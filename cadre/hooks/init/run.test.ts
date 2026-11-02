import { describe, expect, test } from 'claude-code/testing'

import type {
  AskContext,
  AskSpec,
  CadreState,
  Choice,
  DesiredFile,
  Effort,
  Facts,
  FileOp,
  FrameworkId,
  GsdFact,
  HostIo,
  HostRun,
  HunkOp,
  InitFacts,
  InitIo,
  InitLocations,
  InstructionGroup,
  InstructionPart,
  MemoryItem,
  Plan,
  PortEntry,
  RawGsdCandidate,
  RoleSpec,
  SetupScan,
  TemplateRoleId,
} from '../../types'
import { CONFLICT_OPTIONS, conflictQuestion } from '../apply/conflict'
import {
  improverArgv,
  improverGuardFlags,
  improverLine,
  improverNoChangeNote,
  otherChangesWarning,
} from '../apply/improver'
import { installedLine, installFailureText, MARKETPLACE_ADD_ARGV } from '../apply/installs'
import {
  instructionsRecordPath,
  instructionsRecordText,
  privateClaudeMdPath,
  privateClaudeMdText,
} from '../apply/private'
import {
  APPLIED_NONE_NOTE,
  MANIFEST_SKIPPED_NOTE,
  NEXT_STEP_NOTE,
  privateFoldersUnknownWarning,
  PYTHON_TIMEOUT_MS,
} from '../apply/run'
import { sha256Hex } from '../core/hash'
import { compareText } from '../core/text'
import { attendedNote, NOT_SET_TEXT } from '../framework/gsd/hunks'
import { roleClaudeMdText } from '../generate/docs'
import { desiredFiles } from '../generate/files'
import { GIT_TRACKING_UNKNOWN_WARNING, untrackedPartsWarning } from '../generate/gittrack'
import { GIT_COMMON_DIR_ARGV } from '../git/common-dir'
import { infraPluginWorld, tableMatchWorld } from '../golden/worlds'
import { homeRootReply } from '../guards/refusals'
import { isPartsFlowRole } from '../launch/links'
import { t } from '../locales/t'
import { gitignoreLines, mergeIgnoreBlock } from '../plan/gitignore'
import { planReadPaths } from '../plan/plan'
import { DRY_RUN_NOTE, renderPlan } from '../plan/text'
import { runRegen } from '../regen/run'
import type { RegenOptions } from '../regen/run'
import { CLAUDE_MD_PLUGIN, CLAUDE_SECURITY_SKILL } from '../roles/infra'
import { proposeRoles } from '../roles/propose'
import { recommend } from '../roles/recommend'
import { parseRoleJson } from '../roles/rolejson'
import { AUTOPILOT_THRESHOLD } from '../roles/template'
import { gatherScans, scanWarnings } from '../scan/gather'
import { scanRepo } from '../scan/repo'
import { scanSetup } from '../scan/setup/setup'
import { scopeCardLines } from '../scope/card'
import { parseCadreState } from '../state/cadre-files'
import { MAX_PROPOSE_ATTEMPTS } from '../suggest/checked'
import { RECOMMEND_SYSTEM } from '../suggest/instructions'
import { TOPICS_SYSTEM } from '../suggest/topics'
import { resolvedFramework, scopesFor } from '../team'
import {
  ABSOLUTE_PATH_MARKERS,
  ancestor,
  BIDI_OVERRIDE,
  BUILT_RULE,
  builtWorld,
  DEFAULT_LOCATIONS,
  driven,
  EMPTY_FACTS,
  emptyDiskPlan,
  emptySetupScan,
  entry,
  firstLines,
  FRAMEWORKS,
  FULL_DIRS,
  FULL_FILES,
  gitWorld,
  GLOBAL_CLAUDE_MD,
  GLOBAL_SENTENCE,
  GUIDANCE_KEY,
  hostWorld,
  IMPROVER_INSTALL_PREFIX,
  INIT_ANSWERS,
  leaks,
  link,
  manifestOf,
  memHost,
  memIo,
  memoriesWorld,
  MEMORY_DIR,
  MEMORY_INDEX,
  MEMORY_SENTENCE,
  memWorld,
  NUL,
  onDisk,
  OWN_SKILLS_ENTRY_PREFIX,
  paneText,
  PARTS_ANSWERS,
  PARTS_GLOBAL,
  PARTS_RECOMMEND_REPLY,
  PARTS_TOPICS_REPLY,
  partsWorld,
  plannedFiles,
  PROVEN_FACTS,
  PROVEN_USER_GSD,
  regenPartsWorld,
  REPO_SENTENCE,
  repoScan,
  RULES_SECTION,
  scansOf,
  SECRET_FIXTURES,
  secretWorld,
  SECURITY_KEY,
  SECURITY_KEYS,
  session,
  shownBlock,
  skillRef,
  SOURCE_SCAN,
  stageStep,
  stateAt,
  stateOf,
  STATUS_PATH,
  templateRole,
  USER_DIR_LISTED,
  valueOf,
  withEvents,
  wholeDraft,
  withFramework,
  withStats,
  withWrites,
} from '../testkit'
import type { HostCall, HostRunRule, HostWrite, MemHost, MemRun, MemWorld } from '../testkit'
import { ASK_HEADERS, MAX_ASKS, NO_USABLE_ANSWER_REASON, refusalLine, withContext } from '../ui/ask'
import type { StepResult } from '../ui/ask'
import { proposalLines } from '../ui/blocks/context'
import { recommendationLines } from '../ui/blocks/recommendations'
import { scanSummaryLines, scanWarningLines } from '../ui/blocks/scan'
import { diffLines, lineDiff } from '../ui/diff'
import { PANE_PAGE_ROWS } from '../ui/pane'
import { CONFLICT_CONTEXT } from './initapply'
import { cancelledReply, IGNORE_ALL_NOTE, INIT_CANCELLED } from './replies'
import {
  consentedGsdCheck,
  HISTORY_PROGRESS,
  MODEL_PROGRESS,
  perform,
  performState,
  planStep,
  runInit,
  SCAN_PROGRESS,
} from './run'
import type { InitOptions } from './run'
import { assignStage } from './stages/assign'
import { carryStage, ENV_DISMISSED_REASON } from './stages/carry'
import {
  CLAUDE_JSON_CONTEXT,
  CLAUDE_JSON_OPTIONS,
  CLAUDE_JSON_QUESTION,
  CONSENT_DISMISSED_REASON,
  consentStage,
} from './stages/consent'
import { DURATION_DISMISSED_REASON, DURATION_QUESTION, durationStage } from './stages/duration'
import {
  FRAMEWORK_ALL_QUESTION,
  FRAMEWORK_DISMISSED_REASON,
  FRAMEWORK_QUESTION_PREFIX,
  frameworksStage,
} from './stages/frameworks'
import { HISTORY_DISMISSED_REASON, HISTORY_OPTIONS, historyQuestion, NO_HISTORY_NOTE } from './stages/history'
import { HUNK_DISMISSED_REASON } from './stages/hunks'
import {
  IMPROVER_INSTALL_CONTEXT,
  IMPROVER_INSTALL_DISMISSED_REASON,
  IMPROVER_INSTALL_QUESTION,
} from './stages/improver-install'
import {
  CONTENT_DISMISSED_REASON,
  CONTENT_OPTIONS,
  CONTENT_QUESTION,
  INSTRUCTIONS_ENTRY_QUESTION,
  instructionsStage,
  parseContentConsent,
} from './stages/instructions'
import type { Instructed } from './stages/instructions'
import {
  LAUNCH_DIR_QUESTION,
  LAUNCH_START_DISMISSED_REASON,
  LAUNCH_START_QUESTION,
  launchLine,
  launchStage,
} from './stages/launch'
import { MEMORY_DISMISSED_REASON } from './stages/memory'
import { MODEL_DISMISSED_REASON, MODEL_EFFORT_CONTEXT, MODEL_MODE_QUESTION, modelStage } from './stages/model'
import { ASSIGNMENT_DISMISSED_REASON } from './stages/own-skills'
import { GIT_POLICY_DISMISSED_REASON, GIT_POLICY_QUESTION, policyLine, policyStage } from './stages/policy'
import {
  cardLines,
  improverRunLine,
  LINKED_MEMORIES_ROW,
  MAX_REVIEW_ROUNDS,
  parseReviewItem,
  PRIVATE_FILES_HEADING,
  privateFilesRow,
  REVIEW_DISMISSED_REASON,
  REVIEW_QUESTION,
  REVIEW_ROUNDS_REASON,
  REVIEW_TYPE_HINT,
} from './stages/review'
import {
  ADJUST_QUESTION,
  DESCRIBE_QUESTION,
  MAX_ROLE_ROUNDS,
  ROLE_ROUNDS_REASON,
  ROLES_DISMISSED_REASON,
  ROLES_QUESTION,
  rolesStage,
} from './stages/roles'
import { SECURITY_INSTALL_DISMISSED_REASON, SECURITY_INSTALL_PREFIX, securityStage } from './stages/security'
import type { Answer, Effect, InitState } from './state'

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
    const summary = scanSummaryLines(gathered.repo, gathered.setup, '/repo')
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
    expect(run.shown[0]?.lines).toEqual(scanSummaryLines(gathered.repo, gathered.setup, '/repo'))
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
})

/** A model reply that describes a BE role and a docs role with no template base. */
const DESCRIBED_REPLY =
  '{"roles":[{"id":"be","title":"BE","purpose":"API","basedOn":"be"},' +
  '{"id":"docs","title":"Docs","purpose":"docs","basedOn":null}]}'

/** The person's description the describe tests type. */
const DESCRIPTION = 'we have a BE and a docs writer'

/** Facts where GSD (.planning/) and superpowers (docs/superpowers/) are both in use, so the choice is ambiguous. */
const AMBIGUOUS_FACTS: Facts = {
  ...EMPTY_FACTS,
  repoEntries: [
    { name: '.planning', kind: 'dir', isLink: false },
    { name: 'docs', kind: 'dir', isLink: false },
  ],
  docsEntries: [{ name: 'superpowers', kind: 'dir', isLink: false }],
}

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

  test("an unproven GSD: the dry run asks GSD's own check first; No never runs it, Yes once (D-243)", async () => {
    const unproven: GsdFact = {
      location: 'user',
      dir: '~/.claude/gsd-core',
      version: null,
      identity: 'unknown',
      runtimeIdentityTried: false,
    }
    const facts = { facts: { ...AMBIGUOUS_FACTS, gsd: [unproven] }, gsdUserDir: '/home/u/.claude/gsd-core' }
    const check = "ask Run GSD's own check to confirm it's installed? (runs node gsd-tools runtime-identity)"
    const framework = 'ask Which framework do the roles use? (asked because more than one framework is in use)'
    const cases: readonly (readonly [string, number])[] = [['No, skip the check', 0], ['Yes, run the check', 1]]
    for (const [answer, runs] of cases) {
      const run = memIo(gitWorld({ facts }), { ...INIT_ANSWERS, "Run GSD's own check": answer })
      const { io, events } = withEvents(run)
      await runInit(io, { dryRun: true })
      const checkAt = events.indexOf(check)

      const order = [checkAt >= 0, checkAt < events.indexOf(framework)]
      expect([...order, run.gsdIdentityCalls.length]).toEqual([true, true, runs])
    }
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

  test('Same for all roles gives all five roles the threshold 65, and no init question asks it (B3)', async () => {
    const all = driven(modelStage.enter(stateAt('model', { roles })), ['Same for all roles', 'opus + high']).state
    expect(all.draft.roles?.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'qa', 'security'])
    expect(all.draft.roles?.map(role => role.autopilot.threshold)).toEqual(roles.map(() => AUTOPILOT_THRESHOLD))
    const run = memIo(gitWorld(), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(run.asked.filter(question => /threshold/i.test(question))).toEqual([])
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

/** The entry question of the user's own skills when there is one (G-02-1b), as its first line reads. */
const OWN_SKILLS_ENTRY_ONE = `${OWN_SKILLS_ENTRY_PREFIX} (1)?`

describe('history hints', () => {
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

/** The skills row of a role's scope card in the last review block a run showed (D-133); '' with no such card. */
function cardSkills(run: MemRun, id: string): string {
  const review = shownBlock(run, 'review')
  const at = review.findIndex(line => line.startsWith('Scope card: ') && line.endsWith(`(${id})`))

  return at === -1 ? '' : (review[at + 2] ?? '')
}

describe('progress lines (D-232)', () => {
  test('the scans and the history scan each set the status line before they read', async () => {
    const run = memIo(historyGitWorld(), { ...INIT_ANSWERS, [HISTORY_PREFIX]: 'Yes, scan names and counts' })
    await runInit(run.io, { dryRun: true })
    expect(run.progress).toEqual([SCAN_PROGRESS, HISTORY_PROGRESS])
  })

  test('each attempt of a model call sets its own status line, so a retry shows it again', async () => {
    const run = memIo(ownSkillsWorld([]), OWN_ACCEPTED)
    await runInit(run.io, { dryRun: true })
    const skills = Array.from({ length: MAX_PROPOSE_ATTEMPTS }, () => MODEL_PROGRESS.skills)
    expect(run.progress).toEqual([SCAN_PROGRESS, ...skills])
  })

  test('the status texts name what init waits for, one per model call (D-232, DECIDED #22)', () => {
    expect([SCAN_PROGRESS, HISTORY_PROGRESS]).toEqual(['cadre: scanning the repo…', 'cadre: reading session history…'])
    expect(MODEL_PROGRESS).toEqual({
      'describe-roles': 'cadre: reading your structure…',
      skills: 'cadre: recommending skills…',
      topics: 'cadre: grouping instructions…',
      parts: 'cadre: recommending instruction parts…',
    })
  })
})

describe('own skills hand-out (G-02-1b)', () => {
  const CODEX_QUESTION = 'Which roles get codex skills (1)? (e.g. BE, QA, or none)'

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

/** The instruction stage run over `io` for `roles`, the setup scan `setup` and `locations`, as a step result. */
function instructedBy(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  locations: InitLocations,
): Promise<StepResult<Instructed>> {
  const gathered = { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo: repoScan(), setup }
  const state = stateAt('instructions', { roles, gathered, locations })

  return stageStep(io, instructionsStage, state, draft => {
    const { roles: given, instructions } = draft

    return given === undefined || instructions === undefined ? undefined : { roles: given, instructions }
  })
}

/** The whole-file question of the global CLAUDE.md (D-63), as the instruction stage asks it. */
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
    const heading = 'Files found by name (nothing is read before a yes):'
    const found = [heading, '  ~/.claude/CLAUDE.md', 'Memories:', '  none']
    const consent = { title: 'Instruction files', lines: found, kind: 'instructions' }
    const consentOptions = ['No, skip it', 'Yes, read them']
    expect(run.specs[consentAt]).toEqual({ options: consentOptions, header: 'Instructions', context: consent })
    const entryContext =
      '2 topics from 1 file and 0 memories; the pane shows each with the roles it is recommended for.'
    expect(run.asked[entryAt]).toBe(withContext(INSTRUCTIONS_ENTRY_QUESTION, entryContext))
    const options = ['Accept recommendations', 'Go part by part', 'Whole files']
    const entry = { title: 'Instruction parts', lines: shownBlock(run, 'instructions'), kind: 'instructions' }
    expect(run.specs[entryAt]).toEqual({ options, header: 'Instructions', context: entry })
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
    const none = await instructedBy(memIo(memWorld({}), []).io, roles, emptySetupScan(), DEFAULT_LOCATIONS)
    expect(none).toEqual({
      kind: 'accepted',
      value: { roles: [templateRole('pm')], instructions: { kind: 'none' } },
    })
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
    expect(run.specs.slice(at, at + 3).map(spec => ({ options: spec.options, header: spec.header }))).toEqual(
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
    const value = valueOf(await instructedBy(io, roles, setup, DEFAULT_LOCATIONS))
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

  test('an ignored CLAUDE_CONFIG_DIR is not shown again in the instructions block (WF-S3)', async () => {
    const locations = { ...DEFAULT_LOCATIONS, configDir: '.claude-alt' }
    const run = memIo(partsWorld({ locations }), PARTS_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const lines = run.shown.filter(block => block.key === 'instructions').flatMap(block => block.lines)

    expect(lines).not.toHaveLength(0)
    expect(lines.filter(line => line.includes(t('paths.configDirWarning')))).toEqual([])
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
    expect(run.specs.slice(at, at + 2).map(spec => ({ options: spec.options, header: spec.header }))).toEqual(chips)
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
  test('asked after the security question when a role got a built part and the plugin is missing', async () => {
    const run = memIo(builtWorld({ files: builtFilesRecord(false) }), improverOffer('Not now'))
    await runInit(run.io, { dryRun: true })
    const asked = firstLines(run.asked)
    const at = asked.indexOf(IMPROVER_INSTALL_QUESTION)
    expect(at).toBeGreaterThan(asked.findIndex(question => question.startsWith(SECURITY_INSTALL_PREFIX)))
    expect(asked.findIndex(question => question.startsWith(SECURITY_INSTALL_PREFIX))).toBeGreaterThan(0)
    expect(run.asked[at]).toBe(withContext(IMPROVER_INSTALL_QUESTION, IMPROVER_INSTALL_CONTEXT))
    const spec = run.specs[at]
    const shape = [spec?.options, spec?.header, spec?.context?.kind]
    expect(shape).toEqual([['Install', 'Not now'], 'Improver', 'improver-install'])
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
  const ENV_QUESTION =
    'Which env variables do roles carry? Names: API_KEY, JIRA_URL (values are never stored; e.g. API_KEY, or none)'

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
      'Which roles get the project CLAUDE.md (repo/CLAUDE.md)? (e.g. PM, TL, or none)',
      ENV_QUESTION,
    ])
    expect(asked[modelAt + 8]).toBe(GIT_POLICY_QUESTION)
  })

  test('the instruction consent context names the repo by its folder name, not <repo> (D-226)', async () => {
    const run = memIo(secretWorld(), PARTS_DECLINED)
    await runInit(run.io, { dryRun: true })
    const lines = run.specs[firstLines(run.asked).indexOf(CONTENT_QUESTION)]?.context?.lines ?? []

    expect([lines.includes('  repo/CLAUDE.md'), lines.includes('  <repo>/CLAUDE.md')]).toEqual([true, false])
  })

  test('no env, settings or file value of the secret world reaches a question, log or pane (T-02-34)', async () => {
    const run = memIo(secretWorld(), { ...PARTS_DECLINED, 'Which env variables': 'All of them' })
    const reply = await runInit(run.io, { dryRun: true })
    expect(run.asked.filter(question => question.startsWith('Which '))).toHaveLength(6)
    const text = [...run.asked, ...run.logged, ...paneText(run), reply].join('\n')
    expect(leaks(text, [...SECRET_FIXTURES, ...ABSOLUTE_PATH_MARKERS])).toEqual([])
  })
})

describe('hunkStep', () => {
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

describe('launchStartStep', () => {
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
  test('three unreadable git policy answers reply with the reason, which is still logged once', async () => {
    const refusal = refusalLine('whatever', 'definitions, all, ignore')
    const run = memIo(gitWorld(), { ...INIT_ANSWERS, 'Git policy': 'whatever', [refusal]: 'whatever' })
    expect(await runInit(run.io, { dryRun: true })).toBe(cancelledReply(NO_USABLE_ANSWER_REASON))
    expect(run.logged.filter(text => text === NO_USABLE_ANSWER_REASON)).toHaveLength(1)
  })
})

describe('refusal re-ask (G-02-6b)', () => {
  /** The refusal of the framework question when GSD and superpowers are offered: the user's own example (D-136). */
  const BOTH_REFUSAL = "'both' isn't one of: GSD, superpowers, none - a role runs one framework."

  test('each question lists the answers it takes in its refusal', async () => {
    const proposal = proposeRoles(repoScan())
    const { roles } = proposal
    const choice: Choice = { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }
    const roleList = '"None", "All roles", or role ids from: pm, tl, security'
    const launch =
      '"Git root of this repo", "The folder I run it from", "Another folder in this repo" ' +
      '(or type git root, in here or other)'
    const envNames = { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: ['API_KEY'] }
    const gathered = { ...wholeDraft().gathered, setup: emptySetupScan({ carry: envNames }) }
    const frameworksDraft = { choice, roles, gathered, locations: DEFAULT_LOCATIONS }
    const assignAt = (setup: Partial<SetupScan>): InitState => {
      const scans = { ...wholeDraft().gathered, setup: emptySetupScan(setup) }

      return assignStage.enter(stateAt('assign', { roles, gathered: scans, hints: new Map() }))
    }
    const recommendedNone: Answer = { kind: 'model', result: { id: 'skills', result: new Map() } }
    const globalFile = { ...wholeDraft().gathered, setup: emptySetupScan({ hasGlobalClaudeMd: true }) }
    const memoryDraft = wholeDraft({ roles, gathered: globalFile, instructions: { kind: 'none' } })
    const memoryAgain = { returnTo: 'review', returnAfter: 'instructions' } satisfies Partial<InitState>
    const stages: readonly (readonly [string, () => readonly string[], string])[] = [
      [
        'roles',
        () => driven(rolesStage.enter(stateAt('roles', { proposal, installed: FRAMEWORKS })), ['zzz']).asked,
        '"Use these roles", "Adjust them", "Describe my own structure"',
      ],
      [
        'consent',
        () => driven(consentStage.enter(stateAt('consent')), ['zzz']).asked,
        '"No, skip it", "Yes, read names only"',
      ],
      [
        'framework mode',
        () => driven(frameworksStage.enter(stateAt('frameworks', frameworksDraft)), ['zzz']).asked,
        '"Same for all roles", "Per role"',
      ],
      [
        'security',
        () => driven(securityStage.enter(stateAt('security', wholeDraft())), ['zzz']).asked,
        '"Install", "Not now"',
      ],
      [
        'duration',
        () => driven(durationStage.enter(stateAt('duration', { roles })), ['zzz']).asked,
        'a duration such as 4h, 90m or 1h30m, at most 168h',
      ],
      [
        'model mode',
        () => driven(modelStage.enter(stateAt('model', { roles })), ['zzz']).asked,
        '"Same for all roles", "Per role"',
      ],
      ['mcp', () => driven(assignAt({ mcp: [session('sentry')] }), ['zzz']).asked, roleList],
      [
        'memory',
        () => driven(instructionsStage.enter(stateAt('instructions', memoryDraft, memoryAgain)), ['zzz']).asked,
        roleList,
      ],
      ['skills', () => driven(assignAt({ skills: [skillRef('x:y', 'x')] }), ['zzz']).asked, roleList],
      [
        'own skills',
        () => driven(assignAt({ skills: [skillRef('mine')] }), ['zzz'], [recommendedNone]).asked,
        '"Accept recommendations", "Go one by one", "Whole group"',
      ],
      [
        'env',
        () => driven(carryStage.enter(stateAt('carry', wholeDraft({ roles, gathered }))), ['zzz']).asked,
        '"None", "All of them", or names from the list, typed exactly',
      ],
      ['launch', () => driven(launchStage.enter(stateAt('launch', { roles })), ['zzz']).asked, launch],
      ['git policy', () => driven(policyStage.enter(stateAt('policy')), ['zzz']).asked, 'definitions, all, ignore'],
    ]
    for (const [name, asked, accepts] of stages) {
      expect([name, asked()[1]?.split('\n')[0]]).toEqual([name, `'zzz' isn't one of: ${accepts}.`])
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

  test('the review question carries the plan summary, git policy and launcher start, then its hint', async () => {
    const { plain } = await questionRuns()
    const files = await plannedFiles(gitWorld(), await defaultRoles(gitWorld()))
    const context =
      `Summary: ${files.length + 2} create, 0 change, 0 leave, 0 conflict, 0 hunks; ` +
      'Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root'
    expect(askedOf(plain, REVIEW_QUESTION).split('\n')).toEqual([REVIEW_QUESTION, context, REVIEW_TYPE_HINT])
  })
})

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

/** The default team of the git fixture world has a Security role, so its ignore block holds the reports line. */
const GIT_TEAM_HAS_SECURITY = true

/** The kind of the op of each path in the file plan of a reply. */
function opKinds(reply: string): Map<string, string> {
  const kinds = new Map<string, string>()
  for (const line of reply.split('\n')) {
    const [, kind, path] = /^ {2}(create|change|leave|conflict) +(\S+)/.exec(line) ?? []
    if (kind !== undefined && path !== undefined) kinds.set(path, kind)
  }

  return kinds
}

describe('init plan', () => {
  /** PM on the repo default, Team Lead on superpowers by its own framework, BE on the repo default. */
  const roles = [templateRole('pm'), withFramework(templateRole('tl'), 'superpowers'), templateRole('be')]

  test('init --dry-run replies with the file plan of desiredFiles, the policy, start and note', async () => {
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

/**
 * The spec of the review question's first page on a pane surface (D-233, ASKED #19): Next page, Confirm and Change
 * something… with the Review chip, and the first PANE_PAGE_ROWS - 1 review lines as its context, titled with its place.
 */
function firstPageSpec(lines: readonly string[]): AskSpec {
  const size = PANE_PAGE_ROWS - 1
  const count = Math.ceil(lines.length / size)
  const context: AskContext = { title: `Review (page 1 of ${count})`, lines: lines.slice(0, size), kind: 'review' }

  return { options: ['Next page', 'Confirm', 'Change something…'], header: 'Review', context }
}

/** A user-level GSD install found but not proven, as in the D-243 spec of runInit (WF-S2). */
const UNPROVEN: GsdFact = {
  location: 'user',
  dir: '~/.claude/gsd-core',
  version: null,
  identity: 'unknown',
  runtimeIdentityTried: false,
}

describe('consentedGsdCheck (D-243, WF-S6)', () => {
  /** What /cadre detect collected: a user-level GSD found but not proven. */
  const FACTS: InitFacts = { facts: { ...EMPTY_FACTS, gsd: [UNPROVEN] }, gsdUserDir: '/home/u/.claude/gsd-core' }
  /** The user-level candidate as GSD's own check reads it: its runtime identity proves it. */
  const PROBED: RawGsdCandidate = {
    location: 'user',
    dir: '/home/u/.claude/gsd-core',
    isPresent: true,
    versionText: null,
    identityText: null,
    manifest: null,
    runtimeStdout: '{"packageName":"@opengsd/gsd-core","version":"1.16.0"}',
    runtimeTried: true,
  }
  /** The start of the GSD check question, as the answers name it. */
  const CHECK = "Run GSD's own check"

  /** A port of a session whose dialog state is `interactive` and whose check reads PROBED, answering `answers`. */
  function checkRun(interactive: boolean | null, answers: Readonly<Record<string, string>>): MemRun {
    return memIo(memWorld({ interactive, probedGsd: PROBED }), answers)
  }

  test('No gives the facts back and runs no check', async () => {
    const run = checkRun(true, { [CHECK]: 'No, skip the check' })
    const facts = await consentedGsdCheck(run.io, FACTS, DEFAULT_LOCATIONS)

    expect([facts, run.gsdIdentityCalls, run.asked.length]).toEqual([FACTS, [], 1])
  })

  test('a dismissal gives the facts back and runs no check', async () => {
    const run = checkRun(true, {})
    const facts = await consentedGsdCheck(run.io, FACTS, DEFAULT_LOCATIONS)

    expect([facts, run.gsdIdentityCalls, run.asked.length]).toEqual([FACTS, [], 1])
  })

  test('an answer it cannot read gives the facts back and runs no check', async () => {
    const run = checkRun(true, { [CHECK]: 'Maybe' })
    const facts = await consentedGsdCheck(run.io, FACTS, DEFAULT_LOCATIONS)

    expect([facts, run.gsdIdentityCalls, run.asked.length]).toEqual([FACTS, [], 1])
  })

  test('with no one to ask (isInteractive null) it asks nothing and runs no check, even with a Yes ready', async () => {
    const run = checkRun(null, { [CHECK]: 'Yes, run the check' })
    const facts = await consentedGsdCheck(run.io, FACTS, DEFAULT_LOCATIONS)

    expect([facts, run.gsdIdentityCalls, run.asked.length]).toEqual([FACTS, [], 0])
  })

  test('Yes runs the check once with the locations and merges the user-level fact it proves', async () => {
    const run = checkRun(true, { [CHECK]: 'Yes, run the check' })
    const facts = await consentedGsdCheck(run.io, FACTS, DEFAULT_LOCATIONS)
    const identities = facts.facts.gsd.filter(fact => fact.location === 'user').map(fact => fact.identity)

    expect([identities, run.gsdIdentityCalls, run.asked.length]).toEqual([['proven'], [DEFAULT_LOCATIONS], 1])
  })
})

describe('reviewStep', () => {
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
    const frameworks = team.map(role => resolvedFramework(role, 'none'))
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
      ...recommendationLines(recommend({ roles: team, frameworks, scan: gathered.repo, setup: gathered.setup }), team),
    ]
    expect(team).toHaveLength(6)
    expect(expected).toContain('warning: the root was given through a link')
    const reviews = run.shown.filter(block => block.key === 'review')
    expect(reviews).toEqual([{ key: 'review', title: 'Review', lines: expected }])
    expect(events[events.indexOf(`ask ${REVIEW_QUESTION}`) - 1]).toBe('show review')
    const reviewAt = firstLines(run.asked).indexOf(REVIEW_QUESTION)
    expect(run.specs[reviewAt]).toEqual(firstPageSpec(expected))
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

  test(
    'a Change roles round never asks the GSD check again, after No or after a Yes that proved nothing (WF-S2, D-243)',
    async () => {
      const facts = { facts: { ...EMPTY_FACTS, gsd: [UNPROVEN] }, gsdUserDir: '/home/u/.claude/gsd-core' }
      const cases: readonly (readonly [string, number])[] = [['No, skip the check', 0], ['Yes, run the check', 1]]
      for (const [answer, runs] of cases) {
        const run = queuedIo(gitWorld({ facts }), {
          ...INIT_ANSWERS,
          "Run GSD's own check": answer,
          'Review the plan': ['Change roles', 'Confirm'],
        })
        await runInit(run.io, { dryRun: true })
        const asks = run.asked.filter(question => question.startsWith("Run GSD's own check")).length

        expect([asks, run.gsdIdentityCalls.length]).toEqual([1, runs])
      }
    },
  )

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
      `'maybe' isn't one of: "Next page", "Confirm", "Change something…", roles, git policy, launcher start, ` +
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
  test('reviewStep asks it with the four buttons, once, right after it shows the review block', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const asked = run.asked.filter(question => question.startsWith('Review the plan'))
    expect(firstLines(asked)).toEqual([REVIEW_QUESTION])
    expect(asked[0]?.endsWith(`\n${REVIEW_TYPE_HINT}`)).toBe(true)
    expect(events[events.indexOf(`ask ${REVIEW_QUESTION}`) - 1]).toBe('show review')
    const reviewAt = firstLines(run.asked).indexOf(REVIEW_QUESTION)
    expect(run.specs[reviewAt]).toEqual(firstPageSpec(shownBlock(run, 'review')))
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
    expect(await runInit(home.io, { dryRun: false, host: refused.io })).toBe(homeRootReply('init'))
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
    expect(run.specs[reviewAt + 1]?.options).toEqual(CONFLICT_OPTIONS)
    expect(run.specs[reviewAt + 1]?.header).toBe('Conflict')
  })

  test('the conflict question carries the diff of that file from the version on disk to the new (D-236)', async () => {
    const { world, role } = await editedRoleWorld()
    const run = memIo(world, { ...INIT_ANSWERS, [ROLE_QUESTION]: 'Keep mine' })
    await runInit(run.io, { dryRun: false, host: memHost(hostWorld({})).io })
    const diff = lineDiff(EDITED_ROLE, role)
    const counts = `Take new: ${diff.added} ${diff.added === 1 ? 'line' : 'lines'} added, ${diff.removed} removed`
    const at = run.asked.indexOf(ROLE_ASKED)
    expect(run.specs[at]?.context).toEqual({
      title: 'Conflict: .cadre/be/ROLE.md',
      lines: [counts, ...diffLines(diff)],
      kind: 'conflict-diff',
    })
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

/** The Git section after an edit. */
const GIT_EDITED = '## Git\nUse signed commits, always.\n'

/** The start of a regen question about a part or a memory for BE (G-02-1f Regen, D-142). */
const REGEN_PART_PREFIX = 'Should be get'

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

describe('init plan', () => {
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
})

describe('question contexts (D-211, D-236)', () => {
  test("the MCP server question's context lists the tools the session gave, never a description (D-211)", async () => {
    const tools = [{ name: 'mcp__sentry__issues', description: 'SENTRY-DESCRIPTION', mcp: true }]
    const run = memIo(gitWorld({ tools }), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const at = run.asked.findIndex(question => question.startsWith('Which roles get the sentry MCP server?'))
    expect(run.specs[at]?.context).toEqual({
      title: 'MCP: sentry',
      lines: ['Source: session', 'Tools: 1 (issues)', 'Recommended: none'],
      kind: 'mcp-server',
    })
  })
})

describe('performState (WD-S1)', () => {
  const OPTIONS: InitOptions = { dryRun: true }
  const EFFECT_SPEC: AskSpec = { options: ['Effect A', 'Effect B'], header: 'Effect' }
  const OPEN_SPEC: AskSpec = { options: ['Open A', 'Open B'], header: 'Open' }
  const EFFECT_ASK = { kind: 'ask', question: 'The effect copy?', spec: EFFECT_SPEC } satisfies Effect

  test("an ask asks the state's open question with its spec, never the effect's copy (D-204, D-230)", async () => {
    const openQuestion = { question: 'The open question?', spec: OPEN_SPEC }
    const run = memIo(memWorld({}), ['Open A'])
    const answer = await performState(run.io, OPTIONS, stateAt('roles', {}, { effect: EFFECT_ASK, openQuestion }))
    expect(answer).toEqual({ kind: 'answer', text: 'Open A' })
    expect([run.asked, run.specs]).toEqual([['The open question?'], [OPEN_SPEC]])
  })

  test('an ask with no open question, or the end, gives null and asks nothing (fail closed)', async () => {
    const run = memIo(memWorld({}), ['Effect A'])
    expect(await performState(run.io, OPTIONS, stateAt('roles', {}, { effect: EFFECT_ASK }))).toBeNull()
    expect(await performState(run.io, OPTIONS, stateAt('roles'))).toBeNull()
    expect(run.asked).toEqual([])
  })

  test('a host operation or a model call gives what perform gives', async () => {
    const listing = { kind: 'io', call: { id: 'list-sessions', dir: '/repo/sessions' } } satisfies Effect
    const scan = { parts: [], files: [], memories: [], warnings: [] }
    const grouping = { kind: 'model', call: { id: 'topics', scan } } satisfies Effect
    for (const effect of [listing, grouping]) {
      const given = await performState(memIo(memWorld({}), []).io, OPTIONS, stateAt('history', {}, { effect }))
      expect(given).toEqual(await perform(memIo(memWorld({}), []).io, OPTIONS, effect))
    }
  })
})

describe('one session tool list read per scan (#163)', () => {
  test('the scans read the session tool list once and give that read as their tools', async () => {
    const reads: unknown[] = []
    const tools = async (): Promise<unknown> => {
      const read = [{ name: `mcp__read${reads.length + 1}__list`, description: 'Lists', mcp: true }]
      reads.push(read)

      return read
    }
    const locations = DEFAULT_LOCATIONS
    const scan = { kind: 'io', call: { id: 'scan', locations, readUserMcp: false } } satisfies Effect
    const answer = await perform({ ...memIo(memWorld({}), []).io, tools }, { dryRun: true }, scan)
    const given = answer.kind === 'io' && answer.result.id === 'scan' ? answer.result.tools : null
    expect([reads.length, given]).toEqual([1, reads[0]])
  })
})

describe('infra plugins by name (D-252)', () => {
  test('a dry run never asks about or prompts with the skills of autopilot under another marketplace', async () => {
    const run = memIo(infraPluginWorld(), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    expect(run.asked.filter(question => question.includes('away'))).toEqual([])
    expect(JSON.stringify(run.specs)).not.toContain('away')
    expect(run.prompts.filter(prompt => prompt.includes('away'))).toEqual([])
    expect(shownBlock(run, 'review')).not.toEqual([])
    expect(shownBlock(run, 'review').filter(line => line.includes('away'))).toEqual([])
  })
})

/** The MCP row of a role's scope card in the last review block a run showed (D-133); '' with no such card. */
function cardMcp(run: MemRun, id: string): string {
  const review = shownBlock(run, 'review')
  const at = review.findIndex(line => line.startsWith('Scope card: ') && line.endsWith(`(${id})`))

  return at === -1 ? '' : (review[at + 3] ?? '')
}

describe('table seeds (D-249, D-280)', () => {
  const GITHUB_QUESTION = 'Which roles get the github MCP server? (e.g. BE, QA, or none)'

  test('a dry run asks github with the table seed as its recommendation; only the answer gives it', async () => {
    const declined = memIo(tableMatchWorld(), OWN_ACCEPTED)
    await runInit(declined.io, { dryRun: true })
    const at = firstLines(declined.asked).indexOf(GITHUB_QUESTION)
    expect(declined.specs[at]?.context?.lines.at(-1)).toBe('Recommended: tl')
    expect(cardMcp(declined, 'tl')).toBe('  MCP servers: none')
    const given = memIo(tableMatchWorld(), { ...OWN_ACCEPTED, [GITHUB_QUESTION]: 'tl' })
    await runInit(given.io, { dryRun: true })
    expect(cardMcp(given, 'tl')).toBe('  MCP servers: github')
  })

  test('security-review is handed out with its table seed when the model gives none; Accept gives it', async () => {
    const run = memIo(tableMatchWorld(), OWN_ACCEPTED)
    await runInit(run.io, { dryRun: true })
    expect(firstLines(run.asked)).toContain(ownEntry(1))
    expect(shownBlock(run, 'skills')).toEqual([
      OWN_SKILLS_HEADING,
      '  security-review: Review the changes for security.',
      '    recommended: security',
    ])
    expect(cardSkills(run, 'security')).toContain('security-review')
    expect(cardSkills(run, 'be')).not.toContain('security-review')
  })
})
