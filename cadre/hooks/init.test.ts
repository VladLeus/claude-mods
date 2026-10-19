import { describe, expect, test } from 'claude-code/testing'

import type {
  Choice,
  Detection,
  DetectStatus,
  Facts,
  FrameworkId,
  GsdFact,
  HookScript,
  InitFacts,
  InitIo,
  LaunchStart,
  PortStat,
  RepoScan,
  RoleChange,
  RoleSpec,
  UnsupportedId,
} from '../types'
import { detectAll } from './adapters'
import { MODEL_EFFORT_OPTIONS, modelEffortRefusal } from './assign'
import { FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY, MAX_READ_BYTES } from './facts'
import {
  ADJUST_DISMISSED_REASON,
  ADJUST_OPTIONS,
  ADJUST_QUESTION,
  ADJUST_ROUNDS_NOTE,
  adjustLoop,
  askChoice,
  ASSIGNMENT_DISMISSED_REASON,
  assignmentStep,
  carryStep,
  CLAUDE_JSON_OPTIONS,
  CLAUDE_JSON_QUESTION,
  commandRefusal,
  CONSENT_DISMISSED_REASON,
  consentStep,
  DESCRIBE_CANCELLED_REASON,
  DESCRIBE_OPTIONS,
  DESCRIBE_QUESTION,
  describeStep,
  DRY_RUN_NOTE,
  DURATION_DISMISSED_REASON,
  DURATION_OPTIONS,
  DURATION_QUESTION,
  durationStep,
  ENV_DISMISSED_REASON,
  FRAMEWORK_ALL_QUESTION,
  FRAMEWORK_DISMISSED_REASON,
  FRAMEWORK_LABELS,
  FRAMEWORK_QUESTION_PREFIX,
  frameworkReason,
  frameworkRoleQuestion,
  frameworkStep,
  gatherScans,
  GIT_POLICY_DISMISSED_REASON,
  GIT_POLICY_OPTIONS,
  GIT_POLICY_QUESTION,
  gitPolicyStep,
  GUARD_SOURCE_WARNING,
  guardSourceWarnings,
  HUNK_DISMISSED_REASON,
  hunkStep,
  IGNORE_ALL_NOTE,
  INIT_CANCELLED,
  INIT_FILE_SYSTEM_ROOT_REPLY,
  INIT_HOME_ROOT_REPLY,
  INIT_ROOT_UNKNOWN_REPLY,
  initGuard,
  installedFrameworks,
  LAUNCH_DIR_CANCELLED_REASON,
  LAUNCH_DIR_OPTIONS,
  LAUNCH_DIR_QUESTION,
  LAUNCH_DIR_ROUNDS_REASON,
  LAUNCH_START_DISMISSED_REASON,
  LAUNCH_START_OPTIONS,
  LAUNCH_START_QUESTION,
  launchLine,
  launchStartStep,
  MAX_ADJUST_ROUNDS,
  MAX_ASKS,
  MAX_PROPOSE_ATTEMPTS,
  MAX_ROLE_ROUNDS,
  MEMORY_DISMISSED_REASON,
  memoryStep,
  MODEL_DISMISSED_REASON,
  MODEL_MODE_QUESTION,
  modelStep,
  NOT_INTERACTIVE_REPLY,
  parseGitPolicy,
  pluginVersionOf,
  policyLine,
  portProbeOf,
  portTextOf,
  proposalLines,
  provenUserDir,
  resolvedFramework,
  ROLE_ROUNDS_REASON,
  ROLES_DISMISSED_REASON,
  ROLES_OPTIONS,
  ROLES_QUESTION,
  rolesStep,
  runInit,
  scanSummaryLines,
  scanWarningLines,
  scanWarnings,
} from './init'
import type { AdjustOutcome, Gathered, StepResult } from './init'
import { attendedNote, NOT_SET_TEXT, recommend, recommendationLines, UNKNOWN_CONFIG_TEXT } from './recommend'
import { choiceLine } from './render'
import { AUTOPILOT_THRESHOLD, PROPOSE_SYSTEM, proposeRoles, rolesFromProposal } from './roles'
import { autopilotReply, scanRepo } from './scan'
import { scanSetup } from './setup'
import {
  BIDI_OVERRIDE,
  DEFAULT_LOCATIONS,
  EMPTY_FACTS,
  emptySetupScan,
  entry,
  FRAMEWORKS,
  INIT_ANSWERS,
  leaks,
  memIo,
  memWorld,
  SECRET_FIXTURES,
  session,
  skillRef,
} from './testkit'
import type { MemRun, MemWorld } from './testkit'

/** The status file autopilot keeps for session s1 of the fixture user. */
const STATUS_PATH = '/home/u/.claude/autopilot/s1.json'

/** A session in the git repo /repo: its `.git` folder is there, and `over` changes the fields it names. */
function gitWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ dirs: { '/repo/.git': [] }, ...over })
}

/** The port of a run that also records every path it was asked to stat, in order. */
function withStats(run: MemRun): { readonly io: InitIo; readonly stats: string[] } {
  const stats: string[] = []
  const io: InitIo = {
    ...run.io,
    stat: async path => {
      stats.push(path)

      return run.io.stat(path)
    },
  }

  return { io, stats }
}

/** The port of a run that also records its questions and log entries in one list, in the order they happened. */
function withEvents(run: MemRun): { readonly io: InitIo; readonly events: string[] } {
  const events: string[] = []
  const io: InitIo = {
    ...run.io,
    ask: async (question, spec) => {
      events.push(`ask ${question}`)

      return run.io.ask(question, spec)
    },
    log: text => {
      events.push(`log ${text}`)
      run.io.log(text)
    },
  }

  return { io, events }
}

/** A repo scan that found nothing; `over` changes the fields it names. */
function repoScan(over: Partial<RepoScan> = {}): RepoScan {
  return {
    findings: [],
    languages: [],
    codeDirs: [],
    hasSource: false,
    isTruncated: false,
    cadre: { dir: 'absent', manifest: null, manifestState: 'absent', state: null, stateState: 'absent' },
    warnings: [],
    ...over,
  }
}

describe('initGuard', () => {
  test('a session nobody can be asked in is refused first, before any stat or read', async () => {
    for (const interactive of [false, null]) {
      const run = memIo(gitWorld({ interactive }), {})
      const { io, stats } = withStats(run)
      expect(await initGuard(io, 'init')).toEqual({ kind: 'refuse', text: NOT_INTERACTIVE_REPLY })
      expect(run.reads).toEqual([])
      expect(stats).toEqual([])
    }
  })

  test('an unreadable session root is refused next, before any stat or read', async () => {
    const run = memIo(gitWorld({ locations: null }), {})
    const { io, stats } = withStats(run)
    expect(await initGuard(io, 'init')).toEqual({ kind: 'refuse', text: INIT_ROOT_UNKNOWN_REPLY })
    expect(run.reads).toEqual([])
    expect(stats).toEqual([])
  })

  test('the home folder and the file system root are refused in init wording, before any stat or read', async () => {
    const cases = [
      { root: '/home/u', text: INIT_HOME_ROOT_REPLY },
      { root: '/', text: INIT_FILE_SYSTEM_ROOT_REPLY },
    ]
    for (const { root, text } of cases) {
      const run = memIo(gitWorld({ locations: { ...DEFAULT_LOCATIONS, root, givenRoot: root } }), {})
      const { io, stats } = withStats(run)
      expect(await initGuard(io, 'init')).toEqual({ kind: 'refuse', text })
      expect(run.reads).toEqual([])
      expect(stats).toEqual([])
    }
  })

  test('a root with no git repo above it is refused with the git init wording, before any read', async () => {
    const run = memIo(memWorld({}), {})
    const { io, stats } = withStats(run)
    expect(await initGuard(io, 'init')).toEqual({
      kind: 'refuse',
      text: 'cadre init needs a git repo: run git init first',
    })
    expect(stats).toEqual(['/repo/.git', '/.git'])
    expect(run.reads).toEqual([])
  })

  test('a root below the git top level is refused with the top level named, before any read', async () => {
    const locations = { ...DEFAULT_LOCATIONS, root: '/repo/app', givenRoot: '/repo/app' }
    const run = memIo(gitWorld({ locations }), {})
    const { io, stats } = withStats(run)
    expect(await initGuard(io, 'init')).toEqual({ kind: 'refuse', text: 'run /cadre init from the repo root: /repo' })
    expect(stats).toEqual(['/repo/app/.git', '/repo/.git'])
    expect(run.reads).toEqual([])
  })

  test('an active autopilot run in this session is refused after the git check', async () => {
    const files = { [STATUS_PATH]: '{"isOn":true,"phase":"running","beat":1000000}' }
    const run = memIo(gitWorld({ files }), {})
    expect(await initGuard(run.io, 'init')).toEqual({ kind: 'refuse', text: autopilotReply('active', 'init') })
    expect(run.reads).toEqual([STATUS_PATH])
  })

  test('a status file over the read cap or unreadable refuses with the unknown text', async () => {
    const unknown = { kind: 'refuse', text: autopilotReply('unknown', 'init') }
    const tooLarge = memIo(gitWorld({ files: { [STATUS_PATH]: 'x'.repeat(MAX_READ_BYTES + 1) } }), {})
    expect(await initGuard(tooLarge.io, 'init')).toEqual(unknown)
    const unreadable = memIo(gitWorld({ unknownPaths: [STATUS_PATH] }), {})
    expect(await initGuard(unreadable.io, 'init')).toEqual(unknown)
  })

  test('no HOME as given, no usable session id or no clock refuses as unknown, reading nothing', async () => {
    const unknown = { kind: 'refuse', text: autopilotReply('unknown', 'init') }
    const worlds = [
      gitWorld({ locations: { ...DEFAULT_LOCATIONS, givenHome: null } }),
      gitWorld({ sessionId: null }),
      gitWorld({ now: null }),
      gitWorld({ sessionId: '../s1' }),
    ]
    for (const world of worlds) {
      const run = memIo(world, {})
      expect(await initGuard(run.io, 'init')).toEqual(unknown)
      expect(run.reads).toEqual([])
    }
  })

  test('with the repo top level and no live autopilot run the guard goes on with the locations', async () => {
    const stale = '{"isOn":true,"phase":"running","beat":1}'
    for (const files of [{}, { [STATUS_PATH]: '{"isOn":false}' }, { [STATUS_PATH]: stale }]) {
      const run = memIo(gitWorld({ files }), {})
      expect(await initGuard(run.io, 'init')).toEqual({ kind: 'ok', locations: DEFAULT_LOCATIONS })
    }
  })

  test('regen skips the interactive check (D-99): in claude -p it goes on and never asks the host', async () => {
    const run = memIo(gitWorld({ interactive: false }), {})
    const io: InitIo = {
      ...run.io,
      isInteractive: async () => {
        throw new Error('the regen guard must not ask whether anyone is there')
      },
    }
    expect(await initGuard(io, 'regen')).toEqual({ kind: 'ok', locations: DEFAULT_LOCATIONS })
  })

  test('regen is refused in the regen wording at the home folder and for every later check', async () => {
    const home = memIo(gitWorld({ locations: { ...DEFAULT_LOCATIONS, root: '/home/u', givenRoot: '/home/u' } }), {})
    expect(await initGuard(home.io, 'regen')).toEqual({
      kind: 'refuse',
      text: commandRefusal(HOME_ROOT_REPLY, 'regen'),
    })
    const noRoot = memIo(gitWorld({ locations: null }), {})
    expect(await initGuard(noRoot.io, 'regen')).toEqual({
      kind: 'refuse',
      text: 'cadre regen could not read the session root, so it stopped before reading anything.',
    })
    const noGit = memIo(memWorld({}), {})
    expect(await initGuard(noGit.io, 'regen')).toEqual({
      kind: 'refuse',
      text: 'cadre regen needs a git repo: run git init first',
    })
    const active = memIo(gitWorld({ files: { [STATUS_PATH]: '{"isOn":true,"beat":1000000}' } }), {})
    expect(await initGuard(active.io, 'regen')).toEqual({ kind: 'refuse', text: autopilotReply('active', 'regen') })
  })
})

describe('gatherScans', () => {
  /** A repo with a TypeScript test file and a session that has the sentry MCP server. */
  const scanned = gitWorld({
    dirs: { '/repo/.git': [], '/repo': [entry('src', 'dir')], '/repo/src': [entry('a.test.ts')] },
    tools: [{ name: 'mcp__sentry__issues', description: 'Sentry issues', mcp: true }],
    files: { '/home/u/.claude.json': '{"mcpServers":{"linear":{"command":"x"}}}' },
  })

  test('gatherScans gives the facts and the repo and setup scans of the session, as the scans give them', async () => {
    for (const isAllowed of [false, true]) {
      const gathered = await gatherScans(memIo(scanned, {}).io, DEFAULT_LOCATIONS, isAllowed)
      expect(gathered.facts).toEqual(scanned.facts)
      expect(gathered.repo).toEqual(await scanRepo(memIo(scanned, {}).io, '/repo'))
      const ctx = { root: '/repo', givenRoot: '/repo', home: '/home/u', configDir: null }
      expect(gathered.setup).toEqual(await scanSetup(memIo(scanned, {}).io, ctx, isAllowed))
      expect(gathered.repo.languages).toEqual(['TypeScript'])
    }
  })

  test('without consent gatherScans never reads ~/.claude.json', async () => {
    const run = memIo(scanned, {})
    const gathered = await gatherScans(run.io, DEFAULT_LOCATIONS, false)
    expect(run.reads).not.toContain('/home/u/.claude.json')
    expect(gathered.setup.mcp.map(server => server.name)).toEqual(['sentry'])
  })

  test('with consent gatherScans reads ~/.claude.json once and keeps its server names', async () => {
    const run = memIo(scanned, {})
    const gathered = await gatherScans(run.io, DEFAULT_LOCATIONS, true)
    expect(run.reads.filter(path => path === '/home/u/.claude.json')).toHaveLength(1)
    expect(gathered.setup.mcp.map(server => server.name)).toEqual(['linear', 'sentry'])
  })

  test('the setup scan looks for the project of the root as given as well as the root as resolved', async () => {
    const claudeJson = '{"projects":{"/link/repo":{"mcpServers":{"jira":{}}}}}'
    const world = gitWorld({ files: { '/home/u/.claude.json': claudeJson } })
    const locations = { ...DEFAULT_LOCATIONS, givenRoot: '/link/repo' }
    const gathered = await gatherScans(memIo(world, {}).io, locations, true)
    expect(gathered.setup.mcp.map(server => server.name)).toEqual(['jira'])
  })
})

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

  test('a scan that stopped at the entry cap says so after the .cadre/ line', () => {
    const lines = scanSummaryLines(repoScan({ isTruncated: true }), emptySetupScan())
    expect(lines[4]).toBe('  truncated: the scan stopped after 2000 entries; later files were not scanned')
    expect(lines[5]).toBe('User setup (names only):')
    expect(scanSummaryLines(repoScan(), emptySetupScan())).toHaveLength(8)
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

/** What the scans of one run found, with these warnings in each of the three scans. */
function gatheredWith(facts: readonly string[], repo: readonly string[], setup: readonly string[]): Gathered {
  return {
    facts: { facts: { ...EMPTY_FACTS, warnings: facts }, gsdUserDir: null },
    repo: repoScan({ warnings: repo }),
    setup: emptySetupScan({ warnings: setup }),
  }
}

describe('scanWarnings', () => {
  test('the warnings of the locations, the facts, the repo scan and the setup scan, in that order', () => {
    const locations = { ...DEFAULT_LOCATIONS, warnings: ['root given through a link'] }
    const gathered = gatheredWith(['facts a', 'facts b'], ['repo a'], ['setup a'])
    expect(scanWarnings(locations, gathered)).toEqual([
      'root given through a link',
      'facts a',
      'facts b',
      'repo a',
      'setup a',
    ])
  })

  test('a warning given twice, in one list or in two, is listed once where it first comes', () => {
    const locations = { ...DEFAULT_LOCATIONS, warnings: ['same', 'loc'] }
    const gathered = gatheredWith(['facts', 'same'], ['repo', 'facts'], ['repo', 'setup', 'setup'])
    expect(scanWarnings(locations, gathered)).toEqual(['same', 'loc', 'facts', 'repo', 'setup'])
  })

  test('with no warning anywhere the list is empty, and so are its lines', () => {
    expect(scanWarnings(DEFAULT_LOCATIONS, gatheredWith([], [], []))).toEqual([])
    expect(scanWarningLines([])).toEqual([])
  })

  test('each warning is one line that starts with warning:', () => {
    expect(scanWarningLines(['a'])).toEqual(['warning: a'])
    expect(scanWarningLines(['a', 'b c'])).toEqual(['warning: a', 'warning: b c'])
  })
})

/** A setup scan whose hooks register the GSD secret read guard once from each of these settings sources. */
function guardFrom(sources: readonly HookScript['source'][]): Gathered['setup'] {
  return emptySetupScan({
    hooks: sources.map(source => ({ script: 'gsd-secret-read-guard.js', event: 'PreToolUse', source })),
  })
}

/** Settings with one PreToolUse hook that runs the GSD secret read guard. */
const GUARD_SETTINGS = {
  hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node /x/hooks/gsd-secret-read-guard.js' }] }] },
}

describe('guardSourceWarnings (A2)', () => {
  test('the warning says that a guard only in local settings will not load in role sessions yet', () => {
    expect(GUARD_SOURCE_WARNING).toBe(
      'the GSD secret read guard is registered only in local settings, so it will not load in role sessions yet',
    )
  })

  test('a guard registered only in local settings is named once in the warnings', () => {
    expect(guardSourceWarnings(guardFrom(['local']))).toEqual([GUARD_SOURCE_WARNING])
    expect(guardSourceWarnings(guardFrom(['local', 'local']))).toEqual([GUARD_SOURCE_WARNING])
  })

  test('a guard from the user or project settings, as well or alone, or no guard at all, gives no warning', () => {
    const cases: readonly (readonly HookScript['source'][])[] = [
      ['user'],
      ['project'],
      ['local', 'project'],
      ['local', 'user'],
      [],
    ]
    for (const sources of cases) {
      expect([sources.join('+'), guardSourceWarnings(guardFrom(sources))]).toEqual([sources.join('+'), []])
    }
  })

  test('another hook only in local settings gives no warning', () => {
    const setup = emptySetupScan({ hooks: [{ script: 'my-hook.sh', event: 'PreToolUse', source: 'local' }] })
    expect(guardSourceWarnings(setup)).toEqual([])
  })

  test('scanWarnings ends with the guard-source warning, after the setup scan warnings, each text once', () => {
    const gathered = { ...gatheredWith(['facts a'], [], []), setup: { ...guardFrom(['local']), warnings: ['setup a'] } }
    expect(scanWarnings(DEFAULT_LOCATIONS, gathered)).toEqual(['facts a', 'setup a', GUARD_SOURCE_WARNING])
    const twice = { ...gathered, setup: { ...gathered.setup, warnings: [GUARD_SOURCE_WARNING] } }
    expect(scanWarnings(DEFAULT_LOCATIONS, twice)).toEqual(['facts a', GUARD_SOURCE_WARNING])
  })

  test('the guard is still carried when it is only in local settings: the warning changes nothing else', async () => {
    const world = gitWorld({ settings: { user: {}, project: {}, local: GUARD_SETTINGS } })
    const gathered = await gatherScans(memIo(world, {}).io, DEFAULT_LOCATIONS, false)
    const roles = proposeRoles(repoScan()).roles
    const carried = valueOf(await carryStep(memIo(memWorld({}), []).io, roles, gathered.setup))
    expect(carried.map(role => role.carry.hooks)).toEqual(roles.map(() => ['gsd-secret-read-guard.js']))
  })
})

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
    expect(run.asked[0]).toBe(CLAUDE_JSON_QUESTION)
    expect(CLAUDE_JSON_QUESTION).toBe(
      'Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.',
    )
    expect(run.specs[0]).toEqual({ options: ['Yes, read names only', 'No, skip it'] })
    expect(CLAUDE_JSON_OPTIONS).toEqual(['Yes, read names only', 'No, skip it'])
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
    expect(await runInit(run.io, { dryRun: true })).toBe(INIT_CANCELLED)
    expect(run.asked).toEqual([CLAUDE_JSON_QUESTION])
    expect(run.listed).toEqual([])
    expect(run.reads).toEqual([STATUS_PATH])
    expect(run.logged).toEqual([CONSENT_DISMISSED_REASON])
  })

  test('consentStep accepts yes or no; a dismissal or unknown answers are cancelled with the reason (A1)', async () => {
    const yes = memIo(memWorld({}), ['Yes, read names only'])
    expect(await consentStep(yes.io)).toEqual({ kind: 'accepted', value: true })
    expect(yes.asked).toEqual([CLAUDE_JSON_QUESTION])
    expect(yes.specs).toEqual([{ options: CLAUDE_JSON_OPTIONS }])
    expect(await consentStep(memIo(memWorld({}), [' no, SKIP it ']).io)).toEqual({ kind: 'accepted', value: false })
    for (const answers of [[], ['maybe', 'maybe', 'maybe']]) {
      const run = memIo(memWorld({}), answers)
      expect(await consentStep(run.io)).toEqual({ kind: 'cancelled', reason: CONSENT_DISMISSED_REASON })
      expect(run.logged).toEqual([])
    }
    expect(CONSENT_DISMISSED_REASON).toBe('The ~/.claude.json question was dismissed or not answered.')
  })

  test('right after the consent init logs the repo scan and the user setup, before the next question', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    expect(events[0]).toBe(`ask ${CLAUDE_JSON_QUESTION}`)
    expect(events[1]?.startsWith('log Repo scan (read-only):\n')).toBe(true)
    expect(events[1]).toContain('\nUser setup (names only):\n')
  })

  test('init prints every scan warning right after the scan summary, in the same entry, before the roles', async () => {
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
    expect(events[1]).toBe(`log ${[...summary, ...warnings].join('\n')}`)
    expect(events[2]?.startsWith('log Proposed roles:\n')).toBe(true)
  })

  test('with no scan warning nothing is added after the scan summary', async () => {
    const listable = gitWorld({ dirs: { '/repo/.git': [], '/repo': [] } })
    const run = memIo(listable, INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const gathered = await gatherScans(memIo(listable, {}).io, DEFAULT_LOCATIONS, false)
    expect(scanWarnings(DEFAULT_LOCATIONS, gathered)).toEqual([])
    expect(events[1]).toBe(`log ${scanSummaryLines(gathered.repo, gathered.setup).join('\n')}`)
  })

  test('init prints the guard-source warning with the scan warnings when the guard is only local (A2)', async () => {
    const local = memIo(gitWorld({ settings: { user: {}, project: {}, local: GUARD_SETTINGS } }), INIT_ANSWERS)
    const { io, events } = withEvents(local)
    await runInit(io, { dryRun: true })
    expect(events[1]?.split('\n')).toContain(`warning: ${GUARD_SOURCE_WARNING}`)
    const user = memIo(gitWorld({ settings: { user: GUARD_SETTINGS, project: {}, local: {} } }), INIT_ANSWERS)
    await runInit(user.io, { dryRun: true })
    expect(user.logged.join('\n')).not.toContain(GUARD_SOURCE_WARNING)
  })

  test('after the summary init shows the roles proposed from the repo scan and asks the roles question', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const proposal = proposeRoles(await scanRepo(memIo(gitWorld(), {}).io, '/repo'))
    expect(events[2]).toBe(`log ${proposalLines(proposal.roles, proposal.changes).join('\n')}`)
    expect(events[3]).toBe(`ask ${ROLES_QUESTION}`)
  })

  test('a dismissed roles question cancels init and prints why', async () => {
    const answers = Object.fromEntries(Object.entries(INIT_ANSWERS).filter(([key]) => key !== 'Use these roles?'))
    const run = memIo(gitWorld(), answers)
    expect(await runInit(run.io, { dryRun: true })).toBe(INIT_CANCELLED)
    expect(run.asked).toEqual([CLAUDE_JSON_QUESTION, ROLES_QUESTION])
    expect(run.logged.at(-1)).toBe(ROLES_DISMISSED_REASON)
  })

  test('a roles step that hits its round cap prints the reason as its own line and asks nothing after it', async () => {
    const answers = { ...INIT_ANSWERS, 'Use these roles?': 'Adjust them', 'Adjust the roles': 'Done adjusting' }
    const run = memIo(gitWorld(), answers)
    expect(await runInit(run.io, { dryRun: true })).toBe(INIT_CANCELLED)
    expect(run.logged.at(-1)).toBe(ROLE_ROUNDS_REASON)
    expect(run.asked.filter(question => question === ROLES_QUESTION)).toHaveLength(MAX_ROLE_ROUNDS)
    expect(run.asked.filter(question => question !== ROLES_QUESTION && question !== ADJUST_QUESTION)).toEqual([
      CLAUDE_JSON_QUESTION,
    ])
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
function rolesOf(result: AdjustOutcome | StepResult<readonly RoleSpec[]>): readonly RoleSpec[] | null {
  if (result.kind === 'cancelled') return null

  return result.kind === 'adjusted' ? result.roles : result.value
}

/** The value of an accepted step result; a cancelled one stops the test with its reason. */
function valueOf<T>(result: StepResult<T>): T {
  if (result.kind === 'cancelled') throw new Error(`the step was cancelled: ${result.reason}`)

  return result.value
}

/** The fallback sentence that ends the line init prints when the described structure cannot be used. */
const FALLBACK_END = 'Using the template proposal; you can still adjust it.'

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
    expect(run.asked).toEqual([DESCRIBE_QUESTION])
    expect(run.specs[0]).toEqual({ options: ['Use the template instead', 'Cancel init'] })
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
    if (result === null || result.kind !== 'fallback') throw new Error('no fallback')
    expect(result.message.startsWith('Could not use the described structure: ')).toBe(true)
    expect(result.message.endsWith(FALLBACK_END)).toBe(true)
    expect(Array.from(result.message).length <= 240).toBe(true)
  })

  test('a blank description is asked again and never sent to the model', async () => {
    const run = memIo(memWorld({ replies: [DESCRIBED_REPLY] }), ['   ', '', DESCRIPTION])
    expect(await describeStep(run.io)).toEqual({ kind: 'roles', roles: DESCRIBED_ROLES })
    expect(run.asked).toEqual([DESCRIBE_QUESTION, DESCRIBE_QUESTION, DESCRIBE_QUESTION])
    expect(run.prompts).toHaveLength(1)
  })

  test('the template answer makes no model call, and Cancel init or a dismissal cancels', async () => {
    const template = memIo(memWorld({ replies: [DESCRIBED_REPLY] }), ['Use the template instead'])
    expect(await describeStep(template.io)).toEqual({ kind: 'template' })
    expect(template.prompts).toEqual([])
    const cancel = memIo(memWorld({ replies: [DESCRIBED_REPLY] }), ['Cancel init'])
    expect(await describeStep(cancel.io)).toBeNull()
    expect(cancel.prompts).toEqual([])
    expect(await describeStep(memIo(memWorld({}), []).io)).toBeNull()
    expect(DESCRIBE_OPTIONS).toEqual(['Use the template instead', 'Cancel init'])
    expect(Object.isFrozen(DESCRIBE_OPTIONS)).toBe(true)
  })

  test('the describe question says to type the structure in the text field', () => {
    expect(DESCRIBE_QUESTION).toBe('Describe your role structure in your own words (type it in the text field).')
  })
})

describe('adjustLoop', () => {
  const roles = proposeRoles(FULL_SCAN).roles

  test('one typed change per answer until Done adjusting: drop and add', async () => {
    const run = memIo(memWorld({}), ['drop fe', 'add docs "Docs writer"', 'Done adjusting'])
    const adjusted = rolesOf(await adjustLoop(run.io, roles, FRAMEWORKS))
    expect(adjusted?.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'qa', 'security', 'docs'])
    expect(adjusted?.find(role => role.id === 'docs')?.title).toBe('Docs writer')
    expect(run.asked).toEqual([ADJUST_QUESTION, ADJUST_QUESTION, ADJUST_QUESTION])
    expect(run.specs[0]).toEqual({ options: ['Done adjusting', 'Show the roles'] })
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

  test('a line it cannot read and a change it cannot apply each print an exact message', async () => {
    const run = memIo(memWorld({}), ['delete fe', 'drop zz', 'Done adjusting'])
    expect(await adjustLoop(run.io, roles, FRAMEWORKS)).toEqual({ kind: 'adjusted', roles })
    expect(run.logged).toEqual([
      'Could not read that change: delete fe. Use add, drop, rename or framework.',
      'no role "zz"',
    ])
  })

  test('Show the roles prints the current roles and asks again', async () => {
    const run = memIo(memWorld({}), ['drop fe', 'Show the roles', 'Done adjusting'])
    await adjustLoop(run.io, roles, FRAMEWORKS)
    const [shown] = run.logged
    expect(shown?.startsWith('Proposed roles:\n')).toBe(true)
    expect(shown).not.toContain('FE (fe)')
    expect(shown).not.toContain('Changes from the scan:')
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
    expect(run.logged.at(-1)).toBe(ADJUST_ROUNDS_NOTE)
    expect(ADJUST_ROUNDS_NOTE).toBe(
      'Adjust took 30 answers without "Done adjusting": showing the roles as they are now.',
    )
  })

  test('Adjust refuses a framework not installed, names the installed ones, and the role keeps its own', async () => {
    const run = memIo(memWorld({}), ['framework qa superpowers', 'Done adjusting'])
    expect(await adjustLoop(run.io, roles, ['gsd', 'none'])).toEqual({ kind: 'adjusted', roles })
    expect(run.logged).toEqual([
      'Cannot set qa to superpowers: it is not installed for this repo (installed: GSD, none (built-in)). ' +
        'qa keeps its framework.',
    ])
  })

  test('Adjust applies an installed framework; a role it does not know gets the unknown-role message', async () => {
    const run = memIo(memWorld({}), ['framework qa gsd', 'framework nosuch superpowers', 'Done adjusting'])
    const adjusted = rolesOf(await adjustLoop(run.io, roles, ['gsd', 'none']))
    expect(adjusted?.find(role => role.id === 'qa')?.framework).toBe('gsd')
    expect(run.logged).toEqual(['no role "nosuch"'])
  })

  test('none is always installed, so a role can always be set to the built-in fallback', async () => {
    const run = memIo(memWorld({}), ['framework qa none', 'framework be gsd', 'Done adjusting'])
    const adjusted = rolesOf(await adjustLoop(run.io, roles, ['none']))
    expect(adjusted?.find(role => role.id === 'qa')?.framework).toBe('none')
    expect(adjusted?.find(role => role.id === 'be')?.framework).toBeUndefined()
    expect(run.logged).toEqual([
      'Cannot set be to gsd: it is not installed for this repo (installed: none (built-in)). be keeps its framework.',
    ])
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

  test('Use these roles returns the proposed roles, after the proposal lines are logged', async () => {
    const run = memIo(memWorld({}), { 'Use these roles?': 'Use these roles' })
    expect(await rolesStep(run.io, proposal, FRAMEWORKS)).toEqual({ kind: 'accepted', value: proposal.roles })
    expect(run.logged).toEqual([proposalLines(proposal.roles, proposal.changes).join('\n')])
    expect(run.asked).toEqual([ROLES_QUESTION])
    expect(run.specs[0]).toEqual({ options: ['Use these roles', 'Adjust them', 'Describe my own structure'] })
    expect(ROLES_QUESTION).toBe('Use these roles?')
    expect(ROLES_OPTIONS).toEqual(['Use these roles', 'Adjust them', 'Describe my own structure'])
    expect(Object.isFrozen(ROLES_OPTIONS)).toBe(true)
  })

  test('a described structure goes through the model twice and is used after Use these roles', async () => {
    const answers = ['Describe my own structure', DESCRIPTION, 'Use these roles']
    const run = memIo(memWorld({ replies: ['not json', DESCRIBED_REPLY] }), answers)
    const roles = rolesOf(await rolesStep(run.io, proposal, FRAMEWORKS))
    expect(run.prompts).toHaveLength(2)
    expect(run.prompts[1]).toContain('the reply is not JSON')
    expect(roles).toEqual(DESCRIBED_ROLES)
    const docs = roles?.find(role => role.id === 'docs')
    expect(docs?.hasBash).toBe(true)
    expect(docs?.autopilot.askUser).toBe(false)
    expect(run.asked).toEqual([ROLES_QUESTION, DESCRIBE_QUESTION, ROLES_QUESTION])
    expect(run.logged[1]).toBe(proposalLines(DESCRIBED_ROLES, []).join('\n'))
  })

  test('three invalid replies print why and ask the roles question again with the template roles', async () => {
    const answers = ['Describe my own structure', DESCRIPTION, 'Use these roles']
    const run = memIo(memWorld({ replies: ['not json', 'not json', 'not json'] }), answers)
    expect(await rolesStep(run.io, proposal, FRAMEWORKS)).toEqual({ kind: 'accepted', value: proposal.roles })
    expect(run.prompts).toHaveLength(3)
    const reason = run.logged[1]
    expect(reason?.startsWith('Could not use the described structure:')).toBe(true)
    expect(reason?.endsWith(FALLBACK_END)).toBe(true)
    expect(run.logged[2]).toBe(proposalLines(proposal.roles, proposal.changes).join('\n'))
    expect(run.asked).toEqual([ROLES_QUESTION, DESCRIBE_QUESTION, ROLES_QUESTION])
  })

  test('Use the template instead goes back to the roles question with no model call', async () => {
    const answers = ['Describe my own structure', '  ', 'Use the template instead', 'Use these roles']
    const run = memIo(memWorld({ replies: [DESCRIBED_REPLY] }), answers)
    expect(await rolesStep(run.io, proposal, FRAMEWORKS)).toEqual({ kind: 'accepted', value: proposal.roles })
    expect(run.prompts).toEqual([])
    expect(run.asked).toEqual([ROLES_QUESTION, DESCRIBE_QUESTION, DESCRIBE_QUESTION, ROLES_QUESTION])
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
    expect(run.asked.filter(question => question === ROLES_QUESTION)).toHaveLength(2)
    expect(run.logged.at(-1)).toContain('Docs writer (docs)')
  })

  test('a dismissal at any point of the step cancels it with the reason of that question (A1)', async () => {
    const scripts: readonly (readonly [readonly string[], string])[] = [
      [[], ROLES_DISMISSED_REASON],
      [['Adjust them'], ADJUST_DISMISSED_REASON],
      [['Describe my own structure'], DESCRIBE_CANCELLED_REASON],
      [['Describe my own structure', 'Cancel init'], DESCRIBE_CANCELLED_REASON],
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
    expect(run.asked.filter(question => question === ROLES_QUESTION)).toHaveLength(MAX_ROLE_ROUNDS)
    expect(MAX_ROLE_ROUNDS).toBe(10)
    expect(ROLE_ROUNDS_REASON).toBe(
      'The roles question was asked 10 times without "Use these roles": nothing was chosen.',
    )
  })

  test('a 10th round of Adjust them and Done adjusting cancels too: no cap ever accepts the roles (A1)', async () => {
    const answers = Array.from({ length: 11 }, () => ['Adjust them', 'Done adjusting']).flat()
    const run = memIo(memWorld({}), answers)
    expect(await rolesStep(run.io, proposal, FRAMEWORKS)).toEqual({ kind: 'cancelled', reason: ROLE_ROUNDS_REASON })
    expect(run.asked.filter(question => question === ROLES_QUESTION)).toHaveLength(10)
  })

  test('the Adjust cap shows the roles so far and asks the roles question again; Use these roles accepts', async () => {
    const full = proposeRoles(FULL_SCAN)
    const answers = ['Adjust them', 'drop fe', ...Array.from({ length: 29 }, () => 'delete fe'), 'Use these roles']
    const run = memIo(memWorld({}), answers)
    const kept = full.roles.filter(role => role.id !== 'fe')
    expect(await rolesStep(run.io, full, FRAMEWORKS)).toEqual({ kind: 'accepted', value: kept })
    expect(run.asked.filter(question => question === ROLES_QUESTION)).toHaveLength(2)
    const noteAt = run.logged.indexOf(ADJUST_ROUNDS_NOTE)
    expect(noteAt > 0 && run.logged[noteAt + 1] === proposalLines(kept, full.changes).join('\n')).toBe(true)
  })

  test('the Adjust cap is not acceptance: a dismissed roles question after it cancels the step', async () => {
    const full = proposeRoles(FULL_SCAN)
    const answers = ['Adjust them', 'drop fe', ...Array.from({ length: 29 }, () => 'delete fe')]
    const run = memIo(memWorld({}), answers)
    expect(await rolesStep(run.io, full, FRAMEWORKS)).toEqual({ kind: 'cancelled', reason: ROLES_DISMISSED_REASON })
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
    expect(run.asked).toEqual([AMBIGUOUS_QUESTION, FRAMEWORK_ALL_QUESTION])
    expect(run.specs).toEqual([{ options: ['Same for all roles', 'Per role'] }, { options: BOTH_OPTIONS }])
  })

  test('ambiguous: Per role asks each role by title and id, in role order, with both frameworks and none', async () => {
    const run = memIo(memWorld({}), ['Per role', 'GSD', 'none (built-in)', 'superpowers'])
    const result = valueOf(await frameworkStep(run.io, ambiguous, roles))
    expect(result.roles.map(role => role.framework)).toEqual(['gsd', 'none', 'superpowers'])
    expect(result.repoDefault).toBeNull()
    expect(run.asked).toEqual([
      AMBIGUOUS_QUESTION,
      'Framework for PM (pm)?',
      'Framework for Team Lead (tl)?',
      'Framework for Security (security)?',
    ])
    const each = { options: BOTH_OPTIONS }
    expect(run.specs.slice(1)).toEqual([each, each, each])
  })

  test('installed-only asks with the installed framework and none, and says why it asks', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'GSD'])
    const result = valueOf(await frameworkStep(run.io, installedOnly, roles))
    expect(result.roles.map(role => role.framework)).toEqual(['gsd', 'gsd', 'gsd'])
    expect(run.asked).toEqual([INSTALLED_QUESTION, FRAMEWORK_ALL_QUESTION])
    expect(run.specs[1]).toEqual({ options: ['GSD', 'none (built-in)'] })
  })

  test('a typed framework that is not offered is asked again; a typed id that is offered counts', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'superpowers', ' NONE '])
    const result = valueOf(await frameworkStep(run.io, installedOnly, roles))
    expect(result.roles.map(role => role.framework)).toEqual(['none', 'none', 'none'])
    expect(run.asked).toEqual([INSTALLED_QUESTION, FRAMEWORK_ALL_QUESTION, FRAMEWORK_ALL_QUESTION])
  })

  test('a dismissed framework question is never a choice: the step is cancelled with the reason (A1)', async () => {
    const scripts = [[], ['Same for all roles'], ['Per role', 'GSD'], ['what', 'ever', 'else']]
    for (const answers of scripts) {
      const run = memIo(memWorld({}), answers)
      expect(await frameworkStep(run.io, ambiguous, roles)).toEqual({
        kind: 'cancelled',
        reason: FRAMEWORK_DISMISSED_REASON,
      })
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
    const none = memIo(memWorld({}), {})
    expect(await frameworkStep(none.io, { kind: 'none' }, roles)).toEqual(builtIn)
    expect(none.asked).toEqual([])
    expect(none.logged).toEqual([])
  })

  test('options keep SUPPORTED_IDS order then none for each role, 2 to 4 of them, in any choice order', async () => {
    const reversed: Choice = { kind: 'ambiguous', ids: ['superpowers', 'gsd'] }
    const run = memIo(memWorld({}), ['Per role', 'GSD', 'GSD', 'GSD'])
    await frameworkStep(run.io, reversed, roles)
    const each = { options: BOTH_OPTIONS }
    expect(run.specs.slice(1)).toEqual([each, each, each])
    for (const spec of run.specs) {
      expect(spec.options.length >= 2 && spec.options.length <= 4).toBe(true)
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
  test('with nothing detected no framework is asked and the GSD and superpowers lines print first', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    expect(run.asked.some(question => question.startsWith(FRAMEWORK_QUESTION_PREFIX))).toBe(false)
    const at = events.findIndex(event => event.startsWith('log Recommendations (print-only; nothing is installed):\n'))
    expect(at >= 0 && at < events.indexOf('ask Git policy for .cadre/?')).toBe(true)
    expect(events[at]).toContain('\n- GSD for all roles: ')
    expect(events[at]).toContain('\n- superpowers for all roles: ')
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
    expect(run.logged).toContain(expected.join('\n'))
  })

  test('with two frameworks in use the framework question follows the roles; no framework is recommended', async () => {
    const run = memIo(gitWorld({ facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } }), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const rolesAt = events.indexOf(`ask ${ROLES_QUESTION}`)
    const frameworkAt = events.indexOf(
      'ask Which framework do the roles use? (asked because more than one framework is in use)',
    )
    expect(rolesAt >= 0 && frameworkAt > rolesAt).toBe(true)
    expect(events[frameworkAt + 1]).toBe(`ask ${FRAMEWORK_ALL_QUESTION}`)
    const recommended = run.logged.find(text => text.startsWith('Recommendations'))
    expect(recommended === undefined).toBe(false)
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
    expect(run.logged).toContain(
      'Cannot set security to superpowers: it is not installed for this repo (installed: GSD, none (built-in)). ' +
        'security keeps its framework.',
    )
  })

  test('a dismissed framework question cancels init and prints why (A1)', async () => {
    const kept = Object.entries(INIT_ANSWERS).filter(([key]) => !key.startsWith('Which framework'))
    const answers = Object.fromEntries(kept)
    const run = memIo(gitWorld({ facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } }), answers)
    expect(await runInit(run.io, { dryRun: true })).toBe(INIT_CANCELLED)
    expect(run.logged.at(-1)).toBe(FRAMEWORK_DISMISSED_REASON)
  })
})

/** The INIT_ANSWERS without the answer for one question prefix, so that question is dismissed. */
function answersWithout(prefix: string): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(INIT_ANSWERS).filter(([key]) => key !== prefix))
}

describe('durationStep', () => {
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
      expect(await durationStep(run.io)).toEqual({ kind: 'accepted', value: duration })
      expect(run.asked).toEqual([DURATION_QUESTION])
      expect(run.specs).toEqual([{ options: ['4h', '2h', '8h'] }])
      expect(run.logged).toEqual([])
    }
  })

  test('zero and more than 168 hours are asked again, and a duration after them is taken', async () => {
    const run = memIo(memWorld({}), ['0', '200h', '2h'])
    expect(await durationStep(run.io)).toEqual({ kind: 'accepted', value: '2h' })
    expect(run.asked).toEqual([DURATION_QUESTION, DURATION_QUESTION, DURATION_QUESTION])
  })

  test('three answers outside the grammar are cancelled with the reason, and nothing is taken (A1)', async () => {
    const run = memIo(memWorld({}), ['soon', 'soon', 'soon', '4h'])
    expect(await durationStep(run.io)).toEqual({ kind: 'cancelled', reason: DURATION_DISMISSED_REASON })
    expect(run.asked).toHaveLength(MAX_ASKS)
    expect(run.logged).toEqual([])
  })

  test('a dismissed duration question is cancelled at once with the reason, which the step never prints', async () => {
    const run = memIo(memWorld({}), [])
    expect(await durationStep(run.io)).toEqual({ kind: 'cancelled', reason: DURATION_DISMISSED_REASON })
    expect(run.asked).toEqual([DURATION_QUESTION])
    expect(run.logged).toEqual([])
    expect(DURATION_DISMISSED_REASON).toBe('The autopilot duration question was dismissed or not answered.')
  })

  test('init asks the duration once, after the recommendations, and a dismissed one cancels init', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const recommendedAt = events.findIndex(event => event.startsWith('log Recommendations'))
    expect(events.indexOf(`ask ${DURATION_QUESTION}`) > recommendedAt).toBe(true)
    expect(run.asked.filter(question => question === DURATION_QUESTION)).toHaveLength(1)
    const dismissed = memIo(gitWorld(), answersWithout('Autopilot duration'))
    expect(await runInit(dismissed.io, { dryRun: true })).toBe(INIT_CANCELLED)
    expect(dismissed.asked.at(-1)).toBe(DURATION_QUESTION)
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
  const MODEL_ALL = 'Model and effort for all roles?'

  test('the first model question offers Same for all roles first, then Per role', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'opus + medium'])
    await modelStep(run.io, roles)
    expect(MODEL_MODE_QUESTION).toBe('Model and effort: same for all roles, or per role?')
    expect(run.asked[0]).toBe(MODEL_MODE_QUESTION)
    expect(run.specs[0]).toEqual({ options: ['Same for all roles', 'Per role'] })
  })

  test('Same for all roles asks once more and gives every role that model family and effort', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'sonnet + high'])
    const modelled = valueOf(await modelStep(run.io, roles))
    expect(modelled.map(role => [role.id, role.model, role.effort])).toEqual(
      roles.map(role => [role.id, 'sonnet', 'high']),
    )
    expect(run.asked).toEqual([MODEL_MODE_QUESTION, MODEL_ALL])
    expect(run.specs[1]).toEqual({ options: ['opus + medium', 'sonnet + medium', 'sonnet + high'] })
    expect(run.logged).toEqual([])
  })

  test('Per role asks each role by its title and id in role order, each with the three options (A6)', async () => {
    const answers = ['Per role', 'opus + medium', 'sonnet + high', 'sonnet + medium', 'haiku low', 'OPUS+max']
    const run = memIo(memWorld({}), answers)
    const modelled = valueOf(await modelStep(run.io, roles))
    expect(run.asked).toEqual([
      MODEL_MODE_QUESTION,
      'Model and effort for PM (pm)?',
      'Model and effort for Team Lead (tl)?',
      'Model and effort for BE (be)?',
      'Model and effort for QA (qa)?',
      'Model and effort for Security (security)?',
    ])
    const each = { options: MODEL_EFFORT_OPTIONS }
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
      MODEL_MODE_QUESTION,
      'Model and effort for Backend (be)?',
      'Model and effort for Backend (be-api)?',
    ])
    expect(modelled.map(role => [role.id, role.model, role.effort])).toEqual([
      ['be', 'opus', 'medium'],
      ['be-api', 'sonnet', 'high'],
    ])
  })

  test('a model that is no family alias prints the refusal line and is asked again (A4)', async () => {
    const run = memIo(memWorld({}), ['Same for all roles', 'sonet + high', 'high high', 'opus + high'])
    const modelled = valueOf(await modelStep(run.io, roles))
    expect(modelled.map(role => [role.model, role.effort])).toEqual(roles.map(() => ['opus', 'high']))
    expect(run.asked).toEqual([MODEL_MODE_QUESTION, MODEL_ALL, MODEL_ALL, MODEL_ALL])
    expect(run.logged).toEqual([modelEffortRefusal('sonet + high'), modelEffortRefusal('high high')])
  })

  test('MAX_ASKS refused models, a pinned id among them, cancel with the reason after the refusal lines', async () => {
    const refused = ['claude-opus-5-5 high', 'opus', 'sonet high']
    const run = memIo(memWorld({}), ['Same for all roles', ...refused, 'opus + high'])
    expect(await modelStep(run.io, roles)).toEqual({ kind: 'cancelled', reason: MODEL_DISMISSED_REASON })
    expect(run.asked).toEqual([MODEL_MODE_QUESTION, MODEL_ALL, MODEL_ALL, MODEL_ALL])
    expect(run.logged).toEqual(refused.map(answer => modelEffortRefusal(answer)))
  })

  test('each role keeps its duration and the threshold 65, asked nowhere, and the input is unchanged', async () => {
    const before = JSON.stringify(roles)
    const modelled = valueOf(await modelStep(memIo(memWorld({}), ['Per role', 'sonnet high']).io, roles.slice(0, 1)))
    expect(modelled.map(role => role.autopilot)).toEqual([{ duration: '90m', threshold: 65, askUser: true }])
    expect(roles.every(role => role.autopilot.threshold === AUTOPILOT_THRESHOLD)).toBe(true)
    expect(AUTOPILOT_THRESHOLD).toBe(65)
    expect(JSON.stringify(roles)).toBe(before)
  })

  test('a dismissal or unlisted answer at any model question cancels with the reason, no roles (A1)', async () => {
    const scripts = [[], ['Same for all roles'], ['Per role', 'opus + medium'], ['nope', 'nope', 'nope']]
    for (const answers of scripts) {
      const run = memIo(memWorld({}), answers)
      expect(await modelStep(run.io, roles)).toEqual({ kind: 'cancelled', reason: MODEL_DISMISSED_REASON })
      expect(run.logged).toEqual([])
    }
    expect(MODEL_DISMISSED_REASON).toBe('A model and effort question was dismissed or not answered.')
  })

  test('init asks the model questions right after the duration, and a dismissed one cancels init', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const at = run.asked.indexOf(DURATION_QUESTION)
    expect(run.asked.slice(at + 1, at + 3)).toEqual([MODEL_MODE_QUESTION, MODEL_ALL])
    const dismissed = memIo(gitWorld(), answersWithout('Model and effort for'))
    expect(await runInit(dismissed.io, { dryRun: true })).toBe(INIT_CANCELLED)
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
const ROLE_LIST_SPEC = { options: ['None', 'All roles'] }

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

  test('the tables decide the known names; each unknown server and skill group is asked once', async () => {
    const run = memIo(memWorld({}), ['be', 'All roles'])
    const assigned = valueOf(await assignmentStep(run.io, roles, setup))
    expect(run.asked).toEqual([SENTRY_QUESTION, CODEX_QUESTION])
    expect(run.specs).toEqual([ROLE_LIST_SPEC, ROLE_LIST_SPEC])
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

  test('an answer that names a role the team does not have is asked again', async () => {
    const run = memIo(memWorld({}), ['cto', 'be', 'None'])
    const assigned = valueOf(await assignmentStep(run.io, roles, setup))
    expect(roleIn(assigned, 'be').mcp).toEqual(['sentry'])
    expect(run.asked).toEqual([SENTRY_QUESTION, SENTRY_QUESTION, CODEX_QUESTION])
  })

  test('three unreadable answers or a dismissal cancel with the reason, and no answer is kept (A1)', async () => {
    for (const answers of [['cto', 'cto', 'cto'], [], ['be']]) {
      const run = memIo(memWorld({}), answers)
      expect(await assignmentStep(run.io, roles, setup)).toEqual({
        kind: 'cancelled',
        reason: ASSIGNMENT_DISMISSED_REASON,
      })
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

describe('memoryStep', () => {
  const roles = proposeRoles(FULL_SCAN).roles
  /** A global CLAUDE.md, one auto-memory and the project CLAUDE.md: all three groups are there. */
  const found = emptySetupScan({ hasGlobalClaudeMd: true, memoryFiles: ['a.md'], claudeMd: ['<repo>/CLAUDE.md'] })
  const GLOBAL_QUESTION =
    'Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)'
  const MEMORY_QUESTION = 'Which roles get the auto-memories for this repo (a.md)? (e.g. PM, TL, or none)'
  const PROJECT_QUESTION = 'Which roles get the project CLAUDE.md (<repo>/CLAUDE.md)? (e.g. PM, TL, or none)'

  test('one question per group that is there: the global CLAUDE.md, the auto-memories, the project', async () => {
    const run = memIo(memWorld({}), ['pm, tl', 'None', 'All roles'])
    const given = valueOf(await memoryStep(run.io, roles, found))
    expect(run.asked).toEqual([GLOBAL_QUESTION, MEMORY_QUESTION, PROJECT_QUESTION])
    expect(run.specs).toEqual([ROLE_LIST_SPEC, ROLE_LIST_SPEC, ROLE_LIST_SPEC])
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
    expect(run.asked).toEqual(['Which roles get the auto-memories for this repo (a.md, b.md)? (e.g. PM, TL, or none)'])
    expect(roleIn(given, 'qa').instructions).toEqual(['auto-memory'])
    const none = memIo(memWorld({}), [])
    expect(await memoryStep(none.io, roles, emptySetupScan())).toEqual({ kind: 'accepted', value: roles })
    expect(none.asked).toEqual([])
  })

  test('an unknown role is asked again; three such answers or a dismissal cancel with the reason (A1)', async () => {
    const again = memIo(memWorld({}), ['cto', 'pm', 'None', 'None'])
    expect(roleIn(valueOf(await memoryStep(again.io, roles, found)), 'pm').instructions).toEqual(['global-claude-md'])
    expect(again.asked).toEqual([GLOBAL_QUESTION, GLOBAL_QUESTION, MEMORY_QUESTION, PROJECT_QUESTION])
    for (const answers of [['cto', 'cto', 'cto'], [], ['pm', 'pm']]) {
      const run = memIo(memWorld({}), answers)
      expect(await memoryStep(run.io, roles, found)).toEqual({ kind: 'cancelled', reason: MEMORY_DISMISSED_REASON })
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

/**
 * A git repo whose user setup holds a fake secret wherever a value can sit: env values, the status line and a hook
 * command in the user settings, an MCP tool and a skill description, the text of the global CLAUDE.md, of the project
 * CLAUDE.md and of an auto-memory. The scans keep the names: sentry, the codex skill, the three instruction groups,
 * the env names API_KEY and JIRA_URL, autoCompactWindow, the status line and the secret read guard.
 */
function secretWorld(): MemWorld {
  const guard = { type: 'command', command: 'T=SENTINEL_SECRET_VALUE node /h/gsd-secret-read-guard.js' }
  const user = {
    env: { API_KEY: 'sk-FAKE-SECRET-0123456789', JIRA_URL: 'Bearer FAKE-TOKEN-0123' },
    autoCompactWindow: 800000,
    statusLine: { type: 'command', command: 'node /home/u/bin/line.js --token ghp_FAKEFAKEFAKEFAKEFAKE' },
    hooks: { PreToolUse: [{ hooks: [guard] }] },
  }

  return gitWorld({
    settings: { user, project: {}, local: {} },
    tools: [{ name: 'mcp__sentry__issues', description: 'sk-FAKE-SECRET-0123456789', mcp: true }],
    commands: [{ name: 'codex:rescue', source: 'plugin', plugin: 'codex', description: 'Bearer FAKE-TOKEN-0123' }],
    ancestors: [{ dir: '/repo', name: 'CLAUDE.md', content: 'SENTINEL_SECRET_VALUE', parts: [] }],
    dirs: { '/repo/.git': [], '/home/u/.claude/projects/-repo/memory': [entry('notes.md')] },
    files: {
      '/home/u/.claude/CLAUDE.md': 'sk-FAKE-SECRET-0123456789',
      '/home/u/.claude/projects/-repo/memory/notes.md': 'ghp_FAKEFAKEFAKEFAKEFAKE',
    },
  })
}

describe('carryStep', () => {
  const roles = proposeRoles(FULL_SCAN).roles
  /** The carry facts of user settings with two env variables and nothing else. */
  const noCarry = { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] }
  const twoNames = emptySetupScan({ carry: { ...noCarry, envNames: ['API_KEY', 'JIRA_URL'] } })
  const ENV_QUESTION =
    'Which env variables do roles carry? Names: API_KEY, JIRA_URL (values are never stored; e.g. API_KEY, or none)'

  /** A hook script registered for an event in the user settings. */
  function hook(script: string, event = 'PreToolUse'): HookScript {
    return { script, event, source: 'user' }
  }

  test('the env question is asked once, and every role carries the picked names only', async () => {
    const run = memIo(memWorld({}), ['JIRA_URL'])
    const carried = valueOf(await carryStep(run.io, roles, twoNames))
    expect(run.asked).toEqual([ENV_QUESTION])
    expect(run.specs).toEqual([{ options: ['None', 'All of them'] }])
    const carry = { autoCompactWindow: false, statusLine: false, env: ['JIRA_URL'], hooks: [] }
    expect(carried.map(role => role.carry)).toEqual(roles.map(() => carry))
    expect(run.logged).toEqual([])
  })

  test('All of them carries every scanned name, None carries none, and NAME=value is asked again', async () => {
    const all = memIo(memWorld({}), ['API_KEY=x', 'All of them'])
    const carried = valueOf(await carryStep(all.io, roles, twoNames))
    expect(carried.every(role => role.carry.env.join() === 'API_KEY,JIRA_URL')).toBe(true)
    expect(all.asked).toEqual([ENV_QUESTION, ENV_QUESTION])
    const none = valueOf(await carryStep(memIo(memWorld({}), ['None']).io, roles, twoNames))
    expect(none.every(role => role.carry.env.length === 0)).toBe(true)
  })

  test('with no env names nothing is asked; autoCompactWindow and the status line are carried when set', async () => {
    const run = memIo(memWorld({}), [])
    const set = emptySetupScan({ carry: { ...noCarry, autoCompactWindow: 800000, hasStatusLine: true } })
    const carried = valueOf(await carryStep(run.io, roles, set))
    expect(run.asked).toEqual([])
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

  test('a dismissal or three answers that name no scanned variable cancel with the reason (A1)', async () => {
    for (const answers of [[], ['HOME', 'jira_url', 'API_KEY JIRA_URL=1']]) {
      const run = memIo(memWorld({}), answers)
      expect(await carryStep(run.io, roles, twoNames)).toEqual({ kind: 'cancelled', reason: ENV_DISMISSED_REASON })
      expect(run.logged).toEqual([])
    }
    expect(ENV_DISMISSED_REASON).toBe('The env variables question was dismissed or not answered.')
  })

  test('init asks the assignment, memory and env questions after the model questions, in that order', async () => {
    const run = memIo(secretWorld(), INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const modelAt = run.asked.indexOf('Model and effort for all roles?')
    expect(run.asked.slice(modelAt + 1, modelAt + 7)).toEqual([
      'Which roles get the sentry MCP server? (e.g. BE, QA, or none)',
      'Which roles get codex skills (1)? (e.g. BE, QA, or none)',
      'Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)',
      'Which roles get the auto-memories for this repo (notes.md)? (e.g. PM, TL, or none)',
      'Which roles get the project CLAUDE.md (<repo>/CLAUDE.md)? (e.g. PM, TL, or none)',
      ENV_QUESTION,
    ])
    expect(run.asked[modelAt + 7]).toBe(GIT_POLICY_QUESTION)
  })

  test('no env, settings or file value of the secret world reaches a question or a log line (T-02-34)', async () => {
    const run = memIo(secretWorld(), { ...INIT_ANSWERS, 'Which env variables': 'All of them' })
    await runInit(run.io, { dryRun: true })
    expect(run.asked.filter(question => question.startsWith('Which '))).toHaveLength(6)
    expect(leaks([...run.asked, ...run.logged].join('\n'), SECRET_FIXTURES)).toEqual([])
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

describe('provenUserDir', () => {
  test('the raw user-level GSD dir when the facts prove the user GSD', () => {
    expect(provenUserDir(PROVEN_FACTS)).toBe('/home/u/.claude/gsd-core')
  })

  test('null for an unproven user GSD, a proven repo copy alone, or no raw dir', () => {
    const unproven: readonly GsdFact['identity'][] = ['absent', 'unknown']
    for (const identity of unproven) {
      const facts = { ...EMPTY_FACTS, gsd: [{ ...PROVEN_USER_GSD, identity }] }
      expect(provenUserDir({ ...PROVEN_FACTS, facts })).toBeNull()
    }
    const repoCopy: GsdFact = { ...PROVEN_USER_GSD, location: 'project', dir: '<repo>/.claude/gsd-core' }
    expect(provenUserDir({ ...PROVEN_FACTS, facts: { ...EMPTY_FACTS, gsd: [repoCopy] } })).toBeNull()
    expect(provenUserDir({ ...PROVEN_FACTS, gsdUserDir: null })).toBeNull()
    expect(provenUserDir({ facts: EMPTY_FACTS, gsdUserDir: '/home/u/.claude/gsd-core' })).toBeNull()
  })
})

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

  test('only Accept accepts: an answer that is neither Accept nor Decline is asked again', async () => {
    const run = memIo(configWorld('{}'), ['yes', 'Accept', 'DECLINE'])
    const hunks = valueOf(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS))))
    expect(hunks.map(hunk => hunk.isAccepted)).toEqual([true, false])
    expect(run.asked).toHaveLength(3)
  })

  test('a dismissal or three unlisted answers cancel with the reason; no earlier Accept is kept (A1)', async () => {
    for (const answers of [[], ['Accept'], ['yes', 'ok', 'sure']]) {
      const run = memIo(configWorld('{}'), answers)
      expect(await hunkStep(run.io, input('gsd', gatheredOf(PROVEN_FACTS)))).toEqual({
        kind: 'cancelled',
        reason: HUNK_DISMISSED_REASON,
      })
      expect(run.logged).toEqual([])
    }
    expect(HUNK_DISMISSED_REASON).toBe('A hunk question was dismissed or not answered.')
  })

  test('init asks the hunks of GSD roles after the carried settings, right before the git policy', async () => {
    const run = memIo({ ...secretWorld(), facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } }, INIT_ANSWERS)
    await runInit(run.io, { dryRun: true })
    const policyAt = run.asked.indexOf(GIT_POLICY_QUESTION)
    const [env, ...hunks] = run.asked.slice(policyAt - 3, policyAt).map(question => question.split('\n')[0])
    expect(env?.startsWith('Which env variables do roles carry?')).toBe(true)
    expect(hunks).toEqual(['.planning/config.json: mode', '.planning/config.json: workflow.text_mode'])
    expect(run.logged).toContain(attendedNote(['mode', 'workflow.text_mode']))
  })

  test('init with no role on GSD asks no hunk, and a dismissed hunk cancels init with its reason', async () => {
    const plain = memIo(gitWorld(), INIT_ANSWERS)
    await runInit(plain.io, { dryRun: true })
    expect(plain.asked.some(question => question.startsWith('.planning/config.json:'))).toBe(false)
    expect(plain.logged.some(text => text.startsWith('attended:'))).toBe(false)
    const world = gitWorld({ facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } })
    const dismissed = memIo(world, answersWithout('.planning/config.json:'))
    expect(await runInit(dismissed.io, { dryRun: true })).toBe(INIT_CANCELLED)
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

/** The line init logs for a launcher folder it cannot use. */
function cannotUse(answer: string, problem: string): string {
  return `Cannot use ${answer}: ${problem}.`
}

/** The problem with a folder path isSafeRelativePath refuses. */
const UNSAFE_FOLDER = 'use a folder inside this repo: letters, digits, . _ @ - and /, with no .. and no leading /'

/** The problem with a folder whose real path is not a folder inside the repo. */
const NOT_A_FOLDER = 'it is not a folder in this repo'

/** What launchStartStep gives for the folder apps/web of the repo. */
const APPS_WEB = { kind: 'accepted', value: { kind: 'dir', path: 'apps/web' } }

describe('launchStartStep', () => {
  test('the launcher start question is asked once for the repo with three options, none preselected', () => {
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
      expect(await launchStartStep(run.io, '/repo')).toEqual({ kind: 'accepted', value: start })
      expect(run.asked).toEqual([LAUNCH_START_QUESTION])
      expect(run.specs[0]).toEqual({ options: LAUNCH_START_OPTIONS })
    }
  })

  test('another folder asks for it, and a plain folder of the repo is chosen, one trailing slash dropped', async () => {
    for (const first of ['Another folder in this repo', 'other']) {
      for (const folder of ['apps/web', 'apps/web/', ' apps/web ']) {
        const run = memIo(FOLDER_WORLD, [first, folder])
        expect(await launchStartStep(run.io, '/repo')).toEqual(APPS_WEB)
        expect(run.asked).toEqual([LAUNCH_START_QUESTION, LAUNCH_DIR_QUESTION])
        expect(run.specs[1]).toEqual({ options: ['Cancel init'] })
        expect(run.logged).toEqual([])
      }
    }
  })

  test('an unsafe or missing folder, a file or a link out of the repo is refused with why, asked again', async () => {
    const bad = ['../x', '/etc', 'a b', '${HOME}', 'missing', 'apps/readme.md', 'apps/linked']
    for (const answer of bad) {
      const run = memIo(FOLDER_WORLD, ['other', answer, 'apps/web'])
      expect(await launchStartStep(run.io, '/repo')).toEqual(APPS_WEB)
      const problem = ['missing', 'apps/readme.md', 'apps/linked'].includes(answer) ? NOT_A_FOLDER : UNSAFE_FOLDER
      expect(run.logged).toEqual([cannotUse(answer, problem)])
      expect(run.asked).toEqual([LAUNCH_START_QUESTION, LAUNCH_DIR_QUESTION, LAUNCH_DIR_QUESTION])
    }
  })

  test('a folder reached through a linked parent that leaves the repo is refused, and asked again', async () => {
    const run = memIo(FOLDER_WORLD, ['other', 'vendor/ui', 'apps/web'])
    const outside: PortStat = { kind: 'dir', size: 0, isLink: false, realPath: '/elsewhere/vendor/ui' }
    expect(await launchStartStep(withStat(run, '/repo/vendor/ui', outside), '/repo')).toEqual(APPS_WEB)
    expect(run.logged).toEqual([cannotUse('vendor/ui', NOT_A_FOLDER)])
    expect(run.asked).toEqual([LAUNCH_START_QUESTION, LAUNCH_DIR_QUESTION, LAUNCH_DIR_QUESTION])
  })

  test('a folder whose stat has no real path is refused, and asked again', async () => {
    const run = memIo(FOLDER_WORLD, ['other', 'apps/unresolved', 'apps/web'])
    const unresolved: PortStat = { kind: 'dir', size: 0, isLink: false }
    expect(await launchStartStep(withStat(run, '/repo/apps/unresolved', unresolved), '/repo')).toEqual(APPS_WEB)
    expect(run.logged).toEqual([cannotUse('apps/unresolved', NOT_A_FOLDER)])
    expect(run.asked).toEqual([LAUNCH_START_QUESTION, LAUNCH_DIR_QUESTION, LAUNCH_DIR_QUESTION])
  })

  test('a folder whose real path lies inside the repo is still chosen', async () => {
    const run = memIo(FOLDER_WORLD, ['other', 'packages/api'])
    const inside: PortStat = { kind: 'dir', size: 0, isLink: false, realPath: '/repo/packages/api' }
    const chosen = { kind: 'accepted', value: { kind: 'dir', path: 'packages/api' } }
    expect(await launchStartStep(withStat(run, '/repo/packages/api', inside), '/repo')).toEqual(chosen)
    expect(run.asked).toEqual([LAUNCH_START_QUESTION, LAUNCH_DIR_QUESTION])
    expect(run.logged).toEqual([])
  })

  test('a refused folder is shown cleaned and capped in the line that says why', async () => {
    const answer = `a${BIDI_OVERRIDE} ${'x'.repeat(200)}`
    const run = memIo(FOLDER_WORLD, ['other', answer, 'apps/web'])
    await launchStartStep(run.io, '/repo')
    expect(run.logged).toEqual([cannotUse(`a ${'x'.repeat(107)}…`, UNSAFE_FOLDER)])
  })

  test(`${MAX_ASKS} unusable folders cancel with the rounds reason, and nothing was chosen`, async () => {
    const run = memIo(FOLDER_WORLD, ['other', '../a', 'missing', '/b', 'apps/web'])
    expect(await launchStartStep(run.io, '/repo')).toEqual({ kind: 'cancelled', reason: LAUNCH_DIR_ROUNDS_REASON })
    expect(run.asked.filter(question => question === LAUNCH_DIR_QUESTION)).toHaveLength(MAX_ASKS)
    expect(LAUNCH_DIR_ROUNDS_REASON).toBe('No usable launcher folder after 3 tries: nothing was chosen.')
  })

  test('Cancel init or a dismissal at the folder question cancels with its reason', async () => {
    for (const answers of [['other', 'Cancel init'], ['other', ' cancel INIT '], ['other']]) {
      const run = memIo(FOLDER_WORLD, answers)
      expect(await launchStartStep(run.io, '/repo')).toEqual({ kind: 'cancelled', reason: LAUNCH_DIR_CANCELLED_REASON })
    }
    expect(LAUNCH_DIR_CANCELLED_REASON).toBe('The launcher folder question was dismissed or cancelled.')
  })

  test('a dismissed or never answered start question cancels with its reason', async () => {
    for (const answers of [[], ['somewhere', 'else', 'again']]) {
      const run = memIo(memWorld({}), answers)
      expect(await launchStartStep(run.io, '/repo')).toEqual({
        kind: 'cancelled',
        reason: LAUNCH_START_DISMISSED_REASON,
      })
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
    expect(run.asked[run.asked.indexOf(GIT_POLICY_QUESTION) + 1]).toBe(LAUNCH_START_QUESTION)
    expect(run.asked.filter(question => question === LAUNCH_START_QUESTION)).toHaveLength(1)
    expect(reply.split('\n')).toEqual([
      'cadre init --dry-run',
      policyLine('definitions'),
      'Launchers start in: the git root',
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
    const reply = await runInit(run.io, { dryRun: false })
    expect(reply.split('\n').slice(1, 4)).toEqual([
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
    expect(await runInit(run.io, { dryRun: true })).toBe(INIT_CANCELLED)
    expect(run.asked.at(-1)).toBe(LAUNCH_START_QUESTION)
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
  test('a dismissal at each of the eleven steps cancels init and prints its reason once, last of all', async () => {
    const gsd = gitWorld({ facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } })
    const sentryNone = { 'Which roles get the sentry': 'None', 'Which roles get codex': 'None' }
    const memory: CancelCase = {
      world: secretWorld(),
      answers: { ...answersWithout('Which roles get'), ...sentryNone },
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
      dismissedAt(secretWorld(), 'Which env variables', 'Which env variables', ENV_DISMISSED_REASON),
      dismissedAt(gsd, '.planning/config.json:', '.planning/config.json: mode', HUNK_DISMISSED_REASON),
      dismissedAt(gitWorld(), 'Git policy', GIT_POLICY_QUESTION, GIT_POLICY_DISMISSED_REASON),
      dismissedAt(
        gitWorld(),
        'Where should the role launchers start',
        LAUNCH_START_QUESTION,
        LAUNCH_START_DISMISSED_REASON,
      ),
    ]
    for (const { world, answers, question, reason } of cases) {
      const run = memIo(world, answers)
      expect(await runInit(run.io, { dryRun: true })).toBe(INIT_CANCELLED)
      expect(run.asked.at(-1)?.slice(0, question.length)).toBe(question)
      expect(run.logged.at(-1)).toBe(reason)
      expect(run.logged.filter(text => text === reason)).toHaveLength(1)
    }
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
    expect(run.asked).toEqual([GIT_POLICY_QUESTION])
    expect(run.specs).toEqual([{ options: GIT_POLICY_OPTIONS }])
    for (const answers of [[], ['whatever', 'whatever', 'whatever']]) {
      const dismissed = memIo(memWorld({}), answers)
      expect(await gitPolicyStep(dismissed.io)).toEqual({ kind: 'cancelled', reason: GIT_POLICY_DISMISSED_REASON })
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

  test('askChoice gives null after exactly two asks for an invalid answer followed by a dismissal', async () => {
    const run = memIo(memWorld({}), ['nonsense'])
    const policy = await askChoice(run.io, 'Git policy?', { options: GIT_POLICY_OPTIONS }, parseGitPolicy)
    expect(policy).toBeNull()
    expect(run.asked).toEqual(['Git policy?', 'Git policy?'])
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
