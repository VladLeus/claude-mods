/**
 * What the git runs of more than one area share, a layer 1 module: the timeout of a git run, which /cadre epic and
 * /cadre status both use (D-246). It imports nothing, so any area can import it with no cycle.
 */

/**
 * How long a git run of /cadre epic or /cadre status may run before it is given up (Pitfall 8, D-246); epic's
 * `git worktree add` and `git worktree remove` have their own, longer ones.
 */
export const GIT_TIMEOUT_MS = 30_000
