/**
 * The instruction stage of init (G-02-1f, D-63, D-134, D-136, D-230), a layer 10 module: the content consent, asked
 * before any instruction or memory text is read, with its context line of what init found by name (contentContextLine);
 * the entry question of the instruction hand-out (instructionsEntry); each topic and memory as a hand-out item with its
 * question, context line and chip (topicItems, memoryItems); and instructionsStage, the pure stage that has the names
 * listed, asks the consent, then the whole-file questions or the parts flow (the read as an io effect, the model's
 * topics and recommendations as model effects, the hand-out), and in the memory go-back from the review asks the
 * hand-out it had again. Pure: it gives states and never performs an effect, imports core, paths, scan/instructions,
 * ui, init/handout, init/state and init/stages/memory, and never imports init/machine or init/run.
 */
import type {
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
import { redactedText } from '../../core/redact'
import { asSentence, idsOrNone, shown } from '../../core/text'
import { SCREEN_LIST_WORDS, t, tn } from '../../locales/t'
import { memoryFoldersOf } from '../../paths'
import { isMemoryIndexName } from '../../scan/instructions/memories'
import type { InstructionSources } from '../../scan/instructions/read'
import { ASK_HEADERS, choiceAnswer, countedChip, quotedLabels, withContext } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { instructionPartsContext, instructionsContext, memoryContext, topicContext } from '../../ui/blocks/context'
import { cappedList, instructionLines, sourceText, topicParts } from '../../ui/blocks/instructions'
import { ACCEPT_RECOMMENDATIONS, handoutAnswer, handoutEnter } from '../handout'
import type { HandoutEntry, HandoutItem, HandoutNext } from '../handout'
import { reusable, stageCancelled, stageDone, stageFailed, withEffect, withOutputs } from '../state'
import type { Answer, InitState, Kept, RepoNames, StageDef } from '../state'
import { memoryAnswer, memoryEnter } from './memory'
import type { MemoryNext } from './memory'

/**
 * The content consent question (G-02-1f "Consent first", D-134): no instruction or memory text is read before a yes,
 * and the question says that the model groups what is read.
 */
export const CONTENT_QUESTION = t('init.instructions.contentQuestion')

/**
 * Each content consent answer, the declining one first: the engine dialog starts with its first option focused, so a
 * quick Submit declines, and option 0 never consents (G-02-1f "Consent first", D-134).
 */
const CONTENT_CONSENTS: readonly Labelled<boolean>[] = Object.freeze([
  { label: t('init.instructions.consentNo'), value: false },
  { label: t('init.instructions.consentYes'), value: true },
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
export const CONTENT_DISMISSED_REASON = t('init.instructions.contentDismissedReason')

/** What the last sentence of the content consent context line says: a No keeps today's questions (D-63). */
const CONTENT_NO_TEXT = t('init.instructions.noText')

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
  const chain = tn('init.instructions.claudeMdFiles', setup.claudeMd.length, { count: setup.claudeMd.length })
  const ruleCount = repo.rules?.length ?? 0
  const rules = tn('init.instructions.ruleFiles', ruleCount, { count: ruleCount })
  const memoryCount = setup.memoryFiles.filter(name => !isMemoryIndexName(name)).length
  const memories = tn('init.instructions.memories', memoryCount, { count: memoryCount })
  const found = t('init.instructions.found', { global, chain, rules, agents: yesNo(repo.hasAgentsMd) })

  return t('init.instructions.contentContext', { found, memories, noText: CONTENT_NO_TEXT })
}

/** The entry question of the instruction hand-out (G-02-1f Entry choices): the parts and the memories. */
export const INSTRUCTIONS_ENTRY_QUESTION = t('init.instructions.instructionsEntryQuestion')

/** The entry answer that asks each topic once (G-02-1f Part by part). */
const PART_BY_PART_LABEL = t('init.instructions.partByPart')

/** The entry answer that keeps the whole-file questions of D-63 (G-02-1f Entry choices). */
const WHOLE_FILES_LABEL = t('init.instructions.wholeFiles')

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
  const files = tn('init.instructions.files', scan.files.length, { count: scan.files.length })
  const topicCount = tn('init.instructions.topics', topics.length, { count: topics.length })
  const memoryCount = tn('init.instructions.memories', scan.memories.length, { count: scan.memories.length })

  const topicsFrom = t('init.instructions.topicsFrom', { topicCount, files })

  return t('init.instructions.entryContext', { topics: topicsFrom, memoryCount })
}

/**
 * The entry question of the instruction hand-out as the hand-out asks it (G-02-1f Entry choices): its context line, the
 * Instructions chip and the three answers.
 */
export function instructionsEntry(scan: InstructionScan, topics: readonly InstructionTopic[]): HandoutEntry {
  return {
    question: INSTRUCTIONS_ENTRY_QUESTION,
    contextLine: entryContextLine(scan, topics),
    header: ASK_HEADERS.instructions,
    accept: ACCEPT_RECOMMENDATIONS,
    oneByOne: PART_BY_PART_LABEL,
    whole: WHOLE_FILES_LABEL,
  }
}

/** Why init cancels when a question of the instruction hand-out is dismissed or not answered (A1, D-45). */
export const HANDOUT_DISMISSED_REASON = t('init.instructions.handoutDismissedReason')

/** The most sources a topic's context line names before it counts the rest. */
const MAX_SHOWN_SOURCES = 3

/** The question of one topic (G-02-1f Part by part): which roles get it, by its title. */
export function topicQuestion(topic: InstructionTopic): string {
  return t('init.instructions.topicQuestion', { title: topic.title })
}

/**
 * The context line of a topic's question (G-02-1f Part by part, D-136): its summary, its secret-like spans hidden
 * (redactedText, E1, #163), as a sentence (asSentence, 02-GAPS-B2 N1), the roles the model recommended for it, or
 * none, then the file and heading of its first three parts, each cut as shown text, and how many more. The roles come
 * before the sources, so the context cap can only cut the sources (02-GAPS-B2 S5).
 */
export function topicContextLine(
  topic: InstructionTopic,
  parts: readonly InstructionPart[],
  recommended: readonly string[],
): string {
  const sources = cappedList(topicParts(topic, parts).map(part => shown(sourceText(part))), MAX_SHOWN_SOURCES)

  return t('init.instructions.topicContextLine', {
    asSentence: asSentence(redactedText(topic.summary)),
    recommended: idsOrNone(recommended, SCREEN_LIST_WORDS.none),
    sources,
  })
}

/**
 * The chip of a topic's question (G-02-3c): `Topic <i>/<n>`, or just `Topic` when that would be over the 12 code points
 * a chip shows.
 */
export function topicHeader(position: number, count: number): string {
  return countedChip(t('init.instructions.topicChip'), position, count)
}

/**
 * Each topic as a hand-out item (G-02-1f Part by part): its question, context line, chip, the roles recommended for
 * it, none when the recommendation gave it none, and its own context, that topic only (topicContext, D-236).
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
      contextLine: topicContextLine(topic, scan.parts, ids),
      header: topicHeader(index + 1, topics.length),
      recommended: ids,
      context: topicContext(topic, scan.parts, ids, index + 1, topics.length),
    }
  })
}

/** The question of one memory (G-02-1f Memories): which roles get it, by its file name. */
export function memoryItemQuestion(memory: MemoryItem): string {
  return t('init.instructions.memoryItemQuestion', { file: memory.file })
}

/**
 * The context line of a memory's question (G-02-1f Memories, D-136): its MEMORY.md summary, or NO_MEMORY_SUMMARY, its
 * secret-like spans hidden (redactedText, E1, #163), as a sentence (asSentence, 02-GAPS-B2 N1), and the roles the
 * model recommended for it, or none.
 */
export function memoryItemContextLine(memory: MemoryItem, recommended: readonly string[]): string {
  return t('init.instructions.memoryItemContextLine', {
    asSentence: asSentence(redactedText(memory.summary)),
    recommended: idsOrNone(recommended, SCREEN_LIST_WORDS.none),
  })
}

/**
 * The chip of a memory's question (G-02-3c): `Memory <i>/<n>`, or just `Memory` when that would be over the 12 code
 * points a chip shows.
 */
export function memoryItemHeader(position: number, count: number): string {
  return countedChip(t('init.instructions.memoryChip'), position, count)
}

/**
 * Each memory as a hand-out item (G-02-1f Memories), asked after the topics: its question, context line, chip, the
 * roles recommended for it, none when the recommendation gave it none, and its own context, that memory only
 * (memoryContext, D-236).
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
      contextLine: memoryItemContextLine(memory, ids),
      header: memoryItemHeader(index + 1, memories.length),
      recommended: ids,
      context: memoryContext(memory, ids, index + 1, memories.length),
    }
  })
}

/** What the instruction stage gives (G-02-1f): the roles with their instruction groups, and how it handed them out. */
export type Instructed = {
  readonly roles: readonly RoleSpec[]
  readonly instructions: InstructionHandout
}

/** What the parts flow found before the hand-out: the read, its topics and the roles recommended for each item. */
type PartsFound = {
  readonly scan: InstructionScan
  readonly topics: readonly InstructionTopic[]
  readonly recommended: ReadonlyMap<string, readonly string[]>
}

/** What the instruction stage works from: the team, the setup scan and where init runs. */
type InstructionInput = {
  readonly roles: readonly RoleSpec[]
  readonly setup: SetupScan
  readonly locations: NonNullable<InitState['draft']['locations']>
}

/** The InstructionInput of a state's draft; null while the roles, the scans or the locations are not set. */
function instructionInput(state: InitState): InstructionInput | null {
  const { roles, gathered, locations } = state.draft
  if (roles === undefined || gathered === undefined || locations === undefined) return null

  return { roles, setup: gathered.setup, locations }
}

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

/** The whole-files hand-out: the D-63 group questions were asked. */
const WHOLE: InstructionHandout = Object.freeze({ kind: 'whole' })

/** The stage done with `roles`, given their instruction groups, and the hand-out `instructions` (Instructed). */
function instructedDone(state: InitState, instructed: Instructed): InitState {
  return stageDone({ ...state, draft: { ...state.draft, ...instructed } })
}

/**
 * The content consent (G-02-1f "Consent first", D-134): CONTENT_QUESTION with what init found on its second line
 * (contentContextLine: the setup scan, and the rule files and AGENTS.md by name), No, skip it first, the Instructions
 * chip, the files and memories found by name as its own context (instructionsContext, D-236), and
 * CONTENT_DISMISSED_REASON for a dismissal.
 */
function contentAsk(setup: SetupScan, repo: RepoNames): ChoiceAsk<boolean> & { readonly dismissedReason: string } {
  return {
    question: withContext(CONTENT_QUESTION, contentContextLine(setup, repo)),
    spec: { options: CONTENT_OPTIONS, header: ASK_HEADERS.instructions, context: instructionsContext(setup, repo) },
    parse: parseContentConsent,
    accepts: quotedLabels(CONTENT_OPTIONS),
    dismissedReason: CONTENT_DISMISSED_REASON,
  }
}

/** The content consent asked `tries` times so far, `question` its text once refused. */
function contentAsked(
  state: InitState,
  input: InstructionInput,
  repo: RepoNames,
  tries: number,
  question: string | null,
): InitState {
  const ask = contentAsk(input.setup, repo)
  const asking: InitState = { ...state, sub: { kind: 'content', tries, repo } }

  return withEffect(asking, { kind: 'ask', question: question ?? ask.question, spec: ask.spec })
}

/** The instruction group questions (D-63, memoryAnswer) at `next`; the hand-out ends as `keep` (A1). */
function grouped(state: InitState, keep: InstructionHandout, next: MemoryNext): InitState {
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  if (next.kind === 'done') return instructedDone(state, { roles: next.roles, instructions: keep })
  const asking: InitState = { ...state, sub: { kind: 'memory', cursor: next.cursor, keep } }

  return withEffect(asking, { kind: 'ask', question: next.question, spec: next.spec })
}

/** The whole-file questions of D-63 (memoryEnter), handed out as `keep`. */
function wholeFiles(state: InitState, input: InstructionInput, keep: InstructionHandout): InitState {
  return grouped(state, keep, memoryEnter(input.roles, input.setup))
}

/**
 * The instruction hand-out at `next` (handoutAnswer): Whole files asks the whole-file questions; the other answers keep
 * the topics and memories with the roles given each, and give every role no D-63 group. The read, the topics and the
 * answers live in memory for this run; only the repo parts a role was given are planned, as its built CLAUDE.md
 * (repoPartsOf, planStep).
 */
function partsHandedOut(state: InitState, input: InstructionInput, found: PartsFound, next: HandoutNext): InitState {
  const { scan, topics, recommended } = found
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  if (next.kind === 'ask') {
    const sub: InitState['sub'] = { kind: 'parts-handout', cursor: next.cursor, scan, topics, recommended }

    return withEffect({ ...state, sub }, { kind: 'ask', question: next.question, spec: next.spec })
  }
  if (next.outcome.kind === 'whole') return wholeFiles(state, input, WHOLE)
  const instructions: InstructionHandout = { kind: 'parts', scan, topics, recommended, given: next.outcome.given }

  return instructedDone(state, { roles: withoutGroups(input.roles), instructions })
}

/**
 * The hand-out of what the parts flow found (G-02-1f Entry choices, Memories): the instructions block in the side pane
 * first (instructionLines), then the entry question, with that block as its own context (instructionPartsContext,
 * D-236), with the topics and then the memories as items.
 */
function handOutParts(state: InitState, input: InstructionInput, found: PartsFound): InitState {
  const { scan, topics, recommended } = found
  const lines = instructionLines(scan, topics, recommended)
  const shownBlock = withOutputs(state, [{ kind: 'show', block: { key: 'instructions', lines } }])
  const items = [...topicItems(scan, topics, recommended), ...memoryItems(scan.memories, recommended)]
  const entry = { ...instructionsEntry(scan, topics), context: instructionPartsContext(scan, topics, recommended) }
  const next = handoutEnter(entry, items, input.roles, HANDOUT_DISMISSED_REASON)

  return partsHandedOut(shownBlock, input, found, next)
}

/**
 * The kept results a review go-back reuses for the read `scan` (reusable, D-235): only those of a read with the same
 * part ids (ASKED #137). The kept topics name each part of their read once, and none when it had no part, so their part
 * ids are that read's; for another read there are none, and the model is called again, as on a first pass.
 */
function keptFor(state: InitState, scan: InstructionScan): Kept | null {
  const kept = reusable(state)
  if (kept === null || kept.topics === null) return null
  const ids = new Set(kept.topics.flatMap(topic => topic.partIds))
  const isSameRead = ids.size === scan.parts.length && scan.parts.every(part => ids.has(part.id))

  return isSameRead ? kept : null
}

/**
 * The roles recommended for the topics and the memories (G-02-1f Recommendation, Memories): the parts model effect,
 * which reads each role's work, the topics and the memories by file and summary; a review go-back hands them out with
 * the recommendation of the first pass, kept for the same role ids and part ids (keptFor, D-235).
 */
function recommending(
  state: InitState,
  input: InstructionInput,
  scan: InstructionScan,
  topics: readonly InstructionTopic[],
): InitState {
  const kept = keptFor(state, scan)?.parts ?? null
  if (kept !== null) return handOutParts(state, input, { scan, topics, recommended: kept })
  const calling: InitState = { ...state, sub: { kind: 'parts', scan, topics } }
  const { roles } = input

  return withEffect(calling, { kind: 'model', call: { id: 'parts', roles, topics, memories: scan.memories } })
}

/**
 * After the read (G-02-1f): a read with no part and no memory shows its read warnings, if any, in the instructions
 * block, then asks the whole-file questions; else the model groups the parts into topics across files (no call without
 * a part, the topics model effect), and a second call recommends roles for the topics and the memories. A review
 * go-back uses the topics of the first pass instead, kept for the same role ids and part ids (keptFor, D-235).
 */
function afterRead(state: InitState, input: InstructionInput, scan: InstructionScan): InitState {
  const isEmpty = scan.parts.length === 0 && scan.memories.length === 0
  if (isEmpty && scan.warnings.length === 0) return wholeFiles(state, input, WHOLE)
  if (isEmpty) {
    const lines = instructionLines(scan, [], new Map())

    return wholeFiles(withOutputs(state, [{ kind: 'show', block: { key: 'instructions', lines } }]), input, WHOLE)
  }
  if (scan.parts.length === 0) return recommending(state, input, scan, [])
  const kept = keptFor(state, scan)?.topics ?? null
  if (kept !== null) return recommending(state, input, scan, kept)

  return withEffect({ ...state, sub: { kind: 'topics', scan } }, { kind: 'model', call: { id: 'topics', scan } })
}

/**
 * The answer to the content consent (choiceAnswer): No asks the whole-file questions, handed out as `whole`, and Yes
 * has the instruction files and the memories read (the read-instruction-files io effect: the setup scan's chain, the
 * rule files and AGENTS.md init found by name, and the memory folders of this repo). Any other answer is asked again
 * with why on top; a dismissal cancels with CONTENT_DISMISSED_REASON and MAX_ASKS answers it cannot read with
 * NO_USABLE_ANSWER_REASON (A1).
 */
function afterContent(
  state: InitState,
  input: InstructionInput,
  sub: { readonly tries: number; readonly repo: RepoNames },
  answer: string | null,
): InitState {
  const next = choiceAnswer(contentAsk(input.setup, sub.repo), sub, answer)
  if (next.kind === 'again') return contentAsked(state, input, sub.repo, next.sub.tries, next.question)
  if (next.kind === 'cancelled') return stageCancelled(state, next.reason)
  if (!next.value) return wholeFiles(state, input, WHOLE)
  const { root, home, configDir } = input.locations
  const memoryFolders = memoryFoldersOf(input.locations)
  const sources: InstructionSources = { root, home, configDir, chain: input.setup.claudeMd, ...sub.repo, memoryFolders }
  const reading: InitState = { ...state, sub: { kind: 'instruction-read' } }

  return withEffect(reading, { kind: 'io', call: { id: 'read-instruction-files', sources } })
}

/**
 * After the names (G-02-1f Sources): with no global CLAUDE.md, no CLAUDE.md in the repo chain, no rule file, no
 * AGENTS.md and no memory file nothing is asked, the hand-out is `none` and every role gets no group; else the content
 * consent, so no instruction or memory text is read before a yes.
 */
function afterNames(state: InitState, input: InstructionInput, repo: RepoNames): InitState {
  if (hasInstructionFiles(input.setup, repo)) return contentAsked(state, input, repo, 1, null)

  return instructedDone(state, { roles: withoutGroups(input.roles), instructions: { kind: 'none' } })
}

/** The answer to the effect the instruction stage has out: a host operation, a model call, or a question. */
function instructionsAnswer(state: InitState, answer: Answer): InitState {
  const input = instructionInput(state)
  if (input === null) return stageFailed(state)
  const { sub } = state
  if (answer.kind === 'io') {
    const { result } = answer
    if (result.id === 'repo-instruction-names' && sub.kind === 'start') return afterNames(state, input, result.result)
    const isRead = result.id === 'read-instruction-files' && sub.kind === 'instruction-read'

    return isRead ? afterRead(state, input, result.result) : stageFailed(state)
  }
  if (answer.kind === 'model') {
    const { result } = answer
    if (result.id === 'topics' && sub.kind === 'topics') return recommending(state, input, sub.scan, result.result)
    if (result.id !== 'parts' || sub.kind !== 'parts') return stageFailed(state)

    return handOutParts(state, input, { scan: sub.scan, topics: sub.topics, recommended: result.result })
  }
  switch (sub.kind) {
    case 'content':
      return afterContent(state, input, sub, answer.text)
    case 'parts-handout': {
      const { scan, topics, recommended } = sub

      return partsHandedOut(state, input, { scan, topics, recommended }, handoutAnswer(sub.cursor, answer.text))
    }
    case 'memory':
      return grouped(state, sub.keep, memoryAnswer(input.roles, input.setup, sub.cursor, answer.text))
    default:
      return stageFailed(state)
  }
}

/**
 * The instruction stage (G-02-1f, replacing the D-63 group step among the role steps, D-230), the same in a plain init
 * and in --dry-run. It first has `.claude/rules` listed and AGENTS.md looked up, by name only (the
 * repo-instruction-names io effect, afterNames), then asks the content consent (afterContent): No asks the whole-file
 * questions, handed out as `whole`, and Yes runs the parts flow (afterRead). In the memory go-back from the review it
 * asks again what it handed out (D-204): a parts hand-out goes back to its entry question with the same read, topics
 * and recommendations, its block shown again first, so nothing is read and the model is not called again; a whole-files
 * or none hand-out asks the whole-file questions as before and keeps its kind. A dismissal of any of its questions is
 * cancelled with that question's reason, and MAX_ASKS answers it cannot read with NO_USABLE_ANSWER_REASON (A1). The
 * stage writes nothing; the repo parts it hands out reach the plan through the draft (repoPartsOf).
 */
export const instructionsStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => {
    const input = instructionInput(state)
    if (input === null) return stageFailed(state)
    const { instructions } = state.draft
    const isAgain = state.returnAfter === 'instructions' && instructions !== undefined
    if (isAgain && instructions.kind === 'parts') return handOutParts(state, input, instructions)
    if (isAgain) return wholeFiles(state, input, instructions)

    return withEffect(state, { kind: 'io', call: { id: 'repo-instruction-names', root: input.locations.root } })
  },
  answer: instructionsAnswer,
})
