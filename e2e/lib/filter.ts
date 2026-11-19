import { readFileSync } from 'node:fs'
import { hostname, userInfo } from 'node:os'
import { LeakError } from './errors.ts'
import type { Env } from './proc.ts'

export type FilterValues = {
  readonly credentials: readonly string[]
  readonly identities: readonly string[]
}

export type FilterContext = {
  readonly envSecrets: readonly string[]
  readonly credentials: readonly string[]
  readonly identities: readonly string[]
  readonly scratch: readonly string[]
  readonly home: string | null
  readonly user: string | null
  readonly hosts: readonly string[]
  readonly run: string | null
  readonly uuids: Map<string, number>
}

export type Residue = {
  readonly line: number
  readonly kinds: readonly string[]
}

const SECRET_NAME_RE = /TOKEN|KEY|SECRET/i
const MIN_NAME_CHARS = 3
const PATH_END = `(?=$|[/\\s"',:;)\\]}<>])`
const ENCODED_END = '(?=$|[^A-Za-z0-9])'
const SK_ANT_RE = /sk-ant-[A-Za-z0-9_-]+/g
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const USER_PATH_RE = /\/(Users|home)\/[^/\s"',:;)\]}<>]+/g
const ENCODED_USER_RE = /-(?:Users|home)-[A-Za-z0-9]+-/g
const ENCODED_TMP_RE = /-(?:private-)?var-folders-[A-Za-z0-9-]+?-T-/g
const BARE_USER_PATH_RE = /\/(?:Users|home)\/(?!<)/g
const TEMP_PATH_RE = /\/var\/folders\/|\/private\/var\//g

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function parseFilterValues(text: string): FilterValues | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(value)) return null
  const { credentials, identities } = value
  if (!isStringList(credentials) || !isStringList(identities)) return null

  return { credentials, identities }
}

function readFilterFile(path: string): FilterValues | null {
  try {
    return parseFilterValues(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function longestFirst(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter(value => value.length > 0))].sort((a, b) => b.length - a.length)
}

function longEnough(name: string | null | undefined): string | null {
  return name && name.length >= MIN_NAME_CHARS ? name : null
}

function currentUser(env: Env): string | null {
  try {
    return longEnough(userInfo().username)
  } catch {
    return longEnough(env.USER)
  }
}

function hostForms(): readonly string[] {
  const host = hostname()
  const forms = [host, host.split('.')[0]].map(longEnough).filter(form => form !== null)

  return longestFirst(forms)
}

function scratchForms(root: string): readonly string[] {
  if (!root.startsWith('/private/')) return [root]

  return longestFirst([root, root.slice('/private'.length)])
}

export function filterContext(env: Env, extra: Partial<FilterValues> = {}): FilterContext {
  const file = env.E2E_FILTER_FILE ? readFilterFile(env.E2E_FILTER_FILE) : null
  const envSecrets = Object.entries(env).filter(([name]) => SECRET_NAME_RE.test(name)).map(([, value]) => value ?? '')

  return {
    envSecrets: longestFirst(envSecrets),
    credentials: longestFirst([...(file?.credentials ?? []), ...(extra.credentials ?? [])]),
    identities: longestFirst([...(file?.identities ?? []), ...(extra.identities ?? [])]),
    scratch: env.E2E_SCRATCH ? scratchForms(env.E2E_SCRATCH) : [],
    home: env.HOME && env.HOME.length > 1 ? env.HOME : null,
    user: currentUser(env),
    hosts: hostForms(),
    run: env.E2E_RUN || null,
    uuids: new Map(),
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceExact(text: string, values: readonly string[], placeholder: string): string {
  return values.reduce((out, value) => out.split(value).join(placeholder), text)
}

function replaceInsensitive(text: string, values: readonly string[], placeholder: string): string {
  return values.reduce((out, value) => out.replace(new RegExp(escapeRegExp(value), 'gi'), () => placeholder), text)
}

function encodePath(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

function encodedForms(ctx: FilterContext): readonly string[] {
  const paths = ctx.home ? [...ctx.scratch, ctx.home] : ctx.scratch

  return longestFirst(paths.map(encodePath).filter(form => form.length > 1))
}

function uuidNumber(uuids: Map<string, number>, uuid: string): number {
  const key = uuid.toLowerCase()
  const known = uuids.get(key)
  if (known !== undefined) return known
  const next = uuids.size + 1
  uuids.set(key, next)

  return next
}

function replaceNames(text: string, ctx: FilterContext): string {
  const user = ctx.user ? [{ value: ctx.user, placeholder: '<user>' }] : []
  const names = [...user, ...ctx.hosts.map(host => ({ value: host, placeholder: '<host>' }))]
  const ordered = names.sort((a, b) => b.value.length - a.value.length)

  return ordered.reduce((out, name) => replaceInsensitive(out, [name.value], name.placeholder), text)
}

export function filterText(text: string, ctx: FilterContext): string {
  let out = replaceExact(text, ctx.envSecrets, '<secret>')
  out = replaceExact(out, ctx.credentials, '<secret>')
  out = replaceInsensitive(out, ctx.identities, '<identity>')
  out = out.replace(SK_ANT_RE, '<secret>')
  out = replaceExact(out, ctx.scratch, '<scratch>')
  if (ctx.home) out = out.replace(new RegExp(`${escapeRegExp(ctx.home)}${PATH_END}`, 'g'), '~')
  out = out.replace(USER_PATH_RE, (_match, dir: string) => `/${dir}/<user>`)
  for (const form of encodedForms(ctx)) {
    out = out.replace(new RegExp(`${escapeRegExp(form)}${ENCODED_END}`, 'g'), '-<path>')
  }
  out = out.replace(ENCODED_USER_RE, '-<path>-').replace(ENCODED_TMP_RE, '-<path>-')
  out = out.replace(UUID_RE, uuid => `<uuid-${uuidNumber(ctx.uuids, uuid)}>`)
  out = out.replace(EMAIL_RE, '<email>')
  out = replaceNames(out, ctx)
  if (ctx.run) out = out.split(ctx.run).join('<run>')

  return out
}

function indicesOf(text: string, needle: string, insensitive: boolean): readonly number[] {
  if (!needle) return []
  const haystack = insensitive ? text.toLowerCase() : text
  const target = insensitive ? needle.toLowerCase() : needle
  const found: number[] = []
  for (let index = haystack.indexOf(target); index !== -1; index = haystack.indexOf(target, index + 1)) {
    found.push(index)
  }

  return found
}

function matchIndices(text: string, re: RegExp): readonly number[] {
  return [...text.matchAll(re)].map(match => match.index)
}

function lineOf(text: string, index: number): number {
  let line = 1
  for (let at = text.indexOf('\n'); at !== -1 && at < index; at = text.indexOf('\n', at + 1)) line += 1

  return line
}

export function residueOf(text: string, ctx: FilterContext): readonly Residue[] {
  const hits: { index: number, kind: string }[] = []
  const add = (indices: readonly number[], kind: string): void => {
    for (const index of indices) hits.push({ index, kind })
  }
  add(indicesOf(text, ctx.home ?? '', false), 'home')
  add(matchIndices(text, BARE_USER_PATH_RE), 'user path')
  add(matchIndices(text, TEMP_PATH_RE), 'temp path')
  add(matchIndices(text, UUID_RE), 'uuid')
  add(indicesOf(text, 'sk-ant-', false), 'token')
  for (const value of ctx.envSecrets) add(indicesOf(text, value, false), 'env secret')
  for (const value of ctx.credentials) add(indicesOf(text, value, false), 'credential')
  for (const value of ctx.identities) add(indicesOf(text, value, true), 'identity')
  add(matchIndices(text, EMAIL_RE), 'email')
  add(indicesOf(text, ctx.user ?? '', true), 'user name')
  for (const host of ctx.hosts) add(indicesOf(text, host, true), 'host name')

  const byLine = new Map<number, Set<string>>()
  for (const hit of hits) {
    const line = lineOf(text, hit.index)
    byLine.set(line, (byLine.get(line) ?? new Set<string>()).add(hit.kind))
  }

  return [...byLine.entries()].sort(([a], [b]) => a - b).map(([line, kinds]) => ({ line, kinds: [...kinds] }))
}

export function leakCheck(text: string, ctx: FilterContext): void {
  const residue = residueOf(text, ctx)
  if (residue.length === 0) return
  const where = residue.map(item => `line ${item.line} (${item.kinds.join(', ')})`).join(', ')

  throw new LeakError(`leak check failed: residue on ${where}`, residue.map(item => item.line))
}
