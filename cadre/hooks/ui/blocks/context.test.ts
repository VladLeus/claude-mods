import { describe, expect, test } from 'claude-code/testing'

import type { Detection, InstructionPart, InstructionScan, RoleChange } from '../../../types'
import { REDACTED } from '../../core/redact'
import { proposeRoles } from '../../roles/propose'
import { rolesFromProposal } from '../../suggest/propose'
import {
  DEFAULT_LOCATIONS,
  EMPTY_FACTS,
  emptySetupScan,
  FULL_SCAN,
  GUIDANCE_KEY,
  memory,
  RECOMMENDED,
  repoScan,
  SECURITY_KEY,
  SECURITY_TOPIC,
  SOURCE_SCAN,
  templateRole,
  TOPICS,
} from '../../testkit'
import {
  detectionContext,
  envContext,
  improverInstallContext,
  instructionPartsContext,
  instructionsContext,
  launchContext,
  launchDirContext,
  memoryContext,
  memoryGroupContext,
  proposalLines,
  reviewContext,
  rolesContext,
  scanContext,
  securityContext,
  topicContext,
} from './context'
import { instructionLines } from './instructions'
import { scanSummaryLines } from './scan'

/** The roles DESCRIBED_REPLY stands for. */
const DESCRIBED_ROLES = rolesFromProposal([
  { id: 'be', title: 'BE', purpose: 'API', basedOn: 'be' },
  { id: 'docs', title: 'Docs', purpose: 'docs', basedOn: null },
])

describe('proposalLines', () => {
  test('the proposal lists each role with its title, id and purpose, then each scan change with its reason', () => {
    const proposal = proposeRoles(SOURCE_SCAN)
    expect(proposalLines(proposal.roles, proposal.changes)).toEqual([
      'Proposed roles:',
      `  ${'PM (pm)'.padEnd(24)}Owns product decisions: scope, requirements and acceptance.`,
      `  ${'Team Lead (tl)'.padEnd(24)}Owns architecture and QA decisions; reviews and merges the work.`,
      `  ${'BE (be)'.padEnd(24)}Implements the backend and core code.`,
      `  ${'QA (qa)'.padEnd(24)}Owns tests and end-to-end checks.`,
      `  ${'Security (security)'.padEnd(24)}Owns security decisions and reviews.`,
      'Changes from the scan:',
      '  kept be: source code found (TypeScript), no UI framework (package.json)',
      '  dropped fe: no frontend framework found (react, vue, next, svelte, angular)',
    ])
  })

  test('evidence paths are joined with commas, and no change at all reads none', () => {
    const roles = proposeRoles(FULL_SCAN).roles
    const change: RoleChange = { roleId: 'be', change: 'kept', reason: 'r', evidence: ['a.ts', 'b/c.go'] }
    expect(proposalLines(roles, [change]).slice(-1)).toEqual(['  kept be: r (a.ts, b/c.go)'])
    expect(proposalLines(roles, []).slice(-2)).toEqual(['Changes from the scan:', '  none'])
  })

  test('a title and id of 24 characters or more still leave one space before the purpose', () => {
    const [first] = DESCRIBED_ROLES
    if (first === undefined) throw new Error('no described role')
    const long = { ...first, id: 'backend-api', title: 'Backend API team' }
    expect(proposalLines([long], [])[1]).toBe('  Backend API team (backend-api) API')
  })
})

/** A bidi override, built at runtime (T-02.1-71). */
const BIDI = String.fromCodePoint(0x202e)

/** The part of SECURITY_TOPIC, from the global CLAUDE.md. */
const PART: InstructionPart = {
  id: 'P1',
  file: '~/.claude/CLAUDE.md',
  heading: 'Security',
  source: 'global',
  text: '# Security\nNever commit secrets.\n',
  hash: 'a'.repeat(64),
}

describe('question contexts (D-203, D-236)', () => {
  test('scanContext is the scan block: the summary lines, then each scan warning', () => {
    const repo = repoScan({ warnings: ['could not list src'] })
    const setup = emptySetupScan()
    const gathered = { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo, setup }
    expect(scanContext(DEFAULT_LOCATIONS, gathered)).toEqual({
      title: 'Scan',
      lines: [...scanSummaryLines(repo, setup, '/repo'), 'warning: could not list src'],
      kind: 'scan',
    })
  })

  test('rolesContext is the proposal: each role with its purpose, then the scan changes', () => {
    const proposal = proposeRoles(SOURCE_SCAN)
    expect(rolesContext(proposal.roles, proposal.changes)).toEqual({
      title: 'Roles',
      lines: proposalLines(proposal.roles, proposal.changes),
      kind: 'roles',
    })
  })

  test('detectionContext lists each framework found with its status, version and evidence', () => {
    const detections: readonly Detection[] = [
      { id: 'gsd', name: 'GSD', status: 'in-use', version: '1.2.3', evidence: ['.planning/', 'gsd-core'] },
      { id: 'superpowers', name: 'superpowers', status: 'not-found', version: null, evidence: [] },
    ]
    expect(detectionContext(detections)).toEqual({
      title: 'Frameworks',
      lines: ['GSD: in use 1.2.3 (.planning/; gsd-core)', 'superpowers: not found'],
      kind: 'detection',
    })
  })

  test('securityContext names each missing plugin with what it does', () => {
    expect(securityContext([SECURITY_KEY, GUIDANCE_KEY, 'other@market'])).toEqual({
      title: 'Security plugins',
      lines: [
        `${SECURITY_KEY}: claude-security gives the Security role a review skill (/claude-security), needs Python ` +
          '3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo.',
        `${GUIDANCE_KEY}: security-guidance adds hooks that warn about risky edits.`,
        'other@market',
      ],
      kind: 'security',
    })
  })

  test('instructionsContext lists the files and memories found by name, MEMORY.md left out', () => {
    const setup = { hasGlobalClaudeMd: true, claudeMd: ['<repo>/CLAUDE.md'], memoryFiles: ['MEMORY.md', 'squad.md'] }
    expect(instructionsContext(setup, { rules: ['security.md'], hasAgentsMd: true }, '/repo')).toEqual({
      title: 'Instruction files',
      lines: [
        'Files found by name (nothing is read before a yes):',
        '  ~/.claude/CLAUDE.md',
        '  repo/CLAUDE.md',
        '  .claude/rules/security.md',
        '  AGENTS.md',
        'Memories:',
        '  squad.md',
      ],
      kind: 'instructions',
    })
    const none = { hasGlobalClaudeMd: false, claudeMd: [], memoryFiles: [] }
    expect(instructionsContext(none, { rules: null, hasAgentsMd: false }, '/repo').lines).toEqual([
      'Files found by name (nothing is read before a yes):',
      '  none',
      'Memories:',
      '  none',
    ])
  })

  test('instructionPartsContext is the instructions block of the hand-out', () => {
    const scan: InstructionScan = { parts: [PART], files: [PART.file], memories: [], warnings: [] }
    expect(instructionPartsContext(scan, TOPICS, RECOMMENDED)).toEqual({
      title: 'Instruction parts',
      lines: instructionLines(scan, TOPICS, RECOMMENDED),
      kind: 'instructions',
    })
  })

  test('topicContext holds that topic only: its summary, its sources and the recommended roles', () => {
    expect(topicContext(SECURITY_TOPIC, [PART], ['security'], 1, 2)).toEqual({
      title: 'Topic 1 of 2',
      lines: [
        'Security rules: How secrets stay out of the repo.',
        '  from: ~/.claude/CLAUDE.md > Security',
        '  recommended: security',
      ],
      kind: 'topic',
    })
  })

  test('memoryContext holds that memory only: its file, summary and recommended roles, never its folder', () => {
    const squad = memory('M1', 'squad.md', `Unsigned${BIDI} commits.`)
    const context = memoryContext(squad, [], 2, 3)
    expect(context).toEqual({
      title: 'Memory 2 of 3',
      lines: ['squad.md: Unsigned commits.', '  recommended: none'],
      kind: 'memory',
    })
    expect(context.lines.join('\n')).not.toContain(squad.folder)
  })

  test('memoryGroupContext lists the files of its group, the global CLAUDE.md by what it holds', () => {
    expect(memoryGroupContext('global-claude-md', [])).toEqual({
      title: 'Global CLAUDE.md',
      lines: ['~/.claude/CLAUDE.md and the files it imports'],
      kind: 'memory-group',
    })
    expect(memoryGroupContext('auto-memory', ['a.md', 'b.md'])).toEqual({
      title: 'Auto-memories',
      lines: ['a.md', 'b.md'],
      kind: 'memory-group',
    })
    const many = Array.from({ length: 14 }, (_, at) => `<repo>/f${at}/CLAUDE.md`)
    const project = memoryGroupContext('project-claude-md', many)
    expect([project.title, project.lines.length, project.lines.at(-1)]).toEqual(['Project CLAUDE.md', 13, '+2 more'])
  })

  test('envContext is the env block: its heading, then each name', () => {
    expect(envContext(['API_KEY', 'JIRA_URL'])).toEqual({
      title: 'Env variables',
      lines: ['Env variable names in your settings (values are never read):', '  API_KEY', '  JIRA_URL'],
      kind: 'env',
    })
  })

  test('improverInstallContext names the built CLAUDE.md of each role given one', () => {
    expect(improverInstallContext(['be', 'qa'])).toEqual({
      title: 'Improver install',
      lines: ['Built CLAUDE.md files it would tidy:', '  be: .cadre/be/CLAUDE.md', '  qa: .cadre/qa/CLAUDE.md'],
      kind: 'improver-install',
    })
  })

  test('launchContext says what the git root and the run folder mean, then lists the launchers', () => {
    expect(launchContext([templateRole('pm'), templateRole('be')])).toEqual({
      title: 'Launch',
      lines: [
        'Git root: the top of this repo, the same for every launcher.',
        'Run folder: wherever you run a launcher from.',
        'Launchers: .cadre/bin/pm, .cadre/bin/be',
      ],
      kind: 'launch',
    })
  })

  test('launchDirContext lists the folders with code, 12 then how many more; with none it says so', () => {
    const dirs = Array.from({ length: 13 }, (_, at) => `d${String(at).padStart(2, '0')}`)
    const context = launchDirContext(dirs)
    expect([context.title, context.kind, context.lines[0], context.lines[1]]).toEqual([
      'Launch folder',
      'launch-dir',
      'Folders with code in this repo:',
      '  d00/',
    ])
    expect([context.lines.length, context.lines.at(-1)]).toEqual([14, '  +1 more'])
    expect(launchDirContext([]).lines).toEqual(['No folder with code was found in this repo.'])
  })

  test('reviewContext is the review block, each line cleaned as a report cell (T-02.1-71)', () => {
    expect(reviewContext(['Plan:', `  create${BIDI} .cadre/be/role.json`])).toEqual({
      title: 'Review',
      lines: ['Plan:', '  create .cadre/be/role.json'],
      kind: 'review',
    })
  })
})

describe('context redaction (WD-S5, #163)', () => {
  test('secret-like spans of summaries, role titles and purposes are hidden; a title beside them stays whole', () => {
    const secret = ['token', 'ab12cd34ef56'].join('=')
    const topic = { ...SECURITY_TOPIC, title: 'API key', summary: `Rotate ${secret} monthly` }
    const plain = { ...topic, summary: '90-day rotation of the deploy keys' }
    const squad = memory('M1', 'squad.md', `Uses ${secret}`)
    expect([
      topicContext(topic, [PART], [], 1, 1).lines[0],
      topicContext(plain, [PART], [], 1, 1).lines[0],
      memoryContext(squad, [], 1, 1).lines[0],
    ]).toEqual([
      `API key: Rotate token=${REDACTED} monthly`,
      'API key: 90-day rotation of the deploy keys',
      `squad.md: Uses token=${REDACTED}`,
    ])
    const role = templateRole('be', { title: `BE ${secret}`, purpose: `Owns ${secret} rotation.` })
    const [, row] = rolesContext([role], []).lines
    expect(row).toBe(`  BE token=${REDACTED} (be)  Owns token=${REDACTED} rotation.`)
  })

  test('a secret-like span of a topic title is hidden in its context (PR-S3)', () => {
    const secret = ['token', 'ab12cd34ef56'].join('=')
    const topic = { ...SECURITY_TOPIC, title: `Deploy ${secret}`, summary: 'Deploy notes' }
    expect(topicContext(topic, [PART], [], 1, 1).lines[0]).toBe(`Deploy token=${REDACTED}: Deploy notes`)
  })
})

describe('context lines kept whole (#163)', () => {
  test('each context line is cleaned and kept whole, never cut at 240 code points', () => {
    const wide = 'w'.repeat(300)
    const repo = repoScan({ warnings: [wide] })
    const gathered = { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo, setup: emptySetupScan() }
    const detection: Detection = { id: 'gsd', name: 'GSD', status: 'in-use', version: null, evidence: [wide] }
    const topic = { ...SECURITY_TOPIC, summary: wide }
    const scan: InstructionScan = { parts: [PART], files: [PART.file], memories: [], warnings: [] }
    const contexts = [
      scanContext(DEFAULT_LOCATIONS, gathered),
      rolesContext([templateRole('be', { purpose: wide })], []),
      detectionContext([detection]),
      securityContext([wide]),
      instructionPartsContext(scan, [topic], RECOMMENDED),
      topicContext(topic, [PART], [], 1, 1),
      memoryContext(memory('M1', 'squad.md', wide), [], 1, 1),
      reviewContext([wide]),
    ]
    expect(contexts.map(context => context.lines.some(line => line.includes(wide)))).toEqual(contexts.map(() => true))
  })
})
