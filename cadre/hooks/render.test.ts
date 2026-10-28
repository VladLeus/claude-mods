import { describe, expect, test } from 'claude-code/testing'

import type { Choice, Facts, FrameworkAdapter, GsdFact, HookScript, PaneKey, RepoEntry, ShownBlock } from '../types'
import { isObject } from './core/json'
import { pad, reportText } from './core/text'
import { GSD_GATES } from './framework/gsd/adapter'
import { BUILTIN_ADAPTER } from './framework/none/adapter'
import { ADAPTERS, detectAll } from './framework/registry'
import { SUPERPOWERS_ADAPTER } from './framework/superpowers/adapter'
import {
  adaptersReportLines,
  answersFromNotes,
  askedHeader,
  askRewrite,
  choiceLine,
  detectReportLines,
  detectText,
  diffLines,
  headerTopic,
  lineDiff,
  MAX_PREVIEW_CHARS,
  OWN_ANSWER_HINT,
  panePlacement,
  paneRows,
  paneSpans,
  paneView,
  PREVIEW_BLOCKS,
  previewBlockFor,
  previewMarkdown,
  STATUS_LABEL,
  withDescribeOwn,
  withPreviews,
} from './render'
import type { AskedQuestion, CheckedQuestion, PaneRow, PaneSpan } from './render'
import { BIDI_OVERRIDE } from './testkit'
import { ASK_HEADERS, countedChip, PANE_TITLES } from './ui/ask'

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

describe('panePlacement (D3)', () => {
  test('the placement is read only when it is dock or inline', () => {
    expect(panePlacement({ placement: 'inline' })).toBe('inline')
    expect(panePlacement({ placement: 'dock' })).toBe('dock')
    for (const props of [{}, null, undefined, 'x', { placement: 3 }, { placement: 'Inline' }]) {
      expect(panePlacement(props)).toBe(null)
    }
  })
})

/** A block of the side pane with this key, title and lines, for the preview tests (D3). */
function shownBlock(key: PaneKey, title: string, lines: readonly string[]): ShownBlock {
  return { key, title, lines }
}

/** Whether a preview line is one of its fences: three or more backticks and nothing else. */
function isFence(line: string): boolean {
  return /^`{3,}$/.test(line)
}

/** `count` lines of 99 characters, each its own, for the cut tests: `<tag> <n>` padded with x. */
function longLines(tag: string, count: number): string[] {
  return Array.from({ length: count }, (_, at) => `${tag} ${at}`.padEnd(99, 'x'))
}

describe('previewMarkdown (D3)', () => {
  test('no blocks give no preview', () => {
    expect(previewMarkdown([])).toBe('')
  })

  test('each block is its bold title and its lines in a fence, in the given order, a blank line between', () => {
    const blocks = [
      shownBlock('review', 'Review', ['Roles:', '  BE (be)']),
      shownBlock('scan', 'Scan', ['  stack: ts']),
    ]
    expect(previewMarkdown(blocks).split('\n')).toEqual([
      '**Review**',
      '```',
      'Roles:',
      '  BE (be)',
      '```',
      '',
      '**Scan**',
      '```',
      '  stack: ts',
      '```',
    ])
  })

  test('a fence is one backtick longer than the longest backtick run of its block, and at least three', () => {
    const blocks = [
      shownBlock('scan', 'Scan', ['run ``` here', 'and `` there']),
      shownBlock('roles', 'Roles', ['two `` only']),
    ]
    expect(previewMarkdown(blocks).split('\n')).toEqual([
      '**Scan**',
      '````',
      'run ``` here',
      'and `` there',
      '````',
      '',
      '**Roles**',
      '```',
      'two `` only',
      '```',
    ])
  })

  test('a title has its markdown characters escaped with a backslash', () => {
    const title = 'a*b_c`d[e]f<g>h#i\\j~k|l'
    expect(previewMarkdown([shownBlock('scan', title, ['x'])]).split('\n')[0]).toBe(
      '**a\\*b\\_c\\`d\\[e\\]f\\<g\\>h\\#i\\\\j\\~k\\|l**',
    )
  })

  test('control characters in a title or a line are removed, so neither can add a line', () => {
    const bell = String.fromCharCode(7)
    const block = shownBlock('scan', `Sc\nan${BIDI_OVERRIDE}`, [`a\nb${bell}`, '  c'])
    expect(previewMarkdown([block]).split('\n')).toEqual(['**Scan**', '```', 'ab', '  c', '```'])
  })

  test('past the cap the preview is cut after a whole line, its fence closed, and ends with a … line', () => {
    const lines = longLines('review', 30)
    const preview = previewMarkdown([shownBlock('review', 'Review', lines), shownBlock('scan', 'Scan', ['x'])])
    const rows = preview.split('\n')
    expect(preview.length).toBeLessThanOrEqual(MAX_PREVIEW_CHARS)
    expect(rows.slice(-2)).toEqual(['```', '…'])
    expect(rows.filter(isFence)).toHaveLength(2)
    const kept = rows.slice(2, -2)
    expect(kept.length > 0 && kept.length < lines.length).toBe(true)
    expect(kept).toEqual(lines.slice(0, kept.length))
    expect(rows).not.toContain('**Scan**')
  })

  test('a block whose first line does not fit is left out with its title, after the closed block before it', () => {
    const lines = longLines('review', 18)
    const blocks = [shownBlock('review', 'Review', lines), shownBlock('scan', 'Scan', longLines('scan', 1))]
    const preview = previewMarkdown(blocks)
    expect(preview.length).toBeLessThanOrEqual(MAX_PREVIEW_CHARS)
    expect(preview.split('\n')).toEqual(['**Review**', '```', ...lines, '```', '…'])
  })

  test('every opened fence is closed and the preview stays under the cap, however many blocks there are', () => {
    const keys: PaneKey[] = ['scan', 'history', 'roles', 'recommendations', 'review', 'env', 'notes']
    const blocks = keys.map(key => shownBlock(key, key, longLines(key, 9)))
    const preview = previewMarkdown(blocks)
    const rows = preview.split('\n')
    expect(preview.length).toBeLessThanOrEqual(MAX_PREVIEW_CHARS)
    expect(rows.filter(isFence).length % 2).toBe(0)
    expect(rows.at(-1)).toBe('…')
    const kept = rows.filter(row => !isFence(row) && row !== '' && row !== '…' && !row.startsWith('**'))
    expect(kept).toEqual(blocks.flatMap(block => block.lines).slice(0, kept.length))
  })
})

describe('headerTopic (B1)', () => {
  test('one counted suffix at the very end is stripped: i/n, or i of n as the hunk chip counts', () => {
    expect(headerTopic('Skill 3/7')).toBe('Skill')
    expect(headerTopic('Hunk 2 of 5')).toBe('Hunk')
    expect(headerTopic('Topic 10/12')).toBe('Topic')
  })

  test('a header with no counted suffix at its very end is kept as it is', () => {
    expect(headerTopic('Launch dir')).toBe('Launch dir')
    expect(headerTopic('Roles')).toBe('Roles')
    expect(headerTopic('v 2/3x')).toBe('v 2/3x')
  })

  test('a counted chip gives its word, and a chip too long to count is its bare word (countedChip)', () => {
    expect(headerTopic(countedChip('Memory', 2, 4))).toBe('Memory')
    expect(countedChip('Instructions', 1, 2)).toBe('Instructions')
    expect(headerTopic(countedChip('Instructions', 1, 2))).toBe('Instructions')
  })
})

describe('PREVIEW_BLOCKS (B1)', () => {
  test('the table and each of its lists are frozen, and each list holds one pane key or more', () => {
    const paneKeys: readonly string[] = Object.keys(PANE_TITLES)
    expect(Object.isFrozen(PREVIEW_BLOCKS)).toBe(true)
    for (const [topic, keys] of Object.entries(PREVIEW_BLOCKS)) {
      const isPaneKeys = keys.length > 0 && keys.every(key => paneKeys.includes(key))
      expect([topic, Object.isFrozen(keys), isPaneKeys]).toEqual([topic, true, true])
    }
  })

  test('every ASK_HEADERS chip is a topic but claude.json and Git policy; Skill, Topic, Regen are, Hunk is not', () => {
    const unmapped = Object.values(ASK_HEADERS).filter(header => !Object.hasOwn(PREVIEW_BLOCKS, header))
    expect(unmapped).toEqual(['claude.json', 'Git policy'])
    for (const topic of ['Skill', 'Topic', 'Regen']) expect(Object.hasOwn(PREVIEW_BLOCKS, topic)).toBe(true)
    expect(Object.hasOwn(PREVIEW_BLOCKS, 'Hunk')).toBe(false)
  })

  test('each topic lists the blocks its question is asked after, as the user locked them (B1)', () => {
    expect(PREVIEW_BLOCKS).toEqual({
      History: ['scan'],
      Roles: ['roles'],
      Adjust: ['roles'],
      Describe: ['roles'],
      Framework: ['roles'],
      Duration: ['roles'],
      Model: ['roles'],
      Launch: ['roles'],
      'Launch dir': ['roles'],
      Security: ['recommendations'],
      MCP: ['recommendations'],
      Skills: ['recommendations'],
      Skill: ['skills'],
      Instructions: ['instructions'],
      Topic: ['instructions'],
      Memory: ['instructions'],
      Regen: ['instructions'],
      Env: ['env'],
      Review: ['review'],
      Conflict: ['review'],
      Improver: ['improver', 'instructions'],
    })
  })
})

describe('previewBlockFor (B1)', () => {
  /** A pane of blocks with these keys, newest first, each titled by its key. */
  function paneOf(...keys: readonly PaneKey[]): ShownBlock[] {
    return keys.map(key => shownBlock(key, key, [`${key} line`]))
  }

  test('no blocks give none', () => {
    expect(previewBlockFor('Roles', [])).toEqual([])
  })

  test('a mapped header gives its block, wherever the pane holds it', () => {
    const pane = paneOf('review', 'roles', 'scan')
    expect(previewBlockFor('Roles', pane)).toEqual([pane[1]])
    const skills = paneOf('review', 'skills')
    expect(previewBlockFor('Skill 2/5', skills)).toEqual([skills[1]])
  })

  test('the improver question gives the improver block, else the instruction parts', () => {
    for (const pane of [paneOf('improver', 'instructions'), paneOf('instructions', 'improver')]) {
      expect(previewBlockFor('Improver', pane)).toEqual(pane.filter(block => block.key === 'improver'))
    }
    const parts = paneOf('review', 'instructions')
    expect(previewBlockFor('Improver', parts)).toEqual([parts[1]])
  })

  test('the newest block stands in for a header with no block in the pane, no key of its own, or no text', () => {
    const pane = paneOf('review', 'roles')
    for (const header of ['Env', 'Git policy', 3, undefined, '__proto__', 'constructor']) {
      expect(previewBlockFor(header, pane)).toEqual([pane[0]])
    }
  })
})

describe('askedHeader (R1)', () => {
  test('the header of the first question of the call', () => {
    expect(askedHeader([{ question: 'Q?', header: 'Roles', options: [] }])).toBe('Roles')
    const two = [
      { question: 'Q?', header: 'Roles', options: [] },
      { question: 'Next?', header: 'Env', options: [] },
    ]
    expect(askedHeader(two)).toBe('Roles')
  })

  test('no string header on the first question, or no list of questions, gives null', () => {
    const none: unknown[] = [
      [{ question: 'Q?', options: [] }],
      [{ question: 'Q?', header: 3, options: [] }],
      [null, { question: 'Next?', header: 'Env', options: [] }],
      [],
      'x',
      null,
      undefined,
    ]
    for (const questions of none) expect(askedHeader(questions)).toBe(null)
  })
})

/** One single-select AskUserQuestion question with two options and no preview, as a model asks it (D3). */
const PICK_QUESTION = {
  question: 'Pick one?',
  header: 'Pick',
  multiSelect: false,
  options: [
    { label: 'A', description: 'a' },
    { label: 'B', description: 'b' },
  ],
}

/** Questions whose shape withPreviews cannot check (D3, A1): a call that asks them passes through unchanged. */
const UNCHECKED_QUESTIONS: readonly unknown[] = [
  'x',
  {},
  null,
  undefined,
  [],
  ['x'],
  [null],
  [[]],
  [{ options: [{ label: 'A' }] }],
  [{ question: 3, options: [{ label: 'A' }] }],
  [{ question: 'Q?' }],
  [{ question: 'Q?', options: 'A' }],
  [{ question: 'Q?', options: [] }],
  [{ question: 'Q?', options: ['A'] }],
  [{ question: 'Q?', options: [null] }],
  [{ question: 'Q?', options: [{ description: 'a' }] }],
  [{ question: 'Q?', options: [{ label: 3 }] }],
  [PICK_QUESTION, { question: 'Q?', options: [] }],
]

/** PICK_QUESTION with these options after its A and B, each described by its label in lower case (A2). */
function pickWith(...labels: readonly string[]): CheckedQuestion {
  const more = labels.map(label => ({ label, description: label.toLowerCase() }))

  return { ...PICK_QUESTION, options: [...PICK_QUESTION.options, ...more] }
}

describe('withPreviews (D3)', () => {
  test('each option of a single-select question gets the preview, every other field kept, the input unchanged', () => {
    const questions = [PICK_QUESTION, { question: 'Next?', options: [{ label: 'C' }] }]
    const before = JSON.stringify(questions)
    const result = withPreviews(questions, () => 'P')
    expect(result).toEqual([
      {
        question: 'Pick one?',
        header: 'Pick',
        multiSelect: false,
        options: [
          { label: 'A', description: 'a', preview: 'P' },
          { label: 'B', description: 'b', preview: 'P' },
        ],
      },
      { question: 'Next?', options: [{ label: 'C', preview: 'P' }] },
    ])
    expect(JSON.stringify(questions)).toBe(before)
    expect(result === questions || result?.[0] === questions[0]).toBe(false)
  })

  test('a shape it cannot check gives null, so the call passes through', () => {
    for (const questions of UNCHECKED_QUESTIONS) expect(withPreviews(questions, () => 'P')).toBe(null)
  })

  test('only multi-select questions give null; one among single-select ones is copied unchanged', () => {
    const multi = { ...PICK_QUESTION, question: 'Which?', multiSelect: true }
    expect(withPreviews([multi], () => 'P')).toBe(null)
    const result = withPreviews([PICK_QUESTION, multi], () => 'P')
    expect(result?.[1]).toEqual(multi)
    expect(result?.[1] === multi).toBe(false)
    expect(result?.[0]?.options).toEqual([
      { label: 'A', description: 'a', preview: 'P' },
      { label: 'B', description: 'b', preview: 'P' },
    ])
  })

  test('an option that has a preview of its own keeps it', () => {
    const questions = [{ question: 'Q?', options: [{ label: 'A', preview: 'mine' }, { label: 'B' }] }]
    expect(withPreviews(questions, () => 'P')).toEqual([
      {
        question: 'Q?',
        options: [
          { label: 'A', preview: 'mine' },
          { label: 'B', preview: 'P' },
        ],
      },
    ])
  })

  test('each single-select question gets the preview made for its own header, undefined when it has none', () => {
    const questions = [PICK_QUESTION, { question: 'Next?', options: [{ label: 'C' }] }]
    const result = withPreviews(questions, header => `P ${String(header)}`)
    expect(result?.map(question => question.options)).toEqual([
      [
        { label: 'A', description: 'a', preview: 'P Pick' },
        { label: 'B', description: 'b', preview: 'P Pick' },
      ],
      [{ label: 'C', preview: 'P undefined' }],
    ])
  })
})

describe('withDescribeOwn (A2)', () => {
  /** The option a question with room for it gets, with the preview 'P'. */
  const OWN_OPTION = {
    label: 'Describe your own',
    description: 'Press n, type your answer, then Enter',
    preview: 'P',
  }

  test('a question with 2 or 3 options gets one last option to type an own answer, and the hint line (R3)', () => {
    const hinted = `Pick one?\n${OWN_ANSWER_HINT}`
    expect(withDescribeOwn(PICK_QUESTION, 'P')).toEqual({
      question: hinted,
      header: 'Pick',
      multiSelect: false,
      options: [{ label: 'A', description: 'a' }, { label: 'B', description: 'b' }, OWN_OPTION],
    })
    const three = withDescribeOwn(pickWith('C'), 'P')
    expect(three).toEqual({ ...pickWith('C'), question: hinted, options: [...pickWith('C').options, OWN_OPTION] })
  })

  test('a question with 4 options keeps them and gets the hint line as the last line of its text', () => {
    const four = pickWith('C', 'D')
    const hinted = 'Pick one?\nOr press n, type your own answer, then Enter.'
    expect(withDescribeOwn(four, 'P')).toEqual({ ...four, question: hinted })
  })

  test('a question that already has a Describe your own option gets no other one, but the hint line (R3)', () => {
    const two = { ...PICK_QUESTION, options: [{ label: 'A' }, { label: 'Describe your own', description: 'mine' }] }
    for (const question of [two, pickWith('C', 'Describe your own')]) {
      expect(withDescribeOwn(question, 'P')).toEqual({ ...question, question: `Pick one?\n${OWN_ANSWER_HINT}` })
    }
  })

  test('a question whose text already ends with the hint line does not get it a second time (R3)', () => {
    const hinted = `Pick one?\n${OWN_ANSWER_HINT}`
    expect(withDescribeOwn({ ...PICK_QUESTION, question: hinted }, 'P').question).toBe(hinted)
    const four = { ...pickWith('C', 'D'), question: hinted }
    expect(withDescribeOwn(four, 'P')).toEqual(four)
  })

  test("every 'under Other' reads 'as a note (press n)', and the hint line follows (R4)", () => {
    const question = { ...PICK_QUESTION, question: 'Type ids under Other.' }
    expect(withDescribeOwn(question, 'P').question).toBe(`Type ids as a note (press n).\n${OWN_ANSWER_HINT}`)
    const twice = { ...PICK_QUESTION, question: 'Pick under Other, or type ids under Other.' }
    const both = `Pick as a note (press n), or type ids as a note (press n).\n${OWN_ANSWER_HINT}`
    expect(withDescribeOwn(twice, 'P').question).toBe(both)
    expect(withDescribeOwn(PICK_QUESTION, 'P').question).toBe(`Pick one?\n${OWN_ANSWER_HINT}`)
  })

  test('the question it is given is never changed, and the result is a new object', () => {
    const other = { ...PICK_QUESTION, question: 'Type ids under Other.' }
    for (const question of [pickWith('C'), pickWith('C', 'D'), pickWith('C', 'Describe your own'), other]) {
      const before = JSON.stringify(question)
      const result = withDescribeOwn(question, 'P')
      expect(JSON.stringify(question)).toBe(before)
      expect(result === question).toBe(false)
    }
  })
})

/** The preview of each option of each question a dialog would show; undefined where an option has none. */
function optionPreviews(questions: readonly Record<string, unknown>[] | undefined): unknown[][] {
  return (questions ?? []).map(question => {
    const options: unknown = question.options

    return Array.isArray(options) ? options.map(option => (isObject(option) ? option.preview : undefined)) : []
  })
}

describe('askRewrite (A1, A2, B1)', () => {
  /** A pane of one block, so a question's preview is that block whatever its header. */
  const BLOCKS = [shownBlock('review', 'Review', ['Roles:', '  BE (be)'])]

  test('no blocks give null, so the call passes through', () => {
    expect(askRewrite([PICK_QUESTION], [])).toBe(null)
  })

  test('a shape withPreviews cannot check gives null', () => {
    for (const questions of UNCHECKED_QUESTIONS) expect(askRewrite(questions, BLOCKS)).toBe(null)
  })

  test('only multi-select questions give null', () => {
    expect(askRewrite([{ ...PICK_QUESTION, multiSelect: true }], BLOCKS)).toBe(null)
  })

  test('a single-select question gets the preview on every option, Describe your own and the hint (R3)', () => {
    const questions = [PICK_QUESTION]
    const before = JSON.stringify(questions)
    const preview = previewMarkdown(BLOCKS)
    const hinted = `Pick one?\n${OWN_ANSWER_HINT}`
    const rewrite = askRewrite(questions, BLOCKS)
    expect(rewrite?.questions).toEqual([
      {
        ...PICK_QUESTION,
        question: hinted,
        options: [
          { label: 'A', description: 'a', preview },
          { label: 'B', description: 'b', preview },
          { label: 'Describe your own', description: 'Press n, type your answer, then Enter', preview },
        ],
      },
    ])
    expect(rewrite?.asked).toEqual([{ question: 'Pick one?', asked: hinted }])
    expect(JSON.stringify(questions)).toBe(before)
  })

  test('the asked entry of a 2-option question pairs its text as asked with the text shown (R3, R4)', () => {
    const shownText = `Type ids as a note (press n).\n${OWN_ANSWER_HINT}`
    const rewrite = askRewrite([{ ...PICK_QUESTION, question: 'Type ids under Other.' }], BLOCKS)
    expect(rewrite?.asked).toEqual([{ question: 'Type ids under Other.', asked: shownText }])
    expect(rewrite?.questions[0]?.question).toBe(shownText)
  })

  test('a 4-option question is asked with the hint line, and its asked entry pairs the two texts', () => {
    const hinted = 'Pick one?\nOr press n, type your own answer, then Enter.'
    const rewrite = askRewrite([pickWith('C', 'D')], BLOCKS)
    expect(rewrite?.asked).toEqual([{ question: 'Pick one?', asked: hinted }])
    expect(rewrite?.questions[0]?.question).toBe(hinted)
    expect(rewrite?.questions[0]?.options).toHaveLength(4)
  })

  test("a multi-select question among single-select ones is copied unchanged, 'under Other' kept, unasked", () => {
    const multi = { ...PICK_QUESTION, question: 'Which? Type more under Other.', multiSelect: true }
    const rewrite = askRewrite([PICK_QUESTION, multi], BLOCKS)
    expect(rewrite?.questions[1]).toEqual(multi)
    expect(rewrite?.questions[1] === multi).toBe(false)
    expect(rewrite?.asked).toEqual([{ question: 'Pick one?', asked: `Pick one?\n${OWN_ANSWER_HINT}` }])
  })

  test('each question gets the preview of the one block its header needs, Describe your own included (B1)', () => {
    const env = shownBlock('env', 'Env variables', ['  FOO'])
    const roles = shownBlock('roles', 'Roles', ['  BE (be)'])
    const questions = [
      { ...PICK_QUESTION, header: 'Roles' },
      { ...PICK_QUESTION, question: 'Carry?', header: 'Env' },
    ]
    const rolesPreview = previewMarkdown([roles])
    const envPreview = previewMarkdown([env])
    expect(optionPreviews(askRewrite(questions, [env, roles])?.questions)).toEqual([
      [rolesPreview, rolesPreview, rolesPreview],
      [envPreview, envPreview, envPreview],
    ])
  })
})

describe('answersFromNotes (A3)', () => {
  /** The one question these results answer, asked as the dialog showed it. */
  const ASKED: readonly AskedQuestion[] = [{ question: 'Q?', asked: 'Q?' }]

  /** A dialog result that answers Q? with `answer`, with `notes` typed for it when given. */
  function answered(answer: string, notes?: string): Record<string, unknown> {
    const result = { answers: { 'Q?': answer } }

    return notes === undefined ? result : { ...result, annotations: { 'Q?': { notes } } }
  }

  test('notes typed in the dialog are the answer, trimmed, whatever was chosen', () => {
    expect(answersFromNotes(ASKED, answered('A', '  my words  '))).toEqual({ 'Q?': 'my words' })
    expect(answersFromNotes(ASKED, answered('(notes only)', 'my words'))).toEqual({ 'Q?': 'my words' })
    expect(answersFromNotes(ASKED, answered('Describe your own', ' mine '))).toEqual({ 'Q?': 'mine' })
  })

  test('with blank or no notes the chosen answer stays, and Describe your own is an empty answer', () => {
    expect(answersFromNotes(ASKED, answered('B', '   '))).toEqual({ 'Q?': 'B' })
    expect(answersFromNotes(ASKED, answered('B'))).toEqual({ 'Q?': 'B' })
    expect(answersFromNotes(ASKED, answered('Describe your own'))).toEqual({ 'Q?': '' })
  })

  test('the answer is stored under the question as asked, and the text the dialog showed is dropped', () => {
    const asked = [{ question: 'Q?', asked: 'Q?\nhint' }]
    expect(answersFromNotes(asked, { answers: { 'Q?\nhint': 'C' } })).toEqual({ 'Q?': 'C' })
    const noted = { answers: { 'Q?\nhint': 'C' }, annotations: { 'Q?\nhint': { notes: 'mine' } } }
    expect(answersFromNotes(asked, noted)).toEqual({ 'Q?': 'mine' })
  })

  test("an answer to a question whose 'under Other' was rewritten is stored under the text as asked (R4)", () => {
    const shownText = `Type ids as a note (press n).\n${OWN_ANSWER_HINT}`
    const asked = [{ question: 'Type ids under Other.', asked: shownText }]
    expect(answersFromNotes(asked, { answers: { [shownText]: 'A' } })).toEqual({ 'Type ids under Other.': 'A' })
  })

  test('another question keeps its answer, and a question with no answer and no notes adds no key', () => {
    const both = { answers: { 'Q?': 'A', 'Other?': 'Describe your own' } }
    expect(answersFromNotes(ASKED, both)).toEqual({ 'Q?': 'A', 'Other?': 'Describe your own' })
    const other = answersFromNotes(ASKED, { answers: { 'Other?': 'X' } })
    expect(other === null ? null : Object.keys(other)).toEqual(['Other?'])
  })

  test('a malformed annotation counts as no notes, and only own keys are read', () => {
    for (const annotation of [null, { notes: 3 }, 'x']) {
      const result = { answers: { 'Q?': 'B' }, annotations: { 'Q?': annotation } }
      expect(answersFromNotes(ASKED, result)).toEqual({ 'Q?': 'B' })
    }
    const inherited = [
      { question: 'constructor', asked: 'constructor' },
      { question: 'toString', asked: 'toString' },
    ]
    const none = answersFromNotes(inherited, { answers: {}, annotations: {} })
    expect(none === null ? null : Object.keys(none)).toEqual([])
  })

  test('a result whose shape does not validate gives null', () => {
    const bad: unknown[] = [
      'x',
      null,
      {},
      { answers: 'x' },
      { answers: [] },
      { answers: { 'Q?': 3 } },
      { answers: {}, annotations: 'x' },
      { answers: {}, annotations: [] },
    ]
    for (const result of bad) expect(answersFromNotes(ASKED, result)).toBe(null)
  })

  test('the result it reads is never changed', () => {
    const result = { answers: { 'Q?\nhint': 'C', 'Other?': 'X' }, annotations: { 'Q?\nhint': { notes: ' mine ' } } }
    const before = JSON.stringify(result)
    const answers = answersFromNotes([{ question: 'Q?', asked: 'Q?\nhint' }], result)
    expect(answers).toEqual({ 'Other?': 'X', 'Q?': 'mine' })
    expect(JSON.stringify(result)).toBe(before)
    expect(answers === result.answers).toBe(false)
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
