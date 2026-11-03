import { describe, expect, test } from 'claude-code/testing'

import { PANE_LIST_WORDS, SCREEN_LIST_MAX, SCREEN_LIST_WORDS } from '../locales/t'
import { CARD_LIST_WORDS } from '../scope/card'
import { BIDI_OVERRIDE } from '../testkit'
import {
  asciiLower,
  asSentence,
  cardList,
  clean,
  idLabel,
  idsOrNone,
  MAX_CARD_LIST,
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

describe('asSentence (02-GAPS-B2 N1)', () => {
  test('a text gets a final period unless it ends in a sentence mark; an empty text stays empty', () => {
    expect(['', 'Deploy the app', 'Done.', 'Why?', 'Go!'].map(asSentence)).toEqual([
      '',
      'Deploy the app.',
      'Done.',
      'Why?',
      'Go!',
    ])
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
    expect(idsOrNone([], 'none')).toBe('none')
    expect(idsOrNone(['be', 'qa'], 'none')).toBe('be, qa')
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
    const words = { none: 'none', more: (count: number) => `+${count} more`, max: 12 }

    expect(cardList([], words)).toBe('none')
    expect(cardList(['a'], words)).toBe('a')
    expect(cardList(twelve, words)).toBe(twelve.join(', '))
  })

  test('cardList of more than 12 names lists the first 12, then counts the rest', () => {
    const names = Array.from({ length: 15 }, (_, index) => `n${index + 1}`)
    const words = { none: 'none', more: (count: number) => `+${count} more`, max: 12 }

    expect(cardList(names, words)).toBe([...names.slice(0, 12), '+3 more'].join(', '))
  })

  test('cardList caps at its words: the screen and a card at 12, a pane surface shows every name (D-256)', () => {
    const names = Array.from({ length: 14 }, (_, index) => `n${index + 1}`)
    expect(cardList(names, SCREEN_LIST_WORDS)).toBe([...names.slice(0, 12), '+2 more'].join(', '))
    expect(cardList(names, PANE_LIST_WORDS)).toBe(names.join(', '))
    expect(cardList(names, CARD_LIST_WORDS)).toBe([...names.slice(0, 12), '+2 more'].join(', '))
    expect([SCREEN_LIST_WORDS.max, CARD_LIST_WORDS.max, PANE_LIST_WORDS.max]).toEqual([12, MAX_CARD_LIST, Infinity])
  })

  test("the screen's cap SCREEN_LIST_MAX stays the card cap MAX_CARD_LIST (D-256)", () => {
    expect(SCREEN_LIST_MAX).toBe(MAX_CARD_LIST)
  })
})

describe('safety net: asciiLower (A8)', () => {
  test('asciiLower lowercases A-Z only and keeps every non-ASCII letter as it is', () => {
    expect(asciiLower('GSD:Plan-Phase_2')).toBe('gsd:plan-phase_2')
    expect(asciiLower('ÄPFEL-İX-ß')).toBe('Äpfel-İx-ß')
  })
})
