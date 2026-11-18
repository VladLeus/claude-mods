# claude-mods

Three Claude Code mods (plugins of function hooks) in one local marketplace, `local-mods`:

| Mod | Command | What it does |
|---|---|---|
| `agent-fleet` | `/fleet` | A pane with every running session that has the mod: context fill, working/idle, subagents and workflow agents, who messages whom, cost, and an autopilot badge. `/fleet` toggles it. |
| `autopilot` | `/autopilot`, `/away`, `/back`, `/ask-user` | Runs a session on its own for a set time with a fixed role. At a context threshold it writes a handoff, clears itself and resumes from the handoff, instead of auto-compacting. Respects the permission mode, defers blocked actions, watches token limits, works with `/goal`. With asking on (`--ask-user` or `/ask-user on`), while you are away it queues its critical questions and asks them one by one when you are back. |
| `cadre` | `/cadre detect`, `/cadre init`, `/cadre regen`, `/cadre frameworks`, `/cadre start`, `/cadre status`, `/cadre epic` | Splits a repo into narrow-scope role sessions: detect shows which dev framework the repo uses; init scans the repo and your setup (names only), proposes roles, shows each scope card and the exact file plan, and writes it after you confirm; regen re-renders one role; frameworks asks init's framework questions again and re-renders the role files; start renders a role's per-launch files and hands you its launcher; status reads from disk whether a role's autopilot run is done; epic opens an epic's roles in their own git worktree. |

Function-hook mods are early access: you need a recent Claude Code (built and tested on 2.1.295).

## Install

### Just use them

Install a signed release tag, not `main`: pick the latest tag from the [releases](https://github.com/VladLeus/claude-mods/releases) and put it after `#`.

```bash
claude plugin marketplace add VladLeus/claude-mods#v0.5.0
claude plugin install autopilot@local-mods
claude plugin install agent-fleet@local-mods
```

Restart Claude Code. The marketplace stays on that tag, and third-party marketplaces do not auto-update unless you turn it on in `/plugin` → Marketplaces. To move to a newer release, check its notes and diff first, then remove the marketplace and add it again with the new tag.

### Develop them (clone + local marketplace)

This mode is for developing the mods, not for everyday use. The marketplace is read live from your clone, so **any commit you pull or check out runs with full access to your machine on the next reload**. Review untrusted PRs in a separate worktree or clone that no marketplace points at. Never run `claude plugin test` (or reload plugins) on an untrusted PR checkout locally: spec files and hooks are code that runs with your full user access, so let the `specs` CI run them.

```bash
git clone https://github.com/VladLeus/claude-mods.git ~/code/claude-mods
claude plugin marketplace add ~/code/claude-mods
claude plugin install autopilot@local-mods --scope user
claude plugin install agent-fleet@local-mods --scope user
claude plugin install cadre@local-mods --scope user
```

A marketplace added from a folder is read from that folder: edit the files, then run `/reload-plugins` in a session.

### Skills autopilot needs

Autopilot hands off with two skills. Copy them unless you already have skills with these names:

```bash
cp -R extras/skills/create-handoff-doc extras/skills/resume-handoff-doc ~/.claude/skills/
```

Handoffs are written to `thoughts/shared/handoffs/` of the project.

## autopilot

```
/autopilot <time> <threshold%> [max restarts] "<role>" [--goal "<condition>"] [--5h 95] [--week 80] [--ask-user]
/autopilot until <clock> <threshold%> [max restarts] "<role>" [flags]   # same start, ending at a local time
/autopilot                 # status
/autopilot extend [<time>] [--restarts N]   # add time and/or restarts
/autopilot shorten [<time>] [--restarts N]  # take time and/or restarts off
/autopilot until HH:MM     # end at a local time
/autopilot 0 0 stop        # hand the wheel back (also clears the goal); /autopilot stop works too
```

`/ap` runs the same command with the same arguments: Claude Code reserves the name `autopilot` for a built-in command, so `/ap` keeps working if it ever takes that name over.

`extend`, `shorten` and `until` only work when you type them (in the prompt or over Remote Control), never from the session itself. Give a time, `--restarts N` (1–99), or both. With a limited run, `--restarts` raises or lowers the max restarts by N (lowering never goes below the restarts already used). With an unlimited run, `extend --restarts N` allows N more restarts from now, and `shorten --restarts` is ignored (the reply says so).

A run that ended on time is brought back by extending its time. A run that ended on restarts is brought back by raising the limit while there is time left. Anything else (goal met, weekly limit, work complete) is not revived. The change is refused when the new end would be in the past, less than 1 minute ahead, or more than 7 days ahead.

A run that finished on time or on restarts is kept for 15 minutes. In that time `/autopilot` says so, and `extend`, `shorten --restarts` or `until` bring it back: the session clears and resumes from the handoff it already wrote, through a restart that is not counted against the restarts. If the session does not restart after being asked once more, the run pauses and says so; the handoff it restarts from must be newer than the moment the run began finishing. After a goal, the weekly limit or a work-complete finish, or after `/autopilot 0 0 stop`, nothing is kept. `<clock>` (for `until`, as a start and as a change) is 24-hour `18:30` or `7:30`, or 12-hour with am/pm and no space, any case: `6pm`, `6:30pm`, `12am` (midnight), `12pm` (noon). It is the next time the local clock reads that, always under 24 hours ahead. `until <clock>` alone changes the end of the running session; followed by a threshold and role it starts a run. `until` needs the machine's time zone; when it cannot be read, use `extend` or `shorten`.

Example, a night run:

```
/autopilot 10h 65 "You are the docs writer, responsible for … Use /explore for the map." --goal "issue #42 is closed and its docs are merged" --5h 95 --week 80
```

- **time**: `90m`, `2h`, `1h30m`, or minutes.
- **threshold**: the context % at which it hands off and restarts. Under 50%, every handoff after the first fires 10 points later (a resume alone loads ~5–15%). It never waits past **auto-compact minus 10 points**; a higher value is lowered to that ceiling and the command says so. The ceiling depends on `autoCompactWindow` in `~/.claude/settings.json` (800000 on a 1M window gives ~66%). Raise that setting to allow a higher threshold.
- **max restarts**: leave out for as many as the time allows.
- **role**: who the session is and what it is responsible for. It is pinned in the system prompt, survives `/clear`, and goes into every handoff with the session's `/rename` name and `/color` (the color is set again after each `/clear`). `/skills` named in the role are recognised and announced to the model as skills.
- **--goal**: a `/goal` completion condition, set again after every `/clear`. When the evaluator marks it met, autopilot asks for a final handoff and stops. Phrase it in terms of files or repo state, not "in the chat": after `/clear` the chat is empty.
- **--5h**: at this % of the 5-hour token window it parks and resumes 2 minutes after the window resets.
- **--week**: at this % of the weekly window it stops for good: final handoff, summary, a phone notification from the session, autopilot off.
- **--ask-user**: lets the session wait for you, for critical things only (an irreversible or outward-facing action, missing access, a decision outside its role): it asks you in an `AskUserQuestion` dialog, or, for an action you must take or when it cannot use the dialog, sends a phone notification with the question, waits with `wait_for`, and is not nudged until you answer. Everything else it still decides itself. Without the flag it never waits for you unless you turn asking on with `/ask-user on`; `/ask-user on|off` works while the run goes or before it starts (see [Away, back and ask-user](#away-back-and-ask-user)).

While it runs:

- Ordinary questions (`AskUserQuestion`) are answered with "decide yourself within your role"; the decision goes into the handoff. Only a question that truly cannot wait is sent to your phone (`PushNotification`). With asking on and you available (you are not away, and no ended away is still waiting for you to write), an `AskUserQuestion` reaches you as a dialog instead, the menus of a workflow the session runs (a GSD menu, for example) included, so a session started with `--ask-user` can stop at such a menu until you answer or go `/away`; the session's own questions stay for critical ones.
- Permissions stay as they are. Run the session in auto mode or with allow rules. A refused action is never retried another way.
  - An action the permission mode refuses (a push, a commit), or its classifier or safety check, is logged as deferred and left for you.
  - A refusal by a settings rule (a deny in `permissions`) is final: it reaches the session unchanged and is logged.
- The session never ends or hands off on its own; autopilot decides. If the work is done it answers `AUTOPILOT_DONE` and autopilot wraps up.
- Waiting: when the session hands work to someone else and has nothing useful left, it calls the `wait_for` tool and ends its turn. While it waits, autopilot does not nudge it, does not count idle turns and drops the goal's re-prompt. Any new turn (a message from another session, a subagent or workflow finishing, you) wakes it.
  - Reasons: `session-answer`, `session-ping`, `subagent-result`, `workflow-end`, `background-task`, `idle-inbox`, `other`, and, while it may ask you (asking is on with `--ask-user` or `/ask-user on`, you are not away, and no ended away is still waiting for you to write), also `user-answer` and `user-input` (these need the question as `note`). `from` names who it waits for.
  - `idle-inbox`: nothing to do until a message comes (a cadre role with an empty inbox). Give it no timeout; any incoming message wakes the session.
  - `timeout` (`30m`, `1h`): past it, autopilot asks the session once to check whether the answer is stuck. It never runs past the run's time.
  - Polling (a build, a deploy, a slow job): wait with `background-task` and a timeout, not the same check every turn.
  - Stops: the run's time ends a wait. The weekly stop also ends a run in the turn that declares a wait. The 5-hour stop never ends an idle wait.
  - The status and the fleet badge show what it waits for, from whom and for how long: `/autopilot` prints `Waiting: session-answer ← "BE-expert" · 12m`, the fleet badge `⏸ session-answer ← BE-expert · 12m00s`.
- Stalls: two turns in a row without progress (no tool call, or exactly the same calls as the turn before) park a run without `--goal`. It waits with reason `other` and you get the toast "Autopilot parked: no progress for two turns"; any new message resumes it. A run with a goal pauses instead.
- Log: `~/.claude/autopilot/<session id>.log` (decisions, deferrals, refusals, restarts, limits).

### Away, back and ask-user

```
/away for <duration> [--global]   # 90m, 2h, 1h30m
/away until <clock> [--global]    # 15:00, 6pm: the next time the local clock reads that
/back [--global]
/ask-user on|off [--global]
```

These tell the session whether it may ask you now. They only work when you type them (in the prompt or over Remote Control), never from the session itself. `--global` may stand anywhere in the line.

- **Scope.** Without `--global` the setting is for this session. With `--global` it is for every session on this machine with the mod (`~/.claude/autopilot/status/global.json`; needs `HOME`). A session's own setting always beats the global one, field by field, even when it is older: `/back` in one session keeps it available while a global away holds for the rest.
- **No run needed.** The setting is stored even when autopilot is off and applies to the next run (in this session, or in every session for `--global`). A session's setting follows autopilot's own restarts, but not your own `/clear` (that is a new session).
- **`/away`** needs a time: a duration (at least 1 minute, at most 7 days) or `until <clock>` (same clock forms as `/autopilot until`, always under 24 hours ahead). Bare `/away`, an unknown word or a time out of range is an error and changes nothing.
- **While you are away** (or asking is off), the session works as without `--ask-user`: it decides ordinary questions itself. A critical question (one it would have stopped and asked you about) goes into a queue with `queue_question`, with what it does meanwhile, and it keeps working on what that question does not block. The queue never drops a question; above 20 a toast warns. If the session was waiting for your answer when you went away, the wait ends and that question stays queued (at the head if it was not queued yet); if the wait did not carry the question, the session is told to queue it itself.
- **When the away ends** with an empty queue, nothing happens. With questions queued, the session sends **one** phone notification ("N critical questions are queued") and keeps working without asking until you write in it. A message you write before the away ends does not count: use `/back`. A global away ends with **one** combined notification across sessions ("7 questions in 3 sessions"), sent by one of them. An away that ends while asking is off sends nothing.
- **`/back`**, or your first message after the away ended, starts the questions: one at a time, in an `AskUserQuestion` dialog when it can (as text, waiting with `wait_for user-answer`, when not). An answer in the dialog takes the question off the queue, as does your answer typed while the session waits for it, and the next one follows; a dismissed or unanswered dialog leaves it queued. A message you send before a question is asked removes nothing. New critical questions join the end of the queue.
- **`/ask-user off`** is an away without an end: critical questions are queued. **`/ask-user on`** turns asking on, also for a run started without `--ask-user`; when you are not away it starts the queued questions. During an active `/away` it only flips the switch: the away holds until its time.
- A run started without `--ask-user`, with no `/ask-user` setting anywhere, never waits for you and queues nothing: `/away` is stored but changes nothing until `/ask-user on`.
- Notifications and questions reach the session only while it works or waits for an answer. While it is parked on the 5-hour limit, paused or restarting, you get a toast; they are delivered when it works again. An away-end notification not delivered yet is dropped once it is no longer true: you are back and the questions start, you go away again, asking is turned off, or (for a global away) a day has passed since it ended.
- Questions still open when the run ends go into the final handoff. A new run started in this session (for example after a pause) keeps them and asks them when asking is on; `/autopilot 0 0 stop` lists them in its reply.
- `/autopilot` shows whether you are away and whether asking is on, each with where it comes from (session or global), also with no run; during a run it also shows the mode and how many questions are queued.

## agent-fleet

`/fleet` toggles the pane (`/fleet open`, `/fleet close`). Every session with the mod writes a heartbeat to `~/.claude/fleet/<session id>.json` every 15 s and on every turn, spawn and message; the pane reads that folder. Ended and cleared sessions are hidden at once (a resume brings them back), a silent one shows "no signal" after 3 minutes and is dropped after an hour, and files older than a day are deleted.

## cadre

```bash
/cadre detect                # which dev framework this repo uses, with the evidence
/cadre detect --adapters     # also the contract cadre would drive each framework with
/cadre init                  # guided setup: scan, roles, scope cards, the file plan, then write it after Confirm
/cadre init --dry-run        # the same, ending "Dry run: nothing was written."
/cadre regen <id>            # re-render one role from its role.json and write that role's files
/cadre regen <id> --dry-run  # the same, ending "Dry run: nothing was written."
/cadre frameworks            # ask the framework questions again, review the changed files, write after Confirm
/cadre frameworks --dry-run  # the same, ending "Dry run: nothing was written."
/cadre start <id>            # render .cadre/<id>/.runtime/, print and copy the launcher command
/cadre start <id> --terminal # also open it in a new Terminal window, iTerm tab or tmux window (macOS)
/cadre status <id>           # done, running, stopped, not started or unknown, from autopilot's files on disk
.cadre/bin/<id> --probe      # report each scope rule as enforced, best-effort or violated
/cadre epic <KEY> [title]    # create or reuse the epic's worktree and open its roles there (macOS terminals)
/cadre epic done <KEY>       # remove a finished epic's worktree (clean, merged, no role running)
/cadre epic done <KEY> --force # remove it anyway, after a consent question that lists No first
```

`detect` is read-only and writes nothing. A framework is in use when the repo has its artifacts: `.planning/` for GSD, `docs/superpowers/` or `.superpowers/` for superpowers. It is installed when a user-level install is found, not found when neither is present, and unsupported when `aidlc/`, `_bmad/` or `.specify/` is there. With more than one framework in use it says "ambiguous", and `/cadre init` asks which one each role uses. It never runs code from the repo it inspects. cadre is installable from a release tag once one contains it; until then, install it from a clone as in Develop them above. cadre's `register.tsx` is tested against a faked host in `claude plugin test cadre`.

`init` writes the plan only after you pick **Confirm** in its final review; `--dry-run` never writes. `/cadre init` refuses in `claude -p` (nobody can be asked), inside an active autopilot run in the same session (or when its status cannot be read), outside a git repo or below its top level, and at or above your home folder. It asks before it reads `~/.claude.json` (MCP server names only) and before it scans session history (names and counts only). It proposes narrow-scope roles from a template (PM, Team Lead, BE, FE, QA, Security) adjusted by what the scan finds; you can use them, adjust them or describe your own structure. Whenever it finds a supported framework, in use or installed, it asks which frameworks the team keeps: keep the found ones, add a missing one, none (built-in), or Other with the names. The answer is stored as `frameworks` in `.cadre/cadre.json`, beside `structure`, which records whether you took cadre's core team (`core`) or your own structure (`custom`), so a re-run does not ask again while the stored frameworks are all still installed and hold every framework a role is set to (an Adjust `framework <id> <fw>` to another one asks again, after a stored None too); with two kept it then asks which framework the roles use, for all of them or per role. A stored None stays as it is: when the scan finds a supported framework, init prints one line that names `/cadre frameworks` and asks nothing. Adding a framework, here or with an Adjust `framework <id> <fw>` line, asks to install it, No first; after Confirm it installs at project scope with the framework's own command, run from the repo root, so the repo's own settings for that command (its `.npmrc` for `npx`) decide where the package comes from: GSD `npx -y @opengsd/gsd-core@latest --claude --local`, which writes `.claude/gsd-core`, `.claude/commands`, `.claude/agents`, `.claude/hooks`, `.claude/settings.local.json`, `.claude/scripts`, `.claude/gsd-file-manifest.json` and `.claude/gsd-install-state.json`, or superpowers `claude plugin install superpowers@claude-plugins-official --scope project`, which writes `enabledPlugins` in `.claude/settings.json`. The review names each install's command and what it writes; a failed install prints its command, and the roles on that framework fall back. A free-text role structure goes to the model with no tools, and the reply is validated before anything uses it. Framework config changes (GSD `mode: yolo`, `workflow.text_mode: false`) are shown as before/after hunks that you accept one by one, only when `.planning/config.json` already exists: init never creates `.planning/`, and a GSD role that needs it (TL's `/gsd-new-project`) creates it inside the checkout it works in. When the team has a Security role and Anthropic's `claude-security` or `security-guidance` plugin from `claude-plugins-official` is missing, init offers to install them after you Confirm (claude-security needs Python 3.9 or newer and writes `CLAUDE-SECURITY-<time>/` report folders, which the cadre block in `.gitignore` ignores); nothing is installed without your Install answer or in `--dry-run`, the installs run from your home folder, a failed install prints the command to run yourself, and after an install you run `/reload-plugins`. When the team has a PM and the `mattpocock-skills` plugin is not installed for the repo, init asks, No first, to install it at project scope after you Confirm (`claude plugin install mattpocock-skills@claude-plugins-official --scope project`), for PM's grill; when it is installed, PM gets the grill skills without a question. PM gets only `mattpocock-skills:grilling` and `mattpocock-skills:grill-me`: at each launch every other skill the plugin lists is denied for a role that was not given it. No installs nothing, prints the command and PM runs the grill itself. The git policy is commit definitions (the default), commit all, or ignore all of `.cadre/`, with the ignore lines kept in a marked `# >>> cadre` block in `.gitignore`. Under commit all, each role's copy of its private instructions, `.cadre/<id>/.runtime/private-instructions/`, is ignored too; a repo set up before this change re-runs `/cadre init` to refresh the block and runs `git rm -r --cached .cadre/*/.runtime/private-instructions` if the old link was staged. A role gets the repo's CLAUDE.md, rule files and AGENTS.md (offered only when there is no root CLAUDE.md) whole or not at all, loaded from the originals at launch; every such file it was not given, and every other role's built CLAUDE.md, is excluded for it. `.cadre/<id>/CLAUDE.md` holds only a header, plus `@../../AGENTS.md` when the role was given AGENTS.md. A file git does not track is given to no role, with the warning `{file} is not tracked by git: no role is given it`. The claude-md-improver, when offered, tidies each role's private CLAUDE.md, built from your global CLAUDE.md, in `<config dir>/cadre/<repo>-<hash8>/<id>/instructions/`. Every `/cadre start` and `/cadre epic` copies the files of that folder into the role's git-ignored `.cadre/<id>/.runtime/private-instructions/`, which the launcher adds with `--add-dir`, so an edit there reaches the role at the next `/cadre start` or `/cadre epic`; the role cannot edit its copy, and no other role can read it (best effort for a role with Bash). The launcher start (asked once for the repo) is the git root, the folder a launcher is run from, or a folder you type; a launcher must be run by its own path, because a copy or link outside the repo fails closed. A scope card lists the role's framework, model and permission mode, the skills and MCP servers it gets and the ones it does not, the hooks loaded, each rule marked `[hard]`, `[best-effort]` or `[none]`, the decision chain and the memory folder `<config dir>/cadre/<repo>-<hash8>/<id>`, where `<config dir>` is `CLAUDE_CONFIG_DIR`, else `~/.claude`.

`/cadre frameworks` asks the framework step of init again for a team `/cadre init` already wrote, whatever `.cadre/cadre.json` stores: which frameworks the team uses (with none found: Add GSD, Add superpowers or None), the install offer for each one added (No first), whether the roles share one framework or each picks its own when two are kept, and GSD's config changes one by one. Each role's GSD or superpowers value is chosen again; an explicit none stays. The roles keep their ids, skills and assignments. It also repairs a team whose `.cadre/cadre.json` has no default framework while a role has none, which `/cadre regen` refuses. It then shows a review of the files that change (which can include changes from your setup since the last render), with Confirm and Cancel; nothing is installed or written before Confirm, a file you edited is asked Keep mine / Take new, and `--dry-run` writes nothing. It refuses in `claude -p`, inside an active autopilot run, in an epic worktree (run it in the main checkout) and without `.cadre/cadre.json`. Run `/cadre start <id>` again for a running role to pick the change up.

Before the reply, init shows the roles, each scope card, the file plan and the scan warnings, then asks to review: **Confirm**, **Change roles**, **Change git policy** or **Change launcher start**. Typing `duration`, `model`, `assignments` (or `mcp`, `skills`), `memory`, `env` or `hunks` goes back to that one item. The question is asked at most 10 times; after 10 rounds without Confirm init replies `init cancelled, nothing written: The review question was asked 10 times without "Confirm": nothing was chosen.`, and a dismissed review replies `init cancelled, nothing written: The review question was dismissed or not answered.` Plain `init` and `init --dry-run` print the same plan, the git policy line and the launcher line; they differ only in the first line (`cadre init` or `cadre init --dry-run`) and the end: plain init ends with what it wrote (`Applied: ...`) and `Next: run /cadre start <id> to launch a role.`, and `--dry-run` ends with `Dry run: nothing was written.`

On the main terminal screen init opens no side pane: each question's context is in its option preview, a context too long for the preview is printed above the question, and progress between questions shows in the status line; the review there pages through the plan with **Next page**, **Previous page**, **Confirm** and **Change something…** (type the item to change in the note). When the scan finds a GSD install it cannot prove, init asks before it runs GSD's own check (`node gsd-tools runtime-identity`): No, the first option, leaves GSD found but unproven, `/cadre detect` asks the same way, and `claude -p` never runs it. A relative `CLAUDE_CONFIG_DIR`, or one inside the repo, is ignored with a warning and `~/.claude` is used instead. After updating to 0.4.1, the next `/cadre init` or `/cadre regen` updates a role's ROLE.md once where its rule texts changed (a code dir with an unusual name, a deny pattern that was not emitted), or writes a `.cadre-new` copy beside one you edited.

In 0.4.2, init recommends MCP servers first, then your own skills and plugin skill groups to match the MCP servers you confirmed, and offers **Accept** only where something is recommended; autopilot's, agent-fleet's and cadre's skills go to every role without a question. The MCP questions list the servers grouped by the role they are recommended for and leave out servers disabled for the project. On fullscreen and in the desktop app each question shows its sentence and a one-line summary, and the side pane shows only that question's context, with a long list paged under a size cap through **Next page** and **Previous page**, or, while cadre works, a loader with a one-line summary of the step. On the main terminal screen, option previews and Review pages are fitted by the rows they wrap to. After updating to 0.4.2, the parts of an instruction file with CRLF line ends read as changed once, on the next `/cadre regen`.

`/cadre regen <id>` re-renders one role from `.cadre/<id>/role.json` and the current scans, and plans only that role's folder (except `role.json`, its input), its launcher, `INDEX.md` and the manifest; every other manifest entry is kept as it is. It asks nothing, so it also runs in `claude -p`. It reads `~/.claude.json` only when init was allowed to, which `.cadre/cadre.json` records as `readUserMcp`. Its reply is the command, the file plan, one `warning:` line for each scan warning and the closing note. Like init it refuses at or above your home folder, outside a git repo or below its top level, and inside an active autopilot run (or when its status cannot be read), but not in `claude -p`; then it refuses with one of these:

- `cadre regen needs .cadre/cadre.json from /cadre init: run /cadre init first.`
- `.cadre/cadre.json is not valid: fix it, or run /cadre init again.`
- `no role <id> in .cadre/cadre.json (roles: ...)`
- `.cadre/<id>/role.json is missing or not valid: fix it, or run /cadre init again.`
- `role <id> has no framework and this repo has no default: set "framework" in .cadre/<id>/role.json to gsd, superpowers or none, then run /cadre regen <id> again.`
- `.cadre/manifest.json is missing, so regen cannot keep the other roles' files: run /cadre init again.`
- `.cadre/manifest.json is not valid, so regen cannot keep the other roles' files: run /cadre init again.`

After **Confirm**, init asks **Keep mine** or **Take new** for each file you changed by hand, runs the framework config changes you accepted, then writes `.cadre/<role>/`, the executable launchers `.cadre/bin/<role>`, `.cadre/INDEX.md`, the `.gitignore` block and, last, `.cadre/manifest.json`. A config change that fails is printed for you to run, and the roles it affects stay attended. Plain regen writes its one role the same way and keeps any file you changed by hand, with the new version beside it as `<file>.cadre-new`.

`/cadre start <id>` checks the role, its launcher against the manifest and `claude --version` (2.1.295 or newer), renders `.cadre/<id>/.runtime/` (settings, MCP config, probe expectations and links) and the role's inbox `inbox.jsonl` in your user config folder, prints the launcher command and copies it with `pbcopy`. `--terminal` opens it in a new Terminal window, an iTerm tab or a tmux window; it picks one from `$TMUX` and `$TERM_PROGRAM` and refuses, still printing and copying the command, when it cannot tell.

A launcher refuses to start when it is not inside the repo of its role, when `claude` is older than 2.1.295, or when `.cadre/<id>/.runtime/` is missing, older than the role files or than one of its own rendered files (a render that did not finish), or holds a file that is not valid JSON (checked with `jq`, else `node`); it never renders anything itself. It starts the session as `cadre-<id>` at the launcher start chosen in init, with the role's scope, its memory folder and the autopilot kickoff. A launcher that starts below the git root also adds the git root with `--add-dir`, and the project settings of the git root do not load there, which the scope card says.

`.cadre/bin/<id> --probe` runs one short print-mode turn with the same flags and reports each scope rule as `enforced`, `best-effort` or `violated` (and `note` for the card's notes) from the session's startup inventory; it refuses when that inventory holds a tool, skill or command name it cannot read whole (one with `]` or a character JSON escapes), and it shows the errors of that turn. MCP denies are best-effort: they remove a denied server's tools, and the role's settings also deny the whole server (`deniedMcpServers`), resources and prompts included, where the engine honours that (not yet proven for claude.ai connectors); `--probe` checks the tools only.

`/cadre status <id>` reads from disk, not from what a model says, whether the role's autopilot run is `done`, `running`, `not started`, `stopped` or `unknown`; it finds the role's session by its name `cadre-<id>`, or by its fleet beat, and shows the latest handoff under `thoughts/shared/handoffs/<id>/`.

`/cadre epic <KEY> [title]` runs only in the root session of the main checkout: inside a linked worktree it refuses and names the main checkout. It needs a team applied by `/cadre init` with a PM (the role with id `pm`, else the one role based on `pm`), and it checks the team, each picked role's launcher and `claude --version` as `/cadre start` does, all before it creates anything. `<KEY>` is the tracker key as typed: 1 to 32 letters, digits, `-` or `_`, starting with a letter or digit, with one leading `#` dropped, so `#123` works. The worktree is `.claude/worktrees/<slug>` on a new branch `epic/<slug>` made from the current HEAD; the slug is the key and the title words in lowercase, with every other run of characters turned into one `-`, at most 48 characters. Running it again with the same key reuses that worktree and ignores the title, and when only the branch is left (`epic done` keeps it), the worktree is added back on that branch. In the worktree, these are copied from the main checkout (`cp -pR` to a `<path>.cadre-copy` sibling, then `mv -n` into place, never over a file that is there): every path the main checkout's `.worktreeinclude` names that git ignores (a file or a whole folder, `thoughts/` when you list it there), `.env*` files, `.gitignore`, `.gitattributes`, `.mailmap` and `.cadre/sizing.md`. A folder that holds a listed path deeper down becomes a real folder whose children follow the same rules. Every other untracked or ignored entry of the main checkout is linked to the main checkout's copy: `node_modules` and the untracked or ignored files under `.claude/` are then the main checkout's own, and a change made through a link lands in the main checkout. `.claude/worktrees` is never linked. An untracked or ignored `.cadre` is mirrored instead of linked: `.cadre`, `.cadre/bin` and each `.cadre/<id>` are real folders whose other entries are links, and `.runtime/` is never linked, so each role's `.runtime/` is the worktree's own. The links and the roles' `.runtime/` folders are hidden from git by `<worktree git dir>/cadre-links.exclude`, which holds your global excludes file and one line per link or copied git file; the worktree reads it as its own `core.excludesFile`, which needs `extensions.worktreeConfig`: cadre sets it to true in the repo's shared config, and `epic done` leaves it set.

`/cadre epic` asks one question, which roles to open: all of them, PM only, or role ids typed under Other, and PM is always added. With no dialog (`claude -p`) or a team of one role it opens every role without asking, and dismissing the question creates nothing. Each picked role's `.runtime/` is rendered for the worktree as `/cadre start` renders it, with the epic kickoff in its `.runtime/kickoff.txt`, which the launcher starts with when it is there. Each role then opens in a new Terminal window, iTerm tab or tmux window inside the worktree (macOS), picked as `/cadre start --terminal` picks one, or forced with `--terminal=terminal`, `iterm` or `tmux`; for a role that cannot open, its `cd -- <worktree> && <launcher>` command is printed, and those commands are copied. A role whose launcher in the worktree is not the one cadre checked in the main checkout is not opened or copied. PM starts with the epic key and title and is told to read its ROLE.md and its inbox with `inbox_read`, get the epic with its tracker MCP, grill you on it (with `mattpocock-skills:grilling` when available, else itself), then feed TL ticket by ticket. Every other role starts by waiting for its parent, TL, or PM when the team has no TL (`wait_for` reason `idle-inbox` from `cadre-<parent id>`, with no timeout), then reads its inbox with `inbox_read`: TL runs the ticket loop of its ROLE.md, and every other role works what its parent sends. PM starts with `--ask-user` and asks you. On cadre's core team, the structure init records in `.cadre/cadre.json`, TL and Security start with `--ask-user` too: TL asks you about architecture and high-level decisions and about what a worker sends up that only a person can do or decide, and Security asks when a matter is unclear or a risk must be accepted that TL cannot accept. BE, FE, QA and every role but PM of a custom team do not ask you; a `cadre.json` with no recorded structure counts as custom until a fresh `/cadre init`. Role memory is shared by all checkouts of the repo, since its folder is keyed on the git common dir. `/cadre epic` needs launchers that read the epic kickoff: after upgrading cadre, run `/cadre regen <id>` once for each role, and when the repo commits `.cadre`, commit the new `.cadre/bin/` too, since a new worktree is made from HEAD; until then `/cadre epic` refuses before it creates anything.

**Epics as a conveyor.** PM grills you on the epic and on every ticket in one attended run, until no question is open: each round in `AskUserQuestion` dialogs (up to 4 questions per call, the recommended option first), or as text with `wait_for` when a dialog cannot be used. It then proposes how the epic is planned, from the modes the repo's frameworks offer: GSD epic (TL keeps the epic as a GSD milestone and every ticket runs on GSD) or ticket by ticket, sized; with one framework only ticket by ticket. A ticket's size is the highest of four scores from 0.1 to 1.0: PM scores scope and risk from the ticket, TL adds complexity and effort; the ticket is large at or over the threshold in the `sizing` block of `.cadre/cadre.json` (0.5 by default), which also maps small and large to a framework, and each dimension is scored against the anchors in `.cadre/sizing.md`, which init writes once for you to edit by hand. PM sends TL the brief, then one ticket at a time; TL plans it in its own docs, hands BE and FE their tasks in parallel, waits for every report and reports to PM. On cadre's core team TL also answers PM's code questions during the grill and hands each implementer a brief, not a plan; the implementer plans, builds, runs the specs, lint and checks and reports, and TL trusts the report and reads the diff; TL then sends QA a verify task and Security the finished ticket, and Security reports each finding to TL with its severity. A technical question goes up to TL, a product question to PM, and only the roles that start with `--ask-user` ask you. On `epic-end` every role marks its open inbox entries, writes its handoff and answers `AUTOPILOT_DONE`, PM last. Each role's ROLE.md holds these rules in its Hierarchy and Sizing sections.

**Inbox.** Each role has an inbox, `inbox.jsonl` in `<config dir>/cadre/inboxes/<repo name>-<hash>/<id>/` (`<config dir>` is `CLAUDE_CONFIG_DIR`, else `~/.claude`), outside the repo: append-only entries that cadre stamps with the sender and the time. A role sends with `inbox_send` (kinds `ticket`, `task`, `report`, `question`, `answer`, `epic-end` and `note`), reads its own inbox with `inbox_read` and moves an entry through the six states with `inbox_mark`: unread, read, awaiting, blocked, rejected (the reason goes back up) and done. `inbox_send` lists each field's cap in its schema and names every problem in one refusal; `inbox_read` shows read, awaiting and blocked entries on one line and an entry in full by its `id`. Every record ends with an `end` key that echoes its id, and a reader drops a record cut short. The entry is written first, then the receiving role is woken live by the session id it published; a role that is not running finds the entry when it next reads its inbox. Roles may not Edit or Write anything under `<config dir>/cadre/inboxes/`, and no role session gets that folder as an added directory, so only the inbox tools write the inbox and `session.json`: never edit an inbox by hand. A config folder path a permission rule cannot hold (a space, for example) gets no such deny, and `/cadre start` warns. A role session works its inbox folder out from its own `HOME` or `CLAUDE_CONFIG_DIR`, so start each role from a terminal with the same config folder as the session that ran `/cadre start`; otherwise its inbox tools refuse. An inbox under `.cadre/<id>/.runtime/` from an earlier 0.5.0 setup is not moved or read, and stays git-ignored. The tools exist only in a role session, not in the root session.

**Planning docs.** Each role keeps its own planning docs and state, so it loads only the context of its task: on GSD its own workstream (`GSD_WORKSTREAM` is `cadre-<id>`, or `cadre-<epic slug>-<id>` in an epic, which the role creates with `--no-migrate`), on superpowers its own plan files `docs/superpowers/plans/<id>-<ticket>.md`, executed with `superpowers:subagent-driven-development`. cadre writes nothing under `.planning/`. A role that is not on none may run every framework the repo records. When a role may run two or more frameworks, its ROLE.md groups the start steps under each framework, and the framework a task names in its `use` field picks the group.

`/cadre epic done <KEY>` also runs only in the main checkout's root session. It removes the epic's worktree only when the worktree is clean (`git status --porcelain --untracked-files=normal` prints nothing, so untracked files count even when `status.showUntrackedFiles` hides them), its branch is merged into the branch or commit it was made from (`git merge-base --is-ancestor`, against the base in its record), and no role of the team reads `running` there. Otherwise it refuses and names each reason with its fix, and it refuses too when it cannot tell, for example when the record cannot be read. It then moves back into the main checkout (`mv -f`) each regular file of a copied folder that changed in the worktree since that folder was copied, when main's `.worktreeinclude` still names the folder; a file changed in both places takes the worktree's version, and in a folder made real for a listed path only new files directly in it move. A folder no longer listed, a path main holds as a link, or a failed move refuses and names the path, before anything is removed. It then removes the links it recorded with `rm -f`, never `-r`, but only a path the worktree still lists as a link below real folders; anything else is left to `git worktree remove`, which runs next and never follows a link. The copied `.env*` files, and every copy not moved back, go with the worktree, and the branch is kept. `--force` removes it anyway, after one consent question that lists `No, keep it` first; with no dialog it refuses. A locked worktree is unlocked only when its lock names a process id that is no longer running; a live process, one `ps` cannot tell about, or a lock that names no process refuses, with or without `--force`.

A known limit: under the ignore-all git policy, or while `.cadre` is not committed, `/cadre start` inside an epic worktree refuses, because the worktree's `.cadre` files are links into the main checkout; reopen the roles with `/cadre epic <KEY>` from the main checkout. Under the committed policies, `/cadre start <id>` works inside the worktree as in the main checkout and keeps the epic kickoff. A role session in an epic worktree reads its `role.json` and the team from the main checkout, which the render passes as `CADRE_MAIN_ROOT`, so the inbox tools work there under every git policy; its inbox and session files stay the worktree's own. `/cadre status <id>` works inside the worktree under every policy: it reads the team from the main checkout and reports the worktree's own session.

A known limit: in a role started below the git root (a dir start, or a here start from a sub-folder), the kickoff's relative read of `.cadre/<id>/ROLE.md` may not resolve. The role still has its ROLE.md, since it is part of the system prompt.

A known limit: when the repo's root path holds a `#`, tmux expands the window's start folder as a format, so a here-start tmux window may open in `~` instead of the start folder.

More known limits:

- On a dir start, a hook cadre carries that the start folder's settings also register runs twice.
- On a repo root whose encoded folder name is over 200 characters, init finds no session history and gives no auto-memory; `/cadre status` still finds the session.
  A stale full-name folder from before the engine shortened names wins over the live shortened one.
  A main-checkout session that moved into an epic worktree can make status verify the main folder for the worktree.
- A start folder or settings file reached through a link inside the repo stays editable at its real path: the start-folder denies name the path as typed.
- A start settings file cadre cannot read (unreadable, over the read cap, or outside the repo) switches off none of the plugins it enables.
  The scope card then labels its plugins rule best-effort.
- A repo command file granted to a role as a skill gets a `skill-present` probe line. The engine lists a command only under `slash_commands`, so that line can fail the probe.
- A `/cadre` reply is not markdown-escaped: a single `*` in a path such as `.cadre/*/.runtime/` disappears on screen.
- A role that polls by repeating the same calls every turn parks on its third turn; poll with `wait_for` reason `background-task` and a timeout.
- A weekly limit crossed by other sessions while a role waits idle acts at its next wake. The 5-hour stop never ends an idle wait.
- "Parked" in autopilot's toasts and log names both the 5-hour-limit wait and the stall wait.
- `/cadre epic done` trusts the epic record in the worktree: a role that edits it can list `.claude` or a tracked folder as copied and have `epic done` move its files into the main checkout. The `--force` question does not say files move into main, and with an unreadable record nothing moves back.
- New sub-folders inside a folder made real for a listed path are not moved back by `/cadre epic done`.
- A `.planning/` that exists but is git-ignored (GSD with `commit_docs: false`) is linked into an epic worktree, so GSD writes there land in the main checkout.
- An AGENTS.md in a folder above the launch roots is never excluded, so a role may load it.
- A repo file reached only through an `@` import in your global CLAUDE.md or an ancestor's, or one whose name holds a control or format character, shows as given but never loads.
- A `role.json` from before 0.5.24 that records sections of a repo instruction file is not migrated: run a fresh `/cadre init`, or a session `/cadre regen <id>` asks about each such file once.
- A tracked env file that is modified locally is unreadable to a role until it is committed.

Launchers are POSIX `sh` and run on macOS and Linux; `/cadre start` copies and opens terminals on macOS only, and elsewhere prints the command for you to run.

**Sandbox.** A role with Bash runs it in the sandbox and may write `~/.cache`; a role without Bash has the sandbox off. BE, FE and QA also run `docker`, `docker-compose` and the repo's `package.json` docker scripts outside the sandbox (run them alone, with no `cd`, pipe or redirect), and may read the env files git tracks while they match the committed version (when the repo root's path holds only letters, digits, `.`, `_`, `-` and `/`); untracked env files stay denied. TL and Security get none of these. The scope card shows a Docker row and a secrets row.

**Upgrading to 0.5.25.** Run a fresh `/cadre init`: only init records `structure`, so until then a team counts as custom and keeps the earlier role texts, and init replaces the old built `.cadre/<id>/CLAUDE.md` files. Run `claude plugin update cadre@local-mods` first.

**Upgrading to 0.5.0.** Run `/cadre regen <id>` once for every role: the launcher now unsets the session variables a parent Claude session passes on, so each role is reachable by its own session id. Re-run `/cadre init` once too, not only `/cadre regen`, since regen never writes `.cadre/cadre.json`: init records the framework answer and the `sizing` block, which unlocks GSD-epic mode and union scope; until then PM is offered ticket-by-ticket mode on the repo's stored framework only. To choose the team's frameworks again later, for example after you install GSD, run `/cadre frameworks`. Old `.runtime/inbox.md` files are no longer read or written. PM's epic brief is the first entry of a new inbox, so reusing an epic whose PM already has an inbox adds no brief; a newly added epic worktree starts with empty inboxes, also when an earlier epic of the same key left some behind. PM's grill dialogs need autopilot 0.6.0.

## Contributing

`main` takes changes through pull requests only, and a PR merges after the owner (@VladLeus) approves it:

- Work on a branch, open a PR against `main`.
- A PR is required, with 1 code-owner approval (CODEOWNERS + the branch ruleset); new commits dismiss it.
- Required checks: `owner-approval`, `specs` (each mod and the marketplace) and `signed-commits`. Commits must be signed.
- `protected-paths` is a warning, not a requirement: it turns red when a PR touches `.github/`, CODEOWNERS or removes or shrinks tests, so the owner reviews those changes with extra care.
- The `owner-approval` status is success only when the owner's latest review is an approval of the PR's current head; the `owner-approved` label mirrors it and a label set by hand is overwritten.
- No direct pushes and no force pushes to `main`, not even for admins: an admin can bypass the rules only by merging a PR.

Collaborators push branches to this repository. A PR from a fork works too, but its label and status are then set by the owner by hand (a fork's workflow token cannot write to this repository).

## Developing

- Edit, then `/reload-plugins` in a session. Check with:
  ```bash
  claude plugin validate autopilot
  claude plugin test autopilot
  ```
- Type-check cadre with `npm ci --ignore-scripts && npm run typecheck:cadre`: strict tsc over the pure modules, tests and types (CI job `typecheck`). `claude plugin validate` does not type-check.
- **Bump `version` in `.claude-plugin/plugin.json` and run `claude plugin update <mod>@local-mods` after a change.** `/reload-plugins` reads the folder, but a restarted Claude Code (the desktop app especially) loads the copy cached at the last install or update.
- The engine writes the API's types beside each mod at `.claude-plugin/types/` (git-ignored); grep `claude-code/index.d.ts` there for events and `$` methods.
- Logic worth testing lives in a plain module (`fleet.ts`, `autopilot.ts`); `register.tsx` holds the hooks.
