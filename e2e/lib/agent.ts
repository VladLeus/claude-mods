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

const WITHHELD_LINE = '[line withheld: it failed the leak check]'
const ROOT_WINDOW = 'claude'
const ROLE_WINDOW_PREFIX = 'cadre-'
const ROW_ID_RE = /^\d+(?:\.\d+)*#\d+[a-z]*$/
const WS_ID_RE = /^\d+(?:\.\d+)*-\d+[a-z]*-[0-9a-f]{4}$/
const WS_HEX_RE = /^[0-9a-f]{4}$/
const ROLE_RE = /^[a-z][a-z0-9-]*$/
const VARIANT_RE = /^[a-z0-9-]+$/
const WINDOW_RE = /^[A-Za-z0-9._-]+$/
const WORKTREE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const WHOLE_RE = /^[1-9][0-9]*$/
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
}

type StartCommand = {
  readonly verb: 'start'
  readonly ws: string
  readonly role: string
  readonly cwd: string | null
  readonly wt: string | null
  readonly raw: boolean
}

type CaptureCommand = {
  readonly verb: 'capture'
  readonly ws: string
  readonly window: string
  readonly history: boolean
  readonly lines: number
}

type FinishCommand = {
  readonly verb: 'finish'
  readonly ws: string
}

type HelpCommand = {
  readonly verb: 'help'
}

export type AgentCommand =
  | BeginCommand
  | HoldCommand
  | EndCommand
  | FixtureCommand
  | StartCommand
  | CaptureCommand
  | FinishCommand
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
  if (positionals.length !== spec.count) {
    const noun = spec.count === 1 ? 'argument' : 'arguments'
    return `${verb} takes ${spec.count} ${noun}, not ${positionals.length}: run help`
  }

  return { positionals, strings, switches }
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
  const args = argsOf('fixture', argv, { count: 1, strings: ['row'] })
  if (typeof args === 'string') return args
  const [variant = ''] = args.positionals
  const row = args.strings.get('row')
  if (!VARIANT_RE.test(variant)) return `not a fixture variant: ${variant}`
  if (row === undefined) return 'fixture needs --row <row>'
  if (!ROW_ID_RE.test(row)) return `not a row id: ${row}`

  return { verb: 'fixture', variant, row }
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

function parseCapture(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('capture', argv, { count: 2, strings: ['lines'], switches: ['history'] })
  if (typeof args === 'string') return args
  const [ws = '', window = ''] = args.positionals
  const lines = linesOf(args.strings.get('lines'))
  if (!isWsId(ws)) return `not a workspace id: ${ws}`
  if (!WINDOW_RE.test(window)) return `not a window name: ${window}`
  if (lines === null) return `--lines must be a whole number from 1 to ${HISTORY_LINES_MAX}`

  return { verb: 'capture', ws, window, history: args.switches.has('history'), lines }
}

function parseFinish(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('finish', argv, { count: 1 })
  if (typeof args === 'string') return args
  const [ws = ''] = args.positionals
  if (!isWsId(ws)) return `not a workspace id: ${ws}`

  return { verb: 'finish', ws }
}

function parseHelp(argv: readonly string[]): AgentCommand | string {
  const args = argsOf('help', argv, { count: 0 })
  if (typeof args === 'string') return args

  return { verb: 'help' }
}

const PARSERS: ReadonlyMap<string, Parser> = new Map([
  ['begin', parseBegin],
  ['hold', parseHold],
  ['end', parseEnd],
  ['fixture', parseFixture],
  ['start', parseStart],
  ['capture', parseCapture],
  ['finish', parseFinish],
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

export function parseWsState(value: unknown): WsState | null {
  if (!isRecord(value)) return null
  const { id, row, variant, exclusive, socket, startedAt, status, windows, claims, uuids } = value
  if (typeof id !== 'string' || typeof row !== 'string' || typeof variant !== 'string') return null
  if (typeof exclusive !== 'boolean' || typeof socket !== 'string' || !isCount(startedAt)) return null
  const wsStatus = WS_STATUSES.find(item => item === status)
  if (!wsStatus || !isListOf(windows, isWsWindow) || !isStringList(claims) || !isListOf(uuids, isUuidPair)) return null

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

export function sendRefusal(_text: string, _target: SendTarget): string | null {
  return null
}

export function answerRefusal(_label: string, _exclusive: boolean): string | null {
  return null
}

export function keysRefusal(_keys: readonly string[]): string | null {
  return null
}

export function claimsTaken(_workspaces: readonly WsState[]): ReadonlyMap<string, string> {
  return new Map()
}

export function claimRefusal(_role: string, _wsId: string, _taken: ReadonlyMap<string, string>): string | null {
  return null
}
