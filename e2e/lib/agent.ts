import { createHash } from 'node:crypto'
import type { EntryKind, TopEntry } from './config-state.ts'
import { LeakError } from './errors.ts'
import { filterText, isRecord, isStringList, leakCheck } from './filter.ts'
import type { FilterContext } from './filter.ts'
import type { GuardSnapshot, KeychainDigest, WatchedFile } from './guard.ts'
import { RUN_ID_RE } from './scratch.ts'
import { ROW_KINDS, SIDECAR_SCHEMA, VERDICTS } from './summary.ts'
import type { Check, Json, Note, NotAutomated, Observation, RowKind, Sidecar, Verdict } from './summary.ts'

export const NOTE_MAX_CHARS = 4000
export const NOTES_MAX = 60
export const RESULT_MAX_BYTES = 200_000
export const HISTORY_LINES_DEFAULT = 200
export const HISTORY_LINES_MAX = 2000
export const ROOT_ROLE = 'root'
export const WAIT_TIMEOUT_DEFAULT_S = 60
// A verb that waits returns within one agent Bash call, which runs at most 10 minutes.
export const WAIT_MAX_S = 540
export const SAFE_KEYS: readonly string[] = [
  'Enter', 'Escape', 'Up', 'Down', 'Left', 'Right', 'Tab', 'BTab', 'Space', 'BSpace', 'PageUp', 'PageDown', 'C-c',
]

export const GIT_READS: readonly string[] = [
  'status', 'log', 'diff', 'show', 'branch', 'ls-files', 'rev-parse', 'check-ignore',
]

const WITHHELD_LINE = '[line withheld: it failed the leak check]'
const ROOT_WINDOW = 'claude'
const ROLE_WINDOW_PREFIX = 'role-'
const ROW_ID_RE = /^\d+(?:\.\d+)*#\d+[a-z]*$/
const WS_ID_RE = /^\d+(?:\.\d+)*-\d+[a-z]*-[0-9a-f]{4}$/
const WS_HEX_RE = /^[0-9a-f]{4}$/
const ROLE_RE = /^[a-z][a-z0-9-]*$/
const VARIANT_RE = /^[a-z0-9-]+$/
const WINDOW_RE = /^[A-Za-z0-9._-]+$/
const WORKTREE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const WHOLE_RE = /^[1-9][0-9]*$/
const SECONDS_RE = /^(?:0|[1-9][0-9]*)$/
const CONTROL_RE = /\p{Cc}/u
const INSTALL_LABEL_RE = /^(?:install|yes, install)/i
const SEED_NAME_RE = /^[a-z][a-z0-9-]*$/
const INBOX_HEAD_RE = /^inbox(?::(.+))?$/
const TERMINAL_FLAG = '--terminal'
const SAFE_TERMINALS: readonly string[] = ['--terminal=tmux', '--terminal=none']
const CONFIG_READS: readonly string[] = ['--get', '--get-all', '--list']
// Whatever the subcommand, these write or read files outside the copy, set config or point git at another repo.
const GIT_REFUSED_PREFIXES: readonly string[] = ['--output', '--no-index']
const GIT_REFUSED_OPTIONS: readonly string[] = ['-c', '-C', '--git-dir', '--work-tree']
const GIT_REFUSED_TEXT = [...GIT_REFUSED_PREFIXES, ...GIT_REFUSED_OPTIONS].join(', ')
const EXCLUSIVE_SEEDS: readonly string[] = ['user-claude-md']
const LOCATION_USAGE = 'use repo/<path>, inbox/<role>/<path>, inbox:<worktree>/<role>/<path> or projects/<path>'
const RUN_USAGE = 'run needs a command: run <ws> [--wt <worktree>] git <subcommand> [args...]'
const CLAIM_WAIT_DEFAULT_S = 0
const MS_PER_SECOND = 1000
const HALVES: readonly string[] = ['', 'a', 'b']
const ENTRY_KINDS: readonly EntryKind[] = ['dir', 'file', 'link', 'other']

type BeginCommand = {
  readonly verb: 'begin'
  readonly fixtures: string
}

type HoldCommand = {
  readonly verb: 'hold'
  readonly run: string
}

type EndCommand = {
  readonly verb: 'end'
  readonly token: string | null
}

type FixtureCommand = {
  readonly verb: 'fixture'
  readonly variant: string
  readonly row: string
  readonly exclusive: boolean
}

type StartCommand = {
  readonly verb: 'start'
  readonly ws: string
  readonly role: string
  readonly cwd: string | null
  readonly wt: string | null
  readonly raw: boolean
}

type ClaimCommand = {
  readonly verb: 'claim'
  readonly ws: string
  readonly roles: readonly string[]
  readonly waitMs: number
}

type WsOnlyCommand<V extends string> = {
  readonly verb: V
  readonly ws: string
}

type WindowCommand<V extends string> = {
  readonly verb: V
  readonly ws: string
  readonly window: string
}

type TextCommand<V extends string> = {
  readonly verb: V
  readonly ws: string
  readonly window: string
  readonly text: string
}

type AnswerCommand = {
  readonly verb: 'answer'
  readonly ws: string
  readonly window: string
  readonly label: string
}

type KeysCommand = {
  readonly verb: 'keys'
  readonly ws: string
  readonly window: string
  readonly keys: readonly string[]
}

type CaptureCommand = {
  readonly verb: 'capture'
  readonly ws: string
  readonly window: string
  readonly history: boolean
  readonly lines: number
}

type WaitCommand = {
  readonly verb: 'wait'
  readonly ws: string
  readonly window: string
  readonly pattern: RegExp
  readonly timeoutMs: number
}

type CadreCommand = {
  readonly verb: 'cadre'
  readonly ws: string
  readonly args: readonly string[]
  readonly wt: string | null
}

type ProbeCommand = {
  readonly verb: 'probe'
  readonly ws: string
  readonly role: string
  readonly wt: string | null
}

type RunCommand = {
  readonly verb: 'run'
  readonly ws: string
  readonly wt: string | null
  readonly argv: readonly string[]
}

type LocationCommand<V extends string> = {
  readonly verb: V
  readonly ws: string
  readonly location: Location
}

type SeedCommand = {
  readonly verb: 'seed'
  readonly ws: string
  readonly name: string
  readonly role: string | null
}

type HelpCommand = {
  readonly verb: 'help'
}

export type AgentCommand =
  | BeginCommand
  | HoldCommand
  | EndCommand
  | FixtureCommand
  | ClaimCommand
  | StartCommand
  | WsOnlyCommand<'windows'>
  | WindowCommand<'trust'>
  | TextCommand<'send'>
  | KeysCommand
  | AnswerCommand
  | TextCommand<'other'>
  | CaptureCommand
  | WaitCommand
  | WindowCommand<'idle'>
  | WindowCommand<'stop'>
  | CadreCommand
  | ProbeCommand
  | RunCommand
  | LocationCommand<'files'>
  | LocationCommand<'read'>
  | SeedCommand
  | WsOnlyCommand<'finish'>
  | HelpCommand

export type RunState = {
  readonly run: string
  readonly root: string
  readonly e2eDir: string
  readonly claudeBin: string
  readonly claude: string
  readonly fixtures: string
  readonly filterFile: string
  readonly startedAt: number
  readonly holderPid: number
  readonly tokenHash: string
}

type WsWindow = {
  readonly name: string
  readonly kind: 'root' | 'role'
}

export type WsState = {
  readonly id: string
  readonly row: string
  readonly variant: string
  readonly exclusive: boolean
  readonly socket: string
  readonly startedAt: number
  readonly status: 'live' | 'finished'
  readonly windows: readonly WsWindow[]
  readonly claims: readonly string[]
  readonly uuids: readonly (readonly [string, number])[]
  readonly snapshot?: readonly TopEntry[]
}

export type Location = {
  readonly root: 'repo' | 'inbox' | 'projects'
  readonly worktree: string | null
  readonly role: string | null
  readonly path: string
}

type AgentCheck = {
  readonly name: string
  readonly ok: boolean
  readonly expected: string
  readonly observed: string
}

export type AgentResult = {
  readonly row: string
  readonly half: string
  readonly title: string
  readonly kind: RowKind
  readonly verdict: Verdict
  readonly reason: string
  readonly checks: readonly AgentCheck[]
  readonly observations: readonly Observation[]
  readonly evidence: readonly Note[]
  readonly notAutomated: readonly NotAutomated[]
}

type ResultMeta = {
  readonly row: string
  readonly durationMs: number
  readonly screens: readonly Note[]
}

type ArgSpec = {
  readonly count: number
  readonly variadic?: boolean
  readonly strings?: readonly string[]
  readonly switches?: readonly string[]
}

type Args = {
  readonly positionals: readonly string[]
  readonly strings: ReadonlyMap<string, string>
  readonly switches: ReadonlySet<string>
}

type Parser = (argv: readonly string[]) => AgentCommand | string

const WS_STATUSES: readonly WsState['status'][] = ['live', 'finished']
const WINDOW_KINDS: readonly WsWindow['kind'][] = ['root', 'role']

function argsOf(verb: string, argv: readonly string[], spec: ArgSpec): Args | string {
  const positionals: string[] = []
  const strings = new Map<string, string>()
  const switches = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? ''
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const name = arg.slice(2)
    if (strings.has(name) || switches.has(name)) return `${arg} is given twice`
    if (spec.switches?.includes(name)) {
      switches.add(name)
      continue
    }
    if (!spec.strings?.includes(name)) return `unknown flag for ${verb}: ${arg}`
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) return `${arg} needs a value`
    strings.set(name, value)
    index += 1
  }
  const isCountOk = spec.variadic ? positionals.length >= spec.count : positionals.length === spec.count
  if (!isCountOk) {
    const noun = spec.count === 1 ? 'argument' : 'arguments'
    const least = spec.variadic ? 'at least ' : ''
    return `${verb} takes ${least}${spec.count} ${noun}, not ${positionals.length}: run help`
  }

  return { positionals, strings, switches }
}

function windowRefusal(ws: string, window: string): string | null {
  if (!isWsId(ws)) return `not a workspace id: ${ws}`
  if (!WINDOW_RE.test(window)) return `not a window name: ${window}`

  return null
}

// The text verbs take no flags, so a text that starts with -- stays text.
function textArgs(verb: string, argv: readonly string[]): readonly [string, string, string] | string {
  if (argv.length !== 3) return `${verb} takes 3 arguments, not ${argv.length}: quote the text, run help`
  const [ws = '', window = '', text = ''] = argv
  const refusal = windowRefusal(ws, window)
  if (refusal) return refusal
  if (text.trim() === '') return `${verb} needs a text`
  if (CONTROL_RE.test(text)) return 'the text must be one line with no control characters'

  return [ws, window, text]
}

function secondsMs(value: string | undefined, fallbackS: number, minS: number): number | null {
  if (value === undefined) return fallbackS * MS_PER_SECOND
  if (!SECONDS_RE.test(value)) return null
  const seconds = Number(value)

  return seconds >= minS && seconds <= WAIT_MAX_S ? seconds * MS_PER_SECOND : null
}

function regexOf(source: string): RegExp | null {
  if (source === '') return null
  try {
    return new RegExp(source, 'm')
  } catch {
    return null
  }
}

function isFolderPath(path: string): boolean {
  if (path.startsWith('/')) return false

  return path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function linesOf(value: string | undefined): number | null {
  if (value === undefined) return HISTORY_LINES_DEFAULT
  if (!WHOLE_RE.test(value)) return null
  const lines = Number(value)

  return lines <= HISTORY_LINES_MAX ? lines : null
}

function parseBegin(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('begin', argv, { count: 0, strings: ['fixtures'] })
  if (typeof args === 'string') return args
  const fixtures = args.strings.get('fixtures')
  if (fixtures === undefined) return 'begin needs --fixtures <run>'
  if (!RUN_ID_RE.test(fixtures)) return `not a run id: ${fixtures}`

  return { verb: 'begin', fixtures }
}

function parseHold(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('hold', argv, { count: 1 })
  if (typeof args === 'string') return args
  const [run = ''] = args.positionals
  if (!RUN_ID_RE.test(run)) return `not a run id: ${run}`

  return { verb: 'hold', run }
}

function parseEnd(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('end', argv, { count: 0, strings: ['token'] })
  if (typeof args === 'string') return args

  return { verb: 'end', token: args.strings.get('token') ?? null }
}

function parseFixture(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('fixture', argv, { count: 1, strings: ['row'], switches: ['exclusive'] })
  if (typeof args === 'string') return args
  const [variant = ''] = args.positionals
  const row = args.strings.get('row')
  if (!VARIANT_RE.test(variant)) return `not a fixture variant: ${variant}`
  if (row === undefined) return 'fixture needs --row <row>'
  if (!ROW_ID_RE.test(row)) return `not a row id: ${row}`

  return { verb: 'fixture', variant, row, exclusive: args.switches.has('exclusive') }
}

function parseStart(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('start', argv, { count: 2, strings: ['cwd', 'wt'], switches: ['raw'] })
  if (typeof args === 'string') return args
  const [ws = '', role = ''] = args.positionals
  const cwd = args.strings.get('cwd') ?? null
  const wt = args.strings.get('wt') ?? null
  const raw = args.switches.has('raw')
  if (!isWsId(ws)) return `not a workspace id: ${ws}`
  if (role !== ROOT_ROLE && !ROLE_RE.test(role)) return `not a role id: ${role}`
  if (role === ROOT_ROLE && raw) return 'start root takes no --raw'
  if (cwd !== null && !isFolderPath(cwd)) return `--cwd must name a folder inside the copy: ${cwd}`
  if (wt !== null && !WORKTREE_RE.test(wt)) return `not a worktree name: ${wt}`

  return { verb: 'start', ws, role, cwd, wt, raw }
}

function parseClaim(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('claim', argv, { count: 2, variadic: true, strings: ['wait'] })
  if (typeof args === 'string') return args
  const [ws = '', ...roles] = args.positionals
  const waitMs = secondsMs(args.strings.get('wait'), CLAIM_WAIT_DEFAULT_S, 0)
  if (!isWsId(ws)) return `not a workspace id: ${ws}`
  if (roles.includes(ROOT_ROLE)) return 'the root window needs no claim'
  const bad = roles.find(role => !ROLE_RE.test(role))
  if (bad !== undefined) return `not a role id: ${bad}`
  const twice = roles.find((role, index) => roles.indexOf(role) !== index)
  if (twice !== undefined) return `${twice} is given twice`
  if (waitMs === null) return `--wait must be a whole number of seconds from 0 to ${WAIT_MAX_S}`

  return { verb: 'claim', ws, roles, waitMs }
}

function parseWsOnly(verb: 'windows' | 'finish', argv: readonly string[]): AgentCommand | string {
  const args = argsOf(verb, argv, { count: 1 })
  if (typeof args === 'string') return args
  const [ws = ''] = args.positionals
  if (!isWsId(ws)) return `not a workspace id: ${ws}`

  return { verb, ws }
}

function parseWindowVerb(verb: 'trust' | 'idle' | 'stop', argv: readonly string[]): AgentCommand | string {
  const args = argsOf(verb, argv, { count: 2 })
  if (typeof args === 'string') return args
  const [ws = '', window = ''] = args.positionals

  return windowRefusal(ws, window) ?? { verb, ws, window }
}

function parseText(verb: 'send' | 'other', argv: readonly string[]): AgentCommand | string {
  const args = textArgs(verb, argv)
  if (typeof args === 'string') return args
  const [ws, window, text] = args

  return { verb, ws, window, text }
}

function parseAnswer(argv: readonly string[]): AgentCommand | string {
  const args = textArgs('answer', argv)
  if (typeof args === 'string') return args
  const [ws, window, label] = args

  return { verb: 'answer', ws, window, label }
}

function parseKeys(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('keys', argv, { count: 3, variadic: true })
  if (typeof args === 'string') return args
  const [ws = '', window = '', ...keys] = args.positionals

  return windowRefusal(ws, window) ?? { verb: 'keys', ws, window, keys }
}

function parseCapture(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('capture', argv, { count: 2, strings: ['lines'], switches: ['history'] })
  if (typeof args === 'string') return args
  const [ws = '', window = ''] = args.positionals
  const lines = linesOf(args.strings.get('lines'))
  const refusal = windowRefusal(ws, window)
  if (refusal) return refusal
  if (lines === null) return `--lines must be a whole number from 1 to ${HISTORY_LINES_MAX}`

  return { verb: 'capture', ws, window, history: args.switches.has('history'), lines }
}

function parseWait(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('wait', argv, { count: 3, strings: ['timeout'] })
  if (typeof args === 'string') return args
  const [ws = '', window = '', source = ''] = args.positionals
  const refusal = windowRefusal(ws, window)
  if (refusal) return refusal
  const pattern = regexOf(source)
  if (pattern === null) return `not a valid regex: ${JSON.stringify(source)}`
  const timeoutMs = secondsMs(args.strings.get('timeout'), WAIT_TIMEOUT_DEFAULT_S, 1)
  if (timeoutMs === null) return `--timeout must be a whole number of seconds from 1 to ${WAIT_MAX_S}`

  return { verb: 'wait', ws, window, pattern, timeoutMs }
}

function parseCadre(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('cadre', argv, { count: 2, variadic: true, strings: ['wt'] })
  if (typeof args === 'string') return args
  const [ws = '', ...rest] = args.positionals
  const wt = args.strings.get('wt') ?? null
  if (!isWsId(ws)) return `not a workspace id: ${ws}`
  if (wt !== null && !WORKTREE_RE.test(wt)) return `not a worktree name: ${wt}`

  return { verb: 'cadre', ws, args: rest, wt }
}

function parseProbe(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('probe', argv, { count: 2, strings: ['wt'] })
  if (typeof args === 'string') return args
  const [ws = '', role = ''] = args.positionals
  const wt = args.strings.get('wt') ?? null
  if (!isWsId(ws)) return `not a workspace id: ${ws}`
  if (role === ROOT_ROLE || !ROLE_RE.test(role)) return `not a role id: ${role}`
  if (wt !== null && !WORKTREE_RE.test(wt)) return `not a worktree name: ${wt}`

  return { verb: 'probe', ws, role, wt }
}

// The argv after the workspace and --wt is taken as given, so its options are never read as flags of run.
function parseRun(argv: readonly string[]): AgentCommand | string {
  const [ws = '', ...rest] = argv
  const hasWt = rest[0] === '--wt'
  const wt = hasWt ? rest[1] ?? '' : null
  const command = rest.slice(hasWt ? 2 : 0)
  if (!isWsId(ws)) return `not a workspace id: ${ws}`
  if (wt !== null && !WORKTREE_RE.test(wt)) return `--wt needs a worktree name: ${JSON.stringify(wt)}`
  if (command.length === 0) return RUN_USAGE

  return { verb: 'run', ws, wt, argv: command }
}

function parseLocated(verb: 'files' | 'read', argv: readonly string[]): AgentCommand | string {
  const args = argsOf(verb, argv, { count: 2 })
  if (typeof args === 'string') return args
  const [ws = '', text = ''] = args.positionals
  if (!isWsId(ws)) return `not a workspace id: ${ws}`
  const location = parseLocation(text)
  if (location === null) return `not a location: ${text}: ${LOCATION_USAGE}`

  return { verb, ws, location }
}

function parseSeed(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('seed', argv, { count: 2, variadic: true })
  if (typeof args === 'string') return args
  const [ws = '', name = '', role, ...extra] = args.positionals
  if (!isWsId(ws)) return `not a workspace id: ${ws}`
  if (!SEED_NAME_RE.test(name)) return `not a seed name: ${name}`
  if (extra.length > 0) return `seed takes 2 or 3 arguments, not ${args.positionals.length}: run help`
  if (role !== undefined && (role === ROOT_ROLE || !ROLE_RE.test(role))) return `not a role id: ${role}`

  return { verb: 'seed', ws, name, role: role ?? null }
}

function parseHelp(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('help', argv, { count: 0 })
  if (typeof args === 'string') return args

  return { verb: 'help' }
}

const PARSERS: ReadonlyMap<string, Parser> = new Map<string, Parser>([
  ['begin', parseBegin],
  ['hold', parseHold],
  ['end', parseEnd],
  ['fixture', parseFixture],
  ['claim', parseClaim],
  ['start', parseStart],
  ['windows', argv => parseWsOnly('windows', argv)],
  ['trust', argv => parseWindowVerb('trust', argv)],
  ['send', argv => parseText('send', argv)],
  ['keys', parseKeys],
  ['answer', parseAnswer],
  ['other', argv => parseText('other', argv)],
  ['capture', parseCapture],
  ['wait', parseWait],
  ['idle', argv => parseWindowVerb('idle', argv)],
  ['stop', argv => parseWindowVerb('stop', argv)],
  ['cadre', parseCadre],
  ['probe', parseProbe],
  ['run', parseRun],
  ['files', argv => parseLocated('files', argv)],
  ['read', argv => parseLocated('read', argv)],
  ['seed', parseSeed],
  ['finish', argv => parseWsOnly('finish', argv)],
  ['help', parseHelp],
])

export function parseCommand(argv: readonly string[]): AgentCommand | string {
  const [verb, ...rest] = argv
  if (verb === undefined) return 'no verb given: run help'
  const parse = PARSERS.get(verb)
  if (!parse) return `unknown verb ${verb}: run help`

  return parse(rest)
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function tokenRefusal(token: string | null | undefined, storedHash: string | null | undefined): string | null {
  if (!storedHash) return 'the agent run holds no orchestrator token hash'
  if (!token) return 'the orchestrator token is missing'
  if (tokenHash(token) !== storedHash) return 'the orchestrator token is wrong'

  return null
}

export function wsIdOf(row: string, hex: string): string | null {
  if (!ROW_ID_RE.test(row) || !WS_HEX_RE.test(hex)) return null

  return `${row.replace('#', '-')}-${hex}`
}

export function isWsId(value: string): boolean {
  return WS_ID_RE.test(value)
}

export function windowNameFor(role: string, taken: readonly string[]): string | null {
  if (role === ROOT_ROLE) return taken.includes(ROOT_WINDOW) ? null : ROOT_WINDOW
  if (!ROLE_RE.test(role)) return null
  const base = `${ROLE_WINDOW_PREFIX}${role}`
  if (!taken.includes(base)) return base
  for (let number = 2; ; number += 1) {
    const name = `${base}-${number}`
    if (!taken.includes(name)) return name
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isListOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard)
}

function isWsWindow(item: unknown): item is WsWindow {
  if (!isRecord(item) || typeof item.name !== 'string') return false
  const { kind } = item

  return WINDOW_KINDS.some(known => known === kind)
}

function isUuidPair(item: unknown): item is readonly [string, number] {
  return Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && isCount(item[1])
}

export function parseRunState(value: unknown): RunState | null {
  if (!isRecord(value)) return null
  const { run, root, e2eDir, claudeBin, claude, fixtures, filterFile, startedAt, holderPid, tokenHash: hash } = value
  if (typeof run !== 'string' || typeof root !== 'string' || typeof e2eDir !== 'string') return null
  if (typeof claudeBin !== 'string' || typeof claude !== 'string' || typeof fixtures !== 'string') return null
  if (typeof filterFile !== 'string' || typeof hash !== 'string') return null
  if (!isCount(startedAt) || !isCount(holderPid)) return null

  return { run, root, e2eDir, claudeBin, claude, fixtures, filterFile, startedAt, holderPid, tokenHash: hash }
}

function snapshotField(value: unknown): { readonly snapshot?: readonly TopEntry[] } | null {
  if (value === undefined) return {}
  if (!isListOf(value, isTopEntry)) return null

  return { snapshot: value.map(entry => ({ name: entry.name, kind: entry.kind, mtimeMs: entry.mtimeMs })) }
}

export function parseWsState(value: unknown): WsState | null {
  if (!isRecord(value)) return null
  const { id, row, variant, exclusive, socket, startedAt, status, windows, claims, uuids } = value
  if (typeof id !== 'string' || typeof row !== 'string' || typeof variant !== 'string') return null
  if (typeof exclusive !== 'boolean' || typeof socket !== 'string' || !isCount(startedAt)) return null
  const wsStatus = WS_STATUSES.find(item => item === status)
  if (!wsStatus || !isListOf(windows, isWsWindow) || !isStringList(claims) || !isListOf(uuids, isUuidPair)) return null
  const snapshot = snapshotField(value.snapshot)
  if (snapshot === null) return null

  return {
    id,
    row,
    variant,
    exclusive,
    socket,
    startedAt,
    status: wsStatus,
    windows: windows.map(item => ({ name: item.name, kind: item.kind })),
    claims,
    uuids: uuids.map(([uuid, number]) => [uuid, number] as const),
    ...snapshot,
  }
}

function isTopEntry(item: unknown): item is TopEntry {
  if (!isRecord(item) || typeof item.name !== 'string' || typeof item.mtimeMs !== 'number') return false
  const { kind } = item

  return ENTRY_KINDS.some(known => known === kind)
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function isBooleanList(value: unknown): value is boolean[] {
  return Array.isArray(value) && value.every(item => typeof item === 'boolean')
}

function isWatchedFile(item: unknown): item is WatchedFile {
  if (!isRecord(item) || typeof item.name !== 'string') return false
  if (!isNumberOrNull(item.mtimeMs) || !isNumberOrNull(item.size)) return false

  return isBooleanList(item.needles) && isBooleanList(item.markers)
}

function isKeychain(value: unknown): value is KeychainDigest | null | undefined {
  if (value === undefined || value === null) return true

  return isRecord(value) && isCount(value.count) && typeof value.hash === 'string'
}

export function parseGuardSnapshot(value: unknown): GuardSnapshot | null {
  if (!isRecord(value)) return null
  const { top, projects, files, sessionFiles, keychain } = value
  if (!isListOf(top, isTopEntry) || !isStringList(projects) || !isListOf(files, isWatchedFile)) return null
  if (!isStringList(sessionFiles) || !isKeychain(keychain)) return null

  return { top, projects, files, sessionFiles, keychain }
}

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJson)

  return isRecord(value) && Object.values(value).every(isJson)
}

function isAgentCheck(item: unknown): item is AgentCheck {
  if (!isRecord(item) || typeof item.name !== 'string' || typeof item.ok !== 'boolean') return false

  return typeof item.expected === 'string' && typeof item.observed === 'string'
}

function isObservation(item: unknown): item is Observation {
  return isRecord(item) && typeof item.name === 'string' && isJson(item.value) && typeof item.evidence === 'string'
}

function isNote(item: unknown): item is Note {
  return isRecord(item) && typeof item.label === 'string' && typeof item.text === 'string'
}

function isNotAutomated(item: unknown): item is NotAutomated {
  return isRecord(item) && typeof item.name === 'string' && typeof item.reason === 'string'
}

function agentResultOf(input: unknown): AgentResult | string {
  if (!isRecord(input)) return 'the result must be a JSON object'
  const { row, half, title, kind, verdict, reason, checks, observations, evidence, notAutomated } = input
  if (typeof row !== 'string' || typeof title !== 'string' || typeof reason !== 'string') {
    return 'row, title and reason must be strings'
  }
  if (typeof half !== 'string' || !HALVES.includes(half)) return 'half must be "", "a" or "b"'
  const rowKind = ROW_KINDS.find(item => item === kind)
  if (!rowKind) return `kind must be one of ${ROW_KINDS.join(', ')}`
  const rowVerdict = VERDICTS.find(item => item === verdict)
  if (!rowVerdict) return `verdict must be one of ${VERDICTS.join(', ')}`
  if (!isListOf(checks, isAgentCheck)) return 'checks must be a list of { name, ok, expected, observed }'
  if (!isListOf(observations, isObservation)) return 'observations must be a list of { name, value, evidence }'
  if (!isListOf(evidence, isNote)) return 'evidence must be a list of { label, text }'
  if (!isListOf(notAutomated, isNotAutomated)) return 'notAutomated must be a list of { name, reason }'

  return { row, half, title, kind: rowKind, verdict: rowVerdict, reason, checks, observations, evidence, notAutomated }
}

function cutNote(note: Note): Note {
  if (note.text.length <= NOTE_MAX_CHARS) return note

  return { label: note.label, text: `${note.text.slice(0, NOTE_MAX_CHARS - 1)}…` }
}

function checkOf(check: AgentCheck): Check {
  return { name: check.name, ok: check.ok, message: `expected: ${check.expected}; observed: ${check.observed}` }
}

export function agentSidecar(input: unknown, meta: ResultMeta): Sidecar | string {
  const result = agentResultOf(input)
  if (typeof result === 'string') return result
  if (result.row !== meta.row) return `the result is for ${result.row}, but this workspace runs ${meta.row}`
  if (result.verdict !== 'pass' && result.reason.trim() === '') return `the verdict ${result.verdict} needs a reason`
  const needsChecks = result.verdict === 'pass' || result.verdict === 'fail'
  if (needsChecks && result.checks.length === 0) return `the verdict ${result.verdict} needs at least one check`
  if (result.evidence.length > NOTES_MAX) return `the evidence holds more than ${NOTES_MAX} notes`

  return {
    schema: SIDECAR_SCHEMA,
    id: result.row,
    half: result.half,
    title: result.title,
    tier: 'live',
    kind: result.kind,
    verdict: result.verdict,
    reason: result.reason,
    checks: result.checks.map(checkOf),
    observations: result.observations,
    evidence: result.evidence.map(cutNote),
    screens: meta.screens,
    notAutomated: result.notAutomated,
    cassette: 'agent',
    durationMs: meta.durationMs,
  }
}

export function filterLines(text: string, ctx: FilterContext): string {
  const filtered = filterText(text, ctx)
  try {
    leakCheck(filtered, ctx)
    return filtered
  } catch (error) {
    if (!(error instanceof LeakError)) throw error
    const withheld = new Set(error.lines)
    return filtered.split('\n').map((line, index) => (withheld.has(index + 1) ? WITHHELD_LINE : line)).join('\n')
  }
}

type SendTarget = {
  readonly exclusive: boolean
  readonly root: boolean
}

function isEpicOpen(words: readonly string[]): boolean {
  const [command = '', sub = '', next = ''] = words.map(word => word.toLowerCase())

  return command === '/cadre' && sub === 'epic' && next !== 'done'
}

function hasSafeTerminal(words: readonly string[]): boolean {
  const flags = words.filter(word => word.startsWith(TERMINAL_FLAG))

  return flags.length > 0 && flags.every(flag => SAFE_TERMINALS.includes(flag))
}

export function sendRefusal(text: string, target: SendTarget): string | null {
  const trimmed = text.trim()
  const words = trimmed.split(/\s+/)
  const command = (words[0] ?? '').toLowerCase()
  if (trimmed.startsWith('!')) return 'shell mode (!) is refused'
  if (command === '/login' || command === '/logout') return `${command} is refused: every workspace shares the login`
  if (trimmed.toLowerCase().includes('--global')) return '--global is refused: it changes state outside the workspace'
  if (command.startsWith('/plugin') && !target.exclusive) return '/plugin is refused outside an exclusive workspace'
  if (isEpicOpen(words) && !hasSafeTerminal(words)) return '/cadre epic needs --terminal=tmux or --terminal=none'
  // Untrimmed: the slash must be the first typed character, so a leading space cannot make the text a prompt.
  if (target.root && !text.startsWith('/')) return 'a root window takes slash commands only'

  return null
}

export function answerRefusal(label: string, exclusive: boolean): string | null {
  if (exclusive) return null
  if (!INSTALL_LABEL_RE.test(label.trimStart())) return null

  return `the answer ${label} installs: it needs an exclusive workspace`
}

export function keysRefusal(keys: readonly string[]): string | null {
  if (keys.length === 0) return 'no keys given'
  const refused = keys.find(key => !SAFE_KEYS.includes(key))
  if (refused === undefined) return null

  return `the key ${refused} is refused: use ${SAFE_KEYS.join(', ')}`
}

export function claimsTaken(workspaces: readonly WsState[]): ReadonlyMap<string, string> {
  const live = workspaces.filter(ws => ws.status === 'live')

  return new Map(live.flatMap(ws => ws.claims.map(role => [role, ws.id] as const)))
}

export function claimRefusal(role: string, wsId: string, taken: ReadonlyMap<string, string>): string | null {
  const holder = taken.get(role)
  if (holder === undefined || holder === wsId) return null

  return `busy: ${role} held by ${holder}`
}

export function parseLocation(text: string): Location | null {
  if (text.startsWith('/')) return null
  const parts = (text.endsWith('/') ? text.slice(0, -1) : text).split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) return null
  const [head = '', ...rest] = parts
  if (head === 'repo' || head === 'projects') return { root: head, worktree: null, role: null, path: rest.join('/') }
  const inbox = INBOX_HEAD_RE.exec(head)
  if (!inbox) return null
  const worktree = inbox[1] ?? null
  const [role = '', ...inner] = rest
  if (worktree !== null && !WORKTREE_RE.test(worktree)) return null
  if (role === ROOT_ROLE || !ROLE_RE.test(role)) return null

  return { root: 'inbox', worktree, role, path: inner.join('/') }
}

function isRefusedGitArg(arg: string): boolean {
  if (GIT_REFUSED_PREFIXES.some(prefix => arg.startsWith(prefix))) return true

  return GIT_REFUSED_OPTIONS.some(option => arg === option || arg.startsWith(`${option}=`))
}

export function runRefusal(argv: readonly string[]): string | null {
  const [program, sub = '', ...args] = argv
  if (program === undefined) return RUN_USAGE
  if (program !== 'git') return `only git runs here, not ${program}`
  if (sub === '') return 'git needs a subcommand'
  if (sub.startsWith('-')) return `git takes no option before its subcommand: ${sub}`
  const refused = args.find(isRefusedGitArg)
  if (refused !== undefined) return `the git argument ${refused} is refused: run takes no ${GIT_REFUSED_TEXT}`
  if (GIT_READS.includes(sub)) return null
  if (sub === 'worktree') return args[0] === 'list' ? null : 'git worktree runs only as git worktree list'
  if (sub !== 'config') return `git ${sub} is refused: use ${GIT_READS.join(', ')}, worktree list or config`
  const options = args.filter(arg => arg.startsWith('-'))
  if (options.length > 0 && options.every(option => CONFIG_READS.includes(option))) return null

  return `git config runs only with ${CONFIG_READS.join(', ')} and no other option`
}

// Print mode would open an epic's terminals outside the workspace tmux server, so an epic opens only in a root window.
export function cadreRefusal(args: readonly string[]): string | null {
  const [sub = '', next = ''] = args.join(' ').trim().split(/\s+/)
  if (sub.toLowerCase() !== 'epic' || next === 'done') return null

  return 'cadre opens no epic: send /cadre epic <key> <title> --terminal=tmux to a root window'
}

export function exclusiveRefusal(
  wsId: string,
  workspaces: readonly WsState[],
  holder: string | null,
  exclusive: boolean,
): string | null {
  if (holder !== null && holder !== wsId) return `the exclusive workspace ${holder} is open: wait until it finishes`
  if (!exclusive) return null
  const other = workspaces.find(ws => ws.status === 'live' && ws.id !== wsId)
  if (other === undefined) return null

  return `an exclusive workspace opens only when no other is live: ${other.id} is live`
}

export function seedRefusal(name: string, exclusive: boolean): string | null {
  if (exclusive || !EXCLUSIVE_SEEDS.includes(name)) return null

  return `the seed ${name} writes the e2e dir: it needs an exclusive workspace (fixture --exclusive)`
}
