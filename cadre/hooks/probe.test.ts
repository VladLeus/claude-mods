import { describe, expect, test } from 'claude-code/testing'

import type { CompiledScope, Enforcement, ProbeCheckKind, ProbeExpectation, ScopeContext, ScopeRule } from '../types'
import {
  expectationsFor,
  isProbeToken,
  parseInitEvent,
  PROBE_CHECK_KINDS,
  probeExpectationsText,
  probeText,
  probeVerdicts,
} from './probe'
import type { InitInventory, ProbeVerdict } from './probe'
import { compileScope } from './scope/compile'
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
  test('PROBE_CHECK_KINDS lists the nine kinds in the order of the type, and the list is frozen', () => {
    expect(PROBE_CHECK_KINDS).toEqual([
      'tool-absent', 'tool-prefix-absent', 'tool-present', 'command-present', 'skill-present',
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

  test(
    'probeText writes every backslash and pipe as a slash, so jq and sed hand the launcher the same bytes (A3)',
    () => {
      expect(probeText('C:\\dir|x \\c \\n')).toBe('C:/dir/x /c /n')
      expect(probeText('a\\\\b')).toBe('a//b')
    },
  )

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

/** The tools the init event of a PM probe run lists: Read and the three autopilot tools, and no Bash (ISO-01). */
const PM_TOOLS: readonly string[] = [
  'Read',
  'mcp__autopilot__restart_session',
  'mcp__autopilot__wait_for',
  'mcp__autopilot__queue_question',
]

/** The skills the init event of a PM probe run lists: the two handoff skills every role keeps. */
const PM_SKILLS: readonly string[] = ['create-handoff-doc', 'resume-handoff-doc']

/** What parseInitEvent gives for the init line of an untouched PM run; the memory folder has its trailing slash. */
const PM_INVENTORY: InitInventory = {
  tools: PM_TOOLS,
  slashCommands: ['autopilot'],
  skills: PM_SKILLS,
  permissionMode: 'auto',
  memoryAuto: `${PM_MEMORY}/`,
}

/** What the probe prints for the check on a denied notion server: its tools must be absent, best-effort (D-104). */
const NOTION_TEXT = 'Scanned MCP servers not given are denied: notion [tools of mcp__notion__ absent]'

/**
 * The init event of a PM probe run as an object, with the keys the engine writes (RESEARCH 2.4); `over` replaces the
 * keys it names, and a key set to undefined is left out of the line.
 */
function initEvent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'system',
    subtype: 'init',
    cwd: '/repo',
    session_id: 'f1e2d3',
    tools: PM_TOOLS,
    mcp_servers: [{ name: 'autopilot', status: 'connected', source: 'dynamic' }],
    model: 'opus',
    permissionMode: 'auto',
    slash_commands: ['autopilot'],
    agents: ['general-purpose'],
    skills: PM_SKILLS,
    plugins: [{ name: 'autopilot', path: '/plugins/autopilot', source: 'autopilot@local-mods' }],
    memory_paths: { auto: `${PM_MEMORY}/` },
    claude_code_version: '2.1.295',
    ...over,
  }
}

/** The init event as the one compact JSON line the engine writes; `over` as in initEvent. */
function initLine(over: Record<string, unknown> = {}): string {
  return JSON.stringify(initEvent(over))
}

/** The stream-json output of a probe run: a hook event and a title event before the init line, then a result. */
function probeOutput(line: string): string {
  const events = [
    JSON.stringify({ type: 'system', subtype: 'hook_started' }),
    JSON.stringify({ type: 'system', subtype: 'session_title_changed' }),
    line,
    JSON.stringify({ type: 'result', subtype: 'success', result: 'OK' }),
  ]

  return `${events.join('\n')}\n`
}

/** The verdicts of the probe on the init line of this output, for the PM scope with these servers denied. */
function runVerdicts(output: string, servers: readonly string[]): ReturnType<typeof probeVerdicts> {
  const parsed = parseInitEvent(output)
  if (parsed === null) return []

  return probeVerdicts(parsed, expectationsFor(pmWith(servers), PM_MEMORY))
}

describe('parseInitEvent end to end (ISO-01)', () => {
  test('parseInitEvent gives the tools, commands, skills, mode and memory folder of the init line', () => {
    expect(parseInitEvent(initLine())).toEqual(PM_INVENTORY)
  })

  test('the init line need not be line 1: a hook event and a title event come before it (RESEARCH 2.4)', () => {
    const output = probeOutput(initLine())

    expect(output.split('\n').slice(0, 2)).toEqual([
      '{"type":"system","subtype":"hook_started"}',
      '{"type":"system","subtype":"session_title_changed"}',
    ])
    expect(parseInitEvent(output)).toEqual(PM_INVENTORY)
  })

  test('an untouched PM run gives no violated verdict, with or without a denied server (D-112)', () => {
    const none = runVerdicts(probeOutput(initLine()), [])
    const notion = runVerdicts(probeOutput(initLine()), ['notion'])

    expect(none.filter(item => item.verdict === 'violated')).toEqual([])
    expect(notion.filter(item => item.verdict === 'violated')).toEqual([])
    expect(none.find(item => item.text === BASH_EXPECTATION.text)).toEqual({
      verdict: 'enforced',
      text: BASH_EXPECTATION.text,
    })
    expect(notion.find(item => item.text === NOTION_TEXT)).toEqual({ verdict: 'best-effort', text: NOTION_TEXT })
    expect(notion.at(-1)).toEqual({ verdict: 'enforced', text: PM_MEMORY_EXPECTATION.text })
  })

  test('one tool of the denied notion server gives exactly one violated verdict, for the notion check', () => {
    const output = probeOutput(initLine({ tools: [...PM_TOOLS, 'mcp__notion__search'] }))
    const verdicts = runVerdicts(output, ['notion'])

    expect(verdicts.filter(item => item.verdict === 'violated')).toEqual([{ verdict: 'violated', text: NOTION_TEXT }])
  })
})

/** The text every init line holds, which a line must hold to be read at all. */
const INIT_MARK = '"subtype":"init"'

describe('parseInitEvent', () => {
  test('output with no init line gives null, the twin of the launcher refusing with no startup inventory', () => {
    const noInit = [
      JSON.stringify({ type: 'system', subtype: 'hook_started' }),
      JSON.stringify({ type: 'result', subtype: 'success' }),
    ].join('\n')

    expect([parseInitEvent(''), parseInitEvent('\n\n'), parseInitEvent(noInit)]).toEqual([null, null, null])
  })

  test('a truncated init line gives null, alone or among the other lines of a run', () => {
    const line = initLine()
    const half = line.slice(0, Math.floor(line.length / 2))

    expect(half.includes(INIT_MARK)).toBe(true)
    expect(parseInitEvent(half)).toBeNull()
    expect(parseInitEvent(probeOutput(half))).toBeNull()
  })

  test('an init line whose tools is not an array gives null: a string, an object, null, a number or no tools', () => {
    const lines = ['Read', { Read: true }, null, 7, undefined].map(tools => initLine({ tools }))

    expect(lines.map(parseInitEvent)).toEqual([null, null, null, null, null])
  })

  test('an init line whose skills or slash_commands is not an array gives null, as the launcher refuses (A2)', () => {
    const lines = [
      initLine({ skills: undefined }),
      initLine({ slash_commands: undefined }),
      initLine({ skills: 'create-handoff-doc' }),
      initLine({ slash_commands: { autopilot: true } }),
      initLine({ skills: null }),
    ]

    expect(lines.map(parseInitEvent)).toEqual([null, null, null, null, null])
  })

  test('an init line that holds a list key twice, nested or not, gives null, as the launcher refuses (A2)', () => {
    const nested = [
      initLine({ plugins: [{ name: 'x', tools: ['Bash'] }] }),
      initLine({ agents: [{ name: 'y', skills: [] }] }),
      initLine({ mcp_servers: [{ name: 'z', slash_commands: ['a'] }] }),
    ]
    const duplicate = '{"type":"system","subtype":"init","tools":["Bash"],"tools":[],"skills":[],"slash_commands":[]}'

    expect(nested.map(parseInitEvent)).toEqual([null, null, null])
    expect(nested.map(line => parseInitEvent(probeOutput(line)))).toEqual([null, null, null])
    expect(parseInitEvent(duplicate)).toBeNull()
  })

  test('a JSON array that holds the init text is no init event, nor is another type or another subtype', () => {
    const asArray = JSON.stringify([initEvent()])
    const otherType = initLine({ type: 'assistant' })
    const otherSubtype = JSON.stringify({ type: 'system', subtype: 'hook_response', data: initEvent() })
    const lines = [asArray, otherType, otherSubtype]

    expect(lines.filter(line => !line.includes(INIT_MARK))).toEqual([])
    expect(lines.map(parseInitEvent)).toEqual([null, null, null])
  })

  test('the first init event decides: a decoy before it is skipped, a malformed one is not skipped for a later', () => {
    const decoy = initLine({ type: 'assistant', tools: ['Bash'] })
    const malformed = initLine({ tools: 'Read' })

    expect(parseInitEvent([decoy, initLine()].join('\n'))).toEqual(PM_INVENTORY)
    expect(parseInitEvent([malformed, initLine()].join('\n'))).toBeNull()
  })

  test('an init line whose tools hold a number and a string keeps only the string, as its commands and skills', () => {
    const tools = initLine({ tools: [7, 'Read', null, { name: 'Bash' }] })
    const lists = initLine({ slash_commands: [false, 'autopilot'], skills: [['x'], 'create-handoff-doc'] })

    expect(parseInitEvent(tools)).toEqual({ ...PM_INVENTORY, tools: ['Read'] })
    expect(parseInitEvent(lists)).toEqual({
      ...PM_INVENTORY,
      slashCommands: ['autopilot'],
      skills: ['create-handoff-doc'],
    })
  })

  test('a permission mode that is a number, or no memory_paths, gives null for the mode and the memory folder', () => {
    const line = initLine({ permissionMode: 5, memory_paths: undefined })
    const memory = ['auto', ['auto'], null, {}, { auto: 5 }].map(value => initLine({ memory_paths: value }))

    expect(parseInitEvent(line)).toEqual({ ...PM_INVENTORY, permissionMode: null, memoryAuto: null })
    expect(memory.map(item => parseInitEvent(item)?.memoryAuto)).toEqual([null, null, null, null, null])
  })

  test('an init line that lists a denied server in mcp_servers changes no verdict: only tools are read (D-104)', () => {
    const servers = [
      { name: 'autopilot', status: 'connected', source: 'dynamic' },
      { name: 'notion', status: 'connected', source: 'claudeai' },
    ]
    const listed = initLine({ mcp_servers: servers })
    const verdicts = runVerdicts(probeOutput(listed), ['notion'])

    expect(parseInitEvent(listed)).toEqual(PM_INVENTORY)
    expect(verdicts.find(item => item.text === NOTION_TEXT)).toEqual({ verdict: 'best-effort', text: NOTION_TEXT })
    expect(verdicts).toEqual(runVerdicts(probeOutput(initLine()), ['notion']))
  })

  test('hostile output never throws: every malformed shape gives null', () => {
    const system = `{"type":"system",${INIT_MARK}`
    const hostile = [
      INIT_MARK,
      `{${INIT_MARK}}`,
      `[${INIT_MARK}]`,
      system,
      `${system},"tools":`,
      `${system},"tools":{"__proto__":{"x":1}}}`,
      `${system},"tools":"Read","memory_paths":"auto"}`,
      `${INIT_MARK}\r\n${INIT_MARK}`,
    ]

    expect(hostile.map(parseInitEvent)).toEqual(hostile.map(() => null))
  })

  test('a list that holds a name with ] gives null, wherever the name stands and in each list (#72 A1)', () => {
    const lines = [
      initLine({ tools: ['Read', 'we]ird', 'Bash', 'mcp__notion__search'] }),
      initLine({ tools: [']x', ...PM_TOOLS, 'Bash'] }),
      initLine({ tools: [...PM_TOOLS, ']'] }),
      initLine({ slash_commands: ['autopilot', 'x]'] }),
      initLine({ skills: [...PM_SKILLS, 'a]b'] }),
    ]

    expect(lines.map(parseInitEvent)).toEqual([null, null, null, null, null])
    expect(lines.map(line => parseInitEvent(probeOutput(line)))).toEqual([null, null, null, null, null])
    expect(runVerdicts(probeOutput(lines[0] ?? ''), ['notion'])).toEqual([])
  })

  test('a name JSON writes with an escape gives null: a quote, a backslash or a control character (#72 A1)', () => {
    const lines = [
      initLine({ skills: [...PM_SKILLS, 'a"b'] }),
      initLine({ skills: [...PM_SKILLS, 'a\\b'] }),
      initLine({ tools: [...PM_TOOLS, 'a\nb'] }),
      initLine({ slash_commands: ['autopilot', 'x\u0007'] }),
    ]

    expect(lines.filter(line => !line.includes('\\'))).toEqual([])
    expect(lines.map(parseInitEvent)).toEqual([null, null, null, null])
  })

  test('a name with [, a space or a letter outside ASCII is read as it is, as the launcher reads it (#72 A1)', () => {
    const tools = [...PM_TOOLS, 'a[b', 'c d']
    const skills = [...PM_SKILLS, 'caf\u00e9']

    expect(parseInitEvent(initLine({ tools, skills }))).toEqual({ ...PM_INVENTORY, tools, skills })
  })
})
