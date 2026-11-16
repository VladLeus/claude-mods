/**
 * The two state files of `.cadre/` as text, a layer 1 module: the parsers of `manifest.json` and `cadre.json` with
 * their field checks, each null for text that is not one (T-02-12). It imports core, paths
 * and the types, so scan, init and start parse the files here with no cycle; scan.ts keeps the reads of the files.
 */
import type { CadreState, FrameworkId, GitPolicy, LaunchStart, Manifest, ManifestEntry, Sizing } from '../../types'
import { isFrameworkId } from '../core/framework-id'
import { isObject, parseJsonValue } from '../core/json'
import { SHA256_HEX } from '../core/names'
import { isRoleId } from '../core/role-id'
import { CONTRACTS } from '../locales/contracts'
import { isSafeRelativePath } from '../paths'

/** A cadre version as the manifest and the state file record it: three numbers joined by dots. */
const VERSION_TEXT = /^\d+\.\d+\.\d+$/

/** Whether a value is a cadre version text: x.y.z, or `unknown` when cadre could not read its own version. */
function isVersionText(value: unknown): value is string {
  return typeof value === 'string' && (value === 'unknown' || VERSION_TEXT.test(value))
}

/** Whether a value is a git policy cadre stores. */
function isGitPolicy(value: unknown): value is GitPolicy {
  return value === 'all' || value === 'definitions' || value === 'ignore'
}

/** One manifest entry, field by field: a safe path, a lowercase hex SHA-256 and a mode of file or exec; else null. */
function manifestEntryOf(value: unknown): ManifestEntry | null {
  if (!isObject(value)) return null
  const { path, sha256, mode } = value
  if (typeof path !== 'string' || !isSafeRelativePath(path)) return null
  if (typeof sha256 !== 'string' || !SHA256_HEX.test(sha256)) return null
  if (mode !== 'file' && mode !== 'exec') return null

  return { path, sha256, mode }
}

/**
 * The text of `.cadre/manifest.json` as a manifest, or null when it is not one (T-02-12): JSON with schema 1, a cadre
 * version, and a list of entries, each with a safe repo-relative path, a lowercase hex SHA-256 and a mode. A path
 * listed twice makes the whole manifest invalid, and a field the contract does not name is dropped.
 */
export function parseManifest(text: string): Manifest | null {
  const value = parseJsonValue(text)?.value
  if (!isObject(value) || value.schema !== 1 || !isVersionText(value.cadreVersion)) return null
  if (!Array.isArray(value.files)) return null

  const files: ManifestEntry[] = []
  const paths = new Set<string>()
  for (const item of value.files) {
    const file = manifestEntryOf(item)
    if (file === null || paths.has(file.path)) return null
    paths.add(file.path)
    files.push(file)
  }

  return { schema: 1, cadreVersion: value.cadreVersion, files }
}

/**
 * A launch start as `.cadre/cadre.json` holds it (A2), or null when it is not one: an object of kind `git-root` or
 * `here`, kept as its kind alone, or of kind `dir` with a string path that isSafeRelativePath takes. A field the
 * contract does not name is dropped.
 */
function launchStartOf(value: unknown): LaunchStart | null {
  if (!isObject(value)) return null
  const { kind, path } = value
  if (kind === 'git-root' || kind === 'here') return { kind }
  if (kind !== 'dir' || typeof path !== 'string' || !isSafeRelativePath(path)) return null

  return { kind: 'dir', path }
}

/** The lowest and highest threshold a sizing block may hold, the range of a score. */
const THRESHOLD_MIN = 0.1
const THRESHOLD_MAX = 1

/**
 * A sizing block as `.cadre/cadre.json` holds it, or null when it is not one: a threshold from 0.1 to 1.0, a framework
 * id for small and for large tickets, and a rubric path that isSafeRelativePath takes.
 */
function sizingOf(value: unknown): Sizing | null {
  if (!isObject(value)) return null
  const { threshold, mapping, rubric } = value
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) return null
  if (threshold < THRESHOLD_MIN || threshold > THRESHOLD_MAX || !isObject(mapping)) return null
  const { small, large } = mapping
  if (!isFrameworkId(small) || !isFrameworkId(large)) return null
  if (typeof rubric !== 'string' || !isSafeRelativePath(rubric)) return null

  return { threshold, mapping: { small, large }, rubric }
}

/** The frameworks recorded for the repo, or null when they are not a list of framework ids, each listed once. */
function frameworksOf(value: unknown): FrameworkId[] | null {
  if (!Array.isArray(value)) return null
  const ids: FrameworkId[] = []
  for (const item of value) {
    if (!isFrameworkId(item) || ids.includes(item)) return null
    ids.push(item)
  }

  return ids
}

/** A recorded docker script: the runner, then a script name an exact permission pattern can hold. */
const DOCKER_SCRIPT = /^(npm run|yarn|pnpm) [A-Za-z0-9:._-]+$/

/** The docker scripts recorded for the repo, or null when they are not a list of runner commands, each listed once. */
function dockerScriptsOf(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const commands: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !DOCKER_SCRIPT.test(item) || commands.includes(item)) return null
    commands.push(item)
  }

  return commands
}

/**
 * The text of `.cadre/cadre.json` as the repo state, or null when it is not one: JSON with schema 1, a cadre version,
 * a framework that is gsd, superpowers, none or null, a git policy, a list of role ids that are each a usable role id
 * (isRoleId: a slug, not reserved) and are not listed twice, a launch start (launchStartOf), and whether init may read
 * ~/.claude.json (a boolean; missing or any other value makes the state null, fail closed). A missing or invalid
 * launch start makes the state null (fail closed). A sizing block, the recorded frameworks and the docker scripts may
 * be absent; present and malformed, they make the state null. A field the contract does not name is dropped.
 */
export function parseCadreState(text: string): CadreState | null {
  const value = parseJsonValue(text)?.value
  if (!isObject(value) || value.schema !== 1 || !isVersionText(value.cadreVersion)) return null
  const { framework, gitPolicy, roles } = value
  if (framework !== null && !isFrameworkId(framework)) return null
  if (!isGitPolicy(gitPolicy) || !Array.isArray(roles)) return null
  const launchStart = launchStartOf(value.launchStart)
  if (launchStart === null) return null
  if (typeof value.readUserMcp !== 'boolean') return null

  const ids: string[] = []
  for (const role of roles) {
    if (typeof role !== 'string' || !isRoleId(role) || ids.includes(role)) return null
    ids.push(role)
  }
  const sizing = value.sizing === undefined ? undefined : sizingOf(value.sizing)
  const frameworks = value.frameworks === undefined ? undefined : frameworksOf(value.frameworks)
  const dockerScripts = value.dockerScripts === undefined ? undefined : dockerScriptsOf(value.dockerScripts)
  if (sizing === null || frameworks === null || dockerScripts === null) return null

  return {
    schema: 1,
    cadreVersion: value.cadreVersion,
    framework,
    gitPolicy,
    roles: ids,
    launchStart,
    readUserMcp: value.readUserMcp,
    ...(sizing === undefined ? {} : { sizing }),
    ...(frameworks === undefined ? {} : { frameworks }),
    ...(dockerScripts === undefined ? {} : { dockerScripts }),
  }
}

/** Whether the text of `.cadre/cadre.json` lists the role id cadre keeps as the sender of its own inbox entries. */
export function listsCadreRole(text: string): boolean {
  const value = parseJsonValue(text)?.value
  const roles = isObject(value) ? value.roles : undefined

  return Array.isArray(roles) && roles.includes(CONTRACTS.cadreSender)
}
