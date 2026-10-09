export type AgentRunState = 'running' | 'waiting' | 'done' | 'failed'

/** One subagent or workflow agent of a session. */
export type AgentRow = {
  id: string
  label: string
  type: string
  model: string | null
  status: AgentRunState
  startedAt: number
  endedAt: number | null
  isWorkflow: boolean
}

/** Message counts between two addresses: a session id, an agent id, or a name. */
export type Link = { from: string; to: string; count: number }

/** One session's heartbeat, as it writes it to ~/.claude/fleet/<id>.json. */
export type Beat = {
  id: string
  /** The /rename name, else the app's auto-title; null when neither is set. */
  name: string | null
  /** The /color color name (blue, green, ...); null when unset. */
  color: string | null
  /** Fallback label: <folder>·<short id>. */
  label: string
  cwd: string
  model: string
  startedAt: number
  beatAt: number
  isActive: boolean
  turnStartedAt: number | null
  idleSince: number | null
  isEnded: boolean
  endedAt: number | null
  /** `clear` for /clear, else the engine's reason (quit, logout, ...). */
  endReason: string | null
  context: { percent: number | null; tokens: number | null; window: number }
  costUsd: number | null
  agents: AgentRow[]
  links: Link[]
  /** Messages from other sessions whose sender could not be told. */
  inboundUnknown: number
  /** The autopilot mod's status for this session, attached when the fleet reads it. */
  autopilot?: AutopilotBadge | null
}

/** What the autopilot mod writes to ~/.claude/autopilot/<id>.json. */
export type AutopilotBadge = {
  isOn: boolean
  phase?: string
  until?: number
  threshold?: number
  restarts?: number
  maxRestarts?: number | null
  waitUntil?: number | null
  hasGoal?: boolean
}

export type Liveness = 'active' | 'idle' | 'stale' | 'ended'

declare module 'claude-code' {
  interface PluginState {
    'agent-fleet': { fleet: Beat[]; selfId: string }
  }
}
