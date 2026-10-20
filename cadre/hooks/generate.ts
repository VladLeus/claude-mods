import type { CadreState, CompiledScope, DesiredFile, FrameworkId, LaunchStart, RoleSpec } from '../types'
import { adapterOf } from './adapters'
import { FRAMEWORK_START_SKILLS, INFRA_SKILLS } from './assign'
import { clean, compareText } from './facts'
import { MAX_ROLE_CHARS } from './kickoff'
import { RUNTIME_STAMP_FILE, stableJson } from './plan'
import { cardList } from './render'
import { MAX_PURPOSE_CHARS } from './roles'
import { scopeCardLines } from './scope'

/**
 * The most characters the role line of a kickoff may have (D-79; 240 since the inbox sentence of D-114,
 * decisions #32/#39).
 */
export const ROLE_LINE_MAX = 240

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

/**
 * The role line around a title: the title goes in the sentence, the role id in every path (D-48). The role reads its
 * ROLE.md and checks its inbox before it starts (D-114: text only, no new command).
 */
function roleSentence(role: RoleSpec, framework: FrameworkId, title: string): string {
  const intro = `You are the ${title} role of this repo (cadre role ${role.id}).`
  const next = `Read .cadre/${role.id}/ROLE.md, check your inbox, then start with ${startText(role.id, framework)}.`

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
 * "Handoffs" (the folder autopilot accepts, D-79), "Inbox" (the role's inbox file and how to leave a note in another
 * role's; D-114: text only, no new command) and "Scope" (the lines of the scope card, ROLE-06). The framework is the
 * one the scope was compiled for (`scope.card.framework`), so the document and the card cannot disagree. The title and
 * the purpose come from outside, so they are cleaned.
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
    '## Inbox',
    '',
    `Your inbox is .cadre/${role.id}/.runtime/inbox.md, a path from the git root. ` +
      'Read it when you start and after every restart.',
    'To leave a note for another role, append one dated line to .cadre/<role id>/.runtime/inbox.md of that role ' +
      '(the role ids are in .cadre/INDEX.md); never edit or delete a line that is there.',
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

/** The launcher flags whose value is a repo-relative path, which the launcher writes anchored at the repo root (A2). */
const PATH_FLAGS: readonly string[] = Object.freeze([
  '--settings',
  '--append-system-prompt-file',
  '--add-dir',
  '--mcp-config',
])

/** The line that finds the repo from the launcher's own folder: under `set -eu` a failed git stops the script (A2). */
const ROOT_LINE = 'root=$(cd -- "$(dirname -- "$0")" && git rev-parse --show-toplevel)'

/**
 * The flag words a launcher that starts in a sub-folder (here or dir) adds after the scope flags: the git root it
 * found, as an added directory, so the role reads its inbox, other roles' inboxes and the root `.planning/` without a
 * prompt (D-127). It is not a scope flag: only the launcher knows the root it resolved.
 */
const ROOT_DIR_FLAG = '--add-dir "$root"'

/** A repo-relative path as one shell word anchored at the repo root the launcher found: `"$root"/<quoted path>`. */
function rootWord(path: string): string {
  return `"$root"/${shQuote(path)}`
}

/**
 * The one line before the exec: `cd` to the git root or a folder under it, or for a here start a refusal when the
 * folder it is run from is not under the repo (A3): project settings are read from the start folder (D-122).
 */
function startLines(start: LaunchStart, id: string): string[] {
  if (start.kind === 'git-root') return ['cd -- "$root"']
  if (start.kind === 'dir') return [`cd -- ${rootWord(start.path)}`]
  const outside = refusal(`cadre: run .cadre/bin/${id} from a folder of its repo`)

  return [`case "$(pwd -P)/" in "$root"/*) ;; *) ${outside} ;; esac`]
}

/** A message of the launcher on stderr, as one shell word whatever it holds (T-03-07). */
function errorLine(message: string): string {
  return `echo ${shQuote(message)} >&2`
}

/** A refusal of the launcher: its message on stderr, then exit 1 before anything starts. */
function refusal(message: string): string {
  return `{ ${errorLine(message)}; exit 1; }`
}

/**
 * A launcher message about the rendered folder of a role (D-102): `cadre: .cadre/<id>/.runtime/<problem>: run
 * /cadre start <id>`. A problem starts with a space unless it names files in the folder.
 */
function runtimeMessage(id: string, problem: string): string {
  return `cadre: .cadre/${id}/.runtime/${problem}: run /cadre start ${id}`
}

/**
 * The lines that define `cadre_claude_ok`, which launcherText puts right after `rt=`. The function reads
 * `claude --version` through a fixed sed program and passes for 2.1.295 or newer (D-107); it is a function, so its
 * `set --` leaves the launcher's own arguments alone.
 */
const VERSION_CHECK_LINES: readonly string[] = Object.freeze([
  'cadre_claude_ok() {',
  "  set -- $(claude --version 2>/dev/null | sed -n " +
    "'s/^\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\).*/\\1 \\2 \\3/p')",
  '  [ $# -eq 3 ] || return 1',
  '  [ "$1" -gt 2 ] || { [ "$1" -eq 2 ] && { [ "$2" -gt 1 ] || { [ "$2" -eq 1 ] && [ "$3" -ge 295 ]; }; }; }',
  '}',
])

/**
 * The text of the launcher `.cadre/bin/<id>`. It finds the repo from its own folder (`dirname -- "$0"`), never from
 * the folder it is run from, and under `set -eu` a failed git stops it. Before it starts anything it refuses, with one
 * line on stderr and exit 1, when:
 * - `.cadre/<id>/role.json` is not under that repo, as for a launcher linked or copied into another repo (D-119);
 * - `.cadre/<id>/ROLE.md` or `kickoff.txt` is missing, since a failed `cat` inside the exec line would not stop it
 *   and claude would start with an empty kickoff;
 * - `claude --version` is missing, unreadable or older than 2.1.295, the engine floor cadre relies on (D-107);
 * - the stamp `/cadre start` writes last into `.cadre/<id>/.runtime/` is missing; or `.cadre/cadre.json` or the
 *   role's role.json, settings.json or mcp.json is newer than it, so a render the role files changed after never
 *   starts; or the rendered settings.json or mcp.json is newer than it, which means a render did not finish (D-102).
 *   The stamp is checked first, since `-nt` against a missing file is true; inbox.md is never compared, other roles
 *   append to it;
 * - the rendered settings.json or mcp.json is missing, empty or not valid JSON, since the engine drops an invalid
 *   settings file in silence with every deny in it (D-107). jq checks them when it is on PATH, else node, else one
 *   line says they were not checked again: `/cadre start` checked them when it rendered them (D-129).
 * - for a `here` start, the folder it is run from (`pwd -P`) is not under the repo, since the engine reads project
 *   settings from the start folder (D-122) and outside the repo that folder's settings could be any, even the user
 *   settings. This check sits where the other starts have their `cd` line.
 * It never runs cadre code and never renders `.runtime/` (D-102): it reads only the stamp, those two JSON files and
 * the role files. It then goes where `start` says (D-113) and execs claude with the flags of the compiled scope, for a
 * `here` or `dir` start the git root it found as an added directory (ROOT_DIR_FLAG, D-127; a git-root start adds
 * nothing), then `--` and the kickoff: each flag shell-quoted, and the value after a path flag (PATH_FLAGS) and the
 * kickoff read anchored at the repo root, since in `here` and `dir` the session starts outside the git top level. The
 * flags come only from compileScope and the title never reaches the script; the role id, a slug, is quoted in the
 * paths and cleaned in the comments and the messages, each message one quoted word, so a hostile id cannot add a
 * command either.
 */
export function launcherText(role: RoleSpec, scope: CompiledScope, start: LaunchStart): string {
  const id = clean(role.id)
  const flags = scope.flags
    .map((flag, index) => (PATH_FLAGS.includes(scope.flags[index - 1] ?? '') ? rootWord(flag) : shQuote(flag)))
    .join(' ')
  const rootDir = start.kind === 'git-root' ? '' : ` ${ROOT_DIR_FLAG}`
  const kickoff = rootWord(rolePath(role.id, 'kickoff.txt'))
  const stamp = `"$rt"/${RUNTIME_STAMP_FILE}`
  const renderInputs = [STATE_PATH, ...['role.json', 'settings.json', 'mcp.json'].map(name => rolePath(role.id, name))]
  const fresh = [...renderInputs.map(rootWord), '"$rt"/settings.json', '"$rt"/mcp.json'].join(' ')
  const jsonFiles = '"$rt"/settings.json "$rt"/mcp.json >/dev/null 2>&1'
  const parse = shQuote('for (const f of process.argv.slice(1)) JSON.parse(require("fs").readFileSync(f, "utf8"))')
  const foreign = `cadre: not the repo of role ${id}`
  const missing = `cadre: .cadre/${id}/ROLE.md or kickoff.txt is missing: run /cadre regen ${id}`
  const unrendered = `${runtimeMessage(id, ' is not rendered')} in the root session of the repo`
  const empty = runtimeMessage(id, 'settings.json or mcp.json is missing or empty')
  const invalid = refusal(runtimeMessage(id, ' holds a file that is not valid JSON'))
  const lines = [
    '#!/bin/sh',
    `# cadre launcher for role ${id}: checks claude and .cadre/${id}/.runtime/, then starts the session.`,
    `# /cadre start ${id} renders .cadre/${id}/.runtime/ in the root session of the repo; ` +
      'this script never renders it.',
    'set -eu',
    ROOT_LINE,
    `[ -f ${rootWord(rolePath(role.id, 'role.json'))} ] || ${refusal(foreign)}`,
    `[ -f ${rootWord(rolePath(role.id, 'ROLE.md'))} ] && [ -f ${kickoff} ] || ${refusal(missing)}`,
    `rt=${rootWord(rolePath(role.id, '.runtime'))}`,
    ...VERSION_CHECK_LINES,
    `cadre_claude_ok || ${refusal('cadre: needs claude 2.1.295 or newer on PATH (see claude --version)')}`,
    `[ -f ${stamp} ] || ${refusal(unrendered)}`,
    `for f in ${fresh}; do`,
    `  if [ "$f" -nt ${stamp} ]; then ${errorLine(runtimeMessage(id, ' is older than the role files'))}; exit 1; fi`,
    'done',
    `[ -s "$rt"/settings.json ] && [ -s "$rt"/mcp.json ] || ${refusal(empty)}`,
    // The JSON check (D-129): jq when it is on PATH, else node, else one line that says the files were not
    // checked again.
    'if command -v jq >/dev/null 2>&1; then',
    `  jq empty ${jsonFiles} || ${invalid}`,
    'elif command -v node >/dev/null 2>&1; then',
    `  node -e ${parse} ${jsonFiles} || ${invalid}`,
    'else',
    `  ${errorLine('cadre: (JSON not re-checked: no jq or node)')}`,
    'fi',
    ...startLines(start, id),
    `exec claude ${flags}${rootDir} -- "$(cat ${kickoff})"`,
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
  /** The repo state init writes as `.cadre/cadre.json`; its `launchStart` is where every launcher starts (A2). */
  readonly state: CadreState
  /** The id of the one role regen re-renders; null for init, which generates every role and the repo state. */
  readonly only: string | null
}

/** The repo-relative path of the index, which lists every role. */
const INDEX_PATH = '.cadre/INDEX.md'

/** The repo-relative path of the repo state file. */
const STATE_PATH = '.cadre/cadre.json'

/**
 * The files of one role: the five in its folder and its launcher, each with the framework its scope was compiled for,
 * the launcher starting where `start` says. A role with no scope gives none, so nothing is generated from a half-known
 * role.
 */
function roleFiles(role: RoleSpec, scope: CompiledScope | undefined, start: LaunchStart): DesiredFile[] {
  if (scope === undefined) return []

  return [
    { path: rolePath(role.id, 'role.json'), content: roleJsonText(role), mode: 'file' },
    { path: rolePath(role.id, 'ROLE.md'), content: roleMdText(role, scope), mode: 'file' },
    { path: rolePath(role.id, 'kickoff.txt'), content: kickoffText(role, scope.card.framework), mode: 'file' },
    { path: rolePath(role.id, 'settings.json'), content: settingsText(scope), mode: 'file' },
    { path: rolePath(role.id, 'mcp.json'), content: mcpText(scope), mode: 'file' },
    { path: `.cadre/bin/${role.id}`, content: launcherText(role, scope, start), mode: 'exec' },
  ]
}

/**
 * Every committed file the plan wants (PLAN-01, D-66), sorted by path: for each role its role.json, ROLE.md,
 * kickoff.txt, settings.json and mcp.json under `.cadre/<id>/` and its launcher `.cadre/bin/<id>`, which starts where
 * `state.launchStart` says, then `.cadre/INDEX.md` and, for init only, `.cadre/cadre.json`. With `only` set (regen,
 * D-68) just that role's files and the index are given, since the index lists every role. Generation is pure: it holds
 * no state between calls, so two runs cannot interleave, and it never changes its input.
 */
export function desiredFiles(input: GenerateInput): DesiredFile[] {
  const { roles, scopes, state, only } = input
  const selected = roles.filter(role => only === null || role.id === only)
  const files = selected.flatMap(role => roleFiles(role, scopes.get(role.id), state.launchStart))
  files.push({ path: INDEX_PATH, content: indexMdText(roles, scopes), mode: 'file' })
  if (only === null) files.push({ path: STATE_PATH, content: cadreJsonText(state), mode: 'file' })

  return files.sort((a, b) => compareText(a.path, b.path))
}
