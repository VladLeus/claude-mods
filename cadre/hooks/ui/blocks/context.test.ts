import { describe, expect, test } from 'claude-code/testing'

import type { AskContext, ContextRow, Detection, InstructionPart, InstructionScan, RoleChange } from '../../../types'
import { REDACTED } from '../../core/redact'
import { SCREEN_LIST_WORDS } from '../../locales/t'
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
  instructionRows,
  instructionsContext,
  itemRows,
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
import { paneDrawn } from '../pane'
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
    expect(scanContext(DEFAULT_LOCATIONS, gathered, SCREEN_LIST_WORDS)).toEqual({
      title: 'Scan',
      lines: [...scanSummaryLines(repo, setup, '/repo', SCREEN_LIST_WORDS), 'warning: could not list src'],
      kind: 'scan',
      summary: '0 plugins, 0 MCP servers, 0 CLAUDE.md files',
      rows: [
        {
          title: null,
          rows: [
            { role: 'heading', text: 'Repo scan (read-only):', indent: 0 },
            { role: 'plain', text: '  stack: none; frontend: none; backend: none', indent: 0 },
            { role: 'plain', text: '  tests: none; E2E: none', indent: 0 },
            { role: 'field', label: 'existing .cadre/', text: 'none', indent: 2 },
            { role: 'heading', text: 'User setup (names only):', indent: 0 },
            { role: 'field', label: 'plugins', text: '0', indent: 2 },
            { role: 'plain', text: '  skills: 0; agents: 0; MCP servers: none', indent: 0 },
            { role: 'plain', text: '  global ~/.claude/CLAUDE.md: no; memories: 0; CLAUDE.md files: none', indent: 0 },
            { role: 'field', label: 'warning', text: 'could not list src', indent: 0 },
          ],
        },
      ],
    })
  })

  test('rolesContext is the proposal: each role with its purpose, then the scan changes', () => {
    const proposal = proposeRoles(SOURCE_SCAN)
    expect(rolesContext(proposal.roles, proposal.changes)).toEqual({
      title: 'Roles',
      lines: proposalLines(proposal.roles, proposal.changes),
      kind: 'roles',
      summary: '5 roles: pm, tl, be, qa, security',
      rows: [
        {
          title: null,
          rows: [
            { role: 'heading', text: 'Proposed roles:', indent: 0 },
            {
              role: 'plain',
              text: `${'PM (pm)'.padEnd(24)}Owns product decisions: scope, requirements and acceptance.`,
              indent: 2,
            },
            {
              role: 'plain',
              text: `${'Team Lead (tl)'.padEnd(24)}Owns architecture and QA decisions; reviews and merges the work.`,
              indent: 2,
            },
            { role: 'plain', text: `${'BE (be)'.padEnd(24)}Implements the backend and core code.`, indent: 2 },
            { role: 'plain', text: `${'QA (qa)'.padEnd(24)}Owns tests and end-to-end checks.`, indent: 2 },
            {
              role: 'plain',
              text: `${'Security (security)'.padEnd(24)}Owns security decisions and reviews.`,
              indent: 2,
            },
            { role: 'heading', text: 'Changes from the scan:', indent: 0 },
            {
              role: 'plain',
              text: '  kept be: source code found (TypeScript), no UI framework (package.json)',
              indent: 0,
            },
            {
              role: 'plain',
              text: '  dropped fe: no frontend framework found (react, vue, next, svelte, angular)',
              indent: 0,
            },
          ],
        },
      ],
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
      summary: '1 framework found: gsd',
      rows: [
        {
          title: null,
          rows: [
            { role: 'field', label: 'GSD', text: 'in use 1.2.3 (.planning/; gsd-core)', indent: 0 },
            { role: 'field', label: 'superpowers', text: 'not found', indent: 0 },
          ],
        },
      ],
    })
    expect(detectionContext(detections.slice(1))).toMatchObject({ summary: 'No framework found' })
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
      summary: '3 plugins to install: claude-security, security-guidance, other',
      rows: [
        {
          title: null,
          rows: [
            {
              role: 'field',
              label: SECURITY_KEY,
              text:
                'claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or ' +
                'newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo.',
              indent: 0,
            },
            {
              role: 'field',
              label: GUIDANCE_KEY,
              text: 'security-guidance adds hooks that warn about risky edits.',
              indent: 0,
            },
            { role: 'plain', text: 'other@market', indent: 0 },
          ],
        },
      ],
    })
  })

  test('instructionsContext lists the files and memories found by name, MEMORY.md left out', () => {
    const setup = { hasGlobalClaudeMd: true, claudeMd: ['<repo>/CLAUDE.md'], memoryFiles: ['MEMORY.md', 'squad.md'] }
    const repo = { rules: ['security.md'], hasAgentsMd: true }
    expect(instructionsContext(setup, repo, '/repo', SCREEN_LIST_WORDS)).toEqual({
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
      summary: '4 files, 1 memory',
      rows: [
        {
          title: null,
          rows: [
            { role: 'heading', text: 'Files found by name (nothing is read before a yes):', indent: 0 },
            { role: 'plain', text: '~/.claude/CLAUDE.md', indent: 2 },
            { role: 'plain', text: 'repo/CLAUDE.md', indent: 2 },
            { role: 'plain', text: '.claude/rules/security.md', indent: 2 },
            { role: 'plain', text: 'AGENTS.md', indent: 2 },
            { role: 'heading', text: 'Memories:', indent: 0 },
            { role: 'plain', text: 'squad.md', indent: 2 },
          ],
        },
      ],
    })
    const none = { hasGlobalClaudeMd: false, claudeMd: [], memoryFiles: [] }
    expect(instructionsContext(none, { rules: null, hasAgentsMd: false }, '/repo', SCREEN_LIST_WORDS).lines).toEqual([
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
      summary: '2 topics, 0 memories, 2 recommended',
      rows: [
        {
          title: null,
          rows: [
            { role: 'heading', text: instructionLines(scan, TOPICS, RECOMMENDED)[0], indent: 0 },
            { role: 'item', label: 'Security rules', text: 'security', indent: 2 },
            { role: 'description', text: 'How secrets stay out of the repo.', indent: 4 },
            { role: 'field', label: 'from', text: '~/.claude/CLAUDE.md > Security', indent: 4 },
            { role: 'item', label: 'Git and commits', text: 'tl', indent: 2 },
            { role: 'description', text: 'How commits are made.', indent: 4 },
          ],
        },
      ],
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
      summary: 'Recommended: security',
      rows: [
        {
          title: null,
          rows: [
            { role: 'item', label: 'Security rules', text: 'security', indent: 2 },
            { role: 'description', text: 'How secrets stay out of the repo.', indent: 4 },
            { role: 'field', label: 'from', text: '~/.claude/CLAUDE.md > Security', indent: 4 },
          ],
        },
      ],
    })
  })

  test('memoryContext holds that memory only: its file, summary and recommended roles, never its folder', () => {
    const squad = memory('M1', 'squad.md', `Unsigned${BIDI} commits.`)
    const context = memoryContext(squad, [], 2, 3)
    expect(context).toEqual({
      title: 'Memory 2 of 3',
      lines: ['squad.md: Unsigned commits.', '  recommended: none'],
      kind: 'memory',
      summary: 'Recommended: none',
      rows: [
        {
          title: null,
          rows: [
            { role: 'item', label: 'squad.md', text: 'none', indent: 2 },
            { role: 'description', text: 'Unsigned commits.', indent: 4 },
          ],
        },
      ],
    })
    expect(context.lines.join('\n')).not.toContain(squad.folder)
  })

  test('memoryGroupContext lists the files of its group, the global CLAUDE.md by what it holds', () => {
    expect(memoryGroupContext('global-claude-md', [], SCREEN_LIST_WORDS)).toEqual({
      title: 'Global CLAUDE.md',
      lines: ['~/.claude/CLAUDE.md and the files it imports'],
      kind: 'memory-group',
      summary: '1 file',
      rows: [
        { title: null, rows: [{ role: 'plain', text: '~/.claude/CLAUDE.md and the files it imports', indent: 0 }] },
      ],
    })
    expect(memoryGroupContext('auto-memory', ['a.md', 'b.md'], SCREEN_LIST_WORDS)).toEqual({
      title: 'Auto-memories',
      lines: ['a.md', 'b.md'],
      kind: 'memory-group',
      summary: '2 files',
      rows: [
        {
          title: null,
          rows: [
            { role: 'plain', text: 'a.md', indent: 0 },
            { role: 'plain', text: 'b.md', indent: 0 },
          ],
        },
      ],
    })
    const many = Array.from({ length: 14 }, (_, at) => `<repo>/f${at}/CLAUDE.md`)
    const project = memoryGroupContext('project-claude-md', many, SCREEN_LIST_WORDS)
    expect([project.title, project.lines.length, project.lines.at(-1)]).toEqual(['Project CLAUDE.md', 13, '+2 more'])
    expect(project).toMatchObject({ summary: '14 files' })
  })

  test('envContext is the env block: its heading, then each name', () => {
    expect(envContext(['API_KEY', 'JIRA_URL'])).toEqual({
      title: 'Env variables',
      lines: ['Env variable names in your settings (values are never read):', '  API_KEY', '  JIRA_URL'],
      kind: 'env',
      summary: '2 env names',
      rows: [
        {
          title: null,
          rows: [
            { role: 'heading', text: 'Env variable names in your settings (values are never read):', indent: 0 },
            { role: 'plain', text: 'API_KEY', indent: 2 },
            { role: 'plain', text: 'JIRA_URL', indent: 2 },
          ],
        },
      ],
    })
  })

  test('improverInstallContext names the built CLAUDE.md of each role given one', () => {
    expect(improverInstallContext(['be', 'qa'])).toEqual({
      title: 'Improver install',
      lines: ['Built CLAUDE.md files it would tidy:', '  be: .cadre/be/CLAUDE.md', '  qa: .cadre/qa/CLAUDE.md'],
      kind: 'improver-install',
      summary: '2 roles: be, qa',
      rows: [
        {
          title: null,
          rows: [
            { role: 'heading', text: 'Built CLAUDE.md files it would tidy:', indent: 0 },
            { role: 'field', label: 'be', text: '.cadre/be/CLAUDE.md', indent: 2 },
            { role: 'field', label: 'qa', text: '.cadre/qa/CLAUDE.md', indent: 2 },
          ],
        },
      ],
    })
  })

  test('launchContext says what the git root and the run folder mean, then lists the launchers', () => {
    expect(launchContext([templateRole('pm'), templateRole('be')], SCREEN_LIST_WORDS)).toEqual({
      title: 'Launch',
      lines: [
        'Git root: the top of this repo, the same for every launcher.',
        'Run folder: wherever you run a launcher from.',
        'Launchers: .cadre/bin/pm, .cadre/bin/be',
      ],
      kind: 'launch',
      summary: '2 launchers',
      rows: [
        {
          title: null,
          rows: [
            { role: 'plain', text: 'Git root: the top of this repo, the same for every launcher.', indent: 0 },
            { role: 'plain', text: 'Run folder: wherever you run a launcher from.', indent: 0 },
            { role: 'field', label: 'Launchers', text: '.cadre/bin/pm, .cadre/bin/be', indent: 0 },
          ],
        },
      ],
    })
  })

  test('launchDirContext lists the folders with code, 12 then how many more; with none it says so', () => {
    const dirs = Array.from({ length: 13 }, (_, at) => `d${String(at).padStart(2, '0')}`)
    const context = launchDirContext(dirs, SCREEN_LIST_WORDS)
    expect([context.title, context.kind, context.lines[0], context.lines[1]]).toEqual([
      'Launch folder',
      'launch-dir',
      'Folders with code in this repo:',
      '  d00/',
    ])
    expect([context.lines.length, context.lines.at(-1)]).toEqual([14, '  +1 more'])
    expect(launchDirContext([], SCREEN_LIST_WORDS).lines).toEqual(['No folder with code was found in this repo.'])
    expect(context).toMatchObject({ summary: '13 code folders' })
    expect(launchDirContext([], SCREEN_LIST_WORDS)).toMatchObject({ summary: '0 code folders' })
    const rows = context.rows?.[0]?.rows ?? []
    expect([rows[0], rows[1], rows.at(-1), rows.length]).toEqual([
      { role: 'heading', text: 'Folders with code in this repo:', indent: 0 },
      { role: 'plain', text: 'd00/', indent: 2 },
      { role: 'plain', text: '+1 more', indent: 2 },
      14,
    ])
  })

  test('reviewContext is the review block, each line cleaned as a report cell (T-02.1-71)', () => {
    expect(reviewContext(['Plan:', `  create${BIDI} .cadre/be/role.json`], 25, 3)).toEqual({
      title: 'Review',
      lines: ['Plan:', '  create .cadre/be/role.json'],
      kind: 'review',
      summary: '25 files, 3 roles',
    })
    expect(reviewContext([], 1, 1)).toMatchObject({ summary: '1 file, 1 role' })
    // The Review keeps its lines and their own styling: it has no rows (D-322).
    expect(reviewContext([], 1, 1).rows).toBe(undefined)
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
      scanContext(DEFAULT_LOCATIONS, gathered, SCREEN_LIST_WORDS),
      rolesContext([templateRole('be', { purpose: wide })], []),
      detectionContext([detection]),
      securityContext([wide]),
      instructionPartsContext(scan, [topic], RECOMMENDED),
      topicContext(topic, [PART], [], 1, 1),
      memoryContext(memory('M1', 'squad.md', wide), [], 1, 1),
      reviewContext([wide], 1, 1),
    ]
    expect(contexts.map(context => context.lines.some(line => line.includes(wide)))).toEqual(contexts.map(() => true))
  })
})

/** The texts the pane draws for the rows of `context`, its title left out (paneDrawn, D-313). */
function drawnLines(context: AskContext): string[] {
  const block = { title: context.title, summary: null, rows: context.rows ?? [], lines: [] }

  return paneDrawn(block, null)
    .slice(1)
    .map(row => row.spans.map(span => span.text).join(''))
}

describe('rows from the same data as lines (D-313, D-323)', () => {
  test('every context but the Review and the item contexts draws its lines as rows, a row per line', () => {
    const repo = repoScan({ warnings: ['could not list src'] })
    const gathered = { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo, setup: emptySetupScan() }
    const proposal = proposeRoles(SOURCE_SCAN)
    const detections: readonly Detection[] = [
      { id: 'gsd', name: 'GSD', status: 'in-use', version: '1.2.3', evidence: ['.planning/', 'gsd-core'] },
      { id: 'superpowers', name: 'superpowers', status: 'not-found', version: null, evidence: [] },
    ]
    const setup = { hasGlobalClaudeMd: true, claudeMd: ['<repo>/CLAUDE.md'], memoryFiles: ['squad.md'] }
    const none = { hasGlobalClaudeMd: false, claudeMd: [], memoryFiles: [] }
    const dirs = Array.from({ length: 13 }, (_, at) => `d${String(at).padStart(2, '0')}`)
    const contexts = [
      scanContext(DEFAULT_LOCATIONS, gathered, SCREEN_LIST_WORDS),
      rolesContext(proposal.roles, proposal.changes),
      rolesContext(proposal.roles, []),
      detectionContext(detections),
      securityContext([SECURITY_KEY, GUIDANCE_KEY, 'other@market']),
      instructionsContext(setup, { rules: ['a.md'], hasAgentsMd: true }, '/repo', SCREEN_LIST_WORDS),
      instructionsContext(none, { rules: null, hasAgentsMd: false }, '/repo', SCREEN_LIST_WORDS),
      memoryGroupContext('global-claude-md', [], SCREEN_LIST_WORDS),
      memoryGroupContext('auto-memory', ['a.md', 'b.md'], SCREEN_LIST_WORDS),
      envContext(['API_KEY', 'JIRA_URL']),
      improverInstallContext(['be', 'qa']),
      launchContext([templateRole('pm'), templateRole('be')], SCREEN_LIST_WORDS),
      launchDirContext(dirs, SCREEN_LIST_WORDS),
      launchDirContext([], SCREEN_LIST_WORDS),
    ]
    for (const context of contexts) expect(drawnLines(context)).toEqual(context.lines)
  })
})

describe('itemRows (D-311)', () => {
  test('an item is `name → roles` at indent 2, then its description at indent 4, then its fields', () => {
    const from = { role: 'field', label: 'from', text: 'CLAUDE.md > Git', indent: 4 } satisfies ContextRow
    expect(itemRows('Git and commits', ['tl', 'be'], 'How commits are made.', [from])).toEqual([
      { role: 'item', label: 'Git and commits', text: 'tl, be', indent: 2 },
      { role: 'description', text: 'How commits are made.', indent: 4 },
      from,
    ])
  })

  test('no recommended role reads none, and no description or only blanks gives the placeholder row', () => {
    const placeholder = { role: 'placeholder', text: 'no description', indent: 4 }
    expect([itemRows('a', [], null), itemRows('b', [], '  ')]).toEqual([
      [{ role: 'item', label: 'a', text: 'none', indent: 2 }, placeholder],
      [{ role: 'item', label: 'b', text: 'none', indent: 2 }, placeholder],
    ])
  })

  test('the pane draws an item as `name → roles` and its description under it, wrapped at its indent (D-312)', () => {
    const description = 'word '.repeat(12).trim()
    const rows = [{ title: null, rows: itemRows('x', ['be'], description) }]
    const block = { title: 'T', summary: null, rows, lines: [] }
    const drawn = paneDrawn(block, 30)
      .slice(1)
      .map(row => row.spans.map(span => span.text).join(''))
    expect(drawn[0]).toBe('  x → be')
    expect(drawn.slice(1).every(row => row.startsWith('    ') && Array.from(row).length <= 30)).toBe(true)
    expect(drawn.slice(1).join(' ').split(' ').filter(word => word !== '')).toEqual(description.split(' '))
  })
})

describe('instructionRows (D-311, D-313)', () => {
  test('the block as rows: its heading, each topic and memory an item with its summary, warnings and notes', () => {
    const squad = memory('M1', 'squad.md', '')
    const scan: InstructionScan = { parts: [PART], files: [PART.file], memories: [squad], warnings: ['w'] }
    expect(instructionRows(scan, TOPICS.slice(0, 1), new Map())).toEqual([
      { role: 'heading', text: instructionLines(scan, TOPICS, new Map())[0], indent: 0 },
      { role: 'item', label: 'Security rules', text: 'none', indent: 2 },
      { role: 'description', text: 'How secrets stay out of the repo.', indent: 4 },
      { role: 'field', label: 'from', text: '~/.claude/CLAUDE.md > Security', indent: 4 },
      { role: 'heading', text: 'Memories (each linked, never copied, when a role gets it):', indent: 0 },
      { role: 'item', label: 'squad.md', text: 'none', indent: 2 },
      { role: 'placeholder', text: 'no description', indent: 4 },
      { role: 'field', label: 'warning', text: 'w', indent: 0 },
      {
        role: 'plain',
        text: 'The model gave no usable recommendation: no role gets a part unless you pick one.',
        indent: 0,
      },
    ])
  })

  test('a secret-like span of a topic title or summary is hidden in its item rows (PR-S3)', () => {
    const secret = ['token', 'ab12cd34ef56'].join('=')
    const topic = { ...SECURITY_TOPIC, title: `Deploy ${secret}`, summary: `Uses ${secret}` }
    const scan: InstructionScan = { parts: [PART], files: [PART.file], memories: [], warnings: [] }
    const [, item, about] = instructionRows(scan, [topic], RECOMMENDED)
    expect([item?.label, about?.text]).toEqual([`Deploy token=${REDACTED}`, `Uses token=${REDACTED}`])
  })
})

describe('descriptions never cut (D-312, D-330)', () => {
  test('a memory summary of 230 characters is shown whole in its line and in its rows', () => {
    const summary = `${'word '.repeat(45)}tails`
    const context = memoryContext(memory('M1', 'm.md', summary), [], 1, 1)
    expect([Array.from(summary).length, context.lines[0], context.rows?.[0]?.rows[1]?.text]).toEqual([
      230,
      `m.md: ${summary}`,
      summary,
    ])
  })
})
