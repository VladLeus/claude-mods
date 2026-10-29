import { describe, expect, test } from 'claude-code/testing'

import { CLAUDE_MD_PLUGIN } from '../../roles/infra'
import {
  IMPROVER_INSTALL_CONTEXT,
  IMPROVER_INSTALL_DISMISSED_REASON,
  IMPROVER_INSTALL_QUESTION,
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
