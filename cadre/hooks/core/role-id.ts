/**
 * The role id rule (D-48), a layer 0 leaf: the slug pattern, the reserved ids and the check every reader of a role id
 * uses. It imports no other module, so roles, scan, the built-in adapter and command can all import it with no cycle
 * (RESEARCH Pitfall 12).
 */

/** A role id (D-48): a lowercase slug of 1 to 24 characters, so `/`, `..` and spaces are impossible. */
export const ROLE_ID_PATTERN = /^[a-z][a-z0-9-]{0,23}$/

/**
 * Slugs a role can never take: `bin` is the launcher folder `.cadre/bin/` (Pitfall 7), and `all` and `none` are the
 * answer words of init's "which roles get this?" questions, so a role named so could never be picked alone.
 */
export const RESERVED_ROLE_IDS: readonly string[] = Object.freeze(['bin', 'all', 'none'])

/**
 * Whether a text is a usable role id: it matches ROLE_ID_PATTERN exactly, with no case folding, and is not one of
 * RESERVED_ROLE_IDS. Every reader of a role id (role validation, `.cadre/cadre.json`, the kickoff folder) uses it.
 */
export function isRoleId(id: string): boolean {
  return ROLE_ID_PATTERN.test(id) && !RESERVED_ROLE_IDS.includes(id)
}
