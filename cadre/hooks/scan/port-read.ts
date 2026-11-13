/**
 * The reads through the init port that the scans share, a layer 3 module: a missing path told from one out of reach,
 * a folder's listing, a repo file read only when it is a regular file inside the root, and the decisions register's
 * port makes around a read, with the version in cadre's own plugin.json. It imports core, paths and the types, so the
 * scans, init, team, start, apply and register read here with no cycle, and none of them reaches into init for it.
 */
import type { InitIo, PortEntry, PortRead, PortStat } from '../../types'
import { isObject } from '../core/json'
import { compareText, utf8Bytes } from '../core/text'
import {
  ENGINE_FOLDER_NAME_MAX_CHARS,
  isFileInsideRoot,
  shortenedProjectDirs,
  startCwdNeedle,
  trimSlash,
} from '../paths'
import { MAX_READ_BYTES } from './facts/normalize'

/**
 * Whether a path the port could not stat or list is missing (`absent`) or there but out of reach (`unknown`). The
 * port's read answers `absent` only for a path that is not there, so a read capped at 0 bytes tells the two apart and
 * never returns any of the file's text. The setup scan uses the same probe, so both scans tell a missing path from a
 * failed one the same way.
 */
export async function missingState(io: InitIo, path: string): Promise<'absent' | 'unknown'> {
  const probe = await io.read(path, 0)

  return probe.state === 'absent' ? 'absent' : 'unknown'
}

/** A folder as listingState sees it: present with its entries, or absent, or unknown when it cannot be listed. */
export type Listing =
  | { readonly state: 'present'; readonly entries: readonly PortEntry[] }
  | { readonly state: 'absent' }
  | { readonly state: 'unknown' }

/**
 * A folder's listing through the port. The port's list answers null both for a folder that is not there and for one
 * it cannot list, so a null listing is told apart by missingState: a missing path is `absent`, anything else (a file,
 * a failed stat or listing) is `unknown`, because unknown is never the same as absent.
 */
export async function listingState(io: InitIo, path: string): Promise<Listing> {
  const entries = await io.list(path)
  if (entries !== null) return { state: 'present', entries }

  return { state: await missingState(io, path) }
}

/**
 * The project folder the engine uses for `folder`. Only a name over ENGINE_FOLDER_NAME_MAX_CHARS lists the parent; a
 * shortened candidate there is followed only when it is the one `holdsStart` verifies, else the name stays as given.
 */
export async function followedProjectFolder(
  io: InitIo,
  folder: string,
  holdsStart: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const cut = folder.lastIndexOf('/')
  const name = folder.slice(cut + 1)
  if (name.length <= ENGINE_FOLDER_NAME_MAX_CHARS) return folder
  const parent = folder.slice(0, cut)
  const entries = await io.list(parent)
  if (entries === null) return folder
  const verified: string[] = []
  for (const candidate of shortenedProjectDirs(name, entries)) {
    if (await holdsStart(`${parent}/${candidate}`)) verified.push(candidate)
  }
  if (verified.length !== 1) return folder

  return `${parent}/${verified[0] ?? name}`
}

/** The most transcripts of one candidate folder readsStartCwd reads: the newest ones. */
const CWD_CHECK_MAX_TRANSCRIPTS = 5

/** The most UTF-8 bytes of one transcript readsStartCwd reads; a bigger one is not read. */
const CWD_CHECK_MAX_BYTES = 4 * 1024 * 1024

/**
 * A check for followedProjectFolder through the port's reads: a folder passes when one of its newest regular `.jsonl`
 * files holds a row whose cwd is `startFolder` (startCwdNeedle).
 */
export function readsStartCwd(io: InitIo, startFolder: string): (folder: string) => Promise<boolean> {
  const needle = startCwdNeedle(startFolder)

  return async folder => {
    const entries = await io.list(folder)
    if (entries === null) return false
    const transcripts = entries
      .filter(entry => entry.kind === 'file' && !entry.isLink && entry.name.endsWith('.jsonl'))
      .sort((a, b) => b.mtimeMs - a.mtimeMs || compareText(a.name, b.name))
      .slice(0, CWD_CHECK_MAX_TRANSCRIPTS)
    for (const transcript of transcripts) {
      const read = await io.read(`${folder}/${transcript.name}`, CWD_CHECK_MAX_BYTES)
      if (read.state === 'text' && read.text.includes(needle)) return true
    }

    return false
  }
}

/**
 * Reads a repo file through the port, only when its resolved stat is a regular file whose real path is inside the
 * root (WR-02), so a link that leaves the repo, a folder, a device or a FIFO is `unknown` and never read. A path with
 * no stat is never read either: missingState tells a missing file (`absent`) from one the port could not stat
 * (`unknown`). A file over `maxBytes` UTF-8 bytes comes back `too-large`.
 */
export async function readRepoFile(io: InitIo, root: string, relPath: string, maxBytes: number): Promise<PortRead> {
  const path = `${trimSlash(root)}/${relPath}`
  const stat = await io.stat(path)
  if (stat === null) return { state: await missingState(io, path) }
  if (!isFileInsideRoot(stat, root)) return { state: 'unknown' }

  return io.read(path, maxBytes)
}

/**
 * What the init port answers before it reads a file, or null when the file may be read: `absent` only when the probe
 * says the path is not there, `unknown` when the probe or the stat failed or the stat shows anything but a regular
 * file (a folder, FIFO or device is never read), `too-large` when the stat size is over `maxBytes` (Pitfall 6).
 */
export function portProbeOf(isThere: boolean | null, stat: PortStat | null, maxBytes: number): PortRead | null {
  if (isThere === false) return { state: 'absent' }
  if (isThere === null) return { state: 'unknown' }
  if (stat === null || stat.kind !== 'file') return { state: 'unknown' }
  if (stat.size > maxBytes) return { state: 'too-large', bytes: stat.size }

  return null
}

/** What the init port answers once a file was read: `unknown` when no text came, `too-large` over `maxBytes` UTF-8 bytes. */
export function portTextOf(text: unknown, maxBytes: number): PortRead {
  if (typeof text !== 'string') return { state: 'unknown' }
  const bytes = utf8Bytes(text)
  if (bytes > maxBytes) return { state: 'too-large', bytes }

  return { state: 'text', text }
}

/** A plugin version as cadre writes it: three numbers joined by dots. */
const PLUGIN_VERSION = /^\d+\.\d+\.\d+$/

/** The `version` in the text of cadre's own plugin.json when it is a plain `x.y.z`; null for anything else (D-89). */
export function pluginVersionOf(text: string): string | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(value)) return null
  const { version } = value
  if (typeof version !== 'string' || !PLUGIN_VERSION.test(version)) return null

  return version
}

/** Each repo-relative path read through readRepoFile, one at a time, keyed by the path. */
export async function readPaths(
  io: InitIo,
  root: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, PortRead>> {
  const disk = new Map<string, PortRead>()
  for (const path of paths) disk.set(path, await readRepoFile(io, root, path, MAX_READ_BYTES))

  return disk
}
