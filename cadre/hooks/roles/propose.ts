/**
 * The scan-based role proposal, a layer 4 module: the template roles init proposes for a repo scan, and the reason
 * and the evidence for every role the scan drops or keeps with a note (ROLE-01, D-49, D-85, D-97a). It imports the
 * role template and the types, so init proposes the roles here.
 */
import type { RepoScan, RoleChange, RoleProposal, RoleSpec, ScanFinding, ScanKind, TemplateRoleId } from '../../types'
import { t } from '../locales/t'
import { NO_FRONTEND_REASON, NO_SOURCE_REASON, NO_TESTS_REASON, ROLE_TEMPLATE, roleFromTemplate } from './template'

/** The most evidence paths one change lists. */
const MAX_EVIDENCE_PATHS = 3

/** The findings of these kinds, in finding order. */
function findingsOf(scan: RepoScan, kinds: readonly ScanKind[]): readonly ScanFinding[] {
  return scan.findings.filter(finding => kinds.includes(finding.kind))
}

/** Whether the scan has a finding of any of these kinds. */
function hasFinding(scan: RepoScan, kinds: readonly ScanKind[]): boolean {
  return scan.findings.some(finding => kinds.includes(finding.kind))
}

/** The scanned languages as a sentence part, or `unknown language` when the scan named none. */
function languageText(scan: RepoScan): string {
  if (scan.languages.length === 0) return t('roles.propose.languageText')

  return scan.languages.join(', ')
}

/**
 * The repo-relative paths that justify a change: at most MAX_EVIDENCE_PATHS, in finding order, one per path and one per
 * kind and label, so a finding the scan repeated is listed once.
 */
function evidencePaths(findings: readonly ScanFinding[]): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const finding of findings) {
    if (paths.length >= MAX_EVIDENCE_PATHS) break
    const key = `${finding.kind}:${finding.label}`
    if (seen.has(key) || paths.includes(finding.evidence)) continue
    seen.add(key)
    paths.push(finding.evidence)
  }

  return paths
}

/** A drop: the role leaves the proposal, and the reason is an absence, so it has no evidence. */
function dropped(roleId: TemplateRoleId, reason: string): RoleChange {
  return { roleId, change: 'dropped', reason, evidence: [] }
}

/**
 * BE is dropped only when the scan found no source code at all (D-85). With source but no backend framework it is kept,
 * with the reason that says which framework is missing and the language evidence (D-97a).
 */
function backendChange(scan: RepoScan): RoleChange | null {
  if (!scan.hasSource) return dropped('be', NO_SOURCE_REASON)
  if (hasFinding(scan, ['be'])) return null
  const missing = hasFinding(scan, ['fe']) ? t('roles.propose.backendChange') : t('roles.propose.backendChange2')

  return {
    roleId: 'be',
    change: 'kept',
    reason: t('roles.propose.backendChangeReason', { language: languageText(scan), missing }),
    evidence: evidencePaths(findingsOf(scan, ['lang'])),
  }
}

/** The change the scan makes to one template role, or null when the template stands (D-49). */
function scanChange(id: TemplateRoleId, scan: RepoScan): RoleChange | null {
  switch (id) {
    case 'be':
      return backendChange(scan)
    case 'fe':
      return hasFinding(scan, ['fe']) ? null : dropped('fe', NO_FRONTEND_REASON)
    case 'qa':
      return hasFinding(scan, ['test', 'e2e']) ? null : dropped('qa', NO_TESTS_REASON)
    case 'pm':
    case 'tl':
    case 'security':
      return null
  }
}

/**
 * The roles init proposes for a scan, and the reason for every change the scan made (ROLE-01). The template is walked
 * once in order, so roles and changes both keep template order. PM, TL and Security are always proposed (D-49). FE is
 * dropped without a frontend finding, QA without a test or E2E finding, and BE only without source code (D-85).
 */
export function proposeRoles(scan: RepoScan): RoleProposal {
  const roles: RoleSpec[] = []
  const changes: RoleChange[] = []
  for (const row of ROLE_TEMPLATE) {
    const change = scanChange(row.id, scan)
    if (change !== null) changes.push(change)
    if (change?.change === 'dropped') continue
    roles.push(roleFromTemplate(row))
  }

  return { roles, changes }
}
