/**
 * Where an autopilot run stands:
 * - running: working toward the goal, nudged on after every turn
 * - wrapping: past the context threshold, writing a handoff before a restart
 * - restarting: the restart tool was called; /clear is queued behind the turn
 * - resuming: /resume-handoff-doc was issued; its turn ending means resumed
 * - waiting: the 5-hour token window is nearly used up; parked until it resets
 * - final: time, restarts, the weekly limit or the goal: a last handoff, no restart
 * - paused: stalled twice in a row; waits for the person
 * - awaiting: the session declared it waits for something (wait_for); not nudged until a new turn starts
 */
export type Phase = 'running' | 'wrapping' | 'restarting' | 'resuming' | 'waiting' | 'final' | 'paused' | 'awaiting'

/** What a session waits for when it calls wait_for. */
export type WaitReason =
  | 'user-input'
  | 'user-answer'
  | 'session-answer'
  | 'session-ping'
  | 'workflow-end'
  | 'subagent-result'
  | 'background-task'
  | 'idle-inbox'
  | 'other'

/** A wait the session declared: what for, from whom, since when, and when autopilot checks on it. */
export type Awaiting = {
  reason: WaitReason
  /** Who the answer comes from (a session name, a subagent); null when not given. */
  from: string | null
  note: string | null
  since: number
  /** When autopilot asks once whether the wait is stuck; null for never. */
  timeoutAt: number | null
  /** Whether that check was already sent. */
  pinged: boolean
  /** In draining: the queued question this wait asks (its note carried `#k` and k was queued). Missing when untagged and in older runs. */
  questionId?: number
}

export type FinalReason = 'time' | 'restarts' | 'week' | 'goal' | 'done'

/** One autopilot run, kept in $.store under `run:<session id>`. */
export type Run = {
  role: string
  /** The session's /rename name and /color at the start, so a handoff keeps them. */
  name: string | null
  color: string | null
  startedAt: number
  until: number
  threshold: number
  /** null: as many restarts as the time allows. */
  maxRestarts: number | null
  restarts: number
  phase: Phase
  /** The handoff a queued restart resumes from. */
  handoffPath: string | null
  /** Turns in a row that called no tool. */
  idleTurns: number
  /** The /goal condition the run sets and keeps set across /clear; null for none. */
  goal: string | null
  /** Skills the role names (`/explore`), confirmed against the session's commands. */
  skills: string[]
  /** Park at this % of the 5-hour token window and resume after it resets. */
  fiveHourStop: number
  /** Stop for good at this % of the weekly token window. */
  weekStop: number
  /** While waiting: when the 5-hour window resets (plus a margin). */
  waitUntil: number | null
  /** Why the run is in its final phase. */
  finalReason: FinalReason | null
  /** The wait the session declared; null when not waiting. Missing in runs stored by older versions. */
  awaiting: Awaiting | null
  /** Whether questions go to the person (--ask-user) instead of being answered by autopilot. Missing in older runs. */
  askUser: boolean
  /** Set when the person brought a finished run back: the next restart does not count against the restarts. */
  isGraceResume?: boolean
  /** When the run entered its final phase: the handoff of a grace resume must be newer than this. */
  finalAt?: number
  /** For a grace resume: the final phase's start, copied from the finished run's `finalAt`. */
  graceSince?: number
  /** For a grace resume: how many times the session was asked again to restart. */
  graceAsks?: number
  /** Critical questions parked while the person cannot answer (/away, /ask-user off), oldest first. Missing in older runs. */
  questions?: Question[]
  /** Whether the queue is being asked one question at a time. */
  drain?: boolean
  /** The question the current drain role section names. */
  askingId?: number
  /** The id the next queued question gets; only grows, so an id is never reused within the run (spec §3.1). Missing in older runs. */
  nextQuestionId?: number
  /** The session away `setAt` whose expiry ping was handed to the model. */
  pingedFor?: number
  /** Prompts that must reach the model, kept until delivered (only while running or awaiting). */
  pending?: Pending[]
  /** The mode the last heartbeat or command acted on. */
  lastMode?: Mode
}

/** A run that finished on time or restarts, kept for a grace period so the person can bring it back. */
export type FinishedRecord = { run: Run; finishedAt: number }

export type StartCommand = {
  kind: 'start'
  /** How long to run, or the next local time reading `hours:minutes`. */
  end: { kind: 'duration'; ms: number } | { kind: 'clock'; hours: number; minutes: number }
  threshold: number
  maxRestarts: number | null
  role: string
  goal: string | null
  fiveHourStop: number
  weekStop: number
  askUser: boolean
}

export type Command =
  | { kind: 'status' }
  | { kind: 'stop' }
  | StartCommand
  /** deltaMs is 0 when no time was given, restarts 0 when no --restarts. */
  | { kind: 'extend' | 'shorten'; deltaMs: number; restarts: number }
  | { kind: 'until'; hours: number; minutes: number }
  | { kind: 'error'; message: string }

/** A token window as `$.session.usage().rateLimits` reports it. */
export type TokenWindow = { kind: string; percentUsed: number; resetsAt?: string }

/**
 * How a run treats questions for the person, decided by availMode in order:
 * - plain: no --ask-user and no askUser record anywhere; today's no-ask behaviour, no queue
 * - queueing: asking is off, or the person is away; critical questions go to the queue
 * - draining: the queue is asked one question at a time
 * - overdue: the away ended with questions queued; no asking until the person writes
 * - asking: today's --ask-user behaviour
 */
export type Mode = 'plain' | 'queueing' | 'overdue' | 'draining' | 'asking'

export type AwayField = { until: number; setAt: number } | { back: true; setAt: number }
export type AskField = { on: boolean; setAt: number }
/** Availability record, session ($.store `away:<sid>`) or global (~/.claude/autopilot/status/global.json). */
export type Avail = { v: 1; away: AwayField | null; askUser: AskField | null }

export type Effective = {
  away: AwayField | null
  awaySource: 'session' | 'global' | null
  /** Effective ask-user: the record if any, else the run's --ask-user flag. */
  askOn: boolean
  /** Whether any level holds an askUser record (D5: no record + flag off = plain). */
  askRecorded: boolean
  /** When the effective askUser record was set (session over global); null without one. */
  askSetAt: number | null
}

/** A critical question parked for the person; ids run 1..n within the run and are never reused (`Run.nextQuestionId`). */
export type Question = { id: number; text: string; kind: 'answer' | 'action'; provisional: string | null; at: number }
export type QueueInput = {
  question: string
  kind: 'answer' | 'action'
  provisional: string | null
  /** Set when the question or the provisional was longer than its cap and was cut. */
  cut?: true
}

/** A prompt that must reach the model; `key` is the away `setAt` for pings, 0 otherwise. */
export type Pending = { kind: 'ping' | 'combined-ping' | 'drain' | 'continue'; text: string; key: number }

export type AvailCommand =
  | { kind: 'away'; end: { kind: 'duration'; ms: number } | { kind: 'clock'; hours: number; minutes: number }; global: boolean }
  | { kind: 'back'; global: boolean }
  | { kind: 'ask-user'; on: boolean; global: boolean }
  | { kind: 'error'; message: string }

/** What the combined ping reads from other sessions' badge files. */
export type BadgeAvail = { queued: number; awaySource: 'session' | 'global' | null; awaySetAt: number | null; beat: number }
export type LockOwner = { sid: string; at: number }
