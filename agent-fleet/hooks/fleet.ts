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

/**
 * Picks the session's name and color from transcript rows grep printed, the
 * last of each kind winning: /rename's title, else the agent name, else the
 * app's auto-title.
 */
export function pickIdentity(grepped: string): { name: string | null; color: string | null } {
  const last: Record<string, string> = {}
  for (const match of grepped.matchAll(/"type":"([a-z-]+)","[a-zA-Z]+":"([^"]*)"/g)) {
    const [, kind, value] = match
    if (kind && value) last[kind] = value
  }

  return {
    name: last['custom-title'] ?? last['agent-name'] ?? last['ai-title'] ?? null,
    color: last['agent-color'] ?? null,
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
    names.set(other.id, displayName(other))
    names.set(shortId(other.id), displayName(other))
  }
  for (const agent of beat.agents) names.set(agent.id, agent.label)
  const nameOf = (address: string) => names.get(address) ?? names.get(shortId(address)) ?? address
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
      lines.push(`← ${displayName(other)} ×${link.count}`)
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
 * on a 5-hour wait, when it resumes instead of the time left.
 */
export function autopilotLine(badge: AutopilotBadge, now: number): string {
  const parts = [`⚙ autopilot · ${badge.phase ?? 'on'}`]
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
  return path.replace(/\/+$/, '').split('/').pop() || path
}
