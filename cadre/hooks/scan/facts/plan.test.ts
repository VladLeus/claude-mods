import { describe, expect, test } from 'claude-code/testing'

import type { GsdReadTarget } from '../../../types'
import { factReadPlan } from './plan'

/** The user-level GSD install under /home/u, as the host reads it. */
const USER_TARGET: GsdReadTarget = {
  location: 'user',
  dir: '/home/u/.claude/gsd-core',
  versionPath: '/home/u/.claude/gsd-core/VERSION',
  identityPath: '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs',
  manifestPath: '/home/u/.claude/gsd-file-manifest.json',
}

/** The repo-local GSD copy under /repo, as the host reads it. */
const PROJECT_TARGET: GsdReadTarget = {
  location: 'project',
  dir: '/repo/.claude/gsd-core',
  versionPath: '/repo/.claude/gsd-core/VERSION',
  identityPath: '/repo/.claude/gsd-core/bin/lib/package-identity.cjs',
  manifestPath: '/repo/.claude/gsd-file-manifest.json',
}

describe('factReadPlan', () => {
  test('without CLAUDE_CONFIG_DIR the user install is under home, and the repo has its own copy', () => {
    expect(factReadPlan({ root: '/repo', home: '/home/u', configDir: null })).toEqual({
      installedPluginsPath: '/home/u/.claude/plugins/installed_plugins.json',
      gsd: [USER_TARGET, PROJECT_TARGET],
      warnings: [],
    })
  })

  test('CLAUDE_CONFIG_DIR replaces the home .claude folder for the plugins file and the user install', () => {
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: '/opt/claude' })
    expect(plan.installedPluginsPath).toBe('/opt/claude/plugins/installed_plugins.json')
    expect(plan.gsd[0]?.dir).toBe('/opt/claude/gsd-core')
    expect(plan.gsd[0]?.manifestPath).toBe('/opt/claude/gsd-file-manifest.json')
    expect(plan.gsd[1]).toEqual(PROJECT_TARGET)
    expect(plan.warnings).toEqual([])
  })

  test('an unsafe CLAUDE_CONFIG_DIR is ignored, with a warning that repeats nothing, and home is used', () => {
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: 'rel/../x' })
    expect(plan.installedPluginsPath).toBe('/home/u/.claude/plugins/installed_plugins.json')
    expect(plan.gsd[0]).toEqual(USER_TARGET)
    expect(plan.warnings.join(' ')).toContain('CLAUDE_CONFIG_DIR')
    expect(plan.warnings.join(' ')).not.toContain('rel/../x')
  })

  test('a CLAUDE_CONFIG_DIR inside the repo is ignored, so the repo cannot host the user install', () => {
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: '/repo/.claude-config' })
    expect(plan.gsd[0]).toEqual(USER_TARGET)
    expect(plan.warnings.join(' ')).toContain('CLAUDE_CONFIG_DIR')
  })

  test('with no home folder, a safe CLAUDE_CONFIG_DIR alone gives the user install', () => {
    const plan = factReadPlan({ root: '/repo', home: null, configDir: '/opt/claude' })
    expect(plan.installedPluginsPath).toBe('/opt/claude/plugins/installed_plugins.json')
    expect(plan.gsd[0]?.dir).toBe('/opt/claude/gsd-core')
    expect(plan.gsd[0]?.manifestPath).toBe('/opt/claude/gsd-file-manifest.json')
  })

  test('with neither home nor CLAUDE_CONFIG_DIR only the repo copy is read, and a warning says so', () => {
    const plan = factReadPlan({ root: '/repo', home: null, configDir: null })
    expect(plan.installedPluginsPath).toBeNull()
    expect(plan.gsd).toEqual([PROJECT_TARGET])
    expect(plan.warnings.join(' ')).toContain('user-level installs were not checked')
  })

  test('a CLAUDE_CONFIG_DIR that only shares a text prefix with the root is accepted', () => {
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: '/repo-cfg' })
    expect(plan.gsd[0]?.dir).toBe('/repo-cfg/gsd-core')
    expect(plan.warnings).toEqual([])
  })

  test('a root with a trailing slash behaves like the root without it', () => {
    expect(factReadPlan({ root: '/repo/', home: '/home/u', configDir: '/repo-cfg' })).toEqual(
      factReadPlan({ root: '/repo', home: '/home/u', configDir: '/repo-cfg' }),
    )
    expect(factReadPlan({ root: '/repo/', home: '/home/u', configDir: '/repo/cfg' }).gsd[0]).toEqual(USER_TARGET)
  })

  test('a home folder and a CLAUDE_CONFIG_DIR with a trailing slash behave like the ones without it', () => {
    expect(factReadPlan({ root: '/repo', home: '/home/u/', configDir: null }).gsd[0]).toEqual(USER_TARGET)
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: '/opt/claude/' })
    expect(plan.gsd[0]?.dir).toBe('/opt/claude/gsd-core')
    expect(plan.warnings).toEqual([])
  })

  test('a CLAUDE_CONFIG_DIR equal to the root is ignored, with the warning', () => {
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: '/repo' })
    expect(plan.gsd[0]).toEqual(USER_TARGET)
    expect(plan.warnings.join(' ')).toContain('CLAUDE_CONFIG_DIR')
  })

  test('a CLAUDE_CONFIG_DIR with an empty or . segment is ignored, with the warning', () => {
    for (const configDir of ['/./repo/x', '//repo/x']) {
      const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir })
      expect(plan.gsd[0]).toEqual(USER_TARGET)
      expect(plan.warnings.join(' ')).toContain('CLAUDE_CONFIG_DIR')
    }
  })

  test('a home folder with a .. segment, a relative home and a root home give no user folder', () => {
    for (const home of ['/a/../repo', 'foo', '/']) {
      const plan = factReadPlan({ root: '/repo', home, configDir: null })
      expect(plan.installedPluginsPath).toBeNull()
      expect(plan.gsd.map(target => target.location)).toEqual(['project'])
      expect(plan.warnings.join(' ')).toContain('user-level installs were not checked')
    }
  })

  test('a home folder that lies inside the repo is not read as the user install', () => {
    const plan = factReadPlan({ root: '/home/u', home: '/home/u', configDir: null })
    expect(plan.gsd.map(target => target.location)).toEqual(['project'])
    expect(plan.warnings.join(' ')).toContain('user-level installs were not checked')
  })
})
