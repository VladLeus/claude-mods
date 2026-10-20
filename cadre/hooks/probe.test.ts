import { describe, expect, test } from 'claude-code/testing'

import type { ProbeExpectation, ScopeContext } from '../types'
import { expectationsFor, probeExpectationsText, probeVerdicts } from './probe'
import type { InitInventory } from './probe'
import { compileScope } from './scope'
import { emptySetupScan, templateRole } from './testkit'

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
