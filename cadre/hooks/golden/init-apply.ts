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
            "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks; Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
        "Summary: 25 create, 0 change, 0 leave, 0 conflict, 0 hunks",
        "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
        "Launchers start in: the git root",
        "Applied: wrote 25 files (3 executable).",
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
        "sha256": "4bc150512031a5c42ce85f2483ceced3f8f34d37c034290ed95491c4bea08f97",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/security",
        "sha256": "74d4ab2fac8219fee80db859adae163907c2413629326e3798d52c8eb0ba4cfd",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/tl",
        "sha256": "edf1c6806771400b67844d452e471b86a13be4e2212564add76d7e06b148951a",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/cadre.json",
        "sha256": "9e55d5e0233bf45be6146808d100937b1e69de44ec9a85db57cd5f194948947e",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/CLAUDE.md",
        "sha256": "bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/ROLE.md",
        "sha256": "4fdb74f05178a56978b1dbc64b8ce171a32243f8393098cfb28d786627b14aee",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/kickoff.txt",
        "sha256": "821f012cfd6904e01ef8e589d7b68c74262c2c96cc51c8c3e7a713cd9332683b",
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
        "sha256": "abc3827f668224ccc3b497bb0a6ac04d8c2f467bb5ef4d706e70b85601dd6e49",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/kickoff.txt",
        "sha256": "8652ec9b83290629f58ac5aee51532f71771656982f21026f3c85bb53427bf02",
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
        "path": "/repo/.cadre/tl/CLAUDE.md",
        "sha256": "a77e9dd5552ffce1e5b1c4402fa884759db6cf017af7d98bfb88c8ba6fd554e8",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/ROLE.md",
        "sha256": "14e9f2c912cc589035ebdfc7a63c106a9a7e8de88564d3765c0be53533a1a917",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/kickoff.txt",
        "sha256": "b0e91e95cd3c5765d80acfbb9a45a5c5c3680eabda1647c409414ccd5d1481ab",
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
        "sha256": "71985359552eda4f6ed7f1c32720940c0cd163282dafbad8a75d58830d2a72db",
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
      "      \"sha256\": \"4bc150512031a5c42ce85f2483ceced3f8f34d37c034290ed95491c4bea08f97\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/security\",",
      "      \"sha256\": \"74d4ab2fac8219fee80db859adae163907c2413629326e3798d52c8eb0ba4cfd\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/tl\",",
      "      \"sha256\": \"edf1c6806771400b67844d452e471b86a13be4e2212564add76d7e06b148951a\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/cadre.json\",",
      "      \"sha256\": \"9e55d5e0233bf45be6146808d100937b1e69de44ec9a85db57cd5f194948947e\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/CLAUDE.md\",",
      "      \"sha256\": \"bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/ROLE.md\",",
      "      \"sha256\": \"4fdb74f05178a56978b1dbc64b8ce171a32243f8393098cfb28d786627b14aee\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/kickoff.txt\",",
      "      \"sha256\": \"821f012cfd6904e01ef8e589d7b68c74262c2c96cc51c8c3e7a713cd9332683b\"",
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
      "      \"sha256\": \"abc3827f668224ccc3b497bb0a6ac04d8c2f467bb5ef4d706e70b85601dd6e49\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/kickoff.txt\",",
      "      \"sha256\": \"8652ec9b83290629f58ac5aee51532f71771656982f21026f3c85bb53427bf02\"",
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
      "      \"path\": \".cadre/tl/CLAUDE.md\",",
      "      \"sha256\": \"a77e9dd5552ffce1e5b1c4402fa884759db6cf017af7d98bfb88c8ba6fd554e8\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/ROLE.md\",",
      "      \"sha256\": \"14e9f2c912cc589035ebdfc7a63c106a9a7e8de88564d3765c0be53533a1a917\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/kickoff.txt\",",
      "      \"sha256\": \"b0e91e95cd3c5765d80acfbb9a45a5c5c3680eabda1647c409414ccd5d1481ab\"",
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
            "Which framework do the roles use? (asked because none is in use here, but some are installed for you)",
            "Roles: pm, tl, security."
          ],
          "header": "Framework",
          "options": [
            "Same for all roles",
            "Per role"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Framework for all roles?",
            "Roles: pm, tl, security."
          ],
          "header": "Framework",
          "options": [
            "GSD",
            "none (built-in)"
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
            "Summary: 25 create, 0 change, 0 leave, 0 conflict, 1 hunks (1 accepted); Git policy: commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root",
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
        "Summary: 25 create, 0 change, 0 leave, 0 conflict, 1 hunks (1 accepted)",
        "Git policy: commit definitions (.cadre/*/.runtime/ ignored)",
        "Launchers start in: the git root",
        "Applied: wrote 25 files (3 executable).",
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
        "sha256": "4bc150512031a5c42ce85f2483ceced3f8f34d37c034290ed95491c4bea08f97",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/security",
        "sha256": "74d4ab2fac8219fee80db859adae163907c2413629326e3798d52c8eb0ba4cfd",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/tl",
        "sha256": "edf1c6806771400b67844d452e471b86a13be4e2212564add76d7e06b148951a",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/cadre.json",
        "sha256": "fde5b6810a0e421fe114b93b000a6a2f5615955813ffe7fb6fa499245f5a689e",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/CLAUDE.md",
        "sha256": "bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/ROLE.md",
        "sha256": "01773b7d33e7e4ec5576a4eefc64a8d966ed79d4a492836015741a2aa48bfdbf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/kickoff.txt",
        "sha256": "5ecd0574e3dd68cf8d5171d53a13fd097dec3a5a6f4d50447319d467bf5c20bf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/pm/role.json",
        "sha256": "57cec2f8376baad5bce154b5e2e019f55ffd316c6a331df07999f45baf53495b",
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
        "sha256": "a4a2d8d8a9b940b36788e9be10a1d341b7ac308eb662bf69cbb32b58840df121",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/kickoff.txt",
        "sha256": "0aaf15c16830a3c18536550b22924bb482e539f1e60d63eff2d92e7382d55397",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/role.json",
        "sha256": "9f554e78a5bd4a71519b1aeb79b397664476c5d508971c1c88f57fe0309cff0c",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/security/settings.json",
        "sha256": "8be5da803401dfc4aed2e51d348c0de6b7932b644c5be87c7e9612911523ab25",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/CLAUDE.md",
        "sha256": "a77e9dd5552ffce1e5b1c4402fa884759db6cf017af7d98bfb88c8ba6fd554e8",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/ROLE.md",
        "sha256": "1494f3764a090ce0b878f80a1f405d734194b15607fd25c24effeac0c166e009",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/kickoff.txt",
        "sha256": "243a4ac49b75b24fe6d7ef603bdfb6b289a615eef1ac003cc216ae1197e6d185",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/tl/role.json",
        "sha256": "08a6b6bf23c7202e9837017f33267e53db44e0033d42818c266a51ecc6523923",
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
        "sha256": "df5bf5960f43cc7d8dda9bf5630f62ef657417b2a0a549fb38ff16dbaa676c63",
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
      "      \"sha256\": \"4bc150512031a5c42ce85f2483ceced3f8f34d37c034290ed95491c4bea08f97\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/security\",",
      "      \"sha256\": \"74d4ab2fac8219fee80db859adae163907c2413629326e3798d52c8eb0ba4cfd\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/tl\",",
      "      \"sha256\": \"edf1c6806771400b67844d452e471b86a13be4e2212564add76d7e06b148951a\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/cadre.json\",",
      "      \"sha256\": \"fde5b6810a0e421fe114b93b000a6a2f5615955813ffe7fb6fa499245f5a689e\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/CLAUDE.md\",",
      "      \"sha256\": \"bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/ROLE.md\",",
      "      \"sha256\": \"01773b7d33e7e4ec5576a4eefc64a8d966ed79d4a492836015741a2aa48bfdbf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/kickoff.txt\",",
      "      \"sha256\": \"5ecd0574e3dd68cf8d5171d53a13fd097dec3a5a6f4d50447319d467bf5c20bf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/role.json\",",
      "      \"sha256\": \"57cec2f8376baad5bce154b5e2e019f55ffd316c6a331df07999f45baf53495b\"",
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
      "      \"sha256\": \"a4a2d8d8a9b940b36788e9be10a1d341b7ac308eb662bf69cbb32b58840df121\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/kickoff.txt\",",
      "      \"sha256\": \"0aaf15c16830a3c18536550b22924bb482e539f1e60d63eff2d92e7382d55397\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/role.json\",",
      "      \"sha256\": \"9f554e78a5bd4a71519b1aeb79b397664476c5d508971c1c88f57fe0309cff0c\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/security/settings.json\",",
      "      \"sha256\": \"8be5da803401dfc4aed2e51d348c0de6b7932b644c5be87c7e9612911523ab25\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/CLAUDE.md\",",
      "      \"sha256\": \"a77e9dd5552ffce1e5b1c4402fa884759db6cf017af7d98bfb88c8ba6fd554e8\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/ROLE.md\",",
      "      \"sha256\": \"1494f3764a090ce0b878f80a1f405d734194b15607fd25c24effeac0c166e009\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/kickoff.txt\",",
      "      \"sha256\": \"243a4ac49b75b24fe6d7ef603bdfb6b289a615eef1ac003cc216ae1197e6d185\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/tl/role.json\",",
      "      \"sha256\": \"08a6b6bf23c7202e9837017f33267e53db44e0033d42818c266a51ecc6523923\"",
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
