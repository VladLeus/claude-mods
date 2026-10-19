import type {
  AskSpec,
  Choice,
  Detection,
  FrameworkId,
  GitPolicy,
  InitFacts,
  InitIo,
  InitLocations,
  PortRead,
  PortStat,
  RepoScan,
  RoleChange,
  RoleProposal,
  RoleSpec,
  ScanKind,
  SetupScan,
} from '../types'
import { detectAll } from './adapters'
import { PER_ROLE, SAME_FOR_ALL } from './assign'
import {
  clean,
  detectRefusal,
  FILE_SYSTEM_ROOT_REPLY,
  HOME_ROOT_REPLY,
  isObject,
  MAX_READ_BYTES,
  utf8Bytes,
} from './facts'
import { chooseFramework, SUPPORTED_IDS } from './framework'
import { recommend, recommendationLines } from './recommend'
import { cardList, choiceLine, chunkLines, pad, reportText, shown } from './render'
import {
  applyAdjust,
  parseAdjust,
  parseProposal,
  PROPOSE_SYSTEM,
  proposePrompt,
  proposeRoles,
  rolesFromProposal,
} from './roles'
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

/** Each git policy dialog label with the policy it stands for. */
const GIT_POLICY_LABELS: readonly Labelled<GitPolicy>[] = Object.freeze(
  GIT_POLICIES.map(entry => ({ label: entry.label, value: entry.policy })),
)

/** Each git policy word a person may type under "Other", as a label with the policy it stands for. */
const GIT_POLICY_WORDS: readonly Labelled<GitPolicy>[] = Object.freeze(
  GIT_POLICIES.map(entry => ({ label: entry.word, value: entry.policy })),
)

/**
 * The git policy an answer names, else null. The three dialog labels match trimmed and in any case, and so do the
 * words `definitions`, `all` and `ignore` a person may type under "Other". An empty or unknown answer is never a
 * choice.
 */
export function parseGitPolicy(answer: string): GitPolicy | null {
  return labelled(GIT_POLICY_LABELS, answer) ?? labelled(GIT_POLICY_WORDS, answer)
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

/** The plugin count, with their names listed as a card lists names when there are any. */
function pluginSummary(plugins: readonly string[]): string {
  if (plugins.length === 0) return '0'

  return `${plugins.length} (${cardList(plugins.map(shown))})`
}

/**
 * The scans as init prints them before any role question (SCAN-01, SCAN-02): the repo part (stack, frontend, backend,
 * tests, E2E, an existing `.cadre/`, and a line when the walk stopped at the entry cap), then the user setup as names
 * and counts only. Each setup line gives its counts first and its name list last, and a list shows 12 names cleaned and
 * capped, then counts the rest, so a long list never pushes a count past the 240 code points a line keeps (B2). No
 * setting value, file content or warning is part of it.
 */
export function scanSummaryLines(repo: RepoScan, setup: SetupScan): string[] {
  const stack = `stack: ${namesOrNone(repo.languages)}`
  const sides = `frontend: ${findingLabels(repo, 'fe')}; backend: ${findingLabels(repo, 'be')}`
  const mcp = cardList(setup.mcp.map(server => shown(server.name)))
  const globalMd = setup.hasGlobalClaudeMd ? 'yes' : 'no'

  return [
    'Repo scan (read-only):',
    `  ${stack}; ${sides}`,
    `  tests: ${findingLabels(repo, 'test')}; E2E: ${findingLabels(repo, 'e2e')}`,
    `  existing .cadre/: ${cadreSummary(repo.cadre)}`,
    ...(repo.isTruncated ? [TRUNCATED_LINE] : []),
    'User setup (names only):',
    `  plugins: ${pluginSummary(setup.plugins)}`,
    `  skills: ${setup.skills.length}; agents: ${setup.agents.length}; MCP servers: ${mcp}`,
    `  global ~/.claude/CLAUDE.md: ${globalMd}; memories: ${setup.memoryFiles.length}; ` +
      `CLAUDE.md files: ${cardList(setup.claudeMd.map(shown))}`,
  ]
}

/**
 * Every warning the scans of one run gave: those of the locations, of the detect facts, of the repo scan and of the
 * setup scan, in that order, each text once where it first comes. Init prints them right after the scan summary, and
 * 02-13's final review shows the same list again next to the plan.
 */
export function scanWarnings(locations: InitLocations, gathered: Gathered): string[] {
  const all = [
    ...locations.warnings,
    ...gathered.facts.facts.warnings,
    ...gathered.repo.warnings,
    ...gathered.setup.warnings,
  ]

  return Array.from(new Set(all))
}

/** The scan warnings as init prints them, one `warning: <text>` line each; nothing when there are none. */
export function scanWarningLines(warnings: readonly string[]): string[] {
  return warnings.map(warning => `warning: ${warning}`)
}

/** The roles question init asks after it shows the proposal (D-46). */
export const ROLES_QUESTION = 'Use these roles?'

/** What the person can do with the roles shown: use them, adjust them, or describe a structure of their own. */
type RolesChoice = 'use' | 'adjust' | 'describe'

/** Each answer to the roles question with what it does, in the order the dialog shows them (D-46). */
const ROLES_CHOICES: readonly Labelled<RolesChoice>[] = Object.freeze([
  { label: 'Use these roles', value: 'use' },
  { label: 'Adjust them', value: 'adjust' },
  { label: 'Describe my own structure', value: 'describe' },
])

/** The answers to the roles question, in the fixed order use, adjust, describe; nothing is preselected (D-46). */
export const ROLES_OPTIONS: readonly string[] = Object.freeze(ROLES_CHOICES.map(entry => entry.label))

/** The free-text question for the person's own role structure (ROLE-02); its answer is all the model sees (D-83). */
export const DESCRIBE_QUESTION = 'Describe your role structure in your own words (type it in the text field).'

/** What a button of the describe question does: back to the template, or end init. */
type DescribeChoice = 'template' | 'cancel'

/** Each button of the describe question with what it does. */
const DESCRIBE_CHOICES: readonly Labelled<DescribeChoice>[] = Object.freeze([
  { label: 'Use the template instead', value: 'template' },
  { label: 'Cancel init', value: 'cancel' },
])

/** The buttons of the describe question; the description itself is typed in the text field. */
export const DESCRIBE_OPTIONS: readonly string[] = Object.freeze(DESCRIBE_CHOICES.map(entry => entry.label))

/** The Adjust question (D-47): one typed change per answer, with an example of each of the four changes. */
export const ADJUST_QUESTION =
  'Adjust the roles: type one change, for example add docs "Docs writer", drop fe, rename be api "API", ' +
  'or framework qa gsd.'

/** What a button of the Adjust question does: end the loop, or print the roles as they are now. */
type AdjustChoice = 'done' | 'show'

/** Each button of the Adjust question with what it does. */
const ADJUST_CHOICES: readonly Labelled<AdjustChoice>[] = Object.freeze([
  { label: 'Done adjusting', value: 'done' },
  { label: 'Show the roles', value: 'show' },
])

/** The buttons of the Adjust question; a change itself is typed in the text field. */
export const ADJUST_OPTIONS: readonly string[] = Object.freeze(ADJUST_CHOICES.map(entry => entry.label))

/** The most model calls one description gets: the first try and two retries with the exact errors (D-46, D-83). */
export const MAX_PROPOSE_ATTEMPTS = 3

/** The most times the roles question is asked; the round after them cancels, so no roles are taken unconfirmed (A1). */
export const MAX_ROLE_ROUNDS = 10

/** The most answers the Adjust loop takes; after them it shows the roles so far and goes back to the roles question. */
export const MAX_ADJUST_ROUNDS = 30

/** Why the roles step cancels once the roles question was asked MAX_ROLE_ROUNDS times (A1). */
export const ROLE_ROUNDS_REASON =
  `The roles question was asked ${MAX_ROLE_ROUNDS} times without "Use these roles": nothing was chosen.`

/** The note the Adjust loop prints at its cap, before it goes back to the roles question with the roles so far (A1). */
export const ADJUST_ROUNDS_NOTE =
  `Adjust took ${MAX_ADJUST_ROUNDS} answers without "Done adjusting": showing the roles as they are now.`

/** Why the roles step cancels when the roles question is dismissed or never answered with a listed choice (A1). */
export const ROLES_DISMISSED_REASON = 'The roles question was dismissed or not answered.'

/** Why the roles step cancels when the Adjust question is dismissed (A1). */
export const ADJUST_DISMISSED_REASON = 'The Adjust question was dismissed.'

/** Why the roles step cancels when the describe question is dismissed or `Cancel init` is chosen there (A1). */
export const DESCRIBE_CANCELLED_REASON = 'The describe question was dismissed or cancelled.'

/** The column, in code points, where a role's purpose starts in the proposal, after its title and id. */
const ROLE_LABEL_WIDTH = 24

/** Code points of the model's errors the fallback line shows, so a long list never cuts off the line's end. */
const MAX_FALLBACK_ERROR_CHARS = 120

/** The error the next prompt and the fallback line give when the model answered with no text. */
const NO_TEXT_ERROR = 'the model gave no text'

/** The sentence that ends the fallback line. */
const FALLBACK_NOTE = 'Using the template proposal; you can still adjust it.'

/** The roles as the proposal lists them: a heading, then one line per role with its title, id and purpose. */
function roleLines(roles: readonly RoleSpec[]): string[] {
  const rows = roles.map(role => `  ${pad(`${role.title} (${role.id})`, ROLE_LABEL_WIDTH)}${role.purpose}`)

  return ['Proposed roles:', ...rows]
}

/** One scan change: dropped or kept, the role id and the reason, then its evidence paths when there are any. */
function changeLine(change: RoleChange): string {
  const evidence = change.evidence.length === 0 ? '' : ` (${change.evidence.join(', ')})`

  return `  ${change.change} ${change.roleId}: ${change.reason}${evidence}`
}

/**
 * The proposal as init prints it before the roles question (ROLE-01): every role with its title, id and purpose, then
 * every change the scan made to the template with its reason and evidence, or `none` when it made none.
 */
export function proposalLines(roles: readonly RoleSpec[], changes: readonly RoleChange[]): string[] {
  const changeRows = changes.length === 0 ? ['  none'] : changes.map(changeLine)

  return [...roleLines(roles), 'Changes from the scan:', ...changeRows]
}

/** What describeStep gives: the described roles, a return to the template, or the fallback and why. */
type Described =
  | { readonly kind: 'roles'; readonly roles: readonly RoleSpec[] }
  | { readonly kind: 'template' }
  | { readonly kind: 'fallback'; readonly message: string }

/** An answer to the describe question: one of its buttons, or the typed description. */
type DescribeAnswer =
  | { readonly kind: 'template' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'text'; readonly text: string }

/** The answer to the describe question; null for a blank one, so it is asked again and never sent to the model. */
function parseDescribeAnswer(answer: string): DescribeAnswer | null {
  const choice = labelled(DESCRIBE_CHOICES, answer)
  if (choice === 'template') return { kind: 'template' }
  if (choice === 'cancel') return { kind: 'cancel' }
  const text = answer.trim()
  if (text === '') return null

  return { kind: 'text', text }
}

/** The line init prints when the described structure cannot be used: the last errors, cut so the line keeps its end. */
function fallbackMessage(errors: readonly string[]): string {
  const reason = clean(errors.join('; '), MAX_FALLBACK_ERROR_CHARS)

  return `Could not use the described structure: ${reason}. ${FALLBACK_NOTE}`
}

/**
 * Turns the person's description into roles through the model (D-83). The prompt carries the description as a JSON
 * string and nothing from a scan (proposePrompt); every reply is validated by parseProposal, and an invalid one is
 * sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all. Then it falls back with the last errors.
 */
async function proposeFromText(io: InitIo, text: string): Promise<Described> {
  let errors: readonly string[] = []
  for (let attempt = 0; attempt < MAX_PROPOSE_ATTEMPTS; attempt += 1) {
    const reply = await io.complete(proposePrompt(text, errors), PROPOSE_SYSTEM)
    if (reply === null) {
      errors = [NO_TEXT_ERROR]
      continue
    }
    const parsed = parseProposal(reply)
    if (parsed.kind === 'ok') return { kind: 'roles', roles: rolesFromProposal(parsed.roles) }
    errors = parsed.errors
  }

  return { kind: 'fallback', message: fallbackMessage(errors) }
}

/**
 * The Describe path (ROLE-02, D-46, D-83): the person types their own structure in the text field. A blank answer is
 * asked again and never sent to the model; `Use the template instead` goes back with no model call; `Cancel init` or a
 * dismissed dialog is null. Only the typed text reaches the model, and its roles decide nothing until the person
 * answers the roles question again.
 */
export async function describeStep(io: InitIo): Promise<Described | null> {
  const answer = await askChoice(io, DESCRIBE_QUESTION, { options: DESCRIBE_OPTIONS }, parseDescribeAnswer)
  if (answer === null || answer.kind === 'cancel') return null
  if (answer.kind === 'template') return { kind: 'template' }

  return proposeFromText(io, answer.text)
}

/** The message for a typed line that is none of the four changes (D-47). */
function unreadChange(answer: string): string {
  return `Could not read that change: ${answer.trim()}. Use add, drop, rename or framework.`
}

/**
 * The frameworks an Adjust line may set a role to (A5): each supported framework this repo has in use or installed,
 * in SUPPORTED_IDS order, then `none`, the built-in fallback, which is always there.
 */
export function installedFrameworks(detections: readonly Detection[]): FrameworkId[] {
  const isThere = (id: FrameworkId): boolean =>
    detections.some(found => found.id === id && (found.status === 'in-use' || found.status === 'installed'))

  return [...SUPPORTED_IDS.filter(isThere), 'none']
}

/** The message for an Adjust line that sets a role to a framework this repo does not have installed (A5). */
function notInstalledMessage(id: string, framework: FrameworkId, installed: readonly FrameworkId[]): string {
  const names = installed.map(item => FRAMEWORK_LABELS[item]).join(', ')

  return (
    `Cannot set ${id} to ${framework}: it is not installed for this repo (installed: ${names}). ` +
    `${id} keeps its framework.`
  )
}

/**
 * The roles after one typed change, or the exact message why the line cannot be read or the change applied. Setting a
 * role the team has to a framework outside `installed` is refused, so the role keeps its framework (A5).
 */
function adjusted(
  roles: readonly RoleSpec[],
  answer: string,
  installed: readonly FrameworkId[],
): ReturnType<typeof applyAdjust> {
  const op = parseAdjust(answer)
  if (op === null) return { kind: 'error', message: unreadChange(answer) }
  if (op.kind === 'framework' && roles.some(role => role.id === op.id) && !installed.includes(op.framework)) {
    return { kind: 'error', message: notInstalledMessage(op.id, op.framework, installed) }
  }

  return applyAdjust(roles, op)
}

/**
 * What the Adjust loop gives (A1): the roles as adjusted, which are no choice yet, since the roles question still has
 * to confirm them, or why the loop was cancelled.
 */
export type AdjustOutcome =
  | { readonly kind: 'adjusted'; readonly roles: readonly RoleSpec[] }
  | { readonly kind: 'cancelled'; readonly reason: string }

/**
 * The Adjust loop (D-47): one typed change per answer, add, drop, rename or framework, until `Done adjusting`, which
 * gives the roles as adjusted. A line it cannot read, a change applyAdjust refuses, or a framework outside
 * `installed` (A5) prints its exact message and the loop goes on; `Show the roles` prints the roles as they are now.
 * A dismissed dialog cancels with ADJUST_DISMISSED_REASON. After MAX_ADJUST_ROUNDS answers it prints
 * ADJUST_ROUNDS_NOTE and gives the roles adjusted so far, so the roles question asks about them again: a cap is never
 * an acceptance (A1). The roles it is given are never changed.
 */
export async function adjustLoop(
  io: InitIo,
  roles: readonly RoleSpec[],
  installed: readonly FrameworkId[],
): Promise<AdjustOutcome> {
  let current = roles
  for (let round = 0; round < MAX_ADJUST_ROUNDS; round += 1) {
    const answer = await askOnce(io, ADJUST_QUESTION, { options: ADJUST_OPTIONS })
    if (answer === null) return { kind: 'cancelled', reason: ADJUST_DISMISSED_REASON }
    const choice = labelled(ADJUST_CHOICES, answer)
    if (choice === 'done') return { kind: 'adjusted', roles: current }
    if (choice === 'show') {
      logLines(io, roleLines(current))
      continue
    }
    const result = adjusted(current, answer, installed)
    if (result.kind === 'error') {
      logLines(io, [result.message])
      continue
    }
    current = result.roles
  }
  logLines(io, [ADJUST_ROUNDS_NOTE])

  return { kind: 'adjusted', roles: current }
}

/** The answer to the roles question, or null when it names none of the three, so it is asked again. */
function parseRolesChoice(answer: string): RolesChoice | null {
  return labelled(ROLES_CHOICES, answer)
}

/**
 * The state of the roles step (A1, D-40, D-83):
 * - `proposed`: the roles, with the scan changes behind them (none for a described structure), are shown and the
 *   roles question is asked.
 * - `adjusting`: the Adjust loop runs on those roles.
 * - `describing`: the person describes a structure of their own.
 * - `accepted`: the person answered `Use these roles` for the roles shown; the only state that holds a choice.
 * - `cancelled`: the step ended with nothing chosen, and `reason` says why.
 */
export type RolesState =
  | { readonly kind: 'proposed'; readonly roles: readonly RoleSpec[]; readonly changes: readonly RoleChange[] }
  | { readonly kind: 'adjusting'; readonly roles: readonly RoleSpec[]; readonly changes: readonly RoleChange[] }
  | { readonly kind: 'describing' }
  | { readonly kind: 'accepted'; readonly roles: readonly RoleSpec[] }
  | { readonly kind: 'cancelled'; readonly reason: string }

/** The roles step cancelled with a reason. */
function rolesCancelled(reason: string): RolesState {
  return { kind: 'cancelled', reason }
}

/** After `proposed`: the roles are shown and asked about; only `Use these roles` accepts them. */
async function afterProposed(
  io: InitIo,
  state: Extract<RolesState, { readonly kind: 'proposed' }>,
): Promise<RolesState> {
  logLines(io, proposalLines(state.roles, state.changes))
  const choice = await askChoice(io, ROLES_QUESTION, { options: ROLES_OPTIONS }, parseRolesChoice)
  if (choice === null) return rolesCancelled(ROLES_DISMISSED_REASON)
  if (choice === 'use') return { kind: 'accepted', roles: state.roles }
  if (choice === 'adjust') return { kind: 'adjusting', roles: state.roles, changes: state.changes }

  return { kind: 'describing' }
}

/** After `adjusting`: the adjusted roles are proposed again with the same scan changes, or the step is cancelled. */
async function afterAdjusting(
  io: InitIo,
  state: Extract<RolesState, { readonly kind: 'adjusting' }>,
  installed: readonly FrameworkId[],
): Promise<RolesState> {
  const outcome = await adjustLoop(io, state.roles, installed)
  if (outcome.kind === 'cancelled') return rolesCancelled(outcome.reason)

  return { kind: 'proposed', roles: outcome.roles, changes: state.changes }
}

/**
 * After `describing`: the described roles are proposed with no scan changes; going back to the template, or roles the
 * model could not give (its reason printed first), proposes the template again; a dismissal or `Cancel init` cancels.
 */
async function afterDescribing(io: InitIo, proposal: RoleProposal): Promise<RolesState> {
  const described = await describeStep(io)
  if (described === null) return rolesCancelled(DESCRIBE_CANCELLED_REASON)
  if (described.kind === 'roles') return { kind: 'proposed', roles: described.roles, changes: [] }
  if (described.kind === 'fallback') logLines(io, [described.message])

  return { kind: 'proposed', roles: proposal.roles, changes: proposal.changes }
}

/** The state after one step of the roles step; an end state stays as it is. */
async function nextState(
  io: InitIo,
  state: RolesState,
  proposal: RoleProposal,
  installed: readonly FrameworkId[],
): Promise<RolesState> {
  switch (state.kind) {
    case 'proposed':
      return afterProposed(io, state)
    case 'adjusting':
      return afterAdjusting(io, state, installed)
    case 'describing':
      return afterDescribing(io, proposal)
    case 'accepted':
    case 'cancelled':
      return state
  }
}

/**
 * The roles step (ROLE-01, ROLE-02, D-40, D-46, D-47, D-83), as the states of RolesState. It starts at `proposed`
 * with the proposal and shows the roles with the scan changes behind them under `Use these roles?`. `Adjust them`
 * runs adjustLoop with the frameworks `installed` for the repo and `Describe my own structure` runs describeStep;
 * either goes back to `proposed`. Only the answer `Use these roles` gives roles (`accepted`): a dismissal anywhere
 * cancels with the reason of that question, and the round after MAX_ROLE_ROUNDS proposals cancels with
 * ROLE_ROUNDS_REASON, so roles nobody confirmed, such as a model's, are never used.
 */
export async function rolesStep(
  io: InitIo,
  proposal: RoleProposal,
  installed: readonly FrameworkId[],
): Promise<Extract<RolesState, { readonly kind: 'accepted' | 'cancelled' }>> {
  let state: RolesState = { kind: 'proposed', roles: proposal.roles, changes: proposal.changes }
  let rounds = 0
  for (;;) {
    if (state.kind === 'accepted' || state.kind === 'cancelled') return state
    const isPastCap = state.kind === 'proposed' && rounds === MAX_ROLE_ROUNDS
    if (isPastCap) return { kind: 'cancelled', reason: ROLE_ROUNDS_REASON }
    if (state.kind === 'proposed') rounds += 1
    state = await nextState(io, state, proposal, installed)
  }
}

/** The framework names the framework questions show; none of them is marked as a default (D-07). */
export const FRAMEWORK_LABELS: Readonly<Record<FrameworkId, string>> = Object.freeze({
  gsd: 'GSD',
  superpowers: 'superpowers',
  none: 'none (built-in)',
})

/** The start of DET-03's framework question; the reason it is asked follows in brackets (D-73). */
export const FRAMEWORK_QUESTION_PREFIX = 'Which framework do the roles use?'

/** The one follow-up question after `Same for all roles` (D-86). */
export const FRAMEWORK_ALL_QUESTION = 'Framework for all roles?'

/** The framework question for one role, by its title, after `Per role` (D-73). */
export function frameworkRoleQuestion(title: string): string {
  return `Framework for ${title}?`
}

/**
 * Why init asks which framework the roles use (D-73): more than one framework is in use, or none is but some are
 * installed for the user (D-29). For a choice init asks nothing about, the text says what the choice found.
 */
export function frameworkReason(choice: Choice): string {
  switch (choice.kind) {
    case 'ambiguous':
      return 'more than one framework is in use'
    case 'installed-only':
      return 'none is in use here, but some are installed for you'
    case 'chosen':
      return choice.reason
    case 'unsupported':
      return 'only frameworks cadre does not support were found'
    case 'none':
      return 'no framework was found'
  }
}

/** How the framework question is answered: once for every role, or role by role (D-86). */
type FrameworkMode = 'same' | 'each'

/** The answers to the first framework question, `Same for all roles` first (D-86). */
const FRAMEWORK_MODES: readonly Labelled<FrameworkMode>[] = Object.freeze([
  { label: SAME_FOR_ALL, value: 'same' },
  { label: PER_ROLE, value: 'each' },
])

/** The buttons of the first framework question. */
const FRAMEWORK_MODE_OPTIONS: readonly string[] = Object.freeze(FRAMEWORK_MODES.map(entry => entry.label))

/** The answer to the first framework question, or null when it names neither, so it is asked again. */
function parseFrameworkMode(answer: string): FrameworkMode | null {
  return labelled(FRAMEWORK_MODES, answer)
}

/** The framework an answer names among `allowed`, by its label or its id, trimmed and in any case; else null. */
function parseFramework(answer: string, allowed: readonly FrameworkId[]): FrameworkId | null {
  const wanted = answer.trim().toLowerCase()

  return allowed.find(id => id === wanted || FRAMEWORK_LABELS[id].toLowerCase() === wanted) ?? null
}

/** The role with its framework set. */
function withFramework(role: RoleSpec, framework: FrameworkId): RoleSpec {
  return { ...role, framework }
}

/** What the framework step decided: the roles, each with its framework when it was asked, and the repo default. */
type Framed = {
  readonly roles: readonly RoleSpec[]
  readonly repoDefault: FrameworkId | null
}

/**
 * DET-03's question for an ambiguous or installed-only choice (D-73, D-86): the reason, then `Same for all roles` or
 * `Per role`, then the framework once for every role or for each role in role order. The options are the frameworks
 * of the choice in SUPPORTED_IDS order, then `none (built-in)`, with nothing preselected (D-07). Every role stores its
 * answer and there is no repo default. A dismissed question is null, never a choice (D-45).
 */
async function askFrameworks(
  io: InitIo,
  choice: Extract<Choice, { readonly kind: 'ambiguous' | 'installed-only' }>,
  roles: readonly RoleSpec[],
): Promise<Framed | null> {
  const allowed: readonly FrameworkId[] = [...SUPPORTED_IDS.filter(id => choice.ids.includes(id)), 'none']
  const spec = { options: allowed.map(id => FRAMEWORK_LABELS[id]) }
  const parse = (answer: string): FrameworkId | null => parseFramework(answer, allowed)
  const question = `${FRAMEWORK_QUESTION_PREFIX} (asked because ${frameworkReason(choice)})`
  const mode = await askChoice(io, question, { options: FRAMEWORK_MODE_OPTIONS }, parseFrameworkMode)
  if (mode === null) return null
  if (mode === 'same') {
    const framework = await askChoice(io, FRAMEWORK_ALL_QUESTION, spec, parse)

    return framework === null ? null : { roles: roles.map(role => withFramework(role, framework)), repoDefault: null }
  }

  const framed: RoleSpec[] = []
  for (const role of roles) {
    const framework = await askChoice(io, frameworkRoleQuestion(role.title), spec, parse)
    if (framework === null) return null
    framed.push(withFramework(role, framework))
  }

  return { roles: framed, repoDefault: null }
}

/**
 * The framework step (DET-03, D-73, D-17). With exactly one framework in use nothing is asked: the roles keep
 * `framework` absent (an Adjust override stays) and that framework is the repo default. An ambiguous or installed-only
 * choice is asked (askFrameworks), so every role stores its framework and there is no repo default. Unsupported and
 * none ask nothing and give the built-in default; unsupported prints what was found. Null when a question is dismissed.
 */
export async function frameworkStep(io: InitIo, choice: Choice, roles: readonly RoleSpec[]): Promise<Framed | null> {
  switch (choice.kind) {
    case 'chosen':
      return { roles, repoDefault: choice.id }
    case 'ambiguous':
    case 'installed-only':
      return askFrameworks(io, choice, roles)
    case 'unsupported':
      logLines(io, [choiceLine(choice)])

      return { roles, repoDefault: 'none' }
    case 'none':
      return { roles, repoDefault: 'none' }
  }
}

/** The framework a role runs on: its own, else the repo default, else `none`, the built-in fallback (D-73, D-17). */
export function resolvedFramework(role: RoleSpec, repoDefault: FrameworkId | null): FrameworkId {
  return role.framework ?? repoDefault ?? 'none'
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
 * runs the scans and prints them with their warnings, takes the roles (rolesStep) and their frameworks
 * (frameworkStep), prints the recommendations (ROLE-03), asks the git policy, and ends with the note that nothing was
 * written (D-44, D-82). A dismissed or unlisted answer cancels with INIT_CANCELLED (D-45); a cancelled roles step
 * prints its reason first, and only roles the person accepted reach the steps after it (A1).
 */
export async function runInit(io: InitIo, options: { readonly dryRun: boolean }): Promise<string> {
  const guard = await initGuard(io, 'init')
  if (guard.kind === 'refuse') return guard.text

  const consent = { options: CLAUDE_JSON_OPTIONS }
  const isClaudeJsonAllowed = await askChoice(io, CLAUDE_JSON_QUESTION, consent, parseConsent)
  if (isClaudeJsonAllowed === null) return INIT_CANCELLED

  const gathered = await gatherScans(io, guard.locations, isClaudeJsonAllowed)
  const warnings = scanWarningLines(scanWarnings(guard.locations, gathered))
  logLines(io, [...scanSummaryLines(gathered.repo, gathered.setup), ...warnings])

  const detections = detectAll(gathered.facts.facts)
  const chosen = await rolesStep(io, proposeRoles(gathered.repo), installedFrameworks(detections))
  if (chosen.kind === 'cancelled') {
    logLines(io, [chosen.reason])

    return INIT_CANCELLED
  }

  const framed = await frameworkStep(io, chooseFramework(detections, null), chosen.roles)
  if (framed === null) return INIT_CANCELLED

  const { roles, repoDefault } = framed
  const frameworks = roles.map(role => resolvedFramework(role, repoDefault))
  const recommendations = recommend({ roles, frameworks, scan: gathered.repo, setup: gathered.setup })
  logLines(io, recommendationLines(recommendations, roles))

  const policy = await askChoice(io, GIT_POLICY_QUESTION, { options: GIT_POLICY_OPTIONS }, parseGitPolicy)
  if (policy === null) return INIT_CANCELLED

  return initReply(policy, options.dryRun)
}
