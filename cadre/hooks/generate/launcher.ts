/**
 * The launcher, a layer 6 module: the text of `.cadre/bin/<id>`, the sh script that checks the role files and the
 * render of /cadre start, can run the startup probe, and execs claude with the role's flags, every word shell-quoted
 * (D-102, D-107, D-112, D-113, D-122, T-02-27); and the repo-relative paths of a role's files and built CLAUDE.md. It
 * imports paths, core and the types, so the file set, apply, epic, init and /cadre start read it here.
 */
import type { CompiledScope, LaunchStart, RoleSpec } from '../../types'
import { clean } from '../core/text'
import { cadreStatePath, PROBE_EXPECTATIONS_FILE, roleJsonPath, RUNTIME_STAMP_FILE } from '../paths'

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
export function rolePath(id: string, name: string): string {
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
 * The oldest claude cadre starts a role with, as text (D-107): the one place the version floor is written out. The
 * launcher's version refusal and the claude refusals of /cadre start are built from it; start/claude-version holds
 * the same floor as the MIN_CLAUDE_VERSION tuple it compares by.
 */
export const MIN_CLAUDE_VERSION_TEXT = '2.1.295'

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
    `cadre_claude_ok || ${refusal(
      `cadre: needs claude ${MIN_CLAUDE_VERSION_TEXT} or newer on PATH (see claude --version)`,
    )}`,
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
