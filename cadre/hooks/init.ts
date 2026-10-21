import type {
  CadreState,
  Choice,
  CompiledScope,
  DesiredFile,
  Detection,
  FrameworkId,
  GitPolicy,
  HostIo,
  HunkOp,
  InitFacts,
  InitIo,
  InitLocations,
  InstructionGroup,
  InstructionHandout,
  InstructionScan,
  InstructionTopic,
  LaunchStart,
  Manifest,
  ManifestEntry,
  McpRoute,
  Plan,
  PortEntry,
  PortRead,
  PortStat,
  RepoScan,
  RoleCarry,
  RoleChange,
  RoleProposal,
  RoleSpec,
  ScanKind,
  ScopeContext,
  SetupScan,
  WriteStat,
} from '../types'
import { ADAPTERS, detectAll } from './adapters'
import {
  applyListPaths,
  applySteps,
  applyStatPaths,
  chmodArgv,
  chmodProblem,
  CONFLICT_OPTIONS,
  conflictPaths,
  conflictQuestion,
  hunkFailureLine,
  hunkRuns,
  hunksAfterRuns,
  installedLine,
  installFailureText,
  listedLinkProblem,
  MARKETPLACE_ADD_ARGV,
  noHomeInstallText,
  parseConflictAnswer,
  pluginInstallArgv,
  PYTHON_VERSION_ARGV,
  pythonProblem,
  setupAfterInstalls,
  writeProblem,
} from './apply'
import type { ApplyStep, ConflictChoice, HunkRun } from './apply'
import {
  accepted,
  ASK_HEADERS,
  askChoice,
  askedText,
  askOnce,
  cancelled,
  choiceResult,
  contextText,
  MAX_ASKS,
  noteLine,
  quotedLabels,
  showBlock,
  withContext,
} from './ask'
import type { AskResult, ChoiceAsk, StepResult } from './ask'
import {
  ALL_ENV_OPTION,
  ALL_OPTION,
  assignToRoles,
  classifyMcp,
  classifySkills,
  CLAUDE_SECURITY_PLUGIN,
  CLAUDE_SECURITY_SKILL,
  envQuestion,
  groupUses,
  mcpQuestion,
  memoryQuestion,
  MODEL_EFFORT_OPTIONS,
  modelEffortRefusal,
  NONE_OPTION,
  orderGroupsByUse,
  parseEnvNames,
  parseModelEffort,
  parseRoleList,
  PER_ROLE,
  SAME_FOR_ALL,
  skillGroupQuestion,
} from './assign'
import type { NameAssignment } from './assign'
import {
  clean,
  detectRefusal,
  FILE_SYSTEM_ROOT_REPLY,
  HOME_ROOT_REPLY,
  isDirInsideRoot,
  isObject,
  MAX_READ_BYTES,
  sortedUnique,
  trimSlash,
  utf8Bytes,
} from './facts'
import { chooseFramework, SUPPORTED_IDS } from './framework'
import { desiredFiles } from './generate'
import { handoutStep } from './handout'
import { sha256Hex } from './hash'
import { historyStep } from './history'
import type { HistoryScan } from './history'
import {
  CONTENT_DISMISSED_REASON,
  CONTENT_OPTIONS,
  CONTENT_QUESTION,
  contentContextLine,
  fallbackTopics,
  HANDOUT_DISMISSED_REASON,
  instructionLines,
  instructionReviewLines,
  instructionsEntry,
  parseContentConsent,
  parseRecommendation,
  parseTopics,
  readInstructionFiles,
  RECOMMEND_SYSTEM,
  recommendPrompt,
  topicItems,
  TOPICS_SYSTEM,
  topicsPrompt,
} from './instructions'
import { gitignoreLines, mergeIgnoreBlock, planReadPaths, planSummary, planWithManifest, renderPlan } from './plan'
import {
  attendedNote,
  hunkCandidates,
  hunkOp,
  hunkQuestion,
  isAttendedFromConfig,
  isUnmetHunk,
  missingSecurityPlugins,
  parseHunkAnswer,
  recommend,
  recommendationLines,
  resolveToolCommand,
} from './recommend'
import type { HunkCandidate } from './recommend'
import { cardList, choiceLine, pad, reportText, shown } from './render'
import {
  applyAdjust,
  EFFORTS,
  isAutopilotDuration,
  MODEL_ALIASES,
  parseAdjust,
  parseProposal,
  parseRoleJson,
  PROPOSE_SYSTEM,
  proposePrompt,
  proposeRoles,
  rolesFromProposal,
  standsFor,
} from './roles'
import {
  autopilotReply,
  autopilotRunState,
  autopilotStatusPath,
  findGitTop,
  gitRootRefusal,
  isSafeRelativePath,
  MAX_FOLDER_ENTRIES,
  MAX_SCAN_ENTRIES,
  notGitRepoReply,
  parseCadreState,
  readRepoFile,
  scanRepo,
  undecidedFacts,
} from './scan'
import type { CommandWord } from './scan'
import { compileScope, pluginName, scopeCardLines } from './scope'
import { scanSetup } from './setup'

/** The reply when init runs where no one can be asked: `claude -p`, or a host that cannot say (fail closed, D-42). */
export const NOT_INTERACTIVE_REPLY =
  'cadre init needs an interactive session to ask its questions. ' +
  'Run /cadre init in a terminal session, not with claude -p.'

/** The reply when the session root cannot be read, worded for its command: it stops before it reads anything. */
function rootUnknownReply(command: CommandWord): string {
  return `cadre ${command} could not read the session root, so it stopped before reading anything.`
}

/** The reply when the session root cannot be read: init stops before it reads anything. */
export const INIT_ROOT_UNKNOWN_REPLY = rootUnknownReply('init')

/**
 * The text of a `/cadre detect` refusal with every `cadre detect` named for `command` instead, so the refusal reads
 * right for init, regen, start or status while detect keeps its own constants byte for byte (Pitfall 10).
 */
export function commandRefusal(refusal: string, command: CommandWord): string {
  return refusal.replaceAll('cadre detect', `cadre ${command}`)
}

/** The home-folder refusal as init words it (D-36, Pitfall 10). */
export const INIT_HOME_ROOT_REPLY = commandRefusal(HOME_ROOT_REPLY, 'init')

/** The file-system-root refusal as init words it (D-36, Pitfall 10). */
export const INIT_FILE_SYSTEM_ROOT_REPLY = commandRefusal(FILE_SYSTEM_ROOT_REPLY, 'init')

/**
 * The start of the reply when a dialog is dismissed or never answered with a listed choice: nothing was written
 * (D-45); cancelledReply adds the reason.
 */
export const INIT_CANCELLED = 'init cancelled, nothing written'

/**
 * The reply of a cancelled init (D-45, batch-1 review S1): INIT_CANCELLED, a colon and the step's reason cleaned as a
 * report cell, so every surface shows why init stopped.
 */
export function cancelledReply(reason: string): string {
  return `${INIT_CANCELLED}: ${reportText(reason)}`
}

/** The last line of the dry-run reply (PLAN-02). */
export const DRY_RUN_NOTE = 'Dry run: nothing was written.'

/** The first applied line when an apply had no step to run: every planned file is already on the disk (D-105). */
export const APPLIED_NONE_NOTE = 'Applied: nothing to write; every file is up to date.'

/** The last line of a plain init or regen reply: what to run next to launch a role from the files written. */
export const NEXT_STEP_NOTE = 'Next: run /cadre start <id> to launch a role.'

/** The start of the manifest-skipped warning; init and regen end it with the command to run again. */
const MANIFEST_SKIPPED_START = '.cadre/manifest.json was not written because a file above was not written: run '

/**
 * The warning in an init reply when apply did not write the manifest because a file write before it failed or was
 * refused, so the manifest never claims a file that is not on the disk (LNCH-01, T-03-18).
 */
export const MANIFEST_SKIPPED_NOTE = `${MANIFEST_SKIPPED_START}/cadre init again.`

/** The manifest-skipped warning of a regen reply: re-running regen of the role is the narrower fix (A4). */
function regenManifestSkippedNote(id: string): string {
  return `${MANIFEST_SKIPPED_START}/cadre regen ${reportText(id)} again.`
}

/** The line added when the person ignores all of `.cadre/`: a linked worktree would not have the definitions (D-65). */
export const IGNORE_ALL_NOTE = "role definitions won't exist in new worktrees"

/** The git policy question (D-65). */
export const GIT_POLICY_QUESTION = 'Git policy for .cadre/?'

/** The context line of the git policy question (D-136): what each policy keeps in git. */
export const GIT_POLICY_CONTEXT =
  'Commit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. ' +
  'Ignore all: nothing in .cadre/ is committed.'

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

/**
 * The git policy choices in the order default, all, ignore: the dialog focuses the first option; the order is fixed
 * (D-65).
 */
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

/** Why init cancels when the git policy question is dismissed or not answered (A1, D-45). */
export const GIT_POLICY_DISMISSED_REASON = 'The git policy question was dismissed or not answered.'

/** What the git policy question takes, as its refusal lists it: the policy words (D-65, D-136). */
const GIT_POLICY_ACCEPTS = GIT_POLICIES.map(entry => entry.word).join(', ')

/**
 * The git policy step (D-65): GIT_POLICY_QUESTION with GIT_POLICY_CONTEXT on its second line (D-136). The policy a
 * label or word names (parseGitPolicy) is accepted, and an answer that names none is asked again with why on top. A
 * dismissal is cancelled with GIT_POLICY_DISMISSED_REASON and MAX_ASKS answers that name no policy with
 * NO_USABLE_ANSWER_REASON, never taken as the default (A1, D-45).
 */
export async function gitPolicyStep(io: InitIo): Promise<StepResult<GitPolicy>> {
  const ask = {
    question: withContext(GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT),
    spec: { options: GIT_POLICY_OPTIONS, header: ASK_HEADERS.gitPolicy },
    parse: parseGitPolicy,
    accepts: GIT_POLICY_ACCEPTS,
  }

  return choiceResult(await askChoice(io, ask), GIT_POLICY_DISMISSED_REASON)
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

/** The role ids of a team in role order, joined with `, `, as a question's refusal or context line names them. */
function idsOf(roles: readonly RoleSpec[]): string {
  return roles.map(role => role.id).join(', ')
}

/** The context line of the framework questions and of the first model question (D-136): the team's role ids. */
export function teamContextLine(roles: readonly RoleSpec[]): string {
  return `Roles: ${idsOf(roles)}.`
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
async function gitTopRefusal(io: InitIo, root: string, command: CommandWord): Promise<string | null> {
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
 * The repo checks a cadre command runs before it reads anything (D-36, D-56, D-97b). It refuses, in this order: an
 * unreadable session root, the home folder or the file system root, a root with no git repo above it, and a root that
 * is not the git top level. Each refusal is worded for `command`, and no check after a refusal runs. It asks no
 * question and does not look for an autopilot run: initGuard adds those checks for init and regen.
 */
export async function repoGuard(io: InitIo, command: CommandWord): Promise<GuardResult> {
  const locations = await io.locations()
  if (locations === null) return refuse(rootUnknownReply(command))

  const rootRefusal = detectRefusal([locations.givenRoot, locations.root], [locations.givenHome, locations.home])
  if (rootRefusal !== null) return refuse(commandRefusal(rootRefusal, command))

  const gitRefusal = await gitTopRefusal(io, locations.root, command)
  if (gitRefusal !== null) return refuse(gitRefusal)

  return { kind: 'ok', locations }
}

/**
 * The guard `/cadre init` and `/cadre regen` run before they scan anything (SCAN-04, D-42, D-56). It refuses, in this
 * order: (init only) a session nobody can be asked in; the repo checks of repoGuard (an unreadable session root, the
 * home folder or the file system root, a root with no git repo above it, a root that is not the git top level); an
 * active autopilot run in this session, and an autopilot state that cannot be read. Regen runs in `claude -p` (D-99),
 * so its guard never asks whether anyone is there. Each refusal is worded for its command, and no check after a
 * refusal runs.
 */
export async function initGuard(io: InitIo, command: 'init' | 'regen'): Promise<GuardResult> {
  if (command === 'init' && (await io.isInteractive()) !== true) return refuse(NOT_INTERACTIVE_REPLY)

  const guard = await repoGuard(io, command)
  if (guard.kind === 'refuse') return guard

  const runRefusal = await autopilotRefusal(io, guard.locations.givenHome, command)
  if (runRefusal !== null) return refuse(runRefusal)

  return guard
}

/** The ~/.claude.json consent question (D-58): the file holds account data, so it is read only after a yes. */
export const CLAUDE_JSON_QUESTION =
  'Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.'

/** The context line of the ~/.claude.json question (D-136): where init still finds MCP servers without the file. */
export const CLAUDE_JSON_CONTEXT =
  'Without it, init still finds MCP servers in .mcp.json, your plugins and this session.'

/** Each consent answer with what it allows, the declining one first: only the yes reads ~/.claude.json (D-58). */
const CONSENTS: readonly Labelled<boolean>[] = Object.freeze([
  { label: 'No, skip it', value: false },
  { label: 'Yes, read names only', value: true },
])

/**
 * The answers to the consent question. The declining answer is first because the engine dialog starts with its first
 * option focused (pre-checked on desktop), so a quick Submit declines (D-58, D-59 as amended by D-134).
 */
export const CLAUDE_JSON_OPTIONS: readonly string[] = Object.freeze(CONSENTS.map(entry => entry.label))

/** Whether a consent answer allows reading ~/.claude.json; null when it names neither answer (D-58). */
function parseConsent(answer: string): boolean | null {
  return labelled(CONSENTS, answer)
}

/** Why init cancels when the ~/.claude.json question is dismissed or not answered (A1, D-45). */
export const CONSENT_DISMISSED_REASON = 'The ~/.claude.json question was dismissed or not answered.'

/**
 * The ~/.claude.json consent step (D-58): CLAUDE_JSON_QUESTION with CLAUDE_JSON_CONTEXT on its second line (D-136).
 * `Yes, read names only` is accepted as true and `No, skip it` as false, and any other answer is asked again with why
 * on top. A dismissal is cancelled with CONSENT_DISMISSED_REASON and MAX_ASKS answers that name neither with
 * NO_USABLE_ANSWER_REASON, so no answer the person did not give decides whether the file is read (A1, D-45).
 */
export async function consentStep(io: InitIo): Promise<StepResult<boolean>> {
  const ask = {
    question: withContext(CLAUDE_JSON_QUESTION, CLAUDE_JSON_CONTEXT),
    spec: { options: CLAUDE_JSON_OPTIONS, header: ASK_HEADERS.claudeJson },
    parse: parseConsent,
    accepts: quotedLabels(CLAUDE_JSON_OPTIONS),
  }

  return choiceResult(await askChoice(io, ask), CONSENT_DISMISSED_REASON)
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

/** How a partial line names a walk that stopped at its overall safety cap (D-137). */
const SAFETY_CAP_TEXT = `the scan stopped at the ${MAX_SCAN_ENTRIES.toLocaleString('en-US')}-entry safety cap`

/**
 * How a partial line ends when the safety cap stopped the walk and no fact is missing: the walk did not reach
 * everything, so nothing is called all found (D-137, batch-1 review N7).
 */
const STOPPED_EARLY_TEXT = 'the scan stopped early; stack, tests and E2E may be incomplete'

/**
 * What a partial line says the scan found (D-137): the facts that may be incomplete; with none, STOPPED_EARLY_TEXT
 * when the safety cap stopped the walk (batch-1 review N7), else that all were found.
 */
function partialFactsText(repo: RepoScan): string {
  const facts = undecidedFacts(repo)
  if (facts.length > 0) return `may be incomplete: ${facts.join(', ')}`
  if (repo.isOverallCapped) return STOPPED_EARLY_TEXT

  return 'stack, tests and E2E were all found'
}

/** The partial line for the deeper folders listed only in part (D-137); null when no folder was capped. */
function folderCapLine(repo: RepoScan): string | null {
  const count = repo.cappedFolders.length
  if (count === 0) return null
  const folders = count === 1 ? 'folder' : 'folders'
  const listed = `${count} deeper ${folders} listed only in part (the first ${MAX_FOLDER_ENTRIES} entries each)`

  return `  partial: ${listed}; ${partialFactsText(repo)}`
}

/**
 * The summary line of a scan that did not list everything (G-02-1e, D-137). A walk that stopped at the safety cap is
 * named first, in place of the folder wording: `  partial: the scan stopped at the 20,000-entry safety cap; ...`.
 * Else, with deeper folders listed only in part: `  partial: <n> deeper folder(s) listed only in part (the first 200
 * entries each); ...`. Either way the line ends with the facts that may be incomplete (undecidedFacts); with none, a
 * walk the safety cap stopped ends with STOPPED_EARLY_TEXT and any other with `stack, tests and E2E were all found`
 * (batch-1 review N7). Null when nothing was capped.
 */
export function truncatedLine(repo: RepoScan): string | null {
  if (repo.isOverallCapped) return `  partial: ${SAFETY_CAP_TEXT}; ${partialFactsText(repo)}`

  return folderCapLine(repo)
}

/**
 * The partial lines of the scan summary (D-137): truncatedLine, then, when the safety cap stopped a walk that had also
 * listed deeper folders only in part, the folder line after it.
 */
function partialLines(repo: RepoScan): string[] {
  const first = truncatedLine(repo)
  if (first === null) return []
  const folders = repo.isOverallCapped ? folderCapLine(repo) : null

  return folders === null ? [first] : [first, folders]
}

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
 * The scans as init shows them in the side pane before any role question (SCAN-01, SCAN-02, D-133): the repo part
 * (stack, frontend, backend, tests, E2E, an existing `.cadre/`, and the partial lines when the walk listed a deeper
 * folder only in part or stopped at its safety cap, D-137), then the user setup as names and counts only. Each setup
 * line gives its counts first and its name list last, and a list shows 12 names cleaned and capped, then counts the
 * rest, so a long list never pushes a count past the 240 code points a line keeps (B2). No setting value, file content
 * or warning is part of it.
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
    ...partialLines(repo),
    'User setup (names only):',
    `  plugins: ${pluginSummary(setup.plugins)}`,
    `  skills: ${setup.skills.length}; agents: ${setup.agents.length}; MCP servers: ${mcp}`,
    `  global ~/.claude/CLAUDE.md: ${globalMd}; memories: ${setup.memoryFiles.length}; ` +
      `CLAUDE.md files: ${cardList(setup.claudeMd.map(shown))}`,
  ]
}

/**
 * The context line of the history question (G-02-1, D-136): what the repo scan found, so the question reads on its
 * own: the stack, then the labels of the frontend, backend, test and E2E findings, each `none` when there is none.
 */
export function scanContextLine(repo: RepoScan): string {
  const sides = `frontend ${findingLabels(repo, 'fe')}; backend ${findingLabels(repo, 'be')}`
  const checks = `tests ${findingLabels(repo, 'test')}; E2E ${findingLabels(repo, 'e2e')}`

  return `Scan: stack ${namesOrNone(repo.languages)}; ${sides}; ${checks}.`
}

/**
 * Every warning the scans of one run gave: those of the locations, of the detect facts, of the repo scan and of the
 * setup scan, in that order, each text once where it first comes. Init shows them right after the scan summary, in its
 * side-pane block, and the final review (reviewStep) shows the same list again next to the plan. A secret read guard
 * registered only in local settings is no warning: launch renders the guard from every settings source (D-103).
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

/** The scan warnings as init shows them, one `warning: <text>` line each; nothing when there are none. */
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

/**
 * The answers to the roles question, in the order use, adjust, describe: the dialog focuses the first option; the
 * order is fixed (D-46).
 */
export const ROLES_OPTIONS: readonly string[] = Object.freeze(ROLES_CHOICES.map(entry => entry.label))

/** The free-text question for the person's own role structure (ROLE-02); its answer is all the model sees (D-83). */
export const DESCRIBE_QUESTION = 'Describe your role structure in your own words (type it in the text field).'

/** The context line of the describe question (D-136): an example of a structure in a person's own words. */
export const DESCRIBE_CONTEXT = 'For example: a PM, one full-stack developer, and a QA who also covers security.'

/** What a button of the describe question does: back to the template, or end init. */
type DescribeChoice = 'template' | 'cancel'

/** Each button of the describe question with what it does. */
const DESCRIBE_CHOICES: readonly Labelled<DescribeChoice>[] = Object.freeze([
  { label: 'Use the template instead', value: 'template' },
  { label: 'Cancel init', value: 'cancel' },
])

/** The buttons of the describe question; the description itself is typed in the text field. */
export const DESCRIBE_OPTIONS: readonly string[] = Object.freeze(DESCRIBE_CHOICES.map(entry => entry.label))

/** What the describe question takes, as its refusal lists it: a typed description or one of its buttons (D-136). */
const DESCRIBE_ACCEPTS = `a description of your roles, ${quotedLabels(DESCRIBE_OPTIONS)}`

/** The Adjust question (D-47): one typed change per answer, with an example of each of the four changes. */
export const ADJUST_QUESTION =
  'Adjust the roles: type one change, for example add docs "Docs writer", drop fe, rename be api "API", ' +
  'or framework qa gsd.'

/** What a button of the Adjust question does: end the loop, or show the roles as they are now in the side pane. */
type AdjustChoice = 'done' | 'show'

/** Each button of the Adjust question with what it does. */
const ADJUST_CHOICES: readonly Labelled<AdjustChoice>[] = Object.freeze([
  { label: 'Done adjusting', value: 'done' },
  { label: 'Show the roles', value: 'show' },
])

/** The buttons of the Adjust question; a change itself is typed in the text field. */
export const ADJUST_OPTIONS: readonly string[] = Object.freeze(ADJUST_CHOICES.map(entry => entry.label))

/** The context line of the Adjust question (D-136): the ids of the roles as they are now, after the changes so far. */
export function adjustContextLine(roles: readonly RoleSpec[]): string {
  return `Roles now: ${idsOf(roles)}.`
}

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

/** Why the roles step cancels when its question is dismissed (A1); unread answers give NO_USABLE_ANSWER_REASON. */
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
 * The proposal as init shows it in the side pane before the roles question (ROLE-01, D-133): every role with its title,
 * id and purpose, then every change the scan made to the template with its reason and evidence, or `none` when it made
 * none.
 */
export function proposalLines(roles: readonly RoleSpec[], changes: readonly RoleChange[]): string[] {
  const changeRows = changes.length === 0 ? ['  none'] : changes.map(changeLine)

  return [...roleLines(roles), 'Changes from the scan:', ...changeRows]
}

/**
 * The context line of the roles question (G-02-1, D-136): every role shown by its title and id, then, when the scan
 * changed the template, how many changes it made (`1 change`, `<n> changes`).
 */
export function rolesContextLine(roles: readonly RoleSpec[], changes: readonly RoleChange[]): string {
  const proposed = `Proposed: ${roles.map(role => `${role.title} (${role.id})`).join(', ')}`
  if (changes.length === 0) return `${proposed}.`
  const noun = changes.length === 1 ? 'change' : 'changes'

  return `${proposed}; ${changes.length} ${noun} from the scan.`
}

/**
 * What describeStep gives: the described roles, a return to the template, the fallback and why, or a cancel with
 * its reason (A1, D-136).
 */
type Described =
  | { readonly kind: 'roles'; readonly roles: readonly RoleSpec[] }
  | { readonly kind: 'template' }
  | { readonly kind: 'fallback'; readonly message: string }
  | { readonly kind: 'cancelled'; readonly reason: string }

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
 * The Describe path (ROLE-02, D-46, D-83): the person types their own structure in the text field of DESCRIBE_QUESTION,
 * which carries DESCRIBE_CONTEXT on its second line (D-136). A blank answer is asked again with why on top and never
 * sent to the model; `Use the template instead` goes back with no model call; `Cancel init` or a dismissed dialog is
 * cancelled with DESCRIBE_CANCELLED_REASON, and MAX_ASKS blank answers with NO_USABLE_ANSWER_REASON (A1). Only the
 * typed text reaches the model, and its roles decide nothing until the person answers the roles question again.
 */
export async function describeStep(io: InitIo): Promise<Described> {
  const ask = {
    question: withContext(DESCRIBE_QUESTION, DESCRIBE_CONTEXT),
    spec: { options: DESCRIBE_OPTIONS, header: ASK_HEADERS.describe },
    parse: parseDescribeAnswer,
    accepts: DESCRIBE_ACCEPTS,
  }
  const answer = choiceResult(await askChoice(io, ask), DESCRIBE_CANCELLED_REASON)
  if (answer.kind === 'cancelled') return answer
  if (answer.value.kind === 'cancel') return { kind: 'cancelled', reason: DESCRIBE_CANCELLED_REASON }
  if (answer.value.kind === 'template') return { kind: 'template' }

  return proposeFromText(io, answer.value.text)
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
 * `installed` (A5) puts its exact message, cleaned as a report cell, on top of the next Adjust ask and the loop goes
 * on (D-136); every ask carries the ids of the roles as they are now (adjustContextLine) on the line after the
 * question; `Show the roles` shows the roles as they are now in the side pane. A dismissed dialog cancels with
 * ADJUST_DISMISSED_REASON. After MAX_ADJUST_ROUNDS answers it prints ADJUST_ROUNDS_NOTE and gives the roles adjusted
 * so far, so the roles question asks about them again: a cap is never an acceptance (A1). The roles it is given are
 * never changed. It keeps its own loop, not askChoice: it runs MAX_ADJUST_ROUNDS rounds, a refused change does not end
 * it, and a taken change asks again with the new roles.
 */
export async function adjustLoop(
  io: InitIo,
  roles: readonly RoleSpec[],
  installed: readonly FrameworkId[],
): Promise<AdjustOutcome> {
  const spec = { options: ADJUST_OPTIONS, header: ASK_HEADERS.adjust }
  let current = roles
  let refusal: string | null = null
  for (let round = 0; round < MAX_ADJUST_ROUNDS; round += 1) {
    const question = withContext(ADJUST_QUESTION, adjustContextLine(current))
    const answer = await askOnce(io, askedText(question, refusal), spec)
    if (answer === null) return { kind: 'cancelled', reason: ADJUST_DISMISSED_REASON }
    refusal = null
    const choice = labelled(ADJUST_CHOICES, answer)
    if (choice === 'done') return { kind: 'adjusted', roles: current }
    if (choice === 'show') {
      await showBlock(io, 'roles', roleLines(current))
      continue
    }
    const result = adjusted(current, answer, installed)
    if (result.kind === 'error') {
      refusal = reportText(result.message)
      continue
    }
    current = result.roles
  }
  await noteLine(io, ADJUST_ROUNDS_NOTE)

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
 * - `accepted`: the person answered `Use these roles` for the roles shown, with the scan changes shown with them (A6);
 *   the only state that holds a choice.
 * - `cancelled`: the step ended with nothing chosen, and `reason` says why.
 */
export type RolesState =
  | { readonly kind: 'proposed'; readonly roles: readonly RoleSpec[]; readonly changes: readonly RoleChange[] }
  | { readonly kind: 'adjusting'; readonly roles: readonly RoleSpec[]; readonly changes: readonly RoleChange[] }
  | { readonly kind: 'describing' }
  | { readonly kind: 'accepted'; readonly roles: readonly RoleSpec[]; readonly changes: readonly RoleChange[] }
  | { readonly kind: 'cancelled'; readonly reason: string }

/** The roles step cancelled with a reason. */
function rolesCancelled(reason: string): RolesState {
  return { kind: 'cancelled', reason }
}

/**
 * After `proposed`: the roles are shown and asked about, with rolesContextLine on the line after the question
 * (D-136); only `Use these roles` accepts them. A dismissal cancels with ROLES_DISMISSED_REASON and MAX_ASKS answers
 * that name no choice with NO_USABLE_ANSWER_REASON (A1).
 */
async function afterProposed(
  io: InitIo,
  state: Extract<RolesState, { readonly kind: 'proposed' }>,
): Promise<RolesState> {
  await showBlock(io, 'roles', proposalLines(state.roles, state.changes))
  const ask = {
    question: withContext(ROLES_QUESTION, rolesContextLine(state.roles, state.changes)),
    spec: { options: ROLES_OPTIONS, header: ASK_HEADERS.roles },
    parse: parseRolesChoice,
    accepts: quotedLabels(ROLES_OPTIONS),
  }
  const picked = choiceResult(await askChoice(io, ask), ROLES_DISMISSED_REASON)
  if (picked.kind === 'cancelled') return rolesCancelled(picked.reason)
  if (picked.value === 'use') return { kind: 'accepted', roles: state.roles, changes: state.changes }
  if (picked.value === 'adjust') return { kind: 'adjusting', roles: state.roles, changes: state.changes }

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
 * model could not give (its reason printed first), proposes the template again; a dismissal, `Cancel init` or
 * MAX_ASKS blank answers cancel with the reason describeStep gives.
 */
async function afterDescribing(io: InitIo, proposal: RoleProposal): Promise<RolesState> {
  const described = await describeStep(io)
  if (described.kind === 'cancelled') return rolesCancelled(described.reason)
  if (described.kind === 'roles') return { kind: 'proposed', roles: described.roles, changes: [] }
  if (described.kind === 'fallback') await noteLine(io, described.message)

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
 * with `start`, the proposal itself unless the final review passes the current team with the scan changes it was
 * accepted with (A6), and shows those roles and changes under `Use these roles?`. `Adjust them` runs adjustLoop with
 * the frameworks `installed` for the repo and `Describe my own structure` runs describeStep, whose template answer goes
 * back to the proposal itself; either goes back to `proposed`. Only the answer `Use these roles` gives roles, as an
 * accepted StepResult with the scan changes shown with them (none for a described structure, A6): a dismissal anywhere
 * is cancelled with the reason of that question, and the round after MAX_ROLE_ROUNDS proposals with
 * ROLE_ROUNDS_REASON, so roles nobody confirmed, such as a model's, are never used (A1).
 */
export async function rolesStep(
  io: InitIo,
  proposal: RoleProposal,
  installed: readonly FrameworkId[],
  start: RoleProposal = proposal,
): Promise<StepResult<RoleProposal>> {
  let state: RolesState = { kind: 'proposed', roles: start.roles, changes: start.changes }
  let rounds = 0
  for (;;) {
    if (state.kind === 'accepted') return accepted({ roles: state.roles, changes: state.changes })
    if (state.kind === 'cancelled') return state
    const isPastCap = state.kind === 'proposed' && rounds === MAX_ROLE_ROUNDS
    if (isPastCap) return cancelled(ROLE_ROUNDS_REASON)
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

/**
 * The framework question for one role after `Per role` (D-73): its title and its id, since the id tells apart roles
 * with the same title (A6).
 */
export function frameworkRoleQuestion(role: Pick<RoleSpec, 'id' | 'title'>): string {
  return `Framework for ${role.title} (${role.id})?`
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

/** How the framework or the model question is answered: once for every role, or role by role (D-86). */
type AnswerMode = 'same' | 'each'

/** The answers to the first framework or model question, `Same for all roles` first (D-86). */
const ANSWER_MODES: readonly Labelled<AnswerMode>[] = Object.freeze([
  { label: SAME_FOR_ALL, value: 'same' },
  { label: PER_ROLE, value: 'each' },
])

/** The buttons of the first framework or model question. */
const ANSWER_MODE_OPTIONS: readonly string[] = Object.freeze(ANSWER_MODES.map(entry => entry.label))

/** The answer to the first framework or model question, or null when it names neither, so it is asked again. */
function parseAnswerMode(answer: string): AnswerMode | null {
  return labelled(ANSWER_MODES, answer)
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

/** Why init cancels when a framework question is dismissed or not answered (A1, D-45). */
export const FRAMEWORK_DISMISSED_REASON = 'A framework question was dismissed or not answered.'

/** Each framework as the refusal of a framework question names it: the word a person may type for it (D-136). */
const FRAMEWORK_WORDS: Readonly<Record<FrameworkId, string>> = Object.freeze({
  gsd: 'GSD',
  superpowers: 'superpowers',
  none: 'none',
})

/**
 * DET-03's question for an ambiguous or installed-only choice (D-73, D-86): the reason, then `Same for all roles` or
 * `Per role`, then the framework once for every role or for each role in role order. The options are the frameworks
 * of the choice in SUPPORTED_IDS order, then `none (built-in)`: the dialog focuses the first option; the order is
 * fixed (D-07). Each of these questions carries the team's role ids (teamContextLine) on its second line, and an
 * answer that names no offered framework is asked again with why on top: the words of the offered frameworks and that
 * a role runs one framework (D-136). Every role stores its answer and there is no repo default. A dismissed question
 * is cancelled with FRAMEWORK_DISMISSED_REASON and MAX_ASKS answers it cannot read with NO_USABLE_ANSWER_REASON, never
 * a choice (A1, D-45).
 */
async function askFrameworks(
  io: InitIo,
  choice: Extract<Choice, { readonly kind: 'ambiguous' | 'installed-only' }>,
  roles: readonly RoleSpec[],
): Promise<StepResult<Framed>> {
  const allowed: readonly FrameworkId[] = [...SUPPORTED_IDS.filter(id => choice.ids.includes(id)), 'none']
  const spec = { options: allowed.map(id => FRAMEWORK_LABELS[id]), header: ASK_HEADERS.framework }
  const parse = (answer: string): FrameworkId | null => parseFramework(answer, allowed)
  const accepts = `${allowed.map(id => FRAMEWORK_WORDS[id]).join(', ')} - a role runs one framework`
  const context = teamContextLine(roles)
  const modeAsk = {
    question: withContext(`${FRAMEWORK_QUESTION_PREFIX} (asked because ${frameworkReason(choice)})`, context),
    spec: { options: ANSWER_MODE_OPTIONS, header: ASK_HEADERS.framework },
    parse: parseAnswerMode,
    accepts: quotedLabels(ANSWER_MODE_OPTIONS),
  }
  const mode = choiceResult(await askChoice(io, modeAsk), FRAMEWORK_DISMISSED_REASON)
  if (mode.kind === 'cancelled') return mode
  if (mode.value === 'same') {
    const allAsk = { question: withContext(FRAMEWORK_ALL_QUESTION, context), spec, parse, accepts }
    const framework = choiceResult(await askChoice(io, allAsk), FRAMEWORK_DISMISSED_REASON)
    if (framework.kind === 'cancelled') return framework

    return accepted({ roles: roles.map(role => withFramework(role, framework.value)), repoDefault: null })
  }

  const framed: RoleSpec[] = []
  for (const role of roles) {
    const roleAsk = { question: withContext(frameworkRoleQuestion(role), context), spec, parse, accepts }
    const framework = choiceResult(await askChoice(io, roleAsk), FRAMEWORK_DISMISSED_REASON)
    if (framework.kind === 'cancelled') return framework
    framed.push(withFramework(role, framework.value))
  }

  return accepted({ roles: framed, repoDefault: null })
}

/**
 * The framework step (DET-03, D-73, D-17). With exactly one framework in use nothing is asked: the roles keep
 * `framework` absent (an Adjust override stays) and that framework is the repo default. An ambiguous or installed-only
 * choice is asked (askFrameworks), so every role stores its framework and there is no repo default. Unsupported and
 * none ask nothing and give the built-in default; unsupported prints what was found. A dismissed question gives the
 * cancel reason FRAMEWORK_DISMISSED_REASON, and MAX_ASKS answers it cannot read NO_USABLE_ANSWER_REASON (A1, D-136).
 */
export async function frameworkStep(
  io: InitIo,
  choice: Choice,
  roles: readonly RoleSpec[],
): Promise<StepResult<Framed>> {
  switch (choice.kind) {
    case 'chosen':
      return accepted({ roles, repoDefault: choice.id })
    case 'ambiguous':
    case 'installed-only':
      return askFrameworks(io, choice, roles)
    case 'unsupported':
      await noteLine(io, choiceLine(choice))

      return accepted({ roles, repoDefault: 'none' })
    case 'none':
      return accepted({ roles, repoDefault: 'none' })
  }
}

/** The framework a role runs on: its own, else the repo default, else `none`, the built-in fallback (D-73, D-17). */
export function resolvedFramework(role: RoleSpec, repoDefault: FrameworkId | null): FrameworkId {
  return role.framework ?? repoDefault ?? 'none'
}

/** The start of the security plugins question, which init asks right after the recommendations (decision #39). */
export const SECURITY_INSTALL_PREFIX = 'Install from claude-plugins-official after you confirm the plan:'

/** The context line of the security plugins question (D-136): nothing is installed before Confirm or in a dry run. */
export const SECURITY_INSTALL_CONTEXT =
  'Nothing is installed before you confirm the final review, and a --dry-run installs nothing.'

/** What each security plugin does, by the plugin name before its `@`, as the question tells it (decision #39). */
const SECURITY_PLUGIN_NOTES: ReadonlyMap<string, string> = new Map([
  [
    'claude-security',
    'claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and ' +
      'writes CLAUDE-SECURITY-<time>/ report folders into the repo.',
  ],
  ['security-guidance', 'security-guidance adds hooks that warn about risky edits.'],
])

/**
 * The security plugins question (decision #39): SECURITY_INSTALL_PREFIX, the names of the missing plugins joined with
 * `and`, then one note for each, so the person knows before answering that claude-security needs Python 3.9 or newer
 * and writes report folders into the repo. `keys` are the plugin keys missingSecurityPlugins gives, each named by
 * pluginName (#72 B3) and shown cleaned and capped as a report cell is, like every printed key (decision #69 B7).
 */
export function securityInstallQuestion(keys: readonly string[]): string {
  const names = keys.map(pluginName)
  const notes = names.flatMap(name => SECURITY_PLUGIN_NOTES.get(name) ?? [])

  return `${SECURITY_INSTALL_PREFIX} ${names.map(reportText).join(' and ')}? ${notes.join(' ')}`
}

/** Each answer to the security plugins question with whether it installs them: only Install does (decision #39). */
const SECURITY_INSTALLS: readonly Labelled<boolean>[] = Object.freeze([
  { label: 'Install', value: true },
  { label: 'Not now', value: false },
])

/**
 * The answers to the security plugins question, Install first: the dialog focuses the first option; the order is fixed
 * (decision #39).
 */
export const SECURITY_INSTALL_OPTIONS: readonly string[] = Object.freeze(SECURITY_INSTALLS.map(entry => entry.label))

/** Why init cancels when the security plugins question is dismissed or not answered (decision #39, A1, D-45). */
export const SECURITY_INSTALL_DISMISSED_REASON = 'The security plugins question was dismissed or not answered.'

/**
 * The security plugins step (decision #39, LNCH-01). With no key it asks nothing and is accepted with none. Else it
 * asks securityInstallQuestion, with SECURITY_INSTALL_CONTEXT on its second line (D-136), and the buttons
 * SECURITY_INSTALL_OPTIONS: Install, trimmed and in any case, is accepted with every key, and Not now with none; any
 * other answer is asked again with why on top. A dismissal is cancelled with SECURITY_INSTALL_DISMISSED_REASON and
 * MAX_ASKS answers that are neither with NO_USABLE_ANSWER_REASON (A1, D-45). It installs nothing itself: the keys are
 * installed only after Confirm, never in --dry-run (applyConfirmed).
 */
export async function securityInstallStep(
  io: InitIo,
  keys: readonly string[],
): Promise<StepResult<readonly string[]>> {
  if (keys.length === 0) return accepted([])
  const ask = {
    question: withContext(securityInstallQuestion(keys), SECURITY_INSTALL_CONTEXT),
    spec: { options: SECURITY_INSTALL_OPTIONS, header: ASK_HEADERS.security },
    parse: (answer: string): boolean | null => labelled(SECURITY_INSTALLS, answer),
    accepts: quotedLabels(SECURITY_INSTALL_OPTIONS),
  }
  const isWanted = choiceResult(await askChoice(io, ask), SECURITY_INSTALL_DISMISSED_REASON)
  if (isWanted.kind === 'cancelled') return isWanted

  return accepted(isWanted.value ? keys : [])
}

/**
 * The roles with the claude-security review skill given or taken away (decision #39): each role that stands for
 * Security, by its id or its `basedOn`, has CLAUDE_SECURITY_SKILL once, last in its skills, when `isWanted`, and not at
 * all when not; every other role is kept as it is. The roles given are not changed.
 */
export function withSecuritySkill(roles: readonly RoleSpec[], isWanted: boolean): RoleSpec[] {
  return roles.map(role => {
    if (!standsFor(role, 'security')) return role
    const skills = role.skills.filter(skill => skill !== CLAUDE_SECURITY_SKILL)

    return { ...role, skills: isWanted ? [...skills, CLAUDE_SECURITY_SKILL] : skills }
  })
}

/** The question init asks once for every role: how long each autopilot run lasts (D-51). */
export const DURATION_QUESTION = 'Autopilot duration for roles?'

/** The context line of the duration question (D-136): the answer applies to every role, named by its id. */
export function durationContextLine(roles: readonly RoleSpec[]): string {
  return `Applies to every role: ${idsOf(roles)}.`
}

/** The duration buttons, 4h first; any other duration is typed under "Other" (D-51). */
export const DURATION_OPTIONS: readonly string[] = Object.freeze(['4h', '2h', '8h'])

/** Why init cancels when the duration question is dismissed (A1, D-45); unread answers give NO_USABLE_ANSWER_REASON. */
export const DURATION_DISMISSED_REASON = 'The autopilot duration question was dismissed or not answered.'

/** A duration answer, trimmed and lowercased, when it is in autopilot's grammar (isAutopilotDuration); else null. */
function parseDuration(answer: string): string | null {
  const duration = answer.trim().toLowerCase()

  return isAutopilotDuration(duration) ? duration : null
}

/** What the duration question takes, as its refusal lists it (D-51, D-136). */
const DURATION_ACCEPTS = 'a duration such as 4h, 90m or 1h30m, at most 168h'

/**
 * The duration question (D-51), asked once for every role, with the ids of `roles` on its second line
 * (durationContextLine, D-136): 4h, 2h or 8h, or any duration typed under "Other". Only an answer in autopilot's
 * grammar, above zero and at most 168 hours, is a duration; any other is asked again with why on top, MAX_ASKS asks in
 * all. A dismissal gives the cancel reason DURATION_DISMISSED_REASON and MAX_ASKS answers that are no duration
 * NO_USABLE_ANSWER_REASON, so nothing is taken (A1). The context threshold is never asked: every role keeps
 * AUTOPILOT_THRESHOLD (D-87).
 */
export async function durationStep(io: InitIo, roles: readonly RoleSpec[]): Promise<StepResult<string>> {
  const ask = {
    question: withContext(DURATION_QUESTION, durationContextLine(roles)),
    spec: { options: DURATION_OPTIONS, header: ASK_HEADERS.duration },
    parse: parseDuration,
    accepts: DURATION_ACCEPTS,
  }

  return choiceResult(await askChoice(io, ask), DURATION_DISMISSED_REASON)
}

/** The roles with this autopilot duration; every other autopilot value, the threshold included, stays as it was. */
function withDuration(roles: readonly RoleSpec[], duration: string): RoleSpec[] {
  return roles.map(role => ({ ...role, autopilot: { ...role.autopilot, duration } }))
}

/** The first model question: one answer for every role or one per role, `Same for all roles` first (D-52, D-86). */
export const MODEL_MODE_QUESTION = 'Model and effort: same for all roles, or per role?'

/** The one model question after `Same for all roles` (D-86). */
const MODEL_ALL_QUESTION = 'Model and effort for all roles?'

/** The context line of each model and effort question (D-136): every model family and effort a role may use. */
export const MODEL_EFFORT_CONTEXT = `Models: ${MODEL_ALIASES.join(', ')}; efforts: ${EFFORTS.join(', ')}.`

/**
 * The model question for one role after `Per role` (D-52): its title and its id, since the id tells apart roles with
 * the same title (A6).
 */
function modelRoleQuestion(role: Pick<RoleSpec, 'id' | 'title'>): string {
  return `Model and effort for ${role.title} (${role.id})?`
}

/** Why init cancels when a model and effort question is dismissed (A1); unread answers give NO_USABLE_ANSWER_REASON. */
export const MODEL_DISMISSED_REASON = 'A model and effort question was dismissed or not answered.'

/** The role with its model family alias and its effort set. */
function withModel(role: RoleSpec, choice: Pick<RoleSpec, 'model' | 'effort'>): RoleSpec {
  return { ...role, model: choice.model, effort: choice.effort }
}

/**
 * Asks one model and effort question at most MAX_ASKS times (D-52, A4, D-136), with MODEL_EFFORT_CONTEXT on the line
 * after the question: askChoice with modelEffortRefusal, cleaned as a report cell, as its refusal. A dismissal gives
 * `dismissed` at once and an answer parseModelEffort reads is the choice; after MAX_ASKS refused answers it gives
 * `exhausted`, so a cap is never a choice (A1).
 */
async function askModelEffort(io: InitIo, question: string): Promise<AskResult<Pick<RoleSpec, 'model' | 'effort'>>> {
  return askChoice(io, {
    question: withContext(question, MODEL_EFFORT_CONTEXT),
    spec: { options: MODEL_EFFORT_OPTIONS, header: ASK_HEADERS.model },
    parse: parseModelEffort,
    accepts: quotedLabels(MODEL_EFFORT_OPTIONS),
    refuse: answer => reportText(modelEffortRefusal(answer)),
  })
}

/**
 * The model and effort step (D-52, D-86): `Same for all roles` or `Per role`, then `opus + medium`, `sonnet + medium`
 * or `sonnet + high`, or a pair typed under "Other", once for every role or for each role in role order. The first
 * question carries the team's role ids (teamContextLine) and each model question MODEL_EFFORT_CONTEXT on its second
 * line (D-136). Each role stores opus, sonnet, haiku or fable, never a pinned model id, and an effort
 * (parseModelEffort, A4); a typed pair it cannot read puts modelEffortRefusal on top of the next ask (askModelEffort).
 * Only an answer to every question gives roles: a dismissal gives the cancel reason MODEL_DISMISSED_REASON, and
 * MAX_ASKS answers it cannot read at one question NO_USABLE_ANSWER_REASON, so no role keeps a model the person did not
 * finish choosing (A1). The roles it is given never change.
 */
export async function modelStep(io: InitIo, roles: readonly RoleSpec[]): Promise<StepResult<readonly RoleSpec[]>> {
  const modeAsk = {
    question: withContext(MODEL_MODE_QUESTION, teamContextLine(roles)),
    spec: { options: ANSWER_MODE_OPTIONS, header: ASK_HEADERS.model },
    parse: parseAnswerMode,
    accepts: quotedLabels(ANSWER_MODE_OPTIONS),
  }
  const mode = choiceResult(await askChoice(io, modeAsk), MODEL_DISMISSED_REASON)
  if (mode.kind === 'cancelled') return mode
  if (mode.value === 'same') {
    const choice = choiceResult(await askModelEffort(io, MODEL_ALL_QUESTION), MODEL_DISMISSED_REASON)
    if (choice.kind === 'cancelled') return choice

    return accepted(roles.map(role => withModel(role, choice.value)))
  }

  const modelled: RoleSpec[] = []
  for (const role of roles) {
    const choice = choiceResult(await askModelEffort(io, modelRoleQuestion(role)), MODEL_DISMISSED_REASON)
    if (choice.kind === 'cancelled') return choice
    modelled.push(withModel(role, choice.value))
  }

  return accepted(modelled)
}

/** The buttons of every question on which roles get an item: no role or every role; a list is typed under "Other". */
const ROLE_LIST_OPTIONS: readonly string[] = Object.freeze([NONE_OPTION, ALL_OPTION])

/** Why init cancels when a question on which roles get an MCP server or skills is dismissed or not answered (A1). */
export const ASSIGNMENT_DISMISSED_REASON =
  'A question on which roles get an MCP server or skills was dismissed or not answered.'

/** The context line of an MCP server question (D-136): the team's role ids; only a role given it can use it. */
export function mcpContextLine(roles: readonly RoleSpec[]): string {
  return `${teamContextLine(roles)} A role not given the server cannot use it.`
}

/** The context line of a skill group question (D-136): the team's role ids, and what giving the skills means. */
export function skillsContextLine(roles: readonly RoleSpec[]): string {
  const meaning = 'A role given these skills can run them in its session; a role not given them cannot.'

  return `${teamContextLine(roles)} ${meaning}`
}

/** One question on which roles get an item, and the names its answer gives them. */
type AssignItem = {
  readonly question: string
  /** The chip of its dialog: ASK_HEADERS.mcp for a server, ASK_HEADERS.skills for a skill group (G-02-3c). */
  readonly header: string
  readonly names: readonly string[]
}

/** What a question on which roles get an item takes, as its refusal lists it: a button or the team's ids (D-136). */
function roleListAccepts(roles: readonly RoleSpec[]): string {
  return `${quotedLabels(ROLE_LIST_OPTIONS)}, or role ids from: ${idsOf(roles)}`
}

/**
 * Asks each item once, answered with None, All roles or a typed list of role ids or titles (parseRoleList), and gives
 * every name of the item to the roles the answer named; an answer that names no role list is asked again with why on
 * top (D-136). A dismissal is cancelled with ASSIGNMENT_DISMISSED_REASON and MAX_ASKS answers it cannot read with
 * NO_USABLE_ANSWER_REASON, so no earlier answer is handed back (A1).
 */
async function askAssignments(
  io: InitIo,
  roles: readonly RoleSpec[],
  items: readonly AssignItem[],
): Promise<StepResult<NameAssignment[]>> {
  const parse = (answer: string): readonly string[] | null => parseRoleList(answer, roles)
  const accepts = roleListAccepts(roles)
  const assignments: NameAssignment[] = []
  for (const item of items) {
    const ask = { question: item.question, spec: { options: ROLE_LIST_OPTIONS, header: item.header }, parse, accepts }
    const roleIds = choiceResult(await askChoice(io, ask), ASSIGNMENT_DISMISSED_REASON)
    if (roleIds.kind === 'cancelled') return roleIds
    assignments.push(...item.names.map(name => ({ name, roleIds: roleIds.value })))
  }

  return accepted(assignments)
}

/**
 * The MCP and skill step (D-53, ISO-04). The servers and skills the name tables decide go to their roles with no
 * question (classifyMcp, classifySkills), and infra servers and handoff and framework skills are never asked about.
 * Each unknown MCP server, then each group of unknown skills by plugin, is asked once, "Which roles get ...? (e.g. BE,
 * QA, or none)", with the team's role ids and what giving the item means on its second line (mcpContextLine,
 * skillsContextLine, D-136), answered with None, All roles or a typed list of role ids or titles; an answer that names
 * any other role is asked again (parseRoleList, T-02-33). The step decides the whole list of each name it asks about:
 * every role first loses those names, then each name joins the `mcp` or `skills` list of the roles its answer names
 * (assignToRoles), so running the step again sets that list, and the names the tables decide stay (A3). With `hints`,
 * the command and skill counts of the history scan, the skill groups are asked busiest first and each question says how
 * often its group was used (orderGroupsByUse, skillGroupQuestion); without hints, or with none that count, the
 * questions and their order are the same as without the scan (D-59). Only an answer to every question gives roles: a
 * dismissal gives the cancel reason ASSIGNMENT_DISMISSED_REASON, and MAX_ASKS answers it cannot read at one question
 * NO_USABLE_ANSWER_REASON (A1, D-136). The roles it is given never change.
 */
export async function assignmentStep(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  hints?: ReadonlyMap<string, number>,
): Promise<StepResult<readonly RoleSpec[]>> {
  const mcp = classifyMcp(setup.mcp, roles)
  const skills = classifySkills(setup.skills, roles)
  const counts = hints ?? new Map<string, number>()
  const serverItems = mcp.unknown.map(name => ({
    question: withContext(mcpQuestion(name), mcpContextLine(roles)),
    header: ASK_HEADERS.mcp,
    names: [name],
  }))
  const groupItems = orderGroupsByUse(skills.groups, counts).map(group => ({
    question: withContext(skillGroupQuestion(group, groupUses(group, counts)), skillsContextLine(roles)),
    header: ASK_HEADERS.skills,
    names: group.names,
  }))
  const servers = await askAssignments(io, roles, serverItems)
  if (servers.kind === 'cancelled') return servers
  const grouped = await askAssignments(io, roles, groupItems)
  if (grouped.kind === 'cancelled') return grouped
  const asked = new Set([...mcp.unknown])
  const askedSkills = new Set(skills.groups.flatMap(group => group.names))
  const unasked = roles.map(role => ({
    ...role,
    mcp: role.mcp.filter(name => !asked.has(name)),
    skills: role.skills.filter(name => !askedSkills.has(name)),
  }))
  const withMcp = assignToRoles(unasked, [...mcp.assigned, ...servers.value], 'mcp')

  return accepted(assignToRoles(withMcp, [...skills.assigned, ...grouped.value], 'skills'))
}

/** The instruction groups in the order init asks about them and a role stores them (D-63). */
const INSTRUCTION_ORDER: readonly InstructionGroup[] = Object.freeze([
  'global-claude-md',
  'auto-memory',
  'project-claude-md',
])

/** Why init cancels when a question on which roles get instructions or memories is dismissed or not answered (A1). */
export const MEMORY_DISMISSED_REASON =
  'A question on which roles get instructions or memories was dismissed or not answered.'

/** The context line of an instruction or memory question (D-136): the team's role ids, and that no content is shown. */
export function memoryContextLine(roles: readonly RoleSpec[]): string {
  return `${teamContextLine(roles)} Their content is never shown or committed.`
}

/**
 * The names the question of an instruction group shows, or null when the scan did not find the group, so it is not
 * asked: none for the global CLAUDE.md, which its label names, the file names of the auto-memories, and the CLAUDE.md
 * files of the chain in display form (D-63, D-100). These are names only: no file is read.
 */
function groupNames(group: InstructionGroup, setup: SetupScan): readonly string[] | null {
  switch (group) {
    case 'global-claude-md':
      return setup.hasGlobalClaudeMd ? [] : null
    case 'auto-memory':
      return setup.memoryFiles.length > 0 ? setup.memoryFiles : null
    case 'project-claude-md':
      return setup.claudeMd.length > 0 ? setup.claudeMd : null
  }
}

/**
 * The instruction and memory step (D-63, D-100). For each group the scan found, in the order the global
 * ~/.claude/CLAUDE.md, the auto-memories for this repo, the project CLAUDE.md, one question names the group and its
 * files and asks which roles get it (memoryQuestion), with the team's role ids and that no content is shown on its
 * second line (memoryContextLine, D-136), answered with None, All roles or a typed list of role ids or titles
 * (parseRoleList), and an answer that names no role list is asked again with why on top; a group the scan did not find
 * is not asked. Each role's `instructions` becomes the groups it was given, in that order, so the answers decide the
 * whole list. Only an answer to every question gives roles: a dismissal gives the cancel reason
 * MEMORY_DISMISSED_REASON, and MAX_ASKS answers it cannot read at one question NO_USABLE_ANSWER_REASON (A1). No file is
 * read and no content is shown; the roles it is given never change.
 */
export async function memoryStep(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
): Promise<StepResult<readonly RoleSpec[]>> {
  const parse = (answer: string): readonly string[] | null => parseRoleList(answer, roles)
  const accepts = roleListAccepts(roles)
  const given = new Map<InstructionGroup, readonly string[]>()
  for (const group of INSTRUCTION_ORDER) {
    const names = groupNames(group, setup)
    if (names === null) continue
    const spec = { options: ROLE_LIST_OPTIONS, header: ASK_HEADERS.memory }
    const ask = { question: withContext(memoryQuestion(group, names), memoryContextLine(roles)), spec, parse, accepts }
    const roleIds = choiceResult(await askChoice(io, ask), MEMORY_DISMISSED_REASON)
    if (roleIds.kind === 'cancelled') return roleIds
    given.set(group, roleIds.value)
  }

  return accepted(
    roles.map(role => ({
      ...role,
      instructions: INSTRUCTION_ORDER.filter(group => given.get(group)?.includes(role.id) === true),
    })),
  )
}

/**
 * The one-line note a plain init prints before the whole-file questions while the instruction parts flow runs only
 * under --dry-run (G-02-1f; user answer 2026-10-21). The gate and this note go once the parts can be written.
 */
export const PARTS_DRY_RUN_ONLY_NOTE =
  'This cadre version shows instruction parts only in --dry-run; a plain init asks the whole-file questions.'

/** What the instruction step gives (G-02-1f): the roles with their instruction groups, and how it handed them out. */
export type Instructed = {
  readonly roles: readonly RoleSpec[]
  readonly instructions: InstructionHandout
}

/** What the parts flow found before the hand-out: the read, its topics and the roles recommended for each topic. */
type PartsFound = {
  readonly scan: InstructionScan
  readonly topics: readonly InstructionTopic[]
  readonly recommended: ReadonlyMap<string, readonly string[]>
}

/** Whether the user-setup scan found anything to hand out: the global CLAUDE.md, a chain file or a memory file. */
function hasInstructionFiles(setup: SetupScan): boolean {
  return setup.hasGlobalClaudeMd || setup.claudeMd.length > 0 || setup.memoryFiles.length > 0
}

/** The roles with no instruction group: nothing to hand out, or the parts flow, gives no D-63 group to any role. */
function withoutGroups(roles: readonly RoleSpec[]): RoleSpec[] {
  return roles.map(role => ({ ...role, instructions: [] }))
}

/** The whole-files hand-out: the D-63 group questions were asked. */
const WHOLE: InstructionHandout = { kind: 'whole' }

/** The whole-file questions of D-63 (memoryStep), handed out as `whole`; a cancel keeps its reason (A1). */
async function wholeFiles(io: InitIo, roles: readonly RoleSpec[], setup: SetupScan): Promise<StepResult<Instructed>> {
  return mapped(await memoryStep(io, roles, setup), (given): Instructed => ({ roles: given, instructions: WHOLE }))
}

/**
 * A plain init while the parts flow runs only under --dry-run (G-02-1f): PARTS_DRY_RUN_ONLY_NOTE as one note, then the
 * whole-file questions (wholeFiles); no content consent is asked and nothing is read.
 */
async function dryRunOnlyNote(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
): Promise<StepResult<Instructed>> {
  await noteLine(io, PARTS_DRY_RUN_ONLY_NOTE)

  return wholeFiles(io, roles, setup)
}

/**
 * The content consent as askChoice asks it (G-02-1f "Consent first", D-134): CONTENT_QUESTION with what the scan found
 * on its second line (contentContextLine), No, skip it first, and the Instructions chip.
 */
function contentAsk(setup: SetupScan): ChoiceAsk<boolean> {
  return {
    question: withContext(CONTENT_QUESTION, contentContextLine(setup)),
    spec: { options: CONTENT_OPTIONS, header: ASK_HEADERS.instructions },
    parse: parseContentConsent,
    accepts: quotedLabels(CONTENT_OPTIONS),
  }
}

/**
 * The topics of a read (G-02-1f Part unit): one model call groups the parts across files (topicsPrompt, TOPICS_SYSTEM).
 * A reply parseTopics cannot take is sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all, and then each
 * file is one topic (fallbackTopics). The model has no tools (D-83), and only its checked topics are kept.
 */
async function groupedTopics(io: InitIo, scan: InstructionScan): Promise<readonly InstructionTopic[]> {
  const partIds = scan.parts.map(part => part.id)
  let errors: readonly string[] = []
  for (let attempt = 0; attempt < MAX_PROPOSE_ATTEMPTS; attempt += 1) {
    const reply = await io.complete(topicsPrompt(scan.parts, errors), TOPICS_SYSTEM)
    const parsed = reply === null ? null : parseTopics(reply, partIds)
    if (parsed?.kind === 'ok') return parsed.topics
    errors = parsed === null ? [NO_TEXT_ERROR] : parsed.errors
  }

  return fallbackTopics(scan)
}

/**
 * The roles recommended for each topic (G-02-1f Recommendation): a second model call reads each role's work and the
 * topics (recommendPrompt, RECOMMEND_SYSTEM). A reply parseRecommendation cannot take is sent back with its exact
 * errors, MAX_PROPOSE_ATTEMPTS calls in all, and then no topic is recommended to any role: the map is empty.
 */
async function recommendedRoles(
  io: InitIo,
  roles: readonly RoleSpec[],
  topics: readonly InstructionTopic[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const topicIds = topics.map(topic => topic.id)
  const roleIds = roles.map(role => role.id)
  let errors: readonly string[] = []
  for (let attempt = 0; attempt < MAX_PROPOSE_ATTEMPTS; attempt += 1) {
    const reply = await io.complete(recommendPrompt(roles, topics, errors), RECOMMEND_SYSTEM)
    const parsed = reply === null ? null : parseRecommendation(reply, topicIds, roleIds)
    if (parsed?.kind === 'ok') return parsed.recommended
    errors = parsed === null ? [NO_TEXT_ERROR] : parsed.errors
  }

  return new Map()
}

/**
 * The hand-out of what the parts flow found (G-02-1f Entry choices): the instructions block in the side pane first
 * (instructionLines), then the entry question and its answers (handoutStep). Whole files asks the whole-file questions
 * (memoryStep); the other answers keep the topics with the roles given each, and give every role no D-63 group. The
 * read, the topics and the answers live in memory for this run only.
 */
async function handOutParts(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  found: PartsFound,
): Promise<StepResult<Instructed>> {
  const { scan, topics, recommended } = found
  await showBlock(io, 'instructions', instructionLines(scan, topics, recommended))
  const items = topicItems(scan, topics, recommended)
  const outcome = await handoutStep(io, instructionsEntry(scan, topics), items, roles, HANDOUT_DISMISSED_REASON)
  if (outcome.kind === 'cancelled') return outcome
  if (outcome.value.kind === 'whole') return wholeFiles(io, roles, setup)
  const instructions: InstructionHandout = { kind: 'parts', scan, topics, recommended, given: outcome.value.given }

  return accepted({ roles: withoutGroups(roles), instructions })
}

/**
 * A consented read that gave no part (G-02-1f): its read warnings, if any, in the instructions block, so each is
 * shown, then the whole-file questions (memoryStep), so the memories keep today's question.
 */
async function noPartRead(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  scan: InstructionScan,
): Promise<StepResult<Instructed>> {
  if (scan.warnings.length > 0) await showBlock(io, 'instructions', instructionLines(scan, [], new Map()))

  return wholeFiles(io, roles, setup)
}

/**
 * The parts flow after a yes (G-02-1f): it reads the instruction files (readInstructionFiles); a read with no part
 * goes to the whole-file questions (noPartRead); else the model groups the parts into topics across files, a second
 * call recommends roles for them, and the person hands them out (handOutParts).
 */
async function partsFlow(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  locations: InitLocations,
): Promise<StepResult<Instructed>> {
  const { root, home, configDir } = locations
  const scan = await readInstructionFiles(io, { root, home, configDir })
  if (scan.parts.length === 0) return noPartRead(io, roles, setup, scan)
  const topics = await groupedTopics(io, scan)
  const recommended = await recommendedRoles(io, roles, topics)

  return handOutParts(io, roles, setup, { scan, topics, recommended })
}

/**
 * The instruction step (G-02-1f, replacing the D-63 group step in the per-role steps). With no global CLAUDE.md, no
 * CLAUDE.md in the repo chain and no memory file it asks nothing, hands out `none` and gives every role no group. A
 * plain init (`isDryRun` false) asks no content consent: it notes PARTS_DRY_RUN_ONLY_NOTE and asks the whole-file
 * questions (memoryStep), handed out as `whole`. A dry run asks the content consent first (contentAsk), so no
 * instruction or memory text is read before a yes: No asks the whole-file questions, and Yes runs the parts flow
 * (partsFlow). A dismissal of any of its questions is cancelled with that question's reason, and MAX_ASKS answers it
 * cannot read with NO_USABLE_ANSWER_REASON (A1). Nothing is written, and the roles it is given never change.
 */
export async function instructionsStep(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  locations: InitLocations,
  isDryRun: boolean,
): Promise<StepResult<Instructed>> {
  if (!hasInstructionFiles(setup)) return accepted({ roles: withoutGroups(roles), instructions: { kind: 'none' } })
  if (!isDryRun) return dryRunOnlyNote(io, roles, setup)
  const consent = choiceResult(await askChoice(io, contentAsk(setup)), CONTENT_DISMISSED_REASON)
  if (consent.kind === 'cancelled') return consent
  if (!consent.value) return wholeFiles(io, roles, setup)

  return partsFlow(io, roles, setup, locations)
}

/**
 * The instruction step again, for the review item memory (G-02-1f): a parts hand-out goes back to its entry question
 * with the same read, topics and recommendations, its block shown again first, so nothing is read and the model is not
 * called again (handOutParts); a whole-files or none hand-out asks the whole-file questions as before (memoryStep) and
 * keeps its kind.
 */
async function instructionsAgain(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  handout: InstructionHandout,
): Promise<StepResult<Instructed>> {
  if (handout.kind === 'parts') return handOutParts(io, roles, setup, handout)

  return mapped(await memoryStep(io, roles, setup), (given): Instructed => ({ roles: given, instructions: handout }))
}

/** The buttons of the env question: no name or every scanned name; names are typed under "Other" (D-60). */
const ENV_OPTIONS: readonly string[] = Object.freeze([NONE_OPTION, ALL_ENV_OPTION])

/** What the env question takes, as its refusal lists it: a button or scanned names (D-60, D-136). */
const ENV_ACCEPTS = `${quotedLabels(ENV_OPTIONS)}, or names from the list, typed exactly`

/** The context line of the env question (D-136): the team's role ids, and that every role carries the same names. */
export function envContextLine(roles: readonly RoleSpec[]): string {
  return `${teamContextLine(roles)} Every role carries the same names; values are filled in at launch.`
}

/** Why init cancels when the env variables question is dismissed (A1); unread answers give NO_USABLE_ANSWER_REASON. */
export const ENV_DISMISSED_REASON = 'The env variables question was dismissed or not answered.'

/** The basename of the GSD secret read guard: the one user hook every role carries when settings register it (D-62). */
const SECRET_READ_GUARD = /^gsd-secret-read-guard\.(?:js|cjs|sh)$/

/** The first line of the side-pane block that lists every scanned env name before the env question (D-135). */
const ENV_PANE_HEADING = 'Env variable names in your settings (values are never read):'

/**
 * The env variable names roles carry (D-60): none when the scan found no name, and then nothing is shown or asked. Else
 * the side pane first lists every scanned name, one per row (D-135), since the question shows only the first five
 * (envQuestion), so All of them never covers a name the person cannot see; then the one env question, with the team's
 * role ids on its second line (envContextLine, D-136), is answered with None, All of them or typed names that were
 * scanned (parseEnvNames), and any other answer is asked again with why on top. A dismissal is cancelled with
 * ENV_DISMISSED_REASON and MAX_ASKS answers that name no scanned variable with NO_USABLE_ANSWER_REASON (A1).
 */
async function carriedEnv(
  io: InitIo,
  names: readonly string[],
  roles: readonly RoleSpec[],
): Promise<StepResult<readonly string[]>> {
  if (names.length === 0) return accepted([])
  const parse = (answer: string): readonly string[] | null => parseEnvNames(answer, names)
  await showBlock(io, 'env', [ENV_PANE_HEADING, ...names.map(name => `  ${name}`)])
  const spec = { options: ENV_OPTIONS, header: ASK_HEADERS.env }
  const ask = { question: withContext(envQuestion(names), envContextLine(roles)), spec, parse, accepts: ENV_ACCEPTS }

  return choiceResult(await askChoice(io, ask), ENV_DISMISSED_REASON)
}

/**
 * The carried settings step (D-60, D-62, D-84). When the user settings define env variables, the side pane lists their
 * names and one question asks which ones roles carry (carriedEnv, D-135); with none, nothing is shown or asked. Every
 * role carries the same: the picked names, never a value; `autoCompactWindow` and `statusLine` when the user settings
 * set them; and the GSD secret read guard, the one hook carried, when any settings source registers it: launch renders
 * it from the user, project and local settings (D-103). Hooks registered in project settings load in roles that start
 * at the git root, and the card lists them as loaded by project settings (D-122). A dismissal gives the cancel reason
 * ENV_DISMISSED_REASON, and MAX_ASKS answers that name no scanned variable NO_USABLE_ANSWER_REASON (A1, D-136). No env
 * or settings value is read, stored or printed (T-02-34); the roles it is given never change.
 */
export async function carryStep(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
): Promise<StepResult<readonly RoleSpec[]>> {
  const env = await carriedEnv(io, setup.carry.envNames, roles)
  if (env.kind === 'cancelled') return env
  const guards = setup.hooks.map(hook => hook.script).filter(script => SECRET_READ_GUARD.test(script))
  const carry: RoleCarry = {
    autoCompactWindow: setup.carry.autoCompactWindow !== null,
    statusLine: setup.carry.hasStatusLine,
    env: env.value,
    hooks: sortedUnique(guards),
  }

  return accepted(roles.map(role => ({ ...role, carry })))
}

/**
 * The user-level GSD dir cadre may run a write through (D-28, D-71, D-72): the raw dir the detect pipeline gave, but
 * only when the facts hold a user-level GSD whose identity is proven; null otherwise, so an unproven GSD or the repo's
 * own copy is never run.
 */
export function provenUserDir(initFacts: InitFacts): string | null {
  const isProven = initFacts.facts.gsd.some(fact => fact.location === 'user' && fact.identity === 'proven')

  return isProven ? initFacts.gsdUserDir : null
}

/** Why init cancels when a hunk question is dismissed (A1, ROLE-04); unread answers give NO_USABLE_ANSWER_REASON. */
export const HUNK_DISMISSED_REASON = 'A hunk question was dismissed or not answered.'

/**
 * The autonomy hunk step (ROLE-04, D-70, D-71, D-72). The framework adapters decide the file and the proposals (A5):
 * for each adapter in ADAPTERS order whose framework a role runs on (resolvedFramework), autonomyHunks(setup) gives
 * the config file its hunks change and the proposals to offer, or null when the framework has no config file to
 * change. Each such file is read through readRepoFile, so a file that links out of the repo is unknown and never read.
 * When no adapter offers a hunk, nothing is asked and there are no hunks. Otherwise each hunk hunkCandidates offers is
 * asked one by one, in that order under `Hunk <i> of <n>`, as its before and after with Accept or Decline
 * (hunkQuestion, parseHunkAnswer). Each op records the answer, the exact command and whether cadre can run it, which
 * only a proven user-level GSD allows (provenUserDir, resolveToolCommand); nothing runs here. When a required hunk is
 * declined or cannot run (isUnmetHunk), the roles stay attended and the attended note names those keys. An answer that
 * is neither Accept nor Decline is asked again with why on top (D-136). A dismissal gives the cancel reason
 * HUNK_DISMISSED_REASON, and MAX_ASKS answers that are neither NO_USABLE_ANSWER_REASON, so no hunk counts as accepted
 * (A1).
 */
export async function hunkStep(
  io: InitIo,
  input: {
    readonly roles: readonly RoleSpec[]
    readonly repoDefault: FrameworkId | null
    readonly gathered: Gathered
    readonly locations: InitLocations
  },
): Promise<StepResult<readonly HunkOp[]>> {
  const { roles, repoDefault, gathered, locations } = input
  const inUse = roles.map(role => resolvedFramework(role, repoDefault))
  const candidates: HunkCandidate[] = []
  for (const adapter of ADAPTERS) {
    if (!inUse.includes(adapter.id)) continue
    const offered = adapter.autonomyHunks(gathered.setup)
    if (offered === null) continue
    const config = await readRepoFile(io, locations.root, offered.file, MAX_READ_BYTES)
    candidates.push(...hunkCandidates(offered.proposals, config))
  }
  if (candidates.length === 0) return accepted([])

  const gsd = {
    userDir: provenUserDir(gathered.facts),
    home: locations.home,
    root: locations.root,
    configDir: locations.configDir,
  }
  const hunks: HunkOp[] = []
  for (const [index, candidate] of candidates.entries()) {
    const { question, spec } = hunkQuestion(candidate, index + 1, candidates.length)
    const ask = { question, spec, parse: parseHunkAnswer, accepts: quotedLabels(spec.options) }
    const isAccepted = choiceResult(await askChoice(io, ask), HUNK_DISMISSED_REASON)
    if (isAccepted.kind === 'cancelled') return isAccepted
    hunks.push(hunkOp(candidate, isAccepted.value, resolveToolCommand(candidate.proposal.write, gsd)))
  }
  const unmet = hunks.filter(isUnmetHunk).map(hunk => hunk.key)
  if (unmet.length > 0) await noteLine(io, attendedNote(unmet))

  return accepted(hunks)
}

/** The question init asks once per repo, right after the git policy: where the role launchers start (A2). */
export const LAUNCH_START_QUESTION = 'Where should the role launchers start their sessions? (asked once for this repo)'

/** The context line of the launcher start question (D-136): the launcher of each role, by its id, starts there. */
export function launchContextLine(roles: readonly RoleSpec[]): string {
  return `The launcher of each role (${idsOf(roles)}) starts its session there.`
}

/** What the launcher start question picks: the git root, the folder a launcher is run from, or a typed folder. */
type LaunchChoice = 'git-root' | 'here' | 'dir'

/** Each launcher start with its dialog label and the word a person may type under "Other" (A2). */
type LaunchStartEntry = {
  readonly label: string
  readonly word: string
  readonly choice: LaunchChoice
}

const LAUNCH_STARTS: readonly LaunchStartEntry[] = Object.freeze([
  { label: 'Git root of this repo', word: 'git root', choice: 'git-root' },
  { label: 'The folder I run it from', word: 'in here', choice: 'here' },
  { label: 'Another folder in this repo', word: 'other', choice: 'dir' },
])

/**
 * The answers to the launcher start question, in the order git root, here, another folder: the dialog focuses the
 * first option; the order is fixed.
 */
export const LAUNCH_START_OPTIONS: readonly string[] = Object.freeze(LAUNCH_STARTS.map(entry => entry.label))

/** Each launcher start dialog label with what it picks. */
const LAUNCH_START_LABELS: readonly Labelled<LaunchChoice>[] = Object.freeze(
  LAUNCH_STARTS.map(entry => ({ label: entry.label, value: entry.choice })),
)

/** Each launcher start word a person may type under "Other", as a label with what it picks. */
const LAUNCH_START_WORDS: readonly Labelled<LaunchChoice>[] = Object.freeze(
  LAUNCH_STARTS.map(entry => ({ label: entry.word, value: entry.choice })),
)

/** The free-text question for the folder the launchers start in, after `Another folder in this repo` (A2). */
export const LAUNCH_DIR_QUESTION =
  'Type the folder the launchers start in, relative to the repo root (for example apps/web).'

/** The context line of the launcher folder question (D-136): which folders can be used. */
export const LAUNCH_DIR_CONTEXT = 'It must be a folder inside this repo; a link that leads out is refused.'

/** The one button of the folder question, which ends init; the folder itself is typed in the text field. */
const LAUNCH_DIR_CHOICES: readonly Labelled<'cancel'>[] = Object.freeze([{ label: 'Cancel init', value: 'cancel' }])

/** The buttons of the folder question. */
export const LAUNCH_DIR_OPTIONS: readonly string[] = Object.freeze(LAUNCH_DIR_CHOICES.map(entry => entry.label))

/** Why init cancels when the launcher start question is dismissed; unread answers give NO_USABLE_ANSWER_REASON. */
export const LAUNCH_START_DISMISSED_REASON = 'The launcher start question was dismissed or not answered.'

/** Why init cancels when the folder question is dismissed or `Cancel init` is chosen there. */
export const LAUNCH_DIR_CANCELLED_REASON = 'The launcher folder question was dismissed or cancelled.'

/** Why init cancels when no typed folder could be used after MAX_ASKS tries. */
export const LAUNCH_DIR_ROUNDS_REASON = `No usable launcher folder after ${MAX_ASKS} tries: nothing was chosen.`

/** The problem with a typed folder that isSafeRelativePath refuses. */
const UNSAFE_LAUNCH_DIR = 'use a folder inside this repo: letters, digits, . _ @ - and /, with no .. and no leading /'

/** The problem with a typed folder whose real path is not a folder inside the repo. */
const NOT_A_LAUNCH_DIR = 'it is not a folder in this repo'

/** The line of the init reply that says where the role launchers start (A2). */
export function launchLine(start: LaunchStart): string {
  if (start.kind === 'git-root') return 'Launchers start in: the git root'
  if (start.kind === 'here') return 'Launchers start in: the folder they are run from'

  return `Launchers start in: ${start.path}/ under the git root`
}

/** The launcher start an answer picks, by its label or its word, trimmed and in any case; else null. */
function parseLaunchChoice(answer: string): LaunchChoice | null {
  return labelled(LAUNCH_START_LABELS, answer) ?? labelled(LAUNCH_START_WORDS, answer)
}

/**
 * Whether a repo-relative path is a folder whose real path lies inside the repo (isDirInsideRoot): a link anywhere in
 * the path that leads out, a file, and a folder whose real path the host could not give are not. The launcher folder
 * question checks a typed folder with it, and regen checks the folder `.cadre/cadre.json` stores.
 */
async function isRepoFolder(io: InitIo, root: string, path: string): Promise<boolean> {
  return isDirInsideRoot(await io.stat(`${root}/${path}`), root)
}

/**
 * What is wrong with a typed launcher folder, or null when it can be used: the path must pass isSafeRelativePath, and
 * it must be a folder inside the repo (isRepoFolder), so a link anywhere in the path that leads out is refused, and so
 * is a folder whose real path the host could not give.
 */
async function launchDirProblem(io: InitIo, root: string, path: string): Promise<string | null> {
  if (!isSafeRelativePath(path)) return UNSAFE_LAUNCH_DIR
  if (!(await isRepoFolder(io, root, path))) return NOT_A_LAUNCH_DIR

  return null
}

/**
 * The folder question (A2), with LAUNCH_DIR_CONTEXT on its second line (D-136), asked at most MAX_ASKS times: `Cancel
 * init` or a dismissal cancels. An answer is trimmed and loses one trailing `/`; one that launchDirProblem refuses
 * puts `Cannot use <typed>: <problem>.`, cleaned as a report cell, on top of the next ask, and after MAX_ASKS refused
 * answers nothing is chosen (LAUNCH_DIR_ROUNDS_REASON). It keeps its own loop, not askChoice: its check is
 * asynchronous (isRepoFolder) and its refusal names the problem that check found.
 */
async function launchDirStep(io: InitIo, root: string): Promise<StepResult<LaunchStart>> {
  const spec = { options: LAUNCH_DIR_OPTIONS, header: ASK_HEADERS.launchDir }
  const question = withContext(LAUNCH_DIR_QUESTION, LAUNCH_DIR_CONTEXT)
  let refusal: string | null = null
  for (let asked = 0; asked < MAX_ASKS; asked += 1) {
    const answer = await askOnce(io, askedText(question, refusal), spec)
    const isCancel = answer === null || labelled(LAUNCH_DIR_CHOICES, answer) === 'cancel'
    if (isCancel) return cancelled(LAUNCH_DIR_CANCELLED_REASON)
    const trimmed = answer.trim()
    const path = trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
    const problem = await launchDirProblem(io, root, path)
    if (problem === null) return accepted({ kind: 'dir', path })
    refusal = reportText(`Cannot use ${shown(answer)}: ${problem}.`)
  }

  return cancelled(LAUNCH_DIR_ROUNDS_REASON)
}

/** What the launcher start question takes, as its refusal lists it: a button or its word (A2, D-136). */
const LAUNCH_START_ACCEPTS = `${quotedLabels(LAUNCH_START_OPTIONS)} (or type git root, in here or other)`

/**
 * Where the role launchers start (A2), asked once per repo right after the git policy, with the ids of `roles` on its
 * second line (launchContextLine, D-136): `Git root of this repo`, `The folder I run it from`, or `Another folder in
 * this repo`, which asks for a folder relative to the repo root (launchDirStep). The labels and the words `git root`,
 * `in here` and `other` match trimmed and in any case, and any other answer is asked again with why on top. Only an
 * explicit answer gives a start: a dismissal (LAUNCH_START_DISMISSED_REASON), MAX_ASKS unlisted answers
 * (NO_USABLE_ANSWER_REASON) or no usable folder is cancelled with a reason, so nothing the person did not confirm is
 * used (A1).
 */
export async function launchStartStep(
  io: InitIo,
  root: string,
  roles: readonly RoleSpec[],
): Promise<StepResult<LaunchStart>> {
  const ask = {
    question: withContext(LAUNCH_START_QUESTION, launchContextLine(roles)),
    spec: { options: LAUNCH_START_OPTIONS, header: ASK_HEADERS.launch },
    parse: parseLaunchChoice,
    accepts: LAUNCH_START_ACCEPTS,
  }
  const picked = choiceResult(await askChoice(io, ask), LAUNCH_START_DISMISSED_REASON)
  if (picked.kind === 'cancelled') return picked
  const choice = picked.value
  if (choice === 'dir') return launchDirStep(io, root)

  return accepted({ kind: choice })
}

/**
 * The MCP route of every role (D-104): merged, so /fleet keeps working in role sessions; a denied server gets tool
 * denies and a deniedMcpServers entry in the runtime settings, which the card labels best-effort (D-124, #39).
 */
export const MCP_ROUTE: McpRoute = 'merged'

/**
 * The frameworks whose roles the answered hunks leave attended (ROLE-04, A5): a framework is attended when its adapter
 * offers autonomy hunks for this setup and a hunk on that adapter's config file is unmet (isUnmetHunk). A framework
 * with no config file to change is never attended this way.
 */
function attendedByHunks(setup: SetupScan, hunks: readonly HunkOp[]): ReadonlySet<FrameworkId> {
  const attended = new Set<FrameworkId>()
  for (const adapter of ADAPTERS) {
    const offered = adapter.autonomyHunks(setup)
    if (offered === null) continue
    if (hunks.some(hunk => hunk.file === offered.file && isUnmetHunk(hunk))) attended.add(adapter.id)
  }

  return attended
}

/**
 * One compiled scope per role, by role id (ROLE-06, D-80): each role is compiled for the framework it runs on
 * (resolvedFramework), with the setup and the code dirs of the scans, the MCP route of every role (MCP_ROUTE, D-104),
 * where the launchers start, so the card tells what loads there (D-122), the whole team for the decision chain, and as
 * attended when its framework is in `attended`.
 */
function compileAll(
  roles: readonly RoleSpec[],
  repoDefault: FrameworkId | null,
  gathered: Gathered,
  attended: ReadonlySet<FrameworkId>,
  launchStart: LaunchStart,
): ReadonlyMap<string, CompiledScope> {
  return new Map(
    roles.map((role): [string, CompiledScope] => {
      const framework = resolvedFramework(role, repoDefault)
      const context: ScopeContext = {
        framework,
        setup: gathered.setup,
        codeDirs: gathered.repo.codeDirs,
        isAttended: attended.has(framework),
        mcpRoute: MCP_ROUTE,
        launchStart,
        roles,
      }

      return [role.id, compileScope(role, context)]
    }),
  )
}

/**
 * The scope of every role, which init shows and plans from (ROLE-06, D-78, D-104): compileScope with the role's own
 * framework or the repo default, the setup and the code dirs of the scans, MCP_ROUTE, where the launchers start (D-122)
 * and the whole team. A role is attended when an unmet hunk is on its framework's config file (A5). Keyed by role id,
 * in role order.
 */
export function scopesFor(
  roles: readonly RoleSpec[],
  repoDefault: FrameworkId | null,
  gathered: Gathered,
  hunks: readonly HunkOp[],
  launchStart: LaunchStart,
): ReadonlyMap<string, CompiledScope> {
  return compileAll(roles, repoDefault, gathered, attendedByHunks(gathered.setup, hunks), launchStart)
}

/** The scope card lines of every role in role order (scopeCardLines); a role with no scope has none (ROLE-06). */
export function cardLines(roles: readonly RoleSpec[], scopes: ReadonlyMap<string, CompiledScope>): string[] {
  return roles.flatMap(role => {
    const scope = scopes.get(role.id)

    return scope === undefined ? [] : scopeCardLines(scope.card)
  })
}

/** What planStep gives: the file plan, the repo state it was planned with, and what apply writes it from (D-105). */
export type PlanResult = {
  readonly plan: Plan
  readonly state: CadreState
  /** The files the plan was built from: apply writes the text of each one it plans to write. */
  readonly desired: readonly DesiredFile[]
  /** The manifest the plan records (planWithManifest): the one apply writes last. */
  readonly manifest: Manifest
  /** The merged root `.gitignore` text; null when no block is planned or the block cannot be merged. */
  readonly gitignore: string | null
}

/** The repo-relative path of the root `.gitignore`, which holds the cadre block (D-64). */
const GITIGNORE_FILE = '.gitignore'

/** Each repo-relative path read through readRepoFile, one at a time, keyed by the path. */
async function readPaths(io: InitIo, root: string, paths: readonly string[]): Promise<ReadonlyMap<string, PortRead>> {
  const disk = new Map<string, PortRead>()
  for (const path of paths) disk.set(path, await readRepoFile(io, root, path, MAX_READ_BYTES))

  return disk
}

/**
 * The truthful file plan of init (PLAN-01, PLAN-03, PLAN-04, D-67). The repo state holds cadre's own version, else
 * `unknown`, the repo default framework, the git policy, the role ids and where the launchers start (A2), and
 * desiredFiles gives every file from it; the repo state also records the consent answer, so regen knows whether it
 * may read ~/.claude.json (A1). Exactly the paths planReadPaths names (each file, the copy beside it and the
 * manifest) and the root `.gitignore` are read, through readRepoFile, so a link out of the repo is unknown and never
 * read. planWithManifest classifies each file against the disk and the last manifest the scan read, then adds the
 * ignore block of the policy (gitignoreLines, which leaves out a `thoughts/` line the file already has and, when a role
 * stands for Security, ends with the line for claude-security's report folders, decision #39) and the hunks.
 * The result also holds what apply writes the plan from: the desired files, the manifest the plan records and the
 * merged `.gitignore` text, which is null when the `.gitignore` cannot be read or its block cannot be merged, since
 * the plan then has no op for it. It writes nothing itself: apply writes the plan after Confirm (applyConfirmed).
 */
export async function planStep(
  io: InitIo,
  input: {
    readonly roles: readonly RoleSpec[]
    readonly repoDefault: FrameworkId | null
    readonly policy: GitPolicy
    readonly launchStart: LaunchStart
    readonly scopes: ReadonlyMap<string, CompiledScope>
    readonly hunks: readonly HunkOp[]
    readonly repo: RepoScan
    readonly locations: InitLocations
    readonly readUserMcp: boolean
  },
): Promise<PlanResult> {
  const { roles, repoDefault, policy, launchStart, scopes, hunks, repo, locations, readUserMcp } = input
  const cadreVersion = (await io.cadreVersion()) ?? 'unknown'
  const state: CadreState = {
    schema: 1,
    cadreVersion,
    framework: repoDefault,
    gitPolicy: policy,
    roles: roles.map(role => role.id),
    launchStart,
    readUserMcp,
  }
  const desired = desiredFiles({ roles, scopes, state, only: null })
  const disk = await readPaths(io, locations.root, planReadPaths(desired))
  const ignoreRead = await readRepoFile(io, locations.root, GITIGNORE_FILE, MAX_READ_BYTES)
  const existing = ignoreRead.state === 'text' ? ignoreRead.text : null
  const lines = gitignoreLines(policy, existing, roles.some(role => standsFor(role, 'security')))
  const { plan, manifest } = await planWithManifest({
    desired,
    disk,
    manifest: repo.cadre.manifest,
    manifestState: repo.cadre.manifestState,
    carried: [],
    gitignore: { disk: ignoreRead, lines },
    hunks,
    cadreVersion,
  })
  const isIgnoreReadable = ignoreRead.state === 'text' || ignoreRead.state === 'absent'
  const gitignore = isIgnoreReadable ? mergeIgnoreBlock(existing, lines) : null

  return { plan, state, desired, manifest, gitignore }
}

/**
 * What one apply did (D-105, LNCH-01). Every path is repo-relative:
 * - `written`: each path whose write landed, in step order, the `.gitignore` and the manifest included;
 * - `executable`: each launcher whose chmod ran and exited 0;
 * - `failed`: each path whose write the host refused or failed;
 * - `refused`: the writeProblem or listedLinkProblem text of each write that was not tried, because the stat of the
 *   path or a folder above it failed, the path is a folder, the path or a folder above it is a link, not a folder or
 *   not inside the repo, a folder lists the path or a folder above it as a link, or such a folder could not be listed
 *   (#72 A2);
 * - `notExecutable`: each launcher whose chmod ran but did not exit 0, or could not run;
 * - `chmodRefusals`: the chmodProblem text of each chmod that was not run, because the write of its path did not land;
 * - `hunkFailures`: each framework command that failed (D-106);
 * - `attended`: the required keys whose failed command made roles attended (D-106);
 * - `installed`: each security plugin key whose install ran after Confirm and exited 0 (decision #39);
 * - `installProblems`: the text of each security plugin that was not installed, with the command to run by hand
 *   (decision #39); never fatal to the apply;
 * - `manifestSkipped`: whether the manifest was not written because a write before it failed or was refused.
 */
export type ApplyOutcome = {
  readonly written: readonly string[]
  readonly executable: readonly string[]
  readonly failed: readonly string[]
  readonly refused: readonly string[]
  readonly notExecutable: readonly string[]
  readonly chmodRefusals: readonly string[]
  readonly hunkFailures: readonly HunkRun[]
  readonly attended: readonly string[]
  readonly installed: readonly string[]
  readonly installProblems: readonly string[]
  readonly manifestSkipped: boolean
}

/** How long one launcher chmod may run before it is given up. */
const CHMOD_TIMEOUT_MS = 10_000

/**
 * Runs the steps of a confirmed apply through the host, in order (D-105, LNCH-01). Every path applyStatPaths names is
 * stat'ed once, through the init port's statForWrite and with resolve, and every folder applyListPaths names is listed
 * once through io.list, before the first step. A write is tried only when writeProblem finds no failed stat, link,
 * folder, non-folder or out-of-repo path on its way (T-03-17, #44) and listedLinkProblem finds no entry on its way
 * listed as a link and no folder there that could not be listed (#72 A2), and its path joins `written` only when
 * host.write says it landed. A chmod runs only on a path in `written`, so only after the write of that same path in
 * this same apply passed writeProblem and landed (chmodProblem): `/bin/chmod` follows links, so a chmod on a path whose
 * write was refused or failed could change the target of a link planted there, outside the repo (RESEARCH 3.2,
 * T-03-38); such a launcher is not made executable, and no chmod runs for it at all. A chmod that ran makes its
 * launcher executable only on exit 0. The manifest is written like any file, but skipped when a write before it failed
 * or was refused, so it never claims a file that is not on the disk (T-03-18).
 */
async function writeSteps(io: InitIo, host: HostIo, root: string, steps: readonly ApplyStep[]): Promise<ApplyOutcome> {
  const base = trimSlash(root)
  const stats = new Map<string, WriteStat>()
  for (const path of applyStatPaths(steps)) stats.set(path, await io.statForWrite(`${base}/${path}`))
  const listings = new Map<string, readonly PortEntry[] | null>()
  for (const folder of applyListPaths(steps)) {
    listings.set(folder, await io.list(folder === '' ? base : `${base}/${folder}`))
  }
  const written = new Set<string>()
  const executable: string[] = []
  const failed: string[] = []
  const refused: string[] = []
  const notExecutable: string[] = []
  const chmodRefusals: string[] = []
  let manifestSkipped = false
  for (const step of steps) {
    if (step.kind === 'chmod') {
      const problem = chmodProblem(step.path, written)
      if (problem !== null) {
        chmodRefusals.push(problem)
        continue
      }
      const run = await host.run(chmodArgv(root, step.path), { timeoutMs: CHMOD_TIMEOUT_MS })
      if (run !== null && run.exitCode === 0) executable.push(step.path)
      else notExecutable.push(step.path)
      continue
    }
    if (step.kind === 'manifest' && (failed.length > 0 || refused.length > 0)) {
      manifestSkipped = true
      continue
    }
    const problem = writeProblem(step.path, stats, root) ?? listedLinkProblem(step.path, stats, listings)
    if (problem !== null) {
      refused.push(problem)
      continue
    }
    if (await host.write(`${base}/${step.path}`, step.text)) written.add(step.path)
    else failed.push(step.path)
  }

  return {
    written: [...written],
    executable,
    failed,
    refused,
    notExecutable,
    chmodRefusals,
    hunkFailures: [],
    attended: [],
    installed: [],
    installProblems: [],
    manifestSkipped,
  }
}

/**
 * The lines a plain init or regen reply ends with (D-105, LNCH-01). First `Applied: wrote <n> file(s) (<m>
 * executable).`, `file` when n is 1, n counting every write that landed (the `.gitignore` and the manifest included)
 * and m the launchers made executable, or APPLIED_NONE_NOTE when nothing was written and no write failed or was
 * refused. Then one `warning: ` line for each write writeProblem refused (its text), each write the host failed, each
 * chmod not run (the chmodProblem text), each chmod that did not exit 0 (with the command to run by hand), each
 * framework command that failed (hunkFailureLine), the attended note when a failure made roles attended, each security
 * plugin that was not installed (its installProblems text, decision #39), and `manifestNote` (MANIFEST_SKIPPED_NOTE
 * unless the caller names another) when the manifest was skipped. Then, when security plugins were installed, the line
 * that names them and says to run /reload-plugins (installedLine). NEXT_STEP_NOTE comes last.
 */
export function appliedLines(outcome: ApplyOutcome, manifestNote: string = MANIFEST_SKIPPED_NOTE): string[] {
  const { written, executable, failed, refused } = outcome
  const isNothing = written.length === 0 && failed.length === 0 && refused.length === 0
  const noun = written.length === 1 ? 'file' : 'files'
  const counted = `Applied: wrote ${written.length} ${noun} (${executable.length} executable).`
  const warnings = [
    ...refused,
    ...failed.map(path => `could not write ${reportText(path)}`),
    ...outcome.chmodRefusals,
    ...outcome.notExecutable.map(path => {
      const shownPath = reportText(path)

      return `could not make ${shownPath} executable: run chmod 755 ${shownPath}`
    }),
    ...outcome.hunkFailures.map(hunkFailureLine),
    ...(outcome.attended.length > 0 ? [attendedNote(outcome.attended)] : []),
    ...outcome.installProblems,
    ...(outcome.manifestSkipped ? [manifestNote] : []),
  ]
  const installed = outcome.installed.length > 0 ? [installedLine(outcome.installed)] : []

  return [
    isNothing ? APPLIED_NONE_NOTE : counted,
    ...warnings.map(warning => `warning: ${warning}`),
    ...installed,
    NEXT_STEP_NOTE,
  ]
}

/**
 * The reply of a finished init (PLAN-01, PLAN-02, D-105): what was asked for, the file plan as renderPlan prints it
 * (with its warnings, so none is printed twice), the git policy, where the launchers start (A2), the worktree line of
 * the ignore policy, and last the dry-run note when `applied` is null (--dry-run, nothing was written), else the lines
 * of what the apply did (appliedLines). Plain init and --dry-run differ only in the first line and that ending.
 */
export function initReplyText(plan: Plan, policy: GitPolicy, start: LaunchStart, applied: ApplyOutcome | null): string {
  return [
    applied === null ? 'cadre init --dry-run' : 'cadre init',
    ...renderPlan(plan),
    policyLine(policy),
    launchLine(start),
    ...(policy === 'ignore' ? [IGNORE_ALL_NOTE] : []),
    ...(applied === null ? [DRY_RUN_NOTE] : appliedLines(applied)),
  ].join('\n')
}

/**
 * The first line of the final review question (D-43, D-134): the person confirms the plan the side pane shows, or goes
 * back to change one item. reviewQuestion gives the whole question text.
 */
export const REVIEW_QUESTION =
  'Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.'

/**
 * The last line of the review question (D-134): how to change an item that has no button of its own, by typing its
 * word under "Other". It is part of the question itself, which every surface draws, so the dialog never depends on the
 * pane for it. This reverses 02-13 user decision 2, which kept the question text unchanged and put the hint under the
 * review summary instead.
 */
export const REVIEW_TYPE_HINT = 'Use a button, or type duration, model, assignments, memory, env or hunks under Other.'

/**
 * The review question as the dialog shows it (D-134): REVIEW_QUESTION, then the context line on its own line when there
 * is one, and REVIEW_TYPE_HINT on the last line, so the text always ends with the typed-item hint.
 */
export function reviewQuestion(context: string | null): string {
  if (context === null) return `${REVIEW_QUESTION}\n${REVIEW_TYPE_HINT}`

  return `${REVIEW_QUESTION}\n${context}\n${REVIEW_TYPE_HINT}`
}

/**
 * The context line of the review question (G-02-1, D-136): the summary line of the plan the side pane shows
 * (planSummary), the git policy line and where the launchers start, so the question reads on its own.
 */
export function reviewContextLine(plan: Plan, policy: GitPolicy, start: LaunchStart): string {
  return `${planSummary(plan)}; ${policyLine(policy)}; ${launchLine(start)}`
}

/**
 * What an answer to the review question picks (D-43, A2): confirm the plan, or go back to one item: the roles (and with
 * them every per-role step), the git policy, the launcher start, the duration, the model and effort, the MCP and skill
 * assignments, the instructions and memories, the carried env names, or the hunks.
 */
export type ReviewItem =
  | 'confirm'
  | 'roles'
  | 'policy'
  | 'launch'
  | 'duration'
  | 'model'
  | 'assignments'
  | 'memory'
  | 'env'
  | 'hunks'

/** Each review button with what it picks, in the order the dialog shows them (D-43, A2). */
const REVIEW_CHOICES: readonly Labelled<ReviewItem>[] = Object.freeze([
  { label: 'Confirm', value: 'confirm' },
  { label: 'Change roles', value: 'roles' },
  { label: 'Change git policy', value: 'policy' },
  { label: 'Change launcher start', value: 'launch' },
])

/** The review buttons: Confirm first, then the three items that have a button of their own (D-43, A2). */
export const REVIEW_OPTIONS: readonly string[] = Object.freeze(REVIEW_CHOICES.map(entry => entry.label))

/** Each item word a person may type under "Other", with the item it goes back to; mcp and skills mean assignments. */
const REVIEW_WORDS: readonly Labelled<ReviewItem>[] = Object.freeze([
  { label: 'roles', value: 'roles' },
  { label: 'git policy', value: 'policy' },
  { label: 'launcher start', value: 'launch' },
  { label: 'duration', value: 'duration' },
  { label: 'model', value: 'model' },
  { label: 'assignments', value: 'assignments' },
  { label: 'mcp', value: 'assignments' },
  { label: 'skills', value: 'assignments' },
  { label: 'memory', value: 'memory' },
  { label: 'env', value: 'env' },
  { label: 'hunks', value: 'hunks' },
])

/**
 * The item an answer to the review question picks, else null, so it is asked again: a button label or an item word,
 * trimmed and in any case (D-43). Any other answer, a sentence around a word included, is no choice.
 */
export function parseReviewItem(answer: string): ReviewItem | null {
  return labelled(REVIEW_CHOICES, answer) ?? labelled(REVIEW_WORDS, answer)
}

/**
 * The most times the review question is asked, so no plan is taken unconfirmed (A1). A go-back picked at the last one
 * cancels at once, asking nothing more, so no answer is asked for and then thrown away (A3).
 */
export const MAX_REVIEW_ROUNDS = 10

/** Why init cancels when the review question is dismissed (A1, D-45); unread answers give NO_USABLE_ANSWER_REASON. */
export const REVIEW_DISMISSED_REASON = 'The review question was dismissed or not answered.'

/** What the review question takes, as its refusal lists it: a button or an item word (D-43, D-136). */
const REVIEW_ACCEPTS = `${quotedLabels(REVIEW_OPTIONS)}, or duration, model, assignments, memory, env, hunks`

/** Why init cancels once the review question was asked MAX_REVIEW_ROUNDS times without Confirm (A1). */
export const REVIEW_ROUNDS_REASON =
  `The review question was asked ${MAX_REVIEW_ROUNDS} times without "Confirm": nothing was chosen.`

/**
 * What one init run holds in memory while the person reviews the plan (D-43, D-45, D-82): where it runs and what the
 * scans gave, the ~/.claude.json consent answer the scans were gathered with (cadre.json records it, A1), what the
 * roles and framework steps are asked with (the installed frameworks, the framework choice and the template proposal
 * with its scan changes), the history hints the skill questions are asked with (D-59), and every answer so far, the
 * accepted team's scan changes included, so Change roles shows those again (A6), and so are the security plugins the
 * person answered Install for (decision #39). It is never written or kept after the run; a go-back gives a new Draft.
 */
export type Draft = {
  readonly locations: InitLocations
  readonly gathered: Gathered
  readonly readUserMcp: boolean
  readonly installed: readonly FrameworkId[]
  readonly choice: Choice
  readonly proposal: RoleProposal
  /** The command and skill counts of the history scan, empty when it was skipped: hints only (D-59). */
  readonly hints: ReadonlyMap<string, number>
  readonly duration: string
  readonly roles: readonly RoleSpec[]
  /** The scan changes shown with the accepted roles: the template's, or none for a described structure (A6). */
  readonly changes: readonly RoleChange[]
  readonly repoDefault: FrameworkId | null
  readonly hunks: readonly HunkOp[]
  /**
   * The plugin keys the person answered Install for (decision #39); installed only after Confirm, never in --dry-run
   * (applyConfirmed).
   */
  readonly pluginInstalls: readonly string[]
  /**
   * How the instruction files were handed out (G-02-1f): none, the whole-file questions, or the parts with their
   * topics, held in memory for this run only.
   */
  readonly instructions: InstructionHandout
  readonly policy: GitPolicy
  readonly launchStart: LaunchStart
}

/** What the person confirmed in the review (D-43, D-105): the draft the plan was built from, and that plan. */
export type Reviewed = {
  readonly draft: Draft
  readonly planned: PlanResult
}

/**
 * The parts of a Draft that the scans, the consent answer they were gathered with and the history hints fix for the
 * whole run.
 */
type DraftBase = Pick<Draft, 'locations' | 'gathered' | 'readUserMcp' | 'installed' | 'choice' | 'proposal' | 'hints'>

/**
 * What the role steps decide: the duration, the roles with every per-role answer, the scan changes they were accepted
 * with (A6), the repo default, the hunks, the security plugins to install after Confirm (decision #39) and how the
 * instruction files were handed out (G-02-1f).
 */
type Team = Pick<Draft, 'duration' | 'roles' | 'changes' | 'repoDefault' | 'hunks' | 'pluginInstalls' | 'instructions'>

/** A step result with its value turned into another; a cancelled result stays cancelled with its reason (A1). */
function mapped<T, U>(result: StepResult<T>, apply: (value: T) => U): StepResult<U> {
  return result.kind === 'cancelled' ? result : accepted(apply(result.value))
}

/**
 * The per-role steps after the duration (D-52, D-53, D-60, G-02-1f, ROLE-04), in this order: model and effort
 * (modelStep), MCP servers and skills with the history hints (assignmentStep), instructions and memories
 * (instructionsStep, which runs the instruction parts only when `isDryRun`), carried settings (carryStep), then the
 * autonomy hunks of the frameworks the roles run on (hunkStep). The first cancelled step ends it with its reason (A1).
 */
async function perRoleSteps(
  io: InitIo,
  base: DraftBase,
  roles: readonly RoleSpec[],
  repoDefault: FrameworkId | null,
  isDryRun: boolean,
): Promise<StepResult<Omit<Team, 'duration' | 'changes' | 'pluginInstalls'>>> {
  const { gathered, locations } = base
  const modelled = await modelStep(io, roles)
  if (modelled.kind === 'cancelled') return modelled
  const assigned = await assignmentStep(io, modelled.value, gathered.setup, base.hints)
  if (assigned.kind === 'cancelled') return assigned
  const instructed = await instructionsStep(io, assigned.value, gathered.setup, locations, isDryRun)
  if (instructed.kind === 'cancelled') return instructed
  const { instructions } = instructed.value
  const carried = await carryStep(io, instructed.value.roles, gathered.setup)
  if (carried.kind === 'cancelled') return carried
  const team = carried.value
  const hunks = await hunkStep(io, { roles: team, repoDefault, gathered, locations })

  return mapped(hunks, answered => ({ roles: team, repoDefault, hunks: answered, instructions }))
}

/**
 * The role steps from the roles question to the hunks (ROLE-01 to ROLE-05, D-43): the roles (rolesStep from `start`,
 * shown with its scan changes), their frameworks (frameworkStep), the recommendations for that team (ROLE-03), the
 * security plugins question for the plugins a team with a Security role misses (missingSecurityPlugins,
 * securityInstallStep, decision #39), the duration, asked when `duration` is null and else kept for every role (D-51),
 * then perRoleSteps. When claude-security was asked about, every role that stands for Security gets its review skill
 * on Install and loses it on Not now (withSecuritySkill) before the duration. Init runs it once from the proposal;
 * Change roles runs it again from the current team with the scan changes it was accepted with (A6) and the duration it
 * has. The team keeps the scan changes of the roles accepted and the plugins to install after Confirm. `isDryRun` is
 * whether the run is --dry-run, which the instruction step needs (instructionsStep). The first cancelled step ends it
 * with its reason (A1).
 */
async function teamStep(
  io: InitIo,
  base: DraftBase,
  start: RoleProposal,
  duration: string | null,
  isDryRun: boolean,
): Promise<StepResult<Team>> {
  const { gathered } = base
  const chosen = await rolesStep(io, base.proposal, base.installed, start)
  if (chosen.kind === 'cancelled') return chosen
  const framed = await frameworkStep(io, base.choice, chosen.value.roles)
  if (framed.kind === 'cancelled') return framed
  const { roles, repoDefault } = framed.value
  const frameworks = roles.map(role => resolvedFramework(role, repoDefault))
  const recommendations = recommend({ roles, frameworks, scan: gathered.repo, setup: gathered.setup })
  await showBlock(io, 'recommendations', recommendationLines(recommendations, roles))
  const missing = missingSecurityPlugins(roles, gathered.setup)
  const installs = await securityInstallStep(io, missing)
  if (installs.kind === 'cancelled') return installs
  const pluginInstalls = installs.value
  const isSkillAsked = missing.includes(CLAUDE_SECURITY_PLUGIN)
  const team = isSkillAsked ? withSecuritySkill(roles, pluginInstalls.includes(CLAUDE_SECURITY_PLUGIN)) : roles
  const asked = duration === null ? await durationStep(io, team) : accepted(duration)
  if (asked.kind === 'cancelled') return asked
  const kept = asked.value
  const steps = await perRoleSteps(io, base, withDuration(team, kept), repoDefault, isDryRun)

  return mapped(steps, decided => ({ duration: kept, changes: chosen.value.changes, pluginInstalls, ...decided }))
}

/**
 * Goes back to one review item (D-43) and gives the draft with the new answer: it re-asks that item's step, and for
 * Change roles every role step from the current team, shown with the scan changes it was accepted with (A6), with the
 * duration kept (teamStep, given `isDryRun` as the run is). The duration, model, assignment, memory and env steps run
 * again on the current roles and decide the whole list they ask about (A3), so a narrower answer takes a name away;
 * memory goes back to the instruction hand-out it had (instructionsAgain). A cancelled step ends the review with its
 * reason (A1).
 */
async function goBack(
  io: InitIo,
  draft: Draft,
  item: Exclude<ReviewItem, 'confirm'>,
  isDryRun: boolean,
): Promise<StepResult<Draft>> {
  const { gathered, locations, roles } = draft
  switch (item) {
    case 'roles': {
      const team = await teamStep(io, draft, { roles, changes: draft.changes }, draft.duration, isDryRun)

      return mapped(team, decided => ({ ...draft, ...decided }))
    }
    case 'policy':
      return mapped(await gitPolicyStep(io), policy => ({ ...draft, policy }))
    case 'launch':
      return mapped(await launchStartStep(io, locations.root, roles), launchStart => ({ ...draft, launchStart }))
    case 'duration':
      return mapped(await durationStep(io, roles), duration => ({
        ...draft,
        duration,
        roles: withDuration(roles, duration),
      }))
    case 'model':
      return mapped(await modelStep(io, roles), modelled => ({ ...draft, roles: modelled }))
    case 'assignments':
      return mapped(await assignmentStep(io, roles, gathered.setup, draft.hints), assigned => ({
        ...draft,
        roles: assigned,
      }))
    case 'memory':
      return mapped(await instructionsAgain(io, roles, gathered.setup, draft.instructions), (instructed): Draft => ({
        ...draft,
        ...instructed,
      }))
    case 'env':
      return mapped(await carryStep(io, roles, gathered.setup), carried => ({ ...draft, roles: carried }))
    case 'hunks': {
      const hunks = await hunkStep(io, { roles, repoDefault: draft.repoDefault, gathered, locations })

      return mapped(hunks, answered => ({ ...draft, hunks: answered }))
    }
  }
}

/**
 * The review rows of the instruction parts (G-02-1f): per role the topics it was given and the topics kept with the
 * root session only (instructionReviewLines), for the parts flow only; none for the whole-file questions or none.
 */
function handoutLines(draft: Draft): string[] {
  const handout = draft.instructions
  if (handout.kind !== 'parts') return []

  return instructionReviewLines(draft.roles, handout.topics, handout.given)
}

/**
 * The summary the review shows before its question (D-43 as amended by D-134), in this order: the role titles and
 * ids, every scope card, for the instruction parts flow the topics per role (handoutLines, G-02-1f), the file plan with
 * its hunks, its warnings and the `.gitignore` block rows as renderPlan prints them (so none is printed twice), the git
 * policy line, the launcher-start line, IGNORE_ALL_NOTE when the policy is `ignore`, so both items with a review button
 * of their own can be checked before Confirm, then the scan warnings of the run, kept for this review, and last the
 * security plugins Confirm installs when the person answered Install for any (decision #39), each key cleaned and
 * capped as a report cell is (decision #69 B7).
 */
function reviewLines(draft: Draft, scopes: ReadonlyMap<string, CompiledScope>, plan: Plan): string[] {
  const keys = draft.pluginInstalls.map(reportText).join(', ')
  const installLine = `Plugins to install after Confirm (a --dry-run installs nothing): ${keys}`

  return [
    'Roles:',
    ...draft.roles.map(role => `  ${role.title} (${role.id})`),
    ...cardLines(draft.roles, scopes),
    ...handoutLines(draft),
    ...renderPlan(plan),
    policyLine(draft.policy),
    launchLine(draft.launchStart),
    ...(draft.policy === 'ignore' ? [IGNORE_ALL_NOTE] : []),
    ...scanWarningLines(scanWarnings(draft.locations, draft.gathered)),
    ...(draft.pluginInstalls.length === 0 ? [] : [installLine]),
  ]
}

/**
 * The final review (D-43, A1). Each round compiles the scopes from the draft (scopesFor), with the plugins answered
 * Install counted as installed (setupAfterInstalls), so the cards and the plan show what Confirm writes when every
 * install works (decision #69 A4; a failed install is then a warning, and apply plans again without it), plans the
 * files (planStep), shows the summary in the side pane (reviewLines, D-133) and asks reviewQuestion with the context
 * line of that plan, cleaned as a report cell (reviewContextLine, D-136), and REVIEW_OPTIONS; an item word may be typed
 * under "Other" (parseReviewItem), and any other answer is asked again with why on top. Confirm accepts the plan just
 * shown, with the state it was planned with and the draft it was built from (Reviewed). A go-back re-asks that one item
 * (goBack, given `isDryRun` as the run is), and the next round shows the summary again. A dismissal
 * (REVIEW_DISMISSED_REASON), MAX_ASKS answers it cannot read (NO_USABLE_ANSWER_REASON), or a cancelled go-back step is
 * cancelled with its reason, and so is a run that has asked MAX_REVIEW_ROUNDS times without Confirm
 * (REVIEW_ROUNDS_REASON), so no plan the person did not confirm is used (A1, D-45). A go-back picked at the last round
 * cancels at once and asks none of that item's questions (A3). The review itself writes nothing: Confirm is the consent
 * apply writes the plan on (D-105).
 */
export async function reviewStep(io: InitIo, draft: Draft, isDryRun: boolean): Promise<StepResult<Reviewed>> {
  let current = draft
  for (let round = 0; round < MAX_REVIEW_ROUNDS; round += 1) {
    const setup = setupAfterInstalls(current.gathered.setup, current.pluginInstalls)
    const gathered = { ...current.gathered, setup }
    const scopes = scopesFor(current.roles, current.repoDefault, gathered, current.hunks, current.launchStart)
    const planned = await planStep(io, {
      roles: current.roles,
      repoDefault: current.repoDefault,
      policy: current.policy,
      launchStart: current.launchStart,
      scopes,
      hunks: current.hunks,
      repo: current.gathered.repo,
      locations: current.locations,
      readUserMcp: current.readUserMcp,
    })
    await showBlock(io, 'review', reviewLines(current, scopes, planned.plan))
    const ask = {
      question: reviewQuestion(contextText(reviewContextLine(planned.plan, current.policy, current.launchStart))),
      spec: { options: REVIEW_OPTIONS, header: ASK_HEADERS.review },
      parse: parseReviewItem,
      accepts: REVIEW_ACCEPTS,
    }
    const picked = choiceResult(await askChoice(io, ask), REVIEW_DISMISSED_REASON)
    if (picked.kind === 'cancelled') return picked
    const item = picked.value
    if (item === 'confirm') return accepted({ draft: current, planned })
    if (round === MAX_REVIEW_ROUNDS - 1) break
    const changed = await goBack(io, current, item, isDryRun)
    if (changed.kind === 'cancelled') return changed
    current = changed.value
  }

  return cancelled(REVIEW_ROUNDS_REASON)
}

/** The history scan as hints for the skill questions: each name with its count; none when the scan was skipped. */
function historyHints(history: HistoryScan | 'skipped'): ReadonlyMap<string, number> {
  if (history === 'skipped') return new Map()

  return new Map(history.counts.map((entry): [string, number] => [entry.name, entry.count]))
}

/**
 * The reply of a cancelled step: its reason logged as its own line, the one place a cancel reason is printed (A1), and
 * cancelledReply of that reason, so the reply names it too (batch-1 review S1).
 */
function cancelReply(io: InitIo, reason: string): string {
  io.log(reportText(reason))

  return cancelledReply(reason)
}

/** How long one accepted framework command may run at apply before it is given up (D-106, T-03-19). */
export const HUNK_TIMEOUT_MS = 30_000

/**
 * How long one security plugin install, or the marketplace add, may run at apply before it is given up (decision #39,
 * T-03-42).
 */
export const PLUGIN_RUN_TIMEOUT_MS = 180_000

/**
 * How long the Python check before the claude-security install may run before it is given up (decision #39,
 * T-03-42).
 */
export const PYTHON_TIMEOUT_MS = 5_000

/** Why init cancels when a Keep mine or Take new question is dismissed or not answered (D-67, A1). */
export const CONFLICT_DISMISSED_REASON = 'A Keep mine or Take new question was dismissed or not answered.'

/** The context line of each Keep mine or Take new question (D-136): what each answer does with the edited file. */
export const CONFLICT_CONTEXT = 'Keep mine leaves your edited file as it is; Take new writes the new version over it.'

/**
 * Installs the security plugins the person answered Install for, after Confirm (decision #39): each key in order, every
 * run with the home folder as cwd, so no repo-level settings or marketplace definitions take part (T-03-46). For
 * claude-security alone, PYTHON_VERSION_ARGV runs first (PYTHON_TIMEOUT_MS), and a pythonProblem is recorded and skips
 * that key only. An install runs pluginInstallArgv (PLUGIN_RUN_TIMEOUT_MS) and counts when it exits 0. The first
 * install that fails, a run the host rejects included, runs MARKETPLACE_ADD_ARGV once for the whole call: when the add
 * exits 0, that install and each later one that fails is tried once more; when the add fails, none is. A key that
 * still failed is a problem with the commands to run by hand (installFailureText), and the next key is still tried.
 */
async function installPlugins(
  host: HostIo,
  home: string,
  keys: readonly string[],
): Promise<Pick<ApplyOutcome, 'installed' | 'installProblems'>> {
  const installed: string[] = []
  const installProblems: string[] = []
  const pythonOptions = { cwd: home, timeoutMs: PYTHON_TIMEOUT_MS }
  const pluginOptions = { cwd: home, timeoutMs: PLUGIN_RUN_TIMEOUT_MS }
  const isDone = async (argv: readonly string[]): Promise<boolean> => {
    const run = await host.run(argv, pluginOptions)

    return run !== null && run.exitCode === 0
  }
  let marketplace: 'untried' | 'added' | 'failed' = 'untried'
  for (const key of keys) {
    const problem =
      key === CLAUDE_SECURITY_PLUGIN ? pythonProblem(await host.run(PYTHON_VERSION_ARGV, pythonOptions)) : null
    if (problem !== null) {
      installProblems.push(problem)
      continue
    }
    if (await isDone(pluginInstallArgv(key))) {
      installed.push(key)
      continue
    }
    if (marketplace === 'untried') marketplace = (await isDone(MARKETPLACE_ADD_ARGV)) ? 'added' : 'failed'
    if (marketplace === 'added' && (await isDone(pluginInstallArgv(key)))) {
      installed.push(key)
      continue
    }
    installProblems.push(installFailureText(key, marketplace === 'failed'))
  }

  return { installed, installProblems }
}

/**
 * Writes the plan the person confirmed (D-105, LNCH-01), in this order:
 * 1. The Keep mine or Take new questions, the only questions after Confirm (D-105, D-67): one for each conflicted file
 *    of the confirmed plan (conflictPaths), in plan order, before any host call (conflictQuestion with
 *    CONFLICT_OPTIONS, parseConflictAnswer); an answer that is neither is asked again with why on top (D-136). A
 *    dismissal cancels with CONFLICT_DISMISSED_REASON and MAX_ASKS answers that are neither with
 *    NO_USABLE_ANSWER_REASON, so nothing is written or run (A1, D-45).
 * 2. Each accepted hunk cadre can run, in hunk order (hunkRuns): the argv is re-resolved from its adapter proposal
 *    through a proven user-level GSD only, so a declined hunk or a repo-local GSD never runs and its command stays in
 *    the plan (D-28, D-72). It runs with cwd at the repo root and HUNK_TIMEOUT_MS; a run the host rejects or that
 *    exits non-zero is a failure, and apply goes on (D-106).
 * 3. The hunks after their runs (hunksAfterRuns): a failed hunk is no longer runnable.
 * 4. The security plugins the person answered Install for (draft.pluginInstalls, decision #39), installed in order
 *    from the home folder, never the repo (installPlugins, T-03-46): claude-security only after its Python check, and
 *    a failed install tried once more after the marketplace add. An install that fails or is skipped is a problem the
 *    reply prints with the command to run, never fatal. With no home folder known nothing is run, and each key is such
 *    a problem (noHomeInstallText).
 * 5. Attended judged again from the config on disk (attendedByConfig), the scopes compiled again and the plan made
 *    again from the disk (planStep), all from the setup with the plugins just installed (setupAfterInstalls), so
 *    ROLE.md is rendered and hashed after the hunks ran (D-120) and a Security role's settings enable claude-security
 *    once it is installed. The hunk runs above keep the setup of the scan.
 * 6. The steps of that fresh plan with the answers (applySteps), run through the host port by writeSteps: each write
 *    checked for links first, a launcher made executable only after its own write landed, and the manifest last. Take
 *    new overwrites the person's file and the manifest records its new hash; Keep mine keeps the file and writes its
 *    `.cadre-new` copy, as it does for a file that became a conflict after the questions.
 * 7. The outcome with every failed run (hunkFailures), the keys of the failed hunks that are required (attended), and
 *    the plugins installed and the install problems (installed, installProblems), which the reply prints, each failure
 *    with the command to run (D-106, decision #39).
 * Like every init step it gives a StepResult (A1): accepted with the fresh plan as written and what the apply did.
 */
export async function applyConfirmed(
  io: InitIo,
  host: HostIo,
  reviewed: Reviewed,
): Promise<StepResult<{ readonly planned: PlanResult; readonly outcome: ApplyOutcome }>> {
  const { draft } = reviewed
  const { locations, gathered, roles, repoDefault, launchStart } = draft
  const choices = new Map<string, ConflictChoice>()
  for (const path of conflictPaths(reviewed.planned.plan)) {
    const ask = {
      question: withContext(conflictQuestion(path), CONFLICT_CONTEXT),
      spec: { options: CONFLICT_OPTIONS, header: ASK_HEADERS.conflict },
      parse: parseConflictAnswer,
      accepts: quotedLabels(CONFLICT_OPTIONS),
    }
    const choice = choiceResult(await askChoice(io, ask), CONFLICT_DISMISSED_REASON)
    if (choice.kind === 'cancelled') return choice
    choices.set(path, choice.value)
  }
  const gsd = {
    userDir: provenUserDir(gathered.facts),
    home: locations.home,
    root: locations.root,
    configDir: locations.configDir,
  }
  const failures: HunkRun[] = []
  for (const run of hunkRuns(draft.hunks, gathered.setup, gsd)) {
    const result = await host.run(run.argv, { cwd: locations.root, timeoutMs: HUNK_TIMEOUT_MS })
    if (result === null || result.exitCode !== 0) failures.push(run)
  }
  const hunks = hunksAfterRuns(draft.hunks, new Set(failures.map(run => run.key)))
  const installs =
    locations.home === null
      ? { installed: [], installProblems: draft.pluginInstalls.map(noHomeInstallText) }
      : await installPlugins(host, locations.home, draft.pluginInstalls)
  const setup = setupAfterInstalls(gathered.setup, installs.installed)
  const frameworks = roles.map(role => resolvedFramework(role, repoDefault))
  const attended = await attendedByConfig(io, locations.root, frameworks, setup)
  const scopes = compileAll(roles, repoDefault, { ...gathered, setup }, attended, launchStart)
  const planned = await planStep(io, {
    roles,
    repoDefault,
    policy: draft.policy,
    launchStart,
    scopes,
    hunks,
    repo: gathered.repo,
    locations,
    readUserMcp: draft.readUserMcp,
  })
  const steps = await applySteps({ ...planned, choices })
  const written = await writeSteps(io, host, locations.root, steps)
  const required = new Set(hunks.filter(hunk => hunk.isRequired).map(hunk => hunk.key))
  const outcome: ApplyOutcome = {
    ...written,
    hunkFailures: failures,
    attended: failures.filter(run => required.has(run.key)).map(run => run.key),
    installed: installs.installed,
    installProblems: installs.installProblems,
  }

  return accepted({ planned, outcome })
}

/**
 * How `/cadre init` runs (D-105, T-03-16): --dry-run prints the plan and holds no host, so it can neither write nor
 * run; plain init writes the plan through `host` after Confirm.
 */
export type InitOptions = { readonly dryRun: true } | { readonly dryRun: false; readonly host: HostIo }

/**
 * `/cadre init`. It runs the guard before it reads or asks anything (initGuard), asks the ~/.claude.json consent
 * (consentStep), runs the scans and shows them with their warnings, then runs the history step (historyStep), which
 * asks before it reads any session transcript and keeps names and counts only (SCAN-03, D-59), then the role steps
 * (teamStep): the roles and their frameworks, the recommendations (ROLE-03), the security plugins a team with a
 * Security role misses (decision #39), the autopilot duration once for every role, each role's model and effort, the
 * MCP servers and skills, the instructions and memories (instructionsStep: in --dry-run the content consent and the
 * instruction parts, else the whole-file questions; G-02-1f), the carried env names, and the autonomy hunks of the
 * frameworks in use. It then asks the git policy (gitPolicyStep) and, once for the repo, where the launchers start
 * (launchStartStep), shows the one final review with every role's scope card for that start (the one place the cards
 * are shown; reviewLines, ROLE-06, A5) and the exact file plan, where the person confirms or goes back to change one
 * item (reviewStep, D-43). --dry-run then replies with the confirmed plan and the note that nothing was written, and
 * installs nothing (D-82); plain init writes it (applyConfirmed, D-105), asking only Keep mine or Take new for each
 * conflicted file (D-67), running the accepted hunks first, then installing the security plugins answered Install from
 * the home folder, and writing the plan made again from the disk (D-120), and replies with the plan as written and what
 * the apply did (initReplyText). Every step gives a StepResult (A1): runInit checks its kind before it uses the value,
 * and for a cancelled step prints the reason as its own line and answers cancelledReply with the step's reason (D-45),
 * so only values the person accepted reach the steps after it, and nothing is written or installed before Confirm.
 * Every answer lives in memory for this one run, and nothing is kept for the next (D-45, D-82).
 */
export async function runInit(io: InitIo, options: InitOptions): Promise<string> {
  const guard = await initGuard(io, 'init')
  if (guard.kind === 'refuse') return guard.text

  const consent = await consentStep(io)
  if (consent.kind === 'cancelled') return cancelReply(io, consent.reason)

  const gathered = await gatherScans(io, guard.locations, consent.value)
  const warnings = scanWarningLines(scanWarnings(guard.locations, gathered))
  await showBlock(io, 'scan', [...scanSummaryLines(gathered.repo, gathered.setup), ...warnings])

  const history = await historyStep(io, guard.locations, scanContextLine(gathered.repo))
  if (history.kind === 'cancelled') return cancelReply(io, history.reason)

  const detections = detectAll(gathered.facts.facts)
  const proposal = proposeRoles(gathered.repo)
  const base: DraftBase = {
    locations: guard.locations,
    gathered,
    readUserMcp: consent.value,
    installed: installedFrameworks(detections),
    choice: chooseFramework(detections, null),
    proposal,
    hints: historyHints(history.value),
  }
  const team = await teamStep(io, base, proposal, null, options.dryRun)
  if (team.kind === 'cancelled') return cancelReply(io, team.reason)

  const policy = await gitPolicyStep(io)
  if (policy.kind === 'cancelled') return cancelReply(io, policy.reason)

  const launch = await launchStartStep(io, guard.locations.root, team.value.roles)
  if (launch.kind === 'cancelled') return cancelReply(io, launch.reason)

  const draft = { ...base, ...team.value, policy: policy.value, launchStart: launch.value }
  const reviewed = await reviewStep(io, draft, options.dryRun)
  if (reviewed.kind === 'cancelled') return cancelReply(io, reviewed.reason)
  const { plan, state } = reviewed.value.planned
  if (options.dryRun) return initReplyText(plan, state.gitPolicy, state.launchStart, null)

  const applied = await applyConfirmed(io, options.host, reviewed.value)
  if (applied.kind === 'cancelled') return cancelReply(io, applied.reason)
  const asWritten = applied.value.planned

  return initReplyText(asWritten.plan, asWritten.state.gitPolicy, asWritten.state.launchStart, applied.value.outcome)
}

/** The cadre commands that work from an applied team, so they need `.cadre/cadre.json`. */
export type TeamCommand = Exclude<CommandWord, 'init'>

/**
 * The reply when a command that works from the team finds no `.cadre/cadre.json`, worded for that command: there is
 * nothing to work from until init has run (D-68).
 */
export function noStateReply(command: TeamCommand): string {
  return `cadre ${command} needs .cadre/cadre.json from /cadre init: run /cadre init first.`
}

/** The reply when regen finds no `.cadre/cadre.json`: there is nothing to re-render from until init has run (D-68). */
export const REGEN_NO_STATE = noStateReply('regen')

/**
 * The reply when `.cadre/cadre.json` is there but cannot be used: it cannot be read, is too large or is not valid repo
 * state (parseCadreState), or the launcher folder it stores is not a folder inside the repo (T-02-36).
 */
export const REGEN_BAD_STATE = '.cadre/cadre.json is not valid: fix it, or run /cadre init again.'

/**
 * The reply when `.cadre/manifest.json` is not there (A2): regen cannot keep the manifest entries of the other roles
 * without it, so it refuses; init plans every role again and rebuilds the whole manifest.
 */
export const REGEN_NO_MANIFEST =
  ".cadre/manifest.json is missing, so regen cannot keep the other roles' files: run /cadre init again."

/**
 * The reply when `.cadre/manifest.json` cannot be read, is too large or is not a valid manifest (A2): regen cannot keep
 * the manifest entries of the other roles from it, so it refuses; init plans every role again and rebuilds the whole
 * manifest.
 */
export const REGEN_BAD_MANIFEST =
  ".cadre/manifest.json is not valid, so regen cannot keep the other roles' files: run /cadre init again."

/** The reply when `.cadre/cadre.json` does not list the role asked for: it names the roles listed, or none. */
export function regenNoRole(id: string, roles: readonly string[]): string {
  return `no role ${id} in .cadre/cadre.json (roles: ${namesOrNone(roles)})`
}

/**
 * The reply when a listed role's role.json is missing, cannot be read, is not valid (parseRoleJson) or holds the id of
 * another folder (T-02-36).
 */
export function regenBadRole(id: string): string {
  return `.cadre/${id}/role.json is missing or not valid: fix it, or run /cadre init again.`
}

/** The reply when a role stores no framework and the repo has no default framework to run it on (D-73, D-97d). */
export function regenNeedsFramework(id: string): string {
  return (
    `role ${id} has no framework and this repo has no default: set "framework" in .cadre/${id}/role.json to gsd, ` +
    `superpowers or none, then run /cadre regen ${id} again.`
  )
}

/** The repo-relative path of the repo state regen re-renders from. */
const CADRE_STATE_FILE = '.cadre/cadre.json'

/** What a read of regen, /cadre start or /cadre status gives: the value it found, or the exact reply that refuses. */
export type RegenRead<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'refuse'; readonly text: string }

/** A regen read that refuses the run with this reply. */
function regenRefusal(text: string): RegenRead<never> {
  return { kind: 'refuse', text }
}

/**
 * The repo state regen re-renders from, and /cadre start and /cadre status work from (D-68, T-02-36):
 * `.cadre/cadre.json` read through readRepoFile, so a link out of the repo is never read, and checked by
 * parseCadreState. A missing file refuses with noStateReply, worded for `command`; a file that cannot be read, is too
 * large or is not valid state refuses with REGEN_BAD_STATE, and so does a stored launcher folder that is not a folder
 * inside the repo (isRepoFolder).
 */
async function regenState(
  io: InitIo,
  root: string,
  command: TeamCommand,
): Promise<RegenRead<CadreState>> {
  const read = await readRepoFile(io, root, CADRE_STATE_FILE, MAX_READ_BYTES)
  if (read.state === 'absent') return regenRefusal(noStateReply(command))
  const state = read.state === 'text' ? parseCadreState(read.text) : null
  if (state === null) return regenRefusal(REGEN_BAD_STATE)
  const start = state.launchStart
  if (start.kind === 'dir' && !(await isRepoFolder(io, root, start.path))) return regenRefusal(REGEN_BAD_STATE)

  return { kind: 'ok', value: state }
}

/** The repo-relative path of a role's role.json: what regen reads the role from, and never plans (A5). */
function roleJsonPath(id: string): string {
  return `.cadre/${id}/role.json`
}

/** The team regen read: every listed role, and the role.json text each was parsed from, keyed by its id (A5). */
type RegenTeam = {
  readonly roles: readonly RoleSpec[]
  readonly texts: ReadonlyMap<string, string>
}

/**
 * Every role `.cadre/cadre.json` lists, in its order, read back from `.cadre/<id>/role.json` through readRepoFile and
 * parseRoleJson (D-68, T-02-36), with the exact text each was parsed from (A5). The first role whose file is missing,
 * cannot be read, is not valid or holds another id than its folder refuses with regenBadRole, so no role is
 * re-rendered beside a half-known team.
 */
async function regenRoles(io: InitIo, root: string, ids: readonly string[]): Promise<RegenRead<RegenTeam>> {
  const roles: RoleSpec[] = []
  const texts = new Map<string, string>()
  for (const id of ids) {
    const read = await readRepoFile(io, root, roleJsonPath(id), MAX_READ_BYTES)
    if (read.state !== 'text') return regenRefusal(regenBadRole(id))
    const role = parseRoleJson(read.text)
    if (role === null || role.id !== id) return regenRefusal(regenBadRole(id))
    roles.push(role)
    texts.set(id, read.text)
  }

  return { kind: 'ok', value: { roles, texts } }
}

/**
 * The team a command works from (D-68, A5): the repo state of `.cadre/cadre.json`, every role it lists in its order,
 * read back from the role's role.json, and the exact role.json text each role was parsed from, keyed by role id.
 */
export type TeamState = {
  readonly state: CadreState
  readonly roles: readonly RoleSpec[]
  readonly texts: ReadonlyMap<string, string>
}

/**
 * The team regen, /cadre start and /cadre status read before they plan or launch anything (D-68, T-02-36). It refuses
 * with an exact reply in this order, which is runRegen's: no `.cadre/cadre.json` (noStateReply, worded for
 * `command`); a cadre.json that cannot be read or is not valid, its stored launcher folder included (REGEN_BAD_STATE);
 * an `id` it does not list (regenNoRole); the first listed role.json, in cadre.json order, that is missing, not valid
 * or holds another id (regenBadRole); and, when the repo has no default framework, the first listed role with none of
 * its own (regenNeedsFramework, D-73). It asks nothing and writes nothing.
 */
export async function readTeam(
  io: InitIo,
  root: string,
  command: TeamCommand,
  id: string,
): Promise<RegenRead<TeamState>> {
  const loaded = await regenState(io, root, command)
  if (loaded.kind === 'refuse') return loaded
  const state = loaded.value
  if (!state.roles.includes(id)) return regenRefusal(regenNoRole(id, state.roles))

  const team = await regenRoles(io, root, state.roles)
  if (team.kind === 'refuse') return team
  const { roles, texts } = team.value
  const unframed = state.framework === null ? roles.find(role => role.framework === undefined) : undefined
  if (unframed !== undefined) return regenRefusal(regenNeedsFramework(unframed.id))

  return { kind: 'ok', value: { state, roles, texts } }
}

/**
 * The frameworks whose roles the current config leaves attended, with no question asked (regen and /cadre start
 * through compileTeam, and apply once the hunks ran, D-70, D-72, D-120, A5): for each adapter in ADAPTERS order that a
 * role runs on and that offers autonomy hunks for this setup, its config file is read through readRepoFile, and the
 * framework is attended while a required proposal is not at its target (isAttendedFromConfig). A config that cannot
 * be read attends the roles (fail closed).
 */
async function attendedByConfig(
  io: InitIo,
  root: string,
  frameworks: readonly FrameworkId[],
  setup: SetupScan,
): Promise<ReadonlySet<FrameworkId>> {
  const attended = new Set<FrameworkId>()
  for (const adapter of ADAPTERS) {
    if (!frameworks.includes(adapter.id)) continue
    const offered = adapter.autonomyHunks(setup)
    if (offered === null) continue
    const config = await readRepoFile(io, root, offered.file, MAX_READ_BYTES)
    if (isAttendedFromConfig(offered.proposals, config)) attended.add(adapter.id)
  }

  return attended
}

/**
 * The scans and the compiled scopes of a team, as regen and /cadre start use them (D-68, D-70, D-72): the scans of one
 * run (gatherScans), which read ~/.claude.json only when cadre.json records the consent (readUserMcp, A1); attended
 * judged from the config on disk with no question asked (attendedByConfig); and every role compiled on its own
 * framework or the repo default, for cadre.json's launch start (compileAll, D-122).
 */
export async function compileTeam(
  io: InitIo,
  locations: InitLocations,
  state: CadreState,
  roles: readonly RoleSpec[],
): Promise<{ readonly gathered: Gathered; readonly scopes: ReadonlyMap<string, CompiledScope> }> {
  const gathered = await gatherScans(io, locations, state.readUserMcp)
  const frameworks = roles.map(role => resolvedFramework(role, state.framework))
  const attended = await attendedByConfig(io, locations.root, frameworks, gathered.setup)

  return { gathered, scopes: compileAll(roles, state.framework, gathered, attended, state.launchStart) }
}

/** Whether a repo-relative path is one of this role's own: in its folder `.cadre/<id>/`, or its launcher. */
function isRolePath(path: string, id: string): boolean {
  return path.startsWith(`.cadre/${id}/`) || path === `.cadre/bin/${id}`
}

/**
 * The manifest entries regen keeps as they are (D-68): every entry of the last manifest that this run does not
 * generate and that is not in the role's folder or its launcher, so the other roles and cadre.json keep theirs.
 */
function carriedEntries(manifest: Manifest, desired: readonly DesiredFile[], id: string): ManifestEntry[] {
  const generated = new Set(desired.map(file => file.path))

  return manifest.files.filter(entry => !generated.has(entry.path) && !isRolePath(entry.path, id))
}

/**
 * What regen planned for one role: the file plan, the scan warnings of the run its reply prints (A4), and what apply
 * writes the plan from: the desired files and the manifest the plan records.
 */
type RegenPlanned = {
  readonly plan: Plan
  readonly warnings: readonly string[]
  readonly desired: readonly DesiredFile[]
  readonly manifest: Manifest
}

/**
 * The file plan of regen for one role (D-68, PLAN-04), with the scan warnings of the run (scanWarnings, A4). Every
 * listed role is compiled as init compiles it, on its own framework or the repo default and attended by the current
 * config (compileTeam), so the index lists the whole team; desiredFiles gives only that role's files, its
 * launcher and the index. Exactly the paths planReadPaths names are read, and planWithManifest classifies them against
 * the disk and the last manifest, carrying every other entry (carriedEntries). No `.gitignore` block and no hunk is
 * planned. ~/.claude.json is read only when cadre.json records the consent (readUserMcp, A1), so the MCP denies init
 * compiled from it stay. Without a manifest read in full regen cannot keep the other roles' entries, so it refuses
 * (A2), as the scan read it: REGEN_NO_MANIFEST when it is not there, REGEN_BAD_MANIFEST when it cannot be read, is
 * too large or is not valid. The role's role.json is the input, so it gets no op and the new manifest records the hash
 * of `roleJson`, the text on disk (A5); the next init normalises it. It gives the desired files without role.json and
 * the manifest the plan records, which a plain regen writes.
 */
async function regenPlan(
  io: InitIo,
  input: {
    readonly id: string
    readonly state: CadreState
    readonly roles: readonly RoleSpec[]
    readonly roleJson: string
    readonly locations: InitLocations
  },
): Promise<RegenRead<RegenPlanned>> {
  const { id, state, roles, roleJson, locations } = input
  const { gathered, scopes } = await compileTeam(io, locations, state, roles)
  const { manifest, manifestState } = gathered.repo.cadre
  if (manifest === null) return regenRefusal(manifestState === 'absent' ? REGEN_NO_MANIFEST : REGEN_BAD_MANIFEST)
  const generated = desiredFiles({ roles, scopes, state, only: id })
  const ownPath = roleJsonPath(id)
  const desired = generated.filter(file => file.path !== ownPath)
  const sha256 = await sha256Hex(roleJson)
  const own = generated
    .filter(file => file.path === ownPath)
    .map((file): ManifestEntry => ({ path: file.path, sha256, mode: file.mode }))
  const planned = await planWithManifest({
    desired,
    disk: await readPaths(io, locations.root, planReadPaths(desired)),
    manifest,
    manifestState,
    carried: [...own, ...carriedEntries(manifest, generated, id)],
    gitignore: null,
    hunks: [],
    cadreVersion: (await io.cadreVersion()) ?? 'unknown',
  })
  const warnings = scanWarnings(locations, gathered)

  return { kind: 'ok', value: { plan: planned.plan, warnings, desired, manifest: planned.manifest } }
}

/**
 * The regen reply (D-68): what was asked for, the file plan as renderPlan prints it, one `warning:` line for each scan
 * warning, between the plan and the ending as init prints them (scanWarningLines, A4), then the dry-run note when
 * `applied` is null (--dry-run, nothing was written), else the lines of what the apply did (appliedLines), with the
 * regen manifest note (A4).
 */
function regenReplyText(planned: RegenPlanned, id: string, applied: ApplyOutcome | null): string {
  const command = applied === null ? `cadre regen ${id} --dry-run` : `cadre regen ${id}`
  const ending = applied === null ? [DRY_RUN_NOTE] : appliedLines(applied, regenManifestSkippedNote(id))

  return [command, ...renderPlan(planned.plan), ...scanWarningLines(planned.warnings), ...ending].join('\n')
}

/**
 * How `/cadre regen <id>` runs (D-68, T-03-16): --dry-run prints the role's plan and holds no host, so it can neither
 * write nor run; plain regen writes that plan through `host`.
 */
export type RegenOptions =
  | { readonly id: string; readonly dryRun: true }
  | { readonly id: string; readonly dryRun: false; readonly host: HostIo }

/**
 * `/cadre regen <id> [--dry-run]` (D-68, D-99). It asks nothing and logs nothing, so it also runs in `claude -p`: its
 * guard (initGuard in the regen wording) never asks whether anyone is there. It then reads the team (readTeam) and
 * refuses with an exact reply, in this order: no `.cadre/cadre.json` (REGEN_NO_STATE); a cadre.json that cannot be
 * read or is not valid, its stored launcher folder included (REGEN_BAD_STATE); an id it does not list (regenNoRole);
 * the first listed role.json, in cadre.json order, that is missing, not valid or holds another id (regenBadRole); when
 * the repo has no default framework, the first listed role with none of its own (regenNeedsFramework, D-73); and last,
 * read by the scan regenPlan runs, a manifest that is not there (REGEN_NO_MANIFEST) or cannot be read, is too large or
 * is not valid (REGEN_BAD_MANIFEST, A2). Otherwise it plans that one role (regenPlan). --dry-run replies with the
 * plan, a `warning:` line for each scan warning and the note that nothing was written; plain regen writes the plan
 * with no question (D-68): a conflicted file is kept and its `.cadre-new` copy written, as an unanswered conflict is
 * (D-67), cadre.json is never among its files, and a manifest the plan keeps as a conflict is not written. It then
 * replies with the plan, the warnings and what the apply did (regenReplyText). The warnings are in the reply, so it
 * still asks and logs nothing (A4). ~/.claude.json is read only when cadre.json records the consent (readUserMcp, A1),
 * so the MCP denies init compiled from it stay. Plain regen and --dry-run differ only in the first line and the ending.
 */
export async function runRegen(io: InitIo, options: RegenOptions): Promise<string> {
  const guard = await initGuard(io, 'regen')
  if (guard.kind === 'refuse') return guard.text
  const { locations } = guard

  const team = await readTeam(io, locations.root, 'regen', options.id)
  if (team.kind === 'refuse') return team.text
  const { state, roles, texts } = team.value
  const roleJson = texts.get(options.id)
  // Fail closed: every listed role was read, so after the id check its text is always there.
  if (roleJson === undefined) return regenBadRole(options.id)

  const planned = await regenPlan(io, { id: options.id, state, roles, roleJson, locations })
  if (planned.kind === 'refuse') return planned.text
  if (options.dryRun) return regenReplyText(planned.value, options.id, null)

  const { plan, desired, manifest } = planned.value
  const steps = await applySteps({ plan, desired, manifest, gitignore: null, choices: new Map() })
  const outcome = await writeSteps(io, options.host, locations.root, steps)

  return regenReplyText(planned.value, options.id, outcome)
}
