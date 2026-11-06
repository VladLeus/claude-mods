import { describe, expect, test } from 'claude-code/testing'

import type { InstructionHandout } from '../../../types'
import { CLAUDE_MD_PLUGIN } from '../../roles/infra'
import { driven, emptySetupScan, GUIDANCE_KEY, stateAt, wholeDraft } from '../../testkit'
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
        "tidies each role's built CLAUDE.md, and you accept or keep each change.",
    )
    expect(IMPROVER_INSTALL_CONTEXT).toBe(
      'Without it the built files stay as cadre wrote them; a --dry-run installs nothing.',
    )
    expect(IMPROVER_INSTALL_DISMISSED_REASON).toBe('The claude-md-management question was dismissed or not answered.')
    expect(CLAUDE_MD_PLUGIN).toBe('claude-md-management@claude-plugins-official')
  })
})

describe('the improver install stage (D-230)', () => {
  /** A hand-out that gives the PM role a built file with one part. */
  const BUILT: InstructionHandout = {
    kind: 'parts',
    scan: { parts: [], files: [], memories: [], warnings: [] },
    topics: [{ id: 'T1', title: 'Rules', summary: 'The team rules.', partIds: ['P1'] }],
    recommended: new Map(),
    given: new Map([['T1', ['pm']]]),
  }

  /** The improver install stage entered with `instructions`, the plugins in `installed`, and the security answer. */
  function improverAt(instructions: InstructionHandout, installed: readonly string[] = []): InitState {
    const gathered = { ...wholeDraft().gathered, setup: emptySetupScan({ installedPlugins: installed }) }
    const draft = wholeDraft({ instructions, gathered, pluginInstalls: [GUIDANCE_KEY] })

    return improverInstallStage.enter(stateAt('improver-install', draft))
  }

  test('improverInstallStage asks when a role got a built file and the plugin is missing; the open question', () => {
    const state = improverAt(BUILT)
    const question = withContext(IMPROVER_INSTALL_QUESTION, IMPROVER_INSTALL_CONTEXT)
    const lines = ['Built CLAUDE.md files it would tidy:', '  pm: .cadre/pm/CLAUDE.md']
    // A pane surface asks the question with the summary of its context (D-310).
    const summary = '1 role: pm'
    const pane = { asked: question, text: withContext(IMPROVER_INSTALL_QUESTION, summary) }
    const rows = [
      {
        title: null,
        rows: [
          { role: 'heading', text: 'Built CLAUDE.md files it would tidy:', indent: 0 },
          { role: 'field', label: 'pm', text: '.cadre/pm/CLAUDE.md', indent: 2 },
        ],
      },
    ]
    const context = { title: 'Improver install', lines, kind: 'improver-install', summary, pane, rows }
    const ask = { question, spec: { options: ['Install', 'Not now'], header: 'Improver', context } }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
  })

  test('the improver install question carries each role given a built file, in role order (D-236)', () => {
    const topics = [
      { id: 'T1', title: 'Rules', summary: 'The team rules.', partIds: ['P1'] },
      { id: 'T2', title: 'Empty', summary: 'No part.', partIds: [] },
    ]
    const given = new Map([
      ['T1', ['security', 'pm']],
      ['T2', ['tl']],
    ])
    const state = improverAt({ ...BUILT, topics, given })
    expect(state.openQuestion?.spec.context?.lines).toEqual([
      'Built CLAUDE.md files it would tidy:',
      '  pm: .cadre/pm/CLAUDE.md',
      '  security: .cadre/security/CLAUDE.md',
    ])
  })

  test('Install adds the plugin after the plugins answered before it, and Not now adds none', () => {
    expect(driven(improverAt(BUILT), ['Install']).state.draft.pluginInstalls).toEqual([GUIDANCE_KEY, CLAUDE_MD_PLUGIN])
    expect(driven(improverAt(BUILT), ['Not now']).state.draft.pluginInstalls).toEqual([GUIDANCE_KEY])
  })

  test('with no built file, or the plugin installed, it asks nothing and adds nothing', () => {
    const quiet = [improverAt({ kind: 'none' }), improverAt({ kind: 'whole' }), improverAt(BUILT, [CLAUDE_MD_PLUGIN])]
    for (const state of quiet) {
      expect([state.sub, state.openQuestion]).toEqual([{ kind: 'done' }, null])
      expect(state.draft.pluginInstalls).toEqual([GUIDANCE_KEY])
    }
  })
})
