# e2e

End-to-end tests for the mods in this repo. `e2e/lib/` is a mod-agnostic driver (tmux, claude, scratch folders,
fixtures, cassettes, filter, results); each suite lives in `e2e/<mod>/` with its own `rows.ts` registry. The cadre
suite in `e2e/cadre/` automates the UAT rows of phases 03, 03.1 and 03.2 tagged `cut: scripted`; each test is named
`<phase>#<row> <title>`.

## Tiers

- `npm run e2e` runs the offline tier: the unit specs `e2e/lib/*.test.ts`, every `e2e/*/rows.test.ts` and the offline
  rows. It needs no claude login, makes no model call and starts no tmux. This is the only tier CI runs, and CI holds
  no credential and no cassette.
- `npm run e2e:live` runs the live tier: real claude sessions inside private tmux servers
  (`tmux -L e2e-<run>-...`, never the default server), one scratch copy of a fixture repo per test. It refuses to
  start when `CI` is set.
- `npm run typecheck:e2e` type-checks every e2e file strictly (`e2e/tsconfig.strict.json`).

Both tiers need Node 24 or newer (type stripping). The live tier assumes macOS (the clipboard rows use `pbcopy` and
`pbpaste`, and fixture copies use `cp -c`) and needs `tmux` and `claude` on PATH.

## The e2e login

Every live claude child runs with `CLAUDE_CONFIG_DIR` set to one reusable e2e config dir,
`~/.cache/claude-mods-e2e/config` (env `E2E_CONFIG_DIR` overrides it). Log into it once, in a normal terminal:

```sh
CLAUDE_CONFIG_DIR=~/.cache/claude-mods-e2e/config claude auth login
```

- The dir is used in place. The harness never reads, copies, prints or writes a credential: no credentials file, no
  token in an env var, no copy of the login. claude reads its own keychain item and keeps the login fresh itself.
- When the login cannot be refreshed, the preflight stops with `log in again: CLAUDE_CONFIG_DIR=<dir> claude auth
  login` and a reason (`not logged in`, `login expires soon` when the login ends within 3 hours, `model call failed`).
- `error: auth lost mid-run` means a session showed the login screen during a row: log in again and rerun.
- One live run at a time holds the dir through the lock `<dir>.lock`.
- The dir's `projects/` grows with the transcripts of scratch sessions. Empty it whenever you like, but only between
  runs: its transcript names are how a run recognises leftover test sessions.
- Concurrent rows let claude write the dir's `.claude.json` in parallel. A lost entry there is fixed by logging in
  again.

## What a live run touches on the real HOME

Live claude children run with the real HOME and USER, since claude finds the dir's keychain login only with both.
So:

- autopilot and agent-fleet write one file per test session under the real `~/.claude/autopilot/` and
  `~/.claude/fleet/`. The runner deletes exactly those files after the run (and, after a killed run, at the start of
  the next one); it never touches autopilot's `global.json` or another session's file. Test sessions may show in
  your fleet pane while a run is going.
- claude writes MCP server logs under `~/Library/Caches/claude-cli-nodejs/`, and npm and npx read `~/.npmrc`.
- A run refuses to start while a global autopilot away is on (`global away is on`): run `/back --global` first.
- Every claude found through PATH passes the claude fence first, which refuses (exit 97, logged) any claude call
  whose `CLAUDE_CONFIG_DIR` is not the e2e dir. Every row shim named `claude` execs that fence, never the real binary.
- The harness makes one keychain call: the guard's names-only listing (`security dump-keychain` without `-d`),
  reduced in memory to a count and a hash of the service names starting with `Claude Code`, or none when that check
  was dropped.
- The guard reads the real `~/.claude.json` and plugin files into memory only to search them for the suite's fixed
  needles and markers; it never stores, prints or parses their values.

## Exclusive rows

Rows that install plugins or marketplaces, or stage a user-level GSD, are `exclusive` in the registry: 03#61, 03#80,
03#82, 03#83 with 03#87, 03.2#3 and 03.2#30 (and the `v050` fixture builder). Each runs alone, after the parallel
rows, between a snapshot and a restore of the e2e dir's non-credential plugin state (`plugins/`, `settings.json`,
`gsd-core`). The summary lists `e2e dir state restored after <file>` for each; a failed restore prints `e2e dir state
not restored after <file>: <reason>` and fails the run. Rows that start a real role session carry `roleSession` and
run one at a time per role.

## The guard

After a run the guard compares the real `~/.claude` with its snapshot.

- A failure (exit 3) is a change traceable to the suite: a new real `projects/` entry or a `~/.claude.json` / guarded
  file entry naming the scratch base or the e2e dir; a suite plugin marker (`claude-plugins-official`,
  `claude-security@`, `security-guidance@`, `local-mods`, `cadre@local-mods`) newly in a real plugin file
  (`settings.json`, `plugins/known_marketplaces.json`, `plugins/installed_plugins.json`); a leftover test-session file
  under `autopilot/` or `fleet/`; or any refusal by the claude fence.
- A warning is any other change there: `~/.claude.json` and `plugins/` mtimes, unrelated new `projects/` entries,
  `~/.claude/cache`, top-level entries, the keychain digest. It is usually your own or the driving session's work, so
  other claude sessions may keep working during a run.

## Running

```sh
npm run e2e                                         # offline tier
npm run e2e:live -- --rows 03#33,03#70              # some live rows
npm run e2e:live -- --rows 03#64 --allow-product-fail
E2E_RECORD=all npm run e2e:live -- --publish .planning/phases/03.2-conveyor-and-framework-choice
```

A live run with fixture builds takes longer than a 10-minute tool limit. Run it in the background and read the
result from a log outside the repo: `{ npm run e2e:live -- <flags>; } > <log> 2>&1; echo "exit=$?" >> <log>`. The
last stdout line is `e2e: run <run> exit <code> summary e2e/results/<run>/SUMMARY.md`.

Flags (`node e2e/run.ts`):

- `--tier offline|live` (required, set by the npm scripts).
- `--rows <id,...>`: ids such as `03#45` or `03.2#15c`; `03#68` selects both halves. The offline unit specs always run.
- `--build <variant,...>`: live only; also build these fixture variants. With no `--rows` it builds and runs no row.
- `--allow-product-fail`: exit 0 when rows end `fail` but none ends `error`.
- `--publish <dir>`: copy the summary to `<dir>/<suite>-E2E-SUMMARY-<run>.md`.
- `--leak-check <file,...>`: check files for leaks (home paths, user and host names, emails, uuids, `sk-ant-`
  tokens, env secret values and the e2e login's identity values); prints file and line of a residue, never the value;
  exits 1 on a residue, 2 when the identity values cannot be read. Run it on every notes file and summary before a
  commit. `--generic-only` skips the identity values; it is allowed only before any live output exists and in CI.

Env: `E2E_RECORD` (`once` default, `none`, `all`), `E2E_KEEP=1` (keep the scratch root), `E2E_CONCURRENCY` (live
rows in parallel, default 2), `E2E_CONFIG_DIR` (the e2e login dir).

Exit codes: 0 ok; 1 a row ended `error` (or `fail` without `--allow-product-fail`), a fixture build, restore or
session-file removal failed, or a summary failed its leak check; 2 a preflight refusal (CI, login, lock, global away);
3 a guard failure.

## Verdicts, results, cassettes

Each row ends `pass`, `fail`, `recorded`, `skipped` or `error` (a harness fault, never a product verdict). Results go
to the git-ignored `e2e/results/<run>/`: one `<phase#row>.md` with a JSON sidecar per row and a `SUMMARY.md`. Every
result doc, cassette and summary passes a filter and a fail-closed leak check before it is written.

The 18 live rows with a recorded part replay from a cassette under the git-ignored `e2e/cassettes/` while its key is
unchanged: the claude version, the hashes of the row's declared cadre inputs and the test file (plus a 7-day limit
for the networked rows). A replay restores the whole row without starting claude. `E2E_RECORD=once` replays or
records, `none` only replays, `all` always records. The published verdicts come from a full re-record
(`E2E_RECORD=all`), so no published row is a replay.

## Adding a suite

Add `e2e/<mod>/rows.ts` exporting a `ROWS` registry (id, title, tier, fixture variants, kind, file, and the optional
`exclusive`, `roleSession`, `clipboard`, `cassette` and `partial`), a `rows.test.ts` that checks it, and the tests
under `e2e/<mod>/offline/` and `e2e/<mod>/live/` built on `rowTest` from `e2e/lib/row.ts`. `run.ts` discovers every
`e2e/*/rows.ts`.
