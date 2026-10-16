/**
 * What `/cadre` asked for: the help text, or the read-only detection. Every input other than empty,
 * `help`, or `detect [--adapters]` is help with the input echoed back as unknown.
 */
export type CadreCommand =
  | {
      readonly kind: 'help'
      /** The input echoed back when it was not `help` or empty; null otherwise. */
      readonly unknown: string | null
    }
  | {
      readonly kind: 'detect'
      /** Whether `--adapters` was given: also show the contract each framework is driven with. */
      readonly adapters: boolean
    }

/** A framework cadre has an adapter for. `none` is the built-in fallback, not a framework found in the repo. */
export type FrameworkId = 'gsd' | 'superpowers' | 'none'

/** A marker of a framework cadre detects but does not drive autonomously in v1. */
export type UnsupportedId = 'aidlc' | 'bmad' | 'spec-kit'

/** How one framework stands in this repo. `in-use` beats `installed`; `unsupported` is never folded into `none`. */
export type DetectStatus = 'in-use' | 'installed' | 'not-found' | 'unsupported'

/** One framework's detection result, with the evidence that justifies its status. */
export type Detection = {
  /** A supported adapter id, or an unsupported marker id. */
  readonly id: FrameworkId | UnsupportedId
  /** The display name shown in the report. */
  readonly name: string
  readonly status: DetectStatus
  /** The version read from a file or manifest; null when none could be read. */
  readonly version: string | null
  /** Fixed evidence strings (paths, keys, locations), never values read from user files. */
  readonly evidence: readonly string[]
}

/** The kind of a directory entry. A symlink is `other` with `isLink` true. */
export type EntryKind = 'file' | 'dir' | 'other'

/** One top-level entry of the repo root or of its `docs/` folder. */
export type RepoEntry = {
  readonly name: string
  readonly kind: EntryKind
  /** True for a symlink, whatever it points at. */
  readonly isLink: boolean
}

/** The settings file a value was read from. */
export type SettingsSource = 'user' | 'project' | 'local'

/** One `enabledPlugins` key, cleaned, with its value and the settings file it came from. */
export type PluginFlag = {
  readonly key: string
  readonly source: SettingsSource
  readonly value: boolean
}

/** One hook script registered in settings. Only the basename is kept; the command around it is discarded. */
export type HookScript = {
  /** The basename, such as `gsd-context-monitor.js`. */
  readonly script: string
  readonly event: string
  readonly source: SettingsSource
}

/** The version recorded for an installed plugin key. */
export type PluginVersion = {
  readonly key: string
  readonly version: string
}

/** Where a GSD install was found: the user-level install or the one inside the repo. */
export type GsdLocation = 'user' | 'project'

/** One GSD candidate install as the detection reports it. */
export type GsdFact = {
  readonly location: GsdLocation
  /**
   * Display form only: `<repo>/...`, `~/...`, or `$CLAUDE_CONFIG_DIR/...` for a CLAUDE_CONFIG_DIR outside the home
   * folder. Any other path would show cleaned as given, but detection reads no path outside those three folders.
   */
  readonly dir: string
  /** The trimmed VERSION text; null when it could not be read. */
  readonly version: string | null
  /** `proven` when the identity check matched, `absent` when it did not, `unknown` when it could not be read. */
  readonly identity: 'proven' | 'absent' | 'unknown'
  /** Whether the runtime identity command was tried for this candidate. */
  readonly runtimeIdentityTried: boolean
}

/** Everything detection reads, normalised. It is the only input to adapters and to rendering. */
export type Facts = {
  readonly repoEntries: readonly RepoEntry[]
  readonly docsEntries: readonly RepoEntry[]
  /** Already folded across settings sources. */
  readonly enabledPlugins: readonly PluginFlag[]
  readonly hookScripts: readonly HookScript[]
  readonly superpowersVersions: readonly PluginVersion[]
  readonly gsd: readonly GsdFact[]
  /** A read that failed is unknown, never absent: the failure is recorded here. */
  readonly warnings: readonly string[]
}

/** A GSD candidate as the host read it, before normalisation. `dir` is absolute and is never printed. */
export type RawGsdCandidate = {
  readonly location: GsdLocation
  readonly dir: string
  readonly isPresent: boolean
  readonly versionText: string | null
  readonly identityText: string | null
  /** The parsed manifest, unvalidated; normalisation checks its shape. */
  readonly manifest: unknown
  /** The runtime identity command's stdout; null when it was not run or failed. */
  readonly runtimeStdout: string | null
  readonly runtimeTried: boolean
}

/** The host's raw reads, before normalisation into Facts. Every value is unvalidated. */
export type RawFacts = {
  readonly root: string
  readonly home: string | null
  readonly repoEntries: unknown
  readonly docsEntries: unknown
  readonly settings: readonly { readonly source: SettingsSource; readonly value: unknown }[]
  readonly installedPlugins: unknown
  readonly gsd: readonly RawGsdCandidate[]
  readonly warnings: readonly string[]
}

/** The files to read for one GSD candidate. `dir` is absolute: it is used for reads and never printed. */
export type GsdReadTarget = {
  readonly location: GsdLocation
  readonly dir: string
  readonly versionPath: string
  readonly identityPath: string
  readonly manifestPath: string
}

/** The reads the host must perform before detection. Building the plan touches nothing. */
export type ReadPlan = {
  readonly installedPluginsPath: string | null
  readonly gsd: readonly GsdReadTarget[]
  readonly warnings: readonly string[]
}

/**
 * A kind of decision or gate. Owners: Product goes to PM, Arch and QA to TL, Security to Security.
 * The owner map itself is role-template data, added in Phase 2.
 */
export type DecisionType = 'Product' | 'Arch' | 'Security' | 'QA'

/** Where a gate happens: an AskUserQuestion menu, a chat approval, plain text, a UAT step, or a standing rule. */
export type GateKind = 'auq' | 'chat' | 'plaintext' | 'uat' | 'standing-rule'

/** What happens at a gate in an autonomous role. */
export type GateHandling = 'preapprove' | 'escalate' | 'autopilot-denies' | 'config-required' | 'standing-rule'

/** One place a framework stops for a decision. The adapter lists these so the kickoff can answer them in advance. */
export type Gate = {
  readonly id: string
  /** The framework step or skill where the gate happens. */
  readonly where: string
  readonly kind: GateKind
  /** The decision type that owns the gate; null only for standing rules. */
  readonly decisionType: DecisionType | null
  /** True when no pre-supplied answer can replace the person. */
  readonly needsHuman: boolean
  readonly handling: GateHandling
  /** How the role kickoff supplies or escalates the gate. */
  readonly kickoff: string
}

/** A setting change an adapter proposes for autonomy. Phase 1 only describes it; nothing applies it. */
export type SettingProposal = {
  readonly kind: 'command'
  readonly key: string
  /**
   * The argv that reads the current value. `argv[0]` is a logical tool name such as `gsd-tools`, not an executable on
   * PATH: the executor resolves it (for GSD, to `node <gsd dir>/bin/gsd-tools.cjs`).
   */
  readonly read: readonly string[]
  /** The argv that writes the proposed value; `argv[0]` is a logical tool name, resolved the same way as for `read`. */
  readonly write: readonly string[]
  readonly to: string
  readonly why: string
  /** True when autonomy needs this change; false when the change only helps. */
  readonly isRequired: boolean
}

/** One fact an adapter adds to the detection output, such as the GSD hooks it found. */
export type AdapterFact = {
  readonly name: string
  readonly note: string
}

/** What a role's kickoff text knows about the role and the spec it works from. */
export type KickoffContext = {
  readonly role: string
  /** The spec's path in the repo; null when the role has no spec yet. */
  readonly specPath: string | null
}

/**
 * The contract every framework adapter implements. `detectRule` is shown by `--adapters`.
 * Every field is required except `roleFacts`. `autonomyNote` is null unless `autonomy` is empty, and then it
 * states why the framework needs no autonomy settings.
 */
export type FrameworkAdapter = {
  readonly id: FrameworkId
  readonly name: string
  /** One line, shown by `--adapters`, on how this framework is detected. */
  readonly detectRule: string
  readonly detect: (facts: Facts) => Detection
  /** The exact commands or skills the role line names to start the work. */
  readonly startWork: readonly string[]
  /** Where specs and plans live, relative to the repo root. */
  readonly locations: { readonly spec: readonly string[]; readonly plan: readonly string[] }
  readonly verify: readonly string[]
  /** The done signal besides AUTOPILOT_DONE: an artifact, and the check that proves it. */
  readonly doneSignal: {
    readonly artifact: string
    readonly check: string
  }
  readonly humanGates: readonly Gate[]
  readonly autonomy: readonly SettingProposal[]
  readonly autonomyNote: string | null
  readonly kickoffText: (ctx: KickoffContext) => string
  /** Facts the adapter adds to the detection output, such as GSD's hooks. Optional. */
  readonly roleFacts?: (facts: Facts) => readonly AdapterFact[]
}

/** A repo-root entry that marks a framework cadre does not drive in v1. */
export type UnsupportedMarker = {
  /** The repo-root entry name, such as `aidlc/` or `_bmad/`. */
  readonly marker: string
  readonly id: UnsupportedId
  readonly name: string
  /** Why the framework is not driven autonomously. */
  readonly reason: string
}

/**
 * The adapter choice for a repo. Only `chosen` picks an adapter. `ambiguous` and `installed-only` never
 * preselect one, and `unsupported` and `none` name what was found instead.
 */
export type Choice =
  | {
      readonly kind: 'chosen'
      readonly id: FrameworkId
      /** `only-one-in-use` when one framework is in use; `user` when the person picked it. */
      readonly pickedBy: 'only-one-in-use' | 'user'
      readonly reason: string
    }
  | {
      /** Two or more frameworks are in use; nothing is preselected and the person is asked. */
      readonly kind: 'ambiguous'
      readonly ids: readonly FrameworkId[]
    }
  | {
      /** Nothing is in use but one or more is installed for the user; never chosen automatically. */
      readonly kind: 'installed-only'
      readonly ids: readonly FrameworkId[]
    }
  | {
      readonly kind: 'unsupported'
      readonly ids: readonly UnsupportedId[]
    }
  | {
      readonly kind: 'none'
    }

/** One role of the team. `framework` overrides the repo's adapter for this role; absent means the repo's default. */
export type RoleSpec = {
  readonly id: string
  readonly framework?: FrameworkId
}
