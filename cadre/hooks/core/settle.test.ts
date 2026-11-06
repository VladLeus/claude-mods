import { describe, expect, test } from 'claude-code/testing'

import { settledWithin } from './settle'

/** A promise that never settles, as a host call that never answers (edge #1). */
function never(): Promise<unknown> {
  return new Promise(() => undefined)
}

describe('settledWithin (D-271, edge #1)', () => {
  test('a host call that never settles is given up once the bounded wait resolves', async () => {
    const settled = await settledWithin(never(), Promise.resolve())

    expect(settled).toBe(undefined)
  })

  test('a host call that rejects settles it without a throw, while the bounded wait never settles', async () => {
    const settled = await settledWithin(Promise.reject(new Error('the host refused')), never())

    expect(settled).toBe(undefined)
  })
})
