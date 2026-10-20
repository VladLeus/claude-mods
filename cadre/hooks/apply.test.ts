import { describe, expect, test } from 'claude-code/testing'

import type { DesiredFile, FileMode, Manifest, Plan, PortRead } from '../types'
import { applySteps, chmodArgv } from './apply'
import type { ApplyStep, ConflictChoice } from './apply'
import { MAX_READ_BYTES } from './facts'
import {
  gitignoreLines,
  isSafeOpPath,
  MANIFEST_PATH,
  mergeIgnoreBlock,
  planReadPaths,
  planWithManifest,
  stableJson,
} from './plan'
import type { PlanInput } from './plan'
import { parseManifest, readRepoFile } from './scan'
import { memIo, memWorld, withWrites } from './testkit'
import type { HostWrite, MemWorld } from './testkit'

const VERSION = '0.2.0'

/** The repo root of the fixtures, as memWorld has it. */
const ROOT = '/repo'

/** A plain generated file. */
const A = '.cadre/a.md'

/** The launcher of the BE role, an executable file. */
const LAUNCHER = '.cadre/bin/be'

/** A path that is not there. */
const ABSENT: PortRead = { state: 'absent' }

/** No conflict was answered. */
const NO_CHOICES: ReadonlyMap<string, ConflictChoice> = new Map()

/** The kinds a step may have: none of them deletes (LNCH-01). */
const STEP_KINDS: readonly string[] = ['write', 'chmod', 'manifest']

/** A desired file; the mode is a plain file unless it says otherwise. */
function file(path: string, content: string, mode: FileMode = 'file'): DesiredFile {
  return { path, content, mode }
}

/** A file read through the port: its text. */
function text(content: string): PortRead {
  return { state: 'text', text: content }
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

/** One `kind path` line per step: a compact way to compare the order and the kinds of the steps. */
function stepLine(step: ApplyStep): string {
  return `${step.kind} ${step.path}`
}

/** One `kind path` line per file op of a plan, in plan order; the hunks are dropped. */
function summary(plan: Plan): string[] {
  const lines: string[] = []
  for (const op of plan.ops) {
    if (op.kind !== 'hunk') lines.push(`${op.kind} ${op.path}`)
  }

  return lines
}

/** What one run plans over a world: the plan, the manifest it records and the merged .gitignore text. */
type Planned = { readonly plan: Plan; readonly manifest: Manifest; readonly gitignore: string | null }

/**
 * Plans `desired` over a world as init does: every path planReadPaths names and the root .gitignore read through
 * readRepoFile, the last manifest parsed from the disk, and the cadre block of the definitions policy.
 */
async function planOver(world: MemWorld, desired: readonly DesiredFile[]): Promise<Planned> {
  const { io } = memIo(world, [])
  const disk = new Map<string, PortRead>()
  for (const path of planReadPaths(desired)) disk.set(path, await readRepoFile(io, ROOT, path, MAX_READ_BYTES))
  const ignore = await readRepoFile(io, ROOT, '.gitignore', MAX_READ_BYTES)
  const existing = ignore.state === 'text' ? ignore.text : null
  const lines = gitignoreLines('definitions', existing)
  const last = disk.get(MANIFEST_PATH)
  const manifest = last?.state === 'text' ? parseManifest(last.text) : null
  const manifestState = manifest === null ? 'absent' : 'present'
  const planned = await planWithManifest(
    input({ desired, disk, manifest, manifestState, gitignore: { disk: ignore, lines } }),
  )

  return { ...planned, gitignore: mergeIgnoreBlock(existing, lines) }
}

/** The write and manifest steps as writes of the fake host under the root, each of them landed. */
function landed(steps: readonly ApplyStep[]): HostWrite[] {
  const writes: HostWrite[] = []
  for (const step of steps) {
    if (step.kind === 'chmod') continue
    writes.push({ path: `${ROOT}/${step.path}`, text: step.text, isWritten: true })
  }

  return writes
}

describe('apply steps (LNCH-01)', () => {
  test('an all-create plan writes each file in plan order, a chmod after the launcher, the manifest last', async () => {
    const desired = [file(LAUNCHER, '#!/bin/sh\n', 'exec'), file(A, 'a\n')]
    const { plan, manifest } = await planWithManifest(input({ desired }))
    const steps = await applySteps({ plan, desired, manifest, gitignore: null, choices: NO_CHOICES })

    expect(steps).toEqual([
      { kind: 'write', path: A, text: 'a\n' },
      { kind: 'write', path: LAUNCHER, text: '#!/bin/sh\n' },
      { kind: 'chmod', path: LAUNCHER },
      { kind: 'manifest', path: MANIFEST_PATH, text: stableJson(manifest) },
    ])
  })

  test('a planned .gitignore create is written with the merged block text in its sorted place', async () => {
    const desired = [file(A, 'a\n'), file(LAUNCHER, '#!/bin/sh\n', 'exec')]
    const block = '# >>> cadre\nthoughts/\n.cadre/*/.runtime/\n# <<< cadre\n'
    const gitignore = { disk: ABSENT, lines: ['thoughts/', '.cadre/*/.runtime/'] }
    const { plan, manifest } = await planWithManifest(input({ desired, gitignore }))
    const steps = await applySteps({ plan, desired, manifest, gitignore: block, choices: NO_CHOICES })

    expect(summary(plan)).toContain('create .gitignore')
    expect(steps.map(stepLine)).toEqual([
      `write ${A}`,
      `write ${LAUNCHER}`,
      `chmod ${LAUNCHER}`,
      'write .gitignore',
      `manifest ${MANIFEST_PATH}`,
    ])
    expect(steps[3]).toEqual({ kind: 'write', path: '.gitignore', text: block })
  })

  test('a .gitignore change is written with the merged text, and nothing is written for it without one', async () => {
    const merged = 'node_modules\n# >>> cadre\nthoughts/\n# <<< cadre\n'
    const gitignore = { disk: text('node_modules\n'), lines: ['thoughts/'] }
    const { plan, manifest } = await planWithManifest(input({ gitignore }))
    const written = await applySteps({ plan, desired: [], manifest, gitignore: merged, choices: NO_CHOICES })
    const unmerged = await applySteps({ plan, desired: [], manifest, gitignore: null, choices: NO_CHOICES })

    expect(summary(plan)).toEqual([`create ${MANIFEST_PATH}`, 'change .gitignore'])
    expect(written.map(stepLine)).toEqual(['write .gitignore', `manifest ${MANIFEST_PATH}`])
    expect(written[0]).toEqual({ kind: 'write', path: '.gitignore', text: merged })
    expect(unmerged.map(stepLine)).toEqual([`manifest ${MANIFEST_PATH}`])
  })

  test('the manifest is written last when the plan creates or changes it, and not when it leaves it', async () => {
    const desired = [file(A, 'a\n')]
    const first = await planWithManifest(input({ desired }))
    const recorded = stableJson(first.manifest)
    const older = stableJson({ ...first.manifest, cadreVersion: '0.1.0' })
    const diskWith = (manifestText: string): ReadonlyMap<string, PortRead> => {
      return new Map([
        [A, text('a\n')],
        [MANIFEST_PATH, text(manifestText)],
      ])
    }
    const changed = await planWithManifest(input({ desired, disk: diskWith(older) }))
    const left = await planWithManifest(input({ desired, disk: diskWith(recorded) }))

    expect(summary(changed.plan)).toEqual([`leave ${A}`, `change ${MANIFEST_PATH}`])
    expect(await applySteps({ ...changed, desired, gitignore: null, choices: NO_CHOICES })).toEqual([
      { kind: 'manifest', path: MANIFEST_PATH, text: recorded },
    ])
    expect(summary(left.plan)).toEqual([`leave ${A}`, `leave ${MANIFEST_PATH}`])
    expect(await applySteps({ ...left, desired, gitignore: null, choices: NO_CHOICES })).toEqual([])
  })

  test('chmodArgv makes a file executable with /bin/chmod 755 and its absolute path under the root', () => {
    expect(chmodArgv('/repo', '.cadre/bin/be')).toEqual(['/bin/chmod', '755', '/repo/.cadre/bin/be'])
    expect(chmodArgv('/repo/', '.cadre/bin/be')).toEqual(['/bin/chmod', '755', '/repo/.cadre/bin/be'])
  })

  test('re-run: planning again over what the steps wrote gives only leave ops, and then no step at all', async () => {
    const desired = [file(A, 'a\n'), file(LAUNCHER, '#!/bin/sh\n', 'exec')]
    const world = memWorld({})
    const first = await planOver(world, desired)
    const steps = await applySteps({ ...first, desired, choices: NO_CHOICES })
    const again = await planOver(withWrites(world, landed(steps)), desired)
    const rerun = await applySteps({ ...again, desired, choices: NO_CHOICES })

    expect(summary(first.plan)).toEqual([
      `create ${A}`,
      `create ${LAUNCHER}`,
      `create ${MANIFEST_PATH}`,
      'create .gitignore',
    ])
    expect(summary(again.plan)).toEqual([
      `leave ${A}`,
      `leave ${LAUNCHER}`,
      `leave ${MANIFEST_PATH}`,
      'leave .gitignore',
    ])
    expect(again.manifest).toEqual(first.manifest)
    expect(rerun).toEqual([])
  })

  test('interrupt: an apply stopped before the manifest leaves none, and planning again plans the rest', async () => {
    const desired = [file(A, 'a\n'), file(LAUNCHER, '#!/bin/sh\n', 'exec')]
    const world = memWorld({})
    const first = await planOver(world, desired)
    const steps = await applySteps({ ...first, desired, choices: NO_CHOICES })
    const stopped = withWrites(world, landed(steps.slice(0, 1)))
    const again = await planOver(stopped, desired)

    expect(steps.findIndex(step => step.kind === 'manifest')).toBe(steps.length - 1)
    expect(Object.keys(stopped.files)).toEqual([`${ROOT}/${A}`])
    expect(summary(again.plan)).toEqual([
      `leave ${A}`,
      `create ${LAUNCHER}`,
      `create ${MANIFEST_PATH}`,
      'create .gitignore',
    ])
  })

  test('PLAN-06: whatever is desired, every step writes, chmods or records a safe path, and none deletes', async () => {
    const hostile = [
      'CLAUDE.md',
      '.claude/settings.json',
      '.planning/config.json',
      '../x',
      '/abs',
      '.cadre/be/.runtime/settings.json',
    ]
    const desired = [
      ...hostile.map(path => file(path, 'x\n', 'exec')),
      file(A, 'a\n'),
      file(LAUNCHER, '#!/bin/sh\n', 'exec'),
    ]
    const disk = new Map(hostile.map((path): [string, PortRead] => [path, text('mine\n')]))
    const choices = new Map(desired.map((entry): [string, ConflictChoice] => [entry.path, 'new']))
    const { plan, manifest } = await planWithManifest(input({ desired, disk }))
    const steps = await applySteps({ plan, desired, manifest, gitignore: '# >>> cadre\n# <<< cadre\n', choices })

    expect(steps.filter(step => !isSafeOpPath(step.path)).map(stepLine)).toEqual([])
    expect(steps.map(step => step.kind).filter(kind => !STEP_KINDS.includes(kind))).toEqual([])
    expect(steps.map(stepLine)).toEqual([
      `write ${A}`,
      `write ${LAUNCHER}`,
      `chmod ${LAUNCHER}`,
      `manifest ${MANIFEST_PATH}`,
    ])
  })
})
