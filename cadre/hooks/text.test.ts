import { describe, expect, test } from 'claude-code/testing'

import type {
  CadreState,
  Choice,
  CompiledScope,
  FrameworkId,
  GitPolicy,
  KickoffContext,
  LaunchStart,
  Plan,
  ProbeExpectation,
  RepoScan,
  ScopeContext,
} from '../types'
import { ADAPTERS } from './adapters'
import {
  CONFLICT_OPTIONS,
  conflictQuestion,
  hunkFailureLine,
  installedLine,
  installFailureText,
  MARKETPLACE_ADD_ARGV,
  noHomeInstallText,
  PYTHON_VERSION_ARGV,
} from './apply'
import type { HunkRun } from './apply'
import {
  ALL_ENV_OPTION,
  ALL_OPTION,
  CLAUDE_SECURITY_PLUGIN,
  CLAUDE_SECURITY_SKILL,
  envQuestion,
  FRAMEWORK_START_SKILLS,
  INFRA_MCP_SERVERS,
  INFRA_PLUGINS,
  INFRA_SKILLS,
  INFRA_TOOLS,
  INSTRUCTION_LABELS,
  MCP_ROLE_ROWS,
  mcpQuestion,
  memoryQuestion,
  MODEL_EFFORT_OPTIONS,
  NONE_OPTION,
  PER_ROLE,
  SAME_FOR_ALL,
  SECURITY_GUIDANCE_PLUGIN,
  SECURITY_PLUGINS,
  SKILL_ROLE_ROWS,
  skillGroupQuestion,
} from './assign'
import { BUILTIN_ADAPTER, BUILTIN_GATES, builtinKickoffText } from './builtin'
import { helpText, RESERVED_ROLE_IDS, USAGE_LINES } from './command'
import { FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY, HOME_UNUSABLE_WARNING, SOURCE_ORDER } from './facts'
import { DECISION_TYPES, FRAMEWORK_IDS, REQUIRED_FIELDS, SUPPORTED_IDS, UNSUPPORTED_MARKERS } from './framework'
import {
  cadreJsonText,
  indexMdText,
  kickoffRoleLine,
  kickoffText,
  launcherText,
  mcpText,
  PROBE_PROMPT,
  roleJsonText,
  roleMdText,
  settingsText,
} from './generate'
import { GSD_ADAPTER, GSD_AUTONOMY, GSD_CONFIG_FILE, GSD_GATES, GSD_HOOK_NOTES, gsdKickoffText } from './gsd'
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
  APPLIED_NONE_NOTE,
  appliedLines,
  ASSIGNMENT_DISMISSED_REASON,
  cardLines,
  CLAUDE_JSON_OPTIONS,
  CLAUDE_JSON_QUESTION,
  CONFLICT_DISMISSED_REASON,
  CONSENT_DISMISSED_REASON,
  DESCRIBE_CANCELLED_REASON,
  DESCRIBE_OPTIONS,
  DESCRIBE_QUESTION,
  DRY_RUN_NOTE,
  DURATION_DISMISSED_REASON,
  DURATION_OPTIONS,
  DURATION_QUESTION,
  ENV_DISMISSED_REASON,
  FRAMEWORK_ALL_QUESTION,
  FRAMEWORK_DISMISSED_REASON,
  FRAMEWORK_LABELS,
  FRAMEWORK_QUESTION_PREFIX,
  frameworkRoleQuestion,
  GIT_POLICY_DISMISSED_REASON,
  GIT_POLICY_OPTIONS,
  GIT_POLICY_QUESTION,
  HUNK_DISMISSED_REASON,
  IGNORE_ALL_NOTE,
  INIT_CANCELLED,
  INIT_FILE_SYSTEM_ROOT_REPLY,
  INIT_HOME_ROOT_REPLY,
  INIT_ROOT_UNKNOWN_REPLY,
  initReplyText,
  LAUNCH_DIR_CANCELLED_REASON,
  LAUNCH_DIR_OPTIONS,
  LAUNCH_DIR_QUESTION,
  LAUNCH_DIR_ROUNDS_REASON,
  LAUNCH_START_DISMISSED_REASON,
  LAUNCH_START_OPTIONS,
  LAUNCH_START_QUESTION,
  launchLine,
  MANIFEST_SKIPPED_NOTE,
  MCP_ROUTE,
  MEMORY_DISMISSED_REASON,
  MODEL_DISMISSED_REASON,
  MODEL_MODE_QUESTION,
  NEXT_STEP_NOTE,
  NO_USABLE_ANSWER_REASON,
  NOT_INTERACTIVE_REPLY,
  PANE_TITLES,
  policyLine,
  proposalLines,
  quotedLabels,
  refusalLine,
  REGEN_BAD_MANIFEST,
  REGEN_BAD_STATE,
  REGEN_NO_MANIFEST,
  REGEN_NO_STATE,
  REVIEW_DISMISSED_REASON,
  REVIEW_OPTIONS,
  REVIEW_QUESTION,
  REVIEW_ROUNDS_REASON,
  REVIEW_TYPE_HINT,
  reviewQuestion,
  ROLE_ROUNDS_REASON,
  ROLES_DISMISSED_REASON,
  ROLES_OPTIONS,
  ROLES_QUESTION,
  runInit,
  scanSummaryLines,
  scanWarningLines,
  SECURITY_INSTALL_DISMISSED_REASON,
  SECURITY_INSTALL_OPTIONS,
  SECURITY_INSTALL_PREFIX,
  securityInstallQuestion,
} from './init'
import type { ApplyOutcome } from './init'
import { UNNAMED_ROLE } from './kickoff'
import { RUNTIME_SETTINGS_KEYS } from './launch'
import {
  gitignoreLines,
  HUNK_FILES,
  IGNORE_BEGIN,
  IGNORE_END,
  ignoreLines,
  INBOX_FILE,
  MANIFEST_PATH,
  PROBE_EXPECTATIONS_FILE,
  RUNTIME_RENDERED,
  RUNTIME_STAMP_FILE,
  SECURITY_REPORTS_LINE,
} from './plan'
import { PROBE_CHECK_KINDS, probeExpectationsText } from './probe'
import {
  hunkQuestion,
  INSTALL_COMMANDS,
  NOT_SET_TEXT,
  recommend,
  recommendationLines,
  TOOL_SCRIPTS,
  UNKNOWN_CONFIG_TEXT,
} from './recommend'
import { adaptersReportLines, choiceLine, detectReportLines, detectText, STATUS_LABEL } from './render'
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
import { MARKER_ROWS, SKIP_DIRS, SOURCE_EXTENSIONS } from './scan'
import { compileScope, MEMORY_PATTERN, scopeCardLines, SECRET_READ_DENY } from './scope'
import {
  COPIED_LINE,
  GIT_COMMON_DIR_ARGV,
  NOT_COPIED_LINE,
  runtimeMcpText,
  STALE_LINK_FOLDERS,
  stampText,
  START_NO_CLAUDE,
  START_NO_GIT_DIR,
  START_NO_HOME,
  START_NO_MANIFEST,
  TERMINAL_MAC_ONLY,
} from './start'
import { statusReportText } from './status'
import type { StatusReport } from './status'
import { SUPERPOWERS_ADAPTER, SUPERPOWERS_GATES, superpowersKickoffText } from './superpowers'
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

/** A repo scan with a finding, a language, a code folder, a warning, and a walk that stopped at its cap. */
const REPO: RepoScan = {
  findings: [{ kind: 'fe', label: 'react', evidence: 'package.json' }],
  languages: ['TypeScript'],
  codeDirs: ['src'],
  hasSource: true,
  isTruncated: true,
  cadre: { dir: 'absent', manifest: null, manifestState: 'absent', state: null, stateState: 'absent' },
  warnings: ['could not read package.json (treated as unknown)'],
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

/** An apply that wrote, failed, refused, missed a chmod, failed a hunk, installed a plugin and skipped the manifest. */
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
  manifestSkipped: true,
}

const PLAN: Plan = { ops: [{ kind: 'create', path: '.cadre/bin/be', mode: 'exec', note: null }], warnings: [] }

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
 * are given (compareText, parseVersionText, visibleText, asciiLine, cleanKickoffText, probeText, reportText and
 * lastLogText), which add no text of their own.
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
  ['assign', 'INFRA_PLUGINS', INFRA_PLUGINS],
  ['assign', 'INFRA_SKILLS', INFRA_SKILLS],
  ['assign', 'INFRA_TOOLS', INFRA_TOOLS],
  ['assign', 'INFRA_MCP_SERVERS', INFRA_MCP_SERVERS],
  ['assign', 'FRAMEWORK_START_SKILLS', FRAMEWORK_START_SKILLS],
  ['assign', 'MCP_ROLE_ROWS', MCP_ROLE_ROWS],
  ['assign', 'SKILL_ROLE_ROWS', SKILL_ROLE_ROWS],
  ['assign', 'CLAUDE_SECURITY_PLUGIN', CLAUDE_SECURITY_PLUGIN],
  ['assign', 'SECURITY_GUIDANCE_PLUGIN', SECURITY_GUIDANCE_PLUGIN],
  ['assign', 'SECURITY_PLUGINS', SECURITY_PLUGINS],
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
  ['builtin', 'BUILTIN_GATES', BUILTIN_GATES],
  ['builtin', 'BUILTIN_ADAPTER', BUILTIN_ADAPTER],
  ['builtin', 'builtinKickoffText', KICKOFFS.map(builtinKickoffText)],
  ['command', 'RESERVED_ROLE_IDS', RESERVED_ROLE_IDS],
  ['command', 'USAGE_LINES', USAGE_LINES],
  ['command', 'helpText', [helpText(null), helpText('bogus')]],
  ['facts', 'SOURCE_ORDER', SOURCE_ORDER],
  ['facts', 'HOME_ROOT_REPLY', HOME_ROOT_REPLY],
  ['facts', 'FILE_SYSTEM_ROOT_REPLY', FILE_SYSTEM_ROOT_REPLY],
  ['facts', 'HOME_UNUSABLE_WARNING', HOME_UNUSABLE_WARNING],
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
  ['generate', 'launcherText', STARTS.map(start => launcherText(BE, BE_SCOPE, start))],
  ['generate', 'indexMdText', indexMdText(TEAM, SCOPES)],
  ['generate', 'cadreJsonText', cadreJsonText(STATE)],
  ['gsd', 'GSD_HOOK_NOTES', GSD_HOOK_NOTES],
  ['gsd', 'GSD_GATES', GSD_GATES],
  ['gsd', 'GSD_CONFIG_FILE', GSD_CONFIG_FILE],
  ['gsd', 'GSD_AUTONOMY', GSD_AUTONOMY],
  ['gsd', 'GSD_ADAPTER', GSD_ADAPTER],
  ['gsd', 'gsdKickoffText', KICKOFFS.map(gsdKickoffText)],
  ['history', 'NO_HISTORY_NOTE', NO_HISTORY_NOTE],
  ['history', 'UNLISTED_HISTORY_NOTE', UNLISTED_HISTORY_NOTE],
  ['history', 'HISTORY_DISMISSED_REASON', HISTORY_DISMISSED_REASON],
  ['history', 'HISTORY_OPTIONS', HISTORY_OPTIONS],
  ['history', 'historyQuestion', historyQuestion(12)],
  ['history', 'historyLines', historyLines(HISTORY)],
  ['init', 'NOT_INTERACTIVE_REPLY', NOT_INTERACTIVE_REPLY],
  ['init', 'INIT_ROOT_UNKNOWN_REPLY', INIT_ROOT_UNKNOWN_REPLY],
  ['init', 'INIT_HOME_ROOT_REPLY', INIT_HOME_ROOT_REPLY],
  ['init', 'INIT_FILE_SYSTEM_ROOT_REPLY', INIT_FILE_SYSTEM_ROOT_REPLY],
  ['init', 'INIT_CANCELLED', INIT_CANCELLED],
  ['init', 'NO_USABLE_ANSWER_REASON', NO_USABLE_ANSWER_REASON],
  ['init', 'refusalLine', [refusalLine('both', 'GSD, none - a role runs one framework'), refusalLine(' ', 'x')]],
  ['init', 'quotedLabels', quotedLabels(REVIEW_OPTIONS)],
  ['init', 'DRY_RUN_NOTE', DRY_RUN_NOTE],
  ['init', 'APPLIED_NONE_NOTE', APPLIED_NONE_NOTE],
  ['init', 'NEXT_STEP_NOTE', NEXT_STEP_NOTE],
  ['init', 'MANIFEST_SKIPPED_NOTE', MANIFEST_SKIPPED_NOTE],
  ['init', 'IGNORE_ALL_NOTE', IGNORE_ALL_NOTE],
  ['init', 'GIT_POLICY_QUESTION', GIT_POLICY_QUESTION],
  ['init', 'GIT_POLICY_OPTIONS', GIT_POLICY_OPTIONS],
  ['init', 'GIT_POLICY_DISMISSED_REASON', GIT_POLICY_DISMISSED_REASON],
  ['init', 'PANE_TITLES', PANE_TITLES],
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
  ['init', 'SECURITY_INSTALL_OPTIONS', SECURITY_INSTALL_OPTIONS],
  ['init', 'SECURITY_INSTALL_DISMISSED_REASON', SECURITY_INSTALL_DISMISSED_REASON],
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
  ['init', 'policyLine', POLICIES.map(policyLine)],
  ['init', 'scanSummaryLines', scanSummaryLines(REPO, SETUP)],
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
  ['kickoff', 'UNNAMED_ROLE', UNNAMED_ROLE],
  ['launch', 'RUNTIME_SETTINGS_KEYS', RUNTIME_SETTINGS_KEYS],
  ['plan', 'MANIFEST_PATH', MANIFEST_PATH],
  ['plan', 'IGNORE_BEGIN', IGNORE_BEGIN],
  ['plan', 'IGNORE_END', IGNORE_END],
  ['plan', 'RUNTIME_STAMP_FILE', RUNTIME_STAMP_FILE],
  ['plan', 'INBOX_FILE', INBOX_FILE],
  ['plan', 'PROBE_EXPECTATIONS_FILE', PROBE_EXPECTATIONS_FILE],
  ['plan', 'RUNTIME_RENDERED', RUNTIME_RENDERED],
  ['plan', 'SECURITY_REPORTS_LINE', SECURITY_REPORTS_LINE],
  ['plan', 'HUNK_FILES', HUNK_FILES],
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
  ['start', 'stampText', stampText('0.2.0')],
  ['start', 'runtimeMcpText', [false, true].map(isRead => runtimeMcpText(BE, {}, ['/repo'], isRead))],
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
})
