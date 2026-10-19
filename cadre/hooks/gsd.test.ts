import { describe, expect, test } from 'claude-code/testing'

import type { Detection, Facts, GsdFact, RepoEntry } from '../types'
import { gateProblems, missingFields } from './framework'
import {
  detectGsd,
  GSD_ADAPTER,
  GSD_AUTONOMY,
  GSD_CONFIG_FILE,
  GSD_GATES,
  GSD_HOOK_NOTES,
  gsdHookFacts,
  gsdKickoffText,
} from './gsd'
import { DONE_MARKER_LINE } from './kickoff'
import { adaptersReportLines } from './render'

/** Facts with every list empty. A test sets only the list it reads. */
function facts(over: Partial<Facts>): Facts {
  return {
    repoEntries: [],
    docsEntries: [],
    enabledPlugins: [],
    hookScripts: [],
    superpowersVersions: [],
    gsd: [],
    warnings: [],
    ...over,
  }
}

/** The `.planning/` folder at the repo root, as the host lists it. */
const PLANNING_DIR: RepoEntry = { name: '.planning', kind: 'dir', isLink: false }

/** A user-level GSD install whose identity the host proved. */
const PROVEN_USER_INSTALL: GsdFact = {
  location: 'user',
  dir: '~/.claude/gsd-core',
  version: '1.16.0',
  identity: 'proven',
  runtimeIdentityTried: false,
}

/** What detection reports when GSD is neither in use nor installed. */
const NOT_FOUND: Detection = {
  id: 'gsd',
  name: 'GSD',
  status: 'not-found',
  version: null,
  evidence: ['no .planning/', 'no gsd-core install proven'],
}

describe('detectGsd', () => {
  test('a .planning/ directory at the repo root is in use, with the dir evidence', () => {
    expect(detectGsd(facts({ repoEntries: [PLANNING_DIR] }))).toEqual({
      id: 'gsd',
      name: 'GSD',
      status: 'in-use',
      version: null,
      evidence: ['.planning/ (dir)'],
    })
  })

  test('a .planning/ symlink is in use, with the symlink evidence', () => {
    const link: RepoEntry = { name: '.planning', kind: 'other', isLink: true }

    expect(detectGsd(facts({ repoEntries: [link] }))).toEqual({
      id: 'gsd',
      name: 'GSD',
      status: 'in-use',
      version: null,
      evidence: ['.planning/ (symlink)'],
    })
  })

  test('a plain file named .planning is not GSD in use', () => {
    const file: RepoEntry = { name: '.planning', kind: 'file', isLink: false }

    expect(detectGsd(facts({ repoEntries: [file] }))).toEqual(NOT_FOUND)
  })

  test('a proven user-level install alone is installed, with its version and dir as evidence', () => {
    expect(detectGsd(facts({ gsd: [PROVEN_USER_INSTALL] }))).toEqual({
      id: 'gsd',
      name: 'GSD',
      status: 'installed',
      version: '1.16.0',
      evidence: ['gsd-core 1.16.0 at ~/.claude/gsd-core'],
    })
  })

  test('in use beats installed: one detection carries both evidence strings', () => {
    expect(detectGsd(facts({ repoEntries: [PLANNING_DIR], gsd: [PROVEN_USER_INSTALL] }))).toEqual({
      id: 'gsd',
      name: 'GSD',
      status: 'in-use',
      version: '1.16.0',
      evidence: ['.planning/ (dir)', 'gsd-core 1.16.0 at ~/.claude/gsd-core'],
    })
  })

  test('a proven install with no readable version is installed, with version unknown in its evidence', () => {
    const noVersion: GsdFact = { ...PROVEN_USER_INSTALL, version: null }

    expect(detectGsd(facts({ gsd: [noVersion] }))).toEqual({
      id: 'gsd',
      name: 'GSD',
      status: 'installed',
      version: null,
      evidence: ['gsd-core (version unknown) at ~/.claude/gsd-core'],
    })
  })

  test('an install whose identity is unknown is never counted as installed', () => {
    const unknown: GsdFact = { ...PROVEN_USER_INSTALL, identity: 'unknown' }

    expect(detectGsd(facts({ gsd: [unknown] }))).toEqual(NOT_FOUND)
  })

  test('an install whose identity is absent is never counted as installed', () => {
    const absent: GsdFact = { ...PROVEN_USER_INSTALL, identity: 'absent' }

    expect(detectGsd(facts({ gsd: [absent] }))).toEqual(NOT_FOUND)
  })

  test('the version comes from the first proven install that has one', () => {
    const first: GsdFact = { ...PROVEN_USER_INSTALL, version: null }
    const second: GsdFact = { ...PROVEN_USER_INSTALL, dir: '<repo>/.claude/gsd-core', version: '1.2.3' }

    expect(detectGsd(facts({ gsd: [first, second] })).version).toBe('1.2.3')
  })

  test('a .planning/ directory that is also a symlink is in use, named as a symlink', () => {
    const link: RepoEntry = { name: '.planning', kind: 'dir', isLink: true }

    expect(detectGsd(facts({ repoEntries: [link] }))).toEqual({
      id: 'gsd',
      name: 'GSD',
      status: 'in-use',
      version: null,
      evidence: ['.planning/ (symlink)'],
    })
  })

  test('in use with an unproven install leaves the install out of the evidence and the version null', () => {
    const unknown: GsdFact = { ...PROVEN_USER_INSTALL, identity: 'unknown' }

    expect(detectGsd(facts({ repoEntries: [PLANNING_DIR], gsd: [unknown] }))).toEqual({
      id: 'gsd',
      name: 'GSD',
      status: 'in-use',
      version: null,
      evidence: ['.planning/ (dir)'],
    })
  })

  test('an unrelated entry beside a plain-file .planning is not GSD in use', () => {
    const other: RepoEntry = { name: 'src', kind: 'dir', isLink: false }
    const file: RepoEntry = { name: '.planning', kind: 'file', isLink: false }

    expect(detectGsd(facts({ repoEntries: [other, file] }))).toEqual(NOT_FOUND)
  })

  test('no .planning/ and no proven install is not-found, with both absence reasons', () => {
    expect(detectGsd(facts({}))).toEqual(NOT_FOUND)
  })
})

describe('gsdHookFacts', () => {
  test('registered role hooks come out in GSD_HOOK_NOTES order, with their notes', () => {
    const hooks = facts({
      hookScripts: [
        { script: 'gsd-secret-read-guard.js', event: 'PreToolUse', source: 'user' },
        { script: 'gsd-context-monitor.js', event: 'PostToolUse', source: 'project' },
        { script: 'gsd-prompt-guard.js', event: 'UserPromptSubmit', source: 'user' },
      ],
    })

    expect(gsdHookFacts(hooks)).toEqual([
      { name: 'gsd-context-monitor', note: 'conflicts with the autopilot handoff' },
      { name: 'gsd-secret-read-guard', note: 'useful for Security' },
    ])
  })

  test('a hook registered under several events or sources is listed once', () => {
    const hooks = facts({
      hookScripts: [
        { script: 'gsd-context-monitor.js', event: 'PostToolUse', source: 'user' },
        { script: 'gsd-context-monitor.js', event: 'Stop', source: 'project' },
      ],
    })

    expect(gsdHookFacts(hooks)).toEqual([
      { name: 'gsd-context-monitor', note: 'conflicts with the autopilot handoff' },
    ])
  })

  test('the .sh and .cjs extensions match the same way as .js', () => {
    const hooks = facts({
      hookScripts: [
        { script: 'gsd-workflow-guard.cjs', event: 'PreToolUse', source: 'user' },
        { script: 'gsd-validate-commit.sh', event: 'PreToolUse', source: 'local' },
      ],
    })

    expect(gsdHookFacts(hooks).map(hook => hook.name)).toEqual(['gsd-validate-commit', 'gsd-workflow-guard'])
  })

  test('a name that only contains a hook name, or has another extension, is not matched', () => {
    const hooks = facts({
      hookScripts: [
        { script: 'mygsd-context-monitor.js', event: 'PostToolUse', source: 'user' },
        { script: 'gsd-secret-read-guard.js.bak', event: 'PreToolUse', source: 'user' },
        { script: 'gsd-workflow-guard.ts', event: 'PreToolUse', source: 'user' },
      ],
    })

    expect(gsdHookFacts(hooks)).toEqual([])
  })

  test('a bare name, an uppercase name and a near-miss suffix are not matched', () => {
    const hooks = facts({
      hookScripts: [
        { script: 'gsd-context-monitor', event: 'PostToolUse', source: 'user' },
        { script: 'GSD-context-monitor.js', event: 'PostToolUse', source: 'user' },
        { script: 'gsd-context-monitor2.js', event: 'PostToolUse', source: 'user' },
      ],
    })

    expect(gsdHookFacts(hooks)).toEqual([])
  })

  test('changing a returned note does not change GSD_HOOK_NOTES', () => {
    const hooks = facts({ hookScripts: [{ script: 'gsd-context-monitor.js', event: 'PostToolUse', source: 'user' }] })
    const returned = gsdHookFacts(hooks)

    expect(returned).toHaveLength(1)
    Object.assign(returned[0] ?? {}, { note: 'changed' })

    expect(GSD_HOOK_NOTES[0]?.note).toBe('conflicts with the autopilot handoff')
  })

  test('GSD_HOOK_NOTES and every row in it are frozen', () => {
    expect(Object.isFrozen(GSD_HOOK_NOTES)).toBe(true)
    expect(GSD_HOOK_NOTES.every(row => Object.isFrozen(row))).toBe(true)
  })

  test('GSD_HOOK_NOTES lists the four role hooks in order, with their notes', () => {
    expect(GSD_HOOK_NOTES).toEqual([
      { name: 'gsd-context-monitor', note: 'conflicts with the autopilot handoff' },
      { name: 'gsd-secret-read-guard', note: 'useful for Security' },
      {
        name: 'gsd-validate-commit',
        note: 'rejects non-Conventional commit messages when enabled (this repo uses (type): Subject)',
      },
      { name: 'gsd-workflow-guard', note: 'advisory nag when enabled' },
    ])
  })
})

/** The kickoff text of one gate, by its id; throws naming the id when no gate has it. */
function kickoffOf(id: string): string {
  const gate = GSD_GATES.find(row => row.id === id)
  if (gate === undefined) throw new Error(`no gate with id ${id}`)

  return gate.kickoff
}

describe('GSD_GATES', () => {
  test('the seven gate rows match D-14 verbatim, in order', () => {
    expect(GSD_GATES).toEqual([
      {
        id: 'auq-menus',
        where: 'AskUserQuestion menus inside GSD workflows',
        kind: 'auq',
        decisionType: 'Arch',
        needsHuman: false,
        handling: 'autopilot-denies',
        kickoff:
          'Autopilot answers GSD menus with "decide yourself": ' +
          'take the recommended option and log it in decisions.md.',
      },
      {
        id: 'text-mode',
        where: '.planning/config.json workflow.text_mode',
        kind: 'plaintext',
        decisionType: 'Arch',
        needsHuman: false,
        handling: 'config-required',
        kickoff: 'Needs workflow.text_mode false (an autonomy setting); with it true the role is attended.',
      },
      {
        id: 'verify-work-uat',
        where: '/gsd-verify-work',
        kind: 'uat',
        decisionType: 'QA',
        needsHuman: true,
        handling: 'escalate',
        kickoff:
          'Do not run /gsd-verify-work. Send human UAT as a QA decision to TL, ' +
          'which queues it for the human.',
      },
      {
        id: 'secure-phase-accept-risk',
        where: '/gsd-secure-phase',
        kind: 'auq',
        decisionType: 'Security',
        needsHuman: true,
        handling: 'preapprove',
        kickoff:
          'Answer "Verify all open threats"; never accept a risk: ' +
          'accepting risk is always queued for the human.',
      },
      {
        id: 'needs-human-blocker',
        where: 'STATE.md "Needs Human" blocker',
        kind: 'plaintext',
        decisionType: 'Arch',
        needsHuman: false,
        handling: 'escalate',
        kickoff:
          'Route the blocker by its content, by default as an Arch decision to TL; ' +
          'TL decides reversible calls and queues the rest for the human.',
      },
      {
        id: 'ship-merge-pr',
        where: '/gsd-ship, branch finish, merge or PR',
        kind: 'auq',
        decisionType: 'Arch',
        needsHuman: true,
        handling: 'escalate',
        kickoff:
          'Never merge, push or release. Hand the finished branch to TL as an Arch decision; ' +
          'merge, push and release are always queued for the human.',
      },
      {
        id: 'scope-acceptance',
        where: 'scope or acceptance questions in discuss and plan',
        kind: 'chat',
        decisionType: 'Product',
        needsHuman: false,
        handling: 'escalate',
        kickoff: 'Send scope or acceptance questions as a Product decision to PM.',
      },
    ])
  })

  test('the secure-phase-accept-risk kickoff pre-supplies only Verify all open threats', () => {
    const kickoff = kickoffOf('secure-phase-accept-risk')

    expect(kickoff).toContain('Verify all open threats')
    expect(kickoff).toContain('never accept a risk')
  })

  test('the ship-merge-pr kickoff forbids merge, push and release', () => {
    expect(kickoffOf('ship-merge-pr')).toContain('Never merge, push or release')
  })

  test('every gate has a kickoff, and no gate id repeats', () => {
    const ids = GSD_GATES.map(gate => gate.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(GSD_GATES.every(gate => gate.kickoff.trim() !== '')).toBe(true)
  })

  test('the gate table has no problems under the framework gate contract', () => {
    expect(gateProblems([...GSD_GATES])).toEqual([])
  })
})

describe('GSD_AUTONOMY', () => {
  test('the three setting proposals are data only, in order, with their config file, tool writes and reasons', () => {
    expect(GSD_AUTONOMY).toEqual([
      {
        kind: 'command',
        key: 'mode',
        file: '.planning/config.json',
        write: { tool: 'gsd-tools', args: ['config-set', 'mode', 'yolo'] },
        to: 'yolo',
        why: 'interactive mode stops for confirmations; yolo lets an autopilot role run phases unattended',
        isRequired: true,
      },
      {
        kind: 'command',
        key: 'workflow.text_mode',
        file: '.planning/config.json',
        write: { tool: 'gsd-tools', args: ['config-set', 'workflow.text_mode', 'false'] },
        to: 'false',
        why: 'text mode turns menus into plain-text questions autopilot cannot deny, so the role would stall',
        isRequired: true,
      },
      {
        kind: 'command',
        key: 'hooks.context_warnings',
        file: '.planning/config.json',
        write: { tool: 'gsd-tools', args: ['config-set', 'hooks.context_warnings', 'false'] },
        to: 'false',
        why:
          'only when gsd-statusline is the statusline: ' +
          'gsd-context-monitor warnings conflict with the autopilot handoff',
        isRequired: false,
      },
    ])
  })

  test('every write is the logical tool gsd-tools asked to config-set its own key to its own value', () => {
    expect(GSD_AUTONOMY.map(setting => setting.write.tool)).toEqual(['gsd-tools', 'gsd-tools', 'gsd-tools'])
    expect(GSD_AUTONOMY.map(setting => setting.write.args)).toEqual(
      GSD_AUTONOMY.map(setting => ['config-set', setting.key, setting.to]),
    )
  })

  test('no proposal has a read command, since the before value is read from the config file (D-70)', () => {
    expect(GSD_AUTONOMY.map(setting => Object.hasOwn(setting, 'read'))).toEqual([false, false, false])
  })

  test('GSD_CONFIG_FILE is the repo-relative GSD config, and every proposal names it as its file (B4)', () => {
    expect(GSD_CONFIG_FILE).toBe('.planning/config.json')
    expect(GSD_AUTONOMY.map(setting => setting.file)).toEqual([GSD_CONFIG_FILE, GSD_CONFIG_FILE, GSD_CONFIG_FILE])
  })

  test('each row, its write object and its args array are frozen', () => {
    for (const setting of GSD_AUTONOMY) {
      // Object.isFrozen is true for a missing value, so the args must first be a real array.
      expect(Array.isArray(setting.write.args)).toBe(true)
      expect(Object.isFrozen(setting)).toBe(true)
      expect(Object.isFrozen(setting.write)).toBe(true)
      expect(Object.isFrozen(setting.write.args)).toBe(true)
    }
  })

  test('the contract view still prints each proposal as key -> value (required or optional) with its reason', () => {
    const lines = adaptersReportLines([GSD_ADAPTER])

    expect(lines).toContain(
      '    mode -> yolo (required): ' +
        'interactive mode stops for confirmations; yolo lets an autopilot role run phases unattended',
    )
    expect(lines).toContain(
      '    workflow.text_mode -> false (required): ' +
        'text mode turns menus into plain-text questions autopilot cannot deny, so the role would stall',
    )
    expect(lines).toContain(
      '    hooks.context_warnings -> false (optional): ' +
        'only when gsd-statusline is the statusline: ' +
        'gsd-context-monitor warnings conflict with the autopilot handoff',
    )
  })
})

/** The first line of the kickoff for one role, with no spec. */
function firstLineOf(role: string): string {
  return gsdKickoffText({ title: role, roleId: 'be', specPath: null }).split('\n')[0] ?? ''
}

/** The Approved spec line of the kickoff for one spec path, which is the line after the role line. */
function specLineOf(specPath: string): string {
  return gsdKickoffText({ title: 'BE', roleId: 'be', specPath }).split('\n')[1] ?? ''
}

/** Whether any of the lines would read to autopilot as its done marker. */
function hasDoneLine(lines: string[]): boolean {
  return DONE_MARKER_LINE.test(lines.join('\n'))
}

describe('gsdKickoffText', () => {
  test('the first line names the role and says the repo runs on GSD', () => {
    expect(firstLineOf('BE')).toBe('You are the BE role. This repo uses GSD: drive the work with its own commands.')
  })

  test('it names the start, spec and verify commands', () => {
    const text = gsdKickoffText({ title: 'BE', roleId: 'be', specPath: null })

    expect(text).toContain('Start: /gsd-autonomous --only N')
    expect(text).toContain('Specs and plans live under .planning/phases/<NN-slug>/.')
    expect(text).toContain('Verify with /gsd-validate-phase N and /gsd-code-review N.')
  })

  test('its last line is the done answer, with no trailing newline', () => {
    const lines = gsdKickoffText({ title: 'BE', roleId: 'be', specPath: null }).split('\n')

    expect(lines[lines.length - 1]).toBe(
      'When the phase VERIFICATION.md has status: passed, answer with a line that starts with AUTOPILOT_DONE.',
    )
  })

  test('the gate lines follow GSD_GATES order, formatted as where colon kickoff', () => {
    const lines = gsdKickoffText({ title: 'BE', roleId: 'be', specPath: null }).split('\n')
    const gateLines = lines.filter(line => line.startsWith('- '))

    expect(lines).toContain('Human gates:')
    expect(gateLines).toEqual(GSD_GATES.map(gate => `- ${gate.where}: ${gate.kickoff}`))
    expect(gateLines[0]).toBe(
      '- AskUserQuestion menus inside GSD workflows: ' +
        'Autopilot answers GSD menus with "decide yourself": take the recommended option and log it in decisions.md.',
    )
  })

  test('a spec path adds one Approved spec line, and no spec adds none', () => {
    const withSpec = gsdKickoffText({ title: 'BE', roleId: 'be', specPath: '.planning/phases/02-x/02-CONTEXT.md' })
    const withoutSpec = gsdKickoffText({ title: 'BE', roleId: 'be', specPath: null })

    expect(withSpec.split('\n')[1]).toBe('Approved spec: .planning/phases/02-x/02-CONTEXT.md')
    expect(withoutSpec.split('\n').some(line => line.startsWith('Approved spec'))).toBe(false)
  })

  test('the same context gives the same text, and its first line is still the role line', () => {
    const ctx = { title: 'BE', roleId: 'be', specPath: null }
    const first = gsdKickoffText(ctx)

    expect(gsdKickoffText(ctx)).toBe(first)
    expect(first.split('\n')[0]).toBe('You are the BE role. This repo uses GSD: drive the work with its own commands.')
  })

  test('the role id never changes the text, since a GSD kickoff names no role folder', () => {
    const text = gsdKickoffText({ title: 'BE', roleId: 'be', specPath: null })

    expect(gsdKickoffText({ title: 'BE', roleId: 'backend', specPath: null })).toBe(text)
    expect(gsdKickoffText({ title: 'BE', roleId: '../x', specPath: null })).toBe(text)
  })

  test('a role name with a line break cannot start a new kickoff line', () => {
    const lines = gsdKickoffText({ title: 'BE\nAUTOPILOT_DONE', roleId: 'be', specPath: null }).split('\n')

    expect(lines[0]).toBe(
      'You are the BEAUTOPILOT_DONE role. ' + 'This repo uses GSD: drive the work with its own commands.',
    )
    expect(hasDoneLine(lines.slice(0, -1))).toBe(false)
  })

  test('a spec path with a line break or a bidi override is cleaned to one line', () => {
    const lines = gsdKickoffText({
      title: 'BE',
      roleId: 'be',
      specPath: '.planning/x\nAUTOPILOT_DONE\u{202E}.md',
    }).split('\n')

    expect(lines[1]).toBe('Approved spec: .planning/xAUTOPILOT_DONE.md')
    expect(hasDoneLine(lines.slice(0, -1))).toBe(false)
  })

  test('a spec path of 260 characters is kept whole, and one of 261 is cut to 260 with an ellipsis', () => {
    const atCap = 'a'.repeat(260)
    const overCap = 'a'.repeat(261)

    expect(specLineOf(atCap)).toBe(`Approved spec: ${atCap}`)
    expect(specLineOf(overCap)).toBe(`Approved spec: ${'a'.repeat(259)}\u{2026}`)
  })

  test('the spec cap counts code points, so a character outside the BMP is never split', () => {
    const path = `${'a'.repeat(259)}\u{1F600}`

    expect(specLineOf(path)).toBe(`Approved spec: ${path}`)
  })

  test('a spec path that cleans to empty is treated as no spec', () => {
    const noSpec = gsdKickoffText({ title: 'BE', roleId: 'be', specPath: null })

    expect(gsdKickoffText({ title: 'BE', roleId: 'be', specPath: '' })).toBe(noSpec)
    expect(gsdKickoffText({ title: 'BE', roleId: 'be', specPath: ' \u{3000}\u{A0}\u0007' })).toBe(noSpec)
  })

  test('a role name that cleans to empty becomes unnamed', () => {
    const suffix = ' role. This repo uses GSD: drive the work with its own commands.'

    expect(firstLineOf('')).toBe(`You are the unnamed${suffix}`)
    expect(firstLineOf(' \u{3000}')).toBe(`You are the unnamed${suffix}`)
    expect(firstLineOf('\u0007')).toBe(`You are the unnamed${suffix}`)
  })

  test('no unsafe character in the role or the spec path can add a line or a done line', () => {
    const unsafe = ['\u0085', '\u2028', '\u2029', '\v', '\f', '\r', '\u200B', '\u{E0041}']
    const roleBaseline = gsdKickoffText({ title: 'BE', roleId: 'be', specPath: null }).split('\n')
    const specBaseline = gsdKickoffText({ title: 'BE', roleId: 'be', specPath: 'x' }).split('\n')

    for (const char of unsafe) {
      const roleLines = gsdKickoffText({ title: `BE${char}AUTOPILOT_DONE`, roleId: 'be', specPath: null }).split('\n')
      const specLines = gsdKickoffText({ title: 'BE', roleId: 'be', specPath: `x${char}AUTOPILOT_DONE` }).split('\n')

      expect(roleLines.length).toBe(roleBaseline.length)
      expect(specLines.length).toBe(specBaseline.length)
      expect(hasDoneLine(roleLines.slice(0, -1))).toBe(false)
      expect(hasDoneLine(specLines.slice(0, -1))).toBe(false)
      expect(roleLines[roleLines.length - 1]).toContain('AUTOPILOT_DONE')
      expect(specLines[specLines.length - 1]).toContain('AUTOPILOT_DONE')
    }
  })

  test('a role of exactly 40 astral characters is kept whole', () => {
    const role = '\u{1F600}'.repeat(40)

    expect(firstLineOf(role).startsWith(`You are the ${role} role.`)).toBe(true)
  })

  test('a spec path of 261 emoji is cut to 259 emoji and an ellipsis, with no lone surrogate', () => {
    const shown = specLineOf('\u{1F600}'.repeat(261)).slice('Approved spec: '.length)
    const points = Array.from(shown)

    expect(points.length).toBe(260)
    expect(points.slice(0, 259).every(point => point === '\u{1F600}')).toBe(true)
    expect(points[259]).toBe('\u{2026}')
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(shown)).toBe(false)
  })

  test('a role name of 40 characters is kept whole, and one of 41 is cut to 40 with an ellipsis', () => {
    const suffix = ' role. This repo uses GSD: drive the work with its own commands.'
    const atCap = 'R'.repeat(40)
    const overCap = 'R'.repeat(41)

    expect(firstLineOf(atCap)).toBe(`You are the ${atCap}${suffix}`)
    expect(firstLineOf(overCap)).toBe(`You are the ${'R'.repeat(39)}\u{2026}${suffix}`)
  })
})

describe('GSD_ADAPTER', () => {
  test('it has the GSD identity, the detect rule, and the start, locate, verify and done fields', () => {
    expect(GSD_ADAPTER.id).toBe('gsd')
    expect(GSD_ADAPTER.name).toBe('GSD')
    expect(GSD_ADAPTER.detectRule).toBe(
      'in use: .planning/ at the repo root (dir or symlink); ' +
        'installed: gsd-core identity proven at ~/.claude/gsd-core ' +
        '(or $CLAUDE_CONFIG_DIR/gsd-core when it is set and safe) or <repo>/.claude/gsd-core',
    )
    expect(GSD_ADAPTER.startWork).toEqual([
      '/gsd-autonomous --only N',
      '/gsd-discuss-phase N --auto, /gsd-plan-phase N --auto, /gsd-execute-phase N',
      '/gsd-new-project (no .planning/ yet)',
    ])
    expect(GSD_ADAPTER.locations).toEqual({
      spec: ['.planning/REQUIREMENTS.md', '.planning/ROADMAP.md', '.planning/phases/<NN-slug>/*-CONTEXT.md'],
      plan: ['.planning/phases/<NN-slug>/*-PLAN.md'],
    })
    expect(GSD_ADAPTER.verify).toEqual([
      '/gsd-validate-phase N',
      '/gsd-code-review N',
      'the verifier inside /gsd-execute-phase',
    ])
    expect(GSD_ADAPTER.doneSignal).toEqual({
      artifact: '.planning/phases/<NN-slug>/*-VERIFICATION.md',
      check: 'frontmatter status: passed',
    })
  })

  test('it wires the shared gate table, autonomy proposals and functions by reference, with no autonomy note', () => {
    expect(GSD_ADAPTER.humanGates).toBe(GSD_GATES)
    expect(GSD_ADAPTER.autonomy).toBe(GSD_AUTONOMY)
    expect(GSD_ADAPTER.autonomyNote).toBeNull()
    expect(GSD_ADAPTER.detect).toBe(detectGsd)
    expect(GSD_ADAPTER.kickoffText).toBe(gsdKickoffText)
    expect(GSD_ADAPTER.roleFacts).toBe(gsdHookFacts)
  })

  test('it declares every required adapter field under the framework contract', () => {
    expect(missingFields(GSD_ADAPTER)).toEqual([])
  })
})
