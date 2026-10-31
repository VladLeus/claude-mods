import { describe, expect, test } from 'claude-code/testing'

import { sha256Hex } from '../core/hash'
import { NOT_INTERACTIVE_REPLY } from '../guards/repo'
import { skillUsesText } from '../init/answers'
import { ARTIFACT } from './artifact'
import { CONTRACTS } from './contracts'
import { EN } from './en'
import { PROMPTS } from './prompts'
import { fill, SCREEN_LIST_WORDS, setMissingSlotSink, t, templateSlots, tn } from './t'

/** The keys of a table whose value's type widened to string, so its slots are no longer typed. */
type Widened<T> = { [K in keyof T]: string extends T[K] ? K : never }[keyof T]

/**
 * True only while no EN, ARTIFACT, PROMPTS or CONTRACTS value widens to string (WE-S6): a widened value would let a
 * slot compile unfilled (D-224), so a table value that widens fails the type check here.
 */
const NO_WIDENED: [
  Widened<typeof EN> | Widened<typeof ARTIFACT> | Widened<typeof PROMPTS> | Widened<typeof CONTRACTS>,
] extends [never]
  ? true
  : never = true

/**
 * The 24 table values that were `+` chains of single-line literals (WE-S6), as [table, key]: the EN keys, then the
 * ARTIFACT keys, then the PROMPTS key. Their joined bytes are pinned, so a rewrite of their source form keeps them.
 */
const CHAINED: readonly (readonly [Readonly<Record<string, string>>, string])[] = [
  [EN, 'init.notInteractive'],
  [EN, 'init.roles.adjustQuestion'],
  [EN, 'init.improverInstall.improverInstallQuestion'],
  [EN, 'init.instructions.contentQuestion'],
  [EN, 'init.review.changeRefusal'],
  [EN, 'ui.context.securityPluginNotes'],
  [EN, 'start.gatherUser.startNoGitDir'],
  [EN, 'epic.done.roleProblems'],
  [EN, 'guard.refusals.homeRootReply'],
  [EN, 'guard.refusals.fileSystemRootReply'],
  [EN, 'framework.contract.unsupportedMarkers'],
  [EN, 'framework.gsd.adapter.gsdAdapter'],
  [EN, 'framework.superpowers.adapter.superpowersAdapter'],
  [EN, 'framework.superpowers.adapter.superpowersAdapter5'],
  [ARTIFACT, 'roleMdNoteLine'],
  [ARTIFACT, 'gsdGateBlocker'],
  [ARTIFACT, 'gsdGateShip'],
  [ARTIFACT, 'gsdKickoffStart'],
  [ARTIFACT, 'spGateBrainstorm'],
  [ARTIFACT, 'spGateOutward'],
  [ARTIFACT, 'spDoneLine'],
  [ARTIFACT, 'spKickoffNoQuestion'],
  [ARTIFACT, 'builtinGateQuestion'],
  [PROMPTS, 'regenItemsIntro'],
]

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

describe('long table values (D-224, WE-S6)', () => {
  test('the long values keep their bytes in any source form (WE-S6)', async () => {
    const values = CHAINED.map(([table, key]) => table[key])

    expect(await sha256Hex(values.join('\n'))).toBe('f376bc63c95ceb03568767bad39188a2d9f7769fee64accde7097f55128449f6')
  })

  test('no table value widens to string (WE-S6)', () => {
    expect(NO_WIDENED).toBe(true)
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

  test('the counted word pairs keep the bytes the old counted-noun helper gave', () => {
    expect(tn('init.instructions.files', 1, { count: 1 })).toBe('1 file')
    expect(tn('init.instructions.files', 0, { count: 0 })).toBe('0 files')
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

describe('SCREEN_LIST_WORDS (WE-S3)', () => {
  test('one name left out is counted as +1 more', () => {
    expect(SCREEN_LIST_WORDS.more(1)).toBe('+1 more')
  })

  test('twelve names left out are counted as +12 more', () => {
    expect(SCREEN_LIST_WORDS.more(12)).toBe('+12 more')
  })
})
