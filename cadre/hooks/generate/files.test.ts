import { describe, expect, test } from 'claude-code/testing'

import type {
  CadreState,
  CompiledScope,
  DesiredFile,
  FileOp,
  FrameworkId,
  InstructionPart,
  RoleSpec,
  ScopeContext,
  SetupScan,
} from '../../types'
import { isObject } from '../core/json'
import { compareText } from '../core/text'
import {
  cadreJsonText,
  indexMdText,
  kickoffText,
  launcherText,
  mcpText,
  roleClaudeMdText,
  roleJsonText,
  roleMdText,
  settingsText,
} from '../generate'
import { buildPlan, isSafeOpPath } from '../plan/plan'
import { ROLE_TEMPLATE, roleFromTemplate } from '../roles/template'
import { compileScope } from '../scope'
import { infraViolations } from '../scope/lint'
import {
  ABSOLUTE_PATH_MARKERS,
  emptySetupScan,
  FRAMEWORKS,
  leaks,
  SECRET_FIXTURES,
  session,
  skillRef,
  templateRole,
} from '../testkit'
import { desiredFiles } from './files'
import type { GenerateInput } from './files'

/** The six template roles, as init builds them with nothing assigned. */
const TEMPLATE_ROLES: readonly RoleSpec[] = ROLE_TEMPLATE.map(row => roleFromTemplate(row))

/**
 * The compiled scope of a role on the merged MCP route, with the whole team for the decision chain; `over` changes the
 * context fields it names.
 */
function scopeOf(
  role: RoleSpec,
  framework: FrameworkId,
  team: readonly RoleSpec[],
  over: Partial<ScopeContext> = {},
): CompiledScope {
  const ctx: ScopeContext = {
    framework,
    setup: emptySetupScan(),
    codeDirs: [],
    isAttended: false,
    mcpRoute: 'merged',
    launchStart: { kind: 'git-root' },
    roles: team,
    ...over,
  }

  return compileScope(role, ctx)
}

/** The repo state of a team on one framework: what init writes as .cadre/cadre.json. */
function stateOf(team: readonly RoleSpec[], framework: FrameworkId): CadreState {
  return {
    schema: 1,
    cadreVersion: '0.2.0',
    framework,
    gitPolicy: 'definitions',
    roles: team.map(role => role.id),
    launchStart: { kind: 'git-root' },
    readUserMcp: false,
  }
}

/** The input init gives desiredFiles for a team that runs one framework; `over` changes the fields it names. */
function inputOf(team: readonly RoleSpec[], framework: FrameworkId, over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    roles: team,
    scopes: new Map(team.map((role): [string, CompiledScope] => [role.id, scopeOf(role, framework, team)])),
    state: stateOf(team, framework),
    only: null,
    ...over,
  }
}

/** The paths of the files init wants for the BE role alone, sorted by code unit. */
const BE_PATHS: readonly string[] = [
  '.cadre/INDEX.md',
  '.cadre/be/ROLE.md',
  '.cadre/be/kickoff.txt',
  '.cadre/be/mcp.json',
  '.cadre/be/role.json',
  '.cadre/be/settings.json',
  '.cadre/bin/be',
  '.cadre/cadre.json',
]

/** The text of one desired file; undefined when the path is not desired. */
function contentOf(files: readonly DesiredFile[], path: string): string | undefined {
  return files.find(file => file.path === path)?.content
}

/** The desired paths that belong to one role: its folder and its launcher. */
function pathsOfRole(files: readonly DesiredFile[], id: string): string[] {
  return files.map(file => file.path).filter(path => path.startsWith(`.cadre/${id}/`) || path === `.cadre/bin/${id}`)
}

/** The first line of the built CLAUDE.md of role `id`, as the plan writes it (G-02-1f, D-140). */
function builtHeader(id: string): string {
  return (
    `<!-- cadre: instructions for role ${id}, built from this repo's CLAUDE.md files, rules and docs. ` +
    `Edit the originals and run /cadre regen ${id}; this file is rebuilt. -->`
  )
}

/** An instruction part as the reader gives it, from the repo unless told otherwise; the hash is a fixed stand-in. */
function part(
  id: string,
  file: string,
  heading: string,
  text: string,
  source: InstructionPart['source'] = 'repo',
): InstructionPart {
  return { id, file, heading, source, text, hash: 'a'.repeat(64) }
}

/** The Rules section of the root CLAUDE.md, with the blank line before the next heading, as the reader keeps it. */
const RULES_PART = part('P2', 'CLAUDE.md', 'Rules', '# Rules\nRun the tests before a commit.\n\n')

/** A sentence of the global CLAUDE.md that no file in the repo may hold (T-02-69). */
const GLOBAL_ONLY_SENTENCE = 'GLOBAL-ONLY-SENTENCE stays out of the repo'

/** A part of the global CLAUDE.md, which never goes into a built role file (T-02-69). */
const GLOBAL_PART = part('P1', '~/.claude/CLAUDE.md', 'Private', `# Private\n${GLOBAL_ONLY_SENTENCE}.\n`, 'global')

/** The table row of the role with this id in an index; undefined when it has none. */
function indexRowOf(index: string, id: string): string | undefined {
  return index.split('\n').find(line => line.includes(`| .cadre/bin/${id} |`))
}

describe('desiredFiles', () => {
  test('one role gives its five definition files, its launcher, the index and the repo state, sorted by path', () => {
    const files = desiredFiles(inputOf([templateRole('be')], 'gsd'))

    expect(files.map(file => file.path)).toEqual(BE_PATHS)
  })

  test('only the launcher is executable', () => {
    const files = desiredFiles(inputOf([templateRole('be')], 'gsd'))

    expect(files.filter(file => file.mode === 'exec').map(file => file.path)).toEqual(['.cadre/bin/be'])
    expect(files.filter(file => file.mode === 'file')).toHaveLength(BE_PATHS.length - 1)
  })

  test('role.json, kickoff.txt, settings.json and mcp.json hold the text of their builders', () => {
    const be = templateRole('be', { mcp: ['jira'] })
    const scope = scopeOf(be, 'superpowers', [be])
    const files = desiredFiles(inputOf([be], 'superpowers'))

    expect(contentOf(files, '.cadre/be/role.json')).toBe(roleJsonText(be))
    expect(contentOf(files, '.cadre/be/kickoff.txt')).toBe(kickoffText(be, 'superpowers'))
    expect(contentOf(files, '.cadre/be/settings.json')).toBe(settingsText(scope))
    expect(contentOf(files, '.cadre/be/mcp.json')).toBe(mcpText(scope))
  })

  test('each role is generated with its own framework', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const team = [pm, be]
    const scopes = new Map([
      ['pm', scopeOf(pm, 'gsd', team)],
      ['be', scopeOf(be, 'none', team)],
    ])
    const files = desiredFiles(inputOf(team, 'gsd', { scopes }))

    expect(contentOf(files, '.cadre/pm/kickoff.txt')).toContain('start with /gsd-autonomous.')
    expect(contentOf(files, '.cadre/be/kickoff.txt')).toContain('start with the plan in .cadre/be/.runtime/plan.md.')
  })

  test('ROLE.md, kickoff.txt and the index row take the framework the scope was compiled for (A4)', () => {
    const be = templateRole('be')
    const scopes = new Map([['be', scopeOf(be, 'superpowers', [be])]])
    const files = desiredFiles({ ...inputOf([be], 'gsd'), scopes })

    expect(contentOf(files, '.cadre/be/ROLE.md')).toContain('Framework: superpowers.')
    expect(contentOf(files, '.cadre/be/kickoff.txt')).toContain('start with superpowers:brainstorming.')
    expect(indexRowOf(contentOf(files, '.cadre/INDEX.md') ?? '', 'be')).toContain(' | superpowers | ')
  })

  test('the six template roles give 36 role files, the index and the repo state, sorted and once each', () => {
    const paths = desiredFiles(inputOf(TEMPLATE_ROLES, 'gsd')).map(file => file.path)

    expect(paths).toHaveLength(6 * 6 + 2)
    expect(paths).toEqual([...paths].sort(compareText))
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.filter(path => path.startsWith('.cadre/bin/'))).toEqual(
      ['pm', 'tl', 'be', 'fe', 'qa', 'security'].map(id => `.cadre/bin/${id}`).sort(compareText),
    )
  })

  test('with only a role id the set is that role, its launcher and the index, and no repo state (D-68)', () => {
    const files = desiredFiles(inputOf(TEMPLATE_ROLES, 'gsd', { only: 'be' }))

    expect(files.map(file => file.path)).toEqual(BE_PATHS.filter(path => path !== '.cadre/cadre.json'))
  })

  test('with only an id that is not on the team the set is the index alone', () => {
    const files = desiredFiles(inputOf(TEMPLATE_ROLES, 'gsd', { only: 'nobody' }))

    expect(files.map(file => file.path)).toEqual(['.cadre/INDEX.md'])
  })

  test('a role with no scope is skipped, with its launcher', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const full = inputOf([pm, be], 'gsd')
    const noScope = desiredFiles({ ...full, scopes: new Map([['pm', scopeOf(pm, 'gsd', [pm, be])]]) })

    expect(pathsOfRole(noScope, 'be')).toEqual([])
    expect(pathsOfRole(noScope, 'pm')).toHaveLength(6)
  })

  test('generation keeps no state: the same input gives the same files and the input is not changed', () => {
    const input = inputOf(TEMPLATE_ROLES, 'gsd')
    const snapshot = (): string => JSON.stringify([input.roles, Array.from(input.scopes), input.state])
    const before = snapshot()
    const first = desiredFiles(input)
    const second = desiredFiles(input)

    expect(second).toEqual(first)
    expect(second).not.toBe(first)
    expect(snapshot()).toBe(before)
  })

  test('ROLE.md, the launcher, the index and the repo state hold the text of their builders', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const input = inputOf([pm, be], 'gsd')
    const files = desiredFiles(input)
    const scope = scopeOf(be, 'gsd', [pm, be])

    expect(contentOf(files, '.cadre/be/ROLE.md')).toBe(roleMdText(be, scope))
    expect(contentOf(files, '.cadre/bin/be')).toBe(launcherText(be, scope, input.state.launchStart))
    expect(contentOf(files, '.cadre/INDEX.md')).toBe(indexMdText(input.roles, input.scopes))
    expect(contentOf(files, '.cadre/cadre.json')).toBe(cadreJsonText(input.state))
  })

  test('with only a role id the index still lists every role and has the same text as for init (D-68)', () => {
    const all = desiredFiles(inputOf(TEMPLATE_ROLES, 'gsd'))
    const one = desiredFiles(inputOf(TEMPLATE_ROLES, 'gsd', { only: 'be' }))
    const index = contentOf(one, '.cadre/INDEX.md') ?? ''

    expect(index).toBe(contentOf(all, '.cadre/INDEX.md'))
    expect(index.split('\n').filter(line => line.includes('| .cadre/bin/'))).toHaveLength(TEMPLATE_ROLES.length)
  })
})

describe('a built file for every role (02-GAPS-B2 S1)', () => {
  test('with repoParts set every role gets .cadre/<id>/CLAUDE.md, the header alone with no repo part', () => {
    const roles = [templateRole('pm'), templateRole('be'), templateRole('qa')]
    const repoParts = new Map([
      ['be', [RULES_PART]],
      ['pm', [GLOBAL_PART]],
    ])
    const files = desiredFiles(inputOf(roles, 'gsd', { repoParts }))

    expect(files.filter(file => file.path.endsWith('/CLAUDE.md'))).toEqual([
      { path: '.cadre/be/CLAUDE.md', content: roleClaudeMdText('be', [RULES_PART]), mode: 'file' },
      { path: '.cadre/pm/CLAUDE.md', content: `${builtHeader('pm')}\n`, mode: 'file' },
      { path: '.cadre/qa/CLAUDE.md', content: `${builtHeader('qa')}\n`, mode: 'file' },
    ])
  })

  test('with repoParts set and empty, every role still gets the header-only file; without it, none does', () => {
    const roles = [templateRole('pm'), templateRole('be')]
    const empty = desiredFiles(inputOf(roles, 'gsd', { repoParts: new Map() }))
    const without = desiredFiles(inputOf(roles, 'gsd'))

    expect(empty.filter(file => file.path.endsWith('/CLAUDE.md')).map(file => file.content)).toEqual([
      `${builtHeader('be')}\n`,
      `${builtHeader('pm')}\n`,
    ])
    expect(without.filter(file => file.path.endsWith('/CLAUDE.md'))).toEqual([])
  })
})

/**
 * What a scan of the secret world kept, as names only: the env names and hook basenames of the secret settings beside
 * the scanned servers, skills, agents and plugins. The values of that world are the SECRET_FIXTURES, which a scan never
 * keeps and a generated file must never hold.
 */
const WORLD_SETUP: SetupScan = {
  plugins: ['superpowers@claude-plugins-official', 'codex@openai-codex'],
  installedPlugins: ['codex@openai-codex', 'superpowers@claude-plugins-official'],
  skills: [
    skillRef('my-skill'),
    skillRef('gsd-health'),
    skillRef('create-handoff-doc'),
    skillRef('codex:rescue', 'codex'),
    skillRef('superpowers:brainstorming', 'superpowers'),
    skillRef('autopilot', 'autopilot'),
  ],
  mcp: [session('jira'), session('playwright'), session('github'), session('autopilot'), session('sentry')],
  isMcpPartial: false,
  agents: ['gsd-planner', 'my-agent'],
  claudeMd: ['<repo>/CLAUDE.md', '~/.claude/CLAUDE.md'],
  hasGlobalClaudeMd: true,
  memoryFiles: ['~/.claude/projects/-repo/memory/MEMORY.md'],
  settingsKeys: [{ source: 'user', keys: ['autoCompactWindow', 'env', 'hooks', 'statusLine'] }],
  hooks: [
    { script: 'gsd-secret-read-guard.js', event: 'PreToolUse', source: 'user' },
    { script: 'my-hook.sh', event: 'PreToolUse', source: 'user' },
  ],
  carry: { autoCompactWindow: 800000, hasStatusLine: true, isGsdStatusline: true, envNames: ['API_KEY', 'JIRA_URL'] },
  warnings: [],
}

/** The ways a template role may be assigned names: nothing, or every scanned server, skill, hook and env name. */
const WORLD_ASSIGNMENTS: readonly (readonly [string, (role: RoleSpec) => RoleSpec])[] = [
  ['nothing assigned', role => role],
  [
    'everything assigned',
    role => ({
      ...role,
      mcp: WORLD_SETUP.mcp.map(ref => ref.name),
      skills: WORLD_SETUP.skills.map(item => item.name),
      instructions: ['global-claude-md', 'auto-memory', 'project-claude-md'],
      carry: {
        autoCompactWindow: true,
        statusLine: true,
        env: WORLD_SETUP.carry.envNames,
        hooks: WORLD_SETUP.hooks.map(item => item.script),
      },
    }),
  ],
]

/** The contexts the matrix runs: the merged MCP route unattended, and the strict route attended. */
const WORLD_CONTEXTS: readonly (readonly [string, Partial<ScopeContext>])[] = [
  ['merged', { mcpRoute: 'merged' }],
  ['strict and attended', { mcpRoute: 'strict', isAttended: true }],
]

/** The input init gives desiredFiles for the six template roles in one framework, with the secret world scanned. */
function worldInput(
  framework: FrameworkId,
  assign: (role: RoleSpec) => RoleSpec,
  over: Partial<ScopeContext>,
): GenerateInput {
  const team = TEMPLATE_ROLES.map(assign)
  const world: Partial<ScopeContext> = { setup: WORLD_SETUP, codeDirs: ['autopilot', 'cadre'], ...over }

  return {
    roles: team,
    scopes: new Map(team.map((role): [string, CompiledScope] => [role.id, scopeOf(role, framework, team, world)])),
    state: stateOf(team, framework),
    only: null,
  }
}

/** A check of the files init wants for one matrix input: its problems as messages, empty when there are none. */
type FilesCheck = (input: GenerateInput, files: readonly DesiredFile[]) => string[]

/** Every problem a check finds over the matrix of frameworks, assignments and contexts, with where it was found. */
function worldProblems(check: FilesCheck): string[] {
  const problems: string[] = []
  for (const framework of FRAMEWORKS) {
    for (const [assignment, assign] of WORLD_ASSIGNMENTS) {
      for (const [context, over] of WORLD_CONTEXTS) {
        const input = worldInput(framework, assign, over)
        const where = `${framework} / ${assignment} / ${context}`
        problems.push(...check(input, desiredFiles(input)).map(problem => `${where}: ${problem}`))
      }
    }
  }

  return problems
}

/** What no committed file may hold (PLAN-05): a secret, the start of an absolute user path, or a variable reference. */
const FORBIDDEN_TEXT: readonly string[] = [...SECRET_FIXTURES, ...ABSOLUTE_PATH_MARKERS, '${']

/** The ways a desired file holds forbidden text, as messages. */
function contentProblems(file: DesiredFile): string[] {
  return leaks(file.content, FORBIDDEN_TEXT).map(needle => `${file.path} holds ${needle}`)
}

/**
 * Whether lowercased path segments name a role's built `.cadre/<id>/CLAUDE.md`, the one CLAUDE.md a plan may hold
 * (G-02-1f Storage split, D-140): directly in a role folder, never in `.cadre/bin/` or deeper.
 */
function isBuiltRoleFile(segments: readonly string[]): boolean {
  return segments.length === 3 && segments[0] === '.cadre' && segments[1] !== 'bin' && segments[2] === 'claude.md'
}

/** The ways the path of a desired file breaks PLAN-06 (D-50, as D-140 amends it for built role files), as messages. */
function pathProblems(file: DesiredFile): string[] {
  const segments = file.path.toLowerCase().split('/')
  const problems: string[] = []
  const isInstructionFile = /(?:claude|agents)\.md$/.test(file.path.toLowerCase())
  if (!isSafeOpPath(file.path)) problems.push(`${file.path} is not a safe op path`)
  if (isInstructionFile && !isBuiltRoleFile(segments)) problems.push(`${file.path} is a CLAUDE.md or AGENTS.md`)
  if (segments.includes('.claude')) problems.push(`${file.path} is under a .claude folder`)
  if (segments.includes('.runtime')) problems.push(`${file.path} is in a .runtime folder`)

  return problems
}

/** The problems with the text of an mcp.json: it must hold exactly the schema and the sorted server names (D-93). */
function mcpFileProblems(path: string, content: string): string[] {
  const parsed: unknown = JSON.parse(content)
  if (!isObject(parsed)) return [`${path} is not an object`]
  const problems: string[] = []
  if (Object.keys(parsed).sort(compareText).join(',') !== 'schema,servers') problems.push(`${path} has other keys`)
  if (parsed.schema !== 1) problems.push(`${path} has schema ${JSON.stringify(parsed.schema)}`)
  const servers = parsed.servers
  const isNames = Array.isArray(servers) && servers.every(name => typeof name === 'string')
  if (!isNames) return [...problems, `${path} servers are not a list of names`]
  if (servers.join(',') !== [...servers].sort(compareText).join(',')) problems.push(`${path} servers are not sorted`)

  return problems
}

/** The problems with the text of a settings.json: only the three template keys, and no infra tool blocked. */
function settingsFileProblems(path: string, content: string, scope: CompiledScope, framework: FrameworkId): string[] {
  const parsed = JSON.parse(content)
  const keys = Object.keys(parsed).sort(compareText).join(',')
  const problems: string[] = []
  if (keys !== 'enabledPlugins,permissions,sandbox') problems.push(`${path} has the keys ${keys}`)
  problems.push(...infraViolations({ ...scope, settings: parsed }, framework).map(problem => `${path}: ${problem}`))

  return problems
}

/** The mcp.json problems of every role of an input. */
const mcpFilesCheck: FilesCheck = (input, files) =>
  input.roles.flatMap(role => {
    const path = `.cadre/${role.id}/mcp.json`
    const content = contentOf(files, path)

    return content === undefined ? [`${path} is missing`] : mcpFileProblems(path, content)
  })

/** The settings.json problems of every role of an input. */
const settingsFilesCheck: FilesCheck = (input, files) =>
  input.roles.flatMap(role => {
    const path = `.cadre/${role.id}/settings.json`
    const content = contentOf(files, path)
    const scope = input.scopes.get(role.id)
    if (content === undefined || scope === undefined) return [`${path} is missing`]

    return settingsFileProblems(path, content, scope, scope.card.framework)
  })

describe('generated file properties', () => {
  test('the matrix is six roles, three frameworks, two assignments and two contexts of 38 files each', () => {
    let runs = 0
    const sizes = new Set<number>()
    worldProblems((_input, files) => {
      runs += 1
      sizes.add(files.length)

      return []
    })

    expect(runs).toBe(3 * 2 * 2)
    expect(Array.from(sizes)).toEqual([6 * 6 + 2])
    expect(WORLD_ASSIGNMENTS.map(([label]) => label)).toEqual(['nothing assigned', 'everything assigned'])
  })

  test('no generated file holds a secret, an absolute user path or a variable reference (PLAN-05)', () => {
    expect(worldProblems((_input, files) => files.flatMap(contentProblems))).toEqual([])
  })

  test('every generated path is a safe op path, and none is a CLAUDE.md, an AGENTS.md, in .claude or .runtime', () => {
    expect(worldProblems((_input, files) => files.flatMap(pathProblems))).toEqual([])
  })

  test('built role CLAUDE.md files pass the content and path checks and hold no global part (PLAN-05, T-02-69)', () => {
    const input = worldInput('gsd', role => role, {})
    const keys = `# Keys\n${SECRET_FIXTURES[0]} in /Users/alice\n`
    const secretPart = part('P1', '~/.claude/CLAUDE.md', 'Keys', keys, 'global')
    const given = (role: RoleSpec): [string, InstructionPart[]] => [role.id, [secretPart, RULES_PART]]
    const files = desiredFiles({ ...input, repoParts: new Map(input.roles.map(given)) })
    const built = files.filter(file => file.path.endsWith('/CLAUDE.md')).map(file => file.path)

    expect(built).toEqual(input.roles.map(role => `.cadre/${role.id}/CLAUDE.md`).sort(compareText))
    expect(files.flatMap(contentProblems)).toEqual([])
    expect(files.flatMap(pathProblems)).toEqual([])
  })

  test('every mcp.json holds exactly the schema and a sorted list of server names (D-93)', () => {
    expect(worldProblems(mcpFilesCheck)).toEqual([])
  })

  test('every settings.json has only the three template keys and passes the ISO-04 checker, parsed back (D-84)', () => {
    expect(worldProblems(settingsFilesCheck)).toEqual([])
  })

  test('buildPlan creates every generated file on an empty disk, the launchers executable, no warning', async () => {
    const files = desiredFiles(worldInput('gsd', role => role, {}))
    const plan = await buildPlan({
      desired: files,
      disk: new Map(),
      manifest: null,
      manifestState: 'absent',
      carried: [],
      gitignore: null,
      hunks: [],
      cadreVersion: '0.2.0',
    })
    const created = plan.ops.filter((op): op is FileOp => op.kind === 'create')
    const wanted = [...files.map(file => file.path), '.cadre/manifest.json'].sort(compareText)

    expect(plan.warnings).toEqual([])
    expect(created).toHaveLength(plan.ops.length)
    expect(created.map(op => op.path)).toEqual(wanted)
    expect(created.filter(op => op.path.startsWith('.cadre/bin/')).every(op => op.mode === 'exec')).toBe(true)
  })

  test('the content check finds a secret, an absolute user path and a variable reference', () => {
    const bad = (content: string): DesiredFile => ({ path: '.cadre/be/ROLE.md', content, mode: 'file' })

    expect(contentProblems(bad(`key ${SECRET_FIXTURES[0]}`))).toHaveLength(1)
    expect(contentProblems(bad('cd /Users/alice/repo'))).toEqual(['.cadre/be/ROLE.md holds /Users/'])
    expect(contentProblems(bad('/home/u/.claude'))).toEqual(['.cadre/be/ROLE.md holds /home/'])
    expect(contentProblems(bad('${HOME}/x'))).toEqual(['.cadre/be/ROLE.md holds ${'])
    expect(contentProblems(bad('fine'))).toEqual([])
  })

  test('the path check finds a path outside .cadre, a non-role CLAUDE.md, an AGENTS.md, .claude and .runtime', () => {
    const at = (path: string): DesiredFile => ({ path, content: '', mode: 'file' })

    expect(pathProblems(at('CLAUDE.md')).length > 0).toBe(true)
    expect(pathProblems(at('.cadre/be/CLAUDE.md'))).toEqual([])
    expect(pathProblems(at('.cadre/bin/CLAUDE.md')).length > 0).toBe(true)
    expect(pathProblems(at('.cadre/be/docs/CLAUDE.md')).length > 0).toBe(true)
    expect(pathProblems(at('.cadre/be/agents.md')).length > 0).toBe(true)
    expect(pathProblems(at('.cadre/.claude/settings.json')).length > 0).toBe(true)
    expect(pathProblems(at('.cadre/be/.runtime/settings.json')).length > 0).toBe(true)
    expect(pathProblems(at('../outside'))).toContain('../outside is not a safe op path')
    expect(pathProblems(at('.cadre/be/ROLE.md'))).toEqual([])
  })

  test('the json checks find an extra key, a bad schema, an unsorted list, a blocked tool and a missing plugin', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', [be])
    const mcp = (value: unknown): string[] => mcpFileProblems('mcp.json', JSON.stringify(value))
    const settings = (value: unknown): string[] => settingsFileProblems('s.json', JSON.stringify(value), scope, 'gsd')
    const good = scope.settings
    const deny = [...good.permissions.deny, 'mcp__autopilot__wait_for']

    expect(mcp({ schema: 1, servers: ['a', 'b'] })).toEqual([])
    expect(mcp({ schema: 1, servers: ['a'], env: {} })).toEqual(['mcp.json has other keys'])
    expect(mcp({ schema: 2, servers: [] })).toEqual(['mcp.json has schema 2'])
    expect(mcp({ schema: 1, servers: ['b', 'a'] })).toEqual(['mcp.json servers are not sorted'])
    expect(mcp({ schema: 1, servers: [1] })).toEqual(['mcp.json servers are not a list of names'])
    expect(settings(good)).toEqual([])
    expect(settings({ ...good, autoCompactWindow: 800000 })).toEqual([
      's.json has the keys autoCompactWindow,enabledPlugins,permissions,sandbox',
    ])
    expect(settings({ ...good, permissions: { ...good.permissions, deny } })).toEqual([
      's.json: deny entry mcp__autopilot__wait_for would block an infra tool',
    ])
    expect(settings({ ...good, enabledPlugins: {} }).length > 0).toBe(true)
  })
})
