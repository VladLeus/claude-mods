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
        "No session history for this repo."
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
        "sha256": "259951f6304398fe98bb98b3b164e8dd56f16465cd02a632f08b03c9eaa1df06",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/pm",
        "sha256": "9fb677b0e2a5984f0efb4cbab6c500f39d83c6add898c2263c7e74ea49737a30",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/security",
        "sha256": "90af305a09c5c7c9ef29b5141950f95cdcf96e1359a0c8ad295bba6b7e0b7959",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/tl",
        "sha256": "1ba839b14904a9df5a6476d993e08aea11985095474bf44c11f8a7214f7856fc",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/cadre.json",
        "sha256": "c9585323198d2e154d0a575f1f1cf5b938c213b53b5c68205c8e7fc1cc95311e",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/CLAUDE.md",
        "sha256": "bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/ROLE.md",
        "sha256": "645c33dd1b97dd7550238b171d3991df968b703c8d32e5c9fd7449d3d0ddc445",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/kickoff.txt",
        "sha256": "22fd17861d0629a70ab5904a951f67f987df2363dbb05d382ba37bfe8ca173da",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/role.json",
        "sha256": "f9f23e920d313fa7baa6f8d1cab14189428d7c7a2a6bf1825baa2b4748896fed",
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
        "sha256": "b980b465ecd29583096aeb96687cf37b0c43370b81b819527efc9405bd5994fc",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/kickoff.txt",
        "sha256": "1a4f0743499f273da5b3dec051530a1bf11d96ba5266692e042a4ddfb75d62bd",
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
        "sha256": "8be5da803401dfc4aed2e51d348c0de6b7932b644c5be87c7e9612911523ab25",
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
        "sha256": "636e017ed3ad24091ca445be4f55e93db552f307e94d6cf5640f6fb8ba764341",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/kickoff.txt",
        "sha256": "75d35cbf120652efd8af9476efa696d6d90f3ae83f6cc638e4d18778e6436ed3",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/role.json",
        "sha256": "c738e88f9a512e380cd53a6aeaf748571056e08847b842ed48cd59b503067219",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/settings.json",
        "sha256": "8be5da803401dfc4aed2e51d348c0de6b7932b644c5be87c7e9612911523ab25",
        "isWritten": true
      },
      {
        "path": "/repo/.gitignore",
        "sha256": "bbe833a41abc5c566f5dd980a031fab757796b8049d4c16ebc707316f4dae303",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/manifest.json",
        "sha256": "08914686718c7ab04719a4f539f8957db4cdb06fcd7f214d0d1955cb6aedce58",
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
      "      \"sha256\": \"259951f6304398fe98bb98b3b164e8dd56f16465cd02a632f08b03c9eaa1df06\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/pm\",",
      "      \"sha256\": \"9fb677b0e2a5984f0efb4cbab6c500f39d83c6add898c2263c7e74ea49737a30\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/security\",",
      "      \"sha256\": \"90af305a09c5c7c9ef29b5141950f95cdcf96e1359a0c8ad295bba6b7e0b7959\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/tl\",",
      "      \"sha256\": \"1ba839b14904a9df5a6476d993e08aea11985095474bf44c11f8a7214f7856fc\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/cadre.json\",",
      "      \"sha256\": \"c9585323198d2e154d0a575f1f1cf5b938c213b53b5c68205c8e7fc1cc95311e\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/CLAUDE.md\",",
      "      \"sha256\": \"bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/ROLE.md\",",
      "      \"sha256\": \"645c33dd1b97dd7550238b171d3991df968b703c8d32e5c9fd7449d3d0ddc445\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/kickoff.txt\",",
      "      \"sha256\": \"22fd17861d0629a70ab5904a951f67f987df2363dbb05d382ba37bfe8ca173da\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/role.json\",",
      "      \"sha256\": \"f9f23e920d313fa7baa6f8d1cab14189428d7c7a2a6bf1825baa2b4748896fed\"",
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
      "      \"sha256\": \"b980b465ecd29583096aeb96687cf37b0c43370b81b819527efc9405bd5994fc\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/kickoff.txt\",",
      "      \"sha256\": \"1a4f0743499f273da5b3dec051530a1bf11d96ba5266692e042a4ddfb75d62bd\"",
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
      "      \"sha256\": \"8be5da803401dfc4aed2e51d348c0de6b7932b644c5be87c7e9612911523ab25\"",
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
      "      \"sha256\": \"636e017ed3ad24091ca445be4f55e93db552f307e94d6cf5640f6fb8ba764341\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/kickoff.txt\",",
      "      \"sha256\": \"75d35cbf120652efd8af9476efa696d6d90f3ae83f6cc638e4d18778e6436ed3\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/role.json\",",
      "      \"sha256\": \"c738e88f9a512e380cd53a6aeaf748571056e08847b842ed48cd59b503067219\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/settings.json\",",
      "      \"sha256\": \"8be5da803401dfc4aed2e51d348c0de6b7932b644c5be87c7e9612911523ab25\"",
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
        "No session history for this repo."
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
        "sha256": "6187ff0cb34a9d46afe5bc5aab0cb9ee963e8405e00d6770e0dd99d4e0e4ff1b",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/pm",
        "sha256": "9fb677b0e2a5984f0efb4cbab6c500f39d83c6add898c2263c7e74ea49737a30",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/security",
        "sha256": "90af305a09c5c7c9ef29b5141950f95cdcf96e1359a0c8ad295bba6b7e0b7959",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/tl",
        "sha256": "1ba839b14904a9df5a6476d993e08aea11985095474bf44c11f8a7214f7856fc",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/cadre.json",
        "sha256": "85003e02dfe431643071c294633d3d8f6be5fe49607d210f5cf5bef4d6bd8052",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/CLAUDE.md",
        "sha256": "bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/ROLE.md",
        "sha256": "865e51b739884191a81fc3dd74dba78ea0ed49387c51128f7eb391ae8288a2a8",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/kickoff.txt",
        "sha256": "7d54ac00f2ef4507e6fdffdfacd325d437f817166abf98a77422de0e165e7eb6",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/role.json",
        "sha256": "f9f23e920d313fa7baa6f8d1cab14189428d7c7a2a6bf1825baa2b4748896fed",
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
        "sha256": "658751fe317d8c150afe98e99002a6d46005036f54445560d097853d2797a63d",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/kickoff.txt",
        "sha256": "5d2443a198212d243c3c7ea23ef89a91211e2ae1038cb36634ad65d0d237cd78",
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
        "sha256": "8be5da803401dfc4aed2e51d348c0de6b7932b644c5be87c7e9612911523ab25",
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
        "sha256": "0b5c06534744f7a236432518934c2f2a422d97991724739a8e9328eaa53edf1c",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/kickoff.txt",
        "sha256": "5ba0cf5aa7bfb58e7e9c52f5952f5edffd2026f7536f2e22dade82d984eab592",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/role.json",
        "sha256": "c738e88f9a512e380cd53a6aeaf748571056e08847b842ed48cd59b503067219",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/settings.json",
        "sha256": "8be5da803401dfc4aed2e51d348c0de6b7932b644c5be87c7e9612911523ab25",
        "isWritten": true
      },
      {
        "path": "/repo/.gitignore",
        "sha256": "bbe833a41abc5c566f5dd980a031fab757796b8049d4c16ebc707316f4dae303",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/manifest.json",
        "sha256": "14560bf87e2044ea3382290dec32b3a29be52d80fad3ff577322c688a7e51f54",
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
      "      \"sha256\": \"6187ff0cb34a9d46afe5bc5aab0cb9ee963e8405e00d6770e0dd99d4e0e4ff1b\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/pm\",",
      "      \"sha256\": \"9fb677b0e2a5984f0efb4cbab6c500f39d83c6add898c2263c7e74ea49737a30\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/security\",",
      "      \"sha256\": \"90af305a09c5c7c9ef29b5141950f95cdcf96e1359a0c8ad295bba6b7e0b7959\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/tl\",",
      "      \"sha256\": \"1ba839b14904a9df5a6476d993e08aea11985095474bf44c11f8a7214f7856fc\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/cadre.json\",",
      "      \"sha256\": \"85003e02dfe431643071c294633d3d8f6be5fe49607d210f5cf5bef4d6bd8052\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/CLAUDE.md\",",
      "      \"sha256\": \"bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/ROLE.md\",",
      "      \"sha256\": \"865e51b739884191a81fc3dd74dba78ea0ed49387c51128f7eb391ae8288a2a8\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/kickoff.txt\",",
      "      \"sha256\": \"7d54ac00f2ef4507e6fdffdfacd325d437f817166abf98a77422de0e165e7eb6\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/role.json\",",
      "      \"sha256\": \"f9f23e920d313fa7baa6f8d1cab14189428d7c7a2a6bf1825baa2b4748896fed\"",
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
      "      \"sha256\": \"658751fe317d8c150afe98e99002a6d46005036f54445560d097853d2797a63d\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/kickoff.txt\",",
      "      \"sha256\": \"5d2443a198212d243c3c7ea23ef89a91211e2ae1038cb36634ad65d0d237cd78\"",
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
      "      \"sha256\": \"8be5da803401dfc4aed2e51d348c0de6b7932b644c5be87c7e9612911523ab25\"",
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
      "      \"sha256\": \"0b5c06534744f7a236432518934c2f2a422d97991724739a8e9328eaa53edf1c\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/kickoff.txt\",",
      "      \"sha256\": \"5ba0cf5aa7bfb58e7e9c52f5952f5edffd2026f7536f2e22dade82d984eab592\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/role.json\",",
      "      \"sha256\": \"c738e88f9a512e380cd53a6aeaf748571056e08847b842ed48cd59b503067219\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/settings.json\",",
      "      \"sha256\": \"8be5da803401dfc4aed2e51d348c0de6b7932b644c5be87c7e9612911523ab25\"",
      "    }",
      "  ],",
      "  \"schema\": 1",
      "}",
      ""
    ]
  }
}
