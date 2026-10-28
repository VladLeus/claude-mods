import type {
  CadreState,
  CompiledScope,
  DesiredFile,
  FrameworkId,
  InstructionPart,
  LaunchStart,
  RoleSpec,
} from '../types'
import { stableJson } from './core/json'
import { MAX_ROLE_CHARS } from './core/kickoff-text'
import { cardList, clean, compareText, reportText, sortedUnique } from './core/text'
import { adapterOf } from './framework/registry'
import {
  cadreStatePath,
  handoffFolderOf,
  launcherPath,
  PROBE_EXPECTATIONS_FILE,
  roleJsonPath,
  RUNTIME_STAMP_FILE,
} from './paths'
import { TOP_OF_FILE } from './records'
import { INFRA_SKILLS } from './roles/infra'
import { MAX_PURPOSE_CHARS } from './roles/validate'
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
  return adapterOf(framework).roleStart(roleId)
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

  return `<!-- from ${markerCell(part.file)} > ${heading} -->`
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
  const header =
    `<!-- cadre: instructions for role ${id}, built from this repo's CLAUDE.md files, rules and docs. ` +
    `Edit the originals and run /cadre regen ${id}; this file is rebuilt. -->`

  return `${header}${partsBody(parts)}`
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

/** The repo-relative path of a role's built CLAUDE.md (G-02-1f; 02-GAPS-B3 S6: one home). */
export function builtClaudeMdPath(id: string): string {
  return rolePath(id, 'CLAUDE.md')
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
 * What the exec line runs claude through (D-140 q1-b): `env` with the variable that makes the engine load a CLAUDE.md
 * from each folder `--add-dir` adds, so the role's built CLAUDE.md and its private one load, set for claude alone and
 * not for the launcher's own commands or the probe run.
 */
const EXEC_CLAUDE = 'exec env CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude'

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
 * The prompt of the probe's one short turn (D-112). It is never the kickoff: a kickoff starts a real autopilot run,
 * which on 2.1.295 can overrun --max-turns (RESEARCH 1.3).
 */
export const PROBE_PROMPT = 'Reply with OK.'

/**
 * The refusal of --probe when the init line does not hold one tools, skills and slash_commands list each (D-130,
 * decision #48).
 */
const PROBE_INVENTORY_MESSAGE =
  'cadre: the probe startup inventory does not hold one tools, skills and slash_commands list'

/**
 * The refusal of --probe when a tools, skills or slash_commands list holds a name its sed read cannot take whole: a
 * name with `]`, or with a character JSON escapes (#72 A1).
 */
const PROBE_NAME_MESSAGE = 'cadre: the probe startup inventory holds a name the launcher cannot read'

/**
 * The lines of the `--probe` branch after its print-mode run (D-112, D-130). They refuse when the run gave no init line
 * or when the init line does not hold exactly one `tools`, `skills` and `slash_commands` list (decision #48); read the
 * tools, slash commands and skills lists, the permission mode and the auto memory folder from that line with sed;
 * refuse when one of the three lists holds a `\` (JSON's escape) or an odd number of `"` (#72 A1); read each line of
 * the expectations file as check|enforcement|text|token with jq when it is on PATH, else with sed; print
 * one line per expectation, `enforced`, `best-effort`, `violated` or `note` and its text; and exit 1 when a check is
 * violated, else 0. They count the expectation lines and refuse when the file gave none, as a file jq or sed could not
 * read would (decision #49); only that refusal names the role. A check the case has no arm for, such as not-visible,
 * is best-effort. The init line and the expectations are only compared and echoed inside double quotes, never run
 * (T-03-10). The sed read of a list stops at its first `]`; with no `\` in the list every `"` is a name's own quote,
 * so a read that stopped inside a name, which held a `]`, holds an odd number of them, and the probe fails closed
 * instead of comparing a cut list. The rule is the one parseInitEvent states for its null.
 */
function probeVerdictLines(id: string): readonly string[] {
  const noRule = runtimeMessage(id, `${PROBE_EXPECTATIONS_FILE} gave no rule`)

  return [
    `  [ -n "$init" ] || ${refusal('cadre: the probe run gave no startup inventory')}`,
    '  cadre_once() { case "$init" in *"\\"$1\\":["*"\\"$1\\":["*) return 1 ;; ' +
      '*"\\"$1\\":["*) return 0 ;; *) return 1 ;; esac; }',
    `  for k in tools skills slash_commands; do cadre_once "$k" || ${refusal(PROBE_INVENTORY_MESSAGE)}; done`,
    `  cadre_list() { printf '%s' "$init" | sed -n "s/.*\\"$1\\":\\[\\([^]]*\\)\\].*/\\1/p"; }`,
    '  tools=$(cadre_list tools)',
    '  commands=$(cadre_list slash_commands)',
    '  skills=$(cadre_list skills)',
    '  cadre_closed() { case $1 in *\\\\*) return 1 ;; esac; ' +
      `[ -z "$(printf '%s' "$1" | tr -cd '"' | sed 's/""//g')" ]; }`,
    `  for l in "$tools" "$commands" "$skills"; do cadre_closed "$l" || ${refusal(PROBE_NAME_MESSAGE)}; done`,
    `  mode=$(printf '%s' "$init" | sed -n 's/.*"permissionMode":"\\([^"]*\\)".*/\\1/p')`,
    `  memory=$(printf '%s' "$init" | sed -n 's/.*"memory_paths":{"auto":"\\([^"]*\\)".*/\\1/p')`,
    '  cadre_rules() { if command -v jq >/dev/null 2>&1; then ' +
      `jq -r '.rules[] | [.check, .enforcement, .text, .token] | join("|")' "$rt"/${PROBE_EXPECTATIONS_FILE}; ` +
      `else sed -n 's/^{"check":"\\([a-z-]*\\)","enforcement":"\\([a-z-]*\\)","text":"\\([^"|]*\\)",` +
      `"token":"\\([^"|]*\\)"},\\{0,1\\}$/\\1|\\2|\\3|\\4/p' "$rt"/${PROBE_EXPECTATIONS_FILE}; fi; }`,
    '  bad=0',
    '  n=0',
    "  while IFS='|' read -r check label text token; do",
    '    [ -n "$check" ] || continue',
    '    n=$((n+1))',
    '    ok=1',
    '    case $check in',
    '      tool-absent) case ",$tools," in *",\\"$token\\","*) ok=0 ;; esac ;;',
    '      tool-prefix-absent) case "$tools" in *"\\"$token"*) ok=0 ;; esac ;;',
    '      tool-present) case ",$tools," in *",\\"$token\\","*) ;; *) ok=0 ;; esac ;;',
    '      command-present) case ",$commands," in *",\\"$token\\","*) ;; *) ok=0 ;; esac ;;',
    '      skill-present) case ",$skills," in *",\\"$token\\","*) ;; *) ok=0 ;; esac ;;',
    '      permission-mode) [ "$mode" = "$token" ] || ok=0 ;;',
    '      memory-path) [ "$memory" = "$token" ] || [ "$memory" = "$token/" ] || ok=0 ;;',
    '      note) echo "note         $text"; continue ;;',
    '      *) ok=2 ;;',
    '    esac',
    '    if [ "$ok" = 0 ]; then bad=1; echo "violated     $text"',
    '    elif [ "$ok" = 2 ] || [ "$label" != hard ]; then echo "best-effort  $text"',
    '    else echo "enforced     $text"; fi',
    '  done <<CADRE_RULES',
    '$(cadre_rules)',
    'CADRE_RULES',
    `  [ "$n" -gt 0 ] || ${refusal(noRule)}`,
    '  exit "$bad"',
    'fi',
  ]
}

/**
 * The start of the launcher line, right after `rt=`, that picks the kickoff the session starts with (D-158), up to the
 * role's own kickoff path: the epic kickoff /cadre epic writes into `.runtime` when that file is there, else the
 * committed one. It is an `if`, not `&&`, so under `set -eu` a missing epic kickoff stops nothing.
 */
export const RUNTIME_KICKOFF_TEST = 'if [ -f "$rt"/kickoff.txt ]; then kick="$rt"/kickoff.txt; else kick='

/**
 * Whether a launcher text picks the epic kickoff in `.runtime` (D-158): it holds RUNTIME_KICKOFF_TEST. A launcher an
 * older cadre wrote does not, so it would start an epic role with its committed kickoff.
 */
export function hasRuntimeKickoff(text: string): boolean {
  return text.includes(RUNTIME_KICKOFF_TEST)
}

/**
 * The text of the launcher `.cadre/bin/<id>`. It finds the repo from its own folder (`dirname -- "$0"`), never from
 * the folder it is run from, and under `set -eu` a failed git stops it. It takes no argument, or `--probe` alone; any
 * other argument prints the usage line on stderr and exits 2. Before it starts anything it refuses, with one line on
 * stderr and exit 1, when:
 * - `.cadre/<id>/role.json` is not under that repo, as for a launcher linked or copied into another repo (D-119);
 * - `.cadre/<id>/ROLE.md` or `kickoff.txt` is missing, since a failed `cat` inside the exec line would not stop it
 *   and claude would start with an empty kickoff;
 * - `claude --version` is missing, unreadable or older than 2.1.295, the engine floor cadre relies on (D-107);
 * - the stamp `/cadre start` writes last into `.cadre/<id>/.runtime/` is missing; or `.cadre/cadre.json` or the
 *   role's role.json, settings.json or mcp.json is newer than it, so a render the role files changed after never
 *   starts; or the rendered settings.json, mcp.json or probe-expectations.json is newer than it, which means a render
 *   did not finish (D-102). The stamp is checked first, since `-nt` against a missing file is true; inbox.md is never
 *   compared, other roles append to it;
 * - the rendered settings.json or mcp.json is missing, empty or not valid JSON, since the engine drops an invalid
 *   settings file in silence with every deny in it (D-107). jq checks them when it is on PATH, else node, else one
 *   line says they were not checked again: `/cadre start` checked them when it rendered them (D-129).
 * - for a `here` start, the folder it is run from (`pwd -P`) is not under the repo, since the engine reads project
 *   settings from the start folder (D-122) and outside the repo that folder's settings could be any, even the user
 *   settings. This check sits where the other starts have their `cd` line.
 * It never runs cadre code and never renders `.runtime/` (D-102): it reads only the stamp, those two JSON files, the
 * expectations file of `--probe` and the role files. It then goes where `start` says (D-113). With `--probe` it starts
 * no session (D-112, D-130): it refuses when `.runtime/probe-expectations.json` is missing or empty, runs one
 * print-mode turn (`claude -p --max-turns 1 --output-format stream-json --verbose --no-session-persistence`) with the
 * same flags, the name `cadre-<id>-probe` and PROBE_PROMPT from /dev/null, never the kickoff, keeps the init line of
 * its output and leaves its stderr on the terminal, so a run that fails shows why (#72 A1), refuses when that line does
 * not hold exactly one `tools`, `skills` and `slash_commands` list, when a list holds a name its sed read cannot take
 * whole, or when the expectations file gave no rule, and prints a verdict per expectation from that line alone
 * (probeVerdictLines), exit 1 when a check is violated. Without it, it execs claude through env with
 * CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 (EXEC_CLAUDE, D-140 q1-b), so the CLAUDE.md files of the folders the
 * flags add load, with the flags of the compiled scope, for a `here` or `dir` start the git root it found as an added
 * directory (ROOT_DIR_FLAG, D-127, which the probe run adds too; a git-root start adds nothing), then `--` and the
 * kickoff: each flag shell-quoted, and the value after a path flag (PATH_FLAGS) and the kickoff read anchored at the
 * repo root, since in `here` and `dir` the session starts outside the git top level. The kickoff is the epic kickoff
 * `.cadre/<id>/.runtime/kickoff.txt` when that file is there, else `.cadre/<id>/kickoff.txt` (RUNTIME_KICKOFF_TEST,
 * D-158), passed as one quoted argument and never run. The flags come only from
 * compileScope and the title never reaches the script; the role id, a slug, is quoted in the paths and cleaned in the
 * comments and the messages, each message one quoted word, so a hostile id cannot add a command either.
 */
export function launcherText(role: RoleSpec, scope: CompiledScope, start: LaunchStart): string {
  const id = clean(role.id)
  const words = scope.flags.map((flag, index) =>
    PATH_FLAGS.includes(scope.flags[index - 1] ?? '') ? rootWord(flag) : shQuote(flag),
  )
  const flags = words.join(' ')
  // The probe run passes the same flags under its own name, so no fleet beat or status takes it for the role session.
  const probeFlags = words
    .map((word, index) => (scope.flags[index - 1] === '--name' ? shQuote(`cadre-${role.id}-probe`) : word))
    .join(' ')
  const rootDir = start.kind === 'git-root' ? '' : ` ${ROOT_DIR_FLAG}`
  const kickoff = rootWord(rolePath(role.id, 'kickoff.txt'))
  const stamp = `"$rt"/${RUNTIME_STAMP_FILE}`
  const expectations = `"$rt"/${PROBE_EXPECTATIONS_FILE}`
  const renderInputs = [
    cadreStatePath(),
    ...['role.json', 'settings.json', 'mcp.json'].map(name => rolePath(role.id, name)),
  ]
  const fresh = [...renderInputs.map(rootWord), '"$rt"/settings.json', '"$rt"/mcp.json', expectations].join(' ')
  const jsonFiles = '"$rt"/settings.json "$rt"/mcp.json >/dev/null 2>&1'
  const usage = errorLine(`cadre: usage: .cadre/bin/${id} [--probe]`)
  const probeRun =
    '  init=$(claude -p --max-turns 1 --output-format stream-json --verbose --no-session-persistence ' +
    `${probeFlags}${rootDir} -- ${shQuote(PROBE_PROMPT)} </dev/null | grep '"subtype":"init"' | ` +
    'head -n 1) || true'
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
    `[ -f ${rootWord(roleJsonPath(role.id))} ] || ${refusal(foreign)}`,
    `[ -f ${rootWord(rolePath(role.id, 'ROLE.md'))} ] && [ -f ${kickoff} ] || ${refusal(missing)}`,
    `rt=${rootWord(rolePath(role.id, '.runtime'))}`,
    `${RUNTIME_KICKOFF_TEST}${kickoff}; fi`,
    'probe=0',
    `case $# in 0) ;; 1) [ "$1" = --probe ] || { ${usage}; exit 2; }; probe=1 ;; *) ${usage}; exit 2 ;; esac`,
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
    'if [ "$probe" = 1 ]; then',
    `  [ -s ${expectations} ] || ${refusal(runtimeMessage(id, `${PROBE_EXPECTATIONS_FILE} is missing`))}`,
    probeRun,
    ...probeVerdictLines(id),
    `${EXEC_CLAUDE} ${flags}${rootDir} -- "$(cat "$kick")"`,
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
  return new Set([...INFRA_SKILLS, ...adapterOf(scope.card.framework).startSkills, ...role.skills]).size
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
    launcherPath(role.id),
    `${handoffFolderOf(role.id)}/`,
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
  /**
   * The instruction parts each role was given, by role id, in read order (G-02-1f Storage split): only those read from
   * the repo go into the role's `.cadre/<id>/CLAUDE.md`. Whenever init passes repoParts every role gets its built
   * file, the header alone with no repo part, so a later hand-out always replaces stale content (02-GAPS-B2 S1).
   * Absent for regen and /cadre start, which then build no such file.
   */
  readonly repoParts?: ReadonlyMap<string, readonly InstructionPart[]>
}

/** The repo-relative path of the index, which lists every role. */
const INDEX_PATH = '.cadre/INDEX.md'

/**
 * The built instructions of one role (G-02-1f Storage split): `.cadre/<id>/CLAUDE.md` from the parts it was given that
 * were read from the repo (roleClaudeMdText). Whenever init passes repoParts every role gets its built file, the
 * header alone with no repo part, so a later hand-out always replaces stale content (02-GAPS-B2 S1); null parts, as
 * regen and /cadre start pass, give none. A part of the global CLAUDE.md is dropped here, so it never reaches a file in
 * the repo (T-02-69).
 */
function builtFiles(id: string, parts: readonly InstructionPart[] | null): DesiredFile[] {
  if (parts === null) return []
  const repo = parts.filter(part => part.source === 'repo')

  return [{ path: builtClaudeMdPath(id), content: roleClaudeMdText(id, repo), mode: 'file' }]
}

/**
 * The files of one role: the five in its folder, its built CLAUDE.md (builtFiles: whenever init passes repoParts every
 * role gets its built file, the header alone with no repo part, so a later hand-out always replaces stale content,
 * 02-GAPS-B2 S1; none for null parts), and its launcher, each with the framework its scope was compiled for, the
 * launcher starting where `start` says. A role with no scope gives none, so nothing is generated from a half-known
 * role.
 */
function roleFiles(
  role: RoleSpec,
  scope: CompiledScope | undefined,
  start: LaunchStart,
  parts: readonly InstructionPart[] | null,
): DesiredFile[] {
  if (scope === undefined) return []

  return [
    { path: roleJsonPath(role.id), content: roleJsonText(role), mode: 'file' },
    { path: rolePath(role.id, 'ROLE.md'), content: roleMdText(role, scope), mode: 'file' },
    { path: rolePath(role.id, 'kickoff.txt'), content: kickoffText(role, scope.card.framework), mode: 'file' },
    { path: rolePath(role.id, 'settings.json'), content: settingsText(scope), mode: 'file' },
    { path: rolePath(role.id, 'mcp.json'), content: mcpText(scope), mode: 'file' },
    ...builtFiles(role.id, parts),
    { path: launcherPath(role.id), content: launcherText(role, scope, start), mode: 'exec' },
  ]
}

/**
 * Every committed file the plan wants (PLAN-01, D-66), sorted by path: for each role its role.json, ROLE.md,
 * kickoff.txt, settings.json and mcp.json under `.cadre/<id>/`, its built `.cadre/<id>/CLAUDE.md` from the parts
 * `repoParts` gives it that were read from the repo (G-02-1f), and its launcher `.cadre/bin/<id>`, which starts where
 * `state.launchStart` says, then `.cadre/INDEX.md` and, for init only, `.cadre/cadre.json`. Whenever init passes
 * repoParts every role gets its built file, the header alone with no repo part, so a later hand-out always replaces
 * stale content (02-GAPS-B2 S1); with repoParts absent (regen, /cadre start) no role gets one. With `only` set (regen,
 * D-68) just that role's files and the index are given, since the index lists every role. Generation is pure: it holds
 * no state between calls, so two runs cannot interleave, and it never changes its input.
 */
export function desiredFiles(input: GenerateInput): DesiredFile[] {
  const { roles, scopes, state, only } = input
  const selected = roles.filter(role => only === null || role.id === only)
  const partsOf = (id: string): readonly InstructionPart[] | null =>
    input.repoParts === undefined ? null : (input.repoParts.get(id) ?? [])
  const files = selected.flatMap(role => roleFiles(role, scopes.get(role.id), state.launchStart, partsOf(role.id)))
  files.push({ path: INDEX_PATH, content: indexMdText(roles, scopes), mode: 'file' })
  if (only === null) files.push({ path: cadreStatePath(), content: cadreJsonText(state), mode: 'file' })

  return files.sort((a, b) => compareText(a.path, b.path))
}

/**
 * The argv that asks git which of these repo-relative files it tracks (02-GAPS-B2 M3): `git ls-files -z`, with
 * `--literal-pathspecs` so a name is never a pattern and `--` before the names; it runs at the repo root.
 */
export function gitTrackedArgv(files: readonly string[]): readonly string[] {
  return ['git', '--literal-pathspecs', 'ls-files', '-z', '--', ...files]
}

/** The source file of every repo part the roles were given, sorted, once each (02-GAPS-B2 M3): what git is asked. */
export function repoPartFiles(repoParts: ReadonlyMap<string, readonly InstructionPart[]>): string[] {
  const parts = Array.from(repoParts.values()).flat()

  return sortedUnique(parts.filter(part => part.source === 'repo').map(part => part.file))
}

/**
 * The repo parts a built role file may hold (02-GAPS-B2 M3): the same keys, each keeping only the repo parts whose
 * source file is in `tracked`; null, when git could not be asked, keeps none, so a file git does not track never
 * reaches a committed file.
 */
export function trackedRepoParts(
  repoParts: ReadonlyMap<string, readonly InstructionPart[]>,
  tracked: ReadonlySet<string> | null,
): ReadonlyMap<string, readonly InstructionPart[]> {
  const isTracked = (part: InstructionPart): boolean => part.source === 'repo' && tracked?.has(part.file) === true

  return new Map(Array.from(repoParts, ([id, parts]): [string, InstructionPart[]] => [id, parts.filter(isTracked)]))
}

/**
 * The warning for a source file whose repo parts were left out of the built role files because git does not track it
 * (02-GAPS-B2 M3).
 */
export function untrackedPartsWarning(file: string): string {
  return `${reportText(file)} is not tracked by git: its parts are not written to .cadre/`
}

/**
 * The warning when git could not be asked which instruction files it tracks (02-GAPS-B2 M3): no repo part is written,
 * so the check fails closed.
 */
export const GIT_TRACKING_UNKNOWN_WARNING =
  'could not ask git which instruction files it tracks: no repo part is written to .cadre/'

/** The character `git ls-files -z` ends each name with, built at run time. */
const NUL = String.fromCharCode(0)

/** The files `git ls-files -z` named (02-GAPS-B2 M3): its NUL-separated names, an empty name skipped. */
export function trackedFilesOf(stdout: string): ReadonlySet<string> {
  return new Set(stdout.split(NUL).filter(name => name !== ''))
}
