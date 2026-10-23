import { describe, expect, test } from 'claude-code/testing'

import { captureFiles } from './capture'
import { GOLDEN_FILES } from './files'
import { inputOf, TEMPLATE_ROLES } from './worlds'

describe('golden: desiredFiles bytes (D-219, C4)', () => {
  test('template: the six template roles on the built-in framework', async () => {
    expect(await captureFiles(inputOf(TEMPLATE_ROLES, 'none'))).toEqual(GOLDEN_FILES.template)
  })

  test('gsd: the six template roles on GSD', async () => {
    expect(await captureFiles(inputOf(TEMPLATE_ROLES, 'gsd'))).toEqual(GOLDEN_FILES.gsd)
  })
})
