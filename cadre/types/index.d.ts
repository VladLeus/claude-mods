/**
 * Where `/cadre start <id> --terminal` opens the launcher command (D-109, D-126, D-132):
 * - `none`: no `--terminal` was given, so the command is only printed and copied;
 * - `auto`: a bare `--terminal`: a new tmux window inside tmux, else the macOS terminal `TERM_PROGRAM` names;
 * - `terminal`: `--terminal=terminal`, a new macOS Terminal window;
 * - `iterm`: `--terminal=iterm`, a new iTerm tab, or a new window when none is open;
 * - `tmux`: `--terminal=tmux`, a new tmux window;
 * - `invalid`: `--terminal=` with any other value, or the switch given twice: nothing is opened, and the command is
 *   still printed and copied.
 */
export type TerminalChoice = 'none' | 'auto' | 'terminal' | 'iterm' | 'tmux' | 'invalid'

/**
 * What `/cadre` asked for. Empty or `help` is the help text; `detect [--adapters]` is the read-only detection;
 * `init [--dry-run]` is the guided setup; `regen <id> [--dry-run]` re-renders one role from its role.json;
 * `start <id> [--terminal[=terminal|iterm|tmux]]` renders a role's per-launch files and prints its launcher command;
 * `status <id>` reads from disk whether a role's autopilot run is done, running, stopped, not started or unknown, and
 * writes nothing; `epic <KEY> [title] [--terminal[=terminal|iterm|tmux]]` creates or reuses the epic's worktree in the
 * main checkout (D-145); `epic done <KEY> [--force]` removes a finished epic's worktree and keeps its branch (D-152).
 * Any other input is help with the input echoed back as unknown. Plain init writes the plan after Confirm and plain
 * regen writes the role's plan; --dry-run prints the plan and writes nothing.
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
  | {
      readonly kind: 'init'
      /**
       * Whether --dry-run was given: the plan is printed and nothing is written; plain init writes it after Confirm
       * (D-105).
       */
      readonly dryRun: boolean
    }
  | {
      readonly kind: 'regen'
      /** The role id, already matched against the role-id slug (D-48). */
      readonly id: string
      readonly dryRun: boolean
    }
  | {
      readonly kind: 'start'
      /** The role id, already matched against the role-id slug (D-48). */
      readonly id: string
      /** Where `--terminal` asked to open the launcher command; `none` without the switch (D-109). */
      readonly terminal: TerminalChoice
    }
  | {
      readonly kind: 'status'
      /** The role id, already matched against the role-id slug (D-48). */
      readonly id: string
    }
  | {
      readonly kind: 'epic'
      /** The first word as typed, a leading `#` included; epicKeyOf checks it before anything runs (D-162). */
      readonly key: string
      /** The other words joined by one space; '' when there are none. */
      readonly title: string
      /** Where the epic's roles open (D-167): `auto` without `--terminal`, else what terminalOf read from it. */
      readonly terminal: Exclude<TerminalChoice, 'none'>
    }
  /**
   * The removal of a finished epic's worktree (D-152): only when it is clean, merged into the base it was made from and
   * no role of it runs, else a refusal that says why; with `--force`, after one consent question. Its branch is kept.
   */
  | {
      readonly kind: 'epic-done'
      /** The first word as typed, a leading `#` included; epicKeyOf checks it before anything runs (D-162). */
      readonly key: string
      /** Whether `--force` was given: a yes to one consent question removes the worktree, even when a check fails. */
      readonly force: boolean
    }

/**
 * The record of one epic worktree (D-164), at `<worktree git dir>/cadre-epic.json`: per worktree, outside the tree and
 * not shared. Reuse, `/cadre status` and the epic's removal read it, and its parser fails closed on a bad shape.
 */
export type EpicRecord = {
  readonly schema: 1
  /** The epic key, one leading `#` dropped (D-162). */
  readonly key: string
  /** The worktree's folder name below `.claude/worktrees/`; the branch is `epic/<slug>`. */
  readonly slug: string
  readonly title: string
  readonly branch: string
  /** The branch the worktree was made from (the symbolic HEAD), else its commit; null when git could not name it. */
  readonly base: string | null
  /** When cadre made the worktree, in epoch ms. */
  readonly createdAt: number
  /** The repo-relative paths cadre linked into the worktree (D-148). */
  readonly links: readonly string[]
  /** The repo-relative paths cadre copied into the worktree (D-172). */
  readonly copies: readonly string[]
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

/** A logical tool call: cadre resolves `tool` to a real argv from facts (D-71). Args are fixed constants. */
export type ToolCommand = {
  readonly tool: 'gsd-tools'
  readonly args: readonly string[]
}

/** A setting change an adapter proposes for autonomy. Phase 2 shows it as a hunk; nothing runs it. */
export type SettingProposal = {
  readonly kind: 'command'
  readonly key: string
  /** The repo-relative config file the key lives in; its current value is read statically (D-70). */
  readonly file: string
  readonly write: ToolCommand
  readonly to: string
  readonly why: string
  /** True when autonomy needs this change; false when the change only helps. */
  readonly isRequired: boolean
}

/**
 * The autonomy hunks of one framework for one user setup (A5): the repo-relative config file the hunks change, and
 * the proposals to offer for that setup.
 */
export type AutonomyHunks = {
  readonly file: string
  readonly proposals: readonly SettingProposal[]
}

/** One fact an adapter adds to the detection output, such as the GSD hooks it found. */
export type AdapterFact = {
  readonly name: string
  readonly note: string
}

/** What a role's kickoff text knows: the display title, the id used in paths (D-48), and the spec. */
export type KickoffContext = {
  /** The display title, used in sentences. */
  readonly title: string
  /** The role id slug, used in paths. */
  readonly roleId: string
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
  /** The autonomy hunks init offers for a user setup (A5); null when the framework has no config file to change. */
  readonly autonomyHunks: (setup: SetupScan) => AutonomyHunks | null
  readonly kickoffText: (ctx: KickoffContext) => string
  /** Facts the adapter adds to the detection output, such as GSD's hooks. Optional. */
  readonly roleFacts?: (facts: Facts) => readonly AdapterFact[]
  /**
   * The skills that start and check work in this framework (D-77). Every role on it must be able to run them, so scope
   * compile links or enables them; they come through the adapter and are never asked about.
   */
  readonly startSkills: readonly string[]
  /** Whether a scanned skill belongs to this framework, and so comes through the adapter instead of a question. */
  readonly ownsSkill: (skill: SkillRef) => boolean
  /** The plugins a role on this framework enables besides the plugins of its skills, such as the framework's own. */
  readonly pluginsToEnable: readonly string[]
  /** The name prefix of the setup agents the overlay links for a role on this framework; null links none. */
  readonly agentPrefix: string | null
  /** Whether the framework's workflows need Bash: a role on it without Bash runs them through a person (A1). */
  readonly needsBash: boolean
  /** What the kickoff role line of a role starts the session with: a command, a skill or a file. */
  readonly roleStart: (roleId: string) => string
  /** The command a person runs to install the framework; null when there is nothing to install. */
  readonly install: string | null
  /** The heading of the detect report line that lists the adapter's roleFacts; null when no line is shown. */
  readonly factsHeading: string | null
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
 * The adapter choice for a repo. Only `chosen` picks an adapter. `ambiguous` and `installed-only` never choose one for
 * the person, and `unsupported` and `none` name what was found instead.
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
      /** Two or more frameworks are in use; no framework is chosen for the person and they are asked. */
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

/**
 * What a question's context is about (D-229, D-236): one kind per question family, so the renderers can tell how to
 * draw it.
 */
export type ContextKind =
  | 'scan'
  | 'history'
  | 'roles'
  | 'detection'
  | 'security'
  | 'mcp-server'
  | 'skill-group'
  | 'skills'
  | 'skill'
  | 'instructions'
  | 'topic'
  | 'memory'
  | 'memory-group'
  | 'git-policy'
  | 'env'
  | 'hunk'
  | 'improver-install'
  | 'launch'
  | 'launch-dir'
  | 'review'
  | 'conflict-diff'
  | 'improver'
  | 'regen-part'

/**
 * The context a question carries with it (D-203, D-229): a title, the lines that explain the choice, and what it is
 * about. register.tsx keeps it in the open-question state for the renderers; it never reaches the dialog.
 */
export type AskContext = {
  readonly title: string
  readonly lines: readonly string[]
  readonly kind: ContextKind
}

/**
 * One dialog question's options: 2 to 4 labels, an optional header chip (12 characters at most), multi-select; and,
 * kept out of the dialog, the question's own context and whether it takes a typed answer (D-203, D-229, D-234).
 */
export type AskSpec = {
  readonly options: readonly string[]
  readonly header?: string
  readonly multiSelect?: true
  /** The question's own context; register.tsx puts it in the open-question state and never passes it to the dialog. */
  readonly context?: AskContext
  /** The question takes a typed answer, so the TUI default may offer "Describe your own" (D-234). */
  readonly acceptsTyped?: true
}

/** One directory entry as the host lists it. A symlink is `other` with `isLink` true. */
export type PortEntry = {
  readonly name: string
  readonly kind: EntryKind
  readonly size: number
  readonly mtimeMs: number
  readonly isLink: boolean
}

/** A path's stat, always asked with `resolve`; `realPath` is absent when the host could not resolve it. */
export type PortStat = {
  readonly kind: EntryKind
  readonly size: number
  readonly isLink: boolean
  readonly realPath?: string
}

/**
 * A path's stat as apply asks it right before a write (#44): the stat with `resolve`; `absent` when the stat was
 * refused and the host says the path is not there; `failed` when the stat was refused and the path is there or the
 * host could not say, so the write is refused (fail closed).
 */
export type WriteStat = PortStat | 'absent' | 'failed'

/** A file read through the port: absent, unknown (the read failed), over the cap, or its text (Pitfall 6). */
export type PortRead =
  | { readonly state: 'absent' }
  | { readonly state: 'unknown' }
  | { readonly state: 'too-large'; readonly bytes: number }
  | { readonly state: 'text'; readonly text: string }

/** The session root and HOME as given and as resolved, and CLAUDE_CONFIG_DIR, for one init or regen run. */
export type InitLocations = {
  readonly root: string
  readonly givenRoot: string
  readonly home: string | null
  readonly givenHome: string | null
  readonly configDir: string | null
  readonly warnings: readonly string[]
}

/** What the detect pipeline gives init: the normalised facts, and the raw user-level GSD dir. */
export type InitFacts = {
  readonly facts: Facts
  /** Absolute; never printed or written. Null when there is no user-level GSD candidate (D-71 resolver input). */
  readonly gsdUserDir: string | null
}

/**
 * The kinds of block the cadre init side pane shows; the pane holds one block of each kind (D-133, D-135, G-02-1f,
 * G-02-1b), the improver's diff of the built file it asks about included (D-141).
 */
export type PaneKey =
  | 'scan'
  | 'history'
  | 'roles'
  | 'recommendations'
  | 'review'
  | 'env'
  | 'notes'
  | 'instructions'
  | 'skills'
  | 'improver'

/** One block of the cadre init side pane (D-133): its kind, the title drawn in bold above it, and one row per line. */
export type ShownBlock = {
  readonly key: PaneKey
  readonly title: string
  readonly lines: readonly string[]
}

/**
 * The side-pane state of one init run (D-133): `initPane`, the blocks the cadre init pane shows, newest first, and
 * `openQuestion`, the question cadre has open now (R1, D-203); only register.tsx reads and writes them. They are
 * declared in this types contract because `claude plugin validate` takes a plugin's state keys from the manifest's
 * `types` file only.
 */
declare module 'claude-code' {
  interface PluginState {
    cadre: {
      initPane: ShownBlock[]
      /**
       * The question cadre has open now, or null when none is: written by the init port's ask before the dialog and
       * cleared after it (D-203); the cadre init pane draws the block of its header (R1).
       */
      openQuestion: OpenQuestion | null
    }
  }
}

/**
 * The question cadre has open now, as register.tsx keeps it in the openQuestion state (D-203, D-229): its text, its
 * header chip (null when it has none), its context (null when it has none) and whether it takes a typed answer.
 */
export type OpenQuestion = {
  readonly question: string
  readonly header: string | null
  readonly context: AskContext | null
  readonly acceptsTyped: boolean
}

/**
 * The host port init and regen run through. register.tsx builds it from closures over `$`, so pure modules never see
 * `$` (P8). Every member except `ask` maps a host failure to null or `unknown`, never to absent. `list`, `stat`, `read`
 * and `ancestors` take any absolute path, so a caller that reads a repo file must first check that `stat(path).realPath`
 * is inside `locations.root` (the WR-02 containment rule).
 */
export type InitIo = {
  /** Rejects when the person dismisses the dialog; the rejection text is never shown (D-45). */
  readonly ask: (question: string, spec: AskSpec) => Promise<string>
  /**
   * Appends one line to the transcript as a dim notice (the desktop app does not draw it): only for one-line notes,
   * never a block.
   */
  readonly log: (text: string) => void
  /**
   * Shows a block of lines in the cadre init side pane, replacing the block of the same key and putting it first;
   * never rejects.
   */
  readonly show: (block: ShownBlock) => Promise<void>
  /** One status line between questions on the TUI default, or null to clear it; never rejects (D-232). */
  readonly progress: (text: string | null) => Promise<void>
  /** One model completion; the model has no tools (D-83). Null when the model gave no text. */
  readonly complete: (prompt: string, system: string) => Promise<string | null>
  /** True when a surface can show a dialog, false in `claude -p`, null when unknown. */
  readonly isInteractive: () => Promise<boolean | null>
  /** Null when the session root cannot be read. */
  readonly locations: () => Promise<InitLocations | null>
  /** The detect pipeline (the one Phase 1 identity call included) for these locations. */
  readonly facts: (locations: InitLocations) => Promise<InitFacts>
  readonly sessionId: () => Promise<string | null>
  readonly now: () => Promise<number | null>
  /** The version in cadre's own plugin.json; null when it cannot be read. */
  readonly cadreVersion: () => Promise<string | null>
  readonly list: (path: string) => Promise<readonly PortEntry[] | null>
  readonly stat: (path: string) => Promise<PortStat | null>
  /**
   * The stat apply asks before a write, and nothing else asks (#44): the stat with `resolve`, and only after a refused
   * stat whether the path exists; only a clear no is `absent`.
   */
  readonly statForWrite: (path: string) => Promise<WriteStat>
  /** `maxBytes` counts UTF-8 bytes. A path that does not lead to a regular file (after links) reads as `unknown`. */
  readonly read: (path: string, maxBytes: number) => Promise<PortRead>
  /** `$.fs.ancestors({ names })` unvalidated. It carries file content, which only setup.ts may project away. */
  readonly ancestors: (names: readonly string[]) => Promise<unknown>
  /** One settings source unvalidated; null when unreadable. */
  readonly settings: (source: SettingsSource) => Promise<unknown>
  /** `$.command.list()` unvalidated; null when unreadable. */
  readonly commands: () => Promise<unknown>
  /** `$.tool.list()` unvalidated; null when unreadable. */
  readonly tools: () => Promise<unknown>
}

/** What one process run gave: its exit code and its output. A run that exits non-zero is a result, never thrown. */
export type HostRun = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * How one argv runs: with no shell, `env` laid over the host env, and `timeoutMs` from 1 to 600000 (outside that range
 * the host throws, RESEARCH 3.1).
 */
export type RunOptions = {
  readonly cwd?: string
  readonly stdin?: string
  readonly env?: Readonly<Record<string, string>>
  readonly timeoutMs: number
}

/** The only environment variables `/cadre start --terminal` reads; the host needs string-literal names. */
export type HostEnvName = 'TMUX' | 'TERM_PROGRAM'

/**
 * The write and run port apply and `/cadre start` run through, beside InitIo; `/cadre status` is given its run member
 * only (`Pick<HostIo, 'run'>`, #63 A3), so it cannot write. register.tsx builds it from closures over `$`. InitIo never
 * gets these members, so a path that is given only an InitIo (detect, every --dry-run, every refusal and cancel)
 * cannot write or run (T-03-01). Every member maps a host failure to false or null and never reads an error text.
 */
export type HostIo = {
  /** Writes the text to an absolute path, creating its parent folders; false when the host refused or failed. */
  readonly write: (path: string, text: string) => Promise<boolean>
  /** Runs the argv; null when the command could not start, timed out or was refused. */
  readonly run: (argv: readonly string[], options: RunOptions) => Promise<HostRun | null>
  /** The variable's value; null when it is unset, empty or unreadable. */
  readonly env: (name: HostEnvName) => Promise<string | null>
}

/**
 * What the one runtime identity call gave (D-28, WR-01): its stdout when it exited 0, else null, and `could-not-run`
 * when the call threw, which covers node missing from PATH and a timeout alike; the error itself is never read (IN-05).
 */
export type IdentityRunResult = {
  readonly stdout: string | null
  readonly problem: 'could-not-run' | null
}

/**
 * The read port the facts collector goes through (MUST 18). register.tsx builds it from closures over `$`, so
 * scan/facts/collect never sees `$`; collectFacts and locationsOf are the only ones it is given to. Every member but
 * runIdentity maps a host throw to null and never reads an error text. It reads, and runs the one gated runtime
 * identity call, nothing else: it has no general run, write or spawn member (T-02.1-26).
 */
export type FactsPort = {
  /** Whether the path exists; null when the host could not say. */
  readonly exists: (path: string) => Promise<boolean | null>
  /** A folder's listing, unvalidated; null when it cannot be listed. */
  readonly list: (path: string) => Promise<unknown>
  /** A file's text, unvalidated; null when it cannot be read. */
  readonly read: (path: string) => Promise<unknown>
  /** A path's stat, always asked with `resolve`; null when the host refused it. */
  readonly stat: (path: string) => Promise<PortStat | null>
  /** HOME or CLAUDE_CONFIG_DIR, unvalidated; null when it cannot be read. The host reads literal names only. */
  readonly env: (name: 'HOME' | 'CLAUDE_CONFIG_DIR') => Promise<unknown>
  /** One settings source, unvalidated; null when it cannot be read. */
  readonly settings: (source: SettingsSource) => Promise<unknown>
  /**
   * The runtime identity call: an argv runtimeIdentityArgv gave, run with `cwd`, the GSD folder, as its working
   * folder so it never runs in the repo (WR-01). A non-zero exit gives no stdout; a throw gives `could-not-run`.
   */
  readonly runIdentity: (argv: readonly string[], cwd: string) => Promise<IdentityRunResult>
}

/** The git policy for `.cadre/` (D-65, D-90): commit all, commit definitions (the default), or ignore all of it. */
export type GitPolicy = 'all' | 'definitions' | 'ignore'

/** A role of the template (D-54). A custom role names one as `basedOn`, or none (D-92). */
export type TemplateRoleId = 'pm' | 'tl' | 'be' | 'fe' | 'qa' | 'security'

/** The effort levels `claude --effort` takes on 2.1.295 (P18). */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** The modes `claude --permission-mode` takes on 2.1.295 (P18). Init sets `auto` for every role (D-61). */
export type PermissionMode = 'acceptEdits' | 'auto' | 'bypassPermissions' | 'manual' | 'dontAsk' | 'plan'

/** A role's autopilot kickoff values (D-51, D-79, D-87). */
export type RoleAutopilot = {
  /** Autopilot's duration grammar: minutes as digits, or `<h>h<m>m` such as `4h` or `90m`. */
  readonly duration: string
  /** The context threshold in percent; init writes 65 (D-87). */
  readonly threshold: number
  /** `--ask-user`: on for PM, TL and Security (D-10). */
  readonly askUser: boolean
}

/** An instruction or memory group a role may be given at launch (D-63). Only the group is stored, never content. */
export type InstructionGroup = 'global-claude-md' | 'auto-memory' | 'project-claude-md'

/** Where an instruction part was read from (G-02-1f Sources): the user's config folder, or the repo. */
export type PartSource = 'global' | 'repo'

/**
 * One part of an instruction file (G-02-1f Part unit): a section of a CLAUDE.md file, a rule file, AGENTS.md or a doc
 * a repo file links to, cut at its `#` and `##` headings. `id` is `P<n>` in read order; `file` is the raw repo-relative
 * path for a repo part, the display form for a global one (`~/.claude/CLAUDE.md` style); cleaned only where shown
 * (02-GAPS-B2 N3); `heading` is '' for the text before the first heading. `text` is the section as read, its heading
 * line included, held in memory for this run; it is never logged, shown, asked or put in a reply; a repo part a role
 * is given is written to its `.cadre/<id>/CLAUDE.md` after Confirm (generate.ts); originals are never edited. `hash`
 * is the SHA-256 of `text` as 64 lowercase hex characters, for regen (G-02-1f Regen): the same text gives the same
 * hash, whatever file it is in.
 */
export type InstructionPart = {
  readonly id: string
  readonly file: string
  readonly heading: string
  readonly source: PartSource
  readonly text: string
  readonly hash: string
}

/**
 * One topic the model grouped parts into, across files (G-02-1f Part unit): `id` is `T<n>`, the title and summary are
 * cleaned and capped, and `partIds` names the parts it holds; every part is in exactly one topic.
 */
export type InstructionTopic = {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly partIds: readonly string[]
}

/**
 * One auto-memory of this repo as an item of the hand-out (G-02-1f Memories): `id` is `M<n>` in file-name order;
 * `file` is its file name; `folder` is the absolute memory folder that listed it, the one of the root as resolved
 * first, and it is never shown; `summary` is the one-line summary of its MEMORY.md index line, cleaned and capped, or
 * `No summary in MEMORY.md.`; `hash` is the SHA-256 of its text, for regen. Its text is never kept.
 */
export type MemoryItem = {
  readonly id: string
  readonly file: string
  readonly folder: string
  readonly summary: string
  readonly hash: string
}

/**
 * What one consented read of the instruction files gave (G-02-1f): the parts in read order, the files they came from
 * (display form, read order, once each), the auto-memories of this repo in file-name order and the read warnings. The
 * text is held in memory for this run only.
 */
export type InstructionScan = {
  readonly parts: readonly InstructionPart[]
  readonly files: readonly string[]
  readonly memories: readonly MemoryItem[]
  readonly warnings: readonly string[]
}

/**
 * How init handed out the instruction files (G-02-1f): `none` when there was nothing to hand out, `whole` for the D-63
 * whole-file questions, and `parts` for the topics and memories: the read, the topics, the roles the model recommended
 * for each topic and memory (keyed by topic id and memory id; a usable recommendation names every one, and the map is
 * empty when the model gave none) and the roles the person gave each (keyed the same way; a topic or memory no role
 * was given stays with the root session only). The text is held in memory for this run; it is never logged, shown,
 * asked or put in a reply; a repo part a role is given is written to its `.cadre/<id>/CLAUDE.md` after Confirm
 * (generate.ts); originals are never edited.
 */
export type InstructionHandout =
  | { readonly kind: 'none' }
  | { readonly kind: 'whole' }
  | {
      readonly kind: 'parts'
      readonly scan: InstructionScan
      readonly topics: readonly InstructionTopic[]
      readonly recommended: ReadonlyMap<string, readonly string[]>
      readonly given: ReadonlyMap<string, readonly string[]>
    }

/** What a role carries from the init user's settings, as names only; values are rendered at launch (D-60, D-84). */
export type RoleCarry = {
  readonly autoCompactWindow: boolean
  readonly statusLine: boolean
  /** Env variable names the user picked; values are never stored. */
  readonly env: readonly string[]
  /** Hook script basenames re-added at launch, such as `gsd-secret-read-guard.js` (D-62). */
  readonly hooks: readonly string[]
}

/**
 * One role of the team, as `.cadre/<id>/role.json` stores it. `id` is the slug used in paths, launcher names and
 * memory dirs (D-48); `title` is the cleaned display name used in sentences. `framework` absent means the repo default
 * in `.cadre/cadre.json` (D-73).
 */
export type RoleSpec = {
  readonly id: string
  readonly title: string
  readonly purpose: string
  readonly basedOn: TemplateRoleId | null
  readonly framework?: FrameworkId
  /** A model family alias such as `opus`, never a pinned model id (D-52). */
  readonly model: string
  readonly effort: Effort
  readonly permissionMode: PermissionMode
  readonly autopilot: RoleAutopilot
  /** False for PM: Bash is denied, hard-enforced (ROLE-05). */
  readonly hasBash: boolean
  /** MCP server names the role is given (D-53). */
  readonly mcp: readonly string[]
  /** Skill names the role is given, beyond the infra and framework skills every role has (D-53, ISO-04). */
  readonly skills: readonly string[]
  readonly instructions: readonly InstructionGroup[]
  /**
   * The repo parts the role was given (G-02-1f Regen), each by its repo-relative file, its heading ('' for the text
   * before the first heading) and the SHA-256 of its text, so regen can compare them with the files as they are now
   * (partChanges). It is committed with role.json, so it never holds a global part or a memory: those are recorded only
   * in the role's private instructions.json (D-140 q2-a). Absent in a role.json written before it, which still parses.
   */
  readonly instructionParts?: readonly InstructionPartRecord[]
  /**
   * The other repo parts of the files the records name, which the role was not given (G-02-1f Regen, AUTO-PICK #19
   * Q1), recorded the same way: regen asks a part only when neither list names its file and heading, so a part given
   * to another role or kept with the root session is never asked as new. Committed with role.json; absent when there
   * is none.
   */
  readonly instructionPartsNotGiven?: readonly InstructionPartRecord[]
  readonly carry: RoleCarry
}

/** A part as a role's records name it (G-02-1f Regen): its file, its heading and the SHA-256 of its text. */
export type InstructionPartRecord = {
  readonly file: string
  readonly heading: string
  readonly hash: string
}

/** One scan-driven change to the template proposal, with its reason and evidence (ROLE-01, D-49, D-85). */
export type RoleChange = {
  readonly roleId: TemplateRoleId
  readonly change: 'dropped' | 'kept'
  readonly reason: string
  /** Repo-relative paths that justify the change; empty when the reason is an absence. */
  readonly evidence: readonly string[]
}

/** The roles init proposes and the scan-driven changes behind them. */
export type RoleProposal = {
  readonly roles: readonly RoleSpec[]
  readonly changes: readonly RoleChange[]
}

/** A role the model proposed from the user's free text, after validation (D-83, D-92). */
export type ProposedRole = {
  readonly id: string
  readonly title: string
  readonly purpose: string
  readonly basedOn: TemplateRoleId | null
}

/** Present, absent, or unknown (a read that failed). Unknown is never treated as absent (Pitfall 6). */
export type ReadState = 'present' | 'absent' | 'unknown'

/** What a repo-scan finding is evidence of (D-55). */
export type ScanKind = 'fe' | 'be' | 'lang' | 'test' | 'e2e'

/** One repo-scan finding with the repo-relative path that proves it. */
export type ScanFinding = {
  readonly kind: ScanKind
  readonly label: string
  readonly evidence: string
}

/** How a generated file is written: a plain file, or an executable launcher. */
export type FileMode = 'file' | 'exec'

/** One file cadre generated, as `.cadre/manifest.json` records it (PLAN-04). */
export type ManifestEntry = {
  /** Repo-relative, normalised, no `..` and no leading `/`. */
  readonly path: string
  /** Lowercase hex SHA-256 of the content cadre generated. */
  readonly sha256: string
  readonly mode: FileMode
}

/** `.cadre/manifest.json`: every generated file with its hash. No timestamps, so a re-run hashes stably. */
export type Manifest = {
  readonly schema: 1
  readonly cadreVersion: string
  readonly files: readonly ManifestEntry[]
}

/**
 * Where a role launcher starts its session (A2): at the git root, in the folder it is run from, or in a folder of the
 * repo. `path` is repo-relative and passes isSafeRelativePath.
 */
export type LaunchStart =
  | { readonly kind: 'git-root' }
  | { readonly kind: 'here' }
  | { readonly kind: 'dir'; readonly path: string }

/** `.cadre/cadre.json`: the repo-level answers regen and the ignore block need (D-89). */
export type CadreState = {
  readonly schema: 1
  readonly cadreVersion: string
  /** The repo default framework; null when every role stores its own (ambiguous or installed-only, D-73). */
  readonly framework: FrameworkId | null
  readonly gitPolicy: GitPolicy
  readonly roles: readonly string[]
  /** Where every role launcher of the repo starts its session; init asks it once per repo (A2). */
  readonly launchStart: LaunchStart
  /**
   * Whether the person who ran init allowed reading ~/.claude.json for MCP server names (D-58). Regen reads
   * ~/.claude.json only when it is true, so the MCP denies init compiled from it are kept (A1).
   */
  readonly readUserMcp: boolean
}

/** What the repo scan found (SCAN-01): a separate type beside the frozen Facts (D-88). */
export type RepoScan = {
  readonly findings: readonly ScanFinding[]
  /** Source languages by display name (`TypeScript`), sorted. */
  readonly languages: readonly string[]
  /** Top-level repo-relative folders that hold source files, sorted (PM's best-effort Read deny). */
  readonly codeDirs: readonly string[]
  readonly hasSource: boolean
  /** Folders below the first level whose listing stopped at MAX_FOLDER_ENTRIES (D-137). */
  readonly cappedFolders: readonly string[]
  /** True when the walk stopped at the 20,000-entry safety cap (D-137). */
  readonly isOverallCapped: boolean
  readonly cadre: {
    readonly dir: ReadState
    readonly manifest: Manifest | null
    readonly manifestState: ReadState
    readonly state: CadreState | null
    readonly stateState: ReadState
  }
  readonly warnings: readonly string[]
}

/** A skill or plugin command by name, with the plugin that adds it; null for user and project skills. */
export type SkillRef = {
  readonly name: string
  readonly plugin: string | null
  /**
   * The skill's one-line description, cleaned and cut to 120 code points; in memory only, for the questions and the
   * recommendation call; never written (D-139).
   */
  readonly purpose?: string
}

/** Where an MCP server name was seen (D-57, D-58). */
export type McpSource = 'project' | 'session' | 'user-config'

/** One MCP server by name only. */
export type McpRef = {
  readonly name: string
  readonly source: McpSource
}

/** The carried settings facts, as a number, booleans and names only (D-60). */
export type CarryFacts = {
  readonly autoCompactWindow: number | null
  readonly hasStatusLine: boolean
  readonly isGsdStatusline: boolean
  /** Names from the user settings `env`; values are never read into the scan. */
  readonly envNames: readonly string[]
}

/**
 * What the user-setup scan kept: names, counts and booleans only (SCAN-02, D-57), and each skill's purpose, which is
 * held in memory and never written (D-139).
 */
export type SetupScan = {
  /**
   * The plugin keys set true in enabledPlugins of any settings source, the repo's own included, and the keys installed
   * for the user or this repo, sorted and once each. A role's settings enable plugins from these.
   */
  readonly plugins: readonly string[]
  /**
   * The keys installed for the user or this repo, from `installed_plugins.json` only, sorted and once each: no settings
   * file adds one, so a repo cannot make a plugin look installed. Whether a security plugin is missing is read from
   * these (decision #69 A1).
   */
  readonly installedPlugins: readonly string[]
  readonly skills: readonly SkillRef[]
  readonly mcp: readonly McpRef[]
  /**
   * True when the scan could not see every MCP server (A4): it dropped a name a role.json cannot hold, or it did not
   * read `~/.claude.json` (no consent, no user folder, or a file it could not read or parse). Such a server is not
   * denied.
   */
  readonly isMcpPartial: boolean
  readonly agents: readonly string[]
  /** CLAUDE.md files in the chain, in display form (`<repo>/CLAUDE.md`, `~/...`), never their content. */
  readonly claudeMd: readonly string[]
  readonly hasGlobalClaudeMd: boolean
  readonly memoryFiles: readonly string[]
  readonly settingsKeys: readonly { readonly source: SettingsSource; readonly keys: readonly string[] }[]
  readonly hooks: readonly HookScript[]
  readonly carry: CarryFacts
  readonly warnings: readonly string[]
}

/** How a scope rule holds: enforced by the engine, best effort, or not enforced at all (a warning). */
export type Enforcement = 'hard' | 'best-effort' | 'none'

/**
 * What `<launcher> --probe` checks in the init event of a print-mode start of the role (D-112, D-130), by what that
 * event must show for the rule to hold:
 * - `tool-absent`: `tools` does not list the tool named by the token;
 * - `tool-prefix-absent`: no name in `tools` starts with the token, `mcp__<server>__` for a denied server (D-124);
 * - `tool-present`: `tools` lists the tool named by the token;
 * - `command-present`: `slash_commands` lists the command named by the token;
 * - `skill-present`: `skills` lists the skill named by the token;
 * - `permission-mode`: `permissionMode` is the token;
 * - `memory-path`: `memory_paths.auto` is the folder of the token, with or without a trailing `/` (ISO-03);
 * - `not-visible`: nothing; the event cannot show the rule, so the probe reports it best-effort;
 * - `note`: nothing; the rule is labelled none, a note the probe prints as it is.
 */
export type ProbeCheckKind =
  | 'tool-absent'
  | 'tool-prefix-absent'
  | 'tool-present'
  | 'command-present'
  | 'skill-present'
  | 'permission-mode'
  | 'memory-path'
  | 'not-visible'
  | 'note'

/** One check on a scope rule: a kind the init event can show for a rule, and the name or value it compares. */
export type ProbeCheck = {
  readonly kind: Exclude<ProbeCheckKind, 'memory-path' | 'not-visible' | 'note'>
  readonly token: string
}

/** One line of a scope card. */
export type ScopeRule = {
  readonly text: string
  readonly enforcement: Enforcement
  /** What the startup inventory must show for the rule to hold (D-112); absent when it cannot show it. */
  readonly checks?: readonly ProbeCheck[]
}

/**
 * One line of `.cadre/<id>/.runtime/probe-expectations.json` (D-130): the check, the label of its rule, the text the
 * probe prints and the token it compares; the token is '' for not-visible and note.
 */
export type ProbeExpectation = {
  readonly check: ProbeCheckKind
  readonly enforcement: Enforcement
  readonly text: string
  readonly token: string
}

/** The MCP isolation route; Phase 3 uses merged for every role (D-104), strict stays a parameter. */
export type McpRoute = 'merged' | 'strict'

/** What compileScope needs beside the role. */
export type ScopeContext = {
  /** The role's framework: its own `framework`, else the repo default. */
  readonly framework: FrameworkId
  readonly setup: SetupScan
  readonly codeDirs: readonly string[]
  readonly isAttended: boolean
  readonly mcpRoute: McpRoute
  /** Where the role's launcher starts its session (A2): the card tells what loads there (D-122, D-127, D-113). */
  readonly launchStart: LaunchStart
  /**
   * Every role of the team, for the decision chain through basedOn (D-12, D-54, U5), in the ChainRole shape of
   * roles.ts: a role id, or a role's id with the template role it is based on.
   */
  readonly roles: readonly (string | Pick<RoleSpec, 'id' | 'basedOn'>)[]
}

/** The committed settings template: portable keys only (D-84). Per-user values are rendered at launch. */
export type SettingsTemplate = {
  readonly enabledPlugins: Readonly<Record<string, boolean>>
  readonly permissions: { readonly defaultMode: PermissionMode; readonly deny: readonly string[] }
  readonly sandbox: { readonly enabled: boolean }
}

/** The committed MCP file: the server names this role is given (D-93). Phase 3 renders the real --mcp-config at launch. */
export type McpConfig = {
  readonly schema: 1
  readonly servers: readonly string[]
}

/** What a role can see and what holds it there (ROLE-06). */
export type ScopeCard = {
  readonly roleId: string
  readonly title: string
  readonly framework: FrameworkId
  readonly model: string
  readonly effort: Effort
  readonly permissionMode: PermissionMode
  /** True when role.json sets bypassPermissions by hand; the card leads with a warning (D-61, D-95). */
  readonly isBypass: boolean
  readonly isAttended: boolean
  readonly skills: readonly string[]
  readonly mcp: readonly string[]
  readonly notGiven: { readonly skills: readonly string[]; readonly mcp: readonly string[] }
  /**
   * The scanned hook scripts by what loads them in a role session (D-62, A1): `loaded` are the hooks the role carries;
   * `loadedByProject` are scripts registered in project settings that are not carried, which load because the launcher
   * runs `--setting-sources project`, and only for a git-root start: a `here` or `dir` start does not load the project
   * settings of the git root, so the list is empty and those scripts are not loaded (D-122); `notLoaded` are the
   * scripts that are neither. Each list is sorted, once each.
   */
  readonly hooks: {
    readonly loaded: readonly string[]
    readonly loadedByProject: readonly string[]
    readonly notLoaded: readonly string[]
  }
  readonly rules: readonly ScopeRule[]
  readonly chain: readonly string[]
  /**
   * The memory dir pattern shown on the card, `<config dir>/cadre/<repo>-<hash8>/<id>/`, where `<config dir>` is
   * CLAUDE_CONFIG_DIR when it is set, else ~/.claude; Phase 3 renders it (D-91).
   */
  readonly memoryPattern: string
  readonly mcpRoute: McpRoute
}

/** compileScope's one result: settings, MCP file, launcher flags, overlay and card cannot drift (D-80). */
export type CompiledScope = {
  readonly settings: SettingsTemplate
  readonly mcp: McpConfig
  readonly flags: readonly string[]
  readonly overlay: { readonly skills: readonly string[]; readonly agents: readonly string[] }
  readonly card: ScopeCard
}

/** One file the plan wants on disk. */
export type DesiredFile = {
  readonly path: string
  readonly content: string
  readonly mode: FileMode
}

/** What the plan does to one file (D-67): create, change, leave, or conflict (a user-edited file). */
export type FileOpKind = 'create' | 'change' | 'leave' | 'conflict'

/** One planned file operation: what happens to one path, with its mode, an optional note and optional detail rows. */
export type FileOp = {
  readonly kind: FileOpKind
  readonly path: string
  readonly mode: FileMode
  readonly note: string | null
  /**
   * Rows shown under the path: the lines the .gitignore op writes between the cadre markers, markers included
   * (PLAN-03). Absent for every other op.
   */
  readonly detail?: readonly string[]
}

/** One framework autonomy change shown as before/after and accepted one by one (ROLE-04, D-70). */
export type HunkOp = {
  readonly kind: 'hunk'
  /** Repo-relative config file, such as `.planning/config.json`. */
  readonly file: string
  readonly key: string
  /**
   * Display text: a string value JSON-quoted, a number or boolean as itself; the write runs `command`, never this
   * text.
   */
  readonly before: string
  /**
   * Display text: a string value JSON-quoted, a number or boolean as itself; the write runs `command`, never this
   * text.
   */
  readonly after: string
  readonly isRequired: boolean
  readonly isAccepted: boolean
  /** False when cadre will not run the write (repo-local GSD only, D-72): the person runs `command`. */
  readonly isRunnable: boolean
  /** The exact command in display form (D-71, D-72). */
  readonly command: string
}

/** One entry of the file plan: a file operation or a framework config hunk. */
export type Op = FileOp | HunkOp

/** The file plan (PLAN-01). */
export type Plan = {
  readonly ops: readonly Op[]
  readonly warnings: readonly string[]
}

/**
 * One print-only recommendation (ROLE-03, D-74): the line installs nothing; init asks before it installs the security
 * plugins (decision #39).
 */
export type Recommendation = {
  readonly tool: string
  /** The role that benefits; null when every role does. */
  readonly roleId: string | null
  readonly why: string
  /** The exact command for the person to run; null when there is nothing to run, so no run line is printed (E3). */
  readonly install: string | null
}
