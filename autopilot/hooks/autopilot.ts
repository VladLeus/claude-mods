import type { Command, FinalReason, Phase, Run, TokenWindow } from '../types'

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

const ROLE_QUOTES: Record<string, string> = { '"': '"', '“': '”', '«': '»', "'": "'" }

const FLAG_NAMES = ['--goal', '--5h', '--week']
const isSpace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char)

/**
 * For each position, whether the text from there to the end is only flag
 * syntax, the same as `^(\s+--(goal|5h|week)\s+(<quoted value>|\S+))*\s*$`
 * with the value quoted in any supported style. Read in one pass from the end,
 * each position's answer from one further on, so it stays linear: a regex
 * tried at every closing quote would rescan the tail for each of them.
 */
function flagsOnlyFrom(text: string): Uint8Array {
  const size = text.length
  const isFlagsOnly = new Uint8Array(size + 1)
  const nextSpace = new Int32Array(size + 1)
  const nextNonSpace = new Int32Array(size + 1)
  const nextCloser: Record<string, Int32Array> = {}
  for (const closer of Object.values(ROLE_QUOTES)) nextCloser[closer] = new Int32Array(size + 1).fill(-1)
  isFlagsOnly[size] = 1
  nextSpace[size] = size
  nextNonSpace[size] = size

  for (let at = size - 1; at >= 0; at -= 1) {
    const char = text.charAt(at)
    const isWhitespace = isSpace(char)
    nextSpace[at] = isWhitespace ? at : (nextSpace[at + 1] ?? size)
    nextNonSpace[at] = isWhitespace ? (nextNonSpace[at + 1] ?? size) : at
    for (const [closer, next] of Object.entries(nextCloser)) next[at] = char === closer ? at : (next[at + 1] ?? -1)
    if (!isWhitespace) continue

    const flagAt = nextNonSpace[at] ?? size
    if (flagAt === size) {
      isFlagsOnly[at] = 1
      continue
    }
    const name = FLAG_NAMES.find(flag => text.startsWith(flag, flagAt))
    if (!name || !isSpace(text[flagAt + name.length])) continue
    const valueAt = nextNonSpace[flagAt + name.length] ?? size
    if (valueAt === size) continue

    // A bare word runs to the next space; a quoted value to its closing quote.
    if (isFlagsOnly[nextSpace[valueAt] ?? size]) {
      isFlagsOnly[at] = 1
      continue
    }
    const closer = ROLE_QUOTES[text.charAt(valueAt)]
    const closeAt = closer ? (nextCloser[closer]?.[valueAt + 1] ?? -1) : -1
    if (closeAt !== -1 && isFlagsOnly[closeAt + 1]) isFlagsOnly[at] = 1
  }

  return isFlagsOnly
}

/**
 * Splits a quoted role off the arguments: `head` runs through the role's
 * closing quote, `rest` is what follows, the only place flags are read from.
 * The role closes at the first closing quote after which only flags follow,
 * so a quote or apostrophe inside the role stays in it. null when the role
 * is not quoted.
 */
function splitQuotedRole(text: string): { head: string; rest: string } | null {
  const match = /^\S+\s+\d{1,3}%?\s+(?:\d{1,2}\s+)?(["“«'])/.exec(text)
  if (!match) return null
  const opener = match[1] ?? ''
  const closer = ROLE_QUOTES[opener] ?? opener
  const isFlagsOnly = flagsOnlyFrom(text)
  for (let closeAt = text.indexOf(closer, match[0].length); closeAt !== -1; closeAt = text.indexOf(closer, closeAt + 1)) {
    if (isFlagsOnly[closeAt + 1]) return { head: text.slice(0, closeAt + 1), rest: text.slice(closeAt + 1) }
  }

  // Unclosed, or no closing quote is followed by flags alone: everything after the opening quote is the role.
  return { head: text, rest: '' }
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

  // Flags are read only outside a quoted role: a role may not carry its own --goal.
  const quoted = splitQuotedRole(text)
  let flagText = quoted ? quoted.rest : text
  const goalFlag = takeFlag(flagText, 'goal')
  flagText = goalFlag.rest
  const fiveHourFlag = takeFlag(flagText, '5h')
  flagText = fiveHourFlag.rest
  const weekFlag = takeFlag(flagText, 'week')
  flagText = weekFlag.rest
  text = quoted ? `${quoted.head}${flagText}`.trim() : flagText

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
    const name = trimTrailingPunctuation(match[1] ?? '')
    if (name && known.has(name) && !found.includes(name)) found.push(name)
  }

  return found
}

const TRAILING_PUNCTUATION = '.,;:!?)'

/** Drops trailing `.,;:!?)` in one linear pass (a regex here backtracks on long runs). */
function trimTrailingPunctuation(text: string): string {
  let end = text.length
  while (end > 0 && TRAILING_PUNCTUATION.includes(text.charAt(end - 1))) end -= 1

  return text.slice(0, end)
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

/** Phases in which the session must be able to end its turn: a goal's Stop hook may not hold it. */
export function shouldDropStopBlock(phase: Phase): boolean {
  return phase === 'wrapping' || phase === 'restarting' || phase === 'final'
}

/**
 * Whether autopilot answers AskUserQuestion and marks refused actions as
 * deferred: not while paused or waiting, when the person is in control.
 */
export function autoAnswersQuestions(phase: Phase): boolean {
  return phase !== 'paused' && phase !== 'waiting'
}

function parseRow(line: string): Record<string, unknown> | null {
  try {
    const row: unknown = JSON.parse(line)
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null

    return row as Record<string, unknown>
  } catch {
    // A malformed line: skip it.
    return null
  }
}

export type GoalVerdict = { met: boolean; condition: string }

/**
 * The goal evaluator's verdicts from whole transcript lines. The engine writes
 * each as a top-level attachment row (`{"type":"attachment","attachment":
 * {"type":"goal_status","met":…,"condition":…}}`); a verdict anywhere else (a
 * tool input, message text) is not the engine's and is ignored.
 */
export function goalVerdictsFromRows(lines: readonly string[]): GoalVerdict[] {
  const verdicts: GoalVerdict[] = []
  for (const line of lines) {
    const row = parseRow(line)
    if (!row || row.type !== 'attachment') continue
    const attachment = row.attachment as Record<string, unknown> | null | undefined
    if (!attachment || typeof attachment !== 'object' || attachment.type !== 'goal_status') continue
    if (typeof attachment.met !== 'boolean' || typeof attachment.condition !== 'string') continue
    verdicts.push({ met: attachment.met, condition: attachment.condition })
  }

  return verdicts
}

/** The last verdict for this condition decides. None yet, or not met, is still active. */
export function goalState(verdicts: readonly GoalVerdict[], condition: string): 'achieved' | 'active' {
  const matching = verdicts.filter(verdict => verdict.condition === condition)
  const last = matching[matching.length - 1]

  return last?.met === true ? 'achieved' : 'active'
}

const IDENTITY_KEYS: Record<string, string> = {
  'custom-title': 'customTitle',
  'agent-name': 'agentName',
  'agent-color': 'agentColor',
}

/** The color names a session can carry (the same keys as agent-fleet's SESSION_COLORS; not imported across mods). */
const SESSION_COLOR_NAMES: Record<string, true> = {
  red: true,
  blue: true,
  green: true,
  yellow: true,
  purple: true,
  orange: true,
  pink: true,
  cyan: true,
}

/** Whether a phase is the one where the run follows the session to its new id: only its own /clear restart. */
export function followsNewSessionId(phase: Phase): boolean {
  return phase === 'restarting'
}

/**
 * The session's name and color from whole transcript lines, only from
 * top-level identity rows, the last of each kind winning: /rename's title,
 * else the agent name.
 */
export function identityFromRows(lines: readonly string[]): { name: string | null; color: string | null } {
  const last: Record<string, string> = {}
  for (const line of lines) {
    const row = parseRow(line)
    const kind = typeof row?.type === 'string' ? row.type : ''
    const key = IDENTITY_KEYS[kind]
    if (!row || !key) continue
    const value = row[key]
    if (typeof value !== 'string' || !value) continue
    if (kind === 'agent-color' && !Object.hasOwn(SESSION_COLOR_NAMES, value)) continue
    last[kind] = value
  }

  return { name: last['custom-title'] ?? last['agent-name'] ?? null, color: last['agent-color'] ?? null }
}

const MAX_SHOWN_VALUE = 80

/**
 * Control and invisible characters: every control (Cc), format (Cf: bidi
 * marks, zero-width, soft hyphen, tag characters) and the line and paragraph
 * separators (Zl, Zp).
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
const INVISIBLE_ALL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

/** Trailing slashes off a path, in one linear pass (a regex backtracks on a long run). */
function trimTrailingSlashes(path: string): string {
  let end = path.length
  while (end > 0 && path[end - 1] === '/') end--

  return path.slice(0, end)
}

/** A transcript value shown to the model as data: control and invisible characters out, capped, JSON-quoted. */
function quoteValue(value: string): string {
  return JSON.stringify(value.replace(INVISIBLE_ALL, '').slice(0, MAX_SHOWN_VALUE))
}

/**
 * Whether a handoff path the model gave is one autopilot may resume from: a
 * `.md` file under `<root>/thoughts/shared/handoffs/`, relative paths taken
 * against the root, no control characters, no `..` segment.
 */
export function isValidHandoffPath(root: string, path: string): boolean {
  if (!path || INVISIBLE.test(path)) return false
  if (path.split('/').includes('..')) return false
  if (!path.endsWith('.md')) return false
  const handoffs = `${trimTrailingSlashes(root)}/thoughts/shared/handoffs/`
  const absolute = resolveHandoffPath(root, path)

  return absolute.startsWith(handoffs) && absolute.length > handoffs.length
}

/** A handoff path as an absolute one: relative paths are taken against the root. */
export function resolveHandoffPath(root: string, path: string): string {
  if (path.startsWith('/')) return path

  return `${trimTrailingSlashes(root)}/${path}`
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
    `- Session name: ${run.name ? quoteValue(run.name) : '(none set)'}`,
    `- Session color: ${run.color ? quoteValue(run.color) : '(none set)'}`,
  ].join('\n')
}

const PAUSED_SECTION =
  '# Autopilot is paused\nThe person is in control. Follow their messages as usual; the autopilot rules do not apply until it resumes.'

const WAITING_SECTION =
  '# Autopilot is waiting\nAutopilot is parked until the 5-hour token window resets, and the person is in control meanwhile. Follow their messages as usual; the autopilot rules do not apply until it resumes.'

/** The system prompt section pinned while a run is on; survives /clear. */
export function roleSection(run: Run, now: number): string {
  // Parked or stalled: the person may be back, and the away rules must not override them.
  if (run.phase === 'paused') return PAUSED_SECTION
  if (run.phase === 'waiting') return WAITING_SECTION

  return [
    '# Autopilot: you are working while the person is away',
    'The person started this run with /autopilot. These lines are their instructions about who you are.',
    identityLines(run),
    `- Time left: ${formatLeft(run.until - now)}; context threshold ${run.threshold}%; restarts used ${restartsText(run)}.`,
    ...(run.handoffPath
      ? [`- Latest handoff: ${JSON.stringify(run.handoffPath)}. If you do not know where you are, read it and continue from there; never start the work over.`]
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

/** Whether a turn's answer declares the role's work complete: the marker opens a line, never mid-sentence. */
export function isDoneAnswer(answer: string): boolean {
  // Spaces and tabs only: `\s` would match line breaks too and backtrack quadratically on blank lines.
  return /^[ \t]*AUTOPILOT_DONE\b/m.test(answer)
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
