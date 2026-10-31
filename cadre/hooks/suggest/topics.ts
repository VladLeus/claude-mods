/**
 * The topic grouping prompt, a layer 7 module: the prompt that groups the instruction parts into topics across files,
 * the check of the model's reply and the one-topic-per-file fallback (G-02-1f Part unit). It imports the checked
 * call, core, records, the memory reads of the instruction scan and the types, so init, the instructions block and
 * the other suggest/ modules read it here.
 */
import type { InstructionPart, InstructionScan, InstructionTopic } from '../../types'
import { isObject, parseJsonValue } from '../core/json'
import { unfenced, withReplyErrors } from '../core/reply'
import { clean, idLabel } from '../core/text'
import { PROMPTS, topicsSystemText } from '../locales/prompts'
import { fill } from '../locales/t'
import { TOP_OF_FILE } from '../records'
import { LINE_BREAKS, MAX_SUMMARY_CHARS } from '../scan/instructions/memories'
import { invalidReply, NOT_JSON_ERROR } from './checked'

/** The most code points a topic title keeps (G-02-1f). */
const MAX_TITLE_CHARS = 60

/** The most code points of a part's text the grouping prompt carries (G-02-1f). */
const MAX_PREVIEW_CHARS = 300

/** What the model is told when it groups the parts into topics (G-02-1f Part unit); its reply is checked in code. */
export const TOPICS_SYSTEM = topicsSystemText(MAX_TITLE_CHARS, MAX_SUMMARY_CHARS)

/** The line that introduces the parts in the grouping prompt. */
const PARTS_INTRO = PROMPTS.partsIntro

/** The start of a part's text as the grouping prompt carries it: newlines as spaces, trimmed, then cut. */
export function preview(text: string): string {
  return Array.from(text.replace(LINE_BREAKS, ' ').trim()).slice(0, MAX_PREVIEW_CHARS).join('')
}

/**
 * One part as the grouping prompt lists it: id, file (cleaned, 02-GAPS-B2 N3), heading or `(top of file)`, and the
 * start of its text.
 */
function partLine(part: InstructionPart): string {
  const heading = part.heading === '' ? TOP_OF_FILE : part.heading

  return fill(PROMPTS.partRow, { id: part.id, file: clean(part.file), heading, preview: preview(part.text) })
}

/**
 * The grouping prompt (G-02-1f Part unit): one line per part, `P<n> | <file> | <heading or (top of file)> | <the first
 * 300 code points of its text, newlines as spaces>`, and after a failed reply its exact errors. Only the start of each
 * part reaches the model, which has no tools (D-83).
 */
export function topicsPrompt(parts: readonly InstructionPart[], errors: readonly string[]): string {
  return withReplyErrors([PARTS_INTRO, ...parts.map(partLine)], errors)
}

/** What parseTopics gives: the checked topics, or every error found. */
export type TopicsReply =
  | { readonly kind: 'ok'; readonly topics: readonly InstructionTopic[] }
  | { readonly kind: 'invalid'; readonly errors: readonly string[] }

/** A reply text as a topic keeps it: hidden characters removed, then trimmed; '' for anything but a string. */
function replyText(value: unknown): string {
  return typeof value === 'string' ? clean(value, Number.POSITIVE_INFINITY).trim() : ''
}

/** The problem with one text of a topic: blank, or longer than its cap in code points; none when it is fine. */
function textProblems(text: string, label: string, field: string, maxChars: number): string[] {
  if (text === '') return [fill(PROMPTS.blankField, { label, field })]
  if (Array.from(text).length > maxChars) return [fill(PROMPTS.longField, { label, field, max: maxChars })]

  return []
}

/** One reply entry read as a topic: the topic when it has a parts list with a part, and the errors of the entry. */
type TopicRead = {
  readonly topic: InstructionTopic | null
  readonly errors: readonly string[]
}

/**
 * One reply entry as a topic, `T<n>` by its place in the reply: its title and summary cleaned and checked, and the
 * known part ids it names, once each; an entry that is not an object, or has no parts list or an empty one, is no
 * topic.
 */
function readTopic(entry: unknown, index: number, known: ReadonlySet<string>): TopicRead {
  const label = fill(PROMPTS.topicLabel, { number: index + 1 })
  if (!isObject(entry)) return { topic: null, errors: [fill(PROMPTS.notObject, { label })] }
  const title = replyText(entry.title)
  const summary = replyText(entry.summary)
  const errors = [
    ...textProblems(title, label, 'title', MAX_TITLE_CHARS),
    ...textProblems(summary, label, 'summary', MAX_SUMMARY_CHARS),
  ]
  const list: unknown = entry.parts
  if (!Array.isArray(list)) return { topic: null, errors: [...errors, fill(PROMPTS.noPartsList, { label })] }
  if (list.length === 0) return { topic: null, errors: [...errors, fill(PROMPTS.noParts, { label })] }
  const isKnown = (id: unknown): id is string => typeof id === 'string' && known.has(id)
  const unknown = list.filter(id => !isKnown(id)).map(id => fill(PROMPTS.unknownPart, { label, id: idLabel(id) }))
  const partIds = Array.from(new Set(list.filter(isKnown)))

  return { topic: { id: `T${index + 1}`, title, summary, partIds }, errors: [...errors, ...unknown] }
}

/** The placement errors of the topics read: each part in more than one topic, then each part in none. */
function placementErrors(reads: readonly TopicRead[], partIds: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const id of reads.flatMap(read => read.topic?.partIds ?? [])) counts.set(id, (counts.get(id) ?? 0) + 1)
  const twice = partIds.filter(id => (counts.get(id) ?? 0) > 1).map(id => fill(PROMPTS.partTwice, { id }))
  const none = partIds.filter(id => !counts.has(id)).map(id => fill(PROMPTS.partNone, { id }))

  return [...twice, ...none]
}

/**
 * The model's grouping reply as checked topics (G-02-1f Part unit). The reply is untrusted: one code fence around it
 * is stripped, and only each topic's title, summary and part ids survive. Every problem is listed at once: not JSON, no
 * topics list, then per topic a blank or long title or summary (60 and 160 code points, once cleaned), no parts list,
 * no parts or an unknown part id, then each part in two topics and each part in none, capped at 20 errors.
 */
export function parseTopics(reply: string, partIds: readonly string[]): TopicsReply {
  const json = parseJsonValue(unfenced(reply))
  if (json === null) return invalidReply([NOT_JSON_ERROR])
  const list = isObject(json.value) ? json.value.topics : undefined
  if (!Array.isArray(list)) return invalidReply([PROMPTS.noTopicsList])
  const known = new Set(partIds)
  const reads = list.map((entry: unknown, index) => readTopic(entry, index, known))
  const errors = [...reads.flatMap(read => read.errors), ...placementErrors(reads, partIds)]
  if (errors.length > 0) return invalidReply(errors)

  return { kind: 'ok', topics: reads.flatMap(read => (read.topic === null ? [] : [read.topic])) }
}

/**
 * When the grouping fails three times (G-02-1f): each file is one topic, titled with the file and summed up as
 * `All of <file>`, holding the file's parts, in file order.
 */
export function fallbackTopics(scan: InstructionScan): InstructionTopic[] {
  return scan.files.map((file, index) => ({
    id: `T${index + 1}`,
    title: clean(file, MAX_TITLE_CHARS),
    summary: clean(`All of ${file}`, MAX_SUMMARY_CHARS),
    partIds: scan.parts.filter(part => part.file === file).map(part => part.id),
  }))
}
