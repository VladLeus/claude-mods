import { describe, expect, test } from 'claude-code/testing'

import type {
  CadreState,
  CompiledScope,
  DesiredFile,
  FrameworkAdapter,
  FrameworkId,
  InstructionPart,
  RoleSpec,
  ScopeContext,
} from '../../types'
import { stableJson } from '../core/json'
import { compareText } from '../core/text'
import { GSD_ADAPTER } from '../framework/gsd/adapter'
import { BUILTIN_ADAPTER } from '../framework/none/adapter'
import { SUPERPOWERS_ADAPTER } from '../framework/superpowers/adapter'
import { ROLE_TEMPLATE, roleFromTemplate } from '../roles/template'
import { scopeCardLines } from '../scope/card'
import { compileScope } from '../scope/compile'
import { parseCadreState } from '../state/cadre-files'
import { BIDI_OVERRIDE, emptySetupScan, FRAMEWORKS, leaks, templateRole } from '../testkit'
import { cadreJsonText, indexMdText, partsBody, roleClaudeMdText, roleMdText } from './docs'
import { desiredFiles } from './files'
import type { GenerateInput } from './files'
import { builtClaudeMdPath } from './launcher'

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

/** The text of one desired file; undefined when the path is not desired. */
function contentOf(files: readonly DesiredFile[], path: string): string | undefined {
  return files.find(file => file.path === path)?.content
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

/** The Secrets section of a rule file. */
const SECRETS_PART = part('P3', '.claude/rules/security.md', 'Secrets', '## Secrets\nKeep keys out of the repo.\n')

/** A sentence of the global CLAUDE.md that no file in the repo may hold (T-02-69). */
const GLOBAL_ONLY_SENTENCE = 'GLOBAL-ONLY-SENTENCE stays out of the repo'

/** A part of the global CLAUDE.md, which never goes into a built role file (T-02-69). */
const GLOBAL_PART = part('P1', '~/.claude/CLAUDE.md', 'Private', `# Private\n${GLOBAL_ONLY_SENTENCE}.\n`, 'global')

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

describe('roleClaudeMdText (G-02-1f)', () => {
  test('the header line, a blank line, then each part under its marker, a blank line apart, one final newline', () => {
    expect(roleClaudeMdText('be', [RULES_PART, SECRETS_PART])).toBe(
      [
        builtHeader('be'),
        '',
        '<!-- from CLAUDE.md > Rules -->',
        '# Rules',
        'Run the tests before a commit.',
        '',
        '<!-- from .claude/rules/security.md > Secrets -->',
        '## Secrets',
        'Keep keys out of the repo.',
        '',
      ].join('\n'),
    )
  })

  test('the parts come in the order given, read order, and a part with no heading is marked (top of file)', () => {
    const top = part('P1', 'AGENTS.md', '', 'Work in small steps.\nAsk before a large change.')
    const lines = roleClaudeMdText('qa', [top, SECRETS_PART]).split('\n')

    expect(lines.filter(line => line.startsWith('<!-- from '))).toEqual([
      '<!-- from AGENTS.md > (top of file) -->',
      '<!-- from .claude/rules/security.md > Secrets -->',
    ])
    expect(lines.slice(0, 6)).toEqual([
      builtHeader('qa'),
      '',
      '<!-- from AGENTS.md > (top of file) -->',
      'Work in small steps.',
      'Ask before a large change.',
      '',
    ])
  })

  test('a part read with CRLF line ends is written with LF, and the text ends with exactly one newline', () => {
    const crlf = part('P2', 'CLAUDE.md', 'Rules', '# Rules\r\nRun the tests.\r\n\r\n')
    const text = roleClaudeMdText('be', [crlf])

    expect(text.includes('\r')).toBe(false)
    expect(text.endsWith('<!-- from CLAUDE.md > Rules -->\n# Rules\nRun the tests.\n')).toBe(true)
  })

  test("a '--' in a marker's file or heading is written '- -', so only the marker's end closes it (N2)", () => {
    const dashed = part('P2', 'x--y.md', 'a --> b', 'Text.\n')
    const marker = roleClaudeMdText('be', [dashed]).split('\n')[2] ?? ''

    expect(marker).toBe('<!-- from x- -y.md > a - -> b -->')
    expect(marker.split('-->')).toEqual(['<!-- from x- -y.md > a - -> b ', ''])
  })

  test('with no part the text is the header line alone, with its newline', () => {
    expect(roleClaudeMdText('be', [])).toBe(`${builtHeader('be')}\n`)
  })

  test('builtClaudeMdPath is the one home of a role built CLAUDE.md path, the one desiredFiles writes (S6)', () => {
    expect(builtClaudeMdPath('be')).toBe('.cadre/be/CLAUDE.md')
    expect(builtClaudeMdPath('security')).toBe('.cadre/security/CLAUDE.md')
  })

  test('partsBody is the text after the header: a blank line before each part, one final newline (N5)', () => {
    expect(partsBody([])).toBe('\n')
    expect(partsBody([RULES_PART, SECRETS_PART])).toBe(
      [
        '',
        '',
        '<!-- from CLAUDE.md > Rules -->',
        '# Rules',
        'Run the tests before a commit.',
        '',
        '<!-- from .claude/rules/security.md > Secrets -->',
        '## Secrets',
        'Keep keys out of the repo.',
        '',
      ].join('\n'),
    )
    expect(roleClaudeMdText('be', [RULES_PART])).toBe(`${builtHeader('be')}${partsBody([RULES_PART])}`)
  })

  test('a file name or heading with a line break or a bidi character adds no line to the file', () => {
    const hostile = part('P2', `docs/a\nb${BIDI_OVERRIDE}.md`, `Ru\rles${BIDI_OVERRIDE}`, '# Rules\nRun the tests.\n')

    expect(roleClaudeMdText('be', [hostile]).split('\n').slice(2)).toEqual([
      '<!-- from docs/ab.md > Rules -->',
      '# Rules',
      'Run the tests.',
      '',
    ])
  })

  test('desiredFiles adds .cadre/<id>/CLAUDE.md, a plain file: the repo parts given, else the header alone', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const repoParts = new Map([['be', [RULES_PART, SECRETS_PART]]])
    const files = desiredFiles(inputOf([pm, be], 'gsd', { repoParts }))
    const content = roleClaudeMdText('be', [RULES_PART, SECRETS_PART])

    expect(files.filter(file => file.path.endsWith('/CLAUDE.md'))).toEqual([
      { path: '.cadre/be/CLAUDE.md', content, mode: 'file' },
      { path: '.cadre/pm/CLAUDE.md', content: `${builtHeader('pm')}\n`, mode: 'file' },
    ])
    expect(pathsOfRole(files, 'be')).toEqual(['.cadre/be/CLAUDE.md', ...BE_PATHS.filter(path => path.includes('/be'))])
    expect(files.map(file => file.path)).toEqual(files.map(file => file.path).sort(compareText))
  })

  test('a global part never goes into the file, and a role given only global parts gets the header (T-02-69)', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const repoParts = new Map([
      ['be', [GLOBAL_PART, RULES_PART]],
      ['pm', [GLOBAL_PART]],
    ])
    const files = desiredFiles(inputOf([pm, be], 'gsd', { repoParts }))

    expect(contentOf(files, '.cadre/be/CLAUDE.md')).toBe(roleClaudeMdText('be', [RULES_PART]))
    expect(contentOf(files, '.cadre/pm/CLAUDE.md')).toBe(`${builtHeader('pm')}\n`)
    expect(files.filter(file => file.content.includes(GLOBAL_ONLY_SENTENCE))).toEqual([])
  })

  test('without repoParts the files are those of the whole-files flow; with no part, those and the header file', () => {
    const be = templateRole('be')
    const without = desiredFiles(inputOf([be], 'gsd'))
    const empty = desiredFiles(inputOf([be], 'gsd', { repoParts: new Map([['be', []]]) }))
    const header: DesiredFile = { path: '.cadre/be/CLAUDE.md', content: `${builtHeader('be')}\n`, mode: 'file' }

    expect(without.map(file => file.path)).toEqual(BE_PATHS)
    expect(empty).toEqual([...without, header].sort((a, b) => compareText(a.path, b.path)))
  })
})

/** The line ROLE.md adds after the framework line of an attended role. It is no card rule, so it never repeats one. */
const ATTENDED_LINE =
  'Attended: this role needs a person for some framework steps; the Attended rules under Scope say which.'

/** The adapter each framework is driven with: where ROLE.md takes its framework name and kickoff text from. */
const ADAPTER_OF: Readonly<Record<FrameworkId, FrameworkAdapter>> = {
  gsd: GSD_ADAPTER,
  superpowers: SUPERPOWERS_ADAPTER,
  none: BUILTIN_ADAPTER,
}

/** The lines of a document that start a section. */
function headings(text: string): string[] {
  return text.split('\n').filter(line => line.startsWith('## '))
}

/** The lines of a document that start with `Attended:` at the left margin: the banner, never an indented card rule. */
function bannerLines(text: string): string[] {
  return text.split('\n').filter(line => line.startsWith('Attended:'))
}

/** The table row of the role with this id in an index; undefined when it has none. */
function indexRowOf(index: string, id: string): string | undefined {
  return index.split('\n').find(line => line.includes(`| .cadre/bin/${id} |`))
}

describe('role documents', () => {
  test('ROLE.md opens with the title and id, the purpose, the framework line and the banner of an attended PM', () => {
    const pm = templateRole('pm')
    const text = roleMdText(pm, scopeOf(pm, 'gsd', TEMPLATE_ROLES))

    expect(text.split('\n').slice(0, 7)).toEqual([
      '# PM (cadre role pm)',
      '',
      'Owns product decisions: scope, requirements and acceptance.',
      '',
      'Framework: GSD. Model: opus + medium. Permission mode: auto.',
      ATTENDED_LINE,
      '',
    ])
  })

  test('ROLE.md has the sections How you work, Decisions, Handoffs, Inbox and Scope, in that order', () => {
    const be = templateRole('be')
    const text = roleMdText(be, scopeOf(be, 'gsd', TEMPLATE_ROLES))

    expect(headings(text)).toEqual(['## How you work', '## Decisions', '## Handoffs', '## Inbox', '## Scope'])
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
  })

  test('How you work holds the kickoff text of the adapter, and the framework line names the adapter', () => {
    const api = templateRole('be', { id: 'api', title: 'Backend API' })
    for (const framework of FRAMEWORKS) {
      const adapter = ADAPTER_OF[framework]
      const text = roleMdText(api, scopeOf(api, framework, [api]))
      const kickoff = adapter.kickoffText({ title: 'Backend API', roleId: 'api', specPath: null })

      expect(text).toContain(`## How you work\n\n${kickoff}\n\n## Decisions\n`)
      expect(text).toContain(`Framework: ${adapter.name}. Model: opus + medium. Permission mode: auto.`)
    }
  })

  test('the framework line of ROLE.md names the framework of the scope card, for every framework (A4)', () => {
    const be = templateRole('be')
    const lines = FRAMEWORKS.map(framework => {
      const scope = scopeOf(be, framework, [be])

      return [scope.card.framework, roleMdText(be, scope).split('\n')[4]]
    })

    expect(lines).toEqual([
      ['gsd', 'Framework: GSD. Model: opus + medium. Permission mode: auto.'],
      ['superpowers', 'Framework: superpowers. Model: opus + medium. Permission mode: auto.'],
      ['none', 'Framework: built-in. Model: opus + medium. Permission mode: auto.'],
    ])
  })

  test('Decisions lists the chain of the card, one line for each decision type', () => {
    const pm = templateRole('pm')
    const scope = scopeOf(pm, 'gsd', TEMPLATE_ROLES)

    expect(roleMdText(pm, scope)).toContain(
      '## Decisions\n\n' +
        '- Product: pm -> human (queue_question)\n' +
        '- Arch: tl -> human (queue_question)\n' +
        '- Security: security -> human (queue_question)\n' +
        '- QA: tl -> human (queue_question)\n\n## Handoffs\n',
    )
    expect(scope.card.chain).toHaveLength(4)
  })

  test('Decisions follow basedOn: a renamed PM still takes the product decisions', () => {
    const product = templateRole('pm', { id: 'product', title: 'Product' })
    const be = templateRole('be')
    const text = roleMdText(be, scopeOf(be, 'gsd', [product, be]))

    expect(text).toContain('- Product: product -> human (queue_question)\n')
  })

  test('Handoffs names the handoff folder of the role id', () => {
    const api = templateRole('be', { id: 'api', title: 'Backend API' })
    const text = roleMdText(api, scopeOf(api, 'gsd', [api]))

    expect(text).toContain(
      '## Handoffs\n\n' +
        "Write every handoff under thoughts/shared/handoffs/api/ (autopilot's handoff path).\n\n## Inbox\n",
    )
  })

  test('Inbox names the inbox of the role id and how to leave a note for another role, in two lines (D-114)', () => {
    const be = templateRole('be')
    const api = templateRole('be', { id: 'api', title: 'Backend API' })
    const text = roleMdText(be, scopeOf(be, 'gsd', [be]))

    expect(text).toContain(
      '## Inbox\n\n' +
        'Your inbox is .cadre/be/.runtime/inbox.md, a path from the git root. ' +
        'Read it when you start and after every restart.\n' +
        'To leave a note for another role, append one dated line to .cadre/<role id>/.runtime/inbox.md of that role ' +
        '(the role ids are in .cadre/INDEX.md); never edit or delete a line that is there.\n\n## Scope\n',
    )
    expect(roleMdText(api, scopeOf(api, 'gsd', [api]))).toContain(
      '\n\nYour inbox is .cadre/api/.runtime/inbox.md, a path from the git root. ',
    )
  })

  test('Scope holds the lines of the scope card', () => {
    const be = templateRole('be', { mcp: ['jira'] })
    const scope = scopeOf(be, 'superpowers', TEMPLATE_ROLES)
    const text = roleMdText(be, scope)

    expect(text.endsWith(`## Scope\n\n${scopeCardLines(scope.card).join('\n')}\n`)).toBe(true)
    expect(text).toContain('Scope card: BE (be)\n')
  })

  test('ROLE.md of a role that starts in a folder of the repo says the git root is added (D-127)', () => {
    const be = templateRole('be')
    const text = roleMdText(be, scopeOf(be, 'gsd', [be], { launchStart: { kind: 'dir', path: 'apps/web' } }))

    expect(text).toContain('    [none] Additional directory: <git root> (start folder is <git root>/apps/web)\n')
  })

  test('a role with Bash on an unattended team has no banner', () => {
    const be = templateRole('be')
    const text = roleMdText(be, scopeOf(be, 'gsd', TEMPLATE_ROLES))

    expect(bannerLines(text)).toEqual([])
    expect(text).toContain('Permission mode: auto.\n\n## How you work\n')
  })

  test('an attended context adds the banner once, and the banner never repeats the text of a card rule', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', TEMPLATE_ROLES, { isAttended: true })
    const text = roleMdText(be, scope)

    expect(bannerLines(text)).toEqual([ATTENDED_LINE])
    expect(text).toContain(
      '    [none] Attended: this role needs a person for framework steps that cannot run unattended\n',
    )
    expect(text).not.toContain('Attended: Attended:')
  })

  test('a PM on GSD in an attended context has two Attended card rules and still one banner', () => {
    const pm = templateRole('pm')
    const scope = scopeOf(pm, 'gsd', TEMPLATE_ROLES, { isAttended: true })
    const text = roleMdText(pm, scope)

    expect(bannerLines(text)).toEqual([ATTENDED_LINE])
    expect(text.split('\n').filter(line => line.startsWith('    [none] Attended:'))).toHaveLength(2)
    expect(text).not.toContain('Attended: Attended:')
  })

  test('a title and a purpose are cleaned before they reach the document', () => {
    const role = templateRole('pm', { title: `PM${BIDI_OVERRIDE}`, purpose: 'Owns a thing.\n## Injected\nmore' })
    const text = roleMdText(role, scopeOf(role, 'gsd', [role]))
    const lines = text.split('\n')

    expect(leaks(text, [BIDI_OVERRIDE])).toEqual([])
    expect(lines[0]).toBe('# PM (cadre role pm)')
    expect(lines[2]).toBe('Owns a thing.## Injectedmore')
    expect(headings(text)).toEqual(['## How you work', '## Decisions', '## Handoffs', '## Inbox', '## Scope'])
  })

  test('INDEX.md of two roles is the header, the table header and one row each, in role order', () => {
    const pm = templateRole('pm')
    const be = templateRole('be')
    const input = inputOf([pm, be], 'gsd')

    expect(indexMdText(input.roles, input.scopes)).toBe(
      [
        '# cadre roles',
        '',
        'Generated by cadre from the role definitions. Edit .cadre/<id>/role.json and run /cadre regen <id>.',
        '',
        '| Role | Purpose | Framework | Model | Scope | Launcher | Handoffs |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        '| PM (pm) | Owns product decisions: scope, requirements and acceptance. | GSD | opus + medium | ' +
          'no Bash; MCP: none; skills: 8 | .cadre/bin/pm | thoughts/shared/handoffs/pm/ |',
        '| BE (be) | Implements the backend and core code. | GSD | opus + medium | ' +
          'sandboxed Bash; MCP: none; skills: 8 | .cadre/bin/be | thoughts/shared/handoffs/be/ |',
        '',
      ].join('\n'),
    )
  })

  test('the scope cell lists the MCP servers sorted and counts the skills the role can run, by framework', () => {
    const be = templateRole('be', { mcp: ['jira', 'github'], skills: ['codex:rescue', 'my-skill', 'gsd-plan-phase'] })
    const expected: readonly (readonly [FrameworkId, string])[] = [
      ['gsd', 'sandboxed Bash; MCP: github, jira; skills: 10'],
      ['superpowers', 'sandboxed Bash; MCP: github, jira; skills: 9'],
      ['none', 'sandboxed Bash; MCP: github, jira; skills: 5'],
    ]
    for (const [framework, cell] of expected) {
      const input = inputOf([be], framework)
      const row = indexRowOf(indexMdText(input.roles, input.scopes), 'be')

      expect(row).toContain(` | ${cell} | `)
    }
  })

  test('more than 12 MCP servers show the first 12 and the count of the rest', () => {
    const names = Array.from({ length: 14 }, (_, index) => `srv${String(index + 1).padStart(2, '0')}`)
    const input = inputOf([templateRole('be', { mcp: names })], 'gsd')
    const row = indexRowOf(indexMdText(input.roles, input.scopes), 'be')

    expect(row).toContain(`MCP: ${names.slice(0, 12).join(', ')}, +2 more; `)
    expect(row).not.toContain('srv13')
  })

  test('a pipe in a title or a purpose is written as \\| so it stays one cell', () => {
    const input = inputOf([templateRole('be', { title: 'B|E', purpose: 'Builds a | b.' })], 'gsd')
    const row = indexRowOf(indexMdText(input.roles, input.scopes), 'be')

    expect(row?.startsWith('| B\\|E (be) | Builds a \\| b. | GSD | ')).toBe(true)
  })

  test('a title and a purpose in the index are cleaned', () => {
    const role = templateRole('be', { title: `B${BIDI_OVERRIDE}E`, purpose: 'Line one\nLine two' })
    const input = inputOf([role], 'gsd')
    const index = indexMdText(input.roles, input.scopes)

    expect(leaks(index, [BIDI_OVERRIDE])).toEqual([])
    expect(indexRowOf(index, 'be')?.startsWith('| BE (be) | Line oneLine two | ')).toBe(true)
  })

  test('INDEX.md is static: the same input gives the same text, with no date and no count of handoffs', () => {
    const input = inputOf(TEMPLATE_ROLES, 'gsd')
    const first = indexMdText(input.roles, input.scopes)
    const second = indexMdText(input.roles, input.scopes)

    expect(second).toBe(first)
    expect(/\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}/.test(first)).toBe(false)
    expect(first.toLowerCase()).not.toContain('latest')
  })

  test('a role with no scope has no row in the index', () => {
    const input = inputOf(TEMPLATE_ROLES, 'gsd')
    const noScope = new Map(Array.from(input.scopes).filter(([id]) => id !== 'qa' && id !== 'fe'))
    const text = indexMdText(input.roles, noScope)

    expect(indexRowOf(text, 'qa')).toBeUndefined()
    expect(indexRowOf(text, 'fe')).toBeUndefined()
    expect(indexRowOf(text, 'security')).toContain('| Security (security) |')
  })

  test('cadreJsonText is the stable JSON of the repo state and parses back to it', () => {
    const state = stateOf(TEMPLATE_ROLES, 'gsd')

    expect(cadreJsonText(state)).toBe(stableJson(state))
    expect(JSON.parse(cadreJsonText(state))).toEqual(state)
    expect(cadreJsonText({ ...state, framework: null })).toContain('"framework": null')
  })

  test('cadreJsonText round-trips through parseCadreState with every launch start and consent answer (A2, A1)', () => {
    const state = stateOf(TEMPLATE_ROLES, 'gsd')
    const starts: readonly CadreState['launchStart'][] = [
      { kind: 'git-root' },
      { kind: 'here' },
      { kind: 'dir', path: 'apps/web' },
    ]
    for (const readUserMcp of [false, true]) {
      for (const launchStart of starts) {
        const text = cadreJsonText({ ...state, launchStart, readUserMcp })
        expect(parseCadreState(text)).toEqual({ ...state, launchStart, readUserMcp })
      }
    }
  })
})
