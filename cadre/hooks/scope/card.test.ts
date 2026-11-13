import { describe, expect, test } from 'claude-code/testing'

import type {
  CompiledScope,
  FrameworkId,
  LaunchStart,
  McpRoute,
  ProbeCheck,
  RoleSpec,
  ScopeContext,
  ScopeRule,
  SetupScan,
} from '../../types'
import { ARTIFACT } from '../locales/artifact'
import { chainLines, EMPTY_CARRY, ROLE_TEMPLATE, roleFromTemplate } from '../roles/template'
import {
  BIDI_OVERRIDE,
  context,
  emptySetupScan,
  FRAMEWORKS,
  hook,
  leaks,
  session,
  skillRef,
  templateRole,
} from '../testkit'
import { mcpToolName, scopeCardLines } from './card'
import { compileScope } from './compile'

/** The card rule with exactly this text, or undefined when the card has none. */
function ruleOf(scope: CompiledScope, text: string): ScopeRule | undefined {
  return scope.card.rules.find(candidate => candidate.text === text)
}

/** The first card rule of a role that only has the three infra plugins (hard, the whitelist of --setting-sources). */
const PLUGIN_RULE =
  'Plugins: only agent-fleet@local-mods, autopilot@local-mods, cadre@local-mods load ' +
  '(--setting-sources project whitelist)'

/** The warning that leads the card of a role whose role.json sets bypassPermissions by hand (D-95). */
const BYPASS_RULE = 'WARNING: bypassPermissions is set in role.json: permission prompts are skipped'

/** The rule the card of a role without Bash carries on GSD: GSD workflows need Bash, so a person runs them (A1). */
const GSD_NO_BASH_RULE = 'Attended: GSD workflows need Bash; this role runs them through a person'

/** The route rule of a merged scope (D-104): no --strict-mcp-config, so /fleet works; every MCP deny is best effort. */
const MERGED_ROUTE_RULE = 'MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)'

/** The rule on every card that the infra stays (D-77). */
const AVAILABLE_RULE = 'Autopilot, agent-fleet and the handoff skills are always available'

/** The rule on every card, right after the infra rule, that only the cadre inbox tools write the inbox files. */
const INBOX_RULE =
  'Edit and Write of every inbox.jsonl and session.json are denied; only the cadre inbox tools write them'

/** The note of a bypass card, right after the inbox rule. */
const HELD_RULE = 'Live messages may be held in this permission mode; the inbox is the record'

/**
 * The checks of the infra rule (D-112, D-77): the autopilot command, the two handoff skills and autopilot's three MCP
 * tools are in the startup inventory, in this order.
 */
const AVAILABLE_CHECKS: readonly ProbeCheck[] = [
  { kind: 'command-present', token: 'autopilot' },
  { kind: 'skill-present', token: 'create-handoff-doc' },
  { kind: 'skill-present', token: 'resume-handoff-doc' },
  { kind: 'tool-present', token: 'mcp__autopilot__restart_session' },
  { kind: 'tool-present', token: 'mcp__autopilot__wait_for' },
  { kind: 'tool-present', token: 'mcp__autopilot__queue_question' },
]

/** The MCP deny rule on the merged route: the names only; what stays reachable is the next rule (D-124, A1). */
function mergedDenied(names: string): string {
  return `Scanned MCP servers not given are denied: ${names}`
}

/** The rule right after a merged deny rule: denied servers lose their tools and are denied whole (D-124, #39). */
const MERGED_REACHABLE_RULE =
  'Denied servers: tools removed and the whole server denied ' +
  '(deniedMcpServers; best-effort)'

/** The card rule that names what a role loads as its instructions: its built and private files (02-GAPS-B2 N9). */
function loadsRule(id: string): string {
  return (
    `Loads .cadre/${id}/CLAUDE.md and its private instructions ` +
    `(<config dir>/cadre/<repo>-<hash8>/${id}/instructions/)`
  )
}

/** The last line of the card of a role: its memory folder pattern and where the config dir in it comes from. */
function memoryLine(id: string): string {
  return (
    `  memory: <config dir>/cadre/<repo>-<hash8>/${id}/ ` +
    '(rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)'
  )
}

describe('the inbox rules on the card', () => {
  test('every card has the inbox rule right after the infra rule: hard without Bash, best effort with Bash', () => {
    const afterInfra = [templateRole('pm'), templateRole('be')].map(role => {
      const rules = compileScope(role, context()).card.rules

      return rules[rules.findIndex(found => found.text === AVAILABLE_RULE) + 1]
    })

    expect(afterInfra).toEqual([
      { text: INBOX_RULE, enforcement: 'hard' },
      { text: INBOX_RULE, enforcement: 'best-effort' },
    ])
  })

  test('a bypass card has the held-messages note right after the inbox rule; no other card has it', () => {
    const bypass = compileScope(templateRole('pm', { permissionMode: 'bypassPermissions' }), context()).card.rules
    const others = [templateRole('pm'), templateRole('be')].map(role => compileScope(role, context()))

    expect(bypass[bypass.findIndex(found => found.text === INBOX_RULE) + 1]).toEqual({
      text: HELD_RULE,
      enforcement: 'none',
    })
    expect(others.map(scope => ruleOf(scope, HELD_RULE))).toEqual([undefined, undefined])
  })

  test('the inbox rule is hard only without Bash and at a root a rule can hold, or with no root given', () => {
    const enforcementOf = (role: RoleSpec, over: Partial<ScopeContext>): string | undefined =>
      ruleOf(compileScope(role, context(over)), INBOX_RULE)?.enforcement
    const roots: readonly Partial<ScopeContext>[] = [{ root: '/Users/me/My Projects/app' }, { root: '/repo' }, {}]

    expect(roots.map(over => enforcementOf(templateRole('pm'), over))).toEqual(['best-effort', 'hard', 'hard'])
    expect(roots.map(over => enforcementOf(templateRole('be'), over))).toEqual(roots.map(() => 'best-effort'))
  })

  test('every card of every role, framework, start and route has the inbox rule exactly once', () => {
    const count = (scope: CompiledScope): number => scope.card.rules.filter(item => item.text === INBOX_RULE).length
    const found = routeMatrix().filter(({ scope }) => count(scope) !== 1)

    expect(found.map(({ where }) => where)).toEqual([])
  })
})

describe('the loaded instructions on the card (02-GAPS-B2 N9)', () => {
  test("every card names the role's built and private instructions as a none rule, after the Skills rule", () => {
    for (const role of [templateRole('pm'), templateRole('be')]) {
      const rules = compileScope(role, context()).card.rules
      const skills = rules.findIndex(found => found.text === 'Skills: only the listed skills are linked')

      expect([skills > -1, rules[skills + 1]]).toEqual([true, { text: loadsRule(role.id), enforcement: 'none' }])
    }
  })
})

/** Names that sort in their own order: `${prefix}00`, `${prefix}01` and on, `count` of them. */
function numbered(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(2, '0')}`)
}

describe('card rule lists', () => {
  test('the MCP deny rule names 12 servers and then counts the rest', () => {
    const names = numbered('mcp-', 15)
    const scope = compileScope(templateRole('pm'), context({ setup: emptySetupScan({ mcp: names.map(session) }) }))
    const text = mergedDenied(`${names.slice(0, 12).join(', ')}, +3 more`)

    expect(ruleOf(scope, text)?.enforcement).toBe('best-effort')
    expect(scope.settings.permissions.deny.filter(entry => entry.startsWith('mcp__'))).toHaveLength(15)
  })

  test('the D-124 sentence keeps its own card line however long the denied list is (A1)', () => {
    const scanned = emptySetupScan({ mcp: numbered('claude_ai_connector_', 15).map(session) })
    const lines = scopeCardLines(compileScope(templateRole('pm'), context({ setup: scanned })).card)
    const listLine = lines.find(line => line.startsWith('    [best-effort] Scanned MCP servers not given are denied: '))

    expect(lines.filter(line => line.endsWith('(deniedMcpServers; best-effort)'))).toEqual([
      `    [best-effort] ${MERGED_REACHABLE_RULE}`,
    ])
    expect(listLine?.endsWith('…')).toBe(true)
  })

  test('the MCP deny rule shows a scanned name cleaned', () => {
    const scanned = emptySetupScan({ mcp: [session(`ev${BIDI_OVERRIDE}il`)] })
    const scope = compileScope(templateRole('pm'), context({ setup: scanned }))

    expect(ruleOf(scope, mergedDenied('evil'))?.enforcement).toBe('best-effort')
  })

  test('a long code dir name is capped in the denied-dirs rule, so the card line keeps its fixed tail', () => {
    const dir = 'd'.repeat(300)
    const scope = compileScope(templateRole('pm'), context({ codeDirs: [dir] }))
    const text = `Reads and edits under ${'d'.repeat(109)}… are denied; the patterns match at any depth`

    expect(ruleOf(scope, text)?.enforcement).toBe('best-effort')
    expect(scopeCardLines(scope.card)).toContain(`    [best-effort] ${text}`)
    expect(scope.settings.permissions.deny).toContain(`Read(./${dir}/**)`)
  })

  test('the plugins rule names 12 plugin keys and then counts the rest', () => {
    const plugins = numbered('p', 12)
    const scanned = emptySetupScan({ plugins: plugins.map(name => `${name}@m`) })
    const role = templateRole('pm', { skills: plugins.map(name => `${name}:s`) })
    const scope = compileScope(role, context({ setup: scanned }))
    const shownKeys = [
      'agent-fleet@local-mods',
      'autopilot@local-mods',
      'cadre@local-mods',
      ...plugins.slice(0, 9).map(name => `${name}@m`),
    ]
    const text = `Plugins: only ${shownKeys.join(', ')}, +3 more load (--setting-sources project whitelist)`

    expect(Object.keys(scope.settings.enabledPlugins)).toHaveLength(15)
    expect(ruleOf(scope, text)?.enforcement).toBe('hard')
  })
})

describe('scopeCardLines', () => {
  test('the card of a PM lists framework, skills, MCP, not given, hooks, rules, decisions and memory', () => {
    const scanned = emptySetupScan({
      mcp: [session('jira')],
      skills: [skillRef('my-skill')],
      hooks: [hook('gsd-context-monitor.js'), hook('gsd-secret-read-guard.js')],
    })
    const role = templateRole('pm', { carry: { ...EMPTY_CARRY, hooks: ['gsd-secret-read-guard.js'] } })
    const card = compileScope(role, context({ setup: scanned, codeDirs: ['cadre'] })).card

    expect(scopeCardLines(card)).toEqual([
      'Scope card: PM (pm)',
      '  framework: GSD; model: opus + medium; permission mode: auto',
      '  skills: none',
      '  MCP servers: none',
      '  not given skills: my-skill',
      '  not given MCP: jira',
      '  hooks loaded: gsd-secret-read-guard.js',
      '  hooks loaded by project settings: none',
      '  hooks not loaded: gsd-context-monitor.js',
      '  rules:',
      `    [hard] ${PLUGIN_RULE}`,
      '    [hard] No Bash tool (denied)',
      '    [best-effort] Reads and edits under cadre are denied; the patterns match at any depth',
      '    [best-effort] Reads of .env, .env.*, ~/.ssh and ~/.aws are denied',
      `    [best-effort] ${mergedDenied('jira')}`,
      `    [best-effort] ${MERGED_REACHABLE_RULE}`,
      '    [best-effort] Skills: only the listed skills are linked',
      `    [none] ${loadsRule('pm')}`,
      '    [hard] Autopilot, agent-fleet and the handoff skills are always available',
      `    [hard] ${INBOX_RULE}`,
      '    [hard] Permission mode: auto',
      `    [none] ${GSD_NO_BASH_RULE}`,
      `    [none] ${ARTIFACT.cardAttendedAsk}`,
      `    [none] ${MERGED_ROUTE_RULE}`,
      '  decisions:',
      ...chainLines(['pm', 'tl']).map(line => `    ${line}`),
      memoryLine('pm'),
    ])
  })

  test('the lists show the skills and MCP servers the role has', () => {
    const scanned = emptySetupScan({ mcp: [session('jira'), session('github')] })
    const role = templateRole('tl', { mcp: ['github', 'jira'], skills: ['my-skill', 'codex:rescue'] })
    const lines = scopeCardLines(compileScope(role, context({ setup: scanned })).card)

    expect(lines[0]).toBe('Scope card: Team Lead (tl)')
    expect(lines[2]).toBe('  skills: codex:rescue, my-skill')
    expect(lines[3]).toBe('  MCP servers: github, jira')
    expect(lines.slice(4, 6)).toEqual(['  not given skills: none', '  not given MCP: none'])
  })

  test('the framework line names GSD, superpowers or built-in, and the model, effort and mode of the role', () => {
    const role = templateRole('be', { model: 'sonnet', effort: 'high', permissionMode: 'acceptEdits' })
    const names: readonly [FrameworkId, string][] = [
      ['gsd', 'GSD'],
      ['superpowers', 'superpowers'],
      ['none', 'built-in'],
    ]
    const lines = names.map(([framework]) => scopeCardLines(compileScope(role, context({ framework })).card)[1])

    expect(lines).toEqual(
      names.map(([, name]) => `  framework: ${name}; model: sonnet + high; permission mode: acceptEdits`),
    )
  })

  test('a list longer than 12 names shows 12 and then how many more', () => {
    const names = Array.from({ length: 15 }, (_, index) => `skill-${String(index).padStart(2, '0')}`)
    const scanned = emptySetupScan({ skills: names.map(name => skillRef(name)) })
    const card = compileScope(templateRole('pm'), context({ setup: scanned })).card
    const line = scopeCardLines(card).find(candidate => candidate.startsWith('  not given skills:'))

    expect(line).toBe(`  not given skills: ${names.slice(0, 12).join(', ')}, +3 more`)
  })

  test('a not-given skills list cut at the line cap never hides the MCP servers not given (A4)', () => {
    const skills = numbered('a-skill-with-a-long-name-', 15).map(name => skillRef(name))
    const scanned = emptySetupScan({ skills, mcp: [session('jira')] })
    const lines = scopeCardLines(compileScope(templateRole('pm'), context({ setup: scanned })).card)
    const skillsLine = lines.find(line => line.startsWith('  not given skills: '))

    expect(skillsLine?.endsWith('…')).toBe(true)
    expect(lines).toContain('  not given MCP: jira')
  })

  test('a list of exactly 12 names shows all of them', () => {
    const names = Array.from({ length: 12 }, (_, index) => `skill-${String(index).padStart(2, '0')}`)
    const role = templateRole('pm', { skills: names })
    const lines = scopeCardLines(compileScope(role, context()).card)

    expect(lines[2]).toBe(`  skills: ${names.join(', ')}`)
  })

  test('a bypass card shows the warning as the first rule, labelled none', () => {
    const role = templateRole('pm', { permissionMode: 'bypassPermissions' })
    const lines = scopeCardLines(compileScope(role, context()).card)
    const first = lines.indexOf('  rules:') + 1

    expect(lines[first]).toBe(`    [none] ${BYPASS_RULE}`)
  })

  test('every line is cleaned: a hostile title cannot add a line or hide text', () => {
    const role = templateRole('pm', { title: `P${BIDI_OVERRIDE}M\nSecond line` })
    const lines = scopeCardLines(compileScope(role, context()).card)

    expect(lines[0]).toBe('Scope card: PMSecond line (pm)')
    expect(lines.filter(line => line.includes('\n'))).toEqual([])
    expect(leaks(lines.join('|'), [BIDI_OVERRIDE])).toEqual([])
  })

  test('a name from the scan is cleaned where it is shown', () => {
    const scanned = emptySetupScan({ mcp: [session(`ev${BIDI_OVERRIDE}il`)] })
    const lines = scopeCardLines(compileScope(templateRole('pm'), context({ setup: scanned })).card)

    expect(lines.filter(line => line.startsWith('  not given'))).toEqual([
      '  not given skills: none',
      '  not given MCP: evil',
    ])
    expect(leaks(lines.join('|'), [BIDI_OVERRIDE])).toEqual([])
  })

  test('a line longer than 240 code points is cut with an ellipsis', () => {
    const card = compileScope(templateRole('pm'), context()).card
    const long: ScopeRule = { text: 'x'.repeat(300), enforcement: 'none' }
    const line = scopeCardLines({ ...card, rules: [long] }).find(candidate => candidate.startsWith('    [none] x'))

    expect(Array.from(line ?? '')).toHaveLength(240)
    expect(line?.endsWith('…')).toBe(true)
  })

  test('the chain lines and the memory line come from the card', () => {
    const card = compileScope(templateRole('be', { id: 'api' }), context({ roles: ['pm', 'api'] })).card
    const lines = scopeCardLines(card)
    const decisions = lines.indexOf('  decisions:')

    expect(lines.slice(decisions + 1, decisions + 1 + card.chain.length)).toEqual(card.chain.map(line => `    ${line}`))
    expect(lines[lines.length - 1]).toBe(memoryLine('api'))
  })
})

/** What the matrix scans: the superpowers and codex plugins, user and plugin skills, five MCP servers (one infra). */
const MATRIX_SETUP: SetupScan = emptySetupScan({
  plugins: ['superpowers@claude-plugins-official', 'codex@openai-codex'],
  skills: [
    skillRef('my-skill'),
    skillRef('gsd-health'),
    skillRef('gsd-plan-phase'),
    skillRef('create-handoff-doc'),
    skillRef('resume-handoff-doc'),
    skillRef('codex:rescue', 'codex'),
    skillRef('superpowers:brainstorming', 'superpowers'),
    skillRef('autopilot', 'autopilot'),
  ],
  mcp: [session('jira'), session('playwright'), session('github'), session('autopilot'), session('sentry')],
  agents: ['gsd-planner', 'gsd-executor', 'my-agent'],
  hooks: [hook('gsd-secret-read-guard.js'), hook('gsd-context-monitor.js')],
})

/** A setup with the hook script lint.sh in project settings and the GSD secret read guard in user settings. */
const START_SETUP: SetupScan = emptySetupScan({
  hooks: [hook('lint.sh', 'project'), hook('gsd-secret-read-guard.js')],
})

/** BE carrying the GSD secret read guard, the one hook a role carries (D-62). */
const GUARDED_BE: RoleSpec = templateRole('be', { carry: { ...EMPTY_CARRY, hooks: ['gsd-secret-read-guard.js'] } })

/** The folder apps/web of the repo as a launch start (A2). */
const APPS_WEB: LaunchStart = { kind: 'dir', path: 'apps/web' }

/** The none line a start folder's settings get on the card of a launcher that starts in `folder`. */
function startSettingsLine(folder: string): string {
  const loads = 'loads: its hooks run and its permission rules apply'
  if (folder === HERE_FOLDER) return `.claude/settings.json of the folder the launcher is run from ${loads}`

  return `${folder}/.claude/settings.json ${loads}`
}

/** The folder a here start names. */
const HERE_FOLDER = 'the folder the launcher is run from'

/** The four none rules on the card of BE whose launcher starts in `folder`. */
function startNotes(folder: string): ScopeRule[] {
  return [
    `project settings (<git root>/.claude/settings.json) do not load: the session starts in ${folder}`,
    startSettingsLine(folder),
    `Additional directory: <git root> (start folder is ${folder})`,
    `Handoffs (thoughts/shared/handoffs/be/) and GSD .planning/ follow the start folder (${folder})`,
  ].map((text): ScopeRule => ({ text, enforcement: 'none' }))
}

/** The project monitor warning for `script`. */
function monitorWarning(script: string): string {
  return (
    `WARNING: ${script} is registered in project settings and loads in every role; ` +
    'it conflicts with the autopilot handoff (D-62)'
  )
}

describe('launch start card (D-122)', () => {
  test('a dir start with no start hook lists the project hooks as not loaded and none as loaded by project', () => {
    const card = compileScope(GUARDED_BE, context({ launchStart: APPS_WEB, setup: START_SETUP })).card

    expect(card.hooks).toEqual({ loaded: ['gsd-secret-read-guard.js'], loadedByProject: [], notLoaded: ['lint.sh'] })
  })

  test('a dir start ends the rules, right before the MCP route rule, with the four start notes labelled none', () => {
    const rules = compileScope(GUARDED_BE, context({ launchStart: APPS_WEB, setup: START_SETUP })).card.rules

    expect(rules.slice(-5, -1)).toEqual(startNotes('<git root>/apps/web'))
    expect(rules.at(-1)?.text.startsWith('MCP route: ')).toBe(true)
  })

  test('a dir start lists the start folder hooks as loaded by project settings, less the role\'s own', () => {
    const startHooks = [hook('guard.sh', 'project'), hook('gsd-secret-read-guard.js', 'project')]
    const setup = { ...START_SETUP, startHooks }
    const card = compileScope(GUARDED_BE, context({ launchStart: APPS_WEB, setup })).card

    expect(card.hooks).toEqual({
      loaded: ['gsd-secret-read-guard.js'],
      loadedByProject: ['guard.sh'],
      notLoaded: ['lint.sh'],
    })
    expect(scopeCardLines(card)).toContain('  hooks loaded by project settings: guard.sh')
  })

  test('a here start names the folder the launcher is run from in all four notes', () => {
    const setup = { ...START_SETUP, startHooks: [hook('guard.sh', 'project')] }
    const card = compileScope(GUARDED_BE, context({ launchStart: { kind: 'here' }, setup })).card

    expect(card.rules.slice(-5, -1)).toEqual(startNotes(HERE_FOLDER))
    expect(card.rules.at(-1)?.text.startsWith('MCP route: ')).toBe(true)
    expect(card.hooks.loadedByProject).toEqual([])
  })

  test('a git-root start has no start note and lists the project hook scripts as loaded by project settings', () => {
    const setup = { ...START_SETUP, startHooks: [hook('guard.sh', 'project')] }
    const card = compileScope(GUARDED_BE, context({ launchStart: { kind: 'git-root' }, setup })).card
    const plain = compileScope(GUARDED_BE, context({ launchStart: { kind: 'git-root' }, setup: START_SETUP })).card
    const notes = [...startNotes('<git root>/apps/web'), ...startNotes(HERE_FOLDER)]

    expect(card.rules.filter(item => notes.some(note => note.text === item.text))).toEqual([])
    expect(card.rules.filter(item => item.text.includes('<git root>'))).toEqual([])
    expect(card.rules.filter(item => item.text.includes('.claude/settings.json'))).toEqual([])
    expect(card.hooks).toEqual({ loaded: ['gsd-secret-read-guard.js'], loadedByProject: ['lint.sh'], notLoaded: [] })
    expect(card).toEqual(plain)
  })

  test('a context monitor in project settings gets its warning for a git-root start only', () => {
    const setup = emptySetupScan({ hooks: [hook('gsd-context-monitor.js', 'project')] })
    const starts: readonly LaunchStart[] = [{ kind: 'git-root' }, { kind: 'here' }, APPS_WEB]
    const labels = starts.map(launchStart => {
      const scope = compileScope(templateRole('be'), context({ launchStart, setup }))

      return ruleOf(scope, monitorWarning('gsd-context-monitor.js'))?.enforcement
    })

    expect(labels).toEqual(['none', undefined, undefined])
  })

  test('a context monitor among the start folder hooks gets its warning for a dir start', () => {
    const setup = emptySetupScan({ startHooks: [hook('gsd-context-monitor.js', 'project')] })
    const starts: readonly LaunchStart[] = [{ kind: 'git-root' }, { kind: 'here' }, APPS_WEB]
    const labels = starts.map(launchStart => {
      const scope = compileScope(templateRole('be'), context({ launchStart, setup }))

      return ruleOf(scope, monitorWarning('gsd-context-monitor.js'))?.enforcement
    })

    expect(labels).toEqual([undefined, undefined, 'none'])
  })
})

/** One compiled scope of the route matrix, with the combination it was compiled for. */
type RouteCase = {
  readonly where: string
  readonly scope: CompiledScope
}

/** Every template role on every framework, launch start and MCP route, compiled with the matrix setup. */
function routeMatrix(): RouteCase[] {
  const starts: readonly LaunchStart[] = [{ kind: 'git-root' }, { kind: 'here' }, APPS_WEB]
  const routes: readonly McpRoute[] = ['merged', 'strict']

  return ROLE_TEMPLATE.map(row => roleFromTemplate(row)).flatMap(role =>
    FRAMEWORKS.flatMap(framework =>
      starts.flatMap(launchStart =>
        routes.map(mcpRoute => ({
          where: `${role.id} / ${framework} / ${launchStart.kind} / ${mcpRoute}`,
          scope: compileScope(role, context({ framework, launchStart, mcpRoute, setup: MATRIX_SETUP })),
        })),
      ),
    ),
  )
}

describe('decided MCP route (D-104, D-124)', () => {
  test('the route rule of a merged scope says what merged holds, and that of a strict scope names its flag', () => {
    const merged = compileScope(templateRole('be'), context({ mcpRoute: 'merged' })).card.rules
    const strict = compileScope(templateRole('be'), context({ mcpRoute: 'strict' })).card.rules

    expect(merged.at(-1)).toEqual({
      text: 'MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)',
      enforcement: 'none',
    })
    expect(strict.at(-1)).toEqual({ text: 'MCP route: strict (--strict-mcp-config)', enforcement: 'none' })
  })

  test(
    'a merged deny rule is followed by the whole-server deny rule, best-effort; a strict one is not (A1, #39)',
    () => {
      const setup = emptySetupScan({ mcp: [session('redmine'), session('notion')] })
      const merged = compileScope(templateRole('be'), context({ setup, mcpRoute: 'merged' }))
      const strict = compileScope(templateRole('be'), context({ setup, mcpRoute: 'strict' }))
      const allGiven = compileScope(
        templateRole('be', { mcp: ['notion', 'redmine'] }),
        context({ setup, mcpRoute: 'merged' }),
      )
      const listed = 'Scanned MCP servers not given are denied: notion, redmine'
      const texts = merged.card.rules.map(item => item.text)
      const checks: readonly ProbeCheck[] = [
        { kind: 'tool-prefix-absent', token: 'mcp__notion__' },
        { kind: 'tool-prefix-absent', token: 'mcp__redmine__' },
      ]

      expect(ruleOf(merged, listed)).toEqual({ text: listed, enforcement: 'best-effort', checks })
      expect(ruleOf(merged, MERGED_REACHABLE_RULE)).toEqual({ text: MERGED_REACHABLE_RULE, enforcement: 'best-effort' })
      expect(texts.indexOf(MERGED_REACHABLE_RULE)).toBe(texts.indexOf(listed) + 1)
      expect(ruleOf(strict, listed)).toEqual({ text: listed, enforcement: 'hard', checks })
      expect(ruleOf(strict, MERGED_REACHABLE_RULE)).toBeUndefined()
      expect(ruleOf(allGiven, MERGED_REACHABLE_RULE)).toBeUndefined()
    },
  )

  test('no scope card line of any template role, framework, start and route says provisional', () => {
    const cases = routeMatrix()
    const found = cases.flatMap(({ where, scope }) =>
      scopeCardLines(scope.card)
        .filter(line => line.includes('provisional'))
        .map(line => `${where}: ${line}`),
    )

    expect(cases).toHaveLength(6 * 3 * 3 * 2)
    expect(found).toEqual([])
  })

  test('no compiled settings template holds a deniedMcpServers key (D-124)', () => {
    const found = routeMatrix().filter(({ scope }) => JSON.stringify(scope.settings).includes('deniedMcpServers'))

    expect(found.map(({ where }) => where)).toEqual([])
  })
})

/** The start of the text of every card rule that carries probe checks (D-112). */
const CHECKED_RULE_STARTS: readonly string[] = [
  'No Bash tool (denied)',
  'Scanned MCP servers not given are denied: ',
  AVAILABLE_RULE,
  'Permission mode: ',
]

describe('probe checks (D-112)', () => {
  test('the merged deny rule checks that no tool of a denied server is left; none denied, no check (D-124)', () => {
    const setup = emptySetupScan({ mcp: [session('redmine'), session('notion')] })
    const merged = compileScope(templateRole('pm'), context({ setup }))
    const none = compileScope(templateRole('pm'), context())

    expect(ruleOf(merged, mergedDenied('notion, redmine'))?.checks).toEqual([
      { kind: 'tool-prefix-absent', token: 'mcp__notion__' },
      { kind: 'tool-prefix-absent', token: 'mcp__redmine__' },
    ])
    expect(ruleOf(none, 'No other scanned MCP servers to deny')).toEqual({
      text: 'No other scanned MCP servers to deny',
      enforcement: 'best-effort',
    })
  })

  test('the strict deny rule has the checks too, each server by its engine tool name and two underscores', () => {
    const setup = emptySetupScan({ mcp: [session('my.server'), session('jira')] })
    const strict = compileScope(templateRole('pm'), context({ setup, mcpRoute: 'strict' }))

    expect(ruleOf(strict, 'Scanned MCP servers not given are denied: jira, my.server')).toEqual({
      text: 'Scanned MCP servers not given are denied: jira, my.server',
      enforcement: 'hard',
      checks: [
        { kind: 'tool-prefix-absent', token: 'mcp__jira__' },
        { kind: 'tool-prefix-absent', token: 'mcp__my_server__' },
      ],
    })
  })

  test('the infra rule checks the autopilot command, the handoff skills and the autopilot tools, in order', () => {
    for (const role of [templateRole('pm'), templateRole('be')]) {
      expect(ruleOf(compileScope(role, context()), AVAILABLE_RULE)?.checks).toEqual(AVAILABLE_CHECKS)
    }
  })

  test('the permission rule checks the mode, and manual as the engine reports it: default', () => {
    const auto = compileScope(templateRole('be'), context())
    const manual = compileScope(templateRole('be', { permissionMode: 'manual' }), context())

    expect(ruleOf(auto, 'Permission mode: auto')?.checks).toEqual([{ kind: 'permission-mode', token: 'auto' }])
    expect(ruleOf(manual, 'Permission mode: manual')?.checks).toEqual([{ kind: 'permission-mode', token: 'default' }])
  })

  test(
    'only the Bash, MCP deny, infra and permission rules carry checks, in every role, framework, start and route',
    () => {
      const isChecked = (item: ScopeRule): boolean => CHECKED_RULE_STARTS.some(start => item.text.startsWith(start))
      const found = routeMatrix().flatMap(({ where, scope }) =>
        scope.card.rules
          .filter(item => (item.checks !== undefined) !== isChecked(item))
          .map(item => `${where}: ${item.text}`),
      )

      expect(found).toEqual([])
    },
  )
})

describe('safety net: mcpToolName (A8)', () => {
  test('mcpToolName: mcp__ and the server name, each character outside A-Z, a-z, 0-9, _ and - made _', () => {
    expect(mcpToolName('my.server name/x')).toBe('mcp__my_server_name_x')
    expect(mcpToolName('Jira_cloud-2')).toBe('mcp__Jira_cloud-2')
  })
})

describe('every framework a role may run on the card', () => {
  /** The card lines that say what else the role may run. */
  function alsoRunsLines(scope: CompiledScope): string[] {
    return scopeCardLines(scope.card).filter(line => line.startsWith('  also runs: '))
  }

  test('a role that may also run superpowers has the line naming it, right after its framework line', () => {
    const be = templateRole('be')
    const union = compileScope(be, context({ framework: 'gsd', alsoRuns: ['gsd', 'superpowers'] }))
    const lines = scopeCardLines(union.card)

    expect(alsoRunsLines(union)).toEqual(['  also runs: superpowers'])
    expect(lines[lines.indexOf('  also runs: superpowers') - 1]?.startsWith('  framework: GSD;')).toBe(true)
  })

  test('a card with nothing else to run, or of a role on none, has no such line', () => {
    const alone = compileScope(templateRole('be'), context({ framework: 'gsd' }))
    const none = compileScope(templateRole('pm'), context({ framework: 'none', alsoRuns: ['gsd', 'superpowers'] }))

    expect([alsoRunsLines(alone), alsoRunsLines(none)]).toEqual([[], []])
  })

  test("the start skills of every framework the role may run count as given, so none of them is 'not given'", () => {
    const skills = [skillRef('gsd-plan-phase'), skillRef('gsd-execute-phase'), skillRef('mine')]
    const setup = emptySetupScan({ skills })
    const tl = templateRole('tl')
    const union = compileScope(tl, context({ framework: 'superpowers', setup, alsoRuns: ['superpowers', 'gsd'] }))
    const alone = compileScope(tl, context({ framework: 'superpowers', setup }))

    expect(union.card.notGiven.skills).toEqual(['mine'])
    expect(alone.card.notGiven.skills).toEqual(['gsd-execute-phase', 'gsd-plan-phase', 'mine'])
  })

  test('a role without Bash that may also run gsd carries the GSD Bash rule and is attended', () => {
    const alsoRuns: FrameworkId[] = ['gsd', 'superpowers']
    const noBash = templateRole('tl', { hasBash: false })
    const union = compileScope(noBash, context({ framework: 'superpowers', alsoRuns }))
    const alone = compileScope(noBash, context({ framework: 'superpowers' }))
    const withBash = compileScope(templateRole('tl'), context({ framework: 'superpowers', alsoRuns }))

    expect([ruleOf(union, GSD_NO_BASH_RULE) !== undefined, union.card.isAttended]).toEqual([true, true])
    expect([ruleOf(alone, GSD_NO_BASH_RULE) !== undefined, alone.card.isAttended]).toEqual([false, false])
    expect(ruleOf(withBash, GSD_NO_BASH_RULE)).toBeUndefined()
  })
})

describe('a role started with --ask-user', () => {
  /** Whether the card is attended, then whether it carries the rule that framework menus reach the person. */
  function askMarks(scope: CompiledScope): boolean[] {
    return [scope.card.isAttended, ruleOf(scope, ARTIFACT.cardAttendedAsk) !== undefined]
  }

  test('TL on GSD is attended and carries the ask rule', () => {
    expect(askMarks(compileScope(templateRole('tl'), context({ framework: 'gsd' })))).toEqual([true, true])
  })

  test('TL on superpowers or none is neither, and TL on superpowers that may also run GSD is both', () => {
    const tl = templateRole('tl')
    const superpowers = compileScope(tl, context({ framework: 'superpowers' }))
    const none = compileScope(tl, context({ framework: 'none' }))
    const union = compileScope(tl, context({ framework: 'superpowers', alsoRuns: ['superpowers', 'gsd'] }))

    expect([askMarks(superpowers), askMarks(none), askMarks(union)]).toEqual([
      [false, false],
      [false, false],
      [true, true],
    ])
  })

  test('TL started without --ask-user and BE on GSD are neither', () => {
    const quiet = templateRole('tl', { autopilot: { ...templateRole('tl').autopilot, askUser: false } })
    const scopes = [quiet, templateRole('be')].map(role => compileScope(role, context({ framework: 'gsd' })))

    expect(scopes.map(askMarks)).toEqual([
      [false, false],
      [false, false],
    ])
  })
})
