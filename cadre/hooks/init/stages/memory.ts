/**
 * The instruction and memory questions of init (D-63, D-100, D-136, D-230), a layer 10 module: one question per
 * instruction group the scan found, in the order the global CLAUDE.md, the auto-memories, the project CLAUDE.md, with
 * the team's role ids on its second line (memoryContextLine), and the pure cursor that asks them and gives each role
 * the groups it was given, by name only (memoryEnter, memoryAnswer), which the instruction stage runs; and the None and
 * All roles buttons and the refusal list of every question on which roles get an item (ROLE_LIST_OPTIONS,
 * roleListAccepts), which the assignment questions read too. Pure: it imports init/answers, init/state types, ui/ask
 * and the duration and model stages, and never imports init/machine or init/run.
 */
import type { AskSpec, InstructionGroup, RoleSpec, SetupScan } from '../../../types'
import type { ListWords } from '../../core/text'
import { t } from '../../locales/t'
import { screenPath } from '../../paths'
import { ASK_HEADERS, choiceAnswer, paneQuestionOf, quotedLabels } from '../../ui/ask'
import type { ChoiceAsk } from '../../ui/ask'
import { memoryGroupContext } from '../../ui/blocks/context'
import { ALL_OPTION, memoryPaneQuestion, memoryQuestion, NONE_OPTION, parseRoleList } from '../answers'
import type { MemoryCursor } from '../state'
import { idsOf } from './duration'
import { teamContextLine } from './model'

/** The buttons of every question on which roles get an item: no role or every role; a list is typed under "Other". */
export const ROLE_LIST_OPTIONS: readonly string[] = Object.freeze([NONE_OPTION, ALL_OPTION])

/** What a question on which roles get an item takes, as its refusal lists it: a button or the team's ids (D-136). */
export function roleListAccepts(roles: readonly RoleSpec[]): string {
  return t('init.memory.roleListAccepts', { quotedLabels: quotedLabels(ROLE_LIST_OPTIONS), ids: idsOf(roles) })
}

/** The instruction groups in the order init asks about them and a role stores them (D-63). */
const INSTRUCTION_ORDER: readonly InstructionGroup[] = Object.freeze([
  'global-claude-md',
  'auto-memory',
  'project-claude-md',
])

/** Why init cancels when a question on which roles get instructions or memories is dismissed or not answered (A1). */
export const MEMORY_DISMISSED_REASON = t('init.memory.memoryDismissedReason')

/** The context line of an instruction or memory question (D-136): the team's role ids, and that no content is shown. */
export function memoryContextLine(roles: readonly RoleSpec[]): string {
  return t('init.memory.memoryContextLine', { teamContext: teamContextLine(roles) })
}

/**
 * The names the question of an instruction group shows, or null when the scan did not find the group, so it is not
 * asked: none for the global CLAUDE.md, which its label names, the file names of the auto-memories, and the CLAUDE.md
 * files of the chain as a screen shows them, the repo by its folder name (screenPath, D-226) (D-63, D-100). These are
 * names only: no file is read.
 */
function groupNames(group: InstructionGroup, setup: SetupScan, root: string): readonly string[] | null {
  switch (group) {
    case 'global-claude-md':
      return setup.hasGlobalClaudeMd ? [] : null
    case 'auto-memory':
      return setup.memoryFiles.length > 0 ? setup.memoryFiles : null
    case 'project-claude-md':
      return setup.claudeMd.length > 0 ? setup.claudeMd.map(file => screenPath(file, root)) : null
  }
}

/** What the group questions do next: ask `question` with `spec` and wait at `cursor`, end with roles, or cancel. */
export type MemoryNext =
  | { readonly kind: 'ask'; readonly question: string; readonly spec: AskSpec; readonly cursor: MemoryCursor }
  | { readonly kind: 'done'; readonly roles: RoleSpec[] }
  | { readonly kind: 'cancelled'; readonly reason: string }

/**
 * The question of an instruction group (D-63, D-136): memoryQuestion with its names, the team's role ids and that no
 * content is shown on its second line (memoryContextLine), None or All roles with the Memory chip and the group's
 * files as its own context (memoryGroupContext, D-236), which a pane surface asks with its first line in place of that
 * line (D-255) and with memoryPaneQuestion, which names no file, in place of the question (D-283), a typed list of role
 * ids or titles (parseRoleList), so it takes a typed answer (D-234), and MEMORY_DISMISSED_REASON for a dismissal. Its
 * names, in the question and in the context, are capped by `words` (D-256).
 */
function groupAsk(
  group: InstructionGroup,
  names: readonly string[],
  roles: readonly RoleSpec[],
  words: ListWords,
): ChoiceAsk<readonly string[]> & { readonly dismissedReason: string } {
  const context = memoryGroupContext(group, names, words)
  const contextLine = memoryContextLine(roles)
  const line = context.lines[0] ?? contextLine
  const pane = paneQuestionOf(memoryQuestion(group, names, words), contextLine, line, memoryPaneQuestion(group))

  return {
    question: pane.asked,
    spec: {
      options: ROLE_LIST_OPTIONS,
      header: ASK_HEADERS.memory,
      context: { ...context, pane },
      acceptsTyped: true,
    },
    parse: (answer: string): readonly string[] | null => parseRoleList(answer, roles),
    accepts: roleListAccepts(roles),
    dismissedReason: MEMORY_DISMISSED_REASON,
  }
}

/**
 * The question of the first group at or after `from` the scan found, asked the first time, its names capped by `words`
 * (D-256); after the last, the roles with the groups they were given, in the order global, auto-memory, project, so the
 * answers decide the whole list.
 */
function groupAt(
  roles: readonly RoleSpec[],
  setup: SetupScan,
  root: string,
  from: number,
  given: ReadonlyMap<InstructionGroup, readonly string[]>,
  words: ListWords,
): MemoryNext {
  const at = INSTRUCTION_ORDER.findIndex((group, index) => index >= from && groupNames(group, setup, root) !== null)
  const group = INSTRUCTION_ORDER[at]
  const names = group === undefined ? null : groupNames(group, setup, root)
  if (group === undefined || names === null) {
    const instructed = roles.map(role => ({
      ...role,
      instructions: INSTRUCTION_ORDER.filter(item => given.get(item)?.includes(role.id) === true),
    }))

    return { kind: 'done', roles: instructed }
  }
  const ask = groupAsk(group, names, roles, words)

  return { kind: 'ask', question: ask.question, spec: ask.spec, cursor: { tries: 1, at, given } }
}

/**
 * The instruction and memory questions (D-63, D-100) at their first question: for each group the scan found, in the
 * order the global ~/.claude/CLAUDE.md, the auto-memories for this repo, the project CLAUDE.md, one question names the
 * group and its files, capped by `words` (D-256), and asks which roles get it (groupAsk); a group the scan did not find
 * is not asked, and with none found every role gets no group. No file is read and no content is shown; the roles it is
 * given never change.
 */
export function memoryEnter(roles: readonly RoleSpec[], setup: SetupScan, root: string, words: ListWords): MemoryNext {
  return groupAt(roles, setup, root, 0, new Map(), words)
}

/**
 * The answer to the group question at `cursor` (choiceAnswer): the roles it names get the group, then the next group is
 * asked. An answer that names no role list is asked again with why on top; only an answer to every question gives
 * roles: a dismissal cancels with MEMORY_DISMISSED_REASON, and MAX_ASKS answers it cannot read at one question with
 * NO_USABLE_ANSWER_REASON (A1).
 */
export function memoryAnswer(
  roles: readonly RoleSpec[],
  setup: SetupScan,
  cursor: MemoryCursor,
  answer: string | null,
  root: string,
  words: ListWords,
): MemoryNext {
  const group = INSTRUCTION_ORDER[cursor.at]
  const names = group === undefined ? null : groupNames(group, setup, root)
  if (group === undefined || names === null) return { kind: 'cancelled', reason: MEMORY_DISMISSED_REASON }
  const ask = groupAsk(group, names, roles, words)
  const next = choiceAnswer(ask, cursor, answer)
  if (next.kind === 'again') {
    return { kind: 'ask', question: next.question, spec: ask.spec, cursor: { ...cursor, tries: next.sub.tries } }
  }
  if (next.kind === 'cancelled') return next

  return groupAt(roles, setup, root, cursor.at + 1, new Map([...cursor.given, [group, next.value]]), words)
}
