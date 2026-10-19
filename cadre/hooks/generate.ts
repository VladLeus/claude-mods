import type { CadreState, CompiledScope, DesiredFile, FrameworkId, RoleSpec } from '../types'
import { adapterOf } from './adapters'
import { FRAMEWORK_START_SKILLS, INFRA_SKILLS } from './assign'
import { clean, compareText } from './facts'
import { MAX_ROLE_CHARS } from './kickoff'
import { stableJson } from './plan'
import { cardList } from './render'
import { MAX_PURPOSE_CHARS } from './roles'
import { scopeCardLines } from './scope'

/** The most characters the role line of a kickoff may have (D-79). */
export const ROLE_LINE_MAX = 200

/** What the role line drops: any character outside printable ASCII, and the quote and backtick characters. */
const NOT_ROLE_LINE_CHAR = /[^\x20-\x7e]|["'`]/g

/**
 * Text as one line of printable ASCII, for the role line of a kickoff (D-79): whitespace of any kind becomes a space,
 * every character outside printable ASCII is dropped, and so are the quote characters and the backtick, which could end
 * the quoted role in autopilot's grammar or open a command in a shell. Runs of spaces collapse to one and the ends are
 * trimmed. The text is cut to maxChars characters without a trailing space, and a cap below 1 gives ''.
 */
export function asciiLine(text: string, maxChars: number): string {
  const kept = text.replace(/\s+/g, ' ').replace(NOT_ROLE_LINE_CHAR, '')

  return kept.replace(/ +/g, ' ').trim().slice(0, Math.max(0, maxChars)).trimEnd()
}

/** What the role line starts the session with: the GSD workflow, a superpowers skill, or the built-in plan file. */
function startText(roleId: string, framework: FrameworkId): string {
  if (framework === 'gsd') return '/gsd-autonomous'
  if (framework === 'superpowers') return 'superpowers:brainstorming'

  return `the plan in .cadre/${roleId}/.runtime/plan.md`
}

/** The role line around a title: the title goes in the sentence, the role id in every path (D-48). */
function roleSentence(role: RoleSpec, framework: FrameworkId, title: string): string {
  const intro = `You are the ${title} role of this repo (cadre role ${role.id}).`
  const next = `Read .cadre/${role.id}/ROLE.md and start with ${startText(role.id, framework)}.`

  return `${intro} ${next}`
}

/**
 * The short ASCII role line of a kickoff (D-79): who the role is, where its ROLE.md is, and what to start with. The
 * title is cut to what is left of ROLE_LINE_MAX once the fixed text is in, so a long title never cuts off the
 * instruction at the end, and a title with no ASCII character left gives way to the role id. The line has no quote or
 * backtick character, so it sits inside the quotes of the autopilot command.
 */
export function kickoffRoleLine(role: RoleSpec, framework: FrameworkId): string {
  const room = ROLE_LINE_MAX - roleSentence(role, framework, '').length
  const own = asciiLine(role.title, room)
  const title = own === '' ? asciiLine(role.id, room) : own

  return asciiLine(roleSentence(role, framework, title), ROLE_LINE_MAX)
}

/**
 * The text of `.cadre/<id>/kickoff.txt` (D-79): the positional autopilot command `/autopilot <duration> <threshold>
 * "<role line>"`, with ` --ask-user` for a role that asks the person, and a newline. The role line is the only quoted
 * text, so autopilot reads the switch outside it.
 */
export function kickoffText(role: RoleSpec, framework: FrameworkId): string {
  const { duration, threshold, askUser } = role.autopilot
  const flag = askUser ? ' --ask-user' : ''

  return `/autopilot ${duration} ${threshold} "${kickoffRoleLine(role, framework)}"${flag}\n`
}

/** The text of `.cadre/<id>/role.json`: the role with schema 1, as stable JSON that parseRoleJson reads back. */
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
const ATTENDED_LINE =
  'Attended: this role needs a person for some framework steps; the Attended rules under Scope say which.'

/**
 * The text of `.cadre/<id>/ROLE.md`, the file `--append-system-prompt-file` gives the session; it is never named
 * CLAUDE.md or AGENTS.md (D-50). It holds, in this order: the title and id, the purpose, the framework with the model,
 * effort and permission mode, a banner when the card says the role is attended, "How you work" (the kickoff text of
 * the adapter, named with the title and the id), "Decisions" (the chain of the card, which follows basedOn),
 * "Handoffs" (the folder autopilot accepts, D-79) and "Scope" (the lines of the scope card, ROLE-06). The framework is
 * the one the scope was compiled for (`scope.card.framework`), so the document and the card cannot disagree. The title
 * and the purpose come from outside, so they are cleaned.
 */
export function roleMdText(role: RoleSpec, scope: CompiledScope): string {
  const { card } = scope
  const adapter = adapterOf(card.framework)
  const kickoff = adapter.kickoffText({ title: role.title, roleId: role.id, specPath: null })
  const model = `Model: ${role.model} + ${role.effort}.`
  const lines = [
    `# ${clean(role.title, MAX_ROLE_CHARS)} (cadre role ${role.id})`,
    '',
    clean(role.purpose, MAX_PURPOSE_CHARS),
    '',
    `Framework: ${adapter.name}. ${model} Permission mode: ${role.permissionMode}.`,
    ...(card.isAttended ? [ATTENDED_LINE] : []),
    '',
    '## How you work',
    '',
    kickoff,
    '',
    '## Decisions',
    '',
    ...card.chain.map(line => `- ${line}`),
    '',
    '## Handoffs',
    '',
    `Write every handoff under thoughts/shared/handoffs/${role.id}/ (autopilot's handoff path).`,
    '',
    '## Scope',
    '',
    ...scopeCardLines(card),
  ]

  return `${lines.join('\n')}\n`
}

/** A word a shell reads as itself without quotes: letters, digits and `_ . / = : @ + -`. */
const BARE_WORD = /^[A-Za-z0-9_./=:@+-]+$/

/**
 * A word as one shell word (T-02-27): left bare when it holds only letters, digits and `_ . / = : @ + -`, else in
 * single quotes with each single quote written as `'\''`. The empty word is `''`. A shell reads every character
 * inside single quotes as itself, so a quoted word cannot split, expand or start a command.
 */
export function shQuote(word: string): string {
  if (BARE_WORD.test(word)) return word

  return `'${word.replaceAll("'", "'\\''")}'`
}

/** The repo-relative path of a file in the folder of a role. */
function rolePath(id: string, name: string): string {
  return `.cadre/${id}/${name}`
}

/**
 * The text of the launcher `.cadre/bin/<id>`, provisional until Phase 3 (Pitfall 8): it goes to the git top level and
 * execs claude with the flags of the compiled scope, each one shell-quoted, then `--` and the kickoff text read from
 * kickoff.txt. The flags come only from compileScope and the title never reaches the script; the role id, which is a
 * slug, is quoted in the path and cleaned in the comments, so a hostile one cannot add a command either. Phase 3 adds
 * the claude version check and renders the `.runtime/` folder before the session starts.
 */
export function launcherText(role: RoleSpec, scope: CompiledScope): string {
  const id = clean(role.id)
  const flags = scope.flags.map(flag => shQuote(flag)).join(' ')
  const kickoff = shQuote(rolePath(role.id, 'kickoff.txt'))
  const lines = [
    '#!/bin/sh',
    `# cadre launcher for role ${id}. Provisional (Phase 2): Phase 3 adds the claude version check`,
    `# and renders .cadre/${id}/.runtime/ before it starts the session.`,
    'set -eu',
    'cd "$(git rev-parse --show-toplevel)"',
    `exec claude ${flags} -- "$(cat ${kickoff})"`,
  ]

  return `${lines.join('\n')}\n`
}

/** The most characters of one server name the index shows; a name a role.json holds is at most 100. */
const MAX_NAME_CHARS = 100

/** The lines above the rows of the index (D-69). */
const INDEX_HEAD: readonly string[] = [
  '# cadre roles',
  '',
  'Generated by cadre from the role definitions. Edit .cadre/<id>/role.json and run /cadre regen <id>.',
  '',
  '| Role | Purpose | Framework | Model | Scope | Launcher | Handoffs |',
  '| --- | --- | --- | --- | --- | --- | --- |',
]

/** Text for a table cell: cleaned and capped, with every pipe escaped so it stays one cell. */
function cell(text: string, maxChars: number): string {
  return clean(text, maxChars).replaceAll('|', '\\|')
}

/** Server names for a cell, each as a cell shows it, listed as a scope card lists names (cardList). */
function namesCell(names: readonly string[]): string {
  return cardList(names.map(name => cell(name, MAX_NAME_CHARS)))
}

/**
 * How many skills a role can run: the handoff skills, the start skills of the framework its scope was compiled for and
 * its own (D-77).
 */
function skillCount(role: RoleSpec, scope: CompiledScope): number {
  return new Set([...INFRA_SKILLS, ...FRAMEWORK_START_SKILLS[scope.card.framework], ...role.skills]).size
}

/** The one-line scope of a role: its Bash, the MCP servers it is given and how many skills it can run. */
function scopeSummary(role: RoleSpec, scope: CompiledScope): string {
  const bash = role.hasBash ? 'sandboxed Bash' : 'no Bash'

  return `${bash}; MCP: ${namesCell(scope.mcp.servers)}; skills: ${skillCount(role, scope)}`
}

/** One row of the index table; the framework is the one the scope was compiled for. */
function indexRow(role: RoleSpec, scope: CompiledScope): string {
  const cells = [
    `${cell(role.title, MAX_ROLE_CHARS)} (${role.id})`,
    cell(role.purpose, MAX_PURPOSE_CHARS),
    adapterOf(scope.card.framework).name,
    `${role.model} + ${role.effort}`,
    scopeSummary(role, scope),
    `.cadre/bin/${role.id}`,
    `thoughts/shared/handoffs/${role.id}/`,
  ]

  return `| ${cells.join(' | ')} |`
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

/** What desiredFiles generates from. */
export type GenerateInput = {
  /** Every role of the team, in role order: the index lists them all. */
  readonly roles: readonly RoleSpec[]
  /**
   * The compiled scope of each role by role id. The framework a role runs is the one its scope was compiled for
   * (`card.framework`). A role with no scope is skipped.
   */
  readonly scopes: ReadonlyMap<string, CompiledScope>
  /** The repo state init writes as `.cadre/cadre.json`. */
  readonly state: CadreState
  /** The id of the one role regen re-renders; null for init, which generates every role and the repo state. */
  readonly only: string | null
}

/** The repo-relative path of the index, which lists every role. */
const INDEX_PATH = '.cadre/INDEX.md'

/** The repo-relative path of the repo state file. */
const STATE_PATH = '.cadre/cadre.json'

/**
 * The files of one role: the five in its folder and its launcher, each with the framework its scope was compiled for.
 * A role with no scope gives none, so nothing is generated from a half-known role.
 */
function roleFiles(role: RoleSpec, scope: CompiledScope | undefined): DesiredFile[] {
  if (scope === undefined) return []

  return [
    { path: rolePath(role.id, 'role.json'), content: roleJsonText(role), mode: 'file' },
    { path: rolePath(role.id, 'ROLE.md'), content: roleMdText(role, scope), mode: 'file' },
    { path: rolePath(role.id, 'kickoff.txt'), content: kickoffText(role, scope.card.framework), mode: 'file' },
    { path: rolePath(role.id, 'settings.json'), content: settingsText(scope), mode: 'file' },
    { path: rolePath(role.id, 'mcp.json'), content: mcpText(scope), mode: 'file' },
    { path: `.cadre/bin/${role.id}`, content: launcherText(role, scope), mode: 'exec' },
  ]
}

/**
 * Every committed file the plan wants (PLAN-01, D-66), sorted by path: for each role its role.json, ROLE.md,
 * kickoff.txt, settings.json and mcp.json under `.cadre/<id>/` and its launcher `.cadre/bin/<id>`, then
 * `.cadre/INDEX.md` and, for init only, `.cadre/cadre.json`. With `only` set (regen, D-68) just that role's files and
 * the index are given, since the index lists every role. Generation is pure: it holds no state between calls, so two
 * runs cannot interleave, and it never changes its input.
 */
export function desiredFiles(input: GenerateInput): DesiredFile[] {
  const { roles, scopes, state, only } = input
  const selected = roles.filter(role => only === null || role.id === only)
  const files = selected.flatMap(role => roleFiles(role, scopes.get(role.id)))
  files.push({ path: INDEX_PATH, content: indexMdText(roles, scopes), mode: 'file' })
  if (only === null) files.push({ path: STATE_PATH, content: cadreJsonText(state), mode: 'file' })

  return files.sort((a, b) => compareText(a.path, b.path))
}
