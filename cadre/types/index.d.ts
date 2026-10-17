/**
 * What `/cadre` asked for. Empty or `help` is the help text; `detect [--adapters]` is the read-only detection;
 * `init [--dry-run]` is the guided setup; `regen <id> [--dry-run]` re-renders one role, but its grammar arrives in plan
 * 02-13 and the parser does not give it before then. Any other input is help with the input echoed back as unknown.
 * Phase 2 writes nothing on any path.
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
      /** Whether `--dry-run` was given. In Phase 2 plain init prints the same plan and also writes nothing (D-44). */
      readonly dryRun: boolean
    }
  | {
      readonly kind: 'regen'
      /** The role id, already matched against the role-id slug (D-48). */
      readonly id: string
      readonly dryRun: boolean
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

/** One dialog question's options: 2 to 4 labels, an optional header chip (12 characters at most), multi-select. */
export type AskSpec = {
  readonly options: readonly string[]
  readonly header?: string
  readonly multiSelect?: true
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
 * The host port init and regen run through. register.tsx builds it from closures over `$`, so pure modules never see
 * `$` (P8). Every member except `ask` maps a host failure to null or `unknown`, never to absent. `list`, `stat`, `read`
 * and `ancestors` take any absolute path, so a caller that reads a repo file must first check that `stat(path).realPath`
 * is inside `locations.root` (the WR-02 containment rule).
 */
export type InitIo = {
  /** Rejects when the person dismisses the dialog; the rejection text is never shown (D-45). */
  readonly ask: (question: string, spec: AskSpec) => Promise<string>
  /** One transcript entry of at most 2000 characters (P9). */
  readonly log: (text: string) => void
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
  readonly carry: RoleCarry
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

/** `.cadre/cadre.json`: the repo-level answers regen and the ignore block need (D-89). */
export type CadreState = {
  readonly schema: 1
  readonly cadreVersion: string
  /** The repo default framework; null when every role stores its own (ambiguous or installed-only, D-73). */
  readonly framework: FrameworkId | null
  readonly gitPolicy: GitPolicy
  readonly roles: readonly string[]
}

/** What the repo scan found (SCAN-01): a separate type beside the frozen Facts (D-88). */
export type RepoScan = {
  readonly findings: readonly ScanFinding[]
  /** Source languages by display name (`TypeScript`), sorted. */
  readonly languages: readonly string[]
  /** Top-level repo-relative folders that hold source files, sorted (PM's best-effort Read deny). */
  readonly codeDirs: readonly string[]
  readonly hasSource: boolean
  /** True when the walk stopped at the 2000-entry cap; the depth limit alone never sets it. */
  readonly isTruncated: boolean
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

/** What the user-setup scan kept: names, counts and booleans only (SCAN-02, D-57). */
export type SetupScan = {
  readonly plugins: readonly string[]
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

/** One line of a scope card. */
export type ScopeRule = {
  readonly text: string
  readonly enforcement: Enforcement
}

/** The MCP isolation route, an open parameter until Phase 3 (D-26, D-78). */
export type McpRoute = 'merged' | 'strict'

/** What compileScope needs beside the role. */
export type ScopeContext = {
  /** The role's framework: its own `framework`, else the repo default. */
  readonly framework: FrameworkId
  readonly setup: SetupScan
  readonly codeDirs: readonly string[]
  readonly isAttended: boolean
  readonly mcpRoute: McpRoute
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
  readonly hooks: { readonly loaded: readonly string[]; readonly notLoaded: readonly string[] }
  readonly rules: readonly ScopeRule[]
  readonly chain: readonly string[]
  /** The memory dir pattern shown on the card; Phase 3 renders it (D-91). */
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

/** One planned file operation: what happens to one path, with its mode and an optional note. */
export type FileOp = {
  readonly kind: FileOpKind
  readonly path: string
  readonly mode: FileMode
  readonly note: string | null
}

/** One framework autonomy change shown as before/after and accepted one by one (ROLE-04, D-70). */
export type HunkOp = {
  readonly kind: 'hunk'
  /** Repo-relative config file, such as `.planning/config.json`. */
  readonly file: string
  readonly key: string
  readonly before: string
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

/** One print-only recommendation (ROLE-03, D-74): nothing is installed. */
export type Recommendation = {
  readonly tool: string
  /** The role that benefits; null when every role does. */
  readonly roleId: string | null
  readonly why: string
  /** The exact command for the person to run. */
  readonly install: string
}
