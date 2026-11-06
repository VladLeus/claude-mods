/**
 * The scans every flow gathers, a layer 3 module: the detect facts, the repo scan and the names-only user-setup scan
 * of one run, and every warning they gave, each once. It imports scan, setup and the types, so init, team and start
 * gather the scans and list their warnings here with no cycle, and none of them reaches into init for them.
 */
import type { InitFacts, InitIo, InitLocations, RepoScan, SetupScan } from '../../types'
import { scanRepo } from './repo'
import { scanSetup } from './setup/setup'

/** What the scans of one run found: the detect facts, the repo scan and the names-only user-setup scan. */
export type Gathered = {
  readonly facts: InitFacts
  readonly repo: RepoScan
  readonly setup: SetupScan
}

/**
 * Runs the scans of one init or regen run through the port, read-only: the detect pipeline, the repo scan of the
 * session root (SCAN-01) and the user-setup scan (SCAN-02), which reads ~/.claude.json only when
 * `isClaudeJsonAllowed` is true, the answer to the consent question (D-58).
 */
export async function gatherScans(
  io: InitIo,
  locations: InitLocations,
  isClaudeJsonAllowed: boolean,
): Promise<Gathered> {
  const facts = await io.facts(locations)
  const repo = await scanRepo(io, locations.root)
  const { root, givenRoot, home, configDir } = locations
  const setup = await scanSetup(io, { root, givenRoot, home, configDir }, isClaudeJsonAllowed)

  return { facts, repo, setup }
}

/**
 * Every warning the scans of one run gave: those of the locations, of the detect facts, of the repo scan and of the
 * setup scan, in that order, each text once where it first comes. Init shows them right after the scan summary, in its
 * side-pane block, and the final review (reviewStep) shows the same list again next to the plan. A secret read guard
 * registered only in local settings is no warning: launch renders the guard from every settings source (D-103).
 */
export function scanWarnings(locations: InitLocations, gathered: Gathered): string[] {
  const all = [
    ...locations.warnings,
    ...gathered.facts.facts.warnings,
    ...gathered.repo.warnings,
    ...gathered.setup.warnings,
  ]

  return Array.from(new Set(all))
}
