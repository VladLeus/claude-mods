/**
 * The instruction parts of G-02-1f: the content consent, reading the instruction files and splitting them into parts,
 * the prompts and reply parsers of the two model calls (grouping the parts into topics across files, and recommending
 * roles per topic), the side-pane block, the questions of the hand-out, the review rows and how regen tells kept,
 * changed, added and removed parts and memories apart by their hashes (partChanges). Pure: it reads only through the
 * InitIo port it is given, and it never imports init.ts, which imports it. The text is held in memory for this run; it
 * is never logged, shown, asked or put in a reply; a repo part a role is given is written to its
 * `.cadre/<id>/CLAUDE.md` after Confirm (generate.ts); originals are never edited.
 */
import type { InstructionPart, InstructionScan, InstructionTopic, MemoryItem, SetupScan } from '../types'
import { labelled } from './core/labelled'
import type { Labelled } from './core/labelled'
import { asSentence, countedNoun, idsOrNone, shown } from './core/text'
import { ACCEPT_RECOMMENDATIONS } from './handout'
import type { HandoutEntry, HandoutItem } from './handout'
import { isMemoryIndexName } from './scan/instructions/memories'
import type { InstructionSources } from './scan/instructions/read'
import { ASK_HEADERS, countedChip } from './ui/ask'
import { cappedList, sourceText, topicParts } from './ui/blocks/instructions'

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
