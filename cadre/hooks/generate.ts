import type { CadreState, CompiledScope, DesiredFile, FrameworkId, RoleSpec } from '../types'
import { compareText } from './facts'
import { stableJson } from './plan'

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

/** What desiredFiles generates from. */
export type GenerateInput = {
  /** Every role of the team, in role order: the index lists them all. */
  readonly roles: readonly RoleSpec[]
  /** The compiled scope of each role by role id. A role with no scope is skipped. */
  readonly scopes: ReadonlyMap<string, CompiledScope>
  /** The framework each role runs, by role id: its own, else the repo default. A role with none is skipped. */
  readonly frameworks: ReadonlyMap<string, FrameworkId>
  /** The repo state init writes as `.cadre/cadre.json`. */
  readonly state: CadreState
  /** The id of the one role regen re-renders; null for init, which generates every role and the repo state. */
  readonly only: string | null
}

/** The repo-relative path of the index, which lists every role. */
const INDEX_PATH = '.cadre/INDEX.md'

/** The repo-relative path of the repo state file. */
const STATE_PATH = '.cadre/cadre.json'

/** The repo-relative path of a file in the folder of a role. */
function rolePath(id: string, name: string): string {
  return `.cadre/${id}/${name}`
}

/** The first line of ROLE.md, until Task 2 writes the whole document. */
function roleMdDraft(role: RoleSpec): string {
  return `# ${role.title} (cadre role ${role.id})\n`
}

/** The first lines of the launcher, until Task 2 writes the whole script. */
function launcherDraft(role: RoleSpec): string {
  return `#!/bin/sh\n# cadre launcher for role ${role.id}\n`
}

/** The first line of the index, until Task 2 writes the whole table. */
function indexDraft(): string {
  return '# cadre roles\n'
}

/**
 * The files of one role: the five in its folder and its launcher. A role with no scope or no framework gives none, so
 * nothing is generated from a half-known role.
 */
function roleFiles(
  role: RoleSpec,
  scope: CompiledScope | undefined,
  framework: FrameworkId | undefined,
): DesiredFile[] {
  if (scope === undefined || framework === undefined) return []

  return [
    { path: rolePath(role.id, 'role.json'), content: roleJsonText(role), mode: 'file' },
    { path: rolePath(role.id, 'ROLE.md'), content: roleMdDraft(role), mode: 'file' },
    { path: rolePath(role.id, 'kickoff.txt'), content: kickoffText(role, framework), mode: 'file' },
    { path: rolePath(role.id, 'settings.json'), content: settingsText(scope), mode: 'file' },
    { path: rolePath(role.id, 'mcp.json'), content: mcpText(scope), mode: 'file' },
    { path: `.cadre/bin/${role.id}`, content: launcherDraft(role), mode: 'exec' },
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
  const { roles, scopes, frameworks, state, only } = input
  const selected = roles.filter(role => only === null || role.id === only)
  const files = selected.flatMap(role => roleFiles(role, scopes.get(role.id), frameworks.get(role.id)))
  files.push({ path: INDEX_PATH, content: indexDraft(), mode: 'file' })
  if (only === null) files.push({ path: STATE_PATH, content: stableJson(state), mode: 'file' })

  return files.sort((a, b) => compareText(a.path, b.path))
}
