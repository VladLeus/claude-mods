import { describe, expect, test } from 'claude-code/testing'

import type { FileOp, HunkOp, Plan, RoleSpec } from '../../types'
import { compareText } from '../core/text'
import { NOT_SET_TEXT } from '../framework/gsd/hunks'
import { desiredFiles } from '../generate/files'
import { planReadPaths } from '../plan/plan'
import { proposeRoles } from '../roles/propose'
import { parseCadreState } from '../state/cadre-files'
import { scopesFor } from '../team'
import { DEFAULT_LOCATIONS, emptyDiskPlan, gitWorld, manifestOf, memIo, scansOf, stateOf } from '../testkit'
import type { MemWorld } from '../testkit'
import { planStep } from './initplan'

/** The roles init keeps for `world` with the INIT_ANSWERS defaults: the template proposal of its scan, unchanged. */
async function defaultRoles(world: MemWorld): Promise<readonly RoleSpec[]> {
  return proposeRoles((await scansOf(world)).repo).roles
}

/** The default team of the git fixture world has a Security role, so its ignore block holds the reports line. */
const GIT_TEAM_HAS_SECURITY = true

/** A GSD config hunk as hunkStep records it: required, accepted and runnable unless `over` says otherwise. */
function gsdHunk(over: Partial<HunkOp> = {}): HunkOp {
  return {
    kind: 'hunk',
    file: '.planning/config.json',
    key: 'mode',
    before: NOT_SET_TEXT,
    after: '"yolo"',
    isRequired: true,
    isAccepted: true,
    isRunnable: true,
    command: 'node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo',
    ...over,
  }
}

describe('init plan', () => {
  test('planStep plans a create for each planned file, the manifest and .gitignore, then hunks (PLAN-01)', async () => {
    const team = await defaultRoles(gitWorld())
    const scans = await scansOf(gitWorld())
    const scopes = scopesFor(team, 'none', scans, [], { kind: 'git-root' })
    const hunks = [gsdHunk(), gsdHunk({ key: 'workflow.text_mode', before: 'true', after: 'false' })]
    const input: Parameters<typeof planStep>[1] = {
      roles: team,
      repoDefault: 'none',
      policy: 'definitions',
      launchStart: { kind: 'git-root' },
      scopes,
      hunks,
      repo: scans.repo,
      locations: DEFAULT_LOCATIONS,
      readUserMcp: false,
    }
    const result = await planStep(memIo(gitWorld(), {}).io, input)
    expect(result.state).toEqual(stateOf(team))
    const desired = desiredFiles({ roles: team, scopes, state: result.state, only: null })
    expect(result.plan).toEqual(await emptyDiskPlan(desired, 'definitions', hunks, GIT_TEAM_HAS_SECURITY))
    const files = result.plan.ops.filter((op): op is FileOp => op.kind !== 'hunk')
    const paths = [...desired.map(file => file.path), '.cadre/manifest.json', '.gitignore'].sort(compareText)
    expect(files.map(op => [op.kind, op.path])).toEqual(paths.map(path => ['create', path]))
    expect(result.plan.ops.slice(files.length)).toEqual(hunks)
  })

  test('planStep reads each planned path, the copy beside it and .gitignore through readRepoFile', async () => {
    const team = await defaultRoles(gitWorld())
    const scans = await scansOf(gitWorld())
    const scopes = scopesFor(team, 'none', scans, [], { kind: 'git-root' })
    const linked = '/repo/.cadre/pm/ROLE.md'
    const world = gitWorld({ files: { [linked]: 'x' }, realPaths: { [linked]: '/elsewhere/ROLE.md' } })
    const run = memIo(world, {})
    const result = await planStep(run.io, {
      roles: team,
      repoDefault: 'none',
      policy: 'all',
      launchStart: { kind: 'here' },
      scopes,
      hunks: [],
      repo: scans.repo,
      locations: DEFAULT_LOCATIONS,
      readUserMcp: false,
    })
    const desired = desiredFiles({ roles: team, scopes, state: result.state, only: null })
    const paths = [...planReadPaths(desired), '.gitignore'].map(path => `/repo/${path}`)
    expect(paths.filter(path => path !== linked && !run.reads.includes(path))).toEqual([])
    expect(run.reads).not.toContain(linked)
    const op = result.plan.ops.find(item => item.kind !== 'hunk' && item.path === '.cadre/pm/ROLE.md')
    expect(op?.kind).toBe('conflict')
    expect(result.state).toEqual(stateOf(team, { gitPolicy: 'all', launchStart: { kind: 'here' } }))
  })

  test("planStep writes cadre's own version into cadre.json and the manifest, and unknown when it cannot", async () => {
    const team = await defaultRoles(gitWorld())
    const scans = await scansOf(gitWorld())
    const scopes = scopesFor(team, 'none', scans, [], { kind: 'git-root' })
    const input: Parameters<typeof planStep>[1] = {
      roles: team,
      repoDefault: 'none',
      policy: 'definitions',
      launchStart: { kind: 'git-root' },
      scopes,
      hunks: [],
      repo: scans.repo,
      locations: DEFAULT_LOCATIONS,
      readUserMcp: false,
    }
    const desired = desiredFiles({ roles: team, scopes, state: stateOf(team, { cadreVersion: 'unknown' }), only: null })
    expect(desired.find(file => file.path === '.cadre/cadre.json')?.content).toContain('"cadreVersion": "unknown"')
    const files = { '/repo/.cadre/manifest.json': await manifestOf(desired, 'unknown') }
    const unknown = await planStep(memIo(gitWorld({ cadreVersion: null, files }), {}).io, input)
    expect(unknown.state.cadreVersion).toBe('unknown')
    const manifestKind = (plan: Plan): string | undefined =>
      plan.ops.find(op => op.kind !== 'hunk' && op.path === '.cadre/manifest.json')?.kind
    expect(manifestKind(unknown.plan)).toBe('leave')
    const known = await planStep(memIo(gitWorld({ files }), {}).io, input)
    expect(known.state.cadreVersion).toBe('0.2.0')
    expect(manifestKind(known.plan)).toBe('change')
  })

  test('planStep records the ~/.claude.json consent answer in the state and the planned cadre.json (A1)', async () => {
    const team = await defaultRoles(gitWorld())
    const scans = await scansOf(gitWorld())
    const scopes = scopesFor(team, 'none', scans, [], { kind: 'git-root' })
    for (const readUserMcp of [true, false]) {
      const result = await planStep(memIo(gitWorld(), {}).io, {
        roles: team,
        repoDefault: 'none',
        policy: 'definitions',
        launchStart: { kind: 'git-root' },
        scopes,
        hunks: [],
        repo: scans.repo,
        locations: DEFAULT_LOCATIONS,
        readUserMcp,
      })
      expect([readUserMcp, result.state.readUserMcp]).toEqual([readUserMcp, readUserMcp])
      const desired = desiredFiles({ roles: team, scopes, state: result.state, only: null })
      const stored = parseCadreState(desired.find(file => file.path === '.cadre/cadre.json')?.content ?? '')
      expect([readUserMcp, stored?.readUserMcp]).toEqual([readUserMcp, readUserMcp])
    }
  })
})
