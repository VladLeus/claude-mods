/**
 * The skills part of the setup scan, a layer 3 module: the skills and plugin commands of the host's command list, by
 * name, the plugin that adds each and its one-line purpose, built-in commands and MCP prompts left out (SCAN-02, D-57,
 * D-139). A purpose is held in memory only and never written. It imports core, the facts name warnings, the MCP scan's
 * name cap and the types, so the setup scan reads the skills here.
 */
import type { InitIo, SkillRef } from '../../../types'
import { isObject } from '../../core/json'
import { NAME_PATTERN } from '../../core/names'
import { clean, compareText } from '../../core/text'
import { t } from '../../locales/t'
import { hiddenNameWarnings } from '../facts/normalize'
import { MAX_REF_NAME_CHARS } from './mcp'

/** Code points a skill's purpose keeps: its one-line description, cleaned and cut to this (D-139). */
const MAX_SKILL_PURPOSE_CHARS = 120

/** Command sources a scan does not name: the host ships its built-in commands, and an MCP server adds its prompts. */
const UNNAMED_SOURCES: readonly string[] = ['builtin', 'mcp']
/** The warning when the host cannot list the commands and skills. */
const COMMANDS_WARNING = t('scan.unknown', { what: t('scan.commandsUnlisted') })

/** Whether a command name, or the plugin that adds a command, is a plain ASCII name of at most 100 characters. */
function isCommandName(value: unknown): value is string {
  return typeof value === 'string' && NAME_PATTERN.test(value)
}

/** The objects of a command list whose source a scan names: user, plugin and any source that is not built in or MCP. */
function skillItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isObject)
    .filter(item => typeof item.source === 'string' && !UNNAMED_SOURCES.includes(item.source))
}

/**
 * A command's description as its skill keeps it (D-139): cleaned and cut to MAX_SKILL_PURPOSE_CHARS code points; null
 * for a description that is missing, not a string, or blank once cleaned.
 */
function purposeOf(description: unknown): string | null {
  const purpose = clean(description, MAX_SKILL_PURPOSE_CHARS)

  return purpose.trim() === '' ? null : purpose
}

/** A skill by its name and plugin, with its purpose only when it has one (D-139). */
function skillOf(name: string, plugin: string | null, purpose: string | null): SkillRef {
  return purpose === null ? { name, plugin } : { name, plugin, purpose }
}

/**
 * One command as a name, the plugin that adds it and its purpose (purposeOf); null when the name, or a plugin that is
 * given, is not a name.
 */
function skillRefOf(item: Record<string, unknown>): SkillRef | null {
  const { name, plugin } = item
  if (!isCommandName(name)) return null
  const purpose = purposeOf(item.description)
  if (item.source !== 'plugin' || plugin === undefined) return skillOf(name, null, purpose)
  if (!isCommandName(plugin)) return null

  return skillOf(name, plugin, purpose)
}

/** Skills in the order of their names, then of their plugins, a command with no plugin first. */
function bySkill(first: SkillRef, second: SkillRef): number {
  return compareText(first.name, second.name) || compareText(first.plugin ?? '', second.plugin ?? '')
}

/**
 * The skills and plugin commands of a `$.command.list()` answer, by name, the plugin that adds each and its purpose
 * (SCAN-02, D-57, D-139). Built-in commands and MCP prompts are dropped, and so is a command whose name, or whose
 * plugin, is not a plain name of at most 100 characters. A string description is kept as the skill's purpose, cleaned
 * and cut to MAX_SKILL_PURPOSE_CHARS code points, in memory only, for the questions and the recommendation call; it is
 * never written (D-139), and a blank or missing one gives no purpose. A hint and every other field is never read, so
 * none can be kept. A name is listed once for each plugin, sorted by name. Anything but a list gives [].
 */
export function projectCommands(value: unknown): SkillRef[] {
  const found = new Map<string, SkillRef>()
  for (const item of skillItems(value)) {
    const ref = skillRefOf(item)
    if (ref !== null) found.set(JSON.stringify([ref.name, ref.plugin]), ref)
  }

  return Array.from(found.values()).sort(bySkill)
}

/** The command and plugin names of a command list as the host gave them, for the hidden-name warnings. */
function skillNames(value: unknown): string[] {
  return skillItems(value)
    .flatMap(item => [item.name, item.plugin])
    .filter((name): name is string => typeof name === 'string')
}

/** The skills and plugin commands of the host's command list; a list the host cannot give adds a warning. */
export async function commandRefs(io: InitIo, warnings: string[]): Promise<SkillRef[]> {
  const value = await io.commands()
  if (!Array.isArray(value)) {
    warnings.push(COMMANDS_WARNING)

    return []
  }
  warnings.push(...hiddenNameWarnings(skillNames(value), 'commandOrPluginName', MAX_REF_NAME_CHARS))

  return projectCommands(value)
}
