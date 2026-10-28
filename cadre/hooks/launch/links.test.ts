import { describe, expect, test } from 'claude-code/testing'

import type { ScopeContext } from '../../types'
import { sortedUnique } from '../core/text'
import { adapterOf } from '../framework/registry'
import { launchPlan } from '../launch'
import { INFRA_SKILLS } from '../roles/infra'
import { compileScope } from '../scope/compile'
import { BIDI_OVERRIDE, emptySetupScan, templateRole } from '../testkit'
import { instructionPlan } from './links'
import type { LaunchUser } from './links'

/** The fixture hash: the 8 characters the memory slug shows, then 56 zeros. */
const HASH = `1a2b3c4d${'0'.repeat(56)}`

/** The launching user of the fixtures: repo /repo, home /home/u, nothing to carry; `over` changes named fields. */
function user(over: Partial<LaunchUser> = {}): LaunchUser {
  return {
    root: '/repo',
    givenRoot: '/repo',
    home: '/home/u',
    userDir: '/home/u/.claude',
    gitCommonDir: '/repo/.git',
    commonDirHash: HASH,
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

/** A scope context for the GSD framework and the merged MCP route; `over` changes the fields it names. */
function context(over: Partial<ScopeContext> = {}): ScopeContext {
  return {
    framework: 'gsd',
    setup: emptySetupScan(),
    codeDirs: [],
    isAttended: false,
    mcpRoute: 'merged',
    launchStart: { kind: 'git-root' },
    roles: ['pm', 'tl'],
    ...over,
  }
}

/** What a role carries from the user's settings: the window, the status line, one env name and one hook script. */
const CARRY_ALL = {
  autoCompactWindow: true,
  statusLine: true,
  env: ['JIRA_URL'],
  hooks: ['gsd-secret-read-guard.js'],
}

/** The user's secret guard hook and the context monitor, as the launch collects them from the user's settings. */
const USER_HOOKS = [
  {
    event: 'PreToolUse',
    script: 'gsd-secret-read-guard.js',
    command: 'node /home/u/.claude/hooks/gsd-secret-read-guard.js',
    matcher: null,
    timeout: null,
  },
  {
    event: 'PostToolUse',
    script: 'gsd-context-monitor.js',
    command: 'node /home/u/m.js',
    matcher: null,
    timeout: null,
  },
]

/** The skills every role on GSD has in its overlay: the handoff skills and the start skills of GSD. */
const GSD_SKILLS: readonly string[] = [...INFRA_SKILLS, ...adapterOf('gsd').startSkills]

/** A launching user that has something to carry, the skills of a GSD overlay, and one env value no role carries. */
function carrier(over: Partial<LaunchUser> = {}): LaunchUser {
  return user({
    autoCompactWindow: 800000,
    statusLine: { type: 'command', command: '/home/u/x.js' },
    env: { JIRA_URL: 'https://j', API_KEY: 'k' },
    hooks: USER_HOOKS,
    codeDirs: ['cadre'],
    userSkills: GSD_SKILLS,
    ...over,
  })
}

/** The CLAUDE.md files the engine loads for the fixture repo: its own, the one in `.claude` and an ancestor's. */
const CHAIN = ['/repo/CLAUDE.md', '/repo/.claude/CLAUDE.md', '/home/u/work/CLAUDE.md']

/** The folder the instruction links of the PM are created in, for the group `global` or `memory`. */
function linkDir(group: 'global' | 'memory'): string {
  return `/repo/.cadre/pm/.runtime/instructions/${group}`
}

describe('instructionPlan', () => {
  test('without the project CLAUDE.md group every CLAUDE.md of the loaded chain is excluded, sorted (P11)', () => {
    const plan = instructionPlan(templateRole('pm'), user({ claudeMd: CHAIN }))

    expect(plan.claudeMdExcludes).toEqual(['/home/u/work/CLAUDE.md', '/repo/.claude/CLAUDE.md', '/repo/CLAUDE.md'])
    expect(plan.links).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  test('with the project CLAUDE.md group nothing is excluded: the chain loads by itself (P11)', () => {
    const role = templateRole('pm', { instructions: ['project-claude-md'] })

    expect(instructionPlan(role, user({ claudeMd: CHAIN })).claudeMdExcludes).toEqual([])
  })

  test('the excludes list each file once, whatever order and repeats the chain comes in', () => {
    const claudeMd = [...[...CHAIN].reverse(), ...CHAIN]
    const plan = instructionPlan(templateRole('pm'), user({ claudeMd }))

    expect(plan.claudeMdExcludes).toEqual(['/home/u/work/CLAUDE.md', '/repo/.claude/CLAUDE.md', '/repo/CLAUDE.md'])
  })

  test('the global CLAUDE.md group links the file and its imports, numbered in the order given', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md'] })
    const global = ['/home/u/.claude/CLAUDE.md', '/home/u/notes/a.md']
    const plan = instructionPlan(role, user({ globalClaudeMd: global }))

    expect(plan.links).toEqual([
      { path: `${linkDir('global')}/01-CLAUDE.md`, target: '/home/u/.claude/CLAUDE.md' },
      { path: `${linkDir('global')}/02-a.md`, target: '/home/u/notes/a.md' },
    ])
    expect(plan.warnings).toEqual([])
  })

  test('two global files with the same name do not clash: the number tells them apart', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md'] })
    const global = ['/home/u/.claude/CLAUDE.md', '/home/u/a/notes.md', '/home/u/b/notes.md']
    const plan = instructionPlan(role, user({ globalClaudeMd: global }))

    expect(plan.links.map(link => link.path)).toEqual([
      `${linkDir('global')}/01-CLAUDE.md`,
      `${linkDir('global')}/02-notes.md`,
      `${linkDir('global')}/03-notes.md`,
    ])
    expect(plan.links.map(link => link.target)).toEqual(global)
  })

  test('with no global file the group plans no link and no warning', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md'] })

    expect(instructionPlan(role, user({ globalClaudeMd: [] }))).toEqual({
      claudeMdExcludes: [],
      links: [],
      warnings: [],
    })
  })

  test('a global file whose name is empty or has hidden characters is not linked and the number is kept', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md'] })
    const hidden = `/home/u/x/a${BIDI_OVERRIDE}b.md`
    const global = ['/home/u/.claude/CLAUDE.md', hidden, '/home/u/x/', '/c.md']
    const plan = instructionPlan(role, user({ globalClaudeMd: global }))

    expect(plan.links.map(link => link.path)).toEqual([
      `${linkDir('global')}/01-CLAUDE.md`,
      `${linkDir('global')}/04-c.md`,
    ])
    expect(plan.warnings).toEqual([
      'global file ab.md has an unsafe name: not linked',
      'global file  has an unsafe name: not linked',
    ])
  })

  test('a global file keeps its name behind the number, even a hidden name or one with a space', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md'] })
    const global = ['/home/u/.claude/CLAUDE.md', '/home/u/.claude/.rules.md', '/home/u/my notes.md']
    const plan = instructionPlan(role, user({ globalClaudeMd: global }))

    expect(plan.links.map(link => link.path)).toEqual([
      `${linkDir('global')}/01-CLAUDE.md`,
      `${linkDir('global')}/02-.rules.md`,
      `${linkDir('global')}/03-my notes.md`,
    ])
    expect(plan.warnings).toEqual([])
  })

  test('the memory group links each memory file of this repo to its folder under projects (D-100)', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const plan = instructionPlan(role, user({ memoryFiles: ['MEMORY.md', 'b.md'] }))

    expect(plan.links).toEqual([
      {
        path: `${linkDir('memory')}/MEMORY.md`,
        target: '/home/u/.claude/projects/-repo/memory/MEMORY.md',
      },
      { path: `${linkDir('memory')}/b.md`, target: '/home/u/.claude/projects/-repo/memory/b.md' },
    ])
    expect(plan.warnings).toEqual([])
  })

  test('the memory folder is named after the mangled root and lies in the config dir of the user', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const plan = instructionPlan(role, user({ root: '/w/my repo', userDir: '/cfg', memoryFiles: ['x.md'] }))

    expect(plan.links).toEqual([
      {
        path: '/w/my repo/.cadre/pm/.runtime/instructions/memory/x.md',
        target: '/cfg/projects/-w-my-repo/memory/x.md',
      },
    ])
  })

  test('each memory is linked to the project folder that lists it, the realpath folder first (A6)', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const launcher = user({
      root: '/w/real',
      givenRoot: '/w/link',
      memoryFiles: ['a.md'],
      givenMemoryFiles: ['a.md', 'b.md'],
    })
    const plan = instructionPlan(role, launcher)

    expect(plan.links).toEqual([
      {
        path: '/w/real/.cadre/pm/.runtime/instructions/memory/a.md',
        target: '/home/u/.claude/projects/-w-real/memory/a.md',
      },
      {
        path: '/w/real/.cadre/pm/.runtime/instructions/memory/b.md',
        target: '/home/u/.claude/projects/-w-link/memory/b.md',
      },
    ])
    expect(plan.warnings).toEqual([])
  })

  test('with no link in the way each memory is linked once, to the realpath folder', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const plan = instructionPlan(role, user({ memoryFiles: ['a.md', 'b.md'], givenMemoryFiles: ['b.md', 'a.md'] }))

    expect(plan.links).toEqual([
      { path: `${linkDir('memory')}/a.md`, target: '/home/u/.claude/projects/-repo/memory/a.md' },
      { path: `${linkDir('memory')}/b.md`, target: '/home/u/.claude/projects/-repo/memory/b.md' },
    ])
  })

  test('no memory link points at a folder that did not list its name', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const real = '/home/u/.claude/projects/-w-real/memory/'
    const given = '/home/u/.claude/projects/-w-link/memory/'
    const lists: readonly Pick<LaunchUser, 'memoryFiles' | 'givenMemoryFiles'>[] = [
      { memoryFiles: ['a.md'], givenMemoryFiles: ['b.md'] },
      { memoryFiles: [], givenMemoryFiles: ['a.md', 'b.md'] },
      { memoryFiles: ['a.md', 'b.md'], givenMemoryFiles: [] },
      { memoryFiles: ['b.md', 'c.md'], givenMemoryFiles: ['a.md', 'b.md'] },
    ]
    const cases = lists.map(list => ({
      list,
      links: instructionPlan(role, user({ root: '/w/real', givenRoot: '/w/link', ...list })).links,
    }))
    const isListed = (target: string, list: Pick<LaunchUser, 'memoryFiles' | 'givenMemoryFiles'>): boolean => {
      const name = target.slice(target.lastIndexOf('/') + 1)
      if (target === `${real}${name}`) return list.memoryFiles.includes(name)

      return target === `${given}${name}` && list.givenMemoryFiles.includes(name) && !list.memoryFiles.includes(name)
    }

    expect(cases.flatMap(({ list, links }) => links.filter(link => !isListed(link.target, list)))).toEqual([])
    expect(cases.map(({ links }) => links.length)).toEqual([2, 2, 2, 3])
  })

  test('an unsafe memory name both folders list is warned about once and not linked', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const launcher = user({ givenRoot: '/w/link', memoryFiles: ['../x.md'], givenMemoryFiles: ['../x.md'] })
    const plan = instructionPlan(role, launcher)

    expect(plan.links).toEqual([])
    expect(plan.warnings).toEqual(['memory file ../x.md has an unsafe name: not linked'])
  })

  test('a memory name with a slash, a .. segment or a leading dot is not linked and warns', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const names = ['../x.md', '.hidden.md', '..', 'a/b.md', 'a..b.md', 'ok.md', '']
    const plan = instructionPlan(role, user({ memoryFiles: names }))

    expect(plan.links.map(link => link.path)).toEqual([`${linkDir('memory')}/a..b.md`, `${linkDir('memory')}/ok.md`])
    expect(plan.warnings).toEqual([
      'memory file  has an unsafe name: not linked',
      'memory file .. has an unsafe name: not linked',
      'memory file ../x.md has an unsafe name: not linked',
      'memory file .hidden.md has an unsafe name: not linked',
      'memory file a/b.md has an unsafe name: not linked',
    ])
  })

  test('a memory name with hidden characters is not linked, and the warning shows it cleaned', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const plan = instructionPlan(role, user({ memoryFiles: [`ev${BIDI_OVERRIDE}il.md`] }))

    expect(plan.links).toEqual([])
    expect(plan.warnings).toEqual(['memory file evil.md has an unsafe name: not linked'])
  })

  test('a memory name of 255 characters is linked and one of 256 is not', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const fits = `${'a'.repeat(252)}.md`
    const tooLong = `${'a'.repeat(253)}.md`
    const plan = instructionPlan(role, user({ memoryFiles: [fits, tooLong] }))

    expect(plan.links.map(link => link.path)).toEqual([`${linkDir('memory')}/${fits}`])
    expect(plan.warnings).toHaveLength(1)
  })

  test('a memory name with a space is linked: only a slash, a leading dot or hidden characters are refused', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const plan = instructionPlan(role, user({ memoryFiles: ['my memory.md'] }))

    expect(plan.links.map(link => link.target)).toEqual(['/home/u/.claude/projects/-repo/memory/my memory.md'])
    expect(plan.warnings).toEqual([])
  })

  test('a memory file listed twice is linked once', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })

    expect(instructionPlan(role, user({ memoryFiles: ['b.md', 'b.md'] })).links).toHaveLength(1)
  })

  test('a role without the global or memory group gets no link of that group, whatever exists on disk', () => {
    const files = { globalClaudeMd: ['/home/u/.claude/CLAUDE.md'], memoryFiles: ['MEMORY.md'] }
    const none = instructionPlan(templateRole('pm'), user(files))
    const onlyGlobal = instructionPlan(templateRole('pm', { instructions: ['global-claude-md'] }), user(files))
    const onlyMemory = instructionPlan(templateRole('pm', { instructions: ['auto-memory'] }), user(files))
    const onlyProject = instructionPlan(templateRole('pm', { instructions: ['project-claude-md'] }), user(files))

    expect(none.links).toEqual([])
    expect(onlyProject.links).toEqual([])
    expect(onlyGlobal.links.map(link => link.path)).toEqual([`${linkDir('global')}/01-CLAUDE.md`])
    expect(onlyMemory.links.map(link => link.path)).toEqual([`${linkDir('memory')}/MEMORY.md`])
  })

  test('the links of both groups are sorted by path and lie in the instructions folder of the role', () => {
    const role = templateRole('pm', { instructions: ['auto-memory', 'global-claude-md'] })
    const launcher = user({ globalClaudeMd: ['/home/u/.claude/CLAUDE.md'], memoryFiles: ['MEMORY.md'] })
    const paths = instructionPlan(role, launcher).links.map(link => link.path)

    expect(paths).toEqual([`${linkDir('global')}/01-CLAUDE.md`, `${linkDir('memory')}/MEMORY.md`])
    expect(paths.filter(path => !path.startsWith('/repo/.cadre/pm/.runtime/instructions/'))).toEqual([])
  })

  test('launchPlan puts the excludes into the settings and appends the links and the warnings', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md', 'auto-memory'], carry: CARRY_ALL })
    const scope = compileScope(role, context())
    const launcher = carrier({
      claudeMd: CHAIN,
      globalClaudeMd: ['/home/u/.claude/CLAUDE.md'],
      memoryFiles: ['MEMORY.md', '.bad.md'],
    })
    const plan = launchPlan(role, scope, launcher)

    expect(plan.settings.claudeMdExcludes).toEqual([
      '/home/u/work/CLAUDE.md',
      '/repo/.claude/CLAUDE.md',
      '/repo/CLAUDE.md',
    ])
    expect(plan.links.filter(link => link.path.includes('/instructions/'))).toEqual([
      { path: `${linkDir('global')}/01-CLAUDE.md`, target: '/home/u/.claude/CLAUDE.md' },
      { path: `${linkDir('memory')}/MEMORY.md`, target: '/home/u/.claude/projects/-repo/memory/MEMORY.md' },
    ])
    expect(plan.warnings).toEqual(['memory file .bad.md has an unsafe name: not linked'])
  })

  test('launchPlan lists the warnings of the denies before those of the instructions', () => {
    const role = templateRole('pm', { instructions: ['auto-memory'] })
    const scope = compileScope(role, context())
    const plan = launchPlan(role, scope, user({ root: '/w/a(b)', memoryFiles: ['../x.md'], userSkills: GSD_SKILLS }))

    expect(plan.warnings).toEqual([
      'the repo path holds characters a permission rule cannot hold: code-dir denies stay any-depth',
      'memory file ../x.md has an unsafe name: not linked',
    ])
  })

  test('a role given the project CLAUDE.md has no exclude in its settings', () => {
    const role = templateRole('pm', { instructions: ['project-claude-md'] })
    const plan = launchPlan(role, compileScope(role, context()), user({ claudeMd: CHAIN }))

    expect(plan.settings.claudeMdExcludes).toEqual([])
  })
})

/** The rule files of the fixture repo, a nested one included, as gatherLaunchUser lists them (G-02-1f, M4). */
const RULES = [
  '/repo/.claude/rules/security.md',
  '/repo/.claude/rules/style.md',
  '/repo/.claude/rules/frontend/react.md',
]

/** The built role files of the fixture repo: BE's own, PM's and QA's (G-02-1f). */
const ROLE_FILES = ['/repo/.cadre/be/CLAUDE.md', '/repo/.cadre/pm/CLAUDE.md', '/repo/.cadre/qa/CLAUDE.md']

/** Everything a parts-flow BE excludes in the fixture repo: the chain, the rules and the other roles' files, sorted. */
const BE_PARTS_EXCLUDES = sortedUnique([...CHAIN, ...RULES, '/repo/.cadre/pm/CLAUDE.md', '/repo/.cadre/qa/CLAUDE.md'])

describe('parts-flow excludes (G-02-1f)', () => {
  test("a role with no instruction group excludes the chain, each rule file and the other roles' built files", () => {
    const plan = instructionPlan(templateRole('be'), user({ claudeMd: CHAIN, rules: RULES, roleClaudeMds: ROLE_FILES }))

    expect(plan.claudeMdExcludes).toEqual(BE_PARTS_EXCLUDES)
    expect(plan.claudeMdExcludes).toContain('/repo/.claude/rules/frontend/react.md')
    expect(plan.claudeMdExcludes).not.toContain('/repo/.cadre/be/CLAUDE.md')
  })

  test('a role with groups keeps the whole-files rule: the chain, or nothing with the project group', () => {
    const launcher = user({ claudeMd: CHAIN, rules: RULES, roleClaudeMds: ROLE_FILES })
    const globalOnly = instructionPlan(templateRole('be', { instructions: ['global-claude-md'] }), launcher)
    const project = instructionPlan(templateRole('be', { instructions: ['project-claude-md'] }), launcher)

    expect(globalOnly.claudeMdExcludes).toEqual(sortedUnique(CHAIN))
    expect(project.claudeMdExcludes).toEqual([])
  })

  test('launchPlan renders the parts-flow excludes into the runtime settings, sorted and once each', () => {
    const role = templateRole('be')
    const launcher = user({ claudeMd: CHAIN, rules: [...RULES, ...RULES], roleClaudeMds: ROLE_FILES })
    const plan = launchPlan(role, compileScope(role, context()), launcher)

    expect(plan.settings.claudeMdExcludes).toEqual(BE_PARTS_EXCLUDES)
  })

  test("only <root>/.cadre/<id>/CLAUDE.md is the role's own: a role with a longer id is another", () => {
    const files = ['/w/repo/.cadre/be/CLAUDE.md', '/w/repo/.cadre/bee/CLAUDE.md', '/other/.cadre/be/CLAUDE.md']
    const plan = instructionPlan(templateRole('be'), user({ root: '/w/repo', roleClaudeMds: files }))

    expect(plan.claudeMdExcludes).toEqual(['/other/.cadre/be/CLAUDE.md', '/w/repo/.cadre/bee/CLAUDE.md'])
  })

  test('with no rule file and no built file a parts-flow role excludes the chain alone, as before', () => {
    expect(instructionPlan(templateRole('be'), user({ claudeMd: CHAIN })).claudeMdExcludes).toEqual(sortedUnique(CHAIN))
  })
})
