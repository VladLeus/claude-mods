import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, AskSpec, ContextRow, InitIo, OpenQuestion } from '../../../types'
import { CONFLICT_OPTIONS, conflictContext } from '../../apply/conflict'
import { isObject } from '../../core/json'
import { memIo, memWorld } from '../../testkit'
import { lineDiff } from '../diff'
import type { DiffRow } from '../diff'
import { wrapLine } from '../pane'
import { NEXT_PAGE_LABEL, PREVIOUS_PAGE_LABEL } from '../paging'
import { PREVIEW_LINE_ROWS, previewMarkdown } from '../preview'
import type { PageView } from './contract'
import { TUI_DEFAULT } from './tui-default'

/** One single-select AskUserQuestion question with two options and no preview, as a model asks it (D3). */
const PICK_QUESTION = {
  question: 'Pick one?',
  header: 'Pick',
  multiSelect: false,
  options: [
    { label: 'A', description: 'a' },
    { label: 'B', description: 'b' },
  ],
}

/**
 * PICK_QUESTION as register keeps it open, with no context: it takes a typed answer, and so a note (D-234, D-270).
 */
const PICK_OPEN: OpenQuestion = {
  question: 'Pick one?',
  header: 'Pick',
  context: null,
  acceptsTyped: true,
  takesNote: true,
}

/** The open question's own context (D-203). */
const CONTEXT: AskContext = {
  title: 'Roles',
  lines: ['BE (be)', 'FE (fe)'],
  kind: 'roles',
  summary: '2 roles: be, fe',
}

/** The preview of each option of each question a dialog would show; undefined where an option has none. */
function optionPreviews(questions: readonly Record<string, unknown>[] | undefined): unknown[][] {
  return (questions ?? []).map(question => {
    const options: unknown = question.options

    return Array.isArray(options) ? options.map(option => (isObject(option) ? option.preview : undefined)) : []
  })
}

describe('TUI_DEFAULT.dialogPlan (WD-S2, D-353)', () => {
  test('a call whose first question is not the open question, by its exact text, gets no plan (D-239)', () => {
    const open: OpenQuestion = { ...PICK_OPEN, context: CONTEXT }
    for (const raw of [null, [], [{ question: 3, options: [] }], [{ ...PICK_QUESTION, question: 'Pick one? ' }]]) {
      expect(TUI_DEFAULT.dialogPlan(raw, open, null, null)).toBe(null)
    }
  })
})

describe('the TUI-default preview rows (WD-S3)', () => {
  /** A context of `count` lines `line 1`, `line 2`, ...: an own-skills list. */
  function linesContext(count: number): AskContext {
    return {
      title: 'Lines',
      lines: Array.from({ length: count }, (_, at) => `line ${at + 1}`),
      kind: 'skills',
      summary: `${count} lines`,
    }
  }

  test('with the title and marker rows counted, 21 lines show 19 and +2 more above; 20 fit whole (D-260)', () => {
    const cases: readonly (readonly [number, readonly string[]])[] = [
      [22, [...linesContext(19).lines, '+3 more above']],
      [21, [...linesContext(19).lines, '+2 more above']],
      [20, linesContext(20).lines],
    ]
    for (const [count, shown] of cases) {
      const context = linesContext(count)
      const open: OpenQuestion = { ...PICK_OPEN, context, acceptsTyped: false, takesNote: false }
      const plan = TUI_DEFAULT.dialogPlan([PICK_QUESTION], open, null, null)
      const [previews = []] = optionPreviews(plan?.questions ?? undefined)
      expect([count, previews[0]]).toEqual([count, previewMarkdown([{ ...context, lines: shown }])])
    }
  })
})

describe('the TUI-default preview by wrapped rows (D-260)', () => {
  test('a preview keeps the whole lines whose rows at its columns fit with the title and marker rows', () => {
    // 15 lines of 100 characters and no space: three rows each at 40 columns.
    const lines = Array.from({ length: 15 }, (_, at) => String(at).padStart(2, '0').padEnd(100, 'x'))
    const context: AskContext = { title: 'Lines', lines, kind: 'skills', summary: '15 lines' }
    const open: OpenQuestion = { ...PICK_OPEN, context, acceptsTyped: false, takesNote: false }
    const plan = TUI_DEFAULT.dialogPlan([PICK_QUESTION], open, null, 40)
    const [previews = []] = optionPreviews(plan?.questions ?? undefined)
    const shown = [...lines.slice(0, 6), '+9 more above']
    expect(previews[0]).toBe(previewMarkdown([{ ...context, lines: shown }], 40))
    const rows = 1 + shown.flatMap(line => wrapLine(line, 40)).length
    expect([rows <= PREVIEW_LINE_ROWS, rows + wrapLine(lines[6] ?? '', 40).length > PREVIEW_LINE_ROWS]).toEqual([
      true,
      true,
    ])
  })
})

describe('the TUI-default paged conflict question', () => {
  const VIEW: PageView = { columns: () => 80, seat: () => null, rows: () => null }
  const QUESTION = 'ROLE.md changed since cadre wrote it. Keep mine or take new?'

  /** The conflict question over a diff of `count` changed lines. */
  function conflictSpec(count: number): AskSpec {
    const before = Array.from({ length: count }, (_, at) => `old ${at + 1}`).join('\n')
    const after = Array.from({ length: count }, (_, at) => `new ${at + 1}`).join('\n')
    const context = conflictContext('.cadre/roles/be/ROLE.md', lineDiff(before, after))

    return { options: CONFLICT_OPTIONS, header: 'Conflict', context }
  }

  /** A port that records every ask and answers Next page while a page offers it, then `answer`. */
  function recordingIo(answer: string): { readonly io: InitIo; readonly specs: AskSpec[] } {
    const base = memIo(memWorld({}), [])
    const specs: AskSpec[] = []
    const io: InitIo = {
      ...base.io,
      ask: async (_question, spec) => {
        specs.push(spec)

        return spec.options.includes(NEXT_PAGE_LABEL) ? NEXT_PAGE_LABEL : answer
      },
    }

    return { io, specs }
  }

  /** The conflict question over a diff that adds `lines` and removes none. */
  function addedSpec(lines: readonly string[]): AskSpec {
    const rows = lines.map((line): DiffRow => ({ kind: 'added', line }))
    const context = conflictContext('.cadre/roles/be/ROLE.md', { rows, added: rows.length, removed: 0 })

    return { options: CONFLICT_OPTIONS, header: 'Conflict', context }
  }

  /** The preview the TUI default gives the dialog of one asked page at `columns`. */
  function pagePreview(spec: AskSpec, columns: number | null = 80): unknown {
    const options = spec.options.map(label => ({ label, description: label }))
    const raw = [{ question: QUESTION, header: 'Conflict', multiSelect: false, options }]
    const open: OpenQuestion = {
      question: QUESTION,
      header: 'Conflict',
      context: spec.context ?? null,
      acceptsTyped: false,
      takesNote: false,
    }
    const [previews = []] = optionPreviews(TUI_DEFAULT.dialogPlan(raw, open, null, columns)?.questions ?? undefined)

    return previews[0]
  }

  test('a long conflict diff is asked a page at a time, each preview showing its page and no marker', async () => {
    const spec = conflictSpec(200)
    const { io, specs } = recordingIo('Take new')
    const answer = await TUI_DEFAULT.pagedPort(io, VIEW).ask(QUESTION, spec)
    expect(answer).toBe('Take new')
    expect(specs.length).toBeGreaterThan(1)
    expect(specs[0]?.options[0]).toBe(NEXT_PAGE_LABEL)
    expect(specs.at(-1)?.options).toEqual([PREVIOUS_PAGE_LABEL, ...CONFLICT_OPTIONS])
    for (const page of specs) {
      const context = page.context
      if (context === undefined) throw new Error('a page has no context')
      expect(context.lines).toEqual(spec.context?.lines ?? [])
      const texts = (context.rows ?? []).flatMap(section => section.rows.map(row => row.text))
      expect(texts.length).toBeGreaterThan(0)
      const preview = pagePreview(page)
      expect(preview).toBe(previewMarkdown([{ ...context, lines: texts }], 80))
      expect(String(preview)).not.toContain('more above')
    }
  })

  test('a short conflict diff that fits the preview is asked once, as given', async () => {
    const spec = conflictSpec(3)
    const { io, specs } = recordingIo('Keep mine')
    expect(await TUI_DEFAULT.pagedPort(io, VIEW).ask(QUESTION, spec)).toBe('Keep mine')
    expect(specs).toEqual([spec])
  })

  test('on a wide preview each diff line is whole on exactly one page and no page preview is cut', async () => {
    const wide: PageView = { ...VIEW, columns: () => 122 }
    const spec = addedSpec(Array.from({ length: 60 }, (_, at) => `${'lorem ipsum '.repeat(18)}END${at + 1}X`))
    const { io, specs } = recordingIo('Take new')
    expect(await TUI_DEFAULT.pagedPort(io, wide).ask(QUESTION, spec)).toBe('Take new')
    expect(specs.length).toBeGreaterThan(1)
    const texts = specs.map(page => (page.context?.rows ?? []).flatMap(section => section.rows.map(row => row.text)))
    expect(texts.flat()).toEqual(spec.context?.lines ?? [])
    for (const [at, page] of specs.entries()) {
      const preview = String(pagePreview(page, 122))
      expect(preview).toBe(previewMarkdown([{ title: page.context?.title ?? '', lines: texts[at] ?? [] }], 122))
      expect([preview.endsWith('\n…'), preview.includes('more above')]).toEqual([false, false])
    }
  })

  test('a diff that fills the preview rows exactly is asked once; one line more pages', async () => {
    const short = (count: number): string[] => Array.from({ length: count }, (_, at) => `line ${at + 1}`)
    const exact = addedSpec(short(PREVIEW_LINE_ROWS - 2))
    const once = recordingIo('Keep mine')
    expect(await TUI_DEFAULT.pagedPort(once.io, VIEW).ask(QUESTION, exact)).toBe('Keep mine')
    expect(once.specs).toEqual([exact])
    const over = recordingIo('Keep mine')
    await TUI_DEFAULT.pagedPort(over.io, VIEW).ask(QUESTION, addedSpec(short(PREVIEW_LINE_ROWS - 1)))
    expect(over.specs.length).toBe(2)
  })

  test('with unknown columns a diff of long lines that fits the preview is asked once', async () => {
    const unknown: PageView = { ...VIEW, columns: () => null }
    for (const count of [10, 15]) {
      const spec = addedSpec(Array.from({ length: count }, (_, at) => `${'lorem ipsum '.repeat(6)}END${at + 1}X`))
      const { io, specs } = recordingIo('Keep mine')
      expect(await TUI_DEFAULT.pagedPort(io, unknown).ask(QUESTION, spec)).toBe('Keep mine')
      expect([count, specs]).toEqual([count, [spec]])
    }
  })

  test('a question of another kind with a long context is asked once, as given', async () => {
    const lines = Array.from({ length: 80 }, (_, at) => `skill ${at + 1}`)
    const plain = (text: string): ContextRow => ({ role: 'plain', text, indent: 0 })
    const rows = [{ title: null, rows: lines.map(plain) }]
    const context: AskContext = { title: 'Hand out', lines, kind: 'skills', summary: '80 skills', rows }
    const spec: AskSpec = { options: ['All', 'None'], context }
    const { io, specs } = recordingIo('All')
    expect(await TUI_DEFAULT.pagedPort(io, VIEW).ask('Hand these out?', spec)).toBe('All')
    expect(specs).toEqual([spec])
  })
})
