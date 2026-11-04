/**
 * The pages of a question on a pane surface, a layer 8 module (D-305..D-308, D-329, D-334, D-335): the init port whose
 * ask shows a question whose context frame is over the cap one page at a time, its page moves never reaching the
 * stage. It imports ui/pane (the frame cap and the pages), ui/preview (the dialog's option cap), core, the locale
 * tables and the types; init/run and regen/run ask through it, and the Review takes its page labels from it.
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

/** The option that asks a paged question's last page, where its own options are, from any page before it (D-335). */
export const LAST_PAGE_LABEL = t('ui.paging.lastPage')

/** A page move an answer names: the next page, the one before or the last. */
type PageMove = 'next' | 'previous' | 'last'

/** How a paged question spreads its options over its pages (AskSpec pageOptions). */
type PageOptions = NonNullable<AskSpec['pageOptions']>

/** How a question with no pageOptions is paged (D-329): every option of its own on the last page only. */
const LAST_PAGE_ONLY: PageOptions = { always: [], dropped: [] }

/**
 * The options of page `index` of `count` (D-306, D-307, D-329, D-335): Next page but on the last page, Previous page
 * but on the first, and Last page but on the last when no option of its own shows on every page, so no page has fewer
 * than two options; then the question's own options in their order, the `always` ones on every page, the `dropped` ones
 * on none and every other one on the last page only. Previous page is dropped first when the page would have more
 * than MAX_DIALOG_OPTIONS.
 */
function optionsAt(options: readonly string[], spread: PageOptions, index: number, count: number): string[] {
  const isLast = index === count - 1
  const own = options.filter(option => !spread.dropped.includes(option) && (isLast || spread.always.includes(option)))
  const next = isLast ? [] : [NEXT_PAGE_LABEL]
  const previous = index === 0 ? [] : [PREVIOUS_PAGE_LABEL]
  const last = isLast || spread.always.length > 0 ? [] : [LAST_PAGE_LABEL]
  const all = [...next, ...previous, ...last, ...own]

  return all.length <= MAX_DIALOG_OPTIONS ? all : [...next, ...last, ...own]
}

/** The page move `answer` names among the page moves `options` offers, trimmed and in any case; else null. */
function moveOf(options: readonly string[], answer: string): PageMove | null {
  const moves: readonly Labelled<PageMove>[] = [
    { label: NEXT_PAGE_LABEL, value: 'next' },
    { label: PREVIOUS_PAGE_LABEL, value: 'previous' },
    { label: LAST_PAGE_LABEL, value: 'last' },
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
 * Asks `question` of `spec` through `io`, a page at a time when it pages (D-306, D-307, D-308, D-329, D-335): a spec
 * whose context has rows and a frame over the cap at the width `columnsOf` reads (contextPages) pages, spread by its
 * pageOptions or, with none, with its options on the last page only; any other is asked as given. Page 1 is asked
 * first. An answer that names a page move the page offers, Next, Previous or Last page, asks that page and never
 * reaches the stage, so it is not a try; an option for the last page only, typed before the last page, asks the next
 * page, so nothing is accepted unseen (D-307); every other answer, a typed one too, is the stage's. The items keep
 * their order and every item is on a page (D-308). While `isInline` says the pane is seated inline, checked at each
 * ask, the question is asked as given: an inline pane previews the whole context in the dialog, which pages cannot
 * change (N-02, OC-04-I).
 */
async function pagedAsk(
  io: InitIo,
  question: string,
  spec: AskSpec,
  columnsOf: () => number | null,
  isInline: () => boolean,
): Promise<string> {
  const { context } = spec
  if (context === undefined || context.rows === undefined || isInline()) return io.ask(question, spec)
  const pages = contextPages(context, columnsOf())
  if (pages.length < 2) return io.ask(question, spec)
  const pageOptions = spec.pageOptions ?? LAST_PAGE_ONLY
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
    if (move === 'last') {
      index = pages.length - 1
      continue
    }

    return answer
  }
}

/**
 * The init port whose ask pages a question's context on a pane surface (D-305, D-306, D-307, D-308, D-329): every
 * question whose context frame is over the cap at the width `columnsOf` reads is asked a page at a time (pagedAsk),
 * a hand-out entry or a plugin group by its pageOptions and any other, Yes/No, diff or list, with its options on the
 * last page only (D-335); every other ask, and every other member, is the port's own. A pane seated inline, which
 * `isInline` reads at each ask (never inline when absent), previews the whole context in the dialog, which pages
 * cannot change (N-02, OC-04-I), so it is not paged. On the TUI default and on a surface that shows no context the
 * port is given back as it is.
 */
export function withPagedAsks(
  io: InitIo,
  surface: Surface,
  columnsOf: () => number | null,
  isInline: () => boolean = () => false,
): InitIo {
  if (surface !== 'pane') return io

  return { ...io, ask: async (question, spec) => pagedAsk(io, question, spec, columnsOf, isInline) }
}
