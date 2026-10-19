import { describe, expect, test } from 'claude-code/testing'

import type { InitIo, PortStat, RepoScan, RoleChange, SetupScan } from '../types'
import { FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY, MAX_READ_BYTES } from './facts'
import {
  ADJUST_OPTIONS,
  ADJUST_QUESTION,
  adjustLoop,
  askChoice,
  CLAUDE_JSON_OPTIONS,
  CLAUDE_JSON_QUESTION,
  commandRefusal,
  DESCRIBE_OPTIONS,
  DESCRIBE_QUESTION,
  describeStep,
  gatherScans,
  GIT_POLICY_OPTIONS,
  INIT_CANCELLED,
  INIT_FILE_SYSTEM_ROOT_REPLY,
  INIT_HOME_ROOT_REPLY,
  INIT_ROOT_UNKNOWN_REPLY,
  initGuard,
  MAX_PROPOSE_ATTEMPTS,
  NOT_INTERACTIVE_REPLY,
  parseGitPolicy,
  pluginVersionOf,
  policyLine,
  portProbeOf,
  portTextOf,
  proposalLines,
  ROLES_OPTIONS,
  ROLES_QUESTION,
  rolesStep,
  runInit,
  scanSummaryLines,
} from './init'
import { PROPOSE_SYSTEM, proposeRoles, rolesFromProposal } from './roles'
import { autopilotReply, scanRepo } from './scan'
import { scanSetup } from './setup'
import { DEFAULT_LOCATIONS, entry, leaks, memIo, memWorld } from './testkit'
import type { MemRun, MemWorld } from './testkit'

/** The status file autopilot keeps for session s1 of the fixture user. */
const STATUS_PATH = '/home/u/.claude/autopilot/s1.json'

/**
 * Answers for every question init asks, by question prefix (the longest prefix wins), the same set the faked-host
 * tests use, so a flow test survives questions that later steps add.
 */
const RUN_ANSWERS: Readonly<Record<string, string>> = Object.freeze({
  'Read ~/.claude.json': 'No, skip it',
  'Use these roles?': 'Use these roles',
  'Which framework do the roles use': 'Same for all roles',
  'Framework for': 'GSD',
  'Autopilot duration': '4h',
  'Model and effort: same': 'Same for all roles',
  'Model and effort for': 'opus + medium',
  'Which roles get': 'None',
  'Which env variables': 'None',
  '.planning/config.json:': 'Accept',
  'Git policy': 'Commit definitions (default)',
  'Review the plan': 'Confirm',
  "Scan this repo's session history": 'No, skip it',
})

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

/** A user setup that holds nothing; `over` changes the fields it names. */
function setupScan(over: Partial<SetupScan> = {}): SetupScan {
  return {
    plugins: [],
    skills: [],
    mcp: [],
    isMcpPartial: false,
    agents: [],
    claudeMd: [],
    hasGlobalClaudeMd: false,
    memoryFiles: [],
    settingsKeys: [],
    hooks: [],
    carry: { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] },
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
    expect(scanSummaryLines(repoScan(), setupScan())).toEqual([
      'Repo scan (read-only):',
      '  stack: none; frontend: none; backend: none',
      '  tests: none; E2E: none',
      '  existing .cadre/: none',
      'User setup (names only):',
      '  plugins: 0',
      '  skills: 0; MCP servers: none; agents: 0',
      '  CLAUDE.md files: none; global ~/.claude/CLAUDE.md: no; memories: 0',
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
    const lines = scanSummaryLines(repo, setupScan())
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
      scanSummaryLines(repoScan({ cadre: cadre(dir, manifestState) }), setupScan())[3]
    expect(shown('present', 'present')).toBe('  existing .cadre/: present (manifest present)')
    expect(shown('present', 'absent')).toBe('  existing .cadre/: present (manifest absent)')
    expect(shown('unknown', 'unknown')).toBe('  existing .cadre/: unknown (manifest unknown)')
  })

  test('a scan that stopped at the entry cap says so after the .cadre/ line', () => {
    const lines = scanSummaryLines(repoScan({ isTruncated: true }), setupScan())
    expect(lines[4]).toBe('  truncated: the scan stopped after 2000 entries; later files were not scanned')
    expect(lines[5]).toBe('User setup (names only):')
    expect(scanSummaryLines(repoScan(), setupScan())).toHaveLength(8)
  })

  test('the setup part counts plugins, skills, agents and memories and names MCP servers and CLAUDE.md files', () => {
    const plugins = ['a@m', 'b@m', 'c@m', 'd@m', 'e@m', 'f@m', 'g@m', 'h@m', 'i@m', 'j@m']
    const setup = setupScan({
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
      '  plugins: 10 (a@m, b@m, c@m, d@m, e@m, f@m, g@m, h@m)',
      '  skills: 3; MCP servers: jira, sentry; agents: 2',
      '  CLAUDE.md files: ~/work/CLAUDE.md, <repo>/CLAUDE.md; global ~/.claude/CLAUDE.md: yes; memories: 3',
    ])
  })
})

describe('runInit', () => {
  test('a guard that refuses ends init with its text before any question or scan', async () => {
    const run = memIo(memWorld({}), RUN_ANSWERS)
    expect(await runInit(run.io, { dryRun: true })).toBe('cadre init needs a git repo: run git init first')
    expect(run.asked).toEqual([])
    expect(run.listed).toEqual([])
  })

  test('after the guard the first question is the ~/.claude.json consent with its two options', async () => {
    const run = memIo(gitWorld(), RUN_ANSWERS)
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
    const declined = memIo(gitWorld({ files }), RUN_ANSWERS)
    await runInit(declined.io, { dryRun: true })
    expect(declined.reads).not.toContain('/home/u/.claude.json')
    const allowed = memIo(gitWorld({ files }), { ...RUN_ANSWERS, 'Read ~/.claude.json': 'Yes, read names only' })
    await runInit(allowed.io, { dryRun: true })
    expect(allowed.reads.filter(path => path === '/home/u/.claude.json')).toHaveLength(1)
  })

  test('a dismissed consent cancels init before any scan', async () => {
    const run = memIo(gitWorld(), {})
    expect(await runInit(run.io, { dryRun: true })).toBe(INIT_CANCELLED)
    expect(run.asked).toEqual([CLAUDE_JSON_QUESTION])
    expect(run.listed).toEqual([])
    expect(run.reads).toEqual([STATUS_PATH])
  })

  test('right after the consent init logs the repo scan and the user setup, before the next question', async () => {
    const run = memIo(gitWorld(), RUN_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    expect(events[0]).toBe(`ask ${CLAUDE_JSON_QUESTION}`)
    expect(events[1]?.startsWith('log Repo scan (read-only):\n')).toBe(true)
    expect(events[1]).toContain('\nUser setup (names only):\n')
  })

  test('after the summary init shows the roles proposed from the repo scan and asks the roles question', async () => {
    const run = memIo(gitWorld(), RUN_ANSWERS)
    const { io, events } = withEvents(run)
    await runInit(io, { dryRun: true })
    const proposal = proposeRoles(await scanRepo(memIo(gitWorld(), {}).io, '/repo'))
    expect(events[2]).toBe(`log ${proposalLines(proposal.roles, proposal.changes).join('\n')}`)
    expect(events[3]).toBe(`ask ${ROLES_QUESTION}`)
  })

  test('a dismissed roles question cancels init', async () => {
    const answers = Object.fromEntries(Object.entries(RUN_ANSWERS).filter(([key]) => key !== 'Use these roles?'))
    const run = memIo(gitWorld(), answers)
    expect(await runInit(run.io, { dryRun: true })).toBe(INIT_CANCELLED)
    expect(run.asked).toEqual([CLAUDE_JSON_QUESTION, ROLES_QUESTION])
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
    const adjusted = await adjustLoop(run.io, roles)
    expect(adjusted?.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'qa', 'security', 'docs'])
    expect(adjusted?.find(role => role.id === 'docs')?.title).toBe('Docs writer')
    expect(run.asked).toEqual([ADJUST_QUESTION, ADJUST_QUESTION, ADJUST_QUESTION])
    expect(run.specs[0]).toEqual({ options: ['Done adjusting', 'Show the roles'] })
  })

  test('rename and framework change one role and keep the others', async () => {
    const run = memIo(memWorld({}), ['rename be api "API"', 'framework qa gsd', 'Done adjusting'])
    const adjusted = await adjustLoop(run.io, roles)
    expect(adjusted?.map(role => role.id)).toEqual(['pm', 'tl', 'api', 'fe', 'qa', 'security'])
    expect(adjusted?.find(role => role.id === 'api')?.title).toBe('API')
    expect(adjusted?.find(role => role.id === 'qa')?.framework).toBe('gsd')
    expect(adjusted?.filter(role => role.framework !== undefined)).toHaveLength(1)
  })

  test('a line it cannot read and a change it cannot apply each print an exact message', async () => {
    const run = memIo(memWorld({}), ['delete fe', 'drop zz', 'Done adjusting'])
    expect(await adjustLoop(run.io, roles)).toEqual(roles)
    expect(run.logged).toEqual([
      'Could not read that change: delete fe. Use add, drop, rename or framework.',
      'no role "zz"',
    ])
  })

  test('Show the roles prints the current roles and asks again', async () => {
    const run = memIo(memWorld({}), ['drop fe', 'Show the roles', 'Done adjusting'])
    await adjustLoop(run.io, roles)
    const [shown] = run.logged
    expect(shown?.startsWith('Proposed roles:\n')).toBe(true)
    expect(shown).not.toContain('FE (fe)')
    expect(shown).not.toContain('Changes from the scan:')
  })

  test('a dismissed adjust question cancels, and after 30 rounds the current roles are kept', async () => {
    expect(await adjustLoop(memIo(memWorld({}), ['drop fe']).io, roles)).toBeNull()
    const run = memIo(memWorld({}), Array.from({ length: 31 }, () => 'delete fe'))
    expect(await adjustLoop(run.io, roles)).toEqual(roles)
    expect(run.asked).toHaveLength(30)
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
    expect(await rolesStep(run.io, proposal)).toEqual(proposal.roles)
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
    const roles = await rolesStep(run.io, proposal)
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
    expect(await rolesStep(run.io, proposal)).toEqual(proposal.roles)
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
    expect(await rolesStep(run.io, proposal)).toEqual(proposal.roles)
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
    await rolesStep(run.io, proposeRoles(gathered.repo))
    expect(run.prompts).toHaveLength(1)
    expect(run.prompts[0]).toContain(JSON.stringify(DESCRIPTION))
    expect(leaks(run.prompts.join('\n'), ['sentry', '/repo', '/home/u'])).toEqual([])
  })

  test('Adjust them adjusts the roles and asks the roles question again with them', async () => {
    const full = proposeRoles(FULL_SCAN)
    const answers = ['Adjust them', 'drop fe', 'add docs "Docs writer"', 'Done adjusting', 'Use these roles']
    const run = memIo(memWorld({}), answers)
    const roles = await rolesStep(run.io, full)
    expect(roles?.map(role => role.id)).toEqual(['pm', 'tl', 'be', 'qa', 'security', 'docs'])
    expect(run.asked.filter(question => question === ROLES_QUESTION)).toHaveLength(2)
    expect(run.logged.at(-1)).toContain('Docs writer (docs)')
  })

  test('a dismissed dialog at any point of the step returns null', async () => {
    const scripts = [[], ['Adjust them'], ['Describe my own structure'], ['Describe my own structure', 'Cancel init']]
    for (const answers of scripts) {
      expect(await rolesStep(memIo(memWorld({}), answers).io, proposal)).toBeNull()
    }
  })

  test('after 10 rounds of the roles question the current roles are kept', async () => {
    const answers = Array.from({ length: 11 }, () => ['Adjust them', 'Done adjusting']).flat()
    const run = memIo(memWorld({}), answers)
    expect(await rolesStep(run.io, proposal)).toEqual(proposal.roles)
    expect(run.asked.filter(question => question === ROLES_QUESTION)).toHaveLength(10)
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

  test('the git policy options are listed default, all, ignore, frozen, and each parses to its own policy', () => {
    expect(GIT_POLICY_OPTIONS).toEqual(['Commit definitions (default)', 'Commit all', 'Ignore all of .cadre/'])
    expect(Object.isFrozen(GIT_POLICY_OPTIONS)).toBe(true)
    expect(GIT_POLICY_OPTIONS.map(option => parseGitPolicy(option))).toEqual(['definitions', 'all', 'ignore'])
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
