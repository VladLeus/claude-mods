import { describe, expect, test } from 'claude-code/testing'

import type { InstructionScan } from '../../../types'
import { sha256Hex } from '../../core/hash'
import { contentContextLine, topicContextLine } from '../../init/stages/instructions'
import { SCREEN_LIST_WORDS } from '../../locales/t'
import { fallbackTopics, topicsPrompt } from '../../suggest/topics'
import { emptySetupScan, entry, link, memIo, memWorld, RECOMMENDED, TOPICS } from '../../testkit'
import type { MemWorld } from '../../testkit'
import { instructionLines } from '../../ui/blocks/instructions'
import { unreadableWarning } from './memories'
import {
  configFileWarning,
  isReadableConfigFile,
  moreDocsWarning,
  morePartsWarning,
  outsideWarning,
  overSizeWarning,
  readInstructionFiles,
  referencedDocs,
  repoImportWarning,
  repoInstructionNames,
  RULES_UNLISTED_WARNING,
  totalCapWarning,
  unfollowedImportWarning,
} from './read'
import type { InstructionSources } from './read'

/** The global CLAUDE.md of the cases: a Security section and a Git section, as the plan's dry run has it. */
const GLOBAL_TEXT = '# Security\nNever commit secrets.\n## Git\nUse signed commits.\n'

/** The config folder of the fixture user, where the global CLAUDE.md lives. */
const CONFIG = '/home/u/.claude'

/**
 * Where the reader reads in the fixtures: the repo /repo, the home /home/u, no CLAUDE_CONFIG_DIR, this chain, no rule
 * file, no AGENTS.md and no memory folder.
 */
function sourcesOf(chain: readonly string[] = []): InstructionSources {
  return { root: '/repo', home: '/home/u', configDir: null, chain, rules: [], hasAgentsMd: false, memoryFolders: [] }
}

/** A world of the fixture user with these files; `over` changes the other fields it names. */
function filesWorld(files: Readonly<Record<string, string>>, over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ files, ...over })
}

/** The file, heading and source of each part a read gave, in read order. */
function placesOf(scan: InstructionScan): (readonly [string, string, string])[] {
  return scan.parts.map(found => [found.file, found.heading, found.source])
}

/** A text of `kib` KiB of the letter x under one heading. */
function kibText(heading: string, kib: number): string {
  return `# ${heading}\n${'x'.repeat(kib * 1024 - heading.length - 3)}`
}

describe('readInstructionFiles', () => {
  test('the global file, its imports depth first, then the chain outermost first, then the chain imports', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: '# G\n@./b.md\n@./a.md\n',
        [`${CONFIG}/a.md`]: '# A\n@./c.md\n',
        [`${CONFIG}/b.md`]: '# B\n',
        [`${CONFIG}/c.md`]: '# C\n',
        '/repo/CLAUDE.md': '# R\nSee @docs/rules.md for the rules.\n',
        '/repo/.claude/CLAUDE.md': '# Local\n',
        '/repo/docs/rules.md': '# Rules\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md', '<repo>/.claude/CLAUDE.md']))
    expect(run.reads).toEqual([
      `${CONFIG}/CLAUDE.md`,
      `${CONFIG}/a.md`,
      `${CONFIG}/c.md`,
      `${CONFIG}/b.md`,
      '/repo/CLAUDE.md',
      '/repo/.claude/CLAUDE.md',
      '/repo/docs/rules.md',
    ])
    expect(placesOf(scan)).toEqual([
      ['~/.claude/CLAUDE.md', 'G', 'global'],
      ['~/.claude/a.md', 'A', 'global'],
      ['~/.claude/c.md', 'C', 'global'],
      ['~/.claude/b.md', 'B', 'global'],
      ['CLAUDE.md', 'R', 'repo'],
      ['.claude/CLAUDE.md', 'Local', 'repo'],
      ['docs/rules.md', 'Rules', 'repo'],
    ])
    expect(scan.parts.map(found => found.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'])
    expect(scan.files).toEqual(placesOf(scan).map(([file]) => file))
    expect(scan.warnings).toEqual([])
  })

  test('a path in the config folder is global and a path in the repo is a repo part, whoever imports it', async () => {
    const files = { [`${CONFIG}/CLAUDE.md`]: '# G\n@/repo/docs/x.md\n', '/repo/docs/x.md': '# X\n' }
    const run = memIo(filesWorld(files), [])
    const scan = await readInstructionFiles(run.io, sourcesOf())
    expect(placesOf(scan)).toEqual([
      ['~/.claude/CLAUDE.md', 'G', 'global'],
      ['docs/x.md', 'X', 'repo'],
    ])
  })

  test(
    'a relative or inside-repo CLAUDE_CONFIG_DIR gives ~/.claude and no warning: ' +
      'the setup scan of the run shows it (D-238, WF-S3)',
    async () => {
      for (const configDir of ['.claude-alt', '/repo/.claude-alt']) {
        const files = { [`${CONFIG}/CLAUDE.md`]: '# G\n', [`${configDir}/CLAUDE.md`]: '# Alt\n' }
        const run = memIo(filesWorld(files), [])
        const scan = await readInstructionFiles(run.io, { ...sourcesOf(), configDir })
        const global = ['~/.claude/CLAUDE.md', 'G', 'global']
        expect([placesOf(scan), scan.warnings]).toEqual([[global], []])
      }
    },
  )

  test('imports are followed at most 3 levels deep', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: '# G\n@./l1.md\n',
        [`${CONFIG}/l1.md`]: '# L1\n@./l2.md\n',
        [`${CONFIG}/l2.md`]: '# L2\n@./l3.md\n',
        [`${CONFIG}/l3.md`]: '# L3\n@./l4.md\n',
        [`${CONFIG}/l4.md`]: '# L4\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf())
    expect(scan.parts.map(found => found.heading)).toEqual(['G', 'L1', 'L2', 'L3'])
    expect(run.reads).not.toContain(`${CONFIG}/l4.md`)
  })

  test('at most 20 imported files are read for the global file, and 20 for the chain', async () => {
    const names = Array.from({ length: 25 }, (_, at) => `i${String(at + 1).padStart(2, '0')}.md`)
    const global = Object.fromEntries(names.map(name => [`${CONFIG}/${name}`, `# ${name}\n`]))
    const repo = Object.fromEntries(names.map(name => [`/repo/${name}`, `# ${name}\n`]))
    const imports = names.map(name => `@${name}`).join('\n')
    const roots = { [`${CONFIG}/CLAUDE.md`]: `# G\n${imports}\n`, '/repo/CLAUDE.md': `# R\n${imports}\n` }
    const run = memIo(filesWorld({ ...global, ...repo, ...roots }), [])
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.parts.filter(found => found.source === 'global')).toHaveLength(21)
    expect(scan.parts.filter(found => found.source === 'repo')).toHaveLength(21)
    expect(run.reads).not.toContain(`${CONFIG}/i21.md`)
    expect(run.reads).not.toContain('/repo/i21.md')
  })

  test('each file is read once: a file imported twice, an import cycle, a chain file already read', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: '# G\n@./a.md\n@./b.md\n@/repo/CLAUDE.md\n',
        [`${CONFIG}/a.md`]: '# A\n@./b.md\n',
        [`${CONFIG}/b.md`]: '# B\n@./a.md\n',
        '/repo/CLAUDE.md': '# R\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.parts.map(found => found.heading)).toEqual(['G', 'A', 'B', 'R'])
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, `${CONFIG}/a.md`, `${CONFIG}/b.md`, '/repo/CLAUDE.md'])
  })

  test('a file over 256 KiB is not split; the read stops at 512 KiB in all and counts the files not read', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: `${kibText('G', 200)}\n@./a-big.md\n@./b-one.md\n@./c-two.md\n@./d-three.md\n`,
        [`${CONFIG}/a-big.md`]: kibText('Big', 300),
        [`${CONFIG}/b-one.md`]: kibText('One', 200),
        [`${CONFIG}/c-two.md`]: kibText('Two', 200),
        [`${CONFIG}/d-three.md`]: kibText('Three', 1),
        '/repo/CLAUDE.md': '# R\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.parts.map(found => found.heading)).toEqual(['G', 'One'])
    expect(scan.warnings).toEqual([
      '~/.claude/a-big.md is over 256 KiB, not split: no role gets it',
      'stopped reading at 512 KiB in total, 3 files not read: no role gets them',
    ])
    expect(run.reads).not.toContain(`${CONFIG}/d-three.md`)
    expect(run.reads).not.toContain('/repo/CLAUDE.md')
  })

  test('one file left unread is counted as 1 file', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: `${kibText('G', 250)}\n@./one.md\n@./two.md\n`,
        [`${CONFIG}/one.md`]: kibText('One', 250),
        [`${CONFIG}/two.md`]: kibText('Two', 20),
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf())
    expect(scan.warnings).toEqual(['stopped reading at 512 KiB in total, 1 file not read: no role gets it'])
  })

  test('a repo file that links out of the repo is refused and never read (readRepoFile)', async () => {
    const world = filesWorld({ '/repo/CLAUDE.md': '# R\n' }, { realPaths: { '/repo/CLAUDE.md': '/home/u/secret.md' } })
    const run = memIo(world, [])
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.parts).toEqual([])
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`])
    expect(scan.warnings).toEqual(['could not read CLAUDE.md: no role gets it'])
  })

  test('a global import outside the repo and the config folder is not read; a chain ancestor is (S2)', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: '# G\n@~/notes/private.md\n',
        '/home/u/notes/private.md': '# Private\n',
        '/home/u/work/CLAUDE.md': '# Work\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['~/work/CLAUDE.md']))
    expect(scan.parts.map(found => found.heading)).toEqual(['G', 'Work'])
    expect(scan.warnings).toEqual([
      '~/notes/private.md is outside the repo and your config folder, not read: no role gets it',
    ])
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, '/home/u/work/CLAUDE.md'])
  })

  test('a repo file importing ~/.claude/.credentials.json never reads it: the import stays in the repo', async () => {
    const credentials = `${CONFIG}/.credentials.json`
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\n@~/.claude/.credentials.json\n@../outside.md\n@docs/in.md\n',
        [credentials]: '{"accessToken":"sk-FAKE-SECRET-0123456789"}',
        '/outside.md': '# Outside\n',
        '/repo/docs/in.md': '# In\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, '/repo/CLAUDE.md', '/repo/docs/in.md'])
    expect(run.reads).not.toContain(credentials)
    expect(scan.parts.map(found => found.heading)).toEqual(['R', 'In'])
    expect(scan.warnings).toEqual([
      '~/.claude/.credentials.json is imported by a repo file and is outside the repo, not read: no role gets it',
      '/outside.md is imported by a repo file and is outside the repo, not read: no role gets it',
    ])
    expect(JSON.stringify(scan)).not.toContain('sk-FAKE-SECRET')
  })

  test('a file the port cannot read gets the could-not-read warning; a missing one is quiet', async () => {
    const world = filesWorld({ [`${CONFIG}/CLAUDE.md`]: '# G\n@./gone.md\n@./broken.md\n' })
    const run = memIo({ ...world, unknownPaths: [`${CONFIG}/broken.md`] }, [])
    const scan = await readInstructionFiles(run.io, sourcesOf())
    expect(scan.warnings).toEqual(['could not read ~/.claude/broken.md: no role gets it'])
    expect(scan.parts.map(found => found.heading)).toEqual(['G'])
  })

  test('parts beyond 120 are not offered and stay with the root session; the prompt lists 120 (S6)', async () => {
    const sections = Array.from({ length: 129 }, (_, at) => `# H${at + 1}\nbody\n`).join('')
    const run = memIo(filesWorld({ [`${CONFIG}/CLAUDE.md`]: sections, '/repo/CLAUDE.md': '# R\n' }), [])
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.parts).toHaveLength(120)
    expect(scan.parts.at(-1)?.heading).toBe('H120')
    expect(scan.files).toEqual(['~/.claude/CLAUDE.md'])
    expect(scan.warnings).toEqual([morePartsWarning(10)])
    expect(morePartsWarning(10)).toBe('10 more parts were not offered: they stay with the root session')
    expect(topicsPrompt(scan.parts, []).split('\n').filter(line => /^P\d+ \| /.test(line))).toHaveLength(120)
  })

  test('a chain CLAUDE.md above the repo is read as a private global part, not its outside import (S2)', async () => {
    const run = memIo(
      filesWorld({
        '/home/u/work/CLAUDE.md': '# Team\nShared rules.\n@./notes.md\n',
        '/home/u/work/notes.md': '# Notes\n',
        '/repo/CLAUDE.md': '# R\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['~/work/CLAUDE.md', '<repo>/CLAUDE.md']))
    expect(placesOf(scan)).toEqual([
      ['~/work/CLAUDE.md', 'Team', 'global'],
      ['CLAUDE.md', 'R', 'repo'],
    ])
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, '/home/u/work/CLAUDE.md', '/repo/CLAUDE.md'])
    expect(scan.warnings).toEqual([outsideWarning('~/work/notes.md')])
  })

  test('every not-read warning says that no role gets the file (S2)', () => {
    expect(unreadableWarning('CLAUDE.md')).toBe('could not read CLAUDE.md: no role gets it')
    expect(overSizeWarning('CLAUDE.md')).toBe('CLAUDE.md is over 256 KiB, not split: no role gets it')
    expect(outsideWarning('/x/a.md')).toBe(
      '/x/a.md is outside the repo and your config folder, not read: no role gets it',
    )
    expect(repoImportWarning('~/a.md')).toBe(
      '~/a.md is imported by a repo file and is outside the repo, not read: no role gets it',
    )
    expect(totalCapWarning(1)).toBe('stopped reading at 512 KiB in total, 1 file not read: no role gets it')
    expect(totalCapWarning(3)).toBe('stopped reading at 512 KiB in total, 3 files not read: no role gets them')
    expect(moreDocsWarning(2)).toBe('2 more referenced docs were not read: no role gets them')
  })

  test('with no config folder nothing global is read, and the chain still is', async () => {
    const run = memIo(filesWorld({ '/repo/CLAUDE.md': '# R\n' }), [])
    const sources = { ...sourcesOf(['<repo>/CLAUDE.md']), home: null }
    const scan = await readInstructionFiles(run.io, sources)
    expect(placesOf(scan)).toEqual([['CLAUDE.md', 'R', 'repo']])
    expect(run.reads).toEqual(['/repo/CLAUDE.md'])
  })

  test('a repo file is followed only to a plain .md file outside .git; no other file is read (M3)', async () => {
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\n@./.env\n@./.git/config\n@./.git/x.md\n@./notes/.hidden.md\n@./data.json\n@./ok.md\n',
        '/repo/.env': 'API_KEY=sk-FAKE-SECRET-0123456789\n',
        '/repo/.git/config': '[remote "origin"]\n',
        '/repo/.git/x.md': '# X\n',
        '/repo/notes/.hidden.md': '# Hidden\n',
        '/repo/data.json': '{}\n',
        '/repo/ok.md': '# Ok\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, '/repo/CLAUDE.md', '/repo/ok.md'])
    expect(placesOf(scan)).toEqual([
      ['CLAUDE.md', 'R', 'repo'],
      ['ok.md', 'Ok', 'repo'],
    ])
    const unfollowed = ['.env', '.git/config', '.git/x.md', 'data.json', 'notes/.hidden.md']
    expect(scan.warnings).toEqual(unfollowed.map(unfollowedImportWarning))
    expect(unfollowedImportWarning('.env')).toBe(
      '.env is linked from a repo file and is a dotfile, under .git/ or not a .md file, not read: no role gets it',
    )
  })

  test('a repo import into .git in any letter case is not read (C9)', async () => {
    const run = memIo(
      filesWorld({ '/repo/CLAUDE.md': '# R\n@./.GIT/notes.md\n', '/repo/.GIT/notes.md': '# Notes\n' }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, '/repo/CLAUDE.md'])
    expect(scan.warnings).toEqual([unfollowedImportWarning('.GIT/notes.md')])
  })

  test('a doc link of a repo file into .git or to a dotfile is not read (M3)', async () => {
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\n[x](.git/a.md) [y](docs/.secret.md) [z](docs/z.md)\n',
        '/repo/.git/a.md': '# A\n',
        '/repo/docs/.secret.md': '# Secret\n',
        '/repo/docs/z.md': '# Z\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, '/repo/CLAUDE.md', '/repo/docs/z.md'])
    expect(scan.warnings).toEqual([unfollowedImportWarning('.git/a.md'), unfollowedImportWarning('docs/.secret.md')])
  })

  test('a global import that is not a plain .md file of the config folder is not read and warns (M2)', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: '# G\n@./settings.json\n@./projects/x/memory/a.md\n',
        [`${CONFIG}/settings.json`]: '{"env":{}}',
        [`${CONFIG}/projects/x/memory/a.md`]: '# A\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf())
    expect(placesOf(scan)).toEqual([['~/.claude/CLAUDE.md', 'G', 'global']])
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`])
    expect(scan.warnings).toEqual([
      configFileWarning('~/.claude/projects/x/memory/a.md'),
      configFileWarning('~/.claude/settings.json'),
    ])
    expect(configFileWarning('~/.claude/settings.json')).toBe(
      '~/.claude/settings.json is not a plain .md file of your config folder ' +
        '(no dot name, not under projects/, cadre/ or plugins/), not read: no role gets it',
    )
  })

  test('isReadableConfigFile takes a plain .md config file outside projects/, cadre/ and plugins/ (M2)', () => {
    const refused = [
      '/h/.claude/settings.json',
      '/h/.claude/.hidden/a.md',
      '/h/.claude/notes/.a.md',
      '/h/.claude/projects/x/a.md',
      '/h/.claude/Cadre/a.md',
      '/h/.claude/plugins/a.md',
      '/h/.claude/a.MD',
      '/h/other/a.md',
    ]
    expect(isReadableConfigFile('/h/.claude/notes/a.md', '/h/.claude')).toBe(true)
    expect(refused.filter(path => isReadableConfigFile(path, '/h/.claude'))).toEqual([])
  })

  test('two repo paths that share their first 125 code points stay two files, shown cleaned (N3)', async () => {
    const stem = 'd'.repeat(125)
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': `# R\n@${stem}x.md\n@${stem}y.md\n`,
        [`/repo/${stem}x.md`]: '# X\n',
        [`/repo/${stem}y.md`]: '# Y\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.files).toEqual(['CLAUDE.md', `${stem}x.md`, `${stem}y.md`])
    expect(scan.parts.map(found => found.file)).toEqual(['CLAUDE.md', `${stem}x.md`, `${stem}y.md`])
    const topics = fallbackTopics(scan)
    expect(topics.map(topic => topic.partIds)).toEqual([['P1'], ['P2'], ['P3']])
    const shownFile = `${'d'.repeat(119)}…`
    expect(instructionLines(scan, topics, new Map()).filter(line => line.startsWith('    from: '))).toEqual([
      '    from: CLAUDE.md > R',
      `    from: ${shownFile} > X`,
      `    from: ${shownFile} > Y`,
    ])
    const contexts = topics.map(topic => topicContextLine(topic, scan.parts, [], SCREEN_LIST_WORDS))
    expect(contexts.filter(line => line.includes(`From: ${'d'.repeat(100)}`))).toHaveLength(2)
    expect(contexts.filter(line => line.includes(`${stem}x.md >`) || line.includes(`${stem}y.md >`))).toEqual([])
    expect(topicsPrompt(scan.parts, [])).toContain(`P2 | ${shownFile} | X | # X`)
  })

  test('a CLAUDE_CONFIG_DIR inside the repo is not the config folder: nothing under it is read (N10)', async () => {
    const run = memIo(filesWorld({ '/repo/.cfg/CLAUDE.md': '# Cfg\n' }), [])
    const scan = await readInstructionFiles(run.io, { ...sourcesOf(), configDir: '/repo/.cfg' })
    expect(scan.parts.filter(found => found.file.startsWith('.cfg/'))).toEqual([])
    expect(run.reads.filter(path => path.startsWith('/repo/.cfg'))).toEqual([])
  })
})

/** The rules folder of the fixture repo. */
const RULES = '/repo/.claude/rules'

/** The sources of sourcesOf with these rule file names, null for a rules folder not listed, and AGENTS.md or not. */
function repoSources(
  chain: readonly string[],
  rules: readonly string[] | null,
  hasAgentsMd: boolean,
): InstructionSources {
  return { ...sourcesOf(chain), rules, hasAgentsMd }
}

describe('rules, AGENTS.md and referenced docs', () => {
  test('referencedDocs gives the relative .md links that land in the repo, once each, in text order', () => {
    const text = [
      'Read [the guide](docs/guide.md), [setup](./docs/setup.md#install) and [notes](../notes.md "Notes").',
      'Again [the guide](docs/guide.md); out of the repo [x](../../outside.md).',
    ].join('\n')
    expect(referencedDocs(text, '/repo/pkg', '/repo')).toEqual([
      '/repo/pkg/docs/guide.md',
      '/repo/pkg/docs/setup.md',
      '/repo/notes.md',
    ])
  })

  test('a line of many unclosed links is read in linear time: no doc, in under 2 s (M1)', () => {
    const started = Date.now()
    expect(referencedDocs('[a](x'.repeat(20_000), '/repo', '/repo')).toEqual([])
    expect(Date.now() - started).toBeLessThanOrEqual(1_999)
  })

  test('a link with a scheme, an absolute path, another extension, only an anchor or a folder is no doc', () => {
    const text = [
      '[web](https://example.com/a.md) [mail](mailto:x@y.md) [abs](/repo/a.md)',
      '[txt](docs/a.txt) [top](#top) [dir](docs/) [query](docs/a.md?raw=1)',
    ].join('\n')
    expect(referencedDocs(text, '/repo', '/repo')).toEqual([])
  })

  test('after the chain: each rule file in name order, then AGENTS.md, then the docs repo files link to', async () => {
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\nRead [the guide](docs/guide.md).\n',
        [`${RULES}/a.md`]: '# A\n',
        [`${RULES}/b.md`]: '# B\nSee [the style](../../docs/style.md).\n',
        '/repo/AGENTS.md': '# Agents\nSee [the guide](docs/guide.md) and [the design](docs/arch.md).\n',
        '/repo/docs/guide.md': '# Guide\n',
        '/repo/docs/style.md': '# Style\n',
        '/repo/docs/arch.md': '# Arch\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, repoSources(['<repo>/CLAUDE.md'], ['b.md', 'a.md'], true))
    expect(run.reads).toEqual([
      `${CONFIG}/CLAUDE.md`,
      '/repo/CLAUDE.md',
      `${RULES}/a.md`,
      `${RULES}/b.md`,
      '/repo/AGENTS.md',
      '/repo/docs/guide.md',
      '/repo/docs/style.md',
      '/repo/docs/arch.md',
    ])
    expect(placesOf(scan)).toEqual([
      ['CLAUDE.md', 'R', 'repo'],
      ['.claude/rules/a.md', 'A', 'repo'],
      ['.claude/rules/b.md', 'B', 'repo'],
      ['AGENTS.md', 'Agents', 'repo'],
      ['docs/guide.md', 'Guide', 'repo'],
      ['docs/style.md', 'Style', 'repo'],
      ['docs/arch.md', 'Arch', 'repo'],
    ])
    expect(scan.warnings).toEqual([])
  })

  test('docs come from the repo files read, one level: a doc a doc links to is not read', async () => {
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\n[a](docs/a.md)\n',
        '/repo/docs/a.md': '# A\n[b](b.md)\n',
        '/repo/docs/b.md': '# B\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.parts.map(found => found.heading)).toEqual(['R', 'A'])
    expect(run.reads).not.toContain('/repo/docs/b.md')
  })

  test('at most 20 docs are read, in first-seen order; the rest are counted in one warning', async () => {
    const names = Array.from({ length: 23 }, (_, at) => `d${String(at + 1).padStart(2, '0')}.md`)
    const docs = Object.fromEntries(names.map(name => [`/repo/docs/${name}`, `# ${name}\n`]))
    const links = names.map(name => `[${name}](docs/${name})`).join('\n')
    const run = memIo(filesWorld({ ...docs, '/repo/CLAUDE.md': `# R\n${links}\n` }), [])
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    const read = names.slice(0, 20).map(name => `docs/${name}`)
    expect(scan.parts.map(found => found.file)).toEqual(['CLAUDE.md', ...read])
    expect(run.reads).not.toContain('/repo/docs/d21.md')
    expect(scan.warnings).toEqual(['3 more referenced docs were not read: no role gets them'])
    expect(moreDocsWarning(3)).toBe('3 more referenced docs were not read: no role gets them')
  })

  test('a doc already read, as a chain import or a rule file, is read once and not counted toward 20', async () => {
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\n@docs/a.md\n[a](docs/a.md) [rule](.claude/rules/x.md) [b](docs/b.md)\n',
        '/repo/docs/a.md': '# A\n',
        [`${RULES}/x.md`]: '# X\n',
        '/repo/docs/b.md': '# B\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, repoSources(['<repo>/CLAUDE.md'], ['x.md'], false))
    expect(scan.parts.map(found => found.heading)).toEqual(['R', 'A', 'X', 'B'])
    expect(run.reads.filter(path => path.startsWith('/repo/'))).toEqual([
      '/repo/CLAUDE.md',
      '/repo/docs/a.md',
      `${RULES}/x.md`,
      '/repo/docs/b.md',
    ])
  })

  test('a rules folder that could not be listed is a warning, and no rule file is read', async () => {
    const run = memIo(filesWorld({ [`${RULES}/a.md`]: '# A\n' }), [])
    const scan = await readInstructionFiles(run.io, repoSources([], null, false))
    expect(scan.warnings).toEqual([RULES_UNLISTED_WARNING])
    expect(RULES_UNLISTED_WARNING).toBe('could not list .claude/rules (treated as unknown)')
    expect(run.reads).not.toContain(`${RULES}/a.md`)
  })

  test('AGENTS.md is read only when it was found before the consent', async () => {
    const run = memIo(filesWorld({ '/repo/AGENTS.md': '# Agents\n' }), [])
    const scan = await readInstructionFiles(run.io, sourcesOf())
    expect([scan.parts, run.reads.includes('/repo/AGENTS.md')]).toEqual([[], false])
  })

  test('a rule file that links out of the repo is refused and never read (readRepoFile)', async () => {
    const world = filesWorld({ [`${RULES}/a.md`]: '# A\n' }, { realPaths: { [`${RULES}/a.md`]: '/home/u/secret.md' } })
    const run = memIo(world, [])
    const scan = await readInstructionFiles(run.io, repoSources([], ['a.md'], false))
    expect([scan.parts, run.reads.includes(`${RULES}/a.md`)]).toEqual([[], false])
    expect(scan.warnings).toEqual(['could not read .claude/rules/a.md: no role gets it'])
  })

  test('a rule file in a sub-folder of .claude/rules is named, counted and read as a part (M4)', async () => {
    const world = memWorld({
      dirs: { [RULES]: [entry('a.md'), entry('frontend', 'dir')], [`${RULES}/frontend`]: [entry('react.md')] },
      files: { [`${RULES}/a.md`]: '# A\n', [`${RULES}/frontend/react.md`]: '# React\n' },
    })
    const names = await repoInstructionNames(memIo(world, []).io, '/repo')
    expect(names).toEqual({ rules: ['a.md', 'frontend/react.md'], hasAgentsMd: false })
    expect(contentContextLine(emptySetupScan(), names)).toContain(', 2 rule files, ')
    const scan = await readInstructionFiles(memIo(world, []).io, repoSources([], names.rules, false))
    expect(placesOf(scan)).toEqual([
      ['.claude/rules/a.md', 'A', 'repo'],
      ['.claude/rules/frontend/react.md', 'React', 'repo'],
    ])
  })

  test('repoInstructionNames lists the .md files of .claude/rules and stats AGENTS.md, reading nothing', async () => {
    const world = memWorld({
      dirs: { [RULES]: [entry('b.md'), entry('a.md'), entry('notes.txt'), entry('sub', 'dir'), link('l.md')] },
      files: { '/repo/AGENTS.md': '# Agents\n', [`${RULES}/a.md`]: 'SENTINEL', [`${RULES}/b.md`]: 'SENTINEL' },
    })
    const run = memIo(world, [])
    expect(await repoInstructionNames(run.io, '/repo')).toEqual({ rules: ['a.md', 'b.md'], hasAgentsMd: true })
    expect([run.reads, run.listed]).toEqual([[], [RULES]])
  })

  test('no rules folder gives no rule file; one that cannot be listed or links out gives null', async () => {
    const none = memIo(memWorld({}), [])
    expect(await repoInstructionNames(none.io, '/repo')).toEqual({ rules: [], hasAgentsMd: false })
    const unknown = memIo(memWorld({ dirs: { [RULES]: [entry('a.md')] }, unknownPaths: [RULES] }), [])
    expect((await repoInstructionNames(unknown.io, '/repo')).rules).toBeNull()
    const linkedOut = { dirs: { [RULES]: [entry('a.md')] }, realPaths: { [RULES]: '/elsewhere/rules' } }
    const outside = memIo(memWorld(linkedOut), [])
    expect((await repoInstructionNames(outside.io, '/repo')).rules).toBeNull()
    expect(outside.listed).toEqual([])
  })
})

describe('part hashes', () => {
  test('every part carries the SHA-256 of its text, its heading line included', async () => {
    const run = memIo(filesWorld({ [`${CONFIG}/CLAUDE.md`]: GLOBAL_TEXT }), [])
    const scan = await readInstructionFiles(run.io, sourcesOf())
    const texts = ['# Security\nNever commit secrets.\n', '## Git\nUse signed commits.\n']
    expect(scan.parts.map(found => found.text)).toEqual(texts)
    const hashes = [await sha256Hex(texts[0] ?? ''), await sha256Hex(texts[1] ?? '')]
    expect(scan.parts.map(found => found.hash)).toEqual(hashes)
  })

  test('the same text in two files gives the same hash, and a changed byte changes it', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: '# Same\nKeep it short.\n',
        '/repo/CLAUDE.md': '# Same\nKeep it short.\n',
        '/repo/.claude/CLAUDE.md': '# Same\nKeep it short!\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md', '<repo>/.claude/CLAUDE.md']))
    const [global, repo, changed] = scan.parts.map(found => found.hash)
    expect([scan.parts.length, global === repo, repo === changed]).toEqual([3, true, false])
    expect(global).toBe(await sha256Hex('# Same\nKeep it short.\n'))
  })

  test('a part of every source has a hash of 64 lowercase hex characters: rules, AGENTS.md and docs', async () => {
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\n[a doc](docs/a.md)\n',
        [`${RULES}/x.md`]: '# X\n',
        '/repo/AGENTS.md': '# Agents\n',
        '/repo/docs/a.md': '# A\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, repoSources(['<repo>/CLAUDE.md'], ['x.md'], true))
    expect(scan.parts.map(found => found.file)).toEqual(['CLAUDE.md', '.claude/rules/x.md', 'AGENTS.md', 'docs/a.md'])
    expect(scan.parts.filter(found => /^[0-9a-f]{64}$/.test(String(found.hash)))).toHaveLength(4)
  })

  test('a hash is in the scan only: the pane and the prompts never carry it', async () => {
    const run = memIo(filesWorld({ [`${CONFIG}/CLAUDE.md`]: GLOBAL_TEXT }), [])
    const scan = await readInstructionFiles(run.io, sourcesOf())
    const hashes = scan.parts.map(found => String(found.hash))
    const shown = [...instructionLines(scan, TOPICS, RECOMMENDED), topicsPrompt(scan.parts, [])].join('\n')
    expect([hashes.every(hash => hash.length === 64), hashes.some(hash => shown.includes(hash))]).toEqual([true, false])
  })
})
