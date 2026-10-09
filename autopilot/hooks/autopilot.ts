import type { Command, FinalReason, Run, TokenWindow } from '../types'

export const RESTART_TOOL = 'restart_session'
export const MAX_IDLE_TURNS = 2
/**
 * A threshold below this sits close to what a resume alone loads, so every
 * handoff after the first fires RESUME_BUMP points later. At or above it the
 * threshold stands as given.
 */
export const LOW_THRESHOLD = 50
export const RESUME_BUMP = 10
/**
 * The trigger always fires this many points before auto-compact would: room
 * for the handoff itself (reading state, writing the document).
 */
export const COMPACT_MARGIN = 10
/** The ceiling when auto-compact is off or its threshold is unknown. */
export const DEFAULT_CEILING = 90
export const DEFAULT_FIVE_HOUR_STOP = 95
export const DEFAULT_WEEK_STOP = 80
/** Resume this long after the 5-hour window resets, and wait this long when the reset time is unknown. */
export const RESET_MARGIN_MS = 2 * 60_000
export const UNKNOWN_RESET_WAIT_MS = 30 * 60_000

/**
 * The highest context % a handoff may wait for: COMPACT_MARGIN below the
 * session's auto-compact threshold, so a handoff always comes first.
 */
export function triggerCeiling(autoCompactTokens: number | undefined, windowTokens: number | undefined): number {
  if (!autoCompactTokens || !windowTokens) return DEFAULT_CEILING

  return Math.max(1, Math.floor((autoCompactTokens / windowTokens) * 100) - COMPACT_MARGIN)
}

/**
 * The context % that triggers the handoff now: the person's threshold; under
 * LOW_THRESHOLD, every handoff after the first RESUME_BUMP points later so a
 * resumed session cannot loop; never above the ceiling below auto-compact.
 */
export function effectiveTrigger(run: Run, ceiling: number): number {
  const isBumped = run.threshold < LOW_THRESHOLD && run.restarts > 0

  return Math.min(isBumped ? run.threshold + RESUME_BUMP : run.threshold, ceiling)
}

/** "90m", "2h", "1h30m", "45" (minutes) → milliseconds; null when unreadable. */
export function parseDuration(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text) * 60_000
  const match = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(text)
  if (!match || (!match[1] && !match[2])) return null

  return (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60_000
}

/** Takes `--name value` out of the arguments; a quoted value may hold spaces. */
function takeFlag(text: string, name: string): { value: string | null; rest: string } {
  const pattern = new RegExp(`\\s--${name}\\s+(?:"([^"]*)"|“([^”]*)”|«([^»]*)»|'([^']*)'|(\\S+))`)
  const match = pattern.exec(` ${text}`)
  if (!match) return { value: null, rest: text }
  const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''

  return { value, rest: ` ${text}`.replace(match[0], '').trim() }
}

function percentFlag(value: string | null, fallback: number, label: string): number | string {
  if (value === null) return fallback
  const number = Number(value)
  if (!Number.isFinite(number) || number < 1 || number > 100) return `${label} must be a percentage between 1 and 100.`

  return number
}

const USAGE =
  'Usage: /autopilot <time> <threshold%> [max restarts] "<role>" [--goal "<condition>"] [--5h 95] [--week 80]  ·  /autopilot 0 0 stop'

/**
 * `/autopilot` arguments: nothing (status), `stop` or `0 0 stop`, or
 * `<duration> <threshold%> [max restarts] "<role>"` with optional flags
 * `--goal "<condition>"`, `--5h <%>`, `--week <%>`. No max means as many
 * restarts as the time allows.
 */
export function parseCommand(args: string): Command {
  let text = args.trim()
  if (!text) return { kind: 'status' }
  if (/^(0\s+0\s+)?stop$/i.test(text)) return { kind: 'stop' }

  const goalFlag = takeFlag(text, 'goal')
  text = goalFlag.rest
  const fiveHourFlag = takeFlag(text, '5h')
  text = fiveHourFlag.rest
  const weekFlag = takeFlag(text, 'week')
  text = weekFlag.rest

  const fiveHourStop = percentFlag(fiveHourFlag.value, DEFAULT_FIVE_HOUR_STOP, '--5h')
  if (typeof fiveHourStop === 'string') return { kind: 'error', message: fiveHourStop }
  const weekStop = percentFlag(weekFlag.value, DEFAULT_WEEK_STOP, '--week')
  if (typeof weekStop === 'string') return { kind: 'error', message: weekStop }
  const goal = goalFlag.value?.trim() || null
  if (goalFlag.value !== null && !goal) return { kind: 'error', message: '--goal needs a condition in quotes.' }

  const match = /^(\S+)\s+(\d{1,3})%?\s+(?:(\d{1,2})\s+)?(["'“«][\s\S]+|[^\d\s][\s\S]*)$/.exec(text)
  if (!match) return { kind: 'error', message: USAGE }
  const [, rawDuration = '', rawThreshold = '', rawRestarts, rawRole = ''] = match
  const durationMs = parseDuration(rawDuration)
  if (durationMs === null || durationMs <= 0) {
    return { kind: 'error', message: `Cannot read the time "${rawDuration}" (try 90m, 2h, 1h30m).` }
  }
  const threshold = Number(rawThreshold)
  if (threshold < 1 || threshold > 95) return { kind: 'error', message: 'The context threshold must be between 1 and 95 (%).' }
  const role = rawRole.trim().replace(/^["'“«]|["'”»]$/g, '').trim()
  if (role.length < 10) {
    return { kind: 'error', message: 'Give the role in a sentence or more: who the session is and what it is responsible for.' }
  }

  return {
    kind: 'start',
    durationMs,
    threshold,
    maxRestarts: rawRestarts === undefined ? null : Number(rawRestarts),
    role,
    goal,
    fiveHourStop,
    weekStop,
  }
}

/**
 * The skills a role names as `/name`, kept only when the session has a
 * command of that name that is not built in (a skill, a plugin's command).
 */
export function namedSkills(role: string, skillNames: readonly string[]): string[] {
  const known = new Set(skillNames)
  const found: string[] = []
  for (const match of role.matchAll(/(?:^|[\s("'“«`])\/([a-z0-9][\w:.-]*)/gi)) {
    const name = match[1]?.replace(/[.,;:!?)]+$/, '')
    if (name && known.has(name) && !found.includes(name)) found.push(name)
  }

  return found
}

/** Whether another handoff restart is allowed; time alone limits a run with no max. */
export function canRestart(run: Run): boolean {
  return run.maxRestarts === null || run.restarts < run.maxRestarts
}

export function restartsText(run: Run): string {
  return `${run.restarts}/${run.maxRestarts ?? '∞'}`
}

export type LimitAction = { kind: 'week' } | { kind: 'five-hour'; waitUntil: number } | null

/**
 * What the token windows call for: the weekly one past its stop ends the run
 * for good; the 5-hour one past its stop parks it until the window resets.
 */
export function limitAction(run: Run, windows: readonly TokenWindow[], now: number): LimitAction {
  const week = windows.find(window => window.kind === 'seven_day')
  if (week && week.percentUsed >= run.weekStop) return { kind: 'week' }

  const fiveHour = windows.find(window => window.kind === 'five_hour')
  if (!fiveHour || fiveHour.percentUsed < run.fiveHourStop) return null
  const resetsAt = fiveHour.resetsAt ? Date.parse(fiveHour.resetsAt) : Number.NaN

  return {
    kind: 'five-hour',
    waitUntil: Number.isFinite(resetsAt) && resetsAt > now ? resetsAt + RESET_MARGIN_MS : now + UNKNOWN_RESET_WAIT_MS,
  }
}

export type TurnAction = 'continue' | 'wrapup' | 'final' | 'pause' | 'finish' | 'resume-done' | 'none'

/**
 * What to do when a main-loop turn ends, from the run, the context fill, the
 * time, whether the turn called any tool, and the ceiling below auto-compact.
 * The token windows are judged apart (limitAction), before this.
 */
export function afterTurn(
  run: Run,
  now: number,
  percent: number | null,
  calledTools: boolean,
  ceiling = DEFAULT_CEILING,
): TurnAction {
  // The turn that called the restart tool ends before /clear runs: queue nothing,
  // or a prompt could reach the fresh conversation ahead of the resume.
  if (run.phase === 'paused' || run.phase === 'restarting' || run.phase === 'waiting') return 'none'
  // The turn /resume-handoff-doc started: the resume ran; back to work.
  if (run.phase === 'resuming') return 'resume-done'
  // A wrap-up turn ended; the model either called the restart tool or not.
  if (run.phase === 'wrapping') return 'none'
  if (run.phase === 'final') return 'finish'

  if (now >= run.until) return 'final'
  if (percent !== null && percent >= effectiveTrigger(run, ceiling)) return canRestart(run) ? 'wrapup' : 'final'
  if (!calledTools && run.idleTurns + 1 >= MAX_IDLE_TURNS) return 'pause'

  return 'continue'
}

/** Whether a tool result mid-turn should carry the wrap-up instruction now. */
export function wrapMidTurn(
  run: Run,
  now: number,
  percent: number | null,
  ceiling = DEFAULT_CEILING,
): 'wrapup' | 'final' | null {
  // A resume turn often does real work right away: it is watched as well.
  if (run.phase !== 'running' && run.phase !== 'resuming') return null
  if (now >= run.until) return 'final'
  if (percent !== null && percent >= effectiveTrigger(run, ceiling)) return canRestart(run) ? 'wrapup' : 'final'

  return null
}

/**
 * Reads the goal evaluator's verdicts the transcript keeps, as grep printed
 * them (`{"type":"goal_status","met":…,"condition":…}`): the last one for
 * this condition decides. None yet, or not met, is still active.
 */
export function goalState(grepped: string, condition: string): 'achieved' | 'active' {
  let last: { met?: unknown; condition?: unknown } | null = null
  for (const line of grepped.split('\n')) {
    if (!line.trim()) continue
    try {
      const status = JSON.parse(line) as { met?: unknown; condition?: unknown }
      if (status.condition === condition) last = status
    } catch {
      // A verdict cut by grep's pattern: skip it.
    }
  }

  return last?.met === true ? 'achieved' : 'active'
}

/**
 * The session's name and color from transcript rows grep printed, the last of
 * each kind winning: /rename's title, else the agent name.
 */
export function pickIdentity(grepped: string): { name: string | null; color: string | null } {
  const last: Record<string, string> = {}
  for (const match of grepped.matchAll(/"type":"([a-z-]+)","[a-zA-Z]+":"([^"]*)"/g)) {
    const [, kind, value] = match
    if (kind && value) last[kind] = value
  }

  return { name: last['custom-title'] ?? last['agent-name'] ?? null, color: last['agent-color'] ?? null }
}

export function formatLeft(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

function skillsLine(run: Run): string[] {
  if (run.skills.length === 0) return []

  return [
    `- Skills named in your role: ${run.skills.map(name => `/${name}`).join(', ')}. These are skills, not plain text: invoke them with the Skill tool wherever your role calls for them.`,
  ]
}

function identityLines(run: Run): string {
  return [
    `- Role and responsibilities: ${run.role}`,
    ...skillsLine(run),
    ...(run.goal ? [`- Goal (completion condition): ${run.goal}`] : []),
    `- Session name: ${run.name ?? '(none set)'}`,
    `- Session color: ${run.color ?? '(none set)'}`,
  ].join('\n')
}

/** The system prompt section pinned while a run is on; survives /clear. */
export function roleSection(run: Run, now: number): string {
  return [
    '# Autopilot: you are working while the person is away',
    'The person started this run with /autopilot. These lines are their instructions about who you are.',
    identityLines(run),
    `- Time left: ${formatLeft(run.until - now)}; context threshold ${run.threshold}%; restarts used ${restartsText(run)}.`,
    ...(run.handoffPath
      ? [`- Latest handoff: ${run.handoffPath}. If you do not know where you are, read it and continue from there; never start the work over.`]
      : []),
    'Rules while the person is away:',
    '- Ordinary questions: decide yourself within your role, prefer the reversible option, and record the decision (question, options, choice, why) for your handoff.',
    '- Permissions stay exactly as they are. If an action is denied or needs the person (a push, a commit, anything the permission mode blocks), never retry it another way to get around the denial: note it as deferred until the person returns, and continue with other work.',
    '- Only when a question truly cannot wait for the person and blocks all useful work, call the PushNotification tool with a one-line question (under 200 characters), then continue with whatever else you can do.',
    '- You may refine the goal of the next stage. You may never change your purpose, role or responsibilities.',
    '- Ending this session is autopilot\'s call, not yours: never write a handoff or wind down on your own. Autopilot tells you when (context threshold, time, limits) and how. A previous handoff saying a session ended means that session, not this one: keep working.',
  ].join('\n')
}

export function kickoffPrompt(run: Run, now: number): string {
  return [
    `Autopilot is on for ${formatLeft(run.until - now)}. Your role:`,
    run.role,
    ...skillsLine(run),
    ...(run.goal ? [`Goal: ${run.goal}`] : []),
    'Work toward your goal now. Start by stating in two lines what you will do first, then do it.',
  ].join('\n')
}

/** The line a session answers with when everything its role covers is done. */
export const DONE_MARKER = 'AUTOPILOT_DONE'

export const CONTINUE_PROMPT = `Autopilot: keep going toward your goal within your role. If the current stage is done, pick the next most valuable step within your role and do it. Deferred actions wait for the person. If everything your role covers is complete and no valuable step is left, do not invent work: answer with the line ${DONE_MARKER} and a one-line reason.`

/** Whether a turn's answer declares the role's work complete. */
export function isDoneAnswer(answer: string): boolean {
  return answer.includes(DONE_MARKER)
}

export function wrapupPrompt(run: Run, percent: number | null): string {
  return [
    `Autopilot: the context has reached the handoff point (${percent ?? run.threshold}%). Finish this session gracefully, before auto-compact:`,
    '1. Stop at the right moment: finish or safely park the step in progress. Start nothing new.',
    '2. Use the /create-handoff-doc skill. Put this block at the very top of the handoff, verbatim, as the initial prompt of the next session, marked as important and not to be ignored:',
    identityLines(run),
    '   Then: the goal of the next stage (you may refine it), what is done, what is next, the decisions you made yourself, and the deferred actions waiting for the person.',
    `3. Call the ${RESTART_TOOL} tool with the path of the handoff document. It clears this session and resumes from the handoff.`,
  ].join('\n')
}

const FINAL_OPENING: Record<FinalReason, (run: Run) => string> = {
  time: () => 'Autopilot: the autonomous time is over. Finish gracefully and hand back to the person:',
  restarts: run => `Autopilot: the restart limit (${restartsText(run)}) is reached. Finish gracefully and hand back to the person:`,
  goal: run => `Autopilot: the goal is achieved (${run.goal ?? ''}). Finish gracefully and hand back to the person:`,
  done: () => 'Autopilot: you reported the work your role covers as complete. Finish gracefully and hand back to the person:',
  week: run =>
    `Autopilot: ABSOLUTE STOP: the weekly token limit has reached ${run.weekStop}% used. Stop all work now and hand back to the person:`,
}

export function finalPrompt(run: Run, reason: FinalReason): string {
  return [
    FINAL_OPENING[reason](run),
    '1. Finish or safely park the step in progress. Start nothing new.',
    '2. Use the /create-handoff-doc skill, with this block at the top, verbatim:',
    identityLines(run),
    '   Then: what is done, what is next, the decisions you made yourself, and the deferred actions waiting for the person.',
    ...(reason === 'week'
      ? [
          `3. Call the PushNotification tool once: "Autopilot stopped: weekly token limit at ${run.weekStop}%. Handoff written, waiting for you."`,
          `4. Do NOT call ${RESTART_TOOL}. End with a short summary for the person.`,
        ]
      : [`3. Do NOT call ${RESTART_TOOL}. End with a short summary for the person.`]),
  ].join('\n')
}

export function waitPrompt(run: Run, waitUntil: number): string {
  return [
    `Autopilot: the 5-hour token window has reached ${run.fiveHourStop}% used. Park now:`,
    '1. Finish or safely park the step in progress so nothing is left half-done. Start nothing new.',
    `2. Write two lines on where you stopped and what comes next, then end your turn. Autopilot resumes you after the window resets (about ${new Date(waitUntil).toISOString().slice(11, 16)} UTC). No handoff, no restart.`,
  ].join('\n')
}

export const RESUME_AFTER_WAIT_PROMPT =
  'Autopilot: the 5-hour token window has reset. Continue from where you parked, within your role.'

/** The answer an AskUserQuestion gets while the person is away. */
export const ASK_ANSWER =
  'The person is away (autopilot). Decide this yourself within your role, prefer the reversible option, record the decision for the handoff, and continue. If it truly cannot wait and blocks all useful work, send one PushNotification with the question and continue with other work.'

/** What the model reads after an action the permission mode refused. */
export const DEFERRED_NOTE =
  'Autopilot: this action was refused by the permission mode. Do not try to get around it. It is logged as deferred until the person returns; put it in your handoff and continue with other work.'
