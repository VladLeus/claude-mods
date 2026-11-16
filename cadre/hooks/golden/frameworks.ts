/**
 * The golden fixtures of `/cadre frameworks`: a dry and an applied run in frameworksWorld, an applied team that stores
 * None while GSD is in use. Captured from the code by a scratch run and pasted as printed; frameworks.test.ts in this
 * folder runs each again and compares with toEqual. Only an approved behaviour-change commit may change it.
 */
import type { GoldenApply, GoldenRun } from './types'

/** Each /cadre frameworks run by mode. */
export const GOLDEN_FRAMEWORKS: Readonly<Record<string, GoldenRun | GoldenApply>> = {
  "dry": {
    "asks": [
      {
        "question": [
          "Which frameworks does this team use? Found: GSD. Adding one installs it at project scope after Confirm.",
          "Roles: be, pm."
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
          ".planning/config.json: mode"
        ],
        "header": "Hunk 1 of 2",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          ".planning/config.json: workflow.text_mode"
        ],
        "header": "Hunk 2 of 2",
        "options": [
          "Accept",
          "Decline"
        ],
        "multiSelect": false
      },
      {
        "question": [
          "Review the framework changes. Confirm writes them; Cancel writes nothing."
        ],
        "header": "Review",
        "options": [
          "Confirm",
          "Cancel"
        ],
        "multiSelect": false
      }
    ],
    "logged": [],
    "shown": [],
    "promptHashes": [],
    "reply": [
      "cadre frameworks --dry-run",
      "Frameworks: GSD",
      "be: GSD",
      "pm: none (built-in)",
      "File plan:",
      "  change    .cadre/INDEX.md",
      "  change    .cadre/be/ROLE.md",
      "  change    .cadre/be/kickoff.txt",
      "  change    .cadre/cadre.json",
      "  change    .cadre/manifest.json",
      "  hunk      .planning/config.json  mode: not set (GSD default) -> \"yolo\"  (required, accepted)",
      "            run: node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo",
      "  hunk      .planning/config.json  workflow.text_mode: not set (GSD default) -> false  (required, accepted)",
      "            run: node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set workflow.text_mode false",
      "Summary: 0 create, 5 change, 0 leave, 0 conflict, 2 hunks (2 accepted)",
      "Dry run: nothing was written."
    ]
  },
  "applied": {
    "run": {
      "asks": [
        {
          "question": [
            "Which frameworks does this team use? Found: GSD. Adding one installs it at project scope after Confirm.",
            "Roles: be, pm."
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
            ".planning/config.json: mode"
          ],
          "header": "Hunk 1 of 2",
          "options": [
            "Accept",
            "Decline"
          ],
          "multiSelect": false
        },
        {
          "question": [
            ".planning/config.json: workflow.text_mode"
          ],
          "header": "Hunk 2 of 2",
          "options": [
            "Accept",
            "Decline"
          ],
          "multiSelect": false
        },
        {
          "question": [
            "Review the framework changes. Confirm writes them; Cancel writes nothing."
          ],
          "header": "Review",
          "options": [
            "Confirm",
            "Cancel"
          ],
          "multiSelect": false
        }
      ],
      "logged": [],
      "shown": [],
      "promptHashes": [],
      "reply": [
        "cadre frameworks",
        "Frameworks: GSD",
        "be: GSD",
        "pm: none (built-in)",
        "File plan:",
        "  change    .cadre/INDEX.md",
        "  change    .cadre/be/ROLE.md",
        "  change    .cadre/be/kickoff.txt",
        "  change    .cadre/cadre.json",
        "  change    .cadre/manifest.json",
        "  hunk      .planning/config.json  mode: not set (GSD default) -> \"yolo\"  (required, accepted)",
        "            run: node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo",
        "  hunk      .planning/config.json  workflow.text_mode: not set (GSD default) -> false  (required, accepted)",
        "            run: node ~/.claude/gsd-core/bin/gsd-tools.cjs config-set workflow.text_mode false",
        "Summary: 0 create, 5 change, 0 leave, 0 conflict, 2 hunks (2 accepted)",
        "Applied: wrote 5 files (0 executable).",
        "Next: run /cadre start <id> to launch a role."
      ]
    },
    "writes": [
      {
        "path": "/repo/.cadre/INDEX.md",
        "sha256": "e6e561db51d65729cc8317d4f3f23258082d0027c2103d8826ffb03e2eaff330",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/be/ROLE.md",
        "sha256": "293631e46bc34bb77dd521351e234fd0780dd48d950a320133024b25f47b6357",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/be/kickoff.txt",
        "sha256": "fb87acc0c9cde6279de82fa15bfd144ace00d4be03a200fd9c7a2449ae8c926e",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/cadre.json",
        "sha256": "d222756172b5908bfebb989608f0563ec32e06d836e0889e85a9e0a11712af19",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/manifest.json",
        "sha256": "b621b1028e1043442dcd1bca19e3f077b3ec723970e321060768aa86e5d402dd",
        "isWritten": true
      }
    ],
    "calls": [
      "node /home/u/.claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo @ /repo",
      "node /home/u/.claude/gsd-core/bin/gsd-tools.cjs config-set workflow.text_mode false @ /repo"
    ],
    "manifest": [
      "{",
      "  \"cadreVersion\": \"0.2.0\",",
      "  \"files\": [",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/INDEX.md\",",
      "      \"sha256\": \"e6e561db51d65729cc8317d4f3f23258082d0027c2103d8826ffb03e2eaff330\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/be/CLAUDE.md\",",
      "      \"sha256\": \"b35fad006af4307713a1620f01831317be89f04b4ce428f54cb7c6638c88f7d7\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/be/ROLE.md\",",
      "      \"sha256\": \"293631e46bc34bb77dd521351e234fd0780dd48d950a320133024b25f47b6357\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/be/kickoff.txt\",",
      "      \"sha256\": \"fb87acc0c9cde6279de82fa15bfd144ace00d4be03a200fd9c7a2449ae8c926e\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/be/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/be/role.json\",",
      "      \"sha256\": \"6e6c53878901d0c4a2ba30eb421756ca0ed6d8b75316113af997e83117aa1939\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/be/settings.json\",",
      "      \"sha256\": \"57de2f70adce0df0664d713cf2df44e46bce81f25e6cb0444423936d5406ec3a\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/be\",",
      "      \"sha256\": \"65f388b1a8462f4cf6467d8fb00839f9316be891e0a25d91de1d6adc978bcb08\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/pm\",",
      "      \"sha256\": \"6ee35b865c0d60d5bba7ca33e09b6b50a2da7e3b57b024315fba9b434f33b9ce\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/cadre.json\",",
      "      \"sha256\": \"d222756172b5908bfebb989608f0563ec32e06d836e0889e85a9e0a11712af19\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/CLAUDE.md\",",
      "      \"sha256\": \"bec0e6bed7a85311cef17b5d42b464877dcd0d730c48eb038e0f8f00ad6389b3\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/ROLE.md\",",
      "      \"sha256\": \"7a1592daca6317d45a2aa99fff2c1b9a4894b23bd620f41ad4f0a42e5f6fa47a\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/kickoff.txt\",",
      "      \"sha256\": \"bf1ffd286642f9cc4394d8ee794a0535f5ddefc30107f6b39e03a812ec4d957b\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/mcp.json\",",
      "      \"sha256\": \"5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/role.json\",",
      "      \"sha256\": \"37475f08586055563093a7c74c1a0d50d2c38cd2e8336190ab6d213e858efab1\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/pm/settings.json\",",
      "      \"sha256\": \"d7b4731f3ed8b9a775cc9a1142db81a387d9775dc514c48949ed681f1dc3d595\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/sizing.md\",",
      "      \"sha256\": \"9c961414ae04da71cdabf56a180298b54e2d9e631279138b47c059d3ab7ed6c3\"",
      "    }",
      "  ],",
      "  \"schema\": 1",
      "}",
      ""
    ]
  }
}
