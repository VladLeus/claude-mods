/**
 * The contexts of the assignment questions, a layer 8 module (D-203, D-211, D-236): an MCP server question names the
 * server's source, its tool names from the session's tool list (never a description) and the roles recommended for
 * it; a skill group question lists each of its skills with what it does, how often it was used and the roles
 * recommended for it; the own-skills entry question holds the own-skills block, and one own skill's question that
 * skill alone. Every value is cleaned and capped here (D-222). It imports core and the types, so the assignment stage
 * reads it here.
 */
import type { AskContext, McpRef } from '../../../types'
import { asSentence, cardList, clean, idsOrNone, reportText, shown, sortedUnique } from '../../core/text'

/** The start of a claude.ai connector's MCP server name in a terminal session (R2), as the MCP scan names it. */
const CLAUDE_AI_SERVER_PREFIX = 'claude_ai_'

/** The most code points of a server, group or skill name a context shows, as the questions cut them. */
const MAX_CONTEXT_NAME_CHARS = 60

/**
 * Where an MCP server was seen, as the person knows the place (D-211): `.mcp.json` for the repo's file,
 * `~/.claude.json` for the user's config, `claude.ai` for a session server named as a claude.ai connector, and
 * `session` for any other server of the session's tool list, which the scan cannot tell apart further.
 */
export function mcpSourceText(ref: McpRef): string {
  switch (ref.source) {
    case 'project':
      return '.mcp.json'
    case 'user-config':
      return '~/.claude.json'
    case 'session':
      return ref.name.startsWith(CLAUDE_AI_SERVER_PREFIX) ? 'claude.ai' : 'session'
  }
}

/**
 * The tool names of one MCP server in the session's tool names (D-211): each name of the form
 * `mcp__<server>__<tool>`, its tool part cleaned and capped as a shown name, once each and sorted. Only names are
 * read, never a description; anything but a list gives none.
 */
export function mcpToolNamesOf(tools: unknown, server: string): string[] {
  if (!Array.isArray(tools)) return []
  const prefix = `mcp__${server}__`
  const names = tools.flatMap(name => {
    if (typeof name !== 'string' || !name.startsWith(prefix) || name.length === prefix.length) return []

    return [shown(name.slice(prefix.length))]
  })

  return sortedUnique(names)
}

/** Role ids as a context line lists them, each cleaned: `none` when there are none. */
function roleIdsText(ids: readonly string[]): string {
  return idsOrNone(ids.map(id => shown(id)))
}

/**
 * The context of an MCP server question (D-211, D-236): the server by name, its source (mcpSourceText), the tools the
 * session lists for it (mcpToolNamesOf), counted first, then 12 names and how many more, or `Tools: none listed`,
 * and the roles recommended for it, or none. No other field of the server or its tools is read (T-02.1-72).
 */
export function mcpServerContext(ref: McpRef, sessionTools: unknown, recommended: readonly string[]): AskContext {
  const tools = mcpToolNamesOf(sessionTools, ref.name)
  const toolsLine = tools.length === 0 ? 'Tools: none listed' : `Tools: ${tools.length} (${cardList(tools)})`

  return {
    title: `MCP: ${shown(ref.name, MAX_CONTEXT_NAME_CHARS)}`,
    lines: [`Source: ${mcpSourceText(ref)}`, toolsLine, `Recommended: ${roleIdsText(recommended)}`],
    kind: 'mcp-server',
  }
}

/**
 * One skill as a skill question's context lists it (D-211): its name; what it does, the caller's text standing in
 * for a skill the engine gave no description; how often the history scan saw it, as text, '' when it did not; and the
 * ids of the roles recommended for it.
 */
export type SkillLine = {
  readonly name: string
  readonly purpose: string
  readonly uses: string
  readonly recommended: readonly string[]
}

/**
 * A skill's line (D-211): its name cut to 60 code points, then what it does as a sentence, how often it was used
 * (left out when '') and the roles recommended for it, or none; every value cleaned.
 */
function skillLineText(skill: SkillLine): string {
  const name = shown(skill.name, MAX_CONTEXT_NAME_CHARS)
  const used = skill.uses === '' ? '' : ` Used ${clean(skill.uses)}.`

  return `${name}: ${asSentence(clean(skill.purpose))}${used} Recommended: ${roleIdsText(skill.recommended)}.`
}

/**
 * The context of a skill group question (D-211, D-236): the group by its label, then one line per skill with what it
 * does, how often it was used and the roles recommended for it.
 */
export function skillGroupContext(label: string, skills: readonly SkillLine[]): AskContext {
  return {
    title: `Skills: ${shown(label, MAX_CONTEXT_NAME_CHARS)}`,
    lines: skills.map(skillLineText),
    kind: 'skill-group',
  }
}

/** The context of one own skill's question (D-236): that skill's line alone, titled by its place among them. */
export function skillContext(skill: SkillLine, position: number, count: number): AskContext {
  return { title: `Skill ${position} of ${count}`, lines: [skillLineText(skill)], kind: 'skill' }
}

/**
 * The context of the own-skills entry question (D-236): the own-skills block as the side pane shows it, each line
 * cleaned as a report cell.
 */
export function ownSkillsContext(lines: readonly string[]): AskContext {
  return { title: 'Your own skills', lines: lines.map(reportText), kind: 'skills' }
}
