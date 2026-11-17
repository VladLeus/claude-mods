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
        "sha256": "bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/ROLE.md",
        "sha256": "f7818d9e4e77c579405aa161583176bada8b7fabbb1909ba048453986c62f5c7",
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
        "sha256": "803d386590d1d71564306fc3c3de7758fd656f8b306f95bcc6fe25d892f62332",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/ROLE.md",
        "sha256": "41fc799591aab290bd1e0b4e7f3a74c90508cae3ce587aa88646b0f1a45d0b77",
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
        "sha256": "a77e9dd5552ffce1e5b1c4402fa884759db6cf017af7d98bfb88c8ba6fd554e8",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/ROLE.md",
        "sha256": "709fd696f85ea87e311be353a83b1623dc6d502e761e40151be65c7f3e292f75",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/kickoff.txt",
        "sha256": "937c1de1033196923d0f0f1dca9e033b03d30945cda03a62eff175924023c94c",
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
        "sha256": "a81b4fff47277fa7edd1affd1fe0e4f33b80c3f8adc8ef7b3fb62506935b8b42",
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
      "      \"sha256\": \"bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/ROLE.md\",",
      "      \"sha256\": \"f7818d9e4e77c579405aa161583176bada8b7fabbb1909ba048453986c62f5c7\"",
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
      "      \"sha256\": \"803d386590d1d71564306fc3c3de7758fd656f8b306f95bcc6fe25d892f62332\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/ROLE.md\",",
      "      \"sha256\": \"41fc799591aab290bd1e0b4e7f3a74c90508cae3ce587aa88646b0f1a45d0b77\"",
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
      "      \"sha256\": \"a77e9dd5552ffce1e5b1c4402fa884759db6cf017af7d98bfb88c8ba6fd554e8\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/ROLE.md\",",
      "      \"sha256\": \"709fd696f85ea87e311be353a83b1623dc6d502e761e40151be65c7f3e292f75\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/kickoff.txt\",",
      "      \"sha256\": \"937c1de1033196923d0f0f1dca9e033b03d30945cda03a62eff175924023c94c\"",
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
        "sha256": "bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/ROLE.md",
        "sha256": "f7818d9e4e77c579405aa161583176bada8b7fabbb1909ba048453986c62f5c7",
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
        "sha256": "803d386590d1d71564306fc3c3de7758fd656f8b306f95bcc6fe25d892f62332",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/ROLE.md",
        "sha256": "1cef205cb09b3716aa0fcd4e0a1ffc0f09dd772f04f1513fd5679751e55de705",
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
        "sha256": "a77e9dd5552ffce1e5b1c4402fa884759db6cf017af7d98bfb88c8ba6fd554e8",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/ROLE.md",
        "sha256": "2d3d027b1132e2a3f6f082ee98818b098f3724055d618f3c34bf3ff24a238b29",
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
        "sha256": "19574c77b8623ae7b029239d6070c782480fb30a799579d762f98682e7b4f2de",
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
      "      \"sha256\": \"bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/ROLE.md\",",
      "      \"sha256\": \"f7818d9e4e77c579405aa161583176bada8b7fabbb1909ba048453986c62f5c7\"",
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
      "      \"sha256\": \"803d386590d1d71564306fc3c3de7758fd656f8b306f95bcc6fe25d892f62332\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/ROLE.md\",",
      "      \"sha256\": \"1cef205cb09b3716aa0fcd4e0a1ffc0f09dd772f04f1513fd5679751e55de705\"",
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
      "      \"sha256\": \"a77e9dd5552ffce1e5b1c4402fa884759db6cf017af7d98bfb88c8ba6fd554e8\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/ROLE.md\",",
      "      \"sha256\": \"2d3d027b1132e2a3f6f082ee98818b098f3724055d618f3c34bf3ff24a238b29\"",
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
