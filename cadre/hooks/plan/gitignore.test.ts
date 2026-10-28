import { describe, expect, test } from 'claude-code/testing'

import type {
  DesiredFile,
  FileMode,
  FileOp,
  GitPolicy,
  HunkOp,
  Manifest,
  ManifestEntry,
  Op,
  Plan,
  PortRead,
} from '../../types'
import { sha256Hex } from '../core/hash'
import { stableJson } from '../core/json'
import { compareText } from '../core/text'
import { INBOX_FILE, PROBE_EXPECTATIONS_FILE, RUNTIME_RENDERED, RUNTIME_STAMP_FILE } from '../paths'
import { buildPlan, renderPlan } from '../plan'
import type { PlanInput } from '../plan'
import { BIDI_OVERRIDE } from '../testkit'
import { MANIFEST_PATH } from './classify'
import {
  gitignoreLines,
  hasThoughtsIgnore,
  IGNORE_BEGIN,
  IGNORE_END,
  ignoreLines,
  mergeIgnoreBlock,
  SECURITY_REPORTS_LINE,
} from './gitignore'

const VERSION = '0.2.0'
const ROLE = '.cadre/be/role.json'
const INDEX = '.cadre/INDEX.md'

/** A desired file; the mode is a plain file unless it says otherwise. */
function file(path: string, content: string, mode: FileMode = 'file'): DesiredFile {
  return { path, content, mode }
}

/** A file read through the port: its text. */
function text(content: string): PortRead {
  return { state: 'text', text: content }
}

/** The disk as buildPlan takes it: reads keyed by repo-relative path. */
function diskOf(reads: Readonly<Record<string, PortRead>>): ReadonlyMap<string, PortRead> {
  return new Map(Object.entries(reads))
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

/** The file ops of a plan, in plan order; the hunks are dropped. */
function fileOps(plan: Plan): FileOp[] {
  const ops: FileOp[] = []
  for (const planned of plan.ops) {
    if (planned.kind !== 'hunk') ops.push(planned)
  }

  return ops
}

/** One `kind path` line per file op: a compact way to compare the order and the kinds of a plan. */
function summary(plan: Plan): string[] {
  return fileOps(plan).map(planned => `${planned.kind} ${planned.path}`)
}

/** The kind of the op for one path; undefined when the plan has none. */
function kindOf(plan: Plan, path: string): string | undefined {
  return fileOps(plan).find(planned => planned.path === path)?.kind
}

/** The manifest entries of some desired files, as the plan records them. */
async function entriesOf(files: readonly DesiredFile[]): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = []
  for (const desired of files) {
    entries.push({ path: desired.path, sha256: await sha256Hex(desired.content), mode: desired.mode })
  }

  return entries
}

/**
 * The text a plan writes for the manifest: stableJson of schema 1, the version and the entries in path order, and
 * nothing else. A plan holds no content, so a test proves the text by putting it on the disk and expecting `leave`.
 */
function manifestTextOf(entries: readonly ManifestEntry[], cadreVersion = VERSION): string {
  const files = [...entries].sort((a, b) => compareText(a.path, b.path))
  const manifest: Manifest = { schema: 1, cadreVersion, files }

  return stableJson(manifest)
}

/** A file op built by hand, for the render tests. */
function op(kind: FileOp['kind'], path: string, over: Partial<FileOp> = {}): FileOp {
  return { kind, path, mode: 'file', note: null, ...over }
}

/** A plan built by hand, for the render tests. */
function planOf(ops: readonly Op[], warnings: readonly string[] = []): Plan {
  return { ops, warnings }
}

const GSD_TOOLS = 'node ~/.claude/gsd-core/bin/gsd-tools.cjs'

/** A required, accepted, runnable hunk, as 02-08 builds one for the GSD mode setting. */
const HUNK: HunkOp = {
  kind: 'hunk',
  file: '.planning/config.json',
  key: 'mode',
  before: 'interactive',
  after: 'yolo',
  isRequired: true,
  isAccepted: true,
  isRunnable: true,
  command: `${GSD_TOOLS} config-set mode yolo`,
}

describe('ignore block', () => {
  describe('markers and rendered files', () => {
    test('the markers are the on-disk contract that re-runs, regen and uninstall look for', () => {
      expect(IGNORE_BEGIN).toBe('# >>> cadre')
      expect(IGNORE_END).toBe('# <<< cadre')
    })

    test('the per-user files /cadre start renders into .runtime are the eight named, in a frozen list', () => {
      expect(RUNTIME_RENDERED).toEqual([
        'settings.json',
        'mcp.json',
        'overlay/',
        'instructions/',
        'private-instructions',
        'probe-expectations.json',
        'inbox.md',
        'stamp',
      ])
      expect(Object.isFrozen(RUNTIME_RENDERED)).toBe(true)
    })

    test('the stamp, the inbox and the probe expectations have one name each, the last three rendered (D-102)', () => {
      expect(RUNTIME_STAMP_FILE).toBe('stamp')
      expect(INBOX_FILE).toBe('inbox.md')
      expect(PROBE_EXPECTATIONS_FILE).toBe('probe-expectations.json')
      expect(RUNTIME_RENDERED.slice(-3)).toEqual([PROBE_EXPECTATIONS_FILE, INBOX_FILE, RUNTIME_STAMP_FILE])
    })
  })

  describe('mergeIgnoreBlock', () => {
    test('no file gives the block alone', () => {
      expect(mergeIgnoreBlock(null, ['a'])).toBe('# >>> cadre\na\n# <<< cadre\n')
    })

    test('an empty file gives the block alone', () => {
      expect(mergeIgnoreBlock('', ['a'])).toBe('# >>> cadre\na\n# <<< cadre\n')
    })

    test('no lines gives a block of the two markers', () => {
      expect(mergeIgnoreBlock(null, [])).toBe('# >>> cadre\n# <<< cadre\n')
    })

    test('a file with no block gets the block appended after its lines', () => {
      expect(mergeIgnoreBlock('node_modules\n', ['a'])).toBe('node_modules\n# >>> cadre\na\n# <<< cadre\n')
    })

    test('a last line with no newline gets one before the block', () => {
      expect(mergeIgnoreBlock('x', ['a'])).toBe('x\n# >>> cadre\na\n# <<< cadre\n')
    })

    test('an existing block is replaced in place and the text around it is kept byte for byte', () => {
      const existing = 'one \n\n# keep\n# >>> cadre\nold1\nold2\n# <<< cadre\ntwo\r\nthree'

      expect(mergeIgnoreBlock(existing, ['new'])).toBe('one \n\n# keep\n# >>> cadre\nnew\n# <<< cadre\ntwo\r\nthree')
    })

    test('an empty block is filled with the lines, and a block given no lines is emptied', () => {
      expect(mergeIgnoreBlock('# >>> cadre\n# <<< cadre\n', ['a'])).toBe('# >>> cadre\na\n# <<< cadre\n')
      expect(mergeIgnoreBlock('a\n# >>> cadre\nold\n# <<< cadre\nb\n', [])).toBe('a\n# >>> cadre\n# <<< cadre\nb\n')
    })

    test('markers that end in a carriage return are found, so a Windows file does not get a second block', () => {
      const existing = 'x\r\n# >>> cadre\r\nold\r\n# <<< cadre\r\ny\r\n'

      expect(mergeIgnoreBlock(existing, ['new'])).toBe('x\r\n# >>> cadre\nnew\n# <<< cadre\ny\r\n')
    })

    test('a begin marker with no end marker gives null', () => {
      expect(mergeIgnoreBlock('# >>> cadre\nx\n', ['a'])).toBeNull()
      expect(mergeIgnoreBlock('a\n# >>> cadre', ['a'])).toBeNull()
    })

    test('an end marker before the begin marker does not close it', () => {
      expect(mergeIgnoreBlock('# <<< cadre\n# >>> cadre\nx\n', ['a'])).toBeNull()
    })

    test('an end marker alone is an ordinary line and the block is appended', () => {
      expect(mergeIgnoreBlock('# <<< cadre\n', ['a'])).toBe('# <<< cadre\n# >>> cadre\na\n# <<< cadre\n')
    })

    test('a marker is a whole line: a longer line or an indented one is not a marker', () => {
      const existing = '# >>> cadre extra\n # >>> cadre\n'

      expect(mergeIgnoreBlock(existing, ['a'])).toBe(`${existing}# >>> cadre\na\n# <<< cadre\n`)
    })

    test('only the first block is replaced; a second one is other text and is kept', () => {
      const existing = 'a\n# >>> cadre\n1\n# <<< cadre\nb\n# >>> cadre\n2\n# <<< cadre\n'

      expect(mergeIgnoreBlock(existing, ['new'])).toBe(
        'a\n# >>> cadre\nnew\n# <<< cadre\nb\n# >>> cadre\n2\n# <<< cadre\n',
      )
    })

    test('merging twice gives the same text as merging once', () => {
      const texts = [null, '', 'x', 'x\n', '# >>> cadre\nold\n# <<< cadre', 'a\r\n# >>> cadre\r\n# <<< cadre\r\n']

      for (const existing of texts) {
        const once = mergeIgnoreBlock(existing, ['a', 'b'])

        expect(once).not.toBeNull()
        expect(mergeIgnoreBlock(once, ['a', 'b'])).toBe(once)
      }
    })
  })

  describe('hasThoughtsIgnore', () => {
    test('is false when there is no file and when no line is about thoughts', () => {
      expect(hasThoughtsIgnore(null)).toBe(false)
      expect(hasThoughtsIgnore('')).toBe(false)
      expect(hasThoughtsIgnore('node_modules\n.env\n')).toBe(false)
    })

    test('is true for thoughts/, /thoughts, thoughts and /thoughts/ as a whole line', () => {
      expect(hasThoughtsIgnore('a\nthoughts/\nb\n')).toBe(true)
      expect(hasThoughtsIgnore('a\n/thoughts\nb\n')).toBe(true)
      expect(hasThoughtsIgnore('a\nthoughts\nb\n')).toBe(true)
      expect(hasThoughtsIgnore('a\n/thoughts/\nb\n')).toBe(true)
    })

    test('counts a last line with no newline and a line that ends in a carriage return', () => {
      expect(hasThoughtsIgnore('a\nthoughts')).toBe(true)
      expect(hasThoughtsIgnore('a\r\nthoughts/\r\n')).toBe(true)
    })

    test('is false for a longer path, a comment, a negation, another name or an indented line', () => {
      expect(hasThoughtsIgnore('thoughts/x\n')).toBe(false)
      expect(hasThoughtsIgnore('#thoughts/\n')).toBe(false)
      expect(hasThoughtsIgnore('!thoughts/\n')).toBe(false)
      expect(hasThoughtsIgnore('thoughts.md\n')).toBe(false)
      expect(hasThoughtsIgnore(' thoughts/\n')).toBe(false)
    })

    test('a line inside the cadre block does not count, and one before or after it does', () => {
      const inside = '# >>> cadre\nthoughts/\n# <<< cadre\n'

      expect(hasThoughtsIgnore(inside)).toBe(false)
      expect(hasThoughtsIgnore(`thoughts/\n${inside}`)).toBe(true)
      expect(hasThoughtsIgnore(`${inside}/thoughts\n`)).toBe(true)
    })

    test('with a block that never ends, everything after its begin marker is inside it', () => {
      expect(hasThoughtsIgnore('# >>> cadre\nthoughts/\n')).toBe(false)
      expect(hasThoughtsIgnore('thoughts/\n# >>> cadre\nx\n')).toBe(true)
    })
  })

  describe('gitignoreLines and the three policies', () => {
    test('definitions: thoughts/, the .runtime folders wholesale and the .cadre-new files (D-90, D-99)', () => {
      const text = mergeIgnoreBlock(null, gitignoreLines('definitions', null))

      expect(text).toBe('# >>> cadre\nthoughts/\n.cadre/*/.runtime/\n.cadre/**/*.cadre-new\n# <<< cadre\n')
    })

    test('all: thoughts/, only the per-user rendered files of .runtime and the .cadre-new files (D-90, D-99)', () => {
      const text = mergeIgnoreBlock(null, gitignoreLines('all', null))

      expect(text).toBe(
        '# >>> cadre\nthoughts/\n.cadre/*/.runtime/settings.json\n.cadre/*/.runtime/mcp.json\n' +
          '.cadre/*/.runtime/overlay/\n.cadre/*/.runtime/instructions/\n.cadre/*/.runtime/private-instructions\n' +
          '.cadre/*/.runtime/probe-expectations.json\n.cadre/*/.runtime/inbox.md\n.cadre/*/.runtime/stamp\n' +
          '.cadre/**/*.cadre-new\n# <<< cadre\n',
      )
    })

    test('ignore: thoughts/ and all of .cadre/ (D-90)', () => {
      const text = mergeIgnoreBlock(null, gitignoreLines('ignore', null))

      expect(text).toBe('# >>> cadre\nthoughts/\n.cadre/\n# <<< cadre\n')
    })

    test('thoughts/ is left out when a thoughts line is already outside the block, in every policy', () => {
      const policies: GitPolicy[] = ['all', 'definitions', 'ignore']

      for (const policy of policies) {
        expect(gitignoreLines(policy, 'thoughts/\n')).toEqual(ignoreLines(policy))
        expect(gitignoreLines(policy, '/thoughts\n')).toEqual(ignoreLines(policy))
      }
    })

    test('thoughts/ stays when the only thoughts line is inside the cadre block', () => {
      const existing = '# >>> cadre\nthoughts/\n.cadre/*/.runtime/\n# <<< cadre\n'

      expect(gitignoreLines('definitions', existing)).toEqual([
        'thoughts/',
        '.cadre/*/.runtime/',
        '.cadre/**/*.cadre-new',
      ])
    })

    test('ignoreLines gives the policy lines alone, as a new array each time', () => {
      expect(ignoreLines('definitions')).toEqual(['.cadre/*/.runtime/', '.cadre/**/*.cadre-new'])
      expect(ignoreLines('ignore')).toEqual(['.cadre/'])
      expect(ignoreLines('all')).toHaveLength(9)

      const first = ignoreLines('all')
      first.push('changed')

      expect(ignoreLines('all')).not.toContain('changed')
    })

    test('all ignores the private instructions link with no trailing slash, as git matches a link (M2)', () => {
      expect(ignoreLines('all')).toContain('.cadre/*/.runtime/private-instructions')
      expect(ignoreLines('all')).not.toContain('.cadre/*/.runtime/private-instructions/')
    })

    test('every line of the all policy comes from the rendered files, and the folder itself is not ignored', () => {
      const lines = ignoreLines('all')

      expect(lines).toEqual([...RUNTIME_RENDERED.map(name => `.cadre/*/.runtime/${name}`), '.cadre/**/*.cadre-new'])
      expect(lines).not.toContain('.cadre/*/.runtime/')
    })
  })

  describe('the .gitignore op', () => {
    const LINES = ['thoughts/', '.cadre/*/.runtime/']
    const MERGED = '# >>> cadre\nthoughts/\n.cadre/*/.runtime/\n# <<< cadre\n'
    const UNREADABLE = 'could not read .gitignore (treated as unknown): the ignore block is not planned'
    const NO_END = 'the cadre block in .gitignore has no end marker: fix it by hand; the ignore block is not planned'

    function withIgnore(read: PortRead): PlanInput['gitignore'] {
      return { disk: read, lines: LINES }
    }

    test('no .gitignore on disk plans a create op that sorts after the .cadre ops', async () => {
      const plan = await buildPlan(input({ desired: [file(ROLE, '{}\n')], gitignore: withIgnore({ state: 'absent' }) }))
      const detail = [IGNORE_BEGIN, ...LINES, IGNORE_END]

      expect(summary(plan)).toEqual([`create ${ROLE}`, `create ${MANIFEST_PATH}`, 'create .gitignore'])
      expect(fileOps(plan)[2]).toEqual({ kind: 'create', path: '.gitignore', mode: 'file', note: null, detail })
      expect(plan.warnings).toEqual([])
    })

    test('a .gitignore that already holds the block is left', async () => {
      const plan = await buildPlan(input({ gitignore: withIgnore(text(MERGED)) }))

      expect(kindOf(plan, '.gitignore')).toBe('leave')
    })

    test('a .gitignore without the block is changed', async () => {
      const plan = await buildPlan(input({ gitignore: withIgnore(text('node_modules\n')) }))

      expect(kindOf(plan, '.gitignore')).toBe('change')
    })

    test('a .gitignore with a block of other lines is changed', async () => {
      const plan = await buildPlan(input({ gitignore: withIgnore(text('# >>> cadre\nold\n# <<< cadre\n')) }))

      expect(kindOf(plan, '.gitignore')).toBe('change')
    })

    test('an empty .gitignore is changed, since the file is there', async () => {
      const plan = await buildPlan(input({ gitignore: withIgnore(text('')) }))

      expect(kindOf(plan, '.gitignore')).toBe('change')
    })

    test('a .gitignore that is unknown or too large plans no op and warns', async () => {
      const unknown = await buildPlan(input({ gitignore: withIgnore({ state: 'unknown' }) }))
      const large = await buildPlan(input({ gitignore: withIgnore({ state: 'too-large', bytes: 300_000 }) }))

      expect(kindOf(unknown, '.gitignore')).toBeUndefined()
      expect(unknown.warnings).toEqual([UNREADABLE])
      expect(kindOf(large, '.gitignore')).toBeUndefined()
      expect(large.warnings).toEqual([UNREADABLE])
    })

    test('a block with no end marker plans no op and asks for a fix by hand', async () => {
      const plan = await buildPlan(input({ gitignore: withIgnore(text('a\n# >>> cadre\nx\n')) }))

      expect(kindOf(plan, '.gitignore')).toBeUndefined()
      expect(plan.warnings).toEqual([NO_END])
    })

    test('with no gitignore input there is no .gitignore op and no warning', async () => {
      const plan = await buildPlan(input({ gitignore: null }))

      expect(summary(plan)).toEqual([`create ${MANIFEST_PATH}`])
      expect(plan.warnings).toEqual([])
    })

    test('the .gitignore is not in the manifest, which records the generated files alone', async () => {
      const files = [file(ROLE, '{}\n')]
      const planned = manifestTextOf(await entriesOf(files))
      const plan = await buildPlan(
        input({ desired: files, disk: diskOf({ [MANIFEST_PATH]: text(planned) }), gitignore: withIgnore(text('')) }),
      )

      expect(kindOf(plan, MANIFEST_PATH)).toBe('leave')
    })

    test('a re-run with the planned .gitignore text on disk leaves it', async () => {
      const lines = gitignoreLines('definitions', 'node_modules\n')
      const planned = mergeIgnoreBlock('node_modules\n', lines) ?? ''
      const plan = await buildPlan(input({ gitignore: { disk: text(planned), lines } }))

      expect(kindOf(plan, '.gitignore')).toBe('leave')
    })
  })
})

describe('gitignore block rows (G-02-3)', () => {
  /** The block lines of the definitions policy for a repo with no `.gitignore`, as gitignoreLines gives them. */
  const LINES = gitignoreLines('definitions', null)

  /** What the `.gitignore` op carries: the block lines between the two markers, markers included (PLAN-03). */
  const DETAIL = [IGNORE_BEGIN, ...LINES, IGNORE_END]

  test('the .gitignore op carries the block lines, markers included, when created, changed or left', async () => {
    const reads: readonly (readonly [PortRead, FileOp['kind']])[] = [
      [{ state: 'absent' }, 'create'],
      [text('node_modules\n'), 'change'],
      [text(mergeIgnoreBlock(null, LINES) ?? ''), 'leave'],
    ]
    for (const [disk, kind] of reads) {
      const plan = await buildPlan(input({ gitignore: { disk, lines: LINES } }))
      const ignore = fileOps(plan).find(planned => planned.path === '.gitignore')

      expect([kind, ignore]).toEqual([kind, { kind, path: '.gitignore', mode: 'file', note: null, detail: DETAIL }])
    }
  })

  test('only the .gitignore op has detail rows: no create, conflict, copy, stale file or manifest op', async () => {
    const stale: ManifestEntry = { path: '.cadre/old.json', sha256: 'x', mode: 'file' }
    const plan = await buildPlan(
      input({
        desired: [file(ROLE, 'new\n'), file(INDEX, '# index\n')],
        disk: diskOf({ [ROLE]: text('mine\n') }),
        manifest: { schema: 1, cadreVersion: VERSION, files: [stale] },
        manifestState: 'present',
        gitignore: { disk: { state: 'absent' }, lines: LINES },
        hunks: [HUNK],
      }),
    )

    expect(summary(plan)).toEqual([
      `create ${INDEX}`,
      `conflict ${ROLE}`,
      `create ${ROLE}.cadre-new`,
      `create ${MANIFEST_PATH}`,
      'leave .cadre/old.json',
      'create .gitignore',
    ])
    expect(fileOps(plan).filter(planned => 'detail' in planned).map(planned => planned.path)).toEqual(['.gitignore'])
  })

  test('renderPlan shows each block line on its own row under the .gitignore row, indented like a note', async () => {
    const plan = await buildPlan(input({ gitignore: { disk: { state: 'absent' }, lines: LINES } }))

    expect(LINES).toEqual(['thoughts/', '.cadre/*/.runtime/', '.cadre/**/*.cadre-new'])
    expect(renderPlan(plan)).toEqual([
      'File plan:',
      '  create    .cadre/manifest.json',
      '  create    .gitignore',
      '            # >>> cadre',
      '            thoughts/',
      '            .cadre/*/.runtime/',
      '            .cadre/**/*.cadre-new',
      '            # <<< cadre',
      'Summary: 2 create, 0 change, 0 leave, 0 conflict, 0 hunks',
    ])
  })

  test('the detail rows come after the note row when the op has a note, and before the next op', () => {
    const ops = [op('change', '.gitignore', { note: 'kept', detail: ['a', 'b'] }), op('create', 'z')]
    const lines = renderPlan(planOf(ops))

    expect(lines.slice(1, 6)).toEqual([
      '  change    .gitignore',
      '            kept',
      '            a',
      '            b',
      '  create    z',
    ])
  })

  test('each detail line is cleaned as a report cell, so none can add a row or hide text (T-02-52)', () => {
    const lines = renderPlan(planOf([op('create', '.gitignore', { detail: [`x\ny${BIDI_OVERRIDE}`] })]))

    expect(lines).toEqual([
      'File plan:',
      '  create    .gitignore',
      '            xy',
      'Summary: 1 create, 0 change, 0 leave, 0 conflict, 0 hunks',
    ])
  })
})

describe('the security report line (decision #39)', () => {
  /** The three git policies, in the order the tests run them. */
  const POLICIES: readonly GitPolicy[] = ['all', 'definitions', 'ignore']

  /** No .gitignore yet, and one that already ignores thoughts/ outside the block. */
  const EXISTING: readonly (string | null)[] = [null, 'thoughts/\n']

  test('the line ignores the CLAUDE-SECURITY-<time>/ report folders claude-security writes', () => {
    expect(SECURITY_REPORTS_LINE).toBe('CLAUDE-SECURITY-*/')
  })

  test('with a Security role the block ends with the line, in every policy, with or without thoughts/', () => {
    for (const policy of POLICIES) {
      for (const existing of EXISTING) {
        const lines = gitignoreLines(policy, existing, true)

        expect([policy, existing, lines]).toEqual([
          policy,
          existing,
          [...gitignoreLines(policy, existing), 'CLAUDE-SECURITY-*/'],
        ])
      }
    }
    expect(mergeIgnoreBlock(null, gitignoreLines('definitions', null, true))).toBe(
      '# >>> cadre\nthoughts/\n.cadre/*/.runtime/\n.cadre/**/*.cadre-new\nCLAUDE-SECURITY-*/\n# <<< cadre\n',
    )
  })

  test('without a Security role, or with the parameter left out, the lines are those of every policy before', () => {
    for (const policy of POLICIES) {
      for (const existing of EXISTING) {
        expect(gitignoreLines(policy, existing, false)).toEqual(gitignoreLines(policy, existing))
        expect(gitignoreLines(policy, existing)).not.toContain('CLAUDE-SECURITY-*/')
      }
    }
    expect(gitignoreLines('definitions', null)).toEqual(['thoughts/', '.cadre/*/.runtime/', '.cadre/**/*.cadre-new'])
    expect(gitignoreLines('ignore', 'thoughts/\n', false)).toEqual(['.cadre/'])
  })
})
