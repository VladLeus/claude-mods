import { describe, expect, test } from 'claude-code/testing'

import type { Choice, Facts, FrameworkAdapter, GsdFact, HookScript, RepoEntry } from '../types'
import { ADAPTERS, detectAll } from './adapters'
import { BUILTIN_ADAPTER } from './builtin'
import { GSD_GATES } from './gsd'
import { adaptersReportLines, choiceLine, detectReportLines, detectText, pad, STATUS_LABEL } from './render'
import { SUPERPOWERS_ADAPTER } from './superpowers'

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
      for (const line of adapter.kickoffText({ role: 'BE', roleId: 'be', specPath: null }).split('\n')) {
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
