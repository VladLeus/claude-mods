/**
 * The on-disk, shell and protocol markers (D-221), a layer 0 leaf: text cadre writes into files it reads back, the
 * shell and AppleScript lines its launchers run, the tokens it reads in autopilot's log and the probe texts of a
 * role's probe file. They are never translated: a byte change would lose a block cadre wrote before, break a launcher
 * or misread a log. Templates with `{name}` slots are filled through locales/t `fill`, after the call site cleaned
 * each value (D-222). It imports nothing; any module may import it.
 */

/** Every marker and template by its name (D-221). Object.freeze keeps each literal type, so slots are typed. */
export const CONTRACTS = Object.freeze({
  // The begin and end markers of cadre's block in a role's MEMORY.md (D-140 q3-a), as IGNORE_BEGIN and IGNORE_END.
  memoryBlockBegin: '<!-- >>> cadre linked memories (read-only; rebuilt by /cadre start) -->',
  memoryBlockEnd: '<!-- <<< cadre linked memories -->',
  // One linked memory in that block: a link to its file and its summary.
  memoryBlockLine: '- [{file}]({file}) — {summary}',
  // The stamp a render writes last: the cadre version that rendered, on one line.
  stamp: 'rendered by cadre {version}\n',
  // What a tmux window runs after a launcher that exits non-zero (RESEARCH Pitfall 7).
  tmuxWait: "{ printf '%s\\n' 'cadre: the launcher stopped; press Enter to close this window'; read -r _; }",
  // The starts of the autopilot log lines status reads: a run ended, ended done, started, stopped by the person.
  autopilotFinished: 'finished (',
  autopilotFinishedDone: 'finished (done)',
  autopilotStarted: 'started: ',
  autopilotStopped: 'stopped by the person',
  // The probe texts of a role's probe file: plain ASCII lines with no | and no \ (probe/probe).
  probeUnusual: ' (not checked: unusual characters)',
  probeToolAbsent: 'tool {token} absent',
  probeToolsAbsent: 'tools of {token} absent',
  probeToolPresent: 'tool {token} present',
  probeCommandPresent: 'command {token} present',
  probeSkillPresent: 'skill {token} present',
  probePermissionMode: 'permission mode {token}',
  probeChecked: '{text} [{label}]',
  probeMemoryFolder: 'Memory folder: {dir} (autoMemoryDirectory)',
  // The begin and end markers of the cadre block in the root `.gitignore` (D-64).
  ignoreBegin: '# >>> cadre',
  ignoreEnd: '# <<< cadre',
  // How a part with no heading is named: the text before the first heading of its file (G-02-1f).
  topOfFile: '(top of file)',
  // The line that starts cadre's own lines in a worktree's excludes file, and the line that hides each role's own
  // `.runtime/` there (AUTO-PICK #25, RESEARCH Pitfall 5).
  excludesHeading: '# cadre links (cadre epic)',
  runtimeExcludeLine: '/.cadre/*/.runtime/',
}) satisfies Record<string, string>

/**
 * The AppleScript lines that open a new Terminal window running the shell text, the last argv item, which `do script`
 * reads through `on run argv` (D-126). Terminal.app cannot make a tab without System Events, so it is a window.
 */
export const TERMINAL_APP_LINES: readonly string[] = Object.freeze([
  'on run argv',
  'tell application "Terminal"',
  'activate',
  'do script (item 1 of argv)',
  'end tell',
  'end run',
])

/**
 * The AppleScript lines that open a new iTerm tab in the current window, or a new window when none is open, and write
 * the shell text, the last argv item, into its session through `on run argv` (D-126).
 */
export const ITERM_LINES: readonly string[] = Object.freeze([
  'on run argv',
  'tell application "iTerm"',
  'activate',
  'if (count of windows) is 0 then',
  'create window with default profile',
  'else',
  'tell current window to create tab with default profile',
  'end if',
  'tell current session of current window to write text (item 1 of argv)',
  'end tell',
  'end run',
])

/**
 * The rule autopilot uses to spot its done marker (isDoneAnswer in autopilot/hooks/autopilot.ts): AUTOPILOT_DONE at
 * the start of a line, after optional spaces or tabs. Tests use it to prove that no kickoff line other than the done
 * line reads as the marker.
 */
export const DONE_MARKER_LINE = /^[ \t]*AUTOPILOT_DONE\b/m
