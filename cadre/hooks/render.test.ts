import { describe, expect, test } from 'claude-code/testing'

import type { Choice, Facts, FrameworkAdapter, GsdFact, HookScript, PaneKey, RepoEntry, ShownBlock } from '../types'
import { ADAPTERS, detectAll } from './adapters'
import { BUILTIN_ADAPTER } from './builtin'
import { clean } from './facts'
import { GSD_GATES } from './gsd'
import {
  adaptersReportLines,
  cardList,
  choiceLine,
  detectReportLines,
  detectText,
  diffLines,
  lineDiff,
  pad,
  paneRows,
  paneSpans,
  paneView,
  reportText,
  shown,
  STATUS_LABEL,
} from './render'
import type { PaneRow, PaneSpan } from './render'
import { SUPERPOWERS_ADAPTER } from './superpowers'
import { BIDI_OVERRIDE } from './testkit'

/** The superpowers plugin key this repo enables. */
const SUPERPOWERS_KEY = 'superpowers@claude-plugins-official'

/** A control, format, or line or paragraph separator character. A newline is the one a report may keep. */
const CONTROL_OR_FORMAT = /(?!\n)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

/** Facts with every list empty. A test sets only the list it reads. */
function facts(over: Partial<Facts>): Facts {
  return {
    repoEntries: [],
    docsEntries: [],
    enabledPlugins: [],
    hookScripts: [],
    superpowersVersions: [],
    gsd: [],
    warnings: [],
    ...over,
  }
}

/** A repo-root or docs entry as the host lists it. */
function entry(name: string, kind: RepoEntry['kind'] = 'dir', isLink = false): RepoEntry {
  return { name, kind, isLink }
}

/** A user-level GSD install whose identity is proven, at the given display path. */
function provenGsd(dir: string): GsdFact {
  return { location: 'user', dir, version: '1.16.0', identity: 'proven', runtimeIdentityTried: false }
}

/** A hook script registered in user settings, as normalised Facts keep it: its basename, its event and its source. */
function hook(script: string): HookScript {
  return { script, event: 'PostToolUse', source: 'user' }
}

/**
 * The shape of this repo: `.planning/` and `docs/superpowers/` present, GSD 1.16.0 installed for the user, and
 * superpowers 6.4.1 enabled for the user.
 */
function thisRepo(): Facts {
  return facts({
    repoEntries: [entry('.planning'), entry('docs')],
    docsEntries: [entry('superpowers')],
    enabledPlugins: [{ key: SUPERPOWERS_KEY, source: 'user', value: true }],
    superpowersVersions: [{ key: SUPERPOWERS_KEY, version: '6.4.1' }],
    gsd: [provenGsd('~/.claude/gsd-core')],
  })
}

describe('detectAll', () => {
  test('gives the supported detections in order, then one per unsupported marker, with no built-in row', () => {
    const ids = detectAll(facts({})).map(detection => detection.id)

    expect(ids).toEqual(['gsd', 'superpowers', 'aidlc', 'bmad', 'spec-kit'])
  })
})

describe('detectReportLines', () => {
  test('the report for this repo is a titled table with five rows and the ambiguous choice last', () => {
    expect(detectReportLines(thisRepo())).toEqual([
      'cadre detect  (read-only, nothing was written)',
      '',
      'Framework     Status       Version  Evidence',
      'GSD           in use       1.16.0   .planning/ (dir); gsd-core 1.16.0 at ~/.claude/gsd-core',
      'superpowers   in use       6.4.1    docs/superpowers/; ' + `enabledPlugins["${SUPERPOWERS_KEY}"]=true (user)`,
      'AI-DLC        not found    -        no aidlc/',
      'BMAD          not found    -        no _bmad/',
      'spec-kit      not found    -        no .specify/',
      '',
      'Adapter: ambiguous: gsd, superpowers; init will ask',
    ])
  })

  test('a version of 240 code points is kept whole, and one of 241 is cut to 240 with an ellipsis', () => {
    const kept = 'v'.repeat(240)
    const cut = `${'v'.repeat(239)}\u{2026}`
    const keptRow = detectReportLines(facts({ gsd: [{ ...provenGsd('d'), version: kept }] })).join('\n')
    const cutRow = detectReportLines(facts({ gsd: [{ ...provenGsd('d'), version: `${kept}v` }] })).join('\n')

    expect(keptRow).toContain(`installed    ${kept} `)
    expect(cutRow).toContain(`installed    ${cut} `)
  })

  test('an evidence string of 240 code points is kept whole, and one of 241 is cut to 240 with an ellipsis', () => {
    const prefix = 'gsd-core 1.16.0 at '
    const kept = `${prefix}${'a'.repeat(221)}`
    const cut = `${prefix}${'a'.repeat(220)}\u{2026}`
    const keptLines = detectReportLines(facts({ gsd: [provenGsd('a'.repeat(221))] }))
    const cutLines = detectReportLines(facts({ gsd: [provenGsd('a'.repeat(222))] }))

    expect(Array.from(kept).length).toBe(240)
    expect(keptLines.some(line => line.endsWith(kept))).toBe(true)
    expect(cutLines.some(line => line.endsWith(cut))).toBe(true)
  })

  test('a bidi override and a control character in a detection value are removed before display', () => {
    const hostile = facts({ gsd: [provenGsd('~/.claude/gsd\u{202E}core\u{0007}')] })
    const text = detectReportLines(hostile).join('\n')

    expect(text).toContain('gsd-core 1.16.0 at ~/.claude/gsdcore')
    expect(text).not.toMatch(CONTROL_OR_FORMAT)
  })
})

describe('choiceLine', () => {
  test('a chosen framework names the framework and the reason it was chosen', () => {
    const choice: Choice = {
      kind: 'chosen',
      id: 'gsd',
      pickedBy: 'only-one-in-use',
      reason: 'only gsd is in use in this repo',
    }

    expect(choiceLine(choice)).toBe('Adapter: gsd (only gsd is in use in this repo)')
  })

  test('an ambiguous choice lists its ids and says init will ask', () => {
    expect(choiceLine({ kind: 'ambiguous', ids: ['gsd', 'superpowers'] })).toBe(
      'Adapter: ambiguous: gsd, superpowers; init will ask',
    )
  })

  test('an installed-only choice lists its ids and says init will ask', () => {
    expect(choiceLine({ kind: 'installed-only', ids: ['gsd'] })).toBe('Adapter: installed-only: gsd; init will ask')
  })

  test('an unsupported choice names the marker it found, not the built-in none', () => {
    expect(choiceLine({ kind: 'unsupported', ids: ['aidlc'] })).toBe(
      'Adapter: none usable: aidlc detected but unsupported; init will ask',
    )
  })

  test('the none choice says nothing was detected and names the two frameworks init recommends', () => {
    expect(choiceLine({ kind: 'none' })).toBe(
      'Adapter: none (built-in); nothing detected, init will recommend GSD or superpowers',
    )
  })
})

describe('pad', () => {
  test('pads with spaces up to the width', () => {
    expect(pad('Status', 13)).toBe('Status       ')
  })

  test('a text at the width or longer gets one trailing space, so columns never touch', () => {
    expect(pad('abc', 3)).toBe('abc ')
    expect(pad('abcd', 3)).toBe('abcd ')
  })

  test('the width counts code points, so an astral character takes one column', () => {
    const astral = '\u{1F600}'

    expect(pad(astral, 3)).toBe(`${astral}  `)
  })
})

describe('reportText', () => {
  test('a text over 240 code points is cut to 240, the last one an ellipsis', () => {
    const shown = reportText('a'.repeat(300))

    expect(Array.from(shown).length).toBe(240)
    expect(shown.endsWith('…')).toBe(true)
    expect(shown).toBe(`${'a'.repeat(239)}…`)
  })

  test('a text of exactly 240 code points is kept whole', () => {
    expect(reportText('a'.repeat(240))).toBe('a'.repeat(240))
  })

  test('unsafe characters are removed before the text is shown', () => {
    expect(reportText('x\u202Ey')).toBe('xy')
  })
})

describe('shown and cardList', () => {
  test('shown is a scanned name cleaned and capped at 110 code points, the last one an ellipsis', () => {
    const long = 'x'.repeat(200)

    expect(shown(long)).toBe(clean(long, 110))
    expect(shown(long)).toBe(`${'x'.repeat(109)}…`)
    expect(shown('x'.repeat(110))).toBe('x'.repeat(110))
  })

  test('shown removes a hidden character from a name', () => {
    expect(shown(`a${BIDI_OVERRIDE}b`)).toBe('ab')
  })

  test('cardList is none for no names and lists up to 12 names as they are', () => {
    const twelve = Array.from({ length: 12 }, (_, index) => `n${index + 1}`)

    expect(cardList([])).toBe('none')
    expect(cardList(['a'])).toBe('a')
    expect(cardList(twelve)).toBe(twelve.join(', '))
  })

  test('cardList of more than 12 names lists the first 12, then counts the rest', () => {
    const names = Array.from({ length: 15 }, (_, index) => `n${index + 1}`)

    expect(cardList(names)).toBe([...names.slice(0, 12), '+3 more'].join(', '))
  })
})

describe('STATUS_LABEL', () => {
  test('names each status as the report shows it', () => {
    expect(STATUS_LABEL).toEqual({
      'in-use': 'in use',
      installed: 'installed',
      'not-found': 'not found',
      unsupported: 'unsupported',
    })
  })
})

describe('unsupported markers beside a chosen framework', () => {
  test('a marker found beside a chosen framework is named just before the choice line', () => {
    const lines = detectReportLines(facts({ repoEntries: [entry('.planning'), entry('aidlc')] }))

    expect(lines.slice(-4)).toEqual([
      '',
      'Warning: also detected but unsupported: AI-DLC',
      '',
      'Adapter: gsd (only gsd is in use in this repo)',
    ])
  })

  test('a marker is also named when the choice is ambiguous', () => {
    const repo = facts({
      repoEntries: [entry('.planning'), entry('docs'), entry('aidlc')],
      docsEntries: [entry('superpowers')],
    })

    expect(detectReportLines(repo).slice(-4)).toEqual([
      '',
      'Warning: also detected but unsupported: AI-DLC',
      '',
      'Adapter: ambiguous: gsd, superpowers; init will ask',
    ])
  })

  test('a marker is also named when only an install is found', () => {
    const repo = facts({ repoEntries: [entry('_bmad')], gsd: [provenGsd('~/.claude/gsd-core')] })

    expect(detectReportLines(repo).slice(-4)).toEqual([
      '',
      'Warning: also detected but unsupported: BMAD',
      '',
      'Adapter: installed-only: gsd; init will ask',
    ])
  })

  test('a repo with only an unsupported marker gets no warning, since the choice line already names it', () => {
    const lines = detectReportLines(facts({ repoEntries: [entry('aidlc')] }))

    expect(lines.some(line => line.startsWith('Warning: also detected'))).toBe(false)
    expect(lines.slice(-2)).toEqual(['', 'Adapter: none usable: aidlc detected but unsupported; init will ask'])
  })
})

describe('GSD hooks and host warnings', () => {
  test('registered GSD hooks are named with what each does to a role, before the choice line', () => {
    const repo = facts({
      hookScripts: [hook('gsd-context-monitor.js'), hook('gsd-secret-read-guard.js')],
    })

    expect(detectReportLines(repo).slice(-4)).toEqual([
      '',
      'GSD hooks registered (activation depends on GSD config): ' +
        'gsd-context-monitor (conflicts with the autopilot handoff), gsd-secret-read-guard (useful for Security)',
      '',
      'Adapter: none (built-in); nothing detected, init will recommend GSD or superpowers',
    ])
  })

  test('each host warning is its own line before the choice line', () => {
    const lines = detectReportLines(facts({ warnings: ['could not read project settings'] }))

    expect(lines.slice(-4)).toEqual([
      '',
      'Warning: could not read project settings',
      '',
      'Adapter: none (built-in); nothing detected, init will recommend GSD or superpowers',
    ])
  })

  test('a host warning of 240 code points is kept whole, and one of 241 is cut to 240 with an ellipsis', () => {
    const kept = 'a'.repeat(240)
    const cut = `${'a'.repeat(239)}\u{2026}`
    const lines = detectReportLines(facts({ warnings: [kept, `${kept}b`] }))

    expect(lines).toContain(`Warning: ${kept}`)
    expect(lines).toContain(`Warning: ${cut}`)
  })

  test('a warning with a bidi override and a line break is cleaned to one line', () => {
    const lines = detectReportLines(facts({ warnings: ['could not read\u{202E} settings\nfile'] }))

    expect(lines).toContain('Warning: could not read settingsfile')
    expect(lines.join('\n')).not.toMatch(CONTROL_OR_FORMAT)
  })
})

describe('report invariants', () => {
  test('rendering the same facts twice gives the same text', () => {
    const repo = thisRepo()

    expect(detectReportLines(repo).join('\n')).toBe(detectReportLines(repo).join('\n'))
  })

  test('for every fixture the choice line is the only Adapter line, and it is the last line', () => {
    const fixtures = [
      thisRepo(),
      facts({}),
      facts({ repoEntries: [entry('_bmad')], gsd: [provenGsd('~/.claude/gsd-core')] }),
      facts({ repoEntries: [entry('aidlc')] }),
      facts({ warnings: ['could not read project settings'] }),
      facts({ hookScripts: [hook('gsd-context-monitor.js')] }),
    ]
    for (const fixture of fixtures) {
      const lines = detectReportLines(fixture)
      const adapterLines = lines.filter(line => line.startsWith('Adapter:'))

      expect(adapterLines.length).toBe(1)
      expect(lines.slice(-1)).toEqual(adapterLines)
    }
  })

  test('an empty repo shows every framework row as not found and the built-in choice line', () => {
    const lines = detectReportLines(facts({}))

    expect(lines.slice(3, 8).map(line => line.slice(14, 27).trim())).toEqual([
      'not found',
      'not found',
      'not found',
      'not found',
      'not found',
    ])
    expect(lines.slice(-1)).toEqual([
      'Adapter: none (built-in); nothing detected, init will recommend GSD or superpowers',
    ])
  })
})

/** The three adapter headers, in the order the contract view shows them. */
const ADAPTER_HEADERS = ['GSD (gsd)', 'superpowers (superpowers)', 'built-in (none)']

/** The labels every adapter block shows exactly once, one per contract field (D-09). */
const BLOCK_LABELS = [
  '  detect:',
  '  start work:',
  '  spec files:',
  '  plan files:',
  '  verify:',
  '  done signal:',
  '  autonomy:',
  '  kickoff (example for role BE):',
  '  human gates:',
]

/**
 * The lines of one adapter block, from its header line to the line before the next adapter header. The last block runs
 * to the end of the report, and a header that is not in the report gives no lines.
 */
function blockOf(lines: readonly string[], header: string): string[] {
  const start = lines.indexOf(header)
  if (start === -1) return []
  const next = lines.findIndex((line, index) => index > start && ADAPTER_HEADERS.includes(line))

  return lines.slice(start, next === -1 ? lines.length : next)
}

describe('adaptersReportLines', () => {
  test('the three adapters appear in order: GSD, then superpowers, then the built-in fallback', () => {
    const lines = adaptersReportLines(ADAPTERS)

    expect(lines.filter(line => ADAPTER_HEADERS.includes(line))).toEqual(ADAPTER_HEADERS)
  })

  test('each adapter block shows every contract label exactly once', () => {
    const lines = adaptersReportLines(ADAPTERS)

    for (const header of ADAPTER_HEADERS) {
      const block = blockOf(lines, header)
      expect(block[0]).toBe(header)
      for (const label of BLOCK_LABELS) {
        expect(block.filter(line => line.startsWith(label)).length).toBe(1)
      }
    }
  })

  test('the labels run in contract order inside each block', () => {
    const lines = adaptersReportLines(ADAPTERS)

    for (const header of ADAPTER_HEADERS) {
      const block = blockOf(lines, header)
      const positions = BLOCK_LABELS.map(label => block.findIndex(line => line.startsWith(label)))
      expect(positions).toEqual([...positions].sort((a, b) => a - b))
    }
  })

  test('an empty kickoff example line renders as an empty line, and other lines keep the six-space indent', () => {
    const adapter: FrameworkAdapter = { ...BUILTIN_ADAPTER, kickoffText: () => 'first\n\nsecond' }
    const lines = adaptersReportLines([adapter])
    const start = lines.indexOf('  kickoff (example for role BE):')

    expect(lines.slice(start + 1, start + 4)).toEqual(['      first', '', '      second'])
  })

  test('an empty adapter list gives no lines', () => {
    expect(adaptersReportLines([])).toEqual([])
  })

  test('the GSD gate table has its header, and the accept-risk gate is a Security gate that needs a human', () => {
    const block = blockOf(adaptersReportLines(ADAPTERS), 'GSD (gsd)')
    const row = block.find(line => line.startsWith('    secure-phase-accept-risk'))
    const gate = GSD_GATES.find(entry => entry.id === 'secure-phase-accept-risk')

    expect(block).toContain(`    ${pad('gate', 28)}${pad('type', 15)}${pad('human?', 8)}how the kickoff handles it`)
    expect(row?.slice(32, 47).trim()).toBe('Security')
    expect(row?.slice(47, 55).trim()).toBe('yes')
    expect(row?.slice(55)).toBe(gate?.kickoff)
  })

  test('a standing-rule gate shows the type standing rule and no human', () => {
    const block = blockOf(adaptersReportLines(ADAPTERS), 'superpowers (superpowers)')
    const row = block.find(line => line.startsWith('    worktree-consent'))

    expect(row?.slice(32, 47).trim()).toBe('standing rule')
    expect(row?.slice(47, 55).trim()).toBe('no')
  })

  test('the GSD autonomy lines include mode -> yolo as required', () => {
    const block = blockOf(adaptersReportLines(ADAPTERS), 'GSD (gsd)')

    expect(block.some(line => line.includes('mode -> yolo (required)'))).toBe(true)
  })

  test('the superpowers autonomy line shows its autonomy note, since it declares no settings', () => {
    const block = blockOf(adaptersReportLines(ADAPTERS), 'superpowers (superpowers)')

    expect(block).toContain(`    ${SUPERPOWERS_ADAPTER.autonomyNote}`)
  })

  test('every line of an adapter kickoff appears in its block, indented by six spaces', () => {
    const lines = adaptersReportLines(ADAPTERS)

    for (const adapter of ADAPTERS) {
      const block = blockOf(lines, `${adapter.name} (${adapter.id})`)
      for (const line of adapter.kickoffText({ title: 'BE', roleId: 'be', specPath: null }).split('\n')) {
        expect(block).toContain(`      ${line}`)
      }
    }
  })

  test('the built-in kickoff example names the role by its title, BE, and its paths by the id, be', () => {
    const block = blockOf(adaptersReportLines(ADAPTERS), 'built-in (none)')

    expect(block).toContain(
      '      You are the BE role. This repo has no dev framework: work in plan, execute, verify steps.',
    )
    expect(block).toContain('      Write your plan to .cadre/be/.runtime/plan.md, then execute it with subagents.')
  })
})

/** A side-pane block of this kind, titled with its key, holding these lines (by default one line named after it). */
function paneBlock(key: PaneKey, lines: readonly string[] = [`${key} line`]): ShownBlock {
  return { key, title: key, lines }
}

describe('paneView', () => {
  test('a new block goes first and the other blocks keep their order', () => {
    const scan = paneBlock('scan')
    const history = paneBlock('history')
    const roles = paneBlock('roles')
    expect(paneView([scan, history], roles)).toEqual([roles, scan, history])
  })

  test('a block shown again replaces the block of its key and moves to the top', () => {
    const roles = paneBlock('roles')
    const scan2 = paneBlock('scan', ['Repo scan (read-only):', '  stack: TypeScript'])
    expect(paneView([roles, paneBlock('scan')], scan2)).toEqual([scan2, roles])
    expect(paneView([], scan2)).toEqual([scan2])
  })

  test('it never changes the blocks it is given', () => {
    const blocks = [paneBlock('roles'), paneBlock('scan')]
    const before = JSON.stringify(blocks)
    paneView(blocks, paneBlock('roles', ['changed']))
    expect(JSON.stringify(blocks)).toBe(before)
  })

  test('a notes block shown again keeps the old notes before its own lines and goes first (S1)', () => {
    const notesA = paneBlock('notes', ['note 1'])
    const notesB = paneBlock('notes', ['note 2'])
    const scan = paneBlock('scan')
    const blocks = [notesA, scan]
    const before = JSON.stringify(blocks)
    const merged = { key: 'notes', title: notesB.title, lines: [...notesA.lines, ...notesB.lines] }
    expect(paneView(blocks, notesB)).toEqual([merged, scan])
    expect(JSON.stringify(blocks)).toBe(before)
  })

  test('the first notes block goes first, as any new block does (S1)', () => {
    const notesA = paneBlock('notes', ['note 1'])
    const scan = paneBlock('scan')
    expect(paneView([scan], notesA)).toEqual([notesA, scan])
  })

  test('a block of another key still replaces its own and moves to the top, above the notes (S1)', () => {
    const notesA = paneBlock('notes', ['note 1'])
    const scan = paneBlock('scan')
    const roles2 = paneBlock('roles', ['changed'])
    expect(paneView([notesA, paneBlock('roles'), scan], roles2)).toEqual([roles2, notesA, scan])
  })
})

describe('paneRows', () => {
  test('a block gives its title row, then one row per line', () => {
    expect(paneRows([{ key: 'scan', title: 'Scan', lines: ['Repo scan (read-only):', '  stack: none'] }])).toEqual([
      { text: 'Scan', isTitle: true },
      { text: 'Repo scan (read-only):', isTitle: false },
      { text: '  stack: none', isTitle: false },
    ])
  })

  test('one empty row parts two blocks, none comes after the last, and no blocks give no rows', () => {
    expect(paneRows([paneBlock('review', ['a']), paneBlock('scan', ['b'])])).toEqual([
      { text: 'review', isTitle: true },
      { text: 'a', isTitle: false },
      { text: '', isTitle: false },
      { text: 'scan', isTitle: true },
      { text: 'b', isTitle: false },
    ])
    expect(paneRows([])).toEqual([])
  })

  test('every title and line is cleaned as a report cell, so none can add a row or hide text (T-02-48)', () => {
    const bell = String.fromCharCode(7)
    const long = 'x'.repeat(300)
    const rows = paneRows([{ key: 'scan', title: `Sc\nan${BIDI_OVERRIDE}`, lines: [`a\nb${bell}`, long] }])
    expect(rows.map(row => row.text)).toEqual(['Scan', 'ab', reportText(long)])
    expect(rows.filter(row => CONTROL_OR_FORMAT.test(row.text) || row.text.includes('\n'))).toEqual([])
    expect(Array.from(rows[2]?.text ?? '')).toHaveLength(240)
  })
})

/** A pane row that is not a title, as paneRows gives every line of a block. */
function lineRow(text: string): PaneRow {
  return { text, isTitle: false }
}

/** Whether a span has a look of its own: a colour, bold or dim. */
function isStyled(span: PaneSpan): boolean {
  return span.color !== undefined || span.bold === true || span.dim === true
}

/**
 * The styled spans of a line row and the text all its spans join to, so a test pins the looks and the join without
 * depending on how the plain text between the styled spans is split.
 */
function looksOf(text: string): { readonly styled: PaneSpan[]; readonly joined: string } {
  const spans = paneSpans(lineRow(text))

  return { styled: spans.filter(isStyled), joined: spans.map(span => span.text).join('') }
}

/** Every row the paneSpans tests use, for the invariants that hold over all of them (D1). */
const SPAN_ROWS: readonly string[] = [
  '',
  'Review',
  '    [hard] edits only src/',
  '    [best-effort] asks before a push',
  '    [none] reads anything',
  '    [none]',
  '    [hard]x',
  '  create    .cadre/be/ROLE.md',
  '  change    .claude/settings.json',
  '  conflict  .cadre/fe/ROLE.md',
  '  leave     .cadre/pm/ROLE.md',
  '  hunk      x',
  '  create .cadre/x',
  '  stack: ts; frontend: react; backend: none',
  '  framework: GSD; model: opus + high; permission mode: default',
  '  hooks loaded by project settings: none',
  `${'a'.repeat(40)}: x`,
  `${'a'.repeat(41)}: x`,
  'Summary: 3 create, 1 change, 2 leave, 0 conflict, 0 hunks',
  'Summary: 12 create, 0 change, 0 leave, 0 conflict, 2 hunks (1 accepted)',
  '    recommended: be, fe',
  '    recommended: none',
  '    used 3 times; recommended: be',
  'Scope card: Backend (be)',
  'Roles:',
  'Repo scan (read-only):',
  '- tool for BE: why',
  '+ added line',
  'The model gave no usable recommendation: no role gets a skill unless you pick one.',
]

describe('paneSpans (D1)', () => {
  test('a title row is one bold span in the claude colour, whatever its text; an empty row has none', () => {
    expect(paneSpans({ text: 'Review', isTitle: true })).toEqual([{ text: 'Review', color: 'claude', bold: true }])
    expect(paneSpans({ text: 'Summary: 3', isTitle: true })).toEqual([
      { text: 'Summary: 3', color: 'claude', bold: true },
    ])
    expect(paneSpans(lineRow(''))).toEqual([])
  })

  test('a rule marker is success for hard, warning for best-effort and error for none, the rest plain', () => {
    expect(paneSpans(lineRow('    [hard] edits only src/'))).toEqual([
      { text: '    ' },
      { text: '[hard]', color: 'success' },
      { text: ' edits only src/' },
    ])
    expect(looksOf('    [best-effort] asks before a push')).toEqual({
      styled: [{ text: '[best-effort]', color: 'warning' }],
      joined: '    [best-effort] asks before a push',
    })
    expect(looksOf('    [none] reads anything').styled).toEqual([{ text: '[none]', color: 'error' }])
    expect(paneSpans(lineRow('    [none]'))).toEqual([{ text: '    ' }, { text: '[none]', color: 'error' }])
    expect(paneSpans(lineRow('    [hard]x'))).toEqual([{ text: '    [hard]x' }])
  })

  test('a plan op row colours only its kind: create, change, conflict and leave', () => {
    expect(paneSpans(lineRow('  create    .cadre/be/ROLE.md'))).toEqual([
      { text: '  ' },
      { text: 'create', color: 'success' },
      { text: '    .cadre/be/ROLE.md' },
    ])
    expect(looksOf('  change    .claude/settings.json')).toEqual({
      styled: [{ text: 'change', color: 'warning' }],
      joined: '  change    .claude/settings.json',
    })
    expect(looksOf('  conflict  .cadre/fe/ROLE.md').styled).toEqual([{ text: 'conflict', color: 'error' }])
    expect(looksOf('  leave     .cadre/pm/ROLE.md').styled).toEqual([{ text: 'leave', dim: true }])
  })

  test('a hunk row and a kind not padded to the plan column get no op span', () => {
    expect(looksOf('  hunk      x').styled).toEqual([])
    expect(looksOf('  create .cadre/x').styled).toEqual([])
  })

  test('each field of a row has its label dim and its value plain', () => {
    expect(looksOf('  stack: ts; frontend: react; backend: none')).toEqual({
      styled: [
        { text: 'stack:', dim: true },
        { text: 'frontend:', dim: true },
        { text: 'backend:', dim: true },
      ],
      joined: '  stack: ts; frontend: react; backend: none',
    })
    expect(looksOf('  framework: GSD; model: opus + high; permission mode: default').styled).toEqual([
      { text: 'framework:', dim: true },
      { text: 'model:', dim: true },
      { text: 'permission mode:', dim: true },
    ])
    expect(looksOf('  hooks loaded by project settings: none').styled).toEqual([
      { text: 'hooks loaded by project settings:', dim: true },
    ])
  })

  test('a label has at most 40 code points', () => {
    expect(looksOf(`${'a'.repeat(40)}: x`).styled).toEqual([{ text: `${'a'.repeat(40)}:`, dim: true }])
    expect(paneSpans(lineRow(`${'a'.repeat(41)}: x`))).toEqual([{ text: `${'a'.repeat(41)}: x` }])
  })

  test('the summary has its label dim and each run of digits bold', () => {
    expect(looksOf('Summary: 3 create, 1 change, 2 leave, 0 conflict, 0 hunks')).toEqual({
      styled: [
        { text: 'Summary:', dim: true },
        { text: '3', bold: true },
        { text: '1', bold: true },
        { text: '2', bold: true },
        { text: '0', bold: true },
        { text: '0', bold: true },
      ],
      joined: 'Summary: 3 create, 1 change, 2 leave, 0 conflict, 0 hunks',
    })
    expect(looksOf('Summary: 12 create, 0 change, 0 leave, 0 conflict, 2 hunks (1 accepted)').styled).toEqual([
      { text: 'Summary:', dim: true },
      { text: '12', bold: true },
      { text: '0', bold: true },
      { text: '0', bold: true },
      { text: '0', bold: true },
      { text: '2', bold: true },
      { text: '1', bold: true },
    ])
  })

  test('the roles after recommended: are bold unless none, and so is the title of a scope card', () => {
    expect(looksOf('    recommended: be, fe')).toEqual({
      styled: [
        { text: 'recommended:', dim: true },
        { text: 'be, fe', bold: true },
      ],
      joined: '    recommended: be, fe',
    })
    expect(looksOf('    recommended: none').styled).toEqual([{ text: 'recommended:', dim: true }])
    expect(looksOf('    used 3 times; recommended: be')).toEqual({
      styled: [
        { text: 'recommended:', dim: true },
        { text: 'be', bold: true },
      ],
      joined: '    used 3 times; recommended: be',
    })
    expect(looksOf('Scope card: Backend (be)').styled).toEqual([
      { text: 'Scope card:', dim: true },
      { text: 'Backend (be)', bold: true },
    ])
  })

  test('a row whose colon follows no label is one plain span', () => {
    const rows = [
      'Roles:',
      'Repo scan (read-only):',
      '- tool for BE: why',
      '+ added line',
      'The model gave no usable recommendation: no role gets a skill unless you pick one.',
    ]
    for (const text of rows) expect(paneSpans(lineRow(text))).toEqual([{ text }])
  })

  test('the spans of every row join to its text, none is empty, and no row is dim as a whole', () => {
    for (const text of SPAN_ROWS) {
      for (const isTitle of [false, true]) {
        const spans = paneSpans({ text, isTitle })
        expect(spans.map(span => span.text).join('')).toBe(text)
        expect(spans.filter(span => span.text === '')).toEqual([])
        expect(spans.filter(span => span.dim === true && span.text === text)).toEqual([])
      }
    }
  })
})

describe('detectText', () => {
  test('without the flag it is the report alone, and with it the contract follows after a blank line', () => {
    const repo = thisRepo()
    const withContract = [
      ...detectReportLines(repo),
      '',
      'Adapter contract (the same fields for every adapter):',
      ...adaptersReportLines(ADAPTERS),
    ]

    expect(detectText(repo, false)).toBe(detectReportLines(repo).join('\n'))
    expect(detectText(repo, true)).toBe(withContract.join('\n'))
  })
})

/** The lines of a text, numbered from `from`: `line <n>`, each ended by a line end. */
function numberedLines(count: number, from = 1): string {
  return Array.from({ length: count }, (_, at) => `line ${from + at}\n`).join('')
}

describe('lineDiff', () => {
  test('equal texts give no rows and no counts', () => {
    expect(lineDiff('a\nb\n', 'a\nb\n')).toEqual({ rows: [], added: 0, removed: 0 })
    expect(lineDiff('', '')).toEqual({ rows: [], added: 0, removed: 0 })
  })

  test('a line added or removed gives one row with its count', () => {
    expect(lineDiff('a\nc\n', 'a\nb\nc\n')).toEqual({ rows: [{ kind: 'added', line: 'b' }], added: 1, removed: 0 })
    expect(lineDiff('a\nb\nc\n', 'a\nc\n')).toEqual({ rows: [{ kind: 'removed', line: 'b' }], added: 0, removed: 1 })
  })

  test('a changed line is removed, then added, in text order, around the lines both texts keep', () => {
    expect(lineDiff('h\na\nb\nc\nd\n', 'h\na\nB\nc\nd\ne\n')).toEqual({
      rows: [
        { kind: 'removed', line: 'b' },
        { kind: 'added', line: 'B' },
        { kind: 'added', line: 'e' },
      ],
      added: 2,
      removed: 1,
    })
  })

  test('the longest run of common lines is kept: a moved line is removed where it was and added where it is', () => {
    expect(lineDiff('x\na\nb\nc\n', 'a\nb\nc\nx\n')).toEqual({
      rows: [
        { kind: 'removed', line: 'x' },
        { kind: 'added', line: 'x' },
      ],
      added: 1,
      removed: 1,
    })
  })

  test('texts that differ only in their last line end still give a row', () => {
    expect(lineDiff('a', 'a\n')).toEqual({ rows: [{ kind: 'added', line: '' }], added: 1, removed: 0 })
    expect(lineDiff('a\n', 'a')).toEqual({ rows: [{ kind: 'removed', line: '' }], added: 0, removed: 1 })
  })

  test('one change in a long text gives just that change: the common start and end are not compared', () => {
    const before = numberedLines(5000)
    const after = before.replace('line 2500\n', 'line 2500 changed\n')
    expect(lineDiff(before, after)).toEqual({
      rows: [
        { kind: 'removed', line: 'line 2500' },
        { kind: 'added', line: 'line 2500 changed' },
      ],
      added: 1,
      removed: 1,
    })
  })

  test('two long texts with nothing in common count every line once, the removed ones first', () => {
    const diff = lineDiff(numberedLines(1500), numberedLines(1500, 2001))
    expect([diff.added, diff.removed, diff.rows.length]).toEqual([1500, 1500, 3000])
    expect(diff.rows.slice(0, 1500).every(row => row.kind === 'removed')).toBe(true)
    expect(diff.rows.slice(1500).every(row => row.kind === 'added')).toBe(true)
    expect([diff.rows[0], diff.rows[1500]]).toEqual([
      { kind: 'removed', line: 'line 1' },
      { kind: 'added', line: 'line 2001' },
    ])
  })

  test('past a million compared line pairs the differing middle counts as removed, then added (T-02-77)', () => {
    const xs = Array.from({ length: 1100 }, (_, at) => `x${at}\n`).join('')
    const ys = Array.from({ length: 1100 }, (_, at) => `y${at}\n`).join('')
    const huge = lineDiff(`${xs}c\n`, `c\n${ys}`)
    expect([huge.removed, huge.added, huge.rows.at(1100), huge.rows.at(1101)]).toEqual([
      1101,
      1101,
      { kind: 'removed', line: 'c' },
      { kind: 'added', line: 'c' },
    ])
    expect(lineDiff('x0\nc\n', 'c\ny0\n')).toEqual({
      rows: [
        { kind: 'removed', line: 'x0' },
        { kind: 'added', line: 'y0' },
      ],
      added: 1,
      removed: 1,
    })
  })
})

describe('diffLines', () => {
  test('each added line is a + row and each removed one a - row, cleaned as a report cell', () => {
    const bell = String.fromCharCode(7)
    const diff = lineDiff(`keep\nold${BIDI_OVERRIDE}\n`, `keep\nnew${bell}\n${'x'.repeat(300)}\n`)
    expect(diffLines(diff)).toEqual(['- old', '+ new', `+ ${reportText('x'.repeat(300))}`])
    expect(diffLines(lineDiff('a\n', 'a\n'))).toEqual([])
  })

  test('past 200 rows the first 200 are shown, then how many more changed lines there are', () => {
    const many = diffLines(lineDiff('', numberedLines(205)))
    expect(many).toHaveLength(201)
    expect(many.slice(0, 2)).toEqual(['+ line 1', '+ line 2'])
    expect(many.at(-1)).toBe('... 5 more changed lines')
    expect(diffLines(lineDiff('', numberedLines(201))).at(-1)).toBe('... 1 more changed line')
    expect(diffLines(lineDiff('', numberedLines(200)))).toHaveLength(200)
  })
})
