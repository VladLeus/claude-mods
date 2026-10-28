/**
 * The instruction parts of G-02-1f: the content consent, reading the instruction files and splitting them into parts,
 * the prompts and reply parsers of the two model calls (grouping the parts into topics across files, and recommending
 * roles per topic), the side-pane block, the questions of the hand-out, the review rows and how regen tells kept,
 * changed, added and removed parts and memories apart by their hashes (partChanges). Pure: it reads only through the
 * InitIo port it is given, and it never imports init.ts, which imports it. The text is held in memory for this run; it
 * is never logged, shown, asked or put in a reply; a repo part a role is given is written to its
 * `.cadre/<id>/CLAUDE.md` after Confirm (generate.ts); originals are never edited.
 */
import type {
  InstructionPart,
  InstructionPartRecord,
  InstructionScan,
  InstructionTopic,
  MemoryItem,
  RoleSpec,
  SetupScan,
} from '../types'
import { ASK_HEADERS, countedChip } from './ask'
import { labelled } from './core/labelled'
import type { Labelled } from './core/labelled'
import { asSentence, clean, countedNoun, idsOrNone, moreLine, shown } from './core/text'
import { ACCEPT_RECOMMENDATIONS } from './handout'
import type { HandoutEntry, HandoutItem } from './handout'
import { TOP_OF_FILE } from './records'
import { isMemoryIndexName } from './scan/instructions/memories'
import type { InstructionSources } from './scan/instructions/read'
import { fallbackTopics } from './suggest/topics'

/**
 * The content consent question (G-02-1f "Consent first", D-134): no instruction or memory text is read before a yes,
 * and the question says that the model groups what is read.
 */
export const CONTENT_QUESTION =
  'Read your CLAUDE.md files, rules and memories, and let the model group them into parts for each role? ' +
  'Nothing from your global files or memories is committed, and originals are never edited.'

/**
 * Each content consent answer, the declining one first: the engine dialog starts with its first option focused, so a
 * quick Submit declines, and option 0 never consents (G-02-1f "Consent first", D-134).
 */
const CONTENT_CONSENTS: readonly Labelled<boolean>[] = Object.freeze([
  { label: 'No, skip it', value: false },
  { label: 'Yes, read them', value: true },
])

/** The answers to the content consent question, No, skip it first (D-134). */
export const CONTENT_OPTIONS: readonly string[] = Object.freeze(CONTENT_CONSENTS.map(entry => entry.label))

/**
 * Whether a content consent answer allows the read (G-02-1f "Consent first"): the label it names, trimmed and in any
 * case; null when it names neither, so it is asked again.
 */
export function parseContentConsent(answer: string): boolean | null {
  return labelled(CONTENT_CONSENTS, answer)
}

/** Why init cancels when the content consent is dismissed or not answered (A1, D-45). */
export const CONTENT_DISMISSED_REASON = 'The instruction files question was dismissed or not answered.'

/** What the last sentence of the content consent context line says: a No keeps today's questions (D-63). */
const CONTENT_NO_TEXT = 'No keeps the whole-file questions.'

/** A fact as the content consent context line says it: yes or no. */
function yesNo(isThere: boolean): string {
  return isThere ? 'yes' : 'no'
}

/**
 * The context line of the content consent (G-02-1f, D-136): what init found before it reads anything, by name only
 * (the global CLAUDE.md, the CLAUDE.md files of the repo chain, the rule files of `.claude/rules`, the root AGENTS.md
 * and the memory files, MEMORY.md in any letter case not counted, as the hand-out never offers it; 02-GAPS-B2 S9,
 * 02-GAPS-B3 N2), and that No keeps the whole-file questions. A rules folder that could not be listed counts 0 rule
 * files.
 */
export function contentContextLine(
  setup: Pick<SetupScan, 'hasGlobalClaudeMd' | 'claudeMd' | 'memoryFiles'>,
  repo: Pick<InstructionSources, 'rules' | 'hasAgentsMd'>,
): string {
  const global = yesNo(setup.hasGlobalClaudeMd)
  const chain = countedNoun(setup.claudeMd.length, 'CLAUDE.md file', 'CLAUDE.md files')
  const rules = countedNoun(repo.rules?.length ?? 0, 'rule file', 'rule files')
  const memoryCount = setup.memoryFiles.filter(name => !isMemoryIndexName(name)).length
  const memories = countedNoun(memoryCount, 'memory', 'memories')
  const found = `global CLAUDE.md ${global}, ${chain} in the repo chain, ${rules}, AGENTS.md ${yesNo(repo.hasAgentsMd)}`

  return `Found: ${found}, ${memories}. ${CONTENT_NO_TEXT}`
}

/** The entry question of the instruction hand-out (G-02-1f Entry choices): the parts and the memories. */
export const INSTRUCTIONS_ENTRY_QUESTION = 'How do you want to hand out the instruction parts and memories?'

/** The entry answer that asks each topic once (G-02-1f Part by part). */
const PART_BY_PART_LABEL = 'Go part by part'

/** The entry answer that keeps the whole-file questions of D-63 (G-02-1f Entry choices). */
const WHOLE_FILES_LABEL = 'Whole files'

/** The answers to the entry question, in the order the dialog shows them (G-02-1f Entry choices). */
export const INSTRUCTIONS_ENTRY_OPTIONS: readonly string[] = Object.freeze([
  ACCEPT_RECOMMENDATIONS,
  PART_BY_PART_LABEL,
  WHOLE_FILES_LABEL,
])

/**
 * The context line of the entry question (G-02-1f, D-136): how many topics the parts of how many files make and how
 * many memories there are, and that the side pane shows each with the roles it is recommended for.
 */
export function entryContextLine(scan: InstructionScan, topics: readonly InstructionTopic[]): string {
  const files = countedNoun(scan.files.length, 'file', 'files')
  const topicCount = `${countedNoun(topics.length, 'topic', 'topics')} from ${files}`
  const memoryCount = countedNoun(scan.memories.length, 'memory', 'memories')

  return `${topicCount} and ${memoryCount}; the pane shows each with the roles it is recommended for.`
}

/**
 * The entry question of the instruction hand-out as handoutStep asks it (G-02-1f Entry choices): its context line, the
 * Instructions chip and the three answers.
 */
export function instructionsEntry(scan: InstructionScan, topics: readonly InstructionTopic[]): HandoutEntry {
  return {
    question: INSTRUCTIONS_ENTRY_QUESTION,
    context: entryContextLine(scan, topics),
    header: ASK_HEADERS.instructions,
    accept: ACCEPT_RECOMMENDATIONS,
    oneByOne: PART_BY_PART_LABEL,
    whole: WHOLE_FILES_LABEL,
  }
}

/** Why init cancels when a question of the instruction hand-out is dismissed or not answered (A1, D-45). */
export const HANDOUT_DISMISSED_REASON =
  'A question on which roles get instruction parts was dismissed or not answered.'

/**
 * Where a part comes from, as the pane and a topic's context line show it: its file, cleaned, then its heading
 * (G-02-1f; 02-GAPS-B2 N3: the file is cleaned only where it is shown).
 */
function sourceText(part: InstructionPart): string {
  return `${clean(part.file)} > ${part.heading === '' ? TOP_OF_FILE : part.heading}`
}

/** The parts a topic holds, in the topic's order; an id no part has is skipped. */
function topicParts(topic: InstructionTopic, parts: readonly InstructionPart[]): InstructionPart[] {
  const byId = new Map(parts.map((part): [string, InstructionPart] => [part.id, part]))

  return topic.partIds.flatMap(id => {
    const found = byId.get(id)

    return found === undefined ? [] : [found]
  })
}

/** Items joined with `, `: the first `max`, then `+N more` when more remain. */
function cappedList(items: readonly string[], max: number): string {
  const shown = items.slice(0, max)
  const rest = items.length - shown.length

  return (rest > 0 ? [...shown, moreLine(rest)] : shown).join(', ')
}

/** The most sources a topic's context line names before it counts the rest. */
const MAX_SHOWN_SOURCES = 3

/** The question of one topic (G-02-1f Part by part): which roles get it, by its title. */
export function topicQuestion(topic: InstructionTopic): string {
  return `Which roles get "${topic.title}"?`
}

/**
 * The context line of a topic's question (G-02-1f Part by part, D-136): its summary as a sentence (asSentence,
 * 02-GAPS-B2 N1), the roles the model recommended for it, or none, then the file and heading of its first three parts,
 * each cut as shown text, and how many more. The roles come before the sources, so the context cap can only cut the
 * sources (02-GAPS-B2 S5).
 */
export function topicContextLine(
  topic: InstructionTopic,
  parts: readonly InstructionPart[],
  recommended: readonly string[],
): string {
  const sources = cappedList(topicParts(topic, parts).map(part => shown(sourceText(part))), MAX_SHOWN_SOURCES)

  return `${asSentence(topic.summary)} Recommended: ${idsOrNone(recommended)}. From: ${sources}.`
}

/**
 * The chip of a topic's question (G-02-3c): `Topic <i>/<n>`, or just `Topic` when that would be over the 12 code points
 * a chip shows.
 */
export function topicHeader(position: number, count: number): string {
  return countedChip('Topic', position, count)
}

/**
 * Each topic as a hand-out item (G-02-1f Part by part): its question, context line, chip and the roles recommended for
 * it, none when the recommendation gave it none.
 */
export function topicItems(
  scan: InstructionScan,
  topics: readonly InstructionTopic[],
  recommended: ReadonlyMap<string, readonly string[]>,
): HandoutItem[] {
  return topics.map((topic, index) => {
    const ids = recommended.get(topic.id) ?? []

    return {
      id: topic.id,
      question: topicQuestion(topic),
      context: topicContextLine(topic, scan.parts, ids),
      header: topicHeader(index + 1, topics.length),
      recommended: ids,
    }
  })
}

/** The question of one memory (G-02-1f Memories): which roles get it, by its file name. */
export function memoryItemQuestion(memory: MemoryItem): string {
  return `Which roles get the memory "${memory.file}"?`
}

/**
 * The context line of a memory's question (G-02-1f Memories, D-136): its MEMORY.md summary, or NO_MEMORY_SUMMARY, as a
 * sentence (asSentence, 02-GAPS-B2 N1), and the roles the model recommended for it, or none.
 */
export function memoryItemContextLine(memory: MemoryItem, recommended: readonly string[]): string {
  return `${asSentence(memory.summary)} Recommended: ${idsOrNone(recommended)}.`
}

/**
 * The chip of a memory's question (G-02-3c): `Memory <i>/<n>`, or just `Memory` when that would be over the 12 code
 * points a chip shows.
 */
export function memoryItemHeader(position: number, count: number): string {
  return countedChip('Memory', position, count)
}

/**
 * Each memory as a hand-out item (G-02-1f Memories), asked after the topics: its question, context line, chip and the
 * roles recommended for it, none when the recommendation gave it none.
 */
export function memoryItems(
  memories: readonly MemoryItem[],
  recommended: ReadonlyMap<string, readonly string[]>,
): HandoutItem[] {
  return memories.map((memory, index) => {
    const ids = recommended.get(memory.id) ?? []

    return {
      id: memory.id,
      question: memoryItemQuestion(memory),
      context: memoryItemContextLine(memory, ids),
      header: memoryItemHeader(index + 1, memories.length),
      recommended: ids,
    }
  })
}

/** The first row of the instructions block (G-02-1f; AUTO-PICK #12): what a plain init writes after Confirm. */
const READ_HEADING =
  'Read for this run; a plain init writes the repo parts you hand out to .cadre/<role>/CLAUDE.md after Confirm:'

/** The row of the instructions block when the model gave no usable recommendation (G-02-1f Recommendation). */
const NO_RECOMMENDATION_ROW = 'The model gave no usable recommendation: no role gets a part unless you pick one.'

/** The row of the instructions block when the grouping fell back to one topic per file (G-02-1f Part unit). */
const FILE_TOPICS_ROW = 'The model could not group the parts: each file is one topic.'

/** Whether two topics are the same: id, title, summary and parts. */
function isSameTopic(topic: InstructionTopic, other: InstructionTopic | undefined): boolean {
  if (other === undefined) return false

  return (
    topic.id === other.id &&
    topic.title === other.title &&
    topic.summary === other.summary &&
    topic.partIds.join('\n') === other.partIds.join('\n')
  )
}

/** Whether the topics are the grouping fallback of this read: each file one topic (fallbackTopics). */
function isFileGrouping(scan: InstructionScan, topics: readonly InstructionTopic[]): boolean {
  const fallback = fallbackTopics(scan)

  return topics.length === fallback.length && topics.every((topic, index) => isSameTopic(topic, fallback[index]))
}

/** One topic's rows in the instructions block: title and summary, each source on its own row, the recommended roles. */
function topicRows(topic: InstructionTopic, parts: readonly InstructionPart[], ids: readonly string[]): string[] {
  return [
    `  ${topic.title}: ${topic.summary}`,
    ...topicParts(topic, parts).map(part => `    from: ${sourceText(part)}`),
    `    recommended: ${idsOrNone(ids)}`,
  ]
}

/** The row that heads the memories in the instructions block (G-02-1f Memories). */
const MEMORIES_HEADING = 'Memories (each linked, never copied, when a role gets it):'

/** One memory's rows in the instructions block: its file and summary, then the recommended roles; never its text. */
function memoryRows(memory: MemoryItem, ids: readonly string[]): string[] {
  return [`  ${memory.file}: ${memory.summary}`, `    recommended: ${idsOrNone(ids)}`]
}

/**
 * The instructions block of the side pane (G-02-1f): READ_HEADING, then each topic with its summary, one `from:` row
 * per source (file and heading, never text) and the roles recommended for it, then, when there are memories,
 * MEMORIES_HEADING and each memory with its summary and recommended roles (never its folder, hash or text), then each
 * read warning as `warning: <text>`. When the model gave no usable recommendation (an empty map) for any topic or
 * memory, and when the topics are the one-per-file fallback, a row says so. The text of a part is never in it.
 */
export function instructionLines(
  scan: InstructionScan,
  topics: readonly InstructionTopic[],
  recommended: ReadonlyMap<string, readonly string[]>,
): string[] {
  const rows = topics.flatMap(topic => topicRows(topic, scan.parts, recommended.get(topic.id) ?? []))
  const memoryLines = scan.memories.flatMap(memory => memoryRows(memory, recommended.get(memory.id) ?? []))
  const memories = memoryLines.length === 0 ? [] : [MEMORIES_HEADING, ...memoryLines]
  const hasTopics = topics.length > 0
  const hasItems = hasTopics || scan.memories.length > 0
  const notes = [
    ...(hasItems && recommended.size === 0 ? [NO_RECOMMENDATION_ROW] : []),
    ...(hasTopics && isFileGrouping(scan, topics) ? [FILE_TOPICS_ROW] : []),
  ]

  return [READ_HEADING, ...rows, ...memories, ...scan.warnings.map(warning => `warning: ${warning}`), ...notes]
}

/** The most topic titles a review row names before it counts the rest. */
const MAX_SHOWN_TITLES = 3

/**
 * One role's review row (G-02-1f): `none` when it gets no topic and no memory; else how many topics it gets with
 * their first titles, `0 topics` with none, then how many memories.
 */
function roleItemsLine(id: string, topics: readonly InstructionTopic[], memories: number): string {
  if (topics.length === 0 && memories === 0) return `  ${id}: none`
  const memoryCount = countedNoun(memories, 'memory', 'memories')
  const topicCount = countedNoun(topics.length, 'topic', 'topics')
  if (topics.length === 0) return `  ${id}: ${topicCount}; ${memoryCount}`
  const titles = cappedList(topics.map(topic => topic.title), MAX_SHOWN_TITLES)

  return `  ${id}: ${topicCount}: ${titles}; ${memoryCount}`
}

/**
 * The review rows of the parts flow (G-02-1f), shown after the scope cards: per role, in role order, the topics it was
 * given (three titles, then how many more) and how many memories, or none, each followed by the rows `rowsAfter` gives
 * for that role (02-GAPS-B3 N3; none by default), then how many topics and memories no role was given, which stay with
 * the root session only.
 */
export function instructionReviewLines(
  roles: readonly Pick<RoleSpec, 'id'>[],
  topics: readonly InstructionTopic[],
  memories: readonly Pick<MemoryItem, 'id'>[],
  given: ReadonlyMap<string, readonly string[]>,
  rowsAfter: (roleId: string) => readonly string[] = () => [],
): string[] {
  const isGiven = (itemId: string, roleId: string): boolean => given.get(itemId)?.includes(roleId) === true
  const isKept = (itemId: string): boolean => (given.get(itemId) ?? []).length === 0
  const keptTopics = countedNoun(topics.filter(topic => isKept(topic.id)).length, 'topic', 'topics')
  const keptMemories = countedNoun(memories.filter(memory => isKept(memory.id)).length, 'memory', 'memories')
  const roleLine = (id: string): string => {
    const roleTopics = topics.filter(topic => isGiven(topic.id, id))

    return roleItemsLine(id, roleTopics, memories.filter(memory => isGiven(memory.id, id)).length)
  }

  return [
    'Instructions per role:',
    ...roles.flatMap(role => [roleLine(role.id), ...rowsAfter(role.id)]),
    `Kept with the root session only: ${keptTopics}, ${keptMemories}`,
  ]
}

/** A part as a role's records name it (G-02-1f Regen): its file, its heading and the SHA-256 of its text. */
export type PartRecord = InstructionPartRecord

/** A memory as a role's records name it (G-02-1f Regen): its file and the SHA-256 of its text. */
export type MemoryRecord = Pick<MemoryItem, 'file' | 'hash'>

/** Parts and memories as regen reads them again from the files a role's records name (G-02-1f Regen, D-142 rg2-a). */
export type RegenItems = {
  readonly parts: readonly InstructionPart[]
  readonly memories: readonly MemoryItem[]
}

/** The records of a role's parts and memories (G-02-1f Regen). */
export type RegenRecords = {
  readonly parts: readonly PartRecord[]
  readonly memories: readonly MemoryRecord[]
}

/**
 * What changed in a role's parts and memories since they were recorded (G-02-1f Regen): `kept`, `changed` and `added`
 * hold the items as they are now, in the order given; `removed` holds the records no current item matches, in record
 * order.
 */
export type PartChanges = {
  readonly kept: RegenItems
  readonly changed: RegenItems
  readonly added: RegenItems
  readonly removed: RegenRecords
}

/** A part or a memory, or a record of one: what partChanges matches by. */
type Hashed = { readonly file: string; readonly hash: string }

/** One kind of item matched against its records (matchedItems). */
type Matched<T, R> = {
  readonly kept: T[]
  readonly changed: T[]
  readonly added: T[]
  readonly removed: R[]
}

/**
 * Items matched against records (G-02-1f Regen), each record used once: an item with a record that `isSame` names and
 * that has its hash is kept; then, in item order, one with a record `isSame` names and another hash is changed; an item
 * left over whose file a record names is added, and a record left over is removed. Matching the hash first keeps two
 * sections under one heading apart.
 */
function matchedItems<T extends Hashed, R extends Hashed>(
  items: readonly T[],
  records: readonly R[],
  isSame: (record: R, item: T) => boolean,
): Matched<T, R> {
  const unused = [...records]
  const take = (isMatch: (record: R) => boolean): boolean => {
    const at = unused.findIndex(isMatch)
    if (at < 0) return false
    unused.splice(at, 1)

    return true
  }
  // Both passes run in item order and use each record once, so they are kept as flags by index.
  const isKept = items.map(item => take(record => isSame(record, item) && record.hash === item.hash))
  const isChanged = items.map((item, index) => isKept[index] !== true && take(record => isSame(record, item)))
  const isLeft = (index: number): boolean => isKept[index] !== true && isChanged[index] !== true
  const named = new Set(records.map(record => record.file))

  return {
    kept: items.filter((_, index) => isKept[index] === true),
    changed: items.filter((_, index) => isChanged[index] === true),
    added: items.filter((item, index) => isLeft(index) && named.has(item.file)),
    removed: unused,
  }
}

/**
 * How a role's parts and memories changed since they were recorded (G-02-1f Regen; pure). A recorded part whose file
 * and heading match a current part with the same hash is kept; same file and heading with another hash is changed; a
 * current part with no record left to match, in a file the records name, is added; a record no current part matches is
 * removed, so a section moved to another file is removed and, when the records name that file, added. The same for
 * memories by file and hash: a memory is its own file, so one no record names is never added; only /cadre init finds a
 * new file (D-142 rg2-a). Neither input is changed.
 */
export function partChanges(stored: RegenRecords, current: RegenItems): PartChanges {
  const isSamePart = (record: PartRecord, part: InstructionPart): boolean =>
    record.file === part.file && record.heading === part.heading
  const parts = matchedItems(current.parts, stored.parts, isSamePart)
  const memories = matchedItems(current.memories, stored.memories, (record, memory) => record.file === memory.file)

  return {
    kept: { parts: parts.kept, memories: memories.kept },
    changed: { parts: parts.changed, memories: memories.changed },
    added: { parts: parts.added, memories: memories.added },
    removed: { parts: parts.removed, memories: memories.removed },
  }
}
