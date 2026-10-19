import type {
  AskSpec,
  GitPolicy,
  InitFacts,
  InitIo,
  InitLocations,
  PortRead,
  PortStat,
  RepoScan,
  ScanKind,
  SetupScan,
} from '../types'
import { detectRefusal, FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY, isObject, MAX_READ_BYTES, utf8Bytes } from './facts'
import { chunkLines, reportText } from './render'
import {
  autopilotReply,
  autopilotRunState,
  autopilotStatusPath,
  findGitTop,
  gitRootRefusal,
  MAX_SCAN_ENTRIES,
  notGitRepoReply,
  scanRepo,
} from './scan'
import { scanSetup } from './setup'

/** The reply when init runs where no one can be asked: `claude -p`, or a host that cannot say (fail closed, D-42). */
export const NOT_INTERACTIVE_REPLY =
  'cadre init needs an interactive session to ask its questions. ' +
  'Run /cadre init in a terminal session, not with claude -p.'

/** The reply when the session root cannot be read, worded for init or regen: it stops before it reads anything. */
function rootUnknownReply(command: 'init' | 'regen'): string {
  return `cadre ${command} could not read the session root, so it stopped before reading anything.`
}

/** The reply when the session root cannot be read: init stops before it reads anything. */
export const INIT_ROOT_UNKNOWN_REPLY = rootUnknownReply('init')

/**
 * The text of a `/cadre detect` refusal with every `cadre detect` named for `command` instead, so the refusal reads
 * right for init or regen while detect keeps its own constants byte for byte (Pitfall 10).
 */
export function commandRefusal(refusal: string, command: 'init' | 'regen'): string {
  return refusal.replaceAll('cadre detect', `cadre ${command}`)
}

/** The home-folder refusal as init words it (D-36, Pitfall 10). */
export const INIT_HOME_ROOT_REPLY = commandRefusal(HOME_ROOT_REPLY, 'init')

/** The file-system-root refusal as init words it (D-36, Pitfall 10). */
export const INIT_FILE_SYSTEM_ROOT_REPLY = commandRefusal(FILE_SYSTEM_ROOT_REPLY, 'init')

/** The reply when a dialog is dismissed or never answered with a listed choice: nothing was written (D-45). */
export const INIT_CANCELLED = 'init cancelled, nothing written'

/** The last line of the dry-run reply (PLAN-02). */
export const DRY_RUN_NOTE = 'Dry run: nothing was written.'

/** The last line of the plain init reply in Phase 2: applying the plan arrives with Phase 3 (D-44). */
export const APPLY_LATER_NOTE = 'Applying this plan arrives in a later cadre version; nothing was written.'

/** The line added when the person ignores all of `.cadre/`: a linked worktree would not have the definitions (D-65). */
export const IGNORE_ALL_NOTE = "role definitions won't exist in new worktrees (Phase 3.1)"

/** The total number of asks one question gets: an answer that is not a listed choice is asked again, up to this many. */
export const MAX_ASKS = 3

/** The git policy question (D-65). */
export const GIT_POLICY_QUESTION = 'Git policy for .cadre/?'

/** Each git policy with its dialog label and the word a person may type under "Other" (D-65). */
type GitPolicyEntry = {
  readonly label: string
  readonly word: string
  readonly policy: GitPolicy
}

const GIT_POLICIES: readonly GitPolicyEntry[] =
  Object.freeze([
    { label: 'Commit definitions (default)', word: 'definitions', policy: 'definitions' },
    { label: 'Commit all', word: 'all', policy: 'all' },
    { label: 'Ignore all of .cadre/', word: 'ignore', policy: 'ignore' },
  ])

/** The git policy choices in the fixed order default, all, ignore; nothing is preselected (D-65). */
export const GIT_POLICY_OPTIONS: readonly string[] = Object.freeze(GIT_POLICIES.map(entry => entry.label))

/**
 * The git policy an answer names, else null. The three dialog labels match trimmed and in any case, and so do the
 * words `definitions`, `all` and `ignore` a person may type under "Other". An empty or unknown answer is never a
 * choice.
 */
export function parseGitPolicy(answer: string): GitPolicy | null {
  const wanted = answer.trim().toLowerCase()
  const found = GIT_POLICIES.find(entry => entry.label.toLowerCase() === wanted || entry.word === wanted)

  return found?.policy ?? null
}

/**
 * What the init port answers before it reads a file, or null when the file may be read: `absent` only when the probe
 * says the path is not there, `unknown` when the probe or the stat failed or the stat shows anything but a regular
 * file (a folder, FIFO or device is never read), `too-large` when the stat size is over `maxBytes` (Pitfall 6).
 */
export function portProbeOf(isThere: boolean | null, stat: PortStat | null, maxBytes: number): PortRead | null {
  if (isThere === false) return { state: 'absent' }
  if (isThere === null) return { state: 'unknown' }
  if (stat === null || stat.kind !== 'file') return { state: 'unknown' }
  if (stat.size > maxBytes) return { state: 'too-large', bytes: stat.size }

  return null
}

/** What the init port answers once a file was read: `unknown` when no text came, `too-large` over `maxBytes` UTF-8 bytes. */
export function portTextOf(text: unknown, maxBytes: number): PortRead {
  if (typeof text !== 'string') return { state: 'unknown' }
  const bytes = utf8Bytes(text)
  if (bytes > maxBytes) return { state: 'too-large', bytes }

  return { state: 'text', text }
}

/** Asks once; null when the dialog is dismissed. The rejection is never read, so its text cannot reach a reply. */
async function askOnce(io: InitIo, question: string, spec: AskSpec): Promise<string | null> {
  try {
    return await io.ask(question, spec)
  } catch {
    return null
  }
}

/**
 * Asks `question` and returns what `parse` makes of the answer. An answer `parse` does not take is asked again, up to
 * MAX_ASKS asks in all, and then null; a dismissed dialog is null at once and is not asked again (D-45). A dismissal,
 * an empty answer and an unknown answer are never taken as the person's choice.
 */
export async function askChoice<T>(
  io: InitIo,
  question: string,
  spec: AskSpec,
  parse: (answer: string) => T | null,
): Promise<T | null> {
  for (let asked = 0; asked < MAX_ASKS; asked += 1) {
    const answer = await askOnce(io, question, spec)
    if (answer === null) return null
    const parsed = parse(answer)
    if (parsed !== null) return parsed
  }

  return null
}

/** The line that states each git policy and what stays out of git under it (D-65, D-90). */
const POLICY_LINES: Readonly<Record<GitPolicy, string>> = Object.freeze({
  definitions: 'Git policy: commit definitions (.cadre/*/.runtime/ ignored)',
  all: 'Git policy: commit all (only per-user rendered files in .cadre/*/.runtime/ ignored)',
  ignore: 'Git policy: ignore all of .cadre/',
})

/** The one line that states a git policy and what stays out of git under it. */
export function policyLine(policy: GitPolicy): string {
  return POLICY_LINES[policy]
}

/** A plugin version as cadre writes it: three numbers joined by dots. */
const PLUGIN_VERSION = /^\d+\.\d+\.\d+$/

/** The `version` in the text of cadre's own plugin.json when it is a plain `x.y.z`; null for anything else (D-89). */
export function pluginVersionOf(text: string): string | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(value)) return null
  const { version } = value
  if (typeof version !== 'string' || !PLUGIN_VERSION.test(version)) return null

  return version
}

/** The most characters one transcript entry shows: the host draws only the first 2000 of one log call (P9). */
const LOG_CHUNK_CHARS = 2000

/**
 * Prints lines to the transcript: each line cleaned as a report cell (reportText), so a scanned or typed value cannot
 * add a line or hide text, in entries of at most LOG_CHUNK_CHARS characters (P9).
 */
function logLines(io: InitIo, lines: readonly string[]): void {
  for (const chunk of chunkLines(lines.map(reportText), LOG_CHUNK_CHARS)) io.log(chunk)
}

/** A dialog answer with the value it stands for. */
type Labelled<T> = {
  readonly label: string
  readonly value: T
}

/** The value whose label the answer names, trimmed and in any case; null when it names none, so it is asked again. */
function labelled<T>(entries: readonly Labelled<T>[], answer: string): T | null {
  const wanted = answer.trim().toLowerCase()
  const found = entries.find(entry => entry.label.toLowerCase() === wanted)

  return found === undefined ? null : found.value
}

/** What the guard decided: refuse with this text, or go on with the session's locations. */
export type GuardResult =
  | { readonly kind: 'refuse'; readonly text: string }
  | { readonly kind: 'ok'; readonly locations: InitLocations }

/** A refusal with its text. */
function refuse(text: string): GuardResult {
  return { kind: 'refuse', text }
}

/**
 * The refusal when the session root is not the git top level, or no git repo is above it at all (D-56, D-97b); null
 * when the root is the top level. The walk only stats `.git` and runs no process.
 */
async function gitTopRefusal(io: InitIo, root: string, command: 'init' | 'regen'): Promise<string | null> {
  const found = await findGitTop(io, root)
  if (found.state === 'none') return notGitRepoReply(command)

  return gitRootRefusal(root, found.top, command)
}

/**
 * The refusal when autopilot runs in this session, or when that cannot be told (SCAN-04, D-42), else null. It fails
 * closed: no session id, no clock, no HOME as given, or no usable status path is the unknown reply, before anything is
 * read; then the one status file is read and judged by autopilotRunState.
 */
async function autopilotRefusal(
  io: InitIo,
  givenHome: string | null,
  command: 'init' | 'regen',
): Promise<string | null> {
  const unknown = autopilotReply('unknown', command)
  const sessionId = await io.sessionId()
  if (sessionId === null) return unknown
  const now = await io.now()
  if (now === null) return unknown
  if (givenHome === null) return unknown
  const path = autopilotStatusPath(givenHome, sessionId)
  if (path === null) return unknown
  const read = await io.read(path, MAX_READ_BYTES)

  return autopilotReply(autopilotRunState(read, now), command)
}

/**
 * The guard `/cadre init` and `/cadre regen` run before they scan anything (SCAN-04, D-42, D-56). It refuses, in this
 * order: (init only) a session nobody can be asked in, an unreadable session root, the home folder or the file system
 * root, a root with no git repo above it, a root that is not the git top level, an active autopilot run in this
 * session, and an autopilot state that cannot be read. Regen runs in `claude -p` (D-99), so its guard never asks
 * whether anyone is there. Each refusal is worded for its command, and no check after a refusal runs.
 */
export async function initGuard(io: InitIo, command: 'init' | 'regen'): Promise<GuardResult> {
  if (command === 'init' && (await io.isInteractive()) !== true) return refuse(NOT_INTERACTIVE_REPLY)

  const locations = await io.locations()
  if (locations === null) return refuse(rootUnknownReply(command))

  const rootRefusal = detectRefusal([locations.givenRoot, locations.root], [locations.givenHome, locations.home])
  if (rootRefusal !== null) return refuse(commandRefusal(rootRefusal, command))

  const gitRefusal = await gitTopRefusal(io, locations.root, command)
  if (gitRefusal !== null) return refuse(gitRefusal)

  const runRefusal = await autopilotRefusal(io, locations.givenHome, command)
  if (runRefusal !== null) return refuse(runRefusal)

  return { kind: 'ok', locations }
}

/** The ~/.claude.json consent question (D-58): the file holds account data, so it is read only after a yes. */
export const CLAUDE_JSON_QUESTION =
  'Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.'

/** Each consent answer with what it allows: only the yes reads ~/.claude.json (D-58). */
const CONSENTS: readonly Labelled<boolean>[] = Object.freeze([
  { label: 'Yes, read names only', value: true },
  { label: 'No, skip it', value: false },
])

/** The answers to the consent question, yes first; nothing is preselected (D-58). */
export const CLAUDE_JSON_OPTIONS: readonly string[] = Object.freeze(CONSENTS.map(entry => entry.label))

/** Whether a consent answer allows reading ~/.claude.json; null when it names neither answer (D-58). */
function parseConsent(answer: string): boolean | null {
  return labelled(CONSENTS, answer)
}

/** What the scans of one run found: the detect facts, the repo scan and the names-only user-setup scan. */
export type Gathered = {
  readonly facts: InitFacts
  readonly repo: RepoScan
  readonly setup: SetupScan
}

/**
 * Runs the scans of one init or regen run through the port, read-only: the detect pipeline, the repo scan of the
 * session root (SCAN-01) and the user-setup scan (SCAN-02), which reads ~/.claude.json only when
 * `isClaudeJsonAllowed` is true, the answer to the consent question (D-58).
 */
export async function gatherScans(
  io: InitIo,
  locations: InitLocations,
  isClaudeJsonAllowed: boolean,
): Promise<Gathered> {
  const facts = await io.facts(locations)
  const repo = await scanRepo(io, locations.root)
  const { root, givenRoot, home, configDir } = locations
  const setup = await scanSetup(io, { root, givenRoot, home, configDir }, isClaudeJsonAllowed)

  return { facts, repo, setup }
}

/** The most plugin names the summary shows; the count before them gives the total. */
const MAX_SUMMARY_PLUGINS = 8

/** The line the summary adds when the walk stopped at the entry cap. */
const TRUNCATED_LINE = `  truncated: the scan stopped after ${MAX_SCAN_ENTRIES} entries; later files were not scanned`

/** Names joined with a comma, or `none` when there are none. */
function namesOrNone(names: readonly string[]): string {
  return names.length === 0 ? 'none' : names.join(', ')
}

/** The labels of the repo findings of one kind, in scan order, or `none`. */
function findingLabels(repo: RepoScan, kind: ScanKind): string {
  return namesOrNone(repo.findings.filter(finding => finding.kind === kind).map(finding => finding.label))
}

/** What an earlier run left in `.cadre/`: `none`, or the folder's state with the state of its manifest. */
function cadreSummary(cadre: RepoScan['cadre']): string {
  if (cadre.dir === 'absent') return 'none'

  return `${cadre.dir} (manifest ${cadre.manifestState})`
}

/** The plugin count, with the first MAX_SUMMARY_PLUGINS names when there are any. */
function pluginSummary(plugins: readonly string[]): string {
  if (plugins.length === 0) return '0'

  return `${plugins.length} (${plugins.slice(0, MAX_SUMMARY_PLUGINS).join(', ')})`
}

/**
 * The scans as init prints them before any role question (SCAN-01, SCAN-02): the repo part (stack, frontend, backend,
 * tests, E2E, an existing `.cadre/`, and a line when the walk stopped at the entry cap), then the user setup as names
 * and counts only. No setting value, file content or warning is part of it.
 */
export function scanSummaryLines(repo: RepoScan, setup: SetupScan): string[] {
  const stack = `stack: ${namesOrNone(repo.languages)}`
  const sides = `frontend: ${findingLabels(repo, 'fe')}; backend: ${findingLabels(repo, 'be')}`
  const mcp = namesOrNone(setup.mcp.map(server => server.name))
  const globalMd = setup.hasGlobalClaudeMd ? 'yes' : 'no'

  return [
    'Repo scan (read-only):',
    `  ${stack}; ${sides}`,
    `  tests: ${findingLabels(repo, 'test')}; E2E: ${findingLabels(repo, 'e2e')}`,
    `  existing .cadre/: ${cadreSummary(repo.cadre)}`,
    ...(repo.isTruncated ? [TRUNCATED_LINE] : []),
    'User setup (names only):',
    `  plugins: ${pluginSummary(setup.plugins)}`,
    `  skills: ${setup.skills.length}; MCP servers: ${mcp}; agents: ${setup.agents.length}`,
    `  CLAUDE.md files: ${namesOrNone(setup.claudeMd)}; global ~/.claude/CLAUDE.md: ${globalMd}; ` +
      `memories: ${setup.memoryFiles.length}`,
  ]
}

/** The reply of a finished run: what was asked for, the git policy, and the note that nothing was written. */
function initReply(policy: GitPolicy, dryRun: boolean): string {
  return [
    dryRun ? 'cadre init --dry-run' : 'cadre init',
    policyLine(policy),
    ...(policy === 'ignore' ? [IGNORE_ALL_NOTE] : []),
    dryRun ? DRY_RUN_NOTE : APPLY_LATER_NOTE,
  ].join('\n')
}

/**
 * `/cadre init`. It runs the guard before it reads or asks anything (initGuard), asks the ~/.claude.json consent,
 * runs the scans and prints them, asks the git policy, and ends with the note that nothing was written (D-44, D-82).
 * A dismissed or unlisted answer cancels with INIT_CANCELLED (D-45).
 */
export async function runInit(io: InitIo, options: { readonly dryRun: boolean }): Promise<string> {
  const guard = await initGuard(io, 'init')
  if (guard.kind === 'refuse') return guard.text

  const consent = { options: CLAUDE_JSON_OPTIONS }
  const isClaudeJsonAllowed = await askChoice(io, CLAUDE_JSON_QUESTION, consent, parseConsent)
  if (isClaudeJsonAllowed === null) return INIT_CANCELLED

  const gathered = await gatherScans(io, guard.locations, isClaudeJsonAllowed)
  logLines(io, scanSummaryLines(gathered.repo, gathered.setup))

  const policy = await askChoice(io, GIT_POLICY_QUESTION, { options: GIT_POLICY_OPTIONS }, parseGitPolicy)
  if (policy === null) return INIT_CANCELLED

  return initReply(policy, options.dryRun)
}
