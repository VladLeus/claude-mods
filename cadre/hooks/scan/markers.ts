/**
 * The marker table, a layer 3 module: which dependency name, file, folder or repo path proves a stack, a backend or
 * frontend framework, tests or an E2E setup, the root manifests and source extensions the scan knows, and the findings
 * the walk's entries prove (SCAN-01, D-55, D-137). It imports core, the walk and the types, so the manifest and repo
 * scans match markers here.
 */
import type { ScanFinding, ScanKind } from '../../types'
import { freezeRows } from '../core/freeze'
import type { Seen } from './walk'

/** The language, by display name, of each source file extension; an extension that is not here is not source (D-55). */
export const SOURCE_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  rb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  swift: 'Swift',
  php: 'PHP',
  cs: 'C#',
})

/** A manifest the scan reads beside the package.json files, by the one root file it is read from (D-137). */
export type ManifestKind = 'gemfile' | 'pyproject' | 'requirements' | 'gomod' | 'cargo' | 'composer'

/**
 * The root file each manifest kind is read from (D-137), in the order the scan reads them. Only these names count,
 * and only in the repo root, so no other manifest is ever read.
 */
export const MANIFEST_FILES: Readonly<Record<ManifestKind, string>> = Object.freeze({
  gemfile: 'Gemfile',
  pyproject: 'pyproject.toml',
  requirements: 'requirements.txt',
  gomod: 'go.mod',
  cargo: 'Cargo.toml',
  composer: 'composer.json',
})

/**
 * One row of the marker table (D-55, D-137): what proves a `kind` of finding, shown with `label`. `dep` is a
 * dependency name in a package.json, `file` matches the name of a file, `dir` is the exact name of a folder,
 * `manifest` with `name` is a dependency name the root manifest of that kind lists, and `path` matches the whole
 * repo-relative path of an entry of the `entry` kind that is not a link.
 */
export type MarkerRow = {
  readonly kind: ScanKind
  readonly label: string
  readonly match:
    | { readonly dep: string }
    | { readonly file: RegExp }
    | { readonly dir: string }
    | { readonly manifest: ManifestKind; readonly name: string }
    | { readonly path: RegExp; readonly entry: 'file' | 'dir' }
}

/** A row that a dependency name in a package.json proves; its label is the package name. */
function depRow(kind: ScanKind, dep: string): MarkerRow {
  return { kind, label: dep, match: Object.freeze({ dep }) }
}

/** A row that a file name proves. */
function fileRow(kind: ScanKind, label: string, file: RegExp): MarkerRow {
  return { kind, label, match: Object.freeze({ file }) }
}

/** A row that a folder name proves. */
function dirRow(kind: ScanKind, label: string, dir: string): MarkerRow {
  return { kind, label, match: Object.freeze({ dir }) }
}

/** A row that a dependency name in the root manifest of a kind proves (D-137). */
function manifestRow(kind: ScanKind, label: string, manifest: ManifestKind, name: string): MarkerRow {
  return { kind, label, match: Object.freeze({ manifest, name }) }
}

/** A row that the whole repo-relative path of a file or a folder proves, never a link's (D-137). */
function pathRow(kind: ScanKind, label: string, entry: 'file' | 'dir', path: RegExp): MarkerRow {
  return { kind, label, match: Object.freeze({ path, entry }) }
}

/**
 * The marker table (SCAN-01, D-55, D-137), frozen with every row and match. It holds test file name patterns beside
 * the test configs, because a repo such as this one has many `*.test.ts` files and no jest or vitest config, and must
 * still show tests so QA is not dropped. The manifest rows find the backends and the E2E gems a root manifest names,
 * and the path rows find Rails, its system specs and tests, and Cucumber features by where they sit in the repo. Some
 * facts are found in two places, so their kind and label are shared by two rows; the first evidence the scan meets is
 * kept.
 */
export const MARKER_ROWS: readonly MarkerRow[] = freezeRows([
  depRow('fe', 'react'),
  depRow('fe', 'vue'),
  depRow('fe', 'next'),
  depRow('fe', 'svelte'),
  depRow('fe', '@angular/core'),
  depRow('be', 'express'),
  depRow('be', '@nestjs/core'),
  depRow('be', 'fastify'),
  depRow('be', 'koa'),
  depRow('be', 'hono'),
  manifestRow('be', 'rails', 'gemfile', 'rails'),
  manifestRow('be', 'sinatra', 'gemfile', 'sinatra'),
  manifestRow('be', 'hanami', 'gemfile', 'hanami'),
  manifestRow('be', 'django', 'pyproject', 'django'),
  manifestRow('be', 'flask', 'pyproject', 'flask'),
  manifestRow('be', 'fastapi', 'pyproject', 'fastapi'),
  manifestRow('be', 'django', 'requirements', 'django'),
  manifestRow('be', 'flask', 'requirements', 'flask'),
  manifestRow('be', 'fastapi', 'requirements', 'fastapi'),
  manifestRow('be', 'gin', 'gomod', 'github.com/gin-gonic/gin'),
  manifestRow('be', 'echo', 'gomod', 'github.com/labstack/echo'),
  manifestRow('be', 'fiber', 'gomod', 'github.com/gofiber/fiber'),
  manifestRow('be', 'chi', 'gomod', 'github.com/go-chi/chi'),
  manifestRow('be', 'actix-web', 'cargo', 'actix-web'),
  manifestRow('be', 'axum', 'cargo', 'axum'),
  manifestRow('be', 'rocket', 'cargo', 'rocket'),
  manifestRow('be', 'laravel/framework', 'composer', 'laravel/framework'),
  manifestRow('be', 'symfony', 'composer', 'symfony/framework-bundle'),
  manifestRow('be', 'symfony', 'composer', 'symfony/symfony'),
  depRow('test', 'jest'),
  depRow('test', 'vitest'),
  depRow('test', 'mocha'),
  depRow('e2e', '@playwright/test'),
  depRow('e2e', 'cypress'),
  manifestRow('e2e', 'capybara', 'gemfile', 'capybara'),
  manifestRow('e2e', 'selenium-webdriver', 'gemfile', 'selenium-webdriver'),
  manifestRow('e2e', 'cuprite', 'gemfile', 'cuprite'),
  fileRow('lang', 'JavaScript/TypeScript (package.json)', /^package\.json$/),
  fileRow('lang', 'Ruby (Gemfile)', /^Gemfile$/),
  fileRow('lang', 'Go (go.mod)', /^go\.mod$/),
  fileRow('lang', 'Python (pyproject.toml)', /^pyproject\.toml$/),
  fileRow('lang', 'Rust (Cargo.toml)', /^Cargo\.toml$/),
  fileRow('test', 'Jest config', /^jest\.config\./),
  fileRow('test', 'Vitest config', /^vitest\.config\./),
  fileRow('test', 'RSpec config', /^\.rspec$/),
  fileRow('test', 'pytest config', /^pytest\.ini$/),
  fileRow('test', 'pytest conftest', /^conftest\.py$/),
  fileRow('test', 'JS/TS test files', /\.(test|spec)\.[cm]?[jt]sx?$/),
  fileRow('test', 'Go test files', /_test\.go$/),
  fileRow('test', 'RSpec spec files', /_spec\.rb$/),
  fileRow('test', 'pytest test files', /^test_.+\.py$/),
  fileRow('e2e', 'Playwright config', /^playwright\.config\./),
  fileRow('e2e', 'Cypress config', /^cypress\.config\./),
  dirRow('e2e', 'Cypress folder', 'cypress'),
  pathRow('be', 'rails', 'file', /^config\/application\.rb$/),
  pathRow('e2e', 'Rails system specs', 'dir', /^spec\/system$/),
  pathRow('e2e', 'Rails system tests', 'dir', /^test\/system$/),
  pathRow('e2e', 'Cucumber features', 'file', /^features\/(?:[^/]+\/)?[^/]+\.feature$/),
])

/** The findings so far, one per kind and label. */
export type Findings = Map<string, ScanFinding>

/** Adds a finding unless its kind and label already have one, so the evidence is the first path in walk order. */
export function addFinding(found: Findings, kind: ScanKind, label: string, evidence: string): void {
  const key = `${kind}:${label}`
  if (found.has(key)) return
  found.set(key, { kind, label, evidence })
}

/**
 * Whether a marker row names an entry: a file row by the file's name, a folder row by the folder's name, and a path row
 * by the whole repo-relative path of an entry of its kind that is not a link (D-137).
 */
function rowNames(row: MarkerRow, entry: Seen): boolean {
  if ('file' in row.match) return entry.kind === 'file' && row.match.file.test(entry.name)
  if ('dir' in row.match) return entry.kind === 'dir' && row.match.dir === entry.name
  if ('path' in row.match) return entry.kind === row.match.entry && !entry.isLink && row.match.path.test(entry.path)

  return false
}

/** Adds a finding for every marker file or folder the walk saw, with the path that proves it. */
export function addMarkers(found: Findings, seen: readonly Seen[]): void {
  for (const entry of seen) {
    for (const row of MARKER_ROWS) {
      if (rowNames(row, entry)) addFinding(found, row.kind, row.label, entry.path)
    }
  }
}
