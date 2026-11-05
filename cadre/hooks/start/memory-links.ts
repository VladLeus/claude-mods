/**
 * The linked memories of /cadre start (G-02-1f, D-140 q3-a), a layer 10 module: the memories a parts-flow role's
 * hand-out record names, linked into its role memory folder and listed in cadre's block of its MEMORY.md between
 * MEMORY_BLOCK_BEGIN and MEMORY_BLOCK_END (linkedMemoriesOf, memoryBlockText), with a warning for each memory or block
 * it leaves as it is. It reads through the InitIo port only: the render plan's steps make the links and write the
 * block. It imports apply/private, core, launch/links, paths, scan and start/render-plan; the gather of the launching
 * user reads it.
 */
import type { InitIo, MemoryItem } from '../../types'
import { instructionsRecordPath, parseInstructionsRecord } from '../apply/private'
import type { RecordedMemory } from '../apply/private'
import { sha256Hex } from '../core/hash'
import { reportText, shown, sortedUnique } from '../core/text'
import { isSafeFileName, launchRoots, unsafeMemoryNameWarning } from '../launch/links'
import type { LaunchUser, OverlayLink } from '../launch/links'
import { CONTRACTS } from '../locales/contracts'
import { fill, t } from '../locales/t'
import { displayPath, INSTRUCTIONS_RECORD_FILE, MARKDOWN_EXTENSION, memoryFolderOf, roleMemoryDir } from '../paths'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { isMemoryIndexName, MEMORY_INDEX_FILE } from '../scan/instructions/memories'
import { isPlainName, isRealEntry, notReplacedText } from './render-plan'
import type { MemoryLinks } from './render-plan'

/** The begin marker of cadre's block in a role's MEMORY.md (D-140 q3-a); an on-disk contract, as IGNORE_BEGIN is. */
export const MEMORY_BLOCK_BEGIN = CONTRACTS.memoryBlockBegin

/** The end marker of cadre's block in a role's MEMORY.md (D-140 q3-a); an on-disk contract like MEMORY_BLOCK_BEGIN. */
export const MEMORY_BLOCK_END = CONTRACTS.memoryBlockEnd

/** The lines of a text, each with its own line ending, so joining them gives the text back byte for byte. */
function linesWithEnds(text: string): string[] {
  return text.split(/(?<=\n)/)
}

/** A line without its line ending, `\n` or `\r\n`, so a MEMORY.md with Windows line endings reads the same. */
function withoutLineEnd(line: string): string {
  return line.replace(/\r?\n$/, '')
}

/**
 * Where cadre's block sits in the lines of a MEMORY.md: the index of the first begin marker line and of the first end
 * marker line after it, -1 for a marker that is not there, so a begin marker with no end marker is { begin >= 0, end:
 * -1 }. A marker is a whole line.
 */
function memoryBlockMarkers(lines: readonly string[]): { readonly begin: number; readonly end: number } {
  const begin = lines.findIndex(line => withoutLineEnd(line) === MEMORY_BLOCK_BEGIN)
  if (begin === -1) return { begin, end: -1 }
  const end = lines.findIndex((line, index) => index > begin && withoutLineEnd(line) === MEMORY_BLOCK_END)

  return { begin, end }
}

/**
 * The line of one linked memory in cadre's block (D-140 q3-a): `- [<file>](<file>) \u2014 <summary>`, its file name
 * and summary cleaned and capped as report cells are, so a summary read from disk cannot add a line.
 */
function memoryBlockLine(entry: Pick<MemoryItem, 'file' | 'summary'>): string {
  const file = reportText(entry.file)

  return fill(CONTRACTS.memoryBlockLine, { file, summary: reportText(entry.summary) })
}

/**
 * A role's MEMORY.md text with cadre's block set to these linked memories (D-140 q3-a), as mergeIgnoreBlock sets the
 * cadre block of the root `.gitignore`: MEMORY_BLOCK_BEGIN, one memoryBlockLine per memory in the order given, and
 * MEMORY_BLOCK_END, each line ending in `\n`. The block from the first begin marker to the first end marker after it is
 * replaced, or appended when there is none, and a missing file gives the block alone; no line outside the block
 * changes, byte for byte, and a marker that ends in a carriage return is still found. A begin marker with no end
 * marker after it is a block cadre cannot tell the extent of, so the result is null and nothing is written.
 */
export function memoryBlockText(
  existing: string | null,
  entries: readonly Pick<MemoryItem, 'file' | 'summary'>[],
): string | null {
  const block = [MEMORY_BLOCK_BEGIN, ...entries.map(memoryBlockLine), MEMORY_BLOCK_END].map(line => `${line}\n`)
  if (existing === null) return block.join('')
  const lines = linesWithEnds(existing)
  const { begin, end } = memoryBlockMarkers(lines)
  if (begin === -1) return `${existing}${existing === '' || existing.endsWith('\n') ? '' : '\n'}${block.join('')}`
  if (end === -1) return null

  return `${lines.slice(0, begin).join('')}${block.join('')}${lines.slice(end + 1).join('')}`
}

/** A line of cadre's block, with the file its link names in its first group. */
const MEMORY_BLOCK_ENTRY = /^- \[[^\]\n]*\]\(([^)\n]+)\)/

/**
 * The file names cadre's block of a MEMORY.md text lists, in its order: the link target of each of its lines; none when
 * the text has no block, or one with no end marker.
 */
function memoryBlockFiles(text: string): string[] {
  const lines = linesWithEnds(text)
  const { begin, end } = memoryBlockMarkers(lines)
  if (begin === -1 || end === -1) return []

  return lines.slice(begin + 1, end).flatMap(line => {
    const file = MEMORY_BLOCK_ENTRY.exec(withoutLineEnd(line))?.[1]

    return file === undefined ? [] : [file]
  })
}

/** The warning for a memory that changed since init (G-02-1f): it is linked as it is now. Names are shown cleaned. */
export function memoryChangedWarning(file: string, id: string): string {
  const role = reportText(id)

  return t('start.memoryLinks.memoryChangedWarning', { file: shown(file), role })
}

/** The warning for a memory whose original is no longer in the memory folder of the repo (G-02-1f): not linked. */
export function memoryGoneWarning(file: string): string {
  return t('start.memoryLinks.memoryGoneWarning', { file: shown(file) })
}

/** The warning for a MEMORY.md whose cadre block has no end marker (D-140 q3-a): nothing is written to it. */
export function openMemoryBlockWarning(id: string): string {
  return t('start.memoryLinks.openMemoryBlockWarning', { id: reportText(id) })
}

/**
 * The warning for a hand-out record that is there but cannot be read, or is not a valid record (G-02-1f): no memory
 * of the role is linked, and every link the MEMORY.md block listed is removed.
 */
export function unreadableRecordWarning(id: string): string {
  return (
    t('start.memoryLinks.unreadableRecordWarning', {
      id: reportText(id),
      instructionsRecordFile: INSTRUCTIONS_RECORD_FILE,
    })
  )
}

/** The warning for a role's MEMORY.md that is there but cannot be read (D-140 q3-a): nothing is written to it. */
export function unreadableMemoryIndexWarning(id: string): string {
  return t('start.memoryLinks.unreadableMemoryIndexWarning', { memoryIndexFile: MEMORY_INDEX_FILE, id: reportText(id) })
}

/**
 * The warning for a role's MEMORY.md that is a link (T-02-74): it is never read or written through, so a link put
 * there cannot make /cadre start write the block into the file it points at.
 */
export function memoryIndexLinkWarning(id: string): string {
  return t('start.memoryLinks.memoryIndexLinkWarning', { memoryIndexFile: MEMORY_INDEX_FILE, id: reportText(id) })
}

/**
 * Whether a recorded memory may be linked by its name: a plain file name (isSafeFileName) that ends in `.md`, is not
 * MEMORY.md in any letter case, which is the role's own index (isMemoryIndexName, 02-GAPS-B3 N2), and holds no `(` or
 * `)`, as the MEMORY.md block line could not be parsed back (02-GAPS-B3 N8).
 */
function isLinkableMemory(file: string): boolean {
  if (!isSafeFileName(file) || !file.endsWith(MARKDOWN_EXTENSION)) return false
  if (file.includes('(') || file.includes(')')) return false

  return !isMemoryIndexName(file)
}

/** What /cadre start does with one recorded memory: its link, or none, and the warning to show, or none. */
type MemoryLinkOutcome = {
  readonly link: OverlayLink | null
  readonly warning: string | null
}

/**
 * What /cadre start does with one memory of a role's hand-out record (G-02-1f, D-140 q3-a). It is not linked when its
 * name may not be a link name (isLinkableMemory, unsafeMemoryNameWarning); when its folder is not a memory folder of
 * this repo, of the root as resolved or as given, or of the main checkout (`mainRoot`, 03.1-W3 M1), or its original
 * cannot be read as a file (memoryGoneWarning); or when a real file or folder holds its link path in the role memory
 * folder, which is never replaced (notReplacedText, the path named in its display form, as the role memory folder is
 * never below the repo root: D-272 edge #28). Else it is linked, `<role memory folder>/<file>` to `<its
 * folder>/<file>`, never copied, with memoryChangedWarning when its original's text is over MAX_READ_BYTES or no longer
 * has the hash of the record. The original is read for its hash alone.
 */
async function memoryLinkOf(
  io: InitIo,
  user: LaunchUser,
  input: { readonly folder: string; readonly id: string; readonly memory: RecordedMemory },
): Promise<MemoryLinkOutcome> {
  const { folder, id, memory } = input
  if (!isLinkableMemory(memory.file)) return { link: null, warning: unsafeMemoryNameWarning(memory.file) }
  const roots = launchRoots(user)
  const repoFolders = roots.map(root => memoryFolderOf(user.userDir, root))
  if (!repoFolders.includes(memory.folder)) return { link: null, warning: memoryGoneWarning(memory.file) }
  const path = `${folder}/${memory.file}`
  if (isRealEntry(await io.stat(path))) {
    return { link: null, warning: notReplacedText(displayPath(path, user.home, user.root)) }
  }
  const target = `${memory.folder}/${memory.file}`
  const original = await io.read(target, MAX_READ_BYTES)
  if (original.state === 'absent' || original.state === 'unknown') {
    return { link: null, warning: memoryGoneWarning(memory.file) }
  }
  const isSame = original.state === 'text' && (await sha256Hex(original.text)) === memory.hash

  return { link: { path, target }, warning: isSame ? null : memoryChangedWarning(memory.file, id) }
}

/**
 * The links an earlier start made in the role memory folder that this one does not make (D-140 q3-a): each name the
 * old MEMORY.md block listed, a plain name that is not linked now, that the folder lists as a link. A real file or
 * folder is never among them, and with no listing there are none.
 */
async function staleMemoryLinks(
  io: InitIo,
  folder: string,
  listed: readonly string[],
  linked: ReadonlySet<string>,
): Promise<string[]> {
  const names = listed.filter(name => isPlainName(name) && !linked.has(name))
  if (names.length === 0) return []
  const entries = (await io.list(folder)) ?? []
  const links = new Set(entries.filter(entry => entry.isLink).map(entry => entry.name))

  return sortedUnique(names.filter(name => links.has(name)).map(name => `${folder}/${name}`))
}

/**
 * The read of the role's hand-out record: the memories it names, none when it is not there, null when it cannot be
 * read or is not a record regen would take (parseInstructionsRecord, 02-GAPS-B3 S6: one parser).
 */
async function recordOf(io: InitIo, folder: string): Promise<readonly RecordedMemory[] | null> {
  const read = await io.read(instructionsRecordPath(folder), MAX_READ_BYTES)
  if (read.state === 'absent') return []
  if (read.state !== 'text') return null

  return parseInstructionsRecord(read.text)?.memories ?? null
}

/**
 * The memory links of a parts-flow role (G-02-1f, D-140 q3-a) and the warnings to show. Its hand-out record
 * `<role memory folder>/instructions.json` is read (recordOf): not there names no memory, while one that cannot be read
 * or is not valid names none and warns (unreadableRecordWarning). Each memory it names is linked or not (memoryLinkOf).
 * The role's MEMORY.md is then read: when it is not there, or there with a block both markers end, cadre's block is set
 * to the linked memories in record order (memoryBlockText) and written when its text changes, but never added to a
 * MEMORY.md with no block, or made, for no linked memory; each link the old block listed that is not linked now is
 * removed (staleMemoryLinks). A MEMORY.md that is a link is never read or written through (T-02-74), and one that
 * cannot be read, or whose block has no end marker, is left as it is too; then nothing is removed, with a warning
 * (memoryIndexLinkWarning, unreadableMemoryIndexWarning, openMemoryBlockWarning). No other file of the folder is
 * touched, and nothing is ever copied.
 */
export async function linkedMemoriesOf(
  io: InitIo,
  user: LaunchUser,
  id: string,
): Promise<{ readonly memories: MemoryLinks; readonly warnings: readonly string[] }> {
  const folder = roleMemoryDir(user, id)
  const recorded = await recordOf(io, folder)
  const outcomes: { readonly memory: RecordedMemory; readonly outcome: MemoryLinkOutcome }[] = []
  for (const memory of recorded ?? []) {
    outcomes.push({ memory, outcome: await memoryLinkOf(io, user, { folder, id, memory }) })
  }
  const linked = outcomes.filter(item => item.outcome.link !== null)
  const links = linked.flatMap(item => item.outcome.link ?? [])
  const warnings = [
    ...(recorded === null ? [unreadableRecordWarning(id)] : []),
    ...outcomes.flatMap(item => item.outcome.warning ?? []),
  ]
  const indexPath = `${folder}/${MEMORY_INDEX_FILE}`
  if ((await io.stat(indexPath))?.isLink === true) {
    return { memories: { links, removals: [], index: null }, warnings: [...warnings, memoryIndexLinkWarning(id)] }
  }
  const indexRead = await io.read(indexPath, MAX_READ_BYTES)
  if (indexRead.state !== 'absent' && indexRead.state !== 'text') {
    return { memories: { links, removals: [], index: null }, warnings: [...warnings, unreadableMemoryIndexWarning(id)] }
  }
  const existing = indexRead.state === 'text' ? indexRead.text : null
  const text = memoryBlockText(existing, linked.map(item => item.memory))
  if (text === null) {
    return { memories: { links, removals: [], index: null }, warnings: [...warnings, openMemoryBlockWarning(id)] }
  }
  const listed = existing === null ? [] : memoryBlockFiles(existing)
  const hasBlock = existing !== null && memoryBlockMarkers(linesWithEnds(existing)).begin !== -1
  const isUnchanged = text === existing || (!hasBlock && links.length === 0)
  const removals = await staleMemoryLinks(io, folder, listed, new Set(linked.map(item => item.memory.file)))

  return { memories: { links, removals, index: isUnchanged ? null : { path: indexPath, text } }, warnings }
}
