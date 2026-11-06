/**
 * The CLAUDE.md import rule, a layer 3 module: the files a CLAUDE.md imports with `@path`, as sorted absolute paths
 * once each, an `@` inside a code span, a fenced block or a word not counted (D-63, 02-GAPS-B2 M1). Pure: it reads
 * nothing. It imports core and paths, so the instruction reads and /cadre start follow the imports here.
 */
import { sortedUnique } from '../../core/text'
import { resolveSegments } from '../../paths'

/** A token after an `@`: the `@` starts the text or follows white space, and the token runs to the next white space. */
const IMPORT_TOKEN = /(?:^|\s)@(\S+)/g

/**
 * The characters that end a sentence rather than a path, when they trail an import. The pattern is anchored at the
 * start of the mark run, so a long run of marks is linear (02-GAPS-B2 M1).
 */
const TRAILING_MARKS = /(?<![.,;:!?)\]}>"'])[.,;:!?)\]}>"']+$/

/** The most code points an import token may have; no import path is longer (02-GAPS-B2 M1). */
const MAX_IMPORT_TOKEN_CHARS = 4_096

/** A relative import with nothing in front of it: a name or path of plain characters that ends in `.md`. */
const BARE_MARKDOWN = /^[A-Za-z0-9_.]\S*\.md$/i

/** A run of backticks in a text: where it starts, and where it ends (exclusive). */
type BacktickRun = {
  readonly start: number
  readonly end: number
}

/** Every run of backticks in the text, in order. */
function backtickRuns(text: string): BacktickRun[] {
  const runs: BacktickRun[] = []
  let start = text.indexOf('`')
  while (start !== -1) {
    let end = start
    while (text[end] === '`') end += 1
    runs.push({ start, end })
    start = text.indexOf('`', end)
  }

  return runs
}

/** The index of the next run after `opener` that is as long as it is, which closes the span it opens; -1 for none. */
function closingRun(runs: readonly BacktickRun[], opener: number): number {
  const first = runs[opener]
  if (first === undefined) return -1
  const length = first.end - first.start
  for (let next = opener + 1; next < runs.length; next += 1) {
    const run = runs[next]
    if (run !== undefined && run.end - run.start === length) return next
  }

  return -1
}

/**
 * The text with every code span and fenced block replaced by a space, as an import inside code is not an import. A run
 * of backticks opens a span that the next run of the same length closes, so a fence of four backticks holds fences of
 * three; a run that closes nothing is plain text and hides nothing after it.
 */
function withoutCode(text: string): string {
  const runs = backtickRuns(text)
  const kept: string[] = []
  let copied = 0
  let opener = 0
  while (opener < runs.length) {
    const closer = closingRun(runs, opener)
    const first = runs[opener]
    const last = runs[closer]
    if (first === undefined || last === undefined) {
      opener += 1
      continue
    }
    kept.push(text.slice(copied, first.start), ' ')
    copied = last.end
    opener = closer + 1
  }
  kept.push(text.slice(copied))

  return kept.join('')
}

/**
 * The file one import token names, as an absolute path, or null when the token is not an import. A token starts with
 * `~/` (the home), `/`, `./` or `../` (the folder of the importing file), or is a bare relative path that ends in
 * `.md`. A sentence mark after the path is not part of it, and a folder is not a file. A token of more than
 * MAX_IMPORT_TOKEN_CHARS code points is no import (02-GAPS-B2 M1).
 */
function importPath(token: string, fileDir: string, home: string): string | null {
  if (Array.from(token).length > MAX_IMPORT_TOKEN_CHARS) return null
  const path = token.replace(TRAILING_MARKS, '')
  if (path === '' || path.endsWith('/')) return null
  if (path.startsWith('~/')) return resolveSegments(`${home}/${path.slice(2)}`)
  if (path.startsWith('/')) return resolveSegments(path)
  if (path.startsWith('./') || path.startsWith('../') || BARE_MARKDOWN.test(path)) {
    return resolveSegments(`${fileDir}/${path}`)
  }

  return null
}

/**
 * The files a CLAUDE.md imports (D-63 group 1), as sorted absolute paths once each. An import is an `@` that starts a
 * line or follows white space, and a token inside backticks or a fenced block is not one, nor is an `@` inside a word
 * such as an e-mail address. Paths resolve against the folder of the importing file (`fileDir`) and `~` against `home`,
 * with every `.` and `..` segment resolved away. It reads nothing: the caller reads each file and calls it again on
 * what that file imports.
 */
export function claudeMdImports(text: string, fileDir: string, home: string): string[] {
  const found: string[] = []
  for (const match of withoutCode(text).matchAll(IMPORT_TOKEN)) {
    const path = importPath(match[1] ?? '', fileDir, home)
    if (path !== null) found.push(path)
  }

  return sortedUnique(found)
}
