import { describe, expect, test } from 'claude-code/testing'

import type { PortEntry, PortStat, ScopeContext } from '../../types'
import { sha256Hex } from '../core/hash'
import { stableJson } from '../core/json'
import { isStepDone, renderArgv } from '../host/steps'
import type { RenderStep } from '../host/steps'
import type { LaunchUser, OverlayLink } from '../launch/links'
import { launchPlan } from '../launch/plan'
import type { LaunchPlan } from '../launch/plan'
import { t } from '../locales/t'
import { inboxDirOf, inboxFolderLevels, inboxHomeOf, RUNTIME_KICKOFF_FILE } from '../paths'
import { ignoreLines } from '../plan/gitignore'
import { compileScope } from '../scope/compile'
import { BIDI_OVERRIDE, emptySetupScan, entry, hostWorld, link, memHost, ROOT, templateRole } from '../testkit'
import { renderFailedReply } from './launcher-check'
import {
  inboxClearSteps,
  NO_MEMORY_LINKS,
  notReplacedText,
  notReplacedWarning,
  privateSkippedWarning,
  renderPaths,
  renderSteps,
  runtimeFolder,
  STALE_LINK_FOLDERS,
  stampText,
} from './render-plan'
import type { RenderInput } from './render-plan'

/** The folder of the BE role in the fixture repo. */
const ROLE_DIR = '/repo/.cadre/be'

/** The per-launch folder of the BE role (D-102). */
const RUNTIME = '/repo/.cadre/be/.runtime'

/** The inbox home of the repo root in the user config folder of the fixture user. */
const INBOX_HOME = inboxHomeOf('/home/u/.claude', ROOT, await sha256Hex(ROOT))

/** BE's inbox folder in that inbox home. */
const INBOX_DIR = inboxDirOf(INBOX_HOME, 'be')

/** BE's inbox in its inbox folder. */
const INBOX = `${INBOX_DIR}/inbox.jsonl`

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

/** BE's private instructions folder for the fixture user: `<role memory folder>/instructions`. */
const PRIVATE_FOLDER = '/home/u/.claude/cadre/repo-1a2b3c4d/be/instructions'

/** The levels of BE's role memory folder a render makes mode 700, from the top. */
const PRIVATE_LEVELS: readonly string[] = [
  '/home/u/.claude/cadre',
  '/home/u/.claude/cadre/repo-1a2b3c4d',
  '/home/u/.claude/cadre/repo-1a2b3c4d/be',
  PRIVATE_FOLDER,
]

/** The copy of BE's private instructions in its .runtime, which its launcher adds. */
const PRIVATE_COPY = `${RUNTIME}/private-instructions`

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
    memories: NO_MEMORY_LINKS,
    inboxDir: INBOX_DIR,
    privateSource: PRIVATE_FOLDER,
    ...over,
  }
}

/** What /cadre start gives renderPaths for BE: its inbox folder and its private instructions folder. */
const PATHS_OPTIONS = { inboxDir: INBOX_DIR, privateSource: PRIVATE_FOLDER }

/** The writes of the settings, the MCP config and the probe expectations of a plan, in render order (D-102). */
function fileWritesOf(plan: LaunchPlan): RenderStep[] {
  return [
    { kind: 'write', path: `${RUNTIME}/settings.json`, text: stableJson(plan.settings) },
    { kind: 'write', path: `${RUNTIME}/mcp.json`, text: MCP_TEXT },
    { kind: 'write', path: `${RUNTIME}/probe-expectations.json`, text: EXPECTATIONS_TEXT },
  ]
}

/** The making of BE's inbox folder: its mkdir, then one chmod 700 per level of it from the top. */
const INBOX_FOLDER_STEPS: readonly RenderStep[] = [
  { kind: 'mkdir', path: INBOX_DIR },
  ...inboxFolderLevels(INBOX_DIR).map((path): RenderStep => ({ kind: 'chmod', path })),
]

/** The create of an empty inbox: an append of nothing, which never truncates an inbox that is there. */
const INBOX_CREATE: RenderStep = { kind: 'append', path: INBOX, text: '' }

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
    'renderPaths stats the role folder, .runtime, its overlay, the stale-link folders, the four files, DONE.md ' +
      'and the inbox in its folder, and lists .runtime, the stale-link folders and the inbox folder (#72 A2)',
    () => {
      expect(BE_PLAN.links).toEqual([])
      expect(renderPaths(ROOT, 'be', BE_PLAN, PATHS_OPTIONS)).toEqual({
        stats: [
          INBOX,
          ROLE_DIR,
          RUNTIME,
          `${RUNTIME}/DONE.md`,
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
          RUNTIME,
          `${RUNTIME}/overlay/.claude/skills`,
          `${RUNTIME}/overlay/.claude/agents`,
          `${RUNTIME}/instructions/global`,
          `${RUNTIME}/instructions/memory`,
          INBOX_DIR,
        ],
      })
    },
  )

  test('renderPaths also stats each folder from .runtime down to a link and each link path, sorted, once each', () => {
    const plan = { ...BE_PLAN, links: [MEMORY_LINK, SKILL_LINK, RESUME_LINK] }

    expect(renderPaths(ROOT, 'be', plan, PATHS_OPTIONS).stats).toEqual([
      INBOX,
      ROLE_DIR,
      RUNTIME,
      `${RUNTIME}/DONE.md`,
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

  test('a fresh role: .runtime, its overlay, its inbox folder, three files, an empty inbox, the stamp last', () => {
    expect(BE_PLAN.links).toEqual([])
    expect(renderSteps(input())).toEqual({
      steps: [
        { kind: 'mkdir', path: RUNTIME },
        { kind: 'mkdir', path: `${RUNTIME}/overlay` },
        ...INBOX_FOLDER_STEPS,
        ...fileWritesOf(BE_PLAN),
        INBOX_CREATE,
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
    const stats = disk({ [RUNTIME]: folder(RUNTIME), [INBOX]: regular(INBOX) })

    expect(renderSteps(input({ stats })).steps).toEqual([
      { kind: 'mkdir', path: RUNTIME },
      { kind: 'mkdir', path: `${RUNTIME}/overlay` },
      ...INBOX_FOLDER_STEPS,
      ...fileWritesOf(BE_PLAN),
      STAMP_WRITE,
    ])
  })

  test('an epic seed is appended after a newline when there is no inbox, and never to an inbox that is there', () => {
    const kept = disk({ [RUNTIME]: folder(RUNTIME), [INBOX]: regular(INBOX) })
    const seeded = renderSteps(input({ inboxSeed: 'L\n' })).steps
    const reused = renderSteps(input({ inboxSeed: 'L\n', stats: kept })).steps

    expect(seeded.filter(step => step.path === INBOX)).toEqual([{ kind: 'append', path: INBOX, text: '\nL\n' }])
    expect(reused.filter(step => step.path === INBOX)).toEqual([])
  })

  test('an inbox.md of an older setup is left alone, file or link, and the empty inbox.jsonl is created', () => {
    const old = `${RUNTIME}/inbox.md`
    for (const stat of [regular(old), DANGLING]) {
      const steps = renderSteps(input({ stats: rendered({ [old]: stat }) })).steps

      expect(steps.filter(step => step.path === old)).toEqual([])
      expect(steps.filter(step => step.path === INBOX_CREATE.path)).toEqual([INBOX_CREATE])
    }
  })

  test('renderArgv gives absolute argv and no shell; a write has none, since the host writes it', () => {
    const stamp = `${RUNTIME}/stamp`

    expect(renderArgv({ kind: 'mkdir', path: RUNTIME })).toEqual(['/bin/mkdir', '-p', '--', '/repo/.cadre/be/.runtime'])
    expect(renderArgv({ kind: 'remove', path: stamp })).toEqual(['/bin/rm', '-f', '--', stamp])
    expect(renderArgv({ kind: 'chmod', path: PRIVATE_FOLDER })).toEqual(['/bin/chmod', '700', PRIVATE_FOLDER])
    expect(renderArgv({ kind: 'link', path: SKILL_LINK.path, target: SKILL_LINK.target })).toEqual([
      '/bin/ln',
      '-sfn',
      SKILL_LINK.target,
      SKILL_LINK.path,
    ])
    expect(renderArgv({ kind: 'write', path: `${RUNTIME}/mcp.json`, text: MCP_TEXT })).toBeNull()
    expect(renderArgv(INBOX_CREATE)).toEqual(['/usr/bin/tee', '-a', INBOX_CREATE.path])
    expect(renderArgv({ kind: 'move', path: INBOX_CREATE.path, target: `${INBOX_DIR}/inbox-1000.jsonl` })).toEqual([
      '/bin/mv',
      '--',
      INBOX_CREATE.path,
      `${INBOX_DIR}/inbox-1000.jsonl`,
    ])
  })

  test('an append step runs tee -a with its text as stdin, writes nothing, and fails on a non-zero exit', async () => {
    const path = INBOX
    const argv = ['/usr/bin/tee', '-a', path]
    const done = memHost(hostWorld({}))
    const failed = memHost(hostWorld({ runs: [{ argv, result: { exitCode: 1, stdout: '', stderr: '' } }] }))

    expect(await isStepDone(done.io, { kind: 'append', path, text: 'x\n' })).toBe(true)
    expect(done.calls).toEqual([{ argv, options: { stdin: 'x\n', timeoutMs: 10_000 } }])
    expect(done.writes).toEqual([])
    expect(await isStepDone(failed.io, { kind: 'append', path, text: '' })).toBe(false)
  })

  test('every step of a render lies in the .runtime folder of the role, but its inbox folder and inbox', () => {
    const paths = renderSteps(input()).steps.map(step => step.path)

    expect(paths.length).toBeGreaterThan(0)
    expect(paths.filter(path => path !== RUNTIME && !path.startsWith(`${RUNTIME}/`))).toEqual([
      INBOX_DIR,
      ...inboxFolderLevels(INBOX_DIR),
      INBOX,
    ])
    expect(paths).not.toContain(`${RUNTIME}/inbox.jsonl`)
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

/** What the render refusal says after the path of a file .runtime lists as a link its stat did not show (#72 A2). */
const UNCHECKED_LINK = 'is a link /cadre start could not check: remove it and run /cadre start be again'

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

describe('the rotation of a large inbox', () => {
  const rotation = { archive: `${INBOX_DIR}/inbox-1000.jsonl`, text: '{"v":1}\n' }
  const stats = disk({ [RUNTIME]: folder(RUNTIME), [INBOX]: regular(INBOX) })

  test('a rotation moves the inbox to its archive in its folder, then appends the fresh entry in its place', () => {
    expect(renderSteps(input({ stats, rotation })).steps).toEqual([
      { kind: 'mkdir', path: RUNTIME },
      { kind: 'mkdir', path: `${RUNTIME}/overlay` },
      ...INBOX_FOLDER_STEPS,
      ...fileWritesOf(BE_PLAN),
      { kind: 'move', path: INBOX, target: rotation.archive },
      { kind: 'append', path: INBOX, text: `\n${rotation.text}` },
      STAMP_WRITE,
    ])
  })

  test('the fresh entry is appended, never written, so an entry another role added after the move is kept', () => {
    const atInbox = renderSteps(input({ stats, rotation })).steps.filter(step => step.path === INBOX)

    expect(atInbox.map(step => step.kind)).toEqual(['move', 'append'])
  })

  test('without a rotation a real inbox gets no step and a missing one is created', () => {
    const real = renderSteps(input({ stats })).steps.filter(step => step.path === INBOX)
    const missing = renderSteps(input()).steps.filter(step => step.path === INBOX)

    expect([real, missing]).toEqual([[], [INBOX_CREATE]])
  })
})

describe('runtime render links', () => {
  test('a planned link: .runtime, its overlay and the link folder are made, then the link, files and stamp', () => {
    expect(LINKED_PLAN.links).toEqual([SKILL_LINK])
    expect(renderSteps(linked())).toEqual({
      steps: [
        { kind: 'mkdir', path: RUNTIME },
        { kind: 'mkdir', path: `${RUNTIME}/overlay` },
        { kind: 'mkdir', path: SKILLS },
        ...INBOX_FOLDER_STEPS,
        { kind: 'link', path: SKILL_LINK.path, target: SKILL_LINK.target },
        ...fileWritesOf(LINKED_PLAN),
        INBOX_CREATE,
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
      INBOX_DIR,
    ])
    expect(steps.filter(step => step.kind === 'link')).toEqual(links.map(item => ({ kind: 'link', ...item })))
    expect(steps.findIndex(step => step.kind === 'link')).toBe(4 + INBOX_FOLDER_STEPS.length)
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

  test('a file the render writes that is a link is removed first, then written', () => {
    const settings = `${RUNTIME}/settings.json`
    const steps = renderSteps(input({ stats: rendered({ [settings]: LINK_OUT }) })).steps

    expect(steps[0]).toEqual({ kind: 'remove', path: settings })
    expect(steps.filter(step => step.path === settings).map(step => step.kind)).toEqual(['remove', 'write'])
  })

  test('a file the render writes that is a folder, or any kind but a file or a link, refuses with no step', () => {
    const names = ['settings.json', 'mcp.json', 'probe-expectations.json', 'stamp']
    const results = names.flatMap(name => {
      const path = `${RUNTIME}/${name}`
      const other: PortStat = { kind: 'other', size: 0, isLink: false, realPath: path }

      return [folder(path), other].map(stat => renderSteps(input({ stats: rendered({ [path]: stat }) })))
    })

    expect(results).toHaveLength(8)
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

  test('a file a render writes that .runtime lists as a link, with no link in its stat, refuses (#72 A2)', () => {
    const names = ['settings.json', 'mcp.json', 'probe-expectations.json', 'stamp']
    const results = names.map(name =>
      renderSteps(input({ stats: rendered(), listings: listed({ [RUNTIME]: [entry('notes'), link(name)] }) })),
    )
    const regularStat = rendered({ [`${RUNTIME}/stamp`]: regular(`${RUNTIME}/stamp`) })
    const listedStamp = listed({ [RUNTIME]: [link('stamp')] })

    expect(results).toEqual(
      names.map(name => ({
        steps: [],
        warnings: [],
        refusal: `.cadre/be/.runtime/${name} ${UNCHECKED_LINK}`,
      })),
    )
    expect(renderSteps(input({ stats: regularStat, listings: listedStamp })).refusal).toBe(
      `.cadre/be/.runtime/stamp ${UNCHECKED_LINK}`,
    )
  })

  test('a listed link its stat shows is removed first; a listed real file or another link refuses nothing', () => {
    const settings = `${RUNTIME}/settings.json`
    const linkListing = listed({ [RUNTIME]: [link('settings.json')] })
    const realListing = listed({ [RUNTIME]: [entry('settings.json'), link('settings.json.old')] })
    const linkedSettings = renderSteps(input({ stats: rendered({ [settings]: DANGLING }), listings: linkListing }))
    const realFiles = renderSteps(input({ stats: rendered(), listings: realListing }))

    expect(linkedSettings.refusal).toBeNull()
    expect(linkedSettings.steps.filter(step => step.kind === 'remove')).toEqual([{ kind: 'remove', path: settings }])
    expect(realFiles.refusal).toBeNull()
    expect(realFiles.steps.filter(step => step.kind === 'remove')).toEqual([])
  })

  test('no step removes a real file or folder but the old stamp, and nothing is removed with -r (T-03-20)', () => {
    const names = ['settings.json', 'mcp.json', 'probe-expectations.json', 'stamp']
    const files = Object.fromEntries([
      ...names.map((name): [string, PortStat] => [`${RUNTIME}/${name}`, regular(`${RUNTIME}/${name}`)]),
      [INBOX, regular(INBOX)],
    ])
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

describe('the epic kickoff in .runtime (D-158, D-168)', () => {
  test('an epic render writes its kickoff into .runtime as the step right before the stamp', () => {
    expect(renderSteps(input({ kickoff: 'X\n' })).steps).toEqual([
      { kind: 'mkdir', path: RUNTIME },
      { kind: 'mkdir', path: `${RUNTIME}/overlay` },
      ...INBOX_FOLDER_STEPS,
      ...fileWritesOf(BE_PLAN),
      INBOX_CREATE,
      { kind: 'write', path: `${RUNTIME}/${RUNTIME_KICKOFF_FILE}`, text: 'X\n' },
      STAMP_WRITE,
    ])
  })

  test(
    'a kickoff.txt link is removed before an epic render writes it, a folder there refuses, ' +
      'and a /cadre start render leaves it alone',
    () => {
      const kickoff = `${RUNTIME}/${RUNTIME_KICKOFF_FILE}`
      const linkedFile = renderSteps(input({ kickoff: 'X\n', stats: rendered({ [kickoff]: LINK_OUT }) }))
      const folderFile = renderSteps(input({ kickoff: 'X\n', stats: rendered({ [kickoff]: folder(kickoff) }) }))
      const start = renderSteps(input({ stats: rendered({ [kickoff]: LINK_OUT }) }))

      expect(renderPaths(ROOT, 'be', BE_PLAN, { ...PATHS_OPTIONS, kickoff: true }).stats).toContain(kickoff)
      expect(linkedFile.steps[0]).toEqual({ kind: 'remove', path: kickoff })
      expect(linkedFile.steps.filter(step => step.path === kickoff).map(step => step.kind)).toEqual(['remove', 'write'])
      expect(folderFile).toEqual({ steps: [], warnings: [], refusal: RUNTIME_REFUSAL })
      expect(start.steps.filter(step => step.path === kickoff)).toEqual([])
    },
  )
})

describe('the inbox in its private folder', () => {
  /** The refusal of a render whose inbox is a link or not a regular file. */
  const REFUSAL = t('start.renderPlan.inboxRefusal', { role: 'be', path: INBOX })

  test(
    'an inbox that is a link, by its stat or by the listing of its folder while its stat shows none, refuses ' +
      'with no step, so a link there is never removed',
    () => {
      const results = [
        renderSteps(input({ stats: rendered({ [INBOX]: LINK_OUT }) })),
        renderSteps(input({ stats: rendered({ [INBOX]: DANGLING }) })),
        renderSteps(input({ stats: rendered(), listings: listed({ [INBOX_DIR]: [link('inbox.jsonl')] }) })),
      ]

      expect(results).toEqual(results.map(() => ({ steps: [], warnings: [], refusal: REFUSAL })))
    },
  )

  test('an inbox that is a folder or any other kind but a file refuses with no step', () => {
    const other: PortStat = { kind: 'other', size: 0, isLink: false, realPath: INBOX }
    const results = [folder(INBOX), other].map(stat => renderSteps(input({ stats: rendered({ [INBOX]: stat }) })))

    expect(results).toEqual(results.map(() => ({ steps: [], warnings: [], refusal: REFUSAL })))
  })

  test('a link listed beside the inbox, or a real inbox file, refuses nothing', () => {
    const beside = listed({ [INBOX_DIR]: [link('inbox-1000.jsonl'), entry('session.json')] })
    const results = [
      renderSteps(input({ stats: rendered(), listings: beside })),
      renderSteps(input({ stats: rendered({ [INBOX]: regular(INBOX) }) })),
    ]

    expect(results.map(result => result.refusal)).toEqual([null, null])
  })
})

describe('inboxClearSteps', () => {
  test('each listed role folder gets the removal of its inbox, then of its session record, in listing order', () => {
    expect(inboxClearSteps(INBOX_HOME, [entry('pm', 'dir'), entry('be', 'dir')])).toEqual([
      { kind: 'remove', path: `${INBOX_HOME}/pm/inbox.jsonl` },
      { kind: 'remove', path: `${INBOX_HOME}/pm/session.json` },
      { kind: 'remove', path: `${INBOX_HOME}/be/inbox.jsonl` },
      { kind: 'remove', path: `${INBOX_HOME}/be/session.json` },
    ])
  })

  test('a link, a file, a name that is no plain entry or no role id, and an empty listing clear nothing', () => {
    const entries = [
      link('pm'),
      entry('tl', 'dir', true),
      entry('be'),
      entry('.', 'dir'),
      entry('..', 'dir'),
      entry('qa/x', 'dir'),
      entry('BE!', 'dir'),
      entry('cadre', 'dir'),
    ]

    expect(inboxClearSteps(INBOX_HOME, entries)).toEqual([])
    expect(inboxClearSteps(INBOX_HOME, [])).toEqual([])
  })

  test('a removal is rm -f of one file, never -r', () => {
    const argv = inboxClearSteps(INBOX_HOME, [entry('pm', 'dir')]).map(renderArgv)

    expect(argv).toEqual([
      ['/bin/rm', '-f', '--', `${INBOX_HOME}/pm/inbox.jsonl`],
      ['/bin/rm', '-f', '--', `${INBOX_HOME}/pm/session.json`],
    ])
  })
})

/**
 * A render step's path below BE's .runtime, as an ignore line names it: a folder a step makes ends in `/`, as the
 * folders of RUNTIME_RENDERED do, so a folder line can cover it.
 */
function runtimeRelative(step: RenderStep): string {
  const path = step.path.slice(RUNTIME.length + 1)

  return step.kind === 'mkdir' ? `${path}/` : path
}

/**
 * Whether a line of ignoreLines('all') covers a path below .runtime as git matches it: a line `<name>/` covers every
 * path that starts with it, and a line `<name>` covers that path and every path below it.
 */
function isIgnoredUnderAll(path: string): boolean {
  const prefix = '.cadre/*/.runtime/'

  return ignoreLines('all').some(line => {
    if (!line.startsWith(prefix)) return false
    const name = line.slice(prefix.length)

    return name.endsWith('/') ? path.startsWith(name) : path === name || path.startsWith(`${name}/`)
  })
}

describe('built files reach the session (G-02-1f)', () => {
  test('a render makes the copy folder, then after the links chmods it and copies each regular source file', () => {
    const listings = listed({ [PRIVATE_FOLDER]: [entry('notes.md'), entry('sub', 'dir'), entry('CLAUDE.md')] })
    const result = renderSteps(linked({ listings }))

    expect(result).toEqual({
      steps: [
        { kind: 'mkdir', path: RUNTIME },
        { kind: 'mkdir', path: `${RUNTIME}/overlay` },
        { kind: 'mkdir', path: SKILLS },
        { kind: 'mkdir', path: PRIVATE_COPY },
        { kind: 'mkdir', path: PRIVATE_FOLDER },
        ...PRIVATE_LEVELS.map((path): RenderStep => ({ kind: 'chmod', path })),
        ...INBOX_FOLDER_STEPS,
        { kind: 'link', path: SKILL_LINK.path, target: SKILL_LINK.target },
        { kind: 'chmod', path: PRIVATE_COPY },
        { kind: 'copy', source: `${PRIVATE_FOLDER}/CLAUDE.md`, path: `${PRIVATE_COPY}/CLAUDE.md` },
        { kind: 'copy', source: `${PRIVATE_FOLDER}/notes.md`, path: `${PRIVATE_COPY}/notes.md` },
        ...fileWritesOf(LINKED_PLAN),
        INBOX_CREATE,
        STAMP_WRITE,
      ],
      warnings: [privateSkippedWarning('be', 'sub')],
      refusal: null,
    })
    expect(result.steps.filter(step => step.kind === 'link' && step.path === PRIVATE_COPY)).toEqual([])
    expect(privateSkippedWarning('be', 'sub')).toBe(
      "be's private instructions folder holds sub, which is not a regular file and is not copied to the role",
    )
  })

  test('a link at the copy path is removed after the planned links, before every mkdir; its listing is unused', () => {
    const stats = rendered({ [SKILL_LINK.path]: LINK_OUT, [PRIVATE_COPY]: LINK_OUT })
    const listings = listed({ [PRIVATE_COPY]: [entry('CLAUDE.md'), entry('old.md')] })
    const steps = renderSteps(linked({ stats, listings })).steps
    const removed = steps.findIndex(step => step.kind === 'remove' && step.path === PRIVATE_COPY)

    expect(steps.filter(step => step.kind === 'remove')).toEqual([
      { kind: 'remove', path: SKILL_LINK.path },
      { kind: 'remove', path: PRIVATE_COPY },
    ])
    expect(steps.findIndex(step => step.kind === 'mkdir')).toBeGreaterThan(removed)
  })

  test('a dangling link .runtime lists at the copy path, with no stat, is removed the same way', () => {
    const listings = listed({ [RUNTIME]: [link('private-instructions')] })
    const result = renderSteps(input({ stats: rendered(), listings }))

    expect(result.refusal).toBeNull()
    expect(result.steps.filter(step => step.kind === 'remove')).toEqual([{ kind: 'remove', path: PRIVATE_COPY }])
  })

  test('a copy folder is refreshed: after its chmod each entry in it is removed, then the source is copied', () => {
    const stats = rendered({ [PRIVATE_COPY]: folder(PRIVATE_COPY), [PRIVATE_FOLDER]: folder(PRIVATE_FOLDER) })
    const listings = listed({
      [PRIVATE_COPY]: [entry('CLAUDE.md'), entry('old.md'), link('stale')],
      [PRIVATE_FOLDER]: [entry('CLAUDE.md')],
    })
    const steps = renderSteps(input({ stats, listings })).steps

    expect(steps.filter(step => step.path.startsWith(PRIVATE_COPY))).toEqual([
      { kind: 'mkdir', path: PRIVATE_COPY },
      { kind: 'chmod', path: PRIVATE_COPY },
      { kind: 'remove', path: `${PRIVATE_COPY}/CLAUDE.md` },
      { kind: 'remove', path: `${PRIVATE_COPY}/old.md` },
      { kind: 'remove', path: `${PRIVATE_COPY}/stale` },
      { kind: 'copy', source: `${PRIVATE_FOLDER}/CLAUDE.md`, path: `${PRIVATE_COPY}/CLAUDE.md` },
    ])
  })

  test('with no source folder, its folder and the copy folder are made, and nothing is copied or refused', () => {
    const result = renderSteps(input())
    const at = result.steps.findIndex(step => step.kind === 'mkdir' && step.path === PRIVATE_FOLDER)

    expect(result.refusal).toBeNull()
    expect(result.steps.slice(at, at + 1 + PRIVATE_LEVELS.length)).toEqual([
      { kind: 'mkdir', path: PRIVATE_FOLDER },
      ...PRIVATE_LEVELS.map((path): RenderStep => ({ kind: 'chmod', path })),
    ])
    expect(result.steps.filter(step => step.path.startsWith(PRIVATE_COPY))).toEqual([
      { kind: 'mkdir', path: PRIVATE_COPY },
      { kind: 'chmod', path: PRIVATE_COPY },
    ])
  })

  test('a real file at the copy path, a real folder in the copy, or a source that cannot be listed refuses', () => {
    const asFile = renderSteps(input({ stats: rendered({ [PRIVATE_COPY]: regular(PRIVATE_COPY) }) }))
    const nested = renderSteps(
      input({
        stats: rendered({ [PRIVATE_COPY]: folder(PRIVATE_COPY) }),
        listings: listed({ [PRIVATE_COPY]: [entry('CLAUDE.md'), entry('drafts', 'dir')] }),
      }),
    )
    const unlisted = renderSteps(input({ stats: rendered({ [PRIVATE_FOLDER]: folder(PRIVATE_FOLDER) }) }))

    expect(asFile).toEqual({ steps: [], warnings: [], refusal: RUNTIME_REFUSAL })
    expect(nested).toEqual({ steps: [], warnings: [], refusal: RUNTIME_REFUSAL })
    expect(unlisted).toEqual({ steps: [], warnings: [], refusal: renderFailedReply('be', PRIVATE_FOLDER) })
  })

  test('a source entry that is not a regular file is not copied: one warning each, by name, after the others', () => {
    const source = [
      entry('d-dir', 'dir'),
      entry('CLAUDE.md'),
      link('c-link'),
      entry('b-fifo', 'other'),
      entry('a-file-link', 'file', true),
    ]
    const stats = rendered({ [SKILL_LINK.path]: folder(SKILL_LINK.path) })
    const result = renderSteps(linked({ stats, listings: listed({ [PRIVATE_FOLDER]: source }) }))
    const regularOnly = listed({ [PRIVATE_FOLDER]: [entry('CLAUDE.md'), entry('notes.md')] })

    expect(result.refusal).toBeNull()
    expect(result.steps.filter(step => step.kind === 'copy')).toEqual([
      { kind: 'copy', source: `${PRIVATE_FOLDER}/CLAUDE.md`, path: `${PRIVATE_COPY}/CLAUDE.md` },
    ])
    expect(result.warnings).toEqual([
      notReplacedWarning(ROOT, SKILL_LINK.path),
      ...['a-file-link', 'b-fifo', 'c-link', 'd-dir'].map(name => privateSkippedWarning('be', name)),
    ])
    expect(renderSteps(input({ listings: regularOnly })).warnings).toEqual([])
  })

  test('renderPaths stats the private instructions folder and its copy, and lists both after the inbox folder', () => {
    const paths = renderPaths(ROOT, 'be', BE_PLAN, PATHS_OPTIONS)

    expect(paths.stats).toContain(PRIVATE_FOLDER)
    expect(paths.stats).toContain(PRIVATE_COPY)
    expect(paths.listings.slice(-3)).toEqual([INBOX_DIR, PRIVATE_COPY, PRIVATE_FOLDER])
  })

  test('under commit all, every path a render makes below .runtime is git-ignored, the private copy too (M2)', () => {
    const plan: LaunchPlan = { ...BE_PLAN, links: [MEMORY_LINK, SKILL_LINK] }
    const listings = listed({ [PRIVATE_FOLDER]: [entry('CLAUDE.md')] })
    const below = renderSteps(input({ plan, listings }))
      .steps.filter(step => step.kind !== 'remove' && step.path.startsWith(`${RUNTIME}/`))
      .map(step => runtimeRelative(step))

    expect(below).toContain('private-instructions/')
    expect(below).toContain('private-instructions/CLAUDE.md')
    expect(below).toContain('overlay/')
    expect(below.filter(path => !isIgnoredUnderAll(path))).toEqual([])
  })
})

describe('start review fixes (#63)', () => {
  test('a DONE.md an earlier run left is removed right after the stamp, so a new run has no marker (A6)', () => {
    const stamp = `${RUNTIME}/stamp`
    const done = `${RUNTIME}/DONE.md`
    const steps = renderSteps(input({ stats: rendered({ [stamp]: regular(stamp), [done]: regular(done) }) })).steps
    const alone = renderSteps(input({ stats: rendered({ [done]: regular(done) }) })).steps

    expect(steps.slice(0, 2)).toEqual([
      { kind: 'remove', path: stamp },
      { kind: 'remove', path: done },
    ])
    expect(steps.at(-1)).toEqual(STAMP_WRITE)
    expect(alone[0]).toEqual({ kind: 'remove', path: done })
    expect(renderArgv({ kind: 'remove', path: done })).toEqual(['/bin/rm', '-f', '--', done])
  })

  test('a DONE.md link is removed, a DONE.md folder is kept and refuses nothing, none is no removal (A6)', () => {
    const done = `${RUNTIME}/DONE.md`
    const removals = (stat: PortStat | null): RenderStep[] =>
      renderSteps(input({ stats: rendered({ [done]: stat }) })).steps.filter(step => step.kind === 'remove')

    expect(removals(LINK_OUT)).toEqual([{ kind: 'remove', path: done }])
    expect(removals(DANGLING)).toEqual([{ kind: 'remove', path: done }])
    expect(removals(folder(done))).toEqual([])
    expect(removals(null)).toEqual([])
    expect(renderSteps(input({ stats: rendered({ [done]: folder(done) }) })).refusal).toBeNull()
  })
})

describe('the not-replaced warning (D-272, edge #28)', () => {
  /** How the warning ends, after the path it names. */
  const END = ' is a real file or folder, not a link: not replaced'

  test('#28: notReplacedText names a shown path as it is; notReplacedWarning makes a raw path repo-relative', () => {
    expect(notReplacedText('~/.claude/cadre/repo-1a2b3c4d/be/squad.md')).toBe(
      `~/.claude/cadre/repo-1a2b3c4d/be/squad.md${END}`,
    )
    expect(notReplacedText('/repo/x')).toBe(`/repo/x${END}`)
    expect(notReplacedWarning('/repo', '/repo/x')).toBe(`x${END}`)
    expect(notReplacedWarning('/repo', `/repo/a${BIDI_OVERRIDE}b`)).toBe(notReplacedText(`a${BIDI_OVERRIDE}b`))
  })
})
