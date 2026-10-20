import { describe, expect, test } from 'claude-code/testing'

import type { HostRun, InitLocations, LaunchStart, PortEntry, PortStat, RoleSpec, ScopeContext } from '../types'
import { MAX_READ_BYTES } from './facts'
import { sha256Hex } from './hash'
import { launchPlan } from './launch'
import type { LaunchPlan, LaunchUser, OverlayLink } from './launch'
import { stableJson } from './plan'
import { compileScope } from './scope'
import { CLAUDE_JSON_MAX_BYTES } from './setup'
import {
  gatherLaunchUser,
  GIT_COMMON_DIR_ARGV,
  hookSourcesFor,
  launchHooksOf,
  launchSettingsOf,
  readClaudeJson,
  renderArgv,
  renderPaths,
  renderSteps,
  runtimeFolder,
  runtimeMcpText,
  STALE_LINK_FOLDERS,
  stampText,
  START_NO_GIT_DIR,
  START_NO_HOME,
} from './start'
import type { LaunchUserRead, RenderInput, RenderStep } from './start'
import {
  BIDI_OVERRIDE,
  DEFAULT_LOCATIONS,
  emptySetupScan,
  entry,
  hostWorld,
  leaks,
  link,
  memHost,
  memIo,
  memWorld,
  SECRET_FIXTURES,
  secretUserSettings,
  secretWorld,
  templateRole,
} from './testkit'
import type { HostCall, HostRunRule, MemWorld } from './testkit'

/** The repo root of the fixtures, a realpath. */
const ROOT = '/repo'

/** The folder of the BE role in the fixture repo. */
const ROLE_DIR = '/repo/.cadre/be'

/** The per-launch folder of the BE role (D-102). */
const RUNTIME = '/repo/.cadre/be/.runtime'

/** The MCP config a render writes, as /cadre start passes it. */
const MCP_TEXT = '{\n  "mcpServers": {}\n}\n'

/** The probe expectations a render writes, as /cadre start passes them (D-130). */
const EXPECTATIONS_TEXT = '{"schema":1,"rules":[\n]}\n'

/** The stamp of a render by cadre 0.2.0. */
const STAMP_TEXT = 'rendered by cadre 0.2.0\n'

/** The link of the create-handoff-doc skill into the BE overlay, as launchPlan plans it for a user who has it. */
const SKILL_LINK: OverlayLink = {
  path: '/repo/.cadre/be/.runtime/overlay/.claude/skills/create-handoff-doc',
  target: '/home/u/.claude/skills/create-handoff-doc',
}

/** The link of the resume-handoff-doc skill into the BE overlay. */
const RESUME_LINK: OverlayLink = {
  path: '/repo/.cadre/be/.runtime/overlay/.claude/skills/resume-handoff-doc',
  target: '/home/u/.claude/skills/resume-handoff-doc',
}

/** The link of a memory file of the repo into the BE instructions (D-100). */
const MEMORY_LINK: OverlayLink = {
  path: '/repo/.cadre/be/.runtime/instructions/memory/MEMORY.md',
  target: '/home/u/.claude/projects/-repo/memory/MEMORY.md',
}

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
    globalClaudeMd: [],
    memoryFiles: [],
    givenMemoryFiles: [],
    userSkills: [],
    userAgents: [],
    codeDirs: [],
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

/** The launch plan of BE for a user with no skill, agent or memory to link: it plans no link (D-98). */
const BE_PLAN: LaunchPlan = launchPlan(BE, compileScope(BE, context()), user())

/** A real folder at its own real path. */
function folder(path: string): PortStat {
  return { kind: 'dir', size: 0, isLink: false, realPath: path }
}

/** A regular file at its own real path. */
function regular(path: string): PortStat {
  return { kind: 'file', size: 1, isLink: false, realPath: path }
}

/** The disk of a role whose folder is a real folder inside the repo and holds nothing else; `over` adds stats. */
function disk(over: Readonly<Record<string, PortStat | null>> = {}): ReadonlyMap<string, PortStat | null> {
  return new Map(Object.entries({ [ROLE_DIR]: folder(ROLE_DIR), ...over }))
}

/** A render of the BE plan by cadre 0.2.0 over the disk; `over` changes the fields it names. */
function input(over: Partial<RenderInput> = {}): RenderInput {
  return {
    root: ROOT,
    id: 'be',
    plan: BE_PLAN,
    mcpText: MCP_TEXT,
    expectationsText: EXPECTATIONS_TEXT,
    stampText: stampText('0.2.0'),
    stats: disk(),
    listings: new Map<string, readonly PortEntry[]>(),
    ...over,
  }
}

/** The writes of the settings, the MCP config and the probe expectations of a plan, in render order (D-102). */
function fileWritesOf(plan: LaunchPlan): RenderStep[] {
  return [
    { kind: 'write', path: `${RUNTIME}/settings.json`, text: stableJson(plan.settings) },
    { kind: 'write', path: `${RUNTIME}/mcp.json`, text: MCP_TEXT },
    { kind: 'write', path: `${RUNTIME}/probe-expectations.json`, text: EXPECTATIONS_TEXT },
  ]
}

/** The write of an empty inbox (D-114). */
const INBOX_WRITE: RenderStep = { kind: 'write', path: `${RUNTIME}/inbox.md`, text: '' }

/** The write of the stamp, the last step of every render (LNCH-03). */
const STAMP_WRITE: RenderStep = { kind: 'write', path: `${RUNTIME}/stamp`, text: STAMP_TEXT }

describe('runtime render (D-102)', () => {
  test('runtimeFolder is the .runtime folder of the role under the repo root', () => {
    expect(runtimeFolder('/repo', 'be')).toBe('/repo/.cadre/be/.runtime')
    expect(runtimeFolder('/w/x', 'pm')).toBe('/w/x/.cadre/pm/.runtime')
  })

  test('STALE_LINK_FOLDERS are the four folders under .runtime a render links into, and the list is frozen', () => {
    expect(STALE_LINK_FOLDERS).toEqual([
      'overlay/.claude/skills',
      'overlay/.claude/agents',
      'instructions/global',
      'instructions/memory',
    ])
    expect(Object.isFrozen(STALE_LINK_FOLDERS)).toBe(true)
  })

  test(
    'renderPaths stats the role folder, .runtime, its overlay, the stale-link folders and the five files (#47)',
    () => {
      expect(BE_PLAN.links).toEqual([])
      expect(renderPaths(ROOT, 'be', BE_PLAN)).toEqual({
        stats: [
          ROLE_DIR,
          RUNTIME,
          `${RUNTIME}/inbox.md`,
          `${RUNTIME}/instructions`,
          `${RUNTIME}/instructions/global`,
          `${RUNTIME}/instructions/memory`,
          `${RUNTIME}/mcp.json`,
          `${RUNTIME}/overlay`,
          `${RUNTIME}/overlay/.claude`,
          `${RUNTIME}/overlay/.claude/agents`,
          `${RUNTIME}/overlay/.claude/skills`,
          `${RUNTIME}/probe-expectations.json`,
          `${RUNTIME}/settings.json`,
          `${RUNTIME}/stamp`,
        ],
        listings: [
          `${RUNTIME}/overlay/.claude/skills`,
          `${RUNTIME}/overlay/.claude/agents`,
          `${RUNTIME}/instructions/global`,
          `${RUNTIME}/instructions/memory`,
        ],
      })
    },
  )

  test('renderPaths also stats each folder from .runtime down to a link and each link path, sorted, once each', () => {
    const plan = { ...BE_PLAN, links: [MEMORY_LINK, SKILL_LINK, RESUME_LINK] }

    expect(renderPaths(ROOT, 'be', plan).stats).toEqual([
      ROLE_DIR,
      RUNTIME,
      `${RUNTIME}/inbox.md`,
      `${RUNTIME}/instructions`,
      `${RUNTIME}/instructions/global`,
      `${RUNTIME}/instructions/memory`,
      MEMORY_LINK.path,
      `${RUNTIME}/mcp.json`,
      `${RUNTIME}/overlay`,
      `${RUNTIME}/overlay/.claude`,
      `${RUNTIME}/overlay/.claude/agents`,
      `${RUNTIME}/overlay/.claude/skills`,
      SKILL_LINK.path,
      RESUME_LINK.path,
      `${RUNTIME}/probe-expectations.json`,
      `${RUNTIME}/settings.json`,
      `${RUNTIME}/stamp`,
    ])
  })

  test('a fresh role: .runtime, its overlay, three files, an empty inbox, the stamp last (D-102, D-114)', () => {
    expect(BE_PLAN.links).toEqual([])
    expect(renderSteps(input())).toEqual({
      steps: [
        { kind: 'mkdir', path: RUNTIME },
        { kind: 'mkdir', path: `${RUNTIME}/overlay` },
        ...fileWritesOf(BE_PLAN),
        INBOX_WRITE,
        STAMP_WRITE,
      ],
      warnings: [],
      refusal: null,
    })
  })

  test('stampText names the cadre version that rendered, on one line', () => {
    expect(stampText('0.2.0')).toBe(STAMP_TEXT)
  })

  test('an inbox that is already there is never written again, so a note in it is not lost (D-114, Pitfall 3)', () => {
    const inbox = `${RUNTIME}/inbox.md`
    const stats = disk({ [RUNTIME]: folder(RUNTIME), [inbox]: regular(inbox) })

    expect(renderSteps(input({ stats })).steps).toEqual([
      { kind: 'mkdir', path: RUNTIME },
      { kind: 'mkdir', path: `${RUNTIME}/overlay` },
      ...fileWritesOf(BE_PLAN),
      STAMP_WRITE,
    ])
  })

  test('renderArgv gives absolute argv and no shell; a write has none, since the host writes it', () => {
    const stamp = `${RUNTIME}/stamp`

    expect(renderArgv({ kind: 'mkdir', path: RUNTIME })).toEqual(['/bin/mkdir', '-p', '--', '/repo/.cadre/be/.runtime'])
    expect(renderArgv({ kind: 'remove', path: stamp })).toEqual(['/bin/rm', '-f', '--', stamp])
    expect(renderArgv({ kind: 'link', path: SKILL_LINK.path, target: SKILL_LINK.target })).toEqual([
      '/bin/ln',
      '-sfn',
      SKILL_LINK.target,
      SKILL_LINK.path,
    ])
    expect(renderArgv({ kind: 'write', path: `${RUNTIME}/mcp.json`, text: MCP_TEXT })).toBeNull()
  })

  test('every step of a render lies in the .runtime folder of the role', () => {
    const paths = renderSteps(input()).steps.map(step => step.path)

    expect(paths.length).toBeGreaterThan(0)
    expect(paths.filter(path => path !== RUNTIME && !path.startsWith(`${RUNTIME}/`))).toEqual([])
  })
})

/** The launch plan of BE for a user who has the create-handoff-doc skill: it plans SKILL_LINK and nothing else. */
const LINKED_PLAN: LaunchPlan = launchPlan(
  BE,
  compileScope(BE, context()),
  user({ userSkills: ['create-handoff-doc'] }),
)

/** The skills folder of the BE overlay, which holds SKILL_LINK. */
const SKILLS = `${RUNTIME}/overlay/.claude/skills`

/** A dangling link, as the host stats it: kind other, a link, and no real path. */
const DANGLING: PortStat = { kind: 'other', size: 0, isLink: true }

/** A link to a folder outside the repo, as the host stats it with resolve. */
const LINK_OUT: PortStat = { kind: 'dir', size: 0, isLink: true, realPath: '/elsewhere' }

/** The refusal when the role folder is not a real folder inside the repo. */
const ROLE_REFUSAL = '.cadre/be is not a folder inside this repo: run /cadre regen be'

/** The refusal when .runtime, a folder in it or a file the render writes is not safe to render into. */
const RUNTIME_REFUSAL =
  '.cadre/be/.runtime/ or a folder in it is a link or not a folder: remove it and run /cadre start be again'

/** The disk after an earlier render: the role folder, .runtime and the overlay down to the skills, all real folders. */
function rendered(over: Readonly<Record<string, PortStat | null>> = {}): ReadonlyMap<string, PortStat | null> {
  return disk({
    [RUNTIME]: folder(RUNTIME),
    [`${RUNTIME}/overlay`]: folder(`${RUNTIME}/overlay`),
    [`${RUNTIME}/overlay/.claude`]: folder(`${RUNTIME}/overlay/.claude`),
    [SKILLS]: folder(SKILLS),
    ...over,
  })
}

/** A render of the BE plan with SKILL_LINK; `over` changes the fields it names. */
function linked(over: Partial<RenderInput> = {}): RenderInput {
  return input({ plan: LINKED_PLAN, ...over })
}

/** The listings /cadre start gives: each named folder holds its entries, every other folder is empty. */
function listed(folders: Readonly<Record<string, readonly PortEntry[]>>): ReadonlyMap<string, readonly PortEntry[]> {
  return new Map(Object.entries(folders))
}

describe('runtime render links', () => {
  test('a planned link: .runtime, its overlay and the link folder are made, then the link, files and stamp', () => {
    expect(LINKED_PLAN.links).toEqual([SKILL_LINK])
    expect(renderSteps(linked())).toEqual({
      steps: [
        { kind: 'mkdir', path: RUNTIME },
        { kind: 'mkdir', path: `${RUNTIME}/overlay` },
        { kind: 'mkdir', path: SKILLS },
        { kind: 'link', path: SKILL_LINK.path, target: SKILL_LINK.target },
        ...fileWritesOf(LINKED_PLAN),
        INBOX_WRITE,
        STAMP_WRITE,
      ],
      warnings: [],
      refusal: null,
    })
  })

  test('the folders of links in several places are made sorted and once each, then the links in plan order', () => {
    const links = [MEMORY_LINK, SKILL_LINK, RESUME_LINK]
    const steps = renderSteps(input({ plan: { ...BE_PLAN, links } })).steps

    expect(steps.filter(step => step.kind === 'mkdir').map(step => step.path)).toEqual([
      RUNTIME,
      `${RUNTIME}/instructions/memory`,
      `${RUNTIME}/overlay`,
      SKILLS,
    ])
    expect(steps.filter(step => step.kind === 'link')).toEqual(links.map(item => ({ kind: 'link', ...item })))
    expect(steps.findIndex(step => step.kind === 'link')).toBe(4)
  })

  test('a link path that is already a link is removed once, before every mkdir, and then linked again', () => {
    const stats = rendered({ [SKILL_LINK.path]: LINK_OUT })
    const listings = listed({ [SKILLS]: [link('create-handoff-doc')] })
    const steps = renderSteps(linked({ stats, listings })).steps

    expect(steps.slice(0, 2)).toEqual([
      { kind: 'remove', path: SKILL_LINK.path },
      { kind: 'mkdir', path: RUNTIME },
    ])
    expect(steps.filter(step => step.path === SKILL_LINK.path)).toEqual([
      { kind: 'remove', path: SKILL_LINK.path },
      { kind: 'link', path: SKILL_LINK.path, target: SKILL_LINK.target },
    ])
  })

  test('a link path that is a real folder or file is not removed or linked; a warning names it (Pitfall 2)', () => {
    for (const stat of [folder(SKILL_LINK.path), regular(SKILL_LINK.path)]) {
      const result = renderSteps(linked({ stats: rendered({ [SKILL_LINK.path]: stat }) }))

      expect(result.steps.filter(step => step.path === SKILL_LINK.path)).toEqual([])
      expect(result.warnings).toEqual([
        '.cadre/be/.runtime/overlay/.claude/skills/create-handoff-doc ' +
          'is a real file or folder, not a link: not replaced',
      ])
      expect(result.refusal).toBeNull()
    }
  })

  test('the warning shows the path cleaned, so a hidden character in it cannot hide text', () => {
    const hostile: OverlayLink = { path: `${SKILLS}/a${BIDI_OVERRIDE}b`, target: '/home/u/.claude/skills/a' }
    const plan = { ...BE_PLAN, links: [hostile] }
    const result = renderSteps(input({ plan, stats: rendered({ [hostile.path]: folder(hostile.path) }) }))

    expect(result.warnings).toEqual([
      '.cadre/be/.runtime/overlay/.claude/skills/ab is a real file or folder, not a link: not replaced',
    ])
  })

  test('a link an earlier render left that the plan no longer names is removed; a real file or folder is kept', () => {
    const memory = `${RUNTIME}/instructions/memory`
    const listings = listed({
      [SKILLS]: [link('old-skill'), entry('notes'), entry('kept', 'dir')],
      [memory]: [link('OLD.md')],
    })
    const steps = renderSteps(input({ stats: rendered(), listings })).steps

    expect(steps.filter(step => step.kind === 'remove')).toEqual([
      { kind: 'remove', path: `${memory}/OLD.md` },
      { kind: 'remove', path: `${SKILLS}/old-skill` },
    ])
    expect(steps.slice(0, 2).map(step => step.kind)).toEqual(['remove', 'remove'])
    expect(steps.filter(step => step.path.endsWith('/notes') || step.path.endsWith('/kept'))).toEqual([])
  })

  test('a listed link whose name is not one plain entry, or a link in a folder not listed for links, is kept', () => {
    const listings = listed({
      [SKILLS]: [link('old'), link(''), link('.'), link('..'), link('../../../x')],
      [`${RUNTIME}/overlay`]: [link('stray')],
    })
    const steps = renderSteps(input({ stats: rendered(), listings })).steps

    expect(steps.filter(step => step.kind === 'remove')).toEqual([{ kind: 'remove', path: `${SKILLS}/old` }])
  })

  test('a file the render writes that is a link is removed first; an inbox link becomes an empty inbox', () => {
    const settings = `${RUNTIME}/settings.json`
    const inbox = `${RUNTIME}/inbox.md`
    const steps = renderSteps(input({ stats: rendered({ [settings]: LINK_OUT, [inbox]: DANGLING }) })).steps

    expect(steps.slice(0, 2)).toEqual([
      { kind: 'remove', path: settings },
      { kind: 'remove', path: inbox },
    ])
    expect(steps.filter(step => step.path === settings).map(step => step.kind)).toEqual(['remove', 'write'])
    expect(steps.filter(step => step.path === inbox)).toEqual([{ kind: 'remove', path: inbox }, INBOX_WRITE])
  })

  test('a file the render writes that is a folder, or any kind but a file or a link, refuses with no step', () => {
    const names = ['settings.json', 'mcp.json', 'probe-expectations.json', 'inbox.md', 'stamp']
    const results = names.flatMap(name => {
      const path = `${RUNTIME}/${name}`
      const other: PortStat = { kind: 'other', size: 0, isLink: false, realPath: path }

      return [folder(path), other].map(stat => renderSteps(input({ stats: rendered({ [path]: stat }) })))
    })

    expect(results).toHaveLength(10)
    expect(results).toEqual(results.map(() => ({ steps: [], warnings: [], refusal: RUNTIME_REFUSAL })))
  })

  test('a role folder that is missing, a link, or not a real folder inside the repo refuses, with no step', () => {
    const stats: readonly (PortStat | null)[] = [
      null,
      { kind: 'dir', size: 0, isLink: false, realPath: '/elsewhere/be' },
      { kind: 'dir', size: 0, isLink: true, realPath: ROLE_DIR },
      { kind: 'dir', size: 0, isLink: false },
      regular(ROLE_DIR),
    ]
    const results = stats.map(stat => renderSteps(linked({ stats: rendered({ [ROLE_DIR]: stat }) })))

    expect(results).toEqual(stats.map(() => ({ steps: [], warnings: [], refusal: ROLE_REFUSAL })))
  })

  test('.runtime, its overlay or a folder on the way to a link that is a link or a file refuses, with no step', () => {
    const folders = [RUNTIME, `${RUNTIME}/overlay`, `${RUNTIME}/overlay/.claude`, SKILLS]
    const results = folders.flatMap(path =>
      [DANGLING, LINK_OUT, regular(path)].map(stat => renderSteps(linked({ stats: rendered({ [path]: stat }) }))),
    )

    expect(results).toHaveLength(12)
    expect(results).toEqual(results.map(() => ({ steps: [], warnings: [], refusal: RUNTIME_REFUSAL })))
    expect(renderSteps(input({ stats: rendered({ [`${RUNTIME}/overlay`]: LINK_OUT }) })).refusal).toBe(RUNTIME_REFUSAL)
  })

  test('a stale-link folder or one above it that is a link or a file refuses, with no step (T-03-20, #47)', () => {
    const folders = [
      `${RUNTIME}/instructions`,
      `${RUNTIME}/instructions/global`,
      `${RUNTIME}/instructions/memory`,
      `${RUNTIME}/overlay/.claude`,
      `${RUNTIME}/overlay/.claude/agents`,
      SKILLS,
    ]
    const results = folders.flatMap(path =>
      [DANGLING, LINK_OUT, regular(path)].map(stat => renderSteps(input({ stats: rendered({ [path]: stat }) }))),
    )

    expect(results).toHaveLength(18)
    expect(results).toEqual(results.map(() => ({ steps: [], warnings: [], refusal: RUNTIME_REFUSAL })))
    expect(
      renderSteps(
        input({ stats: rendered({ [`${RUNTIME}/instructions`]: folder(`${RUNTIME}/instructions`) }) }),
      ).refusal,
    ).toBeNull()
  })

  test('an existing stamp is removed first, before every other step, and written last again (LNCH-03)', () => {
    const stamp = `${RUNTIME}/stamp`
    const settings = `${RUNTIME}/settings.json`
    const stats = rendered({ [stamp]: regular(stamp), [SKILL_LINK.path]: DANGLING, [settings]: DANGLING })
    const listings = listed({ [SKILLS]: [link('old-skill')] })
    const steps = renderSteps(linked({ stats, listings })).steps

    expect(steps.filter(step => step.kind === 'remove').map(step => step.path)).toEqual([
      stamp,
      `${SKILLS}/old-skill`,
      SKILL_LINK.path,
      settings,
    ])
    expect(steps[0]).toEqual({ kind: 'remove', path: stamp })
    expect(steps.at(-1)).toEqual(STAMP_WRITE)
    expect(steps.filter(step => step.path === stamp)).toEqual([{ kind: 'remove', path: stamp }, STAMP_WRITE])
  })

  test('a stamp that is a link is removed once, first; with no stamp there is no removal at all', () => {
    const stamp = `${RUNTIME}/stamp`
    const steps = renderSteps(input({ stats: rendered({ [stamp]: LINK_OUT }) })).steps

    expect(steps.filter(step => step.kind === 'remove')).toEqual([{ kind: 'remove', path: stamp }])
    expect(steps[0]).toEqual({ kind: 'remove', path: stamp })
    expect(renderSteps(input({ stats: rendered() })).steps.filter(step => step.kind === 'remove')).toEqual([])
  })

  test('no step removes a real file or folder but the old stamp, and nothing is removed with -r (T-03-20)', () => {
    const names = ['settings.json', 'mcp.json', 'probe-expectations.json', 'inbox.md', 'stamp']
    const files = Object.fromEntries(
      names.map((name): [string, PortStat] => [`${RUNTIME}/${name}`, regular(`${RUNTIME}/${name}`)]),
    )
    const listings = new Map(
      STALE_LINK_FOLDERS.map((name): [string, readonly PortEntry[]] => [
        `${RUNTIME}/${name}`,
        [entry('notes'), entry('kept', 'dir')],
      ]),
    )
    const stats = rendered({ ...files, [SKILL_LINK.path]: folder(SKILL_LINK.path) })
    const result = renderSteps(linked({ stats, listings }))

    expect(result.refusal).toBeNull()
    expect(result.steps.filter(step => step.kind === 'remove')).toEqual([{ kind: 'remove', path: `${RUNTIME}/stamp` }])
    expect(result.steps.flatMap(step => renderArgv(step) ?? []).filter(word => word.startsWith('-r'))).toEqual([])
  })
})

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

/** gatherLaunchUser over `world` with these run rules, for these locations, this launcher start and these code dirs. */
async function gather(
  world: MemWorld,
  runs: readonly HostRunRule[],
  locations: InitLocations = DEFAULT_LOCATIONS,
  launchStart: LaunchStart = GIT_ROOT,
  codeDirs: readonly string[] = [],
): Promise<GatherRun> {
  const host = memHost(hostWorld({ runs }))
  const read = await gatherLaunchUser(memIo(world, {}).io, host.io, { locations, launchStart, codeDirs })

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
      'cadre start could not read the git common dir (git rev-parse failed), so it stopped.',
    )
  })

  test('the user comes from the locations, the user folder and the common dir git gives at the root', async () => {
    const { read, calls } = await gather(repoWorld(), [GIT_OK], DEFAULT_LOCATIONS, GIT_ROOT, ['src'])
    const commonDirHash = await sha256Hex('/repo/.git')

    expect(read).toEqual({ kind: 'ok', user: user({ commonDirHash, codeDirs: ['src'] }), warnings: [] })
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
    })
    const unresolved = userOf((await gather(memWorld({}), [GIT_OK])).read)
    expect([unresolved.gitCommonDir, unresolved.commonDirHash]).toEqual(['/repo/.git', await sha256Hex('/repo/.git')])
  })

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

/** The user's ~/.claude.json of the fixtures. */
const CLAUDE_JSON = '/home/u/.claude.json'

/** The config of the user's redmine server, with a token that may only ever reach the runtime file. */
const REDMINE = { command: 'r', env: { TOKEN: 'sk-FAKE-SECRET-0123456789' } }

/** The MCP config of a role that gets no server (LNCH-02). */
const NO_SERVERS = stableJson({ mcpServers: {} })

/** The one warning for a role given servers when ~/.claude.json was not read (D-58). */
const NOT_READ =
  '~/.claude.json was not read (no consent at init), so the user-scope MCP servers of this role are not rendered'

/** The warning for a server a role is given that ~/.claude.json does not hold. */
function notInFile(name: string): string {
  return (
    `MCP server ${name} is not in ~/.claude.json: ` +
    'the role gets it only from the repo .mcp.json or a claude.ai connector'
  )
}

/** The BE role given exactly these MCP servers. */
function givenMcp(mcp: readonly string[]): RoleSpec {
  return templateRole('be', { mcp })
}

describe('runtime MCP config (D-93)', () => {
  test('readClaudeJson reads nothing without the stored consent, and gives null (D-58)', async () => {
    const run = memIo(memWorld({ files: { [CLAUDE_JSON]: '{"mcpServers":{}}' } }), {})

    expect(await readClaudeJson(run.io, DEFAULT_LOCATIONS, false)).toBeNull()
    expect(run.reads.filter(path => path.endsWith('.claude.json'))).toEqual([])
  })

  test('readClaudeJson with the consent reads the file claudeJsonPathOf names and gives its parsed value', async () => {
    const value = { mcpServers: { redmine: REDMINE } }
    const run = memIo(memWorld({ files: { [CLAUDE_JSON]: JSON.stringify(value) } }), {})

    expect(await readClaudeJson(run.io, DEFAULT_LOCATIONS, true)).toEqual(value)
    expect(run.reads).toEqual([CLAUDE_JSON])
    const configured = memIo(memWorld({ files: { '/cfg/.claude.json': '{"a":1}', [CLAUDE_JSON]: '{"b":2}' } }), {})
    expect(await readClaudeJson(configured.io, { ...DEFAULT_LOCATIONS, configDir: '/cfg' }, true)).toEqual({ a: 1 })
    expect(configured.reads).toEqual(['/cfg/.claude.json'])
  })

  test('readClaudeJson gives null for a file that is absent, unreadable, too large or not JSON', async () => {
    const worlds = [
      memWorld({}),
      memWorld({ files: { [CLAUDE_JSON]: '{}' }, unknownPaths: [CLAUDE_JSON] }),
      memWorld({ files: { [CLAUDE_JSON]: `{"a":"${'x'.repeat(CLAUDE_JSON_MAX_BYTES)}"}` } }),
      memWorld({ files: { [CLAUDE_JSON]: '{' } }),
    ]
    for (const [index, world] of worlds.entries()) {
      expect([index, await readClaudeJson(memIo(world, {}).io, DEFAULT_LOCATIONS, true)]).toEqual([index, null])
    }
    const homeless = { ...DEFAULT_LOCATIONS, home: null }
    expect(await readClaudeJson(memIo(memWorld({}), {}).io, homeless, true)).toBeNull()
  })

  test('runtimeMcpText renders each given server with its config from ~/.claude.json, and no warning', () => {
    const rendered = runtimeMcpText(givenMcp(['redmine']), { mcpServers: { redmine: REDMINE } }, ['/repo'], true)

    expect(rendered).toEqual({ text: stableJson({ mcpServers: { redmine: REDMINE } }), warnings: [] })
  })

  test('the project entry of the root as resolved, then as given, wins over the top level', () => {
    const top = { command: 'top' }
    const own = { command: 'own' }
    const linked = { command: 'linked' }
    const roots = ['/repo', '/link/repo']
    const projects = { '/link/repo': { mcpServers: { redmine: linked } }, '/repo': { mcpServers: { redmine: own } } }
    const textOf = (claudeJson: unknown): string => runtimeMcpText(givenMcp(['redmine']), claudeJson, roots, true).text

    expect(textOf({ mcpServers: { redmine: top }, projects })).toBe(stableJson({ mcpServers: { redmine: own } }))
    const given = { '/link/repo/': { mcpServers: { redmine: linked } } }
    const fromGiven = textOf({ mcpServers: { redmine: top }, projects: given })
    expect(fromGiven).toBe(stableJson({ mcpServers: { redmine: linked } }))
    const other = { '/elsewhere': { mcpServers: { redmine: own } } }
    expect(textOf({ mcpServers: { redmine: top }, projects: other })).toBe(stableJson({ mcpServers: { redmine: top } }))
  })

  test('a given server not in the file, or not an object there, is left out with a warning naming it', () => {
    const claudeJson = { mcpServers: { redmine: REDMINE, broken: 'x', listed: [] } }
    const mcp = ['sentry', 'redmine', 'broken', 'listed', 'constructor']
    const rendered = runtimeMcpText(givenMcp(mcp), claudeJson, ['/repo'], true)

    expect(rendered.text).toBe(stableJson({ mcpServers: { redmine: REDMINE } }))
    expect(rendered.warnings).toEqual(['broken', 'constructor', 'listed', 'sentry'].map(notInFile))
    expect(runtimeMcpText(givenMcp(['redmine']), null, ['/repo'], true)).toEqual({
      text: NO_SERVERS,
      warnings: [notInFile('redmine')],
    })
  })

  test('without the consent a role given servers gets none, and one warning says the file was not read (D-58)', () => {
    const claudeJson = { mcpServers: { redmine: REDMINE } }

    expect(runtimeMcpText(givenMcp(['redmine', 'sentry']), claudeJson, ['/repo'], false)).toEqual({
      text: NO_SERVERS,
      warnings: [NOT_READ],
    })
  })

  test('a role given no MCP server renders no server and no warning, read or not (LNCH-02)', () => {
    for (const isRead of [true, false]) {
      const rendered = runtimeMcpText(givenMcp([]), { mcpServers: { redmine: REDMINE } }, ['/repo'], isRead)

      expect([isRead, rendered]).toEqual([isRead, { text: NO_SERVERS, warnings: [] }])
    }
  })

  test('a server name is shown cleaned, and no warning holds a config value or a secret of the fixtures', () => {
    const linear = { headers: { Authorization: 'Bearer FAKE-TOKEN-0123' } }
    const claudeJson = { mcpServers: { redmine: REDMINE }, projects: { '/repo': { mcpServers: { linear } } } }
    const read = runtimeMcpText(givenMcp(['redmine', 'linear', `sentry${BIDI_OVERRIDE}`]), claudeJson, ['/repo'], true)
    const unread = runtimeMcpText(givenMcp(['redmine', 'linear']), claudeJson, ['/repo'], false)

    expect(read.warnings).toEqual([notInFile('sentry')])
    expect(read.text).toBe(stableJson({ mcpServers: { linear, redmine: REDMINE } }))
    expect(leaks([...read.warnings, ...unread.warnings].join('\n'), SECRET_FIXTURES)).toEqual([])
  })
})
