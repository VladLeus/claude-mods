import { describe, expect, test } from 'claude-code/testing'

import type { HostIo, HostRun, InitIo, InstructionPart, PortEntry } from '../../types'
import { MANIFEST_PATH } from '../plan/classify'
import {
  DEFAULT_LOCATIONS,
  entry,
  hostWorld,
  link,
  memHost,
  memIo,
  memWorld,
  SECURITY_DIR,
  SECURITY_RECORD,
  SECURITY_TEXT_FILE,
  SLUG_DIR,
  TL_DIR,
} from '../testkit'
import type { HostRunRule, MemHost, MemRun } from '../testkit'
import { withContext } from '../ui/ask'
import { lineDiff } from '../ui/diff'
import {
  builtRoleFiles,
  changedBeforeRunWarning,
  improveBuiltFiles,
  IMPROVER_OPTIONS,
  IMPROVER_PROGRESS,
  IMPROVER_TIMEOUT_MS,
  improverArgv,
  improverBlockLines,
  improverContextLine,
  improverDismissedWarning,
  improverFailedNote,
  improverFailure,
  improverLine,
  improverNoChangeNote,
  improverQuestion,
  improverUnreadableNote,
  otherChangesWarning,
  otherFilesLines,
  restoreSteps,
  uncheckedFilesWarning,
} from './improver'
import type { BuiltFile, BuiltFilter } from './improver'
import { privateClaudeMdText } from './private'
import type { ApplyStep } from './private'

/** A part of the fixture user's global CLAUDE.md as the read gives it; the hash only has to be a hash-like text. */
function globalPart(id: string, heading: string, text: string): InstructionPart {
  const hash = `${id.toLowerCase()}${'0'.repeat(62)}`

  return { id, file: '~/.claude/CLAUDE.md', heading, source: 'global', text, hash }
}

/** The Security section of the global CLAUDE.md. */
const SECURITY_PART = globalPart('P1', 'Security', '# Security\nNever commit secrets.\n')

/** Security's private text file as the improver pass gets it. */
const SECURITY_BUILT_FILE: BuiltFile = {
  path: SECURITY_TEXT_FILE,
  text: privateClaudeMdText('security', 'repo', [SECURITY_PART]),
}

/** Security's private text file as the pass shows it, from the home folder. */
const SECURITY_SHOWN = '~/.claude/cadre/repo-1a2b3c4d/security/instructions/CLAUDE.md'

/** BE's role memory folder (D-140 q2-a). */
const BE_DIR = `${SLUG_DIR}/be`

/** BE's instructions/ folder, which holds its private text file: the folder its improver run starts in. */
const BE_FOLDER = `${BE_DIR}/instructions`

/** BE's instructions/ folder as the pass shows it, from the home folder. */
const BE_FOLDER_SHOWN = '~/.claude/cadre/repo-1a2b3c4d/be/instructions'

/** BE's private text file. */
const BE_TEXT_FILE = `${BE_FOLDER}/CLAUDE.md`

/** BE's private text file as the pass shows it, from the home folder. */
const BE_TEXT_SHOWN = `${BE_FOLDER_SHOWN}/CLAUDE.md`

/** The text apply wrote to BE's private text file: its header, then the Security section given to BE. */
const BE_BUILT = privateClaudeMdText('be', 'repo', [SECURITY_PART])

/** BE's private text file as the improver leaves it: one line reworded and one line added. */
const BE_IMPROVED = BE_BUILT.replace(
  'Never commit secrets.',
  'Never commit secrets or keys.\nRotate keys every month.',
)

/** BE's private text file as the improver pass gets it. */
const BE_PRIVATE_FILE: BuiltFile = { path: BE_TEXT_FILE, text: BE_BUILT }

/** The per-file question of BE's private text file, as asked: the question, then its context line (D-136). */
const BE_IMPROVER_ASKED =
  `Accept the improver's changes to ${BE_TEXT_SHOWN}?\n2 lines added, 1 removed; the pane shows the diff.`

/** What one improver run leaves on the disk: the new text of each path it wrote, null for each one it removed. */
type Edits = Readonly<Record<string, string | null>>

/** A disk the improver tests change as a run would: each file's text and each folder's listing, by absolute path. */
type Disk = {
  readonly files: Record<string, string>
  readonly dirs: Record<string, readonly PortEntry[]>
}

/** The disk of the improver tests: BE's and Security's private text files as apply wrote them. */
function builtDisk(): Disk {
  return {
    files: { [BE_TEXT_FILE]: BE_BUILT, [SECURITY_TEXT_FILE]: SECURITY_BUILT_FILE.text },
    dirs: {
      [BE_FOLDER]: [entry('CLAUDE.md')],
      [`${SECURITY_DIR}/instructions`]: [entry('CLAUDE.md')],
    },
  }
}

/** The disk after one edit: the path holds the text, or is gone with null, and its folder lists it or not. */
function applyEdit(disk: Disk, path: string, text: string | null): void {
  const at = path.lastIndexOf('/')
  const folder = path.slice(0, at)
  const name = path.slice(at + 1)
  const others = (disk.dirs[folder] ?? []).filter(listed => listed.name !== name)
  if (text === null) {
    delete disk.files[path]
    disk.dirs[folder] = others
    return
  }
  disk.files[path] = text
  disk.dirs[folder] = [...others, entry(name)]
}

/**
 * The host of an improver test: it answers each run as memHost does with these rules, and once it ran the improver for
 * a file it applies the edits given for that file to the disk, as that run would leave it (G-02-1f, D-141).
 */
function editingHost(
  disk: Disk,
  edits: ReadonlyMap<string, Edits>,
  runs: readonly HostRunRule[] = [],
): { readonly io: HostIo; readonly host: MemHost } {
  const host = memHost(hostWorld({ runs }))
  const io: HostIo = {
    ...host.io,
    run: async (argv, options) => {
      const result = await host.io.run(argv, options)
      const prompt = argv.at(-1) ?? ''
      for (const [file, changes] of edits) {
        if (argv[0] !== 'claude' || !prompt.includes(` ${file} `)) continue
        for (const [path, text] of Object.entries(changes)) applyEdit(disk, path, text)
      }

      return result
    },
  }

  return { io, host }
}

/** The port of an improver test over the disk, answering its questions with these answers. */
function diskIo(disk: Disk, answers: readonly string[] | Readonly<Record<string, string>> = {}): MemRun {
  return memIo(memWorld({ files: disk.files, dirs: disk.dirs }), answers)
}

/** A port whose clock moves on by `stepMs` at each read, as across a run that took that long. */
function tickingClock(io: InitIo, stepMs: number): InitIo {
  let now = 0

  return {
    ...io,
    now: async () => {
      now += stepMs

      return now
    },
  }
}

/** The run of the improver for BE's private text file, with this result. */
function beRun(result: HostRun | null): HostRunRule {
  return { argv: improverArgv(BE_TEXT_FILE), result }
}

/**
 * The init port of `run` and the host port `host` with the loader writes, the questions and the claude runs in one
 * list, in order: `progress <label>`, `ask` and `run claude` (S-02).
 */
function loaderEvents(
  run: MemRun,
  host: HostIo,
): { readonly io: InitIo; readonly host: HostIo; readonly events: string[] } {
  const events: string[] = []
  const io: InitIo = {
    ...run.io,
    progress: async (text, summary) => {
      events.push(`progress ${text ?? ''}`)
      await run.io.progress(text, summary)
    },
    ask: async (question, spec) => {
      events.push('ask')

      return run.io.ask(question, spec)
    },
  }
  const logged: HostIo = {
    ...host,
    run: async (argv, options) => {
      if (argv[0] === 'claude') events.push('run claude')

      return host.run(argv, options)
    },
  }

  return { io, host: logged, events }
}

describe('improver pass (G-02-1f)', () => {
  test('improverArgv is claude -p in acceptEdits with the skill and the absolute path, and nothing else', () => {
    expect(improverArgv(BE_TEXT_FILE)).toEqual([
      'claude',
      '-p',
      '--permission-mode',
      'acceptEdits',
      '--',
      `Use the claude-md-management:claude-md-improver skill to improve the file ${BE_TEXT_FILE} only.`,
    ])
    expect(IMPROVER_TIMEOUT_MS).toBe(300_000)
    expect(IMPROVER_OPTIONS).toEqual(['Accept', 'Keep original'])
  })

  test('each built file gets one run, in the folder that holds it, with 300 s, in the order given', async () => {
    const disk = builtDisk()
    const { io, host } = editingHost(disk, new Map())
    const run = diskIo(disk)
    const outcome = await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE, SECURITY_BUILT_FILE], DEFAULT_LOCATIONS)
    expect(host.calls).toEqual([
      { argv: improverArgv(BE_TEXT_FILE), options: { cwd: BE_FOLDER, timeoutMs: 300_000 } },
      { argv: improverArgv(SECURITY_TEXT_FILE), options: { cwd: `${SECURITY_DIR}/instructions`, timeoutMs: 300_000 } },
    ])
    expect(outcome).toEqual({ restores: [], warnings: [], changed: 0, total: 2 })
    expect(run.logged).toEqual([improverNoChangeNote(BE_TEXT_SHOWN), improverNoChangeNote(SECURITY_SHOWN)])
    expect(run.asked).toEqual([])
    expect(improverNoChangeNote(BE_TEXT_SHOWN)).toBe(`the improver made no change to ${BE_TEXT_SHOWN}`)
  })

  test('the improver label is set before each run, since a per-file question clears it (D-257, S-02)', async () => {
    const securityImproved = `${SECURITY_BUILT_FILE.text}Keep secrets out of logs.\n`
    const edits = new Map<string, Edits>([
      [BE_TEXT_FILE, { [BE_TEXT_FILE]: BE_IMPROVED }],
      [SECURITY_TEXT_FILE, { [SECURITY_TEXT_FILE]: securityImproved }],
    ])
    const disk = builtDisk()
    const run = diskIo(disk, { "Accept the improver's changes": 'Accept' })
    const { io, host, events } = loaderEvents(run, editingHost(disk, edits).io)
    const outcome = await improveBuiltFiles(io, host, [BE_PRIVATE_FILE, SECURITY_BUILT_FILE], DEFAULT_LOCATIONS)
    const label = `progress ${IMPROVER_PROGRESS}`
    expect(events).toEqual([label, 'run claude', 'ask', label, 'run claude', 'ask'])
    expect(run.progressSummaries).toEqual(['2 files', '2 files'])
    expect(outcome.changed).toBe(2)
  })

  test("a change is asked about with its diff as the question's context, and Accept keeps it (D-302)", async () => {
    const disk = builtDisk()
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, { [BE_TEXT_FILE]: BE_IMPROVED }]]))
    const run = diskIo(disk, { "Accept the improver's changes": 'Accept' })
    const outcome = await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    const lines = [
      `${BE_TEXT_SHOWN}: 2 lines added, 1 removed`,
      '- Never commit secrets.',
      '+ Never commit secrets or keys.',
      '+ Rotate keys every month.',
    ]
    expect(run.shown).toEqual([])
    expect(improverBlockLines(BE_TEXT_SHOWN, lineDiff(BE_BUILT, BE_IMPROVED))).toEqual(lines)
    expect(run.asked).toEqual([BE_IMPROVER_ASKED])
    // The context's summary is its file and counts line, which a pane surface asks under the question (D-310).
    const question = `Accept the improver's changes to ${BE_TEXT_SHOWN}?`
    const summary = lines[0] ?? ''
    const pane = { asked: BE_IMPROVER_ASKED, text: `${question}\n${summary}` }
    const rows = [
      {
        title: null,
        rows: [
          { role: 'field', label: BE_TEXT_SHOWN, text: '2 lines added, 1 removed', indent: 0 },
          ...lines.slice(1).map(text => ({ role: 'plain', text, indent: 0 })),
        ],
      },
    ]
    const context = { title: `Improver: ${BE_TEXT_SHOWN}`, lines, kind: 'improver', summary, pane, rows }
    expect(run.specs).toEqual([{ options: ['Accept', 'Keep original'], header: 'Improver', context }])
    expect(outcome).toEqual({ restores: [], warnings: [], changed: 1, total: 1 })
    expect(disk.files[BE_TEXT_FILE]).toBe(BE_IMPROVED)
  })

  test('a secret-like span of the diff is hidden in the block and context only; Accept keeps it (E1)', async () => {
    const keyLine = 'Use API_KEY=sk-FAKE-SECRET-0123456789 on staging.'
    const improved = BE_BUILT.replace('Never commit secrets.', keyLine)
    const disk = builtDisk()
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, { [BE_TEXT_FILE]: improved }]]))
    const run = diskIo(disk, { "Accept the improver's changes": 'Accept' })
    const outcome = await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    const lines = [
      `${BE_TEXT_SHOWN}: 1 line added, 1 removed`,
      '- Never commit secrets.',
      '+ Use API_KEY=[hidden] on staging.',
    ]
    const [asked = ''] = run.asked
    const summary = lines[0] ?? ''
    const pane = { asked, text: `Accept the improver's changes to ${BE_TEXT_SHOWN}?\n${summary}` }
    const rows = [
      {
        title: null,
        rows: [
          { role: 'field', label: BE_TEXT_SHOWN, text: '1 line added, 1 removed', indent: 0 },
          ...lines.slice(1).map(text => ({ role: 'plain', text, indent: 0 })),
        ],
      },
    ]
    const context = { title: `Improver: ${BE_TEXT_SHOWN}`, lines, kind: 'improver', summary, pane, rows }
    expect([run.shown, run.specs.map(spec => spec.context)]).toEqual([[], [context]])
    expect([outcome.changed, disk.files[BE_TEXT_FILE]]).toEqual([1, improved])
  })

  test('a secret-like span across the 240 cut of a diff line is hidden in the block, no prefix shows (PR-S1)', () => {
    const words = 'word '.repeat(46)
    const line = `${words}${'a1b2c3d4e5'.repeat(4)}`
    expect(improverBlockLines(BE_TEXT_SHOWN, lineDiff('', `${line}\n`))).toEqual([
      `${BE_TEXT_SHOWN}: 1 line added, 0 removed`,
      `+ ${words}[hidden]`,
    ])
  })

  test('Keep original, typed in any case, gives the file back to be written as built; none is accepted', async () => {
    const disk = builtDisk()
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, { [BE_TEXT_FILE]: BE_IMPROVED }]]))
    const run = diskIo(disk, { "Accept the improver's changes": ' keep ORIGINAL ' })
    const outcome = await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    expect(outcome).toEqual({ restores: [BE_PRIVATE_FILE], warnings: [], changed: 0, total: 1 })
    expect(run.asked).toEqual([BE_IMPROVER_ASKED])
  })

  test('a dismissed question, or three answers it cannot read, keeps the original with a reply warning', async () => {
    const answerSets: readonly (readonly string[])[] = [[], ['maybe', 'perhaps', 'later']]
    for (const answers of answerSets) {
      const disk = builtDisk()
      const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, { [BE_TEXT_FILE]: BE_IMPROVED }]]))
      const outcome = await improveBuiltFiles(diskIo(disk, answers).io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
      expect(outcome).toEqual({
        restores: [BE_PRIVATE_FILE],
        warnings: [improverDismissedWarning(BE_TEXT_SHOWN)],
        changed: 0,
        total: 1,
      })
    }
    expect(improverDismissedWarning(BE_TEXT_SHOWN)).toBe(
      `the improver question for ${BE_TEXT_SHOWN} was dismissed: the file stays as built`,
    )
  })

  test('a run that could not start, exited non-zero or timed out leaves the file as built, with a note', async () => {
    const cases: readonly (readonly [HostRun | null, number, string])[] = [
      [null, 0, 'it could not start'],
      [{ exitCode: 2, stdout: '', stderr: 'boom' }, 0, 'it exited with 2'],
      [null, IMPROVER_TIMEOUT_MS, 'it timed out'],
    ]
    for (const [result, stepMs, reason] of cases) {
      const disk = builtDisk()
      const { io } = editingHost(disk, new Map(), [beRun(result)])
      const run = diskIo(disk)
      const outcome = await improveBuiltFiles(tickingClock(run.io, stepMs), io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
      expect(outcome).toEqual({ restores: [], warnings: [], changed: 0, total: 1 })
      expect([reason, run.logged]).toEqual([reason, [improverFailedNote(BE_TEXT_SHOWN, reason)]])
      expect(run.asked).toEqual([])
    }
    expect(improverFailedNote(BE_TEXT_SHOWN, 'it timed out')).toBe(
      `the improver did not run for ${BE_TEXT_SHOWN} (it timed out): the file stays as built`,
    )
    expect([improverFailure(null, null), improverFailure({ exitCode: 0, stdout: '', stderr: '' }, 0)]).toEqual([
      'it could not start',
      null,
    ])
    expect(improverFailure(null, IMPROVER_TIMEOUT_MS - 1)).toBe('it could not start')
  })

  test('a failed run that changed its file anyway has it written back as built, asking nothing', async () => {
    const disk = builtDisk()
    const failed = beRun({ exitCode: 1, stdout: '', stderr: '' })
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, { [BE_TEXT_FILE]: BE_IMPROVED }]]), [failed])
    const run = diskIo(disk)
    const outcome = await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    expect(outcome).toEqual({ restores: [BE_PRIVATE_FILE], warnings: [], changed: 0, total: 1 })
    expect(run.logged).toEqual([improverFailedNote(BE_TEXT_SHOWN, 'it exited with 1')])
    expect(run.asked).toEqual([])
  })

  test('a file the improver removed or left as a link cannot be reviewed: it is written back as built', async () => {
    const removed = builtDisk()
    const gone = editingHost(removed, new Map([[BE_TEXT_FILE, { [BE_TEXT_FILE]: null }]]))
    const run = diskIo(removed)
    expect(await improveBuiltFiles(run.io, gone.io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)).toEqual({
      restores: [BE_PRIVATE_FILE],
      warnings: [],
      changed: 0,
      total: 1,
    })
    expect(run.logged).toEqual([improverUnreadableNote(BE_TEXT_SHOWN)])
    expect(improverUnreadableNote(BE_TEXT_SHOWN)).toBe(
      `the improver left ${BE_TEXT_SHOWN} unreadable: it is written back as built`,
    )
    // The improver leaves a link to another file where the built file was: it is never read or diffed.
    const linked = builtDisk()
    const realPaths: Record<string, string> = {}
    const host = memHost(hostWorld({}))
    const linking: HostIo = {
      ...host.io,
      run: async (argv, options) => {
        realPaths[BE_TEXT_FILE] = '/home/u/.zshrc'

        return host.io.run(argv, options)
      },
    }
    const linkRun = memIo(memWorld({ files: linked.files, dirs: linked.dirs, realPaths }), {})
    const outcome = await improveBuiltFiles(linkRun.io, linking, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    const builtReads = linkRun.reads.filter(path => path === BE_TEXT_FILE)
    expect([outcome.restores, linkRun.asked, builtReads]).toEqual([[BE_PRIVATE_FILE], [], [BE_TEXT_FILE]])
    // The note is one logged line and no block of its own (D-325).
    expect([linkRun.logged, linkRun.shown]).toEqual([[improverUnreadableNote(BE_TEXT_SHOWN)], []])
  })

  test('a private file is named from the home folder, and its accepted change counts', async () => {
    const disk = builtDisk()
    const improved = `${SECURITY_BUILT_FILE.text}Rotate keys every month.\n`
    const { io } = editingHost(disk, new Map([[SECURITY_TEXT_FILE, { [SECURITY_TEXT_FILE]: improved }]]))
    const run = diskIo(disk, { "Accept the improver's changes": 'Accept' })
    const outcome = await improveBuiltFiles(run.io, io, [SECURITY_BUILT_FILE], DEFAULT_LOCATIONS)
    expect(outcome).toEqual({ restores: [], warnings: [], changed: 1, total: 1 })
    const context = improverContextLine(lineDiff(SECURITY_BUILT_FILE.text, improved))
    expect(run.asked).toEqual([withContext(improverQuestion(SECURITY_SHOWN), context)])
    expect(improverQuestion(SECURITY_SHOWN)).toBe(`Accept the improver's changes to ${SECURITY_SHOWN}?`)
    expect(improverContextLine(lineDiff('a\n', 'b\n'))).toBe('1 line added, 1 removed; the pane shows the diff.')
  })

  test('restoreSteps writes a private file in its role memory folder', () => {
    expect(restoreSteps([SECURITY_BUILT_FILE])).toEqual([
      { kind: 'private', path: SECURITY_DIR, files: [{ path: SECURITY_TEXT_FILE, text: SECURITY_BUILT_FILE.text }] },
    ])
    expect(restoreSteps([])).toEqual([])
  })

  test('the built files are the private text files with a global part', () => {
    const header = '<!-- header -->\n'
    const steps: ApplyStep[] = [
      { kind: 'write', path: '.cadre/be/CLAUDE.md', text: header },
      { kind: 'write', path: '.cadre/be/ROLE.md', text: 'role\n' },
      { kind: 'write', path: '.cadre/fe/CLAUDE.md', text: header },
      { kind: 'write', path: '.cadre/be/CLAUDE.md.cadre-new', text: header },
      {
        kind: 'private',
        path: SECURITY_DIR,
        files: [
          { path: SECURITY_TEXT_FILE, text: SECURITY_BUILT_FILE.text },
          { path: SECURITY_RECORD, text: '{}\n' },
        ],
      },
      { kind: 'private', path: TL_DIR, files: [{ path: `${TL_DIR}/instructions.json`, text: '{}\n' }] },
      { kind: 'manifest', path: MANIFEST_PATH, text: '{}\n' },
    ]
    const filter: BuiltFilter = { privateFolders: new Set([SECURITY_DIR]) }
    expect(builtRoleFiles(steps, filter)).toEqual([SECURITY_BUILT_FILE])
  })

  test('a private text file is offered only when its folder is named: a header alone is not (02-GAPS-B3 C1)', () => {
    const pmDir = `${SLUG_DIR}/pm`
    const headerOnly = { path: `${pmDir}/instructions/CLAUDE.md`, text: privateClaudeMdText('pm', 'repo', []) }
    const steps: ApplyStep[] = [
      { kind: 'private', path: pmDir, files: [headerOnly, { path: `${pmDir}/instructions.json`, text: '{}\n' }] },
    ]
    expect(builtRoleFiles(steps, { privateFolders: new Set() })).toEqual([])
    expect(builtRoleFiles(steps, { privateFolders: new Set([pmDir]) })).toEqual([headerOnly])
  })

  test('the reply line counts the built files changed and accepted, of all the pass ran for', () => {
    expect(improverLine({ changed: 1, total: 2 })).toBe('Improver: 1 of 2 built files changed and accepted.')
    expect(improverLine({ changed: 0, total: 1 })).toBe('Improver: 0 of 1 built files changed and accepted.')
  })
})

/** A path below BE's instructions/ folder, by its path there. */
function beFile(name: string): string {
  return `${BE_FOLDER}/${name}`
}

/** A path below BE's instructions/ folder as the pass shows it, from the home folder. */
function beShown(name: string): string {
  return `${BE_FOLDER_SHOWN}/${name}`
}

/** builtDisk with more files in BE's instructions/ folder: rules.md, style.md and team.md beside its text file. */
function instructionsDisk(): Disk {
  const disk = builtDisk()
  for (const [name, content] of [['rules.md', '# Rules\n'], ['style.md', 'Use tabs.\n'], ['team.md', 'The team.\n']]) {
    applyEdit(disk, beFile(name ?? ''), content ?? '')
  }

  return disk
}

/**
 * The other-files rows of the improver pass, from their heading on, each one a shown path: in the context of the
 * per-file question when one was asked, else in the notes it logged (D-302).
 */
function otherRows(run: MemRun): readonly string[] {
  const lines = run.specs.findLast(spec => spec.context?.kind === 'improver')?.context?.lines ?? run.logged
  const at = lines.findIndex(line => line.startsWith('Other files changed by the improver in '))

  return at < 0 ? [] : lines.slice(at)
}

describe('improver other changes (G-02-1f, D-141)', () => {
  test('one other file changed, one added and one removed are named in the block and in a reply warning', async () => {
    const disk = instructionsDisk()
    const edits = {
      [BE_TEXT_FILE]: BE_IMPROVED,
      [beFile('style.md')]: 'Use spaces.\n',
      [beFile('rules.md')]: null,
      [beFile('notes.md')]: 'a note\n',
    }
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, edits]]))
    const run = diskIo(disk, { "Accept the improver's changes": 'Accept' })
    const outcome = await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    const others = [beShown('notes.md'), beShown('rules.md'), beShown('style.md')]
    expect(outcome.warnings).toEqual([
      `the improver also changed 3 other files in ${BE_FOLDER_SHOWN}: ${others.join(', ')}; ` +
        'review them (listed above)',
    ])
    expect(outcome.warnings).toEqual([otherChangesWarning(BE_FOLDER_SHOWN, others)])
    expect(otherRows(run)).toEqual(otherFilesLines(BE_FOLDER_SHOWN, others))
    expect(otherFilesLines(BE_FOLDER_SHOWN, others)).toEqual([
      `Other files changed by the improver in ${BE_FOLDER_SHOWN}:`,
      ...others.map(path => `  ${path}`),
    ])
    expect(run.specs.at(-1)?.context?.lines.slice(0, 1)).toEqual([`${BE_TEXT_SHOWN}: 2 lines added, 1 removed`])
    expect([outcome.changed, outcome.restores]).toEqual([1, []])
    expect(disk.files[beFile('style.md')]).toBe('Use spaces.\n')
  })

  test('past three other files the warning counts the rest, while the block names every one', async () => {
    const disk = instructionsDisk()
    const names = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md']
    const edits = Object.fromEntries(names.map(name => [beFile(name), `${name}\n`]))
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, edits]]))
    const run = diskIo(disk)
    const outcome = await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    const named = names.slice(0, 3).map(beShown).join(', ')
    expect(outcome.warnings).toEqual([
      `the improver also changed 5 other files in ${BE_FOLDER_SHOWN}: ${named}, +2 more; review them (listed above)`,
    ])
    expect(otherRows(run)).toHaveLength(6)
    expect(otherChangesWarning(BE_FOLDER_SHOWN, [beShown('a.md')])).toBe(
      `the improver also changed 1 other file in ${BE_FOLDER_SHOWN}: ${beShown('a.md')}; review them (listed above)`,
    )
    expect(otherFilesLines(BE_FOLDER_SHOWN, [])).toEqual([])
  })

  test('other changes are reported when the built file is unchanged or the run failed; none is undone', async () => {
    const results: readonly (HostRun | null)[] = [
      null,
      { exitCode: 1, stdout: '', stderr: '' },
      { exitCode: 0, stdout: '', stderr: '' },
    ]
    for (const result of results) {
      const disk = instructionsDisk()
      const edits = { [beFile('style.md')]: 'Use spaces.\n' }
      const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, edits]]), [beRun(result)])
      const run = diskIo(disk)
      const outcome = await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
      expect(outcome).toEqual({
        restores: [],
        warnings: [otherChangesWarning(BE_FOLDER_SHOWN, [beShown('style.md')])],
        changed: 0,
        total: 1,
      })
      const improver = run.shown.filter(block => block.key === 'improver')
      expect([improver, otherRows(run)]).toEqual([[], otherFilesLines(BE_FOLDER_SHOWN, [beShown('style.md')])])
      expect(run.asked).toEqual([])
    }
  })

  test('four sub-folder levels are listed, a file link is read, a last-level folder is only marked', async () => {
    const disk = instructionsDisk()
    const sub = beFile('sub')
    const deep = `${sub}/inner/deep`
    applyEdit(disk, `${sub}/stamp`, '1\n')
    applyEdit(disk, `${deep}/x.md`, 'deep\n')
    applyEdit(disk, `${deep}/a/b/y.md`, 'deeper\n')
    disk.files[`${sub}/inner/notes.md`] = 'linked memory\n'
    disk.dirs[BE_FOLDER] = [...(disk.dirs[BE_FOLDER] ?? []), entry('sub', 'dir')]
    disk.dirs[sub] = [...(disk.dirs[sub] ?? []), entry('inner', 'dir')]
    disk.dirs[`${sub}/inner`] = [link('notes.md'), link('shared'), entry('deep', 'dir')]
    disk.dirs[deep] = [entry('x.md'), entry('a', 'dir')]
    disk.dirs[`${deep}/a`] = [entry('b', 'dir')]
    const edits = {
      [`${sub}/stamp`]: '2\n',
      [`${sub}/inner/notes.md`]: 'linked memory, edited\n',
      [`${deep}/x.md`]: 'deep, edited\n',
      [`${deep}/a/b/y.md`]: 'deeper, edited\n',
    }
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, edits]]))
    const run = diskIo(disk)
    const outcome = await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    const others = [beShown('sub/inner/deep/x.md'), beShown('sub/inner/notes.md'), beShown('sub/stamp')]
    expect(outcome.warnings).toEqual([otherChangesWarning(BE_FOLDER_SHOWN, others)])
    expect(run.listed.filter(path => path.endsWith('/shared') || path.endsWith('/notes.md'))).toEqual([])
    expect(run.listed.filter(path => path === `${deep}/a/b`)).toHaveLength(2)
    expect(run.reads).not.toContain(`${deep}/a/b/y.md`)
    expect(run.listed.filter(path => path === `${sub}/inner`)).toHaveLength(2)
  })

  test('a file that cannot be read after the run counts as changed; one unreadable both times does not', async () => {
    const disk = instructionsDisk()
    const unknownPaths: string[] = [beFile('team.md')]
    const host = memHost(hostWorld({}))
    const breaking: HostIo = {
      ...host.io,
      run: async (argv, options) => {
        unknownPaths.push(beFile('style.md'))

        return host.io.run(argv, options)
      },
    }
    const run = memIo(memWorld({ files: disk.files, dirs: disk.dirs, unknownPaths }), {})
    const outcome = await improveBuiltFiles(run.io, breaking, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    expect(outcome.warnings).toEqual([otherChangesWarning(BE_FOLDER_SHOWN, [beShown('style.md')])])
  })

  test('past 200 files the rest are counted and reported as not checked; only 200 are read per look', async () => {
    const disk = builtDisk()
    const names = Array.from({ length: 205 }, (_, at) => `f${String(at).padStart(3, '0')}.md`)
    for (const name of names) applyEdit(disk, beFile(name), `${name}\n`)
    const edits = { [beFile('f204.md')]: 'changed past the cap\n', [beFile('a-new.md')]: 'new\n' }
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, edits]]))
    const run = diskIo(disk)
    const outcome = await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    // f199 to f204 lie past the first 200 files of one look or the other: their change is not checked.
    expect(outcome.warnings).toEqual([
      otherChangesWarning(BE_FOLDER_SHOWN, [beShown('a-new.md')]),
      uncheckedFilesWarning(6, BE_FOLDER_SHOWN),
    ])
    expect(uncheckedFilesWarning(6, BE_FOLDER_SHOWN)).toBe(`6 files in ${BE_FOLDER_SHOWN} were not checked`)
    expect(uncheckedFilesWarning(1, BE_FOLDER_SHOWN)).toBe(`1 file in ${BE_FOLDER_SHOWN} was not checked`)
    const folderReads = run.reads.filter(path => path.startsWith(`${BE_FOLDER}/`) && path !== BE_TEXT_FILE)
    expect(folderReads).toHaveLength(400)
  })

  test('a private run reports a file added in its instructions/ folder, named from the home folder', async () => {
    const disk = builtDisk()
    const added = `${SECURITY_DIR}/instructions/notes.md`
    const { io } = editingHost(disk, new Map([[SECURITY_TEXT_FILE, { [added]: 'a note\n' }]]))
    const outcome = await improveBuiltFiles(diskIo(disk).io, io, [SECURITY_BUILT_FILE], DEFAULT_LOCATIONS)
    const folder = '~/.claude/cadre/repo-1a2b3c4d/security/instructions'
    expect(outcome.warnings).toEqual([otherChangesWarning(folder, [`${folder}/notes.md`])])
  })

  test("the improver question's context holds the other changed files after the diff (WD-M3, T-02-75)", async () => {
    const disk = instructionsDisk()
    const edits = { [BE_TEXT_FILE]: BE_IMPROVED, [beFile('style.md')]: 'Use spaces.\n' }
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, edits]]))
    const run = diskIo(disk, { "Accept the improver's changes": 'Accept' })
    await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    const diff = improverBlockLines(BE_TEXT_SHOWN, lineDiff(BE_BUILT, BE_IMPROVED))
    const others = otherFilesLines(BE_FOLDER_SHOWN, [beShown('style.md')])
    expect(run.specs.map(spec => spec.context?.lines)).toEqual([[...diff, ...others]])
  })

  test('a run that changed only other files logs each other-file row, for the TUI default (WD-M3)', async () => {
    const disk = instructionsDisk()
    const edits = { [beFile('style.md')]: 'Use spaces.\n' }
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, edits]]))
    const run = diskIo(disk)
    await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    const rows = otherFilesLines(BE_FOLDER_SHOWN, [beShown('style.md')])
    expect(run.logged.slice(-rows.length)).toEqual(rows)
  })

  test("#18: an unchanged file's other-file rows are one note each, once, and no block (D-302, D-325)", async () => {
    const disk = instructionsDisk()
    const edits = { [beFile('style.md')]: 'Use spaces.\n', [beFile('notes.md')]: 'a note\n' }
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, edits]]))
    const run = diskIo(disk)
    await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    const rows = otherFilesLines(BE_FOLDER_SHOWN, [beShown('notes.md'), beShown('style.md')])
    expect(rows.map(row => run.logged.filter(line => line === row).length)).toEqual(rows.map(() => 1))
    expect(run.shown).toEqual([])
  })

  test('a run with no other change adds no warning and no other-files rows', async () => {
    const disk = instructionsDisk()
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, { [BE_TEXT_FILE]: BE_IMPROVED }]]))
    const run = diskIo(disk, { "Accept the improver's changes": 'Accept' })
    const outcome = await improveBuiltFiles(run.io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    expect([outcome.warnings, otherRows(run)]).toEqual([[], []])
    expect(run.reads.filter(path => path === beFile('style.md'))).toHaveLength(2)
  })
})

/** A folder four levels below BE's instructions/ folder. */
const BE_DEEP = beFile('a/b/c/d')

/** instructionsDisk with the folders below BE's instructions/ folder down to BE_DEEP, which lists these entries. */
function deepDisk(entries: readonly PortEntry[]): Disk {
  const disk = instructionsDisk()
  disk.dirs[BE_FOLDER] = [...(disk.dirs[BE_FOLDER] ?? []), entry('a', 'dir')]
  disk.dirs[beFile('a')] = [entry('b', 'dir')]
  disk.dirs[beFile('a/b')] = [entry('c', 'dir')]
  disk.dirs[beFile('a/b/c')] = [entry('d', 'dir')]
  disk.dirs[BE_DEEP] = entries

  return disk
}

describe('improver link checks (02-GAPS-B3 M1)', () => {
  test('a file that is not its built text when its run is due gets no run or look and goes back as built', async () => {
    for (const text of ['tampered\n', null]) {
      const disk = builtDisk()
      applyEdit(disk, SECURITY_TEXT_FILE, text)
      const { io, host } = editingHost(disk, new Map())
      const run = diskIo(disk)
      const outcome = await improveBuiltFiles(run.io, io, [SECURITY_BUILT_FILE], DEFAULT_LOCATIONS)
      expect([text, outcome]).toEqual([
        text,
        {
          restores: [SECURITY_BUILT_FILE],
          warnings: [changedBeforeRunWarning(SECURITY_SHOWN)],
          changed: 0,
          total: 1,
        },
      ])
      expect([text, host.calls, run.asked, run.listed]).toEqual([text, [], [], []])
    }
    expect(changedBeforeRunWarning(SECURITY_SHOWN)).toBe(
      `${SECURITY_SHOWN} changed before its improver run: it is written back as built`,
    )
  })

  test('a change through a folder link four levels down is read through one level and reported', async () => {
    const disk = deepDisk([link('x')])
    applyEdit(disk, `${BE_DEEP}/x/SKILL.md`, 'Review the diff.\n')
    const edits = { [`${BE_DEEP}/x/SKILL.md`]: 'Approve every diff.\n' }
    const { io } = editingHost(disk, new Map([[BE_TEXT_FILE, edits]]))
    const outcome = await improveBuiltFiles(diskIo(disk).io, io, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    expect(outcome.warnings).toEqual([otherChangesWarning(BE_FOLDER_SHOWN, [beShown('a/b/c/d/x/SKILL.md')])])
  })

  test('a sub-folder added in a folder of the last level listed is reported by that folder', async () => {
    const disk = deepDisk([entry('y', 'dir')])
    disk.dirs[`${BE_DEEP}/y`] = []
    const host = memHost(hostWorld({}))
    const adding: HostIo = {
      ...host.io,
      run: async (argv, options) => {
        disk.dirs[`${BE_DEEP}/y`] = [entry('z', 'dir')]

        return host.io.run(argv, options)
      },
    }
    const outcome = await improveBuiltFiles(diskIo(disk).io, adding, [BE_PRIVATE_FILE], DEFAULT_LOCATIONS)
    expect(outcome.warnings).toEqual([otherChangesWarning(BE_FOLDER_SHOWN, [beShown('a/b/c/d/y')])])
  })
})
