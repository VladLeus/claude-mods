import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow, Beat } from '../types'
import {
  STALE_MS,
  agentRows,
  autopilotLine,
  bar,
  liveness,
  messageLines,
  pickIdentity,
  shortModel,
  upsertLink,
  visible,
} from './fleet'

function beat(over: Partial<Beat>): Beat {
  return {
    id: 'aaaaaaaa-1111',
    name: null,
    color: null,
    label: 'repo·aaaaaaaa',
    cwd: '/x/repo',
    model: 'claude-opus-5-5',
    startedAt: 0,
    beatAt: 1_000_000,
    isActive: false,
    turnStartedAt: null,
    idleSince: null,
    isEnded: false,
    endedAt: null,
    endReason: null,
    context: { percent: 40, tokens: 80_000, window: 200_000 },
    costUsd: null,
    agents: [],
    links: [],
    inboundUnknown: 0,
    ...over,
  }
}

function agent(over: Partial<AgentRow>): AgentRow {
  return {
    id: 'ag1',
    label: 'Fleet demo agent one',
    type: 'general-purpose',
    model: null,
    status: 'running',
    startedAt: 0,
    endedAt: null,
    isWorkflow: false,
    ...over,
  }
}

describe('liveness', () => {
  test('active, idle, stale and ended', async () => {
    const now = 1_000_000
    expect(liveness(beat({ isActive: true }), now)).toBe('active')
    expect(liveness(beat({}), now)).toBe('idle')
    expect(liveness(beat({ isActive: true }), now + STALE_MS + 1)).toBe('stale')
    expect(liveness(beat({ isEnded: true }), now)).toBe('ended')
  })

  test('working sessions sort first and hour-old ones drop', async () => {
    const now = 1_000_000 + 60 * 60_000 - 1
    const idle = beat({ id: 'i', beatAt: now })
    const active = beat({ id: 'a', beatAt: now - 1, isActive: true })
    const old = beat({ id: 'o', beatAt: 0 })
    expect(visible([idle, old, active], now).map(b => b.id)).toEqual(['a', 'i'])
  })

  test('ended and cleared sessions are hidden at once', async () => {
    const now = 1_000_000
    const cleared = beat({ id: 'c', isEnded: true, endReason: 'clear', endedAt: now - 1_000, beatAt: now })
    const quit = beat({ id: 'q', isEnded: true, endReason: 'prompt_input_exit', endedAt: now, beatAt: now })
    const fresh = beat({ id: 'n', beatAt: now })
    expect(visible([cleared, quit, fresh], now).map(b => b.id)).toEqual(['n'])
  })
})

describe('identity', () => {
  test('the last /rename wins over the auto-title, and the color is read', async () => {
    const grepped = [
      '"type":"ai-title","aiTitle":"Auto title"',
      '"type":"custom-title","customTitle":"Logistics"',
      '"type":"agent-color","agentColor":"blue"',
      '"type":"custom-title","customTitle":"Logistics 2"',
    ].join('\n')
    expect(pickIdentity(grepped)).toEqual({ name: 'Logistics 2', color: 'blue' })
  })

  test('falls back to the auto-title, and to nothing', async () => {
    expect(pickIdentity('"type":"ai-title","aiTitle":"Auto title"')).toEqual({ name: 'Auto title', color: null })
    expect(pickIdentity('')).toEqual({ name: null, color: null })
  })
})

describe('messages', () => {
  test('sends, replies and other sessions read by name, not id', async () => {
    let links = upsertLink([], 'aaaaaaaa-1111', 'ag1')
    links = upsertLink(links, 'ag1', 'aaaaaaaa-1111')
    links = upsertLink(links, 'ag1', 'aaaaaaaa-1111')
    const me = beat({ name: 'Dashboard', agents: [agent({})], links, inboundUnknown: 2 })
    const other = beat({ id: 'bbbbbbbb-2222', name: 'Logistics', links: [{ from: 'bbbbbbbb-2222', to: 'aaaaaaaa', count: 1 }] })
    expect(messageLines(me, [me, other])).toEqual([
      '→ Fleet demo agent one ×1',
      '← Fleet demo agent one ×2',
      '← Logistics ×1',
      '← another session ×1',
    ])
  })
})

describe('agents', () => {
  test('running first, then newest, capped', async () => {
    const rows = [
      agent({ id: 'old-done', status: 'done', startedAt: 1 }),
      agent({ id: 'new-done', status: 'done', startedAt: 5 }),
      agent({ id: 'run', status: 'running', startedAt: 0 }),
    ]
    const { shown, hidden } = agentRows(rows, 2)
    expect(shown.map(row => row.id)).toEqual(['run', 'new-done'])
    expect(hidden).toBe(1)
  })
})

describe('autopilot badge', () => {
  test('running: time left, trigger, restarts, goal', async () => {
    const line = autopilotLine(
      { isOn: true, phase: 'running', until: 3_600_000, threshold: 65, restarts: 1, maxRestarts: null, hasGoal: true },
      0,
    )
    expect(line).toBe('⚙ autopilot · running · 1h00m left · trigger 65% · restarts 1/∞ · ⚑ goal')
  })

  test('waiting on the 5-hour window: when it resumes', async () => {
    const line = autopilotLine(
      { isOn: true, phase: 'waiting', waitUntil: Date.parse('2026-10-09T03:40:00Z'), until: 9e12, threshold: 65, restarts: 0, maxRestarts: 3 },
      0,
    )
    expect(line).toBe('⚙ autopilot · waiting · resumes 03:40 UTC · trigger 65% · restarts 0/3')
  })
})

describe('format', () => {
  test('bar and model names', async () => {
    expect(bar(50, 4)).toBe('██░░  50%')
    expect(bar(null, 4)).toBe('····  ?%')
    expect(shortModel('claude-opus-5-5')).toBe('opus 5.5')
    expect(shortModel('claude-haiku-5-5-20261001')).toBe('haiku 5.5')
  })
})
