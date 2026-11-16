import { describe, expect, test } from 'claude-code/testing'

import type {
  CadreState,
  CompiledScope,
  DesiredFile,
  FrameworkAdapter,
  FrameworkId,
  InstructionPart,
  RoleSpec,
} from '../../types'
import { stableJson } from '../core/json'
import { compareText } from '../core/text'
import { GSD_ADAPTER } from '../framework/gsd/adapter'
import { BUILTIN_ADAPTER } from '../framework/none/adapter'
import { SUPERPOWERS_ADAPTER } from '../framework/superpowers/adapter'
import { ARTIFACT } from '../locales/artifact'
import { fill } from '../locales/t'
import { scopeCardLines } from '../scope/card'
import { parseCadreState } from '../state/cadre-files'
import {
  BIDI_OVERRIDE,
  contentOf,
  FRAMEWORKS,
  GLOBAL_ONLY_SENTENCE,
  leaks,
  scopeOf,
  TEMPLATE_ROLES,
  templateRole,
} from '../testkit'
import { cadreJsonText, indexMdText, partsBody, roleClaudeMdText, roleMdText, rubricText } from './docs'
import type { RoleMdTeam } from './docs'
import { desiredFiles } from './files'
import type { GenerateInput } from './files'
import { builtClaudeMdPath } from './launcher'

/** The idle wait sentence, spelled out so the specs pin its words. */
const IDLE_WAIT =
  'When your inbox is empty, call wait_for with reason idle-inbox if more work may come; ' +
  'when your task is finished, give the done answer autopilot asks for.'

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
  '.cadre/sizing.md',
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

describe('rubricText', () => {
  const lines = rubricText().split('\n')

  test('printable ASCII lines ending in one newline, the same text every time, with no date and no count', () => {
    expect(/^[\x20-\x7E\n]*$/.test(rubricText())).toBe(true)
    expect([rubricText().endsWith('\n'), rubricText().endsWith('\n\n')]).toEqual([true, false])
    expect(rubricText()).toBe(rubricText())
    expect(/\d{4}-\d{2}-\d{2}/.test(rubricText())).toBe(false)
  })

  test('each of the four dimensions has a heading with its anchors at 0.2, 0.5 and 0.9, in that order', () => {
    for (const dimension of ['scope', 'complexity', 'risk', 'effort']) {
      const at = lines.findIndex(line => line.startsWith(`## ${dimension}: `))

      expect(at).toBeGreaterThan(0)
      expect(lines.slice(at + 1, at + 4).map(line => line.slice(0, 7))).toEqual(['- 0.2: ', '- 0.5: ', '- 0.9: '])
    }
  })

  test('it says a size is the highest of the four scores and is large at the threshold in cadre.json', () => {
    const text = rubricText()

    expect(text).toContain('highest of its four scores')
    expect(text).toContain('sizing.threshold in .cadre/cadre.json')
    expect(text).toContain('from 0.1 to 1.0')
  })
})

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

/** The template team as init records it when the user keeps cadre's core team. */
const CORE_TEAM: RoleMdTeam = { isCore: true, roles: TEMPLATE_ROLES }

/** The template TL renamed to `lead`, and the core team it leads. */
const LEAD = templateRole('tl', { id: 'lead', title: 'Lead' })
const LEAD_TEAM: RoleMdTeam = { isCore: true, roles: TEMPLATE_ROLES.map(role => (role.id === 'tl' ? LEAD : role)) }

/** The core TL's fed-ticket and brief lines, spelled out so the specs pin their words. */
const CORE_TL_FED =
  "Work only on the ticket PM fed, and answer PM's code-fact questions during the grill; do no research on later " +
  'tickets.'
const CORE_TL_BRIEF =
  'Send each implementer a brief, not a plan: the goal, the acceptance criteria, your architecture decisions with ' +
  'their reasons, the areas at risk, what is out of scope, the report form and what must be proven. Leave out ' +
  'method signatures, spec bodies and commands.'

/** The lines of a document that start a section. */
function headings(text: string): string[] {
  return text.split('\n').filter(line => line.startsWith('## '))
}

/** The lines of a document from `heading` up to the next heading or the end; [] when it has no such heading. */
function sectionLines(text: string, heading: string): string[] {
  const lines = text.split('\n')
  const at = lines.indexOf(heading)
  if (at < 0) return []
  const end = lines.findIndex((line, index) => index > at && line.startsWith('## '))

  return lines.slice(at, end < 0 ? lines.length : end)
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

  test('ROLE.md has How you work, Decisions, Handoffs, Inbox, Planning docs, Hierarchy, Sizing and Scope', () => {
    const be = templateRole('be')
    const text = roleMdText(be, scopeOf(be, 'gsd', TEMPLATE_ROLES))

    expect(headings(text)).toEqual([
      '## How you work',
      '## Decisions',
      '## Handoffs',
      '## Inbox',
      '## Planning docs',
      '## Hierarchy',
      '## Sizing',
      '## Scope',
    ])
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

  test(
    'Inbox names the inbox in the user config folder, the three inbox tools, the idle wait and the states, ' +
      'in four lines',
    () => {
      const be = templateRole('be')
      const api = templateRole('be', { id: 'api', title: 'Backend API' })
      const text = roleMdText(be, scopeOf(be, 'gsd', [be]))

      expect(text).toContain(
        '## Inbox\n\n' +
          'Your inbox lives in your user config folder, outside the repo, and only the cadre inbox tools write it. ' +
          'Read it with inbox_read when you start, after every restart and when a wait ends.\n' +
          IDLE_WAIT + '\n' +
          'Send a message to another role with inbox_send (the role ids are in .cadre/INDEX.md).\n' +
          'Each new entry is unread. Mark it with inbox_mark: read, awaiting (waitsFor: the id of the entry ' +
          'you wait for), blocked (name what it waits on), rejected (with the reason; it goes back up) or done (a ' +
          'one-line outcome). Never edit an inbox file by hand: only the cadre inbox tools write them.\n\n' +
          '## Planning docs\n',
      )
      expect(text).not.toContain('inbox.md')
      expect(roleMdText(api, scopeOf(api, 'gsd', [api]))).toContain(`\n\n${ARTIFACT.roleMdInboxLine}\n`)
      expect(ARTIFACT.roleMdInboxLine).not.toContain('.cadre')
    },
  )

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

  test('a PM on GSD in an attended context has three Attended card rules and still one banner', () => {
    const pm = templateRole('pm')
    const scope = scopeOf(pm, 'gsd', TEMPLATE_ROLES, { isAttended: true })
    const text = roleMdText(pm, scope)

    expect(bannerLines(text)).toEqual([ATTENDED_LINE])
    expect(text.split('\n').filter(line => line.startsWith('    [none] Attended:'))).toHaveLength(3)
    expect(text).not.toContain('Attended: Attended:')
  })

  test('TL on GSD, started with --ask-user, holds the banner once; BE on GSD holds none', () => {
    const banners = [templateRole('tl'), templateRole('be')].map(
      role => roleMdText(role, scopeOf(role, 'gsd', TEMPLATE_ROLES)).split(ARTIFACT.roleMdAttended).length - 1,
    )

    expect(banners).toEqual([1, 0])
  })

  test('a title and a purpose are cleaned before they reach the document', () => {
    const role = templateRole('pm', { title: `PM${BIDI_OVERRIDE}`, purpose: 'Owns a thing.\n## Injected\nmore' })
    const text = roleMdText(role, scopeOf(role, 'gsd', [role]))
    const lines = text.split('\n')

    expect(leaks(text, [BIDI_OVERRIDE])).toEqual([])
    expect(lines[0]).toBe('# PM (cadre role pm)')
    expect(lines[2]).toBe('Owns a thing.## Injectedmore')
    expect(headings(text)).toEqual([
      '## How you work',
      '## Decisions',
      '## Handoffs',
      '## Inbox',
      '## Planning docs',
      '## Hierarchy',
      '## Sizing',
      '## Scope',
    ])
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
          'no Bash; MCP: none; skills: 12 | .cadre/bin/pm | thoughts/shared/handoffs/pm/ |',
        '| BE (be) | Implements the backend and core code. | GSD | opus + medium | ' +
          'sandboxed Bash; MCP: none; skills: 12 | .cadre/bin/be | thoughts/shared/handoffs/be/ |',
        '',
      ].join('\n'),
    )
  })

  test('the scope cell lists the MCP servers sorted and counts the skills the role can run, by framework', () => {
    const be = templateRole('be', { mcp: ['jira', 'github'], skills: ['codex:rescue', 'my-skill', 'gsd-plan-phase'] })
    const expected: readonly (readonly [FrameworkId, string])[] = [
      ['gsd', 'sandboxed Bash; MCP: github, jira; skills: 14'],
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

describe('the Planning docs section of ROLE.md', () => {
  const planningDocs = (text: string): string[] => sectionLines(text, '## Planning docs')
  const stepLines = (adapter: FrameworkAdapter, roleId: string, isLead: boolean): string[] =>
    adapter.roleWork.startSteps({ roleId, isLead }).map(step => `- ${step}`)

  test('TL that may run GSD and superpowers groups the steps under each framework, own framework first', () => {
    const tl = templateRole('tl')
    const scope = scopeOf(tl, 'gsd', TEMPLATE_ROLES, { alsoRuns: ['gsd', 'superpowers'] })
    const section = planningDocs(roleMdText(tl, scope))
    const gsd = stepLines(GSD_ADAPTER, 'tl', true)
    const superpowers = stepLines(SUPERPOWERS_ADAPTER, 'tl', true)

    expect(section).toEqual([
      '## Planning docs',
      '',
      ARTIFACT.roleMdPlanningIntro,
      ARTIFACT.roleMdPlanningPick,
      fill(ARTIFACT.roleMdPlanningGroup, { framework: 'GSD', id: 'gsd' }),
      ...gsd,
      fill(ARTIFACT.roleMdPlanningGroup, { framework: 'superpowers', id: 'superpowers' }),
      ...superpowers,
      '',
    ])
    expect(section.filter(line => line.startsWith('- '))).toEqual([...gsd, ...superpowers])
  })

  test('a role on superpowers that also runs gsd lists the superpowers group first', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'superpowers', TEMPLATE_ROLES, { alsoRuns: ['gsd', 'superpowers'] })

    expect(planningDocs(roleMdText(be, scope))).toEqual([
      '## Planning docs',
      '',
      ARTIFACT.roleMdPlanningIntro,
      ARTIFACT.roleMdPlanningPick,
      fill(ARTIFACT.roleMdPlanningGroup, { framework: 'superpowers', id: 'superpowers' }),
      ...stepLines(SUPERPOWERS_ADAPTER, 'be', false),
      fill(ARTIFACT.roleMdPlanningGroup, { framework: 'GSD', id: 'gsd' }),
      ...stepLines(GSD_ADAPTER, 'be', false),
      '',
    ])
  })

  test('BE on gsd has the worker steps with the no-TL step; BE on superpowers its plan file and the method', () => {
    const be = templateRole('be')
    const gsd = planningDocs(roleMdText(be, scopeOf(be, 'gsd', TEMPLATE_ROLES)))
    const superpowers = planningDocs(roleMdText(be, scopeOf(be, 'superpowers', TEMPLATE_ROLES))).join('\n')
    const worker = GSD_ADAPTER.roleWork.startSteps({ roleId: 'be', isLead: false })

    expect(gsd.filter(line => line.startsWith('- '))).toEqual(worker.map(step => `- ${step}`))
    expect(gsd.join('\n')).toContain('no TL')
    expect(superpowers).toContain('docs/superpowers/plans/be-<ticket>.md')
    expect(superpowers).toContain('superpowers:subagent-driven-development')
  })

  test('BE on gsd alone or on superpowers alone has the intro and the steps, with no pick line and no label', () => {
    const be = templateRole('be')
    const alone: readonly FrameworkId[] = ['gsd', 'superpowers']

    for (const framework of alone) {
      const section = planningDocs(roleMdText(be, scopeOf(be, framework, TEMPLATE_ROLES)))

      expect(section).toEqual([
        '## Planning docs',
        '',
        ARTIFACT.roleMdPlanningIntro,
        ...stepLines(ADAPTER_OF[framework], 'be', false),
        '',
      ])
    }
  })

  test('the core TL has the lead steps without the quick or phase path', () => {
    const steps = [ARTIFACT.gsdStepNewProject, ARTIFACT.gsdStepWorkstream, ARTIFACT.gsdStepMilestoneLead]
    const cases: readonly [RoleSpec, RoleMdTeam][] = [
      [templateRole('tl'), CORE_TEAM],
      [LEAD, LEAD_TEAM],
    ]

    for (const [tl, team] of cases) {
      const text = roleMdText(tl, scopeOf(tl, 'gsd', TEMPLATE_ROLES), team)
      const howYouWork = sectionLines(text, '## How you work').join('\n')

      expect(planningDocs(text)).toEqual([
        '## Planning docs',
        '',
        ARTIFACT.roleMdPlanningIntro,
        ...steps.map(step => `- ${step}`),
        '',
      ])
      expect(howYouWork).not.toContain('Start: /gsd-autonomous')
      expect(howYouWork).not.toContain('Verify with /gsd-validate-phase')
    }
    const custom = roleMdText(templateRole('tl'), scopeOf(templateRole('tl'), 'gsd', TEMPLATE_ROLES))

    expect(planningDocs(custom).join('\n')).toContain('/gsd-quick')
    expect(sectionLines(custom, '## How you work').join('\n')).toContain('Start: /gsd-autonomous')
    expect(sectionLines(custom, '## How you work').join('\n')).toContain('Verify with /gsd-validate-phase')
  })

  test('PM on none has no Planning docs section, whatever the repo records', () => {
    const pm = templateRole('pm')
    const text = roleMdText(pm, scopeOf(pm, 'none', TEMPLATE_ROLES, { alsoRuns: ['gsd', 'superpowers'] }))

    expect(headings(text)).not.toContain('## Planning docs')
  })

  test('every section line is printable ASCII, and none tells the role to write under .planning/ itself', () => {
    for (const framework of FRAMEWORKS) {
      for (const role of TEMPLATE_ROLES) {
        const scope = scopeOf(role, framework, TEMPLATE_ROLES, { alsoRuns: ['gsd', 'superpowers'] })
        const section = planningDocs(roleMdText(role, scope))

        expect(section.filter(line => !/^[\x20-\x7e]*$/.test(line))).toEqual([])
        expect(section.filter(line => /\b(write|edit)\b[^.]*\.planning\//i.test(line))).toEqual([])
      }
    }
  })
})

describe('the Hierarchy section of ROLE.md', () => {
  /** The Hierarchy section of the ROLE.md of `role` on `framework` in the template team, as one text. */
  function hierarchyOf(role: RoleSpec, framework: FrameworkId, team?: RoleMdTeam): string {
    return sectionLines(roleMdText(role, scopeOf(role, framework, TEMPLATE_ROLES), team), '## Hierarchy').join('\n')
  }

  test('PM grills the user through AskUserQuestion rounds until nothing is open, then proposes the mode', () => {
    const text = hierarchyOf(templateRole('pm'), 'none')

    expect(text).toContain('grill the user on the epic and on every ticket in one attended run')
    expect(text).toContain('Use mattpocock-skills:grilling for it when that skill is available.')
    expect(text).toContain('AskUserQuestion: the whole open frontier per round, up to 4 questions per call')
    expect(text).toContain('2-4 options each, the recommended option first')
    expect(text).toContain('split a larger round over several calls')
    expect(text).toContain('The grill is done when no question is open and the user confirms.')
    expect(text).toContain('write the question as text and call wait_for with reason user-answer')
    expect(text).toContain('propose a planning mode')
    expect(text).toContain('do not move on before the user confirms it')
    expect(text).toContain('send epic-end')
  })

  test('PM runs the grill itself with the same rules when the grill skill is not available', () => {
    expect(hierarchyOf(templateRole('pm'), 'none')).toContain(
      'When it is not available (its plugin was declined or did not install), ' +
        'run the grill yourself with the same rules.',
    )
  })

  test('BE has no PM part', () => {
    const be = templateRole('be')
    const text = roleMdText(be, scopeOf(be, 'gsd', TEMPLATE_ROLES))

    expect(text).not.toContain('mattpocock-skills:grilling')
    expect(text).not.toContain('grill the user')
  })

  test(
    'TL sizes each ticket, plans it, sends BE and FE their tasks in parallel, waits and reports to PM ' +
      '(custom or unrecorded team)',
    () => {
      const text = hierarchyOf(templateRole('tl'), 'gsd')

      expect(text).toContain('Your ticket loop as TL: on each ticket PM sends, add complexity and effort')
      expect(text).toContain('compute the size and pick the framework or GSD path')
      expect(text).toContain('record the vector with a one-line reason')
      expect(text).toContain('Plan the ticket in your own planning docs.')
      expect(text).toContain('Send BE and FE their tasks in parallel (inbox_send kind task), split by area')
      expect(text).toContain('a file both would touch is yours to serialise')
      expect(text).toContain('Wait for every report, then report to PM in the form PM asked')
      expect(text).toContain(
        'outcome, changes, verification, the vector with its reason, the framework used, the doc paths and the open ' +
          'questions',
      )
      expect(text).toContain('wait for the next ticket')
    },
  )

  test('the core TL sizes each ticket, works only on the fed ticket, briefs and sends BE and FE their tasks', () => {
    const texts = [hierarchyOf(templateRole('tl'), 'gsd', CORE_TEAM), hierarchyOf(LEAD, 'gsd', LEAD_TEAM)]

    for (const text of texts) {
      const lines = text.split('\n')

      expect(lines.slice(lines.indexOf(ARTIFACT.roleMdTlLoop), -1)).toEqual([
        ARTIFACT.roleMdTlLoop,
        CORE_TL_FED,
        CORE_TL_BRIEF,
        ARTIFACT.roleMdTlTasks,
        ARTIFACT.roleMdTlReport,
      ])
      expect(text).toContain('Your ticket loop as TL: on each ticket PM sends, add complexity and effort')
      expect(text).toContain('Send BE and FE their tasks in parallel (inbox_send kind task), split by area')
      expect(text).not.toContain('Plan the ticket in your own planning docs.')
    }
  })

  test('BE plans in its own docs, commits only its own files, reports to TL and sizes alone with no TL', () => {
    const text = hierarchyOf(templateRole('be'), 'gsd')

    expect(text).toContain('Plan and execute each task in your own planning docs.')
    expect(text).toContain('Commit only your own files on the epic branch: git add <paths>, never git add -A.')
    expect(text).toContain('When git reports an index lock, wait and retry')
    expect(text).toContain('never rebase or reset the shared branch')
    expect(text).toContain('Report each task to TL when it is done')
    expect(text).toContain('A technical question goes to your parent role and TL decides it')
    expect(text).toContain('In a team without TL, PM sends you the ticket: add complexity and effort')
    expect(text).toContain('take the no-TL step of Planning docs when it has one')
  })

  test(
    'every role is told where a question goes, that in an epic only PM asks the user, a rejection and the epic end',
    () => {
      for (const role of TEMPLATE_ROLES) {
        const text = hierarchyOf(role, 'gsd')

        expect(text.startsWith('## Hierarchy\n\nA technical question goes to your parent role')).toBe(true)
        expect(text).toContain('a product or ticket question goes straight to PM')
        expect(text).toContain('In an epic, only PM asks the user')
        expect(text).toContain('An entry you mark rejected goes back up to the role that sent it')
        expect(text).toContain('On epic-end, mark your open inbox entries, write your handoff')
        expect(text).toContain('AUTOPILOT_DONE; PM does this last.')
      }
    },
  )

  test('only a role started with --ask-user gets a line telling it to ask the person', () => {
    for (const framework of FRAMEWORKS) {
      for (const role of TEMPLATE_ROLES) {
        const lines = roleMdText(role, scopeOf(role, framework, TEMPLATE_ROLES)).split('\n')
        const asks = lines.filter(line => /\bask the user\b|\bwith AskUserQuestion\b/i.test(line))

        expect([role.id, asks.length > 0]).toEqual([role.id, role.autopilot.askUser])
      }
    }
  })

  test('a role started with --ask-user gets the line to ask the person outside an epic, after the epic line', () => {
    for (const role of TEMPLATE_ROLES) {
      const lines = hierarchyOf(role, 'gsd').split('\n')
      const at = lines.indexOf(ARTIFACT.roleMdHierarchyAskUser)
      const isAfter = at > lines.indexOf(ARTIFACT.roleMdHierarchyCommonAsk)

      expect([role.id, at >= 0, isAfter]).toEqual([role.id, role.autopilot.askUser, role.autopilot.askUser])
    }
  })

  test('a custom role started with --ask-user gets the line to ask the person outside an epic too', () => {
    const ops = templateRole('be', { id: 'ops', autopilot: { ...templateRole('be').autopilot, askUser: true } })

    expect(hierarchyOf(ops, 'gsd').split('\n')).toContain(ARTIFACT.roleMdHierarchyAskUser)
  })
})

describe('the Sizing section of ROLE.md', () => {
  test('every role gets the four dimensions, who scores which, the size rule, the rubric and the user pin', () => {
    for (const framework of FRAMEWORKS) {
      for (const role of TEMPLATE_ROLES) {
        const text = roleMdText(role, scopeOf(role, framework, TEMPLATE_ROLES))
        const section = sectionLines(text, '## Sizing').join('\n')

        expect(section.startsWith('## Sizing\n\n')).toBe(true)
        expect(section).toContain('four scores, each from 0.1 to 1.0: scope, complexity, risk and effort')
        expect(section).toContain('PM scores scope and risk; TL adds complexity and effort')
        expect(section).toContain('The size is the highest of the four')
        expect(section).toContain('large at or over sizing.threshold in .cadre/cadre.json')
        expect(section).toContain('the anchors in .cadre/sizing.md')
        expect(section).toContain('A size the user pins on a ticket overrides the computed class.')
        expect(text).toContain(`${section}\n## Scope\n`)
      }
    }
  })
})
