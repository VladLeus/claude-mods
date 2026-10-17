import { describe, expect, test } from 'claude-code/testing'

import type { DesiredFile, FileMode, FileOp, HunkOp, Manifest, ManifestEntry, Op, Plan, PortRead } from '../types'
import { compareText } from './facts'
import { sha256Hex } from './hash'
import { buildPlan, classifyFile, MANIFEST_PATH, renderPlan, stableJson } from './plan'
import type { PlanInput } from './plan'
import { BIDI_OVERRIDE } from './testkit'

const VERSION = '0.2.0'
const ROLE = '.cadre/be/role.json'
const INDEX = '.cadre/INDEX.md'

/** A desired file; the mode is a plain file unless it says otherwise. */
function file(path: string, content: string, mode: FileMode = 'file'): DesiredFile {
  return { path, content, mode }
}

/** A file read through the port: its text. */
function text(content: string): PortRead {
  return { state: 'text', text: content }
}

/** The disk as buildPlan takes it: reads keyed by repo-relative path. */
function diskOf(reads: Readonly<Record<string, PortRead>>): ReadonlyMap<string, PortRead> {
  return new Map(Object.entries(reads))
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

/** The file ops of a plan, in plan order; the hunks are dropped. */
function fileOps(plan: Plan): FileOp[] {
  const ops: FileOp[] = []
  for (const op of plan.ops) {
    if (op.kind !== 'hunk') ops.push(op)
  }

  return ops
}

/** One `kind path` line per file op: a compact way to compare the order and the kinds of a plan. */
function summary(plan: Plan): string[] {
  return fileOps(plan).map(op => `${op.kind} ${op.path}`)
}

/** The kind of the op for one path; undefined when the plan has none. */
function kindOf(plan: Plan, path: string): string | undefined {
  return fileOps(plan).find(op => op.path === path)?.kind
}

/** The manifest entries of some desired files, as the plan records them. */
async function entriesOf(files: readonly DesiredFile[]): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = []
  for (const desired of files) {
    entries.push({ path: desired.path, sha256: await sha256Hex(desired.content), mode: desired.mode })
  }

  return entries
}

/**
 * The text a plan writes for the manifest: stableJson of schema 1, the version and the entries in path order, and
 * nothing else. A plan holds no content, so a test proves the text by putting it on the disk and expecting `leave`.
 */
function manifestTextOf(entries: readonly ManifestEntry[], cadreVersion = VERSION): string {
  const files = [...entries].sort((a, b) => compareText(a.path, b.path))
  const manifest: Manifest = { schema: 1, cadreVersion, files }

  return stableJson(manifest)
}

/** A file op built by hand, for the render tests. */
function op(kind: FileOp['kind'], path: string, over: Partial<FileOp> = {}): FileOp {
  return { kind, path, mode: 'file', note: null, ...over }
}

/** A plan built by hand, for the render tests. */
function planOf(ops: readonly Op[], warnings: readonly string[] = []): Plan {
  return { ops, warnings }
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

/** What classifyFile takes for the disk. */
type DiskSeen = Parameters<typeof classifyFile>[2]

const ABSENT: DiskSeen = { state: 'absent' }
const UNKNOWN: DiskSeen = { state: 'unknown' }

function present(hash: string): DiskSeen {
  return { state: 'present', hash }
}

describe('classifyFile', () => {
  test('a file that is not on disk is created, with or without a manifest entry', () => {
    expect(classifyFile('new', null, ABSENT)).toBe('create')
    expect(classifyFile('new', 'old', ABSENT)).toBe('create')
  })

  test('a file that already holds the desired content is left, whatever the manifest says', () => {
    expect(classifyFile('new', null, present('new'))).toBe('leave')
    expect(classifyFile('new', 'old', present('new'))).toBe('leave')
    expect(classifyFile('new', 'new', present('new'))).toBe('leave')
  })

  test('a file that still holds what the manifest recorded, while the desired content differs, is changed', () => {
    expect(classifyFile('new', 'old', present('old'))).toBe('change')
  })

  test('a file that matches neither the desired content nor the manifest is a conflict', () => {
    expect(classifyFile('new', 'old', present('edited'))).toBe('conflict')
  })

  test('a file with no manifest entry whose content differs is a conflict', () => {
    expect(classifyFile('new', null, present('edited'))).toBe('conflict')
  })

  test('a file that could not be read is a conflict, never absent or equal', () => {
    expect(classifyFile('new', null, UNKNOWN)).toBe('conflict')
    expect(classifyFile('new', 'old', UNKNOWN)).toBe('conflict')
    expect(classifyFile('new', 'new', UNKNOWN)).toBe('conflict')
  })
})

describe('stableJson', () => {
  test('sorts the keys at every depth, keeps arrays in order and ends with a newline', () => {
    const value = { b: 1, a: { d: [2, { z: 1, y: 0 }], c: null } }

    expect(stableJson(value)).toBe(
      '{\n  "a": {\n    "c": null,\n    "d": [\n      2,\n      {\n        "y": 0,\n        "z": 1\n      }\n' +
        '    ]\n  },\n  "b": 1\n}\n',
    )
  })

  test('gives the same text whatever order the keys were added in', () => {
    const first = { schema: 1, files: [{ path: 'a', mode: 'file' }], cadreVersion: VERSION }
    const second = { cadreVersion: VERSION, files: [{ mode: 'file', path: 'a' }], schema: 1 }

    expect(stableJson(first)).toBe(stableJson(second))
  })

  test('orders keys by code unit, not by locale: capitals first', () => {
    const keys = Object.keys(JSON.parse(stableJson({ b: 1, B: 2, a: 3, A: 4 })))

    expect(keys).toEqual(['A', 'B', 'a', 'b'])
  })

  test('keeps an own key named __proto__ as a key', () => {
    const value = JSON.parse('{"a": 2, "__proto__": 1}')

    expect(stableJson(value)).toBe('{\n  "__proto__": 1,\n  "a": 2\n}\n')
  })

  test('writes a value that is not an object, and the empty containers, with one trailing newline', () => {
    expect(stableJson('a')).toBe('"a"\n')
    expect(stableJson(null)).toBe('null\n')
    expect(stableJson([])).toBe('[]\n')
    expect(stableJson({})).toBe('{}\n')
  })

  test('does not change the value it is given', () => {
    const value = Object.freeze({ b: Object.freeze([1]), a: 1 })

    expect(stableJson(value)).toBe('{\n  "a": 1,\n  "b": [\n    1\n  ]\n}\n')
    expect(Object.keys(value)).toEqual(['b', 'a'])
  })
})

describe('buildPlan', () => {
  test('one new file gives a create op for it and one for the manifest, in path order', async () => {
    const plan = await buildPlan(input({ desired: [file(ROLE, '{}\n')] }))

    expect(plan.ops).toEqual([
      { kind: 'create', path: ROLE, mode: 'file', note: null },
      { kind: 'create', path: MANIFEST_PATH, mode: 'file', note: null },
    ])
    expect(plan.warnings).toEqual([])
  })

  test('the manifest it plans is schema 1, the version and one entry per file with its hash', async () => {
    const files = [file(ROLE, '{}\n')]
    const sha256 = await sha256Hex('{}\n')
    const expected = manifestTextOf([{ path: ROLE, sha256, mode: 'file' }])

    expect(JSON.parse(expected)).toEqual({
      schema: 1,
      cadreVersion: VERSION,
      files: [{ path: ROLE, sha256, mode: 'file' }],
    })
    const plan = await buildPlan(input({ desired: files, disk: diskOf({ [MANIFEST_PATH]: text(expected) }) }))

    expect(kindOf(plan, MANIFEST_PATH)).toBe('leave')
  })

  test('the manifest is compared as plain text: equal is left, other text a change, none a create', async () => {
    const files = [file(ROLE, '{}\n')]
    const planned = manifestTextOf(await entriesOf(files))
    const compactText = JSON.stringify(JSON.parse(planned))

    const none = await buildPlan(input({ desired: files }))
    const equal = await buildPlan(input({ desired: files, disk: diskOf({ [MANIFEST_PATH]: text(planned) }) }))
    const spaced = await buildPlan(input({ desired: files, disk: diskOf({ [MANIFEST_PATH]: text(`${planned} `) }) }))
    const compact = await buildPlan(input({ desired: files, disk: diskOf({ [MANIFEST_PATH]: text(compactText) }) }))

    expect(kindOf(none, MANIFEST_PATH)).toBe('create')
    expect(kindOf(equal, MANIFEST_PATH)).toBe('leave')
    expect(kindOf(spaced, MANIFEST_PATH)).toBe('change')
    expect(kindOf(compact, MANIFEST_PATH)).toBe('change')
  })

  test('the manifest is never a conflict: an unreadable or too large one is a change', async () => {
    const files = [file(ROLE, '{}\n')]
    const unknown = await buildPlan(input({ desired: files, disk: diskOf({ [MANIFEST_PATH]: { state: 'unknown' } }) }))
    const large = await buildPlan(
      input({ desired: files, disk: diskOf({ [MANIFEST_PATH]: { state: 'too-large', bytes: 300_000 } }) }),
    )

    expect(kindOf(unknown, MANIFEST_PATH)).toBe('change')
    expect(kindOf(large, MANIFEST_PATH)).toBe('change')
  })

  test('a new version of cadre plans a changed manifest and nothing else', async () => {
    const files = [file(ROLE, '{}\n')]
    const old = manifestTextOf(await entriesOf(files), '0.1.0')
    const plan = await buildPlan(
      input({ desired: files, disk: diskOf({ [ROLE]: text('{}\n'), [MANIFEST_PATH]: text(old) }) }),
    )

    expect(summary(plan)).toEqual([`leave ${ROLE}`, `change ${MANIFEST_PATH}`])
  })

  test('a re-run against a disk that holds every file and the manifest leaves them all', async () => {
    const files = [file(ROLE, '{}\n'), file(INDEX, '# Roles\n')]
    const planned = manifestTextOf(await entriesOf(files))
    const disk = diskOf({ [ROLE]: text('{}\n'), [INDEX]: text('# Roles\n'), [MANIFEST_PATH]: text(planned) })
    const plan = await buildPlan(input({ desired: files, disk }))

    expect(summary(plan)).toEqual([`leave ${INDEX}`, `leave ${ROLE}`, `leave ${MANIFEST_PATH}`])
  })

  test('a file that holds what the manifest recorded is changed, and the new manifest has the new hash', async () => {
    const old = file(ROLE, 'old\n')
    const next = file(ROLE, 'new\n')
    const manifest: Manifest = { schema: 1, cadreVersion: '0.1.0', files: await entriesOf([old]) }
    const planned = manifestTextOf(await entriesOf([next]))
    const disk = diskOf({ [ROLE]: text('old\n'), [MANIFEST_PATH]: text(planned) })
    const plan = await buildPlan(input({ desired: [next], disk, manifest, manifestState: 'present' }))

    expect(summary(plan)).toEqual([`change ${ROLE}`, `leave ${MANIFEST_PATH}`])
  })

  test('a file that holds other text than the manifest and the desired content says is a conflict', async () => {
    const old = file(ROLE, 'old\n')
    const manifest: Manifest = { schema: 1, cadreVersion: '0.1.0', files: await entriesOf([old]) }
    const edited = await buildPlan(
      input({
        desired: [file(ROLE, 'new\n')],
        disk: diskOf({ [ROLE]: text('edited by hand\n') }),
        manifest,
        manifestState: 'present',
      }),
    )
    const untracked = await buildPlan(
      input({ desired: [file(ROLE, 'new\n')], disk: diskOf({ [ROLE]: text('edited by hand\n') }) }),
    )

    expect(kindOf(edited, ROLE)).toBe('conflict')
    expect(kindOf(untracked, ROLE)).toBe('conflict')
  })

  test('a disk read that is unknown or too large is a conflict, never absent', async () => {
    const files = [file(ROLE, '{}\n')]
    const unknown = await buildPlan(input({ desired: files, disk: diskOf({ [ROLE]: { state: 'unknown' } }) }))
    const large = await buildPlan(
      input({ desired: files, disk: diskOf({ [ROLE]: { state: 'too-large', bytes: 300_000 } }) }),
    )

    expect(kindOf(unknown, ROLE)).toBe('conflict')
    expect(kindOf(large, ROLE)).toBe('conflict')
  })

  test('an untracked file that already holds the desired content is left', async () => {
    const plan = await buildPlan(input({ desired: [file(ROLE, '{}\n')], disk: diskOf({ [ROLE]: text('{}\n') }) }))

    expect(kindOf(plan, ROLE)).toBe('leave')
  })

  test('ops come in path order, whatever order the files were given in', async () => {
    const files = [file('.cadre/z.md', 'z'), file('.cadre/a.md', 'a'), file('.cadre/bin/be', '#!/bin/sh\n', 'exec')]
    const plan = await buildPlan(input({ desired: files }))

    expect(summary(plan)).toEqual([
      'create .cadre/a.md',
      'create .cadre/bin/be',
      `create ${MANIFEST_PATH}`,
      'create .cadre/z.md',
    ])
  })

  test('an executable file keeps its mode in its op and in the manifest', async () => {
    const launcher = file('.cadre/bin/be', '#!/bin/sh\n', 'exec')
    const planned = manifestTextOf(await entriesOf([launcher]))
    const plan = await buildPlan(input({ desired: [launcher], disk: diskOf({ [MANIFEST_PATH]: text(planned) }) }))

    expect(fileOps(plan)[0]).toEqual({ kind: 'create', path: '.cadre/bin/be', mode: 'exec', note: null })
    expect(kindOf(plan, MANIFEST_PATH)).toBe('leave')
    expect(JSON.parse(planned).files[0].mode).toBe('exec')
  })

  test('the hash is of the content: one newline more is a different file', async () => {
    const disk = diskOf({ [ROLE]: text('{}') })
    const plan = await buildPlan(input({ desired: [file(ROLE, '{}\n')], disk }))

    expect(kindOf(plan, ROLE)).toBe('conflict')
  })

  test('the same input gives the same plan twice', async () => {
    const files = [file(ROLE, '{}\n'), file(INDEX, '# Roles\n')]
    const first = await buildPlan(input({ desired: files }))
    const second = await buildPlan(input({ desired: files }))

    expect(second).toEqual(first)
  })

  test('with nothing desired the plan holds only the manifest', async () => {
    const plan = await buildPlan(input())

    expect(summary(plan)).toEqual([`create ${MANIFEST_PATH}`])
  })
})

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
      `Warning: ${warning}`,
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
      'Warning: w',
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
