import { describe, expect, test } from 'claude-code/testing'

import type { CompiledScope, ProbeExpectation, ScopeContext } from '../../types'
import { ARTIFACT } from '../locales/artifact'
import { CLAUDE_SECURITY_PLUGIN, CLAUDE_SECURITY_SKILL } from '../roles/infra'
import { SKILLS_RULE_ENFORCEMENT } from '../scope/card'
import { compileScope } from '../scope/compile'
import { emptySetupScan, skillRef, templateRole } from '../testkit'
import { probeVerdicts } from './oracle'
import type { InitInventory } from './oracle'
import { deniedSkillNames, expectationsFor, PROBE_CHECK_KINDS, probeExpectationsText } from './probe'

/**
 * A scope context for the GSD framework, the merged MCP route and a git-root start; `over` changes the fields it
 * names.
 */
function context(over: Partial<ScopeContext> = {}): ScopeContext {
  return {
    framework: 'gsd',
    setup: emptySetupScan(),
    codeDirs: [],
    isAttended: false,
    mcpRoute: 'merged',
    launchStart: { kind: 'git-root' },
    roles: ['pm', 'be'],
    ...over,
  }
}

/** The memory folder /cadre start renders for the PM of a repo-1a2b3c4d checkout in the fixture home (D-91). */
const PM_MEMORY = '/home/u/.claude/cadre/repo-1a2b3c4d/pm'

/** The PM's Bash rule as an expectation: the init event must not list the Bash tool (D-112). */
const BASH_EXPECTATION: ProbeExpectation = {
  check: 'tool-absent',
  enforcement: 'hard',
  text: 'No Bash tool (denied) [tool Bash absent]',
  token: 'Bash',
}

/** The expectation of the PM's memory folder, the last of the list (ISO-03). */
const PM_MEMORY_EXPECTATION: ProbeExpectation = {
  check: 'memory-path',
  enforcement: 'hard',
  text: `Memory folder: ${PM_MEMORY} (autoMemoryDirectory)`,
  token: PM_MEMORY,
}

/**
 * A rule line of the expectations file as the launcher's sed program reads it when jq is not on PATH (D-130): the
 * four fields in order, no quote or pipe in the text or the token, and a comma after every line but the last.
 */
const SED_RULE_LINE = /^\{"check":"[a-z-]*","enforcement":"[a-z-]*","text":"[^"|]*","token":"[^"|]*"\},?$/

/** A startup inventory that lists these tools and nothing else; `over` changes the fields it names. */
function inventory(tools: readonly string[], over: Partial<InitInventory> = {}): InitInventory {
  return { tools, slashCommands: [], skills: [], permissionMode: null, memoryAuto: null, ...over }
}

describe('probe expectations (D-130)', () => {
  test('PROBE_CHECK_KINDS lists the ten kinds in the order of the type, and the list is frozen', () => {
    expect(PROBE_CHECK_KINDS).toEqual([
      'tool-absent', 'tool-prefix-absent', 'tool-present', 'command-present', 'skill-present', 'skill-absent',
      'permission-mode', 'memory-path', 'not-visible', 'note',
    ])
    expect(Object.isFrozen(PROBE_CHECK_KINDS)).toBe(true)
  })

  test('the PM card has a tool-absent check on its Bash rule; the Bash rule of a role with Bash has none', () => {
    const pm = compileScope(templateRole('pm'), context()).card.rules
    const be = compileScope(templateRole('be'), context()).card.rules

    expect(pm.find(rule => rule.text === 'No Bash tool (denied)')).toEqual({
      text: 'No Bash tool (denied)',
      enforcement: 'hard',
      checks: [{ kind: 'tool-absent', token: 'Bash' }],
    })
    expect(be.find(rule => rule.text.startsWith('Bash runs in the sandbox'))).toEqual({
      text: 'Bash runs in the sandbox (hard on macOS, best-effort on Linux)',
      enforcement: 'best-effort',
    })
  })

  test('expectationsFor gives the Bash check of the PM once and ends with its memory folder (ISO-03)', () => {
    const expectations = expectationsFor(compileScope(templateRole('pm'), context()), PM_MEMORY)

    expect(expectations.filter(item => item.text === BASH_EXPECTATION.text)).toEqual([BASH_EXPECTATION])
    expect(expectations.at(-1)).toEqual(PM_MEMORY_EXPECTATION)
  })

  test('probeExpectationsText writes schema 1, then one rule per line with its keys in order, and parses back', () => {
    const expectations = expectationsFor(compileScope(templateRole('pm'), context()), PM_MEMORY)
    const text = probeExpectationsText(expectations)
    const lines = text.split('\n')
    const rules = lines.slice(1, -2)

    expect(lines[0]).toBe('{"schema":1,"rules":[')
    expect(lines.slice(-2)).toEqual([']}', ''])
    expect(rules).toHaveLength(expectations.length)
    expect(rules.filter(line => !line.startsWith('{"check":'))).toEqual([])
    expect(rules.filter(line => !SED_RULE_LINE.test(line))).toEqual([])
    expect(rules).toContain(
      '{"check":"tool-absent","enforcement":"hard","text":"No Bash tool (denied) [tool Bash absent]","token":"Bash"},',
    )
    expect(rules.at(-1)).toBe(
      `{"check":"memory-path","enforcement":"hard","text":"Memory folder: ${PM_MEMORY} (autoMemoryDirectory)",` +
        `"token":"${PM_MEMORY}"}`,
    )
    expect(JSON.parse(text)).toEqual({ schema: 1, rules: expectations })
  })

  test('probeVerdicts says enforced when the init event has no Bash tool, and violated when it has one', () => {
    expect(probeVerdicts(inventory(['Read']), [BASH_EXPECTATION])).toEqual([
      { verdict: 'enforced', text: BASH_EXPECTATION.text },
    ])
    expect(probeVerdicts(inventory(['Bash']), [BASH_EXPECTATION])).toEqual([
      { verdict: 'violated', text: BASH_EXPECTATION.text },
    ])
  })
})

/** The BE memory folder of the fixture checkout. */
const BE_MEMORY = '/home/u/.claude/cadre/repo-1a2b3c4d/be'

/** BE compiled with these role skills over a scan that lists these skills. */
function beScope(skills: readonly string[], scanned: ReturnType<typeof skillRef>[]): CompiledScope {
  const setup = emptySetupScan({ skills: scanned })

  return compileScope(templateRole('be', { skills: [...skills] }), context({ setup }))
}

/** The rule text of a granted skill's line, and the start of a call-denied summary line. */
const GIVEN = 'Skill given to the role'
const CALL_DENIED = 'denied at call time'

/**
 * The per-skill expectations of a scope: those whose check is skill-absent or whose text names a granted skill or
 * starts a call-denied summary.
 */
function skillLines(expectations: readonly ProbeExpectation[]): ProbeExpectation[] {
  return expectations.filter(
    item => item.check === 'skill-absent' || item.text.startsWith(GIVEN) || item.text.startsWith(CALL_DENIED),
  )
}

describe('the per-skill probe lines', () => {
  test('deniedSkillNames gives the names of the Skill(...) entries, in order', () => {
    expect(deniedSkillNames(['Skill(a:b)', 'Read(x)', 'Skill(c:d)'])).toEqual(['a:b', 'c:d'])
  })

  test('a not-given plugin skill whose plugin is off gets a best-effort skill-absent line before the memory', () => {
    const scope = beScope([], [skillRef(CLAUDE_SECURITY_SKILL, CLAUDE_SECURITY_PLUGIN)])
    const expectations = expectationsFor(scope, BE_MEMORY)

    expect(scope.card.notGiven.skills).toEqual([CLAUDE_SECURITY_SKILL])
    expect(skillLines(expectations)).toEqual([
      {
        check: 'skill-absent',
        enforcement: 'best-effort',
        text: `Skill denied to the role [skill ${CLAUDE_SECURITY_SKILL} absent]`,
        token: CLAUDE_SECURITY_SKILL,
      },
    ])
    expect(expectations.at(-2)?.check).toBe('skill-absent')
    expect(expectations.at(-1)?.check).toBe('memory-path')
  })

  test('a not-given skill with no scanned plugin gets no line, a colon in its name included', () => {
    const user = beScope([], [skillRef('my-skill')])
    const commands = beScope([], [skillRef('gsd:plan-phase'), skillRef('anthropic-skills:deep-research')])

    expect(user.card.notGiven.skills).toEqual(['my-skill'])
    expect(skillLines(expectationsFor(user, BE_MEMORY))).toEqual([])
    expect(commands.card.notGiven.skills).toEqual(['anthropic-skills:deep-research', 'gsd:plan-phase'])
    expect(commands.card.notGiven.pluginSkills).toEqual([])
    expect(expectationsFor(commands, BE_MEMORY).filter(item => item.check === 'skill-absent')).toEqual([])
  })

  test(
    'a granted skill gets a skill-present line, a handoff skill none, and the denied names one summary line per plugin',
    () => {
      const scope = beScope(['create-handoff-doc', 'x:y'], [])
      const launch = { deniedSkills: ['z:b', 'z:a', 'w:c'], offPlugins: [], unlinkedSkills: [] }
      const lines = skillLines(expectationsFor(scope, BE_MEMORY, launch))

      expect(lines).toEqual([
        { check: 'skill-present', enforcement: 'best-effort', text: `${GIVEN} [skill x:y present]`, token: 'x:y' },
        { check: 'not-visible', enforcement: 'best-effort', text: `${CALL_DENIED} (w, 1 skills): c`, token: '' },
        { check: 'not-visible', enforcement: 'best-effort', text: `${CALL_DENIED} (z, 2 skills): a, b`, token: '' },
      ])
    },
  )

  test('a skill name that is not a probe token becomes a not-visible line marked not checked', () => {
    const scope = beScope([], [])
    const odd: CompiledScope = { ...scope, card: { ...scope.card, skills: ['a"b'] } }
    const expectations = expectationsFor(odd, BE_MEMORY)

    expect(expectations.at(-2)).toEqual({
      check: 'not-visible',
      enforcement: 'best-effort',
      text: 'Skill given to the role [skill ab present] (not checked: unusual characters)',
      token: '',
    })
  })
  test('every per-skill line carries the enforcement of the Skills rule on the card', () => {
    const scope = beScope(['x:y'], [skillRef(CLAUDE_SECURITY_SKILL, CLAUDE_SECURITY_PLUGIN)])
    const skills = scope.card.rules.find(item => item.text === ARTIFACT.cardSkills)
    const launch = { deniedSkills: ['z:a'], offPlugins: [], unlinkedSkills: [] }
    const lines = skillLines(expectationsFor(scope, BE_MEMORY, launch))

    expect(skills?.enforcement).toBe(SKILLS_RULE_ENFORCEMENT)
    expect(lines.length).toBe(3)
    expect(lines.map(line => line.text)).toContain(`${CALL_DENIED} (z, 1 skills): a`)
    expect(lines.map(line => line.enforcement)).toEqual([
      SKILLS_RULE_ENFORCEMENT,
      SKILLS_RULE_ENFORCEMENT,
      SKILLS_RULE_ENFORCEMENT,
    ])
  })

  test('a Security role given claude-security with the plugin enabled gets it present and never absent', () => {
    const security = templateRole('security', { skills: [CLAUDE_SECURITY_SKILL] })
    const scanned = [skillRef(CLAUDE_SECURITY_SKILL, CLAUDE_SECURITY_PLUGIN)]
    const setup = emptySetupScan({ plugins: [CLAUDE_SECURITY_PLUGIN], skills: scanned })
    const scope = compileScope(security, context({ setup, roles: ['security'] }))
    const lines = skillLines(expectationsFor(scope, BE_MEMORY))

    expect(scope.settings.enabledPlugins[CLAUDE_SECURITY_PLUGIN]).toBe(true)
    expect(lines.filter(line => line.token === CLAUDE_SECURITY_SKILL)).toEqual([
      {
        check: 'skill-present',
        enforcement: 'best-effort',
        text: `${GIVEN} [skill ${CLAUDE_SECURITY_SKILL} present]`,
        token: CLAUDE_SECURITY_SKILL,
      },
    ])
  })
})
