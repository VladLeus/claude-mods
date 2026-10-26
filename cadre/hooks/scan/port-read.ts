/**
 * The reads through the init port that the scans share, a layer 3 module: a missing path told from one out of reach,
 * a folder's listing, a repo file read only when it is a regular file inside the root, and the decisions register's
 * port makes around a read, with the version in cadre's own plugin.json. It imports core, paths and the types, so the
 * scans, init, team, start, apply and register read here with no cycle, and none of them reaches into init for it.
 */
import type { InitIo, PortEntry, PortRead, PortStat } from '../../types'
import { isObject } from '../core/json'
import { utf8Bytes } from '../core/text'
import { isFileInsideRoot, trimSlash } from '../paths'

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
