import { describe, expect, test } from 'claude-code/testing'

import type { Facts, FrameworkId } from '../types'
import { helpText, USAGE_LINES } from './command/usage'
import { detectText } from './detect/report'
import { ADAPTERS } from './framework/registry'
import { desiredFiles } from './generate/files'
import { GOLDEN_DETECT } from './golden/detect'
import { GOLDEN_EPIC } from './golden/epic'
import { GOLDEN_START } from './golden/start'
import { GOLDEN_STATUS } from './golden/status'
import { inputOf, TEMPLATE_ROLES } from './golden/worlds'
import { MODEL_EFFORT_OPTIONS } from './init/answers'
import { runInit } from './init/run'
import { ROLES_QUESTION } from './init/stages/roles'
import { ARTIFACT } from './locales/artifact'
import { CONTRACTS, ITERM_LINES, TERMINAL_APP_LINES } from './locales/contracts'
import { EN } from './locales/en'
import { MCP_SYSTEM, PROMPTS, RECOMMEND_SYSTEM, REGEN_RECOMMEND_SYSTEM, SKILLS_SYSTEM } from './locales/prompts'
import { DRY_RUN_NOTE } from './plan/text'
import { INSTALL_COMMANDS } from './roles/recommend'
import { PROPOSE_SYSTEM } from './suggest/propose'
import { TOPICS_SYSTEM } from './suggest/topics'
import { EMPTY_FACTS, entry, INIT_ANSWERS, memIo, memWorld } from './testkit'
import type { MemRun, MemWorld } from './testkit'
import { withContext } from './ui/ask'

/** What user text may never hold: the name of an internal planning phase, such as `Phase 3.1` (G-02-3b). */
const PHASE_NAME = /Phase \d/

/** How many arrays and plain objects deep the walk reads a value: a string four levels down is still read. */
const MAX_DEPTH = 4

/** Whether a value is a plain object: an object literal or a frozen one, never an array, a map or a class instance. */
function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false
  const prototype: unknown = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

/**
 * Every string a value holds: the value itself when it is a string, else each string in its arrays and plain objects,
 * down to MAX_DEPTH levels. Numbers, booleans, functions, patterns and maps hold none.
 */
function stringsOf(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value]
  if (depth === MAX_DEPTH) return []
  if (Array.isArray(value)) return value.flatMap(item => stringsOf(item, depth + 1))
  if (!isPlainObject(value)) return []

  return Object.values(value).flatMap(item => stringsOf(item, depth + 1))
}

/**
 * Every table text and the listed survivors (D-207, D-221): one row per locale table (the screen texts, the
 * generated-file texts, the model prompts with the six system prompts, and the on-disk and protocol markers with the
 * AppleScript lines), then a fifth row of the texts kept outside the tables.
 */
const TEXTS: readonly (readonly [string, string, unknown])[] = [
  ['locales/en', 'EN', EN],
  ['locales/artifact', 'ARTIFACT', ARTIFACT],
  [
    'locales/prompts',
    'PROMPTS',
    [PROMPTS, PROPOSE_SYSTEM, TOPICS_SYSTEM, SKILLS_SYSTEM, MCP_SYSTEM, RECOMMEND_SYSTEM, REGEN_RECOMMEND_SYSTEM],
  ],
  ['locales/contracts', 'CONTRACTS', [CONTRACTS, TERMINAL_APP_LINES, ITERM_LINES]],
  // The texts kept outside the tables (WE-S7). The walk skips functions, so each adapter's roleStart is walked as
  // called. register.tsx's argument hint is not walked: register.tsx imports the engine, which typecheck:cadre cannot
  // load.
  [
    'outside locales',
    'kept',
    [
      ADAPTERS,
      ADAPTERS.map(adapter => adapter.roleStart('x')),
      INSTALL_COMMANDS,
      MODEL_EFFORT_OPTIONS,
      USAGE_LINES,
      helpText('x'),
      detectText(EMPTY_FACTS, true),
    ],
  ],
]

/** A git repo at /repo, which init runs in; `over` changes the fields it names. */
function gitWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ dirs: { '/repo/.git': [] }, ...over })
}

/** The session folder of the fixture repo /repo for the fixture user /home/u. */
const HISTORY_DIR = '/home/u/.claude/projects/-repo'

/** A git repo at /repo with one session transcript, which runs /gsd-plan-phase. */
function historyWorld(): MemWorld {
  return gitWorld({
    dirs: { '/repo/.git': [], [HISTORY_DIR]: [{ ...entry('a.jsonl'), mtimeMs: 1 }] },
    files: { [`${HISTORY_DIR}/a.jsonl`]: '<command-name>/gsd-plan-phase</command-name>' },
  })
}

/** Facts with GSD (.planning/) and superpowers (docs/superpowers/) both in use, so the framework question is asked. */
const BOTH_IN_USE: Facts = {
  ...EMPTY_FACTS,
  repoEntries: [
    { name: '.planning', kind: 'dir', isLink: false },
    { name: 'docs', kind: 'dir', isLink: false },
  ],
  docsEntries: [{ name: 'superpowers', kind: 'dir', isLink: false }],
}

/** The model's roles for a typed description: BE (be) and Docs (docs), so the roles question is asked about them. */
const DESCRIBED_REPLY =
  '{"roles":[{"id":"be","title":"BE","purpose":"API","basedOn":"be"},' +
  '{"id":"docs","title":"Docs","purpose":"docs","basedOn":null}]}'

/** A line of each init text that is not exported, so not in TEXTS: the env pane heading and each refusal's accepts. */
const PRIVATE_FRAGMENTS: readonly string[] = [
  'Env variable names in your settings',
  "isn't one of: definitions, all, ignore",
  'a description of your roles',
  ' - a role runs one framework',
  'a duration such as 4h',
  'or role ids from: ',
  'or names from the list, typed exactly',
  '(or type git root, in here or other)',
  'or duration, model, assignments, memory, env, hunks',
]

/**
 * Every text a run put before the person: each question asked, each option and chip of its dialog, the title, summary
 * and lines of each question's own context, which hold what side-pane blocks showed (D-302), each logged line, each
 * side-pane title and line, and the reply.
 */
function runTexts(run: MemRun, reply: string): string[] {
  return [
    ...run.asked,
    ...run.specs.flatMap(spec => [...spec.options, ...(spec.header === undefined ? [] : [spec.header])]),
    ...run.specs.flatMap(({ context }) =>
      context === undefined ? [] : [context.title, context.summary, ...context.lines],
    ),
    ...run.logged,
    ...run.shown.flatMap(block => [block.title, ...block.lines]),
    reply,
  ]
}

/**
 * The static pieces of the EN texts, 12 characters or more once trimmed, that no ARTIFACT, PROMPTS or CONTRACTS text
 * holds. Generated text is ARTIFACT or PROMPTS (D-221), so an EN text in a hashed file breaks on the first translation
 * (WE-M1).
 */
const EN_ONLY_PIECES: readonly string[] = Object.values(EN)
  .flatMap(template => template.split(/\{[a-zA-Z]+\}/))
  .map(piece => piece.trim())
  .filter(piece => piece.length >= 12)
  .filter(piece => {
    const tables = [ARTIFACT, PROMPTS, CONTRACTS]

    return !tables.some(table => Object.values(table).some(text => text.includes(piece)))
  })

describe('user text names no internal phase (G-02-3b)', () => {
  test('a phase name is the word Phase and a number, as in (Phase 3.1) or the Phase 2 repo scan', () => {
    const texts = ['(Phase 3.1)', 'the Phase 2 repo scan', 'phase 2', 'Phase two', 'Phases']
    expect(texts.map(text => PHASE_NAME.test(text))).toEqual([true, true, false, false, false])
  })

  test('the walk reads every string in arrays and plain objects, four levels down and no deeper', () => {
    expect(stringsOf({ a: 'x', b: [{ c: 'y' }], d: 3, e: null, f: () => 'z', g: /Phase 1/ })).toEqual(['x', 'y'])
    expect(stringsOf([[[['four']]]])).toEqual(['four'])
    expect(stringsOf([[[[['five']]]]])).toEqual([])
    expect(stringsOf(new Map([['k', 'v']]))).toEqual([])
  })

  test('every row of the table holds text the walk can read', () => {
    const empty = TEXTS.filter(([, , value]) => stringsOf(value).length === 0)
    expect(empty.map(([module, name]) => `${module} ${name}`)).toEqual([])
  })

  test('no exported user text names a phase', () => {
    const named = TEXTS.flatMap(([module, name, value]) =>
      stringsOf(value)
        .flatMap(text => text.split('\n'))
        .filter(line => PHASE_NAME.test(line))
        .map(line => `${module} ${name}: ${line}`),
    )
    expect(named).toEqual([])
  })

  test('every start, status, epic and detect golden names no phase', () => {
    const goldens: readonly (readonly [string, unknown])[] = [
      ...Object.entries(GOLDEN_START),
      ...Object.entries(GOLDEN_STATUS),
      ...Object.entries(GOLDEN_EPIC),
      ...Object.entries(GOLDEN_DETECT),
    ]
    const named = goldens.filter(([, value]) => PHASE_NAME.test(JSON.stringify(value))).map(([name]) => name)
    expect(named).toEqual([])
  })

  test('a full dry run with the INIT_ANSWERS defaults asks, logs, shows and replies with no phase name', async () => {
    const run = memIo(gitWorld(), INIT_ANSWERS)
    const reply = await runInit(run.io, { dryRun: true })
    expect(run.shown).toEqual([])
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(runTexts(run, reply).filter(text => PHASE_NAME.test(text))).toEqual([])
  })

  test('a dry run with the history question answered Yes, on a repo with one session, names no phase', async () => {
    const answers = { ...INIT_ANSWERS, "Scan this repo's session history": 'Yes, scan names and counts' }
    const run = memIo(historyWorld(), answers)
    const reply = await runInit(run.io, { dryRun: true })
    expect(run.shown).toEqual([])
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(runTexts(run, reply).filter(text => PHASE_NAME.test(text))).toEqual([])
  })

  // The env pane heading and the refusal accepts are private to init.ts, so not in TEXTS: only a run reaches them.
  test('a dry run with one unreadable answer per kind of question names no phase in its private texts', async () => {
    const world = gitWorld({
      facts: { facts: BOTH_IN_USE, gsdUserDir: null },
      settings: { user: { env: { API_KEY: 'x' } }, project: {}, local: {} },
      tools: [{ name: 'mcp__sentry__issues', description: 'Sentry issues', mcp: true }],
      replies: [DESCRIBED_REPLY],
    })
    const answers = {
      ...INIT_ANSWERS,
      'Use these roles?': 'Describe my own structure',
      [withContext(ROLES_QUESTION, 'Proposed: BE (be)')]: 'Use these roles',
      'Describe your role structure': ' ',
      "An empty answer isn't one of": 'we have a BE and a docs writer',
      'Framework for': 'zz-framework',
      "'zz-framework' isn't one of": 'GSD',
      'Autopilot duration': 'zz-duration',
      "'zz-duration' isn't one of": '4h',
      'Which roles get': 'zz-assign',
      "'zz-assign' isn't one of": 'None',
      'Which env variables': 'zz-env',
      "'zz-env' isn't one of": 'None',
      'Git policy': 'zz-git',
      "'zz-git' isn't one of": 'Commit definitions (default)',
      'Where should the role launchers start': 'zz-launch',
      "'zz-launch' isn't one of": 'Git root of this repo',
      'Review the plan': 'zz-review',
      "'zz-review' isn't one of": 'Confirm',
    }
    const run = memIo(world, answers)
    const reply = await runInit(run.io, { dryRun: true })
    expect(run.specs.map(spec => spec.context?.kind)).toContain('env')
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(runTexts(run, reply).filter(text => PHASE_NAME.test(text))).toEqual([])
    const lines = runTexts(run, reply).flatMap(text => text.split('\n'))
    expect(PRIVATE_FRAGMENTS.filter(fragment => !lines.some(line => line.includes(fragment)))).toEqual([])
  })
})

describe('generated files hold no screen text (D-221)', () => {
  test('no generated file of the golden teams holds an EN-only text (WE-M1)', () => {
    const frameworks: readonly FrameworkId[] = ['none', 'gsd']
    const found = frameworks.flatMap(framework =>
      desiredFiles(inputOf(TEMPLATE_ROLES, framework)).flatMap(file => {
        const pieces = EN_ONLY_PIECES.filter(piece => file.content.includes(piece))

        return pieces.map(piece => `${framework} ${file.path}: ${piece}`)
      }),
    )

    expect(found).toEqual([])
  })
})
