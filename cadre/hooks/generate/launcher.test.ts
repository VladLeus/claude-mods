import { describe, expect, test } from 'claude-code/testing'

import type { CadreState, CompiledScope, FrameworkId, LaunchStart, RoleSpec } from '../../types'
import { ABSOLUTE_PATH_MARKERS, contentOf, FRAMEWORKS, leaks, scopeOf, TEMPLATE_ROLES, templateRole } from '../testkit'
import { desiredFiles } from './files'
import type { GenerateInput } from './files'
import { hasRuntimeKickoff, launcherText, RUNTIME_KICKOFF_TEST, shQuote } from './launcher'

/** The repo state of a team on one framework: what init writes as .cadre/cadre.json. */
function stateOf(team: readonly RoleSpec[], framework: FrameworkId): CadreState {
  return {
    schema: 1,
    cadreVersion: '0.2.0',
    framework,
    gitPolicy: 'definitions',
    roles: team.map(role => role.id),
    launchStart: { kind: 'git-root' },
    readUserMcp: false,
  }
}

/** The input init gives desiredFiles for a team that runs one framework; `over` changes the fields it names. */
function inputOf(team: readonly RoleSpec[], framework: FrameworkId, over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    roles: team,
    scopes: new Map(team.map((role): [string, CompiledScope] => [role.id, scopeOf(role, framework, team)])),
    state: stateOf(team, framework),
    only: null,
    ...over,
  }
}

/** The characters a shell reads as part of a bare word: what shQuote leaves unquoted. */
const BARE_SHELL_CHAR = /[A-Za-z0-9_./=:@+-]/

/**
 * The index just past the `)` that closes a command substitution whose text starts at `start`, right after its `$(`.
 * Single-quoted spans, double-quoted spans and backslash escapes inside it are read as such, so a `)` inside quotes
 * does not close it; -1 when nothing closes it.
 */
function substitutionEnd(line: string, start: number): number {
  let quote = ''
  for (let index = start; index < line.length; index++) {
    const char = line.charAt(index)
    if (quote !== '') {
      if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === ')') return index + 1
  }

  return -1
}

/**
 * The words a POSIX shell reads from a line, for the quoting shapes the launcher uses: bare words of plain characters,
 * single-quoted spans, a backslash before a single quote, and double-quoted spans read to the next double quote, a
 * `$(...)` command substitution inside one kept as its text. It throws on any other character outside quotes and on a
 * substitution nothing closes, so a metacharacter left bare fails the test that reads the line.
 */
function shellWords(line: string): string[] {
  const words: string[] = []
  let word: string | null = null
  let quote = ''
  for (let index = 0; index < line.length; index++) {
    const char = line.charAt(index)
    if (quote === '"' && char === '$' && line.charAt(index + 1) === '(') {
      const end = substitutionEnd(line, index + 2)
      if (end === -1) throw new Error(`an unclosed $( in ${line}`)
      word = `${word ?? ''}${line.slice(index, end)}`
      index = end - 1
      continue
    }
    if (quote !== '') {
      if (char === quote) quote = ''
      else word = `${word ?? ''}${char}`
      continue
    }
    if (char === ' ') {
      if (word !== null) words.push(word)
      word = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      word = word ?? ''
      continue
    }
    if (char === '\\' && line.charAt(index + 1) === "'") {
      word = `${word ?? ''}'`
      index += 1
      continue
    }
    if (!BARE_SHELL_CHAR.test(char)) throw new Error(`a bare ${JSON.stringify(char)} in ${line}`)
    word = `${word ?? ''}${char}`
  }
  if (quote !== '') throw new Error(`an unclosed quote in ${line}`)
  if (word !== null) words.push(word)

  return words
}

/** Whether the shell reader refuses a line (a bare metacharacter or an unclosed quote). */
function isRefused(line: string): boolean {
  try {
    shellWords(line)
  } catch {
    return true
  }

  return false
}

/** The words of the `exec claude` line of a launcher. */
function execWords(launcher: string): string[] {
  const start = launcher.indexOf('\nexec ')

  return shellWords(launcher.slice(start + 1).replace(/\n$/, ''))
}

/** The launcher flags whose value is a repo-relative path, which the launcher anchors at the repo root (A2). */
const PATH_FLAG_NAMES: readonly string[] = ['--settings', '--append-system-prompt-file', '--add-dir', '--mcp-config']

/** The flags as the shell reader reads them from a launcher: the value of each path flag as `$root/<value>`. */
function anchoredFlags(flags: readonly string[]): string[] {
  return flags.map((flag, index) => (PATH_FLAG_NAMES.includes(flags[index - 1] ?? '') ? `$root/${flag}` : flag))
}

/** Every place a launcher can start its session (A2). */
const LAUNCH_STARTS: readonly LaunchStart[] = [
  { kind: 'git-root' },
  { kind: 'here' },
  { kind: 'dir', path: 'apps/web' },
]

/** The flags of the BE role on the merged route, in launcher order, each path anchored at the repo root. */
const BE_FLAGS = [
  '--setting-sources project',
  '--settings "$root"/.cadre/be/.runtime/settings.json',
  '--append-system-prompt-file "$root"/.cadre/be/ROLE.md',
  '--name cadre-be',
  '--model opus',
  '--effort medium',
  '--permission-mode auto',
  '--add-dir "$root"/.cadre/be/.runtime/overlay',
  '--add-dir "$root"/.cadre/be',
  '--add-dir "$root"/.cadre/be/.runtime/private-instructions',
  '--mcp-config "$root"/.cadre/be/.runtime/mcp.json',
].join(' ')

/**
 * The first words of every exec line: env sets the variable that makes the engine load the CLAUDE.md of each added
 * folder, for claude alone (D-140 q1-b).
 */
const EXEC_PREFIX: readonly string[] = ['exec', 'env', 'CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1', 'claude']

/** The line that finds the repo from the launcher's own folder, so a run from another folder cannot misfire (A2). */
const ROOT_LINE = 'root=$(cd -- "$(dirname -- "$0")" && git rev-parse --show-toplevel)'

/** The guard of the BE launcher: it refuses when role.json is not under the repo it found (D-119). */
const BE_GUARD = `[ -f "$root"/.cadre/be/role.json ] || { echo 'cadre: not the repo of role be' >&2; exit 1; }`

/** The check of the BE launcher that its ROLE.md and kickoff.txt are there, right after the guard (A7). */
const BE_FILES_CHECK =
  `[ -f "$root"/.cadre/be/ROLE.md ] && [ -f "$root"/.cadre/be/kickoff.txt ] || { echo 'cadre: .cadre/be/ROLE.md ` +
  `or kickoff.txt is missing: run /cadre regen be' >&2; exit 1; }`

/**
 * The line of the BE launcher right after `rt=` that picks its kickoff: the epic kickoff /cadre epic writes into
 * `.runtime` when it is there, else the committed one (D-158).
 */
const BE_KICKOFF_LINE =
  'if [ -f "$rt"/kickoff.txt ]; then kick="$rt"/kickoff.txt; else kick="$root"/.cadre/be/kickoff.txt; fi'

/** The check of a here-start BE launcher that it is run from a folder of its repo (A3). */
const BE_HERE_CHECK =
  `case "$(pwd -P)/" in "$root"/*) ;; *) { echo 'cadre: run .cadre/bin/be from a folder of its repo' >&2; ` +
  'exit 1; } ;; esac'

/** The refusal of a claude that is missing, unreadable or older than 2.1.295 (D-107). */
const VERSION_REFUSAL =
  "cadre_claude_ok || { echo 'cadre: needs claude 2.1.295 or newer on PATH (see claude --version)' >&2; exit 1; }"

/** The stamp check of the BE launcher: with no stamp, no render of .runtime/ has finished (D-102). */
const BE_STAMP_CHECK =
  `[ -f "$rt"/stamp ] || { echo 'cadre: .cadre/be/.runtime/ is not rendered: ` +
  `run /cadre start be in the root session of the repo' >&2; exit 1; }`

/** The line a launcher prints when neither jq nor node is there to check the rendered JSON again (D-129). */
const NO_JSON_CHECKER = "  echo 'cadre: (JSON not re-checked: no jq or node)' >&2"

/** The argument check of the BE launcher: no argument, or --probe alone; else the usage line and exit 2. */
const BE_ARGS =
  `case $# in 0) ;; 1) [ "$1" = --probe ] || { echo 'cadre: usage: .cadre/bin/be [--probe]' >&2; exit 2; }; ` +
  "probe=1 ;; *) echo 'cadre: usage: .cadre/bin/be [--probe]' >&2; exit 2 ;; esac"

/** The first line of the --probe branch, right after the start line of every start (D-112). */
const PROBE_IF = 'if [ "$probe" = 1 ]; then'

/** The flags of the BE probe run: those of the exec line, with the name cadre-be-probe (Pitfall 1). */
const BE_PROBE_FLAGS = [
  '--setting-sources project',
  '--settings "$root"/.cadre/be/.runtime/settings.json',
  '--append-system-prompt-file "$root"/.cadre/be/ROLE.md',
  '--name cadre-be-probe',
  '--model opus',
  '--effort medium',
  '--permission-mode auto',
  '--add-dir "$root"/.cadre/be/.runtime/overlay',
  '--add-dir "$root"/.cadre/be',
  '--add-dir "$root"/.cadre/be/.runtime/private-instructions',
  '--mcp-config "$root"/.cadre/be/.runtime/mcp.json',
].join(' ')

/**
 * The probe run of the BE launcher (D-112, D-130): one print-mode turn with the scope flags, then for a here or dir
 * start the git root, `--` and a short prompt from /dev/null, never the kickoff; it keeps the init line of the output,
 * and claude's stderr reaches the terminal (#72 A1).
 */
function beProbeRun(rootDir: string): string {
  return (
    '  init=$(claude -p --max-turns 1 --output-format stream-json --verbose --no-session-persistence ' +
    `${BE_PROBE_FLAGS}${rootDir} -- 'Reply with OK.' </dev/null | grep '"subtype":"init"' | head -n 1) ` +
    '|| true'
  )
}

/**
 * The BE lines of the --probe branch after its run (D-130): the refusal of a run with no init line, the init fields
 * read with sed, the refusal of a list that holds a `\` or an odd number of `"` (#72 A1), the expectation lines read
 * with jq or else sed, one verdict line per expectation, the refusal of an init line that does not hold each list key
 * once (D1), the row count and the refusal of a file that gave no rule (A1), and the exit status.
 */
const VERDICT_LINES: readonly string[] = [
  `  [ -n "$init" ] || { echo 'cadre: the probe run gave no startup inventory' >&2; exit 1; }`,
  '  cadre_once() { case "$init" in *"\\"$1\\":["*"\\"$1\\":["*) return 1 ;; ' +
    '*"\\"$1\\":["*) return 0 ;; *) return 1 ;; esac; }',
  `  for k in tools skills slash_commands; do cadre_once "$k" || { echo 'cadre: the probe startup inventory does not ` +
    `hold one tools, skills and slash_commands list' >&2; exit 1; }; done`,
  `  cadre_list() { printf '%s' "$init" | sed -n "s/.*\\"$1\\":\\[\\([^]]*\\)\\].*/\\1/p"; }`,
  '  tools=$(cadre_list tools)',
  '  commands=$(cadre_list slash_commands)',
  '  skills=$(cadre_list skills)',
  '  cadre_closed() { case $1 in *\\\\*) return 1 ;; esac; ' +
    `[ -z "$(printf '%s' "$1" | tr -cd '"' | sed 's/""//g')" ]; }`,
  `  for l in "$tools" "$commands" "$skills"; do cadre_closed "$l" || { echo 'cadre: the probe startup inventory ` +
    `holds a name the launcher cannot read' >&2; exit 1; }; done`,
  `  mode=$(printf '%s' "$init" | sed -n 's/.*"permissionMode":"\\([^"]*\\)".*/\\1/p')`,
  `  memory=$(printf '%s' "$init" | sed -n 's/.*"memory_paths":{"auto":"\\([^"]*\\)".*/\\1/p')`,
  `  cadre_rules() { if command -v jq >/dev/null 2>&1; then jq -r '.rules[] | [.check, .enforcement, .text, ` +
    `.token] | join("|")' "$rt"/probe-expectations.json; else sed -n 's/^{"check":"\\([a-z-]*\\)","enforcement":` +
    `"\\([a-z-]*\\)","text":"\\([^"|]*\\)","token":"\\([^"|]*\\)"},\\{0,1\\}$/\\1|\\2|\\3|\\4/p' ` +
    `"$rt"/probe-expectations.json; fi; }`,
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
  `  [ "$n" -gt 0 ] || { echo 'cadre: .cadre/be/.runtime/probe-expectations.json gave no rule: run /cadre start be' ` +
    `>&2; exit 1; }`,
  '  exit "$bad"',
  'fi',
]

/**
 * The launcher of the BE role on the merged route that starts at the git root, line by line, with its final newline:
 * the guard (D-119), the role-file check (A7), the argument check (`--probe` or nothing), the claude version check
 * (D-107), the freshness check of the role and rendered files against the stamp (D-102, A2), the JSON check (D-107,
 * D-129), the start line, the --probe branch (D-112, D-130) and the exec line.
 */
const BE_LAUNCHER = [
  '#!/bin/sh',
  '# cadre launcher for role be: checks claude and .cadre/be/.runtime/, then starts the session.',
  '# /cadre start be renders .cadre/be/.runtime/ in the root session of the repo; this script never renders it.',
  'set -eu',
  ROOT_LINE,
  BE_GUARD,
  BE_FILES_CHECK,
  'rt="$root"/.cadre/be/.runtime',
  BE_KICKOFF_LINE,
  'probe=0',
  BE_ARGS,
  'cadre_claude_ok() {',
  "  set -- $(claude --version 2>/dev/null | sed -n " +
    "'s/^\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\).*/\\1 \\2 \\3/p')",
  '  [ $# -eq 3 ] || return 1',
  '  [ "$1" -gt 2 ] || { [ "$1" -eq 2 ] && { [ "$2" -gt 1 ] || { [ "$2" -eq 1 ] && [ "$3" -ge 295 ]; }; }; }',
  '}',
  VERSION_REFUSAL,
  BE_STAMP_CHECK,
  'for f in "$root"/.cadre/cadre.json "$root"/.cadre/be/role.json "$root"/.cadre/be/settings.json ' +
    '"$root"/.cadre/be/mcp.json "$rt"/settings.json "$rt"/mcp.json "$rt"/probe-expectations.json; do',
  `  if [ "$f" -nt "$rt"/stamp ]; then echo 'cadre: .cadre/be/.runtime/ is older than the role files: ` +
    `run /cadre start be' >&2; exit 1; fi`,
  'done',
  `[ -s "$rt"/settings.json ] && [ -s "$rt"/mcp.json ] || { echo 'cadre: .cadre/be/.runtime/settings.json or ` +
    `mcp.json is missing or empty: run /cadre start be' >&2; exit 1; }`,
  'if command -v jq >/dev/null 2>&1; then',
  `  jq empty "$rt"/settings.json "$rt"/mcp.json >/dev/null 2>&1 || { echo 'cadre: .cadre/be/.runtime/ holds a ` +
    `file that is not valid JSON: run /cadre start be' >&2; exit 1; }`,
  'elif command -v node >/dev/null 2>&1; then',
  `  node -e 'for (const f of process.argv.slice(1)) JSON.parse(require("fs").readFileSync(f, "utf8"))' ` +
    `"$rt"/settings.json "$rt"/mcp.json >/dev/null 2>&1 || { echo 'cadre: .cadre/be/.runtime/ holds a file ` +
    `that is not valid JSON: run /cadre start be' >&2; exit 1; }`,
  'else',
  NO_JSON_CHECKER,
  'fi',
  'cd -- "$root"',
  PROBE_IF,
  `  [ -s "$rt"/probe-expectations.json ] || { echo 'cadre: .cadre/be/.runtime/probe-expectations.json is missing: ` +
    `run /cadre start be' >&2; exit 1; }`,
  beProbeRun(''),
  ...VERDICT_LINES,
  `exec env CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude ${BE_FLAGS} -- "$(cat "$kick")"`,
  '',
].join('\n')

/**
 * A single-quoted span, line breaks included, or a `\'` outside one, read left to right as a shell reads them: what the
 * hostile-id tests remove from launcher lines, so what is left is all the shell runs or expands.
 */
const QUOTED = /'[^']*'|\\'/g

/** Words a shell would treat as more than one word, a command or a substitution if they were left bare. */
const HOSTILE_WORDS: readonly string[] = [
  '',
  'a b',
  "it's",
  "'",
  "''",
  '$(x)',
  '${HOME}',
  '$HOME',
  '`x`',
  'a;b',
  'a|b',
  'a&b',
  'a>b',
  'a<b',
  'a\nb',
  'a"b',
  'a\\b',
  '*',
  '~',
  '#x',
  '!x',
  '{a,b}',
  '--flag=value with space',
  `caf${String.fromCodePoint(0xe9)}`,
]

describe('launcher', () => {
  test('shQuote leaves a plain word bare and single-quotes any other, writing a quote as four characters', () => {
    expect(shQuote('cadre-be')).toBe('cadre-be')
    expect(shQuote('.cadre/be/.runtime/settings.json')).toBe('.cadre/be/.runtime/settings.json')
    expect(shQuote('a b')).toBe("'a b'")
    expect(shQuote("it's")).toBe("'it'\\''s'")
    expect(shQuote('$(x)')).toBe("'$(x)'")
    expect(shQuote('')).toBe("''")
  })

  test('a shell reads shQuote of any hostile word back as that one word', () => {
    for (const word of HOSTILE_WORDS) {
      expect(shellWords(shQuote(word))).toEqual([word])
    }
  })

  test('the shell reader refuses a bare metacharacter, so it can fail the launcher tests', () => {
    expect(isRefused('a;b')).toBe(true)
    expect(isRefused('$(x)')).toBe(true)
    expect(isRefused("'open")).toBe(true)
    expect(isRefused('"$(cat x"')).toBe(true)
    expect(isRefused("a 'b c' d\\'e \"f g\"")).toBe(false)
    expect(shellWords("a 'b c' d\\'e \"f g\"")).toEqual(['a', 'b c', "d'e", 'f g'])
    expect(shellWords('"$root"/\'a b\' "$(cat "$root"/\'x)y\')"')).toEqual(["$root/a b", '$(cat "$root"/\'x)y\')'])
  })

  test('the git-root BE launcher checks its repo, claude and the rendered files, then execs claude at the top', () => {
    const be = templateRole('be')
    const text = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'git-root' })

    expect(text).toBe(BE_LAUNCHER)
    expect(execWords(text)).toEqual([
      ...EXEC_PREFIX,
      ...shellWords(BE_FLAGS),
      '--',
      '$(cat "$kick")',
    ])
  })

  test(
    'the guard, the role-file check, the version refusal, the stamp check and the no-checker line are there once each',
    () => {
      const be = templateRole('be')
      const lines = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'git-root' }).split('\n')

      for (const line of [BE_GUARD, BE_FILES_CHECK, VERSION_REFUSAL, BE_STAMP_CHECK, NO_JSON_CHECKER]) {
        expect(lines.filter(candidate => candidate === line)).toHaveLength(1)
      }
    },
  )

  test('the here launcher starts in the folder it is run from, with no cd line, and adds the git root (D-127)', () => {
    const be = templateRole('be')
    const text = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'here' })

    expect(text.split('\n').filter(line => line.startsWith('cd '))).toEqual([])
    expect(execWords(text).slice(-4)).toEqual(['--add-dir', '$root', '--', '$(cat "$kick")'])
  })

  test('the dir launcher goes to its folder, the path shell-quoted, and adds the git root (D-127)', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', [be])
    const text = launcherText(be, scope, { kind: 'dir', path: 'apps/web' })

    expect(text.split('\n')).toContain('cd -- "$root"/apps/web')
    expect(execWords(text).slice(-4)).toEqual(['--add-dir', '$root', '--', '$(cat "$kick")'])
    expect(launcherText(be, scope, { kind: 'dir', path: "a b/it's" }).split('\n')).toContain(
      `cd -- "$root"/'a b/it'\\''s'`,
    )
  })

  test('the git-root launcher adds no directory beyond the scope flags: it starts at the root (D-127)', () => {
    const be = templateRole('be')
    const words = execWords(launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'git-root' }))

    expect(words).not.toContain('$root')
    expect(words.slice(-3)).toEqual(['$root/.cadre/be/.runtime/mcp.json', '--', '$(cat "$kick")'])
  })

  test('in every start the exec line is the only one that starts with exec, after every check of the launcher', () => {
    const be = templateRole('be')
    const startLines = { 'git-root': 'cd -- "$root"', here: BE_HERE_CHECK, dir: 'cd -- "$root"/apps/web' }
    for (const start of LAUNCH_STARTS) {
      const lines = launcherText(be, scopeOf(be, 'gsd', [be]), start).split('\n')
      const execAt = lines.findIndex(line => line.startsWith('exec '))
      const refusals = lines.flatMap((line, index) => (/exit [12]\b/.test(line) ? [index] : []))

      expect(lines.filter(line => line.startsWith('exec '))).toHaveLength(1)
      expect(refusals).toHaveLength(start.kind === 'here' ? 15 : 14)
      expect(refusals.every(index => index < execAt)).toBe(true)
      expect(lines.slice(lines.indexOf('fi') + 1, lines.indexOf(PROBE_IF))).toEqual([startLines[start.kind]])
      expect(lines[execAt - 1]).toBe('fi')
    }
  })

  test(
    'the --probe branch refuses unless each list key is on the init line once, ' +
      'and refuses a file that gave no rule (D1, A1)',
    () => {
      const pm = templateRole('pm')
      for (const start of LAUNCH_STARTS) {
        const lines = launcherText(pm, scopeOf(pm, 'gsd', [pm]), start).split('\n')
        const noInit = lines.indexOf(VERDICT_LINES[0] ?? '')

        expect(noInit).toBeGreaterThan(0)
        expect(lines.slice(noInit, noInit + 3)).toEqual(VERDICT_LINES.slice(0, 3))
        expect(lines[lines.indexOf('  exit "$bad"') - 1]).toBe(
          `  [ "$n" -gt 0 ] || { echo 'cadre: .cadre/pm/.runtime/probe-expectations.json gave no rule: ` +
            `run /cadre start pm' >&2; exit 1; }`,
        )
      }
    },
  )

  test(
    'the --probe branch refuses a list its sed read cannot take whole, right after the three reads, ' +
      'and the probe run keeps its stderr (#72 A1)',
    () => {
      const be = templateRole('be')
      const closed = VERDICT_LINES.indexOf('  skills=$(cadre_list skills)') + 1
      for (const start of LAUNCH_STARTS) {
        const lines = launcherText(be, scopeOf(be, 'gsd', [be]), start).split('\n')
        const skillsAt = lines.indexOf('  skills=$(cadre_list skills)')

        expect(closed).toBeGreaterThan(0)
        expect(skillsAt).toBeGreaterThan(0)
        expect(lines.slice(skillsAt + 1, skillsAt + 3)).toEqual(VERDICT_LINES.slice(closed, closed + 2))
        expect(lines.filter(line => line.startsWith('  init=$(claude ') && line.includes('2>/dev/null'))).toEqual([])
      }
    },
  )

  test('the --probe run of every start has the scope flags named cadre-be-probe and a short prompt, no kickoff', () => {
    const be = templateRole('be')
    for (const start of LAUNCH_STARTS) {
      const lines = launcherText(be, scopeOf(be, 'gsd', [be]), start).split('\n')
      const runs = lines.filter(line => line.startsWith('  init=$(claude '))

      expect(runs).toEqual([beProbeRun(start.kind === 'git-root' ? '' : ' --add-dir "$root"')])
      expect(runs.filter(line => line.includes('kickoff.txt'))).toEqual([])
      expect(runs.filter(line => line.includes(`-- 'Reply with OK.' </dev/null`))).toHaveLength(1)
      expect(lines[lines.indexOf(PROBE_IF) + 2]).toBe(runs[0])
    }
  })

  test('every launcher refuses a missing ROLE.md or kickoff.txt right after the guard (A7)', () => {
    const be = templateRole('be')
    for (const start of LAUNCH_STARTS) {
      const lines = launcherText(be, scopeOf(be, 'gsd', [be]), start).split('\n')

      expect(lines[lines.indexOf(BE_GUARD) + 1]).toBe(BE_FILES_CHECK)
    }
  })

  test('every launcher starts with the epic kickoff in .runtime when it is there, else its own (D-158)', () => {
    for (const start of LAUNCH_STARTS) {
      for (const role of TEMPLATE_ROLES) {
        const text = launcherText(role, scopeOf(role, 'gsd', TEMPLATE_ROLES), start)
        const lines = text.split('\n')
        const own = `"$root"/.cadre/${role.id}/kickoff.txt`

        expect(lines[lines.findIndex(line => line.startsWith('rt=')) + 1]).toBe(
          `if [ -f "$rt"/kickoff.txt ]; then kick="$rt"/kickoff.txt; else kick=${own}; fi`,
        )
        expect(text.endsWith(' -- "$(cat "$kick")"\n')).toBe(true)
      }
    }
  })

  test('hasRuntimeKickoff tells a launcher that reads the epic kickoff from one written before it (D-158)', () => {
    const be = templateRole('be')
    const text = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'git-root' })
    const older = text.replace(`${BE_KICKOFF_LINE}\n`, '')

    expect(hasRuntimeKickoff(text)).toBe(true)
    expect(older).not.toBe(text)
    expect(hasRuntimeKickoff(older)).toBe(false)
  })

  test(
    'only the here launcher checks that it is run from a folder of its repo, right before its --probe branch (A3)',
    () => {
      const be = templateRole('be')
      const here = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'here' }).split('\n')
      for (const start of LAUNCH_STARTS) {
        const lines = launcherText(be, scopeOf(be, 'gsd', [be]), start).split('\n')

        expect(lines.filter(line => line.startsWith('case '))).toEqual(
          start.kind === 'here' ? [BE_ARGS, BE_HERE_CHECK] : [BE_ARGS],
        )
      }

      expect(here[here.indexOf(BE_HERE_CHECK) + 1]).toBe(PROBE_IF)
    },
  )

  test(
    'the freshness loop also compares the rendered settings.json and mcp.json with the stamp, never the inbox (A2)',
    () => {
      const be = templateRole('be')
      const lines = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'git-root' }).split('\n')
      const loop = lines.find(line => line.startsWith('for f in ')) ?? ''

      expect(loop.endsWith('"$rt"/settings.json "$rt"/mcp.json "$rt"/probe-expectations.json; do')).toBe(true)
      expect(loop).not.toContain('inbox')
    },
  )

  test('in every mode the words are claude, the anchored flags, the root for a sub-folder, -- and the kickoff', () => {
    for (const start of LAUNCH_STARTS) {
      for (const framework of FRAMEWORKS) {
        for (const role of TEMPLATE_ROLES) {
          const scope = scopeOf(role, framework, TEMPLATE_ROLES)
          const rootDir = start.kind === 'git-root' ? [] : ['--add-dir', '$root']

          expect(execWords(launcherText(role, scope, start))).toEqual([
            ...EXEC_PREFIX,
            ...anchoredFlags(scope.flags),
            ...rootDir,
            '--',
            '$(cat "$kick")',
          ])
        }
      }
    }
  })

  test('the value of each path flag is one word at the repo root, and no other flag word is anchored', () => {
    const be = templateRole('be')
    const words = execWords(launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'here' }))

    expect(words.filter(word => word.startsWith('$root/'))).toEqual([
      '$root/.cadre/be/.runtime/settings.json',
      '$root/.cadre/be/ROLE.md',
      '$root/.cadre/be/.runtime/overlay',
      '$root/.cadre/be',
      '$root/.cadre/be/.runtime/private-instructions',
      '$root/.cadre/be/.runtime/mcp.json',
    ])
  })

  test('only the exec line sets CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1, through env, for claude', () => {
    const be = templateRole('be')
    for (const start of LAUNCH_STARTS) {
      const lines = launcherText(be, scopeOf(be, 'gsd', [be]), start).split('\n')
      const setting = lines.filter(line => line.includes('CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD'))

      expect(setting).toEqual([lines.find(line => line.startsWith('exec ')) ?? 'no exec line'])
      expect(execWords(lines.join('\n')).slice(0, 4)).toEqual(EXEC_PREFIX)
    }
  })

  test('on the strict MCP route the last flag word is --strict-mcp-config, before the --', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', [be], { mcpRoute: 'strict' })
    const words = execWords(launcherText(be, scope, { kind: 'git-root' }))

    expect(words.slice(-3)).toEqual(['--strict-mcp-config', '--', '$(cat "$kick")'])
  })

  test('a flag that holds a space, a quote or a dollar stays one word, anchored or not', () => {
    const be = templateRole('be')
    const scope = scopeOf(be, 'gsd', [be])
    const hostileWord = "x y'$(z);`"
    const flags = [...scope.flags, '--add-dir', hostileWord, '--name', hostileWord]
    const hostile: CompiledScope = { ...scope, flags }

    expect(execWords(launcherText(be, hostile, { kind: 'git-root' }))).toEqual([
      ...EXEC_PREFIX,
      ...anchoredFlags(scope.flags),
      '--add-dir',
      `$root/${hostileWord}`,
      '--name',
      hostileWord,
      '--',
      '$(cat "$kick")',
    ])
  })

  test('a role id with a space, a quote or a dollar cannot add a command', () => {
    const id = "x y'$(z);`"
    const role = templateRole('be', { id })
    const kickoffPath = `.cadre/${id}/kickoff.txt`
    for (const start of LAUNCH_STARTS) {
      const text = launcherText(role, scopeOf(role, 'gsd', [role]), start)
      const lines = text.split('\n')
      const unquoted = lines.slice(3).map(line => line.replace(QUOTED, ''))

      expect(lines.slice(0, 3).map(line => line.charAt(0))).toEqual(['#', '#', '#'])
      expect(unquoted.filter(line => line.includes('$(z)') || line.includes('`'))).toEqual([])
      expect(execWords(text).slice(-2)).toEqual(['--', '$(cat "$kick")'])
      expect(lines).toContain(`${RUNTIME_KICKOFF_TEST}"$root"/${shQuote(kickoffPath)}; fi`)
    }
  })

  test('a role id with a line break cannot leave the comment lines or the quotes', () => {
    const id = 'x\nrm -rf ~'
    const role = templateRole('be', { id })
    const text = launcherText(role, scopeOf(role, 'gsd', [role]), { kind: 'git-root' })
    const lines = text.split('\n')
    const shellLines = lines.slice(3).join('\n').replace(QUOTED, '').split('\n')

    expect(lines.slice(1, 3)).toEqual([
      '# cadre launcher for role xrm -rf ~: checks claude and .cadre/xrm -rf ~/.runtime/, then starts the session.',
      '# /cadre start xrm -rf ~ renders .cadre/xrm -rf ~/.runtime/ in the root session of the repo; ' +
        'this script never renders it.',
    ])
    expect(shellLines.filter(line => line.startsWith('rm '))).toEqual([])
    expect(execWords(text)).toContain(`$root/.cadre/${id}/.runtime/settings.json`)
  })

  test('a title never reaches the launcher', () => {
    const be = templateRole('be', { title: '$(evil) `x`; rm -rf ~' })
    const text = launcherText(be, scopeOf(be, 'gsd', [be]), { kind: 'git-root' })

    expect(text).not.toContain('evil')
    expect(text).not.toContain('rm -rf')
  })

  test('the launcher holds no absolute user path and no variable reference, whatever role, framework and start', () => {
    const problems: string[] = []
    for (const start of LAUNCH_STARTS) {
      for (const framework of FRAMEWORKS) {
        for (const role of TEMPLATE_ROLES) {
          const text = launcherText(role, scopeOf(role, framework, TEMPLATE_ROLES), start)
          const found = leaks(text, [...ABSOLUTE_PATH_MARKERS, '${'])
          problems.push(...found.map(needle => `${start.kind} / ${framework} / ${role.id}: ${needle}`))
        }
      }
    }

    expect(problems).toEqual([])
  })

  test('desiredFiles writes the launcher with the launch start of the repo state (A2)', () => {
    const be = templateRole('be')
    const input = inputOf([be], 'gsd')
    const start: LaunchStart = { kind: 'dir', path: 'apps/web' }
    const files = desiredFiles({ ...input, state: { ...input.state, launchStart: start } })
    const launcher = contentOf(files, '.cadre/bin/be') ?? ''

    expect(launcher).toBe(launcherText(be, scopeOf(be, 'gsd', [be]), start))
    expect(launcher.split('\n')).toContain('cd -- "$root"/apps/web')
  })
})
