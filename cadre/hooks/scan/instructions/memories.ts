/**
 * The memory reads of the instruction hand-out, a layer 3 module: the memory index file in any letter case and its
 * one-line summaries, and this repo's auto-memories, each read after the content consent for its hash only, with the
 * warnings for a folder that could not be listed and a file that could not be read or is over the read cap (G-02-1f
 * Memories, 02-GAPS-B3 N2). No memory text is kept. It imports core, paths, the facts read cap, the port reads and the
 * types, so the instruction reads and questions, init's regen and /cadre start read memories here.
 */
import type { InitIo, InstructionScan, MemoryItem } from '../../../types'
import { sha256Hex } from '../../core/hash'
import { clean, compareText, isChangedByClean } from '../../core/text'
import { joinedPath, markdownFileNames, MAX_FILE_NAME_CHARS } from '../../paths'
import { MAX_READ_BYTES } from '../facts/normalize'
import { listingState } from '../port-read'

/** Every line break of a text. */
export const LINE_BREAKS = /\r\n|\r|\n/g

/** The most code points a topic summary and a memory summary keep (G-02-1f). */
export const MAX_SUMMARY_CHARS = 160

/**
 * The index of the auto-memories of a folder (G-02-1f Memories): it lists them and is never a memory itself, so regen
 * never reads it as one (G-02-1f Regen).
 */
export const MEMORY_INDEX_FILE = 'MEMORY.md'

/**
 * Whether a file name is the memory index in any letter case (02-GAPS-B3 N2): the engine reads MEMORY.md, and no case
 * variant is offered as a memory.
 */
export function isMemoryIndexName(name: string): boolean {
  return name.toLowerCase() === MEMORY_INDEX_FILE.toLowerCase()
}

/** The summary of a memory MEMORY.md has no index line for (G-02-1f Memories). */
export const NO_MEMORY_SUMMARY = 'No summary in MEMORY.md.'

/** The warning when an auto-memory folder could not be listed (G-02-1f Memories): its memories are not offered. */
export const MEMORY_UNLISTED_WARNING = 'could not list the memory folder (treated as unknown)'

/**
 * The warning for a file the port could not read (G-02-1f): its display form, never its path; no role gets it
 * (02-GAPS-B2 S2).
 */
export function unreadableWarning(file: string): string {
  return `could not read ${file}: no role gets it`
}

/** The warning for a memory or MEMORY.md over the read cap (G-02-1f Memories; AUTO-PICK #6): it is not offered. */
export function memoryOverSizeWarning(file: string): string {
  return `${file} is over ${MAX_READ_BYTES / 1024} KiB: not offered`
}

/** An index line of MEMORY.md: `- [<title>](<file>)`, then whatever follows the link. */
const INDEX_LINE = /^- \[([^\]]*)\]\(([^)]*)\)(.*)$/

/** What separates the link of an index line from its summary: an em dash or a hyphen, a space on each side. */
const SUMMARY_SEPARATORS: readonly string[] = Object.freeze([' \u2014 ', ' - '])

/** A text as a memory summary keeps it: hidden characters removed, trimmed, then cut to MAX_SUMMARY_CHARS. */
export function summaryText(text: string): string {
  return clean(clean(text, Number.POSITIVE_INFINITY).trim(), MAX_SUMMARY_CHARS)
}

/** The summary an index line gives: the text after its separator, else its title; '' when both are blank. */
function indexSummary(title: string, rest: string): string {
  const separator = SUMMARY_SEPARATORS.find(mark => rest.startsWith(mark))
  const summary = separator === undefined ? '' : summaryText(rest.slice(separator.length))

  return summary === '' ? summaryText(title) : summary
}

/**
 * The one-line summaries of a MEMORY.md index (G-02-1f Memories), by file name: a line `- [<title>](<file>)` followed
 * by an em dash or a hyphen with a space on each side and a summary gives that summary, cleaned and cut to 160 code
 * points; with no summary after the link the title is the summary. A line whose summary and title are both blank, a
 * file named again and every other line are skipped.
 */
export function memoryIndex(text: string): ReadonlyMap<string, string> {
  const index = new Map<string, string>()
  for (const line of text.split(LINE_BREAKS)) {
    const match = INDEX_LINE.exec(line)
    const file = match?.[2]?.trim() ?? ''
    if (match === null || file === '' || index.has(file)) continue
    const summary = indexSummary(match[1] ?? '', match[3] ?? '')
    if (summary !== '') index.set(file, summary)
  }

  return index
}

/** A memory file with the folder that listed it. */
type MemoryFile = {
  readonly name: string
  readonly folder: string
}

/**
 * The `.md` files of the memory folders (G-02-1f Memories), each name once, from the first folder that lists it, in
 * name order. A name clean would change is skipped, as the setup scan skips it (and names it in its warnings). A
 * folder that could not be listed adds MEMORY_UNLISTED_WARNING once; a folder that is not there is quiet.
 */
async function memoryFiles(io: InitIo, folders: readonly string[], warnings: string[]): Promise<MemoryFile[]> {
  const found = new Map<string, string>()
  for (const folder of folders) {
    const listing = await listingState(io, folder)
    if (listing.state === 'unknown' && !warnings.includes(MEMORY_UNLISTED_WARNING)) {
      warnings.push(MEMORY_UNLISTED_WARNING)
    }
    if (listing.state !== 'present') continue
    for (const name of markdownFileNames(listing.entries)) {
      if (!found.has(name) && !isChangedByClean(name, MAX_FILE_NAME_CHARS)) found.set(name, folder)
    }
  }

  return Array.from(found, ([name, folder]) => ({ name, folder })).sort((a, b) => compareText(a.name, b.name))
}

/**
 * The text of a memory file, or null: the port could not read it (unreadableWarning) or it is over MAX_READ_BYTES
 * (memoryOverSizeWarning, AUTO-PICK #6), each warning naming the file only; a file that is gone is quiet.
 */
async function memoryText(io: InitIo, file: MemoryFile, warnings: string[]): Promise<string | null> {
  const read = await io.read(joinedPath(file.folder, file.name), MAX_READ_BYTES)
  if (read.state === 'text') return read.text
  if (read.state === 'unknown') warnings.push(unreadableWarning(file.name))
  if (read.state === 'too-large') warnings.push(memoryOverSizeWarning(file.name))

  return null
}

/**
 * The auto-memories of this repo (G-02-1f Memories), read only after the content consent: the memory folders are
 * listed (memoryFiles), MEMORY.md is read first for its index (memoryIndex), from the file named exactly so, then each
 * other `.md` file once, in name order, for its hash only (sha256Hex): `M<n>` in that order, with the folder that
 * listed it and the summary of its index line, or NO_MEMORY_SUMMARY. No letter-case variant of MEMORY.md is offered
 * (isMemoryIndexName, 02-GAPS-B3 N2). A memory that could not be read is not offered, so it stays with the root
 * session. No text is kept, neither a memory's nor MEMORY.md's: only file names, folders, summaries and hashes.
 */
export async function readMemories(
  io: InitIo,
  folders: readonly string[],
): Promise<Pick<InstructionScan, 'memories' | 'warnings'>> {
  const warnings: string[] = []
  const files = await memoryFiles(io, folders, warnings)
  const indexFile = files.find(file => file.name === MEMORY_INDEX_FILE)
  const index = memoryIndex(indexFile === undefined ? '' : ((await memoryText(io, indexFile, warnings)) ?? ''))
  const memories: MemoryItem[] = []
  for (const file of files.filter(found => !isMemoryIndexName(found.name))) {
    const text = await memoryText(io, file, warnings)
    if (text === null) continue
    const hash = await sha256Hex(text)
    const summary = index.get(file.name) ?? NO_MEMORY_SUMMARY
    memories.push({ id: `M${memories.length + 1}`, file: file.name, folder: file.folder, summary, hash })
  }

  return { memories, warnings }
}
