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
  InitIo,
  InitLocations,
  InstructionGroup,
  InstructionHandout,
  InstructionPart,
  InstructionPartRecord,
  InstructionScan,
  InstructionTopic,
  LaunchStart,
  Manifest,
  ManifestEntry,
  MemoryItem,
  Plan,
  PortEntry,
  PortRead,
  ReadState,
  RepoScan,
  RoleCarry,
  RoleChange,
  RoleProposal,
  RoleSpec,
  ScanKind,
  SetupScan,
  SkillRef,
  WriteStat,
} from '../types'
import {
  applyListPaths,
  applySteps,
  applyStatPaths,
  builtRoleFiles,
  chmodArgv,
  chmodProblem,
  CONFLICT_OPTIONS,
  conflictPaths,
  conflictQuestion,
  hunkFailureLine,
  hunkRuns,
  hunksAfterRuns,
  improveBuiltFiles,
  improverLine,
  installedLine,
  installFailureText,
  instructionsRecordPath,
  instructionsRecordText,
  listedLinkProblem,
  MARKETPLACE_ADD_ARGV,
  noHomeInstallText,
  parseConflictAnswer,
  parseInstructionsRecord,
  pluginInstallArgv,
  privateCheckPaths,
  privateClaudeMdPath,
  privateLevels,
  privateWriteProblem,
  PYTHON_VERSION_ARGV,
  pythonProblem,
  restoreSteps,
  setupAfterInstalls,
  writeProblem,
} from './apply'
import type {
  ApplyInput,
  ApplyStep,
  BuiltFile,
  ConflictChoice,
  HunkRun,
  ImproverTally,
  InstructionsRecord,
  PrivateFile,
  PrivateRole,
  RecordedMemory,
} from './apply'
import {
  accepted,
  ASK_HEADERS,
  askChoice,
  askedText,
  askOnce,
  cancelled,
  choiceResult,
  contextText,
  countedChip,
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
  CLAUDE_MD_PLUGIN,
  CLAUDE_SECURITY_PLUGIN,
  CLAUDE_SECURITY_SKILL,
  envQuestion,
  groupUses,
  mcpQuestion,
  memoryQuestion,
  MODEL_EFFORT_OPTIONS,
  modelEffortRefusal,
  NO_SKILL_PURPOSE,
  NONE_OPTION,
  orderGroupsByUse,
  ownSkillIds,
  ownSkillLines,
  parseEnvNames,
  parseModelEffort,
  parseRoleList,
  parseSkillRecommendation,
  PER_ROLE,
  SAME_FOR_ALL,
  skillGroupQuestion,
  SKILLS_SYSTEM,
  skillCount,
  skillsPrompt,
  skillUsesText,
} from './assign'
import type { NameAssignment, SkillGroup } from './assign'
import { SUPPORTED_IDS } from './core/framework-id'
import { sha256Hex } from './core/hash'
import { labelled } from './core/labelled'
import type { Labelled } from './core/labelled'
import {
  asSentence,
  cardList,
  clean,
  compareText,
  countedNoun,
  idsOrNone,
  pad,
  reportText,
  shown,
  sortedUnique,
  utf8Bytes,
} from './core/text'
import { FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY, MAX_READ_BYTES } from './facts'
import { chooseFramework } from './framework/contract'
import { SECRET_READ_GUARD } from './framework/gsd/adapter'
import { attendedNote, hunkCandidates, hunkOp, isUnmetHunk } from './framework/gsd/hunks'
import type { HunkCandidate } from './framework/gsd/hunks'
import { provenUserDir } from './framework/gsd/identity'
import { resolveToolCommand } from './framework/gsd/tools'
import { ADAPTERS, detectAll } from './framework/registry'
import {
  builtClaudeMdPath,
  desiredFiles,
  GIT_TRACKING_UNKNOWN_WARNING,
  gitTrackedArgv,
  repoPartFiles,
  trackedFilesOf,
  trackedRepoParts,
  untrackedPartsWarning,
} from './generate'
import { gitCommonDirOf } from './git/common-dir'
import { commandRefusal, initGuard, rootUnknownReply } from './guards/repo'
import { ACCEPT_RECOMMENDATIONS, handoutStep } from './handout'
import type { HandoutEntry, HandoutItem } from './handout'
import { historyStep } from './history'
import type { HistoryScan } from './history'
import { hasRunFailed, isStepDone, privateModeArgv } from './host/steps'
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
  isMemoryIndexName,
  isReadableConfigFile,
  MAX_TOTAL_BYTES,
  memoryItems,
  memoryOverSizeWarning,
  NO_MEMORY_SUMMARY,
  overSizeWarning,
  parseContentConsent,
  parseRecommendation,
  parseRegenRecommendation,
  parseTopics,
  partChanges,
  partsOfText,
  readInstructionFiles,
  RECOMMEND_SYSTEM,
  recommendPrompt,
  REGEN_RECOMMEND_SYSTEM,
  regenRecommendPrompt,
  repoInstructionNames,
  topicItems,
  TOPICS_SYSTEM,
  topicsPrompt,
  unreadableWarning,
} from './instructions'
import type { InstructionSources, MemoryRecord, PartChanges, RegenItems, RegenPromptItem } from './instructions'
import { isPartsFlowRole, isSafeFileName } from './launch'
import {
  displayPath,
  GITIGNORE_FILE,
  isRepoFolder,
  isSafeRelativePath,
  launcherPath,
  MARKDOWN_EXTENSION,
  memoryFolderOf,
  pathFromDisplay,
  relativeTo,
  roleJsonPath,
  roleMemoryDir,
  trimSlash,
  userDirOf,
} from './paths'
import { gitignoreLines, mergeIgnoreBlock, planReadPaths, planSummary, planWithManifest, renderPlan } from './plan'
import { hunkQuestion, missingSecurityPlugins, parseHunkAnswer, recommend, recommendationLines } from './recommend'
import { isRecordedPartFile, partRecord, TOP_OF_FILE } from './records'
import { choiceLine } from './render'
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
import { undecidedFacts } from './scan'
import { gatherScans, scanWarnings } from './scan/gather'
import type { Gathered } from './scan/gather'
import { readRepoFile } from './scan/port-read'
import { MAX_FOLDER_ENTRIES, MAX_SCAN_ENTRIES } from './scan/walk'
import { MEMORY_PATTERN, pluginName, scopeCardLines } from './scope'
import {
  attendedByConfig,
  compileAll,
  compileTeam,
  readTeam,
  regenBadRole,
  regenRefusal,
  resolvedFramework,
  scopesFor,
} from './team'
import type { RegenRead } from './team'

/** The reply when the session root cannot be read: init stops before it reads anything. */
export const INIT_ROOT_UNKNOWN_REPLY = rootUnknownReply('init')

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

/**
 * The warning in an init reply when apply cannot name the role memory folders, so the private files of these roles
 * are not written (G-02-1f, D-140 q2-a): there is no user folder, or git gives no absolute common dir. The ids are
 * cleaned and capped as report cells are.
 */
export function privateFoldersUnknownWarning(ids: readonly string[]): string {
  return (
    `the private files of ${ids.map(reportText).join(', ')} were not written: their role memory folders are unknown ` +
    '(no home folder, or git rev-parse failed or gave no absolute path; git 2.31 or newer is needed)'
  )
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

/** The labels of the repo findings of one kind, in scan order, or `none`. */
function findingLabels(repo: RepoScan, kind: ScanKind): string {
  return idsOrNone(repo.findings.filter(finding => finding.kind === kind).map(finding => finding.label))
}

/** What an earlier run left in `.cadre/`: `none`, or the folder's state with the state of its manifest. */
function cadreSummary(cadre: RepoScan['cadre']): string {
  if (cadre.dir === 'absent') return 'none'

  return `${cadre.dir} (manifest ${cadre.manifestState})`
}

/** The plugin count, with their names listed as a card lists names when there are any. */
function pluginSummary(plugins: readonly string[]): string {
  if (plugins.length === 0) return '0'

  return `${plugins.length} (${cardList(plugins.map(plugin => shown(plugin)))})`
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
  const stack = `stack: ${idsOrNone(repo.languages)}`
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
      `CLAUDE.md files: ${cardList(setup.claudeMd.map(file => shown(file)))}`,
  ]
}

/**
 * The context line of the history question (G-02-1, D-136): what the repo scan found, so the question reads on its
 * own: the stack, then the labels of the frontend, backend, test and E2E findings, each `none` when there is none.
 */
export function scanContextLine(repo: RepoScan): string {
  const sides = `frontend ${findingLabels(repo, 'fe')}; backend ${findingLabels(repo, 'be')}`
  const checks = `tests ${findingLabels(repo, 'test')}; E2E ${findingLabels(repo, 'e2e')}`

  return `Scan: stack ${idsOrNone(repo.languages)}; ${sides}; ${checks}.`
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

/** A model reply as a reply check of checkedCompletion takes it: the value it gives, or every error found. */
type Checked<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'invalid'; readonly errors: readonly string[] }

/**
 * One model call with its retries (D-83; 02-GAPS-B2 S7: one home for the four of init): each reply goes through
 * `parse`, and a reply it cannot take, or no text at all (NO_TEXT_ERROR), is sent back through `prompt` with its exact
 * errors, MAX_PROPOSE_ATTEMPTS calls in all. Then it gives `fallback` of the last errors.
 */
async function checkedCompletion<T>(
  io: InitIo,
  system: string,
  prompt: (errors: readonly string[]) => string,
  parse: (reply: string) => Checked<T>,
  fallback: (errors: readonly string[]) => T,
): Promise<T> {
  let errors: readonly string[] = []
  for (let attempt = 0; attempt < MAX_PROPOSE_ATTEMPTS; attempt += 1) {
    const reply = await io.complete(prompt(errors), system)
    const checked = reply === null ? null : parse(reply)
    if (checked?.kind === 'ok') return checked.value
    errors = checked === null ? [NO_TEXT_ERROR] : checked.errors
  }

  return fallback(errors)
}

/**
 * Turns the person's description into roles through the model (D-83). The prompt carries the description as a JSON
 * string and nothing from a scan (proposePrompt); every reply is validated by parseProposal, and an invalid one is
 * sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all (checkedCompletion). Then it falls back with the
 * last errors.
 */
async function proposeFromText(io: InitIo, text: string): Promise<Described> {
  const parse = (reply: string): Checked<Described> => {
    const parsed = parseProposal(reply)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: { kind: 'roles', roles: rolesFromProposal(parsed.roles) } }
  }
  const prompt = (errors: readonly string[]): string => proposePrompt(text, errors)
  const fallback = (errors: readonly string[]): Described => ({ kind: 'fallback', message: fallbackMessage(errors) })

  return checkedCompletion(io, PROPOSE_SYSTEM, prompt, parse, fallback)
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

/**
 * Each answer to an install question with whether it installs: only Install does. It serves both install offers, the
 * security plugins (decision #39) and claude-md-management (D-141; 02-GAPS-B3 N6).
 */
const INSTALL_CHOICES: readonly Labelled<boolean>[] = Object.freeze([
  { label: 'Install', value: true },
  { label: 'Not now', value: false },
])

/**
 * The answers to an install question, Install first: the dialog focuses the first option; the order is fixed
 * (decision #39). It serves both install offers, the security plugins and claude-md-management (D-141; 02-GAPS-B3 N6).
 */
export const INSTALL_OPTIONS: readonly string[] = Object.freeze(INSTALL_CHOICES.map(entry => entry.label))

/** Why init cancels when the security plugins question is dismissed or not answered (decision #39, A1, D-45). */
export const SECURITY_INSTALL_DISMISSED_REASON = 'The security plugins question was dismissed or not answered.'

/**
 * The security plugins step (decision #39, LNCH-01). With no key it asks nothing and is accepted with none. Else it
 * asks securityInstallQuestion, with SECURITY_INSTALL_CONTEXT on its second line (D-136), and the buttons
 * INSTALL_OPTIONS: Install, trimmed and in any case, is accepted with every key, and Not now with none; any other
 * answer is asked again with why on top. A dismissal is cancelled with SECURITY_INSTALL_DISMISSED_REASON and
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
    spec: { options: INSTALL_OPTIONS, header: ASK_HEADERS.security },
    parse: (answer: string): boolean | null => labelled(INSTALL_CHOICES, answer),
    accepts: quotedLabels(INSTALL_OPTIONS),
  }
  const isWanted = choiceResult(await askChoice(io, ask), SECURITY_INSTALL_DISMISSED_REASON)
  if (isWanted.kind === 'cancelled') return isWanted

  return accepted(isWanted.value ? keys : [])
}

/**
 * The improver install question (G-02-1f, D-141), worded like the security plugins question: init asks it after that
 * question, when a role got a built file and claude-md-management is missing (improverInstallStep).
 */
export const IMPROVER_INSTALL_QUESTION =
  'Install claude-md-management from claude-plugins-official after you confirm the plan? Its claude-md-improver ' +
  "tidies each role's built CLAUDE.md, and you accept or keep each change."

/**
 * The context line of the improver install question (D-136, D-141): what Not now leaves, and that a dry run installs
 * nothing.
 */
export const IMPROVER_INSTALL_CONTEXT =
  'Without it the built files stay as cadre wrote them; a --dry-run installs nothing.'

/** Why init cancels when the improver install question is dismissed or not answered (D-141, A1, D-45). */
export const IMPROVER_INSTALL_DISMISSED_REASON = 'The claude-md-management question was dismissed or not answered.'

/**
 * Whether a hand-out gives some role a built file with a part (G-02-1f, D-141): a parts hand-out with a topic that
 * holds a part and is given to a role. Memories alone build no file, and the whole-file questions or none build none.
 */
function hasBuiltPart(handout: InstructionHandout): boolean {
  if (handout.kind !== 'parts') return false
  const { topics, given } = handout

  return topics.some(topic => topic.partIds.length > 0 && (given.get(topic.id) ?? []).length > 0)
}

/**
 * The improver install step (G-02-1f, D-141). When the hand-out gives no role a built file with a part (hasBuiltPart),
 * or claude-md-management is installed (CLAUDE_MD_PLUGIN among the setup's installed plugins), it asks nothing and is
 * accepted with no key. Else it asks IMPROVER_INSTALL_QUESTION, with IMPROVER_INSTALL_CONTEXT on its second line
 * (D-136), the buttons of both install questions (INSTALL_OPTIONS) and the Improver chip: Install is accepted with
 * CLAUDE_MD_PLUGIN, and Not now with none, so no improver runs; any other answer is asked again with why on top. A
 * dismissal is cancelled with IMPROVER_INSTALL_DISMISSED_REASON and MAX_ASKS answers that are neither with
 * NO_USABLE_ANSWER_REASON (A1, D-45). It installs nothing itself: the key is installed only after Confirm, with the
 * other keys answered Install, never in --dry-run (applyConfirmed).
 */
export async function improverInstallStep(
  io: InitIo,
  handout: InstructionHandout,
  setup: SetupScan,
): Promise<StepResult<readonly string[]>> {
  if (!hasBuiltPart(handout) || setup.installedPlugins.includes(CLAUDE_MD_PLUGIN)) return accepted([])
  const ask = {
    question: withContext(IMPROVER_INSTALL_QUESTION, IMPROVER_INSTALL_CONTEXT),
    spec: { options: INSTALL_OPTIONS, header: ASK_HEADERS.improver },
    parse: (answer: string): boolean | null => labelled(INSTALL_CHOICES, answer),
    accepts: quotedLabels(INSTALL_OPTIONS),
  }
  const isWanted = choiceResult(await askChoice(io, ask), IMPROVER_INSTALL_DISMISSED_REASON)
  if (isWanted.kind === 'cancelled') return isWanted

  return accepted(isWanted.value ? [CLAUDE_MD_PLUGIN] : [])
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
 * The question of a skill group as askAssignments asks it (D-53, D-59, D-136): skillGroupQuestion with how often the
 * history scan saw the group, the team's role ids and what giving the skills means on its second line, and the Skills
 * chip; its answer gives every skill of the group.
 */
function skillGroupItem(
  group: SkillGroup,
  counts: ReadonlyMap<string, number>,
  roles: readonly RoleSpec[],
): AssignItem {
  return {
    question: withContext(skillGroupQuestion(group, groupUses(group, counts)), skillsContextLine(roles)),
    header: ASK_HEADERS.skills,
    names: group.names,
  }
}

/** The entry answer that asks each of the user's own skills once (G-02-1b). */
const ONE_BY_ONE_LABEL = 'Go one by one'

/** The entry answer that asks the group question of D-53 for all of the user's own skills at once (G-02-1b). */
const WHOLE_GROUP_LABEL = 'Whole group'

/** The answers of the own-skills entry question, in the order the dialog shows them (G-02-1b). */
export const OWN_SKILLS_ENTRY_OPTIONS: readonly string[] = Object.freeze([
  ACCEPT_RECOMMENDATIONS,
  ONE_BY_ONE_LABEL,
  WHOLE_GROUP_LABEL,
])

/** The entry question of the hand-out of the user's own skills (G-02-1b), with how many there are. */
export function ownSkillsQuestion(count: number): string {
  return `How do you want to hand out your own skills (${count})?`
}

/**
 * The context line of the own-skills entry question (G-02-1b, D-136): how many skills no plugin adds, and that the
 * side pane shows what each does and the roles it is recommended for.
 */
export function ownSkillsContextLine(count: number): string {
  const skills = countedNoun(count, 'skill', 'skills')

  return `${skills} with no plugin; the pane shows what each does and the roles it is recommended for.`
}

/** The most code points of a skill name an own-skill question shows. A scanned name is data, not text to trust. */
const MAX_SHOWN_SKILL_CHARS = 60

/** The question of one of the user's own skills (G-02-1b): which roles get it, by its name cleaned and cut to 60. */
export function ownSkillQuestion(name: string): string {
  return `Which roles get the skill ${clean(name, MAX_SHOWN_SKILL_CHARS)}?`
}

/**
 * The context line of an own skill's question (G-02-1b, D-136): what the skill does (NO_SKILL_PURPOSE when the engine
 * gave no description), as a sentence (asSentence, 02-GAPS-B2 N1), how often the history scan saw it (skillUsesText;
 * left out at 0, which a run without the scan gives) and the roles the model recommended for it, or none.
 */
export function ownSkillContextLine(skill: SkillRef, uses: number, recommended: readonly string[]): string {
  const used = uses === 0 ? '' : ` Used ${skillUsesText(uses)}.`

  return `${asSentence(skill.purpose ?? NO_SKILL_PURPOSE)}${used} Recommended: ${idsOrNone(recommended)}.`
}

/**
 * The chip of an own skill's question (G-02-3c): `Skill <i>/<n>`, or just `Skill` when that would be over the 12 code
 * points a chip shows (countedChip).
 */
export function ownSkillHeader(position: number, count: number): string {
  return countedChip('Skill', position, count)
}

/**
 * The user's own skills of the group no plugin adds (G-02-1b), as the setup scan gave them, so with their purposes
 * (D-139), in the group's order.
 */
function ownSkillsOf(skills: readonly SkillRef[], group: SkillGroup): SkillRef[] {
  return group.names.flatMap(name => {
    const found = skills.find(skill => skill.plugin === null && skill.name === name)

    return found === undefined ? [] : [found]
  })
}

/** The skills busiest first by their own use counts, then by name (G-02-1b; user answer 2026-10-21). */
function busiestFirst(skills: readonly SkillRef[], counts: ReadonlyMap<string, number>): SkillRef[] {
  return [...skills].sort(
    (a, b) => skillCount(b.name, counts) - skillCount(a.name, counts) || compareText(a.name, b.name),
  )
}

/**
 * The roles recommended for each of the user's own skills (G-02-1b): one model call reads each role's work and each
 * skill's name, purpose and own use count (skillsPrompt, SKILLS_SYSTEM). A reply parseSkillRecommendation cannot take
 * is sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all (checkedCompletion), and then no skill is
 * recommended to any role: the map is empty. The model has no tools (D-83), and only its checked skill and role ids
 * are kept.
 */
async function recommendedSkillRoles(
  io: InitIo,
  roles: readonly RoleSpec[],
  skills: readonly SkillRef[],
  counts: ReadonlyMap<string, number>,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const skillIds = ownSkillIds(skills)
  const roleIds = roles.map(role => role.id)
  const parse = (reply: string): Checked<ReadonlyMap<string, readonly string[]>> => {
    const parsed = parseSkillRecommendation(reply, skillIds, roleIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.recommended }
  }
  const prompt = (errors: readonly string[]): string => skillsPrompt(roles, skills, counts, errors)

  return checkedCompletion(io, SKILLS_SYSTEM, prompt, parse, () => new Map())
}

/** The entry question of the own-skills hand-out as handoutStep asks it (G-02-1b): context line, chip and answers. */
function ownSkillsEntry(count: number): HandoutEntry {
  return {
    question: ownSkillsQuestion(count),
    context: ownSkillsContextLine(count),
    header: ASK_HEADERS.skills,
    accept: ACCEPT_RECOMMENDATIONS,
    oneByOne: ONE_BY_ONE_LABEL,
    whole: WHOLE_GROUP_LABEL,
  }
}

/**
 * Each of the user's own skills as a hand-out item (G-02-1b), in the order given: its name as its id, its question,
 * context line and chip, and the roles the recommendation gave it (keyed S1, S2, ... by place), none when it gave none.
 */
function ownSkillItems(
  skills: readonly SkillRef[],
  counts: ReadonlyMap<string, number>,
  recommended: ReadonlyMap<string, readonly string[]>,
): HandoutItem[] {
  const ids = ownSkillIds(skills)

  return skills.flatMap((skill, index) => {
    const id = ids[index]
    if (id === undefined) return []
    const roleIds = recommended.get(id) ?? []
    const context = ownSkillContextLine(skill, skillCount(skill.name, counts), roleIds)
    const header = ownSkillHeader(index + 1, skills.length)

    return [{ id: skill.name, question: ownSkillQuestion(skill.name), context, header, recommended: roleIds }]
  })
}

/**
 * The hand-out of the user's own skills (G-02-1b, D-139); with no such skill it asks nothing. Else, busiest first and
 * then by name, the model recommends roles for each (recommendedSkillRoles) and the side pane shows every skill with
 * what it does, its own use count and the roles recommended for it (ownSkillLines). Then the entry question
 * (handoutStep): Accept recommendations gives each skill its recommended roles, Go one by one asks each skill once in
 * that order (Yes, No or a typed role list) and Whole group asks the group question of D-53 (skillGroupItem). A
 * dismissal is cancelled with ASSIGNMENT_DISMISSED_REASON, and MAX_ASKS answers it cannot read at one question with
 * NO_USABLE_ANSWER_REASON (A1).
 */
async function ownSkillsStep(
  io: InitIo,
  roles: readonly RoleSpec[],
  scanned: readonly SkillRef[],
  group: SkillGroup | undefined,
  counts: ReadonlyMap<string, number>,
): Promise<StepResult<NameAssignment[]>> {
  if (group === undefined) return accepted([])
  const skills = busiestFirst(ownSkillsOf(scanned, group), counts)
  const recommended = await recommendedSkillRoles(io, roles, skills, counts)
  await showBlock(io, 'skills', ownSkillLines(skills, counts, recommended))
  const items = ownSkillItems(skills, counts, recommended)
  const outcome = await handoutStep(io, ownSkillsEntry(skills.length), items, roles, ASSIGNMENT_DISMISSED_REASON)
  if (outcome.kind === 'cancelled') return outcome
  if (outcome.value.kind === 'whole') return askAssignments(io, roles, [skillGroupItem(group, counts, roles)])
  const { given } = outcome.value

  return accepted(skills.map(skill => ({ name: skill.name, roleIds: given.get(skill.name) ?? [] })))
}

/**
 * The MCP and skill step (D-53, ISO-04). The servers and skills the name tables decide go to their roles with no
 * question (classifyMcp, classifySkills), and infra servers and handoff and framework skills are never asked about.
 * Each unknown MCP server, then each group of unknown skills by plugin, is asked once, "Which roles get ...? (e.g. BE,
 * QA, or none)", with the team's role ids and what giving the item means on its second line (mcpContextLine,
 * skillsContextLine, D-136), answered with None, All roles or a typed list of role ids or titles; an answer that names
 * any other role is asked again (parseRoleList, T-02-33). Then, when the user has skills that no plugin adds, they are
 * handed out (ownSkillsStep, G-02-1b): a model call recommends roles for each, the side pane shows them, and the entry
 * question offers Accept recommendations, Go one by one or Whole group. The step decides the whole list of each name it
 * asks about: every role first loses those names, then each name joins the `mcp` or `skills` list of the roles its
 * answer names (assignToRoles), so running the step again sets that list, and the names the tables decide stay (A3).
 * With `hints`, the command and skill counts of the history scan, the plugin groups are asked busiest first and each
 * group question says how often its group was used (orderGroupsByUse, skillGroupQuestion), and the own skills are
 * shown and asked busiest first; without hints, or with none that count, the questions and their order are the same
 * as without the scan (D-59). Only an answer to every question gives roles: a dismissal gives the cancel reason
 * ASSIGNMENT_DISMISSED_REASON, and MAX_ASKS answers it cannot read at one question NO_USABLE_ANSWER_REASON (A1,
 * D-136). The roles it is given never change.
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
  const pluginGroups = skills.groups.filter(group => group.plugin !== null)
  const groupItems = orderGroupsByUse(pluginGroups, counts).map(group => skillGroupItem(group, counts, roles))
  const servers = await askAssignments(io, roles, serverItems)
  if (servers.kind === 'cancelled') return servers
  const grouped = await askAssignments(io, roles, groupItems)
  if (grouped.kind === 'cancelled') return grouped
  const ownGroup = skills.groups.find(group => group.plugin === null)
  const own = await ownSkillsStep(io, roles, setup.skills, ownGroup, counts)
  if (own.kind === 'cancelled') return own
  const asked = new Set([...mcp.unknown])
  const askedSkills = new Set(skills.groups.flatMap(group => group.names))
  const unasked = roles.map(role => ({
    ...role,
    mcp: role.mcp.filter(name => !asked.has(name)),
    skills: role.skills.filter(name => !askedSkills.has(name)),
  }))
  const withMcp = assignToRoles(unasked, [...mcp.assigned, ...servers.value], 'mcp')

  return accepted(assignToRoles(withMcp, [...skills.assigned, ...grouped.value, ...own.value], 'skills'))
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

/** What init finds of the repo's own instruction files before the content consent, by name only (G-02-1f Sources). */
type RepoNames = Pick<InstructionSources, 'rules' | 'hasAgentsMd'>

/** Whether the setup scan found what the whole-file questions ask about: the global CLAUDE.md, a chain or a memory. */
function hasSetupFiles(setup: SetupScan): boolean {
  return setup.hasGlobalClaudeMd || setup.claudeMd.length > 0 || setup.memoryFiles.length > 0
}

/** Whether init found anything to hand out: what the setup scan found, a rule file or AGENTS.md (G-02-1f). */
function hasInstructionFiles(setup: SetupScan, repo: RepoNames): boolean {
  return hasSetupFiles(setup) || (repo.rules ?? []).length > 0 || repo.hasAgentsMd
}

/** The roles with no instruction group: nothing to hand out, or the parts flow, gives no D-63 group to any role. */
function withoutGroups(roles: readonly RoleSpec[]): RoleSpec[] {
  return roles.map(role => ({ ...role, instructions: [] }))
}

/** Nothing to hand out (G-02-1f): no question is asked, the hand-out is `none` and every role gets no group. */
function nothingToHandOut(roles: readonly RoleSpec[]): StepResult<Instructed> {
  return accepted({ roles: withoutGroups(roles), instructions: { kind: 'none' } })
}

/** The whole-files hand-out: the D-63 group questions were asked. */
const WHOLE: InstructionHandout = { kind: 'whole' }

/** The whole-file questions of D-63 (memoryStep), handed out as `whole`; a cancel keeps its reason (A1). */
async function wholeFiles(io: InitIo, roles: readonly RoleSpec[], setup: SetupScan): Promise<StepResult<Instructed>> {
  return mapped(await memoryStep(io, roles, setup), (given): Instructed => ({ roles: given, instructions: WHOLE }))
}

/**
 * The content consent as askChoice asks it (G-02-1f "Consent first", D-134): CONTENT_QUESTION with what init found on
 * its second line (contentContextLine: the setup scan, and the rule files and AGENTS.md by name), No, skip it first,
 * and the Instructions chip.
 */
function contentAsk(setup: SetupScan, repo: RepoNames): ChoiceAsk<boolean> {
  return {
    question: withContext(CONTENT_QUESTION, contentContextLine(setup, repo)),
    spec: { options: CONTENT_OPTIONS, header: ASK_HEADERS.instructions },
    parse: parseContentConsent,
    accepts: quotedLabels(CONTENT_OPTIONS),
  }
}

/**
 * The topics of a read (G-02-1f Part unit): one model call groups the parts across files (topicsPrompt, TOPICS_SYSTEM).
 * A reply parseTopics cannot take is sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all
 * (checkedCompletion), and then each file is one topic (fallbackTopics). The model has no tools (D-83), and only its
 * checked topics are kept.
 */
async function groupedTopics(io: InitIo, scan: InstructionScan): Promise<readonly InstructionTopic[]> {
  const partIds = scan.parts.map(part => part.id)
  const parse = (reply: string): Checked<readonly InstructionTopic[]> => {
    const parsed = parseTopics(reply, partIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.topics }
  }
  const prompt = (errors: readonly string[]): string => topicsPrompt(scan.parts, errors)

  return checkedCompletion(io, TOPICS_SYSTEM, prompt, parse, () => fallbackTopics(scan))
}

/**
 * The roles recommended for each topic and each memory (G-02-1f Recommendation, Memories): a second model call reads
 * each role's work, the topics and the memories by file and summary (recommendPrompt, RECOMMEND_SYSTEM). A reply
 * parseRecommendation cannot take is sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all
 * (checkedCompletion), and then no topic or memory is recommended to any role: the map is empty.
 */
async function recommendedRoles(
  io: InitIo,
  roles: readonly RoleSpec[],
  topics: readonly InstructionTopic[],
  memories: readonly MemoryItem[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const topicIds = topics.map(topic => topic.id)
  const memoryIds = memories.map(memory => memory.id)
  const roleIds = roles.map(role => role.id)
  const parse = (reply: string): Checked<ReadonlyMap<string, readonly string[]>> => {
    const parsed = parseRecommendation(reply, topicIds, memoryIds, roleIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.recommended }
  }
  const prompt = (errors: readonly string[]): string => recommendPrompt(roles, topics, memories, errors)

  return checkedCompletion(io, RECOMMEND_SYSTEM, prompt, parse, () => new Map())
}

/**
 * The hand-out of what the parts flow found (G-02-1f Entry choices, Memories): the instructions block in the side pane
 * first (instructionLines), then the entry question and its answers (handoutStep), with the topics as items and then
 * the memories. Whole files asks the whole-file questions (memoryStep); the other answers keep the topics and memories
 * with the roles given each, and give every role no D-63 group. The read, the topics and the answers live in memory
 * for this run; only the repo parts a role was given are planned, as its built CLAUDE.md (repoPartsOf, planStep).
 */
async function handOutParts(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  found: PartsFound,
): Promise<StepResult<Instructed>> {
  const { scan, topics, recommended } = found
  await showBlock(io, 'instructions', instructionLines(scan, topics, recommended))
  const items = [...topicItems(scan, topics, recommended), ...memoryItems(scan.memories, recommended)]
  const outcome = await handoutStep(io, instructionsEntry(scan, topics), items, roles, HANDOUT_DISMISSED_REASON)
  if (outcome.kind === 'cancelled') return outcome
  if (outcome.value.kind === 'whole') return wholeFiles(io, roles, setup)
  const instructions: InstructionHandout = { kind: 'parts', scan, topics, recommended, given: outcome.value.given }

  return accepted({ roles: withoutGroups(roles), instructions })
}

/**
 * A consented read that gave no part and no memory (G-02-1f): its read warnings, if any, in the instructions block,
 * so each is shown, then the whole-file questions (memoryStep).
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
 * The auto-memory folders of this repo (G-02-1f Memories), as the setup scan lists them: the `memory` folder of the
 * project folder under `<user folder>/projects` (memoryFolderOf), for the root as resolved, then as given, once each;
 * none with no user folder.
 */
function memoryFoldersOf(locations: InitLocations): string[] {
  const userDir = userDirOf(locations)
  if (userDir === null) return []

  return Array.from(new Set([locations.root, locations.givenRoot].map(root => memoryFolderOf(userDir, root))))
}

/**
 * The parts flow after a yes (G-02-1f): it reads the instruction files and the memories (readInstructionFiles: the
 * setup scan's chain, the rule files and AGENTS.md init found by name, and the memory folders of this repo); a read
 * with no part and no memory goes to the whole-file questions (noPartRead); else the model groups the parts into
 * topics across files (no call without a part), a second call recommends roles for the topics and the memories, and
 * the person hands them out (handOutParts).
 */
async function partsFlow(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  locations: InitLocations,
  repo: RepoNames,
): Promise<StepResult<Instructed>> {
  const { root, home, configDir } = locations
  const memoryFolders = memoryFoldersOf(locations)
  const scan = await readInstructionFiles(io, { root, home, configDir, chain: setup.claudeMd, ...repo, memoryFolders })
  if (scan.parts.length === 0 && scan.memories.length === 0) return noPartRead(io, roles, setup, scan)
  const topics = scan.parts.length === 0 ? [] : await groupedTopics(io, scan)
  const recommended = await recommendedRoles(io, roles, topics, scan.memories)

  return handOutParts(io, roles, setup, { scan, topics, recommended })
}

/**
 * The instruction step (G-02-1f, replacing the D-63 group step in the per-role steps), the same in a plain init and in
 * --dry-run. It first lists `.claude/rules` and stats AGENTS.md, by name only (repoInstructionNames); with no global
 * CLAUDE.md, no CLAUDE.md in the repo chain, no rule file, no AGENTS.md and no memory file it asks nothing, hands out
 * `none` and gives every role no group. Else it asks the content consent (contentAsk), so no instruction or memory
 * text is read before a yes: No asks the whole-file questions (memoryStep), handed out as `whole`, and Yes runs the
 * parts flow (partsFlow). A dismissal of any of its questions is cancelled with that question's reason, and MAX_ASKS
 * answers it cannot read with NO_USABLE_ANSWER_REASON (A1). The step writes nothing, and the roles it is given never
 * change; the repo parts it hands out reach the plan through the draft (repoPartsOf).
 */
export async function instructionsStep(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  locations: InitLocations,
): Promise<StepResult<Instructed>> {
  const repo = await repoInstructionNames(io, locations.root)
  if (!hasInstructionFiles(setup, repo)) return nothingToHandOut(roles)
  const consent = choiceResult(await askChoice(io, contentAsk(setup, repo)), CONTENT_DISMISSED_REASON)
  if (consent.kind === 'cancelled') return consent
  if (!consent.value) return wholeFiles(io, roles, setup)

  return partsFlow(io, roles, setup, locations, repo)
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

/** Each repo-relative path read through readRepoFile, one at a time, keyed by the path. */
async function readPaths(io: InitIo, root: string, paths: readonly string[]): Promise<ReadonlyMap<string, PortRead>> {
  const disk = new Map<string, PortRead>()
  for (const path of paths) disk.set(path, await readRepoFile(io, root, path, MAX_READ_BYTES))

  return disk
}

/**
 * The parts each role was given that were read from the repo, by role id (G-02-1f Storage split): for a parts
 * hand-out, every part of every topic the role was given, with source `repo`, in read order; a role given only global
 * parts maps to none. Empty for the whole-file questions and for none. A part of the global CLAUDE.md is left out, so
 * it never reaches a file in the repo (T-02-69); memories are not parts.
 */
function repoPartsOf(handout: InstructionHandout): ReadonlyMap<string, readonly InstructionPart[]> {
  if (handout.kind !== 'parts') return new Map()
  const { scan, topics, given } = handout
  const roleIds = new Set(topics.flatMap(topic => given.get(topic.id) ?? []))

  return new Map(
    Array.from(roleIds, (roleId): [string, InstructionPart[]] => {
      const owned = topics.filter(topic => given.get(topic.id)?.includes(roleId) === true)
      const partIds = new Set(owned.flatMap(topic => topic.partIds))

      return [roleId, scan.parts.filter(part => part.source === 'repo' && partIds.has(part.id))]
    }),
  )
}

/**
 * A role with these repo part records in place of any it had (G-02-1f Regen, AUTO-PICK #19 Q1): the parts it was
 * given, and the not-given list only when it holds one. A record whose file role.json may not name
 * (isRecordedPartFile) is left out, so init never writes a role.json that parseRoleJson refuses.
 */
function withPartRecords(
  role: RoleSpec,
  given: readonly InstructionPartRecord[],
  notGiven: readonly InstructionPartRecord[],
): RoleSpec {
  // Both old lists are taken off, so the role holds exactly the lists given here.
  const { instructionParts: _given, instructionPartsNotGiven: _notGiven, ...rest } = role
  const recordable = (records: readonly InstructionPartRecord[]): InstructionPartRecord[] =>
    records.filter(record => isRecordedPartFile(record.file)).map(partRecord)
  const instructionParts = recordable(given)
  const instructionPartsNotGiven = recordable(notGiven)

  return instructionPartsNotGiven.length === 0
    ? { ...rest, instructionParts }
    : { ...rest, instructionParts, instructionPartsNotGiven }
}

/**
 * The roles with the records regen compares against (G-02-1f Regen, AUTO-PICK #19 Q1): each parts-flow role
 * (isPartsFlowRole) records the repo parts `repoParts` gives it, and as not given every other repo part the read found
 * in the same files, both in read order, so its role.json names no global part and no memory (T-02-79); a role given
 * no repo part records none, and a whole-files role is left as it is.
 */
function withRepoRecords(
  roles: readonly RoleSpec[],
  handout: InstructionHandout,
  repoParts: ReadonlyMap<string, readonly InstructionPart[]>,
): RoleSpec[] {
  const read = handout.kind === 'parts' ? handout.scan.parts.filter(part => part.source === 'repo') : []

  return roles.map(role => {
    if (!isPartsFlowRole(role)) return role
    const given = repoParts.get(role.id) ?? []
    const files = new Set(given.map(part => part.file))
    const notGiven = read.filter(part => files.has(part.file) && !given.includes(part))

    return withPartRecords(role, given.map(partRecord), notGiven.map(partRecord))
  })
}

/** What a role was given that is private, before its role memory folder is known (privatesOf). */
type OwedPrivate = Pick<PrivateRole, 'id' | 'parts' | 'memories' | 'partsNotGiven'>

/**
 * What each role of the team was given that is private (G-02-1f Storage split, D-140 q2-a; 02-GAPS-B3 C1): one entry
 * per role of the team, in role id order, the order of the role memory folders, for every hand-out kind, so every
 * Confirm writes both private files of every role and no role keeps a part or a memory it lost. For a parts hand-out,
 * every global part of the topics it was given, in read order, every memory it was given, in file-name order, and the
 * other global parts of the files its parts come from, which its record names as not given (AUTO-PICK #19 Q1), each
 * list empty for a role given nothing; the whole-file questions and none give every role empty lists. A part read from
 * the repo is never among them: those go to its built file (repoPartsOf).
 */
function privatesOf(handout: InstructionHandout, roles: readonly RoleSpec[]): OwedPrivate[] {
  const ids = roles.map(role => role.id).sort(compareText)
  if (handout.kind !== 'parts') return ids.map(id => ({ id, parts: [], memories: [], partsNotGiven: [] }))
  const { scan, topics, given } = handout
  const isGiven = (itemId: string, roleId: string): boolean => given.get(itemId)?.includes(roleId) === true
  const globalParts = scan.parts.filter(part => part.source === 'global')

  return ids.map(id => {
    const partIds = new Set(topics.filter(topic => isGiven(topic.id, id)).flatMap(topic => topic.partIds))
    const parts = globalParts.filter(part => partIds.has(part.id))
    const files = new Set(parts.map(part => part.file))
    const notGiven = globalParts.filter(part => files.has(part.file) && !partIds.has(part.id))
    const memories = scan.memories.filter(memory => isGiven(memory.id, id))

    return { id, parts, memories, partsNotGiven: notGiven.map(partRecord) }
  })
}

/**
 * The manifest entries of the built files a re-init keeps as they are (02-GAPS-B3 S1): for each role whose built
 * `.cadre/<id>/CLAUDE.md` is desired, when its role.json as the disk holds it is text parseRoleJson takes, with the
 * same repo part records as the role, given and not given (compared by file, heading and hash), and the built file as
 * the disk holds it hashes to its entry in the last manifest, that entry; so an accepted improver text is neither
 * written over nor offered again while the role's parts are unchanged.
 */
async function keptBuiltEntries(
  roles: readonly RoleSpec[],
  desired: readonly DesiredFile[],
  disk: ReadonlyMap<string, PortRead>,
  manifest: Manifest | null,
): Promise<ManifestEntry[]> {
  const desiredPaths = new Set(desired.map(file => file.path))
  const recordsText = (records: readonly InstructionPartRecord[] | undefined): string =>
    JSON.stringify((records ?? []).map(({ file, heading, hash }) => ({ file, heading, hash })))
  const kept: ManifestEntry[] = []
  for (const role of roles) {
    const path = builtClaudeMdPath(role.id)
    const entry = manifest?.files.find(file => file.path === path)
    if (!desiredPaths.has(path) || entry === undefined) continue
    const roleRead = disk.get(roleJsonPath(role.id))
    const onDisk = roleRead?.state === 'text' ? parseRoleJson(roleRead.text) : null
    if (onDisk === null) continue
    if (recordsText(onDisk.instructionParts) !== recordsText(role.instructionParts)) continue
    if (recordsText(onDisk.instructionPartsNotGiven) !== recordsText(role.instructionPartsNotGiven)) continue
    const built = disk.get(path)
    if (built?.state !== 'text' || (await sha256Hex(built.text)) !== entry.sha256) continue
    kept.push(entry)
  }

  return kept
}

/**
 * The truthful file plan of init (PLAN-01, PLAN-03, PLAN-04, D-67). The repo state holds cadre's own version, else
 * `unknown`, the repo default framework, the git policy, the role ids and where the launchers start (A2), and
 * desiredFiles gives every file from it, with the built `.cadre/<id>/CLAUDE.md` of each role from the repo parts
 * `repoParts` gives it (G-02-1f): whenever init passes repoParts every role gets its built file, the header alone with
 * no repo part, so a later hand-out always replaces stale content (02-GAPS-B2 S1). A role whose repo records and built
 * file are as the last apply left them keeps its built file and manifest entry, as regenPlan does, so an accepted
 * improver text is not overwritten or asked again (keptBuiltEntries, 02-GAPS-B3 S1): its path is dropped from the
 * desired files and its entry carried. The repo state also records the consent answer, so regen knows whether it may
 * read ~/.claude.json (A1). Exactly the paths planReadPaths names (each file, the copy beside it and the manifest) and
 * the root `.gitignore` are read, through readRepoFile, so a link out of the repo is unknown and never read.
 * planWithManifest classifies each file against the disk and the last manifest the scan read, then adds the ignore
 * block of the policy (gitignoreLines, which leaves out a `thoughts/` line the file already has and, when a role
 * stands for Security, ends with the line for claude-security's report folders, decision #39) and the hunks.
 * The result also holds what apply writes the plan from: the desired files less the kept ones, the manifest the plan
 * records and the merged `.gitignore` text, which is null when the `.gitignore` cannot be read or its block cannot be
 * merged, since the plan then has no op for it. It writes nothing itself: apply writes the plan after Confirm
 * (applyConfirmed).
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
    /** The parts each role was given, by role id (repoPartsOf); absent plans no built role file. */
    readonly repoParts?: ReadonlyMap<string, readonly InstructionPart[]>
  },
): Promise<PlanResult> {
  const { roles, repoDefault, policy, launchStart, scopes, hunks, repo, locations, readUserMcp, repoParts } = input
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
  const parts = repoParts === undefined ? {} : { repoParts }
  const generated = desiredFiles({ roles, scopes, state, only: null, ...parts })
  const disk = await readPaths(io, locations.root, planReadPaths(generated))
  const carried = await keptBuiltEntries(roles, generated, disk, repo.cadre.manifest)
  const keptPaths = new Set(carried.map(entry => entry.path))
  const desired = generated.filter(file => !keptPaths.has(file.path))
  const ignoreRead = await readRepoFile(io, locations.root, GITIGNORE_FILE, MAX_READ_BYTES)
  const existing = ignoreRead.state === 'text' ? ignoreRead.text : null
  const lines = gitignoreLines(policy, existing, roles.some(role => standsFor(role, 'security')))
  const { plan, manifest } = await planWithManifest({
    desired,
    disk,
    manifest: repo.cadre.manifest,
    manifestState: repo.cadre.manifestState,
    carried,
    gitignore: { disk: ignoreRead, lines },
    hunks,
    cadreVersion,
  })
  const isIgnoreReadable = ignoreRead.state === 'text' || ignoreRead.state === 'absent'
  const gitignore = isIgnoreReadable ? mergeIgnoreBlock(existing, lines) : null

  return { plan, state, desired, manifest, gitignore }
}

/**
 * What one apply did (D-105, LNCH-01). Every path is repo-relative, except that of a private file:
 * - `written`: each path whose write landed, in step order, the `.gitignore`, the manifest and the private files of
 *   the role memory folders included, a private file as displayPath shows it (`~/...`, G-02-1f);
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
 * - `installed`: each plugin key, a security plugin or claude-md-management, whose install ran after Confirm and exited
 *   0 (decision #39, D-141);
 * - `installProblems`: the text of each such plugin that was not installed, with the command to run by hand (decision
 *   #39); never fatal to the apply;
 * - `untrackedParts`: the warning of each source file whose repo parts were left out of the built files because git
 *   does not track it, or GIT_TRACKING_UNKNOWN_WARNING when git could not be asked (02-GAPS-B2 M3);
 * - `privateProblems`: the warning of each private file that was not written (G-02-1f): the privateWriteProblem text
 *   of one refused, `could not write <path>` for one whose folder could not be made private or whose write failed, and
 *   privateFoldersUnknownWarning when the role memory folders could not be named; never a reason to skip the manifest,
 *   which names no private file;
 * - `manifestSkipped`: whether the manifest was not written because a write of a repo file before it failed or was
 *   refused;
 * - `improverWarnings`: the reply warning of each per-file improver question that got no usable answer (G-02-1f,
 *   D-141), and for a plain regen where no one can be asked whose rebuilt files the improver could improve,
 *   improverNotOfferedWarning (D-142);
 * - `improved`: how many built files the improver changed and the person accepted, of how many the pass ran for; null
 *   when no improver pass ran.
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
  readonly untrackedParts: readonly string[]
  readonly privateProblems: readonly string[]
  readonly manifestSkipped: boolean
  readonly improverWarnings: readonly string[]
  readonly improved: ImproverTally | null
}

/** The outcome of an apply that did nothing: no write, no run, no problem and no improver pass. */
const NOTHING_APPLIED: ApplyOutcome = Object.freeze({
  written: [],
  executable: [],
  failed: [],
  refused: [],
  notExecutable: [],
  chmodRefusals: [],
  hunkFailures: [],
  attended: [],
  installed: [],
  installProblems: [],
  untrackedParts: [],
  privateProblems: [],
  manifestSkipped: false,
  improverWarnings: [],
  improved: null,
})

/** How long one launcher chmod may run before it is given up. */
const CHMOD_TIMEOUT_MS = 10_000

/**
 * Whether the folders of these private files are made and made private (G-02-1f, 02-GAPS-B2 N13): the mkdir run of
 * /cadre start (isStepDone) makes the deepest folder of privateLevels with every one above it, then `/bin/chmod 700`
 * runs on each level from the top (privateModeArgv); false at the first run the host rejects or that does not exit 0.
 */
async function isPrivateFolderMade(host: HostIo, folder: string, files: readonly PrivateFile[]): Promise<boolean> {
  const levels = privateLevels(folder, files)
  const deepest = levels.at(-1) ?? folder
  if (!(await isStepDone(host, { kind: 'mkdir', path: deepest }))) return false
  for (const level of levels) {
    const run = await host.run(privateModeArgv(level), { timeoutMs: CHMOD_TIMEOUT_MS })
    if (hasRunFailed(run)) return false
  }

  return true
}

/** What writePrivate did: the private files written, as displayPath shows them, and the warning of each one not. */
type PrivateOutcome = {
  readonly written: readonly string[]
  readonly problems: readonly string[]
}

/**
 * Writes the private files of one role into its role memory folder (G-02-1f, D-140 q2-a, T-02-72). Every path
 * privateCheckPaths names is stat'ed through statForWrite and every folder it names listed, then a file is tried only
 * when privateWriteProblem finds it is a private file of a confirmed role (`allowed`) with nothing on its way listed as
 * a link, unchecked or a folder; else its refusal is a problem. The files tried are written once their folders are made
 * and made private (isPrivateFolderMade), and one whose folders could not be made, or whose write the host refused or
 * failed, is `could not write <path>`. Paths are shown as displayPath shows them, `~/...` under the home folder.
 */
async function writePrivate(
  io: InitIo,
  host: HostIo,
  step: { readonly path: string; readonly files: readonly PrivateFile[] },
  context: { readonly locations: InitLocations; readonly allowed: ReadonlySet<string> },
): Promise<PrivateOutcome> {
  const { locations, allowed } = context
  const paths = privateCheckPaths(step.path, step.files)
  const stats = new Map<string, WriteStat>()
  for (const path of paths.stats) stats.set(path, await io.statForWrite(path))
  const listings = new Map<string, readonly PortEntry[] | null>()
  for (const folder of paths.listings) listings.set(folder, await io.list(folder))
  const shownPath = (path: string): string => displayPath(path, locations.home, locations.root, locations.configDir)
  const refusals = step.files.map(file => privateWriteProblem(file.path, { allowed, stats, listings, locations }))
  const problems = refusals.filter((refusal): refusal is string => refusal !== null)
  const tried = step.files.filter((_, index) => refusals[index] === null)
  if (tried.length === 0) return { written: [], problems }
  const notWritten = (file: PrivateFile): string => `could not write ${shownPath(file.path)}`
  if (!(await isPrivateFolderMade(host, step.path, tried))) {
    return { written: [], problems: [...problems, ...tried.map(notWritten)] }
  }
  const written: string[] = []
  for (const file of tried) {
    if (await host.write(file.path, file.text)) written.push(shownPath(file.path))
    else problems.push(notWritten(file))
  }

  return { written, problems }
}

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
 * launcher executable only on exit 0. A private step writes the private files of one role into its role memory folder
 * outside the repo (writePrivate, G-02-1f), each only when it is one of `allowed`, the private files of the confirmed
 * roles (T-02-72); its problems are private problems. The manifest is written like any file, but skipped when a write
 * of a repo file before it failed or was refused, so it never claims a file that is not on the disk (T-03-18); a
 * private file is never in it, so a private problem never skips it.
 */
async function writeSteps(
  io: InitIo,
  host: HostIo,
  locations: InitLocations,
  steps: readonly ApplyStep[],
  allowed: ReadonlySet<string> = new Set(),
): Promise<ApplyOutcome> {
  const { root } = locations
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
  const privateProblems: string[] = []
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
    if (step.kind === 'private') {
      const outcome = await writePrivate(io, host, step, { locations, allowed })
      for (const path of outcome.written) written.add(path)
      privateProblems.push(...outcome.problems)
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
    ...NOTHING_APPLIED,
    written: [...written],
    executable,
    failed,
    refused,
    notExecutable,
    chmodRefusals,
    privateProblems,
    manifestSkipped,
  }
}

/**
 * Runs the steps of a confirmed apply with the improver pass between the file writes and the manifest (G-02-1f,
 * D-141). writeSteps runs every step but the manifest; the improver pass runs on each offered built file whose write
 * landed (improveBuiltFiles); then writeSteps runs, with checks made after the improver ran, the write-back of each
 * file the pass gives back as built (restoreSteps) and the manifest applySteps gives with the accepted texts, so the
 * manifest hashes each built file as it ends up. As in one writeSteps run, the manifest is skipped when a write of a
 * repo file before it, the first ones or a write-back, failed or was refused. A file written twice counts once.
 */
async function writeImproved(
  io: InitIo,
  host: HostIo,
  apply: {
    readonly locations: InitLocations
    readonly input: ApplyInput
    readonly steps: readonly ApplyStep[]
    readonly offered: readonly BuiltFile[]
    readonly allowed: ReadonlySet<string>
  },
): Promise<ApplyOutcome> {
  const { locations, input, allowed } = apply
  const fileSteps = apply.steps.filter(step => step.kind !== 'manifest')
  const first = await writeSteps(io, host, locations, fileSteps, allowed)
  const landed = new Set(first.written)
  const shownPath = (path: string): string => displayPath(path, locations.home, locations.root, locations.configDir)
  const files = apply.offered.filter(file => landed.has(file.repoPath ?? shownPath(file.path)))
  const pass = await improveBuiltFiles(io, host, files, locations)
  const manifest = (await applySteps({ ...input, improved: pass.accepted })).filter(step => step.kind === 'manifest')
  const isSkipped = first.failed.length > 0 || first.refused.length > 0
  const later = [...restoreSteps(pass.restores), ...(isSkipped ? [] : manifest)]
  const second = later.length === 0 ? NOTHING_APPLIED : await writeSteps(io, host, locations, later, allowed)

  return {
    ...first,
    written: [...first.written, ...second.written.filter(path => !landed.has(path))],
    failed: [...first.failed, ...second.failed],
    refused: [...first.refused, ...second.refused],
    privateProblems: [...first.privateProblems, ...second.privateProblems],
    manifestSkipped: (isSkipped && manifest.length > 0) || second.manifestSkipped,
    improverWarnings: pass.warnings,
    improved: files.length === 0 ? null : { changed: pass.changed, total: pass.total },
  }
}

/**
 * The lines a plain init or regen reply ends with (D-105, LNCH-01). First `Applied: wrote <n> file(s) (<m>
 * executable).`, `file` when n is 1, n counting every write that landed (the `.gitignore`, the manifest and the
 * private files included) and m the launchers made executable, or APPLIED_NONE_NOTE when nothing was written and no
 * write failed or was refused. Then one `warning: ` line for each write writeProblem refused (its text), each write
 * the host failed, each chmod not run (the chmodProblem text), each chmod that did not exit 0 (with the command to run
 * by hand), each framework command that failed (hunkFailureLine), the attended note when a failure made roles
 * attended, each plugin that was not installed (its installProblems text, decision #39), each source file
 * whose repo parts were left out because git does not track it, or that git could not be asked (untrackedParts,
 * 02-GAPS-B2 M3), each private file that was not written, or the roles whose role memory folders could not be named
 * (privateProblems, G-02-1f), each improver question that got no usable answer (improverWarnings, D-141), and
 * `manifestNote` (MANIFEST_SKIPPED_NOTE unless the caller names another) when the manifest was skipped. Then, when
 * plugins were installed, the line that names them and says to run /reload-plugins (installedLine), and when an
 * improver pass ran, how many built files it changed and the person accepted (improverLine). NEXT_STEP_NOTE comes
 * last.
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
    ...outcome.untrackedParts,
    ...outcome.privateProblems,
    ...outcome.improverWarnings,
    ...(outcome.manifestSkipped ? [manifestNote] : []),
  ]
  const installed = outcome.installed.length > 0 ? [installedLine(outcome.installed)] : []
  const improved = outcome.improved === null ? [] : [improverLine(outcome.improved)]

  return [
    isNothing ? APPLIED_NONE_NOTE : counted,
    ...warnings.map(warning => `warning: ${warning}`),
    ...installed,
    ...improved,
    NEXT_STEP_NOTE,
  ]
}

/**
 * The reply of a finished init (PLAN-01, PLAN-02, D-105): what was asked for, the file plan as renderPlan prints it
 * (with its warnings, so none is printed twice), the git policy, where the launchers start (A2), the worktree line of
 * the ignore policy, `confirmLines` (what Confirm writes outside the repo and the improver line, which a --dry-run
 * reply names, 02-GAPS-B3 S4; none by default), and last the dry-run note when `applied` is null (--dry-run, nothing
 * was written), else the lines of what the apply did (appliedLines). Plain init and --dry-run differ only in the first
 * line, the confirm lines and that ending.
 */
export function initReplyText(
  plan: Plan,
  policy: GitPolicy,
  start: LaunchStart,
  applied: ApplyOutcome | null,
  confirmLines: readonly string[] = [],
): string {
  return [
    applied === null ? 'cadre init --dry-run' : 'cadre init',
    ...renderPlan(plan),
    policyLine(policy),
    launchLine(start),
    ...(policy === 'ignore' ? [IGNORE_ALL_NOTE] : []),
    ...confirmLines,
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
 * accepted team's scan changes included, so Change roles shows those again (A6), and so are the plugins the person
 * answered Install for (decision #39, D-141). It is never written or kept after the run; a go-back gives a new Draft.
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
   * The plugin keys the person answered Install for: the security plugins (decision #39), then claude-md-management
   * (D-141); installed only after Confirm, never in --dry-run (applyConfirmed).
   */
  readonly pluginInstalls: readonly string[]
  /**
   * How the instruction files were handed out (G-02-1f): none, the whole-file questions, or the parts with their
   * topics, held in memory for this run; the plan builds each role's CLAUDE.md from its repo parts (repoPartsOf).
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
 * with (A6), the repo default, the hunks, the plugins to install after Confirm (decision #39, D-141) and how the
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
 * (instructionsStep), carried settings (carryStep), then the autonomy hunks of the frameworks the roles run on
 * (hunkStep). The first cancelled step ends it with its reason (A1).
 */
async function perRoleSteps(
  io: InitIo,
  base: DraftBase,
  roles: readonly RoleSpec[],
  repoDefault: FrameworkId | null,
): Promise<StepResult<Omit<Team, 'duration' | 'changes' | 'pluginInstalls'>>> {
  const { gathered, locations } = base
  const modelled = await modelStep(io, roles)
  if (modelled.kind === 'cancelled') return modelled
  const assigned = await assignmentStep(io, modelled.value, gathered.setup, base.hints)
  if (assigned.kind === 'cancelled') return assigned
  const instructed = await instructionsStep(io, assigned.value, gathered.setup, locations)
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
 * then perRoleSteps, and last the improver install question when the hand-out gave a role a built file and
 * claude-md-management is missing (improverInstallStep, D-141). When claude-security was asked about, every role that
 * stands for Security gets its review skill on Install and loses it on Not now (withSecuritySkill) before the
 * duration. Init runs it once from the proposal; Change roles runs it again from the current team with the scan
 * changes it was accepted with (A6) and the duration it has. The team keeps the scan changes of the roles accepted and
 * the plugins to install after Confirm, the security plugins first. The first cancelled step ends it with its reason
 * (A1).
 */
async function teamStep(
  io: InitIo,
  base: DraftBase,
  start: RoleProposal,
  duration: string | null,
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
  const steps = await perRoleSteps(io, base, withDuration(team, kept), repoDefault)
  if (steps.kind === 'cancelled') return steps
  const improver = await improverInstallStep(io, steps.value.instructions, gathered.setup)
  if (improver.kind === 'cancelled') return improver

  return accepted({
    duration: kept,
    changes: chosen.value.changes,
    pluginInstalls: [...pluginInstalls, ...improver.value],
    ...steps.value,
  })
}

/**
 * Goes back to one review item (D-43) and gives the draft with the new answer: it re-asks that item's step, and for
 * Change roles every role step from the current team, shown with the scan changes it was accepted with (A6), with the
 * duration kept (teamStep). The duration, model, assignment, memory and env steps run again on the current roles and
 * decide the whole list they ask about (A3), so a narrower answer takes a name away; memory goes back to the
 * instruction hand-out it had (instructionsAgain). A cancelled step ends the review with its reason (A1).
 */
async function goBack(io: InitIo, draft: Draft, item: Exclude<ReviewItem, 'confirm'>): Promise<StepResult<Draft>> {
  const { gathered, locations, roles } = draft
  switch (item) {
    case 'roles': {
      const team = await teamStep(io, draft, { roles, changes: draft.changes }, draft.duration)

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
 * The review row under a role given at least one memory (G-02-1f, T-02-73): its memories are linked read-only, as far
 * as the deny of its settings reaches (linkedMemoryDeny).
 */
export const LINKED_MEMORIES_ROW =
  '    memories are linked read-only (best effort: Edit and Write are denied; a Bash write is not blocked)'

/**
 * The review row of a role's private files (02-GAPS-B3 S4), in the scope card's memory folder form, so a dry run needs
 * no git.
 */
export function privateFilesRow(id: string): string {
  return (
    `    private files: ${MEMORY_PATTERN}${id}/instructions/CLAUDE.md and instructions.json ` +
    '(outside the repo, never committed)'
  )
}

/** The heading of the private-files rows outside the parts flow and in the --dry-run reply (02-GAPS-B3 S4). */
export const PRIVATE_FILES_HEADING = 'Private files per role (written after Confirm):'

/**
 * The line that announces the improver pass (02-GAPS-B3 S4): at most this many built files, since the git check and
 * the record compare run after Confirm.
 */
export function improverRunLine(count: number): string {
  const files = countedNoun(count, 'built file', 'built files')

  return (
    `After Confirm, claude-md-improver runs on up to ${files} (claude -p, acceptEdits, up to 5 minutes each); ` +
    'you accept or keep each change.'
  )
}

/**
 * How many built files the improver may run on after Confirm (02-GAPS-B3 S4): each `.cadre/<id>/CLAUDE.md` the plan
 * creates or changes for a role given a repo part (repoPartsOf), and each role given a global part (privatesOf), whose
 * private text file holds it.
 */
function improverRunCount(draft: Draft, plan: Plan): number {
  const withParts = Array.from(repoPartsOf(draft.instructions)).filter(([, parts]) => parts.length > 0)
  const built = new Set(withParts.map(([id]) => builtClaudeMdPath(id)))
  const repoFiles = plan.ops.filter(op => (op.kind === 'create' || op.kind === 'change') && built.has(op.path))
  const privateFiles = privatesOf(draft.instructions, draft.roles).filter(role => role.parts.length > 0)

  return repoFiles.length + privateFiles.length
}

/**
 * The review rows of the instruction parts (G-02-1f): per role the topics and memories it was given, and the topics
 * and memories kept with the root session only (instructionReviewLines, which gives its heading, then one row per
 * role in role order, then the kept row), with LINKED_MEMORIES_ROW right under the row of each role given at least
 * one memory and the role's privateFilesRow under that (its rowsAfter, 02-GAPS-B3 N3, S4); for the parts flow only,
 * none for the whole-file questions or none.
 */
function handoutLines(draft: Draft): string[] {
  const handout = draft.instructions
  if (handout.kind !== 'parts') return []
  const { given } = handout
  const { memories } = handout.scan
  const hasMemory = (id: string): boolean => memories.some(memory => given.get(memory.id)?.includes(id) === true)
  const rowsAfter = (id: string): string[] => [...(hasMemory(id) ? [LINKED_MEMORIES_ROW] : []), privateFilesRow(id)]

  return instructionReviewLines(draft.roles, handout.topics, memories, given, rowsAfter)
}

/**
 * The summary the review shows before its question (D-43 as amended by D-134), in this order: the role titles and
 * ids, every scope card, for the instruction parts flow the topics per role with each role's private files
 * (handoutLines, G-02-1f), for the other flows PRIVATE_FILES_HEADING and the private-files row of each role
 * (privateFilesRow, 02-GAPS-B3 S4), the file plan with its hunks, its warnings and the `.gitignore` block rows as
 * renderPlan prints them (so none is printed twice), the git policy line, the launcher-start line, IGNORE_ALL_NOTE when
 * the policy is `ignore`, so both items with a review button of their own can be checked before Confirm, then the scan
 * warnings of the run, kept for this review, the plugins Confirm installs when the person answered Install for any (the
 * security plugins, decision #39, and claude-md-management, D-141), each key cleaned and capped as a report cell is
 * (decision #69 B7), and last, when claude-md-management is installed or answered Install and the improver has a
 * built file to run on, improverRunLine (improverRunCount, 02-GAPS-B3 S4).
 */
function reviewLines(draft: Draft, scopes: ReadonlyMap<string, CompiledScope>, plan: Plan): string[] {
  const keys = draft.pluginInstalls.map(reportText).join(', ')
  const installLine = `Plugins to install after Confirm (a --dry-run installs nothing): ${keys}`
  const rows = draft.roles.map(role => privateFilesRow(role.id))
  const privateRows = draft.instructions.kind === 'parts' ? [] : [PRIVATE_FILES_HEADING, ...rows]
  const count = improverRunCount(draft, plan)
  const installed = setupAfterInstalls(draft.gathered.setup, draft.pluginInstalls).installedPlugins
  const improver = installed.includes(CLAUDE_MD_PLUGIN) && count > 0 ? [improverRunLine(count)] : []

  return [
    'Roles:',
    ...draft.roles.map(role => `  ${role.title} (${role.id})`),
    ...cardLines(draft.roles, scopes),
    ...handoutLines(draft),
    ...privateRows,
    ...renderPlan(plan),
    policyLine(draft.policy),
    launchLine(draft.launchStart),
    ...(draft.policy === 'ignore' ? [IGNORE_ALL_NOTE] : []),
    ...scanWarningLines(scanWarnings(draft.locations, draft.gathered)),
    ...(draft.pluginInstalls.length === 0 ? [] : [installLine]),
    ...improver,
  ]
}

/**
 * The final review (D-43, A1). Each round compiles the scopes from the draft (scopesFor), with the plugins answered
 * Install counted as installed (setupAfterInstalls), so the cards and the plan show what Confirm writes when every
 * install works (decision #69 A4; a failed install is then a warning, and apply plans again without it), plans the
 * files (planStep) with each role's repo parts (repoPartsOf, G-02-1f), which each parts-flow role's role.json records
 * (withRepoRecords, G-02-1f Regen), shows the summary in the side pane (reviewLines, D-133) and asks reviewQuestion
 * with the context line of that plan, cleaned as a report cell (reviewContextLine, D-136), and REVIEW_OPTIONS; an item
 * word may be typed under "Other" (parseReviewItem), and any other answer is asked again with why on top. Confirm
 * accepts the plan just shown, with the state it was planned with and the draft it was built from (Reviewed). A go-back
 * re-asks that one item (goBack), and the next round shows the summary again. A dismissal (REVIEW_DISMISSED_REASON),
 * MAX_ASKS answers it cannot read (NO_USABLE_ANSWER_REASON), or a cancelled go-back step is cancelled with its reason,
 * and so is a run that has asked MAX_REVIEW_ROUNDS times without Confirm (REVIEW_ROUNDS_REASON), so no plan the person
 * did not confirm is used (A1, D-45). A go-back picked at the last round cancels at once and asks none of that item's
 * questions (A3). The review itself writes nothing: Confirm is the consent apply writes the plan on (D-105).
 */
export async function reviewStep(io: InitIo, draft: Draft): Promise<StepResult<Reviewed>> {
  let current = draft
  for (let round = 0; round < MAX_REVIEW_ROUNDS; round += 1) {
    const setup = setupAfterInstalls(current.gathered.setup, current.pluginInstalls)
    const gathered = { ...current.gathered, setup }
    const scopes = scopesFor(current.roles, current.repoDefault, gathered, current.hunks, current.launchStart)
    const repoParts = repoPartsOf(current.instructions)
    const planned = await planStep(io, {
      roles: withRepoRecords(current.roles, current.instructions, repoParts),
      repoDefault: current.repoDefault,
      policy: current.policy,
      launchStart: current.launchStart,
      scopes,
      hunks: current.hunks,
      repo: current.gathered.repo,
      locations: current.locations,
      readUserMcp: current.readUserMcp,
      repoParts,
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
    const changed = await goBack(io, current, item)
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
 * How long one plugin install, or the marketplace add, may run at apply before it is given up (decision #39, D-141,
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
 * Installs the plugins the person answered Install for, after Confirm (decision #39, D-141): each key in order, every
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

/** How long the git tracked-files run may take. */
const GIT_TRACKED_TIMEOUT_MS = 10_000

/**
 * The repo parts a plain init may write, with the warnings of those it leaves out (02-GAPS-B2 M3). With no repo part
 * the map is given back unchanged and git is not asked. Else gitTrackedArgv runs at the repo root through the host:
 * a run the host rejects or that exits non-zero keeps no repo part (trackedRepoParts with null) and warns
 * GIT_TRACKING_UNKNOWN_WARNING, so the check fails closed; else only the parts of the files git named are kept, and
 * each source file it did not name is an untrackedPartsWarning, in file order.
 */
async function trackedParts(
  host: HostIo,
  root: string,
  repoParts: ReadonlyMap<string, readonly InstructionPart[]>,
): Promise<{
  readonly repoParts: ReadonlyMap<string, readonly InstructionPart[]>
  readonly warnings: readonly string[]
}> {
  const files = repoPartFiles(repoParts)
  if (files.length === 0) return { repoParts, warnings: [] }
  const run = await host.run(gitTrackedArgv(files), { cwd: root, timeoutMs: GIT_TRACKED_TIMEOUT_MS })
  if (run === null || run.exitCode !== 0) {
    return { repoParts: trackedRepoParts(repoParts, null), warnings: [GIT_TRACKING_UNKNOWN_WARNING] }
  }
  const tracked = trackedFilesOf(run.stdout)

  return {
    repoParts: trackedRepoParts(repoParts, tracked),
    warnings: files.filter(file => !tracked.has(file)).map(untrackedPartsWarning),
  }
}

/** Where the private files of an apply go: the roles that have one, the paths apply may write, and why none is. */
type PrivatePlan = {
  readonly privates: readonly PrivateRole[]
  readonly allowed: ReadonlySet<string>
  readonly problems: readonly string[]
  /** Every role id of the team to its role memory folder; empty when unknown (02-GAPS-B3 M1). */
  readonly folders: ReadonlyMap<string, string>
}

/**
 * How the role memory folder of a role is named, as /cadre start names it (G-02-1f, D-140 q2-a): from the user folder
 * and the git common dir (gitCommonDirOf runs `git rev-parse` once at the repo root, roleMemoryDir); null with no user
 * folder, when git is not asked, or with no absolute common dir from git.
 */
async function roleFoldersOf(
  io: InitIo,
  host: HostIo,
  locations: InitLocations,
): Promise<((id: string) => string) | null> {
  const userDir = userDirOf(locations)
  if (userDir === null) return null
  const common = await gitCommonDirOf(io, host, locations.root)
  if (common === null) return null

  return id => roleMemoryDir({ userDir, ...common }, id)
}

/** The folder name of the repo root, which heads each private text file (D-140 q2-a). */
function repoNameOf(locations: InitLocations): string {
  const root = trimSlash(locations.root)

  return root.slice(root.lastIndexOf('/') + 1)
}

/** The private files of these role memory folders: the only paths outside the repo an apply may write (T-02-72). */
function privatePaths(folders: readonly string[]): ReadonlySet<string> {
  return new Set(folders.flatMap(folder => [privateClaudeMdPath(folder), instructionsRecordPath(folder)]))
}

/**
 * Where the private files go (G-02-1f Storage split, D-140 q2-a, T-02-72). On every plain init the role memory folder
 * of each role is named from the user folder and the git common dir, as /cadre start names it (roleFoldersOf: git runs
 * once, 02-GAPS-B3 C1), `folders` maps every role of the team to it (02-GAPS-B3 M1), and `allowed` holds the private
 * text file and the hand-out record of every role of the team: the only paths outside the repo apply may write
 * (privatePaths). Each role owed private files (privatesOf) gets them, unless the instructions.json on disk is exactly
 * the record it would get: an unchanged record leaves both private files as they are, an accepted improver text
 * included, and their paths stay allowed (02-GAPS-B3 S1). The repo's folder name heads each private text file
 * (repoNameOf). With no user folder, or no absolute common dir from git, nothing private is written and
 * privateFoldersUnknownWarning names the roles owed private files.
 */
async function privatePlanOf(
  io: InitIo,
  host: HostIo,
  locations: InitLocations,
  input: { readonly roles: readonly RoleSpec[]; readonly owed: readonly OwedPrivate[] },
): Promise<PrivatePlan> {
  const none: PrivatePlan = { privates: [], allowed: new Set(), problems: [], folders: new Map() }
  const folderOf = await roleFoldersOf(io, host, locations)
  if (folderOf === null) return { ...none, problems: [privateFoldersUnknownWarning(input.owed.map(role => role.id))] }
  const repo = repoNameOf(locations)
  const privates: PrivateRole[] = []
  for (const role of input.owed) {
    const folder = folderOf(role.id)
    const read = await io.read(instructionsRecordPath(folder), MAX_READ_BYTES)
    const record = instructionsRecordText(role.parts, role.memories, role.partsNotGiven)
    if (read.state === 'text' && read.text === record) continue
    privates.push({ ...role, folder, repo })
  }

  return {
    privates,
    allowed: privatePaths(input.roles.map(role => folderOf(role.id))),
    problems: [],
    folders: new Map(input.roles.map((role): [string, string] => [role.id, folderOf(role.id)])),
  }
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
 * 4. The plugins the person answered Install for (draft.pluginInstalls: the security plugins, decision #39, and
 *    claude-md-management, D-141), installed in order from the home folder, never the repo (installPlugins,
 *    T-03-46): claude-security only after its Python check, and a failed install tried once more after the
 *    marketplace add. An install that fails or is skipped is a problem the
 *    reply prints with the command to run, never fatal. With no home folder known nothing is run, and each key is such
 *    a problem (noHomeInstallText).
 * 5. Attended judged again from the config on disk (attendedByConfig), the scopes compiled again and the plan made
 *    again from the disk (planStep, with the repo parts 5a keeps, which each parts-flow role's role.json records with
 *    the other parts of their files as not given: withRepoRecords, G-02-1f Regen), all from the setup with the
 *    plugins just installed (setupAfterInstalls), so ROLE.md is rendered and hashed after the hunks ran (D-120) and a
 *    Security role's settings enable claude-security once it is installed. The hunk runs above keep the setup of the
 *    scan.
 * 5a. Right before planStep, the repo parts of the draft (repoPartsOf) are checked against git (trackedParts,
 *    02-GAPS-B2 M3): `git ls-files` runs once at the repo root through the host, under every git policy, and only the
 *    parts of files git tracks are kept; a run that fails keeps none. Each left-out source file is a warning
 *    (untrackedParts). The dry run holds no host, so its plan may still list a built file whose untracked parts apply
 *    then leaves out.
 * 5b. Then the role memory folder of every role is named from the git common dir as /cadre start names it
 *    (privatePlanOf: `git rev-parse` runs once at the repo root, on every plain init), with the private files of every
 *    role of the team as the only paths outside the repo apply may write (T-02-72); each role gets both private files
 *    (privatesOf, 02-GAPS-B3 C1) unless its instructions.json already holds the record it would get (02-GAPS-B3 S1);
 *    with no folder known, nothing private is written and the reply names the roles (privateProblems).
 * 6. The steps of that fresh plan with the answers and the private files (applySteps), run through the host port by
 *    writeSteps: each write checked for links first, a launcher made executable only after its own write landed, then
 *    each role's private text file and hand-out record in its role memory folder, once the folder is made and made
 *    private (G-02-1f, D-140 q2-a, N13), and the manifest last. Take new overwrites the person's file and the manifest
 *    records its new hash; Keep mine keeps the file and writes its `.cadre-new` copy, as it does for a file that
 *    became a conflict after the questions.
 * 6a. When claude-md-management is installed, before init or by step 4 with no install problem (the setup made
 *    again from the installs), and a built role file holds a part (builtRoleFiles: the `.cadre/<id>/CLAUDE.md` of a
 *    role with a repo part 5a kept, watching the role's private files and guarded from its `.runtime` folder, and
 *    each private text file with a global part, never one of the header alone; 02-GAPS-B3 M1, C1), the improver pass
 *    runs between the file writes and the manifest (writeImproved, G-02-1f, D-141): one `claude -p` run per written
 *    built file, in its own folder, then its diff and the Accept or Keep original question; a kept file is written
 *    back as built, and the manifest records each built file as it ends up. Otherwise no improver runs.
 * 7. The outcome with every failed run (hunkFailures), the keys of the failed hunks that are required (attended), the
 *    plugins installed and the install problems (installed, installProblems), the untracked-parts warnings of 5a
 *    (untrackedParts), the private problems of 5b and 6 (privateProblems) and the improver warnings and tally of 6a
 *    (improverWarnings, improved), which the reply prints, each failure with the command to run (D-106, decision
 *    #39).
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
    if (hasRunFailed(result)) failures.push(run)
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
  const tracked = await trackedParts(host, locations.root, repoPartsOf(draft.instructions))
  const owed = privatesOf(draft.instructions, roles)
  const privatePlan = await privatePlanOf(io, host, locations, { roles, owed })
  const planned = await planStep(io, {
    roles: withRepoRecords(roles, draft.instructions, tracked.repoParts),
    repoDefault,
    policy: draft.policy,
    launchStart,
    scopes,
    hunks,
    repo: gathered.repo,
    locations,
    readUserMcp: draft.readUserMcp,
    repoParts: tracked.repoParts,
  })
  const input: ApplyInput = { ...planned, choices, privates: privatePlan.privates }
  const steps = await applySteps(input)
  const withParts = new Set(Array.from(tracked.repoParts).flatMap(([id, parts]) => (parts.length > 0 ? [id] : [])))
  const isImproverReady = setup.installedPlugins.includes(CLAUDE_MD_PLUGIN)
  const privateFolders = new Set(privatePlan.privates.flatMap(role => (role.parts.length > 0 ? [role.folder] : [])))
  const filter = { repoIds: withParts, privateFolders, roleFolders: privatePlan.folders }
  const offered = isImproverReady ? builtRoleFiles(steps, locations.root, filter) : []
  const allowed = privatePlan.allowed
  const written =
    offered.length === 0
      ? await writeSteps(io, host, locations, steps, allowed)
      : await writeImproved(io, host, { locations, input, steps, offered, allowed })
  const required = new Set(hunks.filter(hunk => hunk.isRequired).map(hunk => hunk.key))
  const outcome: ApplyOutcome = {
    ...written,
    hunkFailures: failures,
    attended: failures.filter(run => required.has(run.key)).map(run => run.key),
    installed: installs.installed,
    installProblems: installs.installProblems,
    untrackedParts: tracked.warnings,
    privateProblems: [...privatePlan.problems, ...written.privateProblems],
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
 * MCP servers and skills, the instructions and memories (instructionsStep: the content consent, then the instruction
 * parts or the whole-file questions; G-02-1f), the carried env names, the autonomy hunks of the frameworks in use, and
 * the claude-md-management install when a role got a built file and it is missing (D-141). It then asks the git policy
 * (gitPolicyStep) and, once for the repo, where the launchers start (launchStartStep), shows the one final review with
 * every role's scope card for that start (the one place the cards are shown; reviewLines, ROLE-06, A5) and the exact
 * file plan, each role's built CLAUDE.md included, where the person confirms or goes back to change one item
 * (reviewStep, D-43). --dry-run then replies with the confirmed plan and the note that nothing was written, and
 * installs nothing (D-82); plain init writes it (applyConfirmed, D-105), asking only Keep mine or Take new for each
 * conflicted file (D-67), running the accepted hunks first, then installing the plugins answered Install from the home
 * folder, and writing the plan made again from the disk (D-120), with the improver pass on each built role file before
 * the manifest (D-141), and replies with the plan as written and what the apply did (initReplyText). Every step gives a
 * StepResult (A1): runInit checks its kind before it uses the value, and for a cancelled step prints the reason as its
 * own line and answers cancelledReply with the step's reason (D-45), so only values the person accepted reach the steps
 * after it, and nothing is written or installed before Confirm. Every answer lives in memory for this one run, and
 * nothing is kept for the next (D-45, D-82).
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
  const team = await teamStep(io, base, proposal, null)
  if (team.kind === 'cancelled') return cancelReply(io, team.reason)

  const policy = await gitPolicyStep(io)
  if (policy.kind === 'cancelled') return cancelReply(io, policy.reason)

  const launch = await launchStartStep(io, guard.locations.root, team.value.roles)
  if (launch.kind === 'cancelled') return cancelReply(io, launch.reason)

  const draft = { ...base, ...team.value, policy: policy.value, launchStart: launch.value }
  const reviewed = await reviewStep(io, draft)
  if (reviewed.kind === 'cancelled') return cancelReply(io, reviewed.reason)
  const { plan, state } = reviewed.value.planned
  if (options.dryRun) {
    const confirmed = reviewed.value.draft
    const count = improverRunCount(confirmed, plan)
    const installed = setupAfterInstalls(confirmed.gathered.setup, confirmed.pluginInstalls).installedPlugins
    const improver = installed.includes(CLAUDE_MD_PLUGIN) && count > 0 ? [improverRunLine(count)] : []
    const rows = confirmed.roles.map(role => privateFilesRow(role.id))

    return initReplyText(plan, state.gitPolicy, state.launchStart, null, [PRIVATE_FILES_HEADING, ...rows, ...improver])
  }

  const applied = await applyConfirmed(io, options.host, reviewed.value)
  if (applied.kind === 'cancelled') return cancelReply(io, applied.reason)
  const asWritten = applied.value.planned

  return initReplyText(asWritten.plan, asWritten.state.gitPolicy, asWritten.state.launchStart, applied.value.outcome)
}

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

/** Whether an item a regen asks about is new since init or changed since (G-02-1f Regen, D-142). */
export type RegenChange = 'new' | 'changed'

/** Each answer to a regen question with what it does: Yes gives the item to the role, No leaves it out (D-142). */
const REGEN_CHOICES: readonly Labelled<boolean>[] = Object.freeze([
  { label: 'Yes', value: true },
  { label: 'No', value: false },
])

/** The answers to a regen question, Yes first (D-142). */
export const REGEN_ITEM_OPTIONS: readonly string[] = Object.freeze(REGEN_CHOICES.map(entry => entry.label))

/**
 * Why regen cancels when a regen question is dismissed or not answered (D-142, A1); MAX_ASKS answers it cannot read
 * give NO_USABLE_ANSWER_REASON.
 */
export const REGEN_DISMISSED_REASON = 'A regen question on instruction parts was dismissed or not answered.'

/**
 * The start of the reply of a regen cancelled at one of its questions: nothing was written (AUTO-PICK #19 Q7);
 * regenCancelledReply adds the reason.
 */
export const REGEN_CANCELLED = 'regen cancelled, nothing written'

/** The reply of a cancelled regen (AUTO-PICK #19 Q7): REGEN_CANCELLED, a colon and the reason as a report cell. */
export function regenCancelledReply(reason: string): string {
  return `${REGEN_CANCELLED}: ${reportText(reason)}`
}

/** The chip of a regen question (D-142, G-02-3c): `Regen <i>/<n>`, or just `Regen` when that is over 12 code points. */
export function regenHeader(position: number, count: number): string {
  return countedChip('Regen', position, count)
}

/** A part's heading as regen names it: the heading, or TOP_OF_FILE for the text before the first heading. */
function headingText(heading: string): string {
  return heading === '' ? TOP_OF_FILE : heading
}

/**
 * The regen question of a part (D-142): whether the role gets it, by its heading and its file, cleaned; regen makes no
 * grouping call, so a part is named by where it is, not by a topic.
 */
export function regenPartQuestion(id: string, part: Pick<InstructionPart, 'file' | 'heading'>): string {
  return `Should ${id} get "${headingText(part.heading)}" from ${clean(part.file)}?`
}

/** How the context line of a regen question names each kind of item (D-142). */
const REGEN_CHANGE_TEXTS: Readonly<Record<RegenChange, string>> = Object.freeze({
  new: 'New since init.',
  changed: 'Changed since init.',
})

/** The context line of a part's regen question (D-142): whether it is new or changed, then the recommendation. */
export function regenPartContextLine(change: RegenChange, isRecommended: boolean): string {
  return `${REGEN_CHANGE_TEXTS[change]} Recommended: ${isRecommended ? 'yes' : 'no'}.`
}

/** The regen question of a memory (D-142): whether the role gets it, by its file name, cleaned. */
export function regenMemoryQuestion(id: string, memory: Pick<MemoryItem, 'file'>): string {
  return `Should ${id} get the memory "${clean(memory.file)}"?`
}

/**
 * The context line of a memory's regen question (D-142): the summary its record holds, or NO_MEMORY_SUMMARY, as a
 * sentence (asSentence), then what a part's context line says (regenPartContextLine). MEMORY.md is not read for it
 * (AUTO-PICK #19 Q10).
 */
export function regenMemoryContextLine(
  memory: Pick<MemoryItem, 'summary'>,
  change: RegenChange,
  isRecommended: boolean,
): string {
  const summary = memory.summary === '' ? NO_MEMORY_SUMMARY : memory.summary

  return `${asSentence(summary)} ${regenPartContextLine(change, isRecommended)}`
}

/** The reply line of a part regen dropped from a role because it is gone from its file (G-02-1f Regen). */
export function partDroppedLine(id: string, record: Pick<InstructionPartRecord, 'file' | 'heading'>): string {
  return `dropped from ${id}: ${clean(record.file)} > ${headingText(record.heading)} (gone from its file)`
}

/** The reply line of a memory regen dropped from a role because its file is gone (G-02-1f Regen). */
export function memoryDroppedLine(id: string, memory: Pick<MemoryItem, 'file'>): string {
  return `dropped from ${id}: memory ${clean(memory.file)} (gone)`
}

/**
 * The warning of a regen where no one can be asked, such as `claude -p` (D-142 rg1-a): how many new or changed parts
 * and memories were left out of the role, and the command that asks about them.
 */
export function notHandedOutWarning(id: string, count: number): string {
  if (count === 1) {
    return (
      `1 new or changed instruction part or memory for ${id} was not handed out: ` +
      `run /cadre regen ${id} in a session to answer it`
    )
  }

  return (
    `${count} new or changed instruction parts or memories for ${id} were not handed out: ` +
    `run /cadre regen ${id} in a session to answer them`
  )
}

/**
 * The warning of a plain regen where no one can be asked whose rebuilt files the improver could improve (D-141,
 * D-142): it is not run, since no one can answer Accept or Keep original.
 */
export function improverNotOfferedWarning(id: string): string {
  return (
    `the improver was not offered for ${id}: claude -p cannot ask Accept or Keep original; ` +
    `run /cadre regen ${id} in a session to review the changes`
  )
}

/**
 * The warning of a --dry-run regen of a role with part records (AUTO-PICK #19 Q5): its private hand-out record is not
 * read, since naming its folder runs git and a dry run holds no host.
 */
export function dryRunPrivateWarning(id: string): string {
  return (
    `--dry-run did not compare the global parts and memories of ${id}: finding their folder runs git; ` +
    'a plain regen compares them'
  )
}

/**
 * The warning when a role's private hand-out record cannot be used (AUTO-PICK #19 Q9): it cannot be read, is not a
 * valid record, or names a file regen may not read, so its global parts and memories are not compared or rebuilt.
 */
export function unusableRecordWarning(id: string): string {
  return (
    `could not use the hand-out record of ${id} (instructions.json): its global parts and memories were not ` +
    'compared; run /cadre init to hand them out again'
  )
}

/**
 * The warning when regen stopped reading one side of a role at MAX_TOTAL_BYTES (02-GAPS-B3 C8): that side is left as
 * it is, its parts not compared.
 */
export function regenTotalWarning(id: string): string {
  return `regen stopped reading at ${MAX_TOTAL_BYTES / 1024} KiB for ${id}: its instruction parts were not compared`
}

/** Whether a repo-relative path is one of this role's own: in its folder `.cadre/<id>/`, or its launcher. */
function isRolePath(path: string, id: string): boolean {
  return path.startsWith(`.cadre/${id}/`) || path === launcherPath(id)
}

/**
 * The manifest entries regen keeps as they are (D-68): every entry of the last manifest that this run does not
 * generate and that is not in the role's folder or its launcher, so the other roles and cadre.json keep theirs.
 */
function carriedEntries(manifest: Manifest, desired: readonly DesiredFile[], id: string): ManifestEntry[] {
  const generated = new Set(desired.map(file => file.path))

  return manifest.files.filter(entry => !generated.has(entry.path) && !isRolePath(entry.path, id))
}

/** What a regen plans from (D-68, A2): the scans and compiled scopes of the team, and the last manifest in full. */
type RegenScans = {
  readonly gathered: Gathered
  readonly scopes: ReadonlyMap<string, CompiledScope>
  readonly manifest: Manifest
  readonly manifestState: ReadState
}

/**
 * The scans of a regen (D-68, D-70, D-72): every listed role compiled as init compiles it, on its own framework or the
 * repo default and attended by the current config (compileTeam), so the index lists the whole team; ~/.claude.json is
 * read only when cadre.json records the consent (readUserMcp, A1), so the MCP denies init compiled from it stay.
 * Without a manifest read in full regen cannot keep the other roles' entries, so it refuses (A2), as the scan read it:
 * REGEN_NO_MANIFEST when it is not there, REGEN_BAD_MANIFEST when it cannot be read, is too large or is not valid.
 */
async function regenScans(
  io: InitIo,
  locations: InitLocations,
  state: CadreState,
  roles: readonly RoleSpec[],
): Promise<RegenRead<RegenScans>> {
  const { gathered, scopes } = await compileTeam(io, locations, state, roles)
  const { manifest, manifestState } = gathered.repo.cadre
  if (manifest === null) return regenRefusal(manifestState === 'absent' ? REGEN_NO_MANIFEST : REGEN_BAD_MANIFEST)

  return { kind: 'ok', value: { gathered, scopes, manifest, manifestState } }
}

/** Whether a part's file and heading are the ones a record names (G-02-1f Regen). */
function isNamedBy(
  record: Pick<InstructionPartRecord, 'file' | 'heading'>,
  part: Pick<InstructionPart, 'file' | 'heading'>,
): boolean {
  return record.file === part.file && record.heading === part.heading
}

/** The files these records name, once each, in record order: the only files regen reads again (D-142 rg2-a). */
function recordedFiles(records: readonly InstructionPartRecord[]): string[] {
  return Array.from(new Set(records.map(record => record.file)))
}

/**
 * One side of a role's records as regen reads it again (G-02-1f Regen): its repo parts (role.json) or its global parts
 * and memories (its private hand-out record), the parts it was given and not given and the memories it was given, as
 * recorded, and the parts and memories of what they name as they are now.
 */
type RegenSide = {
  readonly given: readonly InstructionPartRecord[]
  readonly notGiven: readonly InstructionPartRecord[]
  readonly memories: readonly MemoryRecord[]
  readonly current: RegenItems
}

/**
 * A side regen read again, or why it is left as it is (AUTO-PICK #19 Q8, Q9), with the warnings of the files it could
 * not read or of the record it cannot use.
 */
type SideRead =
  | { readonly kind: 'read'; readonly side: RegenSide }
  | { readonly kind: 'kept'; readonly warnings: readonly string[] }

/**
 * A role's repo side read again (G-02-1f Regen, D-142 rg2-a): each file its role.json records name, once, in record
 * order, through readRepoFile (a link out of the repo is never read), split into hashed parts (partsOfText). A missing
 * file has no part, so its records are removed; a file that cannot be read (unreadableWarning) or is over the read cap
 * (overSizeWarning) leaves the whole side as it is (AUTO-PICK #19 Q8), since its parts could not be rebuilt; so does a
 * text that would take the side past MAX_TOTAL_BYTES in all, which stops the read (regenTotalWarning, 02-GAPS-B3 C8).
 */
async function repoSideRead(io: InitIo, root: string, role: RoleSpec): Promise<SideRead> {
  const given = role.instructionParts ?? []
  const notGiven = role.instructionPartsNotGiven ?? []
  const parts: InstructionPart[] = []
  const warnings: string[] = []
  let total = 0
  for (const file of recordedFiles([...given, ...notGiven])) {
    const read = await readRepoFile(io, root, file, MAX_READ_BYTES)
    if (read.state === 'unknown') warnings.push(unreadableWarning(clean(file)))
    if (read.state === 'too-large') warnings.push(overSizeWarning(clean(file)))
    if (read.state !== 'text') continue
    total += utf8Bytes(read.text)
    if (total > MAX_TOTAL_BYTES) return { kind: 'kept', warnings: [regenTotalWarning(role.id)] }
    parts.push(...(await partsOfText(file, 'repo', read.text, parts.length)))
  }
  if (warnings.length > 0) return { kind: 'kept', warnings }

  return { kind: 'read', side: { given, notGiven, memories: [], current: { parts, memories: [] } } }
}

/**
 * Where a role's private record may name a file regen reads again (AUTO-PICK #19 Q9): the locations its display forms
 * are read back with, the config folder when it is outside the repo, the CLAUDE.md files of the chain above the repo,
 * and the memory folders of this repo.
 */
type RecordPlaces = {
  readonly sources: Pick<InstructionSources, 'root' | 'home' | 'configDir'>
  readonly userDir: string | null
  readonly chain: readonly string[]
  readonly memoryFolders: readonly string[]
}

/**
 * The places a private record may name (AUTO-PICK #19 Q9), as init's read takes them: the config folder only when it
 * is not inside the repo (02-GAPS-B2 N10), the chain CLAUDE.md files of the setup scan read back from their display
 * form, those above the repo only (02-GAPS-B2 S2), and the memory folders of this repo (memoryFoldersOf).
 */
function recordPlacesOf(locations: InitLocations, setup: SetupScan): RecordPlaces {
  const { root, home, configDir } = locations
  const sources = { root, home, configDir }
  const userDir = userDirOf(locations)
  const folder = userDir === null || relativeTo(userDir, root) !== null ? '' : trimSlash(userDir)
  const chain = setup.claudeMd.map(shown => pathFromDisplay(shown, sources))

  return {
    sources,
    userDir: folder === '' ? null : folder,
    chain: chain.filter(path => relativeTo(path, root) === null),
    memoryFolders: memoryFoldersOf(locations),
  }
}

/** Whether a path is absolute with no empty, `.` or `..` segment (AUTO-PICK #19 Q9). */
function isPlainPath(path: string): boolean {
  if (!path.startsWith('/')) return false

  return path
    .slice(1)
    .split('/')
    .every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * The path of a recorded global part's file (AUTO-PICK #19 Q9): its display form read back (pathFromDisplay), when
 * that is a plain absolute path (isPlainPath) that is a plain .md file of the config folder init may read
 * (isReadableConfigFile, 02-GAPS-B3 M2) or a CLAUDE.md of the chain above the repo; else null, so a record cannot point
 * regen at any other file.
 */
function globalPathOf(file: string, places: RecordPlaces): string | null {
  const path = pathFromDisplay(file, places.sources)
  if (!isPlainPath(path)) return null
  if (places.userDir !== null && isReadableConfigFile(path, places.userDir)) return path

  return places.chain.includes(path) ? path : null
}

/**
 * The path of a recorded memory (AUTO-PICK #19 Q9): in a memory folder of this repo, under a plain `.md` file name
 * (isSafeFileName) that is not MEMORY.md in any letter case (isMemoryIndexName, 02-GAPS-B3 N2); else null.
 */
function memoryPathOf(memory: Pick<RecordedMemory, 'file' | 'folder'>, places: RecordPlaces): string | null {
  const { file, folder } = memory
  if (!places.memoryFolders.includes(folder) || !isSafeFileName(file)) return null
  if (!file.endsWith(MARKDOWN_EXTENSION) || isMemoryIndexName(file)) return null

  return `${folder}/${file}`
}

/**
 * A role's private hand-out record found, or why there is none to compare (AUTO-PICK #19 Q5, Q9); with its role memory
 * folder when it is known (02-GAPS-B3 M1).
 */
type PrivateFound =
  | { readonly kind: 'none'; readonly folder: string }
  | { readonly kind: 'kept'; readonly warnings: readonly string[] }
  | { readonly kind: 'found'; readonly folder: string; readonly record: InstructionsRecord }

/**
 * A role's private hand-out record (G-02-1f Regen, D-140 q2-a). A dry run holds no host, so it names no folder and
 * reads no record (dryRunPrivateWarning, AUTO-PICK #19 Q5). Else the role memory folder is named as /cadre start names
 * it (roleFoldersOf), with privateFoldersUnknownWarning when it cannot be, and its instructions.json is read: a record
 * that is not there means the role holds nothing private; one that cannot be read or is not valid
 * (parseInstructionsRecord) is not used (unusableRecordWarning).
 */
async function privateRecordOf(
  io: InitIo,
  host: HostIo | null,
  locations: InitLocations,
  id: string,
): Promise<PrivateFound> {
  if (host === null) return { kind: 'kept', warnings: [dryRunPrivateWarning(id)] }
  const folderOf = await roleFoldersOf(io, host, locations)
  if (folderOf === null) return { kind: 'kept', warnings: [privateFoldersUnknownWarning([id])] }
  const folder = folderOf(id)
  const read = await io.read(instructionsRecordPath(folder), MAX_READ_BYTES)
  if (read.state === 'absent') return { kind: 'none', folder }
  const record = read.state === 'text' ? parseInstructionsRecord(read.text) : null
  if (record === null) return { kind: 'kept', warnings: [unusableRecordWarning(id)] }

  return { kind: 'found', folder, record }
}

/**
 * A role's private side read again (G-02-1f Regen, D-142 rg2-a). Every file and memory its record names is checked
 * first (globalPathOf, memoryPathOf): one regen may not read makes the whole record unusable (unusableRecordWarning,
 * AUTO-PICK #19 Q9), and nothing is read. Then each named file is read once, in record order, through the port and
 * split into hashed global parts (partsOfText), and each memory is read for its hash only, with the folder and summary
 * its record holds (Q10). A missing file or memory is gone; one that cannot be read (unreadableWarning) or is over the
 * read cap (overSizeWarning, memoryOverSizeWarning) leaves the whole side as it is (Q8); so does a text, a memory's
 * included, that would take the side past MAX_TOTAL_BYTES in all, which stops the read (regenTotalWarning, 02-GAPS-B3
 * C8). The repo side has a total of its own.
 */
async function privateSideRead(
  io: InitIo,
  record: InstructionsRecord,
  places: RecordPlaces,
  id: string,
): Promise<SideRead> {
  const files = recordedFiles([...record.parts, ...record.partsNotGiven])
  const named = files.flatMap(file => {
    const path = globalPathOf(file, places)

    return path === null ? [] : [{ file, path }]
  })
  const linked = record.memories.flatMap(memory => {
    const path = memoryPathOf(memory, places)

    return path === null ? [] : [{ memory, path }]
  })
  if (named.length < files.length || linked.length < record.memories.length) {
    return { kind: 'kept', warnings: [unusableRecordWarning(id)] }
  }
  const parts: InstructionPart[] = []
  const warnings: string[] = []
  let total = 0
  for (const { file, path } of named) {
    const read = await io.read(path, MAX_READ_BYTES)
    if (read.state === 'unknown') warnings.push(unreadableWarning(clean(file)))
    if (read.state === 'too-large') warnings.push(overSizeWarning(clean(file)))
    if (read.state !== 'text') continue
    total += utf8Bytes(read.text)
    if (total > MAX_TOTAL_BYTES) return { kind: 'kept', warnings: [regenTotalWarning(id)] }
    parts.push(...(await partsOfText(file, 'global', read.text, parts.length)))
  }
  const memories: MemoryItem[] = []
  for (const { memory, path } of linked) {
    const read = await io.read(path, MAX_READ_BYTES)
    if (read.state === 'unknown') warnings.push(unreadableWarning(clean(memory.file)))
    if (read.state === 'too-large') warnings.push(memoryOverSizeWarning(clean(memory.file)))
    if (read.state !== 'text') continue
    total += utf8Bytes(read.text)
    if (total > MAX_TOTAL_BYTES) return { kind: 'kept', warnings: [regenTotalWarning(id)] }
    const { file, folder, summary } = memory
    memories.push({ id: `M${memories.length + 1}`, file, folder, summary, hash: await sha256Hex(read.text) })
  }
  if (warnings.length > 0) return { kind: 'kept', warnings }
  const { parts: given, partsNotGiven: notGiven } = record

  return { kind: 'read', side: { given, notGiven, memories: record.memories, current: { parts, memories } } }
}

/** One new or changed item a regen asks about (G-02-1f Regen, D-142), as its side found it. */
type RegenAsk =
  | { readonly kind: 'part'; readonly part: InstructionPart; readonly change: RegenChange }
  | { readonly kind: 'memory'; readonly memory: MemoryItem; readonly change: RegenChange }

/** What changed on one side since its records were made, and what regen asks about it (sideChanges). */
type SideChanges = {
  readonly side: RegenSide
  readonly changes: PartChanges
  readonly asked: readonly RegenAsk[]
}

/** The parts now, less one part for each not-given record it matches by file, heading and hash, each record once. */
function openParts(parts: readonly InstructionPart[], notGiven: readonly InstructionPartRecord[]): InstructionPart[] {
  const unused = [...notGiven]
  const open: InstructionPart[] = []
  for (const part of parts) {
    const at = unused.findIndex(record => isNamedBy(record, part) && record.hash === part.hash)
    if (at < 0) {
      open.push(part)
      continue
    }
    unused.splice(at, 1)
  }

  return open
}

/**
 * What changed on one side since its records were made (G-02-1f Regen, AUTO-PICK #19 Q1): a part that matches a
 * not-given record exactly stays not given (openParts), and partChanges compares the given records and the memories
 * with the rest. Regen asks, in file order, each changed part and each part neither list names by file and heading
 * (new), then each changed memory; a changed part the role was not given is not asked, and a memory is never new,
 * since only /cadre init finds a new file (D-142 rg2-a).
 */
function sideChanges(side: RegenSide): SideChanges {
  const open = openParts(side.current.parts, side.notGiven)
  const records = { parts: side.given, memories: side.memories }
  const changes = partChanges(records, { parts: open, memories: side.current.memories })
  const kept = new Set(changes.kept.parts)
  const changed = new Set(changes.changed.parts)
  const isNew = (part: InstructionPart): boolean =>
    !kept.has(part) && !changed.has(part) && !side.notGiven.some(record => isNamedBy(record, part))
  const parts = open.flatMap((part): RegenAsk[] => {
    if (changed.has(part)) return [{ kind: 'part', part, change: 'changed' }]

    return isNew(part) ? [{ kind: 'part', part, change: 'new' }] : []
  })
  const memories = changes.changed.memories.map((memory): RegenAsk => ({ kind: 'memory', memory, change: 'changed' }))

  return { side, changes, asked: [...parts, ...memories] }
}

/**
 * What one side gives after the questions (G-02-1f Regen, D-142): the parts the role holds now and every other part of
 * the files read, both in file order, the memories it holds now, whether its built text and its records change, the
 * reply lines of what was dropped, and how many items were left out because no one could be asked.
 */
type SideResult = {
  readonly given: readonly InstructionPart[]
  readonly notGiven: readonly InstructionPart[]
  readonly memories: readonly MemoryItem[]
  readonly isTextChanged: boolean
  readonly isRecordsChanged: boolean
  readonly dropped: readonly string[]
  readonly leftOut: number
}

/**
 * One side after the questions (G-02-1f Regen, D-142 rg1-a; AUTO-PICK #19 Q1, Q3): the role holds each kept part and
 * memory and, in a session, each asked one answered Yes (`yes`); every other part of the files read is not given, and
 * a memory answered No leaves its record. Its built text changes when a given part changed or is gone, or a new part
 * was taken; its records change only in a session, when an item was asked or one is gone, so where no one can be asked
 * no record is written and a removed item is reported again until a session regen drops it. Each removed part and
 * memory gives its reply line.
 */
function sideResult(id: string, found: SideChanges, yes: ReadonlySet<RegenAsk>, isSession: boolean): SideResult {
  const { side, changes, asked } = found
  const taken = asked.filter(item => yes.has(item))
  const takenParts = taken.flatMap(item => (item.kind === 'part' ? [item.part] : []))
  const takenMemories = taken.flatMap(item => (item.kind === 'memory' ? [item.memory] : []))
  const heldParts = new Set([...changes.kept.parts, ...takenParts])
  const heldMemories = new Set([...changes.kept.memories, ...takenMemories])
  const { removed } = changes
  const isGone = removed.parts.length > 0 || removed.memories.length > 0

  return {
    given: side.current.parts.filter(part => heldParts.has(part)),
    notGiven: side.current.parts.filter(part => !heldParts.has(part)),
    memories: side.current.memories.filter(memory => heldMemories.has(memory)),
    isTextChanged:
      removed.parts.length > 0 || changes.changed.parts.length > 0 || taken.some(item => item.change === 'new'),
    isRecordsChanged: isSession && (isGone || asked.length > 0),
    dropped: [
      ...removed.parts.map(record => partDroppedLine(id, record)),
      ...removed.memories.map(memory => memoryDroppedLine(id, memory)),
    ],
    leftOut: isSession ? 0 : asked.length,
  }
}

/**
 * The recommendation for each item a regen asks about, by `I<n>` (G-02-1f Regen, D-142): one model call with the role
 * and the items (regenRecommendPrompt, REGEN_RECOMMEND_SYSTEM). A reply parseRegenRecommendation cannot take is sent
 * back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all (checkedCompletion), and then no item is recommended.
 */
async function regenRecommended(
  io: InitIo,
  role: RoleSpec,
  asked: readonly RegenAsk[],
): Promise<ReadonlyMap<string, boolean>> {
  const itemIds = asked.map((_, index) => `I${index + 1}`)
  const items = asked.map(
    (item): RegenPromptItem =>
      item.kind === 'part' ? { kind: 'part', part: item.part } : { kind: 'memory', memory: item.memory },
  )
  const parse = (reply: string): Checked<ReadonlyMap<string, boolean>> => {
    const parsed = parseRegenRecommendation(reply, itemIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.recommended }
  }
  const prompt = (errors: readonly string[]): string => regenRecommendPrompt(role, items, errors)

  return checkedCompletion(io, REGEN_RECOMMEND_SYSTEM, prompt, parse, () => new Map())
}

/**
 * The question of one regen item (D-142): the part question (regenPartQuestion) or the memory question
 * (regenMemoryQuestion) with its context line, Yes and No, and the chip of its place (regenHeader); an answer that is
 * neither is asked again with why on top (D-136).
 */
function regenAsk(
  id: string,
  item: RegenAsk,
  isRecommended: boolean,
  place: { readonly position: number; readonly count: number },
): ChoiceAsk<boolean> {
  const question =
    item.kind === 'part'
      ? withContext(regenPartQuestion(id, item.part), regenPartContextLine(item.change, isRecommended))
      : withContext(
          regenMemoryQuestion(id, item.memory),
          regenMemoryContextLine(item.memory, item.change, isRecommended),
        )

  return {
    question,
    spec: { options: REGEN_ITEM_OPTIONS, header: regenHeader(place.position, place.count) },
    parse: answer => labelled(REGEN_CHOICES, answer),
    accepts: quotedLabels(REGEN_ITEM_OPTIONS),
  }
}

/**
 * The answers to the questions of a regen in a session (G-02-1f Regen, D-142 rg1-a): one recommendation call for every
 * item (regenRecommended), then each item's question in order (regenAsk); it gives the items answered Yes. A dismissal
 * is cancelled with REGEN_DISMISSED_REASON and MAX_ASKS answers that are neither with NO_USABLE_ANSWER_REASON, so
 * nothing is written (A1, AUTO-PICK #19 Q7).
 */
async function regenAnswers(
  io: InitIo,
  role: RoleSpec,
  asked: readonly RegenAsk[],
): Promise<StepResult<ReadonlySet<RegenAsk>>> {
  const recommended = await regenRecommended(io, role, asked)
  const yes = new Set<RegenAsk>()
  for (const [index, item] of asked.entries()) {
    const place = { position: index + 1, count: asked.length }
    const ask = regenAsk(role.id, item, recommended.get(`I${place.position}`) === true, place)
    const answer = choiceResult(await askChoice(io, ask), REGEN_DISMISSED_REASON)
    if (answer.kind === 'cancelled') return answer
    if (answer.value) yes.add(item)
  }

  return accepted(yes)
}

/**
 * The repo side as a plain regen may write it (02-GAPS-B2 M3): when it rebuilds the built file or writes the records,
 * `git ls-files` runs once (trackedParts) for the files of the parts it would write, and only the parts of files git
 * tracks are kept, the built text then changing when a given part is left out; each other file is a warning. When git
 * cannot be asked the side is left as it is (null) with GIT_TRACKING_UNKNOWN_WARNING. A dry run holds no host and asks
 * no git, so its plan may show a part that apply then leaves out.
 */
async function trackedSide(
  host: HostIo | null,
  root: string,
  id: string,
  result: SideResult,
): Promise<{ readonly result: SideResult | null; readonly warnings: readonly string[] }> {
  if (host === null || !(result.isTextChanged || result.isRecordsChanged)) return { result, warnings: [] }
  const parts = [...result.given, ...(result.isRecordsChanged ? result.notGiven : [])]
  const tracked = await trackedParts(host, root, new Map([[id, parts]]))
  if (tracked.warnings.includes(GIT_TRACKING_UNKNOWN_WARNING)) return { result: null, warnings: tracked.warnings }
  const kept = new Set(tracked.repoParts.get(id) ?? [])
  const given = result.given.filter(part => kept.has(part))
  const notGiven = result.notGiven.filter(part => kept.has(part))
  const isTextChanged = result.isTextChanged || given.length < result.given.length

  return { result: { ...result, given, notGiven, isTextChanged }, warnings: tracked.warnings }
}

/**
 * Which private files regen rebuilds (G-02-1f Regen; AUTO-PICK #19 Q3, Q4, Q11): when the records change, the record,
 * and the text file too when its text changes or the role is left with nothing, so both files say so; with no record
 * change, as where no one can be asked, the text file alone when its text changes; else none.
 */
function privateRebuildOf(result: SideResult): NonNullable<PrivateRole['rebuild']> | null {
  if (!result.isRecordsChanged) return result.isTextChanged ? 'text' : null
  const isEmpty = result.given.length === 0 && result.memories.length === 0

  return result.isTextChanged || isEmpty ? 'both' : 'record'
}

/**
 * The private files regen rebuilds for a role, or null when it rebuilds none (privateRebuildOf): its role memory
 * folder, the repo's folder name for the text file's header, the global parts and memories it holds now, and the
 * other global parts of the files read, which its record names as not given (AUTO-PICK #19 Q1).
 */
function privateRoleOf(id: string, folder: string, repo: string, result: SideResult): PrivateRole | null {
  const rebuild = privateRebuildOf(result)
  if (rebuild === null) return null
  const { given: parts, memories, notGiven } = result

  return { id, folder, repo, parts, memories, partsNotGiven: notGiven.map(partRecord), rebuild }
}

/** The role with the repo records of this side (withPartRecords): the parts it holds now, and the other parts read. */
function recordedRole(role: RoleSpec, side: SideResult): RoleSpec {
  return withPartRecords(role, side.given.map(partRecord), side.notGiven.map(partRecord))
}

/**
 * What regen hands out for its role (G-02-1f Regen, D-142): the role role.json is planned from, with new records when
 * they change (AUTO-PICK #19 Q2), and whether they do; the repo parts its built CLAUDE.md is rebuilt from, null to
 * keep that file as it is (Q4); its private files to rebuild, null for none; the reply lines of what was dropped; the
 * warnings printed with the scan warnings; the warnings of the git check, printed with what the apply did; whether a
 * dialog could be shown, so the improver may run after a plain regen; and the role memory folder, whose private files
 * the improver run of the built CLAUDE.md watches (02-GAPS-B3 M1).
 */
type RegenHanded = {
  readonly role: RoleSpec
  readonly isRoleWritten: boolean
  readonly repoParts: readonly InstructionPart[] | null
  readonly privateRole: PrivateRole | null
  readonly dropped: readonly string[]
  readonly warnings: readonly string[]
  readonly untracked: readonly string[]
  readonly isSession: boolean
  /** The role memory folder, null when it is not known (02-GAPS-B3 M1). */
  readonly folder: string | null
}

/**
 * The hand-out of a regen (G-02-1f Regen, D-142). A role.json with no part records, written before them, hands out
 * nothing, so regen runs as before. Else regen reads again only the files and memories the records name (rg2-a): the
 * repo side from role.json (repoSideRead) and, in a plain regen, the private side from the role's hand-out record
 * (privateRecordOf, privateSideRead); a --dry-run compares the repo side only (AUTO-PICK #19 Q5). Each side gives what
 * changed and what to ask (sideChanges): the repo side's parts, then the global parts, then the memories. In a session
 * that can show a dialog, with an item to ask, one recommendation call and one question per item follow (regenAnswers,
 * rg1-a), in a --dry-run too (Q6), and a cancel gives its reason (Q7); where no one can be asked nothing is, and the
 * items left out give notHandedOutWarning. Then each side's result (sideResult): the repo side is checked against git
 * in a plain regen (trackedSide), sets its records on the role when they change (withPartRecords) and rebuilds the
 * built file from its parts when its text changes; the private side gives the files of the role memory folder to
 * rebuild (privateRoleOf), with the repo's folder name (repoNameOf).
 */
async function regenHandout(
  io: InitIo,
  host: HostIo | null,
  input: {
    readonly id: string
    readonly role: RoleSpec
    readonly locations: InitLocations
    readonly setup: SetupScan
  },
): Promise<StepResult<RegenHanded>> {
  const { id, role, locations } = input
  const handed: RegenHanded = {
    role,
    isRoleWritten: false,
    repoParts: null,
    privateRole: null,
    dropped: [],
    warnings: [],
    untracked: [],
    isSession: false,
    folder: null,
  }
  if (role.instructionParts === undefined && role.instructionPartsNotGiven === undefined) return accepted(handed)
  const repoRead = await repoSideRead(io, locations.root, role)
  const found = await privateRecordOf(io, host, locations, id)
  const places = recordPlacesOf(locations, input.setup)
  const privateRead = found.kind === 'found' ? await privateSideRead(io, found.record, places, id) : null
  const repoChanges = repoRead.kind === 'read' ? sideChanges(repoRead.side) : null
  const privateChanges = privateRead?.kind === 'read' ? sideChanges(privateRead.side) : null
  const asked = [...(repoChanges?.asked ?? []), ...(privateChanges?.asked ?? [])]
  const isSession = (await io.isInteractive()) === true
  const none: ReadonlySet<RegenAsk> = new Set()
  const answers = isSession && asked.length > 0 ? await regenAnswers(io, role, asked) : accepted(none)
  if (answers.kind === 'cancelled') return answers
  const repoResult = repoChanges === null ? null : sideResult(id, repoChanges, answers.value, isSession)
  const privateResult = privateChanges === null ? null : sideResult(id, privateChanges, answers.value, isSession)
  const tracked = repoResult === null ? null : await trackedSide(host, locations.root, id, repoResult)
  const repoSide = tracked?.result ?? null
  const leftOut = (repoResult?.leftOut ?? 0) + (privateResult?.leftOut ?? 0)
  const warnings = [
    ...(repoRead.kind === 'kept' ? repoRead.warnings : []),
    ...(found.kind === 'kept' ? found.warnings : []),
    ...(privateRead?.kind === 'kept' ? privateRead.warnings : []),
    ...(leftOut > 0 ? [notHandedOutWarning(id, leftOut)] : []),
  ]
  const isRoleWritten = repoSide !== null && repoSide.isRecordsChanged
  const privateRole =
    found.kind === 'found' && privateResult !== null
      ? privateRoleOf(id, found.folder, repoNameOf(locations), privateResult)
      : null

  return accepted({
    role: isRoleWritten ? recordedRole(role, repoSide) : role,
    isRoleWritten,
    repoParts: repoSide !== null && repoSide.isTextChanged ? repoSide.given : null,
    privateRole,
    dropped: [...(repoSide?.dropped ?? []), ...(privateResult?.dropped ?? [])],
    warnings,
    untracked: tracked?.warnings ?? [],
    isSession,
    folder: found.kind === 'found' || found.kind === 'none' ? found.folder : null,
  })
}

/**
 * What regen planned for one role: the file plan, the warnings its reply prints between the plan and the ending (the
 * scan warnings of the run, A4, then the hand-out's), the reply lines of what the hand-out dropped, and what apply
 * writes the plan from: the desired files and the manifest the plan records.
 */
type RegenPlanned = {
  readonly plan: Plan
  readonly warnings: readonly string[]
  readonly dropped: readonly string[]
  readonly desired: readonly DesiredFile[]
  readonly manifest: Manifest
}

/** The manifest with this path recorded at this hash in place of any entry it had for it (A5, AUTO-PICK #19 Q2). */
function withRecordedHash(manifest: Manifest, path: string, sha256: string): Manifest {
  const others = manifest.files.filter(entry => entry.path !== path)

  return { ...manifest, files: [...others, { path, sha256, mode: 'file' }] }
}

/**
 * The file plan of regen for one role (D-68, PLAN-04), from its scans (regenScans) and its hand-out (regenHandout).
 * desiredFiles gives only that role's files, its launcher and the index, with the role as the hand-out gives it, and
 * its built `.cadre/<id>/CLAUDE.md` only when the hand-out rebuilds it from its repo parts; else the last manifest's
 * entry of that file is carried, so the file gets no op and is never listed as no longer generated (AUTO-PICK #15,
 * #19 Q4). Exactly the paths planReadPaths names are read, and planWithManifest classifies them against the disk and
 * the last manifest, carrying every other entry (carriedEntries). No `.gitignore` block and no hunk is planned. The
 * role's role.json is the input (A5): when the hand-out leaves its records as they are it gets no op and the new
 * manifest records the hash of `roleJson`, the text on disk, which the next init normalises; when its records change
 * it is planned with them against that same disk hash as the last one, so it is a change, never a conflict (AUTO-PICK
 * #19 Q2). The warnings are the scan warnings of the run (scanWarnings, A4), then the hand-out's.
 */
async function regenPlan(
  io: InitIo,
  input: {
    readonly id: string
    readonly state: CadreState
    readonly roles: readonly RoleSpec[]
    readonly roleJson: string
    readonly locations: InitLocations
    readonly scans: RegenScans
    readonly handed: RegenHanded
  },
): Promise<RegenPlanned> {
  const { id, state, roleJson, locations, scans, handed } = input
  const { manifest } = scans
  const roles = input.roles.map(role => (role.id === id ? handed.role : role))
  const parts = handed.repoParts === null ? {} : { repoParts: new Map([[id, handed.repoParts]]) }
  const generated = desiredFiles({ roles, scopes: scans.scopes, state, only: id, ...parts })
  const ownPath = roleJsonPath(id)
  const sha256 = await sha256Hex(roleJson)
  const desired = handed.isRoleWritten ? generated : generated.filter(file => file.path !== ownPath)
  const own = generated
    .filter(file => !handed.isRoleWritten && file.path === ownPath)
    .map((file): ManifestEntry => ({ path: file.path, sha256, mode: file.mode }))
  const builtPath = builtClaudeMdPath(id)
  const built = handed.repoParts === null ? manifest.files.filter(entry => entry.path === builtPath) : []
  const planned = await planWithManifest({
    desired,
    disk: await readPaths(io, locations.root, planReadPaths(desired)),
    manifest: handed.isRoleWritten ? withRecordedHash(manifest, ownPath, sha256) : manifest,
    manifestState: scans.manifestState,
    carried: [...own, ...built, ...carriedEntries(manifest, generated, id)],
    gitignore: null,
    hunks: [],
    cadreVersion: (await io.cadreVersion()) ?? 'unknown',
  })
  const warnings = [...scanWarnings(locations, scans.gathered), ...handed.warnings]

  return { plan: planned.plan, warnings, dropped: handed.dropped, desired, manifest: planned.manifest }
}

/**
 * The regen reply (D-68): what was asked for, the file plan as renderPlan prints it, the reply line of each item the
 * hand-out dropped (G-02-1f Regen), one `warning:` line for each warning of the plan, between the plan and the ending
 * as init prints them (scanWarningLines, A4), then the dry-run note when `applied` is null (--dry-run, nothing was
 * written), else the lines of what the apply did (appliedLines), with the regen manifest note (A4).
 */
function regenReplyText(planned: RegenPlanned, id: string, applied: ApplyOutcome | null): string {
  const command = applied === null ? `cadre regen ${id} --dry-run` : `cadre regen ${id}`
  const ending = applied === null ? [DRY_RUN_NOTE] : appliedLines(applied, regenManifestSkippedNote(id))
  const warnings = scanWarningLines(planned.warnings)

  return [command, ...renderPlan(planned.plan), ...planned.dropped, ...warnings, ...ending].join('\n')
}

/**
 * Writes the plan of a plain regen (D-68, D-105) with no question: applySteps with the role's private files when the
 * hand-out rebuilds them, whose paths are the only ones outside the repo it may write (privatePaths, T-02-72), run by
 * writeSteps, so a conflicted file is kept and its `.cadre-new` copy written. When claude-md-management is installed
 * and the apply rebuilds a built file with a part in it (builtRoleFiles: the role's built CLAUDE.md with a repo part,
 * watching its private files when its role memory folder is known and guarded from its `.runtime` folder, and its
 * private text file with a global part; 02-GAPS-B3 M1, C1), the improver pass runs on them in a session
 * (writeImproved, D-141, D-142); where no one can be asked it does not start, and the outcome carries
 * improverNotOfferedWarning. The warnings of the hand-out's git check are its untrackedParts.
 */
async function regenApply(
  io: InitIo,
  host: HostIo,
  input: {
    readonly locations: InitLocations
    readonly planned: RegenPlanned
    readonly handed: RegenHanded
    readonly setup: SetupScan
  },
): Promise<ApplyOutcome> {
  const { locations, planned, handed } = input
  const { plan, desired, manifest } = planned
  const { privateRole, role } = handed
  const privates = privateRole === null ? [] : [privateRole]
  const applyInput: ApplyInput = { plan, desired, manifest, gitignore: null, choices: new Map(), privates }
  const steps = await applySteps(applyInput)
  const allowed = privatePaths(privates.map(owed => owed.folder))
  const withParts = new Set(handed.repoParts !== null && handed.repoParts.length > 0 ? [role.id] : [])
  const isImproverReady = input.setup.installedPlugins.includes(CLAUDE_MD_PLUGIN)
  const privateFolders = new Set(privateRole !== null && privateRole.parts.length > 0 ? [privateRole.folder] : [])
  const roleFolders = handed.folder === null ? new Map<string, string>() : new Map([[role.id, handed.folder]])
  const filter = { repoIds: withParts, privateFolders, roleFolders }
  const built = isImproverReady ? builtRoleFiles(steps, locations.root, filter) : []
  const isOffered = built.length > 0 && handed.isSession
  const written = isOffered
    ? await writeImproved(io, host, { locations, input: applyInput, steps, offered: built, allowed })
    : await writeSteps(io, host, locations, steps, allowed)
  const notOffered = built.length > 0 && !handed.isSession ? [improverNotOfferedWarning(role.id)] : []

  const improverWarnings = [...written.improverWarnings, ...notOffered]

  return { ...written, untrackedParts: handed.untracked, improverWarnings }
}

/**
 * How `/cadre regen <id>` runs (D-68, T-03-16): --dry-run prints the role's plan and holds no host, so it can neither
 * write nor run; plain regen writes that plan through `host`.
 */
export type RegenOptions =
  | { readonly id: string; readonly dryRun: true }
  | { readonly id: string; readonly dryRun: false; readonly host: HostIo }

/**
 * The reply of a regen cancelled at one of its questions: its reason logged as its own line, the one place it is
 * printed (A1), and regenCancelledReply of it, so the reply names it too (AUTO-PICK #19 Q7).
 */
function regenCancelReply(io: InitIo, reason: string): string {
  io.log(reportText(reason))

  return regenCancelledReply(reason)
}

/**
 * `/cadre regen <id> [--dry-run]` (D-68, D-99, D-142). Its guard (initGuard in the regen wording) never asks whether
 * anyone is there, so it also runs in `claude -p`. It then reads the team (readTeam) and refuses with an exact reply,
 * in this order: no `.cadre/cadre.json` (REGEN_NO_STATE); a cadre.json that cannot be read or is not valid, its stored
 * launcher folder included (REGEN_BAD_STATE); an id it does not list (regenNoRole); the first listed role.json, in
 * cadre.json order, that is missing, not valid or holds another id (regenBadRole); when the repo has no default
 * framework, the first listed role with none of its own (regenNeedsFramework, D-73); and last, read by its scans
 * (regenScans), a manifest that is not there (REGEN_NO_MANIFEST) or cannot be read, is too large or is not valid
 * (REGEN_BAD_MANIFEST, A2). Then it hands out what changed in the files and memories the role's records name
 * (regenHandout, G-02-1f Regen): in a session it asks about each new or changed item, and a dismissed or unanswered
 * question cancels with regenCancelledReply, its reason logged as its own line, before anything is written (AUTO-PICK
 * #19 Q7); where no one can be asked it asks and logs nothing and says what it left out. A role.json with no records
 * asks and logs nothing, as before. It plans that one role (regenPlan). --dry-run replies with the plan, the dropped
 * lines, a `warning:` line for each warning and the note that nothing was written; plain regen writes the plan
 * (regenApply): a conflicted file is kept and its `.cadre-new` copy written, as an unanswered conflict is (D-67),
 * cadre.json is never among its files, a manifest the plan keeps as a conflict is not written, and in a session the
 * improver pass runs on the rebuilt files (D-141). It then replies with the plan, the dropped lines, the warnings and
 * what the apply did (regenReplyText). ~/.claude.json is read only when cadre.json records the consent (readUserMcp,
 * A1), so the MCP denies init compiled from it stay. Plain regen and --dry-run differ in the first line and the ending,
 * and a dry run compares no private record (AUTO-PICK #19 Q5) and asks git nothing.
 */
export async function runRegen(io: InitIo, options: RegenOptions): Promise<string> {
  const guard = await initGuard(io, 'regen')
  if (guard.kind === 'refuse') return guard.text
  const { locations } = guard
  const { id } = options

  const team = await readTeam(io, locations.root, 'regen', id)
  if (team.kind === 'refuse') return team.text
  const { state, roles, texts } = team.value
  const role = roles.find(listed => listed.id === id)
  const roleJson = texts.get(id)
  // Fail closed: every listed role was read, so after the id check the role and its text are always there.
  if (role === undefined || roleJson === undefined) return regenBadRole(id)

  const scans = await regenScans(io, locations, state, roles)
  if (scans.kind === 'refuse') return scans.text
  const { setup } = scans.value.gathered
  const host = options.dryRun ? null : options.host
  const handed = await regenHandout(io, host, { id, role, locations, setup })
  if (handed.kind === 'cancelled') return regenCancelReply(io, handed.reason)

  const input = { id, state, roles, roleJson, locations, scans: scans.value, handed: handed.value }
  const planned = await regenPlan(io, input)
  if (options.dryRun) return regenReplyText(planned, id, null)
  const outcome = await regenApply(io, options.host, { locations, planned, handed: handed.value, setup })

  return regenReplyText(planned, id, outcome)
}
