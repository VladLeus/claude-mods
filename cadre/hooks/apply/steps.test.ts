import { describe, expect, test } from 'claude-code/testing'

import type { DesiredFile, FileMode, Manifest, ManifestEntry, Plan, PortRead } from '../../types'
import { sha256Hex } from '../core/hash'
import { stableJson } from '../core/json'
import { MANIFEST_PATH } from '../plan/classify'
import { gitignoreLines, mergeIgnoreBlock } from '../plan/gitignore'
import { isSafeOpPath, planReadPaths, planWithManifest } from '../plan/plan'
import type { PlanInput, PlannedFiles } from '../plan/plan'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { readRepoFile } from '../scan/port-read'
import { parseManifest } from '../state/cadre-files'
import { BIDI_OVERRIDE, memIo, memWorld, withWrites } from '../testkit'
import type { HostWrite, MemWorld } from '../testkit'
import { CONFLICT_OPTIONS, conflictPaths, conflictQuestion, parseConflictAnswer } from './conflict'
import type { ConflictChoice } from './conflict'
import type { ApplyStep } from './private'
import { chmodArgv } from './safety'
import { applySteps } from './steps'

const VERSION = '0.2.0'

/** The repo root of the fixtures, as memWorld has it. */
const ROOT = '/repo'

/** A plain generated file. */
const A = '.cadre/a.md'

/** No conflict was answered. */
const NO_CHOICES: ReadonlyMap<string, ConflictChoice> = new Map()

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

/** The manifest the last step writes, parsed; null when the last step is not the manifest. */
function writtenManifest(steps: readonly ApplyStep[]): Manifest | null {
  const last = steps.at(-1)
  if (last === undefined || last.kind !== 'manifest') return null

  return parseManifest(last.text)
}

/** The launcher of the BE role, an executable file. */
const LAUNCHER = '.cadre/bin/be'

/** A path that is not there. */
const ABSENT: PortRead = { state: 'absent' }

/** The kinds a step may have: none of them deletes (LNCH-01). */
const STEP_KINDS: readonly string[] = ['write', 'chmod', 'manifest']

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
    if (step.kind === 'chmod' || step.kind === 'private') continue
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

/** The role file of the BE role. */
const ROLE_MD = '.cadre/be/ROLE.md'

/** The index of the roles. */
const INDEX = '.cadre/INDEX.md'

/** The copy a conflict on ROLE.md plans beside it (D-67). */
const BESIDE = `${ROLE_MD}.cadre-new`

/** The role file the plan wants now. */
const NEW_ROLE = file(ROLE_MD, 'new role\n')

/** The index, which did not change since cadre wrote it. */
const SAME_INDEX = file(INDEX, '# Roles\n')

/** The answer to one conflict question. */
function answered(path: string, choice: ConflictChoice): ReadonlyMap<string, ConflictChoice> {
  return new Map([[path, choice]])
}

/**
 * The plan for NEW_ROLE and SAME_INDEX over a disk where the person edited ROLE.md after cadre wrote it as
 * 'old role\n'. The last manifest records both files at `version` and is read in full, so the manifest op is a leave
 * at VERSION and a change at any other version; `extra` adds or replaces disk reads.
 */
async function editedRolePlan(
  version: string,
  extra: Readonly<Record<string, PortRead>> = {},
): Promise<{ readonly planned: PlannedFiles; readonly old: Manifest }> {
  const files: ManifestEntry[] = [
    { path: INDEX, sha256: await sha256Hex('# Roles\n'), mode: 'file' },
    { path: ROLE_MD, sha256: await sha256Hex('old role\n'), mode: 'file' },
  ]
  const old: Manifest = { schema: 1, cadreVersion: version, files }
  const reads = { [ROLE_MD]: text('edited\n'), [INDEX]: text('# Roles\n'), [MANIFEST_PATH]: text(stableJson(old)) }
  const disk = new Map(Object.entries({ ...reads, ...extra }))
  const desired = [NEW_ROLE, SAME_INDEX]
  const planned = await planWithManifest(input({ desired, disk, manifest: old, manifestState: 'present' }))

  return { planned, old }
}

describe('apply conflicts (D-67)', () => {
  test('the question names the file, cleaned, and offers Keep mine and Take new in a frozen list', () => {
    expect(CONFLICT_OPTIONS).toEqual(['Keep mine', 'Take new'])
    expect(Object.isFrozen(CONFLICT_OPTIONS)).toBe(true)
    expect(conflictQuestion(ROLE_MD)).toBe(
      '.cadre/be/ROLE.md was changed outside cadre. ' +
        'Keep your version, or take the new one (yours is then overwritten)?',
    )
    expect(conflictQuestion(`.cadre/a${BIDI_OVERRIDE}\nb`)).toBe(
      '.cadre/ab was changed outside cadre. Keep your version, or take the new one (yours is then overwritten)?',
    )
  })

  test('Keep mine or mine keeps the file, Take new or new takes the new one, in any case; else null', () => {
    const mine = ['Keep mine', ' keep mine ', 'mine', 'MINE']

    expect(mine.map(parseConflictAnswer)).toEqual(['mine', 'mine', 'mine', 'mine'])
    expect(['Take new', 'take NEW', 'new'].map(parseConflictAnswer)).toEqual(['new', 'new', 'new'])
    expect(['', 'yes', 'keep', 'Keep mine please'].map(parseConflictAnswer)).toEqual([null, null, null, null])
  })

  test('conflictPaths lists the conflicted files in plan order, never the manifest or a .cadre-new copy', async () => {
    const desired = [SAME_INDEX, NEW_ROLE, file(LAUNCHER, '#!/bin/sh\nnew\n', 'exec')]
    const disk = new Map<string, PortRead>([
      [ROLE_MD, text('edited\n')],
      [LAUNCHER, text('mine\n')],
      [`${LAUNCHER}.cadre-new`, text('older\n')],
      [MANIFEST_PATH, { state: 'unknown' }],
    ])
    const { plan } = await planWithManifest(input({ desired, disk }))

    expect(summary(plan)).toEqual([
      `create ${INDEX}`,
      `conflict ${ROLE_MD}`,
      `create ${BESIDE}`,
      `conflict ${LAUNCHER}`,
      `conflict ${LAUNCHER}.cadre-new`,
      `conflict ${MANIFEST_PATH}`,
    ])
    expect(conflictPaths(plan)).toEqual([ROLE_MD, LAUNCHER])
  })

  test('Take new writes the desired file, not its .cadre-new copy, and the manifest records its new hash', async () => {
    const { planned } = await editedRolePlan(VERSION)
    const choices = answered(ROLE_MD, 'new')
    const steps = await applySteps({ ...planned, desired: [NEW_ROLE, SAME_INDEX], gitignore: null, choices })

    expect(summary(planned.plan)).toEqual([
      `leave ${INDEX}`,
      `conflict ${ROLE_MD}`,
      `create ${BESIDE}`,
      `leave ${MANIFEST_PATH}`,
    ])
    expect(steps.map(stepLine)).toEqual([`write ${ROLE_MD}`, `manifest ${MANIFEST_PATH}`])
    expect(steps[0]).toEqual({ kind: 'write', path: ROLE_MD, text: 'new role\n' })
    expect(writtenManifest(steps)).toEqual({
      schema: 1,
      cadreVersion: VERSION,
      files: [
        { path: INDEX, sha256: await sha256Hex('# Roles\n'), mode: 'file' },
        { path: ROLE_MD, sha256: await sha256Hex('new role\n'), mode: 'file' },
      ],
    })
  })

  test('Keep mine, or no answer, writes the .cadre-new copy, not the file; the manifest keeps its entry', async () => {
    const { planned, old } = await editedRolePlan('0.1.0')

    expect(summary(planned.plan)).toEqual([
      `leave ${INDEX}`,
      `conflict ${ROLE_MD}`,
      `create ${BESIDE}`,
      `change ${MANIFEST_PATH}`,
    ])
    for (const choices of [answered(ROLE_MD, 'mine'), NO_CHOICES]) {
      const steps = await applySteps({ ...planned, desired: [NEW_ROLE, SAME_INDEX], gitignore: null, choices })

      expect(steps.map(stepLine)).toEqual([`write ${BESIDE}`, `manifest ${MANIFEST_PATH}`])
      expect(steps[0]).toEqual({ kind: 'write', path: BESIDE, text: 'new role\n' })
      expect(writtenManifest(steps)).toEqual({ ...old, cadreVersion: VERSION })
    }
  })

  test('a .cadre-new copy already there with other text is kept as it is: Keep mine writes nothing', async () => {
    const { planned } = await editedRolePlan(VERSION, { [BESIDE]: text('older\n') })
    const choices = answered(ROLE_MD, 'mine')
    const steps = await applySteps({ ...planned, desired: [NEW_ROLE, SAME_INDEX], gitignore: null, choices })

    expect(summary(planned.plan)).toEqual([
      `leave ${INDEX}`,
      `conflict ${ROLE_MD}`,
      `conflict ${BESIDE}`,
      `leave ${MANIFEST_PATH}`,
    ])
    expect(steps).toEqual([])
  })

  test('Take new writes a launcher, then makes it executable; Keep mine writes its copy with no chmod', async () => {
    const launcher = file(LAUNCHER, '#!/bin/sh\nnew\n', 'exec')
    const disk = new Map<string, PortRead>([[LAUNCHER, text('mine\n')]])
    const planned = await planWithManifest(input({ desired: [launcher], disk }))
    const taken = await applySteps({
      ...planned,
      desired: [launcher],
      gitignore: null,
      choices: answered(LAUNCHER, 'new'),
    })
    const kept = await applySteps({ ...planned, desired: [launcher], gitignore: null, choices: NO_CHOICES })

    expect(taken.map(stepLine)).toEqual([`write ${LAUNCHER}`, `chmod ${LAUNCHER}`, `manifest ${MANIFEST_PATH}`])
    expect(kept.map(stepLine)).toEqual([`write ${LAUNCHER}.cadre-new`, `manifest ${MANIFEST_PATH}`])
  })

  test('an untracked conflict taken new is recorded in the manifest, which had no entry for it', async () => {
    const disk = new Map<string, PortRead>([[ROLE_MD, text('somebody wrote this\n')]])
    const planned = await planWithManifest(input({ desired: [NEW_ROLE], disk }))
    const choices = answered(ROLE_MD, 'new')
    const steps = await applySteps({ ...planned, desired: [NEW_ROLE], gitignore: null, choices })

    expect(planned.manifest.files).toEqual([])
    expect(writtenManifest(steps)?.files).toEqual([
      { path: ROLE_MD, sha256: await sha256Hex('new role\n'), mode: 'file' },
    ])
  })

  test('an answer for a path that is no conflict changes nothing: no write, and a left manifest stays', async () => {
    const { planned } = await editedRolePlan(VERSION)
    const choices = answered(INDEX, 'new')
    const steps = await applySteps({ ...planned, desired: [NEW_ROLE, SAME_INDEX], gitignore: null, choices })

    expect(steps.map(stepLine)).toEqual([`write ${BESIDE}`])
  })

  test('a plan that keeps the manifest as a conflict has no manifest step, even when a file is taken new', async () => {
    const { planned } = await editedRolePlan(VERSION, { [MANIFEST_PATH]: { state: 'unknown' } })
    const choices = answered(ROLE_MD, 'new')
    const steps = await applySteps({ ...planned, desired: [NEW_ROLE, SAME_INDEX], gitignore: null, choices })

    expect(summary(planned.plan)).toContain(`conflict ${MANIFEST_PATH}`)
    expect(steps.map(stepLine)).toEqual([`write ${ROLE_MD}`])
  })
})
