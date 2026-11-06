import { describe, expect, test } from 'claude-code/testing'

import type { RawFacts } from '../../types'
import { captureDetect } from './capture'
import { GOLDEN_DETECT } from './detect'
import { candidate, installedPlugins, raw, settings } from './worlds'

/**
 * One host read where GSD and superpowers are both present, assembled from the facts.test.ts fixtures in worlds.ts:
 * `.planning/` and `docs/superpowers/` in the repo, the settings and installed plugins of `normalizeFacts with settings
 * and plugins` (superpowers enabled, at 6.4.1), and the user GSD install whose identity module proves it, as
 * `normalizeFacts with GSD candidates` reads it.
 */
const READ: RawFacts = raw({
  repoEntries: [
    { name: '.planning', kind: 'dir', isLink: false },
    { name: 'docs', kind: 'dir', isLink: false },
  ],
  docsEntries: [{ name: 'superpowers', kind: 'dir', isLink: false }],
  settings,
  installedPlugins,
  gsd: [candidate({ identityText: 'const packageName = "@opengsd/gsd-core";', versionText: ' 1.16.0\n' })],
})

describe('golden: /cadre detect without and with --adapters (D-219)', () => {
  test('plain: the report of a read with GSD and superpowers present', () => {
    expect(captureDetect(READ, null, '/repo', false)).toEqual(GOLDEN_DETECT.plain)
  })

  test('adapters: the same report followed by the adapter contract', () => {
    expect(captureDetect(READ, null, '/repo', true)).toEqual(GOLDEN_DETECT.adapters)
  })
})
