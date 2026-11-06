import { describe, expect, test } from 'claude-code/testing'

import type { HostRun, InitLocations, LaunchStart, RoleSpec, ScopeContext } from '../../types'
import { sha256Hex } from '../core/hash'
import { GIT_COMMON_DIR_ARGV } from '../git/common-dir'
import type { LaunchUser } from '../launch/links'
import { launchPlan } from '../launch/plan'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { compileScope } from '../scope/compile'
import {
  DEFAULT_LOCATIONS,
  emptySetupScan,
  entry,
  hostWorld,
  leaks,
  link,
  memHost,
  memIo,
  memWorld,
  ROOT,
  SECRET_FIXTURES,
  secretUserSettings,
  secretWorld,
  templateRole,
} from '../testkit'
import type { HostCall, HostRunRule, MemWorld } from '../testkit'
import {
  gatherLaunchUser,
  hookSourcesFor,
  launchHooksOf,
  launchSettingsOf,
  START_NO_GIT_DIR,
  START_NO_HOME,
} from './gather-user'
import type { LaunchUserRead } from './gather-user'
import { NO_MEMORY_LINKS } from './render-plan'

/** The launching user of the fixtures: repo /repo, home /home/u, nothing to carry or link; `over` changes fields. */
function user(over: Partial<LaunchUser> = {}): LaunchUser {
  return {
    root: ROOT,
    givenRoot: ROOT,
    home: '/home/u',
    userDir: '/home/u/.claude',
    gitCommonDir: '/repo/.git',
    commonDirHash: `1a2b3c4d${'0'.repeat(56)}`,
    autoCompactWindow: null,
    statusLine: null,
    env: {},
    hooks: [],
    claudeMd: [],
    rules: [],
    roleClaudeMds: [],
    globalClaudeMd: [],
    memoryFiles: [],
    givenMemoryFiles: [],
    userSkills: [],
    userAgents: [],
    codeDirs: [],
    linkedMemories: [],
    ...over,
  }
}

/** A scope context for the GSD framework, the merged MCP route and a git-root start. */
function context(): ScopeContext {
  return {
    framework: 'gsd',
    setup: emptySetupScan(),
    codeDirs: [],
    isAttended: false,
    mcpRoute: 'merged',
    launchStart: { kind: 'git-root' },
    roles: ['pm', 'be'],
  }
}

/** The BE role of the template. */
const BE = templateRole('be')

/** The argv that asks git for the absolute common dir of the repo (D-98). */
const GIT_ARGV = ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir']

/** A fake host rule that answers the git argv with this run; null is a run the host rejected. */
function gitRule(result: HostRun | null): HostRunRule {
  return { argv: GIT_ARGV, result }
}

/** The git run of the fixture repo: git answers /repo/.git, with its line break. */
const GIT_OK = gitRule({ exitCode: 0, stdout: '/repo/.git\n', stderr: '' })

/** A launcher start at the git root. */
const GIT_ROOT: LaunchStart = { kind: 'git-root' }

/** A git repo at /repo whose .git folder is there; `over` changes the fields it names. */
function repoWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ dirs: { '/repo/.git': [] }, ...over })
}

/** What gatherLaunchUser gave, and every run the fake host was asked for. */
type GatherRun = {
  readonly read: LaunchUserRead
  readonly calls: readonly HostCall[]
}

/**
 * gatherLaunchUser over `world` with these run rules, for these locations, this launcher start, these code dirs and
 * this role (BE, a parts-flow role, unless told otherwise).
 */
async function gather(
  world: MemWorld,
  runs: readonly HostRunRule[],
  locations: InitLocations = DEFAULT_LOCATIONS,
  launchStart: LaunchStart = GIT_ROOT,
  codeDirs: readonly string[] = [],
  role: RoleSpec = BE,
): Promise<GatherRun> {
  const host = memHost(hostWorld({ runs }))
  const read = await gatherLaunchUser(memIo(world, {}).io, host.io, { locations, launchStart, codeDirs, role })

  return { read, calls: host.calls }
}

/** The user of a read that went on; a refusal stops the test with its text. */
function userOf(read: LaunchUserRead): LaunchUser {
  if (read.kind === 'refuse') throw new Error(`gatherLaunchUser refused: ${read.text}`)

  return read.user
}

describe('gatherLaunchUser (D-98)', () => {
  test('the git argv is frozen, and the two refusals have their fixed texts', () => {
    expect(GIT_COMMON_DIR_ARGV).toEqual(GIT_ARGV)
    expect(Object.isFrozen(GIT_COMMON_DIR_ARGV)).toBe(true)
    expect(START_NO_HOME).toBe('cadre start needs HOME to render the role files, so it stopped.')
    expect(START_NO_GIT_DIR).toBe(
      'cadre start could not read the git common dir (git rev-parse failed or gave no absolute path; ' +
        'git 2.31 or newer is needed), so it stopped.',
    )
  })

  test('the user comes from the locations, the user folder and the common dir git gives at the root', async () => {
    const { read, calls } = await gather(repoWorld(), [GIT_OK], DEFAULT_LOCATIONS, GIT_ROOT, ['src'])
    const commonDirHash = await sha256Hex('/repo/.git')

    expect(read).toEqual({
      kind: 'ok',
      user: user({ commonDirHash, codeDirs: ['src'] }),
      warnings: [],
      memories: NO_MEMORY_LINKS,
    })
    expect(calls).toEqual([{ argv: GIT_ARGV, options: { cwd: '/repo', timeoutMs: 10_000 } }])
  })

  test('the common dir is its stat realpath, else as git gave it; CLAUDE_CONFIG_DIR is the user folder', async () => {
    const locations = { ...DEFAULT_LOCATIONS, givenRoot: '/link/repo', configDir: '/cfg' }
    const linked = repoWorld({ realPaths: { '/repo/.git': '/data/repo/.git' } })
    const resolved = await gather(linked, [GIT_OK], locations)

    expect(resolved.read).toEqual({
      kind: 'ok',
      user: user({
        givenRoot: '/link/repo',
        userDir: '/cfg',
        gitCommonDir: '/data/repo/.git',
        commonDirHash: await sha256Hex('/data/repo/.git'),
      }),
      warnings: [],
      memories: NO_MEMORY_LINKS,
    })
    const unresolved = userOf((await gather(memWorld({}), [GIT_OK])).read)
    expect([unresolved.gitCommonDir, unresolved.commonDirHash]).toEqual(['/repo/.git', await sha256Hex('/repo/.git')])
  })

  test(
    'a relative or inside-repo CLAUDE_CONFIG_DIR gives ~/.claude and no warning: ' +
      'the setup scan of the run shows it (D-238, WF-S3)',
    async () => {
      for (const configDir of ['.claude-alt', '/repo/.claude-alt']) {
        const { read } = await gather(repoWorld(), [GIT_OK], { ...DEFAULT_LOCATIONS, configDir })

        expect(read.kind === 'ok' ? [read.user.userDir, read.warnings] : read).toEqual(['/home/u/.claude', []])
      }
    },
  )

  test(
    'in a worktree nested in the main checkout, a CLAUDE_CONFIG_DIR inside main is ignored (WF-S4, D-238)',
    async () => {
      const WT = '/repo/.claude/worktrees/proj-1'
      const locations = { ...DEFAULT_LOCATIONS, root: WT, givenRoot: WT, configDir: '/repo/.claude-alt' }
      const user = userOf((await gather(repoWorld(), [GIT_OK], locations)).read)

      expect([user.userDir, user.mainRoot]).toEqual(['/home/u/.claude', '/repo'])
    },
  )

  test('two roles of one repo get their own memory folders under the repo slug (D-20, D-91, ISO-03)', async () => {
    const gathered = userOf((await gather(repoWorld(), [GIT_OK])).read)
    const slug = `repo-${(await sha256Hex('/repo/.git')).slice(0, 8)}`
    const be = templateRole('be')
    const pm = templateRole('pm')
    const beDir = launchPlan(be, compileScope(be, context()), gathered).settings.autoMemoryDirectory
    const pmDir = launchPlan(pm, compileScope(pm, context()), gathered).settings.autoMemoryDirectory

    expect(beDir).toBe(`/home/u/.claude/cadre/${slug}/be`)
    expect(pmDir).toBe(`/home/u/.claude/cadre/${slug}/pm`)
    expect(beDir).not.toBe(pmDir)
  })

  test('no HOME refuses before any run, even with CLAUDE_CONFIG_DIR set', async () => {
    for (const configDir of [null, '/cfg']) {
      const { read, calls } = await gather(repoWorld(), [GIT_OK], { ...DEFAULT_LOCATIONS, home: null, configDir })

      expect([configDir, read, calls]).toEqual([configDir, { kind: 'refuse', text: START_NO_HOME }, []])
    }
  })

  test('a git run that exits non-zero, is rejected or gives no absolute path refuses', async () => {
    const cases: readonly (readonly HostRunRule[])[] = [
      [gitRule({ exitCode: 1, stdout: '/repo/.git\n', stderr: 'fatal: not a git repository' })],
      [gitRule(null)],
      [gitRule({ exitCode: 0, stdout: 'repo/.git\n', stderr: '' })],
      [gitRule({ exitCode: 0, stdout: ' /repo/.git\n', stderr: '' })],
      [],
    ]
    for (const [index, runs] of cases.entries()) {
      const { read } = await gather(repoWorld(), runs)

      expect([index, read]).toEqual([index, { kind: 'refuse', text: START_NO_GIT_DIR }])
    }
  })

  test('the rule files are the .md files and links of .claude/rules, absolute and sorted (G-02-1f)', async () => {
    const rules = [entry('style.md'), entry('notes.txt'), entry('linked.md', 'other', true), entry('drafts', 'dir')]
    const world = repoWorld({ dirs: { '/repo/.git': [], '/repo/.claude/rules': [entry('security.md'), ...rules] } })
    const gathered = userOf((await gather(world, [GIT_OK])).read)

    expect(gathered.rules).toEqual([
      '/repo/.claude/rules/linked.md',
      '/repo/.claude/rules/security.md',
      '/repo/.claude/rules/style.md',
    ])
  })

  test('rule files in sub-folders of .claude/rules are listed, links taken, a failed folder skipped (M4)', async () => {
    const world = repoWorld({
      dirs: {
        '/repo/.git': [],
        '/repo/.claude/rules': [entry('security.md'), entry('frontend', 'dir'), link('shared'), entry('gone', 'dir')],
        '/repo/.claude/rules/frontend': [entry('react.md'), entry('notes.txt')],
        '/repo/.claude/rules/shared': [entry('team.md')],
      },
      realPaths: { '/repo/.claude/rules/shared': '/team/rules' },
    })
    const gathered = userOf((await gather(world, [GIT_OK])).read)

    expect(gathered.rules).toEqual([
      '/repo/.claude/rules/frontend/react.md',
      '/repo/.claude/rules/security.md',
      '/repo/.claude/rules/shared/team.md',
    ])
  })

  test('the built role files are the CLAUDE.md of every .cadre folder that has one, stale ones too', async () => {
    const world = repoWorld({
      dirs: {
        '/repo/.git': [],
        '/repo/.cadre': [entry('be', 'dir'), entry('old', 'dir'), entry('pm', 'dir'), entry('INDEX.md')],
        '/repo/.cadre/be': [entry('CLAUDE.md'), entry('ROLE.md')],
        '/repo/.cadre/old': [entry('CLAUDE.md', 'other', true)],
        '/repo/.cadre/pm': [entry('ROLE.md'), entry('notes', 'dir')],
      },
    })
    const gathered = userOf((await gather(world, [GIT_OK])).read)

    expect(gathered.roleClaudeMds).toEqual(['/repo/.cadre/be/CLAUDE.md', '/repo/.cadre/old/CLAUDE.md'])
  })

  test('a listing that fails or a folder that is not there gives no rule file and no built file', async () => {
    const missing = userOf((await gather(repoWorld(), [GIT_OK])).read)
    const unknownPaths = ['/repo/.claude/rules', '/repo/.cadre']
    const unknown = userOf((await gather(repoWorld({ unknownPaths }), [GIT_OK])).read)

    expect([missing.rules, missing.roleClaudeMds, unknown.rules, unknown.roleClaudeMds]).toEqual([[], [], [], []])
  })
})

/** The command of the GSD secret read guard in the user settings of secretUserSettings. */
const USER_GUARD = 'SECRET=SENTINEL_SECRET_VALUE node /home/u/.claude/hooks/gsd-secret-read-guard.js'

/** The command of the secret read guard that the project settings register on Read (D-103). */
const PROJECT_GUARD = 'node /repo/.claude/hooks/gsd-secret-read-guard.js'

/** Project settings that register the secret read guard on Read. */
const PROJECT_GUARD_SETTINGS = {
  hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: PROJECT_GUARD }] }] },
}

/** The secret world with the project settings holding the guard too (D-103). */
function guardedWorld(): MemWorld {
  return secretWorld({ settings: { user: secretUserSettings(), project: PROJECT_GUARD_SETTINGS, local: {} } })
}

/** A start in the folder apps/web of the repo. */
const DIR_START: LaunchStart = { kind: 'dir', path: 'apps/web' }

/** One hook of a launch user, as launchHooksOf gives it. */
type Hook = LaunchUser['hooks'][number]

/** A hook with no matcher and no timeout; `over` changes the fields it names. */
function hook(event: string, script: string, command: string, over: Partial<Hook> = {}): Hook {
  return { event, script, command, matcher: null, timeout: null, ...over }
}

/** The two hooks of secretUserSettings: the guard and the user's own hook, with their whole commands. */
const USER_HOOKS: readonly Hook[] = [
  hook('PreToolUse', 'gsd-secret-read-guard.js', USER_GUARD),
  hook('PreToolUse', 'my-hook.sh', '/home/u/bin/my-hook.sh --key ghp_FAKEFAKEFAKEFAKEFAKE'),
]

/** The guard of the project settings as a launch carries it. */
const PROJECT_HOOK = hook('PreToolUse', 'gsd-secret-read-guard.js', PROJECT_GUARD, { matcher: 'Read' })

/** The global CLAUDE.md of the fixture user. */
const GLOBAL_MD = '/home/u/.claude/CLAUDE.md'

/** The launch user gathered in `world` with the git run of the fixture repo, at the git root unless told otherwise. */
async function gatheredUser(world: MemWorld, launchStart: LaunchStart = GIT_ROOT): Promise<LaunchUser> {
  return userOf((await gather(world, [GIT_OK], DEFAULT_LOCATIONS, launchStart)).read)
}

describe('launch user settings (D-103)', () => {
  test('launchSettingsOf carries the compact window, the status line and the string env values of the user', () => {
    const settings = secretUserSettings()

    expect(launchSettingsOf(settings)).toEqual({
      autoCompactWindow: 800000,
      statusLine: settings.statusLine,
      env: { API_KEY: 'sk-FAKE-SECRET-0123456789', JIRA_URL: 'Bearer FAKE-TOKEN-0123' },
    })
  })

  test('launchSettingsOf gives null, null and {} for anything but an object; a non-string env value is dropped', () => {
    const none = { autoCompactWindow: null, statusLine: null, env: {} }
    for (const value of [null, [], 'x', 5]) expect(launchSettingsOf(value)).toEqual(none)
    expect(launchSettingsOf({ env: { A: 'a', B: 1, C: null, D: { x: 'y' } } })).toEqual({ ...none, env: { A: 'a' } })
    for (const window of [0, -1, 1.5, '800000']) {
      expect(launchSettingsOf({ autoCompactWindow: window, statusLine: 'echo' })).toEqual(none)
    }
  })

  test('launchHooksOf gives each command hook with its event, script, whole command, matcher and timeout', () => {
    expect(launchHooksOf(secretUserSettings())).toEqual(USER_HOOKS)
    const group = { matcher: 'Read', hooks: [{ type: 'command', command: 'x.sh', timeout: 5 }] }
    const grouped = { hooks: { PostToolUse: [group] } }
    expect(launchHooksOf(grouped)).toEqual([hook('PostToolUse', 'x.sh', 'x.sh', { matcher: 'Read', timeout: 5 })])
  })

  test('launchHooksOf drops a hook with no script or of another type; a timeout that is not positive is null', () => {
    const groups = [
      {
        hooks: [
          { type: 'command', command: 'echo hi' },
          { type: 'prompt', command: 'a.sh' },
          { command: 'b.sh' },
          { type: 'command', command: 1 },
          { type: 'command', command: 'c.sh', timeout: 0 },
          { type: 'command', command: 'd.sh', timeout: -5 },
          { type: 'command', command: 'e.sh', timeout: '5' },
        ],
      },
      null,
      { hooks: 'not a list' },
      { matcher: 7, hooks: [{ type: 'command', command: 'f.sh' }] },
    ]
    const value = { hooks: { PreToolUse: groups, Stop: 'not a list' } }

    expect(launchHooksOf(value)).toEqual(['c.sh', 'd.sh', 'e.sh', 'f.sh'].map(name => hook('PreToolUse', name, name)))
    expect([null, {}, { hooks: [] }, { hooks: 'x' }].map(launchHooksOf)).toEqual([[], [], [], []])
  })

  test('hookSourcesFor leaves the project settings out at a git-root start, which loads them (Pitfall 9)', () => {
    expect(hookSourcesFor({ kind: 'git-root' })).toEqual(['user', 'local'])
    expect(hookSourcesFor({ kind: 'here' })).toEqual(['user', 'project', 'local'])
    expect(hookSourcesFor(DIR_START)).toEqual(['user', 'project', 'local'])
  })

  test('the user carries the settings, the hooks and the CLAUDE.md chain of the secret world', async () => {
    const settings = secretUserSettings()
    const gathered = await gatheredUser(secretWorld())

    expect([gathered.autoCompactWindow, gathered.statusLine]).toEqual([800000, settings.statusLine])
    expect(gathered.env).toEqual({ API_KEY: 'sk-FAKE-SECRET-0123456789', JIRA_URL: 'Bearer FAKE-TOKEN-0123' })
    expect(gathered.hooks).toEqual(USER_HOOKS)
    expect(gathered.claudeMd).toEqual(['/repo/CLAUDE.md'])
    expect(gathered.globalClaudeMd).toEqual([GLOBAL_MD])
    expect([gathered.memoryFiles, gathered.givenMemoryFiles]).toEqual([['notes.md'], ['notes.md']])
  })

  test('the guard of the project settings is carried for a dir start, not for a git-root start (D-103)', async () => {
    expect((await gatheredUser(guardedWorld(), DIR_START)).hooks).toEqual([...USER_HOOKS, PROJECT_HOOK])
    expect((await gatheredUser(guardedWorld(), { kind: 'here' })).hooks).toEqual([...USER_HOOKS, PROJECT_HOOK])
    expect((await gatheredUser(guardedWorld())).hooks).toEqual(USER_HOOKS)
    const local = secretWorld({ settings: { user: {}, project: {}, local: PROJECT_GUARD_SETTINGS } })
    expect((await gatheredUser(local)).hooks).toEqual([PROJECT_HOOK])
  })

  test('the rendered settings of a role that carries the guard hold its whole command (runtime only)', async () => {
    const be = templateRole('be')
    const carrier = { ...be, carry: { ...be.carry, hooks: ['gsd-secret-read-guard.js'] } }
    const scope = compileScope(carrier, context())
    const atRoot = launchPlan(carrier, scope, await gatheredUser(guardedWorld())).settings
    const inDir = launchPlan(carrier, scope, await gatheredUser(guardedWorld(), DIR_START)).settings
    const userGroup = { hooks: [{ type: 'command', command: USER_GUARD }] }

    expect(atRoot.hooks).toEqual({ PreToolUse: [userGroup] })
    expect(inDir.hooks).toEqual({
      PreToolUse: [userGroup, { matcher: 'Read', hooks: [{ type: 'command', command: PROJECT_GUARD }] }],
    })
  })

  test('globalClaudeMd follows the imports of the global CLAUDE.md once each, a cycle too; files only', async () => {
    const files = {
      [GLOBAL_MD]: 'Read @./rules.md, @./missing.md and @./notes.md first.',
      '/home/u/.claude/rules.md': 'See @./CLAUDE.md again.',
    }
    const dirs = { '/repo/.git': [], '/home/u/.claude/notes.md': [] }

    const followed = await gatheredUser(repoWorld({ files, dirs }))
    expect(followed.globalClaudeMd).toEqual([GLOBAL_MD, '/home/u/.claude/rules.md'])
    expect((await gatheredUser(repoWorld({ dirs: { '/repo/.git': [], [GLOBAL_MD]: [] } }))).globalClaudeMd).toEqual([])
  })

  test('globalClaudeMd goes breadth first; a file it cannot read is kept, with no imports', async () => {
    const files = {
      [GLOBAL_MD]: '@./a.md @./b.md',
      '/home/u/.claude/a.md': '@./c.md',
      '/home/u/.claude/b.md': '@./d.md',
      '/home/u/.claude/c.md': 'c',
      '/home/u/.claude/d.md': 'd',
    }
    const order = ['a', 'b', 'c', 'd'].map(name => `/home/u/.claude/${name}.md`)
    expect((await gatheredUser(repoWorld({ files }))).globalClaudeMd).toEqual([GLOBAL_MD, ...order])
    const tooLarge = { [GLOBAL_MD]: `@./a.md ${'x'.repeat(MAX_READ_BYTES)}`, '/home/u/.claude/a.md': 'a' }
    expect((await gatheredUser(repoWorld({ files: tooLarge }))).globalClaudeMd).toEqual([GLOBAL_MD])
  })

  test('globalClaudeMd follows at most 5 import hops and keeps at most 20 files', async () => {
    const chain: Record<string, string> = { [GLOBAL_MD]: '@./a1.md' }
    for (let level = 1; level <= 6; level += 1) chain[`/home/u/.claude/a${level}.md`] = `@./a${level + 1}.md`
    const hops = [1, 2, 3, 4, 5].map(level => `/home/u/.claude/a${level}.md`)
    expect((await gatheredUser(repoWorld({ files: chain }))).globalClaudeMd).toEqual([GLOBAL_MD, ...hops])

    const names = Array.from({ length: 25 }, (_, index) => `/home/u/.claude/b${String(index + 1).padStart(2, '0')}.md`)
    const imports = names.map(path => `@${path}`).join('\n')
    const wide = { [GLOBAL_MD]: imports, ...Object.fromEntries(names.map(path => [path, 'b'])) }
    expect((await gatheredUser(repoWorld({ files: wide }))).globalClaudeMd).toEqual([GLOBAL_MD, ...names.slice(0, 19)])
  })

  test('memory files, user skills and user agents are listed from the user folder, by kind', async () => {
    const dirs = {
      '/repo/.git': [],
      '/home/u/.claude/projects/-repo/memory': [
        entry('notes.md'),
        entry('MEMORY.md'),
        entry('old.txt'),
        entry('sub.md', 'dir'),
        entry('linked.md', 'file', true),
      ],
      '/home/u/.claude/projects/-link-repo/memory': [entry('given.md')],
      '/home/u/.claude/skills': [entry('create-handoff-doc', 'dir'), link('linked-skill'), entry('README.md')],
      '/home/u/.claude/agents': [entry('reviewer.md'), entry('notes.txt'), entry('folder.md', 'dir'), link('x.md')],
    }
    const locations = { ...DEFAULT_LOCATIONS, givenRoot: '/link/repo' }
    const gathered = userOf((await gather(repoWorld({ dirs }), [GIT_OK], locations)).read)

    expect([gathered.memoryFiles, gathered.givenMemoryFiles]).toEqual([['MEMORY.md', 'notes.md'], ['given.md']])
    expect(gathered.userSkills).toEqual(['create-handoff-doc', 'linked-skill'])
    expect(gathered.userAgents).toEqual(['reviewer'])
  })

  test('no warning or refusal text of gatherLaunchUser holds a secret of the fixtures', async () => {
    const reads = [
      (await gather(guardedWorld(), [GIT_OK], DEFAULT_LOCATIONS, DIR_START)).read,
      (await gather(guardedWorld(), [GIT_OK], { ...DEFAULT_LOCATIONS, home: null })).read,
      (await gather(guardedWorld(), [gitRule({ exitCode: 1, stdout: '', stderr: 'sk-FAKE-SECRET-0123456789' })])).read,
    ]
    const texts = reads.flatMap(read => (read.kind === 'ok' ? read.warnings : [read.text]))

    expect(reads.map(read => read.kind)).toEqual(['ok', 'refuse', 'refuse'])
    expect(leaks(texts.join('\n'), SECRET_FIXTURES)).toEqual([])
  })
})
