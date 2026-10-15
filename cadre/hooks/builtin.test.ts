import { describe, expect, test } from 'claude-code/testing'

import type { Detection, Facts, RepoEntry } from '../types'
import { gateProblems, missingFields } from './framework'
import { BUILTIN_ADAPTER, BUILTIN_GATES, builtinKickoffText, detectBuiltin } from './builtin'

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

/** The built-in fallback's detection: always installed, and built into cadre rather than found in the repo. */
const BUILT_IN: Detection = {
  id: 'none',
  name: 'built-in',
  status: 'installed',
  version: null,
  evidence: ['built into cadre'],
}

/** The text that follows the role folder on the first kickoff line. */
const ROLE_LINE_TAIL = ' role. This repo has no dev framework: work in plan, execute, verify steps.'

/** The last line of every built-in kickoff for the BE role: the DONE marker, then the AUTOPILOT_DONE answer. */
const BE_DONE_LINE =
  'Write .cadre/be/.runtime/DONE.md with what you did and how you verified it, ' +
  'then answer with a line that starts with AUTOPILOT_DONE.'

/** The kickoff text of a role, split into lines. A spec path is optional. */
function kickoffLines(role: string, specPath: string | null = null): string[] {
  return builtinKickoffText({ role, specPath }).split('\n')
}

/** The first kickoff line for a role name, which a hostile role name tries to lengthen or split. */
function roleLine(role: string): string {
  return kickoffLines(role)[0]
}

/** The Spec line for a spec path, or undefined when the kickoff has none. */
function specLine(specPath: string): string | undefined {
  return kickoffLines('BE', specPath).find(line => line.startsWith('Spec:'))
}

describe('detectBuiltin', () => {
  test('the built-in adapter is always installed, built into cadre, with no version', () => {
    expect(detectBuiltin(facts({}))).toEqual(BUILT_IN)
  })

  test('it ignores the repo, so a repo with a framework in use is still installed', () => {
    const planning: RepoEntry = { name: '.planning', kind: 'dir', isLink: false }

    expect(detectBuiltin(facts({ repoEntries: [planning] }))).toEqual(BUILT_IN)
  })
})

describe('BUILTIN_GATES', () => {
  test('the two gate rows match the plan verbatim, in order', () => {
    expect(BUILTIN_GATES).toEqual([
      {
        id: 'exit-plan-mode',
        where: 'ExitPlanMode',
        kind: 'standing-rule',
        decisionType: null,
        needsHuman: false,
        handling: 'standing-rule',
        kickoff: 'Never call ExitPlanMode (it waits for a human); write the plan file instead.',
      },
      {
        id: 'role-questions',
        where: 'any open question',
        kind: 'chat',
        decisionType: 'Arch',
        needsHuman: false,
        handling: 'escalate',
        kickoff:
          'Send each question to its owner role by type (Product to PM, Arch and QA to TL, Security to Security); ' +
          'do not ask the human directly.',
      },
    ])
  })

  test('the exit-plan-mode kickoff forbids ExitPlanMode', () => {
    expect(BUILTIN_GATES[0].kickoff).toContain('Never call ExitPlanMode')
  })

  test('the gate table has no problems under the framework gate contract', () => {
    expect(gateProblems(BUILTIN_GATES)).toEqual([])
  })
})

describe('builtinKickoffText', () => {
  test('the role line names the role folder, lowercased', () => {
    expect(roleLine('BE')).toBe(`You are the be${ROLE_LINE_TAIL}`)
  })

  test('it writes the plan to the role runtime folder, then executes it with subagents', () => {
    expect(kickoffLines('BE')).toContain(
      'Write your plan to .cadre/be/.runtime/plan.md, then execute it with subagents.',
    )
  })

  test("it verifies with the project's own commands and a reviewer subagent", () => {
    expect(kickoffLines('BE')).toContain(
      "Verify with the project's own test and lint commands and a reviewer subagent.",
    )
  })

  test('a spec path adds one Spec line, and no spec adds none', () => {
    expect(specLine('x.md')).toBe('Spec: x.md')
    expect(kickoffLines('BE', null).filter(line => line.startsWith('Spec:'))).toEqual([])
  })

  test('a spec path that is blank once cleaned adds no Spec line', () => {
    const lines = kickoffLines('BE', '\u{200B} \n')

    expect(lines).toContain('Write your plan to .cadre/be/.runtime/plan.md, then execute it with subagents.')
    expect(lines.filter(line => line.startsWith('Spec:'))).toEqual([])
  })

  test('its last line is the DONE answer, with no trailing newline', () => {
    const lines = kickoffLines('BE')

    expect(lines[lines.length - 1]).toBe(BE_DONE_LINE)
    expect(builtinKickoffText({ role: 'BE', specPath: null }).endsWith('\n')).toBe(false)
  })

  test('one gate line per gate follows in BUILTIN_GATES order, in the where colon kickoff form', () => {
    const gateLines = kickoffLines('BE').filter(line => line.startsWith('- '))

    expect(gateLines).toEqual(BUILTIN_GATES.map(gate => `- ${gate.where}: ${gate.kickoff}`))
  })

  test('a role folder with a line break is cleaned and lowercased, so it cannot start a new line', () => {
    expect(roleLine('Be\nX')).toBe(`You are the bex${ROLE_LINE_TAIL}`)
  })

  test('a role name that is blank once cleaned is named unnamed', () => {
    const lines = kickoffLines('\u{200B} \n')

    expect(lines[0]).toBe(`You are the unnamed${ROLE_LINE_TAIL}`)
    expect(lines).toContain('Write your plan to .cadre/unnamed/.runtime/plan.md, then execute it with subagents.')
  })

  test('a role folder of 40 characters is kept whole', () => {
    expect(roleLine('A'.repeat(40))).toBe(`You are the ${'a'.repeat(40)}${ROLE_LINE_TAIL}`)
  })

  test('a role folder of 41 characters is cut to 40 with an ellipsis', () => {
    expect(roleLine('A'.repeat(41))).toBe(`You are the ${'a'.repeat(39)}\u{2026}${ROLE_LINE_TAIL}`)
  })

  test('a spec path of 260 characters is kept whole', () => {
    expect(specLine('p'.repeat(260))).toBe(`Spec: ${'p'.repeat(260)}`)
  })

  test('a spec path of 261 characters is cut to 260 with an ellipsis', () => {
    expect(specLine('p'.repeat(261))).toBe(`Spec: ${'p'.repeat(259)}\u{2026}`)
  })
})

describe('BUILTIN_ADAPTER', () => {
  test('it declares every required adapter field under the framework contract', () => {
    expect(missingFields(BUILTIN_ADAPTER)).toEqual([])
  })

  test('it fills the identity, detect rule, start, locate, verify and done fields', () => {
    expect(BUILTIN_ADAPTER.id).toBe('none')
    expect(BUILTIN_ADAPTER.name).toBe('built-in')
    expect(BUILTIN_ADAPTER.detectRule).toBe('always available inside cadre; used when no framework is chosen')
    expect(BUILTIN_ADAPTER.startWork).toEqual([
      'write the plan to .cadre/<role>/.runtime/plan.md (never ExitPlanMode)',
      'execute the plan with subagents',
    ])
    expect(BUILTIN_ADAPTER.locations).toEqual({
      spec: ['.cadre/<role>/.runtime/spec.md'],
      plan: ['.cadre/<role>/.runtime/plan.md'],
    })
    expect(BUILTIN_ADAPTER.verify).toEqual([
      "the project's test and lint commands (from the Phase 2 repo scan)",
      'a reviewer subagent',
    ])
    expect(BUILTIN_ADAPTER.doneSignal).toEqual({
      artifact: '.cadre/<role>/.runtime/DONE.md',
      check: 'the file exists and says what was done and how it was verified',
    })
  })

  test('it wires the gate table and functions by reference, with no roleFacts', () => {
    expect(BUILTIN_ADAPTER.humanGates).toBe(BUILTIN_GATES)
    expect(BUILTIN_ADAPTER.detect).toBe(detectBuiltin)
    expect(BUILTIN_ADAPTER.kickoffText).toBe(builtinKickoffText)
    expect(BUILTIN_ADAPTER.roleFacts).toBeUndefined()
  })

  test('it has no autonomy settings, and its note says why', () => {
    expect(BUILTIN_ADAPTER.autonomy).toEqual([])
    expect(BUILTIN_ADAPTER.autonomyNote).toBe('No framework config: autonomy comes from the kickoff text alone.')
  })
})
