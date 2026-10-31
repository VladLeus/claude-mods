/**
 * The regen side read, a layer 10 module: the scans a regen plans from, and the files and memories a role's records
 * name, read again through the port, the repo side from role.json and the private side from its hand-out record, each
 * only where the record names a plain path in the repo or a known folder (G-02-1f Regen, AUTO-PICK #19 Q5, Q9). It
 * imports the apply runner and private files, core, paths, launch, the scans, team, the part changes and the types, so
 * regen's entry, hand-out and plan read it here.
 */
import type {
  CadreState,
  CompiledScope,
  HostIo,
  InitIo,
  InitLocations,
  InstructionPart,
  InstructionPartRecord,
  Manifest,
  MemoryItem,
  ReadState,
  RoleSpec,
  SetupScan,
} from '../../types'
import { instructionsRecordPath, parseInstructionsRecord } from '../apply/private'
import type { InstructionsRecord, RecordedMemory } from '../apply/private'
import { privateFoldersUnknownWarning, roleFoldersOf } from '../apply/run'
import { sha256Hex } from '../core/hash'
import { clean, utf8Bytes } from '../core/text'
import { isSafeFileName } from '../launch/links'
import { t } from '../locales/t'
import { MARKDOWN_EXTENSION, memoryFoldersOf, pathFromDisplay, relativeTo, trimSlash, userDirOf } from '../paths'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import type { Gathered } from '../scan/gather'
import { isMemoryIndexName, memoryOverSizeWarning, unreadableWarning } from '../scan/instructions/memories'
import { isReadableConfigFile, MAX_TOTAL_BYTES, overSizeWarning, partsOfText } from '../scan/instructions/read'
import type { InstructionSources } from '../scan/instructions/read'
import { readRepoFile } from '../scan/port-read'
import { compileTeam, regenRefusal } from '../team'
import type { RegenRead } from '../team'
import type { MemoryRecord, RegenItems } from './part-changes'

/**
 * The reply when `.cadre/manifest.json` is not there (A2): regen cannot keep the manifest entries of the other roles
 * without it, so it refuses; init plans every role again and rebuilds the whole manifest.
 */
export const REGEN_NO_MANIFEST = t('regen.sideRead.regenNoManifest')

/**
 * The reply when `.cadre/manifest.json` cannot be read, is too large or is not a valid manifest (A2): regen cannot keep
 * the manifest entries of the other roles from it, so it refuses; init plans every role again and rebuilds the whole
 * manifest.
 */
export const REGEN_BAD_MANIFEST = t('regen.sideRead.regenBadManifest')

/**
 * The warning of a --dry-run regen of a role with part records (AUTO-PICK #19 Q5): its private hand-out record is not
 * read, since naming its folder runs git and a dry run holds no host.
 */
export function dryRunPrivateWarning(id: string): string {
  return t('regen.sideRead.dryRunPrivateWarning', { id })
}

/**
 * The warning when a role's private hand-out record cannot be used (AUTO-PICK #19 Q9): it cannot be read, is not a
 * valid record, or names a file regen may not read, so its global parts and memories are not compared or rebuilt.
 */
export function unusableRecordWarning(id: string): string {
  return t('regen.sideRead.unusableRecordWarning', { id })
}

/**
 * The warning when regen stopped reading one side of a role at MAX_TOTAL_BYTES (02-GAPS-B3 C8): that side is left as
 * it is, its parts not compared.
 */
export function regenTotalWarning(id: string): string {
  return t('regen.sideRead.regenTotalWarning', { value: MAX_TOTAL_BYTES / 1024, id })
}

/** What a regen plans from (D-68, A2): the scans and compiled scopes of the team, and the last manifest in full. */
export type RegenScans = {
  readonly gathered: Gathered
  readonly scopes: ReadonlyMap<string, CompiledScope>
  readonly manifest: Manifest
  readonly manifestState: ReadState
}

/**
 * The scans of a regen (D-68, D-70, D-72): every listed role compiled as init compiles it, on its own framework or the
 * repo default and attended by the current config (compileTeam), so the index lists the whole team; ~/.claude.json is
 * read only when cadre.json records the consent (readUserMcp, A1), so the MCP denies init compiled from it stay.
 * Without a manifest read in full regen cannot keep the other roles' entries, so it refuses (A2), as the scan read it:
 * REGEN_NO_MANIFEST when it is not there, REGEN_BAD_MANIFEST when it cannot be read, is too large or is not valid.
 */
export async function regenScans(
  io: InitIo,
  locations: InitLocations,
  state: CadreState,
  roles: readonly RoleSpec[],
): Promise<RegenRead<RegenScans>> {
  const { gathered, scopes } = await compileTeam(io, locations, state, roles)
  const { manifest, manifestState } = gathered.repo.cadre
  if (manifest === null) return regenRefusal(manifestState === 'absent' ? REGEN_NO_MANIFEST : REGEN_BAD_MANIFEST)

  return { kind: 'ok', value: { gathered, scopes, manifest, manifestState } }
}

/** Whether a part's file and heading are the ones a record names (G-02-1f Regen). */
export function isNamedBy(
  record: Pick<InstructionPartRecord, 'file' | 'heading'>,
  part: Pick<InstructionPart, 'file' | 'heading'>,
): boolean {
  return record.file === part.file && record.heading === part.heading
}

/** The files these records name, once each, in record order: the only files regen reads again (D-142 rg2-a). */
function recordedFiles(records: readonly InstructionPartRecord[]): string[] {
  return Array.from(new Set(records.map(record => record.file)))
}

/**
 * One side of a role's records as regen reads it again (G-02-1f Regen): its repo parts (role.json) or its global parts
 * and memories (its private hand-out record), the parts it was given and not given and the memories it was given, as
 * recorded, and the parts and memories of what they name as they are now.
 */
export type RegenSide = {
  readonly given: readonly InstructionPartRecord[]
  readonly notGiven: readonly InstructionPartRecord[]
  readonly memories: readonly MemoryRecord[]
  readonly current: RegenItems
}

/**
 * A side regen read again, or why it is left as it is (AUTO-PICK #19 Q8, Q9), with the warnings of the files it could
 * not read or of the record it cannot use.
 */
export type SideRead =
  | { readonly kind: 'read'; readonly side: RegenSide }
  | { readonly kind: 'kept'; readonly warnings: readonly string[] }

/**
 * A role's repo side read again (G-02-1f Regen, D-142 rg2-a): each file its role.json records name, once, in record
 * order, through readRepoFile (a link out of the repo is never read), split into hashed parts (partsOfText). A missing
 * file has no part, so its records are removed; a file that cannot be read (unreadableWarning) or is over the read cap
 * (overSizeWarning) leaves the whole side as it is (AUTO-PICK #19 Q8), since its parts could not be rebuilt; so does a
 * text that would take the side past MAX_TOTAL_BYTES in all, which stops the read (regenTotalWarning, 02-GAPS-B3 C8).
 */
export async function repoSideRead(io: InitIo, root: string, role: RoleSpec): Promise<SideRead> {
  const given = role.instructionParts ?? []
  const notGiven = role.instructionPartsNotGiven ?? []
  const parts: InstructionPart[] = []
  const warnings: string[] = []
  let total = 0
  for (const file of recordedFiles([...given, ...notGiven])) {
    const read = await readRepoFile(io, root, file, MAX_READ_BYTES)
    if (read.state === 'unknown') warnings.push(unreadableWarning(clean(file)))
    if (read.state === 'too-large') warnings.push(overSizeWarning(clean(file)))
    if (read.state !== 'text') continue
    total += utf8Bytes(read.text)
    if (total > MAX_TOTAL_BYTES) return { kind: 'kept', warnings: [regenTotalWarning(role.id)] }
    parts.push(...(await partsOfText(file, 'repo', read.text, parts.length)))
  }
  if (warnings.length > 0) return { kind: 'kept', warnings }

  return { kind: 'read', side: { given, notGiven, memories: [], current: { parts, memories: [] } } }
}

/**
 * Where a role's private record may name a file regen reads again (AUTO-PICK #19 Q9): the locations its display forms
 * are read back with, the config folder when it is outside the repo, the CLAUDE.md files of the chain above the repo,
 * and the memory folders of this repo.
 */
export type RecordPlaces = {
  readonly sources: Pick<InstructionSources, 'root' | 'home' | 'configDir'>
  readonly userDir: string | null
  readonly chain: readonly string[]
  readonly memoryFolders: readonly string[]
}

/**
 * The places a private record may name (AUTO-PICK #19 Q9), as init's read takes them: the config folder only when it
 * is not inside the repo (02-GAPS-B2 N10), the chain CLAUDE.md files of the setup scan read back from their display
 * form, those above the repo only (02-GAPS-B2 S2), and the memory folders of this repo (memoryFoldersOf).
 */
export function recordPlacesOf(locations: InitLocations, setup: SetupScan): RecordPlaces {
  const { root, home, configDir } = locations
  const sources = { root, home, configDir }
  // An ignored CLAUDE_CONFIG_DIR is named in regen's scan warnings, so its warning is not repeated here (D-238).
  const userDir = userDirOf(locations, root, [])
  const folder = userDir === null || relativeTo(userDir, root) !== null ? '' : trimSlash(userDir)
  const chain = setup.claudeMd.map(shown => pathFromDisplay(shown, sources))

  return {
    sources,
    userDir: folder === '' ? null : folder,
    chain: chain.filter(path => relativeTo(path, root) === null),
    memoryFolders: memoryFoldersOf(locations),
  }
}

/** Whether a path is absolute with no empty, `.` or `..` segment (AUTO-PICK #19 Q9). */
function isPlainPath(path: string): boolean {
  if (!path.startsWith('/')) return false

  return path
    .slice(1)
    .split('/')
    .every(segment => segment !== '' && segment !== '.' && segment !== '..')
}

/**
 * The path of a recorded global part's file (AUTO-PICK #19 Q9): its display form read back (pathFromDisplay), when
 * that is a plain absolute path (isPlainPath) that is a plain .md file of the config folder init may read
 * (isReadableConfigFile, 02-GAPS-B3 M2) or a CLAUDE.md of the chain above the repo; else null, so a record cannot point
 * regen at any other file.
 */
function globalPathOf(file: string, places: RecordPlaces): string | null {
  const path = pathFromDisplay(file, places.sources)
  if (!isPlainPath(path)) return null
  if (places.userDir !== null && isReadableConfigFile(path, places.userDir)) return path

  return places.chain.includes(path) ? path : null
}

/**
 * The path of a recorded memory (AUTO-PICK #19 Q9): in a memory folder of this repo, under a plain `.md` file name
 * (isSafeFileName) that is not MEMORY.md in any letter case (isMemoryIndexName, 02-GAPS-B3 N2); else null.
 */
function memoryPathOf(memory: Pick<RecordedMemory, 'file' | 'folder'>, places: RecordPlaces): string | null {
  const { file, folder } = memory
  if (!places.memoryFolders.includes(folder) || !isSafeFileName(file)) return null
  if (!file.endsWith(MARKDOWN_EXTENSION) || isMemoryIndexName(file)) return null

  return `${folder}/${file}`
}

/**
 * A role's private hand-out record found, or why there is none to compare (AUTO-PICK #19 Q5, Q9); with its role memory
 * folder when it is known (02-GAPS-B3 M1).
 */
export type PrivateFound =
  | { readonly kind: 'none'; readonly folder: string }
  | { readonly kind: 'kept'; readonly warnings: readonly string[] }
  | { readonly kind: 'found'; readonly folder: string; readonly record: InstructionsRecord }

/**
 * A role's private hand-out record (G-02-1f Regen, D-140 q2-a). A dry run holds no host, so it names no folder and
 * reads no record (dryRunPrivateWarning, AUTO-PICK #19 Q5). Else the role memory folder is named as /cadre start names
 * it (roleFoldersOf), with privateFoldersUnknownWarning when it cannot be, and its instructions.json is read: a record
 * that is not there means the role holds nothing private; one that cannot be read or is not valid
 * (parseInstructionsRecord) is not used (unusableRecordWarning).
 */
export async function privateRecordOf(
  io: InitIo,
  host: HostIo | null,
  locations: InitLocations,
  id: string,
): Promise<PrivateFound> {
  if (host === null) return { kind: 'kept', warnings: [dryRunPrivateWarning(id)] }
  const folderOf = await roleFoldersOf(io, host, locations)
  if (folderOf === null) return { kind: 'kept', warnings: [privateFoldersUnknownWarning([id])] }
  const folder = folderOf(id)
  const read = await io.read(instructionsRecordPath(folder), MAX_READ_BYTES)
  if (read.state === 'absent') return { kind: 'none', folder }
  const record = read.state === 'text' ? parseInstructionsRecord(read.text) : null
  if (record === null) return { kind: 'kept', warnings: [unusableRecordWarning(id)] }

  return { kind: 'found', folder, record }
}

/**
 * A role's private side read again (G-02-1f Regen, D-142 rg2-a). Every file and memory its record names is checked
 * first (globalPathOf, memoryPathOf): one regen may not read makes the whole record unusable (unusableRecordWarning,
 * AUTO-PICK #19 Q9), and nothing is read. Then each named file is read once, in record order, through the port and
 * split into hashed global parts (partsOfText), and each memory is read for its hash only, with the folder and summary
 * its record holds (Q10). A missing file or memory is gone; one that cannot be read (unreadableWarning) or is over the
 * read cap (overSizeWarning, memoryOverSizeWarning) leaves the whole side as it is (Q8); so does a text, a memory's
 * included, that would take the side past MAX_TOTAL_BYTES in all, which stops the read (regenTotalWarning, 02-GAPS-B3
 * C8). The repo side has a total of its own.
 */
export async function privateSideRead(
  io: InitIo,
  record: InstructionsRecord,
  places: RecordPlaces,
  id: string,
): Promise<SideRead> {
  const files = recordedFiles([...record.parts, ...record.partsNotGiven])
  const named = files.flatMap(file => {
    const path = globalPathOf(file, places)

    return path === null ? [] : [{ file, path }]
  })
  const linked = record.memories.flatMap(memory => {
    const path = memoryPathOf(memory, places)

    return path === null ? [] : [{ memory, path }]
  })
  if (named.length < files.length || linked.length < record.memories.length) {
    return { kind: 'kept', warnings: [unusableRecordWarning(id)] }
  }
  const parts: InstructionPart[] = []
  const warnings: string[] = []
  let total = 0
  for (const { file, path } of named) {
    const read = await io.read(path, MAX_READ_BYTES)
    if (read.state === 'unknown') warnings.push(unreadableWarning(clean(file)))
    if (read.state === 'too-large') warnings.push(overSizeWarning(clean(file)))
    if (read.state !== 'text') continue
    total += utf8Bytes(read.text)
    if (total > MAX_TOTAL_BYTES) return { kind: 'kept', warnings: [regenTotalWarning(id)] }
    parts.push(...(await partsOfText(file, 'global', read.text, parts.length)))
  }
  const memories: MemoryItem[] = []
  for (const { memory, path } of linked) {
    const read = await io.read(path, MAX_READ_BYTES)
    if (read.state === 'unknown') warnings.push(unreadableWarning(clean(memory.file)))
    if (read.state === 'too-large') warnings.push(memoryOverSizeWarning(clean(memory.file)))
    if (read.state !== 'text') continue
    total += utf8Bytes(read.text)
    if (total > MAX_TOTAL_BYTES) return { kind: 'kept', warnings: [regenTotalWarning(id)] }
    const { file, folder, summary } = memory
    memories.push({ id: `M${memories.length + 1}`, file, folder, summary, hash: await sha256Hex(read.text) })
  }
  if (warnings.length > 0) return { kind: 'kept', warnings }
  const { parts: given, partsNotGiven: notGiven } = record

  return { kind: 'read', side: { given, notGiven, memories: record.memories, current: { parts, memories } } }
}
