import type { FilterContext } from './filter.ts'
import type { GuardSnapshot } from './guard.ts'
import type { Note, NotAutomated, Observation, RowKind, Sidecar, Verdict } from './summary.ts'

export const NOTE_MAX_CHARS = 4000
export const NOTES_MAX = 60
export const RESULT_MAX_BYTES = 200_000
export const HISTORY_LINES_DEFAULT = 200
export const HISTORY_LINES_MAX = 2000
export const ROOT_ROLE = 'root'

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

export function parseCommand(_argv: readonly string[]): AgentCommand | string {
  return { verb: 'help' }
}

export function tokenHash(_token: string): string {
  return ''
}

export function tokenRefusal(_token: string | null | undefined, _storedHash: string | null | undefined): string | null {
  return null
}

export function wsIdOf(_row: string, _hex: string): string | null {
  return null
}

export function isWsId(_value: string): boolean {
  return false
}

export function windowNameFor(_role: string, _taken: readonly string[]): string | null {
  return null
}

export function parseRunState(_value: unknown): RunState | null {
  return null
}

export function parseWsState(_value: unknown): WsState | null {
  return null
}

export function parseGuardSnapshot(_value: unknown): GuardSnapshot | null {
  return null
}

export function agentSidecar(_input: unknown, _meta: ResultMeta): Sidecar | string {
  return 'not implemented'
}

export function filterLines(text: string, _ctx: FilterContext): string {
  return text
}
