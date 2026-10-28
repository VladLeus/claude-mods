import { describe, expect, test } from 'claude-code/testing'

import type { CompiledScope, ScopeContext } from '../../types'
import { sortedUnique } from '../core/text'
import { adapterOf } from '../framework/registry'
import { INFRA_SKILLS } from '../roles/infra'
import { compileScope } from '../scope/compile'
import { BIDI_OVERRIDE, emptySetupScan, templateRole } from '../testkit'
import type { LaunchUser } from './links'
import { overlayLinks } from './overlay'
import { launchPlan } from './plan'

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

/** The scope with one more deny entry; the compiled value is never changed. */
function withDeny(scope: CompiledScope, entry: string): CompiledScope {
  const permissions = { ...scope.settings.permissions, deny: [...scope.settings.permissions.deny, entry] }

  return { ...scope, settings: { ...scope.settings, permissions } }
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

describe('overlayLinks', () => {
  const OVERLAY = '/repo/.cadre/pm/.runtime/overlay/.claude'

  test('each overlay skill and agent is linked to the user folder it lives in, sorted by path (S4 V3)', () => {
    const overlay = { skills: ['create-handoff-doc', 'gsd-autonomous', 'resume-handoff-doc'], agents: ['gsd-planner'] }
    const launcher = user({ userSkills: overlay.skills, userAgents: ['gsd-planner'] })

    expect(overlayLinks('pm', overlay, launcher)).toEqual({
      links: [
        { path: `${OVERLAY}/agents/gsd-planner.md`, target: '/home/u/.claude/agents/gsd-planner.md' },
        { path: `${OVERLAY}/skills/create-handoff-doc`, target: '/home/u/.claude/skills/create-handoff-doc' },
        { path: `${OVERLAY}/skills/gsd-autonomous`, target: '/home/u/.claude/skills/gsd-autonomous' },
        { path: `${OVERLAY}/skills/resume-handoff-doc`, target: '/home/u/.claude/skills/resume-handoff-doc' },
      ],
      warnings: [],
    })
  })

  test('the targets lie in the config dir of the user, and the links under the role folder of the repo', () => {
    const overlay = { skills: ['a'], agents: ['b'] }
    const launcher = user({ root: '/w/my repo', userDir: '/cfg', userSkills: ['a'], userAgents: ['b'] })
    const result = overlayLinks('be', overlay, launcher)

    expect(result.links).toEqual([
      {
        path: '/w/my repo/.cadre/be/.runtime/overlay/.claude/agents/b.md',
        target: '/cfg/agents/b.md',
      },
      {
        path: '/w/my repo/.cadre/be/.runtime/overlay/.claude/skills/a',
        target: '/cfg/skills/a',
      },
    ])
  })

  test('a skill the user does not have is not linked and warns', () => {
    const result = overlayLinks('pm', { skills: ['a', 'b'], agents: [] }, user({ userSkills: ['a'] }))

    expect(result.links.map(link => link.path)).toEqual([`${OVERLAY}/skills/a`])
    expect(result.warnings).toEqual(['skill b was not found in your user skills: not linked'])
  })

  test('an agent the user does not have is not linked and warns', () => {
    const result = overlayLinks('pm', { skills: [], agents: ['a', 'b'] }, user({ userAgents: ['b'] }))

    expect(result.links.map(link => link.path)).toEqual([`${OVERLAY}/agents/b.md`])
    expect(result.warnings).toEqual(['agent a was not found in your user agents: not linked'])
  })

  test('a name that is not a plain name is not linked and warns, even when the user lists it', () => {
    const unsafe = ['../x', '.hidden', 'a b', 'a/../b', 'codex:rescue']
    const names = [...unsafe, 'ok']
    const result = overlayLinks('pm', { skills: names, agents: names }, user({ userSkills: names, userAgents: names }))

    expect(result.links.map(link => link.path)).toEqual([`${OVERLAY}/agents/ok.md`, `${OVERLAY}/skills/ok`])
    expect(result.warnings).toEqual([
      ...unsafe.map(name => `skill ${name} has an unsafe name: not linked`),
      ...unsafe.map(name => `agent ${name} has an unsafe name: not linked`),
    ])
  })

  test('pin: a name with a .. segment or a slash is refused, and dots inside a plain name are kept (B5)', () => {
    const names = ['..', '../x', 'x/..', 'a/../b', 'a..b', 'v1.2']
    const result = overlayLinks('pm', { skills: names, agents: [] }, user({ userSkills: names }))

    expect(result.links.map(link => link.path)).toEqual([`${OVERLAY}/skills/a..b`, `${OVERLAY}/skills/v1.2`])
    expect(result.warnings).toEqual([
      'skill .. has an unsafe name: not linked',
      'skill ../x has an unsafe name: not linked',
      'skill a/../b has an unsafe name: not linked',
      'skill x/.. has an unsafe name: not linked',
    ])
  })

  test('a name that is both unsafe and absent from the user is reported as unsafe, never looked up', () => {
    const result = overlayLinks('pm', { skills: ['../x'], agents: ['a b'] }, user())

    expect(result.links).toEqual([])
    expect(result.warnings).toEqual([
      'skill ../x has an unsafe name: not linked',
      'agent a b has an unsafe name: not linked',
    ])
  })

  test('a name is plain up to 80 characters; an empty name and a name of 81 are not', () => {
    const fits = 'a'.repeat(80)
    const names = ['', fits, 'a'.repeat(81)]
    const result = overlayLinks('pm', { skills: names, agents: [] }, user({ userSkills: names }))

    expect(result.links.map(link => link.path)).toEqual([`${OVERLAY}/skills/${fits}`])
    expect(result.warnings).toHaveLength(2)
  })

  test('a hidden character in a name is refused, and the warning shows the name cleaned', () => {
    const name = `ev${BIDI_OVERRIDE}il`
    const result = overlayLinks('pm', { skills: [name], agents: [] }, user({ userSkills: [name] }))

    expect(result.links).toEqual([])
    expect(result.warnings).toEqual(['skill evil has an unsafe name: not linked'])
  })

  test('the warnings list the skills before the agents, each in name order', () => {
    const result = overlayLinks('pm', { skills: ['s2', 's1'], agents: ['a2', 'a1'] }, user())

    expect(result.warnings).toEqual([
      'skill s1 was not found in your user skills: not linked',
      'skill s2 was not found in your user skills: not linked',
      'agent a1 was not found in your user agents: not linked',
      'agent a2 was not found in your user agents: not linked',
    ])
  })

  test('a name given twice is linked once, and an empty overlay plans nothing', () => {
    const twice = overlayLinks('pm', { skills: ['a', 'a'], agents: [] }, user({ userSkills: ['a'] }))

    expect(twice.links).toHaveLength(1)
    expect(overlayLinks('pm', { skills: [], agents: [] }, user())).toEqual({ links: [], warnings: [] })
  })

  test('launchPlan links the instructions and the overlay together, sorted by path, and warns in step order', () => {
    const role = templateRole('pm', { instructions: ['global-claude-md', 'auto-memory'] })
    const scope = compileScope(role, context())
    const launcher = user({
      codeDirs: ['*'],
      globalClaudeMd: ['/home/u/.claude/CLAUDE.md'],
      memoryFiles: ['.bad.md'],
      userSkills: [...INFRA_SKILLS],
    })
    const plan = launchPlan(role, scope, launcher)
    const notFound = (name: string): string => `skill ${name} was not found in your user skills: not linked`

    expect(plan.links.map(link => link.path)).toEqual([
      '/repo/.cadre/pm/.runtime/instructions/global/01-CLAUDE.md',
      `${OVERLAY}/skills/create-handoff-doc`,
      `${OVERLAY}/skills/resume-handoff-doc`,
    ])
    expect(plan.warnings).toEqual([
      'Code dir * has an unusual name and is not denied',
      'memory file .bad.md has an unsafe name: not linked',
      ...sortedUnique(adapterOf('gsd').startSkills).map(notFound),
    ])
  })

  test('a hostile long name is cleaned and cut to 110 characters wherever a warning shows it', () => {
    const name = `a${BIDI_OVERRIDE}b${'x'.repeat(300)}`
    const shown = `ab${'x'.repeat(107)}…`
    const role = templateRole('pm', { skills: [name], instructions: ['global-claude-md', 'auto-memory'] })
    const scope = withDeny(compileScope(role, context()), `Read(/${name}/**)`)
    const launcher = carrier({ codeDirs: [name], globalClaudeMd: [`/home/u/x/${name}`], memoryFiles: [name] })
    const plan = launchPlan(role, scope, launcher)

    expect(plan.warnings).toEqual([
      `Code dir ${shown} has an unusual name and is not denied`,
      `Read(/ab${'x'.repeat(101)}… was not emitted: single leading / matches nothing (P13)`,
      `global file ${shown} has an unsafe name: not linked`,
      `memory file ${shown} has an unsafe name: not linked`,
      `skill ${shown} has an unsafe name: not linked`,
    ])
  })

  test('launchPlan links the overlay skills and the gsd agents for a user who has them all', () => {
    const role = templateRole('be')
    const scope = compileScope(role, context({ setup: emptySetupScan({ agents: ['gsd-planner', 'my-agent'] }) }))
    const launcher = user({
      userSkills: [...INFRA_SKILLS, ...adapterOf('gsd').startSkills],
      userAgents: ['gsd-planner', 'my-agent'],
    })
    const plan = launchPlan(role, scope, launcher)

    expect(plan.warnings).toEqual([])
    expect(plan.links.filter(link => link.path.includes('/agents/')).map(link => link.target)).toEqual([
      '/home/u/.claude/agents/gsd-planner.md',
    ])
    expect(plan.links.filter(link => link.path.includes('/skills/'))).toHaveLength(scope.overlay.skills.length)
  })
})
