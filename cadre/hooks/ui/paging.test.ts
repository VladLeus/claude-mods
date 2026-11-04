import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, AskSpec } from '../../types'
import { oversizeGroupWorld, oversizeWorld } from '../golden/worlds'
import { runInit } from '../init/run'
import { INIT_ANSWERS, memIo, memWorld, OWN_SKILLS_ENTRY_PREFIX } from '../testkit'
import type { MemRun, MemWorld } from '../testkit'
import { contextPages, MAX_PANE_FRAME_CHARS, MAX_PANE_FRAME_ROWS, paneDrawn } from './pane'
import type { PaneBlock } from './pane'
import { NEXT_PAGE_LABEL, PREVIOUS_PAGE_LABEL, withPagedAsks } from './paging'

/** The model's replies of an oversize run: no server recommended, the first own skill recommended for the PM. */
const OVERSIZE_REPLIES = ['{"servers":{}}', '{"skills":{"S1":["pm"]},"groups":{}}']

/** The answers of an oversize run: the init answers, the own skills' recommendations accepted. */
const OVERSIZE_ANSWERS = { ...INIT_ANSWERS, [OWN_SKILLS_ENTRY_PREFIX]: 'Accept recommendations' }

/** The own-skills entry's answers on its last page, in the order the dialog shows them (D-306). */
const LAST_PAGE_OPTIONS = ['Previous page', 'Accept recommendations', 'Go one by one', 'Whole group']

/** The model's reply of an oversize group run: the bigkit group recommended for the PM. */
const GROUP_REPLIES = ['{"skills":{},"groups":{"G1":["pm"]}}']

/** The start of the bigkit plugin group question of oversizeGroupWorld. */
const GROUP_PREFIX = 'Which roles get bigkit skills'

/**
 * The first question `prefix` starts of a dry run over `world` answered by `answers`, as its stage asks it, before any
 * page: its question and spec, read on the TUI default, which is given the port as it is.
 */
async function askedBefore(
  world: MemWorld,
  answers: Readonly<Record<string, string>>,
  prefix: string,
): Promise<{ readonly question: string; readonly spec: AskSpec }> {
  const run = memIo(world, answers)
  await runInit(run.io, { dryRun: true, surface: 'tui-default' })
  const at = run.asked.findIndex(question => question.startsWith(prefix))
  const spec = run.specs[at]
  if (spec === undefined) throw new Error(`the run asked no question starting ${prefix}`)

  return { question: run.asked[at] ?? '', spec }
}

/** The own-skills entry of an oversize dry run as its stage asks it, before any page. */
async function oversizeEntry(): Promise<{ readonly question: string; readonly spec: AskSpec }> {
  return askedBefore(oversizeWorld({ replies: OVERSIZE_REPLIES }), OVERSIZE_ANSWERS, OWN_SKILLS_ENTRY_PREFIX)
}

/** The bigkit plugin group question of an oversize group dry run as its stage asks it, before any page (D-328). */
async function oversizeGroup(): Promise<{ readonly question: string; readonly spec: AskSpec }> {
  return askedBefore(oversizeGroupWorld({ replies: GROUP_REPLIES }), INIT_ANSWERS, GROUP_PREFIX)
}

/** The oversize own-skills entry's context: its stage always gives it one. */
function entryContext(spec: AskSpec): AskContext {
  if (spec.context === undefined || spec.context === null) throw new Error('the own-skills entry has no context')

  return spec.context
}

/**
 * The oversize own-skills entry asked through the paged port of a pane surface at no known width, its pages answered
 * by `answers` in turn: what the stage gets, and the port under it as memIo recorded each page.
 */
async function pagedEntry(answers: readonly string[]): Promise<{ readonly answer: string; readonly inner: MemRun }> {
  const entry = await oversizeEntry()
  const inner = memIo(memWorld({}), answers)
  const answer = await withPagedAsks(inner.io, 'pane', () => null).ask(entry.question, entry.spec)

  return { answer, inner }
}

/** The pane block of a paged spec's context, as paneBlockOf gives it for the open question (D-313, D-334). */
function blockOf(spec: AskSpec): PaneBlock {
  const context = entryContext(spec)
  const block = { title: context.title, summary: context.summary, rows: context.rows ?? null, lines: context.lines }

  return context.page === undefined ? block : { ...block, page: context.page }
}

/** The index of the page each spec asked. */
function pageIndexes(inner: MemRun): (number | undefined)[] {
  return inner.specs.map(spec => spec.context?.page?.index)
}

describe('withPagedAsks (D-305, D-306, D-307, D-308)', () => {
  test('the oversize own-skills entry is three pages: Accept on the last only, the other two on each', async () => {
    const { answer, inner } = await pagedEntry([NEXT_PAGE_LABEL, NEXT_PAGE_LABEL, 'Go one by one'])
    expect(inner.specs.map(spec => spec.options)).toEqual([
      ['Next page', 'Go one by one', 'Whole group'],
      ['Next page', 'Previous page', 'Go one by one', 'Whole group'],
      LAST_PAGE_OPTIONS,
    ])
    expect(answer).toBe('Go one by one')
  })

  test("each page's context has its page and rows, its lines kept, its dialog line ending in page i of n", async () => {
    const entry = await oversizeEntry()
    const context = entryContext(entry.spec)
    const { inner } = await pagedEntry([NEXT_PAGE_LABEL, NEXT_PAGE_LABEL, 'Whole group'])
    expect(inner.specs.map(spec => spec.context?.page)).toEqual([
      { index: 0, count: 3 },
      { index: 1, count: 3 },
      { index: 2, count: 3 },
    ])
    expect(inner.specs.map(spec => spec.context?.rows)).toEqual(contextPages(context, null))
    expect(inner.specs.map(spec => spec.context?.lines)).toEqual([context.lines, context.lines, context.lines])
    const markers = inner.specs.map(spec => spec.context?.pane?.text.split('\n').at(-1))
    expect(markers).toEqual(['page 1 of 3', 'page 2 of 3', 'page 3 of 3'])
    expect(inner.asked).toEqual([entry.question, entry.question, entry.question])
  })

  test('every page fits both frame caps and the pane draws its marker as its last row (D-305, D-334)', async () => {
    const { inner } = await pagedEntry([NEXT_PAGE_LABEL, NEXT_PAGE_LABEL, 'Whole group'])
    for (const spec of inner.specs) {
      const drawn = paneDrawn(blockOf(spec), 60)
      const chars = drawn.flatMap(row => row.spans).reduce((sum, span) => sum + Array.from(span.text).length, 0)
      expect(drawn.length <= MAX_PANE_FRAME_ROWS && chars <= MAX_PANE_FRAME_CHARS).toBe(true)
      const marker = `page ${(spec.context?.page?.index ?? -1) + 1} of 3`
      expect(drawn.at(-1)).toEqual({ spans: [{ text: marker, dim: true }] })
    }
  })

  test('Next page and Previous page ask that page and never reach the stage, so neither is a try', async () => {
    const { answer, inner } = await pagedEntry([NEXT_PAGE_LABEL, ' previous PAGE ', NEXT_PAGE_LABEL, 'Go one by one'])
    expect(pageIndexes(inner)).toEqual([0, 1, 0, 1])
    expect(answer).toBe('Go one by one')
  })

  test('Accept before the last page asks the next one, so no unseen item is taken; the last takes it', async () => {
    const accept = 'Accept recommendations'
    const { answer, inner } = await pagedEntry([accept, accept, accept])
    expect(pageIndexes(inner)).toEqual([0, 1, 2])
    expect(inner.specs.at(-1)?.options).toEqual(LAST_PAGE_OPTIONS)
    expect(answer).toBe(accept)
  })

  test('Whole group on page 1 is answered at once, and so is a typed answer the stage reads itself', async () => {
    const whole = await pagedEntry(['Whole group'])
    expect([whole.answer, pageIndexes(whole.inner)]).toEqual(['Whole group', [0]])
    const typed = await pagedEntry(['be, qa'])
    expect([typed.answer, pageIndexes(typed.inner)]).toEqual(['be, qa', [0]])
  })

  test('the TUI default and a surface that shows no context are given the port as it is', () => {
    const { io } = memIo(memWorld({}), [])
    expect(withPagedAsks(io, 'tui-default', () => null)).toBe(io)
    expect(withPagedAsks(io, 'none', () => null)).toBe(io)
  })

  test('a context whose frame fits is asked unchanged', async () => {
    const entry = await oversizeEntry()
    const context = entryContext(entry.spec)
    const rows = (context.rows ?? []).map(section => ({ ...section, rows: section.rows.slice(0, 2) }))
    const fitting = { ...entry.spec, context: { ...context, rows } }
    const inner = memIo(memWorld({}), ['Whole group'])
    expect(await withPagedAsks(inner.io, 'pane', () => null).ask(entry.question, fitting)).toBe('Whole group')
    expect(inner.specs).toEqual([fitting])
  })
})

describe('a paged plugin group (D-328)', () => {
  test('Go one by one is on every page, Accept recommendation on the last, None and All roles on none', async () => {
    const group = await oversizeGroup()
    const inner = memIo(memWorld({}), [NEXT_PAGE_LABEL, NEXT_PAGE_LABEL, 'Accept recommendation'])
    const answer = await withPagedAsks(inner.io, 'pane', () => null).ask(group.question, group.spec)
    expect(inner.specs.map(spec => spec.options)).toEqual([
      ['Next page', 'Go one by one'],
      ['Next page', 'Previous page', 'Go one by one'],
      ['Previous page', 'Accept recommendation', 'Go one by one'],
    ])
    expect(answer).toBe('Accept recommendation')
  })

  test('a typed none, all or role list on any page reaches the stage as typed, to be read as today', async () => {
    const group = await oversizeGroup()
    for (const typed of ['none', 'All roles', 'all', 'be, qa']) {
      const inner = memIo(memWorld({}), [NEXT_PAGE_LABEL, typed])
      expect(await withPagedAsks(inner.io, 'pane', () => null).ask(group.question, group.spec)).toBe(typed)
      expect(pageIndexes(inner)).toEqual([0, 1])
    }
  })
})
