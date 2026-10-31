/**
 * The role documents, a layer 6 module: the text of role.json, settings.json, mcp.json, ROLE.md and the built
 * CLAUDE.md of a role, the index of every role and the repo state (ROLE-06, D-50, D-84, D-89, D-93, G-02-1f). Every
 * value from outside is cleaned. It imports the scope card, records, paths, core, the framework registry, the infra
 * catalog, role validation and the types, so the file set and apply read them here.
 */
import type { CadreState, CompiledScope, InstructionPart, RoleSpec } from '../../types'
import { stableJson } from '../core/json'
import { MAX_ROLE_CHARS } from '../core/kickoff-text'
import { cardList, clean, reportText } from '../core/text'
import { adapterOf } from '../framework/registry'
import { ARTIFACT } from '../locales/artifact'
import { fill } from '../locales/t'
import { handoffFolderOf, launcherPath } from '../paths'
import { TOP_OF_FILE } from '../records'
import { INFRA_SKILLS } from '../roles/infra'
import { MAX_PURPOSE_CHARS } from '../roles/validate'
import { CARD_LIST_WORDS, scopeCardLines } from '../scope/card'

/**
 * The text of `.cadre/<id>/role.json`: the role with schema 1, its repo part records included when it has them
 * (instructionParts and instructionPartsNotGiven, G-02-1f Regen), as stable JSON that parseRoleJson reads back.
 */
export function roleJsonText(role: RoleSpec): string {
  return stableJson({ schema: 1, ...role })
}

/** The text of `.cadre/<id>/settings.json`: the committed settings template, which holds only portable keys (D-84). */
export function settingsText(scope: CompiledScope): string {
  return stableJson(scope.settings)
}

/** The text of `.cadre/<id>/mcp.json`: the names of the MCP servers the role is given and nothing else (D-93). */
export function mcpText(scope: CompiledScope): string {
  return stableJson(scope.mcp)
}

/** The line ROLE.md adds after the framework line of an attended role. It is no card rule, so it never repeats one. */
const ATTENDED_LINE = ARTIFACT.roleMdAttended

/**
 * The text of `.cadre/<id>/ROLE.md`, the file `--append-system-prompt-file` gives the session; it is never named
 * CLAUDE.md or AGENTS.md (D-50). It holds, in this order: the title and id, the purpose, the framework with the model,
 * effort and permission mode, a banner when the card says the role is attended, "How you work" (the kickoff text of
 * the adapter, named with the title and the id), "Decisions" (the chain of the card, which follows basedOn),
 * "Handoffs" (the folder autopilot accepts, D-79), "Inbox" (the role's inbox file and how to leave a note in another
 * role's; D-114: text only, no new command) and "Scope" (the lines of the scope card, ROLE-06). The framework is the
 * one the scope was compiled for (`scope.card.framework`), so the document and the card cannot disagree. The title and
 * the purpose come from outside, so they are cleaned.
 */
export function roleMdText(role: RoleSpec, scope: CompiledScope): string {
  const { card } = scope
  const adapter = adapterOf(card.framework)
  const kickoff = adapter.kickoffText({ title: role.title, roleId: role.id, specPath: null })
  const model = fill(ARTIFACT.roleMdModel, { model: role.model, effort: role.effort })
  const lines = [
    fill(ARTIFACT.roleMdTitle, { title: clean(role.title, MAX_ROLE_CHARS), id: role.id }),
    '',
    clean(role.purpose, MAX_PURPOSE_CHARS),
    '',
    fill(ARTIFACT.roleMdFramework, { framework: adapter.name, model, mode: role.permissionMode }),
    ...(card.isAttended ? [ATTENDED_LINE] : []),
    '',
    ARTIFACT.roleMdHowYouWork,
    '',
    kickoff,
    '',
    ARTIFACT.roleMdDecisions,
    '',
    ...card.chain.map(line => fill(ARTIFACT.roleMdChainLine, { line })),
    '',
    ARTIFACT.roleMdHandoffs,
    '',
    fill(ARTIFACT.roleMdHandoffLine, { id: role.id }),
    '',
    ARTIFACT.roleMdInbox,
    '',
    fill(ARTIFACT.roleMdInboxLine, { id: role.id }),
    ARTIFACT.roleMdNoteLine,
    '',
    ARTIFACT.roleMdScope,
    '',
    ...scopeCardLines(card),
  ]

  return `${lines.join('\n')}\n`
}

/**
 * A marker cell (02-GAPS-B2 N2): cleaned as a report cell, then each '-' followed by '-' gets a space after it, so no
 * '--' can end the comment early.
 */
function markerCell(text: string): string {
  return reportText(text).replace(/-(?=-)/g, '- ')
}

/**
 * The marker line above a part in a built role file (G-02-1f): `<!-- from <file> > <heading or (top of file)> -->`.
 * The file and the heading are marker cells (markerCell), so no character of either can add a line, hide text or end
 * the comment early (02-GAPS-B2 N2).
 */
function partMarker(part: InstructionPart): string {
  const heading = part.heading === '' ? TOP_OF_FILE : markerCell(part.heading)

  return fill(ARTIFACT.partMarker, { file: markerCell(part.file), heading })
}

/** A part's text as a built role file holds it: as read, each `\r\n` written `\n`, its line ends at the end dropped. */
function partBody(text: string): string {
  return text.replaceAll('\r\n', '\n').replace(/\n+$/, '')
}

/**
 * The text of a built role file after its header line (02-GAPS-B3 N5): each part under its marker, a blank line before
 * each, and one final newline; '\n' with no part.
 */
export function partsBody(parts: readonly InstructionPart[]): string {
  if (parts.length === 0) return '\n'
  const blocks = parts.map(part => `${partMarker(part)}\n${partBody(part.text)}`)

  return `\n\n${blocks.join('\n\n')}\n`
}

/**
 * The text of `.cadre/<id>/CLAUDE.md`, the instructions built for a role from the parts it was given (G-02-1f Storage
 * split, D-140). The first line says the file is built and how to change it, then partsBody: a blank line, then each
 * part in the order given, which is read order, its marker (partMarker) and its text as read (partBody), a blank line
 * between two parts. Every line ends in `\n`, and the text ends with exactly one. It holds whatever parts it is given:
 * desiredFiles gives it a role's repo parts only, so no part of the global CLAUDE.md reaches a repo file (T-02-69).
 */
export function roleClaudeMdText(id: string, parts: readonly InstructionPart[]): string {
  const header = fill(ARTIFACT.roleClaudeMdHeader, { id })

  return `${header}${partsBody(parts)}`
}

/** The most characters of one server name the index shows; a name a role.json holds is at most 100. */
const MAX_NAME_CHARS = 100

/** The lines above the rows of the index (D-69). */
const INDEX_HEAD: readonly string[] = [
  ARTIFACT.indexTitle,
  '',
  ARTIFACT.indexNote,
  '',
  ARTIFACT.indexColumns,
  ARTIFACT.indexRule,
]

/** Text for a table cell: cleaned and capped, with every pipe escaped so it stays one cell. */
function cell(text: string, maxChars: number): string {
  return clean(text, maxChars).replaceAll('|', '\\|')
}

/** Server names for a cell, each as a cell shows it, listed as a scope card lists names (cardList). */
function namesCell(names: readonly string[]): string {
  return cardList(names.map(name => cell(name, MAX_NAME_CHARS)), CARD_LIST_WORDS)
}

/**
 * How many skills a role can run: the handoff skills, the start skills of the framework its scope was compiled for and
 * its own (D-77).
 */
function skillCount(role: RoleSpec, scope: CompiledScope): number {
  return new Set([...INFRA_SKILLS, ...adapterOf(scope.card.framework).startSkills, ...role.skills]).size
}

/** The one-line scope of a role: its Bash, the MCP servers it is given and how many skills it can run. */
function scopeSummary(role: RoleSpec, scope: CompiledScope): string {
  const bash = role.hasBash ? ARTIFACT.indexBash : ARTIFACT.indexNoBash

  return fill(ARTIFACT.indexScope, { bash, servers: namesCell(scope.mcp.servers), skills: skillCount(role, scope) })
}

/** One row of the index table; the framework is the one the scope was compiled for. */
function indexRow(role: RoleSpec, scope: CompiledScope): string {
  const cells = [
    fill(ARTIFACT.indexRoleCell, { title: cell(role.title, MAX_ROLE_CHARS), id: role.id }),
    cell(role.purpose, MAX_PURPOSE_CHARS),
    adapterOf(scope.card.framework).name,
    fill(ARTIFACT.indexModelCell, { model: role.model, effort: role.effort }),
    scopeSummary(role, scope),
    launcherPath(role.id),
    `${handoffFolderOf(role.id)}/`,
  ]

  return fill(ARTIFACT.indexRow, { cells: cells.join(' | ') })
}

/**
 * The text of `.cadre/INDEX.md` (D-69): a static table with one row per role, in role order, built from the definitions
 * alone, so it hashes stably. A row shows the title and id, the purpose, the framework of its compiled scope, the model
 * and effort, a one-line scope, the launcher and the handoff folder; it has no date and no count. A pipe in a title or
 * a purpose is escaped. A role with no scope has no row.
 */
export function indexMdText(roles: readonly RoleSpec[], scopes: ReadonlyMap<string, CompiledScope>): string {
  const rows = roles.flatMap(role => {
    const scope = scopes.get(role.id)
    if (scope === undefined) return []

    return [indexRow(role, scope)]
  })

  return `${[...INDEX_HEAD, ...rows].join('\n')}\n`
}

/** The text of `.cadre/cadre.json`: the repo state (D-89) as stable JSON, which regen and the ignore block read. */
export function cadreJsonText(state: CadreState): string {
  return stableJson(state)
}
