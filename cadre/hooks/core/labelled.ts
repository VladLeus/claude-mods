/**
 * The label-as-key answer parser (D-225), a layer 0 leaf: a dialog answer names the value whose label it gives. It
 * imports no other module, so init.ts and the step modules that ask a question can all share it with no cycle.
 */

/** A dialog answer with the value it stands for. */
export type Labelled<T> = {
  readonly label: string
  readonly value: T
}

/** The value whose label the answer names, trimmed and in any case; null when it names none, so it is asked again. */
export function labelled<T>(entries: readonly Labelled<T>[], answer: string): T | null {
  const wanted = answer.trim().toLowerCase()
  const found = entries.find(entry => entry.label.toLowerCase() === wanted)

  return found === undefined ? null : found.value
}
