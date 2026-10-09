import type { AgentRow, AgentRunState, AutopilotBadge, Beat, Link, Liveness } from '../types'

export const BEAT_MS = 15_000
export const STALE_MS = 3 * 60_000
export const DROP_MS = 60 * 60_000
/** Heartbeat files older than this are deleted. */
export const CLEANUP_MINUTES = 24 * 60
export const AGENT_ROWS = 6

/** The /color names Claude Code records, as hex so every surface draws them. */
export const SESSION_COLORS: Record<string, string> = {
  red: '#e5534b',
  blue: '#539bf5',
  green: '#57ab5a',
  yellow: '#c69026',
  purple: '#b083f0',
  orange: '#e0823d',
  pink: '#e275ad',
  cyan: '#39c5cf',
}

export function liveness(beat: Beat, now: number): Liveness {
  if (beat.isEnded) return 'ended'
  if (now - beat.beatAt > STALE_MS) return 'stale'
  if (beat.isActive) return 'active'

  return 'idle'
}

/**
 * Beats worth showing: never an ended or cleared one (a resume brings it
 * back), any other until DROP_MS without a beat; working first, then newest.
 */
export function visible(beats: Beat[], now: number): Beat[] {
  const order: Record<Liveness, number> = { active: 0, idle: 1, stale: 2, ended: 3 }

  return beats
    .filter(beat => !beat.isEnded && now - beat.beatAt <= DROP_MS)
    .sort((a, b) => order[liveness(a, now)] - order[liveness(b, now)] || b.beatAt - a.beatAt)
}

export function shortId(id: string): string {
  return id.replace(/^session_/, '').slice(0, 8)
}

export function displayName(beat: Beat): string {
  return beat.name ?? beat.label
}

const IDENTITY_FIELD: Record<string, string> = {
  'custom-title': 'customTitle',
  'agent-name': 'agentName',
  'agent-color': 'agentColor',
  'ai-title': 'aiTitle',
}

/**
 * Picks the session's name and color from whole transcript rows grep printed,
 * the last of each kind winning: /rename's title, else the agent name, else the
 * app's auto-title. Only a row whose TOP-LEVEL type names the kind counts; a
 * malformed row, or a color that is not one of SESSION_COLORS, is skipped.
 */
export function identityFromRows(lines: string[]): { name: string | null; color: string | null } {
  const last: Record<string, string> = {}
  for (const line of lines) {
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof row !== 'object' || row === null) continue
    const record = row as Record<string, unknown>
    const kind = record.type
    if (typeof kind !== 'string' || !Object.hasOwn(IDENTITY_FIELD, kind)) continue
    const value = record[IDENTITY_FIELD[kind] as string]
    if (typeof value !== 'string' || !value) continue
    if (kind === 'agent-color' && !Object.hasOwn(SESSION_COLORS, value)) continue
    last[kind] = value
  }

  return {
    name: last['custom-title'] ?? last['agent-name'] ?? last['ai-title'] ?? null,
    color: last['agent-color'] ?? null,
  }
}

/**
 * Strips control, bidi and format characters from a foreign string and caps
 * its length with an ellipsis; anything that is not a string becomes ''.
 */
export function clean(s: unknown, max = 120): string {
  if (typeof s !== 'string') return ''
  const stripped = s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
  const points = Array.from(stripped)
  if (points.length <= max) return stripped

  return `${points.slice(0, Math.max(0, max - 1)).join('')}…`
}

export const MAX_BEAT_BYTES = 64 * 1024
const MAX_AGENTS = 50
const MAX_LINKS = 100
const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60_000
const BEAT_FUTURE_SKEW_MS = 5 * 60_000
const AGENT_STATES: readonly string[] = ['running', 'waiting', 'done', 'failed']

/** The heartbeat file name of a session id (the id itself is validated, so this is the id plus .json). */
export function beatFile(id: string): string {
  return `${id.replace(/[^\w.-]/g, '_')}.json`
}

/** At most MAX_AGENTS rows: every running one, then the newest (last) of the rest; original order kept. */
export function capAgents(rows: AgentRow[]): AgentRow[] {
  if (rows.length <= MAX_AGENTS) return rows
  const running = rows.filter(row => row.status === 'running').length
  let room = Math.max(0, MAX_AGENTS - running)
  const keep = new Array<boolean>(rows.length).fill(false)
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.status === 'running') {
      keep[i] = true
    } else if (room > 0) {
      keep[i] = true
      room--
    }
  }

  return rows.filter((_, i) => keep[i])
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStamp(value: unknown, now: number): value is number {
  return isNum(value) && Math.abs(value - now) <= TEN_YEARS_MS
}

function isNumOrNull(value: unknown): value is number | null {
  return value === null || isNum(value)
}

function isStampOrNull(value: unknown, now: number): value is number | null {
  return value === null || isStamp(value, now)
}

function isStrOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/**
 * A foreign heartbeat, checked field by field against everything the render
 * path touches, or null. The id must be a plain file-safe name and equal the
 * file's stem, so a beat cannot claim another session's id or a path.
 */
export function validBeat(value: unknown, fileName: string, now = Date.now()): Beat | null {
  if (!isObject(value)) return null
  const { id, name, color, label, cwd, model, context } = value
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) return null
  if (!/^[\w.-]+$/.test(id) || id === '.' || id === '..') return null
  if (fileName !== beatFile(id) || fileName !== `${id}.json`) return null
  if (!isStrOrNull(name) || !isStrOrNull(color)) return null
  if (typeof label !== 'string' || typeof cwd !== 'string' || typeof model !== 'string') return null
  if (!isStamp(value.startedAt, now) || !isStamp(value.beatAt, now)) return null
  if (value.beatAt > now + BEAT_FUTURE_SKEW_MS) return null
  if (typeof value.isActive !== 'boolean' || typeof value.isEnded !== 'boolean') return null
  if (!isStampOrNull(value.turnStartedAt, now) || !isStampOrNull(value.idleSince, now)) return null
  const endedAt = value.endedAt ?? null
  const endReason = value.endReason ?? null
  if (!isStampOrNull(endedAt, now) || !isStrOrNull(endReason)) return null
  if (!isObject(context)) return null
  if (!isNumOrNull(context.percent) || !isNumOrNull(context.tokens) || !isNum(context.window)) return null
  if (!isNumOrNull(value.costUsd) || !isNum(value.inboundUnknown)) return null

  const agents = value.agents
  const links = value.links
  if (!Array.isArray(agents) || !Array.isArray(links)) return null
  const rows: AgentRow[] = []
  for (const agent of agents) {
    if (!isObject(agent)) return null
    if (typeof agent.id !== 'string' || typeof agent.label !== 'string' || typeof agent.type !== 'string') return null
    if (!isStrOrNull(agent.model) || typeof agent.isWorkflow !== 'boolean') return null
    if (typeof agent.status !== 'string' || !AGENT_STATES.includes(agent.status)) return null
    if (!isStamp(agent.startedAt, now) || !isStampOrNull(agent.endedAt, now)) return null
    rows.push({
      id: agent.id,
      label: agent.label,
      type: agent.type,
      model: agent.model,
      status: agent.status as AgentRunState,
      startedAt: agent.startedAt,
      endedAt: agent.endedAt,
      isWorkflow: agent.isWorkflow,
    })
  }
  const pairs: Link[] = []
  for (const link of links) {
    if (!isObject(link)) return null
    if (typeof link.from !== 'string' || typeof link.to !== 'string' || !isNum(link.count)) return null
    pairs.push({ from: link.from, to: link.to, count: link.count })
  }
  const keptRows = capAgents(rows)
  const keptPairs = pairs.slice(-MAX_LINKS)

  return {
    id,
    name,
    color,
    label,
    cwd,
    model,
    startedAt: value.startedAt,
    beatAt: value.beatAt,
    isActive: value.isActive,
    turnStartedAt: value.turnStartedAt,
    idleSince: value.idleSince,
    isEnded: value.isEnded,
    endedAt,
    endReason,
    context: { percent: context.percent, tokens: context.tokens, window: context.window },
    costUsd: value.costUsd,
    agents: keptRows,
    links: keptPairs,
    inboundUnknown: value.inboundUnknown,
  }
}

/** The reasons autopilot's wait_for takes (the same list as autopilot's WAIT_REASONS; not imported across mods). */
const WAIT_REASONS: readonly string[] = [
  'user-input',
  'user-answer',
  'session-answer',
  'session-ping',
  'workflow-end',
  'subagent-result',
  'background-task',
  'other',
]
const MAX_WAITING_FROM = 64

/** The autopilot badge as the autopilot mod wrote it, or null when it is off or malformed. */
export function validBadge(value: unknown, now = Date.now()): AutopilotBadge | null {
  if (!isObject(value) || value.isOn !== true) return null
  const { phase, until, threshold, restarts, maxRestarts, waitUntil, hasGoal } = value
  const { waitingFor, waitingFrom, waitingSince } = value
  if (phase !== undefined && typeof phase !== 'string') return null
  if (until !== undefined && !isStamp(until, now)) return null
  if (threshold !== undefined && !isNum(threshold)) return null
  if (restarts !== undefined && !isNum(restarts)) return null
  if (maxRestarts !== undefined && !isNumOrNull(maxRestarts)) return null
  if (waitUntil !== undefined && !isStampOrNull(waitUntil, now)) return null
  if (hasGoal !== undefined && typeof hasGoal !== 'boolean') return null
  if (waitingFor !== undefined && waitingFor !== null && !WAIT_REASONS.includes(waitingFor as string)) return null
  if (waitingFrom !== undefined && !isStrOrNull(waitingFrom)) return null
  if (typeof waitingFrom === 'string' && waitingFrom.length > MAX_WAITING_FROM) return null
  if (waitingSince !== undefined && !isStampOrNull(waitingSince, now)) return null

  return {
    isOn: true,
    phase,
    until,
    threshold,
    restarts,
    maxRestarts,
    waitUntil,
    hasGoal,
    waitingFor: waitingFor as string | null | undefined,
    waitingFrom,
    waitingSince,
  }
}

/** "claude-opus-5-5" → "opus 5.5"; anything else as is. */
export function shortModel(model: string | null): string {
  if (!model) return ''
  const match = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model)
  if (!match) return model

  return `${match[1]} ${match[2]}.${match[3]}`
}

/** Running agents first, then the most recently started; at most `limit`. */
export function agentRows(agents: AgentRow[], limit = AGENT_ROWS): { shown: AgentRow[]; hidden: number } {
  const rank: Record<AgentRunState, number> = { running: 0, waiting: 1, failed: 2, done: 3 }
  const sorted = [...agents].sort((a, b) => rank[a.status] - rank[b.status] || b.startedAt - a.startedAt)

  return { shown: sorted.slice(0, limit), hidden: Math.max(0, sorted.length - limit) }
}

export function upsertLink(links: Link[], from: string, to: string): Link[] {
  const found = links.find(link => link.from === from && link.to === to)
  if (!found) return [...links, { from, to, count: 1 }]

  return links.map(link => (link === found ? { ...link, count: link.count + 1 } : link))
}

/**
 * The message lines of one card: its own links seen from this session
 * (→ out, ← in, a → b between its agents) and the links other sessions hold
 * toward it. Addresses are named by the card's agents and the fleet's sessions.
 */
export function messageLines(beat: Beat, beats: Beat[]): string[] {
  const names = new Map<string, string>()
  for (const other of beats) {
    names.set(other.id, clean(displayName(other)))
    names.set(shortId(other.id), clean(displayName(other)))
  }
  for (const agent of beat.agents) names.set(agent.id, clean(agent.label))
  const nameOf = (address: string) => names.get(address) ?? names.get(shortId(address)) ?? clean(address)
  const isSelf = (address: string) => address === beat.id || address === shortId(beat.id)

  const lines = beat.links.map(link => {
    if (isSelf(link.from)) return `→ ${nameOf(link.to)} ×${link.count}`
    if (isSelf(link.to)) return `← ${nameOf(link.from)} ×${link.count}`

    return `${nameOf(link.from)} → ${nameOf(link.to)} ×${link.count}`
  })

  let knownInbound = 0
  for (const other of beats) {
    if (other.id === beat.id) continue
    for (const link of other.links) {
      if (!isSelf(link.to)) continue
      knownInbound += link.count
      lines.push(`← ${clean(displayName(other))} ×${link.count}`)
    }
  }
  const unknown = beat.inboundUnknown - knownInbound
  if (unknown > 0) lines.push(`← another session ×${unknown}`)

  return lines
}

export function bar(percent: number | null, width = 12): string {
  if (percent === null) return `${'·'.repeat(width)}  ?%`
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)

  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${String(Math.round(percent)).padStart(3)}%`
}

/**
 * The autopilot badge: phase, time left, trigger and restarts, the goal flag;
 * on a 5-hour wait, when it resumes instead of the time left; on a declared
 * wait, what for, from whom and for how long instead of the phase.
 */
export function autopilotLine(badge: AutopilotBadge, now: number): string {
  const parts = [`⚙ autopilot · ${clean(badge.phase ?? 'on', 32)}`]
  if (badge.phase === 'awaiting' && badge.waitingFor) {
    const from = badge.waitingFrom ? ` ← ${clean(badge.waitingFrom, 32)}` : ''
    const since = typeof badge.waitingSince === 'number' ? ` · ${ago(now - badge.waitingSince)}` : ''
    parts[0] = `⚙ autopilot · ⏸ ${clean(badge.waitingFor, 32)}${from}${since}`
  }
  if (badge.phase === 'waiting' && badge.waitUntil) {
    parts.push(`resumes ${new Date(badge.waitUntil).toISOString().slice(11, 16)} UTC`)
  } else if (badge.until) {
    parts.push(`${ago(Math.max(0, badge.until - now))} left`)
  }
  if (badge.threshold) parts.push(`trigger ${badge.threshold}%`)
  parts.push(`restarts ${badge.restarts ?? 0}/${badge.maxRestarts ?? '∞'}`)
  if (badge.hasGoal) parts.push('⚑ goal')

  return parts.join(' · ')
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`

  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

export function tokensK(tokens: number | null): string {
  if (tokens === null) return '?'
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(1)}M`

  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : String(tokens)
}

export function basename(path: string): string {
  let end = path.length
  while (end > 0 && path[end - 1] === '/') end--
  if (end === 0) return path

  return path.slice(path.lastIndexOf('/', end - 1) + 1, end)
}
