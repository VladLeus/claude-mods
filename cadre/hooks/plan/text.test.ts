import { describe, expect, test } from 'claude-code/testing'

import type { DesiredFile, FileMode, FileOp, HunkOp, Op, Plan } from '../../types'
import { buildPlan } from '../plan'
import type { PlanInput } from '../plan'
import { BIDI_OVERRIDE } from '../testkit'
import { planSummary, renderPlan } from './text'

const VERSION = '0.2.0'
const ROLE = '.cadre/be/role.json'

/** A desired file; the mode is a plain file unless it says otherwise. */
function file(path: string, content: string, mode: FileMode = 'file'): DesiredFile {
  return { path, content, mode }
}

/** A plan input with an empty disk, no manifest and no extras; `over` changes the fields it names. */
function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    desired: [],
    disk: new Map(),
    manifest: null,
    manifestState: 'absent',
    carried: [],
    gitignore: null,
    hunks: [],
    cadreVersion: VERSION,
    ...over,
  }
}

const GSD_TOOLS = 'node ~/.claude/gsd-core/bin/gsd-tools.cjs'

/** A required, accepted, runnable hunk, as 02-08 builds one for the GSD mode setting. */
const HUNK: HunkOp = {
  kind: 'hunk',
  file: '.planning/config.json',
  key: 'mode',
  before: 'interactive',
  after: 'yolo',
  isRequired: true,
  isAccepted: true,
  isRunnable: true,
  command: `${GSD_TOOLS} config-set mode yolo`,
}

/** A file op built by hand, for the render tests. */
function op(kind: FileOp['kind'], path: string, over: Partial<FileOp> = {}): FileOp {
  return { kind, path, mode: 'file', note: null, ...over }
}

/** A plan built by hand, for the render tests. */
function planOf(ops: readonly Op[], warnings: readonly string[] = []): Plan {
  return { ops, warnings }
}

describe('renderPlan', () => {
  test('lists each op under File plan: with the kind padded to 10, then a summary line', async () => {
    const plan = await buildPlan(input({ desired: [file(ROLE, '{}\n')] }))

    expect(renderPlan(plan)).toEqual([
      'File plan:',
      '  create    .cadre/be/role.json',
      '  create    .cadre/manifest.json',
      'Summary: 2 create, 0 change, 0 leave, 0 conflict, 0 hunks',
    ])
  })

  test('an executable file shows (executable) after its path', async () => {
    const plan = await buildPlan(input({ desired: [file('.cadre/bin/be', '#!/bin/sh\n', 'exec')] }))

    expect(renderPlan(plan)[1]).toBe('  create    .cadre/bin/be (executable)')
  })

  test('each kind has its own padded column and is counted in the summary', () => {
    const lines = renderPlan(planOf([op('change', 'a'), op('conflict', 'b'), op('create', 'c'), op('leave', 'd')]))

    expect(lines).toEqual([
      'File plan:',
      '  change    a',
      '  conflict  b',
      '  create    c',
      '  leave     d',
      'Summary: 1 create, 1 change, 1 leave, 1 conflict, 0 hunks',
    ])
  })

  test('renders the ops in the order the plan holds them', () => {
    const lines = renderPlan(planOf([op('leave', 'z'), op('create', 'a')]))

    expect(lines.slice(1, 3)).toEqual(['  leave     z', '  create    a'])
  })

  test('a note goes on its own line, indented like the line under a hunk', () => {
    const note = 'changed outside cadre: kept as is; the new version is planned beside it'
    const lines = renderPlan(planOf([op('conflict', ROLE, { note }), op('create', `${ROLE}.cadre-new`)]))

    expect(lines.slice(1, 4)).toEqual([`  conflict  ${ROLE}`, `            ${note}`, `  create    ${ROLE}.cadre-new`])
  })

  test('an executable file with a note shows the flag on the path line and the note under it', () => {
    const lines = renderPlan(planOf([op('leave', '.cadre/bin/be', { mode: 'exec', note: 'kept' })]))

    expect(lines.slice(1, 3)).toEqual(['  leave     .cadre/bin/be (executable)', '            kept'])
  })

  test('a hunk shows its file, key, before and after, flags and command; hunks and accepted ones are counted', () => {
    const declined: HunkOp = {
      ...HUNK,
      key: 'workflow.text_mode',
      before: 'not set (GSD default)',
      after: 'false',
      isRequired: false,
      isAccepted: false,
      command: `${GSD_TOOLS} config-set workflow.text_mode false`,
    }
    const lines = renderPlan(planOf([op('create', ROLE), HUNK, declined]))

    expect(lines).toEqual([
      'File plan:',
      `  create    ${ROLE}`,
      '  hunk      .planning/config.json  mode: interactive -> yolo  (required, accepted)',
      `            run: ${GSD_TOOLS} config-set mode yolo`,
      '  hunk      .planning/config.json  workflow.text_mode: not set (GSD default) -> false  (optional, declined)',
      `            run: ${GSD_TOOLS} config-set workflow.text_mode false`,
      'Summary: 1 create, 0 change, 0 leave, 0 conflict, 2 hunks (1 accepted)',
    ])
  })

  test('warnings are listed after the ops and before the summary', () => {
    const warning = 'refused to plan CLAUDE.md: not a .cadre/ path or .gitignore (PLAN-06)'
    const lines = renderPlan(planOf([op('create', ROLE)], [warning]))

    expect(lines).toEqual([
      'File plan:',
      `  create    ${ROLE}`,
      `warning: ${warning}`,
      'Summary: 1 create, 0 change, 0 leave, 0 conflict, 0 hunks',
    ])
  })

  test('text from outside is cleaned: a hidden character or a line break cannot reach a line', () => {
    const hunk: HunkOp = { ...HUNK, command: `run${BIDI_OVERRIDE}\nme` }
    const conflict = op('conflict', `.cadre/a${BIDI_OVERRIDE}b.json`, { note: `x\ny${BIDI_OVERRIDE}` })
    const lines = renderPlan(planOf([conflict, hunk], [`w\n${BIDI_OVERRIDE}`]))

    expect(lines).toEqual([
      'File plan:',
      '  conflict  .cadre/ab.json',
      '            xy',
      '  hunk      .planning/config.json  mode: interactive -> yolo  (required, accepted)',
      '            run: runme',
      'warning: w',
      'Summary: 0 create, 0 change, 0 leave, 1 conflict, 1 hunks (1 accepted)',
    ])
  })

  test('a path or a note over 240 code points is cut with an ellipsis', () => {
    const ellipsis = String.fromCodePoint(0x2026)
    const lines = renderPlan(planOf([op('create', `.cadre/${'a'.repeat(300)}`, { note: 'n'.repeat(300) })]))

    expect(lines[1]).toBe(`  create    .cadre/${'a'.repeat(232)}${ellipsis}`)
    expect(lines[2]).toBe(`            ${'n'.repeat(239)}${ellipsis}`)
  })

  test('an empty plan lists no ops and a summary of zeros', () => {
    expect(renderPlan(planOf([]))).toEqual(['File plan:', 'Summary: 0 create, 0 change, 0 leave, 0 conflict, 0 hunks'])
  })

  test('an empty note adds no line', () => {
    const lines = renderPlan(planOf([op('leave', 'a', { note: '' })]))

    expect(lines).toEqual(['File plan:', '  leave     a', 'Summary: 0 create, 0 change, 1 leave, 0 conflict, 0 hunks'])
  })
})

describe('planSummary', () => {
  test('planSummary counts each kind and the hunks with their accepted ones, after Summary: (D-136)', () => {
    const declined: HunkOp = { ...HUNK, key: 'workflow.text_mode', isAccepted: false }
    const plan = planOf([op('change', 'a'), op('conflict', 'b'), op('create', 'c'), op('leave', 'd'), HUNK, declined])

    expect(planSummary(plan)).toBe('Summary: 1 create, 1 change, 1 leave, 1 conflict, 2 hunks (1 accepted)')
    expect(planSummary(planOf([op('create', 'c'), op('create', 'e')]))).toBe(
      'Summary: 2 create, 0 change, 0 leave, 0 conflict, 0 hunks',
    )
    expect(planSummary(planOf([]))).toBe('Summary: 0 create, 0 change, 0 leave, 0 conflict, 0 hunks')
  })

  test('renderPlan ends with planSummary, so the review question and the plan give the same line', async () => {
    const built = await buildPlan(input({ desired: [file(ROLE, '{}\n')] }))
    const plans = [built, planOf([op('create', ROLE), HUNK], ['w']), planOf([])]

    for (const plan of plans) expect(renderPlan(plan).at(-1)).toBe(planSummary(plan))
  })
})
