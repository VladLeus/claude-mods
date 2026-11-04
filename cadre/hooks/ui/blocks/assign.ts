/**
 * The contexts of the assignment questions, a layer 8 module (D-203, D-211, D-236): an MCP server question names the
 * server's source, its tool names from the session's tool list (never a description) and the roles recommended for
 * it; a skill group question lists each of its skills with what it does, how often it was used and the roles
 * recommended for it; the own-skills entry question holds the own-skills block, and one own skill's question that
 * skill alone. Each context also gives the structured rows the pane draws from the same values (D-313, D-323): a
 * skill and a server of the list for all the servers as item rows (itemRows of ui/blocks/context, D-311). Every
 * value is cleaned and capped here (D-222), and a description's secret-like spans are hidden (redactedText, E1) before
 * its cap (#163). It imports core, the UNCUT rule of ui/pane, the item rows of ui/blocks/context and the types, so the
 * assignment stage reads it here.
 */
import type { AskContext, ContextRow, McpRef } from '../../../types'
import { redactedText } from '../../core/redact'
import { asSentence, cardList, clean, idsOrNone, shown, sortedUnique } from '../../core/text'
import type { ListWords } from '../../core/text'
import { keyLabel, SCREEN_LIST_WORDS, t, tn } from '../../locales/t'
import { UNCUT } from '../pane'
import { itemRows } from './context'

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
  return idsOrNone(ids.map(id => shown(id)), SCREEN_LIST_WORDS.none)
}


/**
 * The context of an MCP server question (D-211, D-236): the server by name, its source (mcpSourceText), the tools the
 * session lists for it (mcpToolNamesOf), counted first, then the names `words` allows and how many more (every name
 * on a pane surface, D-256), or `Tools: none listed`, and the roles recommended for it, or none, which are its summary
 * too (D-310). No other field of the server or its tools is read (T-02.1-72).
 */
export function mcpServerContext(
  ref: McpRef,
  sessionTools: unknown,
  recommended: readonly string[],
  words: ListWords,
): AskContext {
  const tools = mcpToolNamesOf(sessionTools, ref.name)
  const toolsLine = tools.length === 0 ? t('ui.assign.mcpServerContext') : t('ui.assign.mcpServerContext2', {
    count: tools.length,
    tools: cardList(tools, words),
  })
  const source = mcpSourceText(ref)
  const roleIds = roleIdsText(recommended)
  const rows: ContextRow[] = [
    { role: 'field', label: keyLabel('ui.assign.mcpServerContext3'), text: source, indent: 0 },
    { role: 'plain', text: toolsLine, indent: 0 },
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

/** The most code points of a skill's purpose in its line: the cap the purpose had, kept, now after the redaction. */
const MAX_SKILL_PURPOSE_CHARS = 120

/**
 * A skill's line (D-211): its name cut to 60 code points, then what it does as a sentence with its secret-like spans
 * hidden before the MAX_SKILL_PURPOSE_CHARS cap (redactedText, E1, #163; only the description is read for them, never
 * the name), how often it was used (left out when '') and the roles recommended for it, or none; every value cleaned.
 */
function skillLineText(skill: SkillLine): string {
  const name = shown(skill.name, MAX_CONTEXT_NAME_CHARS)
  const used = skill.uses === '' ? '' : t('ui.assign.skillLineText', { uses: clean(skill.uses) })
  const purpose = asSentence(redactedText(skill.purpose, MAX_SKILL_PURPOSE_CHARS))

  return t('ui.assign.skillLineText2', { name, purpose, used, roleIds: roleIdsText(skill.recommended) })
}

/** The text a caller stands in for a skill the engine gave no description (init/answers NO_SKILL_PURPOSE, D-139). */
const NO_PURPOSE_TEXT = t('init.answers.noSkillPurpose')

/**
 * One skill as item rows (D-311): its name cut to 60 code points and the roles recommended for it, then what it does
 * as a sentence, its secret-like spans hidden before the MAX_SKILL_PURPOSE_CHARS cap (redactedText, E1, #163), with
 * how often it was used after it (` Used ….`, user 2026-11-04). A skill the caller gave NO_PURPOSE_TEXT has the
 * placeholder in place of a description, then its uses on a row of their own when it was used.
 */
function skillRows(skill: SkillLine): ContextRow[] {
  const name = shown(skill.name, MAX_CONTEXT_NAME_CHARS)
  const used = skill.uses === '' ? '' : t('ui.assign.skillLineText', { uses: clean(skill.uses) })
  if (skill.purpose !== NO_PURPOSE_TEXT) {
    const purpose = asSentence(redactedText(skill.purpose, MAX_SKILL_PURPOSE_CHARS))

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
    rows: [{ title: null, rows: skills.flatMap(skillRows) }],
  }
}

/**
 * One MCP server as the context of the question for all the servers lists it (D-250): its name, the source word of
 * its server question (mcpSourceText), how many tool names the session lists for it, and the ids of the roles
 * recommended for it.
 */
export type McpLine = {
  readonly name: string
  readonly source: string
  readonly tools: number
  readonly recommended: readonly string[]
}

/**
 * The context of the question for all the MCP servers at once (D-250), as skillGroupContext is for a skill group: the
 * title MCP servers, then one line per server with its source, how many tools the session lists for it (counted, `1
 * tool`) and the roles recommended for it, or none; the name cut to 60 code points and every value cleaned. Its
 * summary counts the servers and those with a recommended role (D-310).
 */
export function mcpGroupContext(lines: readonly McpLine[]): AskContext {
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
  const rows = lines.flatMap(line => {
    const description = tn('ui.item.mcpDescription', line.tools, { source: clean(line.source), count: line.tools })

    return itemRows(shown(line.name, MAX_CONTEXT_NAME_CHARS), line.recommended, description)
  })

  return {
    title: t('ui.assign.mcpGroupContextTitle'),
    lines: texts,
    kind: 'mcp-server',
    summary,
    rows: [{ title: null, rows }],
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
    rows: [{ title: null, rows: skillRows(skill) }],
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
