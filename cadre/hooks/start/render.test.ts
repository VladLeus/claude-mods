import { describe, expect, test } from 'claude-code/testing'

import type { InitLocations, ProbeExpectation, RoleSpec } from '../../types'
import { probeVerdicts } from '../probe/oracle'
import type { InitInventory } from '../probe/oracle'
import { GRILL_SKILLS, MATTPOCOCK_PLUGIN } from '../roles/infra'
import { compileScope } from '../scope/compile'
import {
  context,
  DEFAULT_LOCATIONS,
  emptySetupScan,
  entry,
  hostWorld,
  memHost,
  memIo,
  memWorld,
  stateOf,
  templateRole,
} from '../testkit'
import type { MemWorld } from '../testkit'
import { renderRole, worktreeClaudeMd } from './render'
import type { EpicRender } from './render'

describe('the scope of an epic role (RESEARCH Pitfalls 1 and 2, WT-02)', () => {
  test('worktreeClaudeMd adds the CLAUDE.md files of the worktree, sorted and once each (Pitfall 1)', () => {
    expect(worktreeClaudeMd(['/repo/CLAUDE.md'], '/repo/.claude/worktrees/x')).toEqual([
      '/repo/.claude/worktrees/x/.claude/CLAUDE.md',
      '/repo/.claude/worktrees/x/CLAUDE.md',
      '/repo/CLAUDE.md',
    ])
  })
})

/** Where the fixture's mattpocock-skills is installed, as installed_plugins.json records it. */
const MATT_PATH = '/u/.claude/plugins/cache/x/mattpocock-skills/1.3.1'

/** The files of mattpocock-skills installed at `scope`, its plugin.json listing grilling, grill-me and tdd. */
function mattInstall(entry: Readonly<Record<string, string>>): Record<string, string> {
  const skills = ['./skills/productivity/grilling', './skills/productivity/grill-me', './skills/engineering/tdd']

  return {
    '/home/u/.claude/plugins/installed_plugins.json': JSON.stringify({
      version: 2,
      plugins: { [MATTPOCOCK_PLUGIN]: [{ ...entry, installPath: MATT_PATH, version: '1.3.1' }] },
    }),
    [`${MATT_PATH}/.claude-plugin/plugin.json`]: JSON.stringify({ name: 'mattpocock-skills', skills }),
  }
}

/** The folders of the fixture repo: its .git and PM's role folder. */
const REPO_DIRS = { '/repo/.git': [], '/repo/.cadre': [entry('pm', 'dir')], '/repo/.cadre/pm': [] }

/** PM given the grill skills. */
const PM: RoleSpec = templateRole('pm', { skills: [...GRILL_SKILLS] })

/** The git argv of the launch user read, answered with the common dir /repo/.git. */
const GIT_RULE = {
  argv: ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
  result: { exitCode: 0, stdout: '/repo/.git\n', stderr: '' },
}

/** The expectations renderRole wrote for PM over `world` at these locations, with this epic. */
async function renderedPm(
  world: MemWorld,
  locations: InitLocations = DEFAULT_LOCATIONS,
  epic: EpicRender | null = null,
): Promise<ProbeExpectation[]> {
  const setup = emptySetupScan({ plugins: [MATTPOCOCK_PLUGIN] })
  const scope = compileScope(PM, context({ framework: 'none', setup, roles: ['pm'] }))
  const host = memHost(hostWorld({ runs: [GIT_RULE] }))
  const input = { locations, state: stateOf([PM]), role: PM, scope, codeDirs: [], mcpRoots: [], epic }
  const render = await renderRole(memIo(world, {}).io, host.io, input)
  if (render.kind === 'refuse') throw new Error(`renderRole refused: ${render.text}`)
  const path = `${locations.root}/.cadre/pm/.runtime/probe-expectations.json`
  const written = host.writes.find(write => write.path === path)
  if (written === undefined) throw new Error('renderRole wrote no probe expectations')
  const parsed: { readonly rules: ProbeExpectation[] } = JSON.parse(written.text)

  return parsed.rules
}

/** The skill lines PM's probe gets: the two grill skills present, tdd absent, all best-effort. */
const PM_SKILL_LINES: readonly ProbeExpectation[] = [
  {
    check: 'skill-present',
    enforcement: 'best-effort',
    text: 'Skill given to the role [skill mattpocock-skills:grill-me present]',
    token: 'mattpocock-skills:grill-me',
  },
  {
    check: 'skill-present',
    enforcement: 'best-effort',
    text: 'Skill given to the role [skill mattpocock-skills:grilling present]',
    token: 'mattpocock-skills:grilling',
  },
  {
    check: 'skill-absent',
    enforcement: 'best-effort',
    text: 'Skill denied to the role [skill mattpocock-skills:tdd absent]',
    token: 'mattpocock-skills:tdd',
  },
]

/** A startup inventory listing these skills and nothing else. */
function skillsInventory(skills: readonly string[]): InitInventory {
  return { tools: [], slashCommands: [], skills, permissionMode: null, memoryAuto: null }
}

describe('the per-skill probe lines of a render', () => {
  test("PM's render writes the grill skills present and tdd absent, before the memory folder line", async () => {
    const rules = await renderedPm(memWorld({ dirs: REPO_DIRS, files: mattInstall({ scope: 'user' }) }))
    const lines = rules.slice(-4, -1)

    expect(lines).toEqual([...PM_SKILL_LINES])
    expect(rules.at(-1)?.check).toBe('memory-path')
    const all = ['mattpocock-skills:grill-me', 'mattpocock-skills:grilling', 'mattpocock-skills:tdd']
    expect(probeVerdicts(skillsInventory(all), lines).map(item => item.verdict)).toEqual([
      'best-effort',
      'best-effort',
      'violated',
    ])
    expect(probeVerdicts(skillsInventory(all.slice(0, 2)), lines).map(item => item.verdict)).toEqual([
      'best-effort',
      'best-effort',
      'best-effort',
    ])
  })
})
