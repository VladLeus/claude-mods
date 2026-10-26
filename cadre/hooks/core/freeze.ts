/**
 * The one table freezer, a layer 0 leaf: it imports no other module, so the framework adapters, scan, roles, assign
 * and scope, which freeze their row tables with it, can all import it with no cycle.
 */

/**
 * Freezes a table and every row in it, so no caller can change an adapter's contract at runtime (T-01-27).
 * Rows are plain data; a row with nested arrays freezes those itself where it is declared.
 */
export function freezeRows<T extends object>(rows: readonly T[]): readonly T[] {
  return Object.freeze(rows.map(row => Object.freeze(row)))
}
