/**
 * The golden fixtures of a plain `/cadre init` (D-219): the run, the path, sha256 and outcome of every write, every
 * host run and the manifest text, in the `nothing` world and in the GSD world whose proven user GSD runs the `mode`
 * hunk through the host (modeWorld), both with the INIT_ANSWERS defaults and a host where every write and run works.
 * Captured from the code by a scratch run and pasted as printed; init-apply.test.ts runs each again and compares with
 * toEqual. Only an approved behaviour-change commit may change a fixture. Only the golden modules import it.
 */
import type { GoldenApply } from './types'

/** Each applied run by world name. */
export const GOLDEN_INIT_APPLY: Readonly<Record<string, GoldenApply>> = {
  "nothing": {
    "run": {
      "asks": [
        {
          "question": [
            "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.",
            "Without it, init still finds MCP servers in .mcp.json, your plugins and this session."
          ],
          "header": "claude.json",
          "options": [
            "No, skip it",
            "Yes, read names only"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Use these roles?",
            "Proposed: PM (pm), Team Lead (tl), Security (security); 3 changes from the scan."
          ],
          "header": "Roles",
          "options": [
            "Use these roles",
            "Adjust them",
            "Describe my own structure"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Install from claude-plugins-official after you confirm the plan: claude-security and security-guidance? claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo. security-guidance adds hooks that warn about risky edits.",
            "Nothing is installed before you confirm the final review, and a --dry-run installs nothing."
          ],
          "header": "Security",
          "options": [
            "Install",
            "Not now"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Autopilot duration for roles?",
            "Applies to every role: pm, tl, security."
          ],
          "header": "Duration",
          "options": [
            "4h",
            "2h",
            "8h"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Model and effort: same for all roles, or per role?",
            "Roles: pm, tl, security."
          ],
          "header": "Model",
          "options": [
            "Same for all roles",
            "Per role"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Model and effort for all roles?",
            "Models: opus, sonnet, haiku, fable; efforts: low, medium, high, xhigh, max."
          ],
          "header": "Model",
          "options": [
            "opus + medium",
            "sonnet + medium",
            "sonnet + high"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Install mattpocock-skills from claude-plugins-official for PM after you confirm the plan? It gives PM mattpocock-skills:grilling and mattpocock-skills:grill-me.",
            "It runs from the repo root at project scope, never in a --dry-run: claude plugin install mattpocock-skills@claude-plugins-official --scope project"
          ],
          "header": "Skills",
          "options": [
            "No",
            "Yes, install it"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Git policy for .cadre/?",
            "Commit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. Ignore all: nothing in .cadre/ is committed."
          ],
          "header": "Git policy",
          "options": [
            "Commit definitions (default)",
            "Commit all",
            "Ignore all of .cadre/"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Where should the role launchers start their sessions? (asked once for this repo)",
            "The launcher of each role (pm, tl, security) starts its session there."
          ],
          "header": "Launch",
          "options": [
            "Git root of this repo",
            "The folder I run it from",
            "Another folder in this repo"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
            "Summary: 26 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
            "Use a button, or type duration, model, assignments, memory, env or hunks under Other."
          ],
          "header": "Review",
          "options": [
            "Next page",
            "Confirm",
            "Change something…"
          ],
          "multiSelect": false
        }
      ],
      "logged": [
        "No session history for this repo.",
        "PM runs without its grill skills: to add them, run claude plugin install mattpocock-skills@claude-plugins-official --scope project from the repo root, then /cadre init again."
      ],
      "shown": [],
      "promptHashes": [],
      "reply": [
        "cadre init",
        "File plan:",
        "  create    .cadre/INDEX.md",
        "  create    .cadre/bin/pm (executable)",
        "  create    .cadre/bin/security (executable)",
        "  create    .cadre/bin/tl (executable)",
        "  create    .cadre/cadre.json",
        "  create    .cadre/manifest.json",
        "  create    .cadre/pm/CLAUDE.md",
        "  create    .cadre/pm/ROLE.md",
        "  create    .cadre/pm/kickoff.txt",
        "  create    .cadre/pm/mcp.json",
        "  create    .cadre/pm/role.json",
        "  create    .cadre/pm/settings.json",
        "  create    .cadre/security/CLAUDE.md",
        "  create    .cadre/security/ROLE.md",
        "  create    .cadre/security/kickoff.txt",
        "  create    .cadre/security/mcp.json",
        "  create    .cadre/security/role.json",
        "  create    .cadre/security/settings.json",
        "  create    .cadre/sizing.md",
        "  create    .cadre/tl/CLAUDE.md",
        "  create    .cadre/tl/ROLE.md",
        "  create    .cadre/tl/kickoff.txt",
        "  create    .cadre/tl/mcp.json",
        "  create    .cadre/tl/role.json",
        "  create    .cadre/tl/settings.json",
        "  create    .gitignore",
        "            # >>> cadre",
        "            thoughts/",
        "            .cadre/*/.runtime/",
        "            .cadre/**/*.cadre-new",
        "            CLAUDE-SECURITY-*/",
        "            # <<< cadre",
        "Summary: 26 create, 0 change, 0 leave, 0 conflict, 0 hunks",
        "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
        "Launchers start in: the git root",
        "Applied: wrote 26 files (3 executable).",
        "warning: the private files of pm, security, tl were not written: their role memory folders are unknown (no home folder, or git rev-parse failed or gave no absolute path; git 2.31 or newer is needed)",
        "Next: run /cadre start <id> to launch a role."
      ]
    },
    "writes": [
      {
        "path": "/repo/.cadre/INDEX.md",
        "sha256": "0e100f55c6f22b3f681ae623499c86c79081b7a17e696017f13d291af09aa78f",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/pm",
        "sha256": "6ee35b865c0d60d5bba7ca33e09b6b50a2da7e3b57b024315fba9b434f33b9ce",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/security",
        "sha256": "ac7bd18566f09aef3ba7f04bca3c057de82b49aaa48f67322d9cbb20ae9e018d",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/tl",
        "sha256": "df02cbb995435b3ffd30902a3c5841b601b0ea1a3ad461a9c7eadfb7cd15e74f",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/cadre.json",
        "sha256": "50a320abab81ccb67f0141ea7081b9ca177c437332fea56462536d4a64b91769",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/CLAUDE.md",
        "sha256": "fb5f48eb55127ba61a2595ccc4415599fbe14f83f01811ffaf82fae11229879e",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/ROLE.md",
        "sha256": "f2fbe356069b80b9c78ee8c36dedd9c214addf88911f869007e0c3d0bf221ccc",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/kickoff.txt",
        "sha256": "0bc1a7023c367d648f2c5592f47526ea8c994d34a7640b6eecf459ef35a4ff5f",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/role.json",
        "sha256": "1e203918000086ef261b5026961745e82fbf3da554ab0db80a8e87ff8061ac68",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/settings.json",
        "sha256": "d7b4731f3ed8b9a775cc9a1142db81a387d9775dc514c48949ed681f1dc3d595",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/CLAUDE.md",
        "sha256": "b7eda0deef942c27f4133af4a6be03f3be6cfce2d8c1ddb412cd924ab58f42b0",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/ROLE.md",
        "sha256": "a752bb5a47d0b504087b3c805ac1a042bb78094257e6a9f134b9975e2567d991",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/kickoff.txt",
        "sha256": "283fccb025b661c02e802be2bb43b67f9d33e9e061ad31b79c52ba9474b4ce8f",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/role.json",
        "sha256": "ef8efa2fc4ef98dc07e9e64145a6bf71192d299146a8e2c8078a965d9c1825ae",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/settings.json",
        "sha256": "03350d7f0ed0c952d6aaa622d81849256219a18b5264825de5a919e4d096ca3a",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/sizing.md",
        "sha256": "9c961414ae04da71cdabf56a180298b54e2d9e631279138b47c059d3ab7ed6c3",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/CLAUDE.md",
        "sha256": "1da5182c105d9f6efa6ac8dcd7051c50ead8e3bedd4d1c6dcd61797d4691407f",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/ROLE.md",
        "sha256": "820dc06a58838ae3c68a97fcdf9f721759c99b4166d7559da1cd5aea00edb600",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/kickoff.txt",
        "sha256": "7f7b3acb7dc35273d3874d7f05a9ade5625bed7070616fd4d4789620fde0daac",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/role.json",
        "sha256": "0b3b5ee6a4f7152de6c5afe5e4f201a252bf66609999ebcd4c2de1025a69b2b6",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/settings.json",
        "sha256": "03350d7f0ed0c952d6aaa622d81849256219a18b5264825de5a919e4d096ca3a",
        "isWritten": true
      },
      {
        "path": "/repo/.gitignore",
        "sha256": "bbe833a41abc5c566f5dd980a031fab757796b8049d4c16ebc707316f4dae303",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/manifest.json",
        "sha256": "1686d92c3e6854afb53bb6e95ac8d394bf5daec2406ee71bc785dfa2a9d7bbc2",
        "isWritten": true
      }
    ],
    "calls": [
      "git rev-parse --path-format=absolute --git-common-dir @ /repo",
      "/bin/chmod 755 /repo/.cadre/bin/pm @ -",
      "/bin/chmod 755 /repo/.cadre/bin/security @ -",
      "/bin/chmod 755 /repo/.cadre/bin/tl @ -"
    ],
    "manifest": [
      "{",
      "  \"cadreVersion\": \"0.2.0\",",
      "  \"files\": [",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/INDEX.md\",",
      "      \"sha256\": \"0e100f55c6f22b3f681ae623499c86c79081b7a17e696017f13d291af09aa78f\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/pm\",",
      "      \"sha256\": \"6ee35b865c0d60d5bba7ca33e09b6b50a2da7e3b57b024315fba9b434f33b9ce\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/security\",",
      "      \"sha256\": \"ac7bd18566f09aef3ba7f04bca3c057de82b49aaa48f67322d9cbb20ae9e018d\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/tl\",",
      "      \"sha256\": \"df02cbb995435b3ffd30902a3c5841b601b0ea1a3ad461a9c7eadfb7cd15e74f\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/cadre.json\",",
      "      \"sha256\": \"50a320abab81ccb67f0141ea7081b9ca177c437332fea56462536d4a64b91769\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/CLAUDE.md\",",
      "      \"sha256\": \"fb5f48eb55127ba61a2595ccc4415599fbe14f83f01811ffaf82fae11229879e\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/ROLE.md\",",
      "      \"sha256\": \"f2fbe356069b80b9c78ee8c36dedd9c214addf88911f869007e0c3d0bf221ccc\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/kickoff.txt\",",
      "      \"sha256\": \"0bc1a7023c367d648f2c5592f47526ea8c994d34a7640b6eecf459ef35a4ff5f\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/role.json\",",
      "      \"sha256\": \"1e203918000086ef261b5026961745e82fbf3da554ab0db80a8e87ff8061ac68\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/settings.json\",",
      "      \"sha256\": \"d7b4731f3ed8b9a775cc9a1142db81a387d9775dc514c48949ed681f1dc3d595\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/CLAUDE.md\",",
      "      \"sha256\": \"b7eda0deef942c27f4133af4a6be03f3be6cfce2d8c1ddb412cd924ab58f42b0\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/ROLE.md\",",
      "      \"sha256\": \"a752bb5a47d0b504087b3c805ac1a042bb78094257e6a9f134b9975e2567d991\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/kickoff.txt\",",
      "      \"sha256\": \"283fccb025b661c02e802be2bb43b67f9d33e9e061ad31b79c52ba9474b4ce8f\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/role.json\",",
      "      \"sha256\": \"ef8efa2fc4ef98dc07e9e64145a6bf71192d299146a8e2c8078a965d9c1825ae\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/settings.json\",",
      "      \"sha256\": \"03350d7f0ed0c952d6aaa622d81849256219a18b5264825de5a919e4d096ca3a\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/sizing.md\",",
      "      \"sha256\": \"9c961414ae04da71cdabf56a180298b54e2d9e631279138b47c059d3ab7ed6c3\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/CLAUDE.md\",",
      "      \"sha256\": \"1da5182c105d9f6efa6ac8dcd7051c50ead8e3bedd4d1c6dcd61797d4691407f\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/ROLE.md\",",
      "      \"sha256\": \"820dc06a58838ae3c68a97fcdf9f721759c99b4166d7559da1cd5aea00edb600\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/kickoff.txt\",",
      "      \"sha256\": \"7f7b3acb7dc35273d3874d7f05a9ade5625bed7070616fd4d4789620fde0daac\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/role.json\",",
      "      \"sha256\": \"0b3b5ee6a4f7152de6c5afe5e4f201a252bf66609999ebcd4c2de1025a69b2b6\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/settings.json\",",
      "      \"sha256\": \"03350d7f0ed0c952d6aaa622d81849256219a18b5264825de5a919e4d096ca3a\"",
      "    }",
      "  ],",
      "  \"schema\": 1",
      "}",
      ""
    ]
  },
  "gsd": {
    "run": {
      "asks": [
        {
          "question": [
            "Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.",
            "Without it, init still finds MCP servers in .mcp.json, your plugins and this session."
          ],
          "header": "claude.json",
          "options": [
            "No, skip it",
            "Yes, read names only"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Use these roles?",
            "Proposed: PM (pm), Team Lead (tl), Security (security); 3 changes from the scan."
          ],
          "header": "Roles",
          "options": [
            "Use these roles",
            "Adjust them",
            "Describe my own structure"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Which frameworks does this team use? Found: GSD. Adding one installs it at project scope after Confirm.",
            "Roles: pm, tl, security."
          ],
          "header": "Framework",
          "options": [
            "Keep GSD (Recommended)",
            "Add superpowers too",
            "None (built-in)"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Install from claude-plugins-official after you confirm the plan: claude-security and security-guidance? claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo. security-guidance adds hooks that warn about risky edits.",
            "Nothing is installed before you confirm the final review, and a --dry-run installs nothing."
          ],
          "header": "Security",
          "options": [
            "Install",
            "Not now"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Autopilot duration for roles?",
            "Applies to every role: pm, tl, security."
          ],
          "header": "Duration",
          "options": [
            "4h",
            "2h",
            "8h"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Model and effort: same for all roles, or per role?",
            "Roles: pm, tl, security."
          ],
          "header": "Model",
          "options": [
            "Same for all roles",
            "Per role"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Model and effort for all roles?",
            "Models: opus, sonnet, haiku, fable; efforts: low, medium, high, xhigh, max."
          ],
          "header": "Model",
          "options": [
            "opus + medium",
            "sonnet + medium",
            "sonnet + high"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Install mattpocock-skills from claude-plugins-official for PM after you confirm the plan? It gives PM mattpocock-skills:grilling and mattpocock-skills:grill-me.",
            "It runs from the repo root at project scope, never in a --dry-run: claude plugin install mattpocock-skills@claude-plugins-official --scope project"
          ],
          "header": "Skills",
          "options": [
            "No",
            "Yes, install it"
          ],
          "multiSelect": false
        },
        {
          "question": [
            ".planning/config.json: mode"
          ],
          "header": "Hunk 1 of 1",
          "options": [
            "Accept",
            "Decline"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Git policy for .cadre/?",
            "Commit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. Ignore all: nothing in .cadre/ is committed."
          ],
          "header": "Git policy",
          "options": [
            "Commit definitions (default)",
            "Commit all",
            "Ignore all of .cadre/"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Where should the role launchers start their sessions? (asked once for this repo)",
            "The launcher of each role (pm, tl, security) starts its session there."
          ],
          "header": "Launch",
          "options": [
            "Git root of this repo",
            "The folder I run it from",
            "Another folder in this repo"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.",
            "Summary: 26 create, 0 change, 0 leave, 0 conflict, 1 hunk (1 accepted); Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
            "Use a button, or type duration, model, assignments, memory, env or hunks under Other."
          ],
          "header": "Review",
          "options": [
            "Next page",
            "Confirm",
            "Change something…"
          ],
          "multiSelect": false
        }
      ],
      "logged": [
        "No session history for this repo.",
        "PM runs without its grill skills: to add them, run claude plugin install mattpocock-skills@claude-plugins-official --scope project from the repo root, then /cadre init again."
      ],
      "shown": [],
      "promptHashes": [],
      "reply": [
        "cadre init",
        "File plan:",
        "  create    .cadre/INDEX.md",
        "  create    .cadre/bin/pm (executable)",
        "  create    .cadre/bin/security (executable)",
        "  create    .cadre/bin/tl (executable)",
        "  create    .cadre/cadre.json",
        "  create    .cadre/manifest.json",
        "  create    .cadre/pm/CLAUDE.md",
        "  create    .cadre/pm/ROLE.md",
        "  create    .cadre/pm/kickoff.txt",
        "  create    .cadre/pm/mcp.json",
        "  create    .cadre/pm/role.json",
        "  create    .cadre/pm/settings.json",
        "  create    .cadre/security/CLAUDE.md",
        "  create    .cadre/security/ROLE.md",
        "  create    .cadre/security/kickoff.txt",
        "  create    .cadre/security/mcp.json",
        "  create    .cadre/security/role.json",
        "  create    .cadre/security/settings.json",
        "  create    .cadre/sizing.md",
        "  create    .cadre/tl/CLAUDE.md",
        "  create    .cadre/tl/ROLE.md",
        "  create    .cadre/tl/kickoff.txt",
        "  create    .cadre/tl/mcp.json",
        "  create    .cadre/tl/role.json",
        "  create    .cadre/tl/settings.json",
        "  create    .gitignore",
        "            # >>> cadre",
        "            thoughts/",
        "            .cadre/*/.runtime/",
        "            .cadre/**/*.cadre-new",
        "            CLAUDE-SECURITY-*/",
        "            # <<< cadre",
        "  hunk      .planning/config.json  mode: not set (GSD default) -> \"yolo\"  (required, accepted)",
        "            run: node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo",
        "Summary: 26 create, 0 change, 0 leave, 0 conflict, 1 hunk (1 accepted)",
        "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
        "Launchers start in: the git root",
        "Applied: wrote 26 files (3 executable).",
        "warning: the private files of pm, security, tl were not written: their role memory folders are unknown (no home folder, or git rev-parse failed or gave no absolute path; git 2.31 or newer is needed)",
        "Next: run /cadre start <id> to launch a role."
      ]
    },
    "writes": [
      {
        "path": "/repo/.cadre/INDEX.md",
        "sha256": "c1b66937d5174e9b01ae3fcc6de9ff537004f83087280c439ca10ff2a9946947",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/pm",
        "sha256": "6ee35b865c0d60d5bba7ca33e09b6b50a2da7e3b57b024315fba9b434f33b9ce",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/security",
        "sha256": "ac7bd18566f09aef3ba7f04bca3c057de82b49aaa48f67322d9cbb20ae9e018d",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/tl",
        "sha256": "df02cbb995435b3ffd30902a3c5841b601b0ea1a3ad461a9c7eadfb7cd15e74f",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/cadre.json",
        "sha256": "3f67d91b888f903ae90fc545672e92203a1bcb5fdb5fbfe140e8b9858ff60a6e",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/CLAUDE.md",
        "sha256": "fb5f48eb55127ba61a2595ccc4415599fbe14f83f01811ffaf82fae11229879e",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/ROLE.md",
        "sha256": "f2fbe356069b80b9c78ee8c36dedd9c214addf88911f869007e0c3d0bf221ccc",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/kickoff.txt",
        "sha256": "0bc1a7023c367d648f2c5592f47526ea8c994d34a7640b6eecf459ef35a4ff5f",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/role.json",
        "sha256": "1e203918000086ef261b5026961745e82fbf3da554ab0db80a8e87ff8061ac68",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/settings.json",
        "sha256": "d7b4731f3ed8b9a775cc9a1142db81a387d9775dc514c48949ed681f1dc3d595",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/CLAUDE.md",
        "sha256": "b7eda0deef942c27f4133af4a6be03f3be6cfce2d8c1ddb412cd924ab58f42b0",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/ROLE.md",
        "sha256": "827301cee3bffb7cf591bc9d7cac4fb82434c5c42f1e144c59682e7d8272d8c5",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/kickoff.txt",
        "sha256": "6aca202354afd43e3013834f29f83bdd60d25c8a386fa6b81e11309896b30a6a",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/role.json",
        "sha256": "ef8efa2fc4ef98dc07e9e64145a6bf71192d299146a8e2c8078a965d9c1825ae",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/settings.json",
        "sha256": "03350d7f0ed0c952d6aaa622d81849256219a18b5264825de5a919e4d096ca3a",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/sizing.md",
        "sha256": "9c961414ae04da71cdabf56a180298b54e2d9e631279138b47c059d3ab7ed6c3",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/CLAUDE.md",
        "sha256": "1da5182c105d9f6efa6ac8dcd7051c50ead8e3bedd4d1c6dcd61797d4691407f",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/ROLE.md",
        "sha256": "85db86e2df3129a964107eed9ff6230d5debce06a8f3e085c05bc10a11dc0cd8",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/kickoff.txt",
        "sha256": "67931bb9e6eba557e0e2ecc34f9149e9a2b0164e4811bfa1bae077e804637787",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/role.json",
        "sha256": "0b3b5ee6a4f7152de6c5afe5e4f201a252bf66609999ebcd4c2de1025a69b2b6",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/settings.json",
        "sha256": "03350d7f0ed0c952d6aaa622d81849256219a18b5264825de5a919e4d096ca3a",
        "isWritten": true
      },
      {
        "path": "/repo/.gitignore",
        "sha256": "bbe833a41abc5c566f5dd980a031fab757796b8049d4c16ebc707316f4dae303",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/manifest.json",
        "sha256": "a8507e6804bfe2f8b468968c209750137cd325e517ce4306830588f369d0b196",
        "isWritten": true
      }
    ],
    "calls": [
      "node /home/u/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo @ /repo",
      "git rev-parse --path-format=absolute --git-common-dir @ /repo",
      "/bin/chmod 755 /repo/.cadre/bin/pm @ -",
      "/bin/chmod 755 /repo/.cadre/bin/security @ -",
      "/bin/chmod 755 /repo/.cadre/bin/tl @ -"
    ],
    "manifest": [
      "{",
      "  \"cadreVersion\": \"0.2.0\",",
      "  \"files\": [",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/INDEX.md\",",
      "      \"sha256\": \"c1b66937d5174e9b01ae3fcc6de9ff537004f83087280c439ca10ff2a9946947\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/pm\",",
      "      \"sha256\": \"6ee35b865c0d60d5bba7ca33e09b6b50a2da7e3b57b024315fba9b434f33b9ce\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/security\",",
      "      \"sha256\": \"ac7bd18566f09aef3ba7f04bca3c057de82b49aaa48f67322d9cbb20ae9e018d\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/tl\",",
      "      \"sha256\": \"df02cbb995435b3ffd30902a3c5841b601b0ea1a3ad461a9c7eadfb7cd15e74f\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/cadre.json\",",
      "      \"sha256\": \"3f67d91b888f903ae90fc545672e92203a1bcb5fdb5fbfe140e8b9858ff60a6e\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/CLAUDE.md\",",
      "      \"sha256\": \"fb5f48eb55127ba61a2595ccc4415599fbe14f83f01811ffaf82fae11229879e\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/ROLE.md\",",
      "      \"sha256\": \"f2fbe356069b80b9c78ee8c36dedd9c214addf88911f869007e0c3d0bf221ccc\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/kickoff.txt\",",
      "      \"sha256\": \"0bc1a7023c367d648f2c5592f47526ea8c994d34a7640b6eecf459ef35a4ff5f\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/role.json\",",
      "      \"sha256\": \"1e203918000086ef261b5026961745e82fbf3da554ab0db80a8e87ff8061ac68\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/settings.json\",",
      "      \"sha256\": \"d7b4731f3ed8b9a775cc9a1142db81a387d9775dc514c48949ed681f1dc3d595\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/CLAUDE.md\",",
      "      \"sha256\": \"b7eda0deef942c27f4133af4a6be03f3be6cfce2d8c1ddb412cd924ab58f42b0\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/ROLE.md\",",
      "      \"sha256\": \"827301cee3bffb7cf591bc9d7cac4fb82434c5c42f1e144c59682e7d8272d8c5\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/kickoff.txt\",",
      "      \"sha256\": \"6aca202354afd43e3013834f29f83bdd60d25c8a386fa6b81e11309896b30a6a\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/role.json\",",
      "      \"sha256\": \"ef8efa2fc4ef98dc07e9e64145a6bf71192d299146a8e2c8078a965d9c1825ae\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/settings.json\",",
      "      \"sha256\": \"03350d7f0ed0c952d6aaa622d81849256219a18b5264825de5a919e4d096ca3a\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/sizing.md\",",
      "      \"sha256\": \"9c961414ae04da71cdabf56a180298b54e2d9e631279138b47c059d3ab7ed6c3\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/CLAUDE.md\",",
      "      \"sha256\": \"1da5182c105d9f6efa6ac8dcd7051c50ead8e3bedd4d1c6dcd61797d4691407f\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/ROLE.md\",",
      "      \"sha256\": \"85db86e2df3129a964107eed9ff6230d5debce06a8f3e085c05bc10a11dc0cd8\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/kickoff.txt\",",
      "      \"sha256\": \"67931bb9e6eba557e0e2ecc34f9149e9a2b0164e4811bfa1bae077e804637787\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/role.json\",",
      "      \"sha256\": \"0b3b5ee6a4f7152de6c5afe5e4f201a252bf66609999ebcd4c2de1025a69b2b6\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/settings.json\",",
      "      \"sha256\": \"03350d7f0ed0c952d6aaa622d81849256219a18b5264825de5a919e4d096ca3a\"",
      "    }",
      "  ],",
      "  \"schema\": 1",
      "}",
      ""
    ]
  }
}
