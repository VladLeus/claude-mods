/**
 * The instruction file reads, a layer 3 module: where the read starts (InstructionSources), what init finds of the
 * repo's own files before the content consent, and the read after it: the global CLAUDE.md, the repo chain, the rule
 * files and AGENTS.md, each file once within the read caps, a repo file as one whole part whose imports are not read
 * and a global file as a part per section with its @imports, and the warnings for what it could not or may not read.
 * It writes nothing; the text is held in memory for the run. It imports core, paths, the facts read cap, the port
 * reads, the rule walk, the import rule, the section split, the memory reads and the types, so init and its regen read
 * the instruction files here.
 */
import type { InitIo, InstructionPart, InstructionScan, MemoryItem, PartSource } from '../../../types'
import { sha256Hex } from '../../core/hash'
import { clean, sortedUnique, utf8Bytes } from '../../core/text'
import { t, tn } from '../../locales/t'
import {
  AGENTS_MD_FILE,
  displayPath,
  isDirInsideRoot,
  joinedPath,
  MARKDOWN_EXTENSION,
  pathFromDisplay,
  relativeTo,
  trimSlash,
  userDirOf,
} from '../../paths'
import { MAX_READ_BYTES } from '../facts/normalize'
import { readRepoFile } from '../port-read'
import { ruleFiles, RULES_FOLDER } from '../rules'
import { claudeMdImports } from './imports'
import { readMemories, unreadableWarning } from './memories'
import { splitSections } from './sections'

/**
 * Where the instruction files are read from: the repo root, the home folder and CLAUDE_CONFIG_DIR as resolved (the
 * config folder is CLAUDE_CONFIG_DIR, else `<home>/.claude`; userDirOf), the CLAUDE.md files of the repo chain in
 * display form, outermost first, as the user-setup scan names them (SetupScan.claudeMd), what init found of the repo's
 * own files before the content consent, by name only (repoInstructionNames), and the auto-memory folders of this repo.
 */
export type InstructionSources = {
  readonly root: string
  readonly home: string | null
  readonly configDir: string | null
  readonly chain: readonly string[]
  /**
   * The `.md` rule files, repo-relative below `.claude/rules`, sub-folders included, in name order; null when that
   * folder could not be listed.
   */
  readonly rules: readonly string[] | null
  /** Whether `<root>/AGENTS.md` was a file when init looked, before the content consent. */
  readonly hasAgentsMd: boolean
  /** The absolute auto-memory folders of this repo, the one of the root as resolved first (readMemories). */
  readonly memoryFolders: readonly string[]
}

/**
 * The rule files of the repo (G-02-1f Sources), by name only: the `.md` files of `.claude/rules` and its sub-folders,
 * repo-relative below `.claude/rules`, in name order (ruleFiles, 02-GAPS-B2 M4). Each folder is listed only when its
 * stat shows a folder whose real path is inside the repo (isDirInsideRoot, WR-02), and no link is taken. A rules
 * folder that is not there has none; one that could not be stat-ed or listed, or that links out of the repo, is null.
 */
async function ruleNames(io: InitIo, root: string): Promise<readonly string[] | null> {
  return ruleFiles(io, root, { isTakenLink: false, isFolderUsable: stat => isDirInsideRoot(stat, root) })
}

/**
 * What init finds of the repo's own instruction files before the content consent (G-02-1f Sources, D-57), by name
 * only: the `.md` files of `.claude/rules` in name order, null when that folder could not be listed (ruleNames), and
 * whether the root AGENTS.md is a file, by its stat. No file is read.
 */
export async function repoInstructionNames(
  io: InitIo,
  root: string,
): Promise<Pick<InstructionSources, 'rules' | 'hasAgentsMd'>> {
  const rules = await ruleNames(io, root)
  const agents = await io.stat(joinedPath(root, AGENTS_MD_FILE))

  return { rules, hasAgentsMd: agents?.kind === 'file' }
}

/** The most import levels followed below a file the read starts from (G-02-1f Sources). */
const MAX_IMPORT_LEVELS = 3

/** The most imported files read for the global file, and again for the chain files above the repo. */
const MAX_IMPORTED_FILES = 20

/**
 * The most UTF-8 bytes one read takes in all, every file together (G-02-1f Sources): 512 KiB; regen holds each side of
 * a role to it too (02-GAPS-B3 C8).
 */
export const MAX_TOTAL_BYTES = 2 * MAX_READ_BYTES

/**
 * The most parts offered to the model and the hand-out (G-02-1f Part unit; 02-GAPS-B2 S6: the grouping reply must fit
 * the 2,048-token completion cap); the rest stay with the root session.
 */
const MAX_PARTS = 120

/** The warning when `.claude/rules` could not be listed before the consent (G-02-1f Sources): no rule file is read. */
export const RULES_UNLISTED_WARNING = t('scan.unknown', { what: t('scan.rulesUnlisted') })

/** The warning for a file over the read cap (G-02-1f): it is not split, so no role gets it (02-GAPS-B2 S2). */
export function overSizeWarning(file: string): string {
  return t('scan.instructions.read.overSizeWarning', { file, value: MAX_READ_BYTES / 1024 })
}

/**
 * The warning for a path outside the repo and the config folder (G-02-1f Sources): it is not read, so no role gets it
 * (02-GAPS-B2 S2).
 */
export function outsideWarning(file: string): string {
  return t('scan.instructions.read.outsideWarning', { file })
}

/**
 * The warning for a file of the config folder the read may not take (02-GAPS-B3 M2): not a plain .md file of it, or
 * under projects/, cadre/ or plugins/ (isReadableConfigFile); it is not read, so no role gets it.
 */
export function configFileWarning(file: string): string {
  return t('scan.instructions.read.configFileWarning', { file })
}

/**
 * The warning when the read stopped at its total cap (G-02-1f Sources): how many files it did not read, which no role
 * gets (02-GAPS-B2 S2).
 */
export function totalCapWarning(count: number): string {
  return tn('scan.instructions.read.totalCapWarning', count, { value: MAX_TOTAL_BYTES / 1024, count })
}

/** The warning for the parts past MAX_PARTS (G-02-1f Part unit): not offered, they stay with the root session. */
export function morePartsWarning(count: number): string {
  return t('scan.instructions.read.morePartsWarning', { count })
}

/** Where a path lies for the read: in the repo (with its repo-relative path), in the config folder, or elsewhere. */
type Place =
  | { readonly kind: 'repo'; readonly path: string; readonly relPath: string }
  | { readonly kind: 'global'; readonly path: string }
  | { readonly kind: 'outside'; readonly path: string }

/**
 * How the read reached a path: `chain` for a CLAUDE.md of the chain, which above the repo is read as a private
 * `global` part; `own` for every other path the read starts from or reaches.
 */
type Reach = 'own' | 'chain'

/** A file the read split into parts: its text, the folder its imports resolve against, and its source. */
type ReadFile = {
  readonly text: string
  readonly dir: string
  readonly source: PartSource
}

/** What one read keeps as it goes: the port, where it reads, and the lists that grow as files are read. */
type ReadState = {
  readonly io: InitIo
  readonly sources: InstructionSources
  readonly userDir: string | null
  readonly parts: InstructionPart[]
  readonly warnings: string[]
  /** Every path the read reached, read or not, so each file is read once. */
  readonly seen: Set<string>
  /** The UTF-8 size of each file read, toward MAX_TOTAL_BYTES. */
  readonly sizes: number[]
  /** The files left unread once the read reached MAX_TOTAL_BYTES; any entry means the read has stopped. */
  readonly unread: string[]
}

/** Where a path lies: in the repo first, then in the config folder, else elsewhere (G-02-1f Sources). */
function placeOf(path: string, state: ReadState): Place {
  const root = trimSlash(state.sources.root)
  if (path.startsWith(`${root}/`)) return { kind: 'repo', path, relPath: path.slice(root.length + 1) }
  const userDir = state.userDir === null ? null : trimSlash(state.userDir)
  if (userDir !== null && path.startsWith(`${userDir}/`)) return { kind: 'global', path }

  return { kind: 'outside', path }
}

/** A place as a warning names it: repo-relative in the repo, cleaned, else in display form (`~/...`). */
function fileOf(place: Place, sources: InstructionSources): string {
  if (place.kind === 'repo') return clean(place.relPath)

  return displayPath(place.path, sources.home, sources.root, sources.configDir)
}

/**
 * A place as a part names it (G-02-1f): the raw repo-relative path in the repo, else the display form, as fileOf gives
 * it. The raw repo-relative path is the part's identity; it is cleaned only where shown (02-GAPS-B2 N3).
 */
function partFileOf(place: Exclude<Place, { readonly kind: 'outside' }>, sources: InstructionSources): string {
  if (place.kind === 'repo') return place.relPath

  return fileOf(place, sources)
}

/**
 * The first folders of the config folder whose files are never handed out (02-GAPS-B3 M2): other repos' memories,
 * cadre's private files and plugin caches.
 */
const HELD_OUT_CONFIG_FOLDERS: readonly string[] = Object.freeze(['projects', 'cadre', 'plugins'])

/**
 * Whether init may read a file of the config folder, and regen a file a record names there (02-GAPS-B3 M2): under the
 * folder, ending in .md, with no segment below it that starts with '.', and not under projects/, cadre/ or plugins/
 * (compared lowercased).
 */
export function isReadableConfigFile(path: string, userDir: string): boolean {
  const folder = trimSlash(userDir)
  if (!path.startsWith(`${folder}/`)) return false
  const segments = path.slice(folder.length + 1).split('/')
  if (segments.some(segment => segment.startsWith('.'))) return false
  if (HELD_OUT_CONFIG_FOLDERS.includes((segments[0] ?? '').toLowerCase())) return false

  return path.endsWith(MARKDOWN_EXTENSION)
}

/** The folder a path is in: what its imports resolve against. */
function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'))
}

/** Adds a warning to the read and gives no file. */
function warned(state: ReadState, warning: string): null {
  state.warnings.push(warning)

  return null
}

/** Counts a file left unread once the read has stopped at its total, and gives no file. */
function leftUnread(state: ReadState, file: string): null {
  state.unread.push(file)

  return null
}

/**
 * The parts of one file's text, each with its file, source and the SHA-256 of its text, `P<n>` after the `before`
 * parts already read: a repo file is one whole part, a global file one part per section (splitSections). The read of
 * init and the read of regen both cut a file through it.
 */
export async function partsOfText(
  file: string,
  source: PartSource,
  text: string,
  before: number,
): Promise<InstructionPart[]> {
  if (source === 'repo') return [{ id: `P${before + 1}`, file, heading: '', source, text, hash: await sha256Hex(text) }]
  const parts: InstructionPart[] = []
  for (const section of splitSections(text)) {
    const { heading, text: partText } = section
    const hash = await sha256Hex(partText)
    parts.push({ id: `P${before + parts.length + 1}`, file, heading, source, text: partText, hash })
  }

  return parts
}

/** Adds a file's parts, `P<n>` in read order (partsOfText). */
async function addParts(state: ReadState, file: string, source: PartSource, text: string): Promise<void> {
  state.parts.push(...(await partsOfText(file, source, text, state.parts.length)))
}

/**
 * A text the port read, kept within the total: when it would take the read past MAX_TOTAL_BYTES the read stops and the
 * file is counted unread; else it is cut into hashed parts and given back for its imports. The parts name their file
 * by partFileOf: the raw repo-relative path is the part's identity; it is cleaned only where shown.
 */
async function keptText(
  state: ReadState,
  place: Exclude<Place, { readonly kind: 'outside' }>,
  text: string,
): Promise<ReadFile | null> {
  const file = partFileOf(place, state.sources)
  const bytes = utf8Bytes(text)
  const total = state.sizes.reduce((sum, size) => sum + size, 0)
  if (total + bytes > MAX_TOTAL_BYTES) return leftUnread(state, file)
  state.sizes.push(bytes)
  const source: PartSource = place.kind === 'repo' ? 'repo' : 'global'
  await addParts(state, file, source, text)

  return { text, dir: folderOf(place.path), source }
}

/**
 * Reads one file the read reaches, once. A chain CLAUDE.md outside the repo and the config folder, an ancestor above
 * the repo, is read through the port as a private `global` part; any other path outside them is not read
 * (outsideWarning). A file of the config folder is read only when it is a plain .md file outside projects/, cadre/ and
 * plugins/ (isReadableConfigFile; else configFileWarning); a chain file above the repo is not held to that rule. Once
 * the read has stopped at its total, a file is only counted. A repo file is read through readRepoFile, so a link out
 * of the repo is never read; a config-folder file through the port. A missing file is quiet; one the port could not
 * read and one over MAX_READ_BYTES are warnings.
 */
async function readOne(state: ReadState, path: string, reach: Reach): Promise<ReadFile | null> {
  if (state.seen.has(path)) return null
  state.seen.add(path)
  const placed = placeOf(path, state)
  const place: Place = reach === 'chain' && placed.kind === 'outside' ? { kind: 'global', path } : placed
  const file = fileOf(place, state.sources)
  if (place.kind === 'outside') return warned(state, outsideWarning(file))
  if (placed.kind === 'global' && state.userDir !== null && !isReadableConfigFile(path, state.userDir)) {
    return warned(state, configFileWarning(file))
  }
  if (state.unread.length > 0) return leftUnread(state, file)
  const read =
    place.kind === 'repo'
      ? await readRepoFile(state.io, state.sources.root, place.relPath, MAX_READ_BYTES)
      : await state.io.read(place.path, MAX_READ_BYTES)
  if (read.state === 'unknown') return warned(state, unreadableWarning(file))
  if (read.state === 'too-large') return warned(state, overSizeWarning(file))
  if (read.state === 'absent') return null

  return keptText(state, place, read.text)
}

/**
 * The imports of a global file read, depth first: each import (claudeMdImports, in its sorted order) is read once, at
 * most MAX_IMPORT_LEVELS levels below the file the read started from and MAX_IMPORTED_FILES imports per budget
 * (`handled`). A repo file's imports are never read, however the read reached it: they load with that file. With no
 * home folder a `~/` import resolves from `/`, so it lands outside and is not read.
 */
async function readImports(state: ReadState, from: ReadFile, level: number, handled: string[]): Promise<void> {
  if (from.source === 'repo') return
  if (level >= MAX_IMPORT_LEVELS) return
  for (const path of claudeMdImports(from.text, from.dir, state.sources.home ?? '')) {
    if (handled.length >= MAX_IMPORTED_FILES) return
    if (state.seen.has(path)) continue
    handled.push(path)
    const read = await readOne(state, path, 'own')
    if (read !== null) await readImports(state, read, level + 1, handled)
  }
}

/** The global CLAUDE.md, then its imports depth first, with their own budget; nothing with no config folder. */
async function readGlobal(state: ReadState): Promise<void> {
  if (state.userDir === null) return
  const global = await readOne(state, joinedPath(state.userDir, 'CLAUDE.md'), 'own')
  if (global === null) return
  await readImports(state, global, 0, [])
}

/**
 * The repo chain, outermost first, then the imports of each chain file above the repo depth first, with one budget for
 * them all: such a file is a private `global` part and its imports are held to the config-folder rule; a chain file in
 * the repo is one whole part.
 */
async function readChain(state: ReadState): Promise<void> {
  const files: ReadFile[] = []
  for (const shown of state.sources.chain) {
    const read = await readOne(state, pathFromDisplay(shown, state.sources), 'chain')
    if (read !== null) files.push(read)
  }
  const handled: string[] = []
  for (const file of files) await readImports(state, file, 0, handled)
}

/**
 * The rule files of `.claude/rules` and its sub-folders, in name order, as listed before the consent (G-02-1f Sources,
 * 02-GAPS-B2 M4); a folder that could not be listed is RULES_UNLISTED_WARNING, and no rule file is read.
 */
async function readRules(state: ReadState): Promise<void> {
  const { root, rules } = state.sources
  if (rules === null) {
    state.warnings.push(RULES_UNLISTED_WARNING)

    return
  }
  for (const name of sortedUnique(rules)) await readOne(state, joinedPath(root, `${RULES_FOLDER}/${name}`), 'own')
}

/** Whether the repo chain holds a CLAUDE.md inside the repo, which a plain session loads in place of AGENTS.md. */
function hasRootClaudeMd(state: ReadState): boolean {
  return state.sources.chain.some(shown => placeOf(pathFromDisplay(shown, state.sources), state).kind === 'repo')
}

/**
 * The root AGENTS.md, when it was a file before the consent; it is read only when the repo has no CLAUDE.md of its own.
 */
async function readAgentsMd(state: ReadState): Promise<void> {
  if (!state.sources.hasAgentsMd) return
  if (hasRootClaudeMd(state)) return
  await readOne(state, joinedPath(state.sources.root, AGENTS_MD_FILE), 'own')
}

/**
 * What a read gave (G-02-1f): the first MAX_PARTS parts, the files they came from in read order, once each, the
 * memories, and the warnings, then how many files the total left unread and how many parts were not offered.
 */
function scanOf(state: ReadState, memories: readonly MemoryItem[]): InstructionScan {
  const parts = state.parts.slice(0, MAX_PARTS)
  const rest = state.parts.length - parts.length
  const warnings = [
    ...state.warnings,
    ...(state.unread.length > 0 ? [totalCapWarning(state.unread.length)] : []),
    ...(rest > 0 ? [morePartsWarning(rest)] : []),
  ]

  return { parts, files: Array.from(new Set(parts.map(part => part.file))), memories, warnings }
}

/**
 * Reads the instruction files after the content consent, each once, in this order: the global
 * `<config folder>/CLAUDE.md` and its @imports depth first, at most 3 import levels and 20 imported files; the repo
 * chain, outermost first (SetupScan.claudeMd), then the @imports of the chain files above the repo the same way with a
 * budget of their own; each rule file of `.claude/rules` in name order; the root AGENTS.md when the repo has no root
 * CLAUDE.md; last the auto-memories of this repo (readMemories). A path in the repo is one whole 'repo' part, read only
 * through readRepoFile, its imports and links never read; a global file is a 'global' part per section; the chain
 * ancestors above the repo are private `global` parts; any other path is not read and gets a warning. Each file is read
 * with MAX_READ_BYTES and one over it is not split; the read stops at 512 KiB in all and counts the files it did not
 * read; parts past the 120th are not offered. A config folder inside the repo is not used, and an ignored
 * CLAUDE_CONFIG_DIR is warned about by the setup scan of the same run, not here. The text is held in memory for this
 * run; it is never logged, shown, asked or put in a reply, and originals are never edited.
 */
export async function readInstructionFiles(io: InitIo, sources: InstructionSources): Promise<InstructionScan> {
  const warnings: string[] = []
  const userDir = userDirOf(sources, [sources.root], [])
  const state: ReadState = {
    io,
    sources,
    userDir: userDir !== null && relativeTo(userDir, sources.root) === null ? userDir : null,
    parts: [],
    warnings,
    seen: new Set(),
    sizes: [],
    unread: [],
  }
  await readGlobal(state)
  await readChain(state)
  await readRules(state)
  await readAgentsMd(state)
  const read = await readMemories(io, sources.memoryFolders)
  state.warnings.push(...read.warnings)

  return scanOf(state, read.memories)
}
