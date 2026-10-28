import { describe, expect, test } from 'claude-code/testing'

import type { FrameworkId, Recommendation, RepoScan, RoleSpec, ScanFinding, TemplateRoleId } from '../../types'
import { pluginInstallArgv } from '../apply'
import { recommendationLines } from '../recommend'
import { scanRepo } from '../scan/repo'
import { BIDI_OVERRIDE, emptySetupScan, entry, memIo, memWorld, session, skillRef } from '../testkit'
import { CLAUDE_SECURITY_PLUGIN, SECURITY_GUIDANCE_PLUGIN } from './infra'
import { INSTALL_COMMANDS, missingSecurityPlugins, recommend } from './recommend'
import { standsFor } from './template'

/** A role with the fields recommend reads set and the rest defaults. */
function role(id: string, basedOn: TemplateRoleId | null, title: string): RoleSpec {
  return {
    id,
    title,
    purpose: 'p',
    basedOn,
    model: 'opus',
    effort: 'medium',
    permissionMode: 'auto',
    autopilot: { duration: '4h', threshold: 65, askUser: false },
    hasBash: true,
    mcp: [],
    skills: [],
    instructions: [],
    carry: { autoCompactWindow: false, statusLine: false, env: [], hooks: [] },
  }
}

const PM = role('pm', 'pm', 'PM')
const TL = role('tl', 'tl', 'Team Lead')
const BE = role('be', 'be', 'BE')
const FE = role('fe', 'fe', 'FE')
const QA = role('qa', 'qa', 'QA')
const SECURITY = role('security', 'security', 'Security')

/** The six template roles in template order. */
const FULL_TEAM: readonly RoleSpec[] = [PM, TL, BE, FE, QA, SECURITY]

/** Every role of a team on one framework, in role order, as init resolves them. */
function allOn(roles: readonly RoleSpec[], framework: FrameworkId): FrameworkId[] {
  return roles.map(() => framework)
}

/** A repo scan that found nothing; `over` changes the fields it names. */
function repoScan(over: Partial<RepoScan> = {}): RepoScan {
  return {
    findings: [],
    languages: [],
    codeDirs: [],
    hasSource: false,
    cappedFolders: [],
    isOverallCapped: false,
    cadre: { dir: 'absent', manifest: null, manifestState: 'absent', state: null, stateState: 'absent' },
    warnings: [],
    ...over,
  }
}

/** An E2E finding, as the repo scan records one. */
const E2E: ScanFinding = { kind: 'e2e', label: 'playwright', evidence: 'playwright.config.ts' }

const NO_FRAMEWORK_WHY = 'no dev framework is in use; roles run the built-in plan, execute, verify loop'
const PLAYWRIGHT_WHY = 'the FE role has no E2E setup to check its work in a browser'
const DEVTOOLS_WHY = 'the FE role cannot inspect the running page'
const CLAUDE_SECURITY_WHY =
  "claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)"
const GUIDANCE_WHY = 'no hooks warn the Security role about risky edits'

const GSD_LINE: Recommendation = { tool: 'GSD', roleId: null, why: NO_FRAMEWORK_WHY, install: INSTALL_COMMANDS.gsd }
const SUPERPOWERS_LINE: Recommendation = {
  tool: 'superpowers',
  roleId: null,
  why: NO_FRAMEWORK_WHY,
  install: INSTALL_COMMANDS.superpowers,
}

/** The Playwright MCP recommendation for the FE role `roleId`. */
function playwrightFor(roleId: string): Recommendation {
  return { tool: 'Playwright MCP', roleId, why: PLAYWRIGHT_WHY, install: INSTALL_COMMANDS.playwright }
}

/** The DevTools MCP recommendation for the FE role `roleId`. */
function devtoolsFor(roleId: string): Recommendation {
  return { tool: 'DevTools MCP', roleId, why: DEVTOOLS_WHY, install: INSTALL_COMMANDS.devtools }
}

/** The claude-security recommendation for the Security role `roleId` (decision #39). */
function claudeSecurityFor(roleId: string): Recommendation {
  return { tool: 'claude-security', roleId, why: CLAUDE_SECURITY_WHY, install: INSTALL_COMMANDS.claudeSecurity }
}

/** The security-guidance recommendation for the Security role `roleId` (decision #39). */
function guidanceFor(roleId: string): Recommendation {
  return { tool: 'security-guidance', roleId, why: GUIDANCE_WHY, install: INSTALL_COMMANDS.securityGuidance }
}

describe('recommend', () => {
  test('INSTALL_COMMANDS holds the six printed commands word for word, and is frozen', () => {
    expect(INSTALL_COMMANDS).toEqual({
      gsd: 'npx -y --package=@opengsd/gsd-core@latest -- gsd-core --global',
      superpowers: 'claude plugin install superpowers@claude-plugins-official',
      playwright: 'claude mcp add playwright -- npx @playwright/mcp@latest',
      devtools: 'claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest',
      claudeSecurity: 'claude plugin install claude-security@claude-plugins-official',
      securityGuidance: 'claude plugin install security-guidance@claude-plugins-official',
    })
    expect(Object.isFrozen(INSTALL_COMMANDS)).toBe(true)
    expect(INSTALL_COMMANDS.claudeSecurity).toBe(pluginInstallArgv(CLAUDE_SECURITY_PLUGIN).join(' '))
    expect(INSTALL_COMMANDS.securityGuidance).toBe(pluginInstallArgv(SECURITY_GUIDANCE_PLUGIN).join(' '))
  })

  test('no framework in use for any role gives the GSD and superpowers lines, first', () => {
    const roles = [PM, TL]

    expect(recommend({ roles, frameworks: allOn(roles, 'none'), scan: repoScan(), setup: emptySetupScan() })).toEqual([
      GSD_LINE,
      SUPERPOWERS_LINE,
    ])
  })

  test('a framework in use for any role gives no GSD or superpowers line', () => {
    const roles = [PM, TL]
    const frameworks: readonly (readonly FrameworkId[])[] = [
      ['gsd', 'gsd'],
      ['superpowers', 'superpowers'],
      ['gsd', 'none'],
      ['none', 'superpowers'],
    ]

    for (const resolved of frameworks) {
      expect(recommend({ roles, frameworks: resolved, scan: repoScan(), setup: emptySetupScan() })).toEqual([])
    }
  })

  test('a team with no roles gets no recommendation', () => {
    expect(recommend({ roles: [], frameworks: [], scan: repoScan(), setup: emptySetupScan() })).toEqual([])
  })

  test('an FE role with no E2E finding and no playwright MCP gets the Playwright MCP line', () => {
    const setup = emptySetupScan({ mcp: [session('chrome-devtools')] })

    expect(recommend({ roles: [FE], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([playwrightFor('fe')])
  })

  test('an E2E finding means no Playwright MCP line', () => {
    const scan = repoScan({ findings: [E2E] })
    const setup = emptySetupScan({ mcp: [session('chrome-devtools')] })

    expect(recommend({ roles: [FE], frameworks: ['gsd'], scan, setup })).toEqual([])
  })

  test('a Rails repo scanned with spec/system gets no Playwright MCP line for FE (G-02-1d)', async () => {
    const world = memWorld({
      dirs: {
        '/repo': [entry('Gemfile'), entry('app', 'dir'), entry('spec', 'dir')],
        '/repo/app': [entry('user.rb')],
        '/repo/spec': [entry('system', 'dir')],
        '/repo/spec/system': [entry('login_spec.rb')],
      },
      files: { '/repo/Gemfile': "gem 'rails'" },
    })
    const scan = await scanRepo(memIo(world, []).io, '/repo')
    const setup = emptySetupScan({ mcp: [session('chrome-devtools')] })

    expect(scan.findings.filter(finding => finding.kind === 'e2e')).toEqual([
      { kind: 'e2e', label: 'Rails system specs', evidence: 'spec/system' },
    ])
    expect(recommend({ roles: [FE], frameworks: ['gsd'], scan, setup })).toEqual([])
  })

  test('a playwright MCP server, in any case and inside a longer name, means no Playwright MCP line', () => {
    for (const name of ['playwright', 'Playwright', 'plugin_playwright_playwright', 'my-PLAYWRIGHT-server']) {
      const setup = emptySetupScan({ mcp: [session(name), session('chrome-devtools')] })

      expect(recommend({ roles: [FE], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([])
    }
  })

  test('an FE role with no devtools MCP gets the DevTools MCP line, whether E2E was found or not', () => {
    const scan = repoScan({ findings: [E2E] })
    const setup = emptySetupScan({ mcp: [session('playwright')] })

    expect(recommend({ roles: [FE], frameworks: ['gsd'], scan, setup })).toEqual([devtoolsFor('fe')])
    expect(recommend({ roles: [FE], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([devtoolsFor('fe')])
  })

  test('a devtools MCP server, in any case and inside a longer name, means no DevTools MCP line', () => {
    for (const name of ['chrome-devtools', 'DevTools', 'devtools-mcp']) {
      const setup = emptySetupScan({ mcp: [session(name), session('playwright')] })

      expect(recommend({ roles: [FE], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([])
    }
  })

  test('an FE role with neither tool gets both lines, Playwright first', () => {
    expect(recommend({ roles: [FE], frameworks: ['gsd'], scan: repoScan(), setup: emptySetupScan() })).toEqual([
      playwrightFor('fe'),
      devtoolsFor('fe'),
    ])
  })

  test('a role based on fe is named by its own id, and a role with the id fe needs no base', () => {
    const web = role('web', 'fe', 'Web UI')
    const frontend = role('fe', null, 'Frontend')

    expect(recommend({ roles: [web], frameworks: ['gsd'], scan: repoScan(), setup: emptySetupScan() })).toEqual([
      playwrightFor('web'),
      devtoolsFor('web'),
    ])
    expect(recommend({ roles: [frontend], frameworks: ['gsd'], scan: repoScan(), setup: emptySetupScan() })).toEqual([
      playwrightFor('fe'),
      devtoolsFor('fe'),
    ])
  })

  test('each FE role gets its own line, rule by rule', () => {
    const roles = [FE, role('web', 'fe', 'Web UI')]

    expect(recommend({ roles, frameworks: allOn(roles, 'gsd'), scan: repoScan(), setup: emptySetupScan() })).toEqual([
      playwrightFor('fe'),
      playwrightFor('web'),
      devtoolsFor('fe'),
      devtoolsFor('web'),
    ])
  })

  test('a Security role with neither security plugin gets the claude-security and security-guidance lines', () => {
    expect(recommend({ roles: [SECURITY], frameworks: ['gsd'], scan: repoScan(), setup: emptySetupScan() })).toEqual([
      claudeSecurityFor('security'),
      guidanceFor('security'),
    ])
    const sec = role('sec', 'security', 'Sec')
    expect(recommend({ roles: [sec], frameworks: ['gsd'], scan: repoScan(), setup: emptySetupScan() })).toEqual([
      claudeSecurityFor('sec'),
      guidanceFor('sec'),
    ])
  })

  test('the exact claude-plugins-official key of an installed security plugin removes its line', () => {
    const cases: readonly (readonly [string[], Recommendation[]])[] = [
      [[CLAUDE_SECURITY_PLUGIN], [guidanceFor('security')]],
      [[SECURITY_GUIDANCE_PLUGIN], [claudeSecurityFor('security')]],
      [[CLAUDE_SECURITY_PLUGIN, SECURITY_GUIDANCE_PLUGIN], []],
    ]

    for (const [plugins, expected] of cases) {
      const setup = emptySetupScan({ plugins, installedPlugins: plugins })

      expect(recommend({ roles: [SECURITY], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual(expected)
    }
  })

  test('an exact security plugin key that only a settings file enables removes no line (#69 A1)', () => {
    const setup = emptySetupScan({ plugins: [CLAUDE_SECURITY_PLUGIN, SECURITY_GUIDANCE_PLUGIN] })

    expect(recommend({ roles: [SECURITY], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([
      claudeSecurityFor('security'),
      guidanceFor('security'),
    ])
  })

  test('a security plugin key of another marketplace removes no line (T-03-46)', () => {
    const lookalikes = ['claude-security@other-market', 'security-guidance@other-market']
    const setup = emptySetupScan({ plugins: lookalikes, installedPlugins: lookalikes })

    expect(recommend({ roles: [SECURITY], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([
      claudeSecurityFor('security'),
      guidanceFor('security'),
    ])
  })

  test('a scanned security-review skill, plain, from a plugin or in any case, removes no line', () => {
    const skills = [
      skillRef('security-review'),
      skillRef('claude-code:security-review', 'claude-code'),
      skillRef('my-security-review'),
      skillRef('Acme:Security-Review'),
    ]

    for (const found of skills) {
      const setup = emptySetupScan({ skills: [skillRef('review'), found] })

      expect(recommend({ roles: [SECURITY], frameworks: ['gsd'], scan: repoScan(), setup })).toEqual([
        claudeSecurityFor('security'),
        guidanceFor('security'),
      ])
    }
  })

  test('a full team with nothing found gets the six lines in rule order', () => {
    const lines = recommend({
      roles: FULL_TEAM,
      frameworks: allOn(FULL_TEAM, 'none'),
      scan: repoScan(),
      setup: emptySetupScan(),
    })

    expect(lines.map(line => [line.tool, line.roleId])).toEqual([
      ['GSD', null],
      ['superpowers', null],
      ['Playwright MCP', 'fe'],
      ['DevTools MCP', 'fe'],
      ['claude-security', 'security'],
      ['security-guidance', 'security'],
    ])
  })

  test('with a framework, E2E, both MCP servers and both security plugins installed nothing is recommended', () => {
    const scan = repoScan({ findings: [E2E] })
    const setup = emptySetupScan({
      mcp: [session('playwright'), session('chrome-devtools')],
      plugins: [CLAUDE_SECURITY_PLUGIN, SECURITY_GUIDANCE_PLUGIN],
      installedPlugins: [CLAUDE_SECURITY_PLUGIN, SECURITY_GUIDANCE_PLUGIN],
    })

    expect(recommend({ roles: FULL_TEAM, frameworks: allOn(FULL_TEAM, 'gsd'), scan, setup })).toEqual([])
  })

  test('a recommendation is plain data: a tool, a role id, a reason and a command as text, never run', () => {
    const lines = recommend({
      roles: FULL_TEAM,
      frameworks: allOn(FULL_TEAM, 'none'),
      scan: repoScan(),
      setup: emptySetupScan(),
    })

    expect(lines).toHaveLength(6)
    for (const line of lines) {
      expect(Object.keys(line).sort()).toEqual(['install', 'roleId', 'tool', 'why'])
      expect(typeof line.install).toBe('string')
      expect(typeof line.why).toBe('string')
    }
  })

  test('each security command is the one printed string, wherever it is shown', () => {
    const lines = recommend({ roles: [SECURITY], frameworks: ['gsd'], scan: repoScan(), setup: emptySetupScan() })

    expect(lines.map(line => line.install)).toEqual([
      INSTALL_COMMANDS.claudeSecurity,
      INSTALL_COMMANDS.securityGuidance,
    ])
  })

  test('recommendationLines of no recommendation says none', () => {
    expect(recommendationLines([], FULL_TEAM)).toEqual(['Recommendations: none'])
  })

  test('recommendationLines prints a heading, then each tool for its role with the exact command to run', () => {
    const lines = recommend({
      roles: FULL_TEAM,
      frameworks: allOn(FULL_TEAM, 'none'),
      scan: repoScan(),
      setup: emptySetupScan(),
    })

    expect(recommendationLines(lines, FULL_TEAM)).toEqual([
      'Recommendations (print-only; init asks before it installs any):',
      '- GSD for all roles: no dev framework is in use; roles run the built-in plan, execute, verify loop',
      '    run: npx -y --package=@opengsd/gsd-core@latest -- gsd-core --global',
      '- superpowers for all roles: no dev framework is in use; roles run the built-in plan, execute, verify loop',
      '    run: claude plugin install superpowers@claude-plugins-official',
      '- Playwright MCP for FE: the FE role has no E2E setup to check its work in a browser',
      '    run: claude mcp add playwright -- npx @playwright/mcp@latest',
      '- DevTools MCP for FE: the FE role cannot inspect the running page',
      '    run: claude mcp add chrome-devtools -- npx chrome-devtools-mcp@latest',
      `- claude-security for Security: ${CLAUDE_SECURITY_WHY}`,
      '    run: claude plugin install claude-security@claude-plugins-official',
      '- security-guidance for Security: no hooks warn the Security role about risky edits',
      '    run: claude plugin install security-guidance@claude-plugins-official',
    ])
  })

  test('recommendationLines names the role by its title, and by its id when no role has it', () => {
    const web = role('web', 'fe', 'Web UI')
    const named = recommendationLines([playwrightFor('web')], [web])
    const unknown = recommendationLines([playwrightFor('ghost')], [web])

    expect(named[1]).toBe(`- Playwright MCP for Web UI: ${PLAYWRIGHT_WHY}`)
    expect(unknown[1]).toBe(`- Playwright MCP for ghost: ${PLAYWRIGHT_WHY}`)
  })

  test('recommendationLines cleans every cell, so a hostile value adds no line and hides no text', () => {
    const hostile: Recommendation = {
      tool: `T${BIDI_OVERRIDE}\nx`,
      roleId: 'web',
      why: 'w\nFAKE',
      install: `i${BIDI_OVERRIDE}\nrm -rf`,
    }
    const lines = recommendationLines([hostile], [role('web', 'fe', 'A\nB')])

    expect(lines).toEqual([
      'Recommendations (print-only; init asks before it installs any):',
      '- Tx for AB: wFAKE',
      '    run: irm -rf',
    ])
  })

  test('recommendationLines caps a long cell at 240 code points', () => {
    const long: Recommendation = { tool: 'T', roleId: null, why: 'w'.repeat(300), install: 'i' }
    const lines = recommendationLines([long], [])

    expect(lines[1]).toBe(`- T for all roles: ${'w'.repeat(239)}…`)
  })

  test('tracer for the whole path: a team with no framework gives lines that name the commands and run none', () => {
    const roles = [PM, FE]
    const lines = recommendationLines(
      recommend({ roles, frameworks: allOn(roles, 'none'), scan: repoScan(), setup: emptySetupScan() }),
      roles,
    )

    expect(lines.filter(line => line.startsWith('    run: '))).toEqual([
      `    run: ${INSTALL_COMMANDS.gsd}`,
      `    run: ${INSTALL_COMMANDS.superpowers}`,
      `    run: ${INSTALL_COMMANDS.playwright}`,
      `    run: ${INSTALL_COMMANDS.devtools}`,
    ])
  })
})

describe('security recommendations (decision #39)', () => {
  test('the Security lines name exactly the plugins missingSecurityPlugins gives, as the install question does', () => {
    const teams: readonly (readonly RoleSpec[])[] = [[SECURITY], [role('sec', 'security', 'Sec')], FULL_TEAM, [PM, FE]]
    const both = [CLAUDE_SECURITY_PLUGIN, SECURITY_GUIDANCE_PLUGIN]
    const lookalikes = ['claude-security@other-market', 'security-guidance@other-market']
    const setups = [
      emptySetupScan(),
      emptySetupScan({ plugins: [CLAUDE_SECURITY_PLUGIN], installedPlugins: [CLAUDE_SECURITY_PLUGIN] }),
      emptySetupScan({ plugins: [SECURITY_GUIDANCE_PLUGIN], installedPlugins: [SECURITY_GUIDANCE_PLUGIN] }),
      emptySetupScan({ plugins: both, installedPlugins: both }),
      // Enabled by a settings file only, the repo's own included: not installed (#69 A1).
      emptySetupScan({ plugins: both }),
      emptySetupScan({ plugins: lookalikes, installedPlugins: lookalikes }),
      emptySetupScan({ skills: [skillRef('security-review'), skillRef('claude-code:security-review', 'claude-code')] }),
    ]

    for (const team of teams) {
      for (const setup of setups) {
        const lines = recommend({ roles: team, frameworks: allOn(team, 'gsd'), scan: repoScan(), setup })
        const security = lines.filter(line =>
          team.some(member => member.id === line.roleId && standsFor(member, 'security')),
        )
        const names = missingSecurityPlugins(team, setup).map(key => key.split('@')[0] ?? key)

        expect(security.map(line => line.tool)).toEqual(names)
      }
    }
  })
})
