/**
 * The readers the setup scan shares, a layer 3 module: where a scan looks (SetupContext), a path in the display form a
 * warning shows, a JSON file read through the port with absent told from unknown, a folder's listing, and the
 * containment check a repo path passes before it is read or listed (D-57, WR-02). It reads only through the init port
 * and keeps no value. It imports core, paths, the port reads and the types, so every setup scan module reads here.
 */
import type { InitIo, PortEntry } from '../../../types'
import { parseJsonValue } from '../../core/json'
import { displayPath } from '../../paths'
import { listingState, missingState } from '../port-read'

/**
 * Where a scan looks: the repo root as the host resolved it and as given, the home folder and CLAUDE_CONFIG_DIR. Every
 * path is absolute and has no trailing slash, or is null. A scan reads from these paths and shows them only in display
 * form (`<repo>/...`, `~/...`), never as they are.
 */
export type SetupContext = {
  readonly root: string
  readonly givenRoot: string
  readonly home: string | null
  readonly configDir: string | null
}

/** A path as a warning shows it: its display form (`<repo>/...`, `~/...`), never the path itself (D-57). */
export function shownPath(ctx: SetupContext, path: string): string {
  return displayPath(path, ctx.home, ctx.root, ctx.configDir)
}

/** The warning for a path the scan could not read: its display form, never the path itself (D-57). */
export function unreadablePathWarning(ctx: SetupContext, path: string): string {
  return `could not read ${shownPath(ctx, path)} (treated as unknown)`
}

/** A JSON file as the port read it: not there, unknown (unreadable, over the cap or not JSON), or its parsed value. */
export type JsonRead =
  | { readonly state: 'absent' }
  | { readonly state: 'unknown' }
  | { readonly state: 'parsed'; readonly value: unknown }

/**
 * A JSON file read through the port, up to `maxBytes`. A file that is not there is absent and quiet; one that cannot be
 * read, is over the cap or does not parse is unknown with a warning, because unknown is never the same as absent.
 */
export async function readJsonFile(
  io: InitIo,
  ctx: SetupContext,
  path: string,
  maxBytes: number,
  warnings: string[],
): Promise<JsonRead> {
  const read = await io.read(path, maxBytes)
  if (read.state === 'absent') return { state: 'absent' }
  const json = read.state === 'text' ? parseJsonValue(read.text) : null
  if (json === null) {
    warnings.push(unreadablePathWarning(ctx, path))

    return { state: 'unknown' }
  }

  return { state: 'parsed', value: json.value }
}

/** The value of a JSON file read by readJsonFile, with its warning; null when the file is absent or unknown. */
export async function readJson(
  io: InitIo,
  ctx: SetupContext,
  path: string,
  maxBytes: number,
  warnings: string[],
): Promise<unknown> {
  const read = await readJsonFile(io, ctx, path, maxBytes, warnings)

  return read.state === 'parsed' ? read.value : null
}

/**
 * A folder's listing, by listingState: a folder that is not there gives [] quietly, and one that cannot be listed gives
 * [] with a warning, because unknown is not absent.
 */
export async function listFolder(
  io: InitIo,
  ctx: SetupContext,
  path: string,
  warnings: string[],
): Promise<readonly PortEntry[]> {
  const listing = await listingState(io, path)
  if (listing.state === 'present') return listing.entries
  if (listing.state === 'unknown') warnings.push(unreadablePathWarning(ctx, path))

  return []
}

/**
 * Whether a repo path may be read or listed: its stat must pass `isInside`, the containment rule for its kind (WR-02).
 * A path that fails it adds a warning; a path with no stat is told apart by missingState, so a missing path is quiet
 * and one the port could not stat adds a warning, because unknown is not absent.
 */
export async function isInsideRepo(
  io: InitIo,
  ctx: SetupContext,
  path: string,
  isInside: (stat: unknown, root: string) => boolean,
  warnings: string[],
): Promise<boolean> {
  const stat = await io.stat(path)
  const isAllowed = stat !== null && isInside(stat, ctx.root)
  if (isAllowed) return true
  if (stat !== null || (await missingState(io, path)) === 'unknown') warnings.push(unreadablePathWarning(ctx, path))

  return false
}
