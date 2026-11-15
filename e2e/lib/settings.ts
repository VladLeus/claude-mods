import { isRecord, isStringList } from './filter.ts'

export type DenyCover = {
  readonly deny: number
  readonly edit: number
  readonly write: number
}

const FOLDER_RULE_RE = /^(Edit|Write)\(\/(\/[^()]*)\/\*\*\)$/

// The rule form is the one cadre writes for a folder, `Edit(//<absolute path>/**)`.
export function denyCoverOf(text: string, folder: string): DenyCover | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const permissions = isRecord(value) ? value.permissions : undefined
  const deny = isRecord(permissions) ? permissions.deny : undefined
  if (!isStringList(deny)) return null
  const target = folder.replace(/\/+$/, '')
  let edit = 0
  let write = 0
  for (const rule of deny) {
    const [, tool, path] = FOLDER_RULE_RE.exec(rule) ?? []
    if (path === undefined) continue
    if (path !== target && !target.startsWith(`${path}/`)) continue
    if (tool === 'Edit') edit += 1
    if (tool === 'Write') write += 1
  }

  return { deny: deny.length, edit, write }
}
