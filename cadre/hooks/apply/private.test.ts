import { describe, expect, test } from 'claude-code/testing'

import type { InstructionPart, MemoryItem, Plan } from '../../types'
import { stableJson } from '../core/json'
import { INSTRUCTIONS_RECORD_FILE, PRIVATE_INSTRUCTIONS_FOLDER } from '../paths'
import { MANIFEST_PATH } from '../plan/classify'
import { planWithManifest } from '../plan/plan'
import {
  A,
  BIDI_OVERRIDE,
  file,
  input,
  LAUNCHER,
  NO_CHOICES,
  SECURITY_DIR,
  SECURITY_RECORD,
  SECURITY_TEXT_FILE,
  SLUG_DIR,
  stepLine,
  text,
  TL_DIR,
} from '../testkit'
import {
  instructionsRecordPath,
  instructionsRecordText,
  parseInstructionsRecord,
  privateClaudeMdPath,
  privateClaudeMdText,
} from './private'
import type { ApplyStep, PrivateRole } from './private'
import { applySteps } from './steps'

/** One `kind path` line per file op of a plan, in plan order; the hunks are dropped. */
function summary(plan: Plan): string[] {
  const lines: string[] = []
  for (const op of plan.ops) {
    if (op.kind !== 'hunk') lines.push(`${op.kind} ${op.path}`)
  }

  return lines
}

/** A part of the fixture user's global CLAUDE.md as the read gives it; the hash only has to be a hash-like text. */
function globalPart(id: string, heading: string, text: string): InstructionPart {
  const hash = `${id.toLowerCase()}${'0'.repeat(62)}`

  return { id, file: '~/.claude/CLAUDE.md', heading, source: 'global', text, hash }
}

/** The Security section of the global CLAUDE.md. */
const SECURITY_PART = globalPart('P1', 'Security', '# Security\nNever commit secrets.\n')

/** The Git section, read with Windows line ends and a blank line at its end. */
const GIT_PART = globalPart('P2', 'Git', '## Git\r\nUse signed commits.\r\n\r\n')

/** The auto-memory squad.md of the fixture repo, as the hand-out offers it (G-02-1f Memories). */
const SQUAD: MemoryItem = {
  id: 'M1',
  file: 'squad.md',
  folder: '/home/u/.claude/projects/-repo/memory',
  summary: 'Unsigned commits on per-phase branches.',
  hash: 'c'.repeat(64),
}

/** The first line of Security's private text file in the repo `repo` (D-140; 02-GAPS-B3 C4). */
const SECURITY_HEADER =
  '<!-- cadre: your global instructions for role security in repo, built from your global CLAUDE.md, its imports ' +
  'and the CLAUDE.md files above the repo. Private to you, never committed; rebuilt by /cadre init and /cadre regen. ' +
  '-->'

/** Security was given the Security section and no memory. */
const SECURITY_PRIVATE: PrivateRole = {
  id: 'security',
  folder: SECURITY_DIR,
  repo: 'repo',
  parts: [SECURITY_PART],
  memories: [],
}

/** The Team Lead was given squad.md and no global part. */
const TL_PRIVATE: PrivateRole = { id: 'tl', folder: TL_DIR, repo: 'repo', parts: [], memories: [SQUAD] }

/** The PM was given nothing private. */
const PM_PRIVATE: PrivateRole = { id: 'pm', folder: `${SLUG_DIR}/pm`, repo: 'repo', parts: [], memories: [] }

/** A SHA-256 as a hand-out record holds it: 64 lowercase hex characters. */
const RECORD_HASH = 'd'.repeat(64)

/**
 * The text of a hand-out record that gives the Security section and squad.md and names the Git section of the same
 * file as not given; `over` changes the fields it names, and a field set to undefined is left out.
 */
function recordWith(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema: 1,
    parts: [{ file: '~/.claude/CLAUDE.md', heading: 'Security', hash: RECORD_HASH }],
    partsNotGiven: [{ file: '~/.claude/CLAUDE.md', heading: 'Git', hash: RECORD_HASH }],
    memories: [{ file: 'squad.md', folder: SQUAD.folder, summary: SQUAD.summary, hash: RECORD_HASH }],
    ...over,
  })
}

describe('private role files (G-02-1f)', () => {
  test('the private text file is its header line, then each global part under its marker, in the order given', () => {
    expect(privateClaudeMdText('security', 'repo', [SECURITY_PART, GIT_PART])).toBe(
      [
        SECURITY_HEADER,
        '',
        '<!-- from ~/.claude/CLAUDE.md > Security -->',
        '# Security',
        'Never commit secrets.',
        '',
        '<!-- from ~/.claude/CLAUDE.md > Git -->',
        '## Git',
        'Use signed commits.',
        '',
      ].join('\n'),
    )
    expect(privateClaudeMdText('security', `re${BIDI_OVERRIDE}\npo`, [SECURITY_PART]).split('\n')[0]).toBe(
      SECURITY_HEADER,
    )
  })

  test('the header names the global CLAUDE.md, its imports and the CLAUDE.md files above the repo (C4)', () => {
    expect(privateClaudeMdText('be', 'repo', [])).toBe(
      '<!-- cadre: your global instructions for role be in repo, built from your global CLAUDE.md, its imports and ' +
        'the CLAUDE.md files above the repo. Private to you, never committed; rebuilt by /cadre init and /cadre ' +
        'regen. -->\n',
    )
  })

  test('the hand-out record is stable JSON: schema 1, each global part by file, heading and hash, each memory', () => {
    const record = instructionsRecordText([SECURITY_PART, GIT_PART], [SQUAD])

    expect(record).toBe(
      stableJson({
        schema: 1,
        parts: [
          { file: '~/.claude/CLAUDE.md', heading: 'Security', hash: SECURITY_PART.hash },
          { file: '~/.claude/CLAUDE.md', heading: 'Git', hash: GIT_PART.hash },
        ],
        memories: [{ file: 'squad.md', folder: SQUAD.folder, summary: SQUAD.summary, hash: SQUAD.hash }],
      }),
    )
    expect(record).not.toContain('Never commit secrets')
    expect(record).not.toContain('"id"')
    expect(instructionsRecordText([], [])).toBe('{\n  "memories": [],\n  "parts": [],\n  "schema": 1\n}\n')
  })

  test('the text file lies in its own instructions/ subfolder, the record beside the memories (D-140)', () => {
    expect(privateClaudeMdPath(SECURITY_DIR)).toBe(SECURITY_TEXT_FILE)
    expect(instructionsRecordPath(SECURITY_DIR)).toBe(SECURITY_RECORD)
    expect([PRIVATE_INSTRUCTIONS_FOLDER, INSTRUCTIONS_RECORD_FILE]).toEqual(['instructions', 'instructions.json'])
  })

  test('the private files come after the repo files and before the manifest, text file before record', async () => {
    const desired = [file(LAUNCHER, '#!/bin/sh\n', 'exec'), file(A, 'a\n')]
    const { plan, manifest } = await planWithManifest(input({ desired }))
    const privates = [SECURITY_PRIVATE, TL_PRIVATE, PM_PRIVATE]
    const steps = await applySteps({ plan, desired, manifest, gitignore: null, choices: NO_CHOICES, privates })

    expect(steps).toEqual([
      { kind: 'write', path: A, text: 'a\n' },
      { kind: 'write', path: LAUNCHER, text: '#!/bin/sh\n' },
      { kind: 'chmod', path: LAUNCHER },
      {
        kind: 'private',
        path: SECURITY_DIR,
        files: [
          { path: SECURITY_TEXT_FILE, text: privateClaudeMdText('security', 'repo', [SECURITY_PART]) },
          { path: SECURITY_RECORD, text: instructionsRecordText([SECURITY_PART], []) },
        ],
      },
      {
        kind: 'private',
        path: TL_DIR,
        files: [
          { path: `${TL_DIR}/instructions/CLAUDE.md`, text: privateClaudeMdText('tl', 'repo', []) },
          { path: `${TL_DIR}/instructions.json`, text: instructionsRecordText([], [SQUAD]) },
        ],
      },
      {
        kind: 'private',
        path: PM_PRIVATE.folder,
        files: [
          { path: `${PM_PRIVATE.folder}/instructions/CLAUDE.md`, text: privateClaudeMdText('pm', 'repo', []) },
          { path: `${PM_PRIVATE.folder}/instructions.json`, text: instructionsRecordText([], []) },
        ],
      },
      { kind: 'manifest', path: MANIFEST_PATH, text: stableJson(manifest) },
    ])
  })

  test('a role given only memories, or nothing, gets both files, also with no manifest step (C1)', async () => {
    const desired = [file(A, 'a\n')]
    const first = await planWithManifest(input({ desired }))
    const disk = new Map([
      [A, text('a\n')],
      [MANIFEST_PATH, text(stableJson(first.manifest))],
    ])
    const left = await planWithManifest(input({ desired, disk }))
    const steps = await applySteps({ ...left, desired, gitignore: null, choices: NO_CHOICES, privates: [TL_PRIVATE] })

    expect(steps.map(stepLine)).toEqual([`private ${TL_DIR}`])
    expect(steps.flatMap(step => (step.kind === 'private' ? step.files.map(onDisk => onDisk.path) : []))).toEqual([
      `${TL_DIR}/instructions/CLAUDE.md`,
      `${TL_DIR}/instructions.json`,
    ])
    const nothing = await applySteps({ ...left, desired, gitignore: null, choices: NO_CHOICES, privates: [PM_PRIVATE] })
    expect(nothing).toEqual([
      {
        kind: 'private',
        path: PM_PRIVATE.folder,
        files: [
          { path: `${PM_PRIVATE.folder}/instructions/CLAUDE.md`, text: privateClaudeMdText('pm', 'repo', []) },
          { path: `${PM_PRIVATE.folder}/instructions.json`, text: instructionsRecordText([], []) },
        ],
      },
    ])
  })
})

describe('regen private files (G-02-1f)', () => {
  test('the record names the global parts not given beside the given ones, only when there are any (Q1)', () => {
    const record = instructionsRecordText([SECURITY_PART], [SQUAD], [GIT_PART])

    expect(record).toBe(
      stableJson({
        schema: 1,
        parts: [{ file: '~/.claude/CLAUDE.md', heading: 'Security', hash: SECURITY_PART.hash }],
        partsNotGiven: [{ file: '~/.claude/CLAUDE.md', heading: 'Git', hash: GIT_PART.hash }],
        memories: [{ file: 'squad.md', folder: SQUAD.folder, summary: SQUAD.summary, hash: SQUAD.hash }],
      }),
    )
    expect(instructionsRecordText([SECURITY_PART], [], [])).toBe(instructionsRecordText([SECURITY_PART], []))
    expect(instructionsRecordText([SECURITY_PART], [])).not.toContain('partsNotGiven')
  })

  test('parseInstructionsRecord reads a record back, with no parts not given when it names none', () => {
    expect(parseInstructionsRecord(recordWith())).toEqual({
      parts: [{ file: '~/.claude/CLAUDE.md', heading: 'Security', hash: RECORD_HASH }],
      partsNotGiven: [{ file: '~/.claude/CLAUDE.md', heading: 'Git', hash: RECORD_HASH }],
      memories: [{ file: 'squad.md', folder: SQUAD.folder, summary: SQUAD.summary, hash: RECORD_HASH }],
    })
    expect(parseInstructionsRecord(recordWith({ partsNotGiven: undefined }))?.partsNotGiven).toEqual([])
    const written = instructionsRecordText([], [{ ...SQUAD, hash: RECORD_HASH }])
    expect(parseInstructionsRecord(written)).toEqual({
      parts: [],
      partsNotGiven: [],
      memories: [{ file: 'squad.md', folder: SQUAD.folder, summary: SQUAD.summary, hash: RECORD_HASH }],
    })
  })

  test('a record that is not schema 1 with checked parts and memories is null, so regen cannot use it', () => {
    const security = { file: '~/.claude/CLAUDE.md', heading: 'Security', hash: RECORD_HASH }
    const squad = { file: 'squad.md', folder: SQUAD.folder, summary: SQUAD.summary, hash: RECORD_HASH }
    const bad: readonly string[] = [
      'not json',
      '[]',
      recordWith({ schema: 2 }),
      recordWith({ parts: null }),
      recordWith({ memories: {} }),
      recordWith({ partsNotGiven: 'none' }),
      recordWith({ parts: [{ ...security, hash: 'not a hash' }] }),
      recordWith({ parts: [{ ...security, hash: RECORD_HASH.toUpperCase() }] }),
      recordWith({ parts: [{ ...security, file: '' }] }),
      recordWith({ parts: [{ ...security, file: `~/.claude/CLA${BIDI_OVERRIDE}UDE.md` }] }),
      recordWith({ parts: [{ ...security, heading: 'h'.repeat(81) }] }),
      recordWith({ partsNotGiven: [{ ...security, heading: 5 }] }),
      recordWith({ memories: [{ ...squad, hash: undefined }] }),
      recordWith({ memories: [{ ...squad, folder: 5 }] }),
      recordWith({ memories: [{ ...squad, summary: null }] }),
    ]
    for (const [index, text] of bad.entries()) expect([index, parseInstructionsRecord(text)]).toEqual([index, null])
  })

  test('a regen rebuild writes the text file, the record or both, whatever they hold (Q3, Q11)', async () => {
    const desired = [file(A, 'a\n')]
    const first = await planWithManifest(input({ desired }))
    const disk = new Map([
      [A, text('a\n')],
      [MANIFEST_PATH, text(stableJson(first.manifest))],
    ])
    const left = await planWithManifest(input({ desired, disk }))
    const stepsOf = async (role: PrivateRole): Promise<ApplyStep[]> =>
      applySteps({ ...left, desired, gitignore: null, choices: NO_CHOICES, privates: [role] })
    const emptied: PrivateRole = { ...PM_PRIVATE, id: 'security', folder: SECURITY_DIR }
    const headerOnly = { path: SECURITY_TEXT_FILE, text: privateClaudeMdText('security', 'repo', []) }
    const emptyRecord = { path: SECURITY_RECORD, text: instructionsRecordText([], []) }
    const record = { path: SECURITY_RECORD, text: instructionsRecordText([SECURITY_PART], [], [GIT_PART]) }

    expect(await stepsOf({ ...emptied, rebuild: 'both' })).toEqual([
      { kind: 'private', path: SECURITY_DIR, files: [headerOnly, emptyRecord] },
    ])
    expect(await stepsOf({ ...emptied, rebuild: 'text' })).toEqual([
      { kind: 'private', path: SECURITY_DIR, files: [headerOnly] },
    ])
    expect(await stepsOf({ ...SECURITY_PRIVATE, partsNotGiven: [GIT_PART], rebuild: 'record' })).toEqual([
      { kind: 'private', path: SECURITY_DIR, files: [record] },
    ])
    // With no rebuild, as init writes them, both files are written, whatever they hold (02-GAPS-B3 C1).
    expect(await stepsOf(emptied)).toEqual([
      { kind: 'private', path: SECURITY_DIR, files: [headerOnly, emptyRecord] },
    ])
  })
})
