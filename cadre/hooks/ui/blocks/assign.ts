/**
 * The contexts of the assignment questions, a layer 8 module (D-203, D-211, D-236): an MCP server question names the
 * server's source, its tool names from the session's tool list (never a description) and the roles recommended for
 * it; a skill group question lists each of its skills with what it does, how often it was used and the roles
 * recommended for it; the own-skills entry question holds the own-skills block, and one own skill's question that
 * skill alone. Each context also gives the structured rows the pane draws from the same values (D-313, D-323): a
 * skill and a server of the list for all the servers as item rows (itemRows of ui/blocks/context, D-311). Every
 * value is cleaned and capped here (D-222), and a description's secret-like spans are hidden (redactedText, E1); a
 * description is not cut here, as the scan capped it at MAX_REPORT_CHARS (D-312, D-330). It imports core, the UNCUT
 * rule of ui/pane, the item rows and role ids text of ui/blocks/context and the types, so the assignment stage reads
 * it here.
 */
import type { AskContext, ContextRow, ContextSection, McpRef, RoleSpec } from '../../../types'
import { redactedText } from '../../core/redact'
import { asSentence, cardList, clean, shown, sortedUnique } from '../../core/text'
import type { ListWords } from '../../core/text'
import { keyLabel, t, tn } from '../../locales/t'
import { UNCUT } from '../pane'
import { itemRows, roleIdsText } from './context'

/** The start of a claude.ai connector's MCP server name in a terminal session (R2), as the MCP scan names it. */
export const CLAUDE_AI_SERVER_PREFIX = 'claude_ai_'

/** The most code points of a server, group or skill name a context shows, as the questions cut them. */
const MAX_CONTEXT_NAME_CHARS = 60

/**
 * The tools line of a server the session lists no tool for (D-317, D-331): one found in config only, as a claude.ai
 * connector of ~/.claude.json may be, is not connected, and its tools are unknown.
 */
const NOT_CONNECTED_LINE = t('ui.assign.mcpNotConnected')

/** NOT_CONNECTED_LINE as a field row (D-313, D-317): its label, then its value, the text after the label's `: `. */
const NOT_CONNECTED_ROW: ContextRow = {
  role: 'field',
  label: keyLabel('ui.assign.mcpNotConnected'),
  text: NOT_CONNECTED_LINE.slice(NOT_CONNECTED_LINE.indexOf(': ') + 2),
  indent: 0,
}

/**
 * Where an MCP server was seen, as the person knows the place (D-211, D-317): `claude.ai` for a server named as a
 * claude.ai connector, whatever list found it; else `.mcp.json` for the repo's file, `~/.claude.json` for the user's
 * config, and `session` for any other server of the session's tool list, which the scan cannot tell apart further.
 */
export function mcpSourceText(ref: McpRef): string {
  if (ref.name.startsWith(CLAUDE_AI_SERVER_PREFIX)) return 'claude.ai'
  switch (ref.source) {
    case 'project':
      return '.mcp.json'
    case 'user-config':
      return '~/.claude.json'
    case 'session':
      return 'session'
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

/**
 * The context of an MCP server question (D-211, D-236): the server by name, its source (mcpSourceText), the tools the
 * session lists for it (mcpToolNamesOf), counted first, then the names `words` allows and how many more (every name
 * on a pane surface, D-256), or, when it lists none, `Tools: not connected, tools unknown`, a field row in its rows
 * (D-317, D-331), and the roles recommended for it, or none, which are its summary too (D-310). No other field of the
 * server or its tools is read (T-02.1-72).
 */
export function mcpServerContext(
  ref: McpRef,
  sessionTools: unknown,
  recommended: readonly string[],
  words: ListWords,
): AskContext {
  const tools = mcpToolNamesOf(sessionTools, ref.name)
  const toolsLine = tools.length === 0 ? NOT_CONNECTED_LINE : t('ui.assign.mcpServerContext2', {
    count: tools.length,
    tools: cardList(tools, words),
  })
  const toolsRow: ContextRow = tools.length === 0 ? NOT_CONNECTED_ROW : { role: 'plain', text: toolsLine, indent: 0 }
  const source = mcpSourceText(ref)
  const roleIds = roleIdsText(recommended)
  const rows: ContextRow[] = [
    { role: 'field', label: keyLabel('ui.assign.mcpServerContext3'), text: source, indent: 0 },
    toolsRow,
    { role: 'recommended', label: keyLabel('ui.assign.mcpServerContext4'), text: roleIds, indent: 0 },
  ]

  return {
    title: t('ui.assign.mcpServerContextTitle', { name: shown(ref.name, MAX_CONTEXT_NAME_CHARS) }),
    lines: [
      t('ui.assign.mcpServerContext3', { mcpSource: source }),
      toolsLine,
      t('ui.assign.mcpServerContext4', { roleIds }),
    ],
    kind: 'mcp-server',
    summary: t('ui.summary.recommended', { roleIds }),
    rows: [{ title: null, rows }],
  }
}

/**
 * One skill as a skill question's context lists it (D-211): its name; what it does, null when the engine gave no
 * description (S-03); how often the history scan saw it, as text, '' when it did not; and the ids of the roles
 * recommended for it.
 */
export type SkillLine = {
  readonly name: string
  readonly purpose: string | null
  readonly uses: string
  readonly recommended: readonly string[]
}

/**
 * A skill's line (D-211): its name cut to 60 code points, then what it does as a sentence with its secret-like spans
 * hidden (redactedText, E1, #163; only the description is read for them, never the name) and not cut, as the scan
 * capped it already (D-312, D-330), how often it was used (left out when '') and the roles recommended for it, or
 * none; every value cleaned.
 */
function skillLineText(skill: SkillLine): string {
  const name = shown(skill.name, MAX_CONTEXT_NAME_CHARS)
  const used = skill.uses === '' ? '' : t('ui.assign.skillLineText', { uses: clean(skill.uses) })
  const purpose = asSentence(redactedText(skill.purpose ?? NO_PURPOSE_TEXT, UNCUT))

  return t('ui.assign.skillLineText2', { name, purpose, used, roleIds: roleIdsText(skill.recommended) })
}

/** The text a skill's TUI line shows when its purpose is null (init/answers NO_SKILL_PURPOSE, D-139, S-03). */
const NO_PURPOSE_TEXT = t('init.answers.noSkillPurpose')

/**
 * One skill as item rows (D-311), the one builder for every skill item row, own skills and plugin groups alike
 * (S-03): its name cut to 60 code points and the roles recommended for it, then what it does as a sentence, its
 * secret-like spans hidden (redactedText, E1, #163) and never cut (D-312, D-330), with how often it was used after it
 * (` Used ….`, user 2026-11-04). A skill with a null purpose has the placeholder in place of a description, then its
 * uses on a row of their own when it was used.
 */
export function skillItemRows(skill: SkillLine): ContextRow[] {
  const name = shown(skill.name, MAX_CONTEXT_NAME_CHARS)
  const used = skill.uses === '' ? '' : t('ui.assign.skillLineText', { uses: clean(skill.uses) })
  if (skill.purpose !== null) {
    const purpose = asSentence(redactedText(skill.purpose, UNCUT))

    return itemRows(name, skill.recommended, `${purpose}${used}`)
  }
  const uses: ContextRow[] = used === '' ? [] : [{ role: 'description', text: used.trim(), indent: 4 }]

  return itemRows(name, skill.recommended, null, uses)
}

/**
 * The context of a skill group question (D-211, D-236): the group by its label, then one line per skill with what it
 * does, how often it was used and the roles recommended for it; its summary counts the skills and names the roles
 * `recommended` for the whole group, none when it names none (D-310).
 */
export function skillGroupContext(
  label: string,
  skills: readonly SkillLine[],
  recommended: readonly string[] = [],
): AskContext {
  const lines = skills.map(skillLineText)

  return {
    title: t('ui.assign.skillGroupContextTitle', { label: shown(label, MAX_CONTEXT_NAME_CHARS) }),
    lines,
    kind: 'skill-group',
    summary: tn('ui.summary.skillGroup', skills.length, { count: skills.length, roleIds: roleIdsText(recommended) }),
    rows: [{ title: null, rows: skills.flatMap(skillItemRows) }],
  }
}

/**
 * One MCP server as the context of the question for all the servers lists it (D-250, D-309): its name, the source
 * word of its server question (mcpSourceText), how many tool names the session lists for it, the ids of the roles
 * recommended for it, whether the session connected it (it lists a tool for it) and whether it is a claude.ai
 * connector (its name starts with CLAUDE_AI_SERVER_PREFIX).
 */
export type McpLine = {
  readonly name: string
  readonly source: string
  readonly tools: number
  readonly recommended: readonly string[]
  readonly isConnected: boolean
  readonly isConnector: boolean
}

/**
 * An MCP server's name as the list of all the servers shows it (D-309): cut to 60 code points, then, only when it has
 * any, its tags in parentheses, joined by `, `: `claude.ai` for a claude.ai connector, then `not connected` for a
 * server the session lists no tool for, so a connected server of any other kind shows its name alone.
 */
function mcpItemLabel(line: McpLine): string {
  const name = shown(line.name, MAX_CONTEXT_NAME_CHARS)
  const tags = [
    ...(line.isConnector ? [t('ui.assign.tagConnector')] : []),
    ...(line.isConnected ? [] : [t('ui.assign.tagNotConnected')]),
  ]

  return tags.length === 0 ? name : `${name} (${tags.join(', ')})`
}

/**
 * The rows of the list of all the MCP servers on pane surfaces (D-309, D-333): a section per role of `roles` in team
 * order, titled with the role's id and title, holding each server recommended for it, so a server recommended for
 * several roles is listed under each, then a section titled Not recommended holding the servers recommended for none;
 * a role no server is recommended for has no section, and nor has Not recommended when every server has a role. Each
 * server, in the order given, is an item row with its name and tags (mcpItemLabel) and no roles, which the pane draws
 * as its name alone; its source, tools and details stay in its own question (mcpServerContext).
 */
function mcpRoleSections(lines: readonly McpLine[], roles: readonly RoleSpec[]): ContextSection[] {
  const itemOf = (line: McpLine): ContextRow => ({ role: 'item', label: mcpItemLabel(line), text: '', indent: 2 })
  const sections = roles.flatMap(role => {
    const given = lines.filter(line => line.recommended.includes(role.id))
    if (given.length === 0) return []
    const title = t('ui.assign.mcpRoleSection', { id: shown(role.id), title: shown(role.title) })

    return [{ title, rows: given.map(itemOf) }]
  })
  const none = lines.filter(line => line.recommended.length === 0)
  if (none.length === 0) return sections

  return [...sections, { title: t('ui.assign.notRecommended'), rows: none.map(itemOf) }]
}

/**
 * The context of the question for all the MCP servers at once (D-250), as skillGroupContext is for a skill group: the
 * title MCP servers, then one line per server with its source, how many tools the session lists for it (counted, `1
 * tool`) and the roles recommended for it, or none; the name cut to 60 code points and every value cleaned. Its
 * summary counts the servers and those with a recommended role (D-310). Its rows, which the pane draws, list the
 * servers by the roles of `roles` they are recommended for (mcpRoleSections, D-309, D-333); the lines stay as they are
 * for the TUI default.
 */
export function mcpGroupContext(lines: readonly McpLine[], roles: readonly RoleSpec[]): AskContext {
  const lineText = (line: McpLine): string =>
    tn('ui.assign.mcpGroupLine', line.tools, {
      name: shown(line.name, MAX_CONTEXT_NAME_CHARS),
      source: clean(line.source),
      count: line.tools,
      roleIds: roleIdsText(line.recommended),
    })

  const recommended = lines.filter(line => line.recommended.length > 0).length
  const summary = tn('ui.summary.mcpGroup', lines.length, { count: lines.length, recommended })
  const texts = lines.map(lineText)

  return {
    title: t('ui.assign.mcpGroupContextTitle'),
    lines: texts,
    kind: 'mcp-server',
    summary,
    rows: mcpRoleSections(lines, roles),
  }
}

/**
 * The context of one skill's question (D-236): that skill's line alone, titled by its place among them; its summary
 * is the roles recommended for it (D-310).
 */
export function skillContext(skill: SkillLine, position: number, count: number): AskContext {
  const lines = [skillLineText(skill)]

  return {
    title: t('ui.assign.skillContext', { position, count }),
    lines,
    kind: 'skill',
    summary: t('ui.summary.recommended', { roleIds: roleIdsText(skill.recommended) }),
    rows: [{ title: null, rows: skillItemRows(skill) }],
  }
}

/**
 * The context of the own-skills entry question (D-236): the own-skills block as the side pane shows it, each line
 * cleaned, not cut (#163), and its structured rows, built from the same skills (D-313, D-323); its summary counts the
 * `count` own skills and the `recommended` of them with a recommended role (D-310).
 */
export function ownSkillsContext(
  lines: readonly string[],
  rows: readonly ContextRow[],
  count: number,
  recommended: number,
): AskContext {
  return {
    title: t('ui.assign.ownSkillsContext'),
    lines: lines.map(line => clean(line, UNCUT)),
    kind: 'skills',
    summary: tn('ui.summary.ownSkills', count, { count, recommended }),
    rows: [{ title: null, rows }],
  }
}
