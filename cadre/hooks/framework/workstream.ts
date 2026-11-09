/**
 * The per-role GSD workstream names, a layer 2 module: one workstream per role in the main checkout and one per role in
 * each epic, built only from the role id and the epic slug, which are slugs already. It imports nothing.
 */

/** A workstream name cadre gives a role: `cadre-`, then at most 80 lowercase letters, digits and dashes. */
export const WORKSTREAM_PATTERN = /^cadre-[a-z0-9-]{1,80}$/

/** The most characters WORKSTREAM_PATTERN takes after `cadre-`. */
const MAX_WORKSTREAM_TAIL = 80

/**
 * A role's workstream: `cadre-<id>` in the main checkout, `cadre-<epic slug>-<id>` in an epic's worktree. A name over
 * WORKSTREAM_PATTERN is cut from the slug side, so the role id stays whole.
 */
export function workstreamName(roleId: string, epicSlug: string | null): string {
  if (epicSlug === null) return `cadre-${roleId}`
  const room = Math.max(0, MAX_WORKSTREAM_TAIL - roleId.length - 1)

  return `cadre-${epicSlug.slice(0, room)}-${roleId}`
}
