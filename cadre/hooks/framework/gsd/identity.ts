/**
 * GSD's identity, a layer 2 module in GSD's framework folder: the files cadre reads to prove a GSD install, the
 * version and runtime identity parsers, the one runtime call a user-level install may get (D-28, WR-01), the GSD
 * facts detection reports, and the proven user-level dir init may run a write through (D-72). It imports core, paths
 * and the types, so facts, init and register.tsx read GSD's identity here.
 */
import type { GsdFact, GsdLocation, GsdReadTarget, InitFacts, RawFacts, RawGsdCandidate } from '../../../types'
import { isObject } from '../../core/json'
import { clean } from '../../core/text'
import { displayPath, MAX_WARNING_CHARS } from '../../paths'

/** Code points a version text keeps; longer text is not a version. */
const MAX_VERSION_CHARS = 40

/**
 * A GSD hook script basename: `gsd-` then 1 to 80 letters, digits and hyphens, then `.js`, `.sh` or `.cjs`. The
 * lookarounds require a whole basename, so `mygsd-x.js` and `gsd-x.js.bak` do not match, and a longer name is not
 * reported.
 */
export const GSD_SCRIPT_PATTERN = /(?<![\w.-])gsd-[a-z0-9-]{1,80}\.(?:js|sh|cjs)(?![\w.-])/g
/** A version as GSD and Claude Code print it: `major.minor.patch` with an optional suffix. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.-]+)?$/
/** The package name GSD declares in its identity module and prints in its runtime identity. */
const GSD_PACKAGE_NAME = '@opengsd/gsd-core'
/**
 * The line the GSD identity module declares its package name on; finding it proves a GSD install. The whole line
 * must match (leading whitespace and a trailing carriage return allowed), so a comment or a longer line does not.
 */
const IDENTITY_SOURCE_PATTERN = /^\s*const packageName = "@opengsd\/gsd-core";\r?$/m
/**
 * The exact opening of the runtime identity output. The closing quote is part of it, so a longer package name
 * such as `@opengsd/gsd-core-evil` is not a match.
 */
const RUNTIME_IDENTITY_PREFIX = `{"packageName":"${GSD_PACKAGE_NAME}"`
/** The locations a GSD candidate may carry; a candidate with any other location is skipped. */
const GSD_LOCATIONS: readonly GsdLocation[] = ['user', 'project']

/** The files to read for one GSD folder: its VERSION, its identity module, and the manifest beside it. */
export function gsdTarget(location: GsdLocation, dir: string, manifestPath: string): GsdReadTarget {
  return {
    location,
    dir,
    versionPath: `${dir}/VERSION`,
    identityPath: `${dir}/bin/lib/package-identity.cjs`,
    manifestPath,
  }
}

/** Whether the identity module's text declares the GSD package name, which proves the install is GSD. */
export function isGsdIdentitySource(text: string | null): boolean {
  return text !== null && IDENTITY_SOURCE_PATTERN.test(text)
}

/**
 * A version text as GSD prints it: trimmed, at most 40 characters, `major.minor.patch` with an optional suffix.
 * Any other text gives null.
 */
export function parseVersionText(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length > MAX_VERSION_CHARS || !VERSION_PATTERN.test(trimmed)) return null

  return trimmed
}

/**
 * The version from the runtime identity command's stdout. Only output that opens with the exact identity object
 * counts; anything else, including text that names the package later on, is refused.
 */
export function parseRuntimeIdentity(stdout: unknown): { version: string } | null {
  if (typeof stdout !== 'string') return null
  const text = stdout.trim()
  if (!text.startsWith(RUNTIME_IDENTITY_PREFIX)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(parsed) || parsed.packageName !== GSD_PACKAGE_NAME) return null
  const version = parseVersionText(parsed.version)

  return version === null ? null : { version }
}

/** The version of a parsed GSD file manifest, when it has a numeric manifestVersion and a valid version. */
export function parseGsdManifest(value: unknown): { version: string } | null {
  if (!isObject(value) || !Number.isFinite(value.manifestVersion)) return null
  const version = parseVersionText(value.version)

  return version === null ? null : { version }
}

/**
 * Why the runtime identity check gave no answer, when cadre knows: `not-built` when the compiled runtime
 * (`bin/lib/cli-exit.cjs`) is missing, so the call was not made (WR-01); `could-not-run` when the call threw, which
 * covers node missing from PATH and a timeout alike (IN-05). It is local to the detect modules, so the shared types
 * file stays as it is.
 */
export type RuntimeProblem = 'not-built' | 'could-not-run'

/** A GSD candidate as register.tsx reads it: the shared raw shape plus the runtime problem, when one is known. */
export type ProbedGsdCandidate = RawGsdCandidate & { readonly runtimeProblem: RuntimeProblem | null }

/** The runtime problems a candidate may carry; any other value counts as no known problem. */
const RUNTIME_PROBLEMS: readonly RuntimeProblem[] = ['not-built', 'could-not-run']

/**
 * The compiled runtime file of a GSD install. When it is missing, gsd-tools would build its runtime and write files on
 * start, so the runtime identity call is not made (WR-01). register.tsx checks it with `$.fs.exists`.
 */
export function runtimeBuiltPath(target: GsdReadTarget): string {
  return `${target.dir}/bin/lib/cli-exit.cjs`
}

/** The runtime identity argv of a GSD folder: node runs its gsd-tools with `runtime-identity --raw`. */
function identityArgvOf(dir: string): string[] {
  return ['node', `${dir}/bin/gsd-tools.cjs`, 'runtime-identity', '--raw']
}

/**
 * The argv that asks a user-level GSD install for its runtime identity, or null. Only the user-level candidate is
 * ever run, and only when it is present, its compiled runtime is built (WR-01), and its identity module does not
 * already prove it. A repo-local candidate is never run: a repo must not get code execution from its own files (D-28).
 * register.tsx runs it with the GSD folder as the working folder, never the repo.
 */
export function runtimeIdentityArgv(
  target: GsdReadTarget,
  identityText: string | null,
  isPresent: boolean,
  isBuilt: boolean,
): string[] | null {
  if (!isRuntimeCallAllowed(target, identityText, isPresent) || !isBuilt) return null

  return identityArgvOf(target.dir)
}

/**
 * Whether an argv is the one runtimeIdentityArgv builds for the GSD folder `cwd`: the same words, in the same order,
 * and no more. register.tsx re-checks every identity argv against this one builder before it runs it, so a
 * collector that asks for another command, or for this one in another folder, never reaches the host (E4).
 */
export function isRuntimeIdentityArgv(argv: readonly string[], cwd: string): boolean {
  const expected = identityArgvOf(cwd)

  return argv.length === expected.length && expected.every((word, at) => argv[at] === word)
}

/**
 * Whether the runtime identity call is allowed before the built check: the candidate is the user-level install, it is
 * present, and its identity module does not already prove it. A repo-local candidate is never allowed (D-28).
 */
export function isRuntimeCallAllowed(target: GsdReadTarget, identityText: string | null, isPresent: boolean): boolean {
  return target.location === 'user' && isPresent && !isGsdIdentitySource(identityText)
}

/**
 * `not-built` when the runtime identity call would be made but the compiled runtime is missing, so it is skipped
 * (WR-01); null otherwise.
 */
export function runtimeSkipProblem(
  target: GsdReadTarget,
  identityText: string | null,
  isPresent: boolean,
  isBuilt: boolean,
): RuntimeProblem | null {
  if (isBuilt || !isRuntimeCallAllowed(target, identityText, isPresent)) return null

  return 'not-built'
}

/**
 * The identity state of one candidate: `absent` when it is not there, `proven` when its identity module or its
 * runtime identity says so, and `unknown` otherwise. A read that failed is unknown, never absent.
 */
function identityOf(candidate: RawGsdCandidate, runtimeProves: boolean): GsdFact['identity'] {
  if (!candidate.isPresent) return 'absent'
  if (runtimeProves || isGsdIdentitySource(candidate.identityText)) return 'proven'

  return 'unknown'
}

/** The version of a candidate: the VERSION text, else the manifest, else the runtime identity. */
function versionOf(candidate: RawGsdCandidate, runtime: { version: string } | null): string | null {
  return (
    parseVersionText(candidate.versionText) ?? parseGsdManifest(candidate.manifest)?.version ?? runtime?.version ?? null
  )
}

/**
 * A host-sent candidate rebuilt field by field, or null when it has no string `dir` or no known location (WR-05).
 * Every other field is checked: `isPresent` and `runtimeTried` count only when exactly true, a text that is not a
 * string is null, and an unknown runtime problem is null. The manifest stays unvalidated; parseGsdManifest checks it.
 */
function usableCandidate(value: unknown): ProbedGsdCandidate | null {
  if (!isObject(value)) return null
  const dir = value.dir
  const location = GSD_LOCATIONS.find(place => place === value.location)
  if (typeof dir !== 'string' || location === undefined) return null

  return {
    location,
    dir,
    isPresent: value.isPresent === true,
    versionText: typeof value.versionText === 'string' ? value.versionText : null,
    identityText: typeof value.identityText === 'string' ? value.identityText : null,
    manifest: value.manifest,
    runtimeStdout: typeof value.runtimeStdout === 'string' ? value.runtimeStdout : null,
    runtimeTried: value.runtimeTried === true,
    runtimeProblem: RUNTIME_PROBLEMS.find(problem => problem === value.runtimeProblem) ?? null,
  }
}

/** The usable candidates of a host-sent list, each rebuilt by usableCandidate; anything else is skipped. */
export function usableCandidates(value: unknown): ProbedGsdCandidate[] {
  if (!Array.isArray(value)) return []

  return value.flatMap(item => {
    const candidate = usableCandidate(item)

    return candidate === null ? [] : [candidate]
  })
}

/** The warning for a candidate nothing proves, with the known runtime problem when there is one (WR-01, IN-05). */
function unprovenWarning(dir: string, problem: RuntimeProblem | null): string {
  const prefix = `could not prove the GSD install at ${dir}`
  if (problem === 'not-built') return `${prefix}: runtime not built (treated as unknown)`
  if (problem === 'could-not-run') {
    return `${prefix}: the identity call could not run (node missing or timed out); treated as unknown`
  }

  return `${prefix} (treated as unknown)`
}

/**
 * One GSD candidate as a fact. The version is the VERSION text, else the manifest, else the runtime identity.
 * A present install that nothing proves adds a warning, which names the install by its cleaned display path and the
 * runtime problem when one is known.
 */
export function gsdFactOf(
  candidate: ProbedGsdCandidate,
  raw: RawFacts,
  configDir: string | null,
  warnings: string[],
): GsdFact {
  const dir = displayPath(candidate.dir, raw.home, raw.root, configDir)
  const runtime = parseRuntimeIdentity(candidate.runtimeStdout)
  const identity = identityOf(candidate, runtime !== null)
  if (identity === 'unknown') {
    warnings.push(clean(unprovenWarning(dir, candidate.runtimeProblem), MAX_WARNING_CHARS))
  }
  const version = versionOf(candidate, runtime)

  return {
    location: candidate.location,
    dir,
    version,
    identity,
    runtimeIdentityTried: candidate.runtimeTried,
  }
}

/**
 * The user-level GSD dir cadre may run a write through (D-28, D-71, D-72): the raw dir the detect pipeline gave, but
 * only when the facts hold a user-level GSD whose identity is proven; null otherwise, so an unproven GSD or the repo's
 * own copy is never run.
 */
export function provenUserDir(initFacts: InitFacts): string | null {
  const isProven = initFacts.facts.gsd.some(fact => fact.location === 'user' && fact.identity === 'proven')

  return isProven ? initFacts.gsdUserDir : null
}
