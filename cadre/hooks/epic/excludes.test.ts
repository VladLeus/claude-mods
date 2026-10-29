import { describe, expect, test } from 'claude-code/testing'

import type { HostRun } from '../../types'
import { excludesText, globalExcludesPath, untrackedEntries } from './excludes'

describe('mirroring the main checkout into the epic worktree (D-147, D-148)', () => {
  test('untrackedEntries reads both NUL-ended listings: each entry once, sorted, without its trailing /', () => {
    expect(untrackedEntries('node_modules/\0', '.cadre/\0node_modules/\0')).toEqual(['.cadre', 'node_modules'])
    expect(untrackedEntries('', '')).toEqual([])
  })

  test('excludesText keeps the global excludes, then one /<path> line per link, sorted, and the runtime line', () => {
    const tail = '# cadre links (cadre epic)\n/node_modules\n/.cadre/*/.runtime/\n'

    expect(excludesText('*.log\n', ['node_modules'])).toBe(`*.log\n${tail}`)
    expect(excludesText('*.log', ['node_modules'])).toBe(`*.log\n${tail}`)
    expect(excludesText('', ['node_modules'])).toBe(tail)
    expect(excludesText('', ['thoughts', 'node_modules'])).toContain('\n/node_modules\n/thoughts\n')
  })

  test('excludesText escapes the special characters and trailing spaces of each link line (03.1-W2 S2)', () => {
    expect(excludesText('', ['app/[id]', 'a*b?', 'back\\slash', 'notes  '])).toBe(
      '# cadre links (cadre epic)\n/a\\*b\\?\n/app/\\[id]\n/back\\\\slash\n/notes\\ \\ \n/.cadre/*/.runtime/\n',
    )
  })
})

/** The user's global excludes file, as `git config --global --path core.excludesFile` names it in the specs. */
const GLOBAL_EXCLUDES = '/home/u/.gitignore_global'

describe("the user's global excludes and the reuse mirror (D-147, D-163, D-164)", () => {
  test('the global excludes file is core.excludesFile, else under XDG_CONFIG_HOME, else ~/.config/git/ignore', () => {
    const run = (exitCode: number, stdout: string): HostRun => ({ exitCode, stdout, stderr: '' })
    const unset = run(1, '')

    expect(globalExcludesPath(run(0, `${GLOBAL_EXCLUDES}\n`), unset, '/home/u')).toBe(GLOBAL_EXCLUDES)
    expect(globalExcludesPath(unset, run(0, '/x\n'), '/home/u')).toBe('/x/git/ignore')
    expect(globalExcludesPath(unset, unset, '/home/u')).toBe('/home/u/.config/git/ignore')
    expect(globalExcludesPath(unset, unset, null)).toBeNull()
    expect(globalExcludesPath(run(0, 'relative/ignore\n'), null, '/home/u')).toBe('/home/u/.config/git/ignore')
  })
})
