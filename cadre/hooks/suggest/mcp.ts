/**
 * The MCP server recommendation prompt, a layer 7 module: the prompt that asks which roles get each MCP server, from
 * the roles, each server's name, source, tool names and table hint, and the check of the model's reply (D-248, D-254).
 * It imports the checked call, core, the prompts and the types, so init reads it here; the tool names and the table
 * hints reach it as plain data.
 */
import type { RoleSpec } from '../../types'
import { isObject, parseJsonValue } from '../core/json'
import { unfenced, withReplyErrors } from '../core/reply'
import { idsOrNone } from '../core/text'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import { invalidReply, NOT_JSON_ERROR, roleMapOf, roleRowText, ROLES_INTRO } from './checked'

export { MCP_SYSTEM } from '../locales/prompts'

/**
 * One MCP server as the prompt lists it (D-248): its name, the source word its question's context shows, the tool
 * names the session lists for it (names only, never a description, D-211) and the role ids the name table seeds.
 */
export type McpPromptServer = {
  readonly name: string
  readonly source: string
  readonly tools: readonly string[]
  readonly seed: readonly string[]
}

/** The most tool names of one server the prompt lists; the rest are counted (T-02.2-01). */
export const MAX_PROMPT_TOOLS = 40

/** The id the recommendation gives a server (D-248): M1, M2, ... by its place in the list. */
export function mcpServerId(index: number): string {
  return `M${index + 1}`
}

/** A server's tool names as its row lists them: the first MAX_PROMPT_TOOLS, then how many more; none for none. */
function toolsText(tools: readonly string[]): string {
  if (tools.length === 0) return PROMPTS.promptNone
  const rest = tools.length - MAX_PROMPT_TOOLS
  if (rest <= 0) return tools.join(', ')

  return [...tools.slice(0, MAX_PROMPT_TOOLS), fill(PROMPTS.moreTools, { count: rest })].join(', ')
}

/**
 * The MCP prompt (D-248): each role as `<id> | <title> | <purpose>`, then each server as `M<n> | <name> | <source> |
 * tools: <names or none> | table: <ids or none>`, its tool names capped at MAX_PROMPT_TOOLS with the rest counted,
 * and after a failed reply its exact errors, one per line. No tool description reaches it (D-211).
 */
export function mcpPrompt(
  roles: readonly Pick<RoleSpec, 'id' | 'title' | 'purpose'>[],
  servers: readonly McpPromptServer[],
  errors: readonly string[] = [],
): string {
  const serverLine = (server: McpPromptServer, index: number): string =>
    fill(PROMPTS.mcpRow, {
      id: mcpServerId(index),
      name: server.name,
      source: server.source,
      tools: toolsText(server.tools),
      table: idsOrNone(server.seed, PROMPTS.promptNone),
    })
  const lines = [ROLES_INTRO, ...roles.map(roleRowText), PROMPTS.mcpIntro, ...servers.map(serverLine)]

  return withReplyErrors(lines, errors, PROMPTS.replyErrorsIntro)
}

/** What parseMcpRecommendation gives: the roles recommended for each server by its name, or every error found. */
export type McpRecommendReply =
  | { readonly kind: 'ok'; readonly recommended: ReadonlyMap<string, readonly string[]> }
  | { readonly kind: 'invalid'; readonly errors: readonly string[] }

/**
 * The model's MCP recommendation as the role ids recommended for each server (D-248). The reply is untrusted: one code
 * fence around it is stripped, and only known server ids (M1, M2, ... by place in `serverNames`) and role ids survive.
 * Every problem is listed at once (not JSON, no servers object, an unknown server, a value that is not a list, an
 * unknown role), capped at 20 errors. A usable reply gives every server an entry: one it leaves out is recommended to
 * no role, and the role ids come once each, in role order. The map is keyed by server name, in the order given.
 */
export function parseMcpRecommendation(
  reply: string,
  serverNames: readonly string[],
  roleIds: readonly string[],
): McpRecommendReply {
  const json = parseJsonValue(unfenced(reply))
  if (json === null) return invalidReply([NOT_JSON_ERROR])
  const named = isObject(json.value) ? json.value.servers : undefined
  if (!isObject(named)) return invalidReply([PROMPTS.noServersObject])
  const map = roleMapOf('server', named, serverNames.map((_, index) => mcpServerId(index)), roleIds)
  if (map.errors.length > 0) return invalidReply(map.errors)
  const recommended = new Map(
    map.roles.flatMap(([, roles], index): [string, readonly string[]][] => {
      const name = serverNames[index]

      return name === undefined ? [] : [[name, roles]]
    }),
  )

  return { kind: 'ok', recommended }
}
