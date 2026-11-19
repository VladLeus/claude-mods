import type { Stats } from 'node:fs'
import { lstat, readdir, readFile, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { EntryKind, TopEntry } from './config-state.ts'
import { HarnessError } from './errors.ts'
import { isRecord } from './filter.ts'
import { sha256 } from './hash.ts'
import { isUnder } from './scratch.ts'

export const SUITE_MARKERS = [
  'claude-plugins-official',
  'claude-security@',
  'security-guidance@',
  '"local-mods"',
  'cadre@local-mods',
] as const

export const GUARD_FILES = [
  '.claude.json',
  '.claude/settings.json',
  '.claude/plugins/known_marketplaces.json',
  '.claude/plugins/installed_plugins.json',
] as const

export type Needles = {
  readonly paths: readonly string[]
  readonly encoded: readonly string[]
}

export type KeychainDigest = {
  readonly count: number
  readonly hash: string
}

export type WatchedFile = {
  readonly name: string
  readonly mtimeMs: number | null
  readonly size: number | null
  readonly needles: readonly boolean[]
  readonly markers: readonly boolean[]
}

export type GuardSnapshot = {
  readonly top: readonly TopEntry[]
  readonly projects: readonly string[]
  readonly files: readonly WatchedFile[]
  readonly sessionFiles: readonly string[]
  readonly keychain: KeychainDigest | null | undefined
}

export type GuardContext = {
  readonly needles: Needles
  readonly refusals: number
  readonly recorded: ReadonlySet<string>
  readonly beatCwds: ReadonlyMap<string, string>
}

export type GuardResult = {
  readonly failures: readonly string[]
  readonly warnings: readonly string[]
}

export type FleetBeat = {
  readonly id: string
  readonly cwd: string | null
}

export type Removal = {
  readonly removed: number
  readonly failures: readonly string[]
}

const WATCHED_FILES = [...GUARD_FILES, '.gitconfig'] as const
const PLUGIN_FILES: ReadonlySet<string> = new Set(GUARD_FILES.slice(1))
const SESSION_DIRS = ['autopilot', 'fleet'] as const
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SESSION_ID_IN_NAME_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/
const KEYCHAIN_SERVICE_RE = /^\s*"svce"<blob>="([^"]*)"/gm
const KEYCHAIN_SERVICE_PREFIX = 'Claude Code'
const KEYCHAIN_HASH_CHARS = 12
const TRANSCRIPT_SUFFIX = '.jsonl'
const BEAT_SUFFIX = '.json'
const NO_LINES: GuardResult = { failures: [], warnings: [] }

function encodePath(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

export function needlesOf(scratchBase: string, e2eDir: string): Needles {
  const paths = [scratchBase, e2eDir]

  return { paths, encoded: paths.map(encodePath) }
}

function isUnderNeedle(path: string, needles: Needles): boolean {
  return needles.paths.some(root => path === root || isUnder(path, root))
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function keychainDigest(text: string): KeychainDigest {
  const names = [...text.matchAll(KEYCHAIN_SERVICE_RE)]
    .map(match => match[1] ?? '')
    .filter(name => name.startsWith(KEYCHAIN_SERVICE_PREFIX))
    .sort()

  return { count: names.length, hash: sha256(names.join('\n')).slice(0, KEYCHAIN_HASH_CHARS) }
}

export function globalAwayActive(text: string, now: number): boolean {
  const value = parseJson(text)
  if (!isRecord(value) || !isRecord(value.away)) return false
  const until = value.away.until

  return typeof until === 'number' && until > now
}

function transcriptId(rel: string): string | null {
  const [folder, name, ...rest] = rel.split('/')
  if (!folder || !name || rest.length > 0 || !name.endsWith(TRANSCRIPT_SUFFIX)) return null

  return name.slice(0, -TRANSCRIPT_SUFFIX.length)
}

export function testSessionIds(
  e2eProjectsJsonl: readonly string[],
  beats: readonly FleetBeat[],
  scratchBase: string,
  e2eDir: string,
): readonly string[] {
  const needles = needlesOf(scratchBase, e2eDir)
  const fromTranscripts = e2eProjectsJsonl.map(transcriptId).filter(id => id !== null)
  const fromBeats = beats.filter(beat => beat.cwd !== null && isUnderNeedle(beat.cwd, needles)).map(beat => beat.id)

  return [...new Set([...fromTranscripts, ...fromBeats])].filter(id => SESSION_ID_RE.test(id)).sort()
}

export async function projectTranscripts(e2eDir: string): Promise<readonly string[]> {
  const root = join(e2eDir, 'projects')
  const found: string[] = []
  for (const folder of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!folder.isDirectory()) continue
    const files = await readdir(join(root, folder.name), { withFileTypes: true }).catch(() => [])
    const names = files.filter(file => file.isFile() && file.name.endsWith(TRANSCRIPT_SUFFIX)).map(file => file.name)
    found.push(...names.map(name => `${folder.name}/${name}`))
  }

  return found.sort()
}

function beatCwd(text: string): string | null {
  const value = parseJson(text)

  return isRecord(value) && typeof value.cwd === 'string' ? value.cwd : null
}

export async function fleetBeats(hostHome: string): Promise<readonly FleetBeat[]> {
  const dir = join(hostHome, '.claude', 'fleet')
  const beats: FleetBeat[] = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile() || !entry.name.endsWith(BEAT_SUFFIX)) continue
    const text = await readFile(join(dir, entry.name), 'utf8').catch(() => '')
    beats.push({ id: entry.name.slice(0, -BEAT_SUFFIX.length), cwd: beatCwd(text) })
  }

  return beats
}

export async function fenceRefusals(scratch: string): Promise<number> {
  const text = await readFile(join(scratch, 'fence', 'refused.log'), 'utf8').catch(() => '')

  return text.split('\n').filter(line => line.length > 0).length
}

function kindOf(stats: Stats): EntryKind {
  if (stats.isSymbolicLink()) return 'link'
  if (stats.isDirectory()) return 'dir'
  if (stats.isFile()) return 'file'

  return 'other'
}

async function topEntries(dir: string): Promise<readonly TopEntry[]> {
  const entries: TopEntry[] = []
  for (const name of (await readdir(dir).catch(() => [])).sort()) {
    const stats = await lstat(join(dir, name)).catch(() => null)
    if (stats) entries.push({ name, kind: kindOf(stats), mtimeMs: stats.mtimeMs })
  }

  return entries
}

async function watchedFile(home: string, name: string, needles: Needles): Promise<WatchedFile> {
  const path = join(home, name)
  const stats = await stat(path).catch(() => null)
  const isGuarded = GUARD_FILES.some(item => item === name)
  // The text is searched for the fixed needles and markers only and dropped here; only booleans are kept.
  const text = isGuarded && stats?.isFile() ? await readFile(path, 'utf8').catch(() => null) : null
  const holds = (needle: string): boolean => text !== null && text.includes(needle)

  return {
    name,
    mtimeMs: stats ? stats.mtimeMs : null,
    size: stats ? stats.size : null,
    needles: isGuarded ? needles.paths.map(holds) : [],
    markers: PLUGIN_FILES.has(name) ? SUITE_MARKERS.map(holds) : [],
  }
}

async function treeOf(root: string, rel: string): Promise<readonly string[]> {
  const found: string[] = []
  for (const entry of await readdir(join(root, rel), { withFileTypes: true }).catch(() => [])) {
    const path = `${rel}/${entry.name}`
    found.push(path)
    if (entry.isDirectory()) found.push(...await treeOf(root, path))
  }

  return found
}

export async function guardSnapshot(
  hostHome: string,
  needles: Needles,
  keychain: KeychainDigest | null | undefined,
): Promise<GuardSnapshot> {
  const config = join(hostHome, '.claude')
  const sessionTrees = await Promise.all(SESSION_DIRS.map(name => treeOf(config, name)))

  return {
    top: await topEntries(config),
    projects: (await readdir(join(config, 'projects')).catch(() => [])).sort(),
    files: await Promise.all(WATCHED_FILES.map(name => watchedFile(hostHome, name, needles))),
    sessionFiles: sessionTrees.flat().sort(),
    keychain,
  }
}

function added(before: readonly string[], after: readonly string[]): readonly string[] {
  const was = new Set(before)

  return after.filter(item => !was.has(item))
}

function presenceLine(label: string, was: boolean, is: boolean): string | null {
  if (!was && is) return `guard: ${label} appeared during the run`
  if (was && !is) return `guard: ${label} disappeared during the run`

  return null
}

function projectLines(before: GuardSnapshot, after: GuardSnapshot, needles: Needles): GuardResult {
  const created = added(before.projects, after.projects)
  const suite = created.filter(name => needles.encoded.some(form => name.startsWith(form))).length
  const others = created.length - suite
  const removed = added(after.projects, before.projects).length

  return {
    failures: suite > 0 ? [`guard: ${suite} suite entries in projects/`] : [],
    warnings: [
      ...(others > 0 ? [`guard: ${others} other new entries in projects/`] : []),
      ...(removed > 0 ? [`guard: ${removed} entries removed from projects/`] : []),
    ],
  }
}

function topLines(before: GuardSnapshot, after: GuardSnapshot): GuardResult {
  const was = new Map(before.top.map(entry => [entry.name, entry]))
  const now = new Map(after.top.map(entry => [entry.name, entry]))
  const names = [...new Set([...was.keys(), ...now.keys()])].sort()
  const warnings = names.flatMap(name => {
    const old = was.get(name)
    const current = now.get(name)
    const label = `~/.claude/${name}`
    const presence = presenceLine(label, old !== undefined, current !== undefined)
    if (presence) return [presence]
    if (old?.kind === current?.kind && old?.mtimeMs === current?.mtimeMs) return []

    return [`guard: ${label} changed during the run`]
  })

  return { failures: [], warnings }
}

function fileLines(old: WatchedFile, current: WatchedFile): GuardResult {
  const label = `~/${current.name}`
  const gained = (now: readonly boolean[], was: readonly boolean[], index: number): boolean =>
    now[index] === true && was[index] !== true
  const traced = current.needles.some((_holds, index) => gained(current.needles, old.needles, index))
  const markers = SUITE_MARKERS.filter((_marker, index) => gained(current.markers, old.markers, index))
  const presence = presenceLine(label, old.mtimeMs !== null, current.mtimeMs !== null)
  const isChanged = old.mtimeMs !== current.mtimeMs || old.size !== current.size
  const change = presence ?? (isChanged ? `guard: ${label} changed during the run` : null)

  return {
    failures: [
      ...(traced ? [`guard: suite trace in ${label}`] : []),
      ...markers.map(marker => `guard: suite plugin ${marker} added in ${label}`),
    ],
    warnings: change ? [change] : [],
  }
}

function sessionIdOf(rel: string): string | null {
  return SESSION_ID_IN_NAME_RE.exec(basename(rel))?.[0] ?? null
}

function isSuiteSession(id: string | null, ctx: GuardContext): boolean {
  if (id === null) return false
  if (ctx.recorded.has(id)) return true
  const cwd = ctx.beatCwds.get(id)

  return cwd !== undefined && isUnderNeedle(cwd, ctx.needles)
}

function sessionLines(before: GuardSnapshot, after: GuardSnapshot, ctx: GuardContext): GuardResult {
  const created = added(before.sessionFiles, after.sessionFiles)
  const left = created.filter(rel => isSuiteSession(sessionIdOf(rel), ctx))
  const removed = added(after.sessionFiles, before.sessionFiles)

  return {
    failures: left.map(rel => `guard: test session file left: ~/.claude/${rel}`),
    warnings: [
      ...created.filter(rel => !left.includes(rel)).map(rel => `guard: ~/.claude/${rel} appeared during the run`),
      ...removed.map(rel => `guard: ~/.claude/${rel} disappeared during the run`),
    ],
  }
}

function keychainLines(before: GuardSnapshot, after: GuardSnapshot): GuardResult {
  const old = before.keychain
  const current = after.keychain
  if (old === undefined && current === undefined) return NO_LINES
  if (!old || !current) return { failures: [], warnings: ['guard: keychain listing unavailable'] }
  if (old.count === current.count && old.hash === current.hash) return NO_LINES

  return { failures: [], warnings: [`guard: Claude Code keychain items changed (${old.count} -> ${current.count})`] }
}

export function compareGuard(before: GuardSnapshot, after: GuardSnapshot, ctx: GuardContext): GuardResult {
  const files = after.files.flatMap(current => {
    const old = before.files.find(item => item.name === current.name)
    return old ? [fileLines(old, current)] : []
  })
  const refusals: GuardResult = {
    failures: ctx.refusals > 0 ? [`guard: claude started ${ctx.refusals} times without the e2e config dir`] : [],
    warnings: [],
  }
  const parts = [
    projectLines(before, after, ctx.needles),
    topLines(before, after),
    ...files,
    sessionLines(before, after, ctx),
    keychainLines(before, after),
    refusals,
  ]

  return {
    failures: [...new Set(parts.flatMap(part => part.failures))],
    warnings: [...new Set(parts.flatMap(part => part.warnings))],
  }
}

function sessionFilePaths(id: string): readonly string[] {
  return [
    `autopilot/${id}.json`,
    `autopilot/${id}.log`,
    `autopilot/status/global.json.tmp-${id}`,
    `fleet/${id}.json`,
  ]
}

async function removeFile(path: string): Promise<'absent' | 'removed' | 'failed'> {
  const stats = await lstat(path).catch(() => null)
  if (!stats) return 'absent'
  if (!stats.isFile()) return 'failed'
  if (await unlink(path).then(() => true, () => false)) return 'removed'

  return await lstat(path).then(() => 'failed' as const, () => 'absent' as const)
}

export async function removeSessionFiles(hostHome: string, ids: readonly string[]): Promise<Removal> {
  if (ids.some(id => !SESSION_ID_RE.test(id))) throw new HarnessError('removeSessionFiles refused: not a session id')
  const config = join(hostHome, '.claude')
  let removed = 0
  const failures: string[] = []
  for (const rel of [...new Set(ids)].flatMap(sessionFilePaths)) {
    const outcome = await removeFile(join(config, rel))
    if (outcome === 'removed') removed += 1
    if (outcome === 'failed') failures.push(rel)
  }

  return { removed, failures }
}
