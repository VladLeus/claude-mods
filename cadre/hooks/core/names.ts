/**
 * The name rules a role.json and the scans share, a layer 0 leaf: the MCP server, skill and command name pattern, the
 * env name pattern, the hook name and heading caps, and the SHA-256 form a record holds. It imports no other module,
 * so the setup scan, instructions, apply and roles can all import it, and the setup scan no longer imports roles.ts.
 */

/**
 * An MCP server, skill or command name as a role.json lists it: a letter or digit, then up to 99 more letters, digits
 * and plugin, scope and version punctuation (`:_.@-`). The setup scan keeps only names that match it.
 */
export const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.@-]{0,99}$/

/**
 * An environment variable name a role carries (D-60): upper case letters, digits and underscores, at most 64
 * characters. The setup scan keeps only env names that match it.
 */
export const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,63}$/

/** The most characters of a hook script basename a role carries (D-62); the setup scan drops a longer one. */
export const MAX_HOOK_NAME_CHARS = 80

/**
 * The most code points a part's heading keeps (G-02-1f Part unit): splitSections cuts a heading to it, and a role.json
 * record of a repo part holds no longer one (parseRoleJson).
 */
export const MAX_HEADING_CHARS = 80

/** A SHA-256 as a part record holds it: 64 lowercase hex characters, as sha256Hex gives it. */
export const SHA256_HEX = /^[0-9a-f]{64}$/

/** Whether a text is a SHA-256 as cadre records it (G-02-1f Regen): 64 lowercase hex characters. */
export function isSha256Hex(text: string): boolean {
  return SHA256_HEX.test(text)
}
