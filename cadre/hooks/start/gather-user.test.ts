import { describe, expect, test } from 'claude-code/testing'

import type { HostRun, InitLocations, LaunchStart, RoleSpec, ScopeContext } from '../../types'
import { sha256Hex } from '../core/hash'
import { isObject } from '../core/json'
import { GIT_COMMON_DIR_ARGV } from '../git/common-dir'
import type { LaunchUser } from '../launch/links'
import { launchPlan } from '../launch/plan'
import { inboxDirOf, inboxHomeOf } from '../paths'
import { GRILL_SKILLS, MATTPOCOCK_PLUGIN } from '../roles/infra'
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
  privateFolderRefusal,
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
      inboxDir: inboxDirOf(inboxHomeOf('/home/u/.claude', '/repo', await sha256Hex('/repo')), 'be'),
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
      inboxDir: inboxDirOf(inboxHomeOf('/cfg', '/repo', await sha256Hex('/repo')), 'be'),
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

  test('a link at the inbox tree in the user folder refuses with the private folder refusal naming it', async () => {
    const tree = '/home/u/.claude/cadre/inboxes'
    const dirs = {
      '/repo/.git': [],
      '/home/u/.claude': [entry('cadre', 'dir')],
      '/home/u/.claude/cadre': [entry('inboxes', 'dir')],
      [tree]: [],
    }
    const linkedTree = { ...dirs, '/home/u/.claude/cadre': [link('inboxes')] }
    const byStat = await gather(repoWorld({ dirs, realPaths: { [tree]: '/elsewhere/inboxes' } }), [GIT_OK])
    const byListing = await gather(repoWorld({ dirs: linkedTree }), [GIT_OK])
    const refusal = { kind: 'refuse', text: privateFolderRefusal('~/.claude/cadre/inboxes', 'link') }

    expect([byStat.read, byListing.read]).toEqual([refusal, refusal])
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

describe('the start folder of a launch', () => {
  test('a dir start sets startDir to its folder; a git-root or here start sets none', async () => {
    const dir = await gatheredUser(repoWorld(), { kind: 'dir', path: 'src' })
    const root = await gatheredUser(repoWorld())
    const here = await gatheredUser(repoWorld(), { kind: 'here' })

    expect(dir.startDir).toBe('src')
    expect(['startDir' in root, 'startDir' in here]).toEqual([false, false])
  })
})

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

/** The fixture user's installed_plugins.json. */
const INSTALLED_PLUGINS = '/home/u/.claude/plugins/installed_plugins.json'

/** Where the fixture's mattpocock-skills is installed, as installed_plugins.json records it. */
const MATT_PATH = '/u/.claude/plugins/cache/x/mattpocock-skills/1.3.1'

/** The skills the fixture plugin.json lists: three paths and one bare name. */
const MATT_SKILLS = [
  './skills/productivity/grilling',
  './skills/productivity/grill-me',
  './skills/engineering/tdd',
  'to-spec',
]

/** installed_plugins.json with these entries for the mattpocock-skills key. */
function installedText(entries: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ version: 2, plugins: { [MATTPOCOCK_PLUGIN]: entries } })
}

/** The plugin.json of the plugin installed at `path`, listing `skills`. */
function manifestAt(path: string, skills: unknown): Record<string, string> {
  return { [`${path}/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'mattpocock-skills', skills }) }
}

/** The files of mattpocock-skills installed at user scope at MATT_PATH, its plugin.json listing `skills`. */
function userInstall(skills: unknown): Record<string, string> {
  return {
    [INSTALLED_PLUGINS]: installedText([{ scope: 'user', installPath: MATT_PATH, version: '1.3.1' }]),
    ...manifestAt(MATT_PATH, skills),
  }
}

/** The files of mattpocock-skills installed for the project at `projectPath`, at MATT_PATH, listing MATT_SKILLS. */
function projectInstall(projectPath: string): Record<string, string> {
  return {
    [INSTALLED_PLUGINS]: installedText([{ scope: 'project', projectPath, installPath: MATT_PATH, version: '1.3.1' }]),
    ...manifestAt(MATT_PATH, MATT_SKILLS),
  }
}

/** A start in the worktree /repo/.claude/worktrees/proj-1, nested in the main checkout /repo. */
const WORKTREE: InitLocations = {
  ...DEFAULT_LOCATIONS,
  root: '/repo/.claude/worktrees/proj-1',
  givenRoot: '/repo/.claude/worktrees/proj-1',
}

/** The launch user gathered in WORKTREE over `world`. */
async function worktreeUser(world: MemWorld): Promise<LaunchUser> {
  return userOf((await gather(world, [GIT_OK], WORKTREE)).read)
}

describe('the plugin skills and project plugins a launch reads', () => {
  test('pluginSkills holds the skill names of the installed plugin.json, sorted and once each', async () => {
    const gathered = await gatheredUser(repoWorld({ files: userInstall([...MATT_SKILLS, 'tdd']) }))

    expect(gathered.pluginSkills).toEqual({ [MATTPOCOCK_PLUGIN]: ['grill-me', 'grilling', 'tdd', 'to-spec'] })
  })

  test('the entry for this repo wins over the user one, and another project is never used', async () => {
    const repoPath = '/repo-install/mattpocock-skills/1.3.1'
    const otherPath = '/other-install/mattpocock-skills/1.3.1'
    const entries = [
      { scope: 'user', installPath: MATT_PATH, version: '1.3.1' },
      { scope: 'project', projectPath: '/elsewhere', installPath: otherPath, version: '1.3.1' },
      { scope: 'project', projectPath: '/repo/', installPath: repoPath, version: '1.3.1' },
    ]
    const files = {
      [INSTALLED_PLUGINS]: installedText(entries),
      ...manifestAt(MATT_PATH, ['grill-me']),
      ...manifestAt(otherPath, ['tdd']),
      ...manifestAt(repoPath, ['grilling']),
    }
    const onlyOther = { ...files, [INSTALLED_PLUGINS]: installedText(entries.slice(1, 2)) }

    expect((await gatheredUser(repoWorld({ files }))).pluginSkills).toEqual({ [MATTPOCOCK_PLUGIN]: ['grilling'] })
    expect('pluginSkills' in (await gatheredUser(repoWorld({ files: onlyOther })))).toBe(false)
  })

  test('a worktree nested in the main checkout reads the install for the main checkout', async () => {
    const gathered = await worktreeUser(repoWorld({ files: projectInstall('/repo') }))

    expect([gathered.mainRoot, gathered.pluginSkills]).toEqual([
      '/repo',
      { [MATTPOCOCK_PLUGIN]: ['grill-me', 'grilling', 'tdd', 'to-spec'] },
    ])
  })

  test('a worktree never reads the install of another project; the main checkout reads its own', async () => {
    const elsewhere = await worktreeUser(repoWorld({ files: projectInstall('/elsewhere') }))
    const main = await gatheredUser(repoWorld({ files: projectInstall('/repo') }))

    expect('pluginSkills' in elsewhere).toBe(false)
    expect(main.pluginSkills).toEqual({ [MATTPOCOCK_PLUGIN]: ['grill-me', 'grilling', 'tdd', 'to-spec'] })
  })

  test("PM's runtime in such a worktree keeps the plugin on and allows only the grill skills", async () => {
    const gathered = await worktreeUser(repoWorld({ files: projectInstall('/repo') }))
    const pm = templateRole('pm', { skills: [...GRILL_SKILLS] })
    const setup = emptySetupScan({ plugins: [MATTPOCOCK_PLUGIN] })
    const plan = launchPlan(pm, compileScope(pm, { ...context(), framework: 'none', setup }), gathered)
    const plugins = isObject(plan.settings.enabledPlugins) ? plan.settings.enabledPlugins : {}
    const permissions = plan.settings.permissions
    const deny: readonly unknown[] = isObject(permissions) && Array.isArray(permissions.deny) ? permissions.deny : []

    expect(plugins[MATTPOCOCK_PLUGIN]).toBe(true)
    expect(deny).toContain('Skill(mattpocock-skills:tdd)')
    expect(deny).toContain('Skill(mattpocock-skills:to-spec)')
    for (const skill of GRILL_SKILLS) expect(deny).not.toContain(`Skill(${skill})`)
    expect(plan.warnings.filter(warning => warning.includes(MATTPOCOCK_PLUGIN))).toEqual([])
  })

  test('a list read from objects with a name counts like one read from paths', async () => {
    const gathered = await gatheredUser(repoWorld({ files: userInstall([{ name: 'grilling' }, './skills/x/tdd']) }))

    expect(gathered.pluginSkills).toEqual({ [MATTPOCOCK_PLUGIN]: ['grilling', 'tdd'] })
  })

  test('a list it cannot read whole gives no entry for the plugin: it fails closed', async () => {
    const lists: readonly unknown[] = [
      undefined,
      'grilling',
      [],
      ['grilling', 7],
      ['grilling', { title: 'tdd' }],
      ['grilling', 'Grill-Me'],
      ['grilling', './skills/x/'],
      ['grilling', '-tdd'],
      ['grilling', `a${'b'.repeat(64)}`],
    ]
    for (const skills of lists) {
      const gathered = await gatheredUser(repoWorld({ files: userInstall(skills) }))

      expect([skills, 'pluginSkills' in gathered]).toEqual([skills, false])
    }
    const notJson = { ...userInstall(['grilling']), [`${MATT_PATH}/.claude-plugin/plugin.json`]: '{"skills": [' }
    const noManifest = { [INSTALLED_PLUGINS]: userInstall(['grilling'])[INSTALLED_PLUGINS] ?? '' }
    const relativePath = installedText([{ scope: 'user', installPath: 'x' }])
    const relative = { ...userInstall(['grilling']), [INSTALLED_PLUGINS]: relativePath }
    for (const files of [notJson, noManifest, relative]) {
      expect('pluginSkills' in (await gatheredUser(repoWorld({ files })))).toBe(false)
    }
  })

  test('projectPlugins are the enabledPlugins keys the repo settings turn on', async () => {
    const enabledPlugins = { [MATTPOCOCK_PLUGIN]: true, 'off@m': false, 'odd@m': 'yes', 'tool@m': true }
    const files = { '/repo/.claude/settings.json': JSON.stringify({ enabledPlugins }) }

    expect((await gatheredUser(repoWorld({ files }))).projectPlugins).toEqual([MATTPOCOCK_PLUGIN, 'tool@m'])
  })

  test('with no install and no repo settings the user has neither field', async () => {
    const gathered = await gatheredUser(repoWorld())
    const files = { '/repo/.claude/settings.json': '{"enabledPlugins": [' }
    const malformed = await gatheredUser(repoWorld({ files }))

    expect([gathered, malformed].map(read => ['pluginSkills' in read, 'projectPlugins' in read])).toEqual([
      [false, false],
      [false, false],
    ])
  })
})
