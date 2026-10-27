/**
 * The rule walk, a layer 3 module: the rule files below the repo's `.claude/rules`, breadth first and bounded in
 * levels and entries, each walk deciding whether links count and which folders it may list (G-02-1f, 02-GAPS-B2 M4).
 * It stats and lists through the init port and reads no file. It imports core, paths, the port reads and the types,
 * so the instruction reads and /cadre start walk the rules here.
 */
import type { InitIo, PortEntry, PortStat } from '../../types'
import { sortedUnique } from '../core/text'
import { trimSlash } from '../paths'
import { missingState } from './port-read'

/** The repo folder of the rule files (G-02-1f Sources), below the root; walked with its sub-folders (02-GAPS-B2 M4). */
export const RULES_FOLDER = '.claude/rules'

/** The most folder levels the rule walk lists, `.claude/rules` itself the first (02-GAPS-B2 M4). */
export const MAX_RULE_LEVELS = 5

/** The most listed entries the rule walk takes, every folder together; it stops there (02-GAPS-B2 M4). */
export const MAX_RULE_ENTRIES = 500

/**
 * How one rule walk treats links and folders (02-GAPS-B2 M4): whether a link is taken, as a rule file when its name
 * ends in `.md` and else as a folder to enter, and which stat of a folder lets the walk list it.
 */
export type RuleWalk = {
  readonly isTakenLink: boolean
  readonly isFolderUsable: (stat: PortStat | null) => boolean
}

/** The extension of a rule file. */
const RULE_EXTENSION = '.md'

/** A folder the rule walk listed: its path relative to the rules folder ('' for that folder), level and entries. */
type RuleFolder = {
  readonly rel: string
  readonly level: number
  readonly entries: readonly PortEntry[]
}

/** Whether a listed entry is a rule file for the walk: a `.md` name that is a regular file, or a link when taken. */
function isRuleFile(entry: PortEntry, walk: RuleWalk): boolean {
  if (!entry.name.endsWith(RULE_EXTENSION)) return false
  if (entry.isLink) return walk.isTakenLink

  return entry.kind === 'file'
}

/** Whether a listed entry is a folder the walk may enter: a real folder, or a link not named `.md` when taken. */
function isRuleFolder(entry: PortEntry, walk: RuleWalk): boolean {
  if (entry.isLink) return walk.isTakenLink && !entry.name.endsWith(RULE_EXTENSION)

  return entry.kind === 'dir'
}

/** The entries of a folder below the rules folder, or null when its stat does not let the walk list it or it fails. */
async function ruleFolderEntries(io: InitIo, path: string, walk: RuleWalk): Promise<readonly PortEntry[] | null> {
  if (!walk.isFolderUsable(await io.stat(path))) return null

  return io.list(path)
}

/**
 * The rule files below `<root>/.claude/rules` (02-GAPS-B2 M4), as paths relative to that folder, sorted and once each.
 * The walk is breadth first, from the rules folder (level 1) down to MAX_RULE_LEVELS; each folder is stat-ed and
 * listed only when `walk.isFolderUsable` takes its stat. A rules folder that is not there (missingState `absent`) has
 * none; one whose stat is not usable or that cannot be listed gives null. A sub-folder that cannot be listed is
 * skipped. Every listed entry counts toward MAX_RULE_ENTRIES, and the walk stops there. A `.md` name that is a regular
 * file, or a link when `walk.isTakenLink`, is a rule file; a folder, or a link not named `.md` when links are taken, is
 * entered unless it lies below the last level.
 */
export async function ruleFiles(io: InitIo, root: string, walk: RuleWalk): Promise<readonly string[] | null> {
  const top = `${trimSlash(root)}/${RULES_FOLDER}`
  const stat = await io.stat(top)
  if (stat === null) return (await missingState(io, top)) === 'absent' ? [] : null
  if (!walk.isFolderUsable(stat)) return null
  const entries = await io.list(top)
  if (entries === null) return null
  const found: string[] = []
  // The queue grows as the walk finds folders, so it is read breadth first.
  const queue: RuleFolder[] = [{ rel: '', level: 1, entries }]
  let listed = 0
  for (const folder of queue) {
    for (const entry of folder.entries) {
      if (listed === MAX_RULE_ENTRIES) return sortedUnique(found)
      listed += 1
      const rel = folder.rel === '' ? entry.name : `${folder.rel}/${entry.name}`
      if (isRuleFile(entry, walk)) found.push(rel)
      if (folder.level === MAX_RULE_LEVELS || !isRuleFolder(entry, walk)) continue
      const below = await ruleFolderEntries(io, `${top}/${rel}`, walk)
      if (below !== null) queue.push({ rel, level: folder.level + 1, entries: below })
    }
  }

  return sortedUnique(found)
}
