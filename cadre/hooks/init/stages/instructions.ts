/**
 * The instruction stage of init (G-02-1f, D-63, D-134, D-136), a layer 10 module: the content consent, asked before
 * any instruction or memory text is read, with its context line of what init found by name (contentContextLine); the
 * entry question of the instruction hand-out (instructionsEntry); each topic and memory as a hand-out item with its
 * question, context line and chip (topicItems, memoryItems); instructionsStep, which asks the consent, then the
 * whole-file questions or the parts flow (the read, the model's topics and recommendations, the hand-out); and
 * instructionsAgain, the step again for the review item memory. Pure: it asks, reads and calls the model through the
 * InitIo port it is given, imports core, paths, scan/instructions, suggest, ui, init/draft, init/handout and
 * init/stages/memory, and never imports init.ts, which imports it, or init/run.
 */
import type {
  InitIo,
  InitLocations,
  InstructionHandout,
  InstructionPart,
  InstructionScan,
  InstructionTopic,
  MemoryItem,
  RoleSpec,
  SetupScan,
} from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { asSentence, countedNoun, idsOrNone, shown } from '../../core/text'
import { memoryFoldersOf } from '../../paths'
import { isMemoryIndexName } from '../../scan/instructions/memories'
import { readInstructionFiles, repoInstructionNames } from '../../scan/instructions/read'
import type { InstructionSources } from '../../scan/instructions/read'
import { checkedCompletion } from '../../suggest/checked'
import type { Checked } from '../../suggest/checked'
import { parseRecommendation, RECOMMEND_SYSTEM, recommendPrompt } from '../../suggest/instructions'
import { fallbackTopics, parseTopics, TOPICS_SYSTEM, topicsPrompt } from '../../suggest/topics'
import {
  accepted,
  ASK_HEADERS,
  askChoice,
  choiceResult,
  countedChip,
  quotedLabels,
  showBlock,
  withContext,
} from '../../ui/ask'
import type { ChoiceAsk, StepResult } from '../../ui/ask'
import { cappedList, instructionLines, sourceText, topicParts } from '../../ui/blocks/instructions'
import { mapped } from '../draft'
import { ACCEPT_RECOMMENDATIONS, handoutStep } from '../handout'
import type { HandoutEntry, HandoutItem } from '../handout'
import { memoryStep } from './memory'

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

/** What the instruction step gives (G-02-1f): the roles with their instruction groups, and how it handed them out. */
export type Instructed = {
  readonly roles: readonly RoleSpec[]
  readonly instructions: InstructionHandout
}

/** What the parts flow found before the hand-out: the read, its topics and the roles recommended for each topic. */
type PartsFound = {
  readonly scan: InstructionScan
  readonly topics: readonly InstructionTopic[]
  readonly recommended: ReadonlyMap<string, readonly string[]>
}

/** What init finds of the repo's own instruction files before the content consent, by name only (G-02-1f Sources). */
type RepoNames = Pick<InstructionSources, 'rules' | 'hasAgentsMd'>

/** Whether the setup scan found what the whole-file questions ask about: the global CLAUDE.md, a chain or a memory. */
function hasSetupFiles(setup: SetupScan): boolean {
  return setup.hasGlobalClaudeMd || setup.claudeMd.length > 0 || setup.memoryFiles.length > 0
}

/** Whether init found anything to hand out: what the setup scan found, a rule file or AGENTS.md (G-02-1f). */
function hasInstructionFiles(setup: SetupScan, repo: RepoNames): boolean {
  return hasSetupFiles(setup) || (repo.rules ?? []).length > 0 || repo.hasAgentsMd
}

/** The roles with no instruction group: nothing to hand out, or the parts flow, gives no D-63 group to any role. */
function withoutGroups(roles: readonly RoleSpec[]): RoleSpec[] {
  return roles.map(role => ({ ...role, instructions: [] }))
}

/** Nothing to hand out (G-02-1f): no question is asked, the hand-out is `none` and every role gets no group. */
function nothingToHandOut(roles: readonly RoleSpec[]): StepResult<Instructed> {
  return accepted({ roles: withoutGroups(roles), instructions: { kind: 'none' } })
}

/** The whole-files hand-out: the D-63 group questions were asked. */
const WHOLE: InstructionHandout = { kind: 'whole' }

/** The whole-file questions of D-63 (memoryStep), handed out as `whole`; a cancel keeps its reason (A1). */
async function wholeFiles(io: InitIo, roles: readonly RoleSpec[], setup: SetupScan): Promise<StepResult<Instructed>> {
  return mapped(await memoryStep(io, roles, setup), (given): Instructed => ({ roles: given, instructions: WHOLE }))
}

/**
 * The content consent as askChoice asks it (G-02-1f "Consent first", D-134): CONTENT_QUESTION with what init found on
 * its second line (contentContextLine: the setup scan, and the rule files and AGENTS.md by name), No, skip it first,
 * and the Instructions chip.
 */
function contentAsk(setup: SetupScan, repo: RepoNames): ChoiceAsk<boolean> {
  return {
    question: withContext(CONTENT_QUESTION, contentContextLine(setup, repo)),
    spec: { options: CONTENT_OPTIONS, header: ASK_HEADERS.instructions },
    parse: parseContentConsent,
    accepts: quotedLabels(CONTENT_OPTIONS),
  }
}

/**
 * The topics of a read (G-02-1f Part unit): one model call groups the parts across files (topicsPrompt, TOPICS_SYSTEM).
 * A reply parseTopics cannot take is sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all
 * (checkedCompletion), and then each file is one topic (fallbackTopics). The model has no tools (D-83), and only its
 * checked topics are kept.
 */
async function groupedTopics(io: InitIo, scan: InstructionScan): Promise<readonly InstructionTopic[]> {
  const partIds = scan.parts.map(part => part.id)
  const parse = (reply: string): Checked<readonly InstructionTopic[]> => {
    const parsed = parseTopics(reply, partIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.topics }
  }
  const prompt = (errors: readonly string[]): string => topicsPrompt(scan.parts, errors)

  return checkedCompletion(io, TOPICS_SYSTEM, prompt, parse, () => fallbackTopics(scan))
}

/**
 * The roles recommended for each topic and each memory (G-02-1f Recommendation, Memories): a second model call reads
 * each role's work, the topics and the memories by file and summary (recommendPrompt, RECOMMEND_SYSTEM). A reply
 * parseRecommendation cannot take is sent back with its exact errors, MAX_PROPOSE_ATTEMPTS calls in all
 * (checkedCompletion), and then no topic or memory is recommended to any role: the map is empty.
 */
async function recommendedRoles(
  io: InitIo,
  roles: readonly RoleSpec[],
  topics: readonly InstructionTopic[],
  memories: readonly MemoryItem[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const topicIds = topics.map(topic => topic.id)
  const memoryIds = memories.map(memory => memory.id)
  const roleIds = roles.map(role => role.id)
  const parse = (reply: string): Checked<ReadonlyMap<string, readonly string[]>> => {
    const parsed = parseRecommendation(reply, topicIds, memoryIds, roleIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.recommended }
  }
  const prompt = (errors: readonly string[]): string => recommendPrompt(roles, topics, memories, errors)

  return checkedCompletion(io, RECOMMEND_SYSTEM, prompt, parse, () => new Map())
}

/**
 * The hand-out of what the parts flow found (G-02-1f Entry choices, Memories): the instructions block in the side pane
 * first (instructionLines), then the entry question and its answers (handoutStep), with the topics as items and then
 * the memories. Whole files asks the whole-file questions (memoryStep); the other answers keep the topics and memories
 * with the roles given each, and give every role no D-63 group. The read, the topics and the answers live in memory
 * for this run; only the repo parts a role was given are planned, as its built CLAUDE.md (repoPartsOf, planStep).
 */
async function handOutParts(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  found: PartsFound,
): Promise<StepResult<Instructed>> {
  const { scan, topics, recommended } = found
  await showBlock(io, 'instructions', instructionLines(scan, topics, recommended))
  const items = [...topicItems(scan, topics, recommended), ...memoryItems(scan.memories, recommended)]
  const outcome = await handoutStep(io, instructionsEntry(scan, topics), items, roles, HANDOUT_DISMISSED_REASON)
  if (outcome.kind === 'cancelled') return outcome
  if (outcome.value.kind === 'whole') return wholeFiles(io, roles, setup)
  const instructions: InstructionHandout = { kind: 'parts', scan, topics, recommended, given: outcome.value.given }

  return accepted({ roles: withoutGroups(roles), instructions })
}

/**
 * A consented read that gave no part and no memory (G-02-1f): its read warnings, if any, in the instructions block,
 * so each is shown, then the whole-file questions (memoryStep).
 */
async function noPartRead(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  scan: InstructionScan,
): Promise<StepResult<Instructed>> {
  if (scan.warnings.length > 0) await showBlock(io, 'instructions', instructionLines(scan, [], new Map()))

  return wholeFiles(io, roles, setup)
}

/**
 * The parts flow after a yes (G-02-1f): it reads the instruction files and the memories (readInstructionFiles: the
 * setup scan's chain, the rule files and AGENTS.md init found by name, and the memory folders of this repo); a read
 * with no part and no memory goes to the whole-file questions (noPartRead); else the model groups the parts into
 * topics across files (no call without a part), a second call recommends roles for the topics and the memories, and
 * the person hands them out (handOutParts).
 */
async function partsFlow(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  locations: InitLocations,
  repo: RepoNames,
): Promise<StepResult<Instructed>> {
  const { root, home, configDir } = locations
  const memoryFolders = memoryFoldersOf(locations)
  const scan = await readInstructionFiles(io, { root, home, configDir, chain: setup.claudeMd, ...repo, memoryFolders })
  if (scan.parts.length === 0 && scan.memories.length === 0) return noPartRead(io, roles, setup, scan)
  const topics = scan.parts.length === 0 ? [] : await groupedTopics(io, scan)
  const recommended = await recommendedRoles(io, roles, topics, scan.memories)

  return handOutParts(io, roles, setup, { scan, topics, recommended })
}

/**
 * The instruction step (G-02-1f, replacing the D-63 group step in the per-role steps), the same in a plain init and in
 * --dry-run. It first lists `.claude/rules` and stats AGENTS.md, by name only (repoInstructionNames); with no global
 * CLAUDE.md, no CLAUDE.md in the repo chain, no rule file, no AGENTS.md and no memory file it asks nothing, hands out
 * `none` and gives every role no group. Else it asks the content consent (contentAsk), so no instruction or memory
 * text is read before a yes: No asks the whole-file questions (memoryStep), handed out as `whole`, and Yes runs the
 * parts flow (partsFlow). A dismissal of any of its questions is cancelled with that question's reason, and MAX_ASKS
 * answers it cannot read with NO_USABLE_ANSWER_REASON (A1). The step writes nothing, and the roles it is given never
 * change; the repo parts it hands out reach the plan through the draft (repoPartsOf).
 */
export async function instructionsStep(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  locations: InitLocations,
): Promise<StepResult<Instructed>> {
  const repo = await repoInstructionNames(io, locations.root)
  if (!hasInstructionFiles(setup, repo)) return nothingToHandOut(roles)
  const consent = choiceResult(await askChoice(io, contentAsk(setup, repo)), CONTENT_DISMISSED_REASON)
  if (consent.kind === 'cancelled') return consent
  if (!consent.value) return wholeFiles(io, roles, setup)

  return partsFlow(io, roles, setup, locations, repo)
}

/**
 * The instruction step again, for the review item memory (G-02-1f): a parts hand-out goes back to its entry question
 * with the same read, topics and recommendations, its block shown again first, so nothing is read and the model is not
 * called again (handOutParts); a whole-files or none hand-out asks the whole-file questions as before (memoryStep) and
 * keeps its kind.
 */
export async function instructionsAgain(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
  handout: InstructionHandout,
): Promise<StepResult<Instructed>> {
  if (handout.kind === 'parts') return handOutParts(io, roles, setup, handout)

  return mapped(await memoryStep(io, roles, setup), (given): Instructed => ({ roles: given, instructions: handout }))
}
