import { describe, expect, test } from 'claude-code/testing'

import { FILE_SYSTEM_ROOT_REPLY, fileSystemRootReply, HOME_ROOT_REPLY, homeRootReply } from '../guards/refusals'
import { t } from '../locales/t'
import { NO_USABLE_ANSWER_REASON } from '../ui/ask'
import { cancelledReply, cancelledText, frameworksInEpicReply, INIT_CANCELLED } from './replies'

describe('cancel reply (S1)', () => {
  test('cancelledReply is INIT_CANCELLED, a colon and the reason cleaned as a report cell', () => {
    expect(cancelledReply(NO_USABLE_ANSWER_REASON)).toBe(
      'init cancelled, nothing written: No usable answer after 3 tries.',
    )
    expect(cancelledReply('a\nb')).toBe('init cancelled, nothing written: ab')
  })
})

describe('the cancel text of each flow', () => {
  test('init keeps its cancel text and reply; the frameworks flow words both as its own', () => {
    expect([cancelledText(), cancelledText('init'), cancelledText('frameworks')]).toEqual([
      INIT_CANCELLED,
      INIT_CANCELLED,
      t('frameworks.replies.cancelled'),
    ])
    expect([cancelledReply('why'), cancelledReply('why', 'init'), cancelledReply('why', 'frameworks')]).toEqual([
      'init cancelled, nothing written: why',
      'init cancelled, nothing written: why',
      'frameworks cancelled, nothing written: why',
    ])
  })
})

describe('the frameworks refusal in an epic worktree', () => {
  test('frameworksInEpicReply names the main checkout, cleaned as a report cell', () => {
    expect(frameworksInEpicReply('/m')).toBe(t('frameworks.epicWorktree', { main: '/m' }))
    expect(frameworksInEpicReply('/m\nx')).toBe(t('frameworks.epicWorktree', { main: '/mx' }))
  })
})

describe('init helpers', () => {
  test('the init refusals use the init wording and the detect refusals keep their own, byte for byte', () => {
    expect(homeRootReply('init')).not.toContain('detect')
    expect(fileSystemRootReply('init')).not.toContain('detect')
    expect(HOME_ROOT_REPLY).toBe(
      'cadre detect needs a repo root other than your home folder. ' +
        'Open the session in a repo and run /cadre detect again.',
    )
    expect(FILE_SYSTEM_ROOT_REPLY).toBe(
      'cadre detect needs a repo root other than the file system root (/). ' +
        'Open the session in a repo and run /cadre detect again.',
    )
  })
})
