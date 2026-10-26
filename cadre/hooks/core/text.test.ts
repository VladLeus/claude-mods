import { describe, expect, test } from 'claude-code/testing'

import { BIDI_OVERRIDE } from '../testkit'
import {
  asciiLower,
  cardList,
  clean,
  countedNoun,
  idLabel,
  idsOrNone,
  moreLine,
  pad,
  reportText,
  shown,
  sortedUnique,
  utf8Bytes,
} from './text'

describe('clean', () => {
  test('removes bidi and line-break characters, joining the text around them', () => {
    expect(clean('a\u202Eb\nc')).toBe('abc')
  })

  test('a value that is not a string becomes the empty string', () => {
    expect(clean(42)).toBe('')
  })

  test('a longer value is cut to the cap, with an ellipsis as the last character', () => {
    expect(clean('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}\u2026`)
  })

  test('a value exactly at the cap is returned unchanged', () => {
    expect(clean('x'.repeat(10), 10)).toBe('x'.repeat(10))
  })

  test('a cap below 1 gives the empty string', () => {
    expect(clean('abc', 0)).toBe('')
  })

  test('lone surrogates and private-use characters are stripped', () => {
    expect(clean('a\uD800b\uE000c')).toBe('abc')
  })
})

describe('sortedUnique', () => {
  test('gives each name once, in code unit order, as a new array', () => {
    const names = ['b', 'a', 'b']

    expect(sortedUnique(names)).toEqual(['a', 'b'])
    expect(sortedUnique(['b', 'B', 'a', '_'])).toEqual(['B', '_', 'a', 'b'])
    expect(sortedUnique([])).toEqual([])
    expect(names).toEqual(['b', 'a', 'b'])
  })
})

describe('utf8Bytes', () => {
  test('counts UTF-8 bytes, not UTF-16 units', () => {
    expect(utf8Bytes('')).toBe(0)
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('é')).toBe(2)
    expect(utf8Bytes('€')).toBe(3)
    expect(utf8Bytes('😀')).toBe(4)
    expect(utf8Bytes('\ud800')).toBe(3)
  })
})

describe('safety net: idLabel (A8)', () => {
  test('idLabel: a string cleaned and capped at 40 code points; anything else is one fixed token', () => {
    expect(idLabel(`be${String.fromCodePoint(0x202e)}\n`)).toBe('be')
    expect(idLabel('x'.repeat(50))).toBe(`${'x'.repeat(39)}…`)
    expect([idLabel(7), idLabel(null), idLabel({ id: 'be' })]).toEqual(Array(3).fill('<non-string id>'))
  })
})

describe('facts helpers (S7)', () => {
  test('idsOrNone is none for no ids, else the ids joined with a comma', () => {
    expect(idsOrNone([])).toBe('none')
    expect(idsOrNone(['be', 'qa'])).toBe('be, qa')
  })

  test('countedNoun is singular for exactly one, plural otherwise', () => {
    expect(countedNoun(1, 'file', 'files')).toBe('1 file')
    expect(countedNoun(0, 'file', 'files')).toBe('0 files')
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

describe('moreLine', () => {
  test('one name left out is counted as +1 more', () => {
    expect(moreLine(1)).toBe('+1 more')
  })

  test('twelve names left out are counted as +12 more', () => {
    expect(moreLine(12)).toBe('+12 more')
  })
})

describe('safety net: asciiLower (A8)', () => {
  test('asciiLower lowercases A-Z only and keeps every non-ASCII letter as it is', () => {
    expect(asciiLower('GSD:Plan-Phase_2')).toBe('gsd:plan-phase_2')
    expect(asciiLower('ÄPFEL-İX-ß')).toBe('Äpfel-İx-ß')
  })
})
