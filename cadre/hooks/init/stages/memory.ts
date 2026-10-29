/**
 * The instruction and memory stage of init (D-63, D-100, D-136), a layer 10 module: one question per instruction
 * group the scan found, in the order the global CLAUDE.md, the auto-memories, the project CLAUDE.md, with the team's
 * role ids on its second line (memoryContextLine), and memoryStep, which gives each role the groups it was given, by
 * name only; and the None and All roles buttons and the refusal list of every question on which roles get an item
 * (ROLE_LIST_OPTIONS, roleListAccepts), which the assignment questions read too. Pure: it asks through the InitIo
 * port it is given, imports init/answers, ui/ask and the duration and model stages, and never imports init.ts, which
 * imports it, or init/run.
 */
import type { InitIo, InstructionGroup, RoleSpec, SetupScan } from '../../../types'
import { accepted, ASK_HEADERS, askChoice, choiceResult, quotedLabels, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import { ALL_OPTION, memoryQuestion, NONE_OPTION, parseRoleList } from '../answers'
import { idsOf } from './duration'
import { teamContextLine } from './model'

/** The buttons of every question on which roles get an item: no role or every role; a list is typed under "Other". */
export const ROLE_LIST_OPTIONS: readonly string[] = Object.freeze([NONE_OPTION, ALL_OPTION])

/** What a question on which roles get an item takes, as its refusal lists it: a button or the team's ids (D-136). */
export function roleListAccepts(roles: readonly RoleSpec[]): string {
  return `${quotedLabels(ROLE_LIST_OPTIONS)}, or role ids from: ${idsOf(roles)}`
}

/** The instruction groups in the order init asks about them and a role stores them (D-63). */
const INSTRUCTION_ORDER: readonly InstructionGroup[] = Object.freeze([
  'global-claude-md',
  'auto-memory',
  'project-claude-md',
])

/** Why init cancels when a question on which roles get instructions or memories is dismissed or not answered (A1). */
export const MEMORY_DISMISSED_REASON =
  'A question on which roles get instructions or memories was dismissed or not answered.'

/** The context line of an instruction or memory question (D-136): the team's role ids, and that no content is shown. */
export function memoryContextLine(roles: readonly RoleSpec[]): string {
  return `${teamContextLine(roles)} Their content is never shown or committed.`
}

/**
 * The names the question of an instruction group shows, or null when the scan did not find the group, so it is not
 * asked: none for the global CLAUDE.md, which its label names, the file names of the auto-memories, and the CLAUDE.md
 * files of the chain in display form (D-63, D-100). These are names only: no file is read.
 */
function groupNames(group: InstructionGroup, setup: SetupScan): readonly string[] | null {
  switch (group) {
    case 'global-claude-md':
      return setup.hasGlobalClaudeMd ? [] : null
    case 'auto-memory':
      return setup.memoryFiles.length > 0 ? setup.memoryFiles : null
    case 'project-claude-md':
      return setup.claudeMd.length > 0 ? setup.claudeMd : null
  }
}

/**
 * The instruction and memory step (D-63, D-100). For each group the scan found, in the order the global
 * ~/.claude/CLAUDE.md, the auto-memories for this repo, the project CLAUDE.md, one question names the group and its
 * files and asks which roles get it (memoryQuestion), with the team's role ids and that no content is shown on its
 * second line (memoryContextLine, D-136), answered with None, All roles or a typed list of role ids or titles
 * (parseRoleList), and an answer that names no role list is asked again with why on top; a group the scan did not find
 * is not asked. Each role's `instructions` becomes the groups it was given, in that order, so the answers decide the
 * whole list. Only an answer to every question gives roles: a dismissal gives the cancel reason
 * MEMORY_DISMISSED_REASON, and MAX_ASKS answers it cannot read at one question NO_USABLE_ANSWER_REASON (A1). No file is
 * read and no content is shown; the roles it is given never change.
 */
export async function memoryStep(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
): Promise<StepResult<readonly RoleSpec[]>> {
  const parse = (answer: string): readonly string[] | null => parseRoleList(answer, roles)
  const accepts = roleListAccepts(roles)
  const given = new Map<InstructionGroup, readonly string[]>()
  for (const group of INSTRUCTION_ORDER) {
    const names = groupNames(group, setup)
    if (names === null) continue
    const spec = { options: ROLE_LIST_OPTIONS, header: ASK_HEADERS.memory }
    const ask = { question: withContext(memoryQuestion(group, names), memoryContextLine(roles)), spec, parse, accepts }
    const roleIds = choiceResult(await askChoice(io, ask), MEMORY_DISMISSED_REASON)
    if (roleIds.kind === 'cancelled') return roleIds
    given.set(group, roleIds.value)
  }

  return accepted(
    roles.map(role => ({
      ...role,
      instructions: INSTRUCTION_ORDER.filter(group => given.get(group)?.includes(role.id) === true),
    })),
  )
}
