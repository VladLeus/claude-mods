import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, AskSpec, ContextRow } from '../../types'
import { oversizeGroupWorld, oversizeWorld } from '../golden/worlds'
import { runInit } from '../init/run'
import { INIT_ANSWERS, memIo, memWorld, OWN_SKILLS_ENTRY_PREFIX } from '../testkit'
import type { MemRun, MemWorld } from '../testkit'
import { contextPages, frameSize, MAX_PANE_FRAME_CHARS, MAX_PANE_FRAME_ROWS, paneBlockOf, paneDrawn } from './pane'
import type { PaneBlock } from './pane'
import { NEXT_PAGE_LABEL, PREVIOUS_PAGE_LABEL, withPagedAsks } from './paging'
import { MAX_DIALOG_OPTIONS } from './preview'

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

  test('a pane seated inline asks an over-cap context once, unpaged; else it pages as before (N-02)', async () => {
    const entry = await oversizeEntry()
    const inline = memIo(memWorld({}), ['Go one by one'])
    const answer = await withPagedAsks(inline.io, 'pane', () => null, () => true).ask(entry.question, entry.spec)
    expect([answer, inline.asked, inline.specs]).toEqual(['Go one by one', [entry.question], [entry.spec]])
    for (const isInline of [() => false, undefined]) {
      const docked = memIo(memWorld({}), [NEXT_PAGE_LABEL, NEXT_PAGE_LABEL, 'Go one by one'])
      await withPagedAsks(docked.io, 'pane', () => null, isInline).ask(entry.question, entry.spec)
      expect(pageIndexes(docked)).toEqual([0, 1, 2])
    }
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

describe('every other question over the cap (D-329, D-335)', () => {
  /** The start of the own skills' whole-group question of oversizeWorld. */
  const WHOLE_PREFIX = 'Which roles get your own skills'

  /** A context of `count` env names, each an item with a description row: three pages for 100, two for 60. */
  function envContext(count: number): AskContext {
    const rows: ContextRow[] = Array.from({ length: count }, (_, at): ContextRow[] => [
      { role: 'item', label: `ENV_${at}`, text: 'be', indent: 2 },
      { role: 'description', text: 'abcd abcd abcd', indent: 4 },
    ]).flat()

    return { title: 'Env', lines: [], kind: 'env', summary: `${count} names`, rows: [{ title: null, rows }] }
  }

  /** A Yes/No question with no pageOptions whose context lists `count` env names. */
  function yesNo(count: number): AskSpec {
    return { options: ['Yes', 'No'], header: 'Env', context: envContext(count) }
  }

  /** `spec` asked through the paged port of a pane surface at no known width, its pages answered by `answers`. */
  async function askedPaged(
    spec: AskSpec,
    answers: readonly string[],
  ): Promise<{ readonly answer: string; readonly inner: MemRun }> {
    const inner = memIo(memWorld({}), answers)
    const answer = await withPagedAsks(inner.io, 'pane', () => null).ask('Carry these env names?', spec)

    return { answer, inner }
  }

  test('a Yes/No of three pages offers Next and Last page, then Previous too, then Previous and its own', async () => {
    const { answer, inner } = await askedPaged(yesNo(100), ['Next page', 'Next page', 'No'])
    expect(inner.specs.map(spec => spec.options)).toEqual([
      ['Next page', 'Last page'],
      ['Next page', 'Previous page', 'Last page'],
      ['Previous page', 'Yes', 'No'],
    ])
    expect(answer).toBe('No')
  })

  test('with two pages, page 1 offers Next and Last page, and page 2 Previous page and its own options', async () => {
    const { inner } = await askedPaged(yesNo(60), ['Next page', 'Yes'])
    expect(inner.specs.map(spec => spec.options)).toEqual([
      ['Next page', 'Last page'],
      ['Previous page', 'Yes', 'No'],
    ])
  })

  test('Last page asks the last page, never reaching the stage; Previous page there asks the one before', async () => {
    const { answer, inner } = await askedPaged(yesNo(100), [' last PAGE ', 'Previous page', 'Last page', 'Yes'])
    expect(pageIndexes(inner)).toEqual([0, 2, 1, 2])
    expect(answer).toBe('Yes')
  })

  test('an option of its own typed before the last page asks the next page; only the last page takes it', async () => {
    const { answer, inner } = await askedPaged(yesNo(100), ['yes', 'Yes', 'YES'])
    expect(pageIndexes(inner)).toEqual([0, 1, 2])
    expect(answer).toBe('YES')
  })

  test('a question of four options drops Previous page on its last page, so no dialog has more than four', async () => {
    const spec = { options: ['a', 'b', 'c', 'd'], header: 'Pick', context: envContext(60) }
    const { inner } = await askedPaged(spec, ['Next page', 'a'])
    expect(inner.specs.map(asked => asked.options)).toEqual([
      ['Next page', 'Last page'],
      ['a', 'b', 'c', 'd'],
    ])
  })

  test('a whole-group question has None and All roles on its last page only; a typed role list is read', async () => {
    const answers = { ...OVERSIZE_ANSWERS, [OWN_SKILLS_ENTRY_PREFIX]: 'Whole group' }
    const whole = await askedBefore(oversizeWorld({ replies: OVERSIZE_REPLIES }), answers, WHOLE_PREFIX)
    const walked = memIo(memWorld({}), ['Next page', 'Next page', 'None'])
    expect(await withPagedAsks(walked.io, 'pane', () => null).ask(whole.question, whole.spec)).toBe('None')
    expect(walked.specs.map(spec => spec.options)).toEqual([
      ['Next page', 'Last page'],
      ['Next page', 'Previous page', 'Last page'],
      ['Previous page', 'None', 'All roles'],
    ])
    const typed = memIo(memWorld({}), ['be, qa'])
    expect(await withPagedAsks(typed.io, 'pane', () => null).ask(whole.question, whole.spec)).toBe('be, qa')
    expect(pageIndexes(typed)).toEqual([0])
  })

  test('every question of the oversize worlds fits both frame caps and offers two to four options', async () => {
    const runs: readonly (readonly [MemWorld, Readonly<Record<string, string>>])[] = [
      [oversizeWorld({ replies: OVERSIZE_REPLIES }), OVERSIZE_ANSWERS],
      [oversizeWorld({ replies: OVERSIZE_REPLIES }), { ...OVERSIZE_ANSWERS, [OWN_SKILLS_ENTRY_PREFIX]: 'Whole group' }],
      [oversizeGroupWorld({ replies: GROUP_REPLIES }), INIT_ANSWERS],
      [oversizeGroupWorld({ replies: GROUP_REPLIES }), { ...INIT_ANSWERS, [GROUP_PREFIX]: 'Accept recommendation' }],
    ]
    for (const [world, answers] of runs) {
      const run = memIo(world, answers)
      await runInit(run.io, { dryRun: true })
      for (const spec of run.specs) {
        expect(spec.options.length >= 2 && spec.options.length <= MAX_DIALOG_OPTIONS).toBe(true)
        const context = spec.context ?? null
        const open = { question: '', header: '', context, acceptsTyped: false, takesNote: false }
        const block = paneBlockOf({ open, loader: null })
        const size = block === null ? { rows: 0, chars: 0 } : frameSize(block, null)
        expect(size.rows <= MAX_PANE_FRAME_ROWS && size.chars <= MAX_PANE_FRAME_CHARS).toBe(true)
      }
    }
  })
})
