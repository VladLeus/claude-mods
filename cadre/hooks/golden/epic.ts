/**
 * The golden fixtures of `/cadre epic` (D-219): create on macOS in iTerm (`create`), a reuse of a kept worktree
 * (`createReuse`), create off macOS where the TERMINAL_MAC_ONLY refusal stands in for the terminal (`createMacOnly`,
 * in the D-237 order), done on a clean, merged, idle epic (`done`) and done refused on a dirty, unmerged one
 * (`doneRefused`), each in the world and host rules of its epic.test.ts spec. Captured from the code by a scratch run
 * and pasted as printed; epic.test.ts in this folder runs each again and compares with toEqual. Only an approved
 * behaviour-change commit may change a fixture. Only the golden modules import it.
 */
import type { GoldenCommand } from './types'

/** Each epic run by what it pins. */
export const GOLDEN_EPIC: Readonly<Record<string, GoldenCommand>> = {
  "create": {
    "reply": [
      "cadre epic PROJ-1",
      "Created the worktree /repo/.claude/worktrees/proj-1 on the new branch epic/proj-1.",
      "Linked 0, copied 0.",
      "warning: pm: skill create-handoff-doc was not found in your user skills: not linked",
      "warning: pm: skill resume-handoff-doc was not found in your user skills: not linked",
      "warning: be: skill create-handoff-doc was not found in your user skills: not linked",
      "warning: be: skill resume-handoff-doc was not found in your user skills: not linked",
      "  pm: opened in a new iTerm tab or window",
      "  be: opened in a new iTerm tab or window"
    ],
    "writes": [
      {
        "path": "/repo/.cadre/sizing.md",
        "sha256": "9c961414ae04da71cdabf56a180298b54e2d9e631279138b47c059d3ab7ed6c3",
        "isWritten": true
      },
      {
        "path": "/repo/.git/worktrees/proj-1/cadre-links.exclude",
        "sha256": "5608675a9aba9d732c26529945239c6c9a508850c8201b61dd2cb49c6547d33b",
        "isWritten": true
      },
      {
        "path": "/repo/.git/worktrees/proj-1/cadre-epic.json",
        "sha256": "fd4e1658a18531425ae21d3ee54b68c1531a813cd8f5feb5a88faa6ab5a50354",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/settings.json",
        "sha256": "5ce07dc894954a116350e43d0a8535f7b2570a0b77893bd9bab31241693dd078",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/mcp.json",
        "sha256": "d8e397af03b5b032f21d0aa967086f0c78b33c87b76f2e9898ae0a144df7de02",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/probe-expectations.json",
        "sha256": "fd7dbeee1fc2bb18ca5a296f698d16a5dea1d7664429b249cda3c3236a6fa6bb",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/kickoff.txt",
        "sha256": "ab0bb77c197ed19ae9804b98288858b778f5ba4f65056e9612aa4ba7774d53d9",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/stamp",
        "sha256": "66fd6f3ca295efcacea48fe6fbe88df117d8ff931fc92eb6fbb6d2f61495721c",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/settings.json",
        "sha256": "0dddb717d732a5a9c05ea9a815c575d25312c98ee28cb7199e626733071024a4",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/mcp.json",
        "sha256": "d8e397af03b5b032f21d0aa967086f0c78b33c87b76f2e9898ae0a144df7de02",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/probe-expectations.json",
        "sha256": "f206cba9b55bcff6e80a084f099cc78f2b20e8aaf048372528493a953ff79efe",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/kickoff.txt",
        "sha256": "63d0562885156658ad058ed7cd38dda474971e9a9fc290f487a600f9a279c9bf",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/stamp",
        "sha256": "66fd6f3ca295efcacea48fe6fbe88df117d8ff931fc92eb6fbb6d2f61495721c",
        "isWritten": true
      }
    ],
    "calls": [
      "git -C /repo rev-parse --path-format=absolute --git-dir --git-common-dir @ -",
      "claude --version @ /home/u",
      "git -C /repo worktree list --porcelain @ -",
      "git -C /repo for-each-ref --format=%(refname:short) refs/heads/epic/ @ -",
      "git -C /repo symbolic-ref --short -q HEAD @ -",
      "git -C /repo rev-parse HEAD @ -",
      "git -C /repo worktree add -b epic/proj-1 /repo/.claude/worktrees/proj-1 HEAD @ -",
      "git -C /repo/.claude/worktrees/proj-1 rev-parse --absolute-git-dir @ -",
      "git -C /repo ls-files -z --others --directory --exclude-standard @ -",
      "git -C /repo ls-files -z --others --ignored --directory --exclude-standard @ -",
      "git -C /repo config --includes --global --path core.excludesFile @ -",
      "/usr/bin/printenv XDG_CONFIG_HOME @ -",
      "git -C /repo config extensions.worktreeConfig true @ -",
      "git -C /repo/.claude/worktrees/proj-1 config --worktree core.excludesFile /repo/.git/worktrees/proj-1/cadre-links.exclude @ -",
      "git rev-parse --path-format=absolute --git-common-dir @ /repo/.claude/worktrees/proj-1",
      "/bin/mkdir -p -- /repo/.claude/worktrees/proj-1/.cadre/pm/.runtime @ -",
      "/bin/mkdir -p -- /repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/overlay @ -",
      "/bin/mkdir -p -- /home/u/.claude/cadre/repo-6b4ca2db/pm/instructions @ -",
      "/bin/chmod 700 /home/u/.claude/cadre @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db/pm @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db/pm/instructions @ -",
      "/bin/mkdir -p -- /home/u/.claude/cadre/inboxes/proj-1-37fe7625/pm @ -",
      "/bin/chmod 700 /home/u/.claude/cadre @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/inboxes @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/inboxes/proj-1-37fe7625 @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/inboxes/proj-1-37fe7625/pm @ -",
      "/bin/ln -sfn /home/u/.claude/cadre/repo-6b4ca2db/pm/instructions /repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/private-instructions @ -",
      "/usr/bin/tee -a /home/u/.claude/cadre/inboxes/proj-1-37fe7625/pm/inbox.jsonl @ -",
      "git rev-parse --path-format=absolute --git-common-dir @ /repo/.claude/worktrees/proj-1",
      "git -C /repo/.claude/worktrees/proj-1 ls-files -z -- :(glob)**/.env :(glob)**/.env.* @ -",
      "/bin/mkdir -p -- /repo/.claude/worktrees/proj-1/.cadre/be/.runtime @ -",
      "/bin/mkdir -p -- /repo/.claude/worktrees/proj-1/.cadre/be/.runtime/overlay @ -",
      "/bin/mkdir -p -- /home/u/.claude/cadre/repo-6b4ca2db/be/instructions @ -",
      "/bin/chmod 700 /home/u/.claude/cadre @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db/be @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db/be/instructions @ -",
      "/bin/mkdir -p -- /home/u/.claude/cadre/inboxes/proj-1-37fe7625/be @ -",
      "/bin/chmod 700 /home/u/.claude/cadre @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/inboxes @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/inboxes/proj-1-37fe7625 @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/inboxes/proj-1-37fe7625/be @ -",
      "/bin/ln -sfn /home/u/.claude/cadre/repo-6b4ca2db/be/instructions /repo/.claude/worktrees/proj-1/.cadre/be/.runtime/private-instructions @ -",
      "/usr/bin/tee -a /home/u/.claude/cadre/inboxes/proj-1-37fe7625/be/inbox.jsonl @ -",
      "/usr/bin/uname -s @ -",
      "/usr/bin/osascript -e on run argv -e tell application \"iTerm\" -e activate -e if (count of windows) is 0 then -e create window with default profile -e else -e tell current window to create tab with default profile -e end if -e tell current session of current window to write text (item 1 of argv) -e end tell -e end run cd -- /repo/.claude/worktrees/proj-1 && /repo/.claude/worktrees/proj-1/.cadre/bin/pm @ -",
      "/usr/bin/osascript -e on run argv -e tell application \"iTerm\" -e activate -e if (count of windows) is 0 then -e create window with default profile -e else -e tell current window to create tab with default profile -e end if -e tell current session of current window to write text (item 1 of argv) -e end tell -e end run cd -- /repo/.claude/worktrees/proj-1 && /repo/.claude/worktrees/proj-1/.cadre/bin/be @ -"
    ]
  },
  "createReuse": {
    "reply": [
      "cadre epic PROJ-1",
      "Title: Add retry",
      "Reused the worktree /repo/.claude/worktrees/proj-1-x on the branch epic/proj-1-x.",
      "Linked 1, copied 0.",
      "  pm: cadre start could not read the git common dir (git rev-parse failed or gave no absolute path; git 2.31 or newer is needed), so it stopped.",
      "  be: cadre start could not read the git common dir (git rev-parse failed or gave no absolute path; git 2.31 or newer is needed), so it stopped."
    ],
    "writes": [
      {
        "path": "/repo/.cadre/sizing.md",
        "sha256": "9c961414ae04da71cdabf56a180298b54e2d9e631279138b47c059d3ab7ed6c3",
        "isWritten": true
      },
      {
        "path": "/repo/.git/worktrees/proj-1-x/cadre-links.exclude",
        "sha256": "0a9da303107e0cb96019f23caf634b3590515712e2865ce9ead36dcff4a39d2d",
        "isWritten": true
      },
      {
        "path": "/repo/.git/worktrees/proj-1-x/cadre-epic.json",
        "sha256": "ebe832759ff2c3f79532783d88c5b43e6203719260d5f5f83840f142e03719c4",
        "isWritten": true
      }
    ],
    "calls": [
      "git -C /repo rev-parse --path-format=absolute --git-dir --git-common-dir @ -",
      "claude --version @ /home/u",
      "git -C /repo worktree list --porcelain @ -",
      "git -C /repo for-each-ref --format=%(refname:short) refs/heads/epic/ @ -",
      "git -C /repo/.claude/worktrees/proj-1-x rev-parse --absolute-git-dir @ -",
      "git -C /repo/.claude/worktrees/proj-1-x rev-parse --absolute-git-dir @ -",
      "git -C /repo ls-files -z --others --directory --exclude-standard @ -",
      "git -C /repo ls-files -z --others --ignored --directory --exclude-standard @ -",
      "git -C /repo config --includes --global --path core.excludesFile @ -",
      "/usr/bin/printenv XDG_CONFIG_HOME @ -",
      "git -C /repo config extensions.worktreeConfig true @ -",
      "git -C /repo/.claude/worktrees/proj-1-x config --worktree core.excludesFile /repo/.git/worktrees/proj-1-x/cadre-links.exclude @ -",
      "/bin/ln -s -- /repo/dist /repo/.claude/worktrees/proj-1-x/dist @ -",
      "git rev-parse --path-format=absolute --git-common-dir @ /repo/.claude/worktrees/proj-1-x",
      "git rev-parse --path-format=absolute --git-common-dir @ /repo/.claude/worktrees/proj-1-x",
      "/usr/bin/uname -s @ -"
    ]
  },
  "createMacOnly": {
    "reply": [
      "cadre epic PROJ-1",
      "Created the worktree /repo/.claude/worktrees/proj-1 on the new branch epic/proj-1.",
      "Linked 0, copied 0.",
      "warning: pm: skill create-handoff-doc was not found in your user skills: not linked",
      "warning: pm: skill resume-handoff-doc was not found in your user skills: not linked",
      "warning: be: skill create-handoff-doc was not found in your user skills: not linked",
      "warning: be: skill resume-handoff-doc was not found in your user skills: not linked",
      "  pm: cd -- /repo/.claude/worktrees/proj-1 && /repo/.claude/worktrees/proj-1/.cadre/bin/pm",
      "  be: cd -- /repo/.claude/worktrees/proj-1 && /repo/.claude/worktrees/proj-1/.cadre/bin/be",
      "Copied to the clipboard.",
      "--terminal works on macOS only: run the command above in a terminal yourself."
    ],
    "writes": [
      {
        "path": "/repo/.cadre/sizing.md",
        "sha256": "9c961414ae04da71cdabf56a180298b54e2d9e631279138b47c059d3ab7ed6c3",
        "isWritten": true
      },
      {
        "path": "/repo/.git/worktrees/proj-1/cadre-links.exclude",
        "sha256": "5608675a9aba9d732c26529945239c6c9a508850c8201b61dd2cb49c6547d33b",
        "isWritten": true
      },
      {
        "path": "/repo/.git/worktrees/proj-1/cadre-epic.json",
        "sha256": "fd4e1658a18531425ae21d3ee54b68c1531a813cd8f5feb5a88faa6ab5a50354",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/settings.json",
        "sha256": "5ce07dc894954a116350e43d0a8535f7b2570a0b77893bd9bab31241693dd078",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/mcp.json",
        "sha256": "d8e397af03b5b032f21d0aa967086f0c78b33c87b76f2e9898ae0a144df7de02",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/probe-expectations.json",
        "sha256": "fd7dbeee1fc2bb18ca5a296f698d16a5dea1d7664429b249cda3c3236a6fa6bb",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/kickoff.txt",
        "sha256": "ab0bb77c197ed19ae9804b98288858b778f5ba4f65056e9612aa4ba7774d53d9",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/stamp",
        "sha256": "66fd6f3ca295efcacea48fe6fbe88df117d8ff931fc92eb6fbb6d2f61495721c",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/settings.json",
        "sha256": "0dddb717d732a5a9c05ea9a815c575d25312c98ee28cb7199e626733071024a4",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/mcp.json",
        "sha256": "d8e397af03b5b032f21d0aa967086f0c78b33c87b76f2e9898ae0a144df7de02",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/probe-expectations.json",
        "sha256": "f206cba9b55bcff6e80a084f099cc78f2b20e8aaf048372528493a953ff79efe",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/kickoff.txt",
        "sha256": "63d0562885156658ad058ed7cd38dda474971e9a9fc290f487a600f9a279c9bf",
        "isWritten": true
      },
      {
        "path": "/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/stamp",
        "sha256": "66fd6f3ca295efcacea48fe6fbe88df117d8ff931fc92eb6fbb6d2f61495721c",
        "isWritten": true
      }
    ],
    "calls": [
      "git -C /repo rev-parse --path-format=absolute --git-dir --git-common-dir @ -",
      "claude --version @ /home/u",
      "git -C /repo worktree list --porcelain @ -",
      "git -C /repo for-each-ref --format=%(refname:short) refs/heads/epic/ @ -",
      "git -C /repo symbolic-ref --short -q HEAD @ -",
      "git -C /repo rev-parse HEAD @ -",
      "git -C /repo worktree add -b epic/proj-1 /repo/.claude/worktrees/proj-1 HEAD @ -",
      "git -C /repo/.claude/worktrees/proj-1 rev-parse --absolute-git-dir @ -",
      "git -C /repo ls-files -z --others --directory --exclude-standard @ -",
      "git -C /repo ls-files -z --others --ignored --directory --exclude-standard @ -",
      "git -C /repo config --includes --global --path core.excludesFile @ -",
      "/usr/bin/printenv XDG_CONFIG_HOME @ -",
      "git -C /repo config extensions.worktreeConfig true @ -",
      "git -C /repo/.claude/worktrees/proj-1 config --worktree core.excludesFile /repo/.git/worktrees/proj-1/cadre-links.exclude @ -",
      "git rev-parse --path-format=absolute --git-common-dir @ /repo/.claude/worktrees/proj-1",
      "/bin/mkdir -p -- /repo/.claude/worktrees/proj-1/.cadre/pm/.runtime @ -",
      "/bin/mkdir -p -- /repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/overlay @ -",
      "/bin/mkdir -p -- /home/u/.claude/cadre/repo-6b4ca2db/pm/instructions @ -",
      "/bin/chmod 700 /home/u/.claude/cadre @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db/pm @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db/pm/instructions @ -",
      "/bin/mkdir -p -- /home/u/.claude/cadre/inboxes/proj-1-37fe7625/pm @ -",
      "/bin/chmod 700 /home/u/.claude/cadre @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/inboxes @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/inboxes/proj-1-37fe7625 @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/inboxes/proj-1-37fe7625/pm @ -",
      "/bin/ln -sfn /home/u/.claude/cadre/repo-6b4ca2db/pm/instructions /repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/private-instructions @ -",
      "/usr/bin/tee -a /home/u/.claude/cadre/inboxes/proj-1-37fe7625/pm/inbox.jsonl @ -",
      "git rev-parse --path-format=absolute --git-common-dir @ /repo/.claude/worktrees/proj-1",
      "git -C /repo/.claude/worktrees/proj-1 ls-files -z -- :(glob)**/.env :(glob)**/.env.* @ -",
      "/bin/mkdir -p -- /repo/.claude/worktrees/proj-1/.cadre/be/.runtime @ -",
      "/bin/mkdir -p -- /repo/.claude/worktrees/proj-1/.cadre/be/.runtime/overlay @ -",
      "/bin/mkdir -p -- /home/u/.claude/cadre/repo-6b4ca2db/be/instructions @ -",
      "/bin/chmod 700 /home/u/.claude/cadre @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db/be @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/repo-6b4ca2db/be/instructions @ -",
      "/bin/mkdir -p -- /home/u/.claude/cadre/inboxes/proj-1-37fe7625/be @ -",
      "/bin/chmod 700 /home/u/.claude/cadre @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/inboxes @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/inboxes/proj-1-37fe7625 @ -",
      "/bin/chmod 700 /home/u/.claude/cadre/inboxes/proj-1-37fe7625/be @ -",
      "/bin/ln -sfn /home/u/.claude/cadre/repo-6b4ca2db/be/instructions /repo/.claude/worktrees/proj-1/.cadre/be/.runtime/private-instructions @ -",
      "/usr/bin/tee -a /home/u/.claude/cadre/inboxes/proj-1-37fe7625/be/inbox.jsonl @ -",
      "/usr/bin/uname -s @ -",
      "/usr/bin/pbcopy @ -"
    ]
  },
  "done": {
    "reply": [
      "cadre epic done PROJ-1: removed the worktree /repo/.claude/worktrees/proj-1-add-retry; its branch epic/proj-1-add-retry is kept, as cadre never deletes a branch."
    ],
    "writes": [],
    "calls": [
      "git -C /repo rev-parse --path-format=absolute --git-dir --git-common-dir @ -",
      "git -C /repo worktree list --porcelain @ -",
      "git -C /repo/.claude/worktrees/proj-1-add-retry rev-parse --absolute-git-dir @ -",
      "git -C /repo/.claude/worktrees/proj-1-add-retry status --porcelain --untracked-files=normal @ -",
      "git -C /repo merge-base --is-ancestor epic/proj-1-add-retry main @ -",
      "/bin/rm -f -- /repo/.claude/worktrees/proj-1-add-retry/.cadre/bin/pm @ -",
      "/bin/rm -f -- /repo/.claude/worktrees/proj-1-add-retry/node_modules @ -",
      "git -C /repo worktree remove /repo/.claude/worktrees/proj-1-add-retry @ -"
    ]
  },
  "doneRefused": {
    "reply": [
      "cadre epic done kept the worktree of the epic PROJ-1 and removed nothing: fix what is below, or run /cadre epic done PROJ-1 --force to remove it anyway after one question.",
      "- git shows changes in the worktree: commit or stash them there",
      "- the branch epic/proj-1-add-retry is not merged into main: merge it into main"
    ],
    "writes": [],
    "calls": [
      "git -C /repo rev-parse --path-format=absolute --git-dir --git-common-dir @ -",
      "git -C /repo worktree list --porcelain @ -",
      "git -C /repo/.claude/worktrees/proj-1-add-retry rev-parse --absolute-git-dir @ -",
      "git -C /repo/.claude/worktrees/proj-1-add-retry status --porcelain --untracked-files=normal @ -",
      "git -C /repo merge-base --is-ancestor epic/proj-1-add-retry main @ -"
    ]
  }
}
