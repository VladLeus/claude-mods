import { describe, expect, test } from 'claude-code/testing'

import { askChoice, MAX_ASKS, refusalLine } from './ask'
import { memIo, memWorld } from './testkit'

/** The question of the refuse cases: its parser takes only the answer `ok`. */
const QUESTION = 'Pick one?'

/** The answers the question takes in words, as the default refusal lists them. */
const ACCEPTS = '"ok"'

/** The parser of the question: `ok` is the only answer it takes. */
function parseOk(answer: string): string | null {
  return answer === 'ok' ? answer : null
}

/** The question as an askChoice ask, with no refuse of its own. */
const OK_ASK = { question: QUESTION, spec: { options: ['ok', 'not ok'] }, parse: parseOk, accepts: ACCEPTS }

/** A refuse text a test can tell apart from refusalLine: `R:` and the answer. */
function refuseWith(answer: string): string {
  return `R:${answer}`
}

describe('askChoice refuse (N5)', () => {
  test('an answer the parser does not take puts its refuse text on top of the next ask', async () => {
    const run = memIo(memWorld({}), ['bad', 'ok'])
    const ask = { ...OK_ASK, refuse: refuseWith }
    expect(await askChoice(run.io, ask)).toEqual({ kind: 'answered', value: 'ok' })
    expect(run.asked).toEqual([QUESTION, `R:bad\n${QUESTION}`])
  })

  test(`${MAX_ASKS} refused answers give exhausted after ${MAX_ASKS} asks, each led by the answer before`, async () => {
    const run = memIo(memWorld({}), ['a', 'b', 'c', 'ok'])
    const ask = { ...OK_ASK, refuse: refuseWith }
    expect(await askChoice(run.io, ask)).toEqual({ kind: 'exhausted' })
    expect(run.asked).toEqual([QUESTION, `R:a\n${QUESTION}`, `R:b\n${QUESTION}`])
    expect(run.asked).toHaveLength(MAX_ASKS)
  })

  test('a dismissal on the first ask gives dismissed after one ask, and refuse is never called', async () => {
    const refused: string[] = []
    const run = memIo(memWorld({}), [])
    const ask = {
      ...OK_ASK,
      refuse: (answer: string) => {
        refused.push(answer)

        return refuseWith(answer)
      },
    }
    expect(await askChoice(run.io, ask)).toEqual({ kind: 'dismissed' })
    expect(run.asked).toEqual([QUESTION])
    expect(refused).toEqual([])
  })

  test('without a refuse, the next ask starts with the refusalLine of the answer, as before', async () => {
    const run = memIo(memWorld({}), ['bad', 'ok'])
    expect(await askChoice(run.io, OK_ASK)).toEqual({ kind: 'answered', value: 'ok' })
    expect(run.asked).toEqual([QUESTION, `${refusalLine('bad', ACCEPTS)}\n${QUESTION}`])
  })
})
