/**
 * The locale core (D-207, D-216, D-223, D-224), a layer 0 module and the only code that fills a text template: fill
 * puts each `{name}` slot's value into a template, t fills an EN text by its key and tn the `.one` or `.other` form of
 * a counted sentence. Slots are typed from each template's literal type (Slots), so a call that passes a missing or an
 * extra slot fails tsc. It never throws: a slot with no value at run time renders as `{name}` and its line goes to the
 * sink register.tsx sets at session.start (the debug log); pure code never sees the host. It imports only locales/en;
 * every module that shows text may import it. Values are cleaned and capped at the call site before they are filled
 * (D-222): fill never reads or changes a value.
 */
import { EN } from './en'
import type { EnKey } from './en'

/**
 * The slot names of a template's literal type: each name inside `{...}`, so `Slots<'{a} of {b}'>` is `'a' | 'b'` and a
 * template with no slot gives never.
 */
export type Slots<S extends string> = S extends `${string}{${infer N}}${infer R}` ? N | Slots<R> : never

/** The vars a template takes: none when it has no slot, else one value for each slot and no other. */
type SlotArgs<S extends string> = [Slots<S>] extends [never] ? [] : [Readonly<Record<Slots<S>, string | number>>]

/** A slot's values as fill reads them at run time. */
type SlotValues = Readonly<Record<string, string | number>>

/** The base of every counted EN sentence: a key B with both a `${B}.one` and a `${B}.other` text (D-223). */
export type PluralBase = {
  [K in EnKey]: K extends `${infer B}.one` ? (`${B}.other` extends EnKey ? B : never) : never
}[EnKey]

/** A well-formed slot: a name of letters only inside braces. */
const SLOT = /\{([a-zA-Z]+)\}/g

/** Where a line about a slot with no value goes; a no-op until register.tsx sets the debug log (D-224). */
let missingSlotSink: (text: string) => void = () => undefined

/** Sets where a line about a slot with no value goes: register.tsx sends it to the debug log at session.start. */
export function setMissingSlotSink(sink: (text: string) => void): void {
  missingSlotSink = sink
}

/**
 * The template with each `{name}` replaced by its value, in one pass over the template only, so a value that holds
 * braces is never filled again (T-02.1-81). A slot with no value stays `{name}` and its line goes to the sink; a sink
 * that throws is ignored, so this never throws (D-224, T-02.1-82).
 */
function filled(template: string, values: SlotValues): string {
  return template.replace(SLOT, (whole, name: string) => {
    const value = values[name]
    if (value !== undefined && Object.hasOwn(values, name)) return String(value)
    try {
      missingSlotSink(`cadre: the text slot {${name}} has no value`)
    } catch {
      // The debug log is best effort: a text is never lost to it.
    }

    return whole
  })
}

/**
 * A template with each slot filled (filled): the one fill every locale table uses, the EN texts and the artifact,
 * prompt and contract templates alike. The vars are typed from the template's literal type (Slots).
 */
export function fill<S extends string>(template: S, ...vars: SlotArgs<S>): string
export function fill(template: string, values: SlotValues = {}): string {
  return filled(template, values)
}

/** The EN text of a key with each slot filled (D-207, D-216). */
export function t<K extends EnKey>(key: K, ...vars: SlotArgs<(typeof EN)[K]>): string
export function t(key: EnKey, values: SlotValues = {}): string {
  return filled(EN[key], values)
}

/**
 * The counted EN sentence of a base (D-223): its `.one` text for a count of exactly 1, else its `.other` text, with
 * each slot filled. A whole sentence per form, never a word spliced in by count.
 */
export function tn<B extends PluralBase>(
  base: B,
  count: number,
  ...vars: SlotArgs<(typeof EN)[`${B}.one`] | (typeof EN)[`${B}.other`]>
): string
export function tn(base: PluralBase, count: number, values: SlotValues = {}): string {
  const key: EnKey = count === 1 ? `${base}.one` : `${base}.other`

  return filled(EN[key], values)
}

/**
 * The most names a list on the TUI default shows before it counts the rest (D-256): the same 12 as core/text
 * MAX_CARD_LIST, which t.ts does not import (both are layer 0 and t.ts imports no core module); text.test checks the
 * two stay equal.
 */
export const SCREEN_LIST_MAX = 12

/**
 * The words of a list on screen: `none` for an empty list, `more` for the last item of a capped list, and its cap,
 * SCREEN_LIST_MAX names (D-256). core/text ListWords takes this shape; t.ts imports no core type.
 */
export const SCREEN_LIST_WORDS = Object.freeze({
  none: t('ui.scan.none'),
  more: (count: number): string => t('ui.list.more', { count }),
  max: SCREEN_LIST_MAX,
})

/**
 * The words of a list in the pane of a pane surface (D-256): the screen's words with no cap, so the pane shows every
 * name; the large safety caps on data read from disk stay where the data is read (D-231).
 */
export const PANE_LIST_WORDS = Object.freeze({ ...SCREEN_LIST_WORDS, max: Number.POSITIVE_INFINITY })

/**
 * The field label a row template draws: the text before its first `: `, after the last slot before it, trimmed; ''
 * when the template has no `: `. ui/pane styles a field by this label, so it never matches EN wording of its own.
 */
export function labelOf(template: string): string {
  const end = template.indexOf(': ')
  if (end === -1) return ''
  const head = template.slice(0, end)

  return head.slice(head.lastIndexOf('}') + 1).trim()
}

/** The field label of an EN row template (labelOf). */
export function keyLabel(key: EnKey): string {
  return labelOf(EN[key])
}

/** The slot names of a template, once each, in the order they first appear (the walk specs check every template). */
export function templateSlots(template: string): readonly string[] {
  return [...new Set([...template.matchAll(SLOT)].map(match => match[1] ?? ''))]
}
