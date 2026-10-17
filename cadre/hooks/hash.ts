/**
 * The SHA-256 of a text's UTF-8 bytes as 64 lowercase hex characters. It is the only async step of plan building: the
 * host's `crypto.subtle` is the one hash function, so no hash code of cadre's own can drift from it.
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))

  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
