import { describe, expect, test } from 'claude-code/testing'

import type {
  CadreState,
  Choice,
  CompiledScope,
  Facts,
  FrameworkId,
  GitPolicy,
  InstructionScan,
  InstructionTopic,
  KickoffContext,
  LaunchStart,
  MemoryItem,
  Plan,
  ProbeExpectation,
  RepoScan,
  ScopeContext,
  SkillRef,
} from '../types'
import {
  changedBeforeRunWarning,
  CONFLICT_OPTIONS,
  conflictQuestion,
  hunkFailureLine,
  IMPROVER_OPTIONS,
  improverArgv,
  improverBlockLines,
  improverContextLine,
  improverDismissedWarning,
  improverFailedNote,
  improverFailure,
  improverLine,
  improverNoChangeNote,
  improverQuestion,
  improverUnreadableNote,
  installedLine,
  installFailureText,
  instructionsRecordText,
  MARKETPLACE_ADD_ARGV,
  noHomeInstallText,
  otherChangesWarning,
  otherFilesLines,
  privateClaudeMdText,
  privateWriteProblem,
  PYTHON_VERSION_ARGV,
  uncheckedFilesWarning,
  UNGUARDED_RUN_REASON,
} from './apply'
import type { HunkRun } from './apply'
import {
  ASK_HEADERS,
  countedChip,
  NO_USABLE_ANSWER_REASON,
  PANE_TITLES,
  quotedLabels,
  refusalLine,
  withContext,
} from './ask'
import {
  ALL_ENV_OPTION,
  ALL_OPTION,
  CLAUDE_MD_PLUGIN,
  CLAUDE_SECURITY_PLUGIN,
  CLAUDE_SECURITY_SKILL,
  envQuestion,
  INFRA_MCP_SERVERS,
  INFRA_PLUGINS,
  INFRA_SKILLS,
  INFRA_TOOLS,
  INSTRUCTION_LABELS,
  MCP_ROLE_ROWS,
  mcpQuestion,
  memoryQuestion,
  MODEL_EFFORT_OPTIONS,
  NO_SKILL_PURPOSE,
  NONE_OPTION,
  ownSkillLines,
  PER_ROLE,
  SAME_FOR_ALL,
  SECURITY_GUIDANCE_PLUGIN,
  SECURITY_PLUGINS,
  SKILL_ROLE_ROWS,
  skillGroupQuestion,
  SKILLS_SYSTEM,
  skillUsesText,
} from './assign'
import { helpText, USAGE_LINES } from './command'
import { FRAMEWORK_IDS, SUPPORTED_IDS } from './core/framework-id'
import { UNNAMED_ROLE } from './core/kickoff-text'
import { cappedErrors, REPLY_ERRORS_INTRO } from './core/reply'
import { RESERVED_ROLE_IDS } from './core/role-id'
import { countedNoun, idsOrNone } from './core/text'
import {
  EPIC_BRANCH_PREFIX,
  EPIC_CANCELLED,
  EPIC_DONE_HEADER,
  EPIC_DONE_NO_DIALOG,
  EPIC_DONE_NO_LIST,
  EPIC_DONE_OPTIONS,
  EPIC_NO_PM,
  EPIC_NO_WORKTREE_LIST,
  EPIC_RECORD_FILE,
  EPIC_ROLES_HEADER,
  EPIC_UNKNOWN_CHECKOUT,
  epicAddFailedReply,
  epicBadKeyReply,
  epicBadNameReply,
  epicCreatedText,
  epicDoneProblems,
  epicDoneQuestion,
  epicDoneRefusal,
  epicExcludesFailedReply,
  epicKeptReply,
  epicKickoffText,
  epicListFailedReply,
  epicLockedReply,
  epicLockLiveReply,
  epicLockUnknownReply,
  epicManyBranchesReply,
  epicManyPmReply,
  epicManyWorktreesReply,
  epicNoRecordWarning,
  epicNotFoundReply,
  epicNotMainReply,
  epicOldLauncherReply,
  epicPathExistsReply,
  epicRecordText,
  epicRemovedText,
  epicRemoveFailedReply,
  epicRolesQuestion,
  epicStepFailedReply,
  epicUnlockFailedReply,
  epicWorktreeLauncherChangedLine,
  epicWorktreeLauncherLine,
  EXCLUDES_FILE,
  excludesText,
  globalExcludesWarning,
  mirrorLinkedParentWarning,
  mirrorUnhideableWarning,
  RUNTIME_EXCLUDE_LINE,
  WORKTREES_DIR,
  XDG_ARGV,
} from './epic'
import { FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY } from './facts'
import { DECISION_TYPES, REQUIRED_FIELDS, UNSUPPORTED_MARKERS } from './framework/contract'
import {
  GSD_ADAPTER,
  GSD_AUTONOMY,
  GSD_CONFIG_FILE,
  GSD_GATES,
  GSD_HOOK_NOTES,
  gsdKickoffText,
} from './framework/gsd/adapter'
import { NOT_SET_TEXT, UNKNOWN_CONFIG_TEXT } from './framework/gsd/hunks'
import { TOOL_SCRIPTS } from './framework/gsd/tools'
import { BUILTIN_ADAPTER, BUILTIN_GATES, builtinKickoffText } from './framework/none/adapter'
import { ADAPTERS } from './framework/registry'
import { SUPERPOWERS_ADAPTER, SUPERPOWERS_GATES, superpowersKickoffText } from './framework/superpowers/adapter'
import {
  cadreJsonText,
  GIT_TRACKING_UNKNOWN_WARNING,
  indexMdText,
  kickoffRoleLine,
  kickoffText,
  launcherText,
  mcpText,
  PROBE_PROMPT,
  roleClaudeMdText,
  roleJsonText,
  roleMdText,
  RUNTIME_KICKOFF_TEST,
  settingsText,
  untrackedPartsWarning,
} from './generate'
import { GIT_COMMON_DIR_ARGV } from './git/common-dir'
import { NOT_INTERACTIVE_REPLY } from './guards/repo'
import { ACCEPT_RECOMMENDATIONS } from './handout'
import {
  HISTORY_DISMISSED_REASON,
  HISTORY_OPTIONS,
  historyLines,
  historyQuestion,
  NO_HISTORY_NOTE,
  UNLISTED_HISTORY_NOTE,
} from './history'
import type { HistoryScan } from './history'
import {
  ADJUST_DISMISSED_REASON,
  ADJUST_OPTIONS,
  ADJUST_QUESTION,
  ADJUST_ROUNDS_NOTE,
  adjustContextLine,
  APPLIED_NONE_NOTE,
  appliedLines,
  ASSIGNMENT_DISMISSED_REASON,
  cancelledReply,
  cardLines,
  CLAUDE_JSON_CONTEXT,
  CLAUDE_JSON_OPTIONS,
  CLAUDE_JSON_QUESTION,
  CONFLICT_CONTEXT,
  CONFLICT_DISMISSED_REASON,
  CONSENT_DISMISSED_REASON,
  DESCRIBE_CANCELLED_REASON,
  DESCRIBE_CONTEXT,
  DESCRIBE_OPTIONS,
  DESCRIBE_QUESTION,
  DRY_RUN_NOTE,
  dryRunPrivateWarning,
  DURATION_DISMISSED_REASON,
  DURATION_OPTIONS,
  DURATION_QUESTION,
  durationContextLine,
  ENV_DISMISSED_REASON,
  envContextLine,
  FRAMEWORK_ALL_QUESTION,
  FRAMEWORK_DISMISSED_REASON,
  FRAMEWORK_LABELS,
  FRAMEWORK_QUESTION_PREFIX,
  frameworkRoleQuestion,
  GIT_POLICY_CONTEXT,
  GIT_POLICY_DISMISSED_REASON,
  GIT_POLICY_OPTIONS,
  GIT_POLICY_QUESTION,
  HUNK_DISMISSED_REASON,
  IGNORE_ALL_NOTE,
  IMPROVER_INSTALL_CONTEXT,
  IMPROVER_INSTALL_DISMISSED_REASON,
  IMPROVER_INSTALL_QUESTION,
  improverNotOfferedWarning,
  improverRunLine,
  INIT_CANCELLED,
  INIT_FILE_SYSTEM_ROOT_REPLY,
  INIT_HOME_ROOT_REPLY,
  INIT_ROOT_UNKNOWN_REPLY,
  initReplyText,
  INSTALL_OPTIONS,
  LAUNCH_DIR_CANCELLED_REASON,
  LAUNCH_DIR_CONTEXT,
  LAUNCH_DIR_OPTIONS,
  LAUNCH_DIR_QUESTION,
  LAUNCH_DIR_ROUNDS_REASON,
  LAUNCH_START_DISMISSED_REASON,
  LAUNCH_START_OPTIONS,
  LAUNCH_START_QUESTION,
  launchContextLine,
  launchLine,
  LINKED_MEMORIES_ROW,
  MANIFEST_SKIPPED_NOTE,
  mcpContextLine,
  MEMORY_DISMISSED_REASON,
  memoryContextLine,
  memoryDroppedLine,
  MODEL_DISMISSED_REASON,
  MODEL_EFFORT_CONTEXT,
  MODEL_MODE_QUESTION,
  NEXT_STEP_NOTE,
  notHandedOutWarning,
  OWN_SKILLS_ENTRY_OPTIONS,
  ownSkillContextLine,
  ownSkillHeader,
  ownSkillQuestion,
  ownSkillsContextLine,
  ownSkillsQuestion,
  partDroppedLine,
  policyLine,
  PRIVATE_FILES_HEADING,
  privateFilesRow,
  privateFoldersUnknownWarning,
  proposalLines,
  REGEN_BAD_MANIFEST,
  REGEN_CANCELLED,
  REGEN_DISMISSED_REASON,
  REGEN_ITEM_OPTIONS,
  REGEN_NO_MANIFEST,
  regenCancelledReply,
  regenHeader,
  regenMemoryContextLine,
  regenMemoryQuestion,
  regenPartContextLine,
  regenPartQuestion,
  regenTotalWarning,
  REVIEW_DISMISSED_REASON,
  REVIEW_OPTIONS,
  REVIEW_QUESTION,
  REVIEW_ROUNDS_REASON,
  REVIEW_TYPE_HINT,
  reviewContextLine,
  reviewQuestion,
  ROLE_ROUNDS_REASON,
  ROLES_DISMISSED_REASON,
  ROLES_OPTIONS,
  ROLES_QUESTION,
  rolesContextLine,
  runInit,
  scanContextLine,
  scanSummaryLines,
  scanWarningLines,
  SECURITY_INSTALL_CONTEXT,
  SECURITY_INSTALL_DISMISSED_REASON,
  SECURITY_INSTALL_PREFIX,
  securityInstallQuestion,
  skillsContextLine,
  teamContextLine,
  truncatedLine,
  unusableRecordWarning,
} from './init'
import type { ApplyOutcome } from './init'
import {
  CONTENT_DISMISSED_REASON,
  CONTENT_OPTIONS,
  CONTENT_QUESTION,
  configFileWarning,
  contentContextLine,
  entryContextLine,
  fallbackTopics,
  HANDOUT_DISMISSED_REASON,
  INSTRUCTIONS_ENTRY_OPTIONS,
  INSTRUCTIONS_ENTRY_QUESTION,
  instructionLines,
  instructionReviewLines,
  instructionsEntry,
  MEMORY_INDEX_FILE,
  MEMORY_UNLISTED_WARNING,
  memoryItemContextLine,
  memoryItemHeader,
  memoryItemQuestion,
  memoryItems,
  memoryOverSizeWarning,
  moreDocsWarning,
  morePartsWarning,
  outsideWarning,
  overSizeWarning,
  NO_MEMORY_SUMMARY,
  RECOMMEND_SYSTEM,
  REGEN_RECOMMEND_SYSTEM,
  repoImportWarning,
  RULES_UNLISTED_WARNING,
  topicContextLine,
  topicHeader,
  topicItems,
  topicQuestion,
  TOPICS_SYSTEM,
  totalCapWarning,
  unfollowedImportWarning,
  unreadableWarning,
} from './instructions'
import {
  RUNTIME_SETTINGS_KEYS,
  UNDENIED_MEMORY_FOLDER_WARNING,
  UNDENIED_PRIVATE_WARNING,
  UNDENIED_RECORD_WARNING,
  undeniedMemoryWarning,
  unsafeMemoryNameWarning,
} from './launch'
import {
  HOME_UNUSABLE_WARNING,
  INBOX_FILE,
  INSTRUCTIONS_RECORD_FILE,
  PRIVATE_INSTRUCTIONS_FOLDER,
  PROBE_EXPECTATIONS_FILE,
  RUNTIME_KICKOFF_FILE,
  RUNTIME_RENDERED,
  RUNTIME_STAMP_FILE,
} from './paths'
import {
  gitignoreLines,
  HUNK_FILES,
  IGNORE_BEGIN,
  IGNORE_END,
  ignoreLines,
  MANIFEST_PATH,
  planSummary,
  SECURITY_REPORTS_LINE,
} from './plan'
import { PROBE_CHECK_KINDS, probeExpectationsText } from './probe'
import { hunkQuestion, INSTALL_COMMANDS, recommend, recommendationLines } from './recommend'
import { TOP_OF_FILE } from './records'
import {
  adaptersReportLines,
  choiceLine,
  detectReportLines,
  detectText,
  diffLines,
  lineDiff,
  STATUS_LABEL,
} from './render'
import {
  chainLines,
  CUSTOM_PURPOSE,
  DECISION_OWNERS,
  DEFAULT_DURATION,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  DEFAULT_PERMISSION_MODE,
  EFFORTS,
  HUMAN_FALLBACK,
  MODEL_ALIASES,
  NO_FRONTEND_REASON,
  NO_SOURCE_REASON,
  NO_TESTS_REASON,
  PROPOSE_SYSTEM,
  proposeRoles,
  ROLE_TEMPLATE,
} from './roles'
import { SOURCE_ORDER } from './scan/facts/settings'
import { MANIFEST_FILES, MARKER_ROWS, SOURCE_EXTENSIONS } from './scan/markers'
import { SKIP_DIRS } from './scan/walk'
import { compileScope, MEMORY_PATTERN, scopeCardLines, SECRET_READ_DENY } from './scope'
import {
  COPIED_LINE,
  MEMORY_BLOCK_BEGIN,
  MEMORY_BLOCK_END,
  memoryBlockText,
  memoryChangedWarning,
  memoryGoneWarning,
  memoryIndexLinkWarning,
  NOT_COPIED_LINE,
  openMemoryBlockWarning,
  privateFolderRefusal,
  privateLinkRefusal,
  runtimeMcpText,
  STALE_LINK_FOLDERS,
  stampText,
  START_NO_CLAUDE,
  START_NO_GIT_DIR,
  START_NO_HOME,
  START_NO_MANIFEST,
  TERMINAL_MAC_ONLY,
  unreadableMemoryIndexWarning,
  unreadableRecordWarning,
} from './start'
import { statusReportText } from './status'
import type { StatusReport } from './status'
import { MCP_ROUTE, REGEN_BAD_STATE, REGEN_NO_STATE } from './team'
import { EMPTY_FACTS, emptySetupScan, entry, INIT_ANSWERS, memIo, memWorld, templateRole } from './testkit'
import type { MemRun, MemWorld } from './testkit'

/** What user text may never hold: the name of an internal planning phase, such as `Phase 3.1` (G-02-3b). */
const PHASE_NAME = /Phase \d/

/** How many arrays and plain objects deep the walk reads a value: a string four levels down is still read. */
const MAX_DEPTH = 4

/** Whether a value is a plain object: an object literal or a frozen one, never an array, a map or a class instance. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * Every string a value holds: the value itself when it is a string, else each string in its arrays and plain objects,
 * down to MAX_DEPTH levels. Numbers, booleans, functions, patterns and maps hold none.
 */
function stringsOf(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value]
  if (depth === MAX_DEPTH) return []
  if (Array.isArray(value)) return value.flatMap(item => stringsOf(item, depth + 1))
  if (!isPlainObject(value)) return []

  return Object.values(value).flatMap(item => stringsOf(item, depth + 1))
}

/** The template team: one role of each template id, in template order. */
const TEAM = ROLE_TEMPLATE.map(row => templateRole(row.id))

/** A BE role with an MCP server and a skill, so its files and questions name both. */
const BE = templateRole('be', { mcp: ['jira'], skills: ['codex:rescue'] })

/** A setup scan that found nothing. */
const SETUP = emptySetupScan()

/** What a role's scope is compiled with: GSD, attended, started in a folder, in the template team. */
const CONTEXT: ScopeContext = {
  framework: 'gsd',
  setup: SETUP,
  codeDirs: ['src'],
  isAttended: true,
  mcpRoute: 'merged',
  launchStart: { kind: 'dir', path: 'apps/web' },
  roles: TEAM,
}

const BE_SCOPE = compileScope(BE, CONTEXT)

const SCOPES: ReadonlyMap<string, CompiledScope> = new Map(
  TEAM.map((role): [string, CompiledScope] => [role.id, compileScope(role, CONTEXT)]),
)

/** A repo scan with a finding, a language, a code folder, a warning, and a deeper folder listed only in part. */
const REPO: RepoScan = {
  findings: [{ kind: 'fe', label: 'react', evidence: 'package.json' }],
  languages: ['TypeScript'],
  codeDirs: ['src'],
  hasSource: true,
  cappedFolders: ['src/generated'],
  isOverallCapped: false,
  cadre: { dir: 'absent', manifest: null, manifestState: 'absent', state: null, stateState: 'absent' },
  warnings: ['could not read package.json (treated as unknown)'],
}

/**
 * A trainual-like Rails repo scan (02-UAT test 1, D-137): Rails from the Gemfile, react, RSpec and system specs found,
 * and two deeper folders listed only in part.
 */
const RAILS_REPO: RepoScan = {
  findings: [
    { kind: 'be', label: 'rails', evidence: 'Gemfile' },
    { kind: 'e2e', label: 'Rails system specs', evidence: 'spec/system' },
    { kind: 'fe', label: 'react', evidence: 'package.json' },
    { kind: 'test', label: 'RSpec config', evidence: '.rspec' },
  ],
  languages: ['JavaScript', 'Ruby'],
  codeDirs: ['app', 'spec'],
  hasSource: true,
  cappedFolders: ['app/models', 'app/views'],
  isOverallCapped: false,
  cadre: { dir: 'absent', manifest: null, manifestState: 'absent', state: null, stateState: 'absent' },
  warnings: [],
}

const PROPOSAL = proposeRoles(REPO)

/** A history scan with a name, a partial read and both kinds of skipped session. */
const HISTORY: HistoryScan = {
  counts: [{ name: 'gsd-plan-phase', count: 2 }],
  scanned: 1,
  total: 3,
  skippedLarge: 1,
  skippedUnknown: 1,
  isPartial: true,
}

const STATE: CadreState = {
  schema: 1,
  cadreVersion: '0.2.0',
  framework: 'gsd',
  gitPolicy: 'ignore',
  roles: ['be'],
  launchStart: { kind: 'git-root' },
  readUserMcp: false,
}

const HUNK_RUN: HunkRun = {
  key: 'mode',
  file: '.planning/config.json',
  argv: ['node', 'gsd-tools.cjs', 'config-set', 'mode', 'yolo'],
  display: 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
}

/** The built CLAUDE.md of BE as the improver texts name it (G-02-1f, D-141). */
const BUILT_PATH = '.cadre/be/CLAUDE.md'

/** A diff of a built role file: one line reworded and one line added (D-141). */
const DIFF = lineDiff('# Rules\nRun the tests.\n', '# Rules\nRun the tests first.\nKeep commits small.\n')

/** Why an improver run failed, each kind once: it timed out, it exited non-zero, it could not start (D-141). */
const FAILURES: readonly string[] = [
  improverFailure(null, 300_000),
  improverFailure({ exitCode: 2, stdout: '', stderr: '' }, 0),
  improverFailure(null, 0),
].flatMap(reason => (reason === null ? [] : [reason]))

/** Other files an improver run changed beside BE's built CLAUDE.md, as the pass shows them (D-141). */
const OTHERS: readonly string[] = [
  '.cadre/be/ROLE.md',
  '.cadre/be/notes.md',
  '.cadre/be/role.json',
  '.cadre/be/x.md',
]

/**
 * An apply that wrote, failed, refused, missed a chmod, failed a hunk, installed a plugin, skipped the manifest, and
 * ran the improver with one question dismissed and one other file changed.
 */
const OUTCOME: ApplyOutcome = {
  written: ['.cadre/bin/be', '.gitignore'],
  executable: ['.cadre/bin/be'],
  failed: ['.cadre/be/ROLE.md'],
  refused: ['.cadre/be/role.json'],
  notExecutable: ['.cadre/bin/qa'],
  chmodRefusals: ['.cadre/bin/pm'],
  hunkFailures: [HUNK_RUN],
  attended: ['be'],
  installed: [CLAUDE_SECURITY_PLUGIN],
  installProblems: [installFailureText(SECURITY_GUIDANCE_PLUGIN, true)],
  untrackedParts: [],
  privateProblems: [privateFoldersUnknownWarning(['be'])],
  manifestSkipped: true,
  improverWarnings: [improverDismissedWarning(BUILT_PATH), otherChangesWarning('.cadre/be', OTHERS.slice(0, 1))],
  improved: { changed: 1, total: 2 },
}

const PLAN: Plan = { ops: [{ kind: 'create', path: '.cadre/bin/be', mode: 'exec', note: null }], warnings: [] }

/** The one auto-memory of PART_SCAN, with its MEMORY.md summary (G-02-1f Memories). */
const PART_MEMORY: MemoryItem = {
  id: 'M1',
  file: 'squad.md',
  folder: '/home/u/.claude/projects/-repo/memory',
  summary: 'Unsigned commits on per-phase branches.',
  hash: 'hash of squad.md',
}

/**
 * A read of a global CLAUDE.md with a Security section, text before it, one auto-memory and one read warning
 * (G-02-1f).
 */
const PART_SCAN: InstructionScan = {
  parts: [
    { id: 'P1', file: '~/.claude/CLAUDE.md', heading: '', source: 'global', text: 'Intro.\n', hash: 'hash of P1' },
    {
      id: 'P2',
      file: '~/.claude/CLAUDE.md',
      heading: 'Security',
      source: 'global',
      text: '# Security\nNo secrets.\n',
      hash: 'hash of P2',
    },
  ],
  files: ['~/.claude/CLAUDE.md'],
  memories: [PART_MEMORY],
  warnings: [unreadableWarning('CLAUDE.md')],
}

/** The one topic of PART_SCAN, as the model groups it. */
const PART_TOPIC: InstructionTopic = {
  id: 'T1',
  title: 'Security rules',
  summary: 'How secrets stay out of the repo.',
  partIds: ['P1', 'P2'],
}

/** The roles recommended for PART_TOPIC and PART_MEMORY. */
const PART_RECOMMENDED: ReadonlyMap<string, readonly string[]> = new Map([
  ['T1', ['security']],
  ['M1', ['tl']],
])

/** One of the user's own skills, with the purpose the engine gave it (G-02-1b, D-139). */
const RELEASE_NOTES: SkillRef = { name: 'release-notes', plugin: null, purpose: 'Write the release notes.' }

/** One of the user's own skills that the engine gave no description. */
const MY_SKILL: SkillRef = { name: 'my-skill', plugin: null }

/** The user's own skills of the own-skills texts: S1 release-notes and S2 my-skill. */
const OWN_SKILLS: readonly SkillRef[] = [RELEASE_NOTES, MY_SKILL]

/** The history counts of OWN_SKILLS: release-notes was used 3 times. */
const OWN_SKILL_USES: ReadonlyMap<string, number> = new Map([['release-notes', 3]])

/** The roles recommended for OWN_SKILLS: S1 to BE, S2 to no role. */
const OWN_SKILLS_RECOMMENDED: ReadonlyMap<string, readonly string[]> = new Map([
  ['S1', ['be']],
  ['S2', []],
])

const POLICIES: readonly GitPolicy[] = ['definitions', 'all', 'ignore']

const STARTS: readonly LaunchStart[] = [{ kind: 'git-root' }, { kind: 'here' }, { kind: 'dir', path: 'apps/web' }]

const KICKOFFS: readonly KickoffContext[] = [
  { title: 'BE', roleId: 'be', specPath: 'docs/spec.md' },
  { title: 'BE', roleId: 'be', specPath: null },
]

const CHOICES: readonly Choice[] = [
  { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use in this repo' },
  { kind: 'ambiguous', ids: ['gsd', 'superpowers'] },
  { kind: 'installed-only', ids: ['gsd'] },
  { kind: 'unsupported', ids: ['bmad'] },
  { kind: 'none' },
]

const PROBE: readonly ProbeExpectation[] = [
  { check: 'tool-absent', enforcement: 'hard', text: 'no Bash', token: 'Bash' },
]

const REPORTS: readonly StatusReport[] = [
  {
    id: 'be',
    state: 'running',
    sessionId: 's1',
    foundBy: 'title',
    lastLog: 'turn 3',
    handoff: 'thoughts/shared/handoffs/be/next.md',
    doneMarker: false,
  },
  { id: 'pm', state: 'unknown', sessionId: null, foundBy: null, lastLog: null, handoff: null, doneMarker: null },
]

/**
 * The worktree `/cadre epic PROJ-1 Add retry` makes in /repo, as the epic texts name it, with two links, one copy and
 * no warning.
 */
const EPIC_WORKTREE = {
  key: 'PROJ-1',
  title: 'Add retry',
  path: '/repo/.claude/worktrees/proj-1-add-retry',
  branch: 'epic/proj-1-add-retry',
  linked: 2,
  copied: 1,
  warnings: [],
}

/** The epic of EPIC_WORKTREE as its kickoffs name it, on a team whose TL is tl (D-158). */
const EPIC_KICKOFF = { key: EPIC_WORKTREE.key, title: EPIC_WORKTREE.title, tlId: 'tl' }

/** The branch of EPIC_WORKTREE and the base it was made from, as the reasons of /cadre epic done name them. */
const EPIC_DONE_NAMES = { branch: EPIC_WORKTREE.branch, base: 'main' }

/**
 * The checks of /cadre epic done on EPIC_WORKTREE, with every check failing in each of its ways across the three
 * entries, so each reason epicDoneProblems gives is in the table (D-169, D-171).
 */
const EPIC_DONE_CHECKS: readonly Parameters<typeof epicDoneProblems>[0][] = [
  { ...EPIC_DONE_NAMES, clean: 'dirty', merged: 'not-merged', running: ['be'], teamRead: true },
  { ...EPIC_DONE_NAMES, clean: 'unknown', merged: 'unknown', running: ['pm', 'be'], teamRead: true },
  { ...EPIC_DONE_NAMES, base: null, clean: 'clean', merged: 'no-record', running: [], teamRead: false },
]

/** Every reason of EPIC_DONE_CHECKS, in order, as the refusal and the --force question of epic done list them. */
const EPIC_DONE_REASONS: readonly string[] = EPIC_DONE_CHECKS.flatMap(epicDoneProblems)

const RECOMMENDATIONS = recommend({
  roles: TEAM,
  frameworks: TEAM.map((): FrameworkId => 'none'),
  scan: REPO,
  setup: SETUP,
})

/**
 * Every exported user text of the pure modules (G-02-3b), with the module it comes from: each exported string
 * constant, string list and table of strings, and what each exported question, line and text builder gives for a
 * simple input (helpText, detectText with and without the adapters view, and every `*Question`, `*Line`, `*Lines` and
 * `*Text` builder). Any plan that adds an exported user text adds it here, so the check below covers it. Left out:
 * register.tsx and testkit.ts, numbers and patterns, and the helpers that only compare, clean or parse a value they
 * are given (compareText, parseVersionText, visibleText, asciiLine, cleanKickoffText, probeText, reportText,
 * contextText and lastLogText), which add no text of their own.
 */
const TEXTS: readonly (readonly [string, string, unknown])[] = [
  ['adapters', 'ADAPTERS', ADAPTERS],
  ['apply', 'CONFLICT_OPTIONS', CONFLICT_OPTIONS],
  ['apply', 'PYTHON_VERSION_ARGV', PYTHON_VERSION_ARGV],
  ['apply', 'MARKETPLACE_ADD_ARGV', MARKETPLACE_ADD_ARGV],
  ['apply', 'conflictQuestion', conflictQuestion('.cadre/be/ROLE.md')],
  ['apply', 'hunkFailureLine', hunkFailureLine(HUNK_RUN)],
  ['apply', 'installFailureText', [false, true].map(isFailed => installFailureText(CLAUDE_SECURITY_PLUGIN, isFailed))],
  ['apply', 'installedLine', installedLine(SECURITY_PLUGINS)],
  ['apply', 'noHomeInstallText', noHomeInstallText(CLAUDE_SECURITY_PLUGIN)],
  ['apply', 'IMPROVER_OPTIONS', IMPROVER_OPTIONS],
  ['apply', 'improverArgv', improverArgv(`/repo/${BUILT_PATH}`)],
  ['apply', 'improverQuestion', improverQuestion(BUILT_PATH)],
  ['apply', 'improverContextLine', [improverContextLine(DIFF), improverContextLine(lineDiff('a\n', 'b\n'))]],
  ['apply', 'improverBlockLines', improverBlockLines(BUILT_PATH, DIFF)],
  ['apply', 'improverNoChangeNote', improverNoChangeNote(BUILT_PATH)],
  ['apply', 'improverFailure', FAILURES],
  ['apply', 'improverFailedNote', FAILURES.map(reason => improverFailedNote(BUILT_PATH, reason))],
  ['apply', 'improverUnreadableNote', improverUnreadableNote(BUILT_PATH)],
  ['apply', 'improverDismissedWarning', improverDismissedWarning(BUILT_PATH)],
  ['apply', 'improverLine', improverLine({ changed: 1, total: 2 })],
  [
    'apply',
    'otherChangesWarning',
    [otherChangesWarning('.cadre/be', OTHERS.slice(0, 1)), otherChangesWarning('.cadre/be', OTHERS)],
  ],
  ['apply', 'otherFilesLines', otherFilesLines('.cadre/be', OTHERS)],
  ['apply', 'uncheckedFilesWarning', [uncheckedFilesWarning(1, '.cadre/be'), uncheckedFilesWarning(7, '.cadre/be')]],
  ['apply', 'changedBeforeRunWarning', changedBeforeRunWarning(BUILT_PATH)],
  ['apply', 'UNGUARDED_RUN_REASON', UNGUARDED_RUN_REASON],
  ['apply', 'privateClaudeMdText', privateClaudeMdText(BE.id, 'repo', PART_SCAN.parts)],
  ['apply', 'instructionsRecordText', instructionsRecordText(PART_SCAN.parts, PART_SCAN.memories)],
  [
    'apply',
    'privateWriteProblem',
    privateWriteProblem('/home/u/.ssh/authorized_keys', {
      allowed: new Set(),
      stats: new Map(),
      listings: new Map(),
      locations: { home: '/home/u', root: '/repo', configDir: null },
    }),
  ],
  ['ask', 'NO_USABLE_ANSWER_REASON', NO_USABLE_ANSWER_REASON],
  ['ask', 'refusalLine', [refusalLine('both', 'GSD, none - a role runs one framework'), refusalLine(' ', 'x')]],
  ['ask', 'quotedLabels', quotedLabels(REVIEW_OPTIONS)],
  ['ask', 'ASK_HEADERS', ASK_HEADERS],
  ['ask', 'withContext', withContext(GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT)],
  ['ask', 'PANE_TITLES', PANE_TITLES],
  ['ask', 'countedChip', [countedChip('Topic', 1, 3), countedChip('Memory', 100, 200)]],
  ['assign', 'INFRA_PLUGINS', INFRA_PLUGINS],
  ['assign', 'INFRA_SKILLS', INFRA_SKILLS],
  ['assign', 'INFRA_TOOLS', INFRA_TOOLS],
  ['assign', 'INFRA_MCP_SERVERS', INFRA_MCP_SERVERS],
  ['assign', 'MCP_ROLE_ROWS', MCP_ROLE_ROWS],
  ['assign', 'SKILL_ROLE_ROWS', SKILL_ROLE_ROWS],
  ['assign', 'CLAUDE_SECURITY_PLUGIN', CLAUDE_SECURITY_PLUGIN],
  ['assign', 'SECURITY_GUIDANCE_PLUGIN', SECURITY_GUIDANCE_PLUGIN],
  ['assign', 'SECURITY_PLUGINS', SECURITY_PLUGINS],
  ['assign', 'CLAUDE_MD_PLUGIN', CLAUDE_MD_PLUGIN],
  ['assign', 'CLAUDE_SECURITY_SKILL', CLAUDE_SECURITY_SKILL],
  ['assign', 'NONE_OPTION', NONE_OPTION],
  ['assign', 'ALL_OPTION', ALL_OPTION],
  ['assign', 'MODEL_EFFORT_OPTIONS', MODEL_EFFORT_OPTIONS],
  ['assign', 'SAME_FOR_ALL', SAME_FOR_ALL],
  ['assign', 'PER_ROLE', PER_ROLE],
  ['assign', 'ALL_ENV_OPTION', ALL_ENV_OPTION],
  ['assign', 'INSTRUCTION_LABELS', INSTRUCTION_LABELS],
  ['assign', 'mcpQuestion', mcpQuestion('jira')],
  [
    'assign',
    'skillGroupQuestion',
    [
      skillGroupQuestion({ label: 'codex', plugin: 'codex', names: ['codex:rescue'] }, 3),
      skillGroupQuestion({ label: 'your own', plugin: null, names: ['my-skill'] }),
    ],
  ],
  ['assign', 'envQuestion', envQuestion(['API_KEY', 'JIRA_URL'])],
  [
    'assign',
    'memoryQuestion',
    [
      memoryQuestion('global-claude-md', ['CLAUDE.md']),
      memoryQuestion('auto-memory', ['MEMORY.md']),
      memoryQuestion('project-claude-md', ['<repo>/CLAUDE.md']),
    ],
  ],
  ['assign', 'NO_SKILL_PURPOSE', NO_SKILL_PURPOSE],
  ['assign', 'skillUsesText', [skillUsesText(1), skillUsesText(3)]],
  [
    'assign',
    'ownSkillLines',
    [
      ownSkillLines(OWN_SKILLS, OWN_SKILL_USES, OWN_SKILLS_RECOMMENDED),
      ownSkillLines(OWN_SKILLS, new Map(), new Map()),
    ],
  ],
  ['assign', 'SKILLS_SYSTEM', SKILLS_SYSTEM],
  ['builtin', 'BUILTIN_GATES', BUILTIN_GATES],
  ['builtin', 'BUILTIN_ADAPTER', BUILTIN_ADAPTER],
  ['builtin', 'builtinKickoffText', KICKOFFS.map(builtinKickoffText)],
  ['command', 'RESERVED_ROLE_IDS', RESERVED_ROLE_IDS],
  ['command', 'USAGE_LINES', USAGE_LINES],
  ['command', 'helpText', [helpText(null), helpText('bogus')]],
  ['epic', 'WORKTREES_DIR', WORKTREES_DIR],
  ['epic', 'EPIC_BRANCH_PREFIX', EPIC_BRANCH_PREFIX],
  ['epic', 'epicBadKeyReply', epicBadKeyReply('../x')],
  ['epic', 'epicBadNameReply', epicBadNameReply('proj-1-Old')],
  ['epic', 'epicAddFailedReply', [true, false].map(isNew => epicAddFailedReply(EPIC_WORKTREE.branch, isNew))],
  [
    'epic',
    'epicCreatedText',
    [
      epicCreatedText({ ...EPIC_WORKTREE, outcome: 'created' }),
      epicCreatedText({ ...EPIC_WORKTREE, title: '', outcome: 'reused' }),
      epicCreatedText({ ...EPIC_WORKTREE, outcome: 're-added', warnings: ['a warning'] }),
    ],
  ],
  ['epic', 'EPIC_UNKNOWN_CHECKOUT', EPIC_UNKNOWN_CHECKOUT],
  ['epic', 'epicNotMainReply', [epicNotMainReply('/repo'), epicNotMainReply(null)]],
  ['epic', 'EPIC_NO_PM', EPIC_NO_PM],
  ['epic', 'epicManyPmReply', epicManyPmReply(['pm-a', 'pm-b'])],
  ['epic', 'EPIC_NO_WORKTREE_LIST', EPIC_NO_WORKTREE_LIST],
  ['epic', 'epicManyWorktreesReply', epicManyWorktreesReply(['/w/a', '/w/b'])],
  ['epic', 'epicManyBranchesReply', epicManyBranchesReply(['epic/proj-1-a', 'epic/proj-1-b'])],
  ['epic', 'epicPathExistsReply', epicPathExistsReply(EPIC_WORKTREE.path)],
  ['epic', 'EPIC_RECORD_FILE', EPIC_RECORD_FILE],
  ['epic', 'epicNoRecordWarning', epicNoRecordWarning(EPIC_WORKTREE.key)],
  ['epic', 'mirrorUnhideableWarning', mirrorUnhideableWarning('a\n*')],
  ['epic', 'EXCLUDES_FILE', EXCLUDES_FILE],
  ['epic', 'RUNTIME_EXCLUDE_LINE', RUNTIME_EXCLUDE_LINE],
  ['epic', 'excludesText', [excludesText('*.log\n', ['node_modules']), excludesText('', [])]],
  ['epic', 'epicListFailedReply', epicListFailedReply(EPIC_WORKTREE.key)],
  ['epic', 'epicExcludesFailedReply', epicExcludesFailedReply(EPIC_WORKTREE.key)],
  ['epic', 'epicStepFailedReply', epicStepFailedReply('node_modules')],
  ['epic', 'mirrorLinkedParentWarning', mirrorLinkedParentWarning('vendor/cache')],
  ['epic', 'XDG_ARGV', XDG_ARGV],
  ['epic', 'globalExcludesWarning', globalExcludesWarning('/home/u/.gitignore_global')],
  [
    'epic',
    'epicKickoffText',
    [
      epicKickoffText({ ...EPIC_KICKOFF, role: templateRole('pm'), isPm: true, parent: null }),
      epicKickoffText({ ...EPIC_KICKOFF, role: BE, isPm: false, parent: 'tl' }),
    ],
  ],
  ['epic', 'epicOldLauncherReply', [epicOldLauncherReply(['be']), epicOldLauncherReply(['pm', 'be'])]],
  ['epic', 'epicWorktreeLauncherLine', epicWorktreeLauncherLine('be')],
  ['epic', 'epicWorktreeLauncherChangedLine', epicWorktreeLauncherChangedLine('be')],
  ['epic', 'EPIC_ROLES_HEADER', EPIC_ROLES_HEADER],
  ['epic', 'epicRolesQuestion', epicRolesQuestion(3)],
  ['epic', 'EPIC_CANCELLED', EPIC_CANCELLED],
  ['epic', 'EPIC_DONE_NO_LIST', EPIC_DONE_NO_LIST],
  ['epic', 'epicNotFoundReply', epicNotFoundReply(EPIC_WORKTREE.key)],
  ['epic', 'epicRemovedText', epicRemovedText(EPIC_WORKTREE.key, EPIC_WORKTREE.path, EPIC_WORKTREE.branch)],
  ['epic', 'epicRemoveFailedReply', epicRemoveFailedReply(EPIC_WORKTREE.key)],
  ['epic', 'epicDoneProblems', EPIC_DONE_CHECKS.map(epicDoneProblems)],
  ['epic', 'epicDoneRefusal', epicDoneRefusal(EPIC_WORKTREE.key, EPIC_DONE_REASONS)],
  ['epic', 'EPIC_DONE_HEADER', EPIC_DONE_HEADER],
  ['epic', 'EPIC_DONE_OPTIONS', EPIC_DONE_OPTIONS],
  [
    'epic',
    'epicDoneQuestion',
    [epicDoneQuestion(EPIC_WORKTREE.key, []), epicDoneQuestion(EPIC_WORKTREE.key, EPIC_DONE_REASONS)],
  ],
  ['epic', 'EPIC_DONE_NO_DIALOG', EPIC_DONE_NO_DIALOG],
  ['epic', 'epicKeptReply', epicKeptReply(EPIC_WORKTREE.key)],
  ['epic', 'epicLockedReply', [epicLockedReply('by hand'), epicLockedReply('')]],
  ['epic', 'epicLockLiveReply', epicLockLiveReply(42)],
  ['epic', 'epicLockUnknownReply', epicLockUnknownReply(42)],
  ['epic', 'epicUnlockFailedReply', epicUnlockFailedReply(42)],
  [
    'epic',
    'epicRecordText',
    epicRecordText({
      schema: 1,
      key: EPIC_WORKTREE.key,
      slug: 'proj-1-add-retry',
      title: EPIC_WORKTREE.title,
      branch: EPIC_WORKTREE.branch,
      base: 'main',
      createdAt: 1,
      links: [],
      copies: [],
    }),
  ],
  ['facts', 'SOURCE_ORDER', SOURCE_ORDER],
  ['facts', 'HOME_ROOT_REPLY', HOME_ROOT_REPLY],
  ['facts', 'FILE_SYSTEM_ROOT_REPLY', FILE_SYSTEM_ROOT_REPLY],
  ['facts', 'HOME_UNUSABLE_WARNING', HOME_UNUSABLE_WARNING],
  ['facts', 'idsOrNone', [idsOrNone([]), idsOrNone(['be', 'qa'])]],
  ['facts', 'countedNoun', [countedNoun(1, 'file', 'files'), countedNoun(2, 'file', 'files')]],
  ['framework', 'DECISION_TYPES', DECISION_TYPES],
  ['framework', 'UNSUPPORTED_MARKERS', UNSUPPORTED_MARKERS],
  ['framework', 'SUPPORTED_IDS', SUPPORTED_IDS],
  ['framework', 'FRAMEWORK_IDS', FRAMEWORK_IDS],
  ['framework', 'REQUIRED_FIELDS', REQUIRED_FIELDS],
  ['generate', 'PROBE_PROMPT', PROBE_PROMPT],
  ['generate', 'kickoffRoleLine', FRAMEWORK_IDS.map(framework => kickoffRoleLine(BE, framework))],
  ['generate', 'kickoffText', FRAMEWORK_IDS.map(framework => kickoffText(BE, framework))],
  ['generate', 'roleJsonText', roleJsonText(BE)],
  ['generate', 'settingsText', settingsText(BE_SCOPE)],
  ['generate', 'mcpText', mcpText(BE_SCOPE)],
  ['generate', 'roleMdText', roleMdText(BE, BE_SCOPE)],
  ['generate', 'roleClaudeMdText', roleClaudeMdText(BE.id, PART_SCAN.parts)],
  ['generate', 'untrackedPartsWarning', untrackedPartsWarning('notes/local.md')],
  ['generate', 'GIT_TRACKING_UNKNOWN_WARNING', GIT_TRACKING_UNKNOWN_WARNING],
  ['generate', 'launcherText', STARTS.map(start => launcherText(BE, BE_SCOPE, start))],
  ['generate', 'RUNTIME_KICKOFF_TEST', RUNTIME_KICKOFF_TEST],
  ['generate', 'indexMdText', indexMdText(TEAM, SCOPES)],
  ['generate', 'cadreJsonText', cadreJsonText(STATE)],
  ['gsd', 'GSD_HOOK_NOTES', GSD_HOOK_NOTES],
  ['gsd', 'GSD_GATES', GSD_GATES],
  ['gsd', 'GSD_CONFIG_FILE', GSD_CONFIG_FILE],
  ['gsd', 'GSD_AUTONOMY', GSD_AUTONOMY],
  ['gsd', 'GSD_ADAPTER', GSD_ADAPTER],
  ['gsd', 'gsdKickoffText', KICKOFFS.map(gsdKickoffText)],
  ['handout', 'ACCEPT_RECOMMENDATIONS', ACCEPT_RECOMMENDATIONS],
  ['history', 'NO_HISTORY_NOTE', NO_HISTORY_NOTE],
  ['history', 'UNLISTED_HISTORY_NOTE', UNLISTED_HISTORY_NOTE],
  ['history', 'HISTORY_DISMISSED_REASON', HISTORY_DISMISSED_REASON],
  ['history', 'HISTORY_OPTIONS', HISTORY_OPTIONS],
  ['history', 'historyQuestion', [12, 51].map(historyQuestion)],
  ['history', 'historyLines', historyLines(HISTORY)],
  ['init', 'NOT_INTERACTIVE_REPLY', NOT_INTERACTIVE_REPLY],
  ['init', 'INIT_ROOT_UNKNOWN_REPLY', INIT_ROOT_UNKNOWN_REPLY],
  ['init', 'INIT_HOME_ROOT_REPLY', INIT_HOME_ROOT_REPLY],
  ['init', 'INIT_FILE_SYSTEM_ROOT_REPLY', INIT_FILE_SYSTEM_ROOT_REPLY],
  ['init', 'INIT_CANCELLED', INIT_CANCELLED],
  ['init', 'cancelledReply', cancelledReply(NO_USABLE_ANSWER_REASON)],
  ['init', 'teamContextLine', teamContextLine(TEAM)],
  ['init', 'GIT_POLICY_CONTEXT', GIT_POLICY_CONTEXT],
  ['init', 'CLAUDE_JSON_CONTEXT', CLAUDE_JSON_CONTEXT],
  ['init', 'scanContextLine', scanContextLine(REPO)],
  ['init', 'rolesContextLine', [rolesContextLine(PROPOSAL.roles, PROPOSAL.changes), rolesContextLine(TEAM, [])]],
  ['init', 'DESCRIBE_CONTEXT', DESCRIBE_CONTEXT],
  ['init', 'adjustContextLine', adjustContextLine(TEAM)],
  ['init', 'SECURITY_INSTALL_CONTEXT', SECURITY_INSTALL_CONTEXT],
  ['init', 'durationContextLine', durationContextLine(TEAM)],
  ['init', 'MODEL_EFFORT_CONTEXT', MODEL_EFFORT_CONTEXT],
  ['init', 'mcpContextLine', mcpContextLine(TEAM)],
  ['init', 'skillsContextLine', skillsContextLine(TEAM)],
  ['init', 'memoryContextLine', memoryContextLine(TEAM)],
  ['init', 'envContextLine', envContextLine(TEAM)],
  ['init', 'launchContextLine', launchContextLine(TEAM)],
  ['init', 'LAUNCH_DIR_CONTEXT', LAUNCH_DIR_CONTEXT],
  ['init', 'reviewContextLine', STARTS.map(start => reviewContextLine(PLAN, 'definitions', start))],
  ['init', 'CONFLICT_CONTEXT', CONFLICT_CONTEXT],
  ['init', 'DRY_RUN_NOTE', DRY_RUN_NOTE],
  ['init', 'APPLIED_NONE_NOTE', APPLIED_NONE_NOTE],
  ['init', 'NEXT_STEP_NOTE', NEXT_STEP_NOTE],
  ['init', 'MANIFEST_SKIPPED_NOTE', MANIFEST_SKIPPED_NOTE],
  ['init', 'privateFoldersUnknownWarning', privateFoldersUnknownWarning(['be', 'security'])],
  ['init', 'LINKED_MEMORIES_ROW', LINKED_MEMORIES_ROW],
  ['init', 'privateFilesRow', privateFilesRow(BE.id)],
  ['init', 'PRIVATE_FILES_HEADING', PRIVATE_FILES_HEADING],
  ['init', 'improverRunLine', [improverRunLine(1), improverRunLine(2)]],
  ['init', 'IGNORE_ALL_NOTE', IGNORE_ALL_NOTE],
  ['init', 'GIT_POLICY_QUESTION', GIT_POLICY_QUESTION],
  ['init', 'GIT_POLICY_OPTIONS', GIT_POLICY_OPTIONS],
  ['init', 'GIT_POLICY_DISMISSED_REASON', GIT_POLICY_DISMISSED_REASON],
  ['init', 'CLAUDE_JSON_QUESTION', CLAUDE_JSON_QUESTION],
  ['init', 'CLAUDE_JSON_OPTIONS', CLAUDE_JSON_OPTIONS],
  ['init', 'CONSENT_DISMISSED_REASON', CONSENT_DISMISSED_REASON],
  ['init', 'ROLES_QUESTION', ROLES_QUESTION],
  ['init', 'ROLES_OPTIONS', ROLES_OPTIONS],
  ['init', 'DESCRIBE_QUESTION', DESCRIBE_QUESTION],
  ['init', 'DESCRIBE_OPTIONS', DESCRIBE_OPTIONS],
  ['init', 'ADJUST_QUESTION', ADJUST_QUESTION],
  ['init', 'ADJUST_OPTIONS', ADJUST_OPTIONS],
  ['init', 'ROLE_ROUNDS_REASON', ROLE_ROUNDS_REASON],
  ['init', 'ADJUST_ROUNDS_NOTE', ADJUST_ROUNDS_NOTE],
  ['init', 'ROLES_DISMISSED_REASON', ROLES_DISMISSED_REASON],
  ['init', 'ADJUST_DISMISSED_REASON', ADJUST_DISMISSED_REASON],
  ['init', 'DESCRIBE_CANCELLED_REASON', DESCRIBE_CANCELLED_REASON],
  ['init', 'FRAMEWORK_LABELS', FRAMEWORK_LABELS],
  ['init', 'FRAMEWORK_QUESTION_PREFIX', FRAMEWORK_QUESTION_PREFIX],
  ['init', 'FRAMEWORK_ALL_QUESTION', FRAMEWORK_ALL_QUESTION],
  ['init', 'FRAMEWORK_DISMISSED_REASON', FRAMEWORK_DISMISSED_REASON],
  ['init', 'SECURITY_INSTALL_PREFIX', SECURITY_INSTALL_PREFIX],
  ['init', 'INSTALL_OPTIONS', INSTALL_OPTIONS],
  ['init', 'SECURITY_INSTALL_DISMISSED_REASON', SECURITY_INSTALL_DISMISSED_REASON],
  ['init', 'IMPROVER_INSTALL_QUESTION', IMPROVER_INSTALL_QUESTION],
  ['init', 'IMPROVER_INSTALL_CONTEXT', IMPROVER_INSTALL_CONTEXT],
  ['init', 'IMPROVER_INSTALL_DISMISSED_REASON', IMPROVER_INSTALL_DISMISSED_REASON],
  ['init', 'DURATION_QUESTION', DURATION_QUESTION],
  ['init', 'DURATION_OPTIONS', DURATION_OPTIONS],
  ['init', 'DURATION_DISMISSED_REASON', DURATION_DISMISSED_REASON],
  ['init', 'MODEL_MODE_QUESTION', MODEL_MODE_QUESTION],
  ['init', 'MODEL_DISMISSED_REASON', MODEL_DISMISSED_REASON],
  ['init', 'ASSIGNMENT_DISMISSED_REASON', ASSIGNMENT_DISMISSED_REASON],
  ['init', 'MEMORY_DISMISSED_REASON', MEMORY_DISMISSED_REASON],
  ['init', 'ENV_DISMISSED_REASON', ENV_DISMISSED_REASON],
  ['init', 'HUNK_DISMISSED_REASON', HUNK_DISMISSED_REASON],
  ['init', 'LAUNCH_START_QUESTION', LAUNCH_START_QUESTION],
  ['init', 'LAUNCH_START_OPTIONS', LAUNCH_START_OPTIONS],
  ['init', 'LAUNCH_DIR_QUESTION', LAUNCH_DIR_QUESTION],
  ['init', 'LAUNCH_DIR_OPTIONS', LAUNCH_DIR_OPTIONS],
  ['init', 'LAUNCH_START_DISMISSED_REASON', LAUNCH_START_DISMISSED_REASON],
  ['init', 'LAUNCH_DIR_CANCELLED_REASON', LAUNCH_DIR_CANCELLED_REASON],
  ['init', 'LAUNCH_DIR_ROUNDS_REASON', LAUNCH_DIR_ROUNDS_REASON],
  ['init', 'MCP_ROUTE', MCP_ROUTE],
  ['init', 'REVIEW_QUESTION', REVIEW_QUESTION],
  ['init', 'REVIEW_OPTIONS', REVIEW_OPTIONS],
  ['init', 'REVIEW_DISMISSED_REASON', REVIEW_DISMISSED_REASON],
  ['init', 'REVIEW_ROUNDS_REASON', REVIEW_ROUNDS_REASON],
  ['init', 'REVIEW_TYPE_HINT', REVIEW_TYPE_HINT],
  ['init', 'reviewQuestion', [reviewQuestion(null), reviewQuestion('Roles: PM, Team Lead, Security.')]],
  ['init', 'CONFLICT_DISMISSED_REASON', CONFLICT_DISMISSED_REASON],
  ['init', 'REGEN_NO_STATE', REGEN_NO_STATE],
  ['init', 'REGEN_BAD_STATE', REGEN_BAD_STATE],
  ['init', 'REGEN_NO_MANIFEST', REGEN_NO_MANIFEST],
  ['init', 'REGEN_BAD_MANIFEST', REGEN_BAD_MANIFEST],
  ['init', 'REGEN_ITEM_OPTIONS', REGEN_ITEM_OPTIONS],
  ['init', 'REGEN_DISMISSED_REASON', REGEN_DISMISSED_REASON],
  ['init', 'REGEN_CANCELLED', REGEN_CANCELLED],
  ['init', 'regenCancelledReply', regenCancelledReply(REGEN_DISMISSED_REASON)],
  ['init', 'regenHeader', [regenHeader(1, 2), regenHeader(100, 200)]],
  ['init', 'regenPartQuestion', PART_SCAN.parts.map(part => regenPartQuestion(BE.id, part))],
  ['init', 'regenPartContextLine', [regenPartContextLine('new', false), regenPartContextLine('changed', true)]],
  ['init', 'regenMemoryQuestion', regenMemoryQuestion(BE.id, PART_MEMORY)],
  [
    'init',
    'regenMemoryContextLine',
    [regenMemoryContextLine(PART_MEMORY, 'changed', true), regenMemoryContextLine({ summary: '' }, 'changed', false)],
  ],
  ['init', 'partDroppedLine', PART_SCAN.parts.map(part => partDroppedLine(BE.id, part))],
  ['init', 'memoryDroppedLine', memoryDroppedLine(BE.id, PART_MEMORY)],
  ['init', 'notHandedOutWarning', [notHandedOutWarning(BE.id, 1), notHandedOutWarning(BE.id, 3)]],
  ['init', 'improverNotOfferedWarning', improverNotOfferedWarning(BE.id)],
  ['init', 'dryRunPrivateWarning', dryRunPrivateWarning(BE.id)],
  ['init', 'unusableRecordWarning', unusableRecordWarning(BE.id)],
  ['init', 'regenTotalWarning', regenTotalWarning(BE.id)],
  ['init', 'policyLine', POLICIES.map(policyLine)],
  ['init', 'scanSummaryLines', [scanSummaryLines(REPO, SETUP), scanSummaryLines(RAILS_REPO, SETUP)]],
  [
    'init',
    'truncatedLine',
    [REPO, RAILS_REPO].flatMap(repo => [truncatedLine(repo), truncatedLine({ ...repo, isOverallCapped: true })]),
  ],
  ['init', 'scanWarningLines', scanWarningLines(REPO.warnings)],
  ['init', 'proposalLines', proposalLines(PROPOSAL.roles, PROPOSAL.changes)],
  ['init', 'frameworkRoleQuestion', frameworkRoleQuestion(BE)],
  ['init', 'securityInstallQuestion', securityInstallQuestion(SECURITY_PLUGINS)],
  ['init', 'launchLine', STARTS.map(launchLine)],
  ['init', 'cardLines', cardLines(TEAM, SCOPES)],
  ['init', 'appliedLines', appliedLines(OUTCOME)],
  [
    'init',
    'initReplyText',
    [
      initReplyText(PLAN, 'ignore', { kind: 'dir', path: 'apps/web' }, OUTCOME),
      initReplyText(PLAN, 'all', { kind: 'git-root' }, null),
    ],
  ],
  ['init', 'OWN_SKILLS_ENTRY_OPTIONS', OWN_SKILLS_ENTRY_OPTIONS],
  ['init', 'ownSkillsQuestion', ownSkillsQuestion(2)],
  ['init', 'ownSkillsContextLine', [ownSkillsContextLine(1), ownSkillsContextLine(2)]],
  ['init', 'ownSkillQuestion', ownSkillQuestion(RELEASE_NOTES.name)],
  [
    'init',
    'ownSkillContextLine',
    [ownSkillContextLine(RELEASE_NOTES, 3, ['be']), ownSkillContextLine(MY_SKILL, 0, [])],
  ],
  ['init', 'ownSkillHeader', [ownSkillHeader(1, 2), ownSkillHeader(100, 200)]],
  ['instructions', 'CONTENT_QUESTION', CONTENT_QUESTION],
  ['instructions', 'CONTENT_OPTIONS', CONTENT_OPTIONS],
  ['instructions', 'CONTENT_DISMISSED_REASON', CONTENT_DISMISSED_REASON],
  [
    'instructions',
    'contentContextLine',
    [
      contentContextLine(SETUP, { rules: ['security.md'], hasAgentsMd: true }),
      contentContextLine(SETUP, { rules: null, hasAgentsMd: false }),
    ],
  ],
  ['instructions', 'INSTRUCTIONS_ENTRY_QUESTION', INSTRUCTIONS_ENTRY_QUESTION],
  ['instructions', 'INSTRUCTIONS_ENTRY_OPTIONS', INSTRUCTIONS_ENTRY_OPTIONS],
  ['instructions', 'entryContextLine', entryContextLine(PART_SCAN, [PART_TOPIC])],
  ['instructions', 'instructionsEntry', instructionsEntry(PART_SCAN, [PART_TOPIC])],
  ['instructions', 'HANDOUT_DISMISSED_REASON', HANDOUT_DISMISSED_REASON],
  ['instructions', 'topicQuestion', topicQuestion(PART_TOPIC)],
  ['instructions', 'topicContextLine', topicContextLine(PART_TOPIC, PART_SCAN.parts, ['security'])],
  ['instructions', 'topicHeader', [topicHeader(1, 2), topicHeader(100, 200)]],
  ['instructions', 'topicItems', topicItems(PART_SCAN, [PART_TOPIC], PART_RECOMMENDED)],
  ['instructions', 'NO_MEMORY_SUMMARY', NO_MEMORY_SUMMARY],
  ['instructions', 'memoryItemQuestion', memoryItemQuestion(PART_MEMORY)],
  ['instructions', 'memoryItemContextLine', memoryItemContextLine(PART_MEMORY, ['tl'])],
  ['instructions', 'memoryItemHeader', [memoryItemHeader(1, 2), memoryItemHeader(10, 100)]],
  ['instructions', 'memoryItems', memoryItems(PART_SCAN.memories, PART_RECOMMENDED)],
  ['instructions', 'unreadableWarning', unreadableWarning('CLAUDE.md')],
  ['instructions', 'overSizeWarning', overSizeWarning('CLAUDE.md')],
  ['instructions', 'memoryOverSizeWarning', memoryOverSizeWarning('big.md')],
  ['instructions', 'outsideWarning', outsideWarning('~/work/CLAUDE.md')],
  ['instructions', 'repoImportWarning', repoImportWarning('~/.claude/.credentials.json')],
  ['instructions', 'unfollowedImportWarning', unfollowedImportWarning('.env')],
  ['instructions', 'configFileWarning', configFileWarning('~/.claude/settings.json')],
  ['instructions', 'totalCapWarning', [totalCapWarning(1), totalCapWarning(3)]],
  ['instructions', 'morePartsWarning', morePartsWarning(6)],
  ['instructions', 'RULES_UNLISTED_WARNING', RULES_UNLISTED_WARNING],
  ['instructions', 'moreDocsWarning', moreDocsWarning(3)],
  ['instructions', 'MEMORY_UNLISTED_WARNING', MEMORY_UNLISTED_WARNING],
  ['instructions', 'TOP_OF_FILE', TOP_OF_FILE],
  ['instructions', 'TOPICS_SYSTEM', TOPICS_SYSTEM],
  ['instructions', 'RECOMMEND_SYSTEM', RECOMMEND_SYSTEM],
  ['instructions', 'REGEN_RECOMMEND_SYSTEM', REGEN_RECOMMEND_SYSTEM],
  ['instructions', 'MEMORY_INDEX_FILE', MEMORY_INDEX_FILE],
  ['instructions', 'fallbackTopics', fallbackTopics(PART_SCAN)],
  [
    'instructions',
    'instructionLines',
    [
      instructionLines(PART_SCAN, [PART_TOPIC], PART_RECOMMENDED),
      instructionLines(PART_SCAN, fallbackTopics(PART_SCAN), new Map()),
    ],
  ],
  [
    'instructions',
    'instructionReviewLines',
    instructionReviewLines(TEAM, [PART_TOPIC], PART_SCAN.memories, PART_RECOMMENDED),
  ],
  ['kickoff', 'UNNAMED_ROLE', UNNAMED_ROLE],
  ['launch', 'RUNTIME_SETTINGS_KEYS', RUNTIME_SETTINGS_KEYS],
  ['launch', 'unsafeMemoryNameWarning', unsafeMemoryNameWarning('../notes.md')],
  ['launch', 'PRIVATE_INSTRUCTIONS_FOLDER', PRIVATE_INSTRUCTIONS_FOLDER],
  ['launch', 'INSTRUCTIONS_RECORD_FILE', INSTRUCTIONS_RECORD_FILE],
  ['launch', 'undeniedMemoryWarning', undeniedMemoryWarning('my notes.md')],
  ['launch', 'UNDENIED_PRIVATE_WARNING', UNDENIED_PRIVATE_WARNING],
  ['launch', 'UNDENIED_MEMORY_FOLDER_WARNING', UNDENIED_MEMORY_FOLDER_WARNING],
  ['launch', 'UNDENIED_RECORD_WARNING', UNDENIED_RECORD_WARNING],
  ['plan', 'MANIFEST_PATH', MANIFEST_PATH],
  ['plan', 'IGNORE_BEGIN', IGNORE_BEGIN],
  ['plan', 'IGNORE_END', IGNORE_END],
  ['plan', 'RUNTIME_STAMP_FILE', RUNTIME_STAMP_FILE],
  ['plan', 'INBOX_FILE', INBOX_FILE],
  ['plan', 'RUNTIME_KICKOFF_FILE', RUNTIME_KICKOFF_FILE],
  ['plan', 'PROBE_EXPECTATIONS_FILE', PROBE_EXPECTATIONS_FILE],
  ['plan', 'RUNTIME_RENDERED', RUNTIME_RENDERED],
  ['plan', 'SECURITY_REPORTS_LINE', SECURITY_REPORTS_LINE],
  ['plan', 'HUNK_FILES', HUNK_FILES],
  ['plan', 'planSummary', planSummary(PLAN)],
  ['plan', 'ignoreLines', POLICIES.map(ignoreLines)],
  ['plan', 'gitignoreLines', gitignoreLines('definitions', null, true)],
  ['probe', 'PROBE_CHECK_KINDS', PROBE_CHECK_KINDS],
  ['probe', 'probeExpectationsText', probeExpectationsText(PROBE)],
  ['recommend', 'NOT_SET_TEXT', NOT_SET_TEXT],
  ['recommend', 'UNKNOWN_CONFIG_TEXT', UNKNOWN_CONFIG_TEXT],
  ['recommend', 'TOOL_SCRIPTS', TOOL_SCRIPTS],
  ['recommend', 'INSTALL_COMMANDS', INSTALL_COMMANDS],
  [
    'recommend',
    'hunkQuestion',
    GSD_AUTONOMY.map((proposal, at) => hunkQuestion({ proposal, before: NOT_SET_TEXT }, at + 1, GSD_AUTONOMY.length)),
  ],
  ['recommend', 'recommendationLines', [recommendationLines(RECOMMENDATIONS, TEAM), recommendationLines([], TEAM)]],
  ['render', 'STATUS_LABEL', STATUS_LABEL],
  ['render', 'choiceLine', CHOICES.map(choiceLine)],
  ['render', 'detectReportLines', detectReportLines(EMPTY_FACTS)],
  ['render', 'adaptersReportLines', adaptersReportLines(ADAPTERS)],
  ['render', 'detectText', [detectText(EMPTY_FACTS, true), detectText(EMPTY_FACTS, false)]],
  ['render', 'diffLines', diffLines(DIFF)],
  ['reply', 'REPLY_ERRORS_INTRO', REPLY_ERRORS_INTRO],
  ['reply', 'cappedErrors', cappedErrors(Array.from({ length: 21 }, (_, at) => `error ${at + 1}`))],
  ['roles', 'ROLE_TEMPLATE', ROLE_TEMPLATE],
  ['roles', 'DEFAULT_MODEL', DEFAULT_MODEL],
  ['roles', 'DEFAULT_EFFORT', DEFAULT_EFFORT],
  ['roles', 'DEFAULT_PERMISSION_MODE', DEFAULT_PERMISSION_MODE],
  ['roles', 'DEFAULT_DURATION', DEFAULT_DURATION],
  ['roles', 'HUMAN_FALLBACK', HUMAN_FALLBACK],
  ['roles', 'DECISION_OWNERS', DECISION_OWNERS],
  ['roles', 'NO_FRONTEND_REASON', NO_FRONTEND_REASON],
  ['roles', 'NO_TESTS_REASON', NO_TESTS_REASON],
  ['roles', 'NO_SOURCE_REASON', NO_SOURCE_REASON],
  ['roles', 'PROPOSE_SYSTEM', PROPOSE_SYSTEM],
  ['roles', 'CUSTOM_PURPOSE', CUSTOM_PURPOSE],
  ['roles', 'MODEL_ALIASES', MODEL_ALIASES],
  ['roles', 'EFFORTS', EFFORTS],
  ['roles', 'chainLines', chainLines(TEAM)],
  ['scan', 'SKIP_DIRS', SKIP_DIRS],
  ['scan', 'SOURCE_EXTENSIONS', SOURCE_EXTENSIONS],
  ['scan', 'MANIFEST_FILES', MANIFEST_FILES],
  ['scan', 'MARKER_ROWS', MARKER_ROWS],
  ['scope', 'SECRET_READ_DENY', SECRET_READ_DENY],
  ['scope', 'MEMORY_PATTERN', MEMORY_PATTERN],
  ['scope', 'scopeCardLines', scopeCardLines(BE_SCOPE.card)],
  ['start', 'STALE_LINK_FOLDERS', STALE_LINK_FOLDERS],
  ['start', 'GIT_COMMON_DIR_ARGV', GIT_COMMON_DIR_ARGV],
  ['start', 'START_NO_HOME', START_NO_HOME],
  ['start', 'START_NO_GIT_DIR', START_NO_GIT_DIR],
  ['start', 'START_NO_CLAUDE', START_NO_CLAUDE],
  ['start', 'START_NO_MANIFEST', START_NO_MANIFEST],
  ['start', 'COPIED_LINE', COPIED_LINE],
  ['start', 'NOT_COPIED_LINE', NOT_COPIED_LINE],
  ['start', 'TERMINAL_MAC_ONLY', TERMINAL_MAC_ONLY],
  ['start', 'privateLinkRefusal', privateLinkRefusal('be')],
  [
    'start',
    'privateFolderRefusal',
    [
      privateFolderRefusal('~/.claude/cadre', 'link'),
      privateFolderRefusal('~/.claude/cadre', 'not-folder'),
      privateFolderRefusal('~/.claude/cadre', 'unchecked'),
    ],
  ],
  ['start', 'stampText', stampText('0.2.0')],
  ['start', 'runtimeMcpText', [false, true].map(isRead => runtimeMcpText(BE, {}, ['/repo'], isRead))],
  ['start', 'MEMORY_BLOCK_BEGIN', MEMORY_BLOCK_BEGIN],
  ['start', 'MEMORY_BLOCK_END', MEMORY_BLOCK_END],
  ['start', 'memoryBlockText', [memoryBlockText(null, [PART_MEMORY]), memoryBlockText('# Index\n', [PART_MEMORY])]],
  ['start', 'memoryChangedWarning', memoryChangedWarning(PART_MEMORY.file, 'be')],
  ['start', 'memoryGoneWarning', memoryGoneWarning(PART_MEMORY.file)],
  ['start', 'openMemoryBlockWarning', openMemoryBlockWarning('be')],
  ['start', 'unreadableRecordWarning', unreadableRecordWarning('be')],
  ['start', 'unreadableMemoryIndexWarning', unreadableMemoryIndexWarning('be')],
  ['start', 'memoryIndexLinkWarning', memoryIndexLinkWarning('be')],
  ['status', 'statusReportText', REPORTS.map(statusReportText)],
  ['superpowers', 'SUPERPOWERS_GATES', SUPERPOWERS_GATES],
  ['superpowers', 'SUPERPOWERS_ADAPTER', SUPERPOWERS_ADAPTER],
  ['superpowers', 'superpowersKickoffText', KICKOFFS.map(superpowersKickoffText)],
]

/** A git repo at /repo, which init runs in; `over` changes the fields it names. */
function gitWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ dirs: { '/repo/.git': [] }, ...over })
}

/** The session folder of the fixture repo /repo for the fixture user /home/u. */
const HISTORY_DIR = '/home/u/.claude/projects/-repo'

/** A git repo at /repo with one session transcript, which runs /gsd-plan-phase. */
function historyWorld(): MemWorld {
  return gitWorld({
    dirs: { '/repo/.git': [], [HISTORY_DIR]: [{ ...entry('a.jsonl'), mtimeMs: 1 }] },
    files: { [`${HISTORY_DIR}/a.jsonl`]: '<command-name>/gsd-plan-phase</command-name>' },
  })
}

/** Facts with GSD (.planning/) and superpowers (docs/superpowers/) both in use, so the framework question is asked. */
const BOTH_IN_USE: Facts = {
  ...EMPTY_FACTS,
  repoEntries: [
    { name: '.planning', kind: 'dir', isLink: false },
    { name: 'docs', kind: 'dir', isLink: false },
  ],
  docsEntries: [{ name: 'superpowers', kind: 'dir', isLink: false }],
}

/** The model's roles for a typed description: BE (be) and Docs (docs), so the roles question is asked about them. */
const DESCRIBED_REPLY =
  '{"roles":[{"id":"be","title":"BE","purpose":"API","basedOn":"be"},' +
  '{"id":"docs","title":"Docs","purpose":"docs","basedOn":null}]}'

/** A line of each init text that is not exported, so not in TEXTS: the env pane heading and each refusal's accepts. */
const PRIVATE_FRAGMENTS: readonly string[] = [
  'Env variable names in your settings',
  "isn't one of: definitions, all, ignore",
  'a description of your roles',
  ' - a role runs one framework',
  'a duration such as 4h',
  'or role ids from: ',
  'or names from the list, typed exactly',
  '(or type git root, in here or other)',
  'or duration, model, assignments, memory, env, hunks',
]

/**
 * Every text a run put before the person: each question asked, each option and chip of its dialog, each logged line,
 * each side-pane title and line, and the reply.
 */
function runTexts(run: MemRun, reply: string): string[] {
  return [
    ...run.asked,
    ...run.specs.flatMap(spec => [...spec.options, ...(spec.header === undefined ? [] : [spec.header])]),
    ...run.logged,
    ...run.shown.flatMap(block => [block.title, ...block.lines]),
    reply,
  ]
}

describe('user text names no internal phase (G-02-3b)', () => {
  test('a phase name is the word Phase and a number, as in (Phase 3.1) or the Phase 2 repo scan', () => {
    const texts = ['(Phase 3.1)', 'the Phase 2 repo scan', 'phase 2', 'Phase two', 'Phases']
    expect(texts.map(text => PHASE_NAME.test(text))).toEqual([true, true, false, false, false])
  })

  test('the walk reads every string in arrays and plain objects, four levels down and no deeper', () => {
    expect(stringsOf({ a: 'x', b: [{ c: 'y' }], d: 3, e: null, f: () => 'z', g: /Phase 1/ })).toEqual(['x', 'y'])
    expect(stringsOf([[[['four']]]])).toEqual(['four'])
    expect(stringsOf([[[[['five']]]]])).toEqual([])
    expect(stringsOf(new Map([['k', 'v']]))).toEqual([])
  })

  test('every row of the table holds text the walk can read', () => {
    const empty = TEXTS.filter(([, , value]) => stringsOf(value).length === 0)
    expect(empty.map(([module, name]) => `${module} ${name}`)).toEqual([])
  })

  test('no exported user text names a phase', () => {
    const named = TEXTS.flatMap(([module, name, value]) =>
      stringsOf(value)
        .flatMap(text => text.split('\n'))
        .filter(line => PHASE_NAME.test(line))
        .map(line => `${module} ${name}: ${line}`),
    )
    expect(named).toEqual([])
  })

  test('a full dry run with the INIT_ANSWERS defaults asks, logs, shows and replies with no phase name', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const reply = await runInit(run.io, { dryRun: true })
    expect(run.shown.map(block => block.key)).toEqual(['scan', 'roles', 'recommendations', 'review'])
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(runTexts(run, reply).filter(text => PHASE_NAME.test(text))).toEqual([])
  })

  test('a dry run with the history question answered Yes, on a repo with one session, names no phase', async () => {
    const answers = { ...INIT_ANSWERS, "Scan this repo's session history": 'Yes, scan names and counts' }
    const run = memIo(historyWorld(), answers)
    const reply = await runInit(run.io, { dryRun: true })
    expect(run.shown.map(block => block.key)).toEqual(['scan', 'history', 'roles', 'recommendations', 'review'])
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(runTexts(run, reply).filter(text => PHASE_NAME.test(text))).toEqual([])
  })

  // The env pane heading and the refusal accepts are private to init.ts, so not in TEXTS: only a run reaches them.
  test('a dry run with one unreadable answer per kind of question names no phase in its private texts', async () => {
    const world = gitWorld({
      facts: { facts: BOTH_IN_USE, gsdUserDir: null },
      settings: { user: { env: { API_KEY: 'x' } }, project: {}, local: {} },
      tools: [{ name: 'mcp__sentry__issues', description: 'Sentry issues', mcp: true }],
      replies: [DESCRIBED_REPLY],
    })
    const answers = {
      ...INIT_ANSWERS,
      'Use these roles?': 'Describe my own structure',
      [withContext(ROLES_QUESTION, 'Proposed: BE (be)')]: 'Use these roles',
      'Describe your role structure': ' ',
      "An empty answer isn't one of": 'we have a BE and a docs writer',
      'Framework for': 'zz-framework',
      "'zz-framework' isn't one of": 'GSD',
      'Autopilot duration': 'zz-duration',
      "'zz-duration' isn't one of": '4h',
      'Which roles get': 'zz-assign',
      "'zz-assign' isn't one of": 'None',
      'Which env variables': 'zz-env',
      "'zz-env' isn't one of": 'None',
      'Git policy': 'zz-git',
      "'zz-git' isn't one of": 'Commit definitions (default)',
      'Where should the role launchers start': 'zz-launch',
      "'zz-launch' isn't one of": 'Git root of this repo',
      'Review the plan': 'zz-review',
      "'zz-review' isn't one of": 'Confirm',
    }
    const run = memIo(world, answers)
    const reply = await runInit(run.io, { dryRun: true })
    expect(run.shown.map(block => block.key)).toContain('env')
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(runTexts(run, reply).filter(text => PHASE_NAME.test(text))).toEqual([])
    const lines = runTexts(run, reply).flatMap(text => text.split('\n'))
    expect(PRIVATE_FRAGMENTS.filter(fragment => !lines.some(line => line.includes(fragment)))).toEqual([])
  })
})
