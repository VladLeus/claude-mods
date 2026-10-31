/**
 * The regen recommendation prompt, a layer 7 module: the prompt that asks whether one role needs each new or changed
 * part and memory a regen asks about, and the check of the model's reply (G-02-1f Regen, D-142). It imports the
 * checked call, suggest/topics, core, records, the memory summaries of the instruction scan and the types, so init's
 * regen reads it here.
 */
import type { InstructionPart, MemoryItem, RoleSpec } from '../../types'
import { isObject, parseJsonValue } from '../core/json'
import { unfenced, withReplyErrors } from '../core/reply'
import { clean, idLabel } from '../core/text'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { TOP_OF_FILE } from '../records'
import { summaryText } from '../scan/instructions/memories'
import { invalidReply, NOT_JSON_ERROR } from './checked'
import { preview } from './topics'

/** One new or changed item a regen asks about, as its recommendation prompt lists it (G-02-1f Regen, D-142). */
export type RegenPromptItem =
  | { readonly kind: 'part'; readonly part: Pick<InstructionPart, 'file' | 'heading' | 'text'> }
  | { readonly kind: 'memory'; readonly memory: Pick<MemoryItem, 'file' | 'summary'> }

export { REGEN_RECOMMEND_SYSTEM } from '../locales/prompts'

/** The line that introduces the role in the regen recommendation prompt. */
const REGEN_ROLE_INTRO = PROMPTS.regenRoleIntro

/** The line that introduces the items in the regen recommendation prompt. */
const REGEN_ITEMS_INTRO = PROMPTS.regenItemsIntro

/**
 * One item as the regen prompt lists it: `I<n> | <file> | <heading or (top of file)> | <the start of its text>` for a
 * part, `I<n> | memory <file> | <summary>` for a memory, the file cleaned (02-GAPS-B2 N3) and the summary, which a
 * record in the user's folder holds, cleaned and capped as the index read keeps it (summaryText).
 */
function regenItemLine(item: RegenPromptItem, index: number): string {
  const id = `I${index + 1}`
  if (item.kind === 'memory') {
    const summary = summaryText(item.memory.summary)

    return fill(PROMPTS.regenMemoryRow, { id, file: clean(item.memory.file), summary })
  }
  const heading = item.part.heading === '' ? TOP_OF_FILE : item.part.heading

  return fill(PROMPTS.partRow, { id, file: clean(item.part.file), heading, preview: preview(item.part.text) })
}

/**
 * The regen recommendation prompt (G-02-1f Regen, D-142): the role as `<id> | <title> | <purpose>`, then each item in
 * the order regen asks it, `I<n>` by its place (regenItemLine: a part with the first 300 code points of its text,
 * newlines as spaces; a memory with its summary, never its text), and after a failed reply its exact errors. The model
 * has no tools (D-83).
 */
export function regenRecommendPrompt(
  role: Pick<RoleSpec, 'id' | 'title' | 'purpose'>,
  items: readonly RegenPromptItem[],
  errors: readonly string[],
): string {
  const roleRow = fill(PROMPTS.roleRow, { id: role.id, title: role.title, purpose: role.purpose })
  const lines = [REGEN_ROLE_INTRO, roleRow, REGEN_ITEMS_INTRO]

  return withReplyErrors([...lines, ...items.map(regenItemLine)], errors, PROMPTS.replyErrorsIntro)
}

/** What parseRegenRecommendation gives: whether each item is recommended, or every error found. */
export type RegenRecommendReply =
  | { readonly kind: 'ok'; readonly recommended: ReadonlyMap<string, boolean> }
  | { readonly kind: 'invalid'; readonly errors: readonly string[] }

/**
 * The model's regen recommendation reply (G-02-1f Regen, D-142) as whether each item is recommended, by item id. The
 * reply is untrusted: one code fence around it is stripped, and every problem is listed at once (not JSON, no items
 * object, an unknown item, a value that is not true or false), capped at 20 errors. An item the reply leaves out is not
 * recommended.
 */
export function parseRegenRecommendation(reply: string, itemIds: readonly string[]): RegenRecommendReply {
  const json = parseJsonValue(unfenced(reply))
  if (json === null) return invalidReply([NOT_JSON_ERROR])
  const items = isObject(json.value) ? json.value.items : undefined
  if (!isObject(items)) return invalidReply([PROMPTS.noItemsObject])
  const errors = Object.entries(items).flatMap(([key, value]) => {
    if (!itemIds.includes(key)) return [fill(PROMPTS.unknownItem, { id: idLabel(key) })]

    return typeof value === 'boolean' ? [] : [fill(PROMPTS.itemNotBoolean, { key })]
  })
  if (errors.length > 0) return invalidReply(errors)
  const isRecommended = (id: string): boolean => Object.hasOwn(items, id) && items[id] === true

  return { kind: 'ok', recommended: new Map(itemIds.map((id): [string, boolean] => [id, isRecommended(id)])) }
}
