/**
 * The regen hand-out, a layer 10 module: what changed in the files and memories a role's records name, the one
 * recommendation call and the one question per item in a session, the dropped lines and warnings, and the role and
 * private files the answers give (G-02-1f Regen, D-142, AUTO-PICK #19). It imports the apply runner and private types,
 * core, generate/gittrack, records, the scans' memory summary, the suggest call and regen prompt, ui/ask, the part
 * changes, the side read and the types, so regen's entry and plan read it here.
 */
import type {
  AskContext,
  HostIo,
  InitIo,
  InitLocations,
  InstructionPart,
  InstructionPartRecord,
  MemoryItem,
  RoleSpec,
  SetupScan,
} from '../../types'
import type { PrivateRole } from '../apply/private'
import { repoNameOf } from '../apply/run'
import { labelled } from '../core/labelled'
import type { Labelled } from '../core/labelled'
import { redactedText } from '../core/redact'
import { asSentence, clean, reportText } from '../core/text'
import { GIT_TRACKING_UNKNOWN_WARNING, trackedParts } from '../generate/gittrack'
import { t, tn } from '../locales/t'
import { partRecord, TOP_OF_FILE, withPartRecords } from '../records'
import { NO_MEMORY_SUMMARY } from '../scan/instructions/memories'
import { checkedCompletion } from '../suggest/checked'
import type { Checked } from '../suggest/checked'
import { parseRegenRecommendation, REGEN_RECOMMEND_SYSTEM, regenRecommendPrompt } from '../suggest/regen'
import type { RegenPromptItem } from '../suggest/regen'
import { accepted, askChoice, choiceResult, countedChip, paneQuestionOf, quotedLabels } from '../ui/ask'
import type { ChoiceAsk, StepResult } from '../ui/ask'
import { partChanges } from './part-changes'
import type { PartChanges } from './part-changes'
import { isNamedBy, privateRecordOf, privateSideRead, recordPlacesOf, repoSideRead } from './side-read'
import type { RegenSide } from './side-read'

/** Whether an item a regen asks about is new since init or changed since (G-02-1f Regen, D-142). */
export type RegenChange = 'new' | 'changed'

/** Each answer to a regen question with what it does: Yes gives the item to the role, No leaves it out (D-142). */
const REGEN_CHOICES: readonly Labelled<boolean>[] = Object.freeze([
  { label: t('regen.review.yes'), value: true },
  { label: t('regen.review.no'), value: false },
])

/** The answers to a regen question, Yes first (D-142). */
export const REGEN_ITEM_OPTIONS: readonly string[] = Object.freeze(REGEN_CHOICES.map(entry => entry.label))

/**
 * Why regen cancels when a regen question is dismissed or not answered (D-142, A1); MAX_ASKS answers it cannot read
 * give NO_USABLE_ANSWER_REASON.
 */
export const REGEN_DISMISSED_REASON = t('regen.review.regenDismissedReason')

/** The chip of a regen question (D-142, G-02-3c): `Regen <i>/<n>`, or just `Regen` when that is over 12 code points. */
export function regenHeader(position: number, count: number): string {
  return countedChip(t('regen.review.chip'), position, count)
}

/** A part's heading as regen names it: the heading, or TOP_OF_FILE for the text before the first heading. */
function headingText(heading: string): string {
  return heading === '' ? TOP_OF_FILE : heading
}

/**
 * The regen question of a part (D-142): whether the role gets it, by its heading, its secret-like spans hidden
 * (redactedText, E1, #163), and its file, cleaned; regen makes no grouping call, so a part is named by where it is,
 * not by a topic.
 */
export function regenPartQuestion(id: string, part: Pick<InstructionPart, 'file' | 'heading'>): string {
  return t('regen.review.regenPartQuestion', {
    id,
    heading: redactedText(headingText(part.heading)),
    file: clean(part.file),
  })
}

/** How the context line of a regen question names each kind of item (D-142). */
const REGEN_CHANGE_TEXTS: Readonly<Record<RegenChange, string>> = Object.freeze({
  new: t('regen.review.changeNew'),
  changed: t('regen.review.changeChanged'),
})

/** The context line of a part's regen question (D-142): whether it is new or changed, then the recommendation. */
export function regenPartContextLine(change: RegenChange, isRecommended: boolean): string {
  return t('regen.review.regenPartContextLine', {
    regenChangeTexts: REGEN_CHANGE_TEXTS[change],
    value: isRecommended ? t('ui.scan.yes') : t('ui.scan.no'),
  })
}

/** The regen question of a memory (D-142): whether the role gets it, by its file name, cleaned. */
export function regenMemoryQuestion(id: string, memory: Pick<MemoryItem, 'file'>): string {
  return t('regen.review.regenMemoryQuestion', { id, file: clean(memory.file) })
}

/**
 * The context line of a memory's regen question (D-142): the summary its record holds, or NO_MEMORY_SUMMARY, its
 * secret-like spans hidden (redactedText, E1, #163), as a sentence (asSentence), then what a part's context line says
 * (regenPartContextLine). MEMORY.md is not read for it (AUTO-PICK #19 Q10).
 */
export function regenMemoryContextLine(
  memory: Pick<MemoryItem, 'summary'>,
  change: RegenChange,
  isRecommended: boolean,
): string {
  const summary = memory.summary === '' ? NO_MEMORY_SUMMARY : memory.summary

  return `${asSentence(redactedText(summary))} ${regenPartContextLine(change, isRecommended)}`
}

/** The reply line of a part regen dropped from a role because it is gone from its file (G-02-1f Regen). */
export function partDroppedLine(id: string, record: Pick<InstructionPartRecord, 'file' | 'heading'>): string {
  return t('regen.review.partDroppedLine', { id, file: clean(record.file), heading: headingText(record.heading) })
}

/** The reply line of a memory regen dropped from a role because its file is gone (G-02-1f Regen). */
export function memoryDroppedLine(id: string, memory: Pick<MemoryItem, 'file'>): string {
  return t('regen.review.memoryDroppedLine', { id, file: clean(memory.file) })
}

/**
 * The warning of a regen where no one can be asked, such as `claude -p` (D-142 rg1-a): how many new or changed parts
 * and memories were left out of the role, and the command that asks about them.
 */
export function notHandedOutWarning(id: string, count: number): string {
  return tn('regen.review.notHandedOut', count, { count, id })
}

/** One new or changed item a regen asks about (G-02-1f Regen, D-142), as its side found it. */
export type RegenAsk =
  | { readonly kind: 'part'; readonly part: InstructionPart; readonly change: RegenChange }
  | { readonly kind: 'memory'; readonly memory: MemoryItem; readonly change: RegenChange }

/**
 * The context of one regen question (D-236): what changed in that item, where it is (a part's file and heading, a
 * memory's file and summary, never its folder or text), whether it is new or changed since init and whether it is
 * recommended, titled by its place among the questions; its summary is that recommendation line (D-310).
 */
export function regenPartContext(
  item: RegenAsk,
  isRecommended: boolean,
  place: { readonly position: number; readonly count: number },
): AskContext {
  const summary = item.kind === 'memory' && item.memory.summary === '' ? NO_MEMORY_SUMMARY : null
  const where =
    item.kind === 'part'
      ? t('regen.review.partSource', {
        file: clean(item.part.file),
        heading: redactedText(headingText(item.part.heading)),
      })
      : t('regen.review.memorySource', {
        file: clean(item.memory.file),
        value: redactedText(summary ?? item.memory.summary),
      })
  const recommended = t('regen.review.recommended', { value: isRecommended ? t('ui.scan.yes') : t('ui.scan.no') })
  const lines = [reportText(where), REGEN_CHANGE_TEXTS[item.change], recommended]

  return { title: t('regen.review.pagedChip', {
    position: place.position,
    count: place.count,
  }), lines, kind: 'regen-part', summary: recommended }
}

/** What changed on one side since its records were made, and what regen asks about it (sideChanges). */
type SideChanges = {
  readonly side: RegenSide
  readonly changes: PartChanges
  readonly asked: readonly RegenAsk[]
}

/** The parts now, less one part for each not-given record it matches by file, heading and hash, each record once. */
function openParts(parts: readonly InstructionPart[], notGiven: readonly InstructionPartRecord[]): InstructionPart[] {
  const unused = [...notGiven]
  const open: InstructionPart[] = []
  for (const part of parts) {
    const at = unused.findIndex(record => isNamedBy(record, part) && record.hash === part.hash)
    if (at < 0) {
      open.push(part)
      continue
    }
    unused.splice(at, 1)
  }

  return open
}

/**
 * What changed on one side since its records were made (G-02-1f Regen, AUTO-PICK #19 Q1): a part that matches a
 * not-given record exactly stays not given (openParts), and partChanges compares the given records and the memories
 * with the rest. Regen asks, in file order, each changed part and each part neither list names by file and heading
 * (new), then each changed memory; a changed part the role was not given is not asked, and a memory is never new,
 * since only /cadre init finds a new file (D-142 rg2-a).
 */
function sideChanges(side: RegenSide): SideChanges {
  const open = openParts(side.current.parts, side.notGiven)
  const records = { parts: side.given, memories: side.memories }
  const changes = partChanges(records, { parts: open, memories: side.current.memories })
  const kept = new Set(changes.kept.parts)
  const changed = new Set(changes.changed.parts)
  const isNew = (part: InstructionPart): boolean =>
    !kept.has(part) && !changed.has(part) && !side.notGiven.some(record => isNamedBy(record, part))
  const parts = open.flatMap((part): RegenAsk[] => {
    if (changed.has(part)) return [{ kind: 'part', part, change: 'changed' }]

    return isNew(part) ? [{ kind: 'part', part, change: 'new' }] : []
  })
  const memories = changes.changed.memories.map((memory): RegenAsk => ({ kind: 'memory', memory, change: 'changed' }))

  return { side, changes, asked: [...parts, ...memories] }
}

/**
 * What one side gives after the questions (G-02-1f Regen, D-142): the parts the role holds now and every other part of
 * the files read, both in file order, the memories it holds now, whether its built text and its records change, the
 * reply lines of what was dropped, and how many items were left out because no one could be asked.
 */
type SideResult = {
  readonly given: readonly InstructionPart[]
  readonly notGiven: readonly InstructionPart[]
  readonly memories: readonly MemoryItem[]
  readonly isTextChanged: boolean
  readonly isRecordsChanged: boolean
  readonly dropped: readonly string[]
  readonly leftOut: number
}

/**
 * One side after the questions (G-02-1f Regen, D-142 rg1-a; AUTO-PICK #19 Q1, Q3): the role holds each kept part and
 * memory and, in a session, each asked one answered Yes (`yes`); every other part of the files read is not given, and
 * a memory answered No leaves its record. Its built text changes when a given part changed or is gone, or a new part
 * was taken; its records change only in a session, when an item was asked or one is gone, so where no one can be asked
 * no record is written and a removed item is reported again until a session regen drops it. Each removed part and
 * memory gives its reply line.
 */
function sideResult(id: string, found: SideChanges, yes: ReadonlySet<RegenAsk>, isSession: boolean): SideResult {
  const { side, changes, asked } = found
  const taken = asked.filter(item => yes.has(item))
  const takenParts = taken.flatMap(item => (item.kind === 'part' ? [item.part] : []))
  const takenMemories = taken.flatMap(item => (item.kind === 'memory' ? [item.memory] : []))
  const heldParts = new Set([...changes.kept.parts, ...takenParts])
  const heldMemories = new Set([...changes.kept.memories, ...takenMemories])
  const { removed } = changes
  const isGone = removed.parts.length > 0 || removed.memories.length > 0

  return {
    given: side.current.parts.filter(part => heldParts.has(part)),
    notGiven: side.current.parts.filter(part => !heldParts.has(part)),
    memories: side.current.memories.filter(memory => heldMemories.has(memory)),
    isTextChanged:
      removed.parts.length > 0 || changes.changed.parts.length > 0 || taken.some(item => item.change === 'new'),
    isRecordsChanged: isSession && (isGone || asked.length > 0),
    dropped: [
      ...removed.parts.map(record => partDroppedLine(id, record)),
      ...removed.memories.map(memory => memoryDroppedLine(id, memory)),
    ],
    leftOut: isSession ? 0 : asked.length,
  }
}

/** The status line the TUI default shows while regen asks the model about the changed parts (D-232). */
const REGEN_PROGRESS = t('init.status.regen')

/**
 * The recommendation for each item a regen asks about, by `I<n>` (G-02-1f Regen, D-142): one model call with the role
 * and the items (regenRecommendPrompt, REGEN_RECOMMEND_SYSTEM), REGEN_PROGRESS on the status line (D-232) and how many
 * items it reads as the loader's summary (D-301). A reply parseRegenRecommendation cannot take is sent back with its
 * exact errors, MAX_PROPOSE_ATTEMPTS calls in all (checkedCompletion), and then no item is recommended.
 */
async function regenRecommended(
  io: InitIo,
  role: RoleSpec,
  asked: readonly RegenAsk[],
): Promise<ReadonlyMap<string, boolean>> {
  const itemIds = asked.map((_, index) => `I${index + 1}`)
  const items = asked.map(
    (item): RegenPromptItem =>
      item.kind === 'part' ? { kind: 'part', part: item.part } : { kind: 'memory', memory: item.memory },
  )
  const parse = (reply: string): Checked<ReadonlyMap<string, boolean>> => {
    const parsed = parseRegenRecommendation(reply, itemIds)
    if (parsed.kind === 'invalid') return parsed

    return { kind: 'ok', value: parsed.recommended }
  }
  const prompt = (errors: readonly string[]): string => regenRecommendPrompt(role, items, errors)

  const step = { label: REGEN_PROGRESS, summary: tn('init.status.count.items', asked.length, { count: asked.length }) }

  return checkedCompletion(io, step, REGEN_RECOMMEND_SYSTEM, prompt, parse, () => new Map())
}

/**
 * The question of one regen item (D-142): the part question (regenPartQuestion) or the memory question
 * (regenMemoryQuestion) with its context line, Yes and No, the chip of its place (regenHeader) and what changed in it
 * as its own context (regenPartContext, D-236), whose summary, whether the model recommends the item, a pane surface
 * asks in place of the context line (D-310); an answer that is neither is asked again with why on top (D-136).
 */
function regenAsk(
  id: string,
  item: RegenAsk,
  isRecommended: boolean,
  place: { readonly position: number; readonly count: number },
): ChoiceAsk<boolean> {
  const sentence = item.kind === 'part' ? regenPartQuestion(id, item.part) : regenMemoryQuestion(id, item.memory)
  const contextLine =
    item.kind === 'part'
      ? regenPartContextLine(item.change, isRecommended)
      : regenMemoryContextLine(item.memory, item.change, isRecommended)
  const context = regenPartContext(item, isRecommended, place)
  const pane = paneQuestionOf(sentence, contextLine, context.summary)

  return {
    question: pane.asked,
    spec: {
      options: REGEN_ITEM_OPTIONS,
      header: regenHeader(place.position, place.count),
      context: { ...context, pane },
    },
    parse: answer => labelled(REGEN_CHOICES, answer),
    accepts: quotedLabels(REGEN_ITEM_OPTIONS),
  }
}

/**
 * The answers to the questions of a regen in a session (G-02-1f Regen, D-142 rg1-a): one recommendation call for every
 * item (regenRecommended), then each item's question in order (regenAsk); it gives the items answered Yes. A dismissal
 * is cancelled with REGEN_DISMISSED_REASON and MAX_ASKS answers that are neither with NO_USABLE_ANSWER_REASON, so
 * nothing is written (A1, AUTO-PICK #19 Q7).
 */
async function regenAnswers(
  io: InitIo,
  role: RoleSpec,
  asked: readonly RegenAsk[],
): Promise<StepResult<ReadonlySet<RegenAsk>>> {
  const recommended = await regenRecommended(io, role, asked)
  const yes = new Set<RegenAsk>()
  for (const [index, item] of asked.entries()) {
    const place = { position: index + 1, count: asked.length }
    const ask = regenAsk(role.id, item, recommended.get(`I${place.position}`) === true, place)
    const answer = choiceResult(await askChoice(io, ask), REGEN_DISMISSED_REASON)
    if (answer.kind === 'cancelled') return answer
    if (answer.value) yes.add(item)
  }

  return accepted(yes)
}

/**
 * The repo side as a plain regen may write it (02-GAPS-B2 M3): when it rebuilds the built file or writes the records,
 * `git ls-files` runs once (trackedParts) for the files of the parts it would write, and only the parts of files git
 * tracks are kept, the built text then changing when a given part is left out; each other file is a warning. When git
 * cannot be asked the side is left as it is (null) with GIT_TRACKING_UNKNOWN_WARNING. A dry run holds no host and asks
 * no git, so its plan may show a part that apply then leaves out.
 */
async function trackedSide(
  host: HostIo | null,
  root: string,
  id: string,
  result: SideResult,
): Promise<{ readonly result: SideResult | null; readonly warnings: readonly string[] }> {
  if (host === null || !(result.isTextChanged || result.isRecordsChanged)) return { result, warnings: [] }
  const parts = [...result.given, ...(result.isRecordsChanged ? result.notGiven : [])]
  const tracked = await trackedParts(host, root, new Map([[id, parts]]))
  if (tracked.warnings.includes(GIT_TRACKING_UNKNOWN_WARNING)) return { result: null, warnings: tracked.warnings }
  const kept = new Set(tracked.repoParts.get(id) ?? [])
  const given = result.given.filter(part => kept.has(part))
  const notGiven = result.notGiven.filter(part => kept.has(part))
  const isTextChanged = result.isTextChanged || given.length < result.given.length

  return { result: { ...result, given, notGiven, isTextChanged }, warnings: tracked.warnings }
}

/**
 * Which private files regen rebuilds (G-02-1f Regen; AUTO-PICK #19 Q3, Q4, Q11): when the records change, the record,
 * and the text file too when its text changes or the role is left with nothing, so both files say so; with no record
 * change, as where no one can be asked, the text file alone when its text changes; else none.
 */
function privateRebuildOf(result: SideResult): NonNullable<PrivateRole['rebuild']> | null {
  if (!result.isRecordsChanged) return result.isTextChanged ? 'text' : null
  const isEmpty = result.given.length === 0 && result.memories.length === 0

  return result.isTextChanged || isEmpty ? 'both' : 'record'
}

/**
 * The private files regen rebuilds for a role, or null when it rebuilds none (privateRebuildOf): its role memory
 * folder, the repo's folder name for the text file's header, the global parts and memories it holds now, and the
 * other global parts of the files read, which its record names as not given (AUTO-PICK #19 Q1).
 */
function privateRoleOf(id: string, folder: string, repo: string, result: SideResult): PrivateRole | null {
  const rebuild = privateRebuildOf(result)
  if (rebuild === null) return null
  const { given: parts, memories, notGiven } = result

  return { id, folder, repo, parts, memories, partsNotGiven: notGiven.map(partRecord), rebuild }
}

/** The role with the repo records of this side (withPartRecords): the parts it holds now, and the other parts read. */
function recordedRole(role: RoleSpec, side: SideResult): RoleSpec {
  return withPartRecords(role, side.given.map(partRecord), side.notGiven.map(partRecord))
}

/**
 * What regen hands out for its role (G-02-1f Regen, D-142): the role role.json is planned from, with new records when
 * they change (AUTO-PICK #19 Q2), and whether they do; the repo parts its built CLAUDE.md is rebuilt from, null to
 * keep that file as it is (Q4); its private files to rebuild, null for none; the reply lines of what was dropped; the
 * warnings printed with the scan warnings; the warnings of the git check, printed with what the apply did; whether a
 * dialog could be shown, so the improver may run after a plain regen; and the role memory folder, whose private files
 * the improver run of the built CLAUDE.md watches (02-GAPS-B3 M1).
 */
export type RegenHanded = {
  readonly role: RoleSpec
  readonly isRoleWritten: boolean
  readonly repoParts: readonly InstructionPart[] | null
  readonly privateRole: PrivateRole | null
  readonly dropped: readonly string[]
  readonly warnings: readonly string[]
  readonly untracked: readonly string[]
  readonly isSession: boolean
  /** The role memory folder, null when it is not known (02-GAPS-B3 M1). */
  readonly folder: string | null
}

/**
 * The hand-out of a regen (G-02-1f Regen, D-142). A role.json with no part records, written before them, hands out
 * nothing, so regen runs as before. Else regen reads again only the files and memories the records name (rg2-a): the
 * repo side from role.json (repoSideRead) and, in a plain regen, the private side from the role's hand-out record
 * (privateRecordOf, privateSideRead); a --dry-run compares the repo side only (AUTO-PICK #19 Q5). Each side gives what
 * changed and what to ask (sideChanges): the repo side's parts, then the global parts, then the memories. In a session
 * that can show a dialog, with an item to ask, one recommendation call and one question per item follow (regenAnswers,
 * rg1-a), in a --dry-run too (Q6), and a cancel gives its reason (Q7); where no one can be asked nothing is, and the
 * items left out give notHandedOutWarning. Then each side's result (sideResult): the repo side is checked against git
 * in a plain regen (trackedSide), sets its records on the role when they change (withPartRecords) and rebuilds the
 * built file from its parts when its text changes; the private side gives the files of the role memory folder to
 * rebuild (privateRoleOf), with the repo's folder name (repoNameOf).
 */
export async function regenHandout(
  io: InitIo,
  host: HostIo | null,
  input: {
    readonly id: string
    readonly role: RoleSpec
    readonly locations: InitLocations
    readonly setup: SetupScan
  },
): Promise<StepResult<RegenHanded>> {
  const { id, role, locations } = input
  const handed: RegenHanded = {
    role,
    isRoleWritten: false,
    repoParts: null,
    privateRole: null,
    dropped: [],
    warnings: [],
    untracked: [],
    isSession: false,
    folder: null,
  }
  if (role.instructionParts === undefined && role.instructionPartsNotGiven === undefined) return accepted(handed)
  const repoRead = await repoSideRead(io, locations.root, role)
  const found = await privateRecordOf(io, host, locations, id)
  const places = recordPlacesOf(locations, input.setup)
  const privateRead = found.kind === 'found' ? await privateSideRead(io, found.record, places, id) : null
  const repoChanges = repoRead.kind === 'read' ? sideChanges(repoRead.side) : null
  const privateChanges = privateRead?.kind === 'read' ? sideChanges(privateRead.side) : null
  const asked = [...(repoChanges?.asked ?? []), ...(privateChanges?.asked ?? [])]
  const isSession = (await io.isInteractive()) === true
  const none: ReadonlySet<RegenAsk> = new Set()
  const answers = isSession && asked.length > 0 ? await regenAnswers(io, role, asked) : accepted(none)
  if (answers.kind === 'cancelled') return answers
  const repoResult = repoChanges === null ? null : sideResult(id, repoChanges, answers.value, isSession)
  const privateResult = privateChanges === null ? null : sideResult(id, privateChanges, answers.value, isSession)
  const tracked = repoResult === null ? null : await trackedSide(host, locations.root, id, repoResult)
  const repoSide = tracked?.result ?? null
  const leftOut = (repoResult?.leftOut ?? 0) + (privateResult?.leftOut ?? 0)
  const warnings = [
    ...(repoRead.kind === 'kept' ? repoRead.warnings : []),
    ...(found.kind === 'kept' ? found.warnings : []),
    ...(privateRead?.kind === 'kept' ? privateRead.warnings : []),
    ...(leftOut > 0 ? [notHandedOutWarning(id, leftOut)] : []),
  ]
  const isRoleWritten = repoSide !== null && repoSide.isRecordsChanged
  const privateRole =
    found.kind === 'found' && privateResult !== null
      ? privateRoleOf(id, found.folder, repoNameOf(locations), privateResult)
      : null

  return accepted({
    role: isRoleWritten ? recordedRole(role, repoSide) : role,
    isRoleWritten,
    repoParts: repoSide !== null && repoSide.isTextChanged ? repoSide.given : null,
    privateRole,
    dropped: [...(repoSide?.dropped ?? []), ...(privateResult?.dropped ?? [])],
    warnings,
    untracked: tracked?.warnings ?? [],
    isSession,
    folder: found.kind === 'found' || found.kind === 'none' ? found.folder : null,
  })
}
