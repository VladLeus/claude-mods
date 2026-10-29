import { describe, expect, test } from 'claude-code/testing'

import type { RepoScan, ScanFinding, ScanKind } from '../../types'
import { entry, findingOf, leaks, link, memIo, memWorld, SECRET_FIXTURES } from '../testkit'
import type { MemWorld } from '../testkit'
import { MAX_READ_BYTES } from './facts/normalize'
import { cargoDeps, composerDeps, gemfileGems, goModules, pyprojectDeps, requirementsDeps } from './manifests'
import { MANIFEST_FILES, MARKER_ROWS } from './markers'
import type { MarkerRow } from './markers'
import { scanRepo } from './repo'

/** The scan of the repo /repo whose folders, files and links are in memory. */
async function scanOf(over: Partial<MemWorld>): Promise<RepoScan> {
  return scanRepo(memIo(memWorld(over), []).io, '/repo')
}

/** The files read: the zero-byte probe of a `/repo/.cadre` that cannot be listed reads nothing, so it is left out. */
function fileReads(reads: readonly string[]): string[] {
  return reads.filter(path => path !== '/repo/.cadre')
}

/** A package.json text with these runtime dependencies. */
function packageOf(dependencies: Readonly<Record<string, string>>): string {
  return JSON.stringify({ name: 'x', dependencies })
}

/** A marker row's match as text, so two rows can be compared: what kind of match it is and what it matches. */
function matchText(match: MarkerRow['match']): string {
  if ('dep' in match) return `dep ${match.dep}`
  if ('file' in match) return `file ${match.file.source}`
  if ('dir' in match) return `dir ${match.dir}`
  if ('manifest' in match) return `manifest ${match.manifest} ${match.name}`

  return `path ${match.entry} ${match.path.source}`
}

/**
 * A trainual-like Rails repo (02-UAT test 1): a root Gemfile with gem 'rails', a package.json with react, an .rspec,
 * and Ruby code under app/.
 */
const RAILS_REPO: Partial<MemWorld> = {
  dirs: {
    '/repo': [entry('.rspec'), entry('Gemfile'), entry('app', 'dir'), entry('package.json')],
    '/repo/app': [entry('models', 'dir')],
    '/repo/app/models': [entry('user.rb')],
  },
  files: {
    '/repo/Gemfile': ["source 'https://rubygems.org'", '', "gem 'rails', '8.1.3.1'", "gem 'pg'"].join('\n'),
    '/repo/package.json': packageOf({ react: '^18.0.0' }),
  },
}

describe('root manifests (G-02-1c)', () => {
  test('MANIFEST_FILES names the one root file each manifest kind is read from, and is frozen (D-137)', () => {
    expect(MANIFEST_FILES).toEqual({
      gemfile: 'Gemfile',
      pyproject: 'pyproject.toml',
      requirements: 'requirements.txt',
      gomod: 'go.mod',
      cargo: 'Cargo.toml',
      composer: 'composer.json',
    })
    expect(Object.isFrozen(MANIFEST_FILES)).toBe(true)
  })

  test('gemfileGems gives the name of a gem line in single or double quotes, with or without a version', () => {
    expect(gemfileGems("gem 'rails', '~> 7.1'")).toEqual(['rails'])
    expect(gemfileGems('gem "rails"')).toEqual(['rails'])
    expect(gemfileGems("gem  'rails'\r")).toEqual(['rails'])
  })

  test('gemfileGems reads an indented gem line inside a group block', () => {
    const text = ["source 'https://rubygems.org'", 'group :development, :test do', "  gem 'rails'", 'end'].join('\n')

    expect(gemfileGems(text)).toEqual(['rails'])
  })

  test('gemfileGems skips a commented gem line and every line that is not a gem line', () => {
    expect(gemfileGems("# gem 'rails'")).toEqual([])
    expect(gemfileGems("  # gem 'rails'")).toEqual([])
    const others = ["source 'https://rubygems.org'", "ruby '3.3.0'", 'gemspec', "gems 'rails'", 'gem rails']
    expect(gemfileGems([...others, "gem 'a b'"].join('\n'))).toEqual([])
  })

  test('gemfileGems gives the names in file order, each once, and needs the same quote on both sides', () => {
    const text = ["gem 'pg'", 'gem "rails"', "gem 'pg', '1.5'", "gem 'selenium-webdriver'", `gem 'mixed"`].join('\n')

    expect(gemfileGems(text)).toEqual(['pg', 'rails', 'selenium-webdriver'])
  })

  test('the Gemfile rows find Rails, Sinatra and Hanami as the backend, each labelled by its gem', () => {
    const isGemfileRow = (row: MarkerRow): boolean => 'manifest' in row.match && row.match.manifest === 'gemfile'
    const rows = MARKER_ROWS.filter(row => row.kind === 'be' && isGemfileRow(row))

    expect(rows.map(row => [row.label, row.match])).toEqual([
      ['rails', { manifest: 'gemfile', name: 'rails' }],
      ['sinatra', { manifest: 'gemfile', name: 'sinatra' }],
      ['hanami', { manifest: 'gemfile', name: 'hanami' }],
    ])
  })

  test("a trainual-like repo, gem 'rails' in the root Gemfile beside react, scans as the backend rails", async () => {
    const scan = await scanOf(RAILS_REPO)

    expect(scan.findings).toEqual([
      { kind: 'be', label: 'rails', evidence: 'Gemfile' },
      { kind: 'fe', label: 'react', evidence: 'package.json' },
      { kind: 'lang', label: 'JavaScript/TypeScript (package.json)', evidence: 'package.json' },
      { kind: 'lang', label: 'Ruby (Gemfile)', evidence: 'Gemfile' },
      { kind: 'test', label: 'RSpec config', evidence: '.rspec' },
    ])
    expect(scan.warnings).toEqual([])
  })

  test('Sinatra and Hanami in the root Gemfile are backends too; a gem no row names adds nothing', async () => {
    const scan = await scanOf({
      dirs: { '/repo': [entry('Gemfile')] },
      files: { '/repo/Gemfile': ["gem 'sinatra'", 'gem "hanami", "~> 2.1"', "gem 'puma'"].join('\n') },
    })

    expect(scan.findings).toEqual([
      { kind: 'be', label: 'hanami', evidence: 'Gemfile' },
      { kind: 'be', label: 'sinatra', evidence: 'Gemfile' },
      { kind: 'lang', label: 'Ruby (Gemfile)', evidence: 'Gemfile' },
    ])
  })

  test('a commented gem rails gives no backend', async () => {
    const scan = await scanOf({ dirs: { '/repo': [entry('Gemfile')] }, files: { '/repo/Gemfile': "# gem 'rails'" } })

    expect(findingOf(scan, 'be', 'rails')).toBeUndefined()
    expect(scan.warnings).toEqual([])
  })

  test('the root Gemfile is read after the package.json files, and a Gemfile one folder down never', async () => {
    const run = memIo(
      memWorld({
        dirs: {
          '/repo': [entry('Gemfile'), entry('api', 'dir'), entry('package.json')],
          '/repo/api': [entry('Gemfile'), entry('package.json')],
        },
        files: {
          '/repo/Gemfile': "gem 'rails'",
          '/repo/api/Gemfile': "gem 'sinatra'",
          '/repo/api/package.json': packageOf({}),
          '/repo/package.json': packageOf({}),
        },
      }),
      [],
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(fileReads(run.reads)).toEqual(['/repo/package.json', '/repo/api/package.json', '/repo/Gemfile'])
    expect(findingOf(scan, 'be', 'rails')).toEqual({ kind: 'be', label: 'rails', evidence: 'Gemfile' })
    expect(findingOf(scan, 'be', 'sinatra')).toBeUndefined()
  })

  test('a folder named Gemfile is not read as a manifest', async () => {
    const run = memIo(memWorld({ dirs: { '/repo': [entry('Gemfile', 'dir')], '/repo/Gemfile': [] } }), [])
    const scan = await scanRepo(run.io, '/repo')

    expect(fileReads(run.reads)).toEqual([])
    expect(scan.warnings).toEqual([])
  })

  test('a Gemfile that links out of the repo is not read and gives a could not read warning (T-02-57)', async () => {
    const run = memIo(
      memWorld({
        dirs: { '/repo': [link('Gemfile')] },
        files: { '/repo/Gemfile': "gem 'rails'" },
        realPaths: { '/repo/Gemfile': '/elsewhere/Gemfile' },
      }),
      [],
    )
    const scan = await scanRepo(run.io, '/repo')

    expect(fileReads(run.reads)).toEqual([])
    expect(scan.warnings).toEqual(['could not read Gemfile (treated as unknown)'])
    expect(scan.findings).toEqual([])
  })

  test('a Gemfile over the read cap, or one that cannot be read, gives the could not read warning', async () => {
    const huge = await scanOf({
      dirs: { '/repo': [entry('Gemfile')] },
      files: { '/repo/Gemfile': `gem 'rails'\n${'#'.repeat(MAX_READ_BYTES)}` },
    })
    const unreadable = await scanOf({ dirs: { '/repo': [entry('Gemfile')] }, unknownPaths: ['/repo/Gemfile'] })

    expect(huge.warnings).toEqual(['could not read Gemfile (treated as unknown)'])
    expect(findingOf(huge, 'be', 'rails')).toBeUndefined()
    expect(unreadable.warnings).toEqual(['could not read Gemfile (treated as unknown)'])
  })

  test('only the names of gems a row names are kept: no version, source or other Gemfile text (T-02-57)', async () => {
    const text = [
      `source 'https://${SECRET_FIXTURES[0]}@gems.example'`,
      `gem 'rails', '${SECRET_FIXTURES[1]}'`,
      `gem '${SECRET_FIXTURES[3]}'`,
      `gem 'private', git: 'https://${SECRET_FIXTURES[2]}@git.example/private.git'`,
    ].join('\n')
    const scan = await scanOf({ dirs: { '/repo': [entry('Gemfile')] }, files: { '/repo/Gemfile': text } })

    expect(findingOf(scan, 'be', 'rails')).toEqual({ kind: 'be', label: 'rails', evidence: 'Gemfile' })
    expect(leaks(JSON.stringify(scan), SECRET_FIXTURES)).toEqual([])
  })
})

/** The findings of one kind, in scan order. */
function findingsOfKind(scan: RepoScan, kind: ScanKind): ScanFinding[] {
  return scan.findings.filter(finding => finding.kind === kind)
}

/** The scan of a repo whose root holds only this one file, with this text. */
async function scanOfFile(name: string, text: string): Promise<RepoScan> {
  return scanOf({ dirs: { '/repo': [entry(name)] }, files: { [`/repo/${name}`]: text } })
}

describe('manifest parsers (G-02-1c)', () => {
  test('pyprojectDeps reads the [project] dependencies on one line: each name lowercased, with _ as -', () => {
    const text = ['[project]', 'name = "app"', 'dependencies = ["Django>=4.2", "fastapi[all]", "typing_extensions"]']

    expect(pyprojectDeps(text.join('\n'))).toEqual(['django', 'fastapi', 'typing-extensions'])
  })

  test('pyprojectDeps reads [project] dependencies over several lines, and skips a commented one', () => {
    const text = [
      '[project]',
      'dependencies = [',
      '  "flask>=3",  # the web app',
      "  'requests',",
      '  # "django",',
      ']',
      'version = "1.0"',
      'keywords = ["django"]',
    ].join('\n')

    expect(pyprojectDeps(text)).toEqual(['flask', 'requests'])
  })

  test('pyprojectDeps reads every key before = in [tool.poetry.dependencies], in file order and once each', () => {
    const text = [
      '[tool.poetry.dependencies]',
      'python = "^3.11"',
      'Django = "^4.2"',
      'fastapi = { version = "^0.110", extras = ["all"] }',
      '"flask" = "^3"',
      'django = "^4.2"',
      '# celery = "^5"',
    ].join('\n')

    expect(pyprojectDeps(text)).toEqual(['python', 'django', 'fastapi', 'flask'])
  })

  test('pyprojectDeps reads no other table: the build system, optional dependencies, poetry groups, tools', () => {
    const text = [
      '[build-system]',
      'requires = ["setuptools", "django"]',
      '[project.optional-dependencies]',
      'web = ["flask"]',
      '[tool.poetry.group.dev.dependencies]',
      'fastapi = "^0.110"',
      '[tool.ruff]',
      'dependencies = ["fastapi"]',
    ].join('\n')

    expect(pyprojectDeps(text)).toEqual([])
  })

  test('requirementsDeps gives the name of each requirement line, lowercased, with _ as -', () => {
    const text = ['Django==4.2.1', 'flask>=3 ; python_version >= "3.9"', 'fastapi[all]', 'typing_extensions', '', ' x']

    expect(requirementsDeps(text.join('\n'))).toEqual(['django', 'flask', 'fastapi', 'typing-extensions', 'x'])
  })

  test('requirementsDeps skips every line that starts with # or -, such as -r base.txt and # flask', () => {
    const skipped = ['-r base.txt', '# flask', '--index-url https://example.org/simple', '-e .', '  # django']

    expect(requirementsDeps([...skipped, 'Flask', 'flask'].join('\n'))).toEqual(['flask'])
  })

  test('goModules gives the module of a require line, with a trailing /v<digits> removed', () => {
    expect(goModules('require github.com/labstack/echo/v4 v4.11.0')).toEqual(['github.com/labstack/echo'])
    expect(goModules('require gopkg.in/yaml.v3 v3.0.1')).toEqual(['gopkg.in/yaml.v3'])
  })

  test('goModules reads every line of a require block; comments, replace and the module line give nothing', () => {
    const text = [
      'module example.com/app',
      '',
      'go 1.22',
      '',
      'require (',
      '  github.com/gin-gonic/gin v1.9.1',
      '  // github.com/go-chi/chi/v5 v5.0.10',
      '  github.com/gofiber/fiber/v2 v2.52.0 // indirect',
      ')',
      '',
      'replace github.com/go-chi/chi => ../chi',
      'require github.com/gin-gonic/gin v1.9.1',
    ].join('\n')

    expect(goModules(text)).toEqual(['github.com/gin-gonic/gin', 'github.com/gofiber/fiber'])
  })

  test('cargoDeps gives every key before = in [dependencies] and the name of every [dependencies.<name>] table', () => {
    const text = [
      '[package]',
      'name = "app"',
      '',
      '[dependencies]',
      'actix-web = "4"',
      'serde = { version = "1", features = ["derive"] }',
      '"axum" = "0.7"',
      'tokio.workspace = true',
      '# rocket = "0.5"',
      '',
      '[dependencies.rocket]',
      'version = "0.5"',
      '',
      '[dev-dependencies]',
      'mockall = "0.12"',
    ].join('\n')

    expect(cargoDeps(text)).toEqual(['actix-web', 'serde', 'axum', 'tokio', 'rocket'])
  })

  test('composerDeps gives the keys of require and require-dev, in file order and once each', () => {
    const text = JSON.stringify({
      name: 'acme/app',
      require: { php: '^8.2', 'laravel/framework': '^11.0' },
      'require-dev': { 'phpunit/phpunit': '^11.0', php: '^8.2' },
      suggest: { 'symfony/symfony': 'x' },
    })

    expect(composerDeps(text)).toEqual(['php', 'laravel/framework', 'phpunit/phpunit'])
  })

  test('composerDeps is null for a text that is not a JSON object, so the scan warns', () => {
    for (const text of ['{ not json', '[]', 'null', '"x"']) {
      expect(composerDeps(text)).toBeNull()
    }
  })

  test('the manifest rows map each framework of each root manifest to its backend label (D-137)', () => {
    const rows = MARKER_ROWS.filter(row => row.kind === 'be' && 'manifest' in row.match)

    expect(rows.map(row => `${row.label} <- ${matchText(row.match)}`)).toEqual([
      'rails <- manifest gemfile rails',
      'sinatra <- manifest gemfile sinatra',
      'hanami <- manifest gemfile hanami',
      'django <- manifest pyproject django',
      'flask <- manifest pyproject flask',
      'fastapi <- manifest pyproject fastapi',
      'django <- manifest requirements django',
      'flask <- manifest requirements flask',
      'fastapi <- manifest requirements fastapi',
      'gin <- manifest gomod github.com/gin-gonic/gin',
      'echo <- manifest gomod github.com/labstack/echo',
      'fiber <- manifest gomod github.com/gofiber/fiber',
      'chi <- manifest gomod github.com/go-chi/chi',
      'actix-web <- manifest cargo actix-web',
      'axum <- manifest cargo axum',
      'rocket <- manifest cargo rocket',
      'laravel/framework <- manifest composer laravel/framework',
      'symfony <- manifest composer symfony/framework-bundle',
      'symfony <- manifest composer symfony/symfony',
    ])
  })

  test('pyproject.toml finds Django, Flask and FastAPI, with the file as evidence', async () => {
    const scan = await scanOfFile('pyproject.toml', '[project]\ndependencies = ["Django>=5", "flask", "fastapi"]')

    expect(findingsOfKind(scan, 'be')).toEqual([
      { kind: 'be', label: 'django', evidence: 'pyproject.toml' },
      { kind: 'be', label: 'fastapi', evidence: 'pyproject.toml' },
      { kind: 'be', label: 'flask', evidence: 'pyproject.toml' },
    ])
    expect(scan.warnings).toEqual([])
  })

  test('requirements.txt finds Django, Flask and FastAPI, with the file as evidence', async () => {
    const scan = await scanOfFile('requirements.txt', 'Django==5.0\nFlask>=3\nfastapi[all]\n')

    expect(findingsOfKind(scan, 'be')).toEqual([
      { kind: 'be', label: 'django', evidence: 'requirements.txt' },
      { kind: 'be', label: 'fastapi', evidence: 'requirements.txt' },
      { kind: 'be', label: 'flask', evidence: 'requirements.txt' },
    ])
  })

  test('a requirements.txt line -r base.txt and a line # flask give nothing', async () => {
    const scan = await scanOfFile('requirements.txt', '-r base.txt\n# flask\n')

    expect(scan.findings).toEqual([])
    expect(scan.warnings).toEqual([])
  })

  test('go.mod finds gin, echo, fiber and chi, a major version suffix included', async () => {
    const lines = [
      'require (',
      '\tgithub.com/gin-gonic/gin v1.9.1',
      '\tgithub.com/gofiber/fiber/v2 v2.52.0',
      '\tgithub.com/go-chi/chi/v5 v5.0.10',
      ')',
    ]
    const scan = await scanOfFile('go.mod', [...lines, 'require github.com/labstack/echo/v4 v4.11.0'].join('\n'))

    expect(findingsOfKind(scan, 'be')).toEqual([
      { kind: 'be', label: 'chi', evidence: 'go.mod' },
      { kind: 'be', label: 'echo', evidence: 'go.mod' },
      { kind: 'be', label: 'fiber', evidence: 'go.mod' },
      { kind: 'be', label: 'gin', evidence: 'go.mod' },
    ])
  })

  test('go.mod with require github.com/labstack/echo/v4 v4.11.0 gives echo', async () => {
    const scan = await scanOfFile('go.mod', 'module example.com/app\n\nrequire github.com/labstack/echo/v4 v4.11.0\n')

    expect(findingsOfKind(scan, 'be')).toEqual([{ kind: 'be', label: 'echo', evidence: 'go.mod' }])
  })

  test('Cargo.toml finds actix-web, axum and rocket, with the file as evidence', async () => {
    const text = ['[dependencies]', 'actix-web = "4"', 'axum = "0.7"', '', '[dependencies.rocket]', 'version = "0.5"']
    const scan = await scanOfFile('Cargo.toml', text.join('\n'))

    expect(findingsOfKind(scan, 'be')).toEqual([
      { kind: 'be', label: 'actix-web', evidence: 'Cargo.toml' },
      { kind: 'be', label: 'axum', evidence: 'Cargo.toml' },
      { kind: 'be', label: 'rocket', evidence: 'Cargo.toml' },
    ])
  })

  test('composer.json finds laravel/framework, and symfony from either Symfony package', async () => {
    const laravel = await scanOfFile('composer.json', JSON.stringify({ require: { 'laravel/framework': '^11' } }))
    const bundle = await scanOfFile('composer.json', JSON.stringify({ require: { 'symfony/framework-bundle': '7' } }))
    const full = await scanOfFile('composer.json', JSON.stringify({ 'require-dev': { 'symfony/symfony': '7' } }))

    expect(findingsOfKind(laravel, 'be')).toEqual([
      { kind: 'be', label: 'laravel/framework', evidence: 'composer.json' },
    ])
    expect(findingsOfKind(bundle, 'be')).toEqual([{ kind: 'be', label: 'symfony', evidence: 'composer.json' }])
    expect(findingsOfKind(full, 'be')).toEqual([{ kind: 'be', label: 'symfony', evidence: 'composer.json' }])
  })

  test('a composer.json that is not JSON gives the could not parse warning and no finding', async () => {
    const scan = await scanOfFile('composer.json', '{ "require": ')

    expect(scan.warnings).toEqual(['could not parse composer.json as JSON (treated as unknown)'])
    expect(scan.findings).toEqual([])
  })

  test('config/application.rb alone proves Rails, with the file as evidence', async () => {
    const scan = await scanOf({
      dirs: { '/repo': [entry('config', 'dir')], '/repo/config': [entry('application.rb'), entry('routes.rb')] },
    })

    expect(findingsOfKind(scan, 'be')).toEqual([{ kind: 'be', label: 'rails', evidence: 'config/application.rb' }])
  })

  test('an application.rb anywhere else, or a link at config/application.rb, is no proof of Rails', async () => {
    const scan = await scanOf({
      dirs: {
        '/repo': [entry('application.rb'), entry('app', 'dir'), entry('config', 'dir')],
        '/repo/app': [entry('config', 'dir')],
        '/repo/app/config': [entry('application.rb')],
        '/repo/config': [{ ...entry('application.rb'), isLink: true }],
      },
    })

    expect(findingsOfKind(scan, 'be')).toEqual([])
  })

  test('every root manifest is read after the package.json files, one at a time, in MANIFEST_FILES order', async () => {
    const names = ['package.json', ...Object.values(MANIFEST_FILES)].sort()
    const files = Object.fromEntries(names.map(name => [`/repo/${name}`, '{}']))
    const run = memIo(memWorld({ dirs: { '/repo': names.map(name => entry(name)) }, files }), [])
    await scanRepo(run.io, '/repo')

    expect(fileReads(run.reads)).toEqual([
      '/repo/package.json',
      '/repo/Gemfile',
      '/repo/pyproject.toml',
      '/repo/requirements.txt',
      '/repo/go.mod',
      '/repo/Cargo.toml',
      '/repo/composer.json',
    ])
  })

  test('a manifest one folder down is never read', async () => {
    const names = Object.values(MANIFEST_FILES)
    const files = Object.fromEntries(names.map(name => [`/repo/api/${name}`, 'django\n']))
    const dirs = { '/repo': [entry('api', 'dir')], '/repo/api': names.map(name => entry(name)) }
    const run = memIo(memWorld({ dirs, files }), [])
    const scan = await scanRepo(run.io, '/repo')

    expect(fileReads(run.reads)).toEqual([])
    expect(findingsOfKind(scan, 'be')).toEqual([])
  })

  test('each root manifest that cannot be read gives its own could not read warning, never an absence', async () => {
    const names = Object.values(MANIFEST_FILES)
    const scan = await scanOf({
      dirs: { '/repo': names.map(name => entry(name)) },
      unknownPaths: names.map(name => `/repo/${name}`),
    })

    expect(scan.warnings).toEqual(names.map(name => `could not read ${name} (treated as unknown)`))
  })
})
