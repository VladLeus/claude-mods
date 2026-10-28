import { describe, expect, test } from 'claude-code/testing'

import type {
  AskSpec,
  CadreState,
  Choice,
  DesiredFile,
  Detection,
  DetectStatus,
  Effort,
  Facts,
  FileOp,
  FrameworkId,
  GitPolicy,
  GsdFact,
  HookScript,
  HostIo,
  HostRun,
  HunkOp,
  InitFacts,
  InitIo,
  InstructionGroup,
  InstructionHandout,
  InstructionPart,
  LaunchStart,
  ManifestEntry,
  MemoryItem,
  PaneKey,
  Plan,
  PortEntry,
  PortStat,
  RepoScan,
  RoleChange,
  RoleProposal,
  RoleSpec,
  ScopeContext,
  SetupScan,
  SkillRef,
  TemplateRoleId,
  UnsupportedId,
} from '../types'
import {
  CONFLICT_OPTIONS,
  conflictQuestion,
  hunkFailureLine,
  improverArgv,
  improverGuardFlags,
  improverLine,
  improverNoChangeNote,
  installedLine,
  installFailureText,
  instructionsRecordPath,
  MARKETPLACE_ADD_ARGV,
  otherChangesWarning,
  instructionsRecordText,
  privateClaudeMdPath,
  privateClaudeMdText,
} from './apply'
import type { HunkRun } from './apply'
import {
  ASK_HEADERS,
  askChoice,
  MAX_ASKS,
  NO_USABLE_ANSWER_REASON,
  PANE_TITLES,
  quotedLabels,
  refusalLine,
  withContext,
} from './ask'
import type { ChoiceAsk, StepResult } from './ask'
import { envQuestion, MODEL_EFFORT_OPTIONS, modelEffortRefusal } from './assign'
import { sha256Hex } from './core/hash'
import { isObject, stableJson } from './core/json'
import { compareText } from './core/text'
import { attendedNote, NOT_SET_TEXT, UNKNOWN_CONFIG_TEXT } from './framework/gsd/hunks'
import { detectAll } from './framework/registry'
import {
  cadreJsonText,
  GIT_TRACKING_UNKNOWN_WARNING,
  roleClaudeMdText,
  roleJsonText,
  untrackedPartsWarning,
} from './generate'
import { desiredFiles } from './generate/files'
import { GIT_COMMON_DIR_ARGV } from './git/common-dir'
import { FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY } from './guards/refusals'
import { commandRefusal, NOT_INTERACTIVE_REPLY } from './guards/repo'
import { HISTORY_DISMISSED_REASON, HISTORY_OPTIONS, historyQuestion, NO_HISTORY_NOTE } from './history'
import {
  ADJUST_DISMISSED_REASON,
  ADJUST_OPTIONS,
  ADJUST_QUESTION,
  ADJUST_ROUNDS_NOTE,
  adjustContextLine,
  adjustLoop,
  APPLIED_NONE_NOTE,
  appliedLines,
  ASSIGNMENT_DISMISSED_REASON,
  assignmentStep,
  cancelledReply,
  cardLines,
  carryStep,
  CLAUDE_JSON_CONTEXT,
  CLAUDE_JSON_OPTIONS,
  CLAUDE_JSON_QUESTION,
  CONFLICT_CONTEXT,
  CONSENT_DISMISSED_REASON,
  consentStep,
  DESCRIBE_CANCELLED_REASON,
  DESCRIBE_CONTEXT,
  DESCRIBE_OPTIONS,
  DESCRIBE_QUESTION,
  describeStep,
  DRY_RUN_NOTE,
  DURATION_DISMISSED_REASON,
  DURATION_OPTIONS,
  DURATION_QUESTION,
  durationContextLine,
  durationStep,
  dryRunPrivateWarning,
  ENV_DISMISSED_REASON,
  envContextLine,
  FRAMEWORK_ALL_QUESTION,
  FRAMEWORK_DISMISSED_REASON,
  FRAMEWORK_LABELS,
  FRAMEWORK_QUESTION_PREFIX,
  frameworkReason,
  frameworkRoleQuestion,
  frameworkStep,
  GIT_POLICY_CONTEXT,
  GIT_POLICY_DISMISSED_REASON,
  GIT_POLICY_OPTIONS,
  GIT_POLICY_QUESTION,
  gitPolicyStep,
  HUNK_DISMISSED_REASON,
  hunkStep,
  IGNORE_ALL_NOTE,
  IMPROVER_INSTALL_CONTEXT,
  IMPROVER_INSTALL_DISMISSED_REASON,
  IMPROVER_INSTALL_QUESTION,
  improverNotOfferedWarning,
  improverRunLine,
  INIT_CANCELLED,
  INIT_FILE_SYSTEM_ROOT_REPLY,
  INIT_HOME_ROOT_REPLY,
  INSTALL_OPTIONS,
  initReplyText,
  installedFrameworks,
  instructionsStep,
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
  launchStartStep,
  LINKED_MEMORIES_ROW,
  MANIFEST_SKIPPED_NOTE,
  MAX_ADJUST_ROUNDS,
  MAX_PROPOSE_ATTEMPTS,
  MAX_REVIEW_ROUNDS,
  MAX_ROLE_ROUNDS,
  mcpContextLine,
  MEMORY_DISMISSED_REASON,
  memoryContextLine,
  memoryDroppedLine,
  memoryStep,
  MODEL_DISMISSED_REASON,
  MODEL_EFFORT_CONTEXT,
  MODEL_MODE_QUESTION,
  modelStep,
  NEXT_STEP_NOTE,
  notHandedOutWarning,
  ownSkillContextLine,
  parseGitPolicy,
  parseReviewItem,
  partDroppedLine,
  planStep,
  PLUGIN_RUN_TIMEOUT_MS,
  policyLine,
  PRIVATE_FILES_HEADING,
  privateFilesRow,
  privateFoldersUnknownWarning,
  proposalLines,
  PYTHON_TIMEOUT_MS,
  REGEN_BAD_MANIFEST,
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
  rolesStep,
  runInit,
  runRegen,
  scanContextLine,
  scanSummaryLines,
  scanWarningLines,
  SECURITY_INSTALL_CONTEXT,
  SECURITY_INSTALL_DISMISSED_REASON,
  SECURITY_INSTALL_PREFIX,
  securityInstallQuestion,
  securityInstallStep,
  skillsContextLine,
  teamContextLine,
  truncatedLine,
  unusableRecordWarning,
  withSecuritySkill,
} from './init'
import type { AdjustOutcome, ApplyOutcome, InitOptions, RegenOptions, ReviewItem } from './init'
import {
  CONTENT_DISMISSED_REASON,
  CONTENT_OPTIONS,
  CONTENT_QUESTION,
  INSTRUCTIONS_ENTRY_QUESTION,
  parseContentConsent,
  RECOMMEND_SYSTEM,
  REGEN_RECOMMEND_SYSTEM,
  TOPICS_SYSTEM,
} from './instructions'
import type { PartRecord } from './instructions'
import { isPartsFlowRole } from './launch'
import { gitignoreLines, mergeIgnoreBlock } from './plan/gitignore'
import { buildPlan, planReadPaths } from './plan/plan'
import { renderPlan } from './plan/text'
import { recommendationLines } from './recommend'
import { choiceLine } from './render'
import { PROPOSE_SYSTEM, rolesFromProposal } from './roles'
import {
  CLAUDE_MD_PLUGIN,
  CLAUDE_SECURITY_PLUGIN,
  CLAUDE_SECURITY_SKILL,
  SECURITY_GUIDANCE_PLUGIN,
  SECURITY_PLUGINS,
} from './roles/infra'
import { proposeRoles } from './roles/propose'
import { missingSecurityPlugins, recommend } from './roles/recommend'
import { parseRoleJson } from './roles/rolejson'
import { AUTOPILOT_THRESHOLD, ROLE_TEMPLATE, roleFromTemplate } from './roles/template'
import { MAX_READ_BYTES } from './scan/facts/normalize'
import { gatherScans, scanWarnings } from './scan/gather'
import type { Gathered } from './scan/gather'
import { unreadableWarning } from './scan/instructions/memories'
import { overSizeWarning, partsOfText } from './scan/instructions/read'
import { pluginVersionOf, portProbeOf, portTextOf } from './scan/port-read'
import { scanRepo } from './scan/repo'
import { scanSetup } from './scan/setup/setup'
import { scopeCardLines } from './scope/card'
import { compileScope } from './scope/compile'
import { parseCadreState } from './state/cadre-files'
import {
  MCP_ROUTE,
  REGEN_BAD_STATE,
  REGEN_NO_STATE,
  regenBadRole,
  regenNeedsFramework,
  regenNoRole,
  resolvedFramework,
  scopesFor,
} from './team'
import {
  ABSOLUTE_PATH_MARKERS,
  BIDI_OVERRIDE,
  cardOf,
  DEFAULT_LOCATIONS,
  EMPTY_FACTS,
  emptySetupScan,
  entry,
  firstLines,
  FRAMEWORKS,
  gitWorld,
  hostWorld,
  INIT_ANSWERS,
  leaks,
  link,
  memHost,
  memIo,
  memWorld,
  onDisk,
  paneText,
  plannedFiles,
  repoScan,
  scansOf,
  SECRET_FIXTURES,
  secretWorld,
  session,
  shownBlock,
  skillRef,
  stateOf,
  STATUS_PATH,
  templateRole,
  USER_DIR_LISTED,
  withEvents,
  withStats,
  withWrites,
} from './testkit'
import type { HostCall, HostRunRule, HostWrite, MemHost, MemRun, MemWorld } from './testkit'

/**
 * What a --dry-run reply of the INIT_ANSWERS team (pm, tl, security) says Confirm writes outside the repo, right
 * before its note: the heading, then the private files of each role (02-GAPS-B3 S4).
 */
const DEFAULT_CONFIRM_LINES: readonly string[] = [
  PRIVATE_FILES_HEADING,
  ...['pm', 'tl', 'security'].map(privateFilesRow),
]

/**
 * The private-folders warning of a plain init of the INIT_ANSWERS team in a world whose git gives no common dir: every
 * plain init names the role memory folders (02-GAPS-B3 C1).
 */
const DEFAULT_FOLDERS_UNKNOWN = `warning: ${privateFoldersUnknownWarning(['pm', 'security', 'tl'])}`

/** The private-folders warning of a plain init of the six template roles in a world whose git gives no common dir. */
const SIX_FOLDERS_UNKNOWN = `warning: ${privateFoldersUnknownWarning(['be', 'fe', 'pm', 'qa', 'security', 'tl'])}`

/** The git run every plain init makes to name the role memory folders (02-GAPS-B3 C1). */
const COMMON_DIR_CALL: HostCall = { argv: GIT_COMMON_DIR_ARGV, options: { cwd: '/repo', timeoutMs: 10_000 } }

/**
 * INIT_ANSWERS with the content consent of the instruction parts declined (G-02-1f), so a dry run in a world with a
 * CLAUDE.md or a memory asks the whole-file questions of D-63, as it did before the consent.
 */
const PARTS_DECLINED: Readonly<Record<string, string>> = { ...INIT_ANSWERS, [CONTENT_QUESTION]: 'No, skip it' }

/** The middle of the partial line for deeper folders listed only in part (D-137). */
const IN_PART = 'listed only in part (the first 200 entries each)'

/** How the partial line names a walk that stopped at its overall safety cap (D-137). */
const SAFETY_CAP = 'the scan stopped at the 20,000-entry safety cap'

describe('scanSummaryLines', () => {
  test('an empty repo and setup are summed up with none and zero for every part', () => {
    expect(scanSummaryLines(repoScan(), emptySetupScan())).toEqual([
      'Repo scan (read-only):',
      '  stack: none; frontend: none; backend: none',
      '  tests: none; E2E: none',
      '  existing .cadre/: none',
      'User setup (names only):',
      '  plugins: 0',
      '  skills: 0; agents: 0; MCP servers: none',
      '  global ~/.claude/CLAUDE.md: no; memories: 0; CLAUDE.md files: none',
    ])
  })

  test('the repo part names the languages and the finding labels of each kind, in scan order', () => {
    const repo = repoScan({
      languages: ['JavaScript', 'TypeScript'],
      findings: [
        { kind: 'be', label: 'express', evidence: 'package.json' },
        { kind: 'e2e', label: 'Playwright config', evidence: 'playwright.config.ts' },
        { kind: 'fe', label: 'next', evidence: 'package.json' },
        { kind: 'fe', label: 'react', evidence: 'package.json' },
        { kind: 'lang', label: 'JavaScript/TypeScript (package.json)', evidence: 'package.json' },
        { kind: 'test', label: 'JS/TS test files', evidence: 'src/a.test.ts' },
        { kind: 'test', label: 'vitest', evidence: 'package.json' },
      ],
      hasSource: true,
    })
    const lines = scanSummaryLines(repo, emptySetupScan())
    expect(lines[1]).toBe('  stack: JavaScript, TypeScript; frontend: next, react; backend: express')
    expect(lines[2]).toBe('  tests: JS/TS test files, vitest; E2E: Playwright config')
  })

  test("a repo with gem 'rails' in its root Gemfile shows backend: rails and keeps BE (G-02-1c)", async () => {
    const world = memWorld({
      dirs: {
        '/repo': [entry('.rspec'), entry('Gemfile'), entry('app', 'dir'), entry('package.json')],
        '/repo/app': [entry('models', 'dir')],
        '/repo/app/models': [entry('user.rb')],
      },
      files: {
        '/repo/Gemfile': "source 'https://rubygems.org'\n\ngem 'rails', '8.1.3.1'\n",
        '/repo/package.json': JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      },
    })
    const repo = await scanRepo(memIo(world, []).io, '/repo')
    const proposal = proposeRoles(repo)

    expect(scanSummaryLines(repo, emptySetupScan())[1]).toBe('  stack: Ruby; frontend: react; backend: rails')
    expect(proposal.roles.map(role => role.id)).toContain('be')
    expect(proposal.changes.filter(change => change.roleId === 'be')).toEqual([])
  })

  test('an existing .cadre/ is shown with its state and the state of its manifest', () => {
    const cadre = (dir: 'present' | 'unknown', manifestState: 'present' | 'absent' | 'unknown'): RepoScan['cadre'] => ({
      dir,
      manifest: null,
      manifestState,
      state: null,
      stateState: 'absent',
    })
    const shown = (dir: 'present' | 'unknown', manifestState: 'present' | 'absent' | 'unknown'): string | undefined =>
      scanSummaryLines(repoScan({ cadre: cadre(dir, manifestState) }), emptySetupScan())[3]
    expect(shown('present', 'present')).toBe('  existing .cadre/: present (manifest present)')
    expect(shown('present', 'absent')).toBe('  existing .cadre/: present (manifest absent)')
    expect(shown('unknown', 'unknown')).toBe('  existing .cadre/: unknown (manifest unknown)')
  })

  test('a scan that listed a deeper folder only in part says so after the .cadre/ line (G-02-1e)', () => {
    const lines = scanSummaryLines(repoScan({ cappedFolders: ['app/views'] }), emptySetupScan())
    expect(lines[4]).toBe(`  partial: 1 deeper folder ${IN_PART}; may be incomplete: stack, tests, E2E`)
    expect(lines[5]).toBe('User setup (names only):')
    expect(scanSummaryLines(repoScan(), emptySetupScan())).toHaveLength(8)
  })

  test('a scan stopped at the safety cap that also capped folders shows the safety line, then the folder line', () => {
    const repo = repoScan({ cappedFolders: ['a/b', 'c/d'], isOverallCapped: true })
    const lines = scanSummaryLines(repo, emptySetupScan())
    expect(lines.slice(4, 7)).toEqual([
      `  partial: ${SAFETY_CAP}; may be incomplete: stack, tests, E2E`,
      `  partial: 2 deeper folders ${IN_PART}; may be incomplete: stack, tests, E2E`,
      'User setup (names only):',
    ])
  })

  test('the setup part counts plugins, skills, agents and memories and names MCP servers and CLAUDE.md files', () => {
    const plugins = ['a@m', 'b@m', 'c@m', 'd@m', 'e@m', 'f@m', 'g@m', 'h@m', 'i@m', 'j@m']
    const setup = emptySetupScan({
      plugins,
      skills: [
        { name: 'security-review', plugin: null },
        { name: 'rescue', plugin: 'codex' },
        { name: 'setup', plugin: 'codex' },
      ],
      mcp: [
        { name: 'jira', source: 'project' },
        { name: 'sentry', source: 'session' },
      ],
      agents: ['planner', 'reviewer'],
      claudeMd: ['~/work/CLAUDE.md', '<repo>/CLAUDE.md'],
      hasGlobalClaudeMd: true,
      memoryFiles: ['a.md', 'b.md', 'c.md'],
    })
    expect(scanSummaryLines(repoScan(), setup).slice(5)).toEqual([
      '  plugins: 10 (a@m, b@m, c@m, d@m, e@m, f@m, g@m, h@m, i@m, j@m)',
      '  skills: 3; agents: 2; MCP servers: jira, sentry',
      '  global ~/.claude/CLAUDE.md: yes; memories: 3; CLAUDE.md files: ~/work/CLAUDE.md, <repo>/CLAUDE.md',
    ])
  })

  test('long setup lists keep their counts first and show 12 names, then count the rest (B2)', () => {
    const names = (prefix: string, count: number): string[] =>
      Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`)
    const plugins = names('plugin-', 30).map(name => `${name}@claude-plugins-official`)
    const servers = names('server-', 20)
    const claudeMd = names('<repo>/pkg', 15).map(name => `${name}/CLAUDE.md`)
    const setup = emptySetupScan({
      plugins,
      mcp: servers.map(name => ({ name, source: 'session' })),
      claudeMd,
      hasGlobalClaudeMd: true,
      memoryFiles: ['a.md'],
    })
    const first12 = (list: readonly string[]): string => list.slice(0, 12).join(', ')
    expect(scanSummaryLines(repoScan(), setup).slice(5)).toEqual([
      `  plugins: 30 (${first12(plugins)}, +18 more)`,
      `  skills: 0; agents: 0; MCP servers: ${first12(servers)}, +8 more`,
      `  global ~/.claude/CLAUDE.md: yes; memories: 1; CLAUDE.md files: ${first12(claudeMd)}, +3 more`,
    ])
  })

  test('a long or hidden-character name in a setup list is cleaned and capped, and the counts stay in front', () => {
    const long = `a${BIDI_OVERRIDE}b${'x'.repeat(300)}`
    const setup = emptySetupScan({ plugins: [long], mcp: [{ name: long, source: 'session' }], claudeMd: [long] })
    const shownName = `ab${'x'.repeat(107)}…`
    expect(scanSummaryLines(repoScan(), setup).slice(5)).toEqual([
      `  plugins: 1 (${shownName})`,
      `  skills: 0; agents: 0; MCP servers: ${shownName}`,
      `  global ~/.claude/CLAUDE.md: no; memories: 0; CLAUDE.md files: ${shownName}`,
    ])
  })
})

/** A repo scan with every fact found: a language, a test finding and an E2E finding; `over` changes the rest. */
function foundAll(over: Partial<RepoScan>): RepoScan {
  return repoScan({
    languages: ['Ruby'],
    findings: [
      { kind: 'e2e', label: 'Rails system specs', evidence: 'spec/system' },
      { kind: 'test', label: 'RSpec config', evidence: '.rspec' },
    ],
    hasSource: true,
    ...over,
  })
}

describe('truncatedLine (G-02-1e)', () => {
  test('nothing capped gives no line', () => {
    expect(truncatedLine(repoScan())).toBeNull()
    expect(truncatedLine(repoScan({ languages: ['Ruby'], hasSource: true }))).toBeNull()
  })

  test('one deeper folder listed only in part names the facts it found nothing for: folder for 1', () => {
    expect(truncatedLine(repoScan({ cappedFolders: ['app/views'] }))).toBe(
      `  partial: 1 deeper folder ${IN_PART}; may be incomplete: stack, tests, E2E`,
    )
  })

  test('several deeper folders say folders, and only the facts not found may be incomplete', () => {
    const repo = foundAll({ findings: [{ kind: 'test', label: 'RSpec config', evidence: '.rspec' }] })
    const capped = { ...repo, cappedFolders: ['app/models', 'app/views', 'spec/models'] }
    expect(truncatedLine(capped)).toBe(`  partial: 3 deeper folders ${IN_PART}; may be incomplete: E2E`)
  })

  test('with stack, tests and E2E all found the line says so', () => {
    expect(truncatedLine(foundAll({ cappedFolders: ['app/views', 'spec/system'] }))).toBe(
      `  partial: 2 deeper folders ${IN_PART}; stack, tests and E2E were all found`,
    )
  })

  test('a stop at the safety cap is named in place of the folder wording, with the same facts rule', () => {
    expect(truncatedLine(repoScan({ isOverallCapped: true }))).toBe(
      `  partial: ${SAFETY_CAP}; may be incomplete: stack, tests, E2E`,
    )
  })

  test('a stop at the safety cap with every fact found says the scan stopped early, never all found (N7)', () => {
    expect(truncatedLine(foundAll({ isOverallCapped: true }))).toBe(
      '  partial: the scan stopped at the 20,000-entry safety cap; ' +
        'the scan stopped early; stack, tests and E2E may be incomplete',
    )
  })

  test('with the safety cap and a capped folder, both partial lines end with the stopped-early tail (N7)', () => {
    const repo = foundAll({ cappedFolders: ['a/b'], isOverallCapped: true })
    const partial = scanSummaryLines(repo, emptySetupScan()).filter(line => line.startsWith('  partial: '))
    expect(partial).toEqual([
      `  partial: ${SAFETY_CAP}; the scan stopped early; stack, tests and E2E may be incomplete`,
      `  partial: 1 deeper folder ${IN_PART}; the scan stopped early; stack, tests and E2E may be incomplete`,
    ])
  })

  test('with the safety cap reached and folders capped, truncatedLine gives the safety line first', () => {
    const repo = repoScan({ cappedFolders: ['a/b'], isOverallCapped: true })
    expect(truncatedLine(repo)).toBe(`  partial: ${SAFETY_CAP}; may be incomplete: stack, tests, E2E`)
  })

  test('a real walk over 20,000 entries gives the safety-cap line', async () => {
    const files = Array.from({ length: 20_001 }, (_, at) => entry(`f${String(at).padStart(5, '0')}.txt`))
    const repo = await scanRepo(memIo(memWorld({ dirs: { '/repo': files } }), []).io, '/repo')
    expect(truncatedLine(repo)).toBe(`  partial: ${SAFETY_CAP}; may be incomplete: stack, tests, E2E`)
  })
})

/** Settings with one PreToolUse hook that runs the GSD secret read guard. */
const GUARD_SETTINGS = {
  hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node /x/hooks/gsd-secret-read-guard.js' }] }] },
}

describe('runInit', () => {
  test('a guard that refuses ends init with its text before any question or scan', async () => {
    const run = memIo(memWorld({}), INIT_ANSWERS)
    expect(await runInit(run.io, { dryRun: true })).toBe('cadre init needs a git repo: run git init first')
    expect(run.asked).toEqual([])
    expect(run.listed).toEqual([])
  })

  test('after the guard the first question is the ~/.claude.json consent with its two options', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(firstLines(run.asked)[0]).toBe(CLAUDE_JSON_QUESTION)
    expect(CLAUDE_JSON_QUESTION).toBe(
      'Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.',
    )
    expect(run.specs[0]).toEqual({ options: ['No, skip it', 'Yes, read names only'], header: 'claude.json' })
    expect(CLAUDE_JSON_OPTIONS).toEqual(['No, skip it', 'Yes, read names only'])
    expect(Object.isFrozen(CLAUDE_JSON_OPTIONS)).toBe(true)
  })

  test('No, skip it leaves ~/.claude.json unread and Yes, read names only reads it once', async () => {
    const files = { '/home/u/.claude.json': '{"mcpServers":{"linear":{}}}' }
    const declined = memIo(gitWorld({ files }), INIT_ANSWERS)
    await runInit(declined.io, { dryRun: true })
    expect(declined.reads).not.toContain('/home/u/.claude.json')
    const allowed = memIo(gitWorld({ files }), { ...INIT_ANSWERS, 'Read ~/.claude.json': 'Yes, read names only' })
    await runInit(allowed.io, { dryRun: true })
    expect(allowed.reads.filter(path => path === '/home/u/.claude.json')).toHaveLength(1)
  })

  test('a dismissed consent cancels init before any scan and prints why (A1)', async () => {
    const run = memIo(gitWorld(), {})
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(CONSENT_DISMISSED_REASON))
    expect(firstLines(run.asked)).toEqual([CLAUDE_JSON_QUESTION])
    expect(run.listed).toEqual([])
    expect(run.reads).toEqual([STATUS_PATH])
    expect(run.logged).toEqual([CONSENT_DISMISSED_REASON])
  })

  test('consentStep accepts yes or no; a dismissal or unknown answers cancel with their reasons (A1)', async () => {
    const yes = memIo(memWorld({}), ['Yes, read names only'])
    expect(await consentStep(yes.io)).toEqual({ kind: 'accepted', value: true })
    expect(yes.asked).toEqual([withContext(CLAUDE_JSON_QUESTION, CLAUDE_JSON_CONTEXT)])
    expect(yes.specs).toEqual([{ options: CLAUDE_JSON_OPTIONS, header: 'claude.json' }])
    expect(await consentStep(memIo(memWorld({}), [' no, SKIP it ']).io)).toEqual({ kind: 'accepted', value: false })
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], CONSENT_DISMISSED_REASON],
      [['maybe', 'maybe', 'maybe'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await consentStep(run.io)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(CONSENT_DISMISSED_REASON).toBe('The ~/.claude.json question was dismissed or not answered.')
  })

  test('after the consent init shows the repo scan and user setup in the pane, before the next question', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    expect(events[0]).toBe(`ask ${CLAUDE_JSON_QUESTION}`)
    expect(events[1]).toBe('show scan')
    expect(run.shown[0]?.lines[0]).toBe('Repo scan (read-only):')
    expect(run.shown[0]?.lines).toContain('User setup (names only):')
  })

  test('init shows every scan warning right after the summary, in the same pane block, before the roles', async () => {
    const locations = { ...DEFAULT_LOCATIONS, warnings: ['the root was given through a link'] }
    const facts = { facts: { ...EMPTY_FACTS, warnings: ['a settings file could not be read'] }, gsdUserDir: null }
    const run = memIo(gitWorld({ locations, facts }), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const gathered = await gatherScans(memIo(gitWorld({ locations, facts }), {}).io, locations, false)
    const summary = scanSummaryLines(gathered.repo, gathered.setup)
    const warnings = scanWarningLines(scanWarnings(locations, gathered))
    expect(warnings.slice(0, 2)).toEqual([
      'warning: the root was given through a link',
      'warning: a settings file could not be read',
    ])
    expect(events[1]).toBe('show scan')
    expect(run.shown[0]).toEqual({ key: 'scan', title: 'Scan', lines: [...summary, ...warnings] })
    expect(events[2]).toBe(`log ${NO_HISTORY_NOTE}`)
    expect(events[3]).toBe('show roles')
  })

  test('with no scan warning nothing is added after the scan summary', async () => {
    const listable = gitWorld({ dirs: { '/repo/.git': [], '/repo': [] } })
    const run = memIo(listable, INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const gathered = await gatherScans(memIo(listable, {}).io, DEFAULT_LOCATIONS, false)
    expect(scanWarnings(DEFAULT_LOCATIONS, gathered)).toEqual([])
    expect(events[1]).toBe('show scan')
    expect(run.shown[0]?.lines).toEqual(scanSummaryLines(gathered.repo, gathered.setup))
  })

  test('a desktop app connector in the session tools is left out with one line in the scan block (R2)', async () => {
    const uuid = 'bffcbad4-dacc-4759-8f45-f8c9abe5e705'
    const tools = [{ name: `mcp__${uuid}__append_values`, description: 'x', mcp: true }]
    const run = memIo(gitWorld({ tools }), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(run.shown[0]?.key).toBe('scan')
    expect(run.shown[0]?.lines).toContain(
      'warning: left out 1 desktop app connector (role sessions run in the terminal, where connectors are ' +
        'claude_ai_* servers)',
    )
    expect(JSON.stringify(run.shown)).not.toContain(uuid)
  })

  test('after the summary init shows the roles proposed from the repo scan and asks the roles question', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const proposal = proposeRoles(await scanRepo(memIo(gitWorld(), {}).io, '/repo'))
    expect(events[2]).toBe(`log ${NO_HISTORY_NOTE}`)
    expect(events[3]).toBe('show roles')
    expect(shownBlock(run, 'roles')).toEqual(proposalLines(proposal.roles, proposal.changes))
    expect(events[4]).toBe(`ask ${ROLES_QUESTION}`)
  })

  test('a dismissed roles question cancels init and prints why', async () => {
    const answers = Object.fromEntries(Object.entries(INIT_ANSWERS).filter(([key]) => key !== 'Use these roles?'))
    const run = memIo(gitWorld(), answers)
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(ROLES_DISMISSED_REASON))
    expect(firstLines(run.asked)).toEqual([CLAUDE_JSON_QUESTION, ROLES_QUESTION])
    expect(run.logged.at(-1)).toBe(ROLES_DISMISSED_REASON)
  })

  test('a roles step that hits its round cap prints the reason as its own line and asks nothing after it', async () => {
    const answers = { ...INIT_ANSWERS, 'Use these roles?': 'Adjust them', 'Adjust the roles': 'Done adjusting' }
    const run = memIo(gitWorld(), answers)
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(ROLE_ROUNDS_REASON))
    expect(run.logged.at(-1)).toBe(ROLE_ROUNDS_REASON)
    expect(firstLines(run.asked).filter(question => question === ROLES_QUESTION)).toHaveLength(MAX_ROLE_ROUNDS)
    expect(firstLines(run.asked).filter(line => line !== ROLES_QUESTION && line !== ADJUST_QUESTION)).toEqual([
      CLAUDE_JSON_QUESTION,
    ])
  })
})

/** The session folder of the fixture repo /repo for the fixture user /home/u. */
const HISTORY_DIR = '/home/u/.claude/projects/-repo'

/** The history question's prefix, as INIT_ANSWERS answers it. */
const HISTORY_PREFIX = "Scan this repo's session history"

/** A git repo at /repo with one session transcript that runs /gsd-plan-phase; `over` changes the fields it names. */
function historyGitWorld(over: Partial<MemWorld> = {}): MemWorld {
  return gitWorld({
    dirs: { '/repo/.git': [], [HISTORY_DIR]: [{ ...entry('a.jsonl'), mtimeMs: 1 }] },
    files: {
      [`${HISTORY_DIR}/a.jsonl`]:
        '{"type":"user","message":{"role":"user","content":"<command-name>/gsd-plan-phase</command-name>"}}',
    },
    ...over,
  })
}

describe('runInit history step (SCAN-03, D-59)', () => {
  test('the history question follows the scan summary and comes before the roles; No reads nothing', async () => {
    const run = memIo(historyGitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    expect(events[0]).toBe(`ask ${CLAUDE_JSON_QUESTION}`)
    expect(events[1]).toBe('show scan')
    expect(events[2]).toBe(`ask ${historyQuestion(1)}`)
    expect(events[3]).toBe('show roles')
    expect(events[4]).toBe(`ask ${ROLES_QUESTION}`)
    expect(run.reads.filter(path => path.endsWith('.jsonl'))).toEqual([])
    expect(run.logged.join('\n')).not.toContain('Session history')
    expect(shownBlock(run, 'history')).toEqual([])
  })

  test('with Yes the names and counts are shown after the question and before the roles', async () => {
    const run = memIo(historyGitWorld(), { ...INIT_ANSWERS, [HISTORY_PREFIX]: 'Yes, scan names and counts' })
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    expect(events[2]).toBe(`ask ${historyQuestion(1)}`)
    expect(events[3]).toBe('show history')
    expect(shownBlock(run, 'history')).toEqual(['Session history (names and counts only):', '  gsd-plan-phase  1'])
    expect(events[4]).toBe('show roles')
    expect(run.reads.filter(path => path.endsWith('.jsonl'))).toEqual([`${HISTORY_DIR}/a.jsonl`])
  })

  test('a dismissed history question cancels init, prints why and asks nothing after it (A1)', async () => {
    const run = memIo(historyGitWorld(), answersWithout(HISTORY_PREFIX))
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(HISTORY_DISMISSED_REASON))
    expect(firstLines(run.asked)).toEqual([CLAUDE_JSON_QUESTION, historyQuestion(1)])
    expect(run.logged.at(-1)).toBe(HISTORY_DISMISSED_REASON)
    expect(run.reads.filter(path => path.endsWith('.jsonl'))).toEqual([])
  })

  test('with no session history init logs the note right after the summary and asks no history question', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    expect(events[2]).toBe(`log ${NO_HISTORY_NOTE}`)
    expect(run.asked.filter(question => question.startsWith(HISTORY_PREFIX))).toEqual([])
  })
})

describe('init pane (G-02-1)', () => {
  test('a dry run shows the scan as the first pane block, titled Scan, and logs none of it', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(run.shown[0]?.key).toBe('scan')
    expect(run.shown[0]?.title).toBe('Scan')
    expect(run.shown[0]?.lines[0]).toBe('Repo scan (read-only):')
    expect(run.logged.filter(text => text.startsWith('Repo scan'))).toEqual([])
  })

  test('the scan is one pane block, shown once, right before the history question', async () => {
    const run = memIo(historyGitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    expect(events.slice(0, 3)).toEqual([`ask ${CLAUDE_JSON_QUESTION}`, 'show scan', `ask ${historyQuestion(1)}`])
    expect(run.shown.filter(block => block.key === 'scan')).toHaveLength(1)
  })

  test('each scan line is cleaned as a report cell: a value cannot add a row or hide text (T-02-48)', async () => {
    const hostile = `a link\nwarning: forged${BIDI_OVERRIDE}\u0007`
    const run = memIo(gitWorld({ locations: { ...DEFAULT_LOCATIONS, warnings: [hostile] } }), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const lines = run.shown[0]?.lines ?? []
    expect(lines).toContain('warning: a linkwarning: forged')
    expect(lines.filter(line => /[\n\u0007\u202E]/u.test(line))).toEqual([])
  })

  test('a full dry run shows scan, roles, recommendations and review, in that order, and logs no block', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(run.shown.map(block => block.key)).toEqual(['scan', 'roles', 'recommendations', 'review'])
    expect(run.shown.map(block => block.title)).toEqual(['Scan', 'Roles', 'Recommendations', 'Review'])
    expect(run.logged.filter(text => text.includes('\n'))).toEqual([])
  })

  test('with the history question answered Yes the history block comes right after the scan', async () => {
    const run = memIo(historyGitWorld(), { ...INIT_ANSWERS, [HISTORY_PREFIX]: 'Yes, scan names and counts' })
    await runInit(run.io, { dryRun: true })
    expect(run.shown.map(block => block.key)).toEqual(['scan', 'history', 'roles', 'recommendations', 'review'])
    expect(run.logged.filter(text => text.includes('\n'))).toEqual([])
  })

  test('the review block holds each scope card row as scopeCardLines gives it, and the plan (G-02-8)', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const team = await defaultRoles(gitWorld())
    const scopes = scopesFor(team, 'none', await scansOf(gitWorld()), [], { kind: 'git-root' })
    const pm = scopes.get('pm')
    const card = pm === undefined ? [] : scopeCardLines(pm.card)
    const review = shownBlock(run, 'review')
    const at = review.indexOf('Scope card: PM (pm)')
    expect(card[0]).toBe('Scope card: PM (pm)')
    expect(card).toContain('  rules:')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(review.slice(at, at + card.length)).toEqual(card)
    expect(review).toContain('File plan:')
  })

  test('Adjust shows the roles in a roles block when asked to Show the roles', async () => {
    // A change the team can take: a refused one puts its message on top of the next ask, which no key starts.
    const run = queuedIo(gitWorld(), {
      ...INIT_ANSWERS,
      'Use these roles?': ['Adjust them', 'Use these roles'],
      'Adjust the roles': ['drop security', 'Show the roles', 'Done adjusting'],
    })
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const showAt = events.indexOf(`ask ${ADJUST_QUESTION}`, events.indexOf(`ask ${ADJUST_QUESTION}`) + 1)
    expect(events.slice(showAt, showAt + 3)).toEqual([`ask ${ADJUST_QUESTION}`, 'show roles', `ask ${ADJUST_QUESTION}`])
    expect(run.shown.filter(block => block.key === 'roles')).toHaveLength(3)
  })

  test('PANE_TITLES names the bold title of each kind of block, and is frozen (D-133)', () => {
    expect(PANE_TITLES).toEqual({
      scan: 'Scan',
      history: 'Session history',
      roles: 'Roles',
      recommendations: 'Recommendations',
      review: 'Review',
      env: 'Env variables',
      notes: 'Notes',
      instructions: 'Instruction parts',
      skills: 'Your own skills',
      improver: 'Improver changes',
    })
    expect(Object.isFrozen(PANE_TITLES)).toBe(true)
  })
})

/** A scan of a TypeScript repo with tests and no frontend: BE is kept with its reason and FE is dropped. */
const SOURCE_SCAN = repoScan({
  languages: ['TypeScript'],
  hasSource: true,
  findings: [
    { kind: 'lang', label: 'JavaScript/TypeScript (package.json)', evidence: 'package.json' },
    { kind: 'test', label: 'JS/TS test files', evidence: 'src/a.test.ts' },
  ],
})

/** A scan of a TypeScript repo with a React frontend and tests, so the template proposes all six roles. */
const FULL_SCAN = repoScan({
  languages: ['TypeScript'],
  hasSource: true,
  findings: [
    { kind: 'fe', label: 'react', evidence: 'package.json' },
    { kind: 'lang', label: 'JavaScript/TypeScript (package.json)', evidence: 'package.json' },
    { kind: 'test', label: 'JS/TS test files', evidence: 'src/a.test.ts' },
  ],
})

/** A model reply that describes a BE role and a docs role with no template base. */
const DESCRIBED_REPLY =
  '{"roles":[{"id":"be","title":"BE","purpose":"API","basedOn":"be"},' +
  '{"id":"docs","title":"Docs","purpose":"docs","basedOn":null}]}'

/** The roles DESCRIBED_REPLY stands for. */
const DESCRIBED_ROLES = rolesFromProposal([
  { id: 'be', title: 'BE', purpose: 'API', basedOn: 'be' },
  { id: 'docs', title: 'Docs', purpose: 'docs', basedOn: null },
])

/** The person's description the describe tests type. */
const DESCRIPTION = 'we have a BE and a docs writer'

/** A detection of one framework or marker with this status, as detectAll gives it. */
function detection(id: FrameworkId | UnsupportedId, status: DetectStatus): Detection {
  return { id, name: id, status, version: null, evidence: [] }
}

/** The roles an Adjust outcome or a roles step result holds; null when it was cancelled. */
function rolesOf(result: AdjustOutcome | StepResult<RoleProposal>): readonly RoleSpec[] | null {
  if (result.kind === 'cancelled') return null

  return result.kind === 'adjusted' ? result.roles : result.value.roles
}

/** The value of an accepted step result; a cancelled one stops the test with its reason. */
function valueOf<T>(result: StepResult<T>): T {
  if (result.kind === 'cancelled') throw new Error(`the step was cancelled: ${result.reason}`)

  return result.value
}

/** The fallback sentence that ends the line init prints when the described structure cannot be used. */
const FALLBACK_END = 'Using the template proposal; you can still adjust it.'

/** The refusal on top of the describe question when it is asked again after a blank answer (D-136). */
const EMPTY_DESCRIPTION =
  `An empty answer isn't one of: a description of your roles, "Use the template instead", "Cancel init".`

/** The describe question as it is asked: the question, then its context line (D-136). */
const DESCRIBE_ASKED = withContext(DESCRIBE_QUESTION, DESCRIBE_CONTEXT)

describe('proposalLines', () => {
  test('the proposal lists each role with its title, id and purpose, then each scan change with its reason', () => {
    const proposal = proposeRoles(SOURCE_SCAN)
    expect(proposalLines(proposal.roles, proposal.changes)).toEqual([
      'Proposed roles:',
      `  ${'PM (pm)'.padEnd(24)}Owns product decisions: scope, requirements and acceptance.`,
      `  ${'Team Lead (tl)'.padEnd(24)}Owns architecture and QA decisions; reviews and merges the work.`,
      `  ${'BE (be)'.padEnd(24)}Implements the backend and core code.`,
      `  ${'QA (qa)'.padEnd(24)}Owns tests and end-to-end checks.`,
      `  ${'Security (security)'.padEnd(24)}Owns security decisions and reviews.`,
      'Changes from the scan:',
      '  kept be: source code found (TypeScript), no UI framework (package.json)',
      '  dropped fe: no frontend framework found (react, vue, next, svelte, angular)',
    ])
  })

  test('evidence paths are joined with commas, and no change at all reads none', () => {
    const roles = proposeRoles(FULL_SCAN).roles
    const change: RoleChange = { roleId: 'be', change: 'kept', reason: 'r', evidence: ['a.ts', 'b/c.go'] }
    expect(proposalLines(roles, [change]).slice(-1)).toEqual(['  kept be: r (a.ts, b/c.go)'])
    expect(proposalLines(roles, []).slice(-2)).toEqual(['Changes from the scan:', '  none'])
  })

  test('a title and id of 24 characters or more still leave one space before the purpose', () => {
    const [first] = DESCRIBED_ROLES
    if (first === undefined) throw new Error('no described role')
    const long = { ...first, id: 'backend-api', title: 'Backend API team' }
    expect(proposalLines([long], [])[1]).toBe('  Backend API team (backend-api) API')
  })
})

describe('describeStep', () => {
  test('a description the model turns into valid roles gives those roles', async () => {
    const run = memIo(memWorld({ replies: [DESCRIBED_REPLY] }), [DESCRIPTION])
    expect(await describeStep(run.io)).toEqual({ kind: 'roles', roles: DESCRIBED_ROLES })
    expect(run.asked).toEqual([DESCRIBE_ASKED])
    expect(run.specs[0]).toEqual({ options: ['Use the template instead', 'Cancel init'], header: 'Describe' })
  })

  test('the prompt is the propose system text and the description as a JSON string', async () => {
    const run = memIo(memWorld({ replies: [DESCRIBED_REPLY] }), [DESCRIPTION])
    await describeStep(run.io)
    expect(run.prompts).toHaveLength(1)
    expect(run.prompts[0]?.startsWith(`${PROPOSE_SYSTEM}\n---\n`)).toBe(true)
    expect(run.prompts[0]).toContain(JSON.stringify(DESCRIPTION))
  })

  test('an invalid reply is sent back with its exact errors, three model calls in all', async () => {
    const run = memIo(memWorld({ replies: ['not json', DESCRIBED_REPLY] }), [DESCRIPTION])
    expect(await describeStep(run.io)).toEqual({ kind: 'roles', roles: DESCRIBED_ROLES })
    expect(run.prompts).toHaveLength(2)
    expect(run.prompts[0]).not.toContain('the reply is not JSON')
    expect(run.prompts[1]).toContain('- the reply is not JSON')
    expect(MAX_PROPOSE_ATTEMPTS).toBe(3)
  })

  test('after three invalid replies it falls back to the template and says why', async () => {
    const run = memIo(memWorld({ replies: ['not json', '{"roles":"x"}', '{"roles":[]}'] }), [DESCRIPTION])
    expect(await describeStep(run.io)).toEqual({
      kind: 'fallback',
      message: `Could not use the described structure: no roles: describe at least one role. ${FALLBACK_END}`,
    })
    expect(run.prompts).toHaveLength(3)
  })

  test('a model that gives no text is retried and then falls back with that reason', async () => {
    const run = memIo(memWorld({ replies: [] }), [DESCRIPTION])
    expect(await describeStep(run.io)).toEqual({
      kind: 'fallback',
      message: `Could not use the described structure: the model gave no text. ${FALLBACK_END}`,
    })
    expect(run.prompts).toHaveLength(3)
  })

  test('many errors are cut so the reason line still ends with the fallback sentence', async () => {
    const badIds = Array.from({ length: 13 }, (_, index) => ({ id: `Bad_${index}`, title: 'x', purpose: 'y' }))
    const reply = JSON.stringify({ roles: badIds })
    const run = memIo(memWorld({ replies: [reply, reply, reply] }), [DESCRIPTION])
    const result = await describeStep(run.io)
    if (result.kind !== 'fallback') throw new Error('no fallback')
    expect(result.message.startsWith('Could not use the described structure: ')).toBe(true)
    expect(result.message.endsWith(FALLBACK_END)).toBe(true)
    expect(Array.from(result.message).length <= 240).toBe(true)
  })

  test('a blank description is asked again with why on top, and never sent to the model', async () => {
    const run = memIo(memWorld({ replies: [DESCRIBED_REPLY] }), ['   ', '', DESCRIPTION])
    expect(await describeStep(run.io)).toEqual({ kind: 'roles', roles: DESCRIBED_ROLES })
    const again = `${EMPTY_DESCRIPTION}\n${DESCRIBE_ASKED}`
    expect(run.asked).toEqual([DESCRIBE_ASKED, again, again])
    expect(run.prompts).toHaveLength(1)
  })

  test('the template answer makes no model call; Cancel init, a dismissal or 3 blank answers cancel', async () => {
    const template = memIo(memWorld({ replies: [DESCRIBED_REPLY] }), ['Use the template instead'])
    expect(await describeStep(template.io)).toEqual({ kind: 'template' })
    expect(template.prompts).toEqual([])
    const cancelledBy = { kind: 'cancelled', reason: DESCRIBE_CANCELLED_REASON }
    const cancel = memIo(memWorld({ replies: [DESCRIBED_REPLY] }), ['Cancel init'])
    expect(await describeStep(cancel.io)).toEqual(cancelledBy)
    expect(cancel.prompts).toEqual([])
    expect(await describeStep(memIo(memWorld({}), []).io)).toEqual(cancelledBy)
    const blank = memIo(memWorld({ replies: [DESCRIBED_REPLY] }), ['', ' ', '  ', DESCRIPTION])
    expect(await describeStep(blank.io)).toEqual({ kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON })
    expect([blank.asked.length, blank.prompts]).toEqual([MAX_ASKS, []])
    expect(DESCRIBE_OPTIONS).toEqual(['Use the template instead', 'Cancel init'])
    expect(Object.isFrozen(DESCRIBE_OPTIONS)).toBe(true)
  })

  test('the describe question says to type the structure in the text field', () => {
    expect(DESCRIBE_QUESTION).toBe('Describe your role structure in your own words (type it in the text field).')
  })
})

describe('adjustLoop', () => {
  const roles = proposeRoles(FULL_SCAN).roles
  /** The Adjust question as it is asked while the roles are unchanged: its context names all six (D-136). */
  const ASKED = withContext(ADJUST_QUESTION, adjustContextLine(roles))

  test('one typed change per answer until Done adjusting: drop and add', async () => {
    const run = memIo(memWorld({}), ['drop fe', 'add docs "Docs writer"', 'Done adjusting'])
    const adjusted = rolesOf(await adjustLoop(run.io, roles, FRAMEWORKS))
    expect(adjusted?.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'qa', 'security', 'docs'])
    expect(adjusted?.find(role => role.id === 'docs')?.title).toBe('Docs writer')
    expect(firstLines(run.asked)).toEqual([ADJUST_QUESTION, ADJUST_QUESTION, ADJUST_QUESTION])
    expect(run.specs[0]).toEqual({ options: ['Done adjusting', 'Show the roles'], header: 'Adjust' })
  })

  test('rename and framework change one role and keep the others', async () => {
    const run = memIo(memWorld({}), ['rename be api "API"', 'framework qa gsd', 'Done adjusting'])
    const adjusted = rolesOf(await adjustLoop(run.io, roles, FRAMEWORKS))
    expect(adjusted?.map(role => role.id)).toEqual(['pm', 'tl', 'api', 'fe', 'qa', 'security'])
    expect(adjusted?.find(role => role.id === 'api')?.title).toBe('API')
    expect(adjusted?.find(role => role.id === 'qa')?.framework).toBe('gsd')
    expect(adjusted?.filter(role => role.framework !== undefined)).toHaveLength(1)
  })

  test('Done adjusting gives the adjusted roles, which the roles question still has to confirm', async () => {
    const run = memIo(memWorld({}), ['drop fe', 'Done adjusting'])
    const kept = roles.filter(role => role.id !== 'fe')
    expect(await adjustLoop(run.io, roles, FRAMEWORKS)).toEqual({ kind: 'adjusted', roles: kept })
  })

  test('a line it cannot read and a change it cannot apply each put their exact message on the next ask', async () => {
    const run = memIo(memWorld({}), ['delete fe', 'drop zz', 'Done adjusting'])
    expect(await adjustLoop(run.io, roles, FRAMEWORKS)).toEqual({ kind: 'adjusted', roles })
    expect(run.asked).toEqual([
      ASKED,
      `Could not read that change: delete fe. Use add, drop, rename or framework.\n${ASKED}`,
      `no role "zz"\n${ASKED}`,
    ])
    expect(run.logged).toEqual([])
  })

  test('Show the roles shows the current roles in the pane and asks again', async () => {
    const run = memIo(memWorld({}), ['drop fe', 'Show the roles', 'Done adjusting'])
    await adjustLoop(run.io, roles, FRAMEWORKS)
    const [shown] = run.shown
    expect(shown?.key).toBe('roles')
    expect(shown?.lines[0]).toBe('Proposed roles:')
    expect(shown?.lines.join('\n')).not.toContain('FE (fe)')
    expect(shown?.lines).not.toContain('Changes from the scan:')
    expect(run.logged).toEqual([])
  })

  test('a dismissed adjust question cancels the step with its reason (A1)', async () => {
    expect(await adjustLoop(memIo(memWorld({}), ['drop fe']).io, roles, FRAMEWORKS)).toEqual({
      kind: 'cancelled',
      reason: ADJUST_DISMISSED_REASON,
    })
    expect(ADJUST_DISMISSED_REASON).toBe('The Adjust question was dismissed.')
  })

  test('after 30 answers without Done adjusting the roles so far go back with a note, not accepted (A1)', async () => {
    const answers = ['drop fe', ...Array.from({ length: 30 }, () => 'delete fe')]
    const run = memIo(memWorld({}), answers)
    const kept = roles.filter(role => role.id !== 'fe')
    expect(await adjustLoop(run.io, roles, FRAMEWORKS)).toEqual({ kind: 'adjusted', roles: kept })
    expect(run.asked).toHaveLength(MAX_ADJUST_ROUNDS)
    expect(MAX_ADJUST_ROUNDS).toBe(30)
    expect(run.logged).toEqual([ADJUST_ROUNDS_NOTE])
    expect(run.shown).toEqual([{ key: 'notes', title: 'Notes', lines: [ADJUST_ROUNDS_NOTE] }])
    expect(ADJUST_ROUNDS_NOTE).toBe(
      'Adjust took 30 answers without "Done adjusting": showing the roles as they are now.',
    )
  })

  test('Adjust refuses a framework not installed, names the installed ones, and the role keeps its own', async () => {
    const run = memIo(memWorld({}), ['framework qa superpowers', 'Done adjusting'])
    expect(await adjustLoop(run.io, roles, ['gsd', 'none'])).toEqual({ kind: 'adjusted', roles })
    const refusal =
      'Cannot set qa to superpowers: it is not installed for this repo (installed: GSD, none (built-in)). ' +
      'qa keeps its framework.'
    expect(run.asked).toEqual([ASKED, `${refusal}\n${ASKED}`])
    expect(run.logged).toEqual([])
  })

  test('Adjust applies an installed framework; a role it does not know gets the unknown-role message', async () => {
    const run = memIo(memWorld({}), ['framework qa gsd', 'framework nosuch superpowers', 'Done adjusting'])
    const adjusted = rolesOf(await adjustLoop(run.io, roles, ['gsd', 'none']))
    expect(adjusted?.find(role => role.id === 'qa')?.framework).toBe('gsd')
    expect(run.asked).toEqual([ASKED, ASKED, `no role "nosuch"\n${ASKED}`])
    expect(run.logged).toEqual([])
  })

  test('none is always installed, so a role can always be set to the built-in fallback', async () => {
    const run = memIo(memWorld({}), ['framework qa none', 'framework be gsd', 'Done adjusting'])
    const adjusted = rolesOf(await adjustLoop(run.io, roles, ['none']))
    expect(adjusted?.find(role => role.id === 'qa')?.framework).toBe('none')
    expect(adjusted?.find(role => role.id === 'be')?.framework).toBeUndefined()
    const refusal =
      'Cannot set be to gsd: it is not installed for this repo (installed: none (built-in)). be keeps its framework.'
    expect(run.asked).toEqual([ASKED, ASKED, `${refusal}\n${ASKED}`])
    expect(run.logged).toEqual([])
  })

  test('installedFrameworks lists the supported ones in use or installed, in SUPPORTED_IDS order, then none', () => {
    expect(installedFrameworks([])).toEqual(['none'])
    expect(installedFrameworks([detection('superpowers', 'installed'), detection('gsd', 'in-use')])).toEqual([
      'gsd',
      'superpowers',
      'none',
    ])
    expect(installedFrameworks([detection('gsd', 'not-found'), detection('superpowers', 'in-use')])).toEqual([
      'superpowers',
      'none',
    ])
    expect(installedFrameworks([detection('aidlc', 'unsupported'), detection('gsd', 'not-found')])).toEqual(['none'])
    expect(installedFrameworks(detectAll(AMBIGUOUS_FACTS))).toEqual(['gsd', 'superpowers', 'none'])
  })

  test('the adjust question gives an example of each change', () => {
    expect(ADJUST_QUESTION).toBe(
      'Adjust the roles: type one change, for example add docs "Docs writer", drop fe, rename be api "API", ' +
        'or framework qa gsd.',
    )
    expect(ADJUST_OPTIONS).toEqual(['Done adjusting', 'Show the roles'])
    expect(Object.isFrozen(ADJUST_OPTIONS)).toBe(true)
  })
})

describe('rolesStep', () => {
  const proposal = proposeRoles(SOURCE_SCAN)

  test('Use these roles returns the proposed roles, after the proposal lines are shown', async () => {
    const run = memIo(memWorld({}), { 'Use these roles?': 'Use these roles' })
    expect(await rolesStep(run.io, proposal, FRAMEWORKS)).toEqual({ kind: 'accepted', value: proposal })
    const lines = proposalLines(proposal.roles, proposal.changes)
    expect(run.shown).toEqual([{ key: 'roles', title: 'Roles', lines }])
    expect(run.logged).toEqual([])
    expect(run.asked).toEqual([withContext(ROLES_QUESTION, rolesContextLine(proposal.roles, proposal.changes))])
    const options = ['Use these roles', 'Adjust them', 'Describe my own structure']
    expect(run.specs[0]).toEqual({ options, header: 'Roles' })
    expect(ROLES_QUESTION).toBe('Use these roles?')
    expect(ROLES_OPTIONS).toEqual(['Use these roles', 'Adjust them', 'Describe my own structure'])
    expect(Object.isFrozen(ROLES_OPTIONS)).toBe(true)
  })

  test('a described structure goes through the model twice and is used after Use these roles', async () => {
    const answers = ['Describe my own structure', DESCRIPTION, 'Use these roles']
    const run = memIo(memWorld({ replies: ['not json', DESCRIBED_REPLY] }), answers)
    const result = await rolesStep(run.io, proposal, FRAMEWORKS)
    expect(result).toEqual({ kind: 'accepted', value: { roles: DESCRIBED_ROLES, changes: [] } })
    const roles = rolesOf(result)
    expect(run.prompts).toHaveLength(2)
    expect(run.prompts[1]).toContain('the reply is not JSON')
    expect(roles).toEqual(DESCRIBED_ROLES)
    const docs = roles?.find(role => role.id === 'docs')
    expect(docs?.hasBash).toBe(true)
    expect(docs?.autopilot.askUser).toBe(false)
    expect(firstLines(run.asked)).toEqual([ROLES_QUESTION, DESCRIBE_QUESTION, ROLES_QUESTION])
    expect(run.shown[1]?.lines).toEqual(proposalLines(DESCRIBED_ROLES, []))
  })

  test('three invalid replies print why and ask the roles question again with the template roles', async () => {
    const answers = ['Describe my own structure', DESCRIPTION, 'Use these roles']
    const run = memIo(memWorld({ replies: ['not json', 'not json', 'not json'] }), answers)
    expect(await rolesStep(run.io, proposal, FRAMEWORKS)).toEqual({ kind: 'accepted', value: proposal })
    expect(run.prompts).toHaveLength(3)
    const [reason] = run.logged
    expect(run.logged).toHaveLength(1)
    expect(reason?.startsWith('Could not use the described structure:')).toBe(true)
    expect(reason?.endsWith(FALLBACK_END)).toBe(true)
    expect(run.shown.map(block => block.key)).toEqual(['roles', 'notes', 'roles'])
    expect(run.shown[1]).toEqual({ key: 'notes', title: 'Notes', lines: run.logged })
    expect(run.shown[2]?.lines).toEqual(proposalLines(proposal.roles, proposal.changes))
    expect(firstLines(run.asked)).toEqual([ROLES_QUESTION, DESCRIBE_QUESTION, ROLES_QUESTION])
  })

  test('Use the template instead goes back to the roles question with no model call', async () => {
    const answers = ['Describe my own structure', '  ', 'Use the template instead', 'Use these roles']
    const run = memIo(memWorld({ replies: [DESCRIBED_REPLY] }), answers)
    expect(await rolesStep(run.io, proposal, FRAMEWORKS)).toEqual({ kind: 'accepted', value: proposal })
    expect(run.prompts).toEqual([])
    expect(firstLines(run.asked)).toEqual([ROLES_QUESTION, DESCRIBE_QUESTION, EMPTY_DESCRIPTION, ROLES_QUESTION])
    expect(run.asked[2]).toBe(`${EMPTY_DESCRIPTION}\n${DESCRIBE_ASKED}`)
  })

  test('the prompt holds the typed text as a JSON string and no name the scans found', async () => {
    const world = gitWorld({
      tools: [{ name: 'mcp__sentry__issues', description: 'Sentry issues', mcp: true }],
      replies: [DESCRIBED_REPLY],
    })
    const run = memIo(world, ['Describe my own structure', DESCRIPTION, 'Use these roles'])
    const gathered = await gatherScans(run.io, DEFAULT_LOCATIONS, false)
    expect(gathered.setup.mcp.map(server => server.name)).toEqual(['sentry'])
    await rolesStep(run.io, proposeRoles(gathered.repo), FRAMEWORKS)
    expect(run.prompts).toHaveLength(1)
    expect(run.prompts[0]).toContain(JSON.stringify(DESCRIPTION))
    expect(leaks(run.prompts.join('\n'), ['sentry', '/repo', '/home/u'])).toEqual([])
  })

  test('Adjust them adjusts the roles and asks the roles question again with them', async () => {
    const full = proposeRoles(FULL_SCAN)
    const answers = ['Adjust them', 'drop fe', 'add docs "Docs writer"', 'Done adjusting', 'Use these roles']
    const run = memIo(memWorld({}), answers)
    const roles = rolesOf(await rolesStep(run.io, full, FRAMEWORKS))
    expect(roles?.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'qa', 'security', 'docs'])
    expect(firstLines(run.asked).filter(question => question === ROLES_QUESTION)).toHaveLength(2)
    expect(shownBlock(run, 'roles').join('\n')).toContain('Docs writer (docs)')
  })

  test('a dismissal or 3 unreadable answers at any point cancel the step with their reason (A1)', async () => {
    const scripts: readonly (readonly [readonly string[], string])[] = [
      [[], ROLES_DISMISSED_REASON],
      [['Adjust them'], ADJUST_DISMISSED_REASON],
      [['Describe my own structure'], DESCRIBE_CANCELLED_REASON],
      [['Describe my own structure', 'Cancel init'], DESCRIBE_CANCELLED_REASON],
      [['maybe', 'maybe', 'maybe'], NO_USABLE_ANSWER_REASON],
      [['Describe my own structure', '', '', ''], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of scripts) {
      expect(await rolesStep(memIo(memWorld({}), answers).io, proposal, FRAMEWORKS)).toEqual({
        kind: 'cancelled',
        reason,
      })
    }
    expect(ROLES_DISMISSED_REASON).toBe('The roles question was dismissed or not answered.')
    expect(DESCRIBE_CANCELLED_REASON).toBe('The describe question was dismissed or cancelled.')
  })

  test('described roles in the 10th round are never used: the step cancels after 10 roles questions (A1)', async () => {
    const rounds = Array.from({ length: 9 }, () => ['Adjust them', 'Done adjusting']).flat()
    const run = memIo(memWorld({ replies: [DESCRIBED_REPLY] }), [...rounds, 'Describe my own structure', DESCRIPTION])
    const result = await rolesStep(run.io, proposal, FRAMEWORKS)
    expect(result).toEqual({ kind: 'cancelled', reason: ROLE_ROUNDS_REASON })
    expect(rolesOf(result)).toBeNull()
    expect(run.prompts).toHaveLength(1)
    expect(firstLines(run.asked).filter(question => question === ROLES_QUESTION)).toHaveLength(MAX_ROLE_ROUNDS)
    expect(MAX_ROLE_ROUNDS).toBe(10)
    expect(ROLE_ROUNDS_REASON).toBe(
      'The roles question was asked 10 times without "Use these roles": nothing was chosen.',
    )
  })

  test('a 10th round of Adjust them and Done adjusting cancels too: no cap ever accepts the roles (A1)', async () => {
    const answers = Array.from({ length: 11 }, () => ['Adjust them', 'Done adjusting']).flat()
    const run = memIo(memWorld({}), answers)
    expect(await rolesStep(run.io, proposal, FRAMEWORKS)).toEqual({ kind: 'cancelled', reason: ROLE_ROUNDS_REASON })
    expect(firstLines(run.asked).filter(question => question === ROLES_QUESTION)).toHaveLength(10)
  })

  test('the Adjust cap shows the roles so far and asks the roles question again; Use these roles accepts', async () => {
    const full = proposeRoles(FULL_SCAN)
    const answers = ['Adjust them', 'drop fe', ...Array.from({ length: 29 }, () => 'delete fe'), 'Use these roles']
    const run = memIo(memWorld({}), answers)
    const { io, events } = withEvents(run)
    const kept = full.roles.filter(role => role.id !== 'fe')
    expect(await rolesStep(io, full, FRAMEWORKS)).toEqual({
      kind: 'accepted',
      value: { roles: kept, changes: full.changes },
    })
    expect(firstLines(run.asked).filter(question => question === ROLES_QUESTION)).toHaveLength(2)
    const noteAt = events.indexOf(`log ${ADJUST_ROUNDS_NOTE}`)
    expect(noteAt > 0 && events[noteAt + 1] === 'show notes' && events[noteAt + 2] === 'show roles').toBe(true)
    expect(shownBlock(run, 'roles')).toEqual(proposalLines(kept, full.changes))
  })

  test('the Adjust cap is not acceptance: a dismissed roles question after it cancels the step', async () => {
    const full = proposeRoles(FULL_SCAN)
    const answers = ['Adjust them', 'drop fe', ...Array.from({ length: 29 }, () => 'delete fe')]
    const run = memIo(memWorld({}), answers)
    expect(await rolesStep(run.io, full, FRAMEWORKS)).toEqual({ kind: 'cancelled', reason: ROLES_DISMISSED_REASON })
  })

  test('a start team is shown with its own scan changes, none for a described team (A6)', async () => {
    const run = memIo(memWorld({}), { 'Use these roles?': 'Use these roles' })
    const start: RoleProposal = { roles: DESCRIBED_ROLES, changes: [] }
    expect(await rolesStep(run.io, proposal, FRAMEWORKS, start)).toEqual({ kind: 'accepted', value: start })
    expect(run.shown).toEqual([{ key: 'roles', title: 'Roles', lines: proposalLines(DESCRIBED_ROLES, []) }])
    expect(shownBlock(run, 'roles').slice(-2)).toEqual(['Changes from the scan:', '  none'])
  })
})

/** A role with its framework set, as the framework step or an Adjust override sets it. */
function withFramework(role: RoleSpec, framework: FrameworkId): RoleSpec {
  return { ...role, framework }
}

/** The framework options when GSD and superpowers are offered: SUPPORTED_IDS order, then the built-in fallback. */
const BOTH_OPTIONS = ['GSD', 'superpowers', 'none (built-in)']

/** Facts where GSD (.planning/) and superpowers (docs/superpowers/) are both in use, so the choice is ambiguous. */
const AMBIGUOUS_FACTS: Facts = {
  ...EMPTY_FACTS,
  repoEntries: [
    { name: '.planning', kind: 'dir', isLink: false },
    { name: 'docs', kind: 'dir', isLink: false },
  ],
  docsEntries: [{ name: 'superpowers', kind: 'dir', isLink: false }],
}

describe('frameworkStep', () => {
  /** PM, Team Lead and Security: the template roles a repo with no source keeps. */
  const roles = proposeRoles(repoScan()).roles
  const ambiguous: Choice = { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }
  const installedOnly: Choice = { kind: 'installed-only', ids: ['gsd'] }
  const AMBIGUOUS_QUESTION = 'Which framework do the roles use? (asked because more than one framework is in use)'
  const INSTALLED_QUESTION =
    'Which framework do the roles use? (asked because none is in use here, but some are installed for you)'

  test('the framework labels and the question texts are fixed, with no option marked as a default', () => {
    expect(FRAMEWORK_LABELS).toEqual({ gsd: 'GSD', superpowers: 'superpowers', none: 'none (built-in)' })
    expect(Object.isFrozen(FRAMEWORK_LABELS)).toBe(true)
    expect(FRAMEWORK_QUESTION_PREFIX).toBe('Which framework do the roles use?')
    expect(FRAMEWORK_ALL_QUESTION).toBe('Framework for all roles?')
    expect(frameworkRoleQuestion({ id: 'tl', title: 'Team Lead' })).toBe('Framework for Team Lead (tl)?')
    expect(frameworkRoleQuestion({ id: 'be-api', title: 'Backend' })).toBe('Framework for Backend (be-api)?')
  })

  test('frameworkReason says why the question is asked, and what a choice that asks nothing found', () => {
    expect(frameworkReason(ambiguous)).toBe('more than one framework is in use')
    expect(frameworkReason(installedOnly)).toBe('none is in use here, but some are installed for you')
    const chosen: Choice = { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use' }
    expect(frameworkReason(chosen)).toBe('only gsd is in use')
    expect(frameworkReason({ kind: 'unsupported', ids: ['aidlc'] })).toBe(
      'only frameworks cadre does not support were found',
    )
    expect(frameworkReason({ kind: 'none' })).toBe('no framework was found')
  })

  test('with one framework in use nothing is asked, overrides stay, and that framework is the default', async () => {
    const chosen: Choice = { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use' }
    const overridden = roles.map(role => (role.id === 'tl' ? withFramework(role, 'superpowers') : role))
    const run = memIo(memWorld({}), {})
    expect(await frameworkStep(run.io, chosen, overridden)).toEqual({
      kind: 'accepted',
      value: { roles: overridden, repoDefault: 'gsd' },
    })
    expect(await frameworkStep(run.io, chosen, roles)).toEqual({
      kind: 'accepted',
      value: { roles, repoDefault: 'gsd' },
    })
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
  })

  test('ambiguous: Same for all roles asks once more and gives every role that framework, no default', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'superpowers'])
    expect(await frameworkStep(run.io, ambiguous, roles)).toEqual({
      kind: 'accepted',
      value: { roles: roles.map(role => withFramework(role, 'superpowers')), repoDefault: null },
    })
    expect(firstLines(run.asked)).toEqual([AMBIGUOUS_QUESTION, FRAMEWORK_ALL_QUESTION])
    expect(run.specs).toEqual([
      { options: ['Same for all roles', 'Per role'], header: 'Framework' },
      { options: BOTH_OPTIONS, header: 'Framework' },
    ])
  })

  test('ambiguous: Per role asks each role by title and id, in role order, with both frameworks and none', async () => {
    const run = memIo(memWorld({}), ['Per role', 'GSD', 'none (built-in)', 'superpowers'])
    const result = valueOf(await frameworkStep(run.io, ambiguous, roles))
    expect(result.roles.map(role => role.framework)).toEqual(['gsd', 'none', 'superpowers'])
    expect(result.repoDefault).toBeNull()
    expect(firstLines(run.asked)).toEqual([
      AMBIGUOUS_QUESTION,
      'Framework for PM (pm)?',
      'Framework for Team Lead (tl)?',
      'Framework for Security (security)?',
    ])
    const each = { options: BOTH_OPTIONS, header: 'Framework' }
    expect(run.specs.slice(1)).toEqual([each, each, each])
  })

  test('installed-only asks with the installed framework and none, and says why it asks', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'GSD'])
    const result = valueOf(await frameworkStep(run.io, installedOnly, roles))
    expect(result.roles.map(role => role.framework)).toEqual(['gsd', 'gsd', 'gsd'])
    expect(firstLines(run.asked)).toEqual([INSTALLED_QUESTION, FRAMEWORK_ALL_QUESTION])
    expect(run.specs[1]).toEqual({ options: ['GSD', 'none (built-in)'], header: 'Framework' })
  })

  test('a typed framework that is not offered is asked again with why on top; an offered id counts', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'superpowers', ' NONE '])
    const result = valueOf(await frameworkStep(run.io, installedOnly, roles))
    expect(result.roles.map(role => role.framework)).toEqual(['none', 'none', 'none'])
    const refusal = "'superpowers' isn't one of: GSD, none - a role runs one framework."
    const all = withContext(FRAMEWORK_ALL_QUESTION, teamContextLine(roles))
    expect(firstLines(run.asked)[0]).toBe(INSTALLED_QUESTION)
    expect(run.asked.slice(1)).toEqual([all, `${refusal}\n${all}`])
  })

  test('a dismissed or unread framework question is never a choice: the step is cancelled (A1)', async () => {
    const scripts: readonly (readonly [readonly string[], string])[] = [
      [[], FRAMEWORK_DISMISSED_REASON],
      [['Same for all roles'], FRAMEWORK_DISMISSED_REASON],
      [['Per role', 'GSD'], FRAMEWORK_DISMISSED_REASON],
      [['what', 'ever', 'else'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of scripts) {
      const run = memIo(memWorld({}), answers)
      expect(await frameworkStep(run.io, ambiguous, roles)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(FRAMEWORK_DISMISSED_REASON).toBe('A framework question was dismissed or not answered.')
  })

  test('unsupported and none ask nothing and give the built-in default; unsupported says what was found', async () => {
    const unsupported: Choice = { kind: 'unsupported', ids: ['aidlc'] }
    const builtIn = { kind: 'accepted', value: { roles, repoDefault: 'none' } }
    const run = memIo(memWorld({}), {})
    expect(await frameworkStep(run.io, unsupported, roles)).toEqual(builtIn)
    expect(run.logged).toEqual([choiceLine(unsupported)])
    expect(run.shown).toEqual([{ key: 'notes', title: 'Notes', lines: [choiceLine(unsupported)] }])
    const none = memIo(memWorld({}), {})
    expect(await frameworkStep(none.io, { kind: 'none' }, roles)).toEqual(builtIn)
    expect(none.asked).toEqual([])
    expect(none.logged).toEqual([])
  })

  test('options keep SUPPORTED_IDS order then none for each role, 2 to 4 of them, in any choice order', async () => {
    const reversed: Choice = { kind: 'ambiguous', ids: ['superpowers', 'gsd'] }
    const run = memIo(memWorld({}), ['Per role', 'GSD', 'GSD', 'GSD'])
    await frameworkStep(run.io, reversed, roles)
    const each = { options: BOTH_OPTIONS, header: 'Framework' }
    expect(run.specs.slice(1)).toEqual([each, each, each])
    for (const spec of run.specs) {
      expect(spec.options.length).toBeGreaterThanOrEqual(2)
      expect(spec.options.length).toBeLessThanOrEqual(4)
      expect(spec.options.some(option => option.includes('(default)'))).toBe(false)
    }
  })

  test("resolvedFramework is the role's own framework, else the repo default, else none", () => {
    const [role] = roles
    if (role === undefined) throw new Error('no template role')
    expect(resolvedFramework(withFramework(role, 'superpowers'), 'gsd')).toBe('superpowers')
    expect(resolvedFramework(role, 'gsd')).toBe('gsd')
    expect(resolvedFramework(role, null)).toBe('none')
  })
})

describe('runInit framework and recommendations', () => {
  test('with nothing detected no framework is asked and the GSD and superpowers lines are shown', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    expect(run.asked.some(question => question.startsWith(FRAMEWORK_QUESTION_PREFIX))).toBe(false)
    const at = events.indexOf('show recommendations')
    expect(at >= 0 && at < events.indexOf('ask Git policy for .cadre/?')).toBe(true)
    const lines = shownBlock(run, 'recommendations')
    expect(lines[0]).toBe('Recommendations (print-only; init asks before it installs any):')
    expect(lines.some(line => line.startsWith('- GSD for all roles: '))).toBe(true)
    expect(lines.some(line => line.startsWith('- superpowers for all roles: '))).toBe(true)
  })

  test('the recommendations are those of recommend for the roles on the built-in framework', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const scan = await scanRepo(memIo(gitWorld(), {}).io, '/repo')
    const ctx = { root: '/repo', givenRoot: '/repo', home: '/home/u', configDir: null }
    const setup = await scanSetup(memIo(gitWorld(), {}).io, ctx, false)
    const roles = proposeRoles(scan).roles
    const frameworks = roles.map((): FrameworkId => 'none')
    const expected = recommendationLines(recommend({ roles, frameworks, scan, setup }), roles)
    expect(shownBlock(run, 'recommendations')).toEqual(expected)
  })

  test('with two frameworks in use the framework question follows the roles; no framework is recommended', async () => {
    const run = memIo(gitWorld({ facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } }), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const rolesAt = events.indexOf(`ask ${ROLES_QUESTION}`)
    const frameworkAt = events.indexOf(
      'ask Which framework do the roles use? (asked because more than one framework is in use)',
    )
    expect(rolesAt).toBeGreaterThanOrEqual(0)
    expect(frameworkAt).toBeGreaterThan(rolesAt)
    expect(events[frameworkAt + 1]).toBe(`ask ${FRAMEWORK_ALL_QUESTION}`)
    const recommended = shownBlock(run, 'recommendations').join('\n')
    expect(recommended.startsWith('Recommendations')).toBe(true)
    expect(recommended).not.toContain('- GSD for all roles')
    expect(recommended).not.toContain('- superpowers for all roles')
  })

  test('in init an Adjust framework that the repo does not have installed is refused (A5)', async () => {
    const gsdOnly: Facts = { ...EMPTY_FACTS, repoEntries: [{ name: '.planning', kind: 'dir', isLink: false }] }
    const answers = [
      'No, skip it',
      'Adjust them',
      'framework security superpowers',
      'Done adjusting',
      'Use these roles',
      'Commit definitions (default)',
    ]
    const run = memIo(gitWorld({ facts: { facts: gsdOnly, gsdUserDir: null } }), answers)
    await runInit(run.io, { dryRun: true })
    const refusal =
      'Cannot set security to superpowers: it is not installed for this repo (installed: GSD, none (built-in)). ' +
      'security keeps its framework.'
    expect(run.asked.some(question => question.startsWith(`${refusal}\n${ADJUST_QUESTION}\n`))).toBe(true)
    expect(run.logged).not.toContain(refusal)
  })

  test('a dismissed framework question cancels init and prints why (A1)', async () => {
    const kept = Object.entries(INIT_ANSWERS).filter(([key]) => !key.startsWith('Which framework'))
    const answers = Object.fromEntries(kept)
    const run = memIo(gitWorld({ facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } }), answers)
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(FRAMEWORK_DISMISSED_REASON))
    expect(run.logged.at(-1)).toBe(FRAMEWORK_DISMISSED_REASON)
  })
})

/** The INIT_ANSWERS without the answer for one question prefix, so that question is dismissed. */
function answersWithout(prefix: string): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(INIT_ANSWERS).filter(([key]) => key !== prefix))
}

describe('durationStep', () => {
  /** PM, Team Lead and Security: the team the duration is asked for. */
  const roles = proposeRoles(repoScan()).roles
  /** The duration question as it is asked: the question, then the ids it applies to (D-136). */
  const ASKED = withContext(DURATION_QUESTION, durationContextLine(roles))

  test('the duration question offers 4h first, then 2h and 8h, and the list is frozen', () => {
    expect(DURATION_QUESTION).toBe('Autopilot duration for roles?')
    expect(DURATION_OPTIONS).toEqual(['4h', '2h', '8h'])
    expect(Object.isFrozen(DURATION_OPTIONS)).toBe(true)
  })

  test('a chosen or typed duration in autopilot grammar is taken, trimmed and lowercased', async () => {
    const cases: readonly (readonly [string, string])[] = [
      ['4h', '4h'],
      ['90m', '90m'],
      [' 8H ', '8h'],
      ['1h30M', '1h30m'],
      ['45', '45'],
    ]
    for (const [answer, duration] of cases) {
      const run = memIo(memWorld({}), [answer])
      expect(await durationStep(run.io, roles)).toEqual({ kind: 'accepted', value: duration })
      expect(run.asked).toEqual([ASKED])
      expect(run.specs).toEqual([{ options: ['4h', '2h', '8h'], header: 'Duration' }])
      expect(run.logged).toEqual([])
    }
  })

  test('zero and more than 168 hours are asked again with why on top, and a duration after them is taken', async () => {
    const run = memIo(memWorld({}), ['0', '200h', '2h'])
    expect(await durationStep(run.io, roles)).toEqual({ kind: 'accepted', value: '2h' })
    const accepts = 'a duration such as 4h, 90m or 1h30m, at most 168h'
    expect(run.asked).toEqual([
      ASKED,
      `'0' isn't one of: ${accepts}.\n${ASKED}`,
      `'200h' isn't one of: ${accepts}.\n${ASKED}`,
    ])
  })

  test('three answers outside the grammar cancel with no usable answer, and nothing is taken (A1)', async () => {
    const run = memIo(memWorld({}), ['soon', 'soon', 'soon', '4h'])
    expect(await durationStep(run.io, roles)).toEqual({ kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON })
    expect(run.asked).toHaveLength(MAX_ASKS)
    expect(run.logged).toEqual([])
  })

  test('a dismissed duration question is cancelled at once with the reason, which the step never prints', async () => {
    const run = memIo(memWorld({}), [])
    expect(await durationStep(run.io, roles)).toEqual({ kind: 'cancelled', reason: DURATION_DISMISSED_REASON })
    expect(run.asked).toEqual([ASKED])
    expect(run.logged).toEqual([])
    expect(DURATION_DISMISSED_REASON).toBe('The autopilot duration question was dismissed or not answered.')
  })

  test('init asks the duration once, after the recommendations, and a dismissed one cancels init', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const recommendedAt = events.indexOf('show recommendations')
    expect(recommendedAt).not.toBe(-1)
    expect(events.indexOf(`ask ${DURATION_QUESTION}`) > recommendedAt).toBe(true)
    expect(firstLines(run.asked).filter(question => question === DURATION_QUESTION)).toHaveLength(1)
    const dismissed = memIo(gitWorld(), answersWithout('Autopilot duration'))
    expect(await runInit(dismissed.io, { dryRun: true })).toBe(cancelledReply(DURATION_DISMISSED_REASON))
    expect(firstLines(dismissed.asked).at(-1)).toBe(DURATION_QUESTION)
    expect(dismissed.logged.at(-1)).toBe(DURATION_DISMISSED_REASON)
    expect(dismissed.logged.filter(text => text === DURATION_DISMISSED_REASON)).toHaveLength(1)
  })
})

describe('modelStep', () => {
  /** PM, Team Lead, BE, QA and Security, each with the 90m run the duration step gave them. */
  const roles = proposeRoles(SOURCE_SCAN).roles.map(role => ({
    ...role,
    autopilot: { ...role.autopilot, duration: '90m' },
  }))
  /** The one model question after `Same for all roles`, as asked: with every family and effort under it (D-136). */
  const MODEL_ALL_LINE = 'Model and effort for all roles?'
  const MODEL_ALL = withContext(MODEL_ALL_LINE, MODEL_EFFORT_CONTEXT)
  /** The first model question as asked for these five roles: their ids under it (D-136). */
  const MODE_ASKED = withContext(MODEL_MODE_QUESTION, 'Roles: pm, tl, be, qa, security.')

  test('the first model question offers Same for all roles first, then Per role', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'opus + medium'])
    await modelStep(run.io, roles)
    expect(MODEL_MODE_QUESTION).toBe('Model and effort: same for all roles, or per role?')
    expect(run.asked[0]).toBe(MODE_ASKED)
    expect(run.specs[0]).toEqual({ options: ['Same for all roles', 'Per role'], header: 'Model' })
  })

  test('Same for all roles asks once more and gives every role that model family and effort', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'sonnet + high'])
    const modelled = valueOf(await modelStep(run.io, roles))
    expect(modelled.map(role => [role.id, role.model, role.effort])).toEqual(
      roles.map(role => [role.id, 'sonnet', 'high']),
    )
    expect(run.asked).toEqual([MODE_ASKED, MODEL_ALL])
    expect(run.specs[1]).toEqual({ options: ['opus + medium', 'sonnet + medium', 'sonnet + high'], header: 'Model' })
    expect(run.logged).toEqual([])
  })

  test('Per role asks each role by its title and id in role order, each with the three options (A6)', async () => {
    const answers = ['Per role', 'opus + medium', 'sonnet + high', 'sonnet + medium', 'haiku low', 'OPUS+max']
    const run = memIo(memWorld({}), answers)
    const modelled = valueOf(await modelStep(run.io, roles))
    expect(run.asked).toEqual([
      MODE_ASKED,
      ...[
        'Model and effort for PM (pm)?',
        'Model and effort for Team Lead (tl)?',
        'Model and effort for BE (be)?',
        'Model and effort for QA (qa)?',
        'Model and effort for Security (security)?',
      ].map(question => withContext(question, MODEL_EFFORT_CONTEXT)),
    ])
    const each = { options: MODEL_EFFORT_OPTIONS, header: 'Model' }
    expect(run.specs.slice(1)).toEqual([each, each, each, each, each])
    expect(modelled.map(role => `${role.id}: ${role.model} ${role.effort}`)).toEqual([
      'pm: opus medium',
      'tl: sonnet high',
      'be: sonnet medium',
      'qa: haiku low',
      'security: opus max',
    ])
  })

  test('two roles with the same title are told apart by their ids in the per-role questions (A6)', async () => {
    const be = { ...roleIn(roles, 'be'), title: 'Backend' }
    const run = memIo(memWorld({}), ['Per role', 'opus + medium', 'sonnet + high'])
    const modelled = valueOf(await modelStep(run.io, [be, { ...be, id: 'be-api' }]))
    expect(run.asked).toEqual([
      withContext(MODEL_MODE_QUESTION, 'Roles: be, be-api.'),
      withContext('Model and effort for Backend (be)?', MODEL_EFFORT_CONTEXT),
      withContext('Model and effort for Backend (be-api)?', MODEL_EFFORT_CONTEXT),
    ])
    expect(modelled.map(role => [role.id, role.model, role.effort])).toEqual([
      ['be', 'opus', 'medium'],
      ['be-api', 'sonnet', 'high'],
    ])
  })

  test('a model that is no family alias puts the refusal line on top of the next ask (A4)', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'sonet + high', 'high high', 'opus + high'])
    const modelled = valueOf(await modelStep(run.io, roles))
    expect(modelled.map(role => [role.model, role.effort])).toEqual(roles.map(() => ['opus', 'high']))
    expect(run.asked).toEqual([
      MODE_ASKED,
      MODEL_ALL,
      `${modelEffortRefusal('sonet + high')}\n${MODEL_ALL}`,
      `${modelEffortRefusal('high high')}\n${MODEL_ALL}`,
    ])
    expect(run.logged).toEqual([])
  })

  test('MAX_ASKS refused models, a pinned id among them, cancel with no usable answer (A4, D-136)', async () => {
    const refused = ['claude-opus-5-5 high', 'opus', 'sonet high']
    const run = memIo(memWorld({}), ['Same for all roles', ...refused, 'opus + high'])
    expect(await modelStep(run.io, roles)).toEqual({ kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON })
    expect(run.asked).toEqual([
      MODE_ASKED,
      MODEL_ALL,
      `${modelEffortRefusal('claude-opus-5-5 high')}\n${MODEL_ALL}`,
      `${modelEffortRefusal('opus')}\n${MODEL_ALL}`,
    ])
    expect(run.logged).toEqual([])
  })

  test('each role keeps its duration and the threshold 65, asked nowhere, and the input is unchanged', async () => {
    const before = JSON.stringify(roles)
    const modelled = valueOf(await modelStep(memIo(memWorld({}), ['Per role', 'sonnet high']).io, roles.slice(0, 1)))
    expect(modelled.map(role => role.autopilot)).toEqual([{ duration: '90m', threshold: 65, askUser: true }])
    expect(roles.every(role => role.autopilot.threshold === AUTOPILOT_THRESHOLD)).toBe(true)
    expect(AUTOPILOT_THRESHOLD).toBe(65)
    expect(JSON.stringify(roles)).toBe(before)
  })

  test('Same for all roles gives all five roles the threshold 65, and no init question asks it (B3)', async () => {
    const all = valueOf(await modelStep(memIo(memWorld({}), ['Same for all roles', 'opus + high']).io, roles))
    expect(all.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'qa', 'security'])
    expect(all.map(role => role.autopilot.threshold)).toEqual(all.map(() => AUTOPILOT_THRESHOLD))
    const run = memIo(gitWorld(), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(run.asked.filter(question => /threshold/i.test(question))).toEqual([])
  })

  test('a dismissal or unlisted answers at any model question cancel with their reason, no roles (A1)', async () => {
    const scripts: readonly (readonly [readonly string[], string])[] = [
      [[], MODEL_DISMISSED_REASON],
      [['Same for all roles'], MODEL_DISMISSED_REASON],
      [['Per role', 'opus + medium'], MODEL_DISMISSED_REASON],
      [['nope', 'nope', 'nope'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of scripts) {
      const run = memIo(memWorld({}), answers)
      expect(await modelStep(run.io, roles)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(MODEL_DISMISSED_REASON).toBe('A model and effort question was dismissed or not answered.')
  })

  test('init asks the model questions right after the duration, and a dismissed one cancels init', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const asked = firstLines(run.asked)
    const at = asked.indexOf(DURATION_QUESTION)
    expect(asked.slice(at + 1, at + 3)).toEqual([MODEL_MODE_QUESTION, MODEL_ALL_LINE])
    const dismissed = memIo(gitWorld(), answersWithout('Model and effort for'))
    expect(await runInit(dismissed.io, { dryRun: true })).toBe(cancelledReply(MODEL_DISMISSED_REASON))
    expect(dismissed.asked.at(-1)).toBe(MODEL_ALL)
    expect(dismissed.logged.at(-1)).toBe(MODEL_DISMISSED_REASON)
  })
})

/** The role with this id in what a step gave; a missing role stops the test with a clear message. */
function roleIn(roles: readonly RoleSpec[] | null, id: string): RoleSpec {
  const found = roles?.find(role => role.id === id)
  if (found === undefined) throw new Error(`no role ${id}`)

  return found
}

/** The buttons of every question on which roles get an item. */
const ROLE_LIST_OPTIONS = ['None', 'All roles']

describe('assignmentStep', () => {
  /** PM, Team Lead, BE, FE, QA and Security: a repo with a frontend and tests keeps every template role. */
  const roles = proposeRoles(FULL_SCAN).roles
  /** jira, which the table gives to PM and TL, the unknown sentry, security-review and two codex skills. */
  const setup = emptySetupScan({
    mcp: [session('jira'), session('sentry')],
    skills: [skillRef('security-review'), skillRef('codex:rescue', 'codex'), skillRef('codex:setup', 'codex')],
  })
  const SENTRY_QUESTION = 'Which roles get the sentry MCP server? (e.g. BE, QA, or none)'
  const CODEX_QUESTION = 'Which roles get codex skills (2)? (e.g. BE, QA, or none)'
  /** The two questions as asked: the team's role ids and what giving the item means under each (D-136). */
  const SENTRY_ASKED = withContext(SENTRY_QUESTION, mcpContextLine(roles))
  const CODEX_ASKED = withContext(CODEX_QUESTION, skillsContextLine(roles))

  test('the tables decide the known names; each unknown server and skill group is asked once', async () => {
    const run = memIo(memWorld({}), ['be', 'All roles'])
    const assigned = valueOf(await assignmentStep(run.io, roles, setup))
    expect(run.asked).toEqual([SENTRY_ASKED, CODEX_ASKED])
    expect(run.specs).toEqual([
      { options: ROLE_LIST_OPTIONS, header: 'MCP' },
      { options: ROLE_LIST_OPTIONS, header: 'Skills' },
    ])
    expect(assigned.map(role => [role.id, role.mcp])).toEqual([
      ['pm', ['jira']],
      ['tl', ['jira']],
      ['be', ['sentry']],
      ['fe', []],
      ['qa', []],
      ['security', []],
    ])
    expect(roleIn(assigned, 'security').skills).toEqual(['codex:rescue', 'codex:setup', 'security-review'])
    for (const id of ['pm', 'tl', 'be', 'fe', 'qa']) {
      expect(roleIn(assigned, id).skills).toEqual(['codex:rescue', 'codex:setup'])
    }
    expect(run.logged).toEqual([])
  })

  test('a typed list of ids or titles gives the item to those roles, and None to no role', async () => {
    const run = memIo(memWorld({}), ['Team Lead, qa', 'None'])
    const assigned = valueOf(await assignmentStep(run.io, roles, setup))
    expect(roleIn(assigned, 'tl').mcp).toEqual(['jira', 'sentry'])
    expect(roleIn(assigned, 'qa').mcp).toEqual(['sentry'])
    expect(roleIn(assigned, 'pm').skills).toEqual([])
    expect(roleIn(assigned, 'security').skills).toEqual(['security-review'])
  })

  test('an answer that names a role the team does not have is asked again with why on top', async () => {
    const run = memIo(memWorld({}), ['cto', 'be', 'None'])
    const assigned = valueOf(await assignmentStep(run.io, roles, setup))
    expect(roleIn(assigned, 'be').mcp).toEqual(['sentry'])
    const refusal = `'cto' isn't one of: "None", "All roles", or role ids from: pm, tl, be, fe, qa, security.`
    expect(run.asked).toEqual([SENTRY_ASKED, `${refusal}\n${SENTRY_ASKED}`, CODEX_ASKED])
  })

  test('three unreadable answers or a dismissal cancel with their reason, and no answer is kept (A1)', async () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [['cto', 'cto', 'cto'], NO_USABLE_ANSWER_REASON],
      [[], ASSIGNMENT_DISMISSED_REASON],
      [['be'], ASSIGNMENT_DISMISSED_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await assignmentStep(run.io, roles, setup)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(ASSIGNMENT_DISMISSED_REASON).toBe(
      'A question on which roles get an MCP server or skills was dismissed or not answered.',
    )
  })

  test('infra servers and handoff and framework skills are never asked about; nothing found asks nothing', async () => {
    const quiet = emptySetupScan({
      mcp: [session('autopilot'), session('github')],
      skills: [
        skillRef('create-handoff-doc'),
        skillRef('gsd-plan-phase'),
        skillRef('superpowers:brainstorming', 'superpowers'),
      ],
    })
    const run = memIo(memWorld({}), [])
    const assigned = valueOf(await assignmentStep(run.io, roles, quiet))
    expect(run.asked).toEqual([])
    expect(roleIn(assigned, 'tl').mcp).toEqual(['github'])
    expect(assigned.flatMap(role => role.skills)).toEqual([])
    const bare = await assignmentStep(memIo(memWorld({}), []).io, roles, emptySetupScan())
    expect(bare).toEqual({ kind: 'accepted', value: roles })
  })

  test('the roles it is given are never changed', async () => {
    const before = JSON.stringify(roles)
    await assignmentStep(memIo(memWorld({}), ['All roles', 'All roles']).io, roles, setup)
    expect(JSON.stringify(roles)).toBe(before)
  })

  test('a second run with None takes sentry and the codex skills away, and the table names stay (A3)', async () => {
    const first = valueOf(await assignmentStep(memIo(memWorld({}), ['All roles', 'All roles']).io, roles, setup))
    expect(first.map(role => role.mcp.includes('sentry'))).toEqual(roles.map(() => true))
    const again = valueOf(await assignmentStep(memIo(memWorld({}), ['None', 'None']).io, first, setup))
    expect(again.map(role => [role.id, role.mcp, role.skills])).toEqual([
      ['pm', ['jira'], []],
      ['tl', ['jira'], []],
      ['be', [], []],
      ['fe', [], []],
      ['qa', [], []],
      ['security', [], ['security-review']],
    ])
  })

  test('a narrower second answer leaves an asked server on the roles it names only (A3)', async () => {
    const first = valueOf(await assignmentStep(memIo(memWorld({}), ['All roles', 'None']).io, roles, setup))
    const again = valueOf(await assignmentStep(memIo(memWorld({}), ['be', 'None']).io, first, setup))
    expect(again.filter(role => role.mcp.includes('sentry')).map(role => role.id)).toEqual(['be'])
    expect(roleIn(again, 'tl').mcp).toEqual(['jira'])
  })
})

/** The start of the entry question of the user's own skills (G-02-1b), as an answer key matches it. */
const OWN_SKILLS_ENTRY_PREFIX = 'How do you want to hand out your own skills'

/** The entry question of the user's own skills when there is one (G-02-1b), as its first line reads. */
const OWN_SKILLS_ENTRY_ONE = `${OWN_SKILLS_ENTRY_PREFIX} (1)?`

describe('history hints', () => {
  /** PM, Team Lead, BE, FE, QA and Security: a repo with a frontend and tests keeps every template role. */
  const roles = proposeRoles(FULL_SCAN).roles
  /** The unknown sentry, and three skill groups to ask about: alpha (1), codex (2) and the user's own (1). */
  const setup = emptySetupScan({
    mcp: [session('sentry')],
    skills: [
      skillRef('alpha:x', 'alpha'),
      skillRef('codex:rescue', 'codex'),
      skillRef('codex:setup', 'codex'),
      skillRef('my-skill'),
    ],
  })
  const SENTRY_QUESTION = 'Which roles get the sentry MCP server? (e.g. BE, QA, or none)'
  /**
   * The 02-07 questions in today's order: the server, the plugin groups by label, then the hand-out of the user's own
   * skills answered Whole group, which asks their group question (G-02-1b).
   */
  const PLAIN_QUESTIONS = [
    SENTRY_QUESTION,
    'Which roles get alpha skills (1)? (e.g. BE, QA, or none)',
    'Which roles get codex skills (2)? (e.g. BE, QA, or none)',
    OWN_SKILLS_ENTRY_ONE,
    'Which roles get your own skills (1)? (e.g. BE, QA, or none)',
  ]
  /** None for the server and each plugin group, then Whole group and None for the user's own skills. */
  const NONE_FOR_ALL = ['None', 'None', 'None', 'Whole group', 'None']

  test('with hints the busiest plugin group comes first, with its uses; servers first, own skills last', async () => {
    const hints = new Map([
      ['my-skill', 5],
      ['codex:rescue', 2],
      ['codex:setup', 1],
    ])
    const run = memIo(memWorld({}), NONE_FOR_ALL)
    valueOf(await assignmentStep(run.io, roles, setup, hints))
    expect(firstLines(run.asked)).toEqual([
      SENTRY_QUESTION,
      'Which roles get codex skills (2)? (used 3 times in recent sessions) (e.g. BE, QA, or none)',
      'Which roles get alpha skills (1)? (e.g. BE, QA, or none)',
      OWN_SKILLS_ENTRY_ONE,
      'Which roles get your own skills (1)? (used 5 times in recent sessions) (e.g. BE, QA, or none)',
    ])
  })

  test('without hints, or with none that count, assignmentStep asks the 02-07 questions in order', async () => {
    for (const hints of [undefined, new Map<string, number>(), new Map([['not-asked', 4]])]) {
      const run = memIo(memWorld({}), NONE_FOR_ALL)
      valueOf(await assignmentStep(run.io, roles, setup, hints))
      expect(firstLines(run.asked)).toEqual(PLAIN_QUESTIONS)
    }
  })

  test('with hints each answer still decides the whole list of the names it asks about (A3)', async () => {
    const hints = new Map([['my-skill', 5]])
    const all = ['All roles', 'All roles', 'All roles', 'Whole group', 'All roles']
    const first = valueOf(await assignmentStep(memIo(memWorld({}), all).io, roles, setup, hints))
    expect(first.every(role => role.skills.includes('my-skill') && role.skills.includes('alpha:x'))).toBe(true)
    const again = valueOf(await assignmentStep(memIo(memWorld({}), NONE_FOR_ALL).io, first, setup, hints))
    expect(again.flatMap(role => [...role.mcp, ...role.skills])).toEqual([])
  })

  test('runInit with Yes annotates the own skills group question by use; skipped, it asks as before', async () => {
    const skillCall = '{"type":"tool_use","name":"Skill","input":{"skill":"my-skill"}}'
    const commands = [
      { name: 'codex:rescue', source: 'plugin', plugin: 'codex' },
      { name: 'my-skill', source: 'user' },
    ]
    const world = historyGitWorld({ commands, files: { [`${HISTORY_DIR}/a.jsonl`]: `${skillCall}\n${skillCall}` } })
    const skillAsks = (run: MemRun): string[] =>
      firstLines(run.asked).filter(question => / skills \(\d+\)\?/.test(question))
    const whole = { ...INIT_ANSWERS, [OWN_SKILLS_ENTRY_PREFIX]: 'Whole group' }
    const scanned = memIo(world, { ...whole, [HISTORY_PREFIX]: 'Yes, scan names and counts' })
    await runInit(scanned.io, { dryRun: true })
    expect(skillAsks(scanned)).toEqual([
      'Which roles get codex skills (1)? (e.g. BE, QA, or none)',
      OWN_SKILLS_ENTRY_ONE,
      'Which roles get your own skills (1)? (used 2 times in recent sessions) (e.g. BE, QA, or none)',
    ])
    const skipped = memIo(world, whole)
    await runInit(skipped.io, { dryRun: true })
    expect(skillAsks(skipped)).toEqual([
      'Which roles get codex skills (1)? (e.g. BE, QA, or none)',
      OWN_SKILLS_ENTRY_ONE,
      'Which roles get your own skills (1)? (e.g. BE, QA, or none)',
    ])
  })

  test('the history counts reach the assignments go-back of the review too', async () => {
    const skillCall = '{"type":"tool_use","name":"Skill","input":{"skill":"my-skill"}}'
    const commands = [
      { name: 'codex:rescue', source: 'plugin', plugin: 'codex' },
      { name: 'my-skill', source: 'user' },
    ]
    const world = historyGitWorld({ commands, files: { [`${HISTORY_DIR}/a.jsonl`]: skillCall } })
    const run = queuedIo(world, {
      ...INIT_ANSWERS,
      [HISTORY_PREFIX]: 'Yes, scan names and counts',
      [OWN_SKILLS_ENTRY_PREFIX]: 'Whole group',
      'Review the plan': ['assignments', 'Confirm'],
    })
    await runInit(run.io, { dryRun: true })
    expect(between(run.asked, REVIEW_QUESTION)).toEqual([
      'Which roles get codex skills (1)? (e.g. BE, QA, or none)',
      OWN_SKILLS_ENTRY_ONE,
      'Which roles get your own skills (1)? (used 1 time in recent sessions) (e.g. BE, QA, or none)',
    ])
  })

  test('init asks and replies the same whether the history was skipped, scanned or absent (D-59)', async () => {
    const answers = { ...INIT_ANSWERS, [HISTORY_PREFIX]: 'Yes, scan names and counts' }
    const runs = [
      memIo(historyGitWorld(), INIT_ANSWERS),
      memIo(historyGitWorld(), answers),
      memIo(gitWorld(), INIT_ANSWERS),
    ]
    const replies: string[] = []
    for (const run of runs) replies.push(await runInit(run.io, { dryRun: true }))
    const asked = runs.map(run => run.asked.filter(question => !question.startsWith(HISTORY_PREFIX)))
    expect(asked[1]).toEqual(asked[0])
    expect(asked[2]).toEqual(asked[0])
    expect(replies[1]).toBe(replies[0])
    expect(replies[2]).toBe(replies[0])
    expect(replies[0]?.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
  })
})

/** The description of the own skill of the purpose tests: a text no other fixture holds (D-139). */
const UNIQUE_PURPOSE = 'UNIQUE-PURPOSE-7f3a'

/** A git repo whose one skill is the user's own my-skill, which the engine describes as UNIQUE_PURPOSE. */
function purposeWorld(over: Partial<MemWorld> = {}): MemWorld {
  return gitWorld({ commands: [{ name: 'my-skill', source: 'user', description: UNIQUE_PURPOSE }], ...over })
}

/** INIT_ANSWERS with the user's own skills handed out by the model's recommendations (G-02-1b). */
const OWN_ACCEPTED: Readonly<Record<string, string>> = {
  ...INIT_ANSWERS,
  [OWN_SKILLS_ENTRY_PREFIX]: 'Accept recommendations',
}

describe('skill purpose in init (D-139)', () => {
  test('a dry run shows the Your own skills block with each purpose before any own-skill question', async () => {
    const run = memIo(purposeWorld(), OWN_ACCEPTED)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    expect(run.shown.filter(block => block.key === 'skills').map(block => block.title)).toEqual(['Your own skills'])
    expect(shownBlock(run, 'skills')).toContain(`  my-skill: ${UNIQUE_PURPOSE}`)
    const shownAt = events.indexOf('show skills')
    const askedAt = events.findIndex(event => event.startsWith('ask ') && event.includes('your own skills'))
    expect(shownAt).toBeGreaterThan(-1)
    expect(askedAt).toBeGreaterThan(shownAt)
  })

  test('a plain init holds the purpose in memory for the pane and writes no file that holds it (T-02-66)', async () => {
    const host = memHost(hostWorld({}))
    const answers = {
      ...INIT_ANSWERS,
      [OWN_SKILLS_ENTRY_PREFIX]: 'Whole group',
      'Which roles get your own skills': 'All roles',
    }
    const run = memIo(purposeWorld(), answers)
    const reply = await runInit(run.io, { dryRun: false, host: host.io })
    expect(shownBlock(run, 'skills')).toContain(`  my-skill: ${UNIQUE_PURPOSE}`)
    const roleFiles = host.writes.filter(write => write.path.endsWith('/role.json'))
    expect(roleFiles.map(write => write.path)).toEqual([
      '/repo/.cadre/pm/role.json',
      '/repo/.cadre/security/role.json',
      '/repo/.cadre/tl/role.json',
    ])
    expect(roleFiles.filter(write => !write.text.includes('"my-skill"'))).toEqual([])
    const isHolding = (write: HostWrite): boolean =>
      write.path.includes(UNIQUE_PURPOSE) || write.text.includes(UNIQUE_PURPOSE)
    expect(host.writes.filter(isHolding)).toEqual([])
    expect(reply).not.toContain(UNIQUE_PURPOSE)
  })
})

/** The first row of the own-skills block (G-02-1b). */
const OWN_SKILLS_HEADING =
  'Skills with no plugin (a role given a skill can run it in its session; a role not given it cannot):'

/** The last row of the own-skills block when the model gave no usable recommendation (G-02-1b). */
const NO_SKILL_RECOMMENDATION = 'The model gave no usable recommendation: no role gets a skill unless you pick one.'

/**
 * A git repo with two of the user's own skills, deploy-notes described and my-skill not, and these replies of the
 * model; `over` changes the fields it names.
 */
function ownSkillsWorld(replies: readonly (string | null)[], over: Partial<MemWorld> = {}): MemWorld {
  const commands = [
    { name: 'deploy-notes', source: 'user', description: 'Write the release notes for a deploy.' },
    { name: 'my-skill', source: 'project' },
  ]

  return gitWorld({ commands, replies, ...over })
}

/** The system prompt and the prompt of a run's completion at `at`, as memIo records them. */
function completionAt(run: MemRun, at: number): { readonly system: string; readonly prompt: string } {
  const [system = '', prompt = ''] = (run.prompts[at] ?? '').split('\n---\n')

  return { system, prompt }
}

describe('skill recommendation in init (G-02-1b)', () => {
  test('a dry run asks the model once and shows the roles it recommends on each skill row', async () => {
    const run = memIo(ownSkillsWorld(['{"skills":{"S1":["security","tl"],"S2":[]}}']), OWN_ACCEPTED)
    await runInit(run.io, { dryRun: true })
    expect(run.prompts).toHaveLength(1)
    const { system, prompt } = completionAt(run, 0)
    expect(system).toContain('Answer only with JSON of the shape {"skills":{"S1":["be"]}}')
    expect(prompt.split('\n').slice(-2)).toEqual([
      'S1 | deploy-notes | Write the release notes for a deploy. | used 0 times',
      'S2 | my-skill | (no description) | used 0 times',
    ])
    expect(shownBlock(run, 'skills')).toEqual([
      OWN_SKILLS_HEADING,
      '  deploy-notes: Write the release notes for a deploy.',
      '    recommended: tl, security',
      '  my-skill: No description.',
      '    recommended: none',
    ])
  })

  test('three replies it cannot take are retried with their exact errors, then the fallback row', async () => {
    const replies = ['not json', '{"skills":{"S9":["pm"]}}', '{"skills":{"S1":"tl"}}']
    const run = memIo(ownSkillsWorld(replies), OWN_ACCEPTED)
    await runInit(run.io, { dryRun: true })
    expect(run.prompts).toHaveLength(MAX_PROPOSE_ATTEMPTS)
    expect(completionAt(run, 1).prompt.split('\n').slice(-2)).toEqual([
      'Your previous reply had these errors; fix all of them:',
      '- the reply is not JSON',
    ])
    expect(completionAt(run, 2).prompt.split('\n').at(-1)).toBe('- unknown skill "S9"')
    expect(shownBlock(run, 'skills')).toEqual([
      OWN_SKILLS_HEADING,
      '  deploy-notes: Write the release notes for a deploy.',
      '    recommended: none',
      '  my-skill: No description.',
      '    recommended: none',
      NO_SKILL_RECOMMENDATION,
    ])
  })

  test('a model that gives no text is asked three times, told so, and the block shows the fallback row', async () => {
    const run = memIo(ownSkillsWorld([]), OWN_ACCEPTED)
    await runInit(run.io, { dryRun: true })
    expect(run.prompts).toHaveLength(MAX_PROPOSE_ATTEMPTS)
    expect(completionAt(run, 2).prompt.split('\n').at(-1)).toBe('- the model gave no text')
    expect(shownBlock(run, 'skills').at(-1)).toBe(NO_SKILL_RECOMMENDATION)
  })

  test('a run with no skill of its own makes no recommendation call and shows no skills block', async () => {
    const commands = [{ name: 'codex:rescue', source: 'plugin', plugin: 'codex', description: 'Rescue.' }]
    const run = memIo(gitWorld({ commands, replies: ['{"skills":{}}'] }), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(run.prompts).toEqual([])
    expect(run.shown.map(block => block.key)).not.toContain('skills')
  })
})

/** The own-skills entry question of a hand-out of `count` skills (G-02-1b), as its first line reads. */
function ownEntry(count: number): string {
  return `${OWN_SKILLS_ENTRY_PREFIX} (${count})?`
}

/** The answers of the own-skills entry question, in the order the dialog shows them (G-02-1b). */
const OWN_ENTRY_OPTIONS = ['Accept recommendations', 'Go one by one', 'Whole group']

/** The skills row of a role's scope card in the last review block a run showed (D-133); '' with no such card. */
function cardSkills(run: MemRun, id: string): string {
  const review = shownBlock(run, 'review')
  const at = review.findIndex(line => line.startsWith('Scope card: ') && line.endsWith(`(${id})`))

  return at === -1 ? '' : (review[at + 2] ?? '')
}

describe('own skills hand-out (G-02-1b)', () => {
  /** PM, Team Lead, BE, FE, QA and Security. */
  const roles = proposeRoles(FULL_SCAN).roles
  /** A codex plugin skill, and three of the user's own skills: mid and zeta used 4 times each, alpha never. */
  const setup = emptySetupScan({
    skills: [
      skillRef('codex:rescue', 'codex'),
      { name: 'alpha', plugin: null, purpose: 'Sort the inbox.' },
      { name: 'zeta', plugin: null },
      { name: 'mid', plugin: null, purpose: 'Draft the weekly report.' },
    ],
  })
  const hints = new Map([
    ['mid', 4],
    ['zeta', 4],
  ])
  /** The recommendation in the busiest-first order: S1 mid to BE, S2 zeta to FE, S3 alpha to no role. */
  const REPLY = '{"skills":{"S1":["be"],"S2":["fe"],"S3":[]}}'
  const CODEX_QUESTION = 'Which roles get codex skills (1)? (e.g. BE, QA, or none)'
  const ENTRY_CONTEXT = '3 skills with no plugin; the pane shows what each does and the roles it is recommended for.'
  /** The one-by-one questions as asked, busiest first and then by name, each with its context line. */
  const MID_ASKED =
    'Which roles get the skill mid?\nDraft the weekly report. Used 4 times in the last 50 sessions. Recommended: be.'
  const ZETA_ASKED =
    'Which roles get the skill zeta?\nNo description. Used 4 times in the last 50 sessions. Recommended: fe.'
  const ALPHA_ASKED = 'Which roles get the skill alpha?\nSort the inbox. Recommended: none.'

  test("an own skill's purpose with no final mark gets a period in its context line (N1)", () => {
    const deploy: SkillRef = { name: 'deploy', plugin: null, purpose: 'Deploy the app' }
    expect(ownSkillContextLine(deploy, 3, [])).toBe(
      'Deploy the app. Used 3 times in the last 50 sessions. Recommended: none.',
    )
  })

  /** The user's own skills a role was given, in the order its list keeps them. */
  function ownOf(assigned: readonly RoleSpec[], id: string): readonly string[] {
    return roleIn(assigned, id).skills.filter(name => ['alpha', 'mid', 'zeta'].includes(name))
  }

  /** A run of the step on `given` with these answers and replies; the result is checked to be accepted first. */
  async function stepRun(
    answers: readonly string[],
    replies: readonly string[] = [REPLY],
    given: readonly RoleSpec[] = roles,
  ): Promise<{ readonly run: MemRun; readonly assigned: readonly RoleSpec[] }> {
    const run = memIo(memWorld({ replies }), answers)
    const result = await assignmentStep(run.io, given, setup, hints)
    expect(result.kind).toBe('accepted')

    return { run, assigned: result.kind === 'accepted' ? result.value : [] }
  }

  test('the plugin groups come first, then the entry question with its context, chip and three answers', async () => {
    const { run } = await stepRun(['None', 'Accept recommendations'])
    expect(run.asked).toEqual([
      withContext(CODEX_QUESTION, skillsContextLine(roles)),
      withContext(ownEntry(3), ENTRY_CONTEXT),
    ])
    expect(run.specs).toEqual([
      { options: ['None', 'All roles'], header: 'Skills' },
      { options: OWN_ENTRY_OPTIONS, header: 'Skills' },
    ])
  })

  test('one own skill is counted in the singular in the entry question and its context line', async () => {
    const one = emptySetupScan({ skills: [{ name: 'alpha', plugin: null }] })
    const run = memIo(memWorld({}), ['Accept recommendations'])
    expect((await assignmentStep(run.io, roles, one)).kind).toBe('accepted')
    const context = '1 skill with no plugin; the pane shows what each does and the roles it is recommended for.'
    expect(run.asked).toEqual([withContext(ownEntry(1), context)])
  })

  test('after the plugin groups the model recommends, and the pane shows the skills busiest first', async () => {
    const run = memIo(memWorld({ replies: [REPLY] }), ['None', 'Accept recommendations'])
    const { io, events } = withEvents(run)
    await assignmentStep(io, roles, setup, hints)
    expect(events).toEqual([`ask ${CODEX_QUESTION}`, 'show skills', `ask ${ownEntry(3)}`])
    expect(completionAt(run, 0).prompt.split('\n').slice(-3)).toEqual([
      'S1 | mid | Draft the weekly report. | used 4 times',
      'S2 | zeta | (no description) | used 4 times',
      'S3 | alpha | Sort the inbox. | used 0 times',
    ])
    expect(shownBlock(run, 'skills')).toEqual([
      OWN_SKILLS_HEADING,
      '  mid: Draft the weekly report.',
      '    used 4 times in the last 50 sessions; recommended: be',
      '  zeta: No description.',
      '    used 4 times in the last 50 sessions; recommended: fe',
      '  alpha: Sort the inbox.',
      '    recommended: none',
    ])
  })

  test('Accept recommendations gives each own skill its recommended roles; the plugin answer stays', async () => {
    const { run, assigned } = await stepRun(['All roles', 'Accept recommendations'])
    expect(roles.map(role => [role.id, ownOf(assigned, role.id)])).toEqual([
      ['pm', []],
      ['tl', []],
      ['be', ['mid']],
      ['fe', ['zeta']],
      ['qa', []],
      ['security', []],
    ])
    expect(assigned.filter(role => !role.skills.includes('codex:rescue'))).toEqual([])
    expect(run.asked).toHaveLength(2)
  })

  test('with no usable recommendation, Accept gives no own skill to any role', async () => {
    const { assigned } = await stepRun(['None', 'Accept recommendations'], [])
    expect(assigned.flatMap(role => role.skills)).toEqual([])
  })

  test('Go one by one asks each own skill once, busiest first, then by name: Yes, No and a role list', async () => {
    const { run, assigned } = await stepRun(['None', 'Go one by one', 'Yes', 'No', 'qa'])
    expect(run.asked.slice(2)).toEqual([MID_ASKED, ZETA_ASKED, ALPHA_ASKED])
    expect(run.specs.slice(2)).toEqual([
      { options: ['Yes', 'No'], header: 'Skill 1/3' },
      { options: ['Yes', 'No'], header: 'Skill 2/3' },
      { options: ['Yes', 'No'], header: 'Skill 3/3' },
    ])
    expect(roles.map(role => [role.id, ownOf(assigned, role.id)])).toEqual([
      ['pm', []],
      ['tl', []],
      ['be', ['mid']],
      ['fe', []],
      ['qa', ['alpha']],
      ['security', []],
    ])
  })

  test('a typed role list is read as a group answer is; an unknown role is asked again with why on top', async () => {
    const { run, assigned } = await stepRun(['None', 'Go one by one', 'cto', 'Team Lead, qa', 'No', 'No'])
    const refusal = `'cto' isn't one of: "Yes", "No", or role ids from: pm, tl, be, fe, qa, security.`
    expect(run.asked.slice(2, 4)).toEqual([MID_ASKED, `${refusal}\n${MID_ASKED}`])
    expect([ownOf(assigned, 'tl'), ownOf(assigned, 'qa'), ownOf(assigned, 'be')]).toEqual([['mid'], ['mid'], []])
  })

  test("Whole group asks today's group question for the own skills, with their uses", async () => {
    const { run, assigned } = await stepRun(['None', 'Whole group', 'All roles'])
    const own = 'Which roles get your own skills (3)? (used 8 times in recent sessions) (e.g. BE, QA, or none)'
    expect(run.asked.slice(2)).toEqual([withContext(own, skillsContextLine(roles))])
    expect(run.specs.at(-1)).toEqual({ options: ['None', 'All roles'], header: 'Skills' })
    expect(assigned.map(role => ownOf(assigned, role.id))).toEqual(roles.map(() => ['alpha', 'mid', 'zeta']))
  })

  test('a dismissal or three unreadable answers cancel with their reason at the question they hit (A1)', async () => {
    const cases: readonly (readonly [readonly string[], string, string])[] = [
      [['None'], ASSIGNMENT_DISMISSED_REASON, ownEntry(3)],
      [['None', 'zz', 'zz', 'zz'], NO_USABLE_ANSWER_REASON, ownEntry(3)],
      [['None', 'Go one by one', 'Yes'], ASSIGNMENT_DISMISSED_REASON, 'Which roles get the skill zeta?'],
      [['None', 'Go one by one', 'cto', 'cto', 'cto'], NO_USABLE_ANSWER_REASON, 'Which roles get the skill mid?'],
    ]
    for (const [answers, reason, question] of cases) {
      const run = memIo(memWorld({ replies: [REPLY] }), answers)
      expect(await assignmentStep(run.io, roles, setup, hints)).toEqual({ kind: 'cancelled', reason })
      expect([answers, run.asked.at(-1)?.includes(question)]).toEqual([answers, true])
    }
  })

  test('a second run decides the own skills again: No takes away what Accept gave (A3)', async () => {
    const first = await stepRun(['None', 'Accept recommendations'])
    expect(ownOf(first.assigned, 'be')).toEqual(['mid'])
    const again = await stepRun(['None', 'Go one by one', 'No', 'No', 'No'], [REPLY], first.assigned)
    expect(again.assigned.flatMap(role => ownOf(again.assigned, role.id))).toEqual([])
  })

  test('a team with no own skill is asked no hand-out question, and the model is not called', async () => {
    const run = memIo(memWorld({ replies: [REPLY] }), ['All roles'])
    const plugins = emptySetupScan({ skills: [skillRef('codex:rescue', 'codex')] })
    valueOf(await assignmentStep(run.io, roles, plugins, hints))
    expect(run.asked).toEqual([withContext(CODEX_QUESTION, skillsContextLine(roles))])
    expect(run.prompts).toEqual([])
  })

  test('a skill question cuts the name to 60 code points; past 12 code points the chip is just Skill', async () => {
    const names = Array.from({ length: 100 }, (_, at) => `s${String(at).padStart(3, '0')}`)
    const long = skillRef('n'.repeat(100))
    const many = emptySetupScan({ skills: [long, ...names.map(name => skillRef(name))] })
    const run = memIo(memWorld({}), ['Go one by one', ...Array.from({ length: 101 }, () => 'No')])
    expect((await assignmentStep(run.io, roles, many)).kind).toBe('accepted')
    expect(run.asked[1]?.split('\n')[0]).toBe(`Which roles get the skill ${'n'.repeat(59)}…?`)
    expect([run.specs[99]?.header, run.specs[100]?.header, run.specs[101]?.header]).toEqual([
      'Skill 99/101',
      'Skill',
      'Skill',
    ])
  })

  test('a dry run one by one: Yes gives the recommended roles, No none, and a typed qa the QA role', async () => {
    const skillCall = '{"type":"tool_use","name":"Skill","input":{"skill":"release-notes"}}'
    const world = fullWorld({
      dirs: { '/repo/.git': [], ...FULL_DIRS, [HISTORY_DIR]: [{ ...entry('a.jsonl'), mtimeMs: 1 }] },
      files: { ...FULL_FILES, [`${HISTORY_DIR}/a.jsonl`]: `${skillCall}\n${skillCall}` },
      commands: [
        { name: 'codex:rescue', source: 'plugin', plugin: 'codex' },
        { name: 'zeta', source: 'user', description: 'Tidy the zeta folder.' },
        { name: 'alpha', source: 'user' },
        { name: 'release-notes', source: 'project', description: 'Write the release notes.' },
      ],
      replies: ['{"skills":{"S1":["be","tl"],"S2":["fe"],"S3":[]}}'],
    })
    const run = memIo(world, {
      ...INIT_ANSWERS,
      [HISTORY_PREFIX]: 'Yes, scan names and counts',
      [OWN_SKILLS_ENTRY_PREFIX]: 'Go one by one',
      'Which roles get the skill release-notes': 'Yes',
      'Which roles get the skill alpha': 'No',
      'Which roles get the skill zeta': 'qa',
    })
    expect((await runInit(run.io, { dryRun: true })).split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    const lines = firstLines(run.asked)
    const at = lines.indexOf(CODEX_QUESTION)
    expect(lines.slice(at, at + 5)).toEqual([
      CODEX_QUESTION,
      ownEntry(3),
      'Which roles get the skill release-notes?',
      'Which roles get the skill alpha?',
      'Which roles get the skill zeta?',
    ])
    expect(askedOf(run, 'Which roles get the skill release-notes?')).toBe(
      'Which roles get the skill release-notes?\n' +
        'Write the release notes. Used 2 times in the last 50 sessions. Recommended: tl, be.',
    )
    expect(['pm', 'tl', 'be', 'fe', 'qa', 'security'].map(id => [id, cardSkills(run, id)])).toEqual([
      ['pm', '  skills: none'],
      ['tl', '  skills: release-notes'],
      ['be', '  skills: release-notes'],
      ['fe', '  skills: none'],
      ['qa', '  skills: zeta'],
      ['security', '  skills: none'],
    ])
  })
})

describe('memoryStep', () => {
  const roles = proposeRoles(FULL_SCAN).roles
  /** A global CLAUDE.md, one auto-memory and the project CLAUDE.md: all three groups are there. */
  const found = emptySetupScan({ hasGlobalClaudeMd: true, memoryFiles: ['a.md'], claudeMd: ['<repo>/CLAUDE.md'] })
  const GLOBAL_QUESTION =
    'Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)'
  const MEMORY_QUESTION = 'Which roles get the auto-memories for this repo (a.md)? (e.g. PM, TL, or none)'
  const PROJECT_QUESTION = 'Which roles get the project CLAUDE.md (<repo>/CLAUDE.md)? (e.g. PM, TL, or none)'
  /** A memory question as asked: the team's role ids and the never-shown promise under it (D-136). */
  const asAsked = (question: string): string => withContext(question, memoryContextLine(roles))

  test('one question per group that is there: the global CLAUDE.md, the auto-memories, the project', async () => {
    const run = memIo(memWorld({}), ['pm, tl', 'None', 'All roles'])
    const given = valueOf(await memoryStep(run.io, roles, found))
    expect(run.asked).toEqual([GLOBAL_QUESTION, MEMORY_QUESTION, PROJECT_QUESTION].map(asAsked))
    const spec = { options: ROLE_LIST_OPTIONS, header: 'Memory' }
    expect(run.specs).toEqual([spec, spec, spec])
    expect(given.map(role => [role.id, role.instructions])).toEqual([
      ['pm', ['global-claude-md', 'project-claude-md']],
      ['tl', ['global-claude-md', 'project-claude-md']],
      ['be', ['project-claude-md']],
      ['fe', ['project-claude-md']],
      ['qa', ['project-claude-md']],
      ['security', ['project-claude-md']],
    ])
    expect(run.logged).toEqual([])
  })

  test('a role keeps the groups it was given in the order global, auto-memory, project', async () => {
    const given = valueOf(await memoryStep(memIo(memWorld({}), ['None', 'be', 'BE']).io, roles, found))
    expect(roleIn(given, 'be').instructions).toEqual(['auto-memory', 'project-claude-md'])
    expect(roleIn(given, 'pm').instructions).toEqual([])
  })

  test('only the groups the scan found are asked, and with none found nothing is asked', async () => {
    const run = memIo(memWorld({}), ['qa'])
    const given = valueOf(await memoryStep(run.io, roles, emptySetupScan({ memoryFiles: ['a.md', 'b.md'] })))
    const question = 'Which roles get the auto-memories for this repo (a.md, b.md)? (e.g. PM, TL, or none)'
    expect(run.asked).toEqual([asAsked(question)])
    expect(roleIn(given, 'qa').instructions).toEqual(['auto-memory'])
    const none = memIo(memWorld({}), [])
    expect(await memoryStep(none.io, roles, emptySetupScan())).toEqual({ kind: 'accepted', value: roles })
    expect(none.asked).toEqual([])
  })

  test('an unknown role is asked again; three such answers or a dismissal cancel with their reason (A1)', async () => {
    const again = memIo(memWorld({}), ['cto', 'pm', 'None', 'None'])
    expect(roleIn(valueOf(await memoryStep(again.io, roles, found)), 'pm').instructions).toEqual(['global-claude-md'])
    const refusal = `'cto' isn't one of: "None", "All roles", or role ids from: pm, tl, be, fe, qa, security.`
    expect(again.asked).toEqual([
      asAsked(GLOBAL_QUESTION),
      `${refusal}\n${asAsked(GLOBAL_QUESTION)}`,
      asAsked(MEMORY_QUESTION),
      asAsked(PROJECT_QUESTION),
    ])
    const cases: readonly (readonly [readonly string[], string])[] = [
      [['cto', 'cto', 'cto'], NO_USABLE_ANSWER_REASON],
      [[], MEMORY_DISMISSED_REASON],
      [['pm', 'pm'], MEMORY_DISMISSED_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await memoryStep(run.io, roles, found)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(MEMORY_DISMISSED_REASON).toBe(
      'A question on which roles get instructions or memories was dismissed or not answered.',
    )
  })

  test('names only: nothing is read or listed, and the roles it is given are never changed', async () => {
    const world = memWorld({ files: { '/home/u/.claude/CLAUDE.md': 'SENTINEL_SECRET_VALUE' } })
    const run = memIo(world, ['pm', 'pm', 'pm'])
    const before = JSON.stringify(roles)
    await memoryStep(run.io, roles, found)
    expect(run.reads).toEqual([])
    expect(run.listed).toEqual([])
    expect(JSON.stringify(roles)).toBe(before)
  })
})

/** The global CLAUDE.md of the fixture user, which the parts flow reads after a yes (G-02-1f). */
const GLOBAL_CLAUDE_MD = '/home/u/.claude/CLAUDE.md'

/** The global CLAUDE.md of the parts flow: a Security section and a Git section, as the plan's dry run has it. */
const PARTS_GLOBAL = '# Security\nNever commit secrets.\n## Git\nUse signed commits.\n'

/** The model's grouping of PARTS_GLOBAL: P1 in T1 'Security rules' and P2 in T2 'Git and commits'. */
const PARTS_TOPICS_REPLY = JSON.stringify({
  topics: [
    { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
    { title: 'Git and commits', summary: 'How commits are made.', parts: ['P2'] },
  ],
})

/** The model's recommendation of the plan's dry run: T1 to security and T2 to tl, and no memory. */
const PARTS_RECOMMEND_REPLY = '{"topics":{"T1":["security"],"T2":["tl"]},"memories":{}}'

/**
 * A git repo whose user has PARTS_GLOBAL as the global CLAUDE.md, with the grouping and the recommendation replies in
 * that order; `over` changes the fields it names.
 */
function partsWorld(over: Partial<MemWorld> = {}): MemWorld {
  const replies = [PARTS_TOPICS_REPLY, PARTS_RECOMMEND_REPLY]

  return gitWorld({ files: { [GLOBAL_CLAUDE_MD]: PARTS_GLOBAL }, replies, ...over })
}

/** The start of the improver install question, which a parts hand-out with a built part asks (G-02-1f, D-141). */
const IMPROVER_INSTALL_PREFIX = 'Install claude-md-management'

/**
 * INIT_ANSWERS with the content consent answered Yes, the entry question Accept recommendations, and the improver
 * install question Not now, so a run whose user lacks claude-md-management runs no improver (D-141).
 */
const PARTS_ANSWERS: Readonly<Record<string, string>> = {
  ...INIT_ANSWERS,
  [CONTENT_QUESTION]: 'Yes, read them',
  [INSTRUCTIONS_ENTRY_QUESTION]: 'Accept recommendations',
  [IMPROVER_INSTALL_PREFIX]: 'Not now',
}

/** The whole-file question of the global CLAUDE.md (D-63), as memoryStep asks it. */
const GLOBAL_GROUP_QUESTION =
  'Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)'

/** The review rows of the plan's dry run: Security gets T1, the Team Lead T2, and PM nothing. */
const PARTS_REVIEW_ROWS = [
  'Instructions per role:',
  '  pm: none',
  privateFilesRow('pm'),
  '  tl: 1 topic: Git and commits; 0 memories',
  privateFilesRow('tl'),
  '  security: 1 topic: Security rules; 0 memories',
  privateFilesRow('security'),
  'Kept with the root session only: 0 topics, 0 memories',
]

/** A global CLAUDE.md with three sections, for the part-by-part runs (G-02-1f Part by part). */
const THREE_GLOBAL = `${PARTS_GLOBAL}## Releases\nWrite release notes.\n`

/** The model's grouping of THREE_GLOBAL: one topic per section. */
const THREE_TOPICS_REPLY = JSON.stringify({
  topics: [
    { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
    { title: 'Git and commits', summary: 'How commits are made.', parts: ['P2'] },
    { title: 'Release notes', summary: 'How releases are written up.', parts: ['P3'] },
  ],
})

/** The six-role repo of fullWorld whose user has THREE_GLOBAL, with its grouping and a recommendation per topic. */
function threePartsWorld(): MemWorld {
  return partsWorld({
    dirs: { '/repo/.git': [], ...FULL_DIRS },
    files: { ...FULL_FILES, [GLOBAL_CLAUDE_MD]: THREE_GLOBAL },
    replies: [THREE_TOPICS_REPLY, '{"topics":{"T1":["security"],"T2":["tl","be"],"T3":["pm"]},"memories":{}}'],
  })
}

/** Part by part on THREE_PARTS: Yes to the first topic, No to the second, and be and qa typed for the third. */
const PART_BY_PART_ANSWERS: Readonly<Record<string, string>> = {
  ...PARTS_ANSWERS,
  [INSTRUCTIONS_ENTRY_QUESTION]: 'Go part by part',
  'Which roles get "Security rules"': 'Yes',
  'Which roles get "Git and commits"': 'No',
  'Which roles get "Release notes"': 'be, qa',
}

/** A sentence of the global CLAUDE.md that must never be shown, asked or logged (T-02-61). */
const GLOBAL_SENTENCE = 'LEAKY-GLOBAL-SENTENCE stays with the model'

/** A sentence of the repo CLAUDE.md that must never be shown, asked or logged (T-02-61). */
const REPO_SENTENCE = 'LEAKY-REPO-SENTENCE stays with the model'

/** One CLAUDE.md of the chain as `$.fs.ancestors` gives it: its folder, its name and its text, which the scan drops. */
function ancestor(dir: string): Readonly<Record<string, unknown>> {
  return { dir, name: 'CLAUDE.md', content: REPO_SENTENCE, parts: [] }
}

/**
 * A git repo whose global CLAUDE.md holds a Security section and whose repo CLAUDE.md, in the chain, holds a Rules
 * section, each with a sentence that must never be shown; the model groups them into two topics. `over` changes the
 * fields it names.
 */
function chainWorld(over: Partial<MemWorld> = {}): MemWorld {
  const topics = [
    { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
    { title: 'Repo rules', summary: 'The rules of this repo.', parts: ['P2'] },
  ]

  return partsWorld({
    files: {
      [GLOBAL_CLAUDE_MD]: `# Security\n${GLOBAL_SENTENCE}.\n`,
      '/repo/CLAUDE.md': `# Rules\n${REPO_SENTENCE}.\n`,
    },
    ancestors: [ancestor('/repo')],
    replies: [JSON.stringify({ topics }), '{"topics":{"T1":["security"],"T2":["tl"]},"memories":{}}'],
    ...over,
  })
}

/** The first row of the instructions block (G-02-1f, AUTO-PICK #12): what a plain init writes after Confirm. */
const READ_HEADING_ROW =
  'Read for this run; a plain init writes the repo parts you hand out to .cadre/<role>/CLAUDE.md after Confirm:'

/** The instructions block of the plan's dry run (G-02-1f). */
const PARTS_BLOCK = [
  READ_HEADING_ROW,
  '  Security rules: How secrets stay out of the repo.',
  '    from: ~/.claude/CLAUDE.md > Security',
  '    recommended: security',
  '  Git and commits: How commits are made.',
  '    from: ~/.claude/CLAUDE.md > Git',
  '    recommended: tl',
]

/** The content consent context line of a world with only the global CLAUDE.md (G-02-1f). */
const GLOBAL_ONLY_FOUND =
  'Found: global CLAUDE.md yes, 0 CLAUDE.md files in the repo chain, 0 rule files, AGENTS.md no, 0 memories. ' +
  'No keeps the whole-file questions.'

/** The topics and hand-out of a parts outcome; any other outcome stops the test with its kind. */
function partsOf(handout: InstructionHandout): Extract<InstructionHandout, { readonly kind: 'parts' }> {
  if (handout.kind !== 'parts') throw new Error(`not the parts flow: ${handout.kind}`)

  return handout
}

/** The port of withEvents that also records each read, as `read <path>`, in the same list in call order. */
function withReadEvents(run: MemRun): { readonly io: InitIo; readonly events: string[] } {
  const traced = withEvents(run)
  const io: InitIo = {
    ...traced.io,
    read: async (path, maxBytes) => {
      traced.events.push(`read ${path}`)

      return traced.io.read(path, maxBytes)
    },
  }

  return { io, events: traced.events }
}

describe('instruction parts (G-02-1f)', () => {
  test('a dry run answered Yes and Accept recommendations shows the per-role topics after the cards', async () => {
    const run = memIo(partsWorld(), PARTS_ANSWERS)
    const reply = await runInit(run.io, { dryRun: true })
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    const review = shownBlock(run, 'review')
    const at = review.indexOf('Instructions per role:')
    const lastCard = review.map(line => line.startsWith('Scope card: ')).lastIndexOf(true)
    expect(review.slice(at, at + PARTS_REVIEW_ROWS.length)).toEqual(PARTS_REVIEW_ROWS)
    expect([lastCard > 0, at > lastCard, review.indexOf('File plan:')]).toEqual([true, true, at + 8])
  })

  test('the instructions block shows each topic, its sources and roles, right before the entry question', async () => {
    const run = memIo(partsWorld(), PARTS_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    expect(run.shown.filter(block => block.key === 'instructions')).toEqual([
      { key: 'instructions', title: 'Instruction parts', lines: PARTS_BLOCK },
    ])
    const entryAt = events.indexOf(`ask ${INSTRUCTIONS_ENTRY_QUESTION}`)
    expect([entryAt > 0, events[entryAt - 1]]).toEqual([true, 'show instructions'])
  })

  test('the consent and entry questions carry their context lines, No first and the Instructions chip', async () => {
    const run = memIo(partsWorld(), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const consentAt = firstLines(run.asked).indexOf(CONTENT_QUESTION)
    const entryAt = firstLines(run.asked).indexOf(INSTRUCTIONS_ENTRY_QUESTION)
    expect(run.asked[consentAt]).toBe(withContext(CONTENT_QUESTION, GLOBAL_ONLY_FOUND))
    expect(run.specs[consentAt]).toEqual({ options: ['No, skip it', 'Yes, read them'], header: 'Instructions' })
    const entryContext =
      '2 topics from 1 file and 0 memories; the pane shows each with the roles it is recommended for.'
    expect(run.asked[entryAt]).toBe(withContext(INSTRUCTIONS_ENTRY_QUESTION, entryContext))
    const options = ['Accept recommendations', 'Go part by part', 'Whole files']
    expect(run.specs[entryAt]).toEqual({ options, header: 'Instructions' })
  })

  test('no instruction file is read before the content consent answer; the global file once (T-02-60)', async () => {
    const run = memIo(partsWorld(), PARTS_ANSWERS)
    const { io, events } = withReadEvents(run)
    await runInit(io, { dryRun: true })
    const consentAt = events.indexOf(`ask ${CONTENT_QUESTION}`)
    const readAt = events.indexOf(`read ${GLOBAL_CLAUDE_MD}`)
    expect([consentAt > 0, readAt > consentAt]).toEqual([true, true])
    expect(run.reads.filter(path => path === GLOBAL_CLAUDE_MD)).toHaveLength(1)
  })

  test('the grouping prompt holds the parts; the recommendation prompt holds the roles and the topics', async () => {
    const run = memIo(partsWorld(), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const [grouping = '', recommending = ''] = run.prompts
    expect(run.prompts).toHaveLength(2)
    expect(grouping.startsWith(`${TOPICS_SYSTEM}\n---\n`)).toBe(true)
    expect(grouping).toContain('P1 | ~/.claude/CLAUDE.md | Security | # Security Never commit secrets.')
    expect(grouping).toContain('P2 | ~/.claude/CLAUDE.md | Git | ## Git Use signed commits.')
    expect(recommending.startsWith(`${RECOMMEND_SYSTEM}\n---\n`)).toBe(true)
    expect(recommending).toContain('T1 | Security rules | How secrets stay out of the repo.')
    expect(recommending).toContain('security | Security | ')
  })

  test('No, skip it reads nothing, calls no model and asks the whole-file questions unchanged (D-63)', async () => {
    const run = memIo(partsWorld(), PARTS_DECLINED)
    const reply = await runInit(run.io, { dryRun: true })
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    const asked = firstLines(run.asked)
    expect(asked).toContain(CONTENT_QUESTION)
    expect(asked.indexOf(GLOBAL_GROUP_QUESTION)).toBeGreaterThan(asked.indexOf(CONTENT_QUESTION))
    expect(run.reads).not.toContain(GLOBAL_CLAUDE_MD)
    expect(run.prompts).toEqual([])
    expect(run.shown.map(block => block.key)).not.toContain('instructions')
    expect(shownBlock(run, 'review')).not.toContain('Instructions per role:')
  })

  test('option 0 of the content consent never consents: a dry run answering it reads no instruction file', async () => {
    const [first = 'missing'] = CONTENT_OPTIONS
    expect(parseContentConsent(first)).toBe(false)
    const run = memIo(partsWorld(), { ...PARTS_ANSWERS, [CONTENT_QUESTION]: first })
    await runInit(run.io, { dryRun: true })
    expect(run.reads).not.toContain(GLOBAL_CLAUDE_MD)
    expect(firstLines(run.asked)).toContain(GLOBAL_GROUP_QUESTION)
  })

  test('a repo with only memories gets the step; a yes hands them out with no grouping call', async () => {
    const memory = '/home/u/.claude/projects/-repo/memory'
    const world = gitWorld({
      dirs: { '/repo/.git': [], [memory]: [entry('notes.md')] },
      files: { [`${memory}/notes.md`]: 'SENTINEL_SECRET_VALUE' },
      replies: ['{"topics":{},"memories":{"M1":["tl"]}}'],
    })
    const run = memIo(world, PARTS_ANSWERS)
    const reply = await runInit(run.io, { dryRun: true })
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    const found =
      'Found: global CLAUDE.md no, 0 CLAUDE.md files in the repo chain, 0 rule files, AGENTS.md no, 1 memory. ' +
      'No keeps the whole-file questions.'
    expect(run.asked).toContain(withContext(CONTENT_QUESTION, found))
    const entryContext = '0 topics from 0 files and 1 memory; the pane shows each with the roles it is recommended for.'
    expect(run.asked).toContain(withContext(INSTRUCTIONS_ENTRY_QUESTION, entryContext))
    const memories = 'Which roles get the auto-memories for this repo (notes.md)? (e.g. PM, TL, or none)'
    expect(firstLines(run.asked)).not.toContain(memories)
    expect(run.prompts).toHaveLength(1)
    expect(run.prompts[0]?.startsWith(`${RECOMMEND_SYSTEM}\n---\n`)).toBe(true)
    expect(run.prompts[0]).toContain('M1 | notes.md | No summary in MEMORY.md.')
    expect(run.prompts.join('\n')).not.toContain('SENTINEL_SECRET_VALUE')
    expect(shownBlock(run, 'review')).toContain('  tl: 0 topics; 1 memory')
  })

  test('a repo with nothing to hand out asks no content consent and leaves every role no group', async () => {
    const run = memIo(gitWorld(), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(firstLines(run.asked)).not.toContain(CONTENT_QUESTION)
    const roles = [templateRole('pm', { instructions: ['global-claude-md'] })]
    const none = await instructionsStep(memIo(memWorld({}), []).io, roles, emptySetupScan(), DEFAULT_LOCATIONS)
    expect(none).toEqual({
      kind: 'accepted',
      value: { roles: [templateRole('pm')], instructions: { kind: 'none' } },
    })
  })

  test('the parts flow gives every role no instruction group and keeps the hand-out in memory only', async () => {
    const run = memIo(partsWorld(), PARTS_ANSWERS)
    const setup = emptySetupScan({ hasGlobalClaudeMd: true })
    const groups: readonly InstructionGroup[] = ['auto-memory']
    const roles = proposeRoles(repoScan()).roles.map(role => ({ ...role, instructions: groups }))
    const value = valueOf(await instructionsStep(run.io, roles, setup, DEFAULT_LOCATIONS))
    expect(value.roles.map(role => role.instructions)).toEqual([[], [], []])
    const handout = partsOf(value.instructions)
    expect(handout.topics.map(topic => topic.title)).toEqual(['Security rules', 'Git and commits'])
    expect([...handout.given.entries()]).toEqual([
      ['T1', ['security']],
      ['T2', ['tl']],
    ])
    expect([...handout.recommended.entries()]).toEqual([...handout.given.entries()])
    expect(handout.scan.files).toEqual(['~/.claude/CLAUDE.md'])
    expect(handout.scan.parts.map(part => [part.id, part.file, part.heading, part.source])).toEqual([
      ['P1', '~/.claude/CLAUDE.md', 'Security', 'global'],
      ['P2', '~/.claude/CLAUDE.md', 'Git', 'global'],
    ])
  })

  test('a dismissed content consent cancels init with its reason, having read nothing (A1)', async () => {
    const answers = Object.fromEntries(Object.entries(PARTS_ANSWERS).filter(([key]) => key !== CONTENT_QUESTION))
    const run = memIo(partsWorld(), answers)
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(CONTENT_DISMISSED_REASON))
    expect(firstLines(run.asked).at(-1)).toBe(CONTENT_QUESTION)
    expect(run.logged.at(-1)).toBe(CONTENT_DISMISSED_REASON)
    expect(run.reads).not.toContain(GLOBAL_CLAUDE_MD)
  })

  test('each model call is retried with its exact errors, up to 3 calls, then falls back (G-02-1f)', async () => {
    const run = memIo(partsWorld({ replies: ['nope', 'still nope', null, '{}', '[]', 'no'] }), PARTS_ANSWERS)
    const reply = await runInit(run.io, { dryRun: true })
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(run.prompts).toHaveLength(6)
    expect(run.prompts[1]?.endsWith('\n- the reply is not JSON')).toBe(true)
    expect(run.prompts[3]?.startsWith(`${RECOMMEND_SYSTEM}\n---\n`)).toBe(true)
    // With no memory to name, a reply with no memories object is not an error (02-GAPS-B2 N14).
    expect(run.prompts[4]?.endsWith('\n- the reply has no "topics" object')).toBe(true)
    expect(run.prompts[4]).not.toContain('"memories" object')
    const block = shownBlock(run, 'instructions')
    expect(block.slice(1, 4)).toEqual([
      '  ~/.claude/CLAUDE.md: All of ~/.claude/CLAUDE.md',
      '    from: ~/.claude/CLAUDE.md > Security',
      '    from: ~/.claude/CLAUDE.md > Git',
    ])
    expect(block.slice(-2)).toEqual([
      'The model gave no usable recommendation: no role gets a part unless you pick one.',
      'The model could not group the parts: each file is one topic.',
    ])
    const review = shownBlock(run, 'review')
    const at = review.indexOf('Instructions per role:')
    expect(review.slice(at, at + 8)).toEqual([
      'Instructions per role:',
      '  pm: none',
      privateFilesRow('pm'),
      '  tl: none',
      privateFilesRow('tl'),
      '  security: none',
      privateFilesRow('security'),
      'Kept with the root session only: 1 topic, 0 memories',
    ])
  })

  test('a call that fails once and then works uses the second reply and its retry carries the errors', async () => {
    const replies = ['nope', PARTS_TOPICS_REPLY, PARTS_RECOMMEND_REPLY]
    const run = memIo(partsWorld({ replies }), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(run.prompts).toHaveLength(3)
    expect(run.prompts[1]?.endsWith('\n- the reply is not JSON')).toBe(true)
    expect(shownBlock(run, 'instructions')).toEqual(PARTS_BLOCK)
  })

  test('Go part by part with Yes, No and be, qa: first topic its roles, the second none, the third two', async () => {
    const run = memIo(threePartsWorld(), PART_BY_PART_ANSWERS)
    const reply = await runInit(run.io, { dryRun: true })
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    const review = shownBlock(run, 'review')
    const at = review.indexOf('Instructions per role:')
    expect(review.slice(at, at + 14)).toEqual([
      'Instructions per role:',
      '  pm: none',
      privateFilesRow('pm'),
      '  tl: none',
      privateFilesRow('tl'),
      '  be: 1 topic: Release notes; 0 memories',
      privateFilesRow('be'),
      '  fe: none',
      privateFilesRow('fe'),
      '  qa: 1 topic: Release notes; 0 memories',
      privateFilesRow('qa'),
      '  security: 1 topic: Security rules; 0 memories',
      privateFilesRow('security'),
      'Kept with the root session only: 1 topic, 0 memories',
    ])
  })

  test('each topic is asked once, in order, with its context line, its Topic i/n chip and Yes / No', async () => {
    const run = memIo(threePartsWorld(), PART_BY_PART_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const topics = run.asked.filter(question => question.startsWith('Which roles get "'))
    expect(topics).toEqual([
      withContext(
        'Which roles get "Security rules"?',
        'How secrets stay out of the repo. Recommended: security. From: ~/.claude/CLAUDE.md > Security.',
      ),
      withContext(
        'Which roles get "Git and commits"?',
        'How commits are made. Recommended: tl, be. From: ~/.claude/CLAUDE.md > Git.',
      ),
      withContext(
        'Which roles get "Release notes"?',
        'How releases are written up. Recommended: pm. From: ~/.claude/CLAUDE.md > Releases.',
      ),
    ])
    const at = run.asked.indexOf(topics[0] ?? 'missing')
    expect(run.specs.slice(at, at + 3)).toEqual(
      ['Topic 1/3', 'Topic 2/3', 'Topic 3/3'].map(header => ({ options: ['Yes', 'No'], header })),
    )
  })

  test('Whole files asks the whole-file questions unchanged and hands out whole (D-63)', async () => {
    const run = memIo(partsWorld(), { ...PARTS_ANSWERS, [INSTRUCTIONS_ENTRY_QUESTION]: 'Whole files' })
    await runInit(run.io, { dryRun: true })
    const asked = firstLines(run.asked)
    expect(asked.indexOf(GLOBAL_GROUP_QUESTION)).toBe(asked.indexOf(INSTRUCTIONS_ENTRY_QUESTION) + 1)
    expect(shownBlock(run, 'review')).not.toContain('Instructions per role:')
    const answers = { ...PARTS_ANSWERS, [INSTRUCTIONS_ENTRY_QUESTION]: 'Whole files', 'Which roles get': 'pm' }
    const setup = emptySetupScan({ hasGlobalClaudeMd: true })
    const roles = proposeRoles(repoScan()).roles
    const io = memIo(partsWorld(), answers).io
    const value = valueOf(await instructionsStep(io, roles, setup, DEFAULT_LOCATIONS))
    expect(value.instructions).toEqual({ kind: 'whole' })
    expect(value.roles.map(role => role.instructions)).toEqual([['global-claude-md'], [], []])
  })

  test('the review item memory goes back to the entry question with the same parts, no read, no call', async () => {
    const run = queuedIo(partsWorld(), {
      ...PARTS_ANSWERS,
      [INSTRUCTIONS_ENTRY_QUESTION]: ['Accept recommendations', 'Go part by part'],
      'Review the plan': ['memory', 'Confirm'],
    })
    expect((await runInit(run.io, { dryRun: true })).split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(between(run.asked, REVIEW_QUESTION)).toEqual([
      INSTRUCTIONS_ENTRY_QUESTION,
      'Which roles get "Security rules"?',
      'Which roles get "Git and commits"?',
    ])
    expect([run.reads.filter(path => path === GLOBAL_CLAUDE_MD).length, run.prompts.length]).toEqual([1, 2])
    expect(run.shown.filter(block => block.key === 'instructions')).toHaveLength(2)
    expect(shownBlock(run, 'review')).toContain('Kept with the root session only: 2 topics, 0 memories')
  })

  test('the review item memory after No, or with nothing to hand out, asks as before', async () => {
    const declined = queuedIo(partsWorld(), { ...PARTS_DECLINED, 'Review the plan': ['memory', 'Confirm'] })
    await runInit(declined.io, { dryRun: true })
    expect(between(declined.asked, REVIEW_QUESTION)).toEqual([GLOBAL_GROUP_QUESTION])
    const empty = queuedIo(gitWorld(), { ...PARTS_ANSWERS, 'Review the plan': ['memory', 'Confirm'] })
    await runInit(empty.io, { dryRun: true })
    expect(between(empty.asked, REVIEW_QUESTION)).toEqual([])
  })

  test('the repo chain is read after the global file, and its parts are named by their repo path', async () => {
    const run = memIo(chainWorld(), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    // The plan also reads the path of each built role file, to classify it against the disk (G-02-1f, PLAN-04).
    const instructionReads = run.reads.filter(path => path.endsWith('CLAUDE.md') && !path.includes('/.cadre/'))
    expect(instructionReads).toEqual([GLOBAL_CLAUDE_MD, '/repo/CLAUDE.md'])
    expect(run.prompts[0]).toContain('P2 | CLAUDE.md | Rules | # Rules')
    expect(shownBlock(run, 'instructions')).toContain('    from: CLAUDE.md > Rules')
  })

  test('the content consent counts the global file and the chain files the scan found', async () => {
    const run = memIo(chainWorld({ ancestors: [ancestor('/home/u/work'), ancestor('/repo')] }), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const found =
      'Found: global CLAUDE.md yes, 2 CLAUDE.md files in the repo chain, 0 rule files, AGENTS.md no, 0 memories. ' +
      'No keeps the whole-file questions.'
    expect(run.asked).toContain(withContext(CONTENT_QUESTION, found))
  })

  test('instruction text never reaches a question, a log line, the pane or the reply (T-02-61)', async () => {
    const answers = { ...PARTS_ANSWERS, [INSTRUCTIONS_ENTRY_QUESTION]: 'Go part by part' }
    const run = memIo(chainWorld(), answers)
    const reply = await runInit(run.io, { dryRun: true })
    expect(firstLines(run.asked)).toContain('Which roles get "Repo rules"?')
    const shown = [
      ...run.asked,
      ...run.specs.flatMap(spec => [...spec.options, spec.header ?? '']),
      ...run.logged,
      ...paneText(run),
      reply,
    ].join('\n')
    expect(leaks(shown, [GLOBAL_SENTENCE, REPO_SENTENCE])).toEqual([])
    expect(leaks(run.prompts[0] ?? '', [GLOBAL_SENTENCE, REPO_SENTENCE])).toEqual([GLOBAL_SENTENCE, REPO_SENTENCE])
  })

  test('every read warning is a row of the instructions block, after the topics', async () => {
    const world = chainWorld({
      ancestors: [ancestor('/home/u/work'), ancestor('/repo')],
      files: { [GLOBAL_CLAUDE_MD]: '# G\n@./big.md\n', '/home/u/.claude/big.md': `# Big\n${'x'.repeat(300 * 1024)}` },
      unknownPaths: ['/repo/CLAUDE.md'],
      replies: [
        '{"topics":[{"title":"General","summary":"The general rules.","parts":["P1"]}]}',
        '{"topics":{"T1":["tl"]},"memories":{}}',
      ],
    })
    const run = memIo(world, PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(shownBlock(run, 'instructions')).toEqual([
      READ_HEADING_ROW,
      '  General: The general rules.',
      '    from: ~/.claude/CLAUDE.md > G',
      '    recommended: tl',
      'warning: ~/.claude/big.md is over 256 KiB, not split: no role gets it',
      'warning: could not read CLAUDE.md: no role gets it',
    ])
  })
})

/** The rules folder of the fixture repo, which init lists by name before the content consent (G-02-1f Sources). */
const RULES_DIR = '/repo/.claude/rules'

/** A sentence of a rule file that must never be shown, asked or logged (T-02-61). */
const RULE_SENTENCE = 'LEAKY-RULE-SENTENCE stays with the model'

/** A sentence of a doc a repo file links to that must never be shown, asked or logged (T-02-65). */
const DOC_SENTENCE = 'LEAKY-DOC-SENTENCE stays with the model'

/**
 * A git repo whose only instruction file is the rule file `.claude/rules/security.md` with a Secrets section, as the
 * plan's dry run has it; the model groups it into one topic recommended to Security. `over` changes the fields it
 * names.
 */
function rulesWorld(over: Partial<MemWorld> = {}): MemWorld {
  return gitWorld({
    dirs: { '/repo/.git': [], [RULES_DIR]: [entry('security.md')] },
    files: { [`${RULES_DIR}/security.md`]: `# Secrets\n${RULE_SENTENCE}.\n` },
    replies: [
      '{"topics":[{"title":"Secrets","summary":"How secrets are kept.","parts":["P1"]}]}',
      '{"topics":{"T1":["security"]},"memories":{}}',
    ],
    ...over,
  })
}

/** The content consent context line of rulesWorld: one rule file and nothing else (G-02-1f). */
const RULES_ONLY_FOUND =
  'Found: global CLAUDE.md no, 0 CLAUDE.md files in the repo chain, 1 rule file, AGENTS.md no, 0 memories. ' +
  'No keeps the whole-file questions.'

describe('rules and AGENTS.md in init (G-02-1f)', () => {
  test('a dry run on a repo with only .claude/rules/security.md asks the content consent, counting it', async () => {
    const run = memIo(rulesWorld(), PARTS_ANSWERS)
    const reply = await runInit(run.io, { dryRun: true })
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(run.asked).toContain(withContext(CONTENT_QUESTION, RULES_ONLY_FOUND))
  })

  test('after a yes the rule file is a part offered to the grouping call and shown by its location', async () => {
    const run = memIo(rulesWorld(), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(run.prompts[0]).toContain('P1 | .claude/rules/security.md | Secrets | # Secrets')
    expect(shownBlock(run, 'instructions')).toEqual([
      READ_HEADING_ROW,
      '  Secrets: How secrets are kept.',
      '    from: .claude/rules/security.md > Secrets',
      '    recommended: security',
    ])
  })

  test('the rule file is a repo part of the hand-out, with its file, heading and source', async () => {
    const roles = proposeRoles(repoScan()).roles
    const run = memIo(rulesWorld(), PARTS_ANSWERS)
    const value = valueOf(await instructionsStep(run.io, roles, emptySetupScan(), DEFAULT_LOCATIONS))
    expect(value.instructions.kind).toBe('parts')
    const handout = partsOf(value.instructions)
    expect(handout.scan.parts.map(part => [part.file, part.heading, part.source])).toEqual([
      ['.claude/rules/security.md', 'Secrets', 'repo'],
    ])
    expect([...handout.given.entries()]).toEqual([['T1', ['security']]])
  })

  test('init lists .claude/rules by name before the consent and reads the rule file only after a yes', async () => {
    const run = memIo(rulesWorld(), PARTS_ANSWERS)
    const traced = withReadEvents(run)
    const io: InitIo = {
      ...traced.io,
      list: async path => {
        traced.events.push(`list ${path}`)

        return traced.io.list(path)
      },
    }
    await runInit(io, { dryRun: true })
    const listAt = traced.events.indexOf(`list ${RULES_DIR}`)
    const consentAt = traced.events.indexOf(`ask ${CONTENT_QUESTION}`)
    const readAt = traced.events.indexOf(`read ${RULES_DIR}/security.md`)
    expect([listAt >= 0, consentAt > listAt, readAt > consentAt]).toEqual([true, true, true])
  })

  test('No, skip it reads no rule file and calls no model', async () => {
    const run = memIo(rulesWorld(), PARTS_DECLINED)
    await runInit(run.io, { dryRun: true })
    expect(firstLines(run.asked)).toContain(CONTENT_QUESTION)
    expect([run.reads.includes(`${RULES_DIR}/security.md`), run.prompts]).toEqual([false, []])
  })

  test('a repo with only AGENTS.md asks the content consent; after a yes AGENTS.md is a repo part', async () => {
    const world = gitWorld({
      files: { '/repo/AGENTS.md': '# Agents\nWork in small steps.\n' },
      replies: [
        '{"topics":[{"title":"Agents","summary":"How agents work.","parts":["P1"]}]}',
        '{"topics":{"T1":["tl"]},"memories":{}}',
      ],
    })
    const run = memIo(world, PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const found =
      'Found: global CLAUDE.md no, 0 CLAUDE.md files in the repo chain, 0 rule files, AGENTS.md yes, 0 memories. ' +
      'No keeps the whole-file questions.'
    expect(run.asked).toContain(withContext(CONTENT_QUESTION, found))
    expect(run.prompts[0]).toContain('P1 | AGENTS.md | Agents | # Agents')
  })

  test('a rules folder that cannot be listed counts 0, and its warning shows in the block after a yes', async () => {
    const run = memIo(partsWorld({ unknownPaths: [RULES_DIR] }), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(run.asked).toContain(withContext(CONTENT_QUESTION, GLOBAL_ONLY_FOUND))
    expect(shownBlock(run, 'instructions')).toContain('warning: could not list .claude/rules (treated as unknown)')
  })

  test('a doc the repo CLAUDE.md links to is read as a repo part after the chain', async () => {
    const topics = [
      { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
      { title: 'Repo rules', summary: 'The rules of this repo.', parts: ['P2', 'P3'] },
    ]
    const world = chainWorld({
      files: {
        [GLOBAL_CLAUDE_MD]: `# Security\n${GLOBAL_SENTENCE}.\n`,
        '/repo/CLAUDE.md': `# Rules\n${REPO_SENTENCE}.\nSee [the guide](docs/guide.md).\n`,
        '/repo/docs/guide.md': `# Guide\n${DOC_SENTENCE}.\n`,
      },
      replies: [JSON.stringify({ topics }), '{"topics":{"T1":["security"],"T2":["tl"]},"memories":{}}'],
    })
    const run = memIo(world, PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(run.prompts[0]).toContain('P3 | docs/guide.md | Guide | # Guide')
    expect(shownBlock(run, 'instructions')).toContain('    from: docs/guide.md > Guide')
  })

  test('rule and doc text never reaches a question, a log line, the pane or the reply (T-02-61)', async () => {
    const world = rulesWorld({
      files: {
        [`${RULES_DIR}/security.md`]: `# Secrets\n${RULE_SENTENCE}.\nSee [the guide](../../docs/guide.md).\n`,
        '/repo/docs/guide.md': `# Guide\n${DOC_SENTENCE}.\n`,
      },
      replies: [
        '{"topics":[{"title":"Secrets","summary":"How secrets are kept.","parts":["P1","P2"]}]}',
        '{"topics":{"T1":["security"]},"memories":{}}',
      ],
    })
    const run = memIo(world, { ...PARTS_ANSWERS, [INSTRUCTIONS_ENTRY_QUESTION]: 'Go part by part' })
    const reply = await runInit(run.io, { dryRun: true })
    expect(firstLines(run.asked)).toContain('Which roles get "Secrets"?')
    const shown = [
      ...run.asked,
      ...run.specs.flatMap(spec => [...spec.options, spec.header ?? '']),
      ...run.logged,
      ...paneText(run),
      reply,
    ].join('\n')
    expect(leaks(shown, [RULE_SENTENCE, DOC_SENTENCE])).toEqual([])
    expect(leaks(run.prompts[0] ?? '', [RULE_SENTENCE, DOC_SENTENCE])).toEqual([RULE_SENTENCE, DOC_SENTENCE])
  })

  test('a plain init on a repo with only rule files lists them before the consent and asks it', async () => {
    const run = memIo(rulesWorld(), PARTS_DECLINED)
    await runInit(run.io, { dryRun: false, host: memHost(hostWorld({})).io })
    expect(run.asked).toContain(withContext(CONTENT_QUESTION, RULES_ONLY_FOUND))
    expect(run.listed).toContain(RULES_DIR)
  })
})

/** The auto-memory folder of the fixture repo for the fixture user (G-02-1f Memories). */
const MEMORY_DIR = '/home/u/.claude/projects/-repo/memory'

/** A sentence of a memory, and of MEMORY.md off its index lines, that is never shown or sent anywhere (T-02-64). */
const MEMORY_SENTENCE = 'LEAKY-MEMORY-SENTENCE stays on disk'

/** The MEMORY.md of memoriesWorld: an index line for squad.md only, then a line that is no index line. */
const MEMORY_INDEX =
  `# Memory index\n- [Squad commits](squad.md) \u2014 Unsigned commits on per-phase branches.\n${MEMORY_SENTENCE}\n`

/**
 * partsWorld with the auto-memories squad.md, which MEMORY.md sums up, and workflow.md, which it does not; the
 * recommendation gives squad.md to the Team Lead and workflow.md to no role. `over` changes the fields it names.
 */
function memoriesWorld(over: Partial<MemWorld> = {}): MemWorld {
  return partsWorld({
    dirs: {
      '/repo/.git': [],
      ...USER_DIR_LISTED,
      [MEMORY_DIR]: [entry('MEMORY.md'), entry('squad.md'), entry('workflow.md')],
    },
    files: {
      [GLOBAL_CLAUDE_MD]: PARTS_GLOBAL,
      [`${MEMORY_DIR}/MEMORY.md`]: MEMORY_INDEX,
      [`${MEMORY_DIR}/squad.md`]: `${MEMORY_SENTENCE} (squad)`,
      [`${MEMORY_DIR}/workflow.md`]: `${MEMORY_SENTENCE} (workflow)`,
    },
    replies: [PARTS_TOPICS_REPLY, '{"topics":{"T1":["security"],"T2":["tl"]},"memories":{"M1":["tl"],"M2":[]}}'],
    ...over,
  })
}

/** The instructions block of memoriesWorld: the topics of the plan's dry run, then the two memories. */
const MEMORIES_BLOCK = [
  ...PARTS_BLOCK,
  'Memories (each linked, never copied, when a role gets it):',
  '  squad.md: Unsigned commits on per-phase branches.',
  '    recommended: tl',
  '  workflow.md: No summary in MEMORY.md.',
  '    recommended: none',
]

/** Part by part on memoriesWorld: Yes and No to the topics, Yes to squad.md and pm, security typed for workflow.md. */
const MEMORY_BY_PART_ANSWERS: Readonly<Record<string, string>> = {
  ...PARTS_ANSWERS,
  [INSTRUCTIONS_ENTRY_QUESTION]: 'Go part by part',
  'Which roles get "Security rules"': 'Yes',
  'Which roles get "Git and commits"': 'No',
  'Which roles get the memory "squad.md"': 'Yes',
  'Which roles get the memory "workflow.md"': 'pm, security',
}

/** The questions of a run that hand out one topic or one memory, as asked. */
function itemQuestions(run: MemRun): string[] {
  const isItem = (question: string): boolean =>
    question.startsWith('Which roles get "') || question.startsWith('Which roles get the memory "')

  return run.asked.filter(isItem)
}

describe('memories one by one (G-02-1f)', () => {
  test('a dry run shows both memories after the topics, each with its MEMORY.md summary or none', async () => {
    const run = memIo(memoriesWorld(), PARTS_ANSWERS)
    const reply = await runInit(run.io, { dryRun: true })
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(shownBlock(run, 'instructions')).toEqual(MEMORIES_BLOCK)
  })

  test('the entry question names the parts and memories, and its context line counts both', async () => {
    const run = memIo(memoriesWorld(), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const context = '2 topics from 1 file and 2 memories; the pane shows each with the roles it is recommended for.'
    const question = 'How do you want to hand out the instruction parts and memories?'
    expect(run.asked).toContain(withContext(question, context))
  })

  test('part by part asks both memories one by one after the topics, with their context lines and chips', async () => {
    const run = memIo(memoriesWorld(), MEMORY_BY_PART_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const items = itemQuestions(run)
    expect(firstLines(items)).toEqual([
      'Which roles get "Security rules"?',
      'Which roles get "Git and commits"?',
      'Which roles get the memory "squad.md"?',
      'Which roles get the memory "workflow.md"?',
    ])
    expect(items.slice(2)).toEqual([
      withContext(
        'Which roles get the memory "squad.md"?',
        'Unsigned commits on per-phase branches. Recommended: tl.',
      ),
      withContext('Which roles get the memory "workflow.md"?', 'No summary in MEMORY.md. Recommended: none.'),
    ])
    const at = run.asked.indexOf(items[2] ?? 'missing')
    const chips = ['Memory 1/2', 'Memory 2/2'].map(header => ({ options: ['Yes', 'No'], header }))
    expect(run.specs.slice(at, at + 2)).toEqual(chips)
  })

  test('the review counts the memories each role gets and the ones kept with the root session', async () => {
    const run = memIo(memoriesWorld(), MEMORY_BY_PART_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const review = shownBlock(run, 'review')
    const at = review.indexOf('Instructions per role:')
    expect(review.slice(at, at + 11)).toEqual([
      'Instructions per role:',
      '  pm: 0 topics; 1 memory',
      LINKED_MEMORIES_ROW,
      privateFilesRow('pm'),
      '  tl: 0 topics; 1 memory',
      LINKED_MEMORIES_ROW,
      privateFilesRow('tl'),
      '  security: 1 topic: Security rules; 1 memory',
      LINKED_MEMORIES_ROW,
      privateFilesRow('security'),
      'Kept with the root session only: 1 topic, 0 memories',
    ])
  })

  test('Accept recommendations gives each memory its recommended roles; one with none stays at the root', async () => {
    const run = memIo(memoriesWorld(), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const review = shownBlock(run, 'review')
    const at = review.indexOf('Instructions per role:')
    expect(review.slice(at, at + 9)).toEqual([
      'Instructions per role:',
      '  pm: none',
      privateFilesRow('pm'),
      '  tl: 1 topic: Git and commits; 1 memory',
      LINKED_MEMORIES_ROW,
      privateFilesRow('tl'),
      '  security: 1 topic: Security rules; 0 memories',
      privateFilesRow('security'),
      'Kept with the root session only: 0 topics, 1 memory',
    ])
  })

  test('the hand-out keeps each memory by its M id with its folder, summary and hash', async () => {
    const roles = proposeRoles(repoScan()).roles
    const setup = emptySetupScan({ hasGlobalClaudeMd: true, memoryFiles: ['MEMORY.md', 'squad.md', 'workflow.md'] })
    const run = memIo(memoriesWorld(), PARTS_ANSWERS)
    const value = valueOf(await instructionsStep(run.io, roles, setup, DEFAULT_LOCATIONS))
    expect(value.instructions.kind).toBe('parts')
    const handout = partsOf(value.instructions)
    expect(Object.keys(handout.scan)).toContain('memories')
    expect(handout.scan.memories.map(found => [found.id, found.file, found.folder, found.summary])).toEqual([
      ['M1', 'squad.md', MEMORY_DIR, 'Unsigned commits on per-phase branches.'],
      ['M2', 'workflow.md', MEMORY_DIR, 'No summary in MEMORY.md.'],
    ])
    const hashes = [await sha256Hex(`${MEMORY_SENTENCE} (squad)`), await sha256Hex(`${MEMORY_SENTENCE} (workflow)`)]
    expect(handout.scan.memories.map(found => found.hash)).toEqual(hashes)
    expect([...handout.given.entries()]).toEqual([
      ['T1', ['security']],
      ['T2', ['tl']],
      ['M1', ['tl']],
      ['M2', []],
    ])
  })

  test('the recommendation prompt lists each memory by id, file and summary', async () => {
    const run = memIo(memoriesWorld(), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const recommending = run.prompts[1] ?? ''
    expect(recommending).toContain('M1 | squad.md | Unsigned commits on per-phase branches.')
    expect(recommending).toContain('M2 | workflow.md | No summary in MEMORY.md.')
  })

  test('no memory and no MEMORY.md is read before the content consent answer (T-02-60)', async () => {
    const run = memIo(memoriesWorld(), PARTS_ANSWERS)
    const { io, events } = withReadEvents(run)
    await runInit(io, { dryRun: true })
    const consentAt = events.indexOf(`ask ${CONTENT_QUESTION}`)
    const readAt = events.findIndex(event => event.startsWith(`read ${MEMORY_DIR}/`))
    expect([consentAt > 0, readAt > consentAt]).toEqual([true, true])
  })

  test('memory text never reaches a question, a log line, the pane, the reply or a prompt (T-02-64)', async () => {
    const run = memIo(memoriesWorld(), MEMORY_BY_PART_ANSWERS)
    const reply = await runInit(run.io, { dryRun: true })
    expect(itemQuestions(run)).toHaveLength(4)
    const shown = [
      ...run.asked,
      ...run.specs.flatMap(spec => [...spec.options, spec.header ?? '']),
      ...run.logged,
      ...paneText(run),
      reply,
      ...run.prompts,
    ].join('\n')
    expect(leaks(shown, [MEMORY_SENTENCE])).toEqual([])
  })

  test('the memories of the root as given are read too, after those of the root as resolved', async () => {
    const given = '/home/u/.claude/projects/-link-repo/memory'
    const world = memoriesWorld({
      dirs: { '/repo/.git': [], [MEMORY_DIR]: [entry('squad.md')], [given]: [entry('squad.md'), entry('extra.md')] },
      files: {
        [GLOBAL_CLAUDE_MD]: PARTS_GLOBAL,
        [`${MEMORY_DIR}/squad.md`]: 'squad',
        [`${given}/squad.md`]: 'another squad',
        [`${given}/extra.md`]: 'extra',
      },
      replies: [PARTS_TOPICS_REPLY, '{"topics":{"T1":[],"T2":[]},"memories":{"M1":[],"M2":[]}}'],
    })
    const roles = proposeRoles(repoScan()).roles
    const locations = { ...DEFAULT_LOCATIONS, givenRoot: '/link/repo' }
    const setup = emptySetupScan({ hasGlobalClaudeMd: true })
    const value = valueOf(await instructionsStep(memIo(world, PARTS_ANSWERS).io, roles, setup, locations))
    expect(value.instructions.kind).toBe('parts')
    const { scan } = partsOf(value.instructions)
    expect(Object.keys(scan)).toContain('memories')
    expect(scan.memories.map(found => [found.id, found.file, found.folder])).toEqual([
      ['M1', 'extra.md', given],
      ['M2', 'squad.md', MEMORY_DIR],
    ])
  })
})

/**
 * A git repo with every instruction source (02-GAPS-B2 N5): the global CLAUDE.md, the repo CLAUDE.md of the chain,
 * which links docs/guide.md, a top-level and a nested rule file, AGENTS.md, and the memory folder with MEMORY.md and
 * one memory. The model gives no usable reply, so each file is one topic and nothing is recommended.
 */
function everySourceWorld(): MemWorld {
  return gitWorld({
    dirs: {
      '/repo/.git': [],
      [RULES_DIR]: [entry('a.md'), entry('frontend', 'dir')],
      [`${RULES_DIR}/frontend`]: [entry('react.md')],
      [MEMORY_DIR]: [entry('MEMORY.md'), entry('squad.md')],
    },
    files: {
      [GLOBAL_CLAUDE_MD]: PARTS_GLOBAL,
      '/repo/CLAUDE.md': `# Rules\n${REPO_SENTENCE}.\nSee [the guide](docs/guide.md).\n`,
      '/repo/docs/guide.md': `# Guide\n${DOC_SENTENCE}.\n`,
      [`${RULES_DIR}/a.md`]: '# A\n',
      [`${RULES_DIR}/frontend/react.md`]: '# React\n',
      '/repo/AGENTS.md': '# Agents\nWork in small steps.\n',
      [`${MEMORY_DIR}/MEMORY.md`]: MEMORY_INDEX,
      [`${MEMORY_DIR}/squad.md`]: `${MEMORY_SENTENCE} (squad)`,
    },
    ancestors: [ancestor('/repo')],
    replies: [],
  })
}

/** Each instruction source file of everySourceWorld, as the port reads it. */
const EVERY_SOURCE: readonly string[] = [
  GLOBAL_CLAUDE_MD,
  '/repo/CLAUDE.md',
  `${RULES_DIR}/a.md`,
  `${RULES_DIR}/frontend/react.md`,
  '/repo/AGENTS.md',
  '/repo/docs/guide.md',
  `${MEMORY_DIR}/MEMORY.md`,
  `${MEMORY_DIR}/squad.md`,
]

describe('the read order over every instruction source (T-02-60, 02-GAPS-B2 N5)', () => {
  test('no source file is read before the content consent answer, and each is read after it', async () => {
    const run = memIo(everySourceWorld(), PARTS_ANSWERS)
    const { io, events } = withReadEvents(run)
    await runInit(io, { dryRun: true })
    const consentAt = events.indexOf(`ask ${CONTENT_QUESTION}`)
    for (const path of EVERY_SOURCE) {
      const readAt = events.indexOf(`read ${path}`)
      expect([path, consentAt > 0, readAt > consentAt]).toEqual([path, true, true])
    }
  })
})

/** The sentence of the root CLAUDE.md's Rules section, which init writes into the built file of the role given it. */
const BUILT_RULE = 'Run the tests before a commit.'

/**
 * The six-role repo of fullWorld whose user has a global Security section and whose root CLAUDE.md, in the chain, has a
 * Rules section; the model groups them into T1 'Security rules' (global) and T2 'Repo rules' (repo) and recommends T1
 * to security and T2 to be (G-02-1f Storage split). `over` changes the fields it names.
 */
function builtWorld(over: Partial<MemWorld> = {}): MemWorld {
  const topics = [
    { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
    { title: 'Repo rules', summary: 'The rules of this repo.', parts: ['P2'] },
  ]

  return gitWorld({
    dirs: { '/repo/.git': [], ...USER_DIR_LISTED, ...FULL_DIRS },
    files: {
      ...FULL_FILES,
      [GLOBAL_CLAUDE_MD]: `# Security\n${GLOBAL_SENTENCE}.\n`,
      '/repo/CLAUDE.md': `# Rules\n${BUILT_RULE}\n`,
    },
    ancestors: [ancestor('/repo')],
    replies: [JSON.stringify({ topics }), '{"topics":{"T1":["security"],"T2":["be"]},"memories":{}}'],
    ...over,
  })
}

/** BE's built CLAUDE.md in builtWorld: the header line, then the Rules part of the root CLAUDE.md (D-140). */
const BUILT_BE = [
  "<!-- cadre: instructions for role be, built from this repo's CLAUDE.md files, rules and docs. " +
    'Edit the originals and run /cadre regen be; this file is rebuilt. -->',
  '',
  '<!-- from CLAUDE.md > Rules -->',
  '# Rules',
  BUILT_RULE,
  '',
].join('\n')

/** The file plan row of BE's built CLAUDE.md on a disk that does not have it. */
const BUILT_BE_ROW = '  create    .cadre/be/CLAUDE.md'

/** The role ids of builtWorld's six-role team, in path order: each gets its built CLAUDE.md (02-GAPS-B2 S1). */
const BUILT_TEAM: readonly string[] = ['be', 'fe', 'pm', 'qa', 'security', 'tl']

/** The paths of the built CLAUDE.md of these roles under /repo, in the order given. */
function builtPaths(ids: readonly string[]): string[] {
  return ids.map(id => `/repo/.cadre/${id}/CLAUDE.md`)
}

/** The written files of a host under the repo's .cadre/ whose path ends in `/CLAUDE.md`: the built role files. */
function builtWrites(host: MemHost): HostWrite[] {
  return host.writes.filter(write => write.path.startsWith('/repo/.cadre/') && write.path.endsWith('/CLAUDE.md'))
}

/** The written files of a host under the repo. */
function repoWrites(host: MemHost): HostWrite[] {
  return host.writes.filter(write => write.path.startsWith('/repo/'))
}

/** A sentence of a local note the root CLAUDE.md imports, which git does not track in the M3 cases. */
const LOCAL_NOTE = 'LOCAL-NOTE-SENTENCE stays out of the repo'

/** The NUL character `git ls-files -z` ends each name with, built at run time. */
const NUL = String.fromCharCode(0)

/** The git run of the M3 cases: which of CLAUDE.md and notes/local.md git tracks (02-GAPS-B2 M3). */
const LOCAL_GIT_ARGV: readonly string[] = [
  'git',
  '--literal-pathspecs',
  'ls-files',
  '-z',
  '--',
  'CLAUDE.md',
  'notes/local.md',
]

/** A git ls-files run that exits 0 and names these files, each ended by NUL. */
function trackedRun(files: readonly string[]): HostRun {
  return { exitCode: 0, stdout: files.map(file => `${file}${NUL}`).join(''), stderr: '' }
}

/** The git run of builtWorld: whether git tracks the root CLAUDE.md, the one source of BE's repo parts (M3). */
const BUILT_GIT_ARGV: readonly string[] = ['git', '--literal-pathspecs', 'ls-files', '-z', '--', 'CLAUDE.md']

/** The host rule of a plain init over builtWorld or the secret world: git tracks the root CLAUDE.md (M3). */
const BUILT_TRACKED: readonly HostRunRule[] = [{ argv: BUILT_GIT_ARGV, result: trackedRun(['CLAUDE.md']) }]

/**
 * The git ls-files runs a host was asked for (M3); the common-dir run of the private files (G-02-1f) is not one of
 * them.
 */
function gitCalls(host: MemHost): HostCall[] {
  return host.calls.filter(call => call.argv[0] === 'git' && call.argv.includes('ls-files'))
}

/** The ids of the roles a plain init wrote a launcher for, in write order, which is path order. */
function launcherIds(host: MemHost): string[] {
  const bin = '/repo/.cadre/bin/'

  return host.writes.filter(write => write.path.startsWith(bin)).map(write => write.path.slice(bin.length))
}

/** A sentence of a team-wide CLAUDE.md above the repo, which no file in the repo may hold (02-GAPS-B2 S2). */
const TEAM_SENTENCE = 'TEAM-WIDE-SENTENCE stays private'

/**
 * builtWorld whose root CLAUDE.md also imports notes/local.md, which holds `local`; the model groups the global
 * Security section into T1, for security, and the two repo parts into T2 'Repo rules', for be (02-GAPS-B2 M3).
 */
function localNoteWorld(local = `# Local\n${LOCAL_NOTE}.\n`): MemWorld {
  const topics = [
    { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
    { title: 'Repo rules', summary: 'The rules of this repo.', parts: ['P2', 'P3'] },
  ]

  return builtWorld({
    files: {
      ...FULL_FILES,
      [GLOBAL_CLAUDE_MD]: `# Security\n${GLOBAL_SENTENCE}.\n`,
      '/repo/CLAUDE.md': `# Rules\n${BUILT_RULE}\n@notes/local.md\n`,
      '/repo/notes/local.md': local,
    },
    replies: [JSON.stringify({ topics }), '{"topics":{"T1":["security"],"T2":["be"]},"memories":{}}'],
  })
}

describe('built role CLAUDE.md (G-02-1f)', () => {
  test('a dry run of the parts flow plans the built CLAUDE.md of every role, BE with its topic (S1)', async () => {
    const run = memIo(builtWorld(), PARTS_ANSWERS)
    const lines = (await runInit(run.io, { dryRun: true })).split('\n')
    const rows = BUILT_TEAM.map(id => `  create    .cadre/${id}/CLAUDE.md`)
    expect(lines.filter(line => line.endsWith('/CLAUDE.md'))).toEqual(rows)
    expect(rows).toContain(BUILT_BE_ROW)
    expect(lines.at(-1)).toBe(DRY_RUN_NOTE)
  })

  test('a plain init asks the content consent, runs the parts flow and writes the built file of the role', async () => {
    const run = memIo(builtWorld(), PARTS_ANSWERS)
    const host = memHost(hostWorld({ runs: BUILT_TRACKED }))
    const reply = await runInit(run.io, { dryRun: false, host: host.io })
    expect(firstLines(run.asked)).toContain(CONTENT_QUESTION)
    expect(run.prompts).toHaveLength(2)
    const texts = BUILT_TEAM.map(id => (id === 'be' ? BUILT_BE : roleClaudeMdText(id, [])))
    expect(builtWrites(host)).toEqual(
      builtPaths(BUILT_TEAM).map((path, at) => ({ path, text: texts[at], isWritten: true })),
    )
    expect(reply.split('\n')).toContain(BUILT_BE_ROW)
    expect(run.logged.filter(text => text.includes('--dry-run'))).toEqual([])
  })

  test('the global part given to security reaches no file in the repo, only its private file (T-02-69)', async () => {
    const host = memHost(hostWorld({ runs: [...BUILT_TRACKED, COMMON_DIR_RULE] }))
    await runInit(memIo(builtWorld(), PARTS_ANSWERS).io, { dryRun: false, host: host.io })
    expect(builtWrites(host).map(write => write.path)).toEqual(builtPaths(BUILT_TEAM))
    expect(repoWrites(host).filter(write => write.text.includes(GLOBAL_SENTENCE))).toEqual([])
    const holding = host.writes.filter(write => write.text.includes(GLOBAL_SENTENCE)).map(write => write.path)
    expect(holding).toEqual([privateClaudeMdPath(await memoryFolder('security'))])
  })

  test('a plain init answered No, skip it asks the whole-file questions and builds no part into a file', async () => {
    const run = memIo(builtWorld(), PARTS_DECLINED)
    const host = memHost(hostWorld({}))
    await runInit(run.io, { dryRun: false, host: host.io })
    const asked = firstLines(run.asked)
    expect(asked).toContain(CONTENT_QUESTION)
    expect(asked.indexOf(GLOBAL_GROUP_QUESTION)).toBeGreaterThan(asked.indexOf(CONTENT_QUESTION))
    const withParts = builtWrites(host).filter(write => write.text.includes('<!-- from '))
    expect([withParts, run.prompts]).toEqual([[], []])
    expect(host.writes.length).toBeGreaterThan(0)
  })

  test('T-02-69: on the secret world, Yes and Accept, no global or memory text reaches the repo or reply', async () => {
    const world = secretWorld({
      dirs: { ...secretWorld().dirs, ...USER_DIR_LISTED },
      files: { ...secretWorld().files, '/repo/CLAUDE.md': `# Rules\n${BUILT_RULE}\n` },
      replies: [
        '{"topics":[{"title":"Keys and rules","summary":"How keys are kept.","parts":["P1","P2"]}]}',
        '{"topics":{"T1":["tl"]},"memories":{"M1":["tl"]}}',
      ],
    })
    const host = memHost(hostWorld({ runs: [...BUILT_TRACKED, COMMON_DIR_RULE] }))
    const reply = await runInit(memIo(world, PARTS_ANSWERS).io, { dryRun: false, host: host.io })
    const built = builtWrites(host)
    expect(built.map(write => write.path)).toEqual(builtPaths(['pm', 'security', 'tl']))
    expect(built.find(write => write.path === '/repo/.cadre/tl/CLAUDE.md')?.text).toContain(BUILT_RULE)
    const shown = [reply, ...repoWrites(host).map(write => write.text)].join('\n')
    expect(leaks(shown, [...SECRET_FIXTURES, ...ABSOLUTE_PATH_MARKERS])).toEqual([])
    // Every role gets both private files (02-GAPS-B3 C1); only tl's hold the global text and the memory.
    const folders = await Promise.all(['pm', 'security', 'tl'].map(memoryFolder))
    const both = folders.flatMap(folder => [privateClaudeMdPath(folder), instructionsRecordPath(folder)])
    expect(homeWrites(host).map(write => write.path)).toEqual(both)
  })

  test('only the parts of files git tracks are written: untracked notes/local.md stays out (M3)', async () => {
    const host = memHost(hostWorld({ runs: [{ argv: LOCAL_GIT_ARGV, result: trackedRun(['CLAUDE.md']) }] }))
    const reply = await runInit(memIo(localNoteWorld(), PARTS_ANSWERS).io, { dryRun: false, host: host.io })
    const built = builtWrites(host)
    expect(built.map(write => write.path)).toEqual(builtPaths(BUILT_TEAM))
    expect(built[0]?.text).toContain(BUILT_RULE)
    expect(host.writes.filter(write => write.text.includes(LOCAL_NOTE))).toEqual([])
    const untracked = 'warning: notes/local.md is not tracked by git: its parts are not written to .cadre/'
    expect(reply.split('\n').filter(line => line.includes('not tracked by git'))).toEqual([untracked])
    expect(untracked).toBe(`warning: ${untrackedPartsWarning('notes/local.md')}`)
    expect(gitCalls(host)).toEqual([{ argv: LOCAL_GIT_ARGV, options: { cwd: '/repo', timeoutMs: 10_000 } }])
  })

  test('a git run the host rejects or that exits non-zero writes no repo part and warns once (M3)', async () => {
    const results: readonly (HostRun | null)[] = [null, { exitCode: 128, stdout: '', stderr: 'fatal: not a repo' }]
    for (const result of results) {
      const host = memHost(hostWorld({ runs: [{ argv: LOCAL_GIT_ARGV, result }] }))
      const reply = await runInit(memIo(localNoteWorld(), PARTS_ANSWERS).io, { dryRun: false, host: host.io })
      const written = host.writes.filter(write => write.text.includes(BUILT_RULE) || write.text.includes(LOCAL_NOTE))
      expect(written).toEqual([])
      expect(reply.split('\n').filter(line => line === `warning: ${GIT_TRACKING_UNKNOWN_WARNING}`)).toHaveLength(1)
    }
    expect(GIT_TRACKING_UNKNOWN_WARNING).toBe(
      'could not ask git which instruction files it tracks: no repo part is written to .cadre/',
    )
  })

  test('a plain init with no repo part to write asks git nothing (M3)', async () => {
    const globalOnly = memHost(hostWorld({}))
    await runInit(memIo(partsWorld(), PARTS_ANSWERS).io, { dryRun: false, host: globalOnly.io })
    const declined = memHost(hostWorld({}))
    await runInit(memIo(localNoteWorld(), PARTS_DECLINED).io, { dryRun: false, host: declined.io })
    expect([gitCalls(globalOnly), gitCalls(declined)]).toEqual([[], []])
    expect(globalOnly.writes.length).toBeGreaterThan(0)
  })

  test('a plain init after No or after Whole files writes the header-only built file of every role (S1)', async () => {
    const whole = { ...PARTS_ANSWERS, [INSTRUCTIONS_ENTRY_QUESTION]: 'Whole files' }
    for (const answers of [PARTS_DECLINED, whole]) {
      const host = memHost(hostWorld({}))
      const reply = await runInit(memIo(builtWorld(), answers).io, { dryRun: false, host: host.io })
      const ids = launcherIds(host)
      const headers = ids.map(id => ({ path: `/repo/.cadre/${id}/CLAUDE.md`, text: roleClaudeMdText(id, []) }))
      expect(ids.length).toBeGreaterThan(1)
      expect(builtWrites(host).map(write => ({ path: write.path, text: write.text }))).toEqual(headers)
      const rows = reply.split('\n').filter(line => line.endsWith('/CLAUDE.md'))
      expect(rows).toEqual(ids.map(id => `  create    .cadre/${id}/CLAUDE.md`))
    }
  })

  test('a chain CLAUDE.md above the repo is read as a private part and reaches no repo file (S2)', async () => {
    const topics = [
      { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
      { title: 'Team rules', summary: 'The rules of the team and the repo.', parts: ['P2', 'P3'] },
    ]
    const world = builtWorld({
      ancestors: [ancestor('/home/u/work'), ancestor('/repo')],
      files: {
        ...FULL_FILES,
        [GLOBAL_CLAUDE_MD]: `# Security\n${GLOBAL_SENTENCE}.\n`,
        '/home/u/work/CLAUDE.md': `# Team\n${TEAM_SENTENCE}.\n`,
        '/repo/CLAUDE.md': `# Rules\n${BUILT_RULE}\n`,
      },
      replies: [JSON.stringify({ topics }), '{"topics":{"T1":["security"],"T2":["be"]},"memories":{}}'],
    })
    const run = memIo(world, PARTS_ANSWERS)
    const host = memHost(hostWorld({ runs: [...BUILT_TRACKED, COMMON_DIR_RULE] }))
    await runInit(run.io, { dryRun: false, host: host.io })
    expect(run.reads).toContain('/home/u/work/CLAUDE.md')
    expect(run.prompts[0]).toContain('P2 | ~/work/CLAUDE.md | Team | # Team')
    expect(repoWrites(host).filter(write => write.text.includes(TEAM_SENTENCE))).toEqual([])
    expect(builtWrites(host).find(write => write.path === '/repo/.cadre/be/CLAUDE.md')?.text).toContain(BUILT_RULE)
    const holding = host.writes.filter(write => write.text.includes(TEAM_SENTENCE)).map(write => write.path)
    expect(holding).toEqual([privateClaudeMdPath(await memoryFolder('be'))])
  })

  test('a secret in a file git does not track reaches no write (M3, N6)', async () => {
    const host = memHost(hostWorld({ runs: [{ argv: LOCAL_GIT_ARGV, result: trackedRun(['CLAUDE.md']) }] }))
    const world = localNoteWorld(`# Local\n${SECRET_FIXTURES.join('\n')}\n`)
    await runInit(memIo(world, PARTS_ANSWERS).io, { dryRun: false, host: host.io })
    expect(builtWrites(host).map(write => write.path)).toEqual(builtPaths(BUILT_TEAM))
    expect(leaks(host.writes.map(write => write.text).join('\n'), SECRET_FIXTURES)).toEqual([])
  })
})

/** The git run that gives the common dir of the fixture repo, /repo/.git: apply names the role memory folders by it. */
const COMMON_DIR_RULE: HostRunRule = {
  argv: GIT_COMMON_DIR_ARGV,
  result: { exitCode: 0, stdout: '/repo/.git\n', stderr: '' },
}

/** The folder that holds the role memory folders of the fixture repo: `~/.claude/cadre/repo-<hash8>` (D-91). */
async function slugFolder(): Promise<string> {
  return `/home/u/.claude/cadre/repo-${(await sha256Hex('/repo/.git')).slice(0, 8)}`
}

/** The role memory folder of a role of the fixture repo for the fixture user (D-20, D-91, D-140 q2-a). */
async function memoryFolder(id: string): Promise<string> {
  return `${await slugFolder()}/${id}`
}

/** A section of PARTS_GLOBAL as the read gives it: a global part of ~/.claude/CLAUDE.md with the hash of its text. */
async function partsGlobalPart(id: string, heading: string, text: string): Promise<InstructionPart> {
  return { id, file: '~/.claude/CLAUDE.md', heading, source: 'global', text, hash: await sha256Hex(text) }
}

/** The Security section of PARTS_GLOBAL, which the plan's recommendation gives security. */
async function securityPart(): Promise<InstructionPart> {
  return partsGlobalPart('P1', 'Security', '# Security\nNever commit secrets.\n')
}

/** The Git section of PARTS_GLOBAL, which the plan's recommendation gives tl. */
async function gitPart(): Promise<InstructionPart> {
  return partsGlobalPart('P2', 'Git', '## Git\nUse signed commits.\n')
}

/** The memory squad.md of memoriesWorld, as the hand-out offers it. */
async function squadMemory(): Promise<MemoryItem> {
  const hash = await sha256Hex(`${MEMORY_SENTENCE} (squad)`)

  return { id: 'M1', file: 'squad.md', folder: MEMORY_DIR, summary: 'Unsigned commits on per-phase branches.', hash }
}

/** The writes of a host that land in the user's folder, outside the repo. */
function homeWrites(host: MemHost): HostWrite[] {
  return host.writes.filter(write => write.path.startsWith('/home/u/'))
}

describe('private role files (G-02-1f)', () => {
  test('after Confirm each role given a global part gets it in its private text file, with its record', async () => {
    const host = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    await runInit(memIo(partsWorld(), PARTS_ANSWERS).io, { dryRun: false, host: host.io })
    const security = await memoryFolder('security')
    const tl = await memoryFolder('tl')
    const pm = await memoryFolder('pm')
    const [p1, p2] = [await securityPart(), await gitPart()]
    // Each record also names the other part of the same file, which the role was not given (AUTO-PICK #19 Q1); pm,
    // given nothing, gets the header alone and an empty record (02-GAPS-B3 C1).
    expect(homeWrites(host)).toEqual([
      { path: privateClaudeMdPath(pm), text: privateClaudeMdText('pm', 'repo', []), isWritten: true },
      { path: instructionsRecordPath(pm), text: instructionsRecordText([], []), isWritten: true },
      { path: privateClaudeMdPath(security), text: privateClaudeMdText('security', 'repo', [p1]), isWritten: true },
      { path: instructionsRecordPath(security), text: instructionsRecordText([p1], [], [p2]), isWritten: true },
      { path: privateClaudeMdPath(tl), text: privateClaudeMdText('tl', 'repo', [p2]), isWritten: true },
      { path: instructionsRecordPath(tl), text: instructionsRecordText([p2], [], [p1]), isWritten: true },
    ])
    expect(privateClaudeMdPath(security)).toBe(`${security}/instructions/CLAUDE.md`)
  })

  test('the private files come after the repo files and before the manifest, which is still written', async () => {
    const host = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    const reply = await runInit(memIo(partsWorld(), PARTS_ANSWERS).io, { dryRun: false, host: host.io })
    const paths = host.writes.map(write => write.path)
    const firstPrivate = paths.findIndex(path => path.startsWith('/home/u/'))
    const lastPrivate = paths.findLastIndex(path => path.startsWith('/home/u/'))
    expect(paths.slice(0, firstPrivate).every(path => path.startsWith('/repo/'))).toBe(true)
    expect(paths.slice(firstPrivate, lastPrivate + 1)).toHaveLength(6)
    expect(paths.slice(lastPrivate + 1)).toEqual(['/repo/.cadre/manifest.json'])
    expect(reply.split('\n').filter(line => line.startsWith('warning: '))).toEqual([])
  })

  test('a role given memories has them in its record by file, folder, summary and hash, never copied', async () => {
    const replies = [PARTS_TOPICS_REPLY, '{"topics":{"T1":["security"],"T2":["tl"]},"memories":{"M1":["pm"],"M2":[]}}']
    const host = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    await runInit(memIo(memoriesWorld({ replies }), PARTS_ANSWERS).io, { dryRun: false, host: host.io })
    const pm = await memoryFolder('pm')
    const squad = await squadMemory()
    expect(host.writes.filter(write => write.path.startsWith(`${pm}/`))).toEqual([
      { path: privateClaudeMdPath(pm), text: privateClaudeMdText('pm', 'repo', []), isWritten: true },
      { path: instructionsRecordPath(pm), text: instructionsRecordText([], [squad]), isWritten: true },
    ])
    expect(host.writes.filter(write => write.text.includes(MEMORY_SENTENCE))).toEqual([])
  })

  test('the role memory folder is made by the mkdir run, made private on each level, then written (N13)', async () => {
    const host = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    const { io, events } = withHostEvents(host)
    await runInit(memIo(partsWorld(), PARTS_ANSWERS).io, { dryRun: false, host: io })
    const slug = await slugFolder()
    const security = `${slug}/security`
    const at = events.indexOf(`run /bin/mkdir -p -- ${security}/instructions`)
    expect(at).toBeGreaterThan(0)
    expect(events.slice(at, at + 7)).toEqual([
      `run /bin/mkdir -p -- ${security}/instructions`,
      'run /bin/chmod 700 /home/u/.claude/cadre',
      `run /bin/chmod 700 ${slug}`,
      `run /bin/chmod 700 ${security}`,
      `run /bin/chmod 700 ${security}/instructions`,
      `write ${privateClaudeMdPath(security)}`,
      `write ${instructionsRecordPath(security)}`,
    ])
    expect(host.calls.filter(call => call.argv[1] === 'rev-parse')).toEqual([
      { argv: GIT_COMMON_DIR_ARGV, options: { cwd: '/repo', timeoutMs: 10_000 } },
    ])
  })

  test('a dry run writes nothing private: it holds no host, reads and lists nothing in the role folders', async () => {
    const run = memIo(memoriesWorld(), PARTS_ANSWERS)
    const { io, stats } = withStats(run)
    const reply = await runInit(io, { dryRun: true })
    const isPrivate = (path: string): boolean => path.startsWith('/home/u/.claude/cadre')
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect([...run.reads, ...run.listed, ...stats].filter(isPrivate)).toEqual([])
  })

  test('a cancel holds a host and still writes nothing private and runs nothing', async () => {
    const host = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    const dismissed = Object.fromEntries(Object.entries(PARTS_ANSWERS).filter(([key]) => key !== 'Review the plan'))
    const reply = await runInit(memIo(memoriesWorld(), dismissed).io, { dryRun: false, host: host.io })
    expect(reply).toBe(cancelledReply(REVIEW_DISMISSED_REASON))
    expect([host.writes, host.calls]).toEqual([[], []])
  })

  test('with no common dir from git no private file is written, the reply says whose; the manifest is', async () => {
    const failed: HostRunRule = { argv: GIT_COMMON_DIR_ARGV, result: { exitCode: 128, stdout: '', stderr: 'fatal' } }
    for (const rule of [failed, { argv: GIT_COMMON_DIR_ARGV, result: null }]) {
      const host = memHost(hostWorld({ runs: [rule] }))
      const reply = await runInit(memIo(partsWorld(), PARTS_ANSWERS).io, { dryRun: false, host: host.io })
      expect(homeWrites(host)).toEqual([])
      expect(reply.split('\n')).toContain(`warning: ${privateFoldersUnknownWarning(['pm', 'security', 'tl'])}`)
      expect(reply.split('\n')).not.toContain(`warning: ${MANIFEST_SKIPPED_NOTE}`)
      expect(host.writes.map(write => write.path).at(-1)).toBe('/repo/.cadre/manifest.json')
    }
    expect(privateFoldersUnknownWarning(['security', 'tl'])).toBe(
      'the private files of security, tl were not written: their role memory folders are unknown ' +
        '(no home folder, or git rev-parse failed or gave no absolute path; git 2.31 or newer is needed)',
    )
  })

  test('a private file listed as a link after Confirm is not written through; the record still is', async () => {
    const slug = await slugFolder()
    const security = `${slug}/security`
    const dirs = {
      '/repo/.git': [],
      '/home/u/.claude': [entry('cadre', 'dir')],
      '/home/u/.claude/cadre': [entry(slug.slice(slug.lastIndexOf('/') + 1), 'dir')],
      [slug]: [entry('security', 'dir')],
      [security]: [entry('instructions', 'dir')],
      [`${security}/instructions`]: [],
    }
    const host = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    const run = memIo(partsWorld({ dirs }), PARTS_ANSWERS)
    const io = listedLinkAfterConfirm(run, `${security}/instructions`, 'CLAUDE.md')
    const reply = await runInit(io, { dryRun: false, host: host.io })
    const written = host.writes.map(write => write.path)
    expect(written).not.toContain(privateClaudeMdPath(security))
    expect(written).toContain(instructionsRecordPath(security))
    const shownPath = `~/.claude/cadre/${slug.slice(slug.lastIndexOf('/') + 1)}/security/instructions/CLAUDE.md`
    expect(reply.split('\n')).toContain(`warning: refused to write ${shownPath}: ${LISTED_LINK}`)
  })

  test('a <userDir>/cadre listed as a link, or an unlisted <userDir>, refuses every private write (S3)', async () => {
    const pm = privateClaudeMdPath(await memoryFolder('pm'))
    const shownPm = `~${pm.slice('/home/u'.length)}`
    const unchecked = 'it or a folder above it could not be checked (a folder listing failed)'
    const worlds: readonly [MemWorld, string][] = [
      [partsWorld({ dirs: { '/repo/.git': [], '/home/u/.claude': [link('cadre')] } }), LISTED_LINK],
      [partsWorld({ dirs: { '/repo/.git': [] } }), unchecked],
    ]
    for (const [world, reason] of worlds) {
      const host = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
      const reply = await runInit(memIo(world, PARTS_ANSWERS).io, { dryRun: false, host: host.io })
      const homeRuns = host.calls.filter(call => call.argv.some(arg => arg.startsWith('/home/u/')))
      expect(homeWrites(host)).toEqual([])
      expect(homeRuns).toEqual([])
      expect(reply.split('\n')).toContain(`warning: refused to write ${shownPm}: ${reason}`)
      expect(host.writes.map(write => write.path).at(-1)).toBe('/repo/.cadre/manifest.json')
    }
  })

  test('the global text reaches the private file only, no write under the repo (T-02-69, T-02-72)', async () => {
    const host = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    await runInit(memIo(partsWorld(), PARTS_ANSWERS).io, { dryRun: false, host: host.io })
    const holding = host.writes.filter(write => write.text.includes('Never commit secrets.'))
    const security = await memoryFolder('security')
    expect(holding.map(write => write.path)).toEqual([privateClaudeMdPath(security)])
  })
})

/** BE's built CLAUDE.md in builtWorld as the improver leaves it: its rule reworded and one line added (D-141). */
const BUILT_BE_IMPROVED = BUILT_BE.replace(BUILT_RULE, `${BUILT_RULE} Keep them green.\nKeep commits small.`)

/** The absolute path of BE's built CLAUDE.md in the fixture repo. */
const BE_CLAUDE_MD = '/repo/.cadre/be/CLAUDE.md'

/** The improver run of BE's built CLAUDE.md: guarded from its .runtime folder and from Bash (02-GAPS-B3 M1). */
const BE_IMPROVER_ARGV: readonly string[] = improverArgv(BE_CLAUDE_MD, improverGuardFlags('/repo', 'be') ?? [])

/** BE's built CLAUDE.md, repo-relative, as a file plan names it. */
const BE_CLAUDE_MD_PATH = '.cadre/be/CLAUDE.md'

/** The start of the per-file improver question (G-02-1f, D-141). */
const IMPROVER_PREFIX = "Accept the improver's changes"

/** The fixture user's installed_plugins.json with claude-md-management installed at user scope (D-141). */
function claudeMdInstalled(): string {
  return JSON.stringify({ plugins: { [CLAUDE_MD_PLUGIN]: [{ scope: 'user', version: '1.0.0' }] } })
}

/**
 * builtWorld's own files, in a new record a test changes as an improver run would, with claude-md-management installed
 * unless `isInstalled` is false (D-141).
 */
function builtFilesRecord(isInstalled = true): Record<string, string> {
  return {
    ...FULL_FILES,
    [GLOBAL_CLAUDE_MD]: `# Security\n${GLOBAL_SENTENCE}.\n`,
    '/repo/CLAUDE.md': `# Rules\n${BUILT_RULE}\n`,
    ...(isInstalled ? { [INSTALLED_PLUGINS_PATH]: claudeMdInstalled() } : {}),
  }
}

/**
 * The host of a plain init over builtWorld with `files` as its files, recording its writes and runs in one list: each
 * write that lands is put in `files`, as a disk holds it, so the improver finds each built file as apply wrote it
 * (02-GAPS-B3 M1); the rules `runs` first, then git tracks the root CLAUDE.md and names the common dir, and once the
 * improver ran for BE's built CLAUDE.md, `files` holds BUILT_BE_IMPROVED there, as that run would leave it (G-02-1f,
 * D-141).
 */
function improvingHost(
  files: Record<string, string>,
  runs: readonly HostRunRule[] = [],
): {
  readonly io: HostIo
  readonly host: MemHost
  readonly events: string[]
} {
  const host = memHost(hostWorld({ runs: [...runs, ...BUILT_TRACKED, COMMON_DIR_RULE] }))
  const logged = withHostEvents(host)
  const io: HostIo = {
    ...logged.io,
    write: async (path, text) => {
      const isWritten = await logged.io.write(path, text)
      if (isWritten) files[path] = text

      return isWritten
    },
    run: async (argv, options) => {
      const result = await logged.io.run(argv, options)
      if (argv.join(' ') === BE_IMPROVER_ARGV.join(' ')) files[BE_CLAUDE_MD] = BUILT_BE_IMPROVED

      return result
    },
  }

  return { io, host, events: logged.events }
}

/** The improver runs a host was asked for, `claude -p`, in order. */
function improverCalls(host: MemHost): HostCall[] {
  return host.calls.filter(call => call.argv[0] === 'claude' && call.argv[1] === '-p')
}

/** The text of the manifest a host wrote; '' when it wrote none. */
function writtenManifestText(host: MemHost): string {
  return host.writes.find(write => write.path === '/repo/.cadre/manifest.json')?.text ?? ''
}

describe('improver in init (G-02-1f)', () => {
  test('after Confirm each built file with a part gets one run, after the writes and before the manifest', async () => {
    const files = builtFilesRecord()
    const { io, host, events } = improvingHost(files)
    const run = memIo(builtWorld({ files }), { ...PARTS_ANSWERS, [IMPROVER_PREFIX]: 'Accept' })
    const reply = await runInit(run.io, { dryRun: false, host: io })
    const security = await memoryFolder('security')
    const text = privateClaudeMdPath(security)
    expect(improverCalls(host)).toEqual([
      { argv: BE_IMPROVER_ARGV, options: { cwd: '/repo/.cadre/be', timeoutMs: 300_000 } },
      { argv: improverArgv(text), options: { cwd: `${security}/instructions`, timeoutMs: 300_000 } },
    ])
    const firstRun = events.findIndex(event => event.startsWith('run claude -p'))
    const lastRun = events.findLastIndex(event => event.startsWith('run claude -p'))
    expect(events[firstRun - 1]).toBe(`write ${instructionsRecordPath(await memoryFolder('tl'))}`)
    expect(events.slice(lastRun + 1)).toEqual(['write /repo/.cadre/manifest.json'])
    expect(writtenManifestText(host)).toContain(await sha256Hex(BUILT_BE_IMPROVED))
    expect(writtenManifestText(host)).not.toContain(await sha256Hex(BUILT_BE))
    expect(reply.split('\n').slice(-2)).toEqual([improverLine({ changed: 1, total: 2 }), NEXT_STEP_NOTE])
    expect(reply.split('\n').filter(line => line.startsWith('warning: '))).toEqual([])
    const shownText = `~/.claude/cadre/${security.split('/').at(-2) ?? ''}/security/instructions/CLAUDE.md`
    expect(run.logged).toContain(improverNoChangeNote(shownText))
    expect(run.shown.filter(block => block.key === 'improver').map(block => block.lines[0])).toEqual([
      '.cadre/be/CLAUDE.md: 2 lines added, 1 removed',
    ])
  })

  test('Keep original writes the built text back after the runs; the manifest records the built text', async () => {
    const files = builtFilesRecord()
    const { io, host } = improvingHost(files)
    const run = memIo(builtWorld({ files }), { ...PARTS_ANSWERS, [IMPROVER_PREFIX]: 'Keep original' })
    const reply = await runInit(run.io, { dryRun: false, host: io })
    const beWrites = host.writes.filter(write => write.path === BE_CLAUDE_MD)
    expect(beWrites.map(write => [write.text, write.isWritten])).toEqual([
      [BUILT_BE, true],
      [BUILT_BE, true],
    ])
    expect(writtenManifestText(host)).toContain(await sha256Hex(BUILT_BE))
    expect(writtenManifestText(host)).not.toContain(await sha256Hex(BUILT_BE_IMPROVED))
    expect(host.writes.at(-1)?.path).toBe('/repo/.cadre/manifest.json')
    expect(reply.split('\n').at(-2)).toBe('Improver: 0 of 2 built files changed and accepted.')
  })

  test('a header-only built file gets no run, and a plain init with no built part runs none at all', async () => {
    const host = memHost(hostWorld({}))
    const reply = await runInit(memIo(builtWorld(), PARTS_DECLINED).io, { dryRun: false, host: host.io })
    expect(improverCalls(host)).toEqual([])
    expect(reply.split('\n').filter(line => line.startsWith('Improver:'))).toEqual([])
  })

  test('another file the improver changed is named in the reply, neither undone nor recorded (D-141)', async () => {
    const files = builtFilesRecord()
    const dirs: Record<string, readonly PortEntry[]> = { '/repo/.git': [], ...USER_DIR_LISTED, ...FULL_DIRS }
    const edited = '{"id":"be","edited":true}\n'
    const { io: improving, host } = improvingHost(files)
    const io: HostIo = {
      ...improving,
      run: async (argv, options) => {
        const result = await improving.run(argv, options)
        if (argv.join(' ') !== BE_IMPROVER_ARGV.join(' ')) return result
        files['/repo/.cadre/be/role.json'] = edited
        dirs['/repo/.cadre/be'] = [entry('CLAUDE.md'), entry('role.json')]

        return result
      },
    }
    const run = memIo(builtWorld({ files, dirs }), { ...PARTS_ANSWERS, [IMPROVER_PREFIX]: 'Accept' })
    const reply = await runInit(run.io, { dryRun: false, host: io })
    const warning = otherChangesWarning('.cadre/be', ['.cadre/be/role.json'])
    expect(reply.split('\n').filter(line => line.startsWith('warning: '))).toEqual([`warning: ${warning}`])
    const roleWrites = host.writes.filter(write => write.path === '/repo/.cadre/be/role.json')
    expect(roleWrites).toHaveLength(1)
    expect(writtenManifestText(host)).toContain(await sha256Hex(roleWrites[0]?.text ?? ''))
    expect(writtenManifestText(host)).not.toContain(await sha256Hex(edited))
    expect(run.shown.filter(block => block.key === 'improver').at(-1)?.lines).toContain('  .cadre/be/role.json')
  })

  test('a dry run holds no host: it runs no improver and asks, shows and replies nothing of it', async () => {
    const run = memIo(builtWorld(), { ...PARTS_ANSWERS, [IMPROVER_PREFIX]: 'Accept' })
    const reply = await runInit(run.io, { dryRun: true })
    expect(firstLines(run.asked).filter(question => question.startsWith(IMPROVER_PREFIX))).toEqual([])
    expect(run.shown.filter(block => block.key === 'improver')).toEqual([])
    expect(reply.split('\n').filter(line => line.startsWith('Improver:'))).toEqual([])
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
  })
})

/**
 * The answers of a plain init over builtWorld with the improver install question answered `answer` and every improver
 * change accepted (G-02-1f, D-141).
 */
function improverOffer(answer: string): Readonly<Record<string, string>> {
  return { ...PARTS_ANSWERS, [IMPROVER_INSTALL_PREFIX]: answer, [IMPROVER_PREFIX]: 'Accept' }
}

/** The last line of the review when claude-md-management is the one plugin answered Install (D-141). */
const IMPROVER_INSTALL_ROW = `Plugins to install after Confirm (a --dry-run installs nothing): ${CLAUDE_MD_PLUGIN}`

/** The last review block a run showed, or none. */
function lastReview(run: MemRun): readonly string[] {
  return run.shown.findLast(block => block.key === 'review')?.lines ?? []
}

describe('improver install offer (G-02-1f)', () => {
  test('the question, its context, its cancel reason and the plugin key are fixed', () => {
    expect(IMPROVER_INSTALL_QUESTION).toBe(
      'Install claude-md-management from claude-plugins-official after you confirm the plan? Its claude-md-improver ' +
        "tidies each role's built CLAUDE.md, and you accept or keep each change.",
    )
    expect(IMPROVER_INSTALL_CONTEXT).toBe(
      'Without it the built files stay as cadre wrote them; a --dry-run installs nothing.',
    )
    expect(IMPROVER_INSTALL_DISMISSED_REASON).toBe('The claude-md-management question was dismissed or not answered.')
    expect(CLAUDE_MD_PLUGIN).toBe('claude-md-management@claude-plugins-official')
  })

  test('asked after the security question when a role got a built part and the plugin is missing', async () => {
    const run = memIo(builtWorld({ files: builtFilesRecord(false) }), improverOffer('Not now'))
    await runInit(run.io, { dryRun: true })
    const asked = firstLines(run.asked)
    const at = asked.indexOf(IMPROVER_INSTALL_QUESTION)
    expect(at).toBeGreaterThan(asked.findIndex(question => question.startsWith(SECURITY_INSTALL_PREFIX)))
    expect(asked.findIndex(question => question.startsWith(SECURITY_INSTALL_PREFIX))).toBeGreaterThan(0)
    expect(run.asked[at]).toBe(withContext(IMPROVER_INSTALL_QUESTION, IMPROVER_INSTALL_CONTEXT))
    expect(run.specs[at]).toEqual({ options: ['Install', 'Not now'], header: 'Improver' })
    expect(asked.filter(question => question === IMPROVER_INSTALL_QUESTION)).toHaveLength(1)
  })

  test('not asked when no role got a part, nor when claude-md-management is installed', async () => {
    const declined = memIo(builtWorld({ files: builtFilesRecord(false) }), PARTS_DECLINED)
    await runInit(declined.io, { dryRun: true })
    const memoriesOnly = memIo(
      memoriesWorld({ replies: [PARTS_TOPICS_REPLY, '{"topics":{"T1":[],"T2":[]},"memories":{"M1":["tl"]}}'] }),
      PARTS_ANSWERS,
    )
    await runInit(memoriesOnly.io, { dryRun: true })
    const installed = memIo(builtWorld({ files: builtFilesRecord() }), PARTS_ANSWERS)
    await runInit(installed.io, { dryRun: true })
    for (const run of [declined, memoriesOnly, installed]) {
      expect(firstLines(run.asked)).not.toContain(IMPROVER_INSTALL_QUESTION)
    }
    expect([memoriesOnly, installed].map(run => firstLines(run.asked).includes(CONTENT_QUESTION))).toEqual([
      true,
      true,
    ])
  })

  test('Install puts the key on the review; Confirm installs it from home, then the improver runs', async () => {
    const files = builtFilesRecord(false)
    const { io, host } = improvingHost(files)
    const run = memIo(builtWorld({ files }), improverOffer('Install'))
    const reply = await runInit(run.io, { dryRun: false, host: io })
    expect(lastReview(run).slice(-2)).toEqual([IMPROVER_INSTALL_ROW, improverRunLine(2)])
    const install = host.calls.findIndex(call => call.argv.join(' ') === `claude plugin install ${CLAUDE_MD_PLUGIN}`)
    expect(install).toBeGreaterThanOrEqual(0)
    expect(host.calls[install]?.options).toEqual({ cwd: '/home/u', timeoutMs: 180_000 })
    expect(host.calls.findIndex(call => call.argv[1] === '-p')).toBeGreaterThan(install)
    expect(improverCalls(host)).toHaveLength(2)
    expect(reply.split('\n').slice(-3)).toEqual([
      installedLine([CLAUDE_MD_PLUGIN]),
      improverLine({ changed: 1, total: 2 }),
      NEXT_STEP_NOTE,
    ])
  })

  test('Not now, or an install that fails, runs no improver at all', async () => {
    const files = builtFilesRecord(false)
    const notNow = improvingHost(files)
    const reply = await runInit(memIo(builtWorld({ files }), improverOffer('Not now')).io, {
      dryRun: false,
      host: notNow.io,
    })
    expect([improverCalls(notNow.host), notNow.host.calls.filter(call => call.argv[1] === 'plugin')]).toEqual([[], []])
    expect(reply.split('\n').filter(line => line.startsWith('Improver:'))).toEqual([])
    const failedFiles = builtFilesRecord(false)
    const failedRun: HostRun = { exitCode: 1, stdout: '', stderr: 'no such marketplace' }
    const failing = improvingHost(failedFiles, [
      { argv: ['claude', 'plugin', 'install', CLAUDE_MD_PLUGIN], result: failedRun },
      { argv: MARKETPLACE_ADD_ARGV, result: failedRun },
    ])
    const failedReply = await runInit(memIo(builtWorld({ files: failedFiles }), improverOffer('Install')).io, {
      dryRun: false,
      host: failing.io,
    })
    expect(improverCalls(failing.host)).toEqual([])
    expect(failedReply.split('\n')).toContain(`warning: ${installFailureText(CLAUDE_MD_PLUGIN, true)}`)
    expect(failedReply.split('\n').filter(line => line.startsWith('Improver:'))).toEqual([])
  })

  test('with claude-md-management installed nothing is asked or installed, and the improver runs', async () => {
    const files = builtFilesRecord()
    const { io, host } = improvingHost(files)
    const run = memIo(builtWorld({ files }), improverOffer('Install'))
    await runInit(run.io, { dryRun: false, host: io })
    expect(firstLines(run.asked)).not.toContain(IMPROVER_INSTALL_QUESTION)
    expect(host.calls.filter(call => call.argv[1] === 'plugin')).toEqual([])
    expect(improverCalls(host)).toHaveLength(2)
    expect(lastReview(run).filter(line => line.startsWith('Plugins to install'))).toEqual([])
  })

  test('a dismissed offer cancels with nothing written; a dry run lists the install and installs nothing', async () => {
    const host = memHost(hostWorld({}))
    const answers = Object.fromEntries(Object.entries(PARTS_ANSWERS).filter(([key]) => key !== IMPROVER_INSTALL_PREFIX))
    const reply = await runInit(memIo(builtWorld(), answers).io, { dryRun: false, host: host.io })
    expect(reply).toBe(cancelledReply(IMPROVER_INSTALL_DISMISSED_REASON))
    expect([host.writes, host.calls]).toEqual([[], []])
    const dry = memIo(builtWorld(), improverOffer('Install'))
    const dryReply = await runInit(dry.io, { dryRun: true })
    expect(lastReview(dry).slice(-2)).toEqual([IMPROVER_INSTALL_ROW, improverRunLine(2)])
    expect(dryReply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
  })
})

/**
 * The private files of these roles as a plain init writes them when it gives them nothing private: the header-only text
 * file, then the empty record, role by role in the order given (02-GAPS-B3 C1).
 */
async function emptyPrivates(ids: readonly string[]): Promise<HostWrite[]> {
  const folders = await Promise.all(ids.map(memoryFolder))

  return folders.flatMap((folder, at) => [
    { path: privateClaudeMdPath(folder), text: privateClaudeMdText(ids[at] ?? '', 'repo', []), isWritten: true },
    { path: instructionsRecordPath(folder), text: instructionsRecordText([], []), isWritten: true },
  ])
}

/** The `/bin/chmod 700` runs of a host: the private folder levels it made private (02-GAPS-B2 N13). */
function privateChmods(host: MemHost): string[] {
  const chmods = host.calls.filter(call => call.argv[0] === '/bin/chmod' && call.argv[1] === '700')

  return chmods.map(call => call.argv[2] ?? '')
}

describe('private files for every role (02-GAPS-B3 C1)', () => {
  test('after Whole files or No every role gets a header-only text file and an empty record; no improver', async () => {
    const whole = { ...PARTS_ANSWERS, [INSTRUCTIONS_ENTRY_QUESTION]: 'Whole files' }
    for (const answers of [PARTS_DECLINED, whole]) {
      const files = builtFilesRecord()
      const host = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
      await runInit(memIo(builtWorld({ files }), answers).io, { dryRun: false, host: host.io })
      expect(homeWrites(host)).toEqual(await emptyPrivates(BUILT_TEAM))
      expect(host.calls.filter(call => call.argv[1] === 'rev-parse')).toEqual([COMMON_DIR_CALL])
      expect(improverCalls(host)).toEqual([])
    }
    expect(instructionsRecordText([], [])).toBe('{\n  "memories": [],\n  "parts": [],\n  "schema": 1\n}\n')
  })

  test('git names the role memory folders on every plain init; with no home folder no role gets them', async () => {
    const host = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    await runInit(memIo(gitWorld(), INIT_ANSWERS).io, { dryRun: false, host: host.io })
    expect(host.calls.filter(call => call.argv[1] === 'rev-parse')).toEqual([COMMON_DIR_CALL])
    expect(homeWrites(host)).toEqual(await emptyPrivates(['pm', 'security', 'tl']))
    const locations = { ...DEFAULT_LOCATIONS, home: null }
    const homeless = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    const reply = await runInit(memIo(gitWorld({ locations }), INIT_ANSWERS).io, { dryRun: false, host: homeless.io })
    expect(reply.split('\n')).toContain(DEFAULT_FOLDERS_UNKNOWN)
    expect([homeless.calls.filter(call => call.argv[0] === 'git'), homeWrites(homeless)]).toEqual([[], []])
  })

  test('a re-init that gives a role no memory any more writes it an empty record', async () => {
    const replies = [PARTS_TOPICS_REPLY, '{"topics":{"T1":["security"],"T2":["tl"]},"memories":{"M1":["pm"],"M2":[]}}']
    const first = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    await runInit(memIo(memoriesWorld({ replies }), PARTS_ANSWERS).io, { dryRun: false, host: first.io })
    const record = instructionsRecordPath(await memoryFolder('pm'))
    const recordOf = (host: MemHost): string | undefined => host.writes.find(write => write.path === record)?.text
    expect(recordOf(first)).toBe(instructionsRecordText([], [await squadMemory()]))
    const again = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    const world = withWrites(memoriesWorld({ replies: [PARTS_TOPICS_REPLY, PARTS_RECOMMEND_REPLY] }), first.writes)
    await runInit(memIo(world, PARTS_ANSWERS).io, { dryRun: false, host: again.io })
    expect(recordOf(again)).toBe(instructionsRecordText([], []))
  })
})

/** builtWorld's folders once an init wrote `.cadre/`: the root lists it, so the next scan reads its manifest. */
function builtAfterDirs(): Readonly<Record<string, readonly PortEntry[]>> {
  return {
    '/repo/.git': [],
    ...FULL_DIRS,
    '/repo': [...FULL_DIRS['/repo'], entry('.cadre', 'dir')],
    '/repo/.cadre': [],
  }
}

describe('an unchanged re-init (02-GAPS-B3 S1)', () => {
  test('a role whose record is unchanged gets no private step: no write and no chmod of its levels', async () => {
    const first = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    await runInit(memIo(partsWorld(), PARTS_ANSWERS).io, { dryRun: false, host: first.io })
    expect(homeWrites(first)).toHaveLength(6)
    const again = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    const reply = await runInit(memIo(withWrites(partsWorld(), first.writes), PARTS_ANSWERS).io, {
      dryRun: false,
      host: again.io,
    })
    expect([homeWrites(again), privateChmods(again)]).toEqual([[], []])
    expect(reply.split('\n').filter(line => line.startsWith('warning: '))).toEqual([])
    const security = await memoryFolder('security')
    const changed = withWrites(partsWorld(), [
      ...first.writes,
      { path: instructionsRecordPath(security), text: '{}\n', isWritten: true },
    ])
    const third = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    await runInit(memIo(changed, PARTS_ANSWERS).io, { dryRun: false, host: third.io })
    expect(homeWrites(third).map(write => write.path)).toEqual([
      privateClaudeMdPath(security),
      instructionsRecordPath(security),
    ])
    expect(privateChmods(third)).toEqual([
      '/home/u/.claude/cadre',
      await slugFolder(),
      security,
      `${security}/instructions`,
    ])
  })

  test('an accepted improver text is kept with its manifest entry while the records are unchanged', async () => {
    const files = builtFilesRecord()
    const first = improvingHost(files)
    const answers = { ...PARTS_ANSWERS, [IMPROVER_PREFIX]: 'Accept' }
    await runInit(memIo(builtWorld({ files }), answers).io, { dryRun: false, host: first.io })
    expect(files[BE_CLAUDE_MD]).toBe(BUILT_BE_IMPROVED)
    const manifest = files['/repo/.cadre/manifest.json'] ?? ''
    expect(manifest).toContain(await sha256Hex(BUILT_BE_IMPROVED))
    const again = improvingHost(files)
    const run = memIo(builtWorld({ files, dirs: builtAfterDirs() }), answers)
    const reply = await runInit(run.io, { dryRun: false, host: again.io })
    expect(reply.split('\n').slice(-2)).toEqual([APPLIED_NONE_NOTE, NEXT_STEP_NOTE])
    expect(opKinds(reply).get(BE_CLAUDE_MD_PATH)).toBe(undefined)
    expect(opKinds(reply).get('.cadre/be/role.json')).toBe('leave')
    expect([improverCalls(again.host), again.host.writes]).toEqual([[], []])
    expect(files[BE_CLAUDE_MD]).toBe(BUILT_BE_IMPROVED)
    expect(files['/repo/.cadre/manifest.json']).toBe(manifest)
    expect(shownBlock(run, 'review').filter(line => line.endsWith(BE_CLAUDE_MD_PATH))).toEqual([])
    const dry = await runInit(memIo(builtWorld({ files, dirs: builtAfterDirs() }), answers).io, { dryRun: true })
    expect(opKinds(dry).get(BE_CLAUDE_MD_PATH)).toBe(undefined)
  })

  test('a role whose records changed plans a change of its built file', async () => {
    const files = builtFilesRecord()
    const answers = { ...PARTS_ANSWERS, [IMPROVER_PREFIX]: 'Accept' }
    await runInit(memIo(builtWorld({ files }), answers).io, { dryRun: false, host: improvingHost(files).io })
    files['/repo/CLAUDE.md'] = `# Rules\n${BUILT_RULE} Always.\n`
    const dry = await runInit(memIo(builtWorld({ files, dirs: builtAfterDirs() }), answers).io, { dryRun: true })
    expect([opKinds(dry).get(BE_CLAUDE_MD_PATH), opKinds(dry).get('.cadre/be/role.json')]).toEqual([
      'change',
      'change',
    ])
  })
})

describe('what Confirm writes outside the repo (02-GAPS-B3 S4)', () => {
  test('the private files row, its heading and the improver line are fixed', () => {
    expect(privateFilesRow('be')).toBe(
      '    private files: <config dir>/cadre/<repo>-<hash8>/be/instructions/CLAUDE.md and instructions.json ' +
        '(outside the repo, never committed)',
    )
    expect(PRIVATE_FILES_HEADING).toBe('Private files per role (written after Confirm):')
    expect([improverRunLine(1), improverRunLine(2)]).toEqual([
      'After Confirm, claude-md-improver runs on up to 1 built file (claude -p, acceptEdits, up to 5 minutes each); ' +
        'you accept or keep each change.',
      'After Confirm, claude-md-improver runs on up to 2 built files (claude -p, acceptEdits, up to 5 minutes each); ' +
        'you accept or keep each change.',
    ])
  })

  test('a whole-files review lists the heading, then the private files of each role in role order', async () => {
    const whole = { ...PARTS_ANSWERS, [INSTRUCTIONS_ENTRY_QUESTION]: 'Whole files' }
    const run = memIo(builtWorld(), whole)
    await runInit(run.io, { dryRun: true })
    const review = shownBlock(run, 'review')
    const at = review.indexOf(PRIVATE_FILES_HEADING)
    const ids = review.filter(line => line.startsWith('Scope card: ')).map(line => /\(([^)]+)\)$/.exec(line)?.[1] ?? '')
    expect(ids).toHaveLength(6)
    expect(review.slice(at, at + 7)).toEqual([PRIVATE_FILES_HEADING, ...ids.map(privateFilesRow)])
    expect(review[at + 7]).toBe('File plan:')
  })

  test('with claude-md-management in, the review ends with the improver line; without it, it has none', async () => {
    const installed = memIo(builtWorld({ files: builtFilesRecord() }), PARTS_ANSWERS)
    await runInit(installed.io, { dryRun: true })
    expect(lastReview(installed).at(-1)).toBe(improverRunLine(2))
    const notNow = memIo(builtWorld({ files: builtFilesRecord(false) }), improverOffer('Not now'))
    await runInit(notNow.io, { dryRun: true })
    expect(lastReview(notNow).filter(line => line.startsWith('After Confirm, claude-md-improver'))).toEqual([])
  })

  test('the --dry-run reply names the private files and the improver before its note, a plain one not', async () => {
    const installed = memIo(builtWorld({ files: builtFilesRecord() }), PARTS_ANSWERS)
    const dry = (await runInit(installed.io, { dryRun: true })).split('\n')
    const at = dry.indexOf(launchLine({ kind: 'git-root' }))
    const ids = shownBlock(installed, 'review')
      .filter(line => line.startsWith('Scope card: '))
      .map(line => /\(([^)]+)\)$/.exec(line)?.[1] ?? '')
    expect(dry.slice(at + 1)).toEqual([
      PRIVATE_FILES_HEADING,
      ...ids.map(privateFilesRow),
      improverRunLine(2),
      DRY_RUN_NOTE,
    ])
    const files = builtFilesRecord()
    const plain = await runInit(memIo(builtWorld({ files }), { ...PARTS_ANSWERS, [IMPROVER_PREFIX]: 'Accept' }).io, {
      dryRun: false,
      host: improvingHost(files).io,
    })
    const named = plain.split('\n').filter(line => line === PRIVATE_FILES_HEADING || line.startsWith('After Confirm'))
    expect(named).toEqual([])
  })
})

describe('carryStep', () => {
  const roles = proposeRoles(FULL_SCAN).roles
  /** The carry facts of user settings with two env variables and nothing else. */
  const noCarry = { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] }
  const twoNames = emptySetupScan({ carry: { ...noCarry, envNames: ['API_KEY', 'JIRA_URL'] } })
  const ENV_QUESTION =
    'Which env variables do roles carry? Names: API_KEY, JIRA_URL (values are never stored; e.g. API_KEY, or none)'
  /** The env question as asked: the team's role ids and where the values come from under it (D-136). */
  const ENV_ASKED = withContext(ENV_QUESTION, envContextLine(roles))

  /** A hook script registered for an event in the user settings. */
  function hook(script: string, event = 'PreToolUse'): HookScript {
    return { script, event, source: 'user' }
  }

  test('the env question is asked once, and every role carries the picked names only', async () => {
    const run = memIo(memWorld({}), ['JIRA_URL'])
    const carried = valueOf(await carryStep(run.io, roles, twoNames))
    expect(run.asked).toEqual([ENV_ASKED])
    expect(run.specs).toEqual([{ options: ['None', 'All of them'], header: 'Env' }])
    const carry = { autoCompactWindow: false, statusLine: false, env: ['JIRA_URL'], hooks: [] }
    expect(carried.map(role => role.carry)).toEqual(roles.map(() => carry))
    expect(run.logged).toEqual([])
  })

  test('All of them carries every scanned name, None carries none, and NAME=value is asked again', async () => {
    const all = memIo(memWorld({}), ['API_KEY=x', 'All of them'])
    const carried = valueOf(await carryStep(all.io, roles, twoNames))
    expect(carried.every(role => role.carry.env.join() === 'API_KEY,JIRA_URL')).toBe(true)
    const refusal = `'API_KEY=x' isn't one of: "None", "All of them", or names from the list, typed exactly.`
    expect(all.asked).toEqual([ENV_ASKED, `${refusal}\n${ENV_ASKED}`])
    const none = valueOf(await carryStep(memIo(memWorld({}), ['None']).io, roles, twoNames))
    expect(none.every(role => role.carry.env.length === 0)).toBe(true)
  })

  test('the side pane lists every scanned env name right before the env question, names only (D-135)', async () => {
    const names = Array.from({ length: 40 }, (_, at) => `CADRE_UAT_NAME_${String(at + 1).padStart(2, '0')}`)
    const forty = emptySetupScan({ carry: { ...noCarry, envNames: names } })
    const run = memIo(memWorld({}), ['CADRE_UAT_NAME_40'])
    const { io, events } = withEvents(run)
    const carried = valueOf(await carryStep(io, roles, forty))
    expect(run.shown).toEqual([
      {
        key: 'env',
        title: 'Env variables',
        lines: ['Env variable names in your settings (values are never read):', ...names.map(name => `  ${name}`)],
      },
    ])
    expect(events).toEqual(['show env', `ask ${envQuestion(names)}`])
    expect(envQuestion(names)).toContain('+35 more')
    expect(carried.map(role => role.carry.env)).toEqual(roles.map(() => ['CADRE_UAT_NAME_40']))
  })

  test('with no env names nothing is asked; autoCompactWindow and the status line are carried when set', async () => {
    const run = memIo(memWorld({}), [])
    const set = emptySetupScan({ carry: { ...noCarry, autoCompactWindow: 800000, hasStatusLine: true } })
    const carried = valueOf(await carryStep(run.io, roles, set))
    expect([run.asked, run.shown]).toEqual([[], []])
    const carry = { autoCompactWindow: true, statusLine: true, env: [], hooks: [] }
    expect(carried.map(role => role.carry)).toEqual(roles.map(() => carry))
    const bare = valueOf(await carryStep(memIo(memWorld({}), []).io, roles, emptySetupScan()))
    const nothing = { autoCompactWindow: false, statusLine: false, env: [], hooks: [] }
    expect(bare.map(role => role.carry)).toEqual(roles.map(() => nothing))
  })

  test('of the user hooks only the GSD secret read guard is carried, once, by every role', async () => {
    const hooks = [
      hook('gsd-secret-read-guard.js'),
      hook('gsd-context-monitor.js', 'PostToolUse'),
      hook('my-hook.sh'),
      hook('gsd-secret-read-guard.js', 'PostToolUse'),
    ]
    const carried = valueOf(await carryStep(memIo(memWorld({}), []).io, roles, emptySetupScan({ hooks })))
    expect(carried.map(role => role.carry.hooks)).toEqual(roles.map(() => ['gsd-secret-read-guard.js']))
  })

  test('the guard is matched by its whole name, with a .js, .cjs or .sh extension', async () => {
    const scripts = [
      'gsd-secret-read-guard.sh',
      'gsd-secret-read-guard.py',
      'my-gsd-secret-read-guard.js',
      'gsd-secret-read-guard.js.bak',
      'gsd-secret-read-guard.cjs',
    ]
    const setup = emptySetupScan({ hooks: scripts.map(script => hook(script)) })
    const [first] = valueOf(await carryStep(memIo(memWorld({}), []).io, roles, setup))
    expect(first?.carry.hooks).toEqual(['gsd-secret-read-guard.cjs', 'gsd-secret-read-guard.sh'])
  })

  test('the guard is carried when any settings source registers it: user, project or local (D-103)', async () => {
    const placements = [
      { user: GUARD_SETTINGS, project: {}, local: {} },
      { user: {}, project: GUARD_SETTINGS, local: {} },
      { user: {}, project: {}, local: GUARD_SETTINGS },
    ]
    for (const settings of placements) {
      const gathered = await gatherScans(memIo(gitWorld({ settings }), {}).io, DEFAULT_LOCATIONS, false)
      const carried = valueOf(await carryStep(memIo(memWorld({}), []).io, roles, gathered.setup))
      expect(carried.map(role => role.carry.hooks)).toEqual(roles.map(() => ['gsd-secret-read-guard.js']))
    }
  })

  test('a dismissal or three answers that name no scanned variable cancel with their reason (A1)', async () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], ENV_DISMISSED_REASON],
      [['HOME', 'jira_url', 'API_KEY JIRA_URL=1'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await carryStep(run.io, roles, twoNames)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(ENV_DISMISSED_REASON).toBe('The env variables question was dismissed or not answered.')
  })

  test('init asks the assignment, memory and env questions after the model questions, in that order', async () => {
    const run = memIo(secretWorld(), PARTS_DECLINED)
    await runInit(run.io, { dryRun: true })
    const asked = firstLines(run.asked)
    const modelAt = asked.indexOf('Model and effort for all roles?')
    expect(asked.slice(modelAt + 1, modelAt + 8)).toEqual([
      'Which roles get the sentry MCP server? (e.g. BE, QA, or none)',
      'Which roles get codex skills (1)? (e.g. BE, QA, or none)',
      CONTENT_QUESTION,
      'Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)',
      'Which roles get the auto-memories for this repo (notes.md)? (e.g. PM, TL, or none)',
      'Which roles get the project CLAUDE.md (<repo>/CLAUDE.md)? (e.g. PM, TL, or none)',
      ENV_QUESTION,
    ])
    expect(asked[modelAt + 8]).toBe(GIT_POLICY_QUESTION)
  })

  test('no env, settings or file value of the secret world reaches a question, log or pane (T-02-34)', async () => {
    const run = memIo(secretWorld(), { ...PARTS_DECLINED, 'Which env variables': 'All of them' })
    const reply = await runInit(run.io, { dryRun: true })
    expect(run.asked.filter(question => question.startsWith('Which '))).toHaveLength(6)
    const text = [...run.asked, ...run.logged, ...paneText(run), reply].join('\n')
    expect(leaks(text, [...SECRET_FIXTURES, ...ABSOLUTE_PATH_MARKERS])).toEqual([])
  })

  test('the roles it is given are never changed', async () => {
    const before = JSON.stringify(roles)
    await carryStep(memIo(memWorld({}), ['All of them']).io, roles, twoNames)
    expect(JSON.stringify(roles)).toBe(before)
  })
})

/** A user-level GSD at ~/.claude/gsd-core whose identity is proven, as detection reports it. */
const PROVEN_USER_GSD: GsdFact = {
  location: 'user',
  dir: '~/.claude/gsd-core',
  version: '1.16.0',
  identity: 'proven',
  runtimeIdentityTried: false,
}

/** The detect facts of a user whose GSD at ~/.claude/gsd-core is proven, with its raw dir. */
const PROVEN_FACTS: InitFacts = {
  facts: { ...EMPTY_FACTS, gsd: [PROVEN_USER_GSD] },
  gsdUserDir: '/home/u/.claude/gsd-core',
}

describe('hunkStep', () => {
  /** PM, Team Lead and Security on the repo default framework: a repo with no source keeps them. */
  const roles = proposeRoles(repoScan()).roles
  const CONFIG = '/repo/.planning/config.json'
  const USER_TOOL = 'node ~/.claude/gsd-core/bin/gsd-tools.cjs'
  const REPO_TOOL = 'node .claude/gsd-core/bin/gsd-tools.cjs'
  const AT_TARGETS = '{"mode":"yolo","workflow":{"text_mode":false}}'
  const BUTTONS = ['Accept', 'Decline']
  /** What the step gives when it asks nothing: accepted with no hunk. */
  const NO_HUNKS = { kind: 'accepted', value: [] }

  /** A world whose `.planning/config.json` holds this text. */
  function configWorld(text: string): MemWorld {
    return memWorld({ files: { [CONFIG]: text } })
  }

  /** What the scans gave: these detect facts, an empty repo scan, and gsd-statusline as the statusline or not. */
  function gatheredOf(facts: InitFacts, isGsdStatusline = false): Gathered {
    const carry = { autoCompactWindow: null, hasStatusLine: isGsdStatusline, isGsdStatusline, envNames: [] }

    return { facts, repo: repoScan(), setup: emptySetupScan({ carry }) }
  }

  /** The step input for these roles on the repo default `repoDefault`, at the fixture locations. */
  function input(
    repoDefault: FrameworkId | null,
    gathered: Gathered,
    list: readonly RoleSpec[] = roles,
  ): Parameters<typeof hunkStep>[1] {
    return { roles: list, repoDefault, gathered, locations: DEFAULT_LOCATIONS }
  }

  test('with no role on GSD nothing is read or asked, no hunk is given and nothing is attended', async () => {
    const onSuperpowers = roles.map(role => withFramework(role, 'superpowers'))
    const defaults: readonly (FrameworkId | null)[] = ['superpowers', 'none', null]
    for (const repoDefault of defaults) {
      for (const list of [roles, onSuperpowers]) {
        const run = memIo(configWorld('{"mode":"interactive"}'), ['Accept', 'Accept'])
        expect(await hunkStep(run.io, input(repoDefault, gatheredOf(PROVEN_FACTS), list))).toEqual(NO_HUNKS)
        expect(run.asked).toEqual([])
        expect(run.reads).toEqual([])
        expect(run.logged).toEqual([])
      }
    }
    const run = memIo(configWorld('{"mode":"interactive"}'), [])
    expect(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS), onSuperpowers))).toEqual(NO_HUNKS)
    expect(run.asked).toEqual([])
  })

  test('a GSD role asks each hunk in turn, Hunk 1 of 2 then Hunk 2 of 2, and each op records the answer', async () => {
    const run = memIo(configWorld('{"mode":"interactive"}'), ['Accept', 'Decline'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS))))
    expect(run.asked.map(question => question.split('\n')[0])).toEqual([
      '.planning/config.json: mode',
      '.planning/config.json: workflow.text_mode',
    ])
    expect(run.specs).toEqual([
      { options: BUTTONS, header: 'Hunk 1 of 2' },
      { options: BUTTONS, header: 'Hunk 2 of 2' },
    ])
    const hunk = { kind: 'hunk', file: '.planning/config.json', isRequired: true, isRunnable: true }
    expect(hunks).toEqual([
      {
        ...hunk,
        key: 'mode',
        before: '"interactive"',
        after: '"yolo"',
        isAccepted: true,
        command: 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
      },
      {
        ...hunk,
        key: 'workflow.text_mode',
        before: NOT_SET_TEXT,
        after: 'false',
        isAccepted: false,
        command: `${USER_TOOL} config-set workflow.text_mode false`,
      },
    ])
  })

  test('a declined required hunk leaves the GSD roles attended, and the note names its key', async () => {
    const run = memIo(configWorld('{"mode":"interactive"}'), ['Accept', 'Decline'])
    await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS)))
    expect(run.logged).toEqual([attendedNote(['workflow.text_mode'])])
    expect(run.shown).toEqual([{ key: 'notes', title: 'Notes', lines: [attendedNote(['workflow.text_mode'])] }])
    expect(run.logged).toEqual([
      'attended: GSD needs a person until workflow.text_mode is set as proposed',
    ])
  })

  test('both accepted with a proven user GSD: runnable, and nothing is attended', async () => {
    const run = memIo(configWorld('{"mode":"interactive"}'), ['Accept', ' accept '])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS))))
    expect(hunks.map(hunk => [hunk.isAccepted, hunk.isRunnable])).toEqual([
      [true, true],
      [true, true],
    ])
    expect(run.logged).toEqual([])
  })

  test('with no proven user GSD the hunks show the repo command, cannot run, and attend when accepted', async () => {
    const unproven: InitFacts = {
      facts: { ...EMPTY_FACTS, gsd: [{ ...PROVEN_USER_GSD, identity: 'unknown' }] },
      gsdUserDir: '/home/u/.claude/gsd-core',
    }
    for (const facts of [unproven, { facts: EMPTY_FACTS, gsdUserDir: null }]) {
      const run = memIo(configWorld('{"mode":"interactive"}'), ['Accept', 'Accept'])
      const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(facts))))
      expect(hunks.map(hunk => [hunk.isAccepted, hunk.isRunnable, hunk.command])).toEqual([
        [true, false, `${REPO_TOOL} config-set mode yolo`],
        [true, false, `${REPO_TOOL} config-set workflow.text_mode false`],
      ])
      expect(run.logged).toEqual([attendedNote(['mode', 'workflow.text_mode'])])
    }
  })

  test('a config already at the targets asks nothing and attends nothing', async () => {
    const run = memIo(configWorld(AT_TARGETS), [])
    expect(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS)))).toEqual(NO_HUNKS)
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
  })

  test('the optional context_warnings hunk comes only under gsd-statusline; declining it attends nothing', async () => {
    const quiet = memIo(configWorld(AT_TARGETS), [])
    expect(await hunkStep(quiet.io, input('gsd', gatheredOf(PROVEN_FACTS, false)))).toEqual(NO_HUNKS)
    const run = memIo(configWorld(AT_TARGETS), ['Decline'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS, true))))
    expect(run.specs).toEqual([{ options: BUTTONS, header: 'Hunk 1 of 1' }])
    expect(hunks.map(hunk => [hunk.key, hunk.isRequired, hunk.isAccepted])).toEqual([
      ['hooks.context_warnings', false, false],
    ])
    expect(run.logged).toEqual([])
  })

  test('the ordering edge: three hunks come in GSD_AUTONOMY order under Hunk 1 of 3 to Hunk 3 of 3', async () => {
    const run = memIo(configWorld('{}'), ['Accept', 'Accept', 'Accept'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS, true))))
    expect(hunks.map(hunk => hunk.key)).toEqual(['mode', 'workflow.text_mode', 'hooks.context_warnings'])
    expect(run.specs.map(spec => spec.header)).toEqual(['Hunk 1 of 3', 'Hunk 2 of 3', 'Hunk 3 of 3'])
  })

  test('one role on GSD is enough, by its own framework or by the repo default', async () => {
    const tlOnGsd = roles.map(role => withFramework(role, role.id === 'tl' ? 'gsd' : 'superpowers'))
    const own = memIo(configWorld('{}'), ['Accept', 'Accept'])
    expect(valueOf(await hunkStep(own.io, input(null, gatheredOf(PROVEN_FACTS), tlOnGsd)))).toHaveLength(2)
    const tlOff = roles.map(role => (role.id === 'tl' ? withFramework(role, 'superpowers') : role))
    const byDefault = memIo(configWorld('{}'), ['Accept', 'Accept'])
    expect(valueOf(await hunkStep(byDefault.io, input('gsd', gatheredOf(PROVEN_FACTS), tlOff)))).toHaveLength(2)
  })

  test('the config is read through readRepoFile: a link out of the repo is unknown and never read', async () => {
    const world = memWorld({ files: { [CONFIG]: AT_TARGETS }, realPaths: { [CONFIG]: '/elsewhere/config.json' } })
    const run = memIo(world, ['Accept', 'Accept'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS))))
    expect(hunks.map(hunk => hunk.before)).toEqual([UNKNOWN_CONFIG_TEXT, UNKNOWN_CONFIG_TEXT])
    expect(run.reads).not.toContain(CONFIG)
  })

  test('a missing config file offers both required hunks as not set', async () => {
    const run = memIo(memWorld({}), ['Decline', 'Decline'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS))))
    expect(hunks.map(hunk => [hunk.key, hunk.before, hunk.isAccepted])).toEqual([
      ['mode', NOT_SET_TEXT, false],
      ['workflow.text_mode', NOT_SET_TEXT, false],
    ])
    expect(run.logged).toEqual([attendedNote(['mode', 'workflow.text_mode'])])
  })

  test('only Accept accepts: an answer that is neither Accept nor Decline is asked again with why on top', async () => {
    const run = memIo(configWorld('{}'), ['yes', 'Accept', 'DECLINE'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS))))
    expect(hunks.map(hunk => hunk.isAccepted)).toEqual([true, false])
    expect(run.asked).toHaveLength(3)
    expect(run.asked[1]).toBe(`'yes' isn't one of: "Accept", "Decline".\n${run.asked[0] ?? ''}`)
  })

  test('a dismissal or three unlisted answers cancel with their reason; no earlier Accept is kept (A1)', async () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], HUNK_DISMISSED_REASON],
      [['Accept'], HUNK_DISMISSED_REASON],
      [['yes', 'ok', 'sure'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(configWorld('{}'), answers)
      expect(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS)))).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(HUNK_DISMISSED_REASON).toBe('A hunk question was dismissed or not answered.')
  })

  test('init asks the hunks of GSD roles after the carried settings, right before the git policy', async () => {
    const run = memIo({ ...secretWorld(), facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } }, PARTS_DECLINED)
    const reply = await runInit(run.io, { dryRun: true })
    const asked = firstLines(run.asked)
    const policyAt = asked.indexOf(GIT_POLICY_QUESTION)
    const [env, ...hunks] = asked.slice(policyAt - 4, policyAt)
    expect(env?.startsWith('Which env variables do roles carry?')).toBe(true)
    expect(hunks).toEqual([
      '.planning/config.json: mode',
      '.planning/config.json: workflow.text_mode',
      '.planning/config.json: hooks.context_warnings',
    ])
    expect(run.logged).toContain(attendedNote(['mode', 'workflow.text_mode']))
    const text = [...run.asked, ...run.logged, ...paneText(run), reply].join('\n')
    expect(leaks(text, [...SECRET_FIXTURES, ...ABSOLUTE_PATH_MARKERS])).toEqual([])
    const proven = memIo({ ...secretWorld(), facts: PROVEN_FACTS }, PARTS_DECLINED)
    const provenReply = await runInit(proven.io, { dryRun: true })
    expect(proven.asked.filter(question => question.startsWith('.planning/config.json: '))).toHaveLength(3)
    const provenText = [...proven.asked, ...proven.logged, ...paneText(proven), provenReply].join('\n')
    expect(leaks(provenText, [...SECRET_FIXTURES, ...ABSOLUTE_PATH_MARKERS])).toEqual([])
  })

  test('init with no role on GSD asks no hunk, and a dismissed hunk cancels init with its reason', async () => {
    const plain = memIo(gitWorld(), INIT_ANSWERS)
    await runInit(plain.io, { dryRun: true })
    expect(plain.asked.some(question => question.startsWith('.planning/config.json:'))).toBe(false)
    expect(plain.logged.some(text => text.startsWith('attended:'))).toBe(false)
    const world = gitWorld({ facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } })
    const dismissed = memIo(world, answersWithout('.planning/config.json:'))
    expect(await runInit(dismissed.io, { dryRun: true })).toBe(cancelledReply(HUNK_DISMISSED_REASON))
    expect(dismissed.logged.at(-1)).toBe(HUNK_DISMISSED_REASON)
  })
})

/** The world of the launcher folder tests: apps/web is a folder, a file, a linked folder and nothing else. */
const FOLDER_WORLD = memWorld({
  dirs: { '/repo/apps/web': [], '/repo/apps/linked': [] },
  files: { '/repo/apps/readme.md': 'x' },
  realPaths: { '/repo/apps/linked': '/elsewhere/linked' },
})

/** The port of a run whose stat of `path` answers `stat`; the stat of any other path is the run's own. */
function withStat(run: MemRun, path: string, stat: PortStat): InitIo {
  return { ...run.io, stat: async asked => (asked === path ? stat : run.io.stat(asked)) }
}

/** The line on top of the folder question when it is asked again after a folder it cannot use (D-136). */
function cannotUse(answer: string, problem: string): string {
  return `Cannot use ${answer}: ${problem}.`
}

/** The problem with a folder path isSafeRelativePath refuses. */
const UNSAFE_FOLDER = 'use a folder inside this repo: letters, digits, . _ @ - and /, with no .. and no leading /'

/** The problem with a folder whose real path is not a folder inside the repo. */
const NOT_A_FOLDER = 'it is not a folder in this repo'

/** What launchStartStep gives for the folder apps/web of the repo. */
const APPS_WEB = { kind: 'accepted', value: { kind: 'dir', path: 'apps/web' } }

/** The team the launcher start is asked for: PM, Team Lead and Security, whose ids its context line names (D-136). */
const LAUNCH_TEAM = proposeRoles(repoScan()).roles

/** The launcher start question as asked for LAUNCH_TEAM: whose launchers start there, under it (D-136). */
const LAUNCH_ASKED = withContext(LAUNCH_START_QUESTION, launchContextLine(LAUNCH_TEAM))

/** The launcher folder question as asked: that the folder must stay inside the repo, under it (D-136). */
const DIR_ASKED = withContext(LAUNCH_DIR_QUESTION, LAUNCH_DIR_CONTEXT)

describe('launchStartStep', () => {
  test('the launcher start question is asked once for the repo with three options in a fixed order', () => {
    expect(LAUNCH_START_QUESTION).toBe(
      'Where should the role launchers start their sessions? (asked once for this repo)',
    )
    expect(LAUNCH_START_OPTIONS).toEqual([
      'Git root of this repo',
      'The folder I run it from',
      'Another folder in this repo',
    ])
    expect(Object.isFrozen(LAUNCH_START_OPTIONS)).toBe(true)
    expect(LAUNCH_DIR_QUESTION).toBe(
      'Type the folder the launchers start in, relative to the repo root (for example apps/web).',
    )
    expect(LAUNCH_DIR_OPTIONS).toEqual(['Cancel init'])
    expect(Object.isFrozen(LAUNCH_DIR_OPTIONS)).toBe(true)
  })

  test('the git root and the folder it is run from are chosen by label or word, trimmed and in any case', async () => {
    const cases: readonly (readonly [string, LaunchStart])[] = [
      ['Git root of this repo', { kind: 'git-root' }],
      [' git root ', { kind: 'git-root' }],
      ['The folder I run it from', { kind: 'here' }],
      ['IN HERE', { kind: 'here' }],
    ]
    for (const [answer, start] of cases) {
      const run = memIo(memWorld({}), [answer])
      expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual({ kind: 'accepted', value: start })
      expect(run.asked).toEqual([LAUNCH_ASKED])
      expect(run.specs[0]).toEqual({ options: LAUNCH_START_OPTIONS, header: 'Launch' })
    }
  })

  test('another folder asks for it, and a plain folder of the repo is chosen, one trailing slash dropped', async () => {
    for (const first of ['Another folder in this repo', 'other']) {
      for (const folder of ['apps/web', 'apps/web/', ' apps/web ']) {
        const run = memIo(FOLDER_WORLD, [first, folder])
        expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual(APPS_WEB)
        expect(run.asked).toEqual([LAUNCH_ASKED, DIR_ASKED])
        expect(run.specs[1]).toEqual({ options: ['Cancel init'], header: 'Launch dir' })
        expect(run.logged).toEqual([])
      }
    }
  })

  test('an unsafe or missing folder, a file or a link out of the repo is asked again with why on top', async () => {
    const bad = ['../x', '/etc', 'a b', '${HOME}', 'missing', 'apps/readme.md', 'apps/linked']
    for (const answer of bad) {
      const run = memIo(FOLDER_WORLD, ['other', answer, 'apps/web'])
      expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual(APPS_WEB)
      const problem = ['missing', 'apps/readme.md', 'apps/linked'].includes(answer) ? NOT_A_FOLDER : UNSAFE_FOLDER
      expect(run.logged).toEqual([])
      expect(run.asked).toEqual([
        LAUNCH_ASKED,
        DIR_ASKED,
        `${cannotUse(answer, problem)}\n${DIR_ASKED}`,
      ])
    }
  })

  test('a folder reached through a linked parent that leaves the repo is refused, and asked again', async () => {
    const run = memIo(FOLDER_WORLD, ['other', 'vendor/ui', 'apps/web'])
    const outside: PortStat = { kind: 'dir', size: 0, isLink: false, realPath: '/elsewhere/vendor/ui' }
    expect(await launchStartStep(withStat(run, '/repo/vendor/ui', outside), '/repo', LAUNCH_TEAM)).toEqual(APPS_WEB)
    expect(run.logged).toEqual([])
    expect(run.asked).toEqual([
      LAUNCH_ASKED,
      DIR_ASKED,
      `${cannotUse('vendor/ui', NOT_A_FOLDER)}\n${DIR_ASKED}`,
    ])
  })

  test('a folder whose stat has no real path is refused, and asked again', async () => {
    const run = memIo(FOLDER_WORLD, ['other', 'apps/unresolved', 'apps/web'])
    const unresolved: PortStat = { kind: 'dir', size: 0, isLink: false }
    const io = withStat(run, '/repo/apps/unresolved', unresolved)
    expect(await launchStartStep(io, '/repo', LAUNCH_TEAM)).toEqual(APPS_WEB)
    expect(run.logged).toEqual([])
    expect(run.asked).toEqual([
      LAUNCH_ASKED,
      DIR_ASKED,
      `${cannotUse('apps/unresolved', NOT_A_FOLDER)}\n${DIR_ASKED}`,
    ])
  })

  test('a folder whose real path lies inside the repo is still chosen', async () => {
    const run = memIo(FOLDER_WORLD, ['other', 'packages/api'])
    const inside: PortStat = { kind: 'dir', size: 0, isLink: false, realPath: '/repo/packages/api' }
    const chosen = { kind: 'accepted', value: { kind: 'dir', path: 'packages/api' } }
    expect(await launchStartStep(withStat(run, '/repo/packages/api', inside), '/repo', LAUNCH_TEAM)).toEqual(chosen)
    expect(run.asked).toEqual([LAUNCH_ASKED, DIR_ASKED])
    expect(run.logged).toEqual([])
  })

  test('a refused folder is shown cleaned and capped in the line that says why', async () => {
    const answer = `a${BIDI_OVERRIDE} ${'x'.repeat(200)}`
    const run = memIo(FOLDER_WORLD, ['other', answer, 'apps/web'])
    await launchStartStep(run.io, '/repo', LAUNCH_TEAM)
    expect(run.asked[2]).toBe(`${cannotUse(`a ${'x'.repeat(107)}…`, UNSAFE_FOLDER)}\n${DIR_ASKED}`)
    expect(run.logged).toEqual([])
  })

  test(`${MAX_ASKS} unusable folders cancel with the rounds reason, and nothing was chosen`, async () => {
    const run = memIo(FOLDER_WORLD, ['other', '../a', 'missing', '/b', 'apps/web'])
    const rounds = { kind: 'cancelled', reason: LAUNCH_DIR_ROUNDS_REASON }
    expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual(rounds)
    expect(run.asked.slice(1)).toEqual([
      DIR_ASKED,
      `${cannotUse('../a', UNSAFE_FOLDER)}\n${DIR_ASKED}`,
      `${cannotUse('missing', NOT_A_FOLDER)}\n${DIR_ASKED}`,
    ])
    expect(run.logged).toEqual([])
    expect(LAUNCH_DIR_ROUNDS_REASON).toBe('No usable launcher folder after 3 tries: nothing was chosen.')
  })

  test('Cancel init or a dismissal at the folder question cancels with its reason', async () => {
    for (const answers of [['other', 'Cancel init'], ['other', ' cancel INIT '], ['other']]) {
      const run = memIo(FOLDER_WORLD, answers)
      const cancelled = { kind: 'cancelled', reason: LAUNCH_DIR_CANCELLED_REASON }
      expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual(cancelled)
    }
    expect(LAUNCH_DIR_CANCELLED_REASON).toBe('The launcher folder question was dismissed or cancelled.')
  })

  test('a dismissed or never answered start question cancels with its reason', async () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], LAUNCH_START_DISMISSED_REASON],
      [['somewhere', 'else', 'again'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual({ kind: 'cancelled', reason })
    }
    expect(LAUNCH_START_DISMISSED_REASON).toBe('The launcher start question was dismissed or not answered.')
  })

  test('launchLine says where the launchers start', () => {
    expect(launchLine({ kind: 'git-root' })).toBe('Launchers start in: the git root')
    expect(launchLine({ kind: 'here' })).toBe('Launchers start in: the folder they are run from')
    expect(launchLine({ kind: 'dir', path: 'apps/web' })).toBe('Launchers start in: apps/web/ under the git root')
  })

  test('init asks where launchers start once, right after the git policy, and names it after the policy', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const reply = await runInit(run.io, { dryRun: true })
    const asked = firstLines(run.asked)
    expect(asked[asked.indexOf(GIT_POLICY_QUESTION) + 1]).toBe(LAUNCH_START_QUESTION)
    expect(asked.filter(question => question === LAUNCH_START_QUESTION)).toHaveLength(1)
    const lines = reply.split('\n')
    expect(lines.slice(lines.indexOf(policyLine('definitions')))).toEqual([
      policyLine('definitions'),
      'Launchers start in: the git root',
      ...DEFAULT_CONFIRM_LINES,
      DRY_RUN_NOTE,
    ])
  })

  test('a folder chosen in init is named in the reply, before the worktree line of the ignore policy', async () => {
    const answers = {
      ...INIT_ANSWERS,
      'Git policy': 'Ignore all of .cadre/',
      'Where should the role launchers start': 'Another folder in this repo',
      'Type the folder the launchers start in': 'apps/web/',
    }
    const run = memIo(gitWorld({ dirs: { '/repo/.git': [], '/repo/apps/web': [] } }), answers)
    const reply = await runInit(run.io, { dryRun: false, host: memHost(hostWorld({})).io })
    const lines = reply.split('\n')
    const at = lines.indexOf(policyLine('ignore'))
    expect(lines.slice(at, at + 3)).toEqual([
      policyLine('ignore'),
      'Launchers start in: apps/web/ under the git root',
      IGNORE_ALL_NOTE,
    ])
  })

  test('a cancelled launcher start prints why and cancels init', async () => {
    const answers = Object.fromEntries(
      Object.entries(INIT_ANSWERS).filter(([key]) => key !== 'Where should the role launchers start'),
    )
    const run = memIo(gitWorld(), answers)
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(LAUNCH_START_DISMISSED_REASON))
    expect(firstLines(run.asked).at(-1)).toBe(LAUNCH_START_QUESTION)
    expect(run.logged.at(-1)).toBe(LAUNCH_START_DISMISSED_REASON)
  })
})

/** One init step a dismissal cancels: the world and answers that dismiss it, its question and its reason. */
type CancelCase = {
  readonly world: MemWorld
  readonly answers: Readonly<Record<string, string>>
  readonly question: string
  readonly reason: string
}

/** The case of a step whose INIT_ANSWERS entry `prefix` is dropped, so its question is dismissed. */
function dismissedAt(world: MemWorld, prefix: string, question: string, reason: string): CancelCase {
  return { world, answers: answersWithout(prefix), question, reason }
}

describe('runInit cancel reasons (A1)', () => {
  test('a dismissal at each of the twelve steps cancels init and prints its reason once, last of all', async () => {
    const gsd = gitWorld({ facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } })
    const sentryNone = { 'Which roles get the sentry': 'None', 'Which roles get codex': 'None' }
    const memory: CancelCase = {
      world: secretWorld(),
      answers: { ...answersWithout('Which roles get'), ...sentryNone, [CONTENT_QUESTION]: 'No, skip it' },
      question: 'Which roles get your global ~/.claude/CLAUDE.md',
      reason: MEMORY_DISMISSED_REASON,
    }
    const cases: readonly CancelCase[] = [
      dismissedAt(gitWorld(), 'Read ~/.claude.json', CLAUDE_JSON_QUESTION, CONSENT_DISMISSED_REASON),
      dismissedAt(gitWorld(), 'Use these roles?', ROLES_QUESTION, ROLES_DISMISSED_REASON),
      dismissedAt(gsd, 'Which framework do the roles use', FRAMEWORK_QUESTION_PREFIX, FRAMEWORK_DISMISSED_REASON),
      dismissedAt(gitWorld(), 'Autopilot duration', DURATION_QUESTION, DURATION_DISMISSED_REASON),
      dismissedAt(gitWorld(), 'Model and effort for', 'Model and effort for all roles?', MODEL_DISMISSED_REASON),
      dismissedAt(secretWorld(), 'Which roles get', 'Which roles get the sentry', ASSIGNMENT_DISMISSED_REASON),
      memory,
      {
        ...dismissedAt(secretWorld(), 'Which env variables', 'Which env variables', ENV_DISMISSED_REASON),
        answers: { ...answersWithout('Which env variables'), [CONTENT_QUESTION]: 'No, skip it' },
      },
      dismissedAt(gsd, '.planning/config.json:', '.planning/config.json: mode', HUNK_DISMISSED_REASON),
      dismissedAt(gitWorld(), 'Git policy', GIT_POLICY_QUESTION, GIT_POLICY_DISMISSED_REASON),
      dismissedAt(
        gitWorld(),
        'Where should the role launchers start',
        LAUNCH_START_QUESTION,
        LAUNCH_START_DISMISSED_REASON,
      ),
      dismissedAt(gitWorld(), 'Review the plan', REVIEW_QUESTION, REVIEW_DISMISSED_REASON),
    ]
    for (const { world, answers, question, reason } of cases) {
      const run = memIo(world, answers)
      expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(reason))
      expect(run.asked.at(-1)?.slice(0, question.length)).toBe(question)
      expect(run.logged.at(-1)).toBe(reason)
      expect(run.logged.filter(text => text === reason)).toHaveLength(1)
    }
  })
})

describe('cancel reply (S1)', () => {
  test('cancelledReply is INIT_CANCELLED, a colon and the reason cleaned as a report cell', () => {
    expect(cancelledReply(NO_USABLE_ANSWER_REASON)).toBe(
      'init cancelled, nothing written: No usable answer after 3 tries.',
    )
    expect(cancelledReply('a\nb')).toBe('init cancelled, nothing written: ab')
  })

  test('three unreadable git policy answers reply with the reason, which is still logged once', async () => {
    const refusal = refusalLine('whatever', 'definitions, all, ignore')
    const run = memIo(gitWorld(), { ...INIT_ANSWERS, 'Git policy': 'whatever', [refusal]: 'whatever' })
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(NO_USABLE_ANSWER_REASON))
    expect(run.logged.filter(text => text === NO_USABLE_ANSWER_REASON)).toHaveLength(1)
  })
})

describe('refusal re-ask (G-02-6b)', () => {
  /** The git policy question as an askChoice ask, with the words its refusal lists. */
  const POLICY: ChoiceAsk<GitPolicy> = {
    question: GIT_POLICY_QUESTION,
    spec: { options: GIT_POLICY_OPTIONS },
    parse: parseGitPolicy,
    accepts: 'definitions, all, ignore',
  }
  /** The refusal of the framework question when GSD and superpowers are offered: the user's own example (D-136). */
  const BOTH_REFUSAL = "'both' isn't one of: GSD, superpowers, none - a role runs one framework."

  test('askChoice gives the answer parse takes as answered, asked once with the question as it is', async () => {
    const run = memIo(memWorld({}), ['Commit all'])
    expect(await askChoice(run.io, POLICY)).toEqual({ kind: 'answered', value: 'all' })
    expect(run.asked).toEqual([GIT_POLICY_QUESTION])
    expect(run.specs).toEqual([POLICY.spec])
  })

  test('askChoice gives dismissed at once for a dismissal, and asks nothing after it', async () => {
    const run = memIo(memWorld({}), [])
    expect(await askChoice(run.io, POLICY)).toEqual({ kind: 'dismissed' })
    expect(run.asked).toEqual([GIT_POLICY_QUESTION])
  })

  test('an answer parse does not take is asked again: the refusal on the first line, then the question', async () => {
    const run = memIo(memWorld({}), ['nonsense', 'Commit all'])
    expect(await askChoice(run.io, POLICY)).toEqual({ kind: 'answered', value: 'all' })
    expect(run.asked).toEqual([
      GIT_POLICY_QUESTION,
      `'nonsense' isn't one of: definitions, all, ignore.\n${GIT_POLICY_QUESTION}`,
    ])
    expect(run.logged).toEqual([])
  })

  test(`${MAX_ASKS} answers parse does not take give exhausted, with no fourth ask (A1)`, async () => {
    const run = memIo(memWorld({}), ['a', 'b', 'c', 'Commit all'])
    expect(await askChoice(run.io, POLICY)).toEqual({ kind: 'exhausted' })
    expect(run.asked).toEqual([
      GIT_POLICY_QUESTION,
      `'a' isn't one of: definitions, all, ignore.\n${GIT_POLICY_QUESTION}`,
      `'b' isn't one of: definitions, all, ignore.\n${GIT_POLICY_QUESTION}`,
    ])
    expect(MAX_ASKS).toBe(3)
  })

  test('an empty answer is refused with its own words, and is never a choice', async () => {
    const run = memIo(memWorld({}), ['   ', 'ignore'])
    expect(await askChoice(run.io, POLICY)).toEqual({ kind: 'answered', value: 'ignore' })
    expect(run.asked[1]).toBe(`An empty answer isn't one of: definitions, all, ignore.\n${GIT_POLICY_QUESTION}`)
    for (const answer of ['', '   ', String.fromCharCode(7)]) {
      expect([answer, refusalLine(answer, 'x')]).toEqual([answer, "An empty answer isn't one of: x."])
    }
  })

  test("refusalLine says why: the user's own example for both at a framework question", () => {
    expect(refusalLine('both', 'GSD, superpowers, none - a role runs one framework')).toBe(BOTH_REFUSAL)
    expect(refusalLine('  both  ', 'x')).toBe("'both' isn't one of: x.")
  })

  test('the typed answer is trimmed, cleaned and cut to 40 code points, so it cannot forge a line (T-02-54)', () => {
    const escape = String.fromCharCode(27)
    const hostile = `a\nwarning: forged${escape}[2J${BIDI_OVERRIDE}b`
    const line = refusalLine(hostile, 'x')
    expect(line).toBe("'awarning: forged[2Jb' isn't one of: x.")
    expect(line.includes('\n') || line.includes(escape) || line.includes(BIDI_OVERRIDE)).toBe(false)
    expect(refusalLine('y'.repeat(60), 'x')).toBe(`'${'y'.repeat(39)}…' isn't one of: x.`)
  })

  test('quotedLabels puts each option label in double quotes, joined with a comma', () => {
    expect(quotedLabels(['Same for all roles', 'Per role'])).toBe('"Same for all roles", "Per role"')
    expect(quotedLabels(CLAUDE_JSON_OPTIONS)).toBe('"No, skip it", "Yes, read names only"')
    expect(quotedLabels([])).toBe('')
  })

  test('running out of tries has its own reason, distinct from every dismissed reason (D-136)', () => {
    expect(NO_USABLE_ANSWER_REASON).toBe('No usable answer after 3 tries.')
    const dismissed = [CONSENT_DISMISSED_REASON, FRAMEWORK_DISMISSED_REASON, REVIEW_DISMISSED_REASON]
    expect(dismissed).not.toContain(NO_USABLE_ANSWER_REASON)
  })

  test('each question lists the answers it takes in its refusal', async () => {
    const roles = proposeRoles(repoScan()).roles
    const choice: Choice = { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }
    const roleList = '"None", "All roles", or role ids from: pm, tl, security'
    const launch =
      '"Git root of this repo", "The folder I run it from", "Another folder in this repo" ' +
      '(or type git root, in here or other)'
    const envNames = { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: ['API_KEY'] }
    const steps: readonly (readonly [string, (io: InitIo) => Promise<unknown>, string])[] = [
      ['consent', io => consentStep(io), '"No, skip it", "Yes, read names only"'],
      [
        'roles',
        io => rolesStep(io, proposeRoles(repoScan()), FRAMEWORKS),
        '"Use these roles", "Adjust them", "Describe my own structure"',
      ],
      ['framework mode', io => frameworkStep(io, choice, roles), '"Same for all roles", "Per role"'],
      ['security', io => securityInstallStep(io, SECURITY_KEYS), '"Install", "Not now"'],
      ['duration', io => durationStep(io, roles), 'a duration such as 4h, 90m or 1h30m, at most 168h'],
      ['model mode', io => modelStep(io, roles), '"Same for all roles", "Per role"'],
      ['mcp', io => assignmentStep(io, roles, emptySetupScan({ mcp: [session('sentry')] })), roleList],
      ['skills', io => assignmentStep(io, roles, emptySetupScan({ skills: [skillRef('x:y', 'x')] })), roleList],
      [
        'own skills',
        io => assignmentStep(io, roles, emptySetupScan({ skills: [skillRef('mine')] })),
        '"Accept recommendations", "Go one by one", "Whole group"',
      ],
      ['memory', io => memoryStep(io, roles, emptySetupScan({ hasGlobalClaudeMd: true })), roleList],
      [
        'env',
        io => carryStep(io, roles, emptySetupScan({ carry: envNames })),
        '"None", "All of them", or names from the list, typed exactly',
      ],
      ['launch', io => launchStartStep(io, '/repo', roles), launch],
      ['git policy', io => gitPolicyStep(io), 'definitions, all, ignore'],
    ]
    for (const [name, step, accepts] of steps) {
      const run = memIo(memWorld({}), ['zzz'])
      await step(run.io)
      expect([name, run.asked[1]?.split('\n')[0]]).toEqual([name, `'zzz' isn't one of: ${accepts}.`])
    }
  })

  test("a dry run that types 'both' three times at the framework question cancels with no usable answer", async () => {
    const answers = { ...INIT_ANSWERS, 'Framework for': 'both', [BOTH_REFUSAL]: 'both' }
    const run = memIo(gitWorld({ facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } }), answers)
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(NO_USABLE_ANSWER_REASON))
    const all = withContext(FRAMEWORK_ALL_QUESTION, 'Roles: pm, tl, security.')
    const at = run.asked.indexOf(all)
    expect(at).toBeGreaterThan(0)
    expect(run.asked.slice(at)).toEqual([all, `${BOTH_REFUSAL}\n${all}`, `${BOTH_REFUSAL}\n${all}`])
    expect(run.logged.at(-1)).toBe(NO_USABLE_ANSWER_REASON)
    expect(run.logged.filter(text => text === NO_USABLE_ANSWER_REASON)).toHaveLength(1)
  })

  test('Esc at the framework question still cancels init with its own dismissed reason (D-45)', async () => {
    const world = gitWorld({ facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } })
    const run = memIo(world, answersWithout('Framework for'))
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(FRAMEWORK_DISMISSED_REASON))
    expect(firstLines(run.asked).at(-1)).toBe(FRAMEWORK_ALL_QUESTION)
    expect(run.logged.at(-1)).toBe(FRAMEWORK_DISMISSED_REASON)
  })

  test('the model loop puts its refusal on top of the next ask; three refused answers cancel (A4)', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'sonet + high', 'opus', 'high high'])
    const roles = [templateRole('pm')]
    expect(await modelStep(run.io, roles)).toEqual({ kind: 'cancelled', reason: NO_USABLE_ANSWER_REASON })
    const all = withContext('Model and effort for all roles?', MODEL_EFFORT_CONTEXT)
    expect(run.asked).toEqual([
      withContext(MODEL_MODE_QUESTION, 'Roles: pm.'),
      all,
      `${modelEffortRefusal('sonet + high')}\n${all}`,
      `${modelEffortRefusal('opus')}\n${all}`,
    ])
    expect(run.logged).toEqual([])
    const dismissed = memIo(memWorld({}), ['Same for all roles', 'sonet + high'])
    expect(await modelStep(dismissed.io, roles)).toEqual({ kind: 'cancelled', reason: MODEL_DISMISSED_REASON })
  })

  test('the launcher folder loop puts its refusal on top of the next ask; the cap keeps its reason', async () => {
    const run = memIo(FOLDER_WORLD, ['other', '../a', 'missing', 'apps/web'])
    expect(await launchStartStep(run.io, '/repo', LAUNCH_TEAM)).toEqual(APPS_WEB)
    expect(run.asked).toEqual([
      LAUNCH_ASKED,
      DIR_ASKED,
      `${cannotUse('../a', UNSAFE_FOLDER)}\n${DIR_ASKED}`,
      `${cannotUse('missing', NOT_A_FOLDER)}\n${DIR_ASKED}`,
    ])
    expect(run.logged).toEqual([])
    const capped = memIo(FOLDER_WORLD, ['other', '../a', 'missing', '/b'])
    const rounds = { kind: 'cancelled', reason: LAUNCH_DIR_ROUNDS_REASON }
    expect(await launchStartStep(capped.io, '/repo', LAUNCH_TEAM)).toEqual(rounds)
  })

  test('the Adjust loop puts the message of a change it cannot apply on top of the next ask', async () => {
    const roles = proposeRoles(FULL_SCAN).roles
    const run = memIo(memWorld({}), ['delete fe', 'drop zz', 'drop fe', 'Show the roles', 'Done adjusting'])
    const kept = roles.filter(role => role.id !== 'fe')
    expect(await adjustLoop(run.io, roles, FRAMEWORKS)).toEqual({ kind: 'adjusted', roles: kept })
    const before = withContext(ADJUST_QUESTION, adjustContextLine(roles))
    const after = withContext(ADJUST_QUESTION, adjustContextLine(kept))
    expect(run.asked).toEqual([
      before,
      `Could not read that change: delete fe. Use add, drop, rename or framework.\n${before}`,
      `no role "zz"\n${before}`,
      after,
      after,
    ])
    expect(run.logged).toEqual([])
  })

  test('a typed line break in an Adjust change cannot add a line to the next ask (T-02-54)', async () => {
    const roles = proposeRoles(FULL_SCAN).roles
    const run = memIo(memWorld({}), ['delete\nfe', 'Done adjusting'])
    await adjustLoop(run.io, roles, FRAMEWORKS)
    expect(run.asked[1]?.split('\n')).toEqual([
      'Could not read that change: deletefe. Use add, drop, rename or framework.',
      ADJUST_QUESTION,
      adjustContextLine(roles),
    ])
  })
})

/**
 * The runs the chip and context-line specs read (G-02-3c, G-02-1), on the testkit world: between them every kind of
 * init question is asked at least once.
 */
type QuestionRuns = {
  /** The default dry run of INIT_ANSWERS. */
  readonly plain: MemRun
  /** Adjust, then Describe, whose model gives no text, so the template comes back. */
  readonly adjusted: MemRun
  /** The framework asked per role, on a world where every per-role step asks. */
  readonly perRole: MemRun
  /** The security plugins asked, and answered Install. */
  readonly security: MemRun
  /** The history question answered Yes. */
  readonly history: MemRun
  /** A launcher folder typed. */
  readonly folder: MemRun
  /** A plain init with a conflicted file, answered Take new. */
  readonly conflict: MemRun
  /** The content consent answered Yes on a world with a global CLAUDE.md, then Accept recommendations (G-02-1f). */
  readonly parts: MemRun
  /** Two of the user's own skills handed out one by one, each answered No; the model gives no text (G-02-1b). */
  readonly ownSkills: MemRun
  /**
   * A plain init whose user lacked claude-md-management: the offer answered Install, then the improver changed BE's
   * built CLAUDE.md, answered Accept (G-02-1f, D-141).
   */
  readonly improver: MemRun
  /** A regen --dry-run in a session whose one changed part is answered Yes (G-02-1f Regen, D-142). */
  readonly regen: MemRun
}

/**
 * Makes the runs of QuestionRuns, each a full init with the INIT_ANSWERS defaults for what it does not change, and one
 * regen.
 */
async function questionRuns(): Promise<QuestionRuns> {
  const plain = memIo(gitWorld(), INIT_ANSWERS)
  await runInit(plain.io, { dryRun: true })
  const adjusted = queuedIo(gitWorld({ replies: [] }), {
    ...INIT_ANSWERS,
    'Use these roles?': ['Adjust them', 'Describe my own structure', 'Use these roles'],
    'Adjust the roles': 'Done adjusting',
    'Describe your role structure': DESCRIPTION,
  })
  await runInit(adjusted.io, { dryRun: true })
  const perRole = memIo(everyStepWorld(), { ...PARTS_DECLINED, 'Which framework do the roles use': 'Per role' })
  await runInit(perRole.io, { dryRun: true })
  const security = memIo(gitWorld(), { ...INIT_ANSWERS, 'Install from claude-plugins-official': 'Install' })
  await runInit(security.io, { dryRun: true })
  const history = memIo(historyGitWorld(), { ...INIT_ANSWERS, [HISTORY_PREFIX]: 'Yes, scan names and counts' })
  await runInit(history.io, { dryRun: true })
  const folder = memIo(gitWorld({ dirs: { '/repo/.git': [], '/repo/apps/web': [] } }), {
    ...INIT_ANSWERS,
    'Where should the role launchers start': 'Another folder in this repo',
    'Type the folder the launchers start in': 'apps/web',
  })
  await runInit(folder.io, { dryRun: true })
  const { world } = await editedRoleWorld()
  const conflict = memIo(world, { ...INIT_ANSWERS, [ROLE_QUESTION]: 'Take new' })
  await runInit(conflict.io, { dryRun: false, host: memHost(hostWorld({})).io })
  const parts = memIo(partsWorld(), PARTS_ANSWERS)
  await runInit(parts.io, { dryRun: true })
  const ownSkills = memIo(ownSkillsWorld([]), {
    ...INIT_ANSWERS,
    [OWN_SKILLS_ENTRY_PREFIX]: 'Go one by one',
    'Which roles get the skill': 'No',
  })
  await runInit(ownSkills.io, { dryRun: true })
  const improverFiles = builtFilesRecord(false)
  const improver = memIo(builtWorld({ files: improverFiles }), improverOffer('Install'))
  await runInit(improver.io, { dryRun: false, host: improvingHost(improverFiles).io })
  const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":true}}'] } }
  const regen = memIo(await regenPartsWorld(changed), { [REGEN_PART_PREFIX]: 'Yes' })
  await runRegen(regen.io, { id: 'be', dryRun: true })

  return { plain, adjusted, perRole, security, history, folder, conflict, parts, ownSkills, improver, regen }
}

/** The dialog spec of the first question a run asked that starts with `start`; a missing one stops the test. */
function specOf(run: MemRun, start: string): AskSpec {
  const at = run.asked.findIndex(question => question.startsWith(start))
  const spec = run.specs[at]
  if (spec === undefined) throw new Error(`no question starts with ${start}`)

  return spec
}

describe('question chips (G-02-3c)', () => {
  test('ASK_HEADERS names the chip of each kind of question, at most 12 characters each, and is frozen', () => {
    expect(ASK_HEADERS).toEqual({
      claudeJson: 'claude.json',
      history: 'History',
      roles: 'Roles',
      adjust: 'Adjust',
      describe: 'Describe',
      framework: 'Framework',
      security: 'Security',
      duration: 'Duration',
      model: 'Model',
      mcp: 'MCP',
      skills: 'Skills',
      memory: 'Memory',
      instructions: 'Instructions',
      env: 'Env',
      launch: 'Launch',
      launchDir: 'Launch dir',
      gitPolicy: 'Git policy',
      review: 'Review',
      conflict: 'Conflict',
      improver: 'Improver',
    })
    expect(Object.isFrozen(ASK_HEADERS)).toBe(true)
    expect(Object.values(ASK_HEADERS).filter(chip => Array.from(chip).length > 12)).toEqual([])
  })

  test('every question of every run has a chip: a non-empty string of at most 12 code points', async () => {
    const runs = Object.values(await questionRuns())
    const isChip = (header: string | undefined): boolean =>
      header !== undefined && header.length > 0 && Array.from(header).length <= 12
    const unchipped = runs.flatMap(run => run.asked.filter((_, at) => !isChip(run.specs[at]?.header)))
    expect(runs.every(run => run.specs.length > 0 && run.specs.length === run.asked.length)).toBe(true)
    expect(unchipped).toEqual([])
  })

  test('every chip of ASK_HEADERS is seen at least once across the runs', async () => {
    const runs = Object.values(await questionRuns())
    const seen = new Set(runs.flatMap(run => run.specs.map(spec => spec.header)))
    expect(Object.values(ASK_HEADERS).filter(chip => !seen.has(chip))).toEqual([])
  })

  test('each question gets the chip of its kind; the hunk questions keep Hunk i of n', async () => {
    const runs = await questionRuns()
    const cases: readonly (readonly [MemRun, string, string])[] = [
      [runs.plain, 'Read ~/.claude.json', 'claude.json'],
      [runs.history, HISTORY_PREFIX, 'History'],
      [runs.plain, 'Use these roles?', 'Roles'],
      [runs.adjusted, 'Adjust the roles', 'Adjust'],
      [runs.adjusted, 'Describe your role structure', 'Describe'],
      [runs.perRole, 'Which framework do the roles use', 'Framework'],
      [runs.perRole, 'Framework for PM (pm)?', 'Framework'],
      [runs.security, 'Install from claude-plugins-official', 'Security'],
      [runs.plain, 'Autopilot duration', 'Duration'],
      [runs.plain, 'Model and effort: same', 'Model'],
      [runs.plain, 'Model and effort for all roles?', 'Model'],
      [runs.perRole, 'Which roles get the sentry MCP server?', 'MCP'],
      [runs.perRole, 'Which roles get codex skills', 'Skills'],
      [runs.perRole, 'Which roles get your global', 'Memory'],
      [runs.perRole, 'Which roles get the auto-memories', 'Memory'],
      [runs.perRole, 'Which roles get the project CLAUDE.md', 'Memory'],
      [runs.perRole, CONTENT_QUESTION, 'Instructions'],
      [runs.parts, CONTENT_QUESTION, 'Instructions'],
      [runs.parts, INSTRUCTIONS_ENTRY_QUESTION, 'Instructions'],
      [runs.ownSkills, OWN_SKILLS_ENTRY_PREFIX, 'Skills'],
      [runs.ownSkills, 'Which roles get the skill deploy-notes?', 'Skill 1/2'],
      [runs.ownSkills, 'Which roles get the skill my-skill?', 'Skill 2/2'],
      [runs.perRole, 'Which env variables', 'Env'],
      [runs.perRole, '.planning/config.json: mode', 'Hunk 1 of 3'],
      [runs.perRole, '.planning/config.json: hooks.context_warnings', 'Hunk 3 of 3'],
      [runs.plain, 'Where should the role launchers start', 'Launch'],
      [runs.folder, 'Type the folder the launchers start in', 'Launch dir'],
      [runs.plain, 'Git policy', 'Git policy'],
      [runs.plain, 'Review the plan', 'Review'],
      [runs.conflict, ROLE_QUESTION, 'Conflict'],
      [runs.improver, IMPROVER_INSTALL_PREFIX, 'Improver'],
      [runs.improver, IMPROVER_PREFIX, 'Improver'],
      [runs.regen, 'Should be get "Git" from CLAUDE.md?', 'Regen 1/1'],
    ]
    for (const [run, start, chip] of cases) expect([start, specOf(run, start).header]).toEqual([start, chip])
  })
})

/** The text of the first question a run asked that starts with `start`; a missing one stops the test. */
function askedOf(run: MemRun, start: string): string {
  const found = run.asked.find(question => question.startsWith(start))
  if (found === undefined) throw new Error(`no question starts with ${start}`)

  return found
}

/** The context line of the git policy question: what each policy keeps in git (D-136). */
const GIT_POLICY_CONTEXT_TEXT =
  'Commit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. ' +
  'Ignore all: nothing in .cadre/ is committed.'

describe('question context lines (G-02-1)', () => {
  /** The roles of the git fixture worlds, which hold no source: PM, Team Lead and Security. */
  const TEAM = 'pm, tl, security'

  test('withContext puts the context, cleaned and cut at 400 code points, on the next line (T-02-55, N2)', () => {
    expect(withContext('Use these roles?', 'Proposed: PM (pm).')).toBe('Use these roles?\nProposed: PM (pm).')
    expect(withContext('Q?', `a\nb${BIDI_OVERRIDE}c`)).toBe('Q?\nabc')
    expect(withContext('Q?', 'x'.repeat(400))).toBe(`Q?\n${'x'.repeat(400)}`)
    expect(withContext('Q?', 'x'.repeat(500))).toBe(`Q?\n${'x'.repeat(399)}…`)
  })

  test('a review question carries a context line of 300 code points whole (N2)', async () => {
    const reviewContext = async (path: string): Promise<string> => {
      const run = memIo(gitWorld({ dirs: { '/repo/.git': [], [`/repo/${path}`]: [] } }), {
        ...INIT_ANSWERS,
        'Where should the role launchers start': 'Another folder in this repo',
        'Type the folder the launchers start in': path,
      })
      await runInit(run.io, { dryRun: true })

      return run.asked.find(question => question.startsWith(`${REVIEW_QUESTION}\n`))?.split('\n')[1] ?? ''
    }
    const path = `apps${'x'.repeat(300 - Array.from(await reviewContext('apps')).length)}`
    const line = await reviewContext(path)
    expect(Array.from(line)).toHaveLength(300)
    expect(line.endsWith(`Launchers start in: ${path}/ under the git root`)).toBe(true)
  })

  test('scanContextLine names the stack and each kind of finding, or none', () => {
    const repo = repoScan({
      languages: ['JavaScript', 'TypeScript'],
      findings: [
        { kind: 'be', label: 'express', evidence: 'package.json' },
        { kind: 'e2e', label: 'Playwright config', evidence: 'playwright.config.ts' },
        { kind: 'fe', label: 'next', evidence: 'package.json' },
        { kind: 'fe', label: 'react', evidence: 'package.json' },
        { kind: 'test', label: 'vitest', evidence: 'package.json' },
      ],
      hasSource: true,
    })
    expect(scanContextLine(repo)).toBe(
      'Scan: stack JavaScript, TypeScript; frontend next, react; backend express; tests vitest; E2E Playwright config.',
    )
    expect(scanContextLine(repoScan())).toBe('Scan: stack none; frontend none; backend none; tests none; E2E none.')
  })

  test('rolesContextLine names each role by title and id, then how many changes the scan made', () => {
    const roles = [templateRole('pm'), templateRole('be')]
    const change: RoleChange = { roleId: 'fe', change: 'dropped', reason: 'r', evidence: [] }
    expect(rolesContextLine(roles, [])).toBe('Proposed: PM (pm), BE (be).')
    expect(rolesContextLine(roles, [change])).toBe('Proposed: PM (pm), BE (be); 1 change from the scan.')
    expect(rolesContextLine(roles, [change, change])).toBe('Proposed: PM (pm), BE (be); 2 changes from the scan.')
  })

  test('reviewContextLine is the plan summary, the git policy line and the launcher line', () => {
    const plan: Plan = { ops: [{ kind: 'create', path: '.cadre/bin/be', mode: 'exec', note: null }], warnings: [] }
    expect(reviewContextLine(plan, 'definitions', { kind: 'git-root' })).toBe(
      'Summary: 1 create, 0 change, 0 leave, 0 conflict, 0 hunks; ' +
        'Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root',
    )
    expect(reviewContextLine(plan, 'ignore', { kind: 'dir', path: 'apps/web' })).toBe(
      'Summary: 1 create, 0 change, 0 leave, 0 conflict, 0 hunks; ' +
        'Git policy: ignore all of .cadre/; Launchers start in: apps/web/ under the git root',
    )
  })

  test('every question of every run but the hunks carries a context line on its second line', async () => {
    const runs = Object.values(await questionRuns())
    const isHunk = (question: string): boolean => question.startsWith('.planning/config.json: ')
    const bare = runs.flatMap(run => run.asked.filter(question => !isHunk(question) && question.split('\n').length < 2))
    expect(runs.every(run => run.asked.length > 0)).toBe(true)
    expect(bare).toEqual([])
  })

  test('a hunk question gets no extra line: it already carries the file, the before and after, and why', async () => {
    const { perRole } = await questionRuns()
    const hunks = perRole.asked.filter(question => question.startsWith('.planning/config.json: '))
    expect(hunks.map(question => question.split('\n').at(-1))).toEqual([
      'Required for unattended GSD roles.',
      'Required for unattended GSD roles.',
      'Optional.',
    ])
  })

  test('each kind of question carries the context line of its row, exactly, on its second and last line', async () => {
    const runs = await questionRuns()
    const cases: readonly (readonly [MemRun, string, string])[] = [
      [
        runs.plain,
        CLAUDE_JSON_QUESTION,
        'Without it, init still finds MCP servers in .mcp.json, your plugins and this session.',
      ],
      [runs.history, HISTORY_PREFIX, 'Scan: stack none; frontend none; backend none; tests none; E2E none.'],
      [runs.plain, ROLES_QUESTION, 'Proposed: PM (pm), Team Lead (tl), Security (security); 3 changes from the scan.'],
      [runs.adjusted, ADJUST_QUESTION, `Roles now: ${TEAM}.`],
      [
        runs.adjusted,
        DESCRIBE_QUESTION,
        'For example: a PM, one full-stack developer, and a QA who also covers security.',
      ],
      [runs.perRole, FRAMEWORK_QUESTION_PREFIX, `Roles: ${TEAM}.`],
      [runs.perRole, 'Framework for PM (pm)?', `Roles: ${TEAM}.`],
      [
        runs.security,
        SECURITY_INSTALL_PREFIX,
        'Nothing is installed before you confirm the final review, and a --dry-run installs nothing.',
      ],
      [runs.plain, DURATION_QUESTION, `Applies to every role: ${TEAM}.`],
      [runs.plain, MODEL_MODE_QUESTION, `Roles: ${TEAM}.`],
      [
        runs.plain,
        'Model and effort for all roles?',
        'Models: opus, sonnet, haiku, fable; efforts: low, medium, high, xhigh, max.',
      ],
      [
        runs.perRole,
        'Which roles get the sentry MCP server?',
        `Roles: ${TEAM}. A role not given the server cannot use it.`,
      ],
      [
        runs.perRole,
        'Which roles get codex skills',
        `Roles: ${TEAM}. A role given these skills can run them in its session; a role not given them cannot.`,
      ],
      [runs.perRole, 'Which roles get your global', `Roles: ${TEAM}. Their content is never shown or committed.`],
      [runs.parts, CONTENT_QUESTION, GLOBAL_ONLY_FOUND],
      [
        runs.parts,
        INSTRUCTIONS_ENTRY_QUESTION,
        '2 topics from 1 file and 0 memories; the pane shows each with the roles it is recommended for.',
      ],
      [
        runs.ownSkills,
        OWN_SKILLS_ENTRY_PREFIX,
        '2 skills with no plugin; the pane shows what each does and the roles it is recommended for.',
      ],
      [
        runs.ownSkills,
        'Which roles get the skill deploy-notes?',
        'Write the release notes for a deploy. Recommended: none.',
      ],
      [runs.ownSkills, 'Which roles get the skill my-skill?', 'No description. Recommended: none.'],
      [
        runs.perRole,
        'Which env variables',
        `Roles: ${TEAM}. Every role carries the same names; values are filled in at launch.`,
      ],
      [runs.plain, LAUNCH_START_QUESTION, `The launcher of each role (${TEAM}) starts its session there.`],
      [runs.folder, LAUNCH_DIR_QUESTION, 'It must be a folder inside this repo; a link that leads out is refused.'],
      [runs.plain, GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT_TEXT],
      [
        runs.conflict,
        ROLE_QUESTION,
        'Keep mine leaves your edited file as it is; Take new writes the new version over it.',
      ],
    ]
    for (const [run, start, context] of cases) {
      expect([start, askedOf(run, start).split('\n').slice(1)]).toEqual([start, [context]])
    }
  })

  test('the framework question for all roles carries the team too', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'GSD'])
    await frameworkStep(run.io, { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }, proposeRoles(repoScan()).roles)
    expect(run.asked[1]).toBe(`${FRAMEWORK_ALL_QUESTION}\nRoles: ${TEAM}.`)
  })

  test('the review question carries the plan summary, git policy and launcher start, then its hint', async () => {
    const { plain } = await questionRuns()
    const files = await plannedFiles(gitWorld(), await defaultRoles(gitWorld()))
    const context =
      `Summary: ${files.length + 2} create, 0 change, 0 leave, 0 conflict, 0 hunks; ` +
      'Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root'
    expect(askedOf(plain, REVIEW_QUESTION).split('\n')).toEqual([REVIEW_QUESTION, context, REVIEW_TYPE_HINT])
  })

  test('a refusal still goes on top: the refusal, then the question, then its context (D-136)', async () => {
    const run = memIo(memWorld({}), ['soon', '4h'])
    expect(await durationStep(run.io, [templateRole('pm'), templateRole('qa')])).toEqual({
      kind: 'accepted',
      value: '4h',
    })
    const asked = `${DURATION_QUESTION}\nApplies to every role: pm, qa.`
    const refusal = "'soon' isn't one of: a duration such as 4h, 90m or 1h30m, at most 168h."
    expect(run.asked).toEqual([asked, `${refusal}\n${asked}`])
  })

  test('the Adjust context line names the roles as they are now, after each change', async () => {
    const run = memIo(memWorld({}), ['drop fe', 'drop zz', 'Done adjusting'])
    await adjustLoop(run.io, proposeRoles(FULL_SCAN).roles, FRAMEWORKS)
    expect(run.asked).toEqual([
      `${ADJUST_QUESTION}\nRoles now: pm, tl, be, fe, qa, security.`,
      `${ADJUST_QUESTION}\nRoles now: pm, tl, be, qa, security.`,
      `no role "zz"\n${ADJUST_QUESTION}\nRoles now: pm, tl, be, qa, security.`,
    ])
  })
})

describe('init helpers', () => {
  test('commandRefusal names the given command wherever a detect refusal names detect', () => {
    expect(commandRefusal(HOME_ROOT_REPLY, 'init')).toBe(
      'cadre init needs a repo root other than your home folder. ' +
        'Open the session in a repo and run /cadre init again.',
    )
    expect(commandRefusal(FILE_SYSTEM_ROOT_REPLY, 'regen')).toBe(
      'cadre regen needs a repo root other than the file system root (/). ' +
        'Open the session in a repo and run /cadre regen again.',
    )
    expect(commandRefusal('no command is named here', 'init')).toBe('no command is named here')
  })

  test('the init refusals use the init wording and the detect refusals keep their own, byte for byte', () => {
    expect(INIT_HOME_ROOT_REPLY).toBe(commandRefusal(HOME_ROOT_REPLY, 'init'))
    expect(INIT_FILE_SYSTEM_ROOT_REPLY).toBe(commandRefusal(FILE_SYSTEM_ROOT_REPLY, 'init'))
    expect(INIT_HOME_ROOT_REPLY).not.toContain('detect')
    expect(INIT_FILE_SYSTEM_ROOT_REPLY).not.toContain('detect')
    expect(HOME_ROOT_REPLY).toBe(
      'cadre detect needs a repo root other than your home folder. ' +
        'Open the session in a repo and run /cadre detect again.',
    )
    expect(FILE_SYSTEM_ROOT_REPLY).toBe(
      'cadre detect needs a repo root other than the file system root (/). ' +
        'Open the session in a repo and run /cadre detect again.',
    )
  })

  test('the non-interactive and cancelled replies state what happened and that nothing was written', () => {
    expect(NOT_INTERACTIVE_REPLY).toBe(
      'cadre init needs an interactive session to ask its questions. ' +
        'Run /cadre init in a terminal session, not with claude -p.',
    )
    expect(INIT_CANCELLED).toBe('init cancelled, nothing written')
  })

  test('parseGitPolicy maps the three labels, trimmed and in any case', () => {
    expect(parseGitPolicy('Commit definitions (default)')).toBe('definitions')
    expect(parseGitPolicy('Commit all')).toBe('all')
    expect(parseGitPolicy('Ignore all of .cadre/')).toBe('ignore')
    expect(parseGitPolicy('  commit ALL ')).toBe('all')
    expect(parseGitPolicy('IGNORE ALL OF .CADRE/')).toBe('ignore')
  })

  test('parseGitPolicy also maps the words definitions, all and ignore', () => {
    expect(parseGitPolicy('definitions')).toBe('definitions')
    expect(parseGitPolicy('All')).toBe('all')
    expect(parseGitPolicy(' ignore ')).toBe('ignore')
  })

  test('parseGitPolicy gives null for an empty, unknown or half-matching answer', () => {
    expect(parseGitPolicy('')).toBeNull()
    expect(parseGitPolicy('   ')).toBeNull()
    expect(parseGitPolicy('whatever')).toBeNull()
    expect(parseGitPolicy('commit')).toBeNull()
    expect(parseGitPolicy('commit all of it')).toBeNull()
  })

  test('pin: parseGitPolicy takes a label or a word, trimmed and in any case, and nothing else (B6)', () => {
    const answers = ['Commit all', ' COMMIT ALL ', 'ignore', 'definitions', 'DEFINITIONS', ' All ', '', 'nope', 'al']
    expect(answers.map(answer => parseGitPolicy(answer))).toEqual([
      'all',
      'all',
      'ignore',
      'definitions',
      'definitions',
      'all',
      null,
      null,
      null,
    ])
  })

  test('the git policy options are listed default, all, ignore, frozen, and each parses to its own policy', () => {
    expect(GIT_POLICY_OPTIONS).toEqual(['Commit definitions (default)', 'Commit all', 'Ignore all of .cadre/'])
    expect(Object.isFrozen(GIT_POLICY_OPTIONS)).toBe(true)
    expect(GIT_POLICY_OPTIONS.map(option => parseGitPolicy(option))).toEqual(['definitions', 'all', 'ignore'])
  })

  test('gitPolicyStep accepts a policy; a dismissal or unknown answers are cancelled with its reason', async () => {
    const run = memIo(memWorld({}), ['Commit all'])
    expect(await gitPolicyStep(run.io)).toEqual({ kind: 'accepted', value: 'all' })
    expect(run.asked).toEqual([withContext(GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT)])
    expect(run.specs).toEqual([{ options: GIT_POLICY_OPTIONS, header: 'Git policy' }])
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], GIT_POLICY_DISMISSED_REASON],
      [['whatever', 'whatever', 'whatever'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const dismissed = memIo(memWorld({}), answers)
      expect(await gitPolicyStep(dismissed.io)).toEqual({ kind: 'cancelled', reason })
      expect(dismissed.asked).toHaveLength(Math.max(1, answers.length))
      expect(dismissed.logged).toEqual([])
    }
    expect(GIT_POLICY_DISMISSED_REASON).toBe('The git policy question was dismissed or not answered.')
  })

  test('policyLine states each policy and what stays out of git', () => {
    expect(policyLine('definitions')).toBe('Git policy: commit definitions (.cadre/*/.runtime/ ignored)')
    expect(policyLine('all')).toBe(
      'Git policy: commit all (only per-user rendered files in .cadre/*/.runtime/ ignored)',
    )
    expect(policyLine('ignore')).toBe('Git policy: ignore all of .cadre/')
  })

  test('pluginVersionOf reads a plain x.y.z version from plugin.json', () => {
    expect(pluginVersionOf('{"name":"cadre","version":"0.1.18"}')).toBe('0.1.18')
    expect(pluginVersionOf('{"version":"10.20.30"}')).toBe('10.20.30')
  })

  test('pluginVersionOf gives null for text that is not JSON, not an object, or has no plain version', () => {
    const bad = [
      '',
      'not json',
      '[]',
      'null',
      '"0.1.18"',
      '{}',
      '{"version":18}',
      '{"version":"1.2"}',
      '{"version":"v1.2.3"}',
      '{"version":"1.2.3-beta"}',
      '{"version":"1.2.3\\n"}',
    ]
    for (const text of bad) {
      expect(pluginVersionOf(text)).toBeNull()
    }
  })

  test('askChoice gives dismissed after exactly two asks for an invalid answer followed by a dismissal', async () => {
    const run = memIo(memWorld({}), ['nonsense'])
    const ask = { question: 'Git policy?', spec: { options: GIT_POLICY_OPTIONS }, parse: parseGitPolicy, accepts: 'x' }
    expect(await askChoice(run.io, ask)).toEqual({ kind: 'dismissed' })
    expect(run.asked).toEqual(['Git policy?', "'nonsense' isn't one of: x.\nGit policy?"])
  })

  describe('the init port read decisions', () => {
    const MAX = 10
    const file = (size: number): PortStat => ({ kind: 'file', size, isLink: false, realPath: '/repo/a' })

    test('portProbeOf is absent only when the probe says the path is not there', () => {
      expect(portProbeOf(false, null, MAX)).toEqual({ state: 'absent' })
      expect(portProbeOf(false, file(1), MAX)).toEqual({ state: 'absent' })
    })

    test('portProbeOf is unknown when the probe failed', () => {
      expect(portProbeOf(null, null, MAX)).toEqual({ state: 'unknown' })
    })

    test('portProbeOf is unknown for a null stat and for a stat that is not a file', () => {
      expect(portProbeOf(true, null, MAX)).toEqual({ state: 'unknown' })
      expect(portProbeOf(true, { kind: 'dir', size: 1, isLink: false }, MAX)).toEqual({ state: 'unknown' })
      expect(portProbeOf(true, { kind: 'other', size: 1, isLink: false }, MAX)).toEqual({ state: 'unknown' })
    })

    test('portProbeOf reads a link to a regular file', () => {
      expect(portProbeOf(true, { kind: 'file', size: 1, isLink: true, realPath: '/repo/real' }, MAX)).toBeNull()
    })

    test('portProbeOf is too-large by the stat size and null (go on and read) at the limit', () => {
      expect(portProbeOf(true, file(MAX + 1), MAX)).toEqual({ state: 'too-large', bytes: MAX + 1 })
      expect(portProbeOf(true, file(MAX), MAX)).toBeNull()
    })

    test('portTextOf is unknown for a non-string, too-large by the UTF-8 bytes, else the text', () => {
      expect(portTextOf(null, MAX)).toEqual({ state: 'unknown' })
      expect(portTextOf(42, MAX)).toEqual({ state: 'unknown' })
      expect(portTextOf('€€€€', MAX)).toEqual({ state: 'too-large', bytes: 12 })
      expect(portTextOf('€€€', MAX)).toEqual({ state: 'text', text: '€€€' })
      expect(portTextOf('abcdefghij', MAX)).toEqual({ state: 'text', text: 'abcdefghij' })
    })
  })
})

/** The folders and files of a repo whose scan proposes all six template roles: React and TypeScript with tests. */
const FULL_DIRS = {
  '/repo': [entry('package.json'), entry('src', 'dir')],
  '/repo/src': [entry('a.ts'), entry('a.test.ts')],
}

/** The package.json of FULL_DIRS: React is a dependency, so FE is kept. */
const FULL_FILES = { '/repo/package.json': '{"dependencies":{"react":"18.0.0"}}' }

/** The roles init keeps for `world` with the INIT_ANSWERS defaults: the template proposal of its scan, unchanged. */
async function defaultRoles(world: MemWorld): Promise<readonly RoleSpec[]> {
  return proposeRoles((await scansOf(world)).repo).roles
}

/**
 * The roles as init plans them (G-02-1f Regen, AUTO-PICK #19 Q1): each parts-flow role records the repo parts it was
 * given, none in these worlds, so its role.json holds an empty list; a whole-files role records none.
 */
function initRecorded(roles: readonly RoleSpec[]): RoleSpec[] {
  return roles.map(role => (isPartsFlowRole(role) ? { ...role, instructionParts: [] } : role))
}

/** The files init plans for these roles in `world`: plannedFiles of the roles as init records them (initRecorded). */
async function initFiles(
  world: MemWorld,
  roles: readonly RoleSpec[],
  over: Partial<CadreState> = {},
): Promise<DesiredFile[]> {
  return plannedFiles(world, initRecorded(roles), over)
}

/**
 * The plan buildPlan gives for these files when the disk holds nothing, with the ignore block of `policy` and, for a
 * team with a Security role, the security reports line, as init plans the block (decision #39). The `.gitignore` op
 * shows the block lines (PLAN-03), so a block planned without that line would differ.
 */
async function emptyDiskPlan(
  desired: readonly DesiredFile[],
  policy: GitPolicy,
  hunks: readonly HunkOp[] = [],
  hasSecurityRole = false,
): Promise<Plan> {
  return buildPlan({
    desired,
    disk: new Map(),
    manifest: null,
    manifestState: 'absent',
    carried: [],
    gitignore: { disk: { state: 'absent' }, lines: gitignoreLines(policy, null, hasSecurityRole) },
    hunks,
    cadreVersion: '0.2.0',
  })
}

/** The default team of the git fixture world has a Security role, so its ignore block holds the reports line. */
const GIT_TEAM_HAS_SECURITY = true

/** The manifest text a run that generated these files records: their hashes and modes in path order. */
async function manifestOf(files: readonly DesiredFile[], cadreVersion = '0.2.0'): Promise<string> {
  const entries: ManifestEntry[] = []
  for (const file of files) entries.push({ path: file.path, sha256: await sha256Hex(file.content), mode: file.mode })

  return stableJson({ schema: 1, cadreVersion, files: entries.sort((a, b) => compareText(a.path, b.path)) })
}

/** The kind of the op of each path in the file plan of a reply. */
function opKinds(reply: string): Map<string, string> {
  const kinds = new Map<string, string>()
  for (const line of reply.split('\n')) {
    const [, kind, path] = /^ {2}(create|change|leave|conflict) +(\S+)/.exec(line) ?? []
    if (kind !== undefined && path !== undefined) kinds.set(path, kind)
  }

  return kinds
}

/** A GSD config hunk as hunkStep records it: required, accepted and runnable unless `over` says otherwise. */
function gsdHunk(over: Partial<HunkOp> = {}): HunkOp {
  return {
    kind: 'hunk',
    file: '.planning/config.json',
    key: 'mode',
    before: NOT_SET_TEXT,
    after: '"yolo"',
    isRequired: true,
    isAccepted: true,
    isRunnable: true,
    command: 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
    ...over,
  }
}

/** An apply outcome in which nothing was written, failed or refused; `over` changes the fields it names. */
function outcomeOf(over: Partial<ApplyOutcome> = {}): ApplyOutcome {
  return {
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
    ...over,
  }
}

describe('init plan', () => {
  /** The scans of a session with nothing detected, a framework-free team on the built-in default. */
  const gathered: Gathered = {
    facts: { facts: EMPTY_FACTS, gsdUserDir: null },
    repo: repoScan({ codeDirs: ['src'] }),
    setup: emptySetupScan({ mcp: [session('jira')] }),
  }
  /** PM on the repo default, Team Lead on superpowers by its own framework, BE on the repo default. */
  const roles = [templateRole('pm'), withFramework(templateRole('tl'), 'superpowers'), templateRole('be')]

  test('the MCP route is merged for every role, and every card says what merged holds (D-104, D-124)', () => {
    expect(MCP_ROUTE).toBe('merged')
    const scopes = scopesFor(roles, 'gsd', gathered, [], { kind: 'git-root' })
    for (const role of roles) {
      const card = cardOf(scopes, role.id)
      expect(card.mcpRoute).toBe('merged')
      expect(scopeCardLines(card)).toContain(
        '    [none] MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)',
      )
    }
    const team = ROLE_TEMPLATE.map(row => roleFromTemplate(row))
    const all = [...scopesFor(team, 'gsd', gathered, [], { kind: 'git-root' }).values()]
    expect(all).toHaveLength(6)
    expect(all.filter(scope => scope.flags.includes('--strict-mcp-config'))).toEqual([])
  })

  test('scopesFor compiles each role with its framework, the setup, the code dirs and the whole team', () => {
    const scopes = scopesFor(roles, 'gsd', gathered, [], { kind: 'git-root' })
    expect([...scopes.keys()]).toEqual(['pm', 'tl', 'be'])
    for (const role of roles) {
      const context: ScopeContext = {
        framework: resolvedFramework(role, 'gsd'),
        setup: gathered.setup,
        codeDirs: ['src'],
        isAttended: false,
        mcpRoute: MCP_ROUTE,
        launchStart: { kind: 'git-root' },
        roles,
      }
      expect(scopes.get(role.id)).toEqual(compileScope(role, context))
    }
  })

  test("a role is attended when an unmet hunk is on its own framework's config file (ROLE-04, A5)", () => {
    const team = [templateRole('be'), withFramework(templateRole('qa'), 'superpowers')]
    const attended = (hunks: readonly HunkOp[]): boolean[] => {
      const scopes = scopesFor(team, 'gsd', gathered, hunks, { kind: 'git-root' })

      return team.map(role => cardOf(scopes, role.id).isAttended)
    }
    expect(attended([])).toEqual([false, false])
    expect(attended([gsdHunk()])).toEqual([false, false])
    expect(attended([gsdHunk({ isAccepted: false })])).toEqual([true, false])
    expect(attended([gsdHunk({ isRunnable: false })])).toEqual([true, false])
    expect(attended([gsdHunk({ isRequired: false, isAccepted: false })])).toEqual([false, false])
    expect(attended([gsdHunk({ isAccepted: false, file: 'other/config.json' })])).toEqual([false, false])
  })

  test("cardLines gives the lines of every role's card in role order, and none for a role with no scope", () => {
    const scopes = scopesFor(roles, 'gsd', gathered, [], { kind: 'git-root' })
    expect(cardLines(roles, scopes)).toEqual(roles.flatMap(role => scopeCardLines(cardOf(scopes, role.id))))
    expect(cardLines([...roles, templateRole('qa')], scopes)).toEqual(cardLines(roles, scopes))
  })

  test('planStep plans a create for each planned file, the manifest and .gitignore, then hunks (PLAN-01)', async () => {
    const team = await defaultRoles(gitWorld())
    const scans = await scansOf(gitWorld())
    const scopes = scopesFor(team, 'none', scans, [], { kind: 'git-root' })
    const hunks = [gsdHunk(), gsdHunk({ key: 'workflow.text_mode', before: 'true', after: 'false' })]
    const input: Parameters<typeof planStep>[1] = {
      roles: team,
      repoDefault: 'none',
      policy: 'definitions',
      launchStart: { kind: 'git-root' },
      scopes,
      hunks,
      repo: scans.repo,
      locations: DEFAULT_LOCATIONS,
      readUserMcp: false,
    }
    const result = await planStep(memIo(gitWorld(), {}).io, input)
    expect(result.state).toEqual(stateOf(team))
    const desired = desiredFiles({ roles: team, scopes, state: result.state, only: null })
    expect(result.plan).toEqual(await emptyDiskPlan(desired, 'definitions', hunks, GIT_TEAM_HAS_SECURITY))
    const files = result.plan.ops.filter((op): op is FileOp => op.kind !== 'hunk')
    const paths = [...desired.map(file => file.path), '.cadre/manifest.json', '.gitignore'].sort(compareText)
    expect(files.map(op => [op.kind, op.path])).toEqual(paths.map(path => ['create', path]))
    expect(result.plan.ops.slice(files.length)).toEqual(hunks)
  })

  test('planStep reads each planned path, the copy beside it and .gitignore through readRepoFile', async () => {
    const team = await defaultRoles(gitWorld())
    const scans = await scansOf(gitWorld())
    const scopes = scopesFor(team, 'none', scans, [], { kind: 'git-root' })
    const linked = '/repo/.cadre/pm/ROLE.md'
    const world = gitWorld({ files: { [linked]: 'x' }, realPaths: { [linked]: '/elsewhere/ROLE.md' } })
    const run = memIo(world, {})
    const result = await planStep(run.io, {
      roles: team,
      repoDefault: 'none',
      policy: 'all',
      launchStart: { kind: 'here' },
      scopes,
      hunks: [],
      repo: scans.repo,
      locations: DEFAULT_LOCATIONS,
      readUserMcp: false,
    })
    const desired = desiredFiles({ roles: team, scopes, state: result.state, only: null })
    const paths = [...planReadPaths(desired), '.gitignore'].map(path => `/repo/${path}`)
    expect(paths.filter(path => path !== linked && !run.reads.includes(path))).toEqual([])
    expect(run.reads).not.toContain(linked)
    const op = result.plan.ops.find(item => item.kind !== 'hunk' && item.path === '.cadre/pm/ROLE.md')
    expect(op?.kind).toBe('conflict')
    expect(result.state).toEqual(stateOf(team, { gitPolicy: 'all', launchStart: { kind: 'here' } }))
  })

  test("planStep writes cadre's own version into cadre.json and the manifest, and unknown when it cannot", async () => {
    const team = await defaultRoles(gitWorld())
    const scans = await scansOf(gitWorld())
    const scopes = scopesFor(team, 'none', scans, [], { kind: 'git-root' })
    const input: Parameters<typeof planStep>[1] = {
      roles: team,
      repoDefault: 'none',
      policy: 'definitions',
      launchStart: { kind: 'git-root' },
      scopes,
      hunks: [],
      repo: scans.repo,
      locations: DEFAULT_LOCATIONS,
      readUserMcp: false,
    }
    const desired = desiredFiles({ roles: team, scopes, state: stateOf(team, { cadreVersion: 'unknown' }), only: null })
    expect(desired.find(file => file.path === '.cadre/cadre.json')?.content).toContain('"cadreVersion": "unknown"')
    const files = { '/repo/.cadre/manifest.json': await manifestOf(desired, 'unknown') }
    const unknown = await planStep(memIo(gitWorld({ cadreVersion: null, files }), {}).io, input)
    expect(unknown.state.cadreVersion).toBe('unknown')
    const manifestKind = (plan: Plan): string | undefined =>
      plan.ops.find(op => op.kind !== 'hunk' && op.path === '.cadre/manifest.json')?.kind
    expect(manifestKind(unknown.plan)).toBe('leave')
    const known = await planStep(memIo(gitWorld({ files }), {}).io, input)
    expect(known.state.cadreVersion).toBe('0.2.0')
    expect(manifestKind(known.plan)).toBe('change')
  })

  test('planStep records the ~/.claude.json consent answer in the state and the planned cadre.json (A1)', async () => {
    const team = await defaultRoles(gitWorld())
    const scans = await scansOf(gitWorld())
    const scopes = scopesFor(team, 'none', scans, [], { kind: 'git-root' })
    for (const readUserMcp of [true, false]) {
      const result = await planStep(memIo(gitWorld(), {}).io, {
        roles: team,
        repoDefault: 'none',
        policy: 'definitions',
        launchStart: { kind: 'git-root' },
        scopes,
        hunks: [],
        repo: scans.repo,
        locations: DEFAULT_LOCATIONS,
        readUserMcp,
      })
      expect([readUserMcp, result.state.readUserMcp]).toEqual([readUserMcp, readUserMcp])
      const desired = desiredFiles({ roles: team, scopes, state: result.state, only: null })
      const stored = parseCadreState(desired.find(file => file.path === '.cadre/cadre.json')?.content ?? '')
      expect([readUserMcp, stored?.readUserMcp]).toEqual([readUserMcp, readUserMcp])
    }
  })

  test('initReplyText ends a plain reply with the applied lines and a dry run with its note', async () => {
    const plan = await emptyDiskPlan([], 'ignore')
    const outcome = outcomeOf({ written: ['.cadre/bin/be', '.gitignore'], executable: ['.cadre/bin/be'] })
    expect(appliedLines(outcome)).toEqual(['Applied: wrote 2 files (1 executable).', NEXT_STEP_NOTE])
    expect(initReplyText(plan, 'ignore', { kind: 'dir', path: 'apps/web' }, outcome).split('\n')).toEqual([
      'cadre init',
      ...renderPlan(plan),
      policyLine('ignore'),
      'Launchers start in: apps/web/ under the git root',
      IGNORE_ALL_NOTE,
      ...appliedLines(outcome),
    ])
    expect(initReplyText(plan, 'definitions', { kind: 'git-root' }, null).split('\n')).toEqual([
      'cadre init --dry-run',
      ...renderPlan(plan),
      policyLine('definitions'),
      'Launchers start in: the git root',
      DRY_RUN_NOTE,
    ])
  })

  test('init --dry-run replies with the plan of desiredFiles and buildPlan, the policy, start and note', async () => {
    const reply = await runInit(memIo(gitWorld(), INIT_ANSWERS).io, { dryRun: true })
    const files = await plannedFiles(gitWorld(), await defaultRoles(gitWorld()))
    const plan = await emptyDiskPlan(files, 'definitions', [], GIT_TEAM_HAS_SECURITY)
    expect(reply.split('\n')).toEqual([
      'cadre init --dry-run',
      ...renderPlan(plan),
      policyLine('definitions'),
      'Launchers start in: the git root',
      ...DEFAULT_CONFIRM_LINES,
      DRY_RUN_NOTE,
    ])
  })

  test('plain init gives the lines of --dry-run but the first, the private files and the end (PLAN-02)', async () => {
    const dry = (await runInit(memIo(gitWorld(), INIT_ANSWERS).io, { dryRun: true })).split('\n')
    const host = memHost(hostWorld({}))
    const plain = (await runInit(memIo(gitWorld(), INIT_ANSWERS).io, { dryRun: false, host: host.io })).split('\n')
    const appliedAt = plain.findIndex(line => line.startsWith('Applied: '))
    const confirmAt = -1 - DEFAULT_CONFIRM_LINES.length
    expect(appliedAt).toBeGreaterThan(0)
    expect(plain.slice(1, appliedAt)).toEqual(dry.slice(1, confirmAt))
    expect(dry.slice(confirmAt, -1)).toEqual(DEFAULT_CONFIRM_LINES)
    expect([plain[0], plain.at(-1)]).toEqual(['cadre init', NEXT_STEP_NOTE])
    expect([dry[0], dry.at(-1)]).toEqual(['cadre init --dry-run', DRY_RUN_NOTE])
  })

  test(
    "init shows every role's scope card once, inside the review after the launch-start question (ROLE-06, A5)",
    async () => {
      const run = memIo(gitWorld(), INIT_ANSWERS)
      const { io, events } = withEvents(run)
      await runInit(io, { dryRun: true })
      const team = await defaultRoles(gitWorld())
      const cards = cardLines(team, scopesFor(team, 'none', await scansOf(gitWorld()), [], { kind: 'git-root' }))
      const launchAt = events.indexOf(`ask ${LAUNCH_START_QUESTION}`)
      const reviewAt = events.indexOf('show review')
      const lines = shownBlock(run, 'review')
      const pmCards = run.shown.filter(block => block.lines.includes('Scope card: PM (pm)'))
      expect(pmCards.map(block => block.key)).toEqual(['review'])
      expect(reviewAt).toBeGreaterThan(launchAt)
      expect(events.slice(launchAt + 1, reviewAt).filter(event => /^(log|show) /.test(event))).toEqual([])
      expect(lines.join('\n')).toContain(
        ['Roles:', ...team.map(role => `  ${role.title} (${role.id})`), ...cards].join('\n'),
      )
      expect(lines.filter(line => line.startsWith('Scope card: '))).toEqual([
        'Scope card: PM (pm)',
        'Scope card: Team Lead (tl)',
        'Scope card: Security (security)',
      ])
    },
  )

  test(
    'the review cards of a folder start carry its notes, and no card is shown before the review (D-122, A5)',
    async () => {
      const answers = {
        ...INIT_ANSWERS,
        'Where should the role launchers start': 'Another folder in this repo',
        'Type the folder the launchers start in': 'apps/web',
      }
      const run = memIo(gitWorld({ dirs: { '/repo/.git': [], '/repo/apps/web': [] } }), answers)
      const { io, events } = withEvents(run)
      await runInit(io, { dryRun: true })
      const review = shownBlock(run, 'review')
      const reviewAt = run.shown.findIndex(block => block.key === 'review')
      const before = run.shown.slice(0, reviewAt).flatMap(block => block.lines)
      expect(review).toContain('    [none] Additional directory: <git root> (start folder is <git root>/apps/web)')
      expect(reviewAt).toBeGreaterThan(0)
      expect(before.filter(line => line.includes('Scope card: '))).toEqual([])
      expect(events.filter(event => event.includes('Scope card: '))).toEqual([])
      expect(review).toContain('Scope card: PM (pm)')
    },
  )

  test('a re-run over the planned files, manifest and .gitignore plans only leave ops (PLAN-04)', async () => {
    const files = await initFiles(gitWorld(), await defaultRoles(gitWorld()))
    const disk = {
      ...onDisk(files),
      '/repo/.cadre/manifest.json': await manifestOf(files),
      '/repo/.gitignore': mergeIgnoreBlock(null, gitignoreLines('definitions', null, true)) ?? '',
    }
    const world = gitWorld({ dirs: { '/repo/.git': [], '/repo/.cadre': [] }, files: disk })
    const reply = await runInit(memIo(world, INIT_ANSWERS).io, { dryRun: true })
    const kinds = opKinds(reply)
    // Each built CLAUDE.md as the last apply left it gets no op: its manifest entry is kept (02-GAPS-B3 S1).
    const built = files.filter(file => file.path.endsWith('/CLAUDE.md')).length
    const left = files.length + 2 - built
    expect([built, kinds.size]).toEqual([3, left])
    expect([...kinds.values()].filter(kind => kind !== 'leave')).toEqual([])
    expect(reply.split('\n')).toContain(`Summary: 0 create, 0 change, ${left} leave, 0 conflict, 0 hunks`)
  })

  test('init stores the consent answer: over a stored yes, yes leaves cadre.json and no changes it (A1)', async () => {
    const team = await defaultRoles(gitWorld())
    const files = await plannedFiles(gitWorld(), team, { readUserMcp: true })
    const world = gitWorld({
      dirs: { '/repo/.git': [], '/repo/.cadre': [] },
      files: { ...onDisk(files), '/repo/.cadre/manifest.json': await manifestOf(files) },
    })
    const cases: readonly (readonly [string, string])[] = [
      ['Yes, read names only', 'leave'],
      ['No, skip it', 'change'],
    ]
    for (const [answer, kind] of cases) {
      const run = memIo(world, { ...INIT_ANSWERS, 'Read ~/.claude.json': answer })
      const kinds = opKinds(await runInit(run.io, { dryRun: true }))
      expect([answer, kinds.get('.cadre/cadre.json')]).toEqual([answer, kind])
    }
  })

  test('a file edited since the last run is a conflict, with the new version planned beside it (D-67)', async () => {
    const files = await initFiles(gitWorld(), await defaultRoles(gitWorld()))
    const disk = {
      ...onDisk(files),
      '/repo/.cadre/manifest.json': await manifestOf(files),
      '/repo/.cadre/pm/ROLE.md': 'edited by hand\n',
    }
    const world = gitWorld({ dirs: { '/repo/.git': [], '/repo/.cadre': [] }, files: disk })
    const kinds = opKinds(await runInit(memIo(world, INIT_ANSWERS).io, { dryRun: true }))
    expect(kinds.get('.cadre/pm/ROLE.md')).toBe('conflict')
    expect(kinds.get('.cadre/pm/ROLE.md.cadre-new')).toBe('create')
    expect(kinds.get('.cadre/pm/kickoff.txt')).toBe('leave')
    expect(kinds.get('.cadre/manifest.json')).toBe('leave')
  })

  test('every answer reaches the files of every role: duration, model, MCP, memories and carry (B1)', async () => {
    const base = secretWorld()
    const world = secretWorld({ dirs: { ...base.dirs, ...FULL_DIRS }, files: { ...base.files, ...FULL_FILES } })
    const picks: readonly (readonly [TemplateRoleId, string, Effort])[] = [
      ['pm', 'sonnet', 'high'],
      ['tl', 'opus', 'max'],
      ['be', 'sonnet', 'medium'],
      ['fe', 'haiku', 'low'],
      ['qa', 'opus', 'high'],
      ['security', 'fable', 'xhigh'],
    ]
    const modelAnswers = Object.fromEntries(
      picks.map(([id, model, effort]) => [
        `Model and effort for ${templateRole(id).title} (${id})?`,
        `${model} + ${effort}`,
      ]),
    )
    const answers = {
      ...PARTS_DECLINED,
      'Autopilot duration': '90m',
      'Model and effort: same': 'Per role',
      ...modelAnswers,
      'Which roles get the sentry': 'be, qa',
      'Which roles get your global': 'pm, tl',
      'Which roles get the auto-memories': 'be',
      'Which roles get the project CLAUDE.md': 'All roles',
      'Which env variables': 'API_KEY',
    }
    const carry = { autoCompactWindow: true, statusLine: true, env: ['API_KEY'], hooks: ['gsd-secret-read-guard.js'] }
    const instructions: Readonly<Record<string, readonly InstructionGroup[]>> = {
      pm: ['global-claude-md', 'project-claude-md'],
      tl: ['global-claude-md', 'project-claude-md'],
      be: ['auto-memory', 'project-claude-md'],
    }
    const roles = picks.map(([id, model, effort]): RoleSpec => {
      const role = templateRole(id)

      return {
        ...role,
        model,
        effort,
        autopilot: { ...role.autopilot, duration: '90m' },
        mcp: id === 'be' || id === 'qa' ? ['sentry'] : [],
        instructions: instructions[id] ?? ['project-claude-md'],
        carry,
      }
    })
    const files = await plannedFiles(world, roles)
    const run = memIo({ ...world, files: { ...world.files, ...onDisk(files) } }, answers)
    const kinds = opKinds(await runInit(run.io, { dryRun: true }))
    expect(files.map(file => [file.path, kinds.get(file.path)])).toEqual(files.map(file => [file.path, 'leave']))
    const text = (path: string): string => files.find(file => file.path === path)?.content ?? ''
    const index = text('.cadre/INDEX.md').split('\n')
    for (const [id, model, effort] of picks) {
      expect(text(`.cadre/${id}/kickoff.txt`).startsWith('/autopilot 90m 65 "')).toBe(true)
      expect(text(`.cadre/bin/${id}`)).toContain(`--model ${model} --effort ${effort}`)
      const row = index.find(line => line.startsWith(`| ${templateRole(id).title} (${id}) |`))
      expect(row).toContain(`| ${model} + ${effort} |`)
      const stored = parseRoleJson(text(`.cadre/${id}/role.json`))
      expect([stored?.autopilot.duration, stored?.model, stored?.effort]).toEqual(['90m', model, effort])
      expect([stored?.mcp, stored?.instructions, stored?.carry]).toEqual([
        id === 'be' || id === 'qa' ? ['sentry'] : [],
        instructions[id] ?? ['project-claude-md'],
        carry,
      ])
    }
  })

  test('a dismissed git policy cancels init before any card; the port has no way to write (D-45, A5)', async () => {
    const run = memIo(gitWorld(), answersWithout('Git policy'))
    const { io, events } = withEvents(run)
    expect(await runInit(io, { dryRun: true })).toBe(cancelledReply(GIT_POLICY_DISMISSED_REASON))
    expect(events.filter(event => event.includes('Scope card: '))).toEqual([])
    expect(run.logged.at(-1)).toBe(GIT_POLICY_DISMISSED_REASON)
    // statForWrite only stats a path before a write (#44); no member of the port can write.
    expect(
      Object.keys(run.io).filter(key => key !== 'statForWrite' && /write|append|remove|delete|mkdir|rename/i.test(key)),
    ).toEqual([])
  })
})

/** A git repo at /repo whose scan proposes all six template roles; `over` changes the fields it names. */
function fullWorld(over: Partial<MemWorld> = {}): MemWorld {
  return gitWorld({ dirs: { '/repo/.git': [], ...FULL_DIRS }, files: { ...FULL_FILES }, ...over })
}

/** `world` with these files on disk under /repo, beside the files it has. */
function withDisk(world: MemWorld, files: readonly DesiredFile[]): MemWorld {
  return { ...world, files: { ...world.files, ...onDisk(files) } }
}

/** The longest of the keys the question starts with; undefined when none does. */
function longestKey(keys: readonly string[], question: string): string | undefined {
  return keys.filter(key => question.startsWith(key)).sort((a, b) => b.length - a.length)[0]
}

/**
 * A port over `world` that answers by question prefix, the longest prefix winning, as INIT_ANSWERS does. A list
 * answers its questions in turn and its last answer repeats; a null in it dismisses that ask, and so does a question no
 * prefix matches.
 */
function queuedIo(world: MemWorld, answers: Readonly<Record<string, string | readonly (string | null)[]>>): MemRun {
  const run = memIo(world, {})
  const used = new Map<string, number>()
  const nextAnswer = (question: string): string | null => {
    const key = longestKey(Object.keys(answers), question)
    if (key === undefined) return null
    const value = answers[key]
    if (value === undefined) return null
    if (typeof value === 'string') return value
    const turn = used.get(key) ?? 0
    used.set(key, turn + 1)

    return value[Math.min(turn, value.length - 1)] ?? null
  }
  const io: InitIo = {
    ...run.io,
    ask: async (question, spec) => {
      run.asked.push(question)
      run.specs.push(spec)
      const answer = nextAnswer(question)
      if (answer === null) throw new Error('dismissed')

      return answer
    },
  }

  return { ...run, io }
}

/**
 * The first lines of the questions asked after the first ask of `question` and before its second (firstLines): every
 * question is matched by its first line, since it carries its context line on its second line (D-136).
 */
function between(asked: readonly string[], question: string): string[] {
  const lines = firstLines(asked)
  const first = lines.indexOf(question)
  const second = lines.indexOf(question, first + 1)
  if (first === -1 || second === -1) throw new Error(`${question} was not asked twice`)

  return lines.slice(first + 1, second)
}

/** A world where every per-role step asks: two frameworks in use, the secret world's names, GSD hunks to answer. */
function everyStepWorld(): MemWorld {
  return { ...secretWorld(), facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } }
}

describe('reviewStep', () => {
  test('the review question, its four buttons and the round cap are fixed (D-43, A2)', () => {
    expect(REVIEW_QUESTION).toBe(
      'Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.',
    )
    expect(REVIEW_OPTIONS).toEqual(['Confirm', 'Change roles', 'Change git policy', 'Change launcher start'])
    expect(Object.isFrozen(REVIEW_OPTIONS)).toBe(true)
    expect(MAX_REVIEW_ROUNDS).toBe(10)
    expect(REVIEW_DISMISSED_REASON).toBe('The review question was dismissed or not answered.')
    expect(REVIEW_ROUNDS_REASON).toBe('The review question was asked 10 times without "Confirm": nothing was chosen.')
  })

  test('parseReviewItem reads a button or a typed item, trimmed and in any case; anything else is null', () => {
    const cases: readonly (readonly [string, ReviewItem | null])[] = [
      ['Confirm', 'confirm'],
      [' confirm ', 'confirm'],
      ['Change roles', 'roles'],
      ['roles', 'roles'],
      ['Change git policy', 'policy'],
      ['GIT POLICY', 'policy'],
      ['Change launcher start', 'launch'],
      ['launcher start', 'launch'],
      ['duration', 'duration'],
      ['Model', 'model'],
      ['assignments', 'assignments'],
      ['mcp', 'assignments'],
      ['skills', 'assignments'],
      ['memory', 'memory'],
      ['env', 'env'],
      [' hunks', 'hunks'],
      ['', null],
      ['yes', null],
      ['policy', null],
      ['change the model', null],
    ]
    for (const [answer, item] of cases) expect([answer, parseReviewItem(answer)]).toEqual([answer, item])
  })

  test('before the question init shows one review block: roles, cards, plan, policy, start, warnings', async () => {
    const locations = { ...DEFAULT_LOCATIONS, warnings: ['the root was given through a link'] }
    const world = fullWorld({ locations })
    const run = memIo(world, INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const gathered = await gatherScans(memIo(world, {}).io, locations, false)
    const team = proposeRoles(gathered.repo).roles
    const scopes = scopesFor(team, 'none', gathered, [], { kind: 'git-root' })
    const { plan } = await planStep(memIo(world, {}).io, {
      roles: team,
      repoDefault: 'none',
      policy: 'definitions',
      launchStart: { kind: 'git-root' },
      scopes,
      hunks: [],
      repo: gathered.repo,
      locations,
      readUserMcp: false,
      repoParts: new Map(),
    })
    const expected = [
      'Roles:',
      ...team.map(role => `  ${role.title} (${role.id})`),
      ...cardLines(team, scopes),
      PRIVATE_FILES_HEADING,
      ...team.map(role => privateFilesRow(role.id)),
      ...renderPlan(plan),
      policyLine('definitions'),
      launchLine({ kind: 'git-root' }),
      ...scanWarningLines(scanWarnings(locations, gathered)),
    ]
    expect(team).toHaveLength(6)
    expect(expected).toContain('warning: the root was given through a link')
    const reviews = run.shown.filter(block => block.key === 'review')
    expect(reviews).toEqual([{ key: 'review', title: 'Review', lines: expected }])
    expect(events[events.indexOf(`ask ${REVIEW_QUESTION}`) - 1]).toBe('show review')
    const reviewAt = firstLines(run.asked).indexOf(REVIEW_QUESTION)
    expect(run.specs[reviewAt]).toEqual({ options: REVIEW_OPTIONS, header: 'Review' })
  })

  test('git policy re-asks only the policy and shows the summary again; Ignore all then Confirm', async () => {
    const run = queuedIo(gitWorld(), {
      ...INIT_ANSWERS,
      'Review the plan': ['git policy', 'Confirm'],
      'Git policy': ['Commit definitions (default)', 'Ignore all of .cadre/'],
    })
    const reply = await runInit(run.io, { dryRun: true })
    expect(between(run.asked, REVIEW_QUESTION)).toEqual([GIT_POLICY_QUESTION])
    expect(firstLines(run.asked).filter(question => question === GIT_POLICY_QUESTION)).toHaveLength(2)
    expect(run.shown.filter(block => block.key === 'review')).toHaveLength(2)
    const team = await defaultRoles(gitWorld())
    const files = await plannedFiles(gitWorld(), team, { gitPolicy: 'ignore' })
    const plan = await emptyDiskPlan(files, 'ignore', [], GIT_TEAM_HAS_SECURITY)
    expect(reply.split('\n')).toEqual([
      'cadre init --dry-run',
      ...renderPlan(plan),
      policyLine('ignore'),
      'Launchers start in: the git root',
      IGNORE_ALL_NOTE,
      ...DEFAULT_CONFIRM_LINES,
      DRY_RUN_NOTE,
    ])
  })

  test('model re-asks only the model questions, and the plan takes the new answer', async () => {
    const team = await defaultRoles(gitWorld())
    const files = await initFiles(
      gitWorld(),
      team.map((role): RoleSpec => ({ ...role, model: 'sonnet', effort: 'high' })),
    )
    const run = queuedIo(withDisk(gitWorld(), files), {
      ...INIT_ANSWERS,
      'Review the plan': ['model', 'Confirm'],
      'Model and effort for': ['opus + medium', 'sonnet + high'],
    })
    const kinds = opKinds(await runInit(run.io, { dryRun: true }))
    expect(between(run.asked, REVIEW_QUESTION)).toEqual([MODEL_MODE_QUESTION, 'Model and effort for all roles?'])
    expect(files.map(file => kinds.get(file.path))).toEqual(files.map(() => 'leave'))
  })

  test('duration re-asks only the duration, and every role takes it', async () => {
    const team = await defaultRoles(gitWorld())
    const files = await initFiles(
      gitWorld(),
      team.map((role): RoleSpec => ({ ...role, autopilot: { ...role.autopilot, duration: '90m' } })),
    )
    const run = queuedIo(withDisk(gitWorld(), files), {
      ...INIT_ANSWERS,
      'Review the plan': ['duration', 'Confirm'],
      'Autopilot duration': ['4h', '90m'],
    })
    const kinds = opKinds(await runInit(run.io, { dryRun: true }))
    expect(between(run.asked, REVIEW_QUESTION)).toEqual([DURATION_QUESTION])
    expect(files.map(file => kinds.get(file.path))).toEqual(files.map(() => 'leave'))
  })

  test('each typed item re-asks only its own questions, in the order init first asked them', async () => {
    const first = memIo(everyStepWorld(), PARTS_DECLINED)
    await runInit(first.io, { dryRun: true })
    const firstAsked = firstLines(first.asked)
    const firstPass = firstAsked.slice(firstAsked.indexOf(ROLES_QUESTION), firstAsked.indexOf(GIT_POLICY_QUESTION))
    const assignments = ['Which roles get the sentry', 'Which roles get codex']
    const cases: readonly (readonly [string, readonly string[]])[] = [
      ['duration', [DURATION_QUESTION]],
      ['model', ['Model and effort']],
      ['assignments', assignments],
      ['mcp', assignments],
      ['skills', assignments],
      ['memory', ['Which roles get your global', 'Which roles get the auto-memories', 'Which roles get the project']],
      ['env', ['Which env variables']],
      ['hunks', ['.planning/config.json: ']],
    ]
    for (const [word, prefixes] of cases) {
      const run = queuedIo(everyStepWorld(), { ...PARTS_DECLINED, 'Review the plan': [word, 'Confirm'] })
      const reply = await runInit(run.io, { dryRun: true })
      expect(reply.startsWith(INIT_CANCELLED)).toBe(false)
      const expected = firstPass.filter(question => prefixes.some(prefix => question.startsWith(prefix)))
      expect(expected).not.toHaveLength(0)
      expect([word, between(run.asked, REVIEW_QUESTION)]).toEqual([word, expected])
    }
  })

  test('Change roles re-asks the roles and every per-role step, and shows the recommendations again', async () => {
    const run = queuedIo(everyStepWorld(), { ...PARTS_DECLINED, 'Review the plan': ['Change roles', 'Confirm'] })
    await runInit(run.io, { dryRun: true })
    const asked = firstLines(run.asked)
    const firstPass = asked.slice(asked.indexOf(ROLES_QUESTION), asked.indexOf(GIT_POLICY_QUESTION))
    expect(firstPass).toContain(DURATION_QUESTION)
    expect(firstPass.some(question => question.startsWith(FRAMEWORK_QUESTION_PREFIX))).toBe(true)
    expect(firstPass.some(question => question.startsWith('.planning/config.json: '))).toBe(true)
    expect(between(run.asked, REVIEW_QUESTION)).toEqual(firstPass.filter(question => question !== DURATION_QUESTION))
    expect(run.shown.filter(block => block.key === 'recommendations')).toHaveLength(2)
    expect(asked.filter(question => question === GIT_POLICY_QUESTION)).toHaveLength(1)
    expect(asked.filter(question => question === LAUNCH_START_QUESTION)).toHaveLength(1)
  })

  test('Change roles starts from the current team, so an earlier Adjust stays', async () => {
    const run = queuedIo(gitWorld(), {
      ...INIT_ANSWERS,
      'Use these roles?': ['Adjust them', 'Use these roles'],
      'Adjust the roles': ['drop security', 'Done adjusting'],
      'Review the plan': ['Change roles', 'Confirm'],
    })
    const kinds = opKinds(await runInit(run.io, { dryRun: true }))
    const proposals = run.shown.filter(block => block.key === 'roles')
    expect(proposals).toHaveLength(3)
    expect(proposals.at(-1)?.lines.join('\n')).not.toContain('Security (security)')
    expect(firstLines(run.asked).filter(question => question === ADJUST_QUESTION)).toHaveLength(2)
    expect([...kinds.keys()].filter(path => path.startsWith('.cadre/security/'))).toEqual([])
    expect(kinds.get('.cadre/pm/role.json')).toBe('create')
  })

  test('Describe then Use the template instead still gives the template after Change roles', async () => {
    const run = queuedIo(gitWorld(), {
      ...INIT_ANSWERS,
      'Use these roles?': ['Adjust them', 'Use these roles', 'Describe my own structure', 'Use these roles'],
      'Adjust the roles': ['drop security', 'Done adjusting'],
      'Describe your role structure': 'Use the template instead',
      'Review the plan': ['Change roles', 'Confirm'],
    })
    const kinds = opKinds(await runInit(run.io, { dryRun: true }))
    expect(firstLines(run.asked).filter(question => question === DESCRIBE_QUESTION)).toHaveLength(1)
    expect(kinds.get('.cadre/security/role.json')).toBe('create')
  })

  test('Change roles shows a described team with no scan changes, as it was accepted (A6)', async () => {
    const run = queuedIo(gitWorld({ replies: [DESCRIBED_REPLY] }), {
      ...INIT_ANSWERS,
      'Use these roles?': ['Describe my own structure', 'Use these roles'],
      'Describe your role structure': DESCRIPTION,
      'Review the plan': ['Change roles', 'Confirm'],
    })
    const reply = await runInit(run.io, { dryRun: true })
    expect(reply.startsWith(INIT_CANCELLED)).toBe(false)
    const proposals = run.shown.filter(block => block.key === 'roles')
    expect(proposals).toHaveLength(3)
    expect(proposals.at(-1)?.lines.slice(-2)).toEqual(['Changes from the scan:', '  none'])
  })

  test("Change roles shows the template team with the template's scan changes, as first shown (A6)", async () => {
    const answers = { ...INIT_ANSWERS, 'Review the plan': ['Change roles', 'Confirm'] }
    const run = queuedIo(gitWorld({ replies: [DESCRIBED_REPLY] }), answers)
    const reply = await runInit(run.io, { dryRun: true })
    expect(reply.startsWith(INIT_CANCELLED)).toBe(false)
    const proposals = run.shown.filter(block => block.key === 'roles')
    expect(proposals).toHaveLength(2)
    expect(proposals.at(-1)).toEqual(proposals[0])
    expect(proposals[0]?.lines.slice(-1)).not.toEqual(['  none'])
  })

  test('Change launcher start, or typing launcher start, re-asks where launchers start (A2)', async () => {
    for (const word of ['Change launcher start', 'launcher start']) {
      const run = queuedIo(gitWorld(), {
        ...INIT_ANSWERS,
        'Review the plan': [word, 'Confirm'],
        'Where should the role launchers start': ['Git root of this repo', 'The folder I run it from'],
      })
      const lines = (await runInit(run.io, { dryRun: true })).split('\n')
      expect(between(run.asked, REVIEW_QUESTION)).toEqual([LAUNCH_START_QUESTION])
      const startLine = lines[lines.indexOf(policyLine('definitions')) + 1]
      expect(startLine).toBe('Launchers start in: the folder they are run from')
    }
  })

  test(`after ${MAX_REVIEW_ROUNDS} review rounds without Confirm init cancels with the reason (A1)`, async () => {
    const run = queuedIo(gitWorld(), { ...INIT_ANSWERS, 'Review the plan': 'model' })
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(REVIEW_ROUNDS_REASON))
    const asked = firstLines(run.asked)
    expect(asked.filter(question => question === REVIEW_QUESTION)).toHaveLength(MAX_REVIEW_ROUNDS)
    expect(asked.filter(question => question === MODEL_MODE_QUESTION)).toHaveLength(MAX_REVIEW_ROUNDS)
    expect(asked.at(-1)).toBe(REVIEW_QUESTION)
    expect(run.logged.at(-1)).toBe(REVIEW_ROUNDS_REASON)
  })

  test('a go-back picked at the last review round cancels at once and asks none of its questions (A3)', async () => {
    const run = queuedIo(gitWorld(), { ...INIT_ANSWERS, 'Review the plan': 'git policy' })
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(REVIEW_ROUNDS_REASON))
    const asked = firstLines(run.asked)
    expect(asked.filter(question => question === GIT_POLICY_QUESTION)).toHaveLength(MAX_REVIEW_ROUNDS)
    expect(asked.at(-1)).toBe(REVIEW_QUESTION)
    expect(run.logged.at(-1)).toBe(REVIEW_ROUNDS_REASON)
  })

  test('a dismissed review, or three answers it cannot read, cancels init with its reason (A1)', async () => {
    const dismissed = memIo(gitWorld(), answersWithout('Review the plan'))
    expect(await runInit(dismissed.io, { dryRun: true })).toBe(cancelledReply(REVIEW_DISMISSED_REASON))
    expect(dismissed.logged.at(-1)).toBe(REVIEW_DISMISSED_REASON)
    const refusal =
      `'maybe' isn't one of: "Confirm", "Change roles", "Change git policy", "Change launcher start", ` +
      'or duration, model, assignments, memory, env, hunks.'
    const unread = memIo(gitWorld(), { ...INIT_ANSWERS, 'Review the plan': 'maybe', [refusal]: 'maybe' })
    expect(await runInit(unread.io, { dryRun: true })).toBe(cancelledReply(NO_USABLE_ANSWER_REASON))
    const reviewAsked = unread.asked.at(-MAX_ASKS) ?? ''
    expect(reviewAsked.startsWith(`${REVIEW_QUESTION}\n`)).toBe(true)
    const again = `${refusal}\n${reviewAsked}`
    expect(unread.asked.slice(-MAX_ASKS)).toEqual([reviewAsked, again, again])
    expect(unread.logged.at(-1)).toBe(NO_USABLE_ANSWER_REASON)
  })

  test("a go-back step that is dismissed cancels init with that step's reason, printed once (A1)", async () => {
    const run = queuedIo(gitWorld(), {
      ...INIT_ANSWERS,
      'Review the plan': ['model', 'Confirm'],
      'Model and effort: same': ['Same for all roles', null],
    })
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(MODEL_DISMISSED_REASON))
    expect(run.logged.at(-1)).toBe(MODEL_DISMISSED_REASON)
    expect(run.logged.filter(text => text === MODEL_DISMISSED_REASON)).toHaveLength(1)
  })

  test('one answer script gives init and --dry-run one plan but the first line, private files and end', async () => {
    const answers = {
      ...PARTS_DECLINED,
      'Review the plan': ['git policy', 'Confirm'],
      'Git policy': ['Commit all', 'Ignore all of .cadre/'],
    }
    const dry = (await runInit(queuedIo(everyStepWorld(), answers).io, { dryRun: true })).split('\n')
    const host = memHost(hostWorld({}))
    const plain = (await runInit(queuedIo(everyStepWorld(), answers).io, { dryRun: false, host: host.io })).split('\n')
    const appliedAt = plain.findIndex(line => line.startsWith('Applied: '))
    const confirmAt = dry.indexOf(PRIVATE_FILES_HEADING)
    expect([appliedAt > 0, confirmAt > 0]).toEqual([true, true])
    expect(plain.slice(1, appliedAt)).toEqual(dry.slice(1, confirmAt))
    expect(dry.slice(1, confirmAt)).toContain('File plan:')
    expect(dry.slice(1, confirmAt)).toContain(policyLine('ignore'))
  })

  test('a cancelled run keeps nothing: the next run on the same port starts fresh (D-45, D-82)', async () => {
    const run = queuedIo(gitWorld(), { ...INIT_ANSWERS, 'Review the plan': [null, 'Confirm'] })
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(REVIEW_DISMISSED_REASON))
    const askedBefore = run.asked.length
    const again = await runInit(run.io, { dryRun: true })
    expect(run.asked[askedBefore]).toBe(withContext(CLAUDE_JSON_QUESTION, CLAUDE_JSON_CONTEXT))
    expect(again).toBe(await runInit(memIo(gitWorld(), INIT_ANSWERS).io, { dryRun: true }))
  })
})

describe('review shows policy and launcher start (G-02-3)', () => {
  /**
   * The rows a dry run of the default team on a repo with no `.gitignore` plans for it: the row, then each line of the
   * cadre block it writes, markers included, as gitignoreLines gives them for a team with a Security role (D-134).
   */
  const IGNORE_ROWS = [
    '  create    .gitignore',
    ...['# >>> cadre', ...gitignoreLines('definitions', null, true), '# <<< cadre'].map(line => `            ${line}`),
  ]

  /** The lines of the review block after its file plan: the rows below the plan's `Summary:` line. */
  function afterPlan(review: readonly string[]): readonly string[] {
    return review.slice(review.findIndex(line => line.startsWith('Summary: ')) + 1)
  }

  test('a dry run shows the git policy and the launcher start right after the plan, before the question', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const review = shownBlock(run, 'review')
    expect(review).toContain('File plan:')
    expect(afterPlan(review).slice(0, 2)).toEqual([
      'Git policy: commit definitions (.cadre/*/.runtime/ ignored)',
      'Launchers start in: the git root',
    ])
    expect(review).not.toContain(IGNORE_ALL_NOTE)
    const askedAt = events.findIndex(event => event.startsWith('ask Review the plan'))
    expect([askedAt > 0, events[askedAt - 1]]).toEqual([true, 'show review'])
  })

  test('with the ignore policy the review also shows the worktree note, right after the launcher start', async () => {
    const run = memIo(gitWorld(), { ...INIT_ANSWERS, 'Git policy': 'Ignore all of .cadre/' })
    await runInit(run.io, { dryRun: true })
    expect(afterPlan(shownBlock(run, 'review')).slice(0, 3)).toEqual([
      'Git policy: ignore all of .cadre/',
      'Launchers start in: the git root',
      IGNORE_ALL_NOTE,
    ])
  })

  test('the review and the reply show the lines of the .gitignore block under its row (PLAN-03)', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const reply = (await runInit(run.io, { dryRun: true })).split('\n')
    const review = shownBlock(run, 'review')
    const reviewAt = review.indexOf('  create    .gitignore')
    const replyAt = reply.indexOf('  create    .gitignore')
    expect([reviewAt > 0, replyAt > 0]).toEqual([true, true])
    expect(review.slice(reviewAt, reviewAt + IGNORE_ROWS.length)).toEqual(IGNORE_ROWS)
    expect(reply.slice(replyAt, replyAt + IGNORE_ROWS.length)).toEqual(IGNORE_ROWS)
    expect(IGNORE_ROWS.slice(-2)).toEqual(['            CLAUDE-SECURITY-*/', '            # <<< cadre'])
  })
})

describe('consent declines first (G-02-11)', () => {
  test('the ~/.claude.json question lists No, skip it first, so a quick Submit declines; labels unchanged', () => {
    expect(CLAUDE_JSON_OPTIONS[0]).toBe('No, skip it')
    expect([...CLAUDE_JSON_OPTIONS].sort()).toEqual(['No, skip it', 'Yes, read names only'])
  })

  test('option 0 of the ~/.claude.json question declines and option 1 consents (T-02-51)', async () => {
    const [first = '', second = ''] = CLAUDE_JSON_OPTIONS
    expect(await consentStep(memIo(memWorld({}), [first]).io)).toEqual({ kind: 'accepted', value: false })
    expect(await consentStep(memIo(memWorld({}), [second]).io)).toEqual({ kind: 'accepted', value: true })
  })

  test('a dry run answering each consent with its option 0 reads no ~/.claude.json and no transcript', async () => {
    const [claudeJsonFirst = ''] = CLAUDE_JSON_OPTIONS
    const [historyFirst = ''] = HISTORY_OPTIONS
    const files = {
      '/home/u/.claude.json': '{"mcpServers":{"linear":{}}}',
      [`${HISTORY_DIR}/a.jsonl`]: '<command-name>/gsd-plan-phase</command-name>',
    }
    const answers = { ...INIT_ANSWERS, 'Read ~/.claude.json': claudeJsonFirst, [HISTORY_PREFIX]: historyFirst }
    const run = memIo(historyGitWorld({ files }), answers)
    const reply = await runInit(run.io, { dryRun: true })
    expect(reply.startsWith(INIT_CANCELLED)).toBe(false)
    expect(firstLines(run.asked.slice(0, 2))).toEqual([CLAUDE_JSON_QUESTION, historyQuestion(1)])
    expect(run.reads.filter(path => path === '/home/u/.claude.json' || path.endsWith('.jsonl'))).toEqual([])
    expect(run.shown.map(block => block.key)).not.toContain('history')
  })
})

describe('review question hint (G-02-7)', () => {
  test('reviewQuestion(null) is the question, then the typed-item hint on its own last line', () => {
    expect(REVIEW_TYPE_HINT).toBe(
      'Use a button, or type duration, model, assignments, memory, env or hunks under Other.',
    )
    expect(reviewQuestion(null)).toBe(
      'Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.\n' +
        'Use a button, or type duration, model, assignments, memory, env or hunks under Other.',
    )
    expect(reviewQuestion(null)).toBe(`${REVIEW_QUESTION}\n${REVIEW_TYPE_HINT}`)
  })

  test('a context line sits on its own line between the question and the hint, which always ends the text', () => {
    const context = 'Roles: PM, Team Lead, Security; 22 files planned.'
    expect(reviewQuestion(context).split('\n')).toEqual([REVIEW_QUESTION, context, REVIEW_TYPE_HINT])
    for (const given of [null, context]) expect(reviewQuestion(given).endsWith(`\n${REVIEW_TYPE_HINT}`)).toBe(true)
  })

  test('reviewStep asks it with the four buttons, once, right after it shows the review block', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const asked = run.asked.filter(question => question.startsWith('Review the plan'))
    expect(firstLines(asked)).toEqual([REVIEW_QUESTION])
    expect(asked[0]?.endsWith(`\n${REVIEW_TYPE_HINT}`)).toBe(true)
    expect(events[events.indexOf(`ask ${REVIEW_QUESTION}`) - 1]).toBe('show review')
    const reviewAt = firstLines(run.asked).indexOf(REVIEW_QUESTION)
    expect(run.specs[reviewAt]).toEqual({ options: REVIEW_OPTIONS, header: 'Review' })
  })

  test('every item the hint names can be typed, and a typed model still goes back to the model step only', async () => {
    const items = ['duration', 'model', 'assignments', 'memory', 'env', 'hunks']
    expect(items.every(item => REVIEW_TYPE_HINT.includes(item))).toBe(true)
    expect(items.map(parseReviewItem)).toEqual(items)
    const run = queuedIo(gitWorld(), { ...INIT_ANSWERS, 'Review the plan': ['model', 'Confirm'] })
    const reply = await runInit(run.io, { dryRun: true })
    expect(reply.startsWith(INIT_CANCELLED)).toBe(false)
    expect(between(run.asked, REVIEW_QUESTION)).toEqual([MODEL_MODE_QUESTION, 'Model and effort for all roles?'])
  })
})

describe('runRegen', () => {
  /** BE and PM on the repo default, in the order cadre.json lists them. */
  const team = [templateRole('be'), templateRole('pm')]
  /** The repo state file of the fixtures. */
  const STATE = '/repo/.cadre/cadre.json'
  /** BE's role.json in the fixtures. */
  const BE_ROLE = '/repo/.cadre/be/role.json'
  /** PM's role.json in the fixtures. */
  const PM_ROLE = '/repo/.cadre/pm/role.json'
  /** The manifest of the fixtures. */
  const MANIFEST = '/repo/.cadre/manifest.json'
  /** The heads of the paths regen of BE may plan: its folder, its launcher, the index and the manifest (D-68). */
  const BE_PLAN_HEADS = ['.cadre/be/', '.cadre/bin/be', '.cadre/INDEX.md', '.cadre/manifest.json']

  /**
   * `base` with what init leaves on disk for `roles` and the state `over`: every planned file, their manifest (which
   * also lists `extra`, files that are not planned) and the `.cadre/` folder.
   */
  async function regenWorld(
    roles: readonly RoleSpec[] = team,
    over: Partial<CadreState> = {},
    base: MemWorld = gitWorld(),
    extra: readonly DesiredFile[] = [],
  ): Promise<MemWorld> {
    const files = await plannedFiles(base, roles, over)
    const manifest = await manifestOf([...files, ...extra])

    return {
      ...base,
      dirs: { ...base.dirs, '/repo/.cadre': [] },
      files: { ...base.files, ...onDisk(files), '/repo/.cadre/manifest.json': manifest },
    }
  }

  /**
   * A git repo at /repo whose root lists as empty, so its scans give no warning (A4); gitWorld's root cannot be listed,
   * which the repo scan warns about. `over` changes the fields it names.
   */
  function listedWorld(over: Partial<MemWorld> = {}): MemWorld {
    return gitWorld({ dirs: { '/repo/.git': [], '/repo': [] }, ...over })
  }

  /** `world` with these absolute paths holding these texts, beside the files it has. */
  function withFiles(world: MemWorld, files: Readonly<Record<string, string>>): MemWorld {
    return { ...world, files: { ...world.files, ...files } }
  }

  /** `world` without the file at this absolute path. */
  function without(world: MemWorld, path: string): MemWorld {
    return { ...world, files: Object.fromEntries(Object.entries(world.files).filter(([key]) => key !== path)) }
  }

  /** Whether regen of BE may plan this path (BE_PLAN_HEADS). */
  function isBePlanPath(path: string): boolean {
    return BE_PLAN_HEADS.some(head => path.startsWith(head))
  }

  /** BE's role.json, repo-relative: the input of regen of BE, which plans no op for it (A5). */
  const BE_ROLE_PATH = '.cadre/be/role.json'

  /**
   * Whether regen of BE plans an op for this path: a path it may plan other than BE's own role.json (A5) and its built
   * CLAUDE.md, which regen keeps with no op while BE's role.json holds no part records (AUTO-PICK #15).
   */
  function isBeOpPath(path: string): boolean {
    return isBePlanPath(path) && path !== BE_ROLE_PATH && path !== BE_CLAUDE_MD_PATH
  }

  /** The reply of `/cadre regen be` in `world`, a dry run unless told otherwise; a plain run writes to a fresh host. */
  async function regenBe(world: MemWorld, dryRun = true): Promise<string> {
    const options: RegenOptions = dryRun
      ? { id: 'be', dryRun: true }
      : { id: 'be', dryRun: false, host: memHost(hostWorld({})).io }

    return runRegen(memIo(world, {}).io, options)
  }

  /** The text of the planned file at this repo-relative path; empty when none is planned there. */
  function textOf(files: readonly DesiredFile[], path: string): string {
    return files.find(file => file.path === path)?.content ?? ''
  }

  test('each refusal has its fixed text, and the unknown-id refusal names the listed roles or none (D-68)', () => {
    expect(REGEN_NO_STATE).toBe('cadre regen needs .cadre/cadre.json from /cadre init: run /cadre init first.')
    expect(REGEN_BAD_STATE).toBe('.cadre/cadre.json is not valid: fix it, or run /cadre init again.')
    expect(regenNoRole('qa', ['be', 'pm'])).toBe('no role qa in .cadre/cadre.json (roles: be, pm)')
    expect(regenNoRole('qa', [])).toBe('no role qa in .cadre/cadre.json (roles: none)')
    expect(regenBadRole('be')).toBe('.cadre/be/role.json is missing or not valid: fix it, or run /cadre init again.')
    expect(regenNeedsFramework('be')).toBe(
      'role be has no framework and this repo has no default: set "framework" in .cadre/be/role.json to gsd, ' +
        'superpowers or none, then run /cadre regen be again.',
    )
  })

  test('the guard runs first, in the regen wording, before any read or question', async () => {
    const world = await regenWorld()
    const run = memIo({ ...world, locations: { ...DEFAULT_LOCATIONS, root: '/home/u', givenRoot: '/home/u' } }, {})
    const host = memHost(hostWorld({}))
    expect(await runRegen(run.io, { id: 'be', dryRun: false, host: host.io })).toBe(
      commandRefusal(HOME_ROOT_REPLY, 'regen'),
    )
    expect([host.writes, host.calls]).toEqual([[], []])
    expect(run.reads).toEqual([])
    expect(run.asked).toEqual([])
  })

  test('with no .cadre/cadre.json regen asks for /cadre init first, and asks nothing', async () => {
    for (const world of [gitWorld(), without(await regenWorld(), STATE)]) {
      const run = memIo(world, {})
      expect(await runRegen(run.io, { id: 'be', dryRun: true })).toBe(REGEN_NO_STATE)
      expect(run.asked).toEqual([])
    }
  })

  test('a cadre.json that cannot be read, is too large or is not valid state refuses (T-02-36)', async () => {
    const world = await regenWorld()
    const state = stateOf(team)
    // The object rest leaves the consent answer out, as a cadre.json written before A1 would.
    const { readUserMcp, ...withoutConsent } = state
    const worlds: readonly MemWorld[] = [
      withFiles(world, { [STATE]: '{' }),
      withFiles(world, { [STATE]: stableJson({ ...state, schema: 2 }) }),
      withFiles(world, { [STATE]: stableJson({ ...state, roles: ['be', 'be'] }) }),
      withFiles(world, { [STATE]: stableJson({ ...state, launchStart: { kind: 'dir', path: '../x' } }) }),
      withFiles(world, { [STATE]: 'x'.repeat(MAX_READ_BYTES + 1) }),
      { ...world, unknownPaths: [STATE] },
      { ...world, realPaths: { [STATE]: '/elsewhere/cadre.json' } },
      withFiles(world, { [STATE]: stableJson(withoutConsent) }),
      withFiles(world, { [STATE]: stableJson({ ...state, readUserMcp: 'yes' }) }),
    ]
    for (const [index, bad] of worlds.entries()) {
      const run = memIo(bad, {})
      expect([index, await runRegen(run.io, { id: 'be', dryRun: true })]).toEqual([index, REGEN_BAD_STATE])
      expect(run.asked).toEqual([])
    }
  })

  test('a stored launcher folder that is not a folder inside the repo makes cadre.json not valid (A2)', async () => {
    const start: LaunchStart = { kind: 'dir', path: 'apps/web' }
    const world = await regenWorld(team, { launchStart: start })
    const folder = '/repo/apps/web'
    const linked = { ...world, dirs: { ...world.dirs, [folder]: [] }, realPaths: { [folder]: '/elsewhere/web' } }
    for (const bad of [world, withFiles(world, { [folder]: 'a file' }), linked]) {
      expect(await regenBe(bad)).toBe(REGEN_BAD_STATE)
    }
    const kinds = opKinds(await regenBe({ ...world, dirs: { ...world.dirs, [folder]: [] } }))
    expect(kinds.get('.cadre/bin/be')).toBe('leave')
    expect([...kinds.values()].filter(kind => kind !== 'leave')).toEqual([])
  })

  test('regen of a folder start plans the ROLE.md init planned, which names the added git root (D-122)', async () => {
    const world = await regenWorld(team, { launchStart: { kind: 'dir', path: 'apps/web' } })
    const kinds = opKinds(await regenBe({ ...world, dirs: { ...world.dirs, '/repo/apps/web': [] } }))
    expect(world.files['/repo/.cadre/be/ROLE.md']).toContain(
      '    [none] Additional directory: <git root> (start folder is <git root>/apps/web)\n',
    )
    expect(kinds.get('.cadre/be/ROLE.md')).toBe('leave')
  })

  test('an id cadre.json does not list refuses, naming the roles it lists', async () => {
    const run = memIo(await regenWorld(), {})
    const host = memHost(hostWorld({}))
    const reply = await runRegen(run.io, { id: 'qa', dryRun: false, host: host.io })
    expect(reply).toBe('no role qa in .cadre/cadre.json (roles: be, pm)')
    expect([host.writes, host.calls]).toEqual([[], []])
    expect(run.asked).toEqual([])
  })

  test('a missing or invalid role.json, or one naming another id, refuses for the first such role', async () => {
    const world = await regenWorld()
    const pmText = world.files[PM_ROLE] ?? ''
    expect(parseRoleJson(pmText)?.id).toBe('pm')
    const cases: readonly (readonly [MemWorld, string])[] = [
      [without(world, BE_ROLE), regenBadRole('be')],
      [withFiles(world, { [BE_ROLE]: '{"schema":1,"id":"be"}' }), regenBadRole('be')],
      [withFiles(world, { [BE_ROLE]: pmText }), regenBadRole('be')],
      [{ ...world, unknownPaths: [BE_ROLE] }, regenBadRole('be')],
      [withFiles(world, { [PM_ROLE]: 'not json' }), regenBadRole('pm')],
      [withFiles(world, { [BE_ROLE]: 'not json', [PM_ROLE]: 'not json' }), regenBadRole('be')],
    ]
    for (const [index, [bad, text]] of cases.entries()) expect([index, await regenBe(bad)]).toEqual([index, text])
  })

  test('with no repo default, the first role in cadre.json order with no framework refuses, naming it', async () => {
    const cases: readonly (readonly [readonly RoleSpec[], string])[] = [
      [team, regenNeedsFramework('be')],
      [[withFramework(templateRole('be'), 'gsd'), templateRole('pm')], regenNeedsFramework('pm')],
    ]
    for (const [roles, text] of cases) expect(await regenBe(await regenWorld(roles, { framework: null }))).toBe(text)
    const framed = team.map(role => withFramework(role, 'none'))
    const reply = await regenBe(await regenWorld(framed, { framework: null }))
    const kinds = opKinds(reply)
    expect([kinds.get(BE_ROLE_PATH), kinds.get('.cadre/be/ROLE.md')]).toEqual([undefined, 'leave'])
    expect(reply).not.toContain(BE_ROLE_PATH)
    expect([...kinds.values()].filter(kind => kind !== 'leave')).toEqual([])
  })

  test("with no .cadre/manifest.json regen refuses, since it cannot keep the other roles' files (A2)", async () => {
    expect(REGEN_NO_MANIFEST).toBe(
      ".cadre/manifest.json is missing, so regen cannot keep the other roles' files: run /cadre init again.",
    )
    const run = memIo(without(await regenWorld(), MANIFEST), {})
    expect(await runRegen(run.io, { id: 'be', dryRun: true })).toBe(REGEN_NO_MANIFEST)
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
  })

  test('a manifest that cannot be read, is too large or is not valid refuses with its own text (A2)', async () => {
    expect(REGEN_BAD_MANIFEST).toBe(
      ".cadre/manifest.json is not valid, so regen cannot keep the other roles' files: run /cadre init again.",
    )
    const world = await regenWorld()
    const worlds: readonly MemWorld[] = [
      withFiles(world, { [MANIFEST]: '{' }),
      withFiles(world, { [MANIFEST]: stableJson({ schema: 2, cadreVersion: '0.2.0', files: [] }) }),
      withFiles(world, { [MANIFEST]: 'x'.repeat(MAX_READ_BYTES + 1) }),
      { ...world, unknownPaths: [MANIFEST] },
      { ...world, realPaths: { [MANIFEST]: '/elsewhere/manifest.json' } },
    ]
    for (const [index, bad] of worlds.entries()) {
      const run = memIo(bad, {})
      expect([index, await runRegen(run.io, { id: 'be', dryRun: true })]).toEqual([index, REGEN_BAD_MANIFEST])
      expect([index, run.asked, run.logged]).toEqual([index, [], []])
    }
  })

  test('the manifest refusal comes last: every earlier refusal still wins without a manifest (A2)', async () => {
    const world = without(await regenWorld(), MANIFEST)
    expect(await runRegen(memIo(world, {}).io, { id: 'qa', dryRun: true })).toBe(regenNoRole('qa', ['be', 'pm']))
    expect(await regenBe(withFiles(world, { [BE_ROLE]: 'not json' }))).toBe(regenBadRole('be'))
    const unframed = without(await regenWorld(team, { framework: null }), MANIFEST)
    expect(await regenBe(unframed)).toBe(regenNeedsFramework('be'))
    expect(await regenBe(without(world, STATE))).toBe(REGEN_NO_STATE)
  })

  test('a valid setup asks and logs nothing, reads no ~/.claude.json or .gitignore, and plans only BE', async () => {
    const linear = '{"mcpServers":{"linear":{"command":"x"}}}'
    const run = memIo(withFiles(await regenWorld(), { '/home/u/.claude.json': linear }), {})
    const reply = await runRegen(run.io, { id: 'be', dryRun: false, host: memHost(hostWorld({})).io })
    const kinds = opKinds(reply)
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
    expect(run.reads).not.toContain('/home/u/.claude.json')
    expect(run.reads).not.toContain('/repo/.gitignore')
    const planned = (await plannedFiles(gitWorld(), team)).map(file => file.path)
    const expected = [...planned.filter(isBeOpPath), '.cadre/manifest.json'].sort(compareText)
    expect([...kinds.keys()]).toEqual(expected)
    // BE's four files; the built CLAUDE.md init wrote is kept with no op (02-GAPS-B2 S1, AUTO-PICK #15).
    expect(expected.filter(path => path.startsWith('.cadre/be/'))).toHaveLength(4)
    expect(reply).not.toContain(BE_ROLE_PATH)
    expect(reply).not.toContain(BE_CLAUDE_MD_PATH)
    expect([...kinds.values()].filter(kind => kind !== 'leave')).toEqual([])
  })

  test('a stored consent re-reads ~/.claude.json once, so an unchanged BE keeps its user MCP deny (A1)', async () => {
    const base = gitWorld({ files: { '/home/u/.claude.json': '{"mcpServers":{"linear":{"command":"x"}}}' } })
    const world = await regenWorld(team, { readUserMcp: true }, base)
    expect(world.files['/repo/.cadre/be/settings.json']).toContain('mcp__linear')
    const run = memIo(world, {})
    const kinds = opKinds(await runRegen(run.io, { id: 'be', dryRun: true }))
    expect([kinds.get('.cadre/be/settings.json'), kinds.get('.cadre/be/ROLE.md')]).toEqual(['leave', 'leave'])
    expect([...kinds.values()].filter(kind => kind !== 'leave')).toEqual([])
    expect(run.reads.filter(path => path === '/home/u/.claude.json')).toHaveLength(1)
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
  })

  test('every manifest entry outside BE, its launcher and the index is carried, with no op (D-68)', async () => {
    const dropped: DesiredFile = { path: '.cadre/qa/role.json', content: 'an old role\n', mode: 'file' }
    const kinds = opKinds(await regenBe(await regenWorld(team, {}, gitWorld(), [dropped])))
    expect([...kinds.keys()].filter(path => !isBePlanPath(path))).toEqual([])
    expect(kinds.get('.cadre/manifest.json')).toBe('leave')
  })

  test('a deleted ROLE.md or kickoff.txt of the role is planned as a create by regen (A7, #39)', async () => {
    expect(opKinds(await regenBe(await regenWorld())).get('.cadre/be/ROLE.md')).toBe('leave')
    for (const name of ['ROLE.md', 'kickoff.txt']) {
      const kinds = opKinds(await regenBe(without(await regenWorld(), `/repo/.cadre/be/${name}`)))
      expect(kinds.get(`.cadre/be/${name}`)).toBe('create')
    }
  })

  test('the reply is the command, the plan and the ending; --dry-run ends with its note', async () => {
    // The root lists, so the scans give no warning and the reply has no warning line (A4).
    const world = await regenWorld(team, {}, listedWorld())
    const plain = (await regenBe(world, false)).split('\n')
    const dry = (await regenBe(world, true)).split('\n')
    expect([plain[0], ...plain.slice(-2)]).toEqual(['cadre regen be', APPLIED_NONE_NOTE, NEXT_STEP_NOTE])
    expect([dry[0], dry.at(-1)]).toEqual(['cadre regen be --dry-run', DRY_RUN_NOTE])
    expect(plain.slice(1, -2)).toEqual(dry.slice(1, -1))
    // BE's role.json holds no part records, so the CLAUDE.md init built is kept with no op and no note (AUTO-PICK #15).
    const leave = (path: string, mode: FileOp['mode']): FileOp => ({ kind: 'leave', path, mode, note: null })
    const files = (await plannedFiles(listedWorld(), team)).filter(file => isBeOpPath(file.path))
    const ops = [...files.map(file => leave(file.path, file.mode)), leave('.cadre/manifest.json', 'file')]
    expect(dry.slice(1, -1)).toEqual(renderPlan({ ops: ops.sort((a, b) => compareText(a.path, b.path)), warnings: [] }))
  })

  test('the reply shows each scan warning between the file plan and the note, as init prints it (A4)', async () => {
    const world = await regenWorld(team, {}, listedWorld())
    const plain = (await regenBe(world)).split('\n')
    const locations = { ...DEFAULT_LOCATIONS, warnings: ['the root was given through a link'] }
    const run = memIo({ ...world, locations }, {})
    const lines = (await runRegen(run.io, { id: 'be', dryRun: true })).split('\n')
    expect(lines).toEqual([...plain.slice(0, -1), 'warning: the root was given through a link', DRY_RUN_NOTE])
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
  })

  test('a guard only in local settings adds no warning: the reply ends with the note (A4, D-103)', async () => {
    const local = listedWorld({ settings: { user: {}, project: {}, local: GUARD_SETTINGS } })
    const world = await regenWorld(team, {}, local)
    const run = memIo(world, {})
    const dry = (await runRegen(run.io, { id: 'be', dryRun: true })).split('\n')
    const plain = (await regenBe(world, false)).split('\n')
    // The root lists, so the scans give no warning (A4), and a guard only in local settings adds none (D-103).
    expect(dry.filter(line => line.startsWith('warning: '))).toEqual([])
    expect(dry.at(-1)).toBe(DRY_RUN_NOTE)
    expect([plain[0], ...plain.slice(-2)]).toEqual(['cadre regen be', APPLIED_NONE_NOTE, NEXT_STEP_NOTE])
    expect(plain.slice(1, -2)).toEqual(dry.slice(1, -1))
    expect(run.logged).toEqual([])
  })

  test('an edited BE role.json is re-rendered: BE, the index and the manifest change, and PM has no op', async () => {
    const edited: RoleSpec = { ...templateRole('be'), model: 'sonnet', effort: 'high' }
    const before = await plannedFiles(gitWorld(), team)
    const after = await plannedFiles(gitWorld(), [edited, templateRole('pm')])
    const world = withFiles(await regenWorld(), { [BE_ROLE]: textOf(after, BE_ROLE_PATH) })
    const kinds = opKinds(await regenBe(world))
    const isKept = (file: DesiredFile): boolean => textOf(before, file.path) === file.content
    const expected = after
      .filter(file => isBeOpPath(file.path))
      .map(file => [file.path, isKept(file) ? 'leave' : 'change'])
    expect([...kinds.entries()].filter(([path]) => path !== '.cadre/manifest.json')).toEqual(expected)
    expect([kinds.get('.cadre/bin/be'), kinds.get('.cadre/INDEX.md')]).toEqual(['change', 'change'])
    expect(kinds.get('.cadre/manifest.json')).toBe('change')
  })

  test('a role.json edited by hand is the input: no op, no conflict, its disk hash in the manifest (A5)', async () => {
    const files = await plannedFiles(gitWorld(), team)
    const world = await regenWorld()
    const stored: unknown = JSON.parse(world.files[BE_ROLE] ?? '')
    if (!isObject(stored)) throw new Error("BE's role.json is not an object")
    const edited = JSON.stringify({ ...stored, note: 'edited by hand' }, null, 4)
    expect(parseRoleJson(edited)?.id).toBe('be')
    const reply = await regenBe(withFiles(world, { [BE_ROLE]: edited }))
    const kinds = opKinds(reply)
    const paths = [...files.map(file => file.path).filter(isBeOpPath), '.cadre/manifest.json'].sort(compareText)
    expect([...kinds.keys()]).toEqual(paths)
    expect([...kinds.entries()].filter(([, kind]) => kind !== 'leave')).toEqual([['.cadre/manifest.json', 'change']])
    expect(reply).not.toContain(BE_ROLE_PATH)
    const recorded = files.map(file => (file.path === BE_ROLE_PATH ? { ...file, content: edited } : file))
    const kept = opKinds(await regenBe(withFiles(world, { [BE_ROLE]: edited, [MANIFEST]: await manifestOf(recorded) })))
    expect(kept.get('.cadre/manifest.json')).toBe('leave')
    expect([...kept.values()].filter(kind => kind !== 'leave')).toEqual([])
  })

  test('a GSD role is attended while .planning/config.json is not at the required values (D-70, D-72)', async () => {
    const config = '/repo/.planning/config.json'
    const cases: readonly (readonly [string | null, string])[] = [
      ['{"mode":"yolo","workflow":{"text_mode":false}}', 'leave'],
      [null, 'change'],
      ['{"mode":"interactive","workflow":{"text_mode":false}}', 'change'],
    ]
    for (const [text, kind] of cases) {
      const base = text === null ? gitWorld() : withFiles(gitWorld(), { [config]: text })
      const kinds = opKinds(await regenBe(await regenWorld(team, { framework: 'gsd' }, base)))
      expect([text, kinds.get('.cadre/be/ROLE.md')]).toEqual([text, kind])
    }
  })

  test('in claude -p regen gives the same reply as in a terminal session and asks nothing (D-99)', async () => {
    const world = await regenWorld()
    const interactive = await regenBe(world)
    for (const isInteractive of [false, null]) {
      const run = memIo({ ...world, interactive: isInteractive }, {})
      const reply = await runRegen(run.io, { id: 'be', dryRun: true })
      expect(reply).toBe(interactive)
      expect(reply.split('\n')[0]).toBe('cadre regen be --dry-run')
      expect(run.asked).toEqual([])
      expect(reply).not.toContain(NOT_INTERACTIVE_REPLY)
    }
  })

  test('no secret or absolute path of the secret world reaches the regen reply, with consent or not (B5)', async () => {
    const claudeJson = '{"mcpServers":{"linear":{"command":"x","env":{"TOKEN":"sk-FAKE-SECRET-0123456789"}}}}'
    const base = secretWorld({ files: { ...secretWorld().files, '/home/u/.claude.json': claudeJson } })
    for (const readUserMcp of [false, true]) {
      const reply = await regenBe(await regenWorld(team, { readUserMcp }, base))
      expect([readUserMcp, reply.split('\n')[0]]).toEqual([readUserMcp, 'cadre regen be --dry-run'])
      expect([readUserMcp, leaks(reply, [...SECRET_FIXTURES, ...ABSOLUTE_PATH_MARKERS])]).toEqual([readUserMcp, []])
    }
  })
})

/** Whether the --dry-run variant of an options type has a `host` key, optional or not; the type checker decides it. */
type DryRunHasHost<T> = 'host' extends keyof Extract<T, { readonly dryRun: true }> ? true : false

/** The host of a run that also records its writes and runs in one list, in call order. */
function withHostEvents(host: MemHost): { readonly io: HostIo; readonly events: string[] } {
  const events: string[] = []
  const io: HostIo = {
    ...host.io,
    write: async (path, text) => {
      events.push(`write ${path}`)

      return host.io.write(path, text)
    },
    run: async (argv, options) => {
      events.push(`run ${argv.join(' ')}`)

      return host.io.run(argv, options)
    },
  }

  return { io, events }
}

/**
 * The port of a run in which a link is planted at `path` after the fresh plan read the disk, right before the write
 * (D-120): the stat of `path` stays the run's own, so neither the review nor the plan made again after Confirm sees a
 * link; once the person confirmed, statForWrite, which only apply asks right before its writes, answers a regular file
 * that is a link landing on `realPath`, as a link planted between that plan and the write would be (RESEARCH 3.2,
 * T-03-38).
 */
function linkAfterConfirm(run: MemRun, path: string, realPath: string): InitIo {
  let isConfirmed = false

  return {
    ...run.io,
    ask: async (question, spec) => {
      const answer = await run.io.ask(question, spec)
      if (question.startsWith(`${REVIEW_QUESTION}\n`) && parseReviewItem(answer) === 'confirm') isConfirmed = true

      return answer
    },
    statForWrite: async asked => {
      if (!isConfirmed || asked !== path) return run.io.statForWrite(asked)

      return { kind: 'file', size: 0, isLink: true, realPath }
    },
  }
}

/**
 * The port of a run whose write-time stat fails at `path`: statForWrite answers failed there and the run's own answer
 * elsewhere (#44, A5).
 */
function statFailsAt(run: MemRun, path: string): InitIo {
  return { ...run.io, statForWrite: async asked => (asked === path ? 'failed' : run.io.statForWrite(asked)) }
}

/**
 * The port of a run whose folder `folder` lists `name` as a link once the review is answered Confirm (#72 A2): a link
 * planted there after Confirm whose stat the host takes for no file, as a dangling link may be, so statForWrite still
 * answers the run's own absent; before Confirm and for every other folder, the run's own listing.
 */
function listedLinkAfterConfirm(run: MemRun, folder: string, name: string): InitIo {
  let isConfirmed = false

  return {
    ...run.io,
    ask: async (question, spec) => {
      const answer = await run.io.ask(question, spec)
      if (question.startsWith(`${REVIEW_QUESTION}\n`) && parseReviewItem(answer) === 'confirm') isConfirmed = true

      return answer
    },
    list: async asked => {
      const entries = await run.io.list(asked)
      if (!isConfirmed || asked !== folder) return entries

      return [...(entries ?? []), link(name)]
    },
  }
}

/** The refusal listedLinkProblem gives for a write whose folder, or one above it, lists it or its way as a link. */
const LISTED_LINK = 'it or a folder above it is listed as a link'

/** The chmod argv of each launcher of the INIT_ANSWERS team in an empty repo (PM, Security, TL), in plan order. */
const EMPTY_REPO_CHMODS = ['pm', 'security', 'tl'].map(id => ['/bin/chmod', '755', `/repo/.cadre/bin/${id}`])

/** The refusal writeProblem gives for the launcher of BE. */
const BE_REFUSED = 'refused to write .cadre/bin/be: it or a folder above it is a link, or not inside the repo'

/** The line for the launcher of BE when its write was refused or failed, so no chmod ran (RESEARCH 3.2). */
const BE_NOT_EXECUTABLE = 'warning: .cadre/bin/be was not made executable: its write was refused or failed'

describe('init apply (D-105)', () => {
  test('the apply notes are fixed', () => {
    const skipped = '.cadre/manifest.json was not written because a file above was not written: run /cadre init again.'
    expect(APPLIED_NONE_NOTE).toBe('Applied: nothing to write; every file is up to date.')
    expect(NEXT_STEP_NOTE).toBe('Next: run /cadre start <id> to launch a role.')
    expect(MANIFEST_SKIPPED_NOTE).toBe(skipped)
  })

  test('Confirm writes each planned file, then .gitignore, then the manifest last, and asks nothing more', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const host = memHost(hostWorld({}))
    await runInit(run.io, { dryRun: false, host: host.io })
    const desired = await initFiles(gitWorld(), await defaultRoles(gitWorld()))
    const ignore = mergeIgnoreBlock(null, gitignoreLines('definitions', null, true))
    expect(host.writes).toEqual([
      ...desired.map(file => ({ path: `/repo/${file.path}`, text: file.content, isWritten: true })),
      { path: '/repo/.gitignore', text: ignore, isWritten: true },
      { path: '/repo/.cadre/manifest.json', text: await manifestOf(desired), isWritten: true },
    ])
    const asked = firstLines(run.asked)
    expect(asked.at(-1)).toBe(REVIEW_QUESTION)
    expect(asked.filter(question => question === REVIEW_QUESTION)).toHaveLength(1)
  })

  test('each launcher is made executable with /bin/chmod 755 right after its own write (LNCH-01)', async () => {
    const host = memHost(hostWorld({}))
    const { io, events } = withHostEvents(host)
    await runInit(memIo(gitWorld(), INIT_ANSWERS).io, { dryRun: false, host: io })
    const chmods = EMPTY_REPO_CHMODS.map(argv => ({ argv, options: { timeoutMs: 10_000 } }))
    expect(host.calls).toEqual([COMMON_DIR_CALL, ...chmods])
    for (const argv of EMPTY_REPO_CHMODS) {
      const path = argv[2] ?? ''
      expect(events[events.indexOf(`write ${path}`) + 1]).toBe(`run ${argv.join(' ')}`)
    }
  })

  test('the reply is the plan as written, the policy and the start, then the applied lines (D-105)', async () => {
    const host = memHost(hostWorld({}))
    const reply = await runInit(memIo(gitWorld(), INIT_ANSWERS).io, { dryRun: false, host: host.io })
    const files = await plannedFiles(gitWorld(), await defaultRoles(gitWorld()))
    const plan = await emptyDiskPlan(files, 'definitions', [], GIT_TEAM_HAS_SECURITY)
    expect(reply.split('\n')).toEqual([
      'cadre init',
      ...renderPlan(plan),
      policyLine('definitions'),
      'Launchers start in: the git root',
      `Applied: wrote ${host.writes.length} files (3 executable).`,
      DEFAULT_FOLDERS_UNKNOWN,
      NEXT_STEP_NOTE,
    ])
  })

  test('init again over what it wrote writes nothing and runs only git for the memory folders (LNCH-01)', async () => {
    const first = memHost(hostWorld({}))
    await runInit(memIo(gitWorld(), INIT_ANSWERS).io, { dryRun: false, host: first.io })
    const again = memHost(hostWorld({}))
    const world = withWrites(gitWorld(), first.writes)
    const reply = await runInit(memIo(world, INIT_ANSWERS).io, { dryRun: false, host: again.io })
    expect(reply.split('\n').slice(-3)).toEqual([APPLIED_NONE_NOTE, DEFAULT_FOLDERS_UNKNOWN, NEXT_STEP_NOTE])
    expect([again.writes, again.calls]).toEqual([[], [COMMON_DIR_CALL]])
  })

  test('init --dry-run is the Phase 2 reply byte for byte, and no option type gives a dry run a host', async () => {
    const reply = await runInit(memIo(gitWorld(), INIT_ANSWERS).io, { dryRun: true })
    const files = await plannedFiles(gitWorld(), await defaultRoles(gitWorld()))
    const plan = await emptyDiskPlan(files, 'definitions', [], GIT_TEAM_HAS_SECURITY)
    const start = 'Launchers start in: the git root'
    const lines = [
      'cadre init --dry-run',
      ...renderPlan(plan),
      policyLine('definitions'),
      start,
      ...DEFAULT_CONFIRM_LINES,
      DRY_RUN_NOTE,
    ]
    expect(reply).toBe(lines.join('\n'))
    // Each constant compiles only while the --dry-run variant of its options type has no host key (T-03-16).
    const isInitHost: DryRunHasHost<InitOptions> = false
    const isRegenHost: DryRunHasHost<RegenOptions> = false
    expect([isInitHost, isRegenHost]).toEqual([false, false])
  })

  test('a refused or cancelled run holds a host and still writes and runs nothing (D-45, D-105)', async () => {
    const locations = { ...DEFAULT_LOCATIONS, root: '/home/u', givenRoot: '/home/u' }
    const refused = memHost(hostWorld({}))
    const home = memIo(gitWorld({ locations }), INIT_ANSWERS)
    expect(await runInit(home.io, { dryRun: false, host: refused.io })).toBe(INIT_HOME_ROOT_REPLY)
    const cancelled = memHost(hostWorld({}))
    const dismissed = memIo(gitWorld(), answersWithout('Review the plan'))
    const reply = await runInit(dismissed.io, { dryRun: false, host: cancelled.io })
    expect(reply).toBe(cancelledReply(REVIEW_DISMISSED_REASON))
    expect([refused.writes, refused.calls, cancelled.writes, cancelled.calls]).toEqual([[], [], [], []])
  })

  test('a launcher link planted after Confirm is not written or chmodded, and the manifest is skipped', async () => {
    const host = memHost(hostWorld({}))
    const io = linkAfterConfirm(memIo(fullWorld(), INIT_ANSWERS), '/repo/.cadre/bin/be', '/elsewhere/be')
    const reply = await runInit(io, { dryRun: false, host: host.io })
    expect(opKinds(reply).get('.cadre/bin/be')).toBe('create')
    const written = host.writes.map(write => write.path)
    const runs = host.calls.map(call => call.argv)
    expect(written).not.toContain('/repo/.cadre/bin/be')
    expect(runs.filter(argv => argv.includes('/repo/.cadre/bin/be') || argv.includes('/elsewhere/be'))).toEqual([])
    for (const id of ['fe', 'pm', 'qa', 'security', 'tl']) {
      expect(written).toContain(`/repo/.cadre/bin/${id}`)
      expect(runs.map(argv => argv.join(' '))).toContain(`/bin/chmod 755 /repo/.cadre/bin/${id}`)
    }
    expect(written).not.toContain('/repo/.cadre/manifest.json')
    const lines = reply.split('\n')
    expect(lines).toContain(`warning: ${BE_REFUSED}`)
    expect(lines).toContain(BE_NOT_EXECUTABLE)
    expect(lines).toContain(`warning: ${MANIFEST_SKIPPED_NOTE}`)
  })

  test('a .gitignore link the stat takes for no file is not written through: the root lists it (#72 A2)', async () => {
    const host = memHost(hostWorld({}))
    const io = listedLinkAfterConfirm(memIo(fullWorld(), INIT_ANSWERS), '/repo', '.gitignore')
    const reply = await runInit(io, { dryRun: false, host: host.io })
    const written = host.writes.map(write => write.path)
    expect(written).not.toContain('/repo/.gitignore')
    expect(written).not.toContain('/repo/.cadre/manifest.json')
    expect(written).toContain('/repo/.cadre/bin/be')
    const lines = reply.split('\n')
    expect(lines).toContain(`warning: refused to write .gitignore: ${LISTED_LINK}`)
    expect(lines).toContain(`warning: ${MANIFEST_SKIPPED_NOTE}`)
  })

  test('a .cadre link the stat takes for no folder gets no write or chmod under it (#72 A2)', async () => {
    const host = memHost(hostWorld({}))
    const io = listedLinkAfterConfirm(memIo(fullWorld(), INIT_ANSWERS), '/repo', '.cadre')
    const reply = await runInit(io, { dryRun: false, host: host.io })
    expect(host.writes.map(write => write.path).filter(path => path.startsWith('/repo/.cadre/'))).toEqual([])
    expect(host.calls.filter(call => call.argv[0] === '/bin/chmod')).toEqual([])
    const lines = reply.split('\n')
    expect(lines).toContain(`warning: refused to write .cadre/bin/be: ${LISTED_LINK}`)
    expect(lines).toContain(BE_NOT_EXECUTABLE)
    expect(lines).toContain(`warning: ${MANIFEST_SKIPPED_NOTE}`)
  })

  test('a launcher write the host refuses is reported, gets no chmod, and skips the manifest', async () => {
    const host = memHost(hostWorld({ writeFails: ['/repo/.cadre/bin/be'] }))
    const reply = await runInit(memIo(fullWorld(), INIT_ANSWERS).io, { dryRun: false, host: host.io })
    expect(host.calls.filter(call => call.argv.includes('/repo/.cadre/bin/be'))).toEqual([])
    expect(host.writes.map(write => write.path)).not.toContain('/repo/.cadre/manifest.json')
    const lines = reply.split('\n')
    expect(lines).toContain('warning: could not write .cadre/bin/be')
    expect(lines).toContain(BE_NOT_EXECUTABLE)
    expect(lines).toContain(`warning: ${MANIFEST_SKIPPED_NOTE}`)
  })

  test(
    'a write whose stat failed is refused with its reason, gets no chmod, and skips the manifest (D3, #44)',
    async () => {
      const host = memHost(hostWorld({}))
      const io = statFailsAt(memIo(fullWorld(), INIT_ANSWERS), '/repo/.cadre/bin/be')
      const reply = await runInit(io, { dryRun: false, host: host.io })
      const written = host.writes.map(write => write.path)
      expect(written).not.toContain('/repo/.cadre/bin/be')
      expect(written).not.toContain('/repo/.cadre/manifest.json')
      expect(host.calls.filter(call => call.argv.includes('/repo/.cadre/bin/be'))).toEqual([])
      const lines = reply.split('\n')
      expect(lines).toContain(
        'warning: refused to write .cadre/bin/be: it or a folder above it could not be checked (a stat failed)',
      )
      expect(lines).toContain(BE_NOT_EXECUTABLE)
      expect(lines).toContain(`warning: ${MANIFEST_SKIPPED_NOTE}`)
      expect(lines.at(-1)).toBe(NEXT_STEP_NOTE)
    },
  )

  test('a chmod that does not exit 0 is reported with the command to run; the manifest is still written', async () => {
    const runs = [
      { argv: ['/bin/chmod', '755', '/repo/.cadre/bin/pm'], result: { exitCode: 1, stdout: '', stderr: 'denied' } },
      { argv: ['/bin/chmod', '755', '/repo/.cadre/bin/tl'], result: null },
    ]
    const host = memHost(hostWorld({ runs }))
    const reply = await runInit(memIo(gitWorld(), INIT_ANSWERS).io, { dryRun: false, host: host.io })
    const lines = reply.split('\n')
    expect(lines).toContain(`Applied: wrote ${host.writes.length} files (1 executable).`)
    expect(lines).toContain('warning: could not make .cadre/bin/pm executable: run chmod 755 .cadre/bin/pm')
    expect(lines).toContain('warning: could not make .cadre/bin/tl executable: run chmod 755 .cadre/bin/tl')
    expect(lines.join('\n')).not.toContain('denied')
    expect(host.writes.at(-1)?.path).toBe('/repo/.cadre/manifest.json')
  })

  test('appliedLines: the count, one warning line per problem in a fixed order, the next step last', () => {
    const run: HunkRun = { key: 'mode', file: '.planning/config.json', argv: ['node'], display: 'node ~/x mode yolo' }
    const outcome = outcomeOf({
      written: ['.cadre/pm/ROLE.md'],
      failed: ['.cadre/be/ROLE.md'],
      refused: [BE_REFUSED],
      notExecutable: ['.cadre/bin/pm'],
      chmodRefusals: ['.cadre/bin/be was not made executable: its write was refused or failed'],
      hunkFailures: [run],
      attended: ['mode'],
      manifestSkipped: true,
    })
    expect(appliedLines(outcome)).toEqual([
      'Applied: wrote 1 file (0 executable).',
      `warning: ${BE_REFUSED}`,
      'warning: could not write .cadre/be/ROLE.md',
      BE_NOT_EXECUTABLE,
      'warning: could not make .cadre/bin/pm executable: run chmod 755 .cadre/bin/pm',
      `warning: ${hunkFailureLine(run)}`,
      `warning: ${attendedNote(['mode'])}`,
      `warning: ${MANIFEST_SKIPPED_NOTE}`,
      NEXT_STEP_NOTE,
    ])
    expect(appliedLines(outcomeOf())).toEqual([APPLIED_NONE_NOTE, NEXT_STEP_NOTE])
    expect(appliedLines(outcomeOf({ failed: ['.cadre/INDEX.md'] }))[0]).toBe('Applied: wrote 0 files (0 executable).')
  })

  test('appliedLines: the untracked-parts warnings come right after the install problems (02-GAPS-B2 M3)', () => {
    const untracked = untrackedPartsWarning('notes/local.md')
    const problems = { installProblems: ['install it by hand'], untrackedParts: [untracked] }
    const outcome = outcomeOf({ ...problems, manifestSkipped: true })
    expect(appliedLines(outcome)).toEqual([
      APPLIED_NONE_NOTE,
      'warning: install it by hand',
      `warning: ${untracked}`,
      `warning: ${MANIFEST_SKIPPED_NOTE}`,
      NEXT_STEP_NOTE,
    ])
  })

  test('no secret or absolute path of the secret world reaches the plain init reply or a written file', async () => {
    const host = memHost(hostWorld({}))
    // The content consent is declined, so the whole-file flow is checked here; a yes is the T-02-69 run.
    const reply = await runInit(memIo(secretWorld(), PARTS_DECLINED).io, { dryRun: false, host: host.io })
    expect(host.writes.length).toBeGreaterThan(0)
    const shown = [reply, ...host.writes.map(write => write.text)].join('\n')
    expect(leaks(shown, [...SECRET_FIXTURES, ...ABSOLUTE_PATH_MARKERS])).toEqual([])
  })
})

/** BE's ROLE.md as a person edited it outside cadre. */
const EDITED_ROLE = 'edited by hand\n'

/** The Keep mine / Take new question of BE's ROLE.md (D-67). */
const ROLE_QUESTION = conflictQuestion('.cadre/be/ROLE.md')

/** The conflict question of BE's ROLE.md as asked: what each answer does on its second line (D-136). */
const ROLE_ASKED = withContext(ROLE_QUESTION, CONFLICT_CONTEXT)

/** What the repo after an init holds once BE's ROLE.md was edited: the world, the planned files and BE's ROLE.md. */
type EditedRole = {
  readonly world: MemWorld
  readonly files: readonly DesiredFile[]
  readonly role: string
}

/**
 * The repo of fullWorld after an init with the INIT_ANSWERS defaults: a listed `.cadre/` with every planned file, the
 * cadre block in the root `.gitignore` and the manifest, except that BE's ROLE.md was edited outside cadre and the
 * manifest records the hash of an older cadre text for it, so init plans it as the one conflict (D-67).
 */
async function editedRoleWorld(): Promise<EditedRole> {
  const files = await initFiles(fullWorld(), await defaultRoles(fullWorld()))
  const role = files.find(file => file.path === '.cadre/be/ROLE.md')?.content ?? ''
  const older = files.map(file =>
    file.path === '.cadre/be/ROLE.md' ? { ...file, content: 'older cadre text\n' } : file,
  )
  const world = withDisk(fullWorld({ dirs: { '/repo/.git': [], ...FULL_DIRS, '/repo/.cadre': [] } }), files)
  const edited = {
    '/repo/.cadre/be/ROLE.md': EDITED_ROLE,
    '/repo/.cadre/manifest.json': await manifestOf(older),
    '/repo/.gitignore': mergeIgnoreBlock(null, gitignoreLines('definitions', null, true)) ?? '',
  }

  return { world: { ...world, files: { ...world.files, ...edited } }, files, role }
}

/**
 * The port of a run in which `path` is edited after the person confirmed the review: from then on a read of `path`
 * answers `text`, so the plan made again from the disk after Confirm sees the edit, while the review and the questions
 * did not (D-120, the 03-09 edge).
 */
function editedAfterConfirm(run: MemRun, path: string, text: string): InitIo {
  let isConfirmed = false

  return {
    ...run.io,
    ask: async (question, spec) => {
      const answer = await run.io.ask(question, spec)
      if (question.startsWith(`${REVIEW_QUESTION}\n`) && parseReviewItem(answer) === 'confirm') isConfirmed = true

      return answer
    },
    read: async (asked, maxBytes) => {
      if (!isConfirmed || asked !== path) return run.io.read(asked, maxBytes)

      return { state: 'text', text }
    },
  }
}

describe('init apply conflicts (D-67)', () => {
  test('after Confirm a hand-edited ROLE.md gets one Keep mine / Take new question, and no other', async () => {
    const { world } = await editedRoleWorld()
    const run = memIo(world, { ...INIT_ANSWERS, [ROLE_QUESTION]: 'Take new' })
    await runInit(run.io, { dryRun: false, host: memHost(hostWorld({})).io })
    const reviewAt = firstLines(run.asked).indexOf(REVIEW_QUESTION)
    expect(reviewAt).toBeGreaterThan(0)
    expect(run.asked.slice(reviewAt + 1)).toEqual([ROLE_ASKED])
    expect(run.specs[reviewAt + 1]).toEqual({ options: CONFLICT_OPTIONS, header: 'Conflict' })
  })

  test('Take new writes the desired ROLE.md and no copy, and the manifest records its new hash', async () => {
    const { world, files, role } = await editedRoleWorld()
    const host = memHost(hostWorld({}))
    const run = memIo(world, { ...INIT_ANSWERS, [ROLE_QUESTION]: 'Take new' })
    const reply = await runInit(run.io, { dryRun: false, host: host.io })
    const manifest = await manifestOf(files)
    expect(opKinds(reply).get('.cadre/be/ROLE.md')).toBe('conflict')
    expect(host.writes).toEqual([
      { path: '/repo/.cadre/be/ROLE.md', text: role, isWritten: true },
      { path: '/repo/.cadre/manifest.json', text: manifest, isWritten: true },
    ])
    expect(manifest).not.toBe(world.files['/repo/.cadre/manifest.json'])
    expect(host.calls).toEqual([COMMON_DIR_CALL])
    expect(reply.split('\n').slice(-3)).toEqual([
      'Applied: wrote 2 files (0 executable).',
      SIX_FOLDERS_UNKNOWN,
      NEXT_STEP_NOTE,
    ])
  })

  test('Keep mine leaves ROLE.md, writes only its .cadre-new copy and keeps the manifest', async () => {
    const { world, role } = await editedRoleWorld()
    const host = memHost(hostWorld({}))
    const run = memIo(world, { ...INIT_ANSWERS, [ROLE_QUESTION]: 'Keep mine' })
    const reply = await runInit(run.io, { dryRun: false, host: host.io })
    expect(run.asked.at(-1)).toBe(ROLE_ASKED)
    expect(host.writes).toEqual([{ path: '/repo/.cadre/be/ROLE.md.cadre-new', text: role, isWritten: true }])
    expect(host.calls).toEqual([COMMON_DIR_CALL])
    expect(reply.split('\n').slice(-3)).toEqual([
      'Applied: wrote 1 file (0 executable).',
      SIX_FOLDERS_UNKNOWN,
      NEXT_STEP_NOTE,
    ])
  })

  test(
    'a dismissed conflict question, or MAX_ASKS answers that are neither, cancels init and writes and runs nothing',
    async () => {
      const { world } = await editedRoleWorld()
      const dismissed = 'A Keep mine or Take new question was dismissed or not answered.'
      const refusal = `'maybe' isn't one of: "Keep mine", "Take new".`
      const unread = { ...INIT_ANSWERS, [ROLE_QUESTION]: 'maybe', [refusal]: 'maybe' }
      const cases: readonly (readonly [Readonly<Record<string, string>>, number, string])[] = [
        [INIT_ANSWERS, 1, dismissed],
        [unread, MAX_ASKS, NO_USABLE_ANSWER_REASON],
      ]
      for (const [answers, asks, reason] of cases) {
        const host = memHost(hostWorld({}))
        const run = memIo(world, answers)
        expect(await runInit(run.io, { dryRun: false, host: host.io })).toBe(cancelledReply(reason))
        expect(run.asked.filter(question => question.includes(ROLE_QUESTION))).toHaveLength(asks)
        expect(run.logged.at(-1)).toBe(reason)
        expect([host.writes, host.calls]).toEqual([[], []])
      }
      const asked = memIo(world, unread)
      await runInit(asked.io, { dryRun: false, host: memHost(hostWorld({})).io })
      expect(asked.asked.slice(-2)).toEqual([`${refusal}\n${ROLE_ASKED}`, `${refusal}\n${ROLE_ASKED}`])
    },
  )

  test('a repo with no conflicted file gets no question after the review question', async () => {
    const first = memHost(hostWorld({}))
    await runInit(memIo(fullWorld(), INIT_ANSWERS).io, { dryRun: false, host: first.io })
    for (const world of [fullWorld(), withWrites(fullWorld(), first.writes)]) {
      const run = memIo(world, INIT_ANSWERS)
      await runInit(run.io, { dryRun: false, host: memHost(hostWorld({})).io })
      const asked = firstLines(run.asked)
      expect(asked.at(-1)).toBe(REVIEW_QUESTION)
      expect(asked.filter(question => question === REVIEW_QUESTION)).toHaveLength(1)
    }
  })

  test('a file edited after the questions is kept as an unasked conflict, and only its copy is written', async () => {
    const { world, files, role } = await editedRoleWorld()
    const matching = { '/repo/.cadre/be/ROLE.md': role, '/repo/.cadre/manifest.json': await manifestOf(files) }
    const host = memHost(hostWorld({}))
    const run = memIo({ ...world, files: { ...world.files, ...matching } }, INIT_ANSWERS)
    const io = editedAfterConfirm(run, '/repo/.cadre/be/ROLE.md', EDITED_ROLE)
    const reply = await runInit(io, { dryRun: false, host: host.io })
    expect(firstLines(run.asked).at(-1)).toBe(REVIEW_QUESTION)
    expect(host.writes).toEqual([{ path: '/repo/.cadre/be/ROLE.md.cadre-new', text: role, isWritten: true }])
    expect(host.calls).toEqual([COMMON_DIR_CALL])
    expect(opKinds(reply).get('.cadre/be/ROLE.md')).toBe('conflict')
    expect(reply.split('\n').slice(-3)).toEqual([
      'Applied: wrote 1 file (0 executable).',
      SIX_FOLDERS_UNKNOWN,
      NEXT_STEP_NOTE,
    ])
  })
})

/** The argv of the GSD `mode` hunk through the proven user-level GSD of PROVEN_FACTS (D-71). */
const MODE_RUN = ['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs', 'config-set', 'mode', 'yolo']

/** The `mode` hunk as the person may run it by hand: the user-level GSD dir shown as `~/...` (D-71). */
const MODE_DISPLAY = 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo'

/** The line apply prints when the `mode` hunk failed (D-106). */
const MODE_FAILED = `warning: the .planning/config.json change mode failed: run it yourself: ${MODE_DISPLAY}`

/** The banner ROLE.md carries under the framework line of an attended role. */
const ATTENDED_BANNER =
  'Attended: this role needs a person for some framework steps; the Attended rules under Scope say which.'

/** The chmod calls of the launchers of PM, Security and Team Lead, as the host records them (LNCH-01). */
const EMPTY_REPO_CHMOD_CALLS = EMPTY_REPO_CHMODS.map(argv => ({ argv, options: { timeoutMs: 10_000 } }))

/**
 * A git repo at /repo whose user-level GSD is proven (PROVEN_FACTS), so INIT_ANSWERS puts PM, Team Lead and Security on
 * GSD, and whose `.planning/config.json` already holds workflow.text_mode false, so `mode` is the one hunk init asks;
 * INIT_ANSWERS accepts it, and cadre can run it.
 */
function modeWorld(over: Partial<MemWorld> = {}): MemWorld {
  const config = { '/repo/.planning/config.json': '{"workflow":{"text_mode":false}}' }

  return gitWorld({ facts: PROVEN_FACTS, files: config, ...over })
}

describe('init apply hunks (D-120)', () => {
  test(
    'an accepted, runnable hunk runs once with cwd at the repo root before any write; exit 0 is no failure',
    async () => {
      const host = memHost(hostWorld({}))
      const { io, events } = withHostEvents(host)
      const reply = await runInit(memIo(modeWorld(), INIT_ANSWERS).io, { dryRun: false, host: io })
      expect(host.calls).toEqual([
        { argv: MODE_RUN, options: { cwd: '/repo', timeoutMs: 30_000 } },
        COMMON_DIR_CALL,
        ...EMPTY_REPO_CHMOD_CALLS,
      ])
      expect(events[0]).toBe(`run ${MODE_RUN.join(' ')}`)
      expect(events[1]).toBe(`run ${GIT_COMMON_DIR_ARGV.join(' ')}`)
      expect(events[2]?.startsWith('write ')).toBe(true)
      const applied = `Applied: wrote ${host.writes.length} files (3 executable).`
      expect(reply.split('\n').slice(-3)).toEqual([applied, DEFAULT_FOLDERS_UNKNOWN, NEXT_STEP_NOTE])
    },
  )

  test(
    'a hunk run that exits 1 is reported with the command, attends the GSD roles, and apply still writes',
    async () => {
      const failed = { exitCode: 1, stdout: '', stderr: 'denied' }
      const host = memHost(hostWorld({ runs: [{ argv: MODE_RUN, result: failed }] }))
      const reply = await runInit(memIo(modeWorld(), INIT_ANSWERS).io, { dryRun: false, host: host.io })
      expect(reply.split('\n').slice(-5)).toEqual([
        `Applied: wrote ${host.writes.length} files (3 executable).`,
        MODE_FAILED,
        `warning: ${attendedNote(['mode'])}`,
        DEFAULT_FOLDERS_UNKNOWN,
        NEXT_STEP_NOTE,
      ])
      expect(reply).not.toContain('denied')
      expect(host.writes.at(-1)?.path).toBe('/repo/.cadre/manifest.json')
      for (const id of ['pm', 'security', 'tl']) {
        const role = host.writes.find(write => write.path === `/repo/.cadre/${id}/ROLE.md`)?.text ?? ''
        expect([id, role.includes(ATTENDED_BANNER)]).toEqual([id, true])
      }
    },
  )

  test('a hunk run the host rejects is a failure the same way (D-106)', async () => {
    const host = memHost(hostWorld({ runs: [{ argv: MODE_RUN, result: null }] }))
    const reply = await runInit(memIo(modeWorld(), INIT_ANSWERS).io, { dryRun: false, host: host.io })
    const lines = reply.split('\n')
    expect(lines).toContain(MODE_FAILED)
    expect(lines).toContain(`warning: ${attendedNote(['mode'])}`)
    expect(host.calls[0]).toEqual({ argv: MODE_RUN, options: { cwd: '/repo', timeoutMs: 30_000 } })
  })

  test('a declined hunk is never run, and no failure is reported for it (consent, D-106)', async () => {
    const host = memHost(hostWorld({}))
    const answers = { ...INIT_ANSWERS, '.planning/config.json:': 'Decline' }
    const reply = await runInit(memIo(modeWorld(), answers).io, { dryRun: false, host: host.io })
    expect(host.calls).toEqual([COMMON_DIR_CALL, ...EMPTY_REPO_CHMOD_CALLS])
    expect(reply).not.toContain('failed: run it yourself')
  })

  test('a repo-local GSD hunk is never run: its command is already in the plan (D-28, D-72)', async () => {
    const repoCopy: GsdFact = { ...PROVEN_USER_GSD, location: 'project', dir: '<repo>/.claude/gsd-core' }
    // GSD is in use and its proven copy is the repo's own; the user-level candidate is not proven, so nothing runs.
    const facts: InitFacts = {
      facts: { ...EMPTY_FACTS, repoEntries: [{ name: '.planning', kind: 'dir', isLink: false }], gsd: [repoCopy] },
      gsdUserDir: '/home/u/.claude/gsd-core',
    }
    const host = memHost(hostWorld({}))
    const reply = await runInit(memIo(modeWorld({ facts }), INIT_ANSWERS).io, { dryRun: false, host: host.io })
    expect(host.calls).toEqual([COMMON_DIR_CALL, ...EMPTY_REPO_CHMOD_CALLS])
    const lines = reply.split('\n').map(line => line.trim())
    expect(lines).toContain('run: node .claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo')
    expect(reply).not.toContain('failed: run it yourself')
  })

  test(
    'a /repo/.cadre that links out of the repo gets no write under .cadre/, a refused line per path, no manifest',
    async () => {
      const dirs = { '/repo/.git': [], '/repo/.cadre': [] }
      const world = gitWorld({ dirs, realPaths: { '/repo/.cadre': '/elsewhere/cadre' } })
      const host = memHost(hostWorld({}))
      const reply = await runInit(memIo(world, INIT_ANSWERS).io, { dryRun: false, host: host.io })
      const desired = await plannedFiles(gitWorld(), await defaultRoles(gitWorld()))
      const reason = 'it or a folder above it is a link, or not inside the repo'
      const refused = desired.map(file => file.path).sort(compareText)
      expect(host.writes.map(write => write.path)).toEqual(['/repo/.gitignore'])
      const lines = reply.split('\n')
      expect(lines.filter(line => line.startsWith('warning: refused to write '))).toEqual(
        refused.map(path => `warning: refused to write ${path}: ${reason}`),
      )
      expect(lines).toContain(`warning: ${MANIFEST_SKIPPED_NOTE}`)
      expect(host.calls).toEqual([COMMON_DIR_CALL])
    },
  )

  test('a ROLE.md write the host refuses is reported, the other files are still written, and no manifest', async () => {
    const host = memHost(hostWorld({ writeFails: ['/repo/.cadre/be/ROLE.md'] }))
    const reply = await runInit(memIo(fullWorld(), INIT_ANSWERS).io, { dryRun: false, host: host.io })
    const desired = await plannedFiles(fullWorld(), await defaultRoles(fullWorld()))
    const others = [...desired.map(file => file.path), '.gitignore']
      .filter(path => path !== '.cadre/be/ROLE.md')
      .sort(compareText)
      .map(path => `/repo/${path}`)
    expect(host.writes.filter(write => write.isWritten).map(write => write.path)).toEqual(others)
    expect(host.writes.filter(write => !write.isWritten).map(write => write.path)).toEqual(['/repo/.cadre/be/ROLE.md'])
    const lines = reply.split('\n')
    expect(lines).toContain('warning: could not write .cadre/be/ROLE.md')
    expect(lines).toContain(`warning: ${MANIFEST_SKIPPED_NOTE}`)
  })
})

describe('regen apply', () => {
  /** BE alone on the built-in default, as `.cadre/cadre.json` lists it. */
  const be = templateRole('be')

  /** The repo-relative paths regen of BE never writes: the repo state and BE's own role.json, its input (A5). */
  const NOT_WRITTEN = ['.cadre/cadre.json', '.cadre/be/role.json']

  /**
   * The repo after an init of BE alone on the built-in default: a listed `.cadre/` folder with cadre.json, BE's
   * role.json and a manifest that records no file, as the faked host's regen world has it.
   */
  function beOnlyWorld(): MemWorld {
    return gitWorld({
      dirs: { '/repo/.git': [], '/repo/.cadre': [] },
      files: {
        '/repo/.cadre/cadre.json': cadreJsonText(stateOf([be])),
        '/repo/.cadre/be/role.json': roleJsonText(be),
        '/repo/.cadre/manifest.json': stableJson({ schema: 1, cadreVersion: '0.2.0', files: [] }),
      },
    })
  }

  test('plain regen writes the files of BE and the manifest last, asking nothing (D-68)', async () => {
    const run = memIo(beOnlyWorld(), {})
    const host = memHost(hostWorld({}))
    const reply = await runRegen(run.io, { id: 'be', dryRun: false, host: host.io })
    // Regen passes no repo parts, so it builds no CLAUDE.md (02-GAPS-B2 S1).
    const files = (await plannedFiles(gitWorld(), [be])).filter(file => file.path !== '.cadre/be/CLAUDE.md')
    const written = files.filter(file => !NOT_WRITTEN.includes(file.path))
    const recorded = files.filter(file => file.path !== '.cadre/cadre.json')
    expect(host.writes).toEqual([
      ...written.map(file => ({ path: `/repo/${file.path}`, text: file.content, isWritten: true })),
      { path: '/repo/.cadre/manifest.json', text: await manifestOf(recorded), isWritten: true },
    ])
    expect(host.calls.map(call => call.argv)).toEqual([['/bin/chmod', '755', '/repo/.cadre/bin/be']])
    const applied = `Applied: wrote ${written.length + 1} files (1 executable).`
    expect(reply.split('\n').slice(-2)).toEqual([applied, NEXT_STEP_NOTE])
    expect([run.asked, run.logged]).toEqual([[], []])
  })

  test('plain regen keeps a hand-edited file, writes its .cadre-new copy and says so (D-67, D-68)', async () => {
    const files = await plannedFiles(gitWorld(), [be])
    const world = gitWorld({
      dirs: { '/repo/.git': [], '/repo/.cadre': [] },
      files: {
        ...onDisk(files),
        '/repo/.cadre/be/ROLE.md': 'edited by hand\n',
        '/repo/.cadre/manifest.json': await manifestOf(files),
      },
    })
    const host = memHost(hostWorld({}))
    const reply = await runRegen(memIo(world, {}).io, { id: 'be', dryRun: false, host: host.io })
    const kinds = opKinds(reply)
    expect([kinds.get('.cadre/be/ROLE.md'), kinds.get('.cadre/be/ROLE.md.cadre-new')]).toEqual(['conflict', 'create'])
    const role = files.find(file => file.path === '.cadre/be/ROLE.md')?.content ?? ''
    expect(host.writes).toEqual([{ path: '/repo/.cadre/be/ROLE.md.cadre-new', text: role, isWritten: true }])
    expect(host.calls).toEqual([])
    expect(reply.split('\n').slice(-2)).toEqual(['Applied: wrote 1 file (0 executable).', NEXT_STEP_NOTE])
  })

  test('a regen whose write failed skips the manifest and says to run regen again (A4)', async () => {
    const host = memHost(hostWorld({ writeFails: ['/repo/.cadre/bin/be'] }))
    const reply = await runRegen(memIo(beOnlyWorld(), {}).io, { id: 'be', dryRun: false, host: host.io })
    const lines = reply.split('\n')
    expect(host.writes.map(write => write.path)).not.toContain('/repo/.cadre/manifest.json')
    expect(lines).toContain(
      'warning: .cadre/manifest.json was not written because a file above was not written: run /cadre regen be again.',
    )
    expect(lines).not.toContain(`warning: ${MANIFEST_SKIPPED_NOTE}`)
    expect(lines.at(-1)).toBe(NEXT_STEP_NOTE)
  })
})

/** The Rules section of the root CLAUDE.md in the regen cases (G-02-1f Regen). */
const RULES_SECTION = '# Rules\nRun the tests.\n'

/** The Git section of the root CLAUDE.md, the one part BE was given (G-02-1f Regen). */
const GIT_SECTION = '## Git\nUse signed commits.\n'

/** The Git section after an edit. */
const GIT_EDITED = '## Git\nUse signed commits, always.\n'

/** A section the root CLAUDE.md gained after init. */
const DEPLOY_SECTION = '## Deploy\nShip on Fridays.\n'

/** The start of a regen question about a part or a memory for BE (G-02-1f Regen, D-142). */
const REGEN_PART_PREFIX = 'Should be get'

/** A repo part of the root CLAUDE.md with this id, heading and text, hashed as the read hashes it. */
async function rootPart(id: string, heading: string, text: string): Promise<InstructionPart> {
  return { id, file: 'CLAUDE.md', heading, source: 'repo', text, hash: await sha256Hex(text) }
}

/** What a role's records keep of a part: its file, heading and hash (G-02-1f Regen). */
function recorded(part: Pick<InstructionPart, 'file' | 'heading' | 'hash'>): PartRecord {
  return { file: part.file, heading: part.heading, hash: part.hash }
}

/** The regen fixture: the root CLAUDE.md now, the world fields to change, and BE's given and not-given parts. */
type RegenFixture = {
  readonly claudeMd?: string | null
  readonly over?: Partial<MemWorld>
  readonly given?: readonly InstructionPart[]
  readonly notGiven?: readonly InstructionPart[]
}

/**
 * The repo after an init that gave BE the parts `given` of the root CLAUDE.md, the Git section unless told otherwise,
 * and recorded `notGiven`, the Rules section, as not given (AUTO-PICK #19 Q1); PM was given no part. Every file init
 * wrote is on the disk with its manifest, BE's built CLAUDE.md holding its parts, and `claudeMd` is the root CLAUDE.md
 * now (none for null). The repo root lists, so the scans warn about nothing. `over` changes the fields it names; its
 * files and folders are kept beside these.
 */
async function regenPartsWorld(fixture: RegenFixture = {}): Promise<MemWorld> {
  const over = fixture.over ?? {}
  const given = fixture.given ?? [await rootPart('P2', 'Git', GIT_SECTION)]
  const notGiven = fixture.notGiven ?? [await rootPart('P1', 'Rules', RULES_SECTION)]
  const records = { instructionParts: given.map(recorded), instructionPartsNotGiven: notGiven.map(recorded) }
  const be = templateRole('be', records)
  const roles = [be, templateRole('pm', { instructionParts: [] })]
  const dirs = { '/repo/.git': [], ...USER_DIR_LISTED, '/repo': [], '/repo/.cadre': [], ...over.dirs }
  const base = gitWorld({ ...over, dirs })
  const state = stateOf(roles)
  const scopes = scopesFor(roles, state.framework, await scansOf(base), [], state.launchStart)
  const files = desiredFiles({ roles, scopes, state, only: null, repoParts: new Map([['be', given]]) })
  const claudeMd = fixture.claudeMd === undefined ? `${RULES_SECTION}${GIT_SECTION}` : fixture.claudeMd
  const root = claudeMd === null ? {} : { '/repo/CLAUDE.md': claudeMd }

  return {
    ...base,
    files: { ...base.files, ...onDisk(files), '/repo/.cadre/manifest.json': await manifestOf(files), ...root },
  }
}

/** The host rules of a plain regen of BE: git names the common dir and tracks the root CLAUDE.md. */
const REGEN_RUNS: readonly HostRunRule[] = [COMMON_DIR_RULE, ...BUILT_TRACKED]

/** A plain `/cadre regen be` in `world` with these answers and host rules: its reply, its port and its host. */
async function regenPlainBe(
  world: MemWorld,
  answers: Readonly<Record<string, string>>,
  runs: readonly HostRunRule[] = REGEN_RUNS,
): Promise<{ readonly reply: string; readonly run: MemRun; readonly host: MemHost }> {
  const run = memIo(world, answers)
  const host = memHost(hostWorld({ runs }))
  const reply = await runRegen(run.io, { id: 'be', dryRun: false, host: host.io })

  return { reply, run, host }
}

/** The lines of a reply that are warnings. */
function warningLines(reply: string): string[] {
  return reply.split('\n').filter(line => line.startsWith('warning: '))
}

/** BE's role with these part records, given and not given (AUTO-PICK #19 Q1). */
function recordedBe(given: readonly InstructionPart[], notGiven: readonly InstructionPart[]): RoleSpec {
  const records = given.map(recorded)
  if (notGiven.length === 0) return templateRole('be', { instructionParts: records })

  return templateRole('be', { instructionParts: records, instructionPartsNotGiven: notGiven.map(recorded) })
}

/** The hand-out record of BE's global parts and memories, in its role memory folder (G-02-1f Regen, D-140 q2-a). */
async function beRecordPath(): Promise<string> {
  return instructionsRecordPath(await memoryFolder('be'))
}

describe('regen by part hashes (G-02-1f)', () => {
  test('the regen texts are fixed', () => {
    expect(REGEN_ITEM_OPTIONS).toEqual(['Yes', 'No'])
    expect(REGEN_DISMISSED_REASON).toBe('A regen question on instruction parts was dismissed or not answered.')
    expect(regenCancelledReply(REGEN_DISMISSED_REASON)).toBe(
      'regen cancelled, nothing written: A regen question on instruction parts was dismissed or not answered.',
    )
    expect(regenPartQuestion('be', { file: 'CLAUDE.md', heading: '' })).toBe(
      'Should be get "(top of file)" from CLAUDE.md?',
    )
    expect([regenPartContextLine('new', false), regenPartContextLine('changed', true)]).toEqual([
      'New since init. Recommended: no.',
      'Changed since init. Recommended: yes.',
    ])
    expect(regenMemoryQuestion('be', { file: 'squad.md' })).toBe('Should be get the memory "squad.md"?')
    expect(regenMemoryContextLine({ summary: 'Unsigned commits' }, 'changed', false)).toBe(
      'Unsigned commits. Changed since init. Recommended: no.',
    )
    expect(regenMemoryContextLine({ summary: '' }, 'changed', true)).toBe(
      'No summary in MEMORY.md. Changed since init. Recommended: yes.',
    )
    expect(regenHeader(1, 1)).toBe('Regen 1/1')
    expect(partDroppedLine('be', { file: 'CLAUDE.md', heading: 'Git' })).toBe(
      'dropped from be: CLAUDE.md > Git (gone from its file)',
    )
    expect(memoryDroppedLine('be', { file: 'squad.md' })).toBe('dropped from be: memory squad.md (gone)')
    expect([notHandedOutWarning('be', 1), notHandedOutWarning('be', 2)]).toEqual([
      '1 new or changed instruction part or memory for be was not handed out: ' +
        'run /cadre regen be in a session to answer it',
      '2 new or changed instruction parts or memories for be were not handed out: ' +
        'run /cadre regen be in a session to answer them',
    ])
    expect(improverNotOfferedWarning('be')).toBe(
      'the improver was not offered for be: claude -p cannot ask Accept or Keep original; ' +
        'run /cadre regen be in a session to review the changes',
    )
    expect(dryRunPrivateWarning('be')).toBe(
      '--dry-run did not compare the global parts and memories of be: finding their folder runs git; ' +
        'a plain regen compares them',
    )
    expect(unusableRecordWarning('be')).toBe(
      'could not use the hand-out record of be (instructions.json): its global parts and memories were not ' +
        'compared; run /cadre init to hand them out again',
    )
  })

  test('with nothing new, changed or removed regen asks nothing, calls no model and rebuilds nothing', async () => {
    const { reply, run, host } = await regenPlainBe(await regenPartsWorld(), {})
    const kinds = opKinds(reply)
    expect([run.asked, run.prompts, host.writes, gitCalls(host)]).toEqual([[], [], [], []])
    expect([kinds.get(BE_CLAUDE_MD_PATH), kinds.get('.cadre/be/role.json')]).toEqual([undefined, undefined])
    expect([...kinds.values()].filter(kind => kind !== 'leave')).toEqual([])
    expect(warningLines(reply)).toEqual([])
    expect(reply).not.toContain('no longer generated')
    expect(reply.split('\n').slice(-2)).toEqual([APPLIED_NONE_NOTE, NEXT_STEP_NOTE])
  })

  test('in a session a changed part is asked after one recommendation call; Yes rebuilds and records it', async () => {
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":true}}'] } }
    const { reply, run, host } = await regenPlainBe(await regenPartsWorld(changed), { [REGEN_PART_PREFIX]: 'Yes' })
    const rules = await rootPart('P1', 'Rules', RULES_SECTION)
    const edited = await rootPart('P2', 'Git', GIT_EDITED)
    expect(run.prompts).toHaveLength(1)
    expect(run.prompts[0]?.startsWith(`${REGEN_RECOMMEND_SYSTEM}\n---\n`)).toBe(true)
    expect(run.prompts[0]).toContain('\nbe | BE | Implements the backend and core code.\n')
    expect(run.prompts[0]).toContain('\nI1 | CLAUDE.md | Git | ## Git Use signed commits, always.')
    expect(run.asked).toEqual([
      withContext('Should be get "Git" from CLAUDE.md?', 'Changed since init. Recommended: yes.'),
    ])
    expect(run.specs).toEqual([{ options: ['Yes', 'No'], header: 'Regen 1/1' }])
    expect(host.writes.slice(0, 2)).toEqual([
      { path: BE_CLAUDE_MD, text: roleClaudeMdText('be', [edited]), isWritten: true },
      { path: '/repo/.cadre/be/role.json', text: roleJsonText(recordedBe([edited], [rules])), isWritten: true },
    ])
    expect(host.writes.slice(2).map(write => write.path)).toEqual(['/repo/.cadre/manifest.json'])
    const kinds = opKinds(reply)
    expect([kinds.get(BE_CLAUDE_MD_PATH), kinds.get('.cadre/be/role.json')]).toEqual(['change', 'change'])
    expect(gitCalls(host).map(call => call.argv)).toEqual([BUILT_GIT_ARGV])
  })

  test('a section new in a named file is asked, one not given is not; after No neither is asked again', async () => {
    const claudeMd = `# Rules\nRun the tests first.\n${GIT_SECTION}${DEPLOY_SECTION}`
    const world = await regenPartsWorld({ claudeMd, over: { replies: ['{"items":{"I1":false}}'] } })
    const first = await regenPlainBe(world, { [REGEN_PART_PREFIX]: 'No' })
    expect(first.run.asked).toEqual([
      withContext('Should be get "Deploy" from CLAUDE.md?', 'New since init. Recommended: no.'),
    ])
    const kinds = opKinds(first.reply)
    expect([kinds.get(BE_CLAUDE_MD_PATH), kinds.get('.cadre/be/role.json')]).toEqual([undefined, 'change'])
    const again = await regenPlainBe(withWrites(world, first.host.writes), {})
    expect([again.run.asked, again.run.prompts, again.host.writes]).toEqual([[], [], []])
  })

  test('No to a changed part takes it out of the built file and records it not given, never asked again', async () => {
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":false}}'] } }
    const world = await regenPartsWorld(changed)
    const first = await regenPlainBe(world, { [REGEN_PART_PREFIX]: 'No' })
    const rules = await rootPart('P1', 'Rules', RULES_SECTION)
    const edited = await rootPart('P2', 'Git', GIT_EDITED)
    expect(first.host.writes.slice(0, 2)).toEqual([
      { path: BE_CLAUDE_MD, text: roleClaudeMdText('be', []), isWritten: true },
      { path: '/repo/.cadre/be/role.json', text: roleJsonText(recordedBe([], [rules, edited])), isWritten: true },
    ])
    const again = await regenPlainBe(withWrites(world, first.host.writes), {})
    expect([again.run.asked, again.host.writes]).toEqual([[], []])
  })

  test('a removed section is dropped with its reply line right after the plan; the built file is rebuilt', async () => {
    const { reply, run, host } = await regenPlainBe(await regenPartsWorld({ claudeMd: RULES_SECTION }), {})
    const lines = reply.split('\n')
    const at = lines.findIndex(line => line.startsWith('Summary: '))
    expect(lines[at + 1]).toBe('dropped from be: CLAUDE.md > Git (gone from its file)')
    expect([run.asked, run.prompts]).toEqual([[], []])
    const rules = await rootPart('P1', 'Rules', RULES_SECTION)
    expect(host.writes.slice(0, 2)).toEqual([
      { path: BE_CLAUDE_MD, text: roleClaudeMdText('be', []), isWritten: true },
      { path: '/repo/.cadre/be/role.json', text: roleJsonText(recordedBe([], [rules])), isWritten: true },
    ])
  })

  test('in claude -p nothing is asked: new and changed parts are left out with a warning, records kept', async () => {
    for (const interactive of [false, null]) {
      const claudeMd = `${RULES_SECTION}${GIT_EDITED}${DEPLOY_SECTION}`
      const { reply, run, host } = await regenPlainBe(await regenPartsWorld({ claudeMd, over: { interactive } }), {})
      expect([interactive, run.asked, run.prompts]).toEqual([interactive, [], []])
      expect([interactive, warningLines(reply)]).toEqual([interactive, [`warning: ${notHandedOutWarning('be', 2)}`]])
      expect(host.writes.map(write => write.path)).toEqual([BE_CLAUDE_MD, '/repo/.cadre/manifest.json'])
      expect(host.writes[0]?.text).toBe(roleClaudeMdText('be', []))
      expect(opKinds(reply).get('.cadre/be/role.json')).toBe(undefined)
    }
  })

  test('a --dry-run in a session asks, plans the rebuild, writes and runs nothing, names what it skipped', async () => {
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":true}}'] } }
    const run = memIo(await regenPartsWorld(changed), { [REGEN_PART_PREFIX]: 'Yes' })
    const reply = await runRegen(run.io, { id: 'be', dryRun: true })
    const kinds = opKinds(reply)
    expect([kinds.get(BE_CLAUDE_MD_PATH), kinds.get('.cadre/be/role.json')]).toEqual(['change', 'change'])
    expect(firstLines(run.asked)).toEqual(['Should be get "Git" from CLAUDE.md?'])
    expect(warningLines(reply)).toEqual([`warning: ${dryRunPrivateWarning('be')}`])
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(run.reads.filter(path => path.startsWith('/home/u/.claude/cadre'))).toEqual([])
  })

  test('after a plain session regen the improver runs on the rebuilt file if claude-md-management is in', async () => {
    const installed = { [INSTALLED_PLUGINS_PATH]: claudeMdInstalled() }
    const over = { files: installed, replies: ['{"items":{"I1":true}}'] }
    const world = await regenPartsWorld({ claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over })
    const files: Record<string, string> = { ...world.files }
    const edited = await rootPart('P2', 'Git', GIT_EDITED)
    const improved = `${roleClaudeMdText('be', [edited])}Keep commits small.\n`
    const host = memHost(hostWorld({ runs: REGEN_RUNS }))
    const io: HostIo = {
      ...host.io,
      // Each write that lands is on the disk, so the improver finds the rebuilt file as apply wrote it (02-GAPS-B3 M1).
      write: async (path, text) => {
        const isWritten = await host.io.write(path, text)
        if (isWritten) files[path] = text

        return isWritten
      },
      run: async (argv, options) => {
        const result = await host.io.run(argv, options)
        if (argv.join(' ') === BE_IMPROVER_ARGV.join(' ')) files[BE_CLAUDE_MD] = improved

        return result
      },
    }
    const run = memIo({ ...world, files }, { [REGEN_PART_PREFIX]: 'Yes', [IMPROVER_PREFIX]: 'Accept' })
    const reply = await runRegen(run.io, { id: 'be', dryRun: false, host: io })
    expect(improverCalls(host)).toEqual([
      { argv: BE_IMPROVER_ARGV, options: { cwd: '/repo/.cadre/be', timeoutMs: 300_000 } },
    ])
    expect(reply.split('\n').slice(-2)).toEqual([improverLine({ changed: 1, total: 1 }), NEXT_STEP_NOTE])
    expect(writtenManifestText(host)).toContain(await sha256Hex(improved))
  })

  test('in claude -p a rebuilt file the improver could improve gets the improver warning and no run', async () => {
    const rules = await rootPart('P1', 'Rules', RULES_SECTION)
    const git = await rootPart('P2', 'Git', GIT_SECTION)
    const over = { files: { [INSTALLED_PLUGINS_PATH]: claudeMdInstalled() }, interactive: false }
    const world = await regenPartsWorld({ claudeMd: RULES_SECTION, over, given: [rules, git], notGiven: [] })
    const { reply, host } = await regenPlainBe(world, {})
    expect(improverCalls(host)).toEqual([])
    expect(warningLines(reply)).toEqual([`warning: ${improverNotOfferedWarning('be')}`])
    expect(host.writes[0]).toEqual({ path: BE_CLAUDE_MD, text: roleClaudeMdText('be', [rules]), isWritten: true })
  })

  test('regen reads again only the files the records name (D-142 rg2-a)', async () => {
    const squad = `${MEMORY_DIR}/squad.md`
    const over = {
      dirs: { [MEMORY_DIR]: [entry('MEMORY.md'), entry('squad.md')], '/repo/.claude/rules': [entry('style.md')] },
      files: {
        '/repo/AGENTS.md': '# Agents\n',
        '/repo/.claude/rules/style.md': '# Style\n',
        [`${MEMORY_DIR}/MEMORY.md`]: MEMORY_INDEX,
        [squad]: `${MEMORY_SENTENCE} (squad)`,
        [GLOBAL_CLAUDE_MD]: PARTS_GLOBAL,
      },
    }
    const run = memIo(await regenPartsWorld({ over }), {})
    await runRegen(run.io, { id: 'be', dryRun: true })
    const rules = '/repo/.claude/rules/style.md'
    const unnamed = ['/repo/AGENTS.md', rules, `${MEMORY_DIR}/MEMORY.md`, squad, GLOBAL_CLAUDE_MD]
    expect(run.reads).toContain('/repo/CLAUDE.md')
    expect(run.reads.filter(path => unnamed.includes(path))).toEqual([])
  })

  test('a plain regen compares the global parts and memories its record names and rebuilds their files', async () => {
    const security = await partsGlobalPart('P1', 'Security', '# Security\nNever commit secrets.\n')
    const git = await partsGlobalPart('P2', 'Git', '## Git\nUse signed commits.\n')
    const securityEdited = await partsGlobalPart('P1', 'Security', '# Security\nNever commit secrets, ever.\n')
    const squad = await squadMemory()
    const files = {
      [await beRecordPath()]: instructionsRecordText([security], [squad], [git]),
      [GLOBAL_CLAUDE_MD]: '# Security\nNever commit secrets, ever.\n## Git\nUse signed commits.\n',
      [`${MEMORY_DIR}/squad.md`]: `${MEMORY_SENTENCE} (squad)`,
    }
    const world = await regenPartsWorld({ over: { files, replies: ['{"items":{"I1":true}}'] } })
    const { reply, run, host } = await regenPlainBe(world, { [REGEN_PART_PREFIX]: 'Yes' })
    expect(run.asked).toEqual([
      withContext('Should be get "Security" from ~/.claude/CLAUDE.md?', 'Changed since init. Recommended: yes.'),
    ])
    const folder = await memoryFolder('be')
    expect(homeWrites(host).map(write => [write.path, write.text])).toEqual([
      [privateClaudeMdPath(folder), privateClaudeMdText('be', 'repo', [securityEdited])],
      [instructionsRecordPath(folder), instructionsRecordText([securityEdited], [squad], [git])],
    ])
    expect(opKinds(reply).get(BE_CLAUDE_MD_PATH)).toBe(undefined)
  })

  test('a removed memory is dropped with its reply line; a role left with nothing gets both files empty', async () => {
    const squad = await squadMemory()
    const files = { [await beRecordPath()]: instructionsRecordText([], [squad]) }
    const { reply, host } = await regenPlainBe(await regenPartsWorld({ over: { files } }), {})
    const folder = await memoryFolder('be')
    expect(reply.split('\n')).toContain('dropped from be: memory squad.md (gone)')
    // A role that had a private record and lost everything gets a header-only text file and an empty record (Q11).
    expect(homeWrites(host).map(write => [write.path, write.text])).toEqual([
      [privateClaudeMdPath(folder), privateClaudeMdText('be', 'repo', [])],
      [instructionsRecordPath(folder), instructionsRecordText([], [])],
    ])
  })

  test('a record naming a file outside the config folder or the memory folders is not used (Q9)', async () => {
    const hash = 'a'.repeat(64)
    // A config-folder file that is not a plain .md file outside projects/, cadre/ and plugins/ (02-GAPS-B3 M2).
    const hostile = [
      '~/.claude/settings.json',
      '~/.claude/.credentials.json',
      '~/.claude/projects/x/memory/a.md',
      '~/.claude/cadre/r-12345678/pm/instructions/CLAUDE.md',
    ]
    const records = [
      JSON.stringify({ schema: 1, parts: [{ file: '/etc/notes.md', heading: '', hash }], memories: [] }),
      JSON.stringify({ schema: 1, parts: [{ file: '~/.claude/../.ssh/notes.md', heading: '', hash }], memories: [] }),
      JSON.stringify({ schema: 1, parts: [], memories: [{ file: 'x.md', folder: '/tmp', summary: 's', hash }] }),
      JSON.stringify({ schema: 1, parts: [], memories: [{ file: '../x.md', folder: MEMORY_DIR, summary: 's', hash }] }),
      '{"schema":1}',
      ...hostile.map(file => JSON.stringify({ schema: 1, parts: [{ file, heading: '', hash }], memories: [] })),
    ]
    const hostilePaths = hostile.map(file => `/home/u/${file.slice(2)}`)
    for (const [index, record] of records.entries()) {
      const secrets = Object.fromEntries(hostilePaths.map(path => [path, 'secret']))
      const files = { [await beRecordPath()]: record, '/etc/notes.md': 'secret', '/tmp/x.md': 'secret', ...secrets }
      const { reply, run, host } = await regenPlainBe(await regenPartsWorld({ over: { files } }), {})
      expect([index, warningLines(reply)]).toEqual([index, [`warning: ${unusableRecordWarning('be')}`]])
      const outside = run.reads.filter(path => /^\/(etc|tmp)\//.test(path) || hostilePaths.includes(path))
      expect([index, outside]).toEqual([index, []])
      expect([index, homeWrites(host)]).toEqual([index, []])
    }
    const style = '# Style\nKeep it short.\n'
    const [part] = await partsOfText('~/.claude/notes/style.md', 'global', style, 0)
    const used = JSON.stringify({ schema: 1, parts: [part === undefined ? {} : recorded(part)], memories: [] })
    const files = { [await beRecordPath()]: used, '/home/u/.claude/notes/style.md': style }
    const { reply, run } = await regenPlainBe(await regenPartsWorld({ over: { files } }), {})
    expect([warningLines(reply), run.reads.includes('/home/u/.claude/notes/style.md')]).toEqual([[], true])
  })

  test('a side whose reads pass 512 KiB is left as it is, with a warning; each side has its own cap (C8)', async () => {
    const big = async (file: string): Promise<InstructionPart[]> =>
      partsOfText(file, 'repo', `# ${file}\n${'x'.repeat(200 * 1024)}\n`, 0)
    const docs = [...(await big('docs/a.md')), ...(await big('docs/b.md')), ...(await big('docs/c.md'))]
    const onDiskDocs = Object.fromEntries(docs.map(part => [`/repo/${part.file}`, part.text]))
    const over = { files: onDiskDocs }
    const { reply, run, host } = await regenPlainBe(await regenPartsWorld({ over, notGiven: docs }), {})
    expect(warningLines(reply)).toEqual([`warning: ${regenTotalWarning('be')}`])
    expect([run.asked, host.writes, opKinds(reply).get(BE_CLAUDE_MD_PATH)]).toEqual([[], [], undefined])
    expect(reply).not.toContain('dropped from be')
    expect(regenTotalWarning('be')).toBe(
      'regen stopped reading at 512 KiB for be: its instruction parts were not compared',
    )
    const bigText = `# Big\n${'y'.repeat(200 * 1024)}\n`
    const global = await partsOfText('~/.claude/notes/big.md', 'global', bigText, 0)
    const record = instructionsRecordText(global, [])
    const files = { ...onDiskDocs, [await beRecordPath()]: record, '/home/u/.claude/notes/big.md': bigText }
    const both = await regenPlainBe(await regenPartsWorld({ over: { files }, notGiven: docs.slice(0, 2) }), {})
    const isPrivateRead = both.run.reads.includes('/home/u/.claude/notes/big.md')
    expect([warningLines(both.reply), isPrivateRead]).toEqual([[], true])
  })

  test('a dismissed regen question, or three answers it cannot read, cancels with nothing written (Q7)', async () => {
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":true}}'] } }
    const cases: readonly (readonly [Readonly<Record<string, string>>, string])[] = [
      [{}, REGEN_DISMISSED_REASON],
      [{ [REGEN_PART_PREFIX]: 'maybe', "'maybe' isn't one of": 'maybe' }, NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const { reply, run, host } = await regenPlainBe(await regenPartsWorld(changed), answers)
      expect([reply, host.writes]).toEqual([regenCancelledReply(reason), []])
      expect(run.logged).toEqual([reason])
    }
  })

  test('a named file that cannot be read or is over the read cap leaves the role as it is (Q8)', async () => {
    const big = 'x'.repeat(MAX_READ_BYTES + 1)
    const worlds: readonly (readonly [MemWorld, string])[] = [
      [await regenPartsWorld({ over: { unknownPaths: ['/repo/CLAUDE.md'] } }), unreadableWarning('CLAUDE.md')],
      [await regenPartsWorld({ claudeMd: big }), overSizeWarning('CLAUDE.md')],
    ]
    for (const [world, warning] of worlds) {
      const { reply, run, host } = await regenPlainBe(world, {})
      expect(warningLines(reply)).toEqual([`warning: ${warning}`])
      expect([run.asked, host.writes]).toEqual([[], []])
    }
  })

  test('an unusable recommendation is sent back with its errors; after three, no item is recommended', async () => {
    const replies = ['not json', '{"items":{"I9":true}}', '{"items":{"I1":"yes"}}']
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies } }
    const { run } = await regenPlainBe(await regenPartsWorld(changed), { [REGEN_PART_PREFIX]: 'Yes' })
    expect(run.prompts).toHaveLength(3)
    expect(run.prompts.map(prompt => prompt.split('\n').at(-1)).slice(1)).toEqual([
      '- the reply is not JSON',
      '- unknown item "I9"',
    ])
    expect(run.asked).toEqual([
      withContext('Should be get "Git" from CLAUDE.md?', 'Changed since init. Recommended: no.'),
    ])
  })

  test('a changed memory is asked with the summary its record holds, and MEMORY.md is not read (Q10)', async () => {
    const squad = await squadMemory()
    const files = {
      [await beRecordPath()]: instructionsRecordText([], [squad]),
      [`${MEMORY_DIR}/squad.md`]: `${MEMORY_SENTENCE} (squad, edited)`,
      [`${MEMORY_DIR}/MEMORY.md`]: MEMORY_INDEX,
    }
    const world = await regenPartsWorld({ over: { files, replies: ['{"items":{"I1":false}}'] } })
    const { run, host } = await regenPlainBe(world, { [REGEN_PART_PREFIX]: 'No' })
    const context = 'Unsigned commits on per-phase branches. Changed since init. Recommended: no.'
    expect(run.asked).toEqual([withContext('Should be get the memory "squad.md"?', context)])
    expect(run.reads).not.toContain(`${MEMORY_DIR}/MEMORY.md`)
    const folder = await memoryFolder('be')
    // No takes the memory out of the record (Q1); the role is left with nothing, so both files say so (Q11).
    expect(homeWrites(host).map(write => [write.path, write.text])).toEqual([
      [privateClaudeMdPath(folder), privateClaudeMdText('be', 'repo', [])],
      [instructionsRecordPath(folder), instructionsRecordText([], [])],
    ])
  })

  test('a role.json written before the records regens as before and keeps the built CLAUDE.md with no op', async () => {
    const world = await regenPartsWorld({ claudeMd: RULES_SECTION })
    const unrecorded = roleJsonText(templateRole('be'))
    const before = { ...world, files: { ...world.files, '/repo/.cadre/be/role.json': unrecorded } }
    const run = memIo(before, {})
    const reply = await runRegen(run.io, { id: 'be', dryRun: true })
    expect(opKinds(reply).get(BE_CLAUDE_MD_PATH)).toBe(undefined)
    expect(reply).not.toContain('no longer generated')
    expect(reply).not.toContain('dropped from be')
    expect(run.reads).not.toContain('/repo/CLAUDE.md')
    expect([run.asked, warningLines(reply)]).toEqual([[], []])
  })

  test('init records the repo parts of each parts-flow role and the other parts of their files only', async () => {
    const topics = [
      { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
      { title: 'Repo rules', summary: 'The rules of this repo.', parts: ['P2'] },
      { title: 'Git', summary: 'How commits are made.', parts: ['P3'] },
    ]
    const world = builtWorld({
      dirs: { '/repo/.git': [], ...FULL_DIRS, [MEMORY_DIR]: [entry('squad.md')] },
      files: {
        ...FULL_FILES,
        [GLOBAL_CLAUDE_MD]: `# Security\n${GLOBAL_SENTENCE}.\n`,
        '/repo/CLAUDE.md': `# Rules\n${BUILT_RULE}\n${GIT_SECTION}`,
        [`${MEMORY_DIR}/squad.md`]: `${MEMORY_SENTENCE} (squad)`,
      },
      replies: [
        JSON.stringify({ topics }),
        '{"topics":{"T1":["security"],"T2":["be"],"T3":["tl"]},"memories":{"M1":["security"]}}',
      ],
    })
    const host = memHost(hostWorld({ runs: [...BUILT_TRACKED, COMMON_DIR_RULE] }))
    await runInit(memIo(world, PARTS_ANSWERS).io, { dryRun: false, host: host.io })
    const written = (id: string): string =>
      host.writes.find(write => write.path === `/repo/.cadre/${id}/role.json`)?.text ?? ''
    const rules = await rootPart('P2', 'Rules', `# Rules\n${BUILT_RULE}\n`)
    const git = await rootPart('P3', 'Git', GIT_SECTION)
    expect(written('be')).toBe(roleJsonText(recordedBe([rules], [git])))
    expect(parseRoleJson(written('tl'))?.instructionParts).toEqual([recorded(git)])
    expect(parseRoleJson(written('tl'))?.instructionPartsNotGiven).toEqual([recorded(rules)])
    const security = parseRoleJson(written('security'))
    expect([security?.instructionParts, security?.instructionPartsNotGiven]).toEqual([[], undefined])
    const secrets = [
      '~/.claude',
      GLOBAL_SENTENCE,
      await sha256Hex(`# Security\n${GLOBAL_SENTENCE}.\n`),
      'squad.md',
      await sha256Hex(`${MEMORY_SENTENCE} (squad)`),
    ]
    const roleJsons = host.writes.filter(write => write.path.endsWith('/role.json')).map(write => write.text)
    expect(leaks(roleJsons.join('\n'), secrets)).toEqual([])
  })
})

/** The plugin key of claude-security in Anthropic's official marketplace (decision #39). */
const SECURITY_KEY = 'claude-security@claude-plugins-official'

/** The plugin key of security-guidance in Anthropic's official marketplace (decision #39). */
const GUIDANCE_KEY = 'security-guidance@claude-plugins-official'

/** Both security plugin keys, in the order init asks about and installs them (decision #39). */
const SECURITY_KEYS = [SECURITY_KEY, GUIDANCE_KEY]

/** The argv that installs claude-security (decision #39). */
const SECURITY_INSTALL = ['claude', 'plugin', 'install', SECURITY_KEY]

/** The argv that installs security-guidance (decision #39). */
const GUIDANCE_INSTALL = ['claude', 'plugin', 'install', GUIDANCE_KEY]

/** The python3 run of a host whose Python is new enough for claude-security (decision #39). */
const PYTHON_OK_RUN: HostRunRule = {
  argv: ['python3', '--version'],
  result: { exitCode: 0, stdout: 'Python 3.12.1\n', stderr: '' },
}

/** A host whose Python is new enough and whose two plugin installs exit 0 (decision #39). */
const INSTALLS_OK: readonly HostRunRule[] = [
  PYTHON_OK_RUN,
  { argv: SECURITY_INSTALL, result: { exitCode: 0, stdout: '', stderr: '' } },
  { argv: GUIDANCE_INSTALL, result: { exitCode: 0, stdout: '', stderr: '' } },
]

/** INIT_ANSWERS with Install answered to the security plugins question (decision #39). */
const INSTALL_ANSWERS: Readonly<Record<string, string>> = {
  ...INIT_ANSWERS,
  'Install from claude-plugins-official': 'Install',
}

/** The start of the security plugins question when both plugins are missing (decision #39). */
const BOTH_QUESTION_START =
  'Install from claude-plugins-official after you confirm the plan: claude-security and security-guidance?'

/** The line before the next step when both plugins were installed (decision #39). */
const BOTH_INSTALLED_LINE =
  'Installed claude-security@claude-plugins-official and security-guidance@claude-plugins-official: ' +
  'run /reload-plugins to load them in this session.'

/** The installed_plugins.json of the fixture user, whose home is /home/u (DEFAULT_LOCATIONS). */
const INSTALLED_PLUGINS_PATH = '/home/u/.claude/plugins/installed_plugins.json'

/** A git repo whose user has these plugin keys installed, at user scope (#69 A1). */
function installedWorld(keys: readonly string[]): MemWorld {
  const plugins = Object.fromEntries(keys.map(key => [key, [{ scope: 'user', version: '1.0.0' }]]))

  return gitWorld({ files: { [INSTALLED_PLUGINS_PATH]: JSON.stringify({ plugins }) } })
}

describe('security plugin installs (decision #39)', () => {
  test('the plugin keys, their order and the review skill the Security role gets are fixed', () => {
    expect([CLAUDE_SECURITY_PLUGIN, SECURITY_GUIDANCE_PLUGIN]).toEqual(SECURITY_KEYS)
    expect(SECURITY_PLUGINS).toEqual(SECURITY_KEYS)
    expect(Object.isFrozen(SECURITY_PLUGINS)).toBe(true)
    expect(CLAUDE_SECURITY_SKILL).toBe('claude-security:claude-security')
  })

  test('the question start, its two answers, its cancel reason and the install timeout are fixed', () => {
    expect(SECURITY_INSTALL_PREFIX).toBe('Install from claude-plugins-official after you confirm the plan:')
    expect(INSTALL_OPTIONS).toEqual(['Install', 'Not now'])
    expect(Object.isFrozen(INSTALL_OPTIONS)).toBe(true)
    expect(SECURITY_INSTALL_DISMISSED_REASON).toBe('The security plugins question was dismissed or not answered.')
    expect(PLUGIN_RUN_TIMEOUT_MS).toBe(180_000)
  })

  test('only a team with a role standing for Security misses a plugin; only an installed exact key counts', () => {
    const team = [templateRole('pm'), templateRole('security')]
    const appsec = templateRole('qa', { id: 'appsec', basedOn: 'security' })
    const installed = (keys: readonly string[]): SetupScan => emptySetupScan({ installedPlugins: keys })
    expect(missingSecurityPlugins([templateRole('pm'), templateRole('tl')], emptySetupScan())).toEqual([])
    expect(missingSecurityPlugins(team, emptySetupScan())).toEqual(SECURITY_KEYS)
    expect(missingSecurityPlugins([appsec], emptySetupScan())).toEqual(SECURITY_KEYS)
    expect(missingSecurityPlugins(team, installed([SECURITY_KEY]))).toEqual([GUIDANCE_KEY])
    expect(missingSecurityPlugins(team, installed([GUIDANCE_KEY]))).toEqual([SECURITY_KEY])
    expect(missingSecurityPlugins(team, installed(SECURITY_KEYS))).toEqual([])
    // A lookalike key of another marketplace is not the plugin cadre installs (T-03-46).
    const lookalikes = ['claude-security@other-market', 'security-guidance@other-market', 'claude-security']
    expect(missingSecurityPlugins(team, installed(lookalikes))).toEqual(SECURITY_KEYS)
    // A key that only a settings file enables, the repo's own included, is not installed (#69 A1).
    expect(missingSecurityPlugins(team, emptySetupScan({ plugins: SECURITY_KEYS }))).toEqual(SECURITY_KEYS)
  })

  test('the question names each missing plugin, then gives one note for each', () => {
    const start = 'Install from claude-plugins-official after you confirm the plan:'
    const securityNote =
      'claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and ' +
      'writes CLAUDE-SECURITY-<time>/ report folders into the repo.'
    const guidanceNote = 'security-guidance adds hooks that warn about risky edits.'
    expect(securityInstallQuestion(SECURITY_KEYS)).toBe(
      `${start} claude-security and security-guidance? ${securityNote} ${guidanceNote}`,
    )
    expect(securityInstallQuestion([SECURITY_KEY])).toBe(`${start} claude-security? ${securityNote}`)
    expect(securityInstallQuestion([GUIDANCE_KEY])).toBe(`${start} security-guidance? ${guidanceNote}`)
  })

  test('the step asks nothing with no plugin missing; Install gives the keys, Not now none, in any case', async () => {
    const quiet = memIo(memWorld({}), [])
    expect(await securityInstallStep(quiet.io, [])).toEqual({ kind: 'accepted', value: [] })
    expect(quiet.asked).toEqual([])
    const cases: readonly (readonly [string, readonly string[]])[] = [
      ['Install', SECURITY_KEYS],
      [' install ', SECURITY_KEYS],
      ['Not now', []],
      ['NOT NOW', []],
    ]
    for (const [answer, value] of cases) {
      const run = memIo(memWorld({}), [answer])
      const result = await securityInstallStep(run.io, SECURITY_KEYS)
      expect([answer, result]).toEqual([answer, { kind: 'accepted', value }])
      expect(run.asked).toEqual([withContext(securityInstallQuestion(SECURITY_KEYS), SECURITY_INSTALL_CONTEXT)])
      expect(run.specs).toEqual([{ options: ['Install', 'Not now'], header: 'Security' }])
    }
  })

  test('a dismissal, or three answers that are neither, cancels the step with its reason (A1, D-45)', async () => {
    const cases: readonly (readonly [readonly string[], string])[] = [
      [[], 'The security plugins question was dismissed or not answered.'],
      [['yes', 'later', 'Install them'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await securityInstallStep(run.io, SECURITY_KEYS)).toEqual({ kind: 'cancelled', reason })
      expect(run.asked).toHaveLength(answers.length === 0 ? 1 : MAX_ASKS)
      expect(run.logged).toEqual([])
    }
    const refused = memIo(memWorld({}), ['yes', 'Install'])
    await securityInstallStep(refused.io, SECURITY_KEYS)
    const question = withContext(securityInstallQuestion(SECURITY_KEYS), SECURITY_INSTALL_CONTEXT)
    expect(refused.asked).toEqual([question, `'yes' isn't one of: "Install", "Not now".\n${question}`])
  })

  test('withSecuritySkill gives the skill once to each role standing for Security, or takes it away', () => {
    const skill = 'claude-security:claude-security'
    const appsec = templateRole('qa', { id: 'appsec', basedOn: 'security', skills: ['codex:rescue'] })
    const roles = [templateRole('pm', { skills: [skill] }), templateRole('security'), appsec]
    const before = JSON.stringify(roles)
    const given = withSecuritySkill(roles, true)
    expect(given.map(role => [role.id, role.skills])).toEqual([
      ['pm', [skill]],
      ['security', [skill]],
      ['appsec', ['codex:rescue', skill]],
    ])
    expect(withSecuritySkill(given, true)).toEqual(given)
    expect(withSecuritySkill(given, false).map(role => [role.id, role.skills])).toEqual([
      ['pm', [skill]],
      ['security', []],
      ['appsec', ['codex:rescue']],
    ])
    expect(given[0]).toEqual(roles[0])
    expect(JSON.stringify(roles)).toBe(before)
  })

  test('init asks it after the recommendations, before the duration; a dry run answered Install plans it', async () => {
    const run = memIo(gitWorld(), INSTALL_ANSWERS)
    const { io, events } = withEvents(run)
    const reply = await runInit(io, { dryRun: true })
    const recommendedAt = events.indexOf('show recommendations')
    const askedAt = events.findIndex(event => event.startsWith(`ask ${BOTH_QUESTION_START}`))
    const durationAt = events.indexOf(`ask ${DURATION_QUESTION}`)
    expect([recommendedAt >= 0, recommendedAt < askedAt, askedAt < durationAt]).toEqual([true, true, true])
    const lines = shownBlock(run, 'review')
    expect(lines.at(-1)).toBe(
      'Plugins to install after Confirm (a --dry-run installs nothing): ' +
        'claude-security@claude-plugins-official, security-guidance@claude-plugins-official',
    )
    const cardAt = lines.indexOf('Scope card: Security (security)')
    const skills = lines.slice(cardAt).find(line => line.startsWith('  skills: ')) ?? ''
    expect([cardAt >= 0, skills.includes('claude-security:claude-security')]).toEqual([true, true])
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    // A dry run holds only the init port, which has no member that can run or write (T-03-40).
    expect(Object.keys(run.io).filter(key => /^(run|write|spawn)$/.test(key))).toEqual([])
  })

  test('plain init answered Install installs both plugins from home after Confirm and says to reload', async () => {
    const host = memHost(hostWorld({ runs: INSTALLS_OK }))
    const { io, events } = withHostEvents(host)
    const reply = await runInit(memIo(gitWorld(), INSTALL_ANSWERS).io, { dryRun: false, host: io })
    const options = { cwd: '/home/u', timeoutMs: 180_000 }
    expect(host.calls.filter(call => call.argv[0] === 'claude')).toEqual([
      { argv: SECURITY_INSTALL, options },
      { argv: GUIDANCE_INSTALL, options },
    ])
    const lastInstallAt = events.indexOf(`run ${GUIDANCE_INSTALL.join(' ')}`)
    const firstWriteAt = events.findIndex(event => event.startsWith('write '))
    expect([lastInstallAt >= 0, lastInstallAt < firstWriteAt]).toEqual([true, true])
    const role = host.writes.find(write => write.path === '/repo/.cadre/security/role.json')?.text ?? ''
    expect(role).toContain('claude-security:claude-security')
    expect(reply.split('\n').slice(-2)).toEqual([BOTH_INSTALLED_LINE, NEXT_STEP_NOTE])
  })

  test('the installs run after the accepted hunks and before the first write (D-120)', async () => {
    const host = memHost(hostWorld({ runs: INSTALLS_OK }))
    const { io, events } = withHostEvents(host)
    await runInit(memIo(modeWorld(), INSTALL_ANSWERS).io, { dryRun: false, host: io })
    const hunkAt = events.indexOf(`run ${MODE_RUN.join(' ')}`)
    const installAt = events.indexOf(`run ${SECURITY_INSTALL.join(' ')}`)
    const firstWriteAt = events.findIndex(event => event.startsWith('write '))
    expect([hunkAt >= 0, hunkAt < installAt, installAt < firstWriteAt]).toEqual([true, true, true])
  })

  test('an install the host rejects or that exits non-zero is a warning with the command; apply goes on', async () => {
    const runs: readonly HostRunRule[] = [
      PYTHON_OK_RUN,
      { argv: SECURITY_INSTALL, result: { exitCode: 1, stdout: '', stderr: 'denied' } },
      { argv: GUIDANCE_INSTALL, result: null },
    ]
    const host = memHost(hostWorld({ runs }))
    const reply = await runInit(memIo(gitWorld(), INSTALL_ANSWERS).io, { dryRun: false, host: host.io })
    const lines = reply.split('\n')
    for (const key of SECURITY_KEYS) {
      expect(lines).toContain(`warning: could not install ${key}: run it yourself: claude plugin install ${key}`)
    }
    expect(reply).not.toContain('denied')
    expect(reply).not.toContain('Installed ')
    expect(host.writes.every(write => write.isWritten)).toBe(true)
    expect(host.writes.at(-1)?.path).toBe('/repo/.cadre/manifest.json')
    expect(lines).toContain(`Applied: wrote ${host.writes.length} files (3 executable).`)
    expect(lines.at(-1)).toBe(NEXT_STEP_NOTE)
  })

  test('a dismissed install question cancels init with its reason, and nothing is written or run (A1)', async () => {
    const run = memIo(gitWorld(), answersWithout('Install from claude-plugins-official'))
    const host = memHost(hostWorld({ runs: INSTALLS_OK }))
    const reply = await runInit(run.io, { dryRun: false, host: host.io })
    expect(reply).toBe(cancelledReply(SECURITY_INSTALL_DISMISSED_REASON))
    expect(run.asked.at(-1)?.startsWith(BOTH_QUESTION_START)).toBe(true)
    expect(run.logged.at(-1)).toBe('The security plugins question was dismissed or not answered.')
    expect([host.calls, host.writes]).toEqual([[], []])
  })

  test('Not now, a team without Security, or both plugins present install nothing', async () => {
    const host = memHost(hostWorld({ runs: INSTALLS_OK }))
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const reply = await runInit(run.io, { dryRun: false, host: host.io })
    expect(run.asked.filter(question => question.startsWith(BOTH_QUESTION_START))).toHaveLength(1)
    expect(host.calls).toEqual([COMMON_DIR_CALL, ...EMPTY_REPO_CHMOD_CALLS])
    const applied = `Applied: wrote ${host.writes.length} files (3 executable).`
    expect(reply.split('\n').slice(-3)).toEqual([applied, DEFAULT_FOLDERS_UNKNOWN, NEXT_STEP_NOTE])
    const role = host.writes.find(write => write.path === '/repo/.cadre/security/role.json')?.text ?? ''
    expect(role).not.toContain('claude-security')
    const dropped = queuedIo(gitWorld(), {
      ...INSTALL_ANSWERS,
      'Use these roles?': ['Adjust them', 'Use these roles'],
      'Adjust the roles': ['drop security', 'Done adjusting'],
    })
    const present = memIo(installedWorld(SECURITY_KEYS), INSTALL_ANSWERS)
    for (const quiet of [dropped, present]) {
      const quietHost = memHost(hostWorld({ runs: INSTALLS_OK }))
      await runInit(quiet.io, { dryRun: false, host: quietHost.io })
      expect(quiet.asked.some(question => question.startsWith('Install from claude-plugins-official'))).toBe(false)
      expect(quietHost.calls.filter(call => call.argv[0] !== '/bin/chmod')).toEqual([COMMON_DIR_CALL])
    }
  })
})

/** The lines of each review init showed, in order: one side-pane review block per round, from `Roles:` on. */
function reviewRounds(run: MemRun): string[][] {
  return run.shown.filter(block => block.key === 'review').map(block => [...block.lines])
}

/** The `Plugins: only ... load` card line of the role with this title and id in a review round; '' when none. */
function pluginsRule(round: readonly string[], card: string): string {
  const at = round.indexOf(`Scope card: ${card}`)
  if (at < 0) return ''

  return round.slice(at).find(line => line.includes('Plugins: only ')) ?? ''
}

describe('security plugin review fixes (#69)', () => {
  test('exact keys that only the repo settings enable still get both lines and the question (A1)', async () => {
    const enabledPlugins = { [SECURITY_KEY]: true, [GUIDANCE_KEY]: true }
    const settings = { user: {}, project: { enabledPlugins }, local: {} }
    const run = memIo(gitWorld({ settings }), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const lines = shownBlock(run, 'recommendations')
    expect(run.asked.filter(question => question.startsWith(BOTH_QUESTION_START))).toHaveLength(1)
    expect(lines).toContain(`    run: claude plugin install ${SECURITY_KEY}`)
    expect(lines).toContain(`    run: claude plugin install ${GUIDANCE_KEY}`)
  })

  test('the review card of Security enables the plugins answered Install, and only those (A4)', async () => {
    const installs = memIo(gitWorld(), INSTALL_ANSWERS)
    await runInit(installs.io, { dryRun: true })
    const installRule = pluginsRule(reviewRounds(installs).at(-1) ?? [], 'Security (security)')
    expect([installRule.includes(SECURITY_KEY), installRule.includes(GUIDANCE_KEY)]).toEqual([true, true])
    const notNow = memIo(gitWorld(), INIT_ANSWERS)
    await runInit(notNow.io, { dryRun: true })
    const notNowRule = pluginsRule(reviewRounds(notNow).at(-1) ?? [], 'Security (security)')
    expect([notNowRule === '', notNowRule.includes('security')]).toEqual([false, false])
  })

  test('Install, then Change roles keeping Security and answering Not now: no install, no skill (B6)', async () => {
    const run = queuedIo(gitWorld(), {
      ...INIT_ANSWERS,
      'Install from claude-plugins-official': ['Install', 'Not now'],
      'Review the plan': ['Change roles', 'Confirm'],
    })
    const host = memHost(hostWorld({ runs: INSTALLS_OK }))
    await runInit(run.io, { dryRun: false, host: host.io })
    const rounds = reviewRounds(run)
    const installLines = rounds.map(round => round.filter(line => line.startsWith('Plugins to install')).length)
    expect(installLines).toEqual([1, 0])
    expect(host.calls.filter(call => call.argv[0] !== '/bin/chmod')).toEqual([COMMON_DIR_CALL])
    const role = host.writes.find(write => write.path === '/repo/.cadre/security/role.json')?.text ?? ''
    expect([role === '', role.includes(CLAUDE_SECURITY_SKILL)]).toEqual([false, false])
  })

  test('Install, then Change roles to a team without Security: no install, no report line (B6)', async () => {
    const run = queuedIo(gitWorld(), {
      ...INSTALL_ANSWERS,
      'Use these roles?': ['Use these roles', 'Adjust them', 'Use these roles'],
      'Adjust the roles': ['drop security', 'Done adjusting'],
      'Review the plan': ['Change roles', 'Confirm'],
    })
    const host = memHost(hostWorld({ runs: INSTALLS_OK }))
    const reply = await runInit(run.io, { dryRun: false, host: host.io })
    const rounds = reviewRounds(run)
    const installLines = rounds.map(round => round.filter(line => line.startsWith('Plugins to install')).length)
    expect(installLines).toEqual([1, 0])
    expect(host.calls.filter(call => call.argv[0] !== '/bin/chmod')).toEqual([COMMON_DIR_CALL])
    const ignore = host.writes.find(write => write.path === '/repo/.gitignore')?.text ?? ''
    expect([ignore.includes('# >>> cadre'), ignore.includes('CLAUDE-SECURITY-*/')]).toEqual([true, false])
    expect(host.writes.some(write => write.path.startsWith('/repo/.cadre/security/'))).toBe(false)
    expect(reply).not.toContain('Installed ')
  })

  test('the question shows each plugin name cleaned, as every printed key is (B7)', () => {
    expect(securityInstallQuestion([`x${BIDI_OVERRIDE}\ny@m`])).toBe(`${SECURITY_INSTALL_PREFIX} xy? `)
  })
})

/** The argv of the Python check that runs right before the claude-security install (decision #39). */
const PYTHON_CHECK = ['python3', '--version']

/** The argv that adds Anthropic's official marketplace after a failed install (decision #39). */
const MARKETPLACE_ADD = ['claude', 'plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official']

/** How the Python check runs: from home, for at most 5 seconds (decision #39, T-03-46). */
const PYTHON_OPTIONS = { cwd: '/home/u', timeoutMs: 5_000 }

/** How a plugin install or the marketplace add runs: from home, for at most 180 seconds (decision #39, T-03-46). */
const PLUGIN_OPTIONS = { cwd: '/home/u', timeoutMs: 180_000 }

/** A plugin run that exits 1. */
const FAILED_RUN = { exitCode: 1, stdout: '', stderr: '' }

/** A plugin run that exits 0. */
const DONE_RUN = { exitCode: 0, stdout: '', stderr: '' }

/** The text of a Python problem: claude-security was not installed, and why (decision #39). */
function pythonNeeds(why: string): string {
  return (
    `claude-security was not installed: it needs Python 3.9 or newer on PATH (${why}): install it, then run: ` +
    `claude plugin install ${SECURITY_KEY}`
  )
}

/** The reply line of a plugin whose install failed; when the marketplace add failed too, the add for a missing one. */
function installFailedLine(key: string, isMarketplaceFailed: boolean): string {
  const add = isMarketplaceFailed
    ? ' (if the claude-plugins-official marketplace is missing, first run: ' +
      'claude plugin marketplace add anthropics/claude-plugins-official)'
    : ''

  return `warning: could not install ${key}: run it yourself: claude plugin install ${key}${add}`
}

describe('install checks (decision #39)', () => {
  test('claude-security installs after one python3 run; every run of the installs starts from home', async () => {
    const host = memHost(hostWorld({ runs: INSTALLS_OK }))
    await runInit(memIo(gitWorld(), INSTALL_ANSWERS).io, { dryRun: false, host: host.io })
    expect(host.calls.filter(call => call.argv[0] !== '/bin/chmod')).toEqual([
      { argv: PYTHON_CHECK, options: PYTHON_OPTIONS },
      { argv: SECURITY_INSTALL, options: PLUGIN_OPTIONS },
      { argv: GUIDANCE_INSTALL, options: PLUGIN_OPTIONS },
      COMMON_DIR_CALL,
    ])
    expect(PYTHON_TIMEOUT_MS).toBe(5_000)
  })

  test('a missing or old Python skips only claude-security, with its warning; security-guidance installs', async () => {
    const cases: readonly (readonly [HostRunRule['result'], string])[] = [
      [null, pythonNeeds('python3 was not found')],
      [{ exitCode: 0, stdout: 'Python 3.8.10\n', stderr: '' }, pythonNeeds('python3 --version says Python 3.8.10')],
    ]
    for (const [python, problem] of cases) {
      const runs: readonly HostRunRule[] = [
        { argv: PYTHON_CHECK, result: python },
        { argv: SECURITY_INSTALL, result: DONE_RUN },
        { argv: GUIDANCE_INSTALL, result: DONE_RUN },
      ]
      const host = memHost(hostWorld({ runs }))
      const reply = await runInit(memIo(gitWorld(), INSTALL_ANSWERS).io, { dryRun: false, host: host.io })
      const lines = reply.split('\n')
      expect(host.calls.filter(call => call.argv[0] === 'claude').map(call => call.argv)).toEqual([GUIDANCE_INSTALL])
      expect(lines).toContain(`warning: ${problem}`)
      expect(lines.slice(-2)).toEqual([
        'Installed security-guidance@claude-plugins-official: run /reload-plugins to load it in this session.',
        NEXT_STEP_NOTE,
      ])
    }
  })

  test('python3 is not run when only security-guidance is to be installed', async () => {
    const run = memIo(installedWorld([SECURITY_KEY]), INSTALL_ANSWERS)
    const host = memHost(hostWorld({ runs: INSTALLS_OK }))
    await runInit(run.io, { dryRun: false, host: host.io })
    const question = 'Install from claude-plugins-official after you confirm the plan: security-guidance?'
    expect(run.asked.filter(asked => asked.startsWith(question))).toHaveLength(1)
    expect(host.calls.filter(call => call.argv[0] !== '/bin/chmod')).toEqual([
      { argv: GUIDANCE_INSTALL, options: PLUGIN_OPTIONS },
      COMMON_DIR_CALL,
    ])
  })

  test('with no home folder known nothing of the installs runs, each key is a warning, and apply goes on', async () => {
    const locations = { ...DEFAULT_LOCATIONS, home: null }
    const host = memHost(hostWorld({ runs: INSTALLS_OK }))
    const reply = await runInit(memIo(gitWorld({ locations }), INSTALL_ANSWERS).io, { dryRun: false, host: host.io })
    const lines = reply.split('\n')
    expect(host.calls).toEqual(EMPTY_REPO_CHMOD_CALLS)
    for (const key of SECURITY_KEYS) {
      expect(lines).toContain(
        `warning: could not install ${key}: no home folder is known to run it from: ` +
          `run it yourself: claude plugin install ${key}`,
      )
    }
    expect(reply).not.toContain('Installed ')
    expect(host.writes.at(-1)?.path).toBe('/repo/.cadre/manifest.json')
    expect(lines).toContain(`Applied: wrote ${host.writes.length} files (3 executable).`)
  })

  test('a failed install adds the marketplace once, from home, and installs again; exit 0 then counts', async () => {
    const host = memHost(hostWorld({ runs: [PYTHON_OK_RUN] }))
    let securityTries = 0
    // The first claude-security install exits 1; the one after the marketplace add exits 0.
    const io: HostIo = {
      ...host.io,
      run: async (argv, options) => {
        const result = await host.io.run(argv, options)
        if (argv.join(' ') !== SECURITY_INSTALL.join(' ')) return result
        securityTries += 1

        return securityTries === 1 ? FAILED_RUN : result
      },
    }
    const reply = await runInit(memIo(gitWorld(), INSTALL_ANSWERS).io, { dryRun: false, host: io })
    expect(host.calls.filter(call => call.argv[0] !== '/bin/chmod')).toEqual([
      { argv: PYTHON_CHECK, options: PYTHON_OPTIONS },
      { argv: SECURITY_INSTALL, options: PLUGIN_OPTIONS },
      { argv: MARKETPLACE_ADD, options: PLUGIN_OPTIONS },
      { argv: SECURITY_INSTALL, options: PLUGIN_OPTIONS },
      { argv: GUIDANCE_INSTALL, options: PLUGIN_OPTIONS },
      COMMON_DIR_CALL,
    ])
    expect(reply).not.toContain('could not install')
    expect(reply.split('\n').slice(-2)).toEqual([BOTH_INSTALLED_LINE, NEXT_STEP_NOTE])
  })

  test('a failed marketplace add gives both commands and no retry, and is not run again for the next key', async () => {
    const runs: readonly HostRunRule[] = [
      PYTHON_OK_RUN,
      { argv: SECURITY_INSTALL, result: FAILED_RUN },
      { argv: MARKETPLACE_ADD, result: null },
      { argv: GUIDANCE_INSTALL, result: FAILED_RUN },
    ]
    const host = memHost(hostWorld({ runs }))
    const reply = await runInit(memIo(gitWorld(), INSTALL_ANSWERS).io, { dryRun: false, host: host.io })
    expect(host.calls.filter(call => call.argv[0] !== '/bin/chmod')).toEqual([
      { argv: PYTHON_CHECK, options: PYTHON_OPTIONS },
      { argv: SECURITY_INSTALL, options: PLUGIN_OPTIONS },
      { argv: MARKETPLACE_ADD, options: PLUGIN_OPTIONS },
      { argv: GUIDANCE_INSTALL, options: PLUGIN_OPTIONS },
      COMMON_DIR_CALL,
    ])
    const lines = reply.split('\n')
    for (const key of SECURITY_KEYS) expect(lines).toContain(installFailedLine(key, true))
    expect(lines.at(-1)).toBe(NEXT_STEP_NOTE)
  })

  test('after an add that worked, a second failing key only retries its own install and gets the command', async () => {
    const runs: readonly HostRunRule[] = [
      PYTHON_OK_RUN,
      { argv: SECURITY_INSTALL, result: FAILED_RUN },
      { argv: MARKETPLACE_ADD, result: DONE_RUN },
      { argv: GUIDANCE_INSTALL, result: null },
    ]
    const host = memHost(hostWorld({ runs }))
    const reply = await runInit(memIo(gitWorld(), INSTALL_ANSWERS).io, { dryRun: false, host: host.io })
    expect(host.calls.filter(call => call.argv[0] !== '/bin/chmod').map(call => call.argv)).toEqual([
      PYTHON_CHECK,
      SECURITY_INSTALL,
      MARKETPLACE_ADD,
      SECURITY_INSTALL,
      GUIDANCE_INSTALL,
      GUIDANCE_INSTALL,
      GIT_COMMON_DIR_ARGV,
    ])
    const lines = reply.split('\n')
    for (const key of SECURITY_KEYS) expect(lines).toContain(installFailedLine(key, false))
    expect(reply).not.toContain('Installed ')
  })

  test('no python3, install or marketplace run has the repo as cwd; only the hunk and git do (T-03-46)', async () => {
    const runs: readonly HostRunRule[] = [PYTHON_OK_RUN, { argv: SECURITY_INSTALL, result: FAILED_RUN }]
    const host = memHost(hostWorld({ runs }))
    await runInit(memIo(modeWorld(), INSTALL_ANSWERS).io, { dryRun: false, host: host.io })
    const installRuns = host.calls.filter(call => call.argv[0] === 'python3' || call.argv[0] === 'claude')
    expect(installRuns.map(call => call.argv)).toEqual([
      PYTHON_CHECK,
      SECURITY_INSTALL,
      MARKETPLACE_ADD,
      SECURITY_INSTALL,
      GUIDANCE_INSTALL,
    ])
    expect(installRuns.filter(call => call.options.cwd !== '/home/u')).toEqual([])
    expect(host.calls.filter(call => call.options.cwd === '/repo').map(call => call.argv)).toEqual([
      MODE_RUN,
      GIT_COMMON_DIR_ARGV,
    ])
  })

  test('the plan is made again with the installed plugins, so only an installed claude-security is on', async () => {
    const textOf = (host: MemHost, path: string): string => host.writes.find(write => write.path === path)?.text ?? ''
    const settingsPath = '/repo/.cadre/security/settings.json'
    const rolePath = '/repo/.cadre/security/role.json'
    const installed = memHost(hostWorld({ runs: INSTALLS_OK }))
    await runInit(memIo(gitWorld(), INSTALL_ANSWERS).io, { dryRun: false, host: installed.io })
    expect(textOf(installed, settingsPath)).toContain('"claude-security@claude-plugins-official": true')
    const failed: readonly HostRunRule[] = [PYTHON_OK_RUN, { argv: SECURITY_INSTALL, result: FAILED_RUN }]
    const skipped: readonly HostRunRule[] = [{ argv: PYTHON_CHECK, result: null }]
    for (const runs of [failed, skipped]) {
      const host = memHost(hostWorld({ runs }))
      await runInit(memIo(gitWorld(), INSTALL_ANSWERS).io, { dryRun: false, host: host.io })
      // The skill stays in role.json: after a manual install, /cadre regen security enables it (decision #66).
      const settings = textOf(host, settingsPath)
      expect([settings === '', settings.includes(SECURITY_KEY)]).toEqual([false, false])
      expect(textOf(host, rolePath)).toContain('claude-security:claude-security')
    }
  })

  test('the .gitignore block ends with the report line in every policy for a Security team, only then', async () => {
    const ignoreOf = (host: MemHost): string => host.writes.find(write => write.path === '/repo/.gitignore')?.text ?? ''
    const blockEnd = ['CLAUDE-SECURITY-*/', '# <<< cadre', '']
    for (const answer of ['Commit definitions (default)', 'Commit all', 'Ignore all of .cadre/']) {
      const host = memHost(hostWorld({}))
      await runInit(memIo(gitWorld(), { ...INIT_ANSWERS, 'Git policy': answer }).io, { dryRun: false, host: host.io })
      expect([answer, ignoreOf(host).split('\n').slice(-3)]).toEqual([answer, blockEnd])
    }
    const dropped = queuedIo(gitWorld(), {
      ...INIT_ANSWERS,
      'Use these roles?': ['Adjust them', 'Use these roles'],
      'Adjust the roles': ['drop security', 'Done adjusting'],
    })
    const droppedHost = memHost(hostWorld({}))
    await runInit(dropped.io, { dryRun: false, host: droppedHost.io })
    expect(ignoreOf(droppedHost)).toContain('# <<< cadre')
    expect(ignoreOf(droppedHost)).not.toContain('CLAUDE-SECURITY')
  })
})

describe('linked memory deny (G-02-1f)', () => {
  test('the review adds the read-only row under each role given a memory, and under no other', async () => {
    const run = memIo(memoriesWorld(), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const review = shownBlock(run, 'review')
    const at = review.indexOf('Instructions per role:')

    expect(review.slice(at + 1, at + 8)).toEqual([
      '  pm: none',
      privateFilesRow('pm'),
      '  tl: 1 topic: Git and commits; 1 memory',
      '    memories are linked read-only (best effort: Edit and Write are denied; a Bash write is not blocked)',
      privateFilesRow('tl'),
      '  security: 1 topic: Security rules; 0 memories',
      privateFilesRow('security'),
    ])
    expect(review.filter(line => line === LINKED_MEMORIES_ROW)).toHaveLength(1)
  })

  test('a review with no memory given, or with the content declined, has no read-only row', async () => {
    const parts = memIo(partsWorld(), PARTS_ANSWERS)
    const declined = memIo(memoriesWorld(), PARTS_DECLINED)
    await runInit(parts.io, { dryRun: true })
    await runInit(declined.io, { dryRun: true })

    expect(shownBlock(parts, 'review')).toContain('Instructions per role:')
    expect(shownBlock(parts, 'review')).not.toContain(LINKED_MEMORIES_ROW)
    expect(shownBlock(declined, 'review')).not.toContain(LINKED_MEMORIES_ROW)
  })
})

describe('safety net: init apply privates through runInit (A8)', () => {
  test('writePrivate: each role is listed from the user folder down, then written in its own folder', async () => {
    const host = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    const { io: hostIo, events } = withHostEvents(host)
    const run = memIo(partsWorld(), PARTS_ANSWERS)
    const io: InitIo = {
      ...run.io,
      list: async path => {
        events.push(`list ${path}`)

        return run.io.list(path)
      },
    }
    await runInit(io, { dryRun: false, host: hostIo })
    // <userDir>/cadre/<repo>-<hash8>: the first 8 hex digits of the sha256 of the git common dir /repo/.git.
    const folder = '/home/u/.claude/cadre/repo-6b4ca2db'
    expect(await slugFolder()).toBe(folder)
    const ids = ['pm', 'security', 'tl']
    const privatePaths = ids.flatMap(id => [
      `${folder}/${id}/instructions/CLAUDE.md`,
      `${folder}/${id}/instructions.json`,
    ])
    for (const id of ids) {
      const role = `${folder}/${id}`
      const textAt = events.indexOf(`write ${role}/instructions/CLAUDE.md`)
      const before = events.slice(0, textAt).findLastIndex(event => event.startsWith('write '))
      expect(events.slice(before + 1, textAt + 2)).toEqual([
        'list /home/u/.claude',
        'list /home/u/.claude/cadre',
        `list ${folder}`,
        `list ${role}`,
        `list ${role}/instructions`,
        `run /bin/mkdir -p -- ${role}/instructions`,
        'run /bin/chmod 700 /home/u/.claude/cadre',
        `run /bin/chmod 700 ${folder}`,
        `run /bin/chmod 700 ${role}`,
        `run /bin/chmod 700 ${role}/instructions`,
        `write ${role}/instructions/CLAUDE.md`,
        `write ${role}/instructions.json`,
      ])
    }
    const writes = events.filter(event => event.startsWith('write ')).map(event => event.slice('write '.length))
    const firstPrivate = writes.findIndex(path => path.startsWith('/home/u/'))
    expect(writes.slice(0, firstPrivate).every(path => path.startsWith('/repo/.'))).toBe(true)
    expect(writes.slice(firstPrivate - 1)).toEqual(['/repo/.gitignore', ...privatePaths, '/repo/.cadre/manifest.json'])
    expect(homeWrites(host).every(write => write.isWritten)).toBe(true)
  })

  test('writeSteps: stats first, each chmod right after its write, and the second pass stats again', async () => {
    const files = builtFilesRecord()
    const { io: hostIo, events } = improvingHost(files)
    const run = memIo(builtWorld({ files }), { ...PARTS_ANSWERS, [IMPROVER_PREFIX]: 'Keep original' })
    const io: InitIo = {
      ...run.io,
      statForWrite: async path => {
        events.push(`stat ${path}`)

        return run.io.statForWrite(path)
      },
    }
    await runInit(io, { dryRun: false, host: hostIo })
    const firstWrite = events.findIndex(event => event.startsWith('write '))
    const repoStats = events.slice(0, firstWrite).filter(event => event.startsWith('stat '))
    expect([repoStats.at(0), repoStats.at(-1)]).toEqual(['stat /repo/.cadre', 'stat /repo/.gitignore'])
    expect(repoStats).toHaveLength(53)
    expect(repoStats).toEqual([...new Set(repoStats)].sort(compareText))
    const repoWrites = events.filter(event => event.startsWith('write /repo/'))
    const firstPass = repoWrites.slice(0, repoWrites.indexOf('write /repo/.gitignore') + 1)
    expect(firstPass).toHaveLength(45)
    expect(firstPass).toEqual([...new Set(firstPass)].sort(compareText))
    for (const id of BUILT_TEAM) {
      const at = events.indexOf(`write /repo/.cadre/bin/${id}`)
      expect(events[at + 1]).toBe(`run /bin/chmod 755 /repo/.cadre/bin/${id}`)
    }
    expect(events.filter(event => event.startsWith('run /bin/chmod 755 '))).toHaveLength(BUILT_TEAM.length)
    const lastRun = events.findLastIndex(event => event.startsWith('run claude -p'))
    expect(events.slice(lastRun + 1)).toEqual([
      'stat /repo/.cadre',
      'stat /repo/.cadre/be',
      'stat /repo/.cadre/be/CLAUDE.md',
      'stat /repo/.cadre/manifest.json',
      'write /repo/.cadre/be/CLAUDE.md',
      'write /repo/.cadre/manifest.json',
    ])
  })

  test('writeImproved: the improved text stays only on Accept; the private text file gets its own run', async () => {
    const security = await memoryFolder('security')
    const beRun = { argv: BE_IMPROVER_ARGV, options: { cwd: '/repo/.cadre/be', timeoutMs: 300_000 } }
    const privateRun = {
      argv: improverArgv(privateClaudeMdPath(security)),
      options: { cwd: `${security}/instructions`, timeoutMs: 300_000 },
    }
    const seen: unknown[] = []
    for (const answer of ['Accept', 'Keep original']) {
      const files = builtFilesRecord()
      const { io, host } = improvingHost(files)
      const run = memIo(builtWorld({ files }), { ...PARTS_ANSWERS, [IMPROVER_PREFIX]: answer })
      await runInit(run.io, { dryRun: false, host: io })
      expect(improverCalls(host)).toEqual([beRun, privateRun])
      const beTexts = host.writes.filter(write => write.path === BE_CLAUDE_MD).map(write => write.text)
      const isImprovedRecorded = writtenManifestText(host).includes(await sha256Hex(BUILT_BE_IMPROVED))
      seen.push([answer, beTexts, files[BE_CLAUDE_MD], isImprovedRecorded])
    }
    expect(seen).toEqual([
      ['Accept', [BUILT_BE], BUILT_BE_IMPROVED, true],
      ['Keep original', [BUILT_BE, BUILT_BE], BUILT_BE, false],
    ])
  })

  test('installPlugins: an Install answer installs its keys from home, Python first; Not now none', async () => {
    const installRuns = (host: MemHost): HostCall[] =>
      host.calls.filter(call => call.argv[0] === 'python3' || call.argv.slice(0, 2).join(' ') === 'claude plugin')
    const fromHome = { cwd: '/home/u', timeoutMs: 180_000 }
    const files = builtFilesRecord(false)
    const installs = improvingHost(files, INSTALLS_OK)
    const answers = { ...improverOffer('Install'), 'Install from claude-plugins-official': 'Install' }
    await runInit(memIo(builtWorld({ files }), answers).io, { dryRun: false, host: installs.io })
    expect(installRuns(installs.host)).toEqual([
      { argv: ['python3', '--version'], options: { cwd: '/home/u', timeoutMs: 5_000 } },
      { argv: SECURITY_INSTALL, options: fromHome },
      { argv: GUIDANCE_INSTALL, options: fromHome },
      { argv: ['claude', 'plugin', 'install', CLAUDE_MD_PLUGIN], options: fromHome },
    ])
    const declinedFiles = builtFilesRecord(false)
    const declined = improvingHost(declinedFiles, INSTALLS_OK)
    const run = memIo(builtWorld({ files: declinedFiles }), improverOffer('Not now'))
    await runInit(run.io, { dryRun: false, host: declined.io })
    expect(firstLines(run.asked).filter(question => question.startsWith('Install'))).toHaveLength(2)
    expect(installRuns(declined.host)).toEqual([])
  })

  test('trackedParts: under the definitions policy git is asked first, once, which part files it tracks', async () => {
    const tracked: HostRunRule = { argv: LOCAL_GIT_ARGV, result: trackedRun(['CLAUDE.md']) }
    const host = memHost(hostWorld({ runs: [tracked, COMMON_DIR_RULE] }))
    const { io, events } = withHostEvents(host)
    const reply = (await runInit(memIo(localNoteWorld(), PARTS_ANSWERS).io, { dryRun: false, host: io })).split('\n')
    expect(reply).toContain('Git policy: commit definitions (.cadre/*/.runtime/ ignored)')
    expect(LOCAL_GIT_ARGV.slice(LOCAL_GIT_ARGV.indexOf('--') + 1)).toEqual(['CLAUDE.md', 'notes/local.md'])
    expect(gitCalls(host)).toEqual([{ argv: LOCAL_GIT_ARGV, options: { cwd: '/repo', timeoutMs: 10_000 } }])
    expect(events[0]).toBe(`run ${LOCAL_GIT_ARGV.join(' ')}`)
    const untracked = reply.filter(line => line.includes('not tracked by git'))
    expect(untracked).toEqual([`warning: ${untrackedPartsWarning('notes/local.md')}`])
    const be = host.writes.find(write => write.path === BE_CLAUDE_MD)?.text ?? ''
    expect([be.includes(BUILT_RULE), be.includes(LOCAL_NOTE)]).toEqual([true, false])
  })

  test('privatePlanOf: a two-role team gets a private step per role, skips an unchanged record, or warns', async () => {
    const answers = {
      ...PARTS_ANSWERS,
      'Use these roles?': ['Adjust them', 'Use these roles'],
      'Adjust the roles': ['drop security', 'Done adjusting'],
    }
    const world = partsWorld({ replies: [PARTS_TOPICS_REPLY, '{"topics":{"T1":["tl"],"T2":["tl"]},"memories":{}}'] })
    const [pm, tl] = [await memoryFolder('pm'), await memoryFolder('tl')]
    const [p1, p2] = [await securityPart(), await gitPart()]
    const first = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    await runInit(queuedIo(world, answers).io, { dryRun: false, host: first.io })
    expect(homeWrites(first)).toEqual([
      { path: privateClaudeMdPath(pm), text: privateClaudeMdText('pm', 'repo', []), isWritten: true },
      { path: instructionsRecordPath(pm), text: instructionsRecordText([], []), isWritten: true },
      { path: privateClaudeMdPath(tl), text: privateClaudeMdText('tl', 'repo', [p1, p2]), isWritten: true },
      { path: instructionsRecordPath(tl), text: instructionsRecordText([p1, p2], []), isWritten: true },
    ])
    expect(first.calls.filter(call => call.argv[1] === 'rev-parse')).toEqual([COMMON_DIR_CALL])
    // A re-init skips pm, whose record on disk is the one it would get, and writes tl, whose record changed.
    const again = memHost(hostWorld({ runs: [COMMON_DIR_RULE] }))
    const changed = [...first.writes, { path: instructionsRecordPath(tl), text: '{}\n', isWritten: true }]
    await runInit(queuedIo(withWrites(world, changed), answers).io, { dryRun: false, host: again.io })
    expect(homeWrites(again).map(write => write.path)).toEqual([privateClaudeMdPath(tl), instructionsRecordPath(tl)])
    // With no common dir from git nothing private is written, and the reply names both roles.
    const unknown = memHost(hostWorld({ runs: [{ argv: GIT_COMMON_DIR_ARGV, result: null }] }))
    const reply = await runInit(queuedIo(world, answers).io, { dryRun: false, host: unknown.io })
    expect(homeWrites(unknown)).toEqual([])
    expect(reply.split('\n')).toContain(`warning: ${privateFoldersUnknownWarning(['pm', 'tl'])}`)
  })

  test('keptBuiltEntries: a built CLAUDE.md whose records and disk hash match is kept with no op', async () => {
    const first = memHost(hostWorld({ runs: [...BUILT_TRACKED, COMMON_DIR_RULE] }))
    await runInit(memIo(builtWorld(), PARTS_ANSWERS).io, { dryRun: false, host: first.io })
    const kept = withWrites(builtWorld({ dirs: builtAfterDirs() }), first.writes)
    const again = memHost(hostWorld({ runs: [...BUILT_TRACKED, COMMON_DIR_RULE] }))
    const reply = await runInit(memIo(kept, PARTS_ANSWERS).io, { dryRun: false, host: again.io })
    const kinds = opKinds(reply)
    expect(BUILT_TEAM.map(id => kinds.get(`.cadre/${id}/CLAUDE.md`) ?? 'no op')).toEqual(BUILT_TEAM.map(() => 'no op'))
    expect(kinds.get('.cadre/be/role.json')).toBe('leave')
    expect(again.writes).toEqual([])
    expect(reply.split('\n').slice(-2)).toEqual([APPLIED_NONE_NOTE, NEXT_STEP_NOTE])
    // Edited on disk, the file no longer hashes to its manifest entry: it is planned as a conflict again.
    const edited = withWrites(kept, [{ path: BE_CLAUDE_MD, text: `${BUILT_BE}mine\n`, isWritten: true }])
    expect(opKinds(await runInit(memIo(edited, PARTS_ANSWERS).io, { dryRun: true })).get(BE_CLAUDE_MD_PATH)).toBe(
      'conflict',
    )
  })
})
