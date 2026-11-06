/**
 * The JSON helpers every reader of a host file or record shares, a layer 0 leaf: the plain-object and key checks, a
 * boxed parse that tells a JSON null from text that is not JSON, the all-or-nothing list parse and the stable JSON
 * every generated file and record is written in. It imports only core/text, so facts, plan, scan, roles, epic, start
 * and generate can all import it with no cycle, and none of them reaches into plan.ts for stableJson.
 */
import { compareText } from './text'

/** A plain object: not null and not an array. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The parsed JSON of a text, boxed so that a JSON `null` differs from text that is not JSON (which gives null). */
export function parseJsonValue(text: string): { readonly value: unknown } | null {
  try {
    return { value: JSON.parse(text) }
  } catch {
    return null
  }
}

/**
 * Each value parsed, or null when any value does not parse (02-GAPS-B3 S6): the all-or-nothing list check of the
 * records.
 */
export function allOrNull<T>(values: readonly unknown[], parse: (value: unknown) => T | null): T[] | null {
  const parsed: T[] = []
  for (const value of values) {
    const item = parse(value)
    if (item === null) return null
    parsed.push(item)
  }

  return parsed
}

/** The own key names of a plain object; [] for anything else. Only the names are read, never the values. */
export function keysOf(value: unknown): string[] {
  return isObject(value) ? Object.keys(value) : []
}

/** The own key names of the plain object under `field`, such as `enabledPlugins`; [] when either is not one. */
export function fieldKeysOf(value: unknown, field: string): string[] {
  return isObject(value) ? keysOf(value[field]) : []
}

/** The value with the keys of every object sorted by code unit; arrays keep their order. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys)
  if (!isObject(value)) return value
  const pairs = Object.keys(value)
    .sort(compareText)
    .map((key): [string, unknown] => [key, sortedKeys(value[key])])

  return Object.fromEntries(pairs)
}

/**
 * A value as stable JSON: the keys of every object sorted by code unit, arrays in their order, two-space indent and one
 * trailing newline. The same value always gives the same text, so a re-run hashes a generated file the same way
 * (PLAN-04). A key that is a whole number, such as "10", comes first and in numeric order, as JavaScript orders it,
 * which is also the same on every run.
 */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortedKeys(value), null, 2)}\n`
}
