# claude-mods

Three Claude Code mods (plugins of function hooks) in one local marketplace, `local-mods`:

| Mod | Command | What it does |
|---|---|---|
| `agent-fleet` | `/fleet` | A pane with every running session that has the mod: context fill, working/idle, subagents and workflow agents, who messages whom, cost, and an autopilot badge. `/fleet` toggles it. |
| `autopilot` | `/autopilot`, `/away`, `/back`, `/ask-user` | Runs a session on its own for a set time with a fixed role. At a context threshold it writes a handoff, clears itself and resumes from the handoff, instead of auto-compacting. Respects the permission mode, defers blocked actions, watches token limits, works with `/goal`. With asking on (`--ask-user` or `/ask-user on`), while you are away it queues its critical questions and asks them one by one when you are back. |
| `cadre` | `/cadre detect` | Read-only: shows which dev framework this repo uses (GSD, superpowers, none, or detected but unsupported such as AI-DLC), with the evidence, and with `--adapters` the contract cadre would drive each framework with. First step of cadre, which will split a repo into narrow-scope role sessions. |

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
/autopilot 0 0 stop        # hand the wheel back (also clears the goal)
```

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
- **--ask-user**: lets the session wait for you, for critical things only (an irreversible or outward-facing action, missing access, a decision outside its role): it sends a phone notification with the question, waits with `wait_for`, and is not nudged until you answer. Everything else it still decides itself. Without the flag it never waits for you unless you turn asking on with `/ask-user on`; `/ask-user on|off` works while the run goes or before it starts (see [Away, back and ask-user](#away-back-and-ask-user)).

While it runs:

- Ordinary questions (`AskUserQuestion`) are answered with "decide yourself within your role"; the decision goes into the handoff. Only a question that truly cannot wait is sent to your phone (`PushNotification`).
- Permissions stay as they are. Run the session in auto mode or with allow rules. An action the permission mode refuses (a push, a commit) is never retried another way: it is logged as deferred and left for you.
- The session never ends or hands off on its own; autopilot decides. If the work is done it answers `AUTOPILOT_DONE` and autopilot wraps up.
- Waiting: when the session hands work to someone else and has nothing useful left, it calls the `wait_for` tool and ends its turn. While it waits, autopilot does not nudge it, does not count idle turns and drops the goal's re-prompt. Any new turn (a message from another session, a subagent or workflow finishing, you) wakes it.
  - Reasons: `session-answer`, `session-ping`, `subagent-result`, `workflow-end`, `background-task`, `other`, and, while it may ask you (asking is on with `--ask-user` or `/ask-user on`, you are not away, and no ended away is still waiting for you to write), also `user-answer` and `user-input` (these need the question as `note`). `from` names who it waits for.
  - `timeout` (`30m`, `1h`): past it, autopilot asks the session once to check whether the answer is stuck. It never runs past the run's time.
  - The status and the fleet badge show what it waits for, from whom and for how long: `/autopilot` prints `Waiting: session-answer ← "BE-expert" · 12m`, the fleet badge `⏸ session-answer ← BE-expert · 12m00s`.
- Log: `~/.claude/autopilot/<session id>.log` (decisions, deferrals, restarts, limits).

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
- **`/back`**, or your first message after the away ended, starts the questions: one at a time, as text, waiting with `wait_for user-answer`. Your answer, typed while the session waits for it, takes it off the queue and the next one follows. A message you send before a question is asked removes nothing. New critical questions join the end of the queue.
- **`/ask-user off`** is an away without an end: critical questions are queued. **`/ask-user on`** turns asking on, also for a run started without `--ask-user`; when you are not away it starts the queued questions. During an active `/away` it only flips the switch: the away holds until its time.
- A run started without `--ask-user`, with no `/ask-user` setting anywhere, never waits for you and queues nothing: `/away` is stored but changes nothing until `/ask-user on`.
- Notifications and questions reach the session only while it works or waits for an answer. While it is parked on the 5-hour limit, paused or restarting, you get a toast; they are delivered when it works again. An away-end notification not delivered yet is dropped once it is no longer true: you are back and the questions start, you go away again, asking is turned off, or (for a global away) a day has passed since it ended.
- Questions still open when the run ends go into the final handoff. A new run started in this session (for example after a pause) keeps them and asks them when asking is on; `/autopilot 0 0 stop` lists them in its reply.
- `/autopilot` shows whether you are away and whether asking is on, each with where it comes from (session or global), also with no run; during a run it also shows the mode and how many questions are queued.

## agent-fleet

`/fleet` toggles the pane (`/fleet open`, `/fleet close`). Every session with the mod writes a heartbeat to `~/.claude/fleet/<session id>.json` every 15 s and on every turn, spawn and message; the pane reads that folder. Ended and cleared sessions are hidden at once (a resume brings them back), a silent one shows "no signal" after 3 minutes and is dropped after an hour, and files older than a day are deleted.

## cadre

```bash
/cadre detect             # which dev framework this repo uses, with the evidence
/cadre detect --adapters  # also the contract cadre would drive each framework with
```

`detect` is read-only and writes nothing. A framework is in use when the repo has its artifacts: `.planning/` for GSD, `docs/superpowers/` or `.superpowers/` for superpowers. It is installed when a user-level install is found, not found when neither is present, and unsupported when `aidlc/`, `_bmad/` or `.specify/` is there. With more than one framework in use it says "ambiguous", and `/cadre init` (coming later) asks which one to use. It never runs code from the repo it inspects. cadre is installable from a release tag once one contains it; until then, install it from a clone as in Develop them above. cadre's `register.tsx` is tested against a faked host in `claude plugin test cadre`.

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
- **Bump `version` in `.claude-plugin/plugin.json` and run `claude plugin update <mod>@local-mods` after a change.** `/reload-plugins` reads the folder, but a restarted Claude Code (the desktop app especially) loads the copy cached at the last install or update.
- The engine writes the API's types beside each mod at `.claude-plugin/types/` (git-ignored); grep `claude-code/index.d.ts` there for events and `$` methods.
- Logic worth testing lives in a plain module (`fleet.ts`, `autopilot.ts`); `register.tsx` holds the hooks.
