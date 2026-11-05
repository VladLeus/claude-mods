import { describe, expect, test } from 'claude-code/testing'

import type { PortEntry, PortStat, ScopeContext } from '../../types'
import { stableJson } from '../core/json'
import { renderArgv } from '../host/steps'
import type { RenderStep } from '../host/steps'
import type { LaunchUser, OverlayLink } from '../launch/links'
import { launchPlan } from '../launch/plan'
import type { LaunchPlan } from '../launch/plan'
import { RUNTIME_KICKOFF_FILE } from '../paths'
import { ignoreLines } from '../plan/gitignore'
import { compileScope } from '../scope/compile'
import { BIDI_OVERRIDE, emptySetupScan, entry, link, ROOT, templateRole } from '../testkit'
import {
  NO_MEMORY_LINKS,
  notReplacedText,
  notReplacedWarning,
  privateLinkRefusal,
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
    'renderPaths stats the role folder, .runtime, its overlay, the stale-link folders, the five files and DONE.md, ' +
      'and lists .runtime, then the stale-link folders (#72 A2)',
    () => {
      expect(BE_PLAN.links).toEqual([])
      expect(renderPaths(ROOT, 'be', BE_PLAN)).toEqual({
        stats: [
          ROLE_DIR,
          RUNTIME,
          `${RUNTIME}/DONE.md`,
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
          RUNTIME,
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
      `${RUNTIME}/DONE.md`,
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
    expect(renderArgv({ kind: 'chmod', path: PRIVATE_FOLDER })).toEqual(['/bin/chmod', '700', PRIVATE_FOLDER])
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

  test('a file a render writes that .runtime lists as a link, with no link in its stat, refuses (#72 A2)', () => {
    const names = ['settings.json', 'mcp.json', 'probe-expectations.json', 'inbox.md', 'stamp']
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

describe('the epic kickoff in .runtime (D-158, D-168)', () => {
  test('an epic render writes its kickoff into .runtime as the step right before the stamp', () => {
    expect(renderSteps(input({ kickoff: 'X\n' })).steps).toEqual([
      { kind: 'mkdir', path: RUNTIME },
      { kind: 'mkdir', path: `${RUNTIME}/overlay` },
      ...fileWritesOf(BE_PLAN),
      INBOX_WRITE,
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

      expect(renderPaths(ROOT, 'be', BE_PLAN, { kickoff: true }).stats).toContain(kickoff)
      expect(linkedFile.steps[0]).toEqual({ kind: 'remove', path: kickoff })
      expect(linkedFile.steps.filter(step => step.path === kickoff).map(step => step.kind)).toEqual(['remove', 'write'])
      expect(folderFile).toEqual({ steps: [], warnings: [], refusal: RUNTIME_REFUSAL })
      expect(start.steps.filter(step => step.path === kickoff)).toEqual([])
    },
  )
})

/** BE's private instructions folder for the fixture user: `<role memory folder>/instructions` (D-140 q1-b). */
const PRIVATE_FOLDER = '/home/u/.claude/cadre/repo-1a2b3c4d/be/instructions'

/** The levels of BE's role memory folder a render makes mode 700, from the top (02-GAPS-B3 S7). */
const PRIVATE_LEVELS: readonly string[] = [
  '/home/u/.claude/cadre',
  '/home/u/.claude/cadre/repo-1a2b3c4d',
  '/home/u/.claude/cadre/repo-1a2b3c4d/be',
  PRIVATE_FOLDER,
]

/** The link in BE's .runtime to its private instructions folder, which its launcher adds (D-140 q1-b). */
const PRIVATE_LINK: OverlayLink = { path: `${RUNTIME}/private-instructions`, target: PRIVATE_FOLDER }

/** BE's plan with the private instructions link and no other link, as /cadre start renders it (D-140 q1-b). */
const PRIVATE_PLAN: LaunchPlan = { ...BE_PLAN, links: [PRIVATE_LINK] }

/**
 * A render step's path below BE's .runtime, as an ignore line names it: a folder a step makes ends in `/`, as the
 * folders of RUNTIME_RENDERED do, so a folder line can cover it.
 */
function runtimeRelative(step: RenderStep): string {
  const path = step.path.slice(RUNTIME.length + 1)

  return step.kind === 'mkdir' ? `${path}/` : path
}

/**
 * Whether a line of ignoreLines('all') covers a path below .runtime (02-GAPS-B2 M2): the line of `<name>` covers the
 * path equal to `<name>`, and, when `<name>` ends in `/`, every path that starts with it.
 */
function isIgnoredUnderAll(path: string): boolean {
  const prefix = '.cadre/*/.runtime/'

  return ignoreLines('all').some(line => {
    if (!line.startsWith(prefix)) return false
    const name = line.slice(prefix.length)

    return name.endsWith('/') ? path.startsWith(name) : path === name
  })
}

describe('built files reach the session (G-02-1f)', () => {
  test('a render makes the private link folder after the .runtime folders, chmods its levels, then links (S7)', () => {
    expect(renderSteps(input({ plan: PRIVATE_PLAN })).steps).toEqual([
      { kind: 'mkdir', path: RUNTIME },
      { kind: 'mkdir', path: `${RUNTIME}/overlay` },
      { kind: 'mkdir', path: PRIVATE_FOLDER },
      ...PRIVATE_LEVELS.map((path): RenderStep => ({ kind: 'chmod', path })),
      { kind: 'link', path: PRIVATE_LINK.path, target: PRIVATE_FOLDER },
      ...fileWritesOf(PRIVATE_PLAN),
      INBOX_WRITE,
      STAMP_WRITE,
    ])
  })

  test('an earlier link at .runtime/private-instructions is removed first; a real file or folder there refuses', () => {
    const stale = renderSteps(input({ plan: PRIVATE_PLAN, stats: rendered({ [PRIVATE_LINK.path]: LINK_OUT }) }))
    const atLink = stale.steps.filter(step => step.path === PRIVATE_LINK.path)

    expect(atLink.map(step => step.kind)).toEqual(['remove', 'link'])
    for (const stat of [folder(PRIVATE_LINK.path), regular(PRIVATE_LINK.path)]) {
      const real = renderSteps(input({ plan: PRIVATE_PLAN, stats: rendered({ [PRIVATE_LINK.path]: stat }) }))

      expect(real).toEqual({ steps: [], warnings: [], refusal: privateLinkRefusal('be') })
    }
    expect(privateLinkRefusal('be')).toBe(
      '.cadre/be/.runtime/private-instructions is a real file or folder, not a link: ' +
        'remove it and run /cadre start be again',
    )
  })

  test('under commit all, every path a render makes below .runtime is git-ignored, the private link too (M2)', () => {
    const plan: LaunchPlan = { ...BE_PLAN, links: [MEMORY_LINK, PRIVATE_LINK, SKILL_LINK] }
    const below = renderSteps(input({ plan }))
      .steps.filter(step => step.kind !== 'remove' && step.path.startsWith(`${RUNTIME}/`))
      .map(step => runtimeRelative(step))

    expect(below).toContain('private-instructions')
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
