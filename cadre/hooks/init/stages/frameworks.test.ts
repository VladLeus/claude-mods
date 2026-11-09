import { describe, expect, test } from 'claude-code/testing'

import type {
  CadreState,
  Choice,
  Detection,
  DetectStatus,
  Facts,
  FrameworkId,
  GsdFact,
  RawGsdCandidate,
  RepoEntry,
  RoleSpec,
  UnsupportedId,
} from '../../../types'
import { REDACTED } from '../../core/redact'
import { choiceLine } from '../../detect/report'
import { detectAll } from '../../framework/registry'
import { applyAdjust, parseAdjust } from '../../roles/adjust'
import { proposeRoles } from '../../roles/propose'
import { resolvedFramework } from '../../team'
import {
  DEFAULT_LOCATIONS,
  driven,
  EMPTY_FACTS,
  emptySetupScan,
  facts,
  firstLines,
  repoScan,
  stateAt,
  wholeDraft,
  withFramework,
} from '../../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import { nextStage } from '../machine'
import { cancelledReply } from '../replies'
import type { InitState } from '../state'
import {
  FRAMEWORK_ALL_QUESTION,
  FRAMEWORK_DISMISSED_REASON,
  FRAMEWORK_LABELS,
  FRAMEWORK_QUESTION_PREFIX,
  frameworkInstallAsk,
  frameworkReason,
  frameworkRoleQuestion,
  frameworksStage,
  GSD_CHECK_QUESTION,
  installedFrameworks,
  isGsdCheckUseful,
  parseFrameworkInstall,
  withConsentedInstall,
} from './frameworks'
import { teamContextLine } from './model'

/** The framework options when GSD and superpowers are offered: SUPPORTED_IDS order, then the built-in fallback. */
const BOTH_OPTIONS = ['GSD', 'superpowers', 'none (built-in)']

/** The detection evidence of a repo where nothing was found, as each framework question carries it (D-236). */
const GSD_LINE = 'GSD: not found (no .planning/; no gsd-core install proven)'
/** The superpowers line of DETECTED, after its name (D-236). */
const SUPERPOWERS_VALUE = 'not found (no docs/superpowers/ or .superpowers/; no enabled superpowers@ plugin)'
const DETECTED = {
  title: 'Frameworks',
  lines: [GSD_LINE, `superpowers: ${SUPERPOWERS_VALUE}`],
  kind: 'detection',
  summary: 'No framework found',
  rows: [
    {
      title: null,
      rows: [
        { role: 'field', label: 'GSD', text: 'not found (no .planning/; no gsd-core install proven)', indent: 0 },
        { role: 'field', label: 'superpowers', text: SUPERPOWERS_VALUE, indent: 0 },
      ],
    },
  ],
}

/**
 * DETECTED as the question `asked` carries it: a pane surface asks that question's sentence, its first line, with the
 * summary of the detections, no framework found, in place of the team line (D-310).
 */
function detectedFor(asked: string | undefined): unknown {
  const [sentence = ''] = (asked ?? '').split('\n')

  return { ...DETECTED, pane: { asked, text: withContext(sentence, DETECTED.summary) } }
}

/** The frameworks stage entered for `choice` and `roles`, the rest of a whole draft set. */
function frameworksAt(choice: Choice, roles: readonly RoleSpec[]): InitState {
  return frameworksStage.enter(stateAt('frameworks', wholeDraft({ choice, roles })))
}

/** What the set question says after the frameworks it found. */
const SET_END = 'Adding one installs it at project scope after Confirm.'

/** The set question with GSD found, and the one with GSD and superpowers found. */
const GSD_SET_QUESTION = `Which frameworks does this team use? Found: GSD. ${SET_END}`
const BOTH_SET_QUESTION = `Which frameworks does this team use? Found: GSD and superpowers. ${SET_END}`

/** The Keep answers of those two set questions. */
const KEEP_GSD = 'Keep GSD (Recommended)'
const KEEP_BOTH = 'Keep GSD and superpowers (Recommended)'

describe('frameworkStep', () => {
  /** PM, Team Lead and Security: the template roles a repo with no source keeps. */
  const roles = proposeRoles(repoScan()).roles
  const ambiguous: Choice = { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }
  const installedOnly: Choice = { kind: 'installed-only', ids: ['gsd'] }
  const AMBIGUOUS_QUESTION = 'Which framework do the roles use? (asked because more than one framework is in use)'

  test('the framework labels and the question texts are fixed, with no option marked as a default', () => {
    expect(FRAMEWORK_LABELS).toEqual({ gsd: 'GSD', superpowers: 'superpowers', none: 'none (built-in)' })
    expect(Object.isFrozen(FRAMEWORK_LABELS)).toBe(true)
    expect(FRAMEWORK_QUESTION_PREFIX).toBe('Which framework do the roles use?')
    expect(FRAMEWORK_ALL_QUESTION).toBe('Framework for all roles?')
    expect(frameworkRoleQuestion({ id: 'tl', title: 'Team Lead' })).toBe('Framework for Team Lead (tl)?')
    expect(frameworkRoleQuestion({ id: 'be-api', title: 'Backend' })).toBe('Framework for Backend (be-api)?')
  })

  test('frameworkReason says why the question is asked, and what a choice that asks nothing found', () => {
    expect(frameworkReason(ambiguous)).toBe('more than one framework is in use')
    expect(frameworkReason(installedOnly)).toBe('none is in use here, but some are installed for you')
    const chosen: Choice = { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use' }
    expect(frameworkReason(chosen)).toBe('only gsd is in use')
    expect(frameworkReason({ kind: 'unsupported', ids: ['aidlc'] })).toBe(
      'only frameworks cadre does not support were found',
    )
    expect(frameworkReason({ kind: 'none' })).toBe('no framework was found')
  })

  test('with one framework in use the set question keeps it: overrides stay, and it is the default', () => {
    const chosen: Choice = { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use' }
    const overridden = roles.map(role => (role.id === 'tl' ? withFramework(role, 'superpowers') : role))
    for (const team of [overridden, roles]) {
      const run = driven(frameworksAt(chosen, team), [KEEP_GSD])
      const { draft } = run.state
      expect([draft.roles, draft.repoDefault, draft.frameworkSet]).toEqual([team, 'gsd', ['gsd']])
      expect([firstLines(run.asked), run.outputs]).toEqual([[GSD_SET_QUESTION], []])
    }
  })

  test('ambiguous: Same for all roles asks once more and gives every role but PM that framework, no default', () => {
    const run = driven(frameworksAt(ambiguous, roles), [KEEP_BOTH, 'Same for all roles', 'superpowers'])
    expect(run.state.draft.roles).toEqual(
      roles.map(role => (role.id === 'pm' ? withFramework(role, 'none') : withFramework(role, 'superpowers'))),
    )
    expect(run.state.draft.repoDefault).toBeNull()
    expect(firstLines(run.asked)).toEqual([BOTH_SET_QUESTION, AMBIGUOUS_QUESTION, FRAMEWORK_ALL_QUESTION])
    expect(run.specs.slice(1)).toEqual([
      { options: ['Same for all roles', 'Per role'], header: 'Framework', context: detectedFor(run.asked[1]) },
      { options: BOTH_OPTIONS, header: 'Framework', context: detectedFor(run.asked[2]), acceptsTyped: true },
    ])
  })

  test('ambiguous: Per role asks each role but PM by title and id, in role order, with the frameworks and none', () => {
    const answers = [KEEP_BOTH, 'Per role', 'none (built-in)', 'superpowers']
    const run = driven(frameworksAt(ambiguous, roles), answers)
    expect(run.state.draft.roles?.map(role => role.framework)).toEqual(['none', 'none', 'superpowers'])
    expect(run.state.draft.repoDefault).toBeNull()
    expect(firstLines(run.asked)).toEqual([
      BOTH_SET_QUESTION,
      AMBIGUOUS_QUESTION,
      'Framework for Team Lead (tl)?',
      'Framework for Security (security)?',
    ])
    const each = run.asked.slice(2).map(asked => ({
      options: BOTH_OPTIONS,
      header: 'Framework',
      context: detectedFor(asked),
      acceptsTyped: true,
    }))
    expect(run.specs.slice(2)).toEqual(each)
  })

  test('installed-only asks the set question; Keep puts every role on the installed framework as the default', () => {
    const run = driven(frameworksAt(installedOnly, roles), [KEEP_GSD])
    expect([run.state.draft.roles, run.state.draft.repoDefault]).toEqual([roles, 'gsd'])
    expect(firstLines(run.asked)).toEqual([GSD_SET_QUESTION])
    const options = [KEEP_GSD, 'Add superpowers too', 'None (built-in)']
    const context = detectedFor(run.asked[0])
    expect(run.specs[0]).toEqual({ options, header: 'Framework', context, acceptsTyped: true })
  })

  test('every framework question carries the detection evidence: each framework, a marker only found (D-236)', () => {
    const repoEntries: readonly RepoEntry[] = [{ name: 'aidlc', kind: 'dir', isLink: false }]
    const setup = emptySetupScan()
    const gathered = { facts: { facts: facts({ repoEntries }), gsdUserDir: null }, repo: repoScan(), setup }
    const state = frameworksStage.enter(stateAt('frameworks', wholeDraft({ choice: ambiguous, roles, gathered })))
    const context = state.openQuestion?.spec.context
    expect([context?.title, context?.kind, context?.lines.length, context?.lines[0]]).toEqual([
      'Frameworks',
      'detection',
      3,
      GSD_LINE,
    ])
    expect(context?.lines[2]?.startsWith('AI-DLC: unsupported (aidlc/ present; detected but unsupported: ')).toBe(true)
  })

  test('the framework question shows a repo-local GSD by the repo folder name, never <repo> (WF-S5, D-226)', () => {
    const local: GsdFact = {
      location: 'project',
      dir: '<repo>/.claude/gsd-core',
      version: '1.16.0',
      identity: 'proven',
      runtimeIdentityTried: false,
    }
    const gathered = {
      facts: { facts: facts({ gsd: [local] }), gsdUserDir: null },
      repo: repoScan(),
      setup: emptySetupScan(),
    }
    const state = frameworksStage.enter(stateAt('frameworks', wholeDraft({ gathered, choice: installedOnly })))
    const lines = state.effect.kind === 'ask' ? state.effect.spec.context?.lines.join('\n') : undefined

    expect([lines?.includes('repo/.claude/gsd-core'), lines?.includes('<repo>')]).toEqual([true, false])
  })

  test('a typed framework that is not offered is asked again with why on top; an offered id counts', () => {
    const run = driven(frameworksAt(ambiguous, roles), [KEEP_BOTH, 'Same for all roles', 'aidlc', ' NONE '])
    expect(run.state.draft.roles?.map(role => role.framework)).toEqual(['none', 'none', 'none'])
    const refusal = "'aidlc' isn't one of: GSD, superpowers, none - a role runs one framework."
    const all = withContext(FRAMEWORK_ALL_QUESTION, teamContextLine(roles))
    expect(firstLines(run.asked)[1]).toBe(AMBIGUOUS_QUESTION)
    expect(run.asked.slice(2)).toEqual([all, `${refusal}\n${all}`])
  })

  test('a dismissed or unread framework question is never a choice: the step is cancelled (A1)', () => {
    const scripts: readonly (readonly [readonly string[], string])[] = [
      [[], FRAMEWORK_DISMISSED_REASON],
      [[KEEP_BOTH], FRAMEWORK_DISMISSED_REASON],
      [[KEEP_BOTH, 'Same for all roles'], FRAMEWORK_DISMISSED_REASON],
      [[KEEP_BOTH, 'Per role', 'GSD'], FRAMEWORK_DISMISSED_REASON],
      [['what', 'ever', 'else'], NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of scripts) {
      const run = driven(frameworksAt(ambiguous, roles), answers)
      expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(reason) })
      expect(run.outputs).toEqual([])
    }
    expect(FRAMEWORK_DISMISSED_REASON).toBe('A framework question was dismissed or not answered.')
  })

  test('unsupported and none ask nothing and give the built-in default; unsupported says what was found', () => {
    const unsupported: Choice = { kind: 'unsupported', ids: ['aidlc'] }
    const run = frameworksAt(unsupported, roles)
    expect([run.sub, run.draft.roles, run.draft.repoDefault]).toEqual([{ kind: 'done' }, roles, 'none'])
    expect(run.outputs).toEqual([{ kind: 'note', line: choiceLine(unsupported) }])
    const none = frameworksAt({ kind: 'none' }, roles)
    expect([none.sub, none.draft.roles, none.draft.repoDefault]).toEqual([{ kind: 'done' }, roles, 'none'])
    expect([none.openQuestion, none.outputs]).toEqual([null, []])
  })

  test('options keep SUPPORTED_IDS order then none for each role, 2 to 4 of them, in any choice order', () => {
    const reversed: Choice = { kind: 'ambiguous', ids: ['superpowers', 'gsd'] }
    const run = driven(frameworksAt(reversed, roles), [KEEP_BOTH, 'Per role', 'GSD', 'GSD', 'GSD'])
    const each = run.asked.slice(2).map(asked => ({
      options: BOTH_OPTIONS,
      header: 'Framework',
      context: detectedFor(asked),
      acceptsTyped: true,
    }))
    expect(run.specs.slice(2)).toEqual(each)
    for (const spec of run.specs) {
      expect(spec.options.length).toBeGreaterThanOrEqual(2)
      expect(spec.options.length).toBeLessThanOrEqual(4)
      expect(spec.options.some(option => option.includes('(default)'))).toBe(false)
    }
  })

  test("resolvedFramework is the role's own framework, else the repo default, else none", () => {
    const role = roles.find(candidate => candidate.id === 'tl')
    if (role === undefined) throw new Error('no template role')
    expect(resolvedFramework(withFramework(role, 'superpowers'), 'gsd')).toBe('superpowers')
    expect(resolvedFramework(role, 'gsd')).toBe('gsd')
    expect(resolvedFramework(role, null)).toBe('none')
  })
})

describe('PM on its own framework none', () => {
  /** PM, Team Lead and Security: the template roles a repo with no source keeps. */
  const roles = proposeRoles(repoScan()).roles
  const chosen: Choice = { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use' }
  const ambiguous: Choice = { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }

  /** The roles after the Adjust line `framework pm gsd`. */
  function adjustedToGsd(): readonly RoleSpec[] {
    const op = parseAdjust('framework pm gsd')
    const adjusted = op === null ? null : applyAdjust(roles, op)
    if (adjusted?.kind !== 'ok') throw new Error('the Adjust line was refused')

    return adjusted.roles
  }

  test('with GSD in use and the set kept, PM stays on none and the other roles take the repo default gsd', () => {
    const run = driven(frameworksAt(chosen, roles), [KEEP_GSD])
    const { roles: framed = [], repoDefault = null } = run.state.draft

    expect(framed.map(role => [role.id, resolvedFramework(role, repoDefault)])).toEqual([
      ['pm', 'none'],
      ['tl', 'gsd'],
      ['security', 'gsd'],
    ])
  })

  test('the same-for-all answer superpowers leaves PM on none; the per-role question asks every role but PM', () => {
    const all = driven(frameworksAt(ambiguous, roles), [KEEP_BOTH, 'Same for all roles', 'superpowers'])
    const each = driven(frameworksAt(ambiguous, roles), [KEEP_BOTH, 'Per role', 'GSD', 'GSD'])

    expect(all.state.draft.roles?.map(role => role.framework)).toEqual(['none', 'superpowers', 'superpowers'])
    expect(each.state.draft.roles?.map(role => role.framework)).toEqual(['none', 'gsd', 'gsd'])
    expect(firstLines(each.asked).slice(2)).toEqual([
      'Framework for Team Lead (tl)?',
      'Framework for Security (security)?',
    ])
  })

  test('an Adjust line moving PM off none is kept with one framework, and a later answer for all roles wins', () => {
    const adjusted = adjustedToGsd()
    const kept = driven(frameworksAt(chosen, adjusted), [KEEP_GSD])
    const all = driven(frameworksAt(ambiguous, adjusted), [KEEP_BOTH, 'Same for all roles', 'superpowers'])
    const each = driven(frameworksAt(ambiguous, adjusted), [KEEP_BOTH, 'Per role', 'superpowers', 'GSD', 'GSD'])

    expect(kept.state.draft.roles?.map(role => role.framework)).toEqual(['gsd', undefined, undefined])
    expect(all.state.draft.roles?.map(role => role.framework)).toEqual(['superpowers', 'superpowers', 'superpowers'])
    expect(firstLines(each.asked)[2]).toBe('Framework for PM (pm)?')
    expect(each.state.draft.roles?.map(role => role.framework)).toEqual(['superpowers', 'gsd', 'gsd'])
  })
})

describe('question context lines (G-02-1)', () => {
  /** The roles of the git fixture worlds, which hold no source: PM, Team Lead and Security. */
  const TEAM = 'pm, tl, security'

  test('the framework question for all roles carries the team too', () => {
    const ambiguous: Choice = { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }
    const roles = proposeRoles(repoScan()).roles
    const run = driven(frameworksAt(ambiguous, roles), [KEEP_BOTH, 'Same for all roles', 'GSD'])
    expect(run.asked[2]).toBe(`${FRAMEWORK_ALL_QUESTION}\nRoles: ${TEAM}.`)
  })
})

describe('role title redaction (WD-S5, #163)', () => {
  test('a secret-like span of a role title is hidden in its framework question', () => {
    const role = { id: 'be', title: `BE ${['token', 'ab12cd34ef56'].join('=')}` }
    expect(frameworkRoleQuestion(role)).toBe(`Framework for BE token=${REDACTED} (be)?`)
  })
})

describe('the frameworks stage (D-230)', () => {
  /** PM, Team Lead and Security: the template roles a repo with no source keeps. */
  const roles = proposeRoles(repoScan()).roles

  test('frameworksStage asks the set question for one framework in use; nothing for unsupported or none', () => {
    const chosen: Choice = { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use' }
    const asked = frameworksStage.enter(stateAt('frameworks', wholeDraft({ choice: chosen, roles, repoDefault: null })))
    expect([asked.sub, firstLines([asked.openQuestion?.question ?? ''])]).toEqual([
      { kind: 'set', tries: 1 },
      [GSD_SET_QUESTION],
    ])
    const unsupported: Choice = { kind: 'unsupported', ids: ['aidlc'] }
    const cases: readonly (readonly [Choice, string, readonly unknown[]])[] = [
      [unsupported, 'none', [{ kind: 'note', line: choiceLine(unsupported) }]],
      [{ kind: 'none' }, 'none', []],
    ]
    for (const [choice, repoDefault, notes] of cases) {
      const state = frameworksStage.enter(stateAt('frameworks', wholeDraft({ choice, roles, repoDefault: null })))
      expect([state.sub, state.draft.repoDefault, state.draft.roles, state.outputs]).toEqual([
        { kind: 'done' },
        repoDefault,
        roles,
        notes,
      ])
    }
  })

  test('an ambiguous choice asks the set, then Same for all roles or Per role with the team ids', () => {
    const choice: Choice = { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }
    const entered = frameworksStage.enter(stateAt('frameworks', wholeDraft({ choice, roles })))
    const state = nextStage(entered, { kind: 'answer', text: KEEP_BOTH })
    const prefix = `${FRAMEWORK_QUESTION_PREFIX} (asked because more than one framework is in use)`
    const question = withContext(prefix, 'Roles: pm, tl, security.')
    const spec = { options: ['Same for all roles', 'Per role'], header: 'Framework', context: detectedFor(question) }
    const ask = { question, spec }
    expect(state.effect).toEqual({ kind: 'ask', ...ask })
    expect(state.openQuestion).toEqual(ask)
    const all = nextStage(state, { kind: 'answer', text: 'Same for all roles' })
    expect(all.openQuestion?.question).toBe(withContext(FRAMEWORK_ALL_QUESTION, 'Roles: pm, tl, security.'))
  })
})

describe('the GSD check (D-243)', () => {
  /** PM, Team Lead and Security: the template roles a repo with no source keeps. */
  const roles = proposeRoles(repoScan()).roles
  /** A user-level GSD found but not proven, as facts gives it: facts never runs GSD's own check. */
  const UNPROVEN: GsdFact = {
    location: 'user',
    dir: '~/.claude/gsd-core',
    version: null,
    identity: 'unknown',
    runtimeIdentityTried: false,
  }
  /** The GSD check question, word for word. */
  const QUESTION = "Run GSD's own check to confirm it's installed? (runs node gsd-tools runtime-identity)"

  /** The frameworks stage entered for a repo with nothing in use whose GSD facts are `gsd`. */
  function gsdAt(gsd: readonly GsdFact[]): InitState {
    const gathered = {
      facts: { facts: facts({ gsd }), gsdUserDir: '/home/u/.claude/gsd-core' },
      repo: repoScan(),
      setup: emptySetupScan(),
    }

    return frameworksStage.enter(stateAt('frameworks', wholeDraft({ gathered, choice: { kind: 'none' }, roles })))
  }

  test('a found, unproven GSD is asked about first, the decline first; No goes on as with no check', () => {
    const asked = gsdAt([UNPROVEN])
    const effect = asked.effect.kind === 'ask' ? asked.effect : null
    const no = nextStage(asked, { kind: 'answer', text: 'No, skip the check' })

    expect([effect?.question, effect?.spec.options, effect?.spec.header, effect?.spec.context?.kind]).toEqual([
      QUESTION,
      ['No, skip the check', 'Yes, run the check'],
      'GSD check',
      'detection',
    ])
    expect(effect?.spec.context?.lines.join('\n')).toContain('~/.claude/gsd-core')
    const after = [no.stage, no.draft.repoDefault, no.draft.gathered?.facts.facts.gsd]
    expect(after).toEqual(['security', 'none', [UNPROVEN]])
  })

  test('the check summary names the install it runs, which a pane surface asks under it (D-310, edge #39)', () => {
    const asked = gsdAt([UNPROVEN])
    const context = asked.effect.kind === 'ask' ? asked.effect.spec.context : null
    const line = '~/.claude/gsd-core: found, not proven'
    expect(context).toEqual({
      title: context?.title,
      lines: [line],
      kind: 'detection',
      summary: line,
      pane: { asked: QUESTION, text: withContext(QUESTION, line) },
      rows: [{ title: null, rows: [{ role: 'plain', text: line, indent: 0 }] }],
    })
  })

  test('Yes asks the runner for the check with the locations, as an io effect', () => {
    const yes = nextStage(gsdAt([UNPROVEN]), { kind: 'answer', text: 'Yes, run the check' })

    expect(yes.effect).toEqual({ kind: 'io', call: { id: 'gsd-identity', locations: DEFAULT_LOCATIONS } })
  })

  test('the check result is merged before the framework step, which reads the choice again from it', () => {
    const yes = nextStage(gsdAt([UNPROVEN]), { kind: 'answer', text: 'Yes, run the check' })
    const probed: RawGsdCandidate = {
      location: 'user',
      dir: '/home/u/.claude/gsd-core',
      isPresent: true,
      versionText: null,
      identityText: null,
      manifest: null,
      runtimeStdout: '{"packageName":"@opengsd/gsd-core","version":"1.16.0"}',
      runtimeTried: true,
    }
    const merged = nextStage(yes, { kind: 'io', result: { id: 'gsd-identity', result: probed } })

    expect(merged.draft.gathered?.facts.facts.gsd.map(fact => fact.identity)).toEqual(['proven'])
    const installedOnly = { kind: 'installed-only', ids: ['gsd'] }
    expect([merged.draft.choice, merged.sub]).toEqual([installedOnly, { kind: 'set', tries: 1 }])
  })

  test('no GSD candidate, or a proven one, is never asked about', () => {
    const proven: GsdFact = { ...UNPROVEN, identity: 'proven' }
    const local: GsdFact = { ...UNPROVEN, location: 'project' }
    const cases: readonly (readonly GsdFact[])[] = [[], [proven], [local]]
    for (const gsd of cases) {
      expect(gsdAt(gsd).sub).toEqual({ kind: 'done' })
    }
  })
})

describe('the GSD check only when it can run and matter (D-269)', () => {
  /** PM, Team Lead and Security: the template roles a repo with no source keeps. */
  const roles = proposeRoles(repoScan()).roles
  /** A user-level GSD found but not proven, as facts gives it. */
  const UNPROVEN: GsdFact = {
    location: 'user',
    dir: '~/.claude/gsd-core',
    version: null,
    identity: 'unknown',
    runtimeIdentityTried: false,
  }
  /** The same install with no compiled runtime, so GSD's own check could run nothing (edge #31). */
  const NOT_BUILT: GsdFact = { ...UNPROVEN, runtimeProblem: 'not-built' }
  /** The repo entries of a repo with superpowers in use (docs/superpowers/) and nothing else. */
  const SUPERPOWERS_IN_USE: Partial<Facts> = {
    repoEntries: [{ name: 'docs', kind: 'dir', isLink: false }],
    docsEntries: [{ name: 'superpowers', kind: 'dir', isLink: false }],
  }
  /** The choice of that repo: superpowers, the one framework in use. */
  const CHOSEN_SUPERPOWERS: Choice = {
    kind: 'chosen',
    id: 'superpowers',
    pickedBy: 'only-one-in-use',
    reason: 'only superpowers is in use',
  }
  /** The decline of the GSD check, as its dialog shows it. */
  const NO = 'No, skip the check'
  /** The template roles with Team Lead set to gsd by an Adjust. */
  const gsdRole = roles.map(role => (role.id === 'tl' ? withFramework(role, 'gsd') : role))
  /** The user-level candidate as GSD's own check reads it: its runtime identity proves it. */
  const PROBED: RawGsdCandidate = {
    location: 'user',
    dir: '/home/u/.claude/gsd-core',
    isPresent: true,
    versionText: null,
    identityText: null,
    manifest: null,
    runtimeStdout: '{"packageName":"@opengsd/gsd-core","version":"1.16.0"}',
    runtimeTried: true,
  }

  /** The state the frameworks stage is entered with for `team` and `choice`, whose facts are `over` with `gsd`. */
  function entryWith(
    gsd: readonly GsdFact[],
    over: Partial<Facts>,
    choice: Choice,
    team: readonly RoleSpec[],
  ): InitState {
    const gathered = {
      facts: { facts: facts({ ...over, gsd }), gsdUserDir: '/home/u/.claude/gsd-core' },
      repo: repoScan(),
      setup: emptySetupScan(),
    }

    return stateAt('frameworks', wholeDraft({ gathered, choice, roles: team }))
  }

  /** What a skip shares with a No (D-295): the gathered facts, the choice, the facts' warnings and the outputs. */
  function asNo(state: InitState): unknown {
    return [state.draft.gathered, state.draft.choice, state.draft.gathered?.facts.facts.warnings, state.outputs]
  }

  test('isGsdCheckUseful: a gsd role, or a choice that proving GSD changes; never a choice it leaves as it is', () => {
    const inUse = facts({ ...SUPERPOWERS_IN_USE, gsd: [UNPROVEN] })
    const planning: RepoEntry = { name: '.planning', kind: 'dir', isLink: false }
    expect(isGsdCheckUseful(inUse, roles)).toBe(false)
    expect(isGsdCheckUseful(inUse, gsdRole)).toBe(true)
    expect(isGsdCheckUseful(facts({ gsd: [UNPROVEN] }), roles)).toBe(true)
    expect(isGsdCheckUseful(facts({ repoEntries: [planning], gsd: [UNPROVEN] }), roles)).toBe(false)
  })

  test('#36: superpowers in use and no gsd role: init asks no GSD check and keeps skipped (D-295)', () => {
    const state = frameworksStage.enter(entryWith([UNPROVEN], SUPERPOWERS_IN_USE, CHOSEN_SUPERPOWERS, roles))
    const [asked = ''] = firstLines([state.openQuestion?.question ?? ''])
    const after = [asked.startsWith('Which frameworks does this team use?'), state.sub, state.draft.gsdCheck]
    expect(after).toEqual([true, { kind: 'set', tries: 1 }, 'skipped'])
  })

  test('#36: from one entry state the skip gives what a No gives; only the gsdCheck marker differs (D-295)', () => {
    const entry = entryWith([UNPROVEN], SUPERPOWERS_IN_USE, CHOSEN_SUPERPOWERS, roles)
    const skipped = frameworksStage.enter(entry)
    const declined = frameworksStage.answer({ ...entry, sub: { kind: 'ask', tries: 1 } }, { kind: 'answer', text: NO })
    expect(asNo(skipped)).toEqual(asNo(declined))
    expect([skipped.draft.gsdCheck, declined.draft.gsdCheck]).toEqual(['skipped', 'declined'])
  })

  test('a gsd role, or a choice that proving GSD changes, still asks the GSD check first', () => {
    const entries = [
      entryWith([UNPROVEN], SUPERPOWERS_IN_USE, CHOSEN_SUPERPOWERS, gsdRole),
      entryWith([UNPROVEN], {}, { kind: 'none' }, roles),
    ]
    for (const entry of entries) {
      const state = frameworksStage.enter(entry)
      expect([state.sub, state.openQuestion?.question]).toEqual([{ kind: 'ask', tries: 1 }, GSD_CHECK_QUESTION])
    }
  })

  test('#31: an install whose runtime is not built is not asked about; gsdCheck stays unset, as a No leaves it', () => {
    const entry = entryWith([NOT_BUILT], {}, { kind: 'none' }, roles)
    const entered = frameworksStage.enter(entry)
    const declined = frameworksStage.answer({ ...entry, sub: { kind: 'ask', tries: 1 } }, { kind: 'answer', text: NO })
    expect([entered.openQuestion, entered.sub, entered.draft.gsdCheck]).toEqual([null, { kind: 'done' }, undefined])
    expect(asNo(entered)).toEqual(asNo(declined))
  })

  test('#30: a Yes whose check proves GSD reads installed again with gsd in it, beside the choice', () => {
    const asked = frameworksStage.enter(entryWith([UNPROVEN], {}, { kind: 'none' }, roles))
    const yes = nextStage(asked, { kind: 'answer', text: 'Yes, run the check' })
    const merged = nextStage(yes, { kind: 'io', result: { id: 'gsd-identity', result: PROBED } })
    const installedOnly = { kind: 'installed-only', ids: ['gsd'] }
    const after = [merged.draft.installed, merged.draft.choice, merged.draft.gsdCheck]
    expect(after).toEqual([['gsd', 'none'], installedOnly, 'run'])
  })

  test('a Yes whose check proves GSD keeps a framework consented from Adjust, and the set question keeps both', () => {
    const team = roles.map(role => (role.id === 'tl' ? withFramework(role, 'superpowers') : role))
    const entry = entryWith([UNPROVEN], {}, { kind: 'none' }, team)
    const consented: InitState['draft'] = {
      ...entry.draft,
      installed: ['superpowers', 'none'],
      frameworkInstalls: ['superpowers'],
    }
    const asked = frameworksStage.enter({ ...entry, draft: consented })
    const yes = nextStage(asked, { kind: 'answer', text: 'Yes, run the check' })
    const merged = nextStage(yes, { kind: 'io', result: { id: 'gsd-identity', result: PROBED } })
    expect([merged.draft.installed, merged.draft.frameworkInstalls]).toEqual([
      ['gsd', 'superpowers', 'none'],
      ['superpowers'],
    ])
    expect([merged.sub, merged.openQuestion?.spec.options]).toEqual([
      { kind: 'set', tries: 1 },
      [KEEP_BOTH, 'None (built-in)'],
    ])
  })
})

/** A detection of one framework or marker with this status, as detectAll gives it. */
function detection(id: FrameworkId | UnsupportedId, status: DetectStatus): Detection {
  return { id, name: id, status, version: null, evidence: [] }
}

/** Facts where GSD (.planning/) and superpowers (docs/superpowers/) are both in use, so the choice is ambiguous. */
const AMBIGUOUS_FACTS: Facts = {
  ...EMPTY_FACTS,
  repoEntries: [
    { name: '.planning', kind: 'dir', isLink: false },
    { name: 'docs', kind: 'dir', isLink: false },
  ],
  docsEntries: [{ name: 'superpowers', kind: 'dir', isLink: false }],
}

describe('installedFrameworks (A5)', () => {
  test('installedFrameworks lists the supported ones in use or installed, in SUPPORTED_IDS order, then none', () => {
    expect(installedFrameworks([])).toEqual(['none'])
    expect(installedFrameworks([detection('superpowers', 'installed'), detection('gsd', 'in-use')])).toEqual([
      'gsd',
      'superpowers',
      'none',
    ])
    expect(installedFrameworks([detection('gsd', 'not-found'), detection('superpowers', 'in-use')])).toEqual([
      'superpowers',
      'none',
    ])
    expect(installedFrameworks([detection('aidlc', 'unsupported'), detection('gsd', 'not-found')])).toEqual(['none'])
    expect(installedFrameworks(detectAll(AMBIGUOUS_FACTS))).toEqual(['gsd', 'superpowers', 'none'])
  })
})

describe('a consented framework install', () => {
  test('a new one joins the installed ones before none, and the installs', () => {
    const draft = withConsentedInstall({ installed: ['gsd', 'none'] }, 'superpowers')
    expect([draft.installed, draft.frameworkInstalls]).toEqual([['gsd', 'superpowers', 'none'], ['superpowers']])
  })

  test('one consented already is kept once in each list', () => {
    const consented: InitState['draft'] = { installed: ['superpowers', 'none'], frameworkInstalls: ['superpowers'] }
    const draft = withConsentedInstall(consented, 'superpowers')
    expect([draft.installed, draft.frameworkInstalls]).toEqual([['superpowers', 'none'], ['superpowers']])
  })

  test('a draft with no installed ones gets the framework, then none', () => {
    const draft = withConsentedInstall({}, 'gsd')
    expect([draft.installed, draft.frameworkInstalls]).toEqual([['gsd', 'none'], ['gsd']])
  })
})

describe('the framework install question', () => {
  test('it names the exact command, run from the repo root after Confirm, and its first option declines', () => {
    const ask = frameworkInstallAsk('superpowers')
    const command = 'claude plugin install superpowers@claude-plugins-official --scope project'
    const line = `cadre runs ${command} from the repo root after Confirm.`

    expect(ask.question).toBe(`Install superpowers for this repo?\n${line}`)
    expect([ask.spec.options, ask.spec.header, ask.accepts]).toEqual([
      ['No', 'Yes, install it'],
      'Framework',
      '"No", "Yes, install it"',
    ])
    expect(parseFrameworkInstall(ask.spec.options[0] ?? '')).toBe(false)
  })

  test("GSD's names its npx install; its context lists what the installer writes, the command its summary", () => {
    const ask = frameworkInstallAsk('gsd')
    const lines = [
      'cadre runs npx -y @opengsd/gsd-core@latest --claude --local from the repo root after Confirm.',
      'It writes .claude/gsd-core, .claude/commands, .claude/agents, .claude/hooks, .claude/settings.local.json.',
    ]
    const [summary = ''] = lines
    const rows = lines.map(text => ({ role: 'plain', text, indent: 0 }))
    const pane = { asked: ask.question, text: ask.question }

    expect(ask.question).toBe(`Install GSD for this repo?\n${summary}`)
    expect(ask.spec.context).toEqual({
      title: 'Install GSD',
      lines,
      kind: 'consent',
      summary,
      pane,
      rows: [{ title: null, rows }],
    })
  })

  test('parseFrameworkInstall reads the No and Yes labels, trimmed and in any case, and nothing else', () => {
    const read = ['No', ' no ', 'Yes, install it', 'YES, INSTALL IT'].map(parseFrameworkInstall)
    const unread = ['Install', 'Not now', 'yes', ''].map(parseFrameworkInstall)

    expect([read, unread]).toEqual([
      [false, false, true, true],
      [null, null, null, null],
    ])
  })
})

describe('the framework set question', () => {
  /** PM, Team Lead and Security: the template roles a repo with no source keeps. */
  const roles = proposeRoles(repoScan()).roles
  /** GSD, the one framework in use. */
  const GSD_CHOSEN: Choice = { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use' }
  /** The mode question once two frameworks are kept. */
  const MODE_QUESTION = 'Which framework do the roles use? (asked because more than one framework is in use)'

  /** The frameworks stage entered with GSD in use and installed, superpowers absent. */
  function gsdInUse(): InitState {
    const draft = wholeDraft({ choice: GSD_CHOSEN, roles, installed: ['gsd', 'none'] })

    return frameworksStage.enter(stateAt('frameworks', draft))
  }

  /** The install question of superpowers, asked after the Add answer. */
  function addAsked(): InitState {
    return nextStage(gsdInUse(), { kind: 'answer', text: 'Add superpowers too' })
  }

  /** What a framework answer leaves in the draft: the set, the installs, the installed ones, the default, the roles. */
  function framed(state: InitState): unknown {
    const { draft } = state

    return [draft.frameworkSet, draft.frameworkInstalls, draft.installed, draft.repoDefault, draft.roles]
  }

  test('GSD in use and superpowers absent: Keep GSD first, then Add superpowers and None, the team below', () => {
    const state = gsdInUse()
    expect([state.sub, state.openQuestion?.question, state.openQuestion?.spec.options]).toEqual([
      { kind: 'set', tries: 1 },
      withContext(GSD_SET_QUESTION, teamContextLine(roles)),
      [KEEP_GSD, 'Add superpowers too', 'None (built-in)'],
    ])
  })

  test('Keep frames every role on the repo default GSD, as one framework in use did; None frames them on none', () => {
    const kept = driven(gsdInUse(), [KEEP_GSD]).state
    const none = driven(gsdInUse(), ['None (built-in)']).state
    expect(framed(kept)).toEqual([['gsd'], undefined, ['gsd', 'none'], 'gsd', roles])
    expect(framed(none)).toEqual([[], undefined, ['gsd', 'none'], 'none', roles])
  })

  test('Add asks the install question next, No first, and records no install before it is answered Yes', () => {
    const asked = addAsked()
    const ask = frameworkInstallAsk('superpowers')
    expect([asked.sub.kind, asked.openQuestion?.question, asked.openQuestion?.spec.options[0]]).toEqual([
      'set-install',
      ask.question,
      'No',
    ])
    expect([asked.draft.frameworkSet, asked.draft.frameworkInstalls, asked.draft.installed]).toEqual([
      undefined,
      undefined,
      ['gsd', 'none'],
    ])
  })

  test('Yes adds superpowers to the set, the installs and the installed ones, then asks the mode question', () => {
    const yes = nextStage(addAsked(), { kind: 'answer', text: 'Yes, install it' })
    const { draft } = yes
    expect([draft.frameworkSet, draft.frameworkInstalls, draft.installed]).toEqual([
      ['gsd', 'superpowers'],
      ['superpowers'],
      ['gsd', 'superpowers', 'none'],
    ])
    const asked = firstLines([yes.openQuestion?.question ?? ''])
    expect([yes.sub, asked]).toEqual([{ kind: 'mode', tries: 1 }, [MODE_QUESTION]])
  })

  test('No or a dismissal of the install question keeps GSD alone, exactly as Keep, and records no install', () => {
    const kept = driven(gsdInUse(), [KEEP_GSD]).state
    for (const text of ['No', null]) {
      const declined = nextStage(addAsked(), { kind: 'answer', text })
      expect([declined.stage, framed(declined)]).toEqual([kept.stage, framed(kept)])
    }
  })

  test('a typed name that is missing asks its install question too', () => {
    const typed = nextStage(gsdInUse(), { kind: 'answer', text: 'gsd superpowers' })
    const ask = frameworkInstallAsk('superpowers')
    expect([typed.sub.kind, typed.openQuestion?.question]).toEqual(['set-install', ask.question])
  })
})

describe('the set question for a framework consented from Adjust', () => {
  /** PM, Team Lead and Security, Team Lead set to superpowers by an Adjust whose install was consented. */
  const team = proposeRoles(repoScan()).roles.map(role =>
    role.id === 'tl' ? withFramework(role, 'superpowers') : role,
  )
  /** The Keep answer of the set question when superpowers alone is found. */
  const KEEP_SUPERPOWERS = 'Keep superpowers (Recommended)'

  /** The frameworks stage entered for `choice`, superpowers consented and nothing else installed. */
  function consentedAt(choice: Choice): InitState {
    const installed: readonly FrameworkId[] = ['superpowers', 'none']
    const draft = wholeDraft({ choice, roles: team, installed, frameworkInstalls: ['superpowers'] })

    return frameworksStage.enter(stateAt('frameworks', draft))
  }

  test('with no framework found the set question keeps superpowers, and Keep makes it the repo default', () => {
    const asked = consentedAt({ kind: 'none' })
    const kept = frameworksStage.answer(asked, { kind: 'answer', text: KEEP_SUPERPOWERS })
    expect([asked.sub, asked.openQuestion?.spec.options[0]]).toEqual([{ kind: 'set', tries: 1 }, KEEP_SUPERPOWERS])
    expect([kept.sub, kept.draft.frameworkSet, kept.draft.repoDefault]).toEqual([
      { kind: 'done' },
      ['superpowers'],
      'superpowers',
    ])
  })

  test('an unsupported scan notes what it found, then asks the set question', () => {
    const unsupported: Choice = { kind: 'unsupported', ids: ['aidlc'] }
    const asked = consentedAt(unsupported)
    expect([asked.sub, asked.openQuestion?.spec.options[0], asked.outputs]).toEqual([
      { kind: 'set', tries: 1 },
      KEEP_SUPERPOWERS,
      [{ kind: 'note', line: choiceLine(unsupported) }],
    ])
  })
})

describe('the stored framework answer and the set question', () => {
  /** PM, Team Lead and Security: the template roles a repo with no source keeps. */
  const roles = proposeRoles(repoScan()).roles
  /** GSD, the one framework in use. */
  const GSD_CHOSEN: Choice = { kind: 'chosen', id: 'gsd', pickedBy: 'only-one-in-use', reason: 'only gsd is in use' }
  /** GSD and superpowers, both in use. */
  const BOTH_IN_USE: Choice = { kind: 'ambiguous', ids: ['gsd', 'superpowers'] }

  /**
   * The frameworks stage entered for `choice` with `installed`, over a cadre.json that stores `stored`, if any; `over`
   * replaces any draft field.
   */
  function enteredWith(
    choice: Choice,
    installed: readonly FrameworkId[],
    stored: readonly FrameworkId[] | null = null,
    over: InitState['draft'] = {},
  ): InitState {
    const state: CadreState = {
      schema: 1,
      cadreVersion: '0.4.11',
      framework: null,
      gitPolicy: 'definitions',
      roles: roles.map(role => role.id),
      launchStart: { kind: 'git-root' },
      readUserMcp: false,
      ...(stored === null ? {} : { frameworks: stored }),
    }
    const repo = repoScan({ cadre: { ...repoScan().cadre, state } })
    const gathered = { facts: { facts: facts({}), gsdUserDir: null }, repo, setup: emptySetupScan() }

    return frameworksStage.enter(stateAt('frameworks', wholeDraft({ choice, roles, installed, gathered, ...over })))
  }

  test('a stored set whose frameworks are all still installed is kept, and nothing is asked', () => {
    const state = enteredWith(GSD_CHOSEN, ['gsd', 'none'], ['gsd'])
    expect([state.openQuestion, state.draft.frameworkSet, state.draft.repoDefault]).toEqual([null, ['gsd'], 'gsd'])
  })

  test('a stored set that names a framework no longer installed asks the set question again', () => {
    const state = enteredWith(GSD_CHOSEN, ['gsd', 'none'], ['superpowers'])
    expect([state.sub, state.draft.frameworkSet]).toEqual([{ kind: 'set', tries: 1 }, undefined])
  })

  test('a stored set without a framework consented from Adjust asks the set question, its Keep naming both', () => {
    const team = roles.map(role => (role.id === 'tl' ? withFramework(role, 'superpowers') : role))
    const consent: InitState['draft'] = { roles: team, frameworkInstalls: ['superpowers'] }
    const installed: readonly FrameworkId[] = ['gsd', 'superpowers', 'none']
    const asked = enteredWith(GSD_CHOSEN, installed, ['gsd'], consent)
    const kept = enteredWith(GSD_CHOSEN, installed, ['gsd', 'superpowers'], consent)
    expect([asked.sub, asked.openQuestion?.spec.options[0], asked.draft.frameworkSet]).toEqual([
      { kind: 'set', tries: 1 },
      KEEP_BOTH,
      undefined,
    ])
    expect([kept.sub, kept.draft.frameworkSet]).toEqual([{ kind: 'mode', tries: 1 }, ['gsd', 'superpowers']])
  })

  test('a set kept on a go-back is asked again when a framework consented since is not in it', () => {
    const installed: readonly FrameworkId[] = ['gsd', 'superpowers', 'none']
    const keptAs = (frameworkSet: readonly FrameworkId[]): InitState =>
      enteredWith(GSD_CHOSEN, installed, null, { frameworkSet, frameworkInstalls: ['superpowers'] })
    const again = keptAs(['gsd'])
    const both = keptAs(['gsd', 'superpowers'])
    expect([again.sub, again.openQuestion?.spec.options[0]]).toEqual([{ kind: 'set', tries: 1 }, KEEP_BOTH])
    expect([both.sub, both.draft.frameworkSet]).toEqual([{ kind: 'mode', tries: 1 }, ['gsd', 'superpowers']])
  })

  test('both in use: Keep both or None; superpowers typed alone keeps it and frames the roles on it', () => {
    const state = enteredWith(BOTH_IN_USE, ['gsd', 'superpowers', 'none'])
    const typed = driven(state, ['superpowers']).state.draft
    expect(state.openQuestion?.spec.options).toEqual([KEEP_BOTH, 'None (built-in)'])
    expect([typed.frameworkSet, typed.repoDefault, typed.roles]).toEqual([['superpowers'], 'superpowers', roles])
  })

  test("' GSD , superpowers ' typed reads both; aidlc typed is asked again with the answers and names it takes", () => {
    const state = enteredWith(BOTH_IN_USE, ['gsd', 'superpowers', 'none'])
    const both = nextStage(state, { kind: 'answer', text: ' GSD , superpowers ' })
    const refused = nextStage(state, { kind: 'answer', text: 'aidlc' })
    const accepts = `"${KEEP_BOTH}", "None (built-in)", or the frameworks by name: GSD, superpowers, none`
    expect([both.draft.frameworkSet, both.sub]).toEqual([['gsd', 'superpowers'], { kind: 'mode', tries: 1 }])
    expect(firstLines([refused.openQuestion?.question ?? ''])).toEqual([`'aidlc' isn't one of: ${accepts}.`])
  })

  test('a dismissed set question cancels with its reason and records no set and no install', () => {
    const run = driven(enteredWith(BOTH_IN_USE, ['gsd', 'superpowers', 'none']), [null])
    const { draft } = run.state
    expect(run.state.effect).toEqual({ kind: 'end', reply: cancelledReply(FRAMEWORK_DISMISSED_REASON) })
    expect([draft.frameworkSet, draft.frameworkInstalls, run.outputs]).toEqual([undefined, undefined, []])
  })
})
