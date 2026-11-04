/**
 * The pages of a question on a pane surface, a layer 8 module (D-305..D-308, D-334): the init port whose ask shows a
 * question whose context frame is over the cap one page at a time, its page moves never reaching the stage. It imports
 * ui/pane (the frame cap and the pages), ui/preview (the dialog's option cap), core, the locale tables and the types;
 * init/run and regen/run ask through it, and the Review takes its page labels from it.
 */
import type { AskContext, AskSpec, ContextSection, InitIo } from '../../types'
import { labelled } from '../core/labelled'
import type { Labelled } from '../core/labelled'
import { t } from '../locales/t'
import { contextPages } from './pane'
import { MAX_DIALOG_OPTIONS } from './preview'
import type { Surface } from './surface'

/** The option that asks a paged question's next page (D-233, D-306). */
export const NEXT_PAGE_LABEL = t('init.review.nextPage')

/** The option that asks a paged question's page before (D-233, D-306). */
export const PREVIOUS_PAGE_LABEL = t('init.review.previousPage')

/** A page move an answer names: the next page or the one before. */
type PageMove = 'next' | 'previous'

/** How a paged question spreads its options over its pages (AskSpec pageOptions). */
type PageOptions = NonNullable<AskSpec['pageOptions']>

/**
 * The options of page `index` of `count` (D-306, D-307): Next page but on the last page, Previous page but on the
 * first, then the question's own options in their order, the `always` ones on every page, the `dropped` ones on none
 * and every other one on the last page only; Previous page is dropped first when the page would have more than
 * MAX_DIALOG_OPTIONS.
 */
function optionsAt(options: readonly string[], spread: PageOptions, index: number, count: number): string[] {
  const isLast = index === count - 1
  const own = options.filter(option => !spread.dropped.includes(option) && (isLast || spread.always.includes(option)))
  const next = isLast ? [] : [NEXT_PAGE_LABEL]
  const previous = index === 0 ? [] : [PREVIOUS_PAGE_LABEL]
  const all = [...next, ...previous, ...own]

  return all.length <= MAX_DIALOG_OPTIONS ? all : [...next, ...own]
}

/** The page move `answer` names among the page moves `options` offers, trimmed and in any case; else null. */
function moveOf(options: readonly string[], answer: string): PageMove | null {
  const moves: readonly Labelled<PageMove>[] = [
    { label: NEXT_PAGE_LABEL, value: 'next' },
    { label: PREVIOUS_PAGE_LABEL, value: 'previous' },
  ]

  return labelled(
    moves.filter(move => options.includes(move.label)),
    answer,
  )
}

/**
 * The spec of page `index` of `pages` (D-306, D-323, D-334): its options, and its context with that page's rows and
 * its page, its lines unchanged; the dialog line a pane surface asks gains the page marker, `page i of n`, as its last
 * line, the same text the pane draws as the frame's last row. A context with no pane text asks `question` with it.
 */
function pageSpec(
  spec: AskSpec,
  context: AskContext,
  question: string,
  pages: readonly (readonly ContextSection[])[],
  index: number,
  options: readonly string[],
): AskSpec {
  const count = pages.length
  const marker = t('ui.paging.marker', { number: index + 1, count })
  const pane =
    context.pane === undefined
      ? { asked: question, text: `${question}\n${marker}` }
      : { ...context.pane, text: `${context.pane.text}\n${marker}` }

  return { ...spec, options, context: { ...context, rows: pages[index] ?? [], page: { index, count }, pane } }
}

/**
 * Asks `question` of `spec` through `io`, a page at a time when it pages (D-306, D-307, D-308): only a spec with
 * pageOptions and a context with rows whose frame is over the cap at the width `columnsOf` reads (contextPages) pages;
 * any other is asked as given. Page 1 is asked first. An answer that names a page move the page offers asks that page
 * and never reaches the stage, so it is not a try; an option for the last page only, typed before the last page,
 * asks the next page, so nothing is accepted unseen (D-307); every other answer is the stage's. The items keep their
 * order and every item is on a page (D-308).
 */
async function pagedAsk(io: InitIo, question: string, spec: AskSpec, columnsOf: () => number | null): Promise<string> {
  const { context, pageOptions } = spec
  if (context === undefined || context.rows === undefined || pageOptions === undefined) return io.ask(question, spec)
  const pages = contextPages(context, columnsOf())
  if (pages.length < 2) return io.ask(question, spec)
  const lastOnly = spec.options
    .filter(option => !pageOptions.always.includes(option) && !pageOptions.dropped.includes(option))
    .map(label => ({ label, value: label }))
  let index = 0
  for (;;) {
    const options = optionsAt(spec.options, pageOptions, index, pages.length)
    const answer = await io.ask(question, pageSpec(spec, context, question, pages, index, options))
    const move = moveOf(options, answer)
    const isEarly = index < pages.length - 1 && labelled(lastOnly, answer) !== null
    if (move === 'next' || isEarly) {
      index += 1
      continue
    }
    if (move === 'previous') {
      index -= 1
      continue
    }

    return answer
  }
}

/**
 * The init port whose ask pages a question's context on a pane surface (D-305, D-306, D-307, D-308): a question whose
 * spec has pageOptions and whose context frame is over the cap at the width `columnsOf` reads is asked a page at a
 * time (pagedAsk); every other ask, and every other member, is the port's own. On the TUI default and on a surface that
 * shows no context the port is given back as it is.
 */
export function withPagedAsks(io: InitIo, surface: Surface, columnsOf: () => number | null): InitIo {
  if (surface !== 'pane') return io

  return { ...io, ask: async (question, spec) => pagedAsk(io, question, spec, columnsOf) }
}
