import { describe, expect, test } from 'claude-code/testing'

import type { AgentRow, Beat } from '../types'
import {
  STALE_MS,
  agentRows,
  autopilotLine,
  bar,
  basename,
  beatFile,
  clean,
  identityFromRows,
  liveness,
  messageLines,
  shortModel,
  upsertLink,
  validBadge,
  validBeat,
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
    const rows = [
      '{"type":"ai-title","aiTitle":"Auto title"}',
      '{"type":"custom-title","customTitle":"Logistics","sessionId":"x"}',
      '{"type":"agent-color","agentColor":"blue"}',
      '{"type":"custom-title","customTitle":"Logistics 2"}',
    ]
    expect(identityFromRows(rows)).toEqual({ name: 'Logistics 2', color: 'blue' })
  })

  test('falls back to the auto-title, and to nothing', async () => {
    expect(identityFromRows(['{"type":"ai-title","aiTitle":"Auto title"}'])).toEqual({ name: 'Auto title', color: null })
    expect(identityFromRows([''])).toEqual({ name: null, color: null })
  })

  test('nested identity objects, unanchored text and malformed rows are ignored', async () => {
    const rows = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","input":{"type":"custom-title","customTitle":"Evil"}}]}}',
      'note: {"type":"custom-title","customTitle":"Evil text"}',
      '{"type":"custom-title","customTitle":"Broken',
      '{"type":"custom-title","customTitle":"Real"}',
    ]
    expect(identityFromRows(rows)).toEqual({ name: 'Real', color: null })
  })

  test('only named colors are accepted', async () => {
    expect(identityFromRows(['{"type":"agent-color","agentColor":"constructor"}']).color).toBe(null)
    expect(identityFromRows(['{"type":"agent-color","agentColor":"__proto__"}']).color).toBe(null)
    expect(identityFromRows(['{"type":"agent-color","agentColor":"red"}']).color).toBe('red')
  })
})

describe('validBeat', () => {
  const now = Date.now()
  const good = () => beat({ startedAt: now - 1000, beatAt: now })
  const file = 'aaaaaaaa-1111.json'

  test('accepts a valid beat with agents and links', async () => {
    const value = good()
    value.agents = [agent({ startedAt: now })]
    value.links = [{ from: 'a', to: 'b', count: 2 }]
    expect(validBeat(value, file, now)?.id).toBe('aaaaaaaa-1111')
  })

  test('rejects malformed fields', async () => {
    const bad = (over: Record<string, unknown>) => validBeat({ ...good(), ...over }, file, now)
    expect(bad({ context: undefined })).toBe(null)
    expect(bad({ agents: [agent({ status: 'exploded' as never, startedAt: now })] })).toBe(null)
    expect(bad({ links: [{ from: 'a', to: 5, count: 1 }] })).toBe(null)
    expect(bad({ costUsd: '3' })).toBe(null)
    expect(bad({ turnStartedAt: 1e300 })).toBe(null)
  })

  test('oversized agents and links are truncated on read', async () => {
    const agents = Array.from({ length: 60 }, (_, i) =>
      agent({ id: `a${i}`, status: i < 3 ? 'running' : 'done', startedAt: now }),
    )
    const links = Array.from({ length: 150 }, (_, i) => ({ from: `f${i}`, to: 't', count: 1 }))
    const result = validBeat({ ...good(), agents, links }, file, now)
    const ids = result?.agents.map(a => a.id) ?? []
    expect(ids).toHaveLength(50)
    expect(ids.slice(0, 3)).toEqual(['a0', 'a1', 'a2'])
    expect(ids.slice(3)).toEqual(Array.from({ length: 47 }, (_, i) => `a${i + 13}`))
    expect(result?.links).toHaveLength(100)
    expect(result?.links[0]?.from).toBe('f50')
    expect(result?.links[99]?.from).toBe('f149')
    expect(validBeat({ ...good(), agents: [...agents, { id: 1 }] }, file, now)).toBe(null)
  })

  test('a legacy beat without endedAt and endReason is accepted as null', async () => {
    const legacy: Record<string, unknown> = { ...good() }
    delete legacy.endedAt
    delete legacy.endReason
    const result = validBeat(legacy, file, now)
    expect(result?.endedAt).toBe(null)
    expect(result?.endReason).toBe(null)
  })

  test('the file name helper matches the old inline form', async () => {
    expect(beatFile('aaaaaaaa-1111')).toBe('aaaaaaaa-1111.json')
    expect(beatFile('a/b c')).toBe('a_b_c.json')
  })

  test('the id is bound to the file name', async () => {
    expect(validBeat(good(), 'other.json', now)).toBe(null)
    expect(validBeat({ ...good(), id: '../../tmp/evil' }, '.._.._tmp_evil.json', now)).toBe(null)
    expect(validBeat({ ...good(), id: '../../tmp/evil' }, file, now)).toBe(null)
  })

  test('the autopilot badge is type-checked', async () => {
    expect(validBadge({ isOn: true, phase: 'running', until: now + 1000, restarts: 1, maxRestarts: null }, now)?.phase).toBe('running')
    expect(validBadge({ isOn: true, waitUntil: 1e300 }, now)).toBe(null)
    expect(validBadge({ isOn: true, restarts: 'x' }, now)).toBe(null)
    expect(validBadge({ isOn: false }, now)).toBe(null)
  })

  test('the waiting fields are type-checked; a badge without them is still valid', async () => {
    const waiting = { isOn: true, phase: 'awaiting', waitingFor: 'session-answer', waitingFrom: 'BE-expert', waitingSince: now - 1000 }
    expect(validBadge(waiting, now)?.waitingFor).toBe('session-answer')
    expect(validBadge(waiting, now)?.waitingFrom).toBe('BE-expert')
    expect(validBadge({ isOn: true, waitingFor: null, waitingFrom: null, waitingSince: null }, now)?.isOn).toBe(true)
    expect(validBadge({ isOn: true, phase: 'running' }, now)?.waitingFor).toBe(undefined)
    expect(validBadge({ ...waiting, waitingFor: 'coffee' }, now)).toBe(null)
    expect(validBadge({ ...waiting, waitingFor: 3 }, now)).toBe(null)
    expect(validBadge({ ...waiting, waitingFrom: 5 }, now)).toBe(null)
    expect(validBadge({ ...waiting, waitingFrom: 'x'.repeat(65) }, now)).toBe(null)
    expect(validBadge({ ...waiting, waitingFrom: 'x'.repeat(64) }, now)?.waitingFrom).toHaveLength(64)
    expect(validBadge({ ...waiting, waitingSince: 1e300 }, now)).toBe(null)
    expect(validBadge({ ...waiting, waitingSince: 'x' }, now)).toBe(null)
  })
})

describe('clean', () => {
  test('strips escapes, bidi marks and newlines, and caps the length', async () => {
    expect(clean('a\u001b[31mred‮x\ny')).toBe('a[31mredxy')
    expect(clean(42)).toBe('')
    expect(clean('a b c؜d⁠e⁤f\u{E0041}g\u009bh')).toBe('abcdefgh')
    const emoji = clean('😀'.repeat(300))
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji)).toBe(false)
    expect(Array.from(emoji)).toHaveLength(120)
    expect(emoji.endsWith('…')).toBe(true)
    expect(clean('x'.repeat(300))).toHaveLength(120)
    expect(clean('x'.repeat(300)).endsWith('…')).toBe(true)
  })
})

/** The fastest of three runs, in ms: timing specs compare growth, not a wall-clock budget. */
function fastest(work: () => void): number {
  let best = Infinity
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = performance.now()
    work()
    best = Math.min(best, performance.now() - started)
  }

  return best
}

describe('basename', () => {
  test('trailing slashes are trimmed in linear time', async () => {
    // 10x more input: linear grows ~10x, quadratic ~100x.
    expect(basename(`${'/'.repeat(100_000)}x`)).toBe('x')
    const small = fastest(() => basename(`${'/'.repeat(10_000)}x`))
    const large = fastest(() => basename(`${'/'.repeat(100_000)}x`))
    expect(large).toBeLessThan(30 * Math.max(small, 1))
    expect(basename('/a/b/')).toBe('b')
    expect(basename('/')).toBe('/')
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

  test('a declared wait: what for, from whom, for how long, then the usual parts', async () => {
    const badge = {
      isOn: true, phase: 'awaiting', until: 3_600_000, threshold: 65, restarts: 0, maxRestarts: null, hasGoal: true,
      waitingFor: 'session-answer', waitingFrom: 'BE-expert', waitingSince: 0,
    }
    expect(autopilotLine(badge, 12 * 60_000)).toBe(
      '⚙ autopilot · ⏸ session-answer ← BE-expert · 12m00s · 48m00s left · trigger 65% · restarts 0/∞ · ⚑ goal',
    )
    expect(autopilotLine({ ...badge, waitingFrom: null, waitingSince: null, hasGoal: false }, 0)).toBe(
      '⚙ autopilot · ⏸ session-answer · 1h00m left · trigger 65% · restarts 0/∞',
    )
    expect(autopilotLine({ ...badge, waitingFrom: 'a\u{202e}b\nc' }, 0)).toContain('← abc ·')
    expect(autopilotLine({ ...badge, waitingFor: null }, 0).startsWith('⚙ autopilot · awaiting · ')).toBe(true)
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

describe('clean, invisible characters', () => {
  test('removes tag-encoded text and other format characters, keeps normal text and emoji', async () => {
    expect(clean('a\u{E0049}\u{E0047}\u{E004E}b')).toBe('ab')
    expect(clean('x؜y​z﻿w­v')).toBe('xyzwv')
    expect(clean('Привіт, світе 😀')).toBe('Привіт, світе 😀')
  })
})

describe('validBeat, future stamps', () => {
  const now = 1_800_000_000_000
  const file = 'aaaaaaaa-1111.json'
  const at = (beatAt: number) => validBeat({ ...beat({ startedAt: now - 1000, beatAt }) }, file, now)

  test('a beat more than 5 minutes ahead is rejected; up to 5 minutes and the past are kept', async () => {
    expect(at(now + 300_000)?.id).toBe('aaaaaaaa-1111')
    expect(at(now + 300_001)).toBe(null)
    expect(at(now - 60_000)?.id).toBe('aaaaaaaa-1111')
  })
})
