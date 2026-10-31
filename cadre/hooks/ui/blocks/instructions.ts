/**
 * The instruction blocks, a layer 8 module: the side-pane block of the instruction parts and memories and the review
 * rows per role (G-02-1f), with the source, topic-part and capped-list helpers the hand-out questions share. It
 * imports the grouping fallback of suggest/topics, records, core and the types, so init and the instruction questions
 * read it here.
 */
import type { InstructionPart, InstructionScan, InstructionTopic, MemoryItem, RoleSpec } from '../../../types'
import { redactedText } from '../../core/redact'
import { clean, idsOrNone } from '../../core/text'
import { SCREEN_LIST_WORDS, t, tn } from '../../locales/t'
import { TOP_OF_FILE } from '../../records'
import { fallbackTopics } from '../../suggest/topics'

/**
 * Where a part comes from, as the pane and a topic's context line show it: its file, cleaned, then its heading
 * (G-02-1f; 02-GAPS-B2 N3: the file is cleaned only where it is shown).
 */
export function sourceText(part: InstructionPart): string {
  return t('ui.instructions.sourceText', {
    file: clean(part.file),
    value: part.heading === '' ? TOP_OF_FILE : part.heading,
  })
}

/** The parts a topic holds, in the topic's order; an id no part has is skipped. */
export function topicParts(topic: InstructionTopic, parts: readonly InstructionPart[]): InstructionPart[] {
  const byId = new Map(parts.map((part): [string, InstructionPart] => [part.id, part]))

  return topic.partIds.flatMap(id => {
    const found = byId.get(id)

    return found === undefined ? [] : [found]
  })
}

/** Items joined with `, `: the first `max`, then `+N more` when more remain. */
export function cappedList(items: readonly string[], max: number): string {
  const shown = items.slice(0, max)
  const rest = items.length - shown.length

  return (rest > 0 ? [...shown, SCREEN_LIST_WORDS.more(rest)] : shown).join(', ')
}

/** The first row of the instructions block (G-02-1f; AUTO-PICK #12): what a plain init writes after Confirm. */
const READ_HEADING = t('ui.instructions.readHeading')

/** The row of the instructions block when the model gave no usable recommendation (G-02-1f Recommendation). */
const NO_RECOMMENDATION_ROW = t('ui.instructions.noRecommendationRow')

/** The row of the instructions block when the grouping fell back to one topic per file (G-02-1f Part unit). */
const FILE_TOPICS_ROW = t('ui.instructions.fileTopicsRow')

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

/**
 * One topic's rows in the instructions block: title and summary, the summary's secret-like spans hidden (redactedText,
 * E1, #163), each source on its own row, the recommended roles.
 */
function topicRows(topic: InstructionTopic, parts: readonly InstructionPart[], ids: readonly string[]): string[] {
  return [
    t('ui.instructions.topicRows', { title: topic.title, summary: redactedText(topic.summary) }),
    ...topicParts(topic, parts).map(part => t('ui.instructions.topicRows2', { source: sourceText(part) })),
    t('ui.instructions.topicRows3', { ids: idsOrNone(ids, SCREEN_LIST_WORDS.none) }),
  ]
}

/** The row that heads the memories in the instructions block (G-02-1f Memories). */
const MEMORIES_HEADING = t('ui.instructions.memoriesHeading')

/**
 * One memory's rows in the instructions block: its file and summary, the summary's secret-like spans hidden
 * (redactedText, E1, #163), then the recommended roles; never its text.
 */
function memoryRows(memory: MemoryItem, ids: readonly string[]): string[] {
  return [t('ui.instructions.memoryRows', {
    file: memory.file,
    summary: redactedText(memory.summary),
  }), t('ui.instructions.memoryRows2', {
    ids: idsOrNone(ids, SCREEN_LIST_WORDS.none),
  })]
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

  return [READ_HEADING, ...rows, ...memories, ...scan.warnings.map(warning => t('ui.instructions.instructionLines', {
    warning,
  })), ...notes]
}

/** The most topic titles a review row names before it counts the rest. */
const MAX_SHOWN_TITLES = 3

/**
 * One role's review row (G-02-1f): `none` when it gets no topic and no memory; else how many topics it gets with
 * their first titles, `0 topics` with none, then how many memories.
 */
function roleItemsLine(id: string, topics: readonly InstructionTopic[], memories: number): string {
  if (topics.length === 0 && memories === 0) return t('ui.instructions.roleItemsLine', { id })
  const memoryCount = tn('init.instructions.memories', memories, { count: memories })
  const topicCount = tn('init.instructions.topics', topics.length, { count: topics.length })
  if (topics.length === 0) return t('ui.instructions.roleItemsLine2', { id, topicCount, memoryCount })
  const titles = cappedList(topics.map(topic => topic.title), MAX_SHOWN_TITLES)

  return t('ui.instructions.roleItemsLine3', { id, topicCount, titles, memoryCount })
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
  const keptTopicCount = topics.filter(topic => isKept(topic.id)).length
  const keptMemoryCount = memories.filter(memory => isKept(memory.id)).length
  const keptTopics = tn('init.instructions.topics', keptTopicCount, { count: keptTopicCount })
  const keptMemories = tn('init.instructions.memories', keptMemoryCount, { count: keptMemoryCount })
  const roleLine = (id: string): string => {
    const roleTopics = topics.filter(topic => isGiven(topic.id, id))

    return roleItemsLine(id, roleTopics, memories.filter(memory => isGiven(memory.id, id)).length)
  }

  return [
    t('ui.instructions.instructionReviewLines'),
    ...roles.flatMap(role => [roleLine(role.id), ...rowsAfter(role.id)]),
    t('ui.instructions.instructionReviewLines2', { keptTopics, keptMemories }),
  ]
}
