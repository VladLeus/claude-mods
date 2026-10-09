# claude-mods

Two Claude Code mods (plugins of function hooks) in one local marketplace, `local-mods`:

| Mod | Command | What it does |
|---|---|---|
| `agent-fleet` | `/fleet` | A pane with every running session that has the mod: context fill, working/idle, subagents and workflow agents, who messages whom, cost, and an autopilot badge. `/fleet` toggles it. |
| `autopilot` | `/autopilot` | Runs a session on its own for a set time with a fixed role. At a context threshold it writes a handoff, clears itself and resumes from the handoff, instead of auto-compacting. Respects the permission mode, defers blocked actions, watches token limits, works with `/goal`. |

Function-hook mods are early access: you need a recent Claude Code (built and tested on 2.1.295).

## Install

### Just use them

Install a signed release tag, not `main`: pick the latest tag from the [releases](https://github.com/VladLeus/claude-mods/releases) and put it after `#`.

```bash
claude plugin marketplace add VladLeus/claude-mods#v0.2.0
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
/autopilot <time> <threshold%> [max restarts] "<role>" [--goal "<condition>"] [--5h 95] [--week 80]
/autopilot                 # status
/autopilot 0 0 stop        # hand the wheel back (also clears the goal)
```

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

While it runs:

- Ordinary questions (`AskUserQuestion`) are answered with "decide yourself within your role"; the decision goes into the handoff. Only a question that truly cannot wait is sent to your phone (`PushNotification`).
- Permissions stay as they are. Run the session in auto mode or with allow rules. An action the permission mode refuses (a push, a commit) is never retried another way: it is logged as deferred and left for you.
- The session never ends or hands off on its own; autopilot decides. If the work is done it answers `AUTOPILOT_DONE` and autopilot wraps up.
- Log: `~/.claude/autopilot/<session id>.log` (decisions, deferrals, restarts, limits).

## agent-fleet

`/fleet` toggles the pane (`/fleet open`, `/fleet close`). Every session with the mod writes a heartbeat to `~/.claude/fleet/<session id>.json` every 15 s and on every turn, spawn and message; the pane reads that folder. Ended and cleared sessions are hidden at once (a resume brings them back), a silent one shows "no signal" after 3 minutes and is dropped after an hour, and files older than a day are deleted.

## Contributing

`main` takes changes through pull requests only, and a PR merges after the owner (@VladLeus) approves it:

- Work on a branch, open a PR against `main`.
- A PR is required, with 1 code-owner approval (CODEOWNERS + the branch ruleset); new commits dismiss it.
- Required checks: `owner-approval`, `specs`, `protected-paths` and `signed-commits`. Commits must be signed.
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
