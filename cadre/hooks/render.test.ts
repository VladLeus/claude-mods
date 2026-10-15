import { describe, expect, test } from 'claude-code/testing'

import type { Choice, Facts, GsdFact, RepoEntry } from '../types'
import { detectAll } from './adapters'
import { choiceLine, detectReportLines, pad, STATUS_LABEL } from './render'

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
