/**
 * The text helpers every module shares, a layer 0 leaf: clean and its display caps (reportText, shown, idLabel), list
 * and count wording (idsOrNone, countedNoun, asSentence, cardList), column padding, code unit order (compareText,
 * sortedUnique), UTF-8 sizes and ASCII lowercasing. It imports no other module, so facts, render, ask, history and
 * every later layer can import it with no cycle; ask.ts takes reportText from here, not from render.ts (C11).
 */

/** The character a cut value ends with. */
const ELLIPSIS = '\u2026'

/**
 * Strips control, bidi, format, surrogate and private-use characters from a foreign string and caps its length
 * with an ellipsis; anything that is not a string becomes ''. The length counts code points, not UTF-16 units.
 * `maxChars` must be at least 1; a smaller cap gives ''.
 */
export function clean(value: unknown, maxChars = 120): string {
  if (typeof value !== 'string' || maxChars < 1) return ''
  const stripped = value.replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, '')
  const points = Array.from(stripped)
  if (points.length <= maxChars) return stripped

  return `${points.slice(0, Math.max(0, maxChars - 1)).join('')}${ELLIPSIS}`
}

/**
 * Whether `clean` would change a foreign name at this cap: a stripped character, or a cut to the cap. Such a name is
 * never matched as a marker or a plugin key, because its cleaned form could pass for a real one (WR-03).
 */
export function isChangedByClean(value: string, maxChars: number): boolean {
  return clean(value, maxChars) !== value
}

/** Ids or names as a row or a context line names them: joined with `, `, or `none` for none (02-GAPS-B2 S7). */
export function idsOrNone(ids: readonly string[]): string {
  return ids.length === 0 ? 'none' : ids.join(', ')
}

/** A count with its noun, singular for exactly one: `1 file`, `0 files`, `2 files` (02-GAPS-B2 S7). */
export function countedNoun(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** The marks a sentence may end with: a period, a question mark or an exclamation mark. */
const SENTENCE_END = /[.!?]$/

/**
 * A text as the first sentence of a context line (02-GAPS-B2 N1): a final '.' added unless it already ends in '.', '!'
 * or '?'; '' stays ''.
 */
export function asSentence(text: string): string {
  if (text === '') return ''
  if (SENTENCE_END.test(text)) return text

  return `${text}.`
}

/** Orders two texts by code unit, so a sort never depends on the locale of the machine. */
export function compareText(a: string, b: string): number {
  if (a === b) return 0

  return a < b ? -1 : 1
}

/**
 * The names once each, in code unit order (compareText), as a new array: the same list on every host, whatever its
 * locale, so a list built from it hashes the same on every run. The input is never changed.
 */
export function sortedUnique(names: readonly string[]): string[] {
  return Array.from(new Set(names)).sort(compareText)
}

/** Code points of an id that a message shows. */
const MAX_ID_LABEL_CHARS = 40

/**
 * An id as message text: a string is cleaned and capped at 40 code points, so a hostile id cannot add a line or hide
 * itself, and anything else is a fixed token. It never stringifies a value.
 */
export function idLabel(id: unknown): string {
  if (typeof id !== 'string') return '<non-string id>'

  return clean(id, MAX_ID_LABEL_CHARS)
}

/** The length of a text in UTF-8 bytes, which is what a file size and a read cap count; not its UTF-16 length. */
export function utf8Bytes(text: string): number {
  let bytes = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }

  return bytes
}

/**
 * The most code points one report cell keeps, the ellipsis included. It is the same cap facts.ts gives a host warning,
 * so no untrusted text reaches the report longer than a warning may be.
 */
const MAX_REPORT_CHARS = 240

/** The most code points of a scanned name that a card rule or a warning shows. A scanned name is data, not trusted. */
const MAX_SHOWN_CHARS = 110

/** The most names one card list shows before it counts the rest. */
export const MAX_CARD_LIST = 12

/**
 * The text padded with spaces to a column width in code points. A text already at the width or longer gets one
 * trailing space, so two columns never run together.
 */
export function pad(text: string, width: number): string {
  const length = Array.from(text).length
  if (length >= width) return `${text} `

  return `${text}${' '.repeat(width - length)}`
}

/**
 * Text from Facts or a detection as the report may show it: unsafe characters removed, then capped at MAX_REPORT_CHARS
 * code points. The plan and card renderers reuse it for every value that comes from outside the code, so a hostile
 * value cannot add a line or hide text.
 */
export function reportText(text: string): string {
  return clean(text, MAX_REPORT_CHARS)
}

/**
 * A scanned name, pattern or path as a card rule or a warning shows it: unsafe characters removed and the length
 * capped at `maxChars` code points, MAX_SHOWN_CHARS unless the caller keeps a cap of its own. Map with an arrow
 * (`names.map(name => shown(name))`), never `map(shown)`: map passes the index second, which would become the cap.
 */
export function shown(value: string, maxChars = MAX_SHOWN_CHARS): string {
  return clean(value, maxChars)
}

/** The last item of a list that counts the names it leaves out: `+N more`, the one wording every capped list uses. */
export function moreLine(count: number): string {
  return `+${count} more`
}

/**
 * A list as a card line or rule shows it: `none` when empty, else the names, past 12 of them the first 12 and
 * `+N more`. A rule passes each scanned name through `shown` first. A line can still pass the 240 code points a card
 * line keeps, so a rule puts its fixed text before a list, or on its own line, never after it (B6).
 */
export function cardList(names: readonly string[]): string {
  if (names.length === 0) return 'none'
  const rest = names.length - MAX_CARD_LIST
  if (rest <= 0) return names.join(', ')

  return [...names.slice(0, MAX_CARD_LIST), moreLine(rest)].join(', ')
}

/**
 * A name with only A-Z lowercased, every other character as it is: the form the history scan keeps a name in, so the
 * scan and the skill hints share one rule and a skill name in any ASCII case finds its count (D-59, WR-02).
 */
export function asciiLower(name: string): string {
  return name.replace(/[A-Z]/g, letter => letter.toLowerCase())
}
