import { describe, expect, test } from 'claude-code/testing'

import type { InstructionHandout, InstructionPart } from '../../../types'
import { CLAUDE_MD_PLUGIN } from '../../roles/infra'
import { driven, emptySetupScan, GUIDANCE_KEY, HASH, stateAt, wholeDraft } from '../../testkit'
import { withContext } from '../../ui/ask'
import type { InitState } from '../state'
import {
  IMPROVER_INSTALL_CONTEXT,
  IMPROVER_INSTALL_DISMISSED_REASON,
  IMPROVER_INSTALL_QUESTION,
  improverInstallStage,
} from './improver-install'

describe('improver install offer (G-02-1f)', () => {
  test('the question, its context, its cancel reason and the plugin key are fixed', () => {
    expect(IMPROVER_INSTALL_QUESTION).toBe(
      'Install claude-md-management from claude-plugins-official after you confirm the plan? Its claude-md-improver ' +
        "tidies each role's private CLAUDE.md, built from your global CLAUDE.md, and you accept or keep each change.",
    )
    expect(IMPROVER_INSTALL_CONTEXT).toBe(
      'Without it the private CLAUDE.md files stay as cadre wrote them; a --dry-run installs nothing.',
    )
    expect(IMPROVER_INSTALL_DISMISSED_REASON).toBe('The claude-md-management question was dismissed or not answered.')
    expect(CLAUDE_MD_PLUGIN).toBe('claude-md-management@claude-plugins-official')
  })
})

describe('the improver install stage (D-230)', () => {
  /** A section of the global CLAUDE.md, which goes into a role's private text file. */
  const GLOBAL_PART: InstructionPart = {
    id: 'P1',
    file: '~/.claude/CLAUDE.md',
    heading: 'Rules',
    source: 'global',
    text: '# Rules\n',
    hash: HASH,
  }

  /** A section of the repo's CLAUDE.md, which a role loads from the original. */
  const REPO_PART: InstructionPart = {
    id: 'P2',
    file: 'CLAUDE.md',
    heading: 'Style',
    source: 'repo',
    text: '# Style\n',
    hash: HASH,
  }

  /** A hand-out that gives the PM role a topic holding a global part. */
  const BUILT: InstructionHandout = {
    kind: 'parts',
    scan: { parts: [GLOBAL_PART, REPO_PART], files: [], memories: [], warnings: [] },
    topics: [{ id: 'T1', title: 'Rules', summary: 'The team rules.', partIds: ['P1'] }],
    recommended: new Map(),
    given: new Map([['T1', ['pm']]]),
  }

  /** A hand-out that gives the PM role a topic of repo parts only, which leaves the improver nothing to run on. */
  const REPO_ONLY: InstructionHandout = {
    ...BUILT,
    topics: [{ id: 'T1', title: 'Style', summary: 'The repo style.', partIds: ['P2'] }],
  }

  /** The improver install stage entered with `instructions`, the plugins in `installed`, and the security answer. */
  function improverAt(instructions: InstructionHandout, installed: readonly string[] = []): InitState {
    const gathered = { ...wholeDraft().gathered, setup: emptySetupScan({ installedPlugins: installed }) }
    const draft = wholeDraft({ instructions, gathered, pluginInstalls: [GUIDANCE_KEY] })

    return improverInstallStage.enter(stateAt('improver-install', draft))
  }

  test('improverInstallStage asks when a role got a global part and the plugin is missing; the open question', () => {
    const state = improverAt(BUILT)
    const question = withContext(IMPROVER_INSTALL_QUESTION, IMPROVER_INSTALL_CONTEXT)
    const heading = 'Private CLAUDE.md files it would tidy, built from your global CLAUDE.md:'
    const path = '<config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md'
    const lines = [heading, `  pm: ${path}`]
    // A pane surface asks the question with the summary of its context (D-310).
    const summary = '1 role: pm'
    const pane = { asked: question, text: withContext(IMPROVER_INSTALL_QUESTION, summary) }
    const rows = [
      {
        title: null,
        rows: [
          { role: 'heading', text: heading, indent: 0 },
          { role: 'field', label: 'pm', text: path, indent: 2 },
        ],
      },
    ]
    const context = { title: 'Improver install', lines, kind: 'improver-install', summary, pane, rows }
    const ask = { question, spec: { options: ['Install', 'Not now'], header: 'Improver', context } }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
  })

  test('the improver install question carries each role given a global part, in role order (D-236)', () => {
    const topics = [
      { id: 'T1', title: 'Rules', summary: 'The team rules.', partIds: ['P1'] },
      { id: 'T2', title: 'Empty', summary: 'No part.', partIds: [] },
      { id: 'T3', title: 'Style', summary: 'The repo style.', partIds: ['P2'] },
    ]
    const given = new Map([
      ['T1', ['security', 'pm']],
      ['T2', ['tl']],
      ['T3', ['tl']],
    ])
    const state = improverAt({ ...BUILT, topics, given })
    expect(state.openQuestion?.spec.context?.lines).toEqual([
      'Private CLAUDE.md files it would tidy, built from your global CLAUDE.md:',
      '  pm: <config dir>/cadre/<repo>-<hash8>/pm/instructions/CLAUDE.md',
      '  security: <config dir>/cadre/<repo>-<hash8>/security/instructions/CLAUDE.md',
    ])
  })

  test('Install adds the plugin after the plugins answered before it, and Not now adds none', () => {
    expect(driven(improverAt(BUILT), ['Install']).state.draft.pluginInstalls).toEqual([GUIDANCE_KEY, CLAUDE_MD_PLUGIN])
    expect(driven(improverAt(BUILT), ['Not now']).state.draft.pluginInstalls).toEqual([GUIDANCE_KEY])
  })

  test('with no global part given, or the plugin installed, it asks nothing and adds nothing', () => {
    const quiet = [
      improverAt({ kind: 'none' }),
      improverAt({ kind: 'whole' }),
      improverAt(REPO_ONLY),
      improverAt(BUILT, [CLAUDE_MD_PLUGIN]),
    ]
    for (const state of quiet) {
      expect([state.sub, state.openQuestion]).toEqual([{ kind: 'done' }, null])
      expect(state.draft.pluginInstalls).toEqual([GUIDANCE_KEY])
    }
  })
})
