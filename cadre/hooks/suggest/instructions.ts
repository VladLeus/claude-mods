/**
 * The instruction recommendation prompt, a layer 7 module: the prompt that asks which roles need each topic of the
 * instruction files and each memory, and the check of the model's reply (G-02-1f Recommendation, Memories). It
 * imports the checked call, core and the types, so init reads it here.
 */
import type { InstructionTopic, MemoryItem, RoleSpec } from '../../types'
import { isObject, parseJsonValue } from '../core/json'
import { unfenced, withReplyErrors } from '../core/reply'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { invalidReply, NOT_JSON_ERROR, roleMapOf, ROLES_INTRO } from './checked'

/** What parseRecommendation gives: the roles recommended for each topic and memory, or every error found. */
export type RecommendReply =
  | { readonly kind: 'ok'; readonly recommended: ReadonlyMap<string, readonly string[]> }
  | { readonly kind: 'invalid'; readonly errors: readonly string[] }

export { RECOMMEND_SYSTEM } from '../locales/prompts'

/** The line that introduces the topics in the recommendation prompt. */
const TOPICS_INTRO = PROMPTS.topicsIntro

/** The line that introduces the memories in the recommendation prompt. */
const MEMORIES_INTRO = PROMPTS.memoriesIntro

/**
 * The recommendation prompt (G-02-1f Recommendation, Memories): each role as `<id> | <title> | <purpose>`, each topic
 * as `T<n> | <title> | <summary>`, each memory as `M<n> | <file> | <summary>`, and after a failed reply its exact
 * errors. No part's text, no memory's text and no memory folder reaches it.
 */
export function recommendPrompt(
  roles: readonly Pick<RoleSpec, 'id' | 'title' | 'purpose'>[],
  topics: readonly InstructionTopic[],
  memories: readonly Pick<MemoryItem, 'id' | 'file' | 'summary'>[],
  errors: readonly string[],
): string {
  const lines = [
    ROLES_INTRO,
    ...roles.map(role => fill(PROMPTS.roleRow, { id: role.id, title: role.title, purpose: role.purpose })),
    TOPICS_INTRO,
    ...topics.map(topic => fill(PROMPTS.topicRow, { id: topic.id, title: topic.title, summary: topic.summary })),
    MEMORIES_INTRO,
    ...memories.map(memory => fill(PROMPTS.memoryRow, { id: memory.id, file: memory.file, summary: memory.summary })),
  ]

  return withReplyErrors(lines, errors, PROMPTS.replyErrorsIntro)
}

/** The errors of a reply that lacks a map: no topics object, no memories object, or both. */
function missingMaps(topics: unknown, memories: unknown): string[] {
  return [
    ...(isObject(topics) ? [] : [PROMPTS.noTopicsObject]),
    ...(isObject(memories) ? [] : [PROMPTS.noMemoriesObject]),
  ]
}

/**
 * The model's recommendation reply as the role ids recommended for each topic and each memory (G-02-1f
 * Recommendation, Memories). The reply is untrusted: one code fence around it is stripped, and only known topic,
 * memory and role ids survive. Every problem is listed at once (not JSON, no topics or no memories object, an unknown
 * topic or memory, a value that is not a list, an unknown role), capped at 20 errors. A map left out whose id list is
 * empty counts as empty (02-GAPS-B2 N14). A usable reply names every topic and every memory: one it leaves out is
 * recommended to no role, and the role ids come once each, in role order. The map is keyed by topic id, then memory
 * id.
 */
export function parseRecommendation(
  reply: string,
  topicIds: readonly string[],
  memoryIds: readonly string[],
  roleIds: readonly string[],
): RecommendReply {
  const json = parseJsonValue(unfenced(reply))
  if (json === null) return invalidReply([NOT_JSON_ERROR])
  const topics = isObject(json.value) ? json.value.topics : undefined
  const memories = isObject(json.value) ? json.value.memories : undefined
  const topicsMap = topics === undefined && topicIds.length === 0 ? {} : topics
  const memoriesMap = memories === undefined && memoryIds.length === 0 ? {} : memories
  if (!isObject(topicsMap) || !isObject(memoriesMap)) return invalidReply(missingMaps(topicsMap, memoriesMap))
  const topicRoles = roleMapOf('topic', topicsMap, topicIds, roleIds)
  const memoryRoles = roleMapOf('memory', memoriesMap, memoryIds, roleIds)
  const errors = [...topicRoles.errors, ...memoryRoles.errors]
  if (errors.length > 0) return invalidReply(errors)
  const recommended = new Map([...topicRoles.roles, ...memoryRoles.roles])

  return { kind: 'ok', recommended }
}
