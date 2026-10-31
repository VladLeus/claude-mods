import { describe, expect, test } from 'claude-code/testing'

import { NOT_INTERACTIVE_REPLY } from '../guards/repo'
import { skillUsesText } from '../init/answers'
import { ARTIFACT } from './artifact'
import { EN } from './en'
import { PROMPTS } from './prompts'
import { fill, setMissingSlotSink, t, templateSlots, tn } from './t'

/** Whether a template keeps a brace once every well-formed `{name}` slot is taken out: an unbalanced or odd brace. */
function hasStrayBrace(template: string): boolean {
  return /[{}]/.test(template.replace(/\{[a-zA-Z]+\}/g, ''))
}

/** Runs `run` with a sink that keeps every missing-slot line, then puts the no-op sink back. */
function withSink(run: () => void): readonly string[] {
  const sunk: string[] = []
  setMissingSlotSink(text => {
    sunk.push(text)
  })
  try {
    run()
  } finally {
    setMissingSlotSink(() => undefined)
  }

  return sunk
}

describe('fill (D-224)', () => {
  test('each slot takes its value, a number as its decimal text', () => {
    expect(fill('{a} and {b}', { a: 1, b: 'x' })).toBe('1 and x')
    expect(fill('no slot')).toBe('no slot')
  })

  test('a slot with no value renders as {name} and sends one line naming it to the sink, never a throw', () => {
    let filled = ''
    // @ts-expect-error the template has a slot zz the call does not pass (the type check bites)
    const sunk = withSink(() => (filled = fill('{a} {zz}', { a: 1 })))

    expect(filled).toBe('1 {zz}')
    expect(sunk.length).toBe(1)
    expect(sunk[0]).toContain('zz')
  })

  test('a sink that throws never makes fill throw', () => {
    setMissingSlotSink(() => {
      throw new Error('the sink failed')
    })
    try {
      // @ts-expect-error the template has a slot b the call does not pass
      expect(fill('{a} {b}', { a: 'x' })).toBe('x {b}')
    } finally {
      setMissingSlotSink(() => undefined)
    }
  })

  test('a value holding braces is not filled again: one pass over the template only (T-02.1-81)', () => {
    expect(fill('{a} {b}', { a: '{b}', b: 'x' })).toBe('{b} x')
  })

  test('a call with an extra slot fails the type check too, and the extra value is never shown', () => {
    // @ts-expect-error the template has no slot b
    expect(fill('{a}', { a: 1, b: 2 })).toBe('1')
  })
})

describe('templateSlots (D-224)', () => {
  test('the slot names of a template, once each, in the order they first appear', () => {
    expect(templateSlots('{a} {b} {a}')).toEqual(['a', 'b'])
    expect(templateSlots('no slot')).toEqual([])
  })

  test('a brace that opens or closes no well-formed slot is a stray brace the walk reports', () => {
    for (const bad of ['{a', 'a}', '{a b}', '{}', '{1}', '{a}}']) expect(hasStrayBrace(bad)).toBe(true)
    for (const good of ['{a} {b}', 'plain', '']) expect(hasStrayBrace(good)).toBe(false)
  })

  test('every EN, ARTIFACT and PROMPTS template has only well-formed slots: balanced braces, letter names', () => {
    const tables = [EN, ARTIFACT, PROMPTS].map(table => Object.entries(table))
    const stray = tables.flatMap(entries => entries.filter(([, template]) => hasStrayBrace(template)))

    expect(stray).toEqual([])
    for (const [, template] of tables.flat()) {
      for (const name of templateSlots(template)) expect(name).toMatch(/^[a-zA-Z]+$/)
    }
  })

  test('every counted EN sentence comes as a pair: each .one key has its .other twin and each .other its .one', () => {
    const keys = Object.keys(EN)
    const twinless = keys.filter(key => {
      if (key.endsWith('.one')) return !keys.includes(`${key.slice(0, -'.one'.length)}.other`)
      if (key.endsWith('.other')) return !keys.includes(`${key.slice(0, -'.other'.length)}.one`)

      return false
    })

    expect(twinless).toEqual([])
  })
})

describe('t and tn (D-207, D-216, D-223)', () => {
  test('t gives the EN text of a key: the init refusal where no one can be asked', () => {
    expect(t('init.notInteractive')).toBe(NOT_INTERACTIVE_REPLY)
  })

  test('tn takes the .one form for a count of 1 and the .other form for any other count', () => {
    expect(tn('init.answers.skillUses', 1, { count: 1, sessions: 50 })).toBe('1 time in the last 50 sessions')
    expect(tn('init.answers.skillUses', 0, { count: 0, sessions: 50 })).toBe('0 times in the last 50 sessions')
    expect(tn('init.answers.skillUses', 2, { count: 2, sessions: 50 })).toBe('2 times in the last 50 sessions')
  })

  test('a counted sentence built through tn keeps its bytes for every count', () => {
    expect(skillUsesText(1)).toBe('1 time in the last 50 sessions')
    expect(skillUsesText(3)).toBe('3 times in the last 50 sessions')
  })

  test('a t or tn call with a missing or an extra slot fails the type check (the type check bites)', () => {
    const sunk = withSink(() => {
      // @ts-expect-error the .other template needs sessions too
      expect(tn('init.answers.skillUses', 2, { count: 2 })).toBe('2 times in the last {sessions} sessions')
      // @ts-expect-error the key has no slot
      expect(t('init.notInteractive', { extra: 1 })).toBe(NOT_INTERACTIVE_REPLY)
    })

    expect(sunk.length).toBe(1)
  })
})
