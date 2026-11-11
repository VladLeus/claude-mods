import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HarnessError } from './errors.ts'
import { pollUntil } from './poll.ts'
import type { PollOptions } from './poll.ts'

type Clock = {
  readonly opts: PollOptions
  readonly sleeps: number[]
}

function fakeClock(timeoutMs: number, intervalMs: number, isDead?: () => boolean): Clock {
  let at = 1_000
  const sleeps: number[] = []
  const base = {
    timeoutMs,
    intervalMs,
    now: () => at,
    sleep: async (ms: number) => {
      sleeps.push(ms)
      at += ms
    },
    label: 'unit poll',
  }

  return { opts: isDead ? { ...base, isDead } : base, sleeps }
}

function reader(values: readonly string[]): { read: () => Promise<string>, count: () => number } {
  let reads = 0

  return {
    read: async () => {
      const value = values[Math.min(reads, values.length - 1)] ?? ''
      reads += 1
      return value
    },
    count: () => reads,
  }
}

test('pollUntil returns the first matching read', async () => {
  const clock = fakeClock(10_000, 200)
  const source = reader(['a', 'b', 'c', 'b'])

  assert.equal(await pollUntil(source.read, value => value === 'b', clock.opts), 'b')
  assert.equal(source.count(), 2)
  assert.deepEqual(clock.sleeps, [200])
})

test('pollUntil throws a HarnessError carrying the last read after the deadline', async () => {
  const clock = fakeClock(1_000, 200)
  let reads = 0
  const read = async (): Promise<string> => {
    reads += 1
    return `screen-${reads}`
  }

  await assert.rejects(pollUntil(read, () => false, clock.opts), (error: unknown) => {
    assert.ok(error instanceof HarnessError)
    assert.match(error.message, /unit poll: timed out after 1000 ms/)
    assert.ok(error.message.endsWith(`screen-${reads}`), 'the error does not carry the last read')
    return true
  })
  assert.equal(reads, 6)
})

test('pollUntil stops at once when isDead reports true', async () => {
  const clock = fakeClock(60_000, 200, () => true)
  const source = reader(['last screen'])

  await assert.rejects(pollUntil(source.read, () => false, clock.opts), (error: unknown) => {
    assert.ok(error instanceof HarnessError)
    assert.match(error.message, /dead/)
    assert.ok(error.message.endsWith('last screen'))
    return true
  })
  assert.equal(source.count(), 1)
  assert.deepEqual(clock.sleeps, [])
})

test('pollUntil returns a matching read even when isDead reports true', async () => {
  const clock = fakeClock(60_000, 200, () => true)
  const source = reader(['done'])

  assert.equal(await pollUntil(source.read, value => value === 'done', clock.opts), 'done')
})

test('pollUntil keeps polling while isDead reports false', async () => {
  const clock = fakeClock(60_000, 200, () => false)
  const source = reader(['a', 'a', 'a', 'ready'])

  assert.equal(await pollUntil(source.read, value => value === 'ready', clock.opts), 'ready')
  assert.equal(source.count(), 4)
})
