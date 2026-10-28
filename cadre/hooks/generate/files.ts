/**
 * The generated file set, a layer 6 module: every committed file init and regen would write, by path, with its content
 * and mode (PLAN-01, D-66, D-68). It imports the text builders of generate, paths, core and the types, so init, regen,
 * /cadre start and testkit get the file set here.
 */
import type { CadreState, CompiledScope, DesiredFile, InstructionPart, LaunchStart, RoleSpec } from '../../types'
import { compareText } from '../core/text'
import { builtClaudeMdPath, launcherText, rolePath } from '../generate'
import { cadreStatePath, launcherPath, roleJsonPath } from '../paths'
import { cadreJsonText, indexMdText, mcpText, roleClaudeMdText, roleJsonText, roleMdText, settingsText } from './docs'
import { kickoffText } from './kickoff'

/** What desiredFiles generates from. */
export type GenerateInput = {
  /** Every role of the team, in role order: the index lists them all. */
  readonly roles: readonly RoleSpec[]
  /**
   * The compiled scope of each role by role id. The framework a role runs is the one its scope was compiled for
   * (`card.framework`). A role with no scope is skipped.
   */
  readonly scopes: ReadonlyMap<string, CompiledScope>
  /** The repo state init writes as `.cadre/cadre.json`; its `launchStart` is where every launcher starts (A2). */
  readonly state: CadreState
  /** The id of the one role regen re-renders; null for init, which generates every role and the repo state. */
  readonly only: string | null
  /**
   * The instruction parts each role was given, by role id, in read order (G-02-1f Storage split): only those read from
   * the repo go into the role's `.cadre/<id>/CLAUDE.md`. Whenever init passes repoParts every role gets its built
   * file, the header alone with no repo part, so a later hand-out always replaces stale content (02-GAPS-B2 S1).
   * Absent for regen and /cadre start, which then build no such file.
   */
  readonly repoParts?: ReadonlyMap<string, readonly InstructionPart[]>
}

/** The repo-relative path of the index, which lists every role. */
const INDEX_PATH = '.cadre/INDEX.md'

/**
 * The built instructions of one role (G-02-1f Storage split): `.cadre/<id>/CLAUDE.md` from the parts it was given that
 * were read from the repo (roleClaudeMdText). Whenever init passes repoParts every role gets its built file, the
 * header alone with no repo part, so a later hand-out always replaces stale content (02-GAPS-B2 S1); null parts, as
 * regen and /cadre start pass, give none. A part of the global CLAUDE.md is dropped here, so it never reaches a file in
 * the repo (T-02-69).
 */
function builtFiles(id: string, parts: readonly InstructionPart[] | null): DesiredFile[] {
  if (parts === null) return []
  const repo = parts.filter(part => part.source === 'repo')

  return [{ path: builtClaudeMdPath(id), content: roleClaudeMdText(id, repo), mode: 'file' }]
}

/**
 * The files of one role: the five in its folder, its built CLAUDE.md (builtFiles: whenever init passes repoParts every
 * role gets its built file, the header alone with no repo part, so a later hand-out always replaces stale content,
 * 02-GAPS-B2 S1; none for null parts), and its launcher, each with the framework its scope was compiled for, the
 * launcher starting where `start` says. A role with no scope gives none, so nothing is generated from a half-known
 * role.
 */
function roleFiles(
  role: RoleSpec,
  scope: CompiledScope | undefined,
  start: LaunchStart,
  parts: readonly InstructionPart[] | null,
): DesiredFile[] {
  if (scope === undefined) return []

  return [
    { path: roleJsonPath(role.id), content: roleJsonText(role), mode: 'file' },
    { path: rolePath(role.id, 'ROLE.md'), content: roleMdText(role, scope), mode: 'file' },
    { path: rolePath(role.id, 'kickoff.txt'), content: kickoffText(role, scope.card.framework), mode: 'file' },
    { path: rolePath(role.id, 'settings.json'), content: settingsText(scope), mode: 'file' },
    { path: rolePath(role.id, 'mcp.json'), content: mcpText(scope), mode: 'file' },
    ...builtFiles(role.id, parts),
    { path: launcherPath(role.id), content: launcherText(role, scope, start), mode: 'exec' },
  ]
}

/**
 * Every committed file the plan wants (PLAN-01, D-66), sorted by path: for each role its role.json, ROLE.md,
 * kickoff.txt, settings.json and mcp.json under `.cadre/<id>/`, its built `.cadre/<id>/CLAUDE.md` from the parts
 * `repoParts` gives it that were read from the repo (G-02-1f), and its launcher `.cadre/bin/<id>`, which starts where
 * `state.launchStart` says, then `.cadre/INDEX.md` and, for init only, `.cadre/cadre.json`. Whenever init passes
 * repoParts every role gets its built file, the header alone with no repo part, so a later hand-out always replaces
 * stale content (02-GAPS-B2 S1); with repoParts absent (regen, /cadre start) no role gets one. With `only` set (regen,
 * D-68) just that role's files and the index are given, since the index lists every role. Generation is pure: it holds
 * no state between calls, so two runs cannot interleave, and it never changes its input.
 */
export function desiredFiles(input: GenerateInput): DesiredFile[] {
  const { roles, scopes, state, only } = input
  const selected = roles.filter(role => only === null || role.id === only)
  const partsOf = (id: string): readonly InstructionPart[] | null =>
    input.repoParts === undefined ? null : (input.repoParts.get(id) ?? [])
  const files = selected.flatMap(role => roleFiles(role, scopes.get(role.id), state.launchStart, partsOf(role.id)))
  files.push({ path: INDEX_PATH, content: indexMdText(roles, scopes), mode: 'file' })
  if (only === null) files.push({ path: cadreStatePath(), content: cadreJsonText(state), mode: 'file' })

  return files.sort((a, b) => compareText(a.path, b.path))
}
