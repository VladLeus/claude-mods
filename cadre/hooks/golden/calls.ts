/**
 * The golden fixtures of the host runs of `/cadre epic`, `/cadre status` and `/cadre start` (WA-M2, D-219): for each
 * world of the epic, status and start goldens, every host run in call order as the JSON of its argv and its options
 * (cwd, timeoutMs, env, stdin), so a changed timeout, env, stdin or call site fails. Captured from the code by an
 * engine run and spliced as printed; calls.test.ts in this folder runs each again and compares with toEqual. Only an
 * approved behaviour-change commit may change a fixture. Only the golden modules import it.
 */

/** Each world's host runs by the name of its epic, status or start golden. */
export const GOLDEN_CALLS: Readonly<Record<string, readonly string[]>> = {
  "epicCreate": [
    "[[\"git\",\"-C\",\"/repo\",\"rev-parse\",\"--path-format=absolute\",\"--git-dir\",\"--git-common-dir\"],{\"timeoutMs\":30000}]",
    "[[\"claude\",\"--version\"],{\"cwd\":\"/home/u\",\"timeoutMs\":10000}]",
    "[[\"git\",\"-C\",\"/repo\",\"worktree\",\"list\",\"--porcelain\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"for-each-ref\",\"--format=%(refname:short)\",\"refs/heads/epic/\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"symbolic-ref\",\"--short\",\"-q\",\"HEAD\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"rev-parse\",\"HEAD\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"worktree\",\"add\",\"-b\",\"epic/proj-1\",\"/repo/.claude/worktrees/proj-1\",\"HEAD\"],{\"timeoutMs\":120000}]",
    "[[\"git\",\"-C\",\"/repo/.claude/worktrees/proj-1\",\"rev-parse\",\"--absolute-git-dir\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"ls-files\",\"-z\",\"--others\",\"--directory\",\"--exclude-standard\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"ls-files\",\"-z\",\"--others\",\"--ignored\",\"--directory\",\"--exclude-standard\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"config\",\"--includes\",\"--global\",\"--path\",\"core.excludesFile\"],{\"timeoutMs\":30000}]",
    "[[\"/usr/bin/printenv\",\"XDG_CONFIG_HOME\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"config\",\"extensions.worktreeConfig\",\"true\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo/.claude/worktrees/proj-1\",\"config\",\"--worktree\",\"core.excludesFile\",\"/repo/.git/worktrees/proj-1/cadre-links.exclude\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"rev-parse\",\"--path-format=absolute\",\"--git-common-dir\"],{\"cwd\":\"/repo/.claude/worktrees/proj-1\",\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/overlay\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/home/u/.claude/cadre/repo-6b4ca2db/pm/instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db/pm\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db/pm/instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/ln\",\"-sfn\",\"/home/u/.claude/cadre/repo-6b4ca2db/pm/instructions\",\"/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/private-instructions\"],{\"timeoutMs\":10000}]",
    "[[\"git\",\"rev-parse\",\"--path-format=absolute\",\"--git-common-dir\"],{\"cwd\":\"/repo/.claude/worktrees/proj-1\",\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/repo/.claude/worktrees/proj-1/.cadre/be/.runtime\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/overlay\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/home/u/.claude/cadre/repo-6b4ca2db/be/instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db/be\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db/be/instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/ln\",\"-sfn\",\"/home/u/.claude/cadre/repo-6b4ca2db/be/instructions\",\"/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/private-instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/usr/bin/uname\",\"-s\"],{\"timeoutMs\":5000}]",
    "[[\"/usr/bin/osascript\",\"-e\",\"on run argv\",\"-e\",\"tell application \\\"iTerm\\\"\",\"-e\",\"activate\",\"-e\",\"if (count of windows) is 0 then\",\"-e\",\"create window with default profile\",\"-e\",\"else\",\"-e\",\"tell current window to create tab with default profile\",\"-e\",\"end if\",\"-e\",\"tell current session of current window to write text (item 1 of argv)\",\"-e\",\"end tell\",\"-e\",\"end run\",\"cd -- /repo/.claude/worktrees/proj-1 && /repo/.claude/worktrees/proj-1/.cadre/bin/pm\"],{\"timeoutMs\":15000}]",
    "[[\"/usr/bin/osascript\",\"-e\",\"on run argv\",\"-e\",\"tell application \\\"iTerm\\\"\",\"-e\",\"activate\",\"-e\",\"if (count of windows) is 0 then\",\"-e\",\"create window with default profile\",\"-e\",\"else\",\"-e\",\"tell current window to create tab with default profile\",\"-e\",\"end if\",\"-e\",\"tell current session of current window to write text (item 1 of argv)\",\"-e\",\"end tell\",\"-e\",\"end run\",\"cd -- /repo/.claude/worktrees/proj-1 && /repo/.claude/worktrees/proj-1/.cadre/bin/be\"],{\"timeoutMs\":15000}]"
  ],
  "epicCreateReuse": [
    "[[\"git\",\"-C\",\"/repo\",\"rev-parse\",\"--path-format=absolute\",\"--git-dir\",\"--git-common-dir\"],{\"timeoutMs\":30000}]",
    "[[\"claude\",\"--version\"],{\"cwd\":\"/home/u\",\"timeoutMs\":10000}]",
    "[[\"git\",\"-C\",\"/repo\",\"worktree\",\"list\",\"--porcelain\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"for-each-ref\",\"--format=%(refname:short)\",\"refs/heads/epic/\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo/.claude/worktrees/proj-1-x\",\"rev-parse\",\"--absolute-git-dir\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"ls-files\",\"-z\",\"--others\",\"--directory\",\"--exclude-standard\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"ls-files\",\"-z\",\"--others\",\"--ignored\",\"--directory\",\"--exclude-standard\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"config\",\"--includes\",\"--global\",\"--path\",\"core.excludesFile\"],{\"timeoutMs\":30000}]",
    "[[\"/usr/bin/printenv\",\"XDG_CONFIG_HOME\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"config\",\"extensions.worktreeConfig\",\"true\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo/.claude/worktrees/proj-1-x\",\"config\",\"--worktree\",\"core.excludesFile\",\"/repo/.git/worktrees/proj-1-x/cadre-links.exclude\"],{\"timeoutMs\":30000}]",
    "[[\"/bin/ln\",\"-s\",\"--\",\"/repo/dist\",\"/repo/.claude/worktrees/proj-1-x/dist\"],{\"timeoutMs\":10000}]",
    "[[\"git\",\"rev-parse\",\"--path-format=absolute\",\"--git-common-dir\"],{\"cwd\":\"/repo/.claude/worktrees/proj-1-x\",\"timeoutMs\":10000}]",
    "[[\"git\",\"rev-parse\",\"--path-format=absolute\",\"--git-common-dir\"],{\"cwd\":\"/repo/.claude/worktrees/proj-1-x\",\"timeoutMs\":10000}]",
    "[[\"/usr/bin/uname\",\"-s\"],{\"timeoutMs\":5000}]"
  ],
  "epicCreateMacOnly": [
    "[[\"git\",\"-C\",\"/repo\",\"rev-parse\",\"--path-format=absolute\",\"--git-dir\",\"--git-common-dir\"],{\"timeoutMs\":30000}]",
    "[[\"claude\",\"--version\"],{\"cwd\":\"/home/u\",\"timeoutMs\":10000}]",
    "[[\"git\",\"-C\",\"/repo\",\"worktree\",\"list\",\"--porcelain\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"for-each-ref\",\"--format=%(refname:short)\",\"refs/heads/epic/\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"symbolic-ref\",\"--short\",\"-q\",\"HEAD\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"rev-parse\",\"HEAD\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"worktree\",\"add\",\"-b\",\"epic/proj-1\",\"/repo/.claude/worktrees/proj-1\",\"HEAD\"],{\"timeoutMs\":120000}]",
    "[[\"git\",\"-C\",\"/repo/.claude/worktrees/proj-1\",\"rev-parse\",\"--absolute-git-dir\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"ls-files\",\"-z\",\"--others\",\"--directory\",\"--exclude-standard\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"ls-files\",\"-z\",\"--others\",\"--ignored\",\"--directory\",\"--exclude-standard\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"config\",\"--includes\",\"--global\",\"--path\",\"core.excludesFile\"],{\"timeoutMs\":30000}]",
    "[[\"/usr/bin/printenv\",\"XDG_CONFIG_HOME\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"config\",\"extensions.worktreeConfig\",\"true\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo/.claude/worktrees/proj-1\",\"config\",\"--worktree\",\"core.excludesFile\",\"/repo/.git/worktrees/proj-1/cadre-links.exclude\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"rev-parse\",\"--path-format=absolute\",\"--git-common-dir\"],{\"cwd\":\"/repo/.claude/worktrees/proj-1\",\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/overlay\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/home/u/.claude/cadre/repo-6b4ca2db/pm/instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db/pm\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db/pm/instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/ln\",\"-sfn\",\"/home/u/.claude/cadre/repo-6b4ca2db/pm/instructions\",\"/repo/.claude/worktrees/proj-1/.cadre/pm/.runtime/private-instructions\"],{\"timeoutMs\":10000}]",
    "[[\"git\",\"rev-parse\",\"--path-format=absolute\",\"--git-common-dir\"],{\"cwd\":\"/repo/.claude/worktrees/proj-1\",\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/repo/.claude/worktrees/proj-1/.cadre/be/.runtime\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/overlay\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/home/u/.claude/cadre/repo-6b4ca2db/be/instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db/be\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db/be/instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/ln\",\"-sfn\",\"/home/u/.claude/cadre/repo-6b4ca2db/be/instructions\",\"/repo/.claude/worktrees/proj-1/.cadre/be/.runtime/private-instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/usr/bin/uname\",\"-s\"],{\"timeoutMs\":5000}]",
    "[[\"/usr/bin/pbcopy\"],{\"stdin\":\"cd -- /repo/.claude/worktrees/proj-1 && /repo/.claude/worktrees/proj-1/.cadre/bin/pm\\ncd -- /repo/.claude/worktrees/proj-1 && /repo/.claude/worktrees/proj-1/.cadre/bin/be\",\"env\":{\"LC_CTYPE\":\"UTF-8\"},\"timeoutMs\":5000}]"
  ],
  "epicDone": [
    "[[\"git\",\"-C\",\"/repo\",\"rev-parse\",\"--path-format=absolute\",\"--git-dir\",\"--git-common-dir\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"worktree\",\"list\",\"--porcelain\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo/.claude/worktrees/proj-1-add-retry\",\"rev-parse\",\"--absolute-git-dir\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo/.claude/worktrees/proj-1-add-retry\",\"status\",\"--porcelain\",\"--untracked-files=normal\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"merge-base\",\"--is-ancestor\",\"epic/proj-1-add-retry\",\"main\"],{\"timeoutMs\":30000}]",
    "[[\"/bin/rm\",\"-f\",\"--\",\"/repo/.claude/worktrees/proj-1-add-retry/.cadre/bin/pm\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/rm\",\"-f\",\"--\",\"/repo/.claude/worktrees/proj-1-add-retry/node_modules\"],{\"timeoutMs\":10000}]",
    "[[\"git\",\"-C\",\"/repo\",\"worktree\",\"remove\",\"/repo/.claude/worktrees/proj-1-add-retry\"],{\"timeoutMs\":120000}]"
  ],
  "epicDoneRefused": [
    "[[\"git\",\"-C\",\"/repo\",\"rev-parse\",\"--path-format=absolute\",\"--git-dir\",\"--git-common-dir\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"worktree\",\"list\",\"--porcelain\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo/.claude/worktrees/proj-1-add-retry\",\"rev-parse\",\"--absolute-git-dir\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo/.claude/worktrees/proj-1-add-retry\",\"status\",\"--porcelain\",\"--untracked-files=normal\"],{\"timeoutMs\":30000}]",
    "[[\"git\",\"-C\",\"/repo\",\"merge-base\",\"--is-ancestor\",\"epic/proj-1-add-retry\",\"main\"],{\"timeoutMs\":30000}]"
  ],
  "statusDone": [
    "[[\"git\",\"-C\",\"/repo\",\"rev-parse\",\"--path-format=absolute\",\"--git-dir\",\"--git-common-dir\"],{\"timeoutMs\":30000}]",
    "[[\"/usr/bin/grep\",\"-E\",\"^\\\\{\\\"type\\\":\\\"custom-title\\\"\",\"--\",\"/home/u/.claude/projects/-repo/s9.jsonl\"],{\"timeoutMs\":5000}]"
  ],
  "statusRunning": [
    "[[\"git\",\"-C\",\"/repo\",\"rev-parse\",\"--path-format=absolute\",\"--git-dir\",\"--git-common-dir\"],{\"timeoutMs\":30000}]",
    "[[\"/usr/bin/grep\",\"-E\",\"^\\\\{\\\"type\\\":\\\"custom-title\\\"\",\"--\",\"/home/u/.claude/projects/-repo/s9.jsonl\"],{\"timeoutMs\":5000}]"
  ],
  "statusNotStarted": [
    "[[\"git\",\"-C\",\"/repo\",\"rev-parse\",\"--path-format=absolute\",\"--git-dir\",\"--git-common-dir\"],{\"timeoutMs\":30000}]",
    "[[\"/usr/bin/grep\",\"-E\",\"^\\\\{\\\"type\\\":\\\"custom-title\\\"\",\"--\",\"/home/u/.claude/projects/-repo/s9.jsonl\"],{\"timeoutMs\":5000}]"
  ],
  "statusStopped": [
    "[[\"git\",\"-C\",\"/repo\",\"rev-parse\",\"--path-format=absolute\",\"--git-dir\",\"--git-common-dir\"],{\"timeoutMs\":30000}]",
    "[[\"/usr/bin/grep\",\"-E\",\"^\\\\{\\\"type\\\":\\\"custom-title\\\"\",\"--\",\"/home/u/.claude/projects/-repo/s9.jsonl\"],{\"timeoutMs\":5000}]"
  ],
  "statusUnknown": [
    "[[\"git\",\"-C\",\"/repo\",\"rev-parse\",\"--path-format=absolute\",\"--git-dir\",\"--git-common-dir\"],{\"timeoutMs\":30000}]",
    "[[\"/usr/bin/grep\",\"-E\",\"^\\\\{\\\"type\\\":\\\"custom-title\\\"\",\"--\",\"/home/u/.claude/projects/-repo/s9.jsonl\"],{\"timeoutMs\":5000}]"
  ],
  "startRender": [
    "[[\"claude\",\"--version\"],{\"cwd\":\"/home/u\",\"timeoutMs\":10000}]",
    "[[\"git\",\"rev-parse\",\"--path-format=absolute\",\"--git-common-dir\"],{\"cwd\":\"/repo\",\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/repo/.cadre/be/.runtime\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/repo/.cadre/be/.runtime/overlay\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/mkdir\",\"-p\",\"--\",\"/home/u/.claude/cadre/repo-6b4ca2db/be/instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db/be\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/chmod\",\"700\",\"/home/u/.claude/cadre/repo-6b4ca2db/be/instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/bin/ln\",\"-sfn\",\"/home/u/.claude/cadre/repo-6b4ca2db/be/instructions\",\"/repo/.cadre/be/.runtime/private-instructions\"],{\"timeoutMs\":10000}]",
    "[[\"/usr/bin/pbcopy\"],{\"stdin\":\"/repo/.cadre/bin/be\",\"env\":{\"LC_CTYPE\":\"UTF-8\"},\"timeoutMs\":5000}]"
  ],
  "startRefusalRepo": [],
  "startRefusalTeam": [],
  "startRefusalLauncher": [],
  "startRefusalClaude": [
    "[[\"claude\",\"--version\"],{\"cwd\":\"/home/u\",\"timeoutMs\":10000}]"
  ]
}
