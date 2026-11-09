import { describe, expect, test } from 'claude-code/testing'

import type { SizeVector, Sizing } from '../../types'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import {
  defaultSizing,
  isLarge,
  modesOffered,
  parseScore,
  parseVector,
  pickFor,
  sizeOf,
  sizeText,
  SP_METHOD,
  SP_PLAN_DIR,
} from './sizing'

const BOTH: Sizing = { threshold: 0.5, mapping: { small: 'superpowers', large: 'gsd' }, rubric: '.cadre/sizing.md' }
const GSD_ONLY: Sizing = { threshold: 0.5, mapping: { small: 'gsd', large: 'gsd' }, rubric: '.cadre/sizing.md' }

/** A vector with every dimension at `score`. */
function even(score: number): SizeVector {
  return { scope: score, complexity: score, risk: score, effort: score }
}

describe('sizeOf and isLarge', () => {
  test('the size is the largest of the four scores; large is a size at or over the threshold', () => {
    const vector = { scope: 0.2, complexity: 0.6, risk: 0.3, effort: 0.4 }

    expect(sizeOf(vector)).toBe(0.6)
    expect(isLarge(vector, 0.5)).toBe(true)
    expect(isLarge(even(0.49), 0.5)).toBe(false)
    expect(isLarge(even(0.5), 0.5)).toBe(true)
  })

  test('equal scores give that score as the size, and a size exactly at the threshold is large', () => {
    expect(sizeOf(even(0.7))).toBe(0.7)
    expect(isLarge(even(0.7), 0.7)).toBe(true)
    expect(isLarge({ scope: 0.1, complexity: 0.1, risk: 0.69, effort: 0.1 }, 0.7)).toBe(false)
  })

  test('the size is one of the scores exactly, never a rounded or summed value', () => {
    expect(sizeOf({ scope: 0.1, complexity: 0.2, risk: 0.30000000000000004, effort: 0.3 })).toBe(0.30000000000000004)
  })
})

describe('parseScore', () => {
  test('a finite number from 0.1 to 1.0 is kept as given; anything else is refused', () => {
    expect([0.1, 1, 0.5, 0.123].map(parseScore)).toEqual([0.1, 1, 0.5, 0.123])
    const refused: readonly unknown[] = [0.09, 1.01, 0, -0.5, NaN, Infinity, -Infinity, '0.5', null, undefined, {}]
    expect(refused.map(parseScore)).toEqual(refused.map(() => null))
  })
})

describe('parseVector', () => {
  test('the four scores come back in the order scope, complexity, risk, effort; an extra key is left out', () => {
    const vector = parseVector({ effort: 0.4, risk: 0.3, extra: 9, complexity: 0.6, scope: 0.2 })

    expect(vector).toEqual({ scope: 0.2, complexity: 0.6, risk: 0.3, effort: 0.4 })
    expect(Object.keys(vector ?? {})).toEqual(['scope', 'complexity', 'risk', 'effort'])
  })

  test('a missing dimension, a score out of range or a vector that is no object is refused', () => {
    const full = { scope: 0.2, complexity: 0.6, risk: 0.3, effort: 0.4 }
    const refused: readonly unknown[] = [
      { complexity: 0.6, risk: 0.3, effort: 0.4 },
      { scope: 0.2, risk: 0.3, effort: 0.4 },
      { scope: 0.2, complexity: 0.6, effort: 0.4 },
      { scope: 0.2, complexity: 0.6, risk: 0.3 },
      { ...full, risk: 1.01 },
      { ...full, effort: '0.4' },
      null,
      [0.2, 0.6, 0.3, 0.4],
      '0.5',
    ]

    expect(refused.map(parseVector)).toEqual(refused.map(() => null))
  })
})

describe('modesOffered', () => {
  test('GSD epic and ticket by ticket with both GSD and superpowers, in that order whatever the list order', () => {
    expect(modesOffered(['gsd', 'superpowers'])).toEqual(['gsd-epic', 'ticket'])
    expect(modesOffered(['superpowers', 'gsd'])).toEqual(['gsd-epic', 'ticket'])
  })

  test('one supported framework offers ticket by ticket only; no supported framework offers no mode', () => {
    expect([modesOffered(['gsd']), modesOffered(['superpowers'])]).toEqual([['ticket'], ['ticket']])
    expect([modesOffered([]), modesOffered(['none'])]).toEqual([[], []])
  })
})

describe('defaultSizing', () => {
  test('the threshold 0.5, the rubric path and the mapping from the frameworks there', () => {
    expect(defaultSizing(['gsd', 'superpowers'])).toEqual(BOTH)
    expect(defaultSizing(['gsd'])).toEqual(GSD_ONLY)
    expect(defaultSizing(['superpowers']).mapping).toEqual({ small: 'superpowers', large: 'superpowers' })
    expect([defaultSizing([]).mapping, defaultSizing(['none']).mapping]).toEqual([
      { small: 'none', large: 'none' },
      { small: 'none', large: 'none' },
    ])
  })
})

describe('pickFor', () => {
  test('GSD epic always runs gsd: a phase when large, /gsd-quick when small', () => {
    expect(pickFor(true, 'gsd-epic', BOTH)).toEqual({ framework: 'gsd', gsdPath: 'phase' })
    expect(pickFor(false, 'gsd-epic', BOTH)).toEqual({ framework: 'gsd', gsdPath: 'quick' })
  })

  test('ticket by ticket takes the mapping by size, with a GSD path only when the framework is gsd', () => {
    expect(pickFor(false, 'ticket', BOTH)).toEqual({ framework: 'superpowers', gsdPath: null })
    expect(pickFor(true, 'ticket', BOTH)).toEqual({ framework: 'gsd', gsdPath: 'phase' })
    expect(pickFor(false, 'ticket', GSD_ONLY)).toEqual({ framework: 'gsd', gsdPath: 'quick' })
  })
})

describe('sizeText', () => {
  const vector = { scope: 0.2, complexity: 0.3, risk: 0.4, effort: 0.3 }

  test('the size, its class at the threshold, then the pick of each mode it is given', () => {
    expect(sizeText(vector, BOTH, ['gsd-epic', 'ticket'])).toBe(
      [
        fill(PROMPTS.inboxSize, { size: 0.4, sizeClass: 'small', threshold: 0.5 }),
        fill(PROMPTS.inboxSizePickGsd, { mode: 'gsd-epic', gsdPath: 'quick' }),
        fill(PROMPTS.inboxSizePick, { mode: 'ticket', framework: 'superpowers' }),
      ].join(' '),
    )
  })

  test('a mode the repo does not offer is not named, and with no mode only the size is', () => {
    expect(sizeText(vector, GSD_ONLY, ['ticket'])).toBe(
      [
        fill(PROMPTS.inboxSize, { size: 0.4, sizeClass: 'small', threshold: 0.5 }),
        fill(PROMPTS.inboxSizePickGsd, { mode: 'ticket', gsdPath: 'quick' }),
      ].join(' '),
    )
    expect(sizeText(vector, BOTH, [])).toBe(fill(PROMPTS.inboxSize, { size: 0.4, sizeClass: 'small', threshold: 0.5 }))
  })
})

describe('the superpowers plan folder and method', () => {
  test('a superpowers worker plans under docs/superpowers/plans and executes with subagent-driven-development', () => {
    expect([SP_PLAN_DIR, SP_METHOD]).toEqual(['docs/superpowers/plans', 'superpowers:subagent-driven-development'])
  })
})
