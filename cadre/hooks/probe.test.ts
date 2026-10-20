import { describe, expect, test } from 'claude-code/testing'

import type { CompiledScope, Enforcement, ProbeCheckKind, ProbeExpectation, ScopeContext, ScopeRule } from '../types'
import { expectationsFor, isProbeToken, probeExpectationsText, probeVerdicts } from './probe'
import type { InitInventory, ProbeVerdict } from './probe'
import { compileScope } from './scope'
import { emptySetupScan, session, templateRole } from './testkit'

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

/** An expectation of this check and token, hard unless named; its text names both. */
function expectation(check: ProbeCheckKind, token: string, enforcement: Enforcement = 'hard'): ProbeExpectation {
  return { check, enforcement, text: `${check} ${token}`, token }
}

/** The verdicts alone, in order. */
function verdictsOf(inventory: InitInventory, expectations: readonly ProbeExpectation[]): ProbeVerdict[] {
  return probeVerdicts(inventory, expectations).map(item => item.verdict)
}

/** The PM on GSD with these MCP servers scanned and none given, on the route named. */
function pmWith(servers: readonly string[], mcpRoute: ScopeContext['mcpRoute'] = 'merged'): CompiledScope {
  return compileScope(templateRole('pm'), context({ setup: emptySetupScan({ mcp: servers.map(session) }), mcpRoute }))
}

/** What the probe adds to the text of an expectation whose token it will not compare (T-03-10). */
const UNUSUAL = ' (not checked: unusual characters)'

describe('probe verdicts', () => {
  test('tool-prefix-absent is violated when any tool starts with the token, and holds when none does', () => {
    const denied = expectation('tool-prefix-absent', 'mcp__notion__')

    expect(verdictsOf(inventory(['Read', 'mcp__notion__search']), [denied])).toEqual(['violated'])
    expect(verdictsOf(inventory(['Read', 'mcp__autopilot__wait_for']), [denied])).toEqual(['enforced'])
  })

  test('tool-present, command-present and skill-present are violated when the name is not in their own list', () => {
    const present = [
      expectation('tool-present', 'mcp__autopilot__wait_for'),
      expectation('command-present', 'autopilot'),
      expectation('skill-present', 'create-handoff-doc'),
    ]
    const lists = { slashCommands: ['autopilot'], skills: ['create-handoff-doc'] }
    const full = inventory(['mcp__autopilot__wait_for'], lists)
    const crossed = inventory(['autopilot', 'create-handoff-doc'], { slashCommands: ['mcp__autopilot__wait_for'] })

    expect(verdictsOf(full, present)).toEqual(['enforced', 'enforced', 'enforced'])
    expect(verdictsOf(inventory([]), present)).toEqual(['violated', 'violated', 'violated'])
    expect(verdictsOf(crossed, present)).toEqual(['violated', 'violated', 'violated'])
  })

  test('permission-mode is violated when the mode differs or is not shown', () => {
    const auto = expectation('permission-mode', 'auto')

    expect(verdictsOf(inventory([], { permissionMode: 'auto' }), [auto])).toEqual(['enforced'])
    expect(verdictsOf(inventory([], { permissionMode: 'default' }), [auto])).toEqual(['violated'])
    expect(verdictsOf(inventory([]), [auto])).toEqual(['violated'])
  })

  test('memory-path holds for the folder with or without a trailing slash, and for no other folder (ISO-03)', () => {
    const memory = expectation('memory-path', PM_MEMORY)
    const shown = (memoryAuto: string | null): ProbeVerdict[] => verdictsOf(inventory([], { memoryAuto }), [memory])

    expect(shown(PM_MEMORY)).toEqual(['enforced'])
    expect(shown(`${PM_MEMORY}/`)).toEqual(['enforced'])
    expect(shown(`${PM_MEMORY}x`)).toEqual(['violated'])
    expect(shown('/home/u/.claude/cadre/repo-1a2b3c4d/be/')).toEqual(['violated'])
    expect(shown(null)).toEqual(['violated'])
  })

  test('not-visible is best-effort whatever its label, a note is a note, a best-effort rule is never enforced', () => {
    const expectations = [
      expectation('not-visible', '', 'hard'),
      expectation('not-visible', '', 'best-effort'),
      expectation('note', '', 'none'),
      expectation('tool-prefix-absent', 'mcp__jira__', 'best-effort'),
      expectation('tool-absent', 'Bash', 'best-effort'),
    ]

    expect(verdictsOf(inventory(['Bash']), expectations)).toEqual([
      'best-effort',
      'best-effort',
      'note',
      'best-effort',
      'violated',
    ])
  })

  test('adjacency: denied red checks mcp__red__, which mcp__redmine__x is not; a denied redmine is violated', () => {
    const tools = inventory(['Read', 'mcp__redmine__x'])
    const red = expectationsFor(pmWith(['red']), PM_MEMORY).filter(item => item.check === 'tool-prefix-absent')
    const redmine = expectationsFor(pmWith(['redmine']), PM_MEMORY).filter(item => item.check === 'tool-prefix-absent')

    expect(red).toEqual([
      {
        check: 'tool-prefix-absent',
        enforcement: 'best-effort',
        text: 'Scanned MCP servers not given are denied: red [tools of mcp__red__ absent]',
        token: 'mcp__red__',
      },
    ])
    expect(verdictsOf(tools, red)).toEqual(['best-effort'])
    expect(verdictsOf(tools, redmine)).toEqual(['violated'])
  })

  test('empty: with no tools, commands or skills, every absent check holds and every present check is violated', () => {
    const expectations = expectationsFor(pmWith(['jira'], 'strict'), PM_MEMORY)
    const verdicts = verdictsOf(inventory([]), expectations)
    const of = (suffix: string): (ProbeVerdict | undefined)[] =>
      expectations.flatMap((item, index) => (item.check.endsWith(suffix) ? [verdicts[index]] : []))

    expect(expectations.filter(item => item.check.endsWith('-absent')).map(item => item.token)).toEqual([
      'Bash',
      'mcp__jira__',
    ])
    expect(of('-absent')).toEqual(['enforced', 'enforced'])
    expect(of('-present')).toEqual(Array.from({ length: 6 }, () => 'violated'))
  })

  test('ordering: verdicts follow the expectations, card rule order then memory, and equal texts keep order', () => {
    const scope = pmWith(['jira'])
    const expectations = expectationsFor(scope, PM_MEMORY)
    const sources = scope.card.rules.flatMap(rule => Array.from({ length: rule.checks?.length ?? 1 }, () => rule.text))
    const texts = expectations.map(item => item.text)
    const same: ProbeExpectation[] = [
      { check: 'tool-absent', enforcement: 'hard', text: 'same', token: 'Bash' },
      { check: 'tool-absent', enforcement: 'hard', text: 'same', token: 'Write' },
    ]

    expect(probeVerdicts(inventory([]), expectations).map(item => item.text)).toEqual(texts)
    expect(expectations).toHaveLength(sources.length + 1)
    expect(expectations.slice(0, -1).filter((item, index) => !item.text.startsWith(sources[index] ?? '-'))).toEqual([])
    expect(expectations.at(-1)?.check).toBe('memory-path')
    expect(probeVerdicts(inventory(['Write']), same)).toEqual([
      { verdict: 'enforced', text: 'same' },
      { verdict: 'violated', text: 'same' },
    ])
  })

  test('a memory folder with a quote is never compared: not-visible, token empty, its verdict best-effort', () => {
    const memory = expectationsFor(pmWith([]), '/home/u/x"y').slice(-1)

    expect(memory).toEqual([
      {
        check: 'not-visible',
        enforcement: 'hard',
        text: `Memory folder: /home/u/xy (autoMemoryDirectory)${UNUSUAL}`,
        token: '',
      },
    ])
    expect(verdictsOf(inventory([], { memoryAuto: '/home/u/x"y' }), memory)).toEqual(['best-effort'])
  })

  test('a token outside printable ASCII or with a quote, backslash, pipe, backtick or dollar is never a check', () => {
    const accented = `/home/u/caf${String.fromCodePoint(0xe9)}`
    const unusual = ['/home/u/x\\y', '/home/u/x|y', '/home/u/x`y', '/home/u/x$y', '/home/u/x\ny', accented, '']
    const written = unusual.map(dir => expectationsFor(pmWith([]), dir).at(-1))

    expect(written.map(item => [item?.check, item?.token])).toEqual(unusual.map(() => ['not-visible', '']))
    expect(written.filter(item => !item?.text.endsWith(UNUSUAL))).toEqual([])
    expect(expectationsFor(pmWith([]), '/home/u/John Smith/pm').at(-1)?.check).toBe('memory-path')
    expect(unusual.filter(isProbeToken)).toEqual([])
    expect(['Bash', 'mcp__red__', '/home/u/John Smith/pm', "it's"].filter(token => !isProbeToken(token))).toEqual([])
  })

  test('a check whose token is unusual is written as not-visible with the rule text and its label', () => {
    const scope = pmWith([])
    const rule: ScopeRule = { text: 'x', enforcement: 'hard', checks: [{ kind: 'tool-absent', token: 'a|b' }] }
    const hostile: CompiledScope = { ...scope, card: { ...scope.card, rules: [rule] } }

    expect(expectationsFor(hostile, PM_MEMORY)).toEqual([
      { check: 'not-visible', enforcement: 'hard', text: `x [tool a/b absent]${UNUSUAL}`, token: '' },
      PM_MEMORY_EXPECTATION,
    ])
  })
})
