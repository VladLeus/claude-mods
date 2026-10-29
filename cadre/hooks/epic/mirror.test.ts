import { describe, expect, test } from 'claude-code/testing'

import type { PortEntry } from '../../types'
import { entry, link } from '../testkit'
import { epicStepArgv, mirrorLinkedParentWarning, mirrorPaths, mirrorPlan, mirrorUnhideableWarning } from './mirror'
import type { EpicStep } from './mirror'

/** The worktree `/cadre epic PROJ-1` makes with no title words (D-146), and its git dir (D-164). */
const BARE_WORKTREE = '/repo/.claude/worktrees/proj-1'

describe('mirroring the main checkout into the epic worktree (D-147, D-148)', () => {
  test('each mirror step runs as one absolute argv with no shell, and a link never replaces what is there', () => {
    const linkStep: EpicStep = { kind: 'link', path: '/w/a', target: '/repo/a' }
    const copyStep: EpicStep = { kind: 'copy', path: '/w/.env', source: '/repo/.env' }

    expect(epicStepArgv({ kind: 'mkdir', path: '/w/a' })).toEqual(['/bin/mkdir', '-p', '--', '/w/a'])
    expect(epicStepArgv(linkStep)).toEqual(['/bin/ln', '-s', '--', '/repo/a', '/w/a'])
    expect(epicStepArgv(copyStep)).toEqual(['/bin/cp', '-p', '--', '/repo/.env', '/w/.env'])
  })
})

/** A mirror step as `<kind> <path below BARE_WORKTREE>`, the form the mirror rule specs compare. */
function stepLine(step: EpicStep): string {
  return `${step.kind} ${step.path.slice(BARE_WORKTREE.length + 1)}`
}

/** What the scratch repo of RESEARCH Pattern 4 holds that git does not track, as untrackedEntries gives it. */
const SCRATCH_ENTRIES: readonly string[] = [
  '.cadre',
  '.claude',
  '.claude/worktrees',
  '.env',
  '.env.local',
  'node_modules',
  'thoughts',
  'web/.env',
]

/** The scratch repo's main checkout: the listing of each folder the mirror reads, '' for the root. */
const SCRATCH_MAIN: ReadonlyMap<string, readonly PortEntry[]> = new Map([
  [
    '',
    [
      entry('.cadre', 'dir'),
      entry('.claude', 'dir'),
      entry('.env'),
      entry('.env.local'),
      entry('node_modules', 'dir'),
      entry('thoughts', 'dir'),
      entry('web', 'dir'),
    ],
  ],
  ['.cadre', [entry('bin', 'dir'), entry('pm', 'dir'), entry('cadre.json'), entry('manifest.json')]],
  ['.cadre/bin', [entry('pm')]],
  ['.cadre/pm', [entry('.runtime', 'dir'), entry('ROLE.md'), entry('role.json')]],
  ['.claude', [entry('settings.local.json'), entry('skills', 'dir'), entry('worktrees', 'dir')]],
  ['web', [entry('.env')]],
])

/** A worktree of the scratch repo whose root lists only `web`, a tracked folder. */
const SCRATCH_TREE: ReadonlyMap<string, readonly PortEntry[]> = new Map([['', [entry('web', 'dir')]]])

/** The steps the scratch repo's mirror plans for the role pm into a worktree that lists only `web` (D-156, D-172). */
const SCRATCH_STEPS: readonly string[] = [
  'mkdir .cadre',
  'mkdir .cadre/bin',
  'link .cadre/bin/pm',
  'link .cadre/cadre.json',
  'link .cadre/manifest.json',
  'mkdir .cadre/pm',
  'link .cadre/pm/ROLE.md',
  'link .cadre/pm/role.json',
  'mkdir .claude',
  'link .claude/settings.local.json',
  'link .claude/skills',
  'copy .env',
  'copy .env.local',
  'link node_modules',
  'link thoughts',
  'copy web/.env',
]

/** mirrorPlan of `entries` for the role pm from /repo into BARE_WORKTREE, over these listings. */
function planOf(
  entries: readonly string[],
  main: ReadonlyMap<string, readonly PortEntry[]>,
  tree: ReadonlyMap<string, readonly PortEntry[]>,
): ReturnType<typeof mirrorPlan> {
  return mirrorPlan({ root: '/repo', worktree: BARE_WORKTREE, entries, roleIds: ['pm'], main, tree })
}

describe('the mirror rules (D-147, D-148, D-149, D-156, D-172)', () => {
  test('the scratch listing mirrors .cadre as real folders, links the rest, copies env files, skips .runtime', () => {
    const plan = planOf(SCRATCH_ENTRIES, SCRATCH_MAIN, SCRATCH_TREE)

    expect(plan.steps.map(stepLine)).toEqual(SCRATCH_STEPS)
    expect(plan.links).toEqual([
      '.cadre/bin/pm',
      '.cadre/cadre.json',
      '.cadre/manifest.json',
      '.cadre/pm/ROLE.md',
      '.cadre/pm/role.json',
      '.claude/settings.local.json',
      '.claude/skills',
      'node_modules',
      'thoughts',
    ])
    expect(plan.copies).toEqual(['.env', '.env.local', 'web/.env'])
    expect(plan.warnings).toEqual([])
    expect(plan.steps.filter(step => step.kind !== 'mkdir').slice(0, 1)).toEqual([
      { kind: 'link', path: `${BARE_WORKTREE}/.cadre/bin/pm`, target: '/repo/.cadre/bin/pm' },
    ])
    expect(plan.steps.find(step => step.kind === 'copy')).toEqual({
      kind: 'copy',
      path: `${BARE_WORKTREE}/.env`,
      source: '/repo/.env',
    })
  })

  test('a .gitignore main does not track is copied, as git reads no linked one (03.1 S1)', () => {
    const main = new Map([['', [entry('.gitignore'), entry('node_modules', 'dir')]]])
    const plan = planOf(['.gitignore', 'node_modules'], main, new Map())

    expect(plan.steps.map(stepLine)).toEqual(['copy .gitignore', 'link node_modules'])
    expect(plan.copies).toEqual(['.gitignore'])
    expect(plan.links).toEqual(['node_modules'])
  })

  test('a target the worktree lists already, as a link or as a file, gets no step', () => {
    const tree = new Map([
      ['', [entry('web', 'dir'), link('node_modules')]],
      ['.cadre/pm', [entry('role.json')]],
    ])
    const kept = SCRATCH_STEPS.filter(step => step !== 'link node_modules' && step !== 'link .cadre/pm/role.json')

    expect(planOf(SCRATCH_ENTRIES, SCRATCH_MAIN, tree).steps.map(stepLine)).toEqual(kept)
  })

  test('an entry below a folder the worktree lists as a link gets no step and one warning naming it', () => {
    const main = new Map([['vendor', [entry('cache', 'dir')]]])
    const plan = planOf(['vendor/cache'], main, new Map([['', [link('vendor')]]]))

    expect(plan.steps).toEqual([])
    expect(plan.warnings).toEqual([mirrorLinkedParentWarning('vendor/cache')])
    expect(plan.warnings[0]).toContain('vendor/cache')
  })

  test('a reuse plans nothing below a target the worktree lists, and warns of nothing (03.1-W2 S3)', () => {
    const main = new Map([
      ['', [entry('thoughts', 'dir')]],
      ['thoughts', [entry('x.log')]],
    ])
    const plan = planOf(['thoughts', 'thoughts/x.log'], main, new Map([['', [link('thoughts')]]]))

    expect(plan.steps).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  test('nothing is planned below a planned link, while an entry below a real folder is still linked', () => {
    const tree = new Map([['', [entry('web', 'dir')]]])

    expect(planOf(['thoughts', 'thoughts/shared'], new Map(), new Map()).steps.map(stepLine)).toEqual(['link thoughts'])
    expect(planOf(['thoughts', 'thoughts/shared', 'web/dist'], new Map(), tree).steps.map(stepLine)).toEqual([
      'link thoughts',
      'link web/dist',
    ])
  })

  test('a name with a line break or another control character gets no step, nor anything below it (03.1-W2 S2)', () => {
    const main = new Map([['', [entry('a\n*'), entry('b\rc'), entry('node_modules', 'dir')]]])
    const plan = planOf(['a\n*', 'a\n*/x', 'b\rc', 'node_modules'], main, new Map())

    expect(plan.steps.map(stepLine)).toEqual(['link node_modules'])
    expect(plan.links).toEqual(['node_modules'])
    expect(plan.copies).toEqual([])
    expect(plan.warnings).toEqual([mirrorUnhideableWarning('a\n*'), mirrorUnhideableWarning('b\rc')])
  })

  test('mirrorPaths names every folder the rules read, in the main checkout and in the worktree, sorted', () => {
    expect(mirrorPaths(['.cadre', 'a/b/c', 'web/.env'], ['pm'])).toEqual({
      main: ['', '.cadre', '.cadre/bin', '.cadre/pm', '.claude', 'a/b', 'web'],
      tree: ['', '.cadre', '.cadre/bin', '.cadre/pm', '.claude', 'a', 'a/b', 'web'],
    })
  })
})
