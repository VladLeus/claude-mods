/**
 * A host call bounded by a wait (D-271), a layer 0 module: pure, it imports nothing, so register.tsx can race a host
 * call that may never settle against a wait it bounds, and nothing else needs to know how.
 */

/**
 * The first of a host call and a bounded wait (D-271, edge #1): it resolves once either one settles, a rejection of
 * either one included, and it never rejects, so a host call that never settles holds its caller at most as long as the
 * wait.
 */
export async function settledWithin(work: Promise<unknown>, limit: Promise<unknown>): Promise<void> {
  await Promise.race([work.catch(() => undefined), limit.catch(() => undefined)])
}
