/**
 * The section split, a layer 3 module: an instruction file's sections, each started by a `# ` or `## ` line outside a
 * fenced block, the text before the first heading one section of its own, so the sections joined give the text back
 * (G-02-1f Part unit). Pure: it reads nothing. It imports core, so the instruction reads split a file here.
 */
import { MAX_HEADING_CHARS } from '../../core/names'
import { clean } from '../../core/text'

/** A section of an instruction file: its heading, '' for the text before the first one, and its text as read. */
export type Section = {
  readonly heading: string
  readonly text: string
}

/** A fence line: up to three spaces, a run of three or more backticks or tildes, then the rest of the line. */
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/s

/** Each line of a text with its line end, so the lines joined give the text back. */
function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

/** A line without its `\n` line end. */
function withoutLineEnd(line: string): string {
  return line.endsWith('\n') ? line.slice(0, -1) : line
}

/**
 * The fence open after a line, by its marker run: a fence line opens one when none is open, and closes the open one
 * only when it is of the same character, at least as long, and holds nothing else.
 */
function fenceAfter(fence: string | null, line: string): string | null {
  const match = FENCE_LINE.exec(line)
  const run = match?.[1]
  const rest = match?.[2]
  if (run === undefined || rest === undefined) return fence
  if (fence === null) return run
  const isClosing = run.charAt(0) === fence.charAt(0) && run.length >= fence.length && rest.trim() === ''

  return isClosing ? null : fence
}

/**
 * The heading a line starts, or null: only a line that starts with `# ` or `## ` does, and its heading is the text
 * after the hashes, trimmed, cleaned and cut to MAX_HEADING_CHARS code points.
 */
function headingOf(line: string): string | null {
  if (!line.startsWith('# ') && !line.startsWith('## ')) return null

  return clean(line.replace(/^#+/, '').trim(), MAX_HEADING_CHARS)
}

/** Adds a section to the list, unless it is the text before the first heading and that text is blank. */
function addSection(sections: Section[], heading: string | null, lines: readonly string[]): void {
  const text = lines.join('')
  if (heading === null && text.trim() === '') return
  sections.push({ heading: heading ?? '', text })
}

/**
 * An instruction file's sections (G-02-1f Part unit): a line that starts with `# ` or `## ` outside a fenced block
 * starts a section, headed by its text after the hashes; `### ` does not split, and no line in a fenced block does.
 * The text before the first heading is one section with heading '' when it is not blank. Each section's text is as
 * read, its heading line included, so the sections joined give the text back (but a blank text before the first
 * heading).
 */
export function splitSections(text: string): Section[] {
  const sections: Section[] = []
  let heading: string | null = null
  let lines: string[] = []
  let fence: string | null = null
  for (const line of linesOf(text)) {
    const isFenced = fence !== null
    fence = fenceAfter(fence, withoutLineEnd(line))
    const found = isFenced ? null : headingOf(withoutLineEnd(line))
    if (found !== null) {
      addSection(sections, heading, lines)
      heading = found
      lines = []
    }
    lines.push(line)
  }
  addSection(sections, heading, lines)

  return sections
}
