/**
 * What `/cadre` asked for: the help text, or the read-only detection. Every input other than empty,
 * `help`, or `detect [--adapters]` is help with the input echoed back as unknown.
 */
export type CadreCommand =
  | {
      kind: 'help'
      /** The input echoed back when it was not `help` or empty; null otherwise. */
      unknown: string | null
    }
  | {
      kind: 'detect'
      /** Whether `--adapters` was given: also show the contract each framework is driven with. */
      adapters: boolean
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
  id: FrameworkId | UnsupportedId
  /** The display name shown in the report. */
  name: string
  status: DetectStatus
  /** The version read from a file or manifest; null when none could be read. */
  version: string | null
  /** Fixed evidence strings (paths, keys, locations), never values read from user files. */
  evidence: string[]
}

/** The kind of a directory entry. A symlink is `other` with `isLink` true. */
export type EntryKind = 'file' | 'dir' | 'other'

/** One top-level entry of the repo root or of its `docs/` folder. */
export type RepoEntry = {
  name: string
  kind: EntryKind
  /** True for a symlink, whatever it points at. */
  isLink: boolean
}

/** The settings file a value was read from. */
export type SettingsSource = 'user' | 'project' | 'local'

/** One `enabledPlugins` key, cleaned, with its value and the settings file it came from. */
export type PluginFlag = {
  key: string
  source: SettingsSource
  value: boolean
}

/** One hook script registered in settings. Only the basename is kept; the command around it is discarded. */
export type HookScript = {
  /** The basename, such as `gsd-context-monitor.js`. */
  script: string
  event: string
  source: SettingsSource
}

/** The version recorded for an installed plugin key. */
export type PluginVersion = {
  key: string
  version: string
}

/** Where a GSD install was found: the user-level install or the one inside the repo. */
export type GsdLocation = 'user' | 'project'

/** One GSD candidate install as the detection reports it. */
export type GsdFact = {
  location: GsdLocation
  /** Display form only: `~/...` or `<repo>/...`. The absolute path is never stored. */
  dir: string
  /** The trimmed VERSION text; null when it could not be read. */
  version: string | null
  /** `proven` when the identity check matched, `absent` when it did not, `unknown` when it could not be read. */
  identity: 'proven' | 'absent' | 'unknown'
  /** Whether the runtime identity command was tried for this candidate. */
  runtimeIdentityTried: boolean
}

/** Everything detection reads, normalised. It is the only input to adapters and to rendering. */
export type Facts = {
  repoEntries: RepoEntry[]
  docsEntries: RepoEntry[]
  /** Already folded across settings sources. */
  enabledPlugins: PluginFlag[]
  hookScripts: HookScript[]
  superpowersVersions: PluginVersion[]
  gsd: GsdFact[]
  /** A read that failed is unknown, never absent: the failure is recorded here. */
  warnings: string[]
}

/** A GSD candidate as the host read it, before normalisation. `dir` is absolute and is never printed. */
export type RawGsdCandidate = {
  location: GsdLocation
  dir: string
  isPresent: boolean
  versionText: string | null
  identityText: string | null
  /** The parsed manifest, unvalidated; normalisation checks its shape. */
  manifest: unknown
  /** The runtime identity command's stdout; null when it was not run or failed. */
  runtimeStdout: string | null
  runtimeTried: boolean
}

/** The host's raw reads, before normalisation into Facts. Every value is unvalidated. */
export type RawFacts = {
  root: string
  home: string | null
  repoEntries: unknown
  docsEntries: unknown
  settings: { source: SettingsSource; value: unknown }[]
  installedPlugins: unknown
  gsd: RawGsdCandidate[]
  warnings: string[]
}

/** The files to read for one GSD candidate. `dir` is absolute: it is used for reads and never printed. */
export type GsdReadTarget = {
  location: GsdLocation
  dir: string
  versionPath: string
  identityPath: string
  manifestPath: string
}

/** The reads the host must perform before detection. Building the plan touches nothing. */
export type ReadPlan = {
  installedPluginsPath: string | null
  gsd: GsdReadTarget[]
  warnings: string[]
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
  id: string
  /** The framework step or skill where the gate happens. */
  where: string
  kind: GateKind
  /** The decision type that owns the gate; null only for standing rules. */
  decisionType: DecisionType | null
  /** True when no pre-supplied answer can replace the person. */
  needsHuman: boolean
  handling: GateHandling
  /** How the role kickoff supplies or escalates the gate. */
  kickoff: string
}

/** A setting change an adapter proposes for autonomy. Phase 1 only describes it; nothing applies it. */
export type SettingProposal = {
  kind: 'command'
  key: string
  /** Commands that read the current value. */
  read: string[]
  /** Commands that write the proposed value. */
  write: string[]
  to: string
  why: string
  /** True when autonomy needs this change; false when the change only helps. */
  isRequired: boolean
}

/** One fact an adapter adds to the detection output, such as the GSD hooks it found. */
export type AdapterFact = {
  name: string
  note: string
}

/** What a role's kickoff text knows about the role and the spec it works from. */
export type KickoffContext = {
  role: string
  /** The spec's path in the repo; null when the role has no spec yet. */
  specPath: string | null
}

/**
 * The contract every framework adapter implements. `detectRule` is shown by `--adapters`.
 * Every field is required except `roleFacts`. `autonomyNote` is null unless `autonomy` is empty, and then it
 * states why the framework needs no autonomy settings.
 */
export type FrameworkAdapter = {
  id: FrameworkId
  name: string
  /** One line, shown by `--adapters`, on how this framework is detected. */
  detectRule: string
  detect(facts: Facts): Detection
  /** The exact commands or skills the role line names to start the work. */
  startWork: string[]
  /** Where specs and plans live, relative to the repo root. */
  locations: { spec: string[]; plan: string[] }
  verify: string[]
  /** The done signal besides AUTOPILOT_DONE: an artifact, and the check that proves it. */
  doneSignal: {
    artifact: string
    check: string
  }
  humanGates: Gate[]
  autonomy: SettingProposal[]
  autonomyNote: string | null
  kickoffText(ctx: KickoffContext): string
  /** Facts the adapter adds to the detection output, such as GSD's hooks. Optional. */
  roleFacts?(facts: Facts): AdapterFact[]
}

/** A repo-root entry that marks a framework cadre does not drive in v1. */
export type UnsupportedMarker = {
  /** The repo-root entry name, such as `aidlc/` or `_bmad/`. */
  marker: string
  id: UnsupportedId
  name: string
  /** Why the framework is not driven autonomously. */
  reason: string
}

/**
 * The adapter choice for a repo. Only `chosen` picks an adapter. `ambiguous` and `installed-only` never
 * preselect one, and `unsupported` and `none` name what was found instead.
 */
export type Choice =
  | {
      kind: 'chosen'
      id: FrameworkId
      /** `only-one-in-use` when one framework is in use; `user` when the person picked it. */
      pickedBy: 'only-one-in-use' | 'user'
      reason: string
    }
  | {
      /** Two or more frameworks are in use; nothing is preselected and the person is asked. */
      kind: 'ambiguous'
      ids: FrameworkId[]
    }
  | {
      /** Nothing is in use but one or more is installed for the user; never chosen automatically. */
      kind: 'installed-only'
      ids: FrameworkId[]
    }
  | {
      kind: 'unsupported'
      ids: UnsupportedId[]
    }
  | {
      kind: 'none'
    }

/** One role of the team. `framework` overrides the repo's adapter for this role; absent means the repo's default. */
export type RoleSpec = {
  id: string
  framework?: FrameworkId
}
