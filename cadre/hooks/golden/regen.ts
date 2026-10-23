/**
 * The golden fixtures of `/cadre regen` (D-219). Regen always re-renders one role (only=<id>), so each fixture is
 * `regen be` in one of two worlds of the regen specs, dry and applied: `dry`/`applied` with BE as the whole team
 * (beOnlyWorld: nothing written yet, so every BE file is created), `dryOnly`/`appliedOnly` with BE one role of the BE
 * and PM team whose files are all on disk (regenWorld: only BE is planned, PM is carried). A dry run is its run, as
 * captureInit gives it; an applied run adds every write, host run and the manifest text, as captureApply gives them.
 * Captured from the code by a scratch run and pasted as printed; regen.test.ts in this folder runs each again and
 * compares with toEqual. Only an approved behaviour-change commit may change a fixture. Only the golden modules import
 * it.
 */
import type { GoldenApply, GoldenRun } from './types'

/** Each regen run by world and mode. */
export const GOLDEN_REGEN: Readonly<Record<string, GoldenRun | GoldenApply>> = {
  "dry": {
    "asks": [],
    "logged": [],
    "shown": [],
    "promptHashes": [],
    "reply": [
      "cadre regen be --dry-run",
      "File plan:",
      "  create    .cadre/INDEX.md",
      "  create    .cadre/be/ROLE.md",
      "  create    .cadre/be/kickoff.txt",
      "  create    .cadre/be/mcp.json",
      "  create    .cadre/be/settings.json",
      "  create    .cadre/bin/be (executable)",
      "  change    .cadre/manifest.json",
      "Summary: 6 create, 1 change, 0 leave, 0 conflict, 0 hunks",
      "warning: could not list the repo root (treated as unknown)",
      "Dry run: nothing was written."
    ]
  },
  "dryOnly": {
    "asks": [],
    "logged": [],
    "shown": [],
    "promptHashes": [],
    "reply": [
      "cadre regen be --dry-run",
      "File plan:",
      "  leave     .cadre/INDEX.md",
      "  leave     .cadre/be/ROLE.md",
      "  leave     .cadre/be/kickoff.txt",
      "  leave     .cadre/be/mcp.json",
      "  leave     .cadre/be/settings.json",
      "  leave     .cadre/bin/be (executable)",
      "  leave     .cadre/manifest.json",
      "Summary: 0 create, 0 change, 7 leave, 0 conflict, 0 hunks",
      "warning: could not list the repo root (treated as unknown)",
      "Dry run: nothing was written."
    ]
  },
  "applied": {
    "run": {
      "asks": [],
      "logged": [],
      "shown": [],
      "promptHashes": [],
      "reply": [
        "cadre regen be",
        "File plan:",
        "  create    .cadre/INDEX.md",
        "  create    .cadre/be/ROLE.md",
        "  create    .cadre/be/kickoff.txt",
        "  create    .cadre/be/mcp.json",
        "  create    .cadre/be/settings.json",
        "  create    .cadre/bin/be (executable)",
        "  change    .cadre/manifest.json",
        "Summary: 6 create, 1 change, 0 leave, 0 conflict, 0 hunks",
        "warning: could not list the repo root (treated as unknown)",
        "Applied: wrote 7 files (1 executable).",
        "Next: run /cadre start <id> to launch a role."
      ]
    },
    "writes": [
      {
        "path": "/repo/.cadre/INDEX.md",
        "sha256": "c2f737ae1004c8ca5c265a7b116de01d298f5296da9153b4ecbd0efadcfee7bf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/be/ROLE.md",
        "sha256": "47effb23db40cbc3a3f06384de57534301bcdc95d0004de13e3fe6eaaacfbfeb",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/be/kickoff.txt",
        "sha256": "ebba4760187aba218974165f107fa22994ade79aa2e159e7775513f3fc21a0e8",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/be/mcp.json",
        "sha256": "5ce88458ea23a00e2d34b1eee44bae2e46ad9cdef7c031a2288338ffe6595cdf",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/be/settings.json",
        "sha256": "8be5da803401dfc4aed2e51d348c0de6b7932b644c5be87c7e9612911523ab25",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/bin/be",
        "sha256": "28a2f8bed75b90519c50ab072060569c8c00f577752700af2c07054a6121522b",
        "isWritten": true
      },
      {
        "path": "/repo/.cadre/manifest.json",
        "sha256": "e25d06d08a1302da948638269fd16632c8198b444b6c0d4deb9a00c8abb845de",
        "isWritten": true
      }
    ],
    "calls": [
      "/bin/chmod 755 /repo/.cadre/bin/be @ -"
    ],
    "manifest": [
      "{",
      "  \"cadreVersion\": \"0.2.0\",",
      "  \"files\": [",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/INDEX.md\",",
      "      \"sha256\": \"c2f737ae1004c8ca5c265a7b116de01d298f5296da9153b4ecbd0efadcfee7bf\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/be/ROLE.md\",",
      "      \"sha256\": \"47effb23db40cbc3a3f06384de57534301bcdc95d0004de13e3fe6eaaacfbfeb\"",
      "    },",
      "    {",
      "      \"mode\": \"file\",",
      "      \"path\": \".cadre/be/kickoff.txt\",",
      "      \"sha256\": \"ebba4760187aba218974165f107fa22994ade79aa2e159e7775513f3fc21a0e8\"",
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
      "      \"sha256\": \"8be5da803401dfc4aed2e51d348c0de6b7932b644c5be87c7e9612911523ab25\"",
      "    },",
      "    {",
      "      \"mode\": \"exec\",",
      "      \"path\": \".cadre/bin/be\",",
      "      \"sha256\": \"28a2f8bed75b90519c50ab072060569c8c00f577752700af2c07054a6121522b\"",
      "    }",
      "  ],",
      "  \"schema\": 1",
      "}",
      ""
    ]
  },
  "appliedOnly": {
    "run": {
      "asks": [],
      "logged": [],
      "shown": [],
      "promptHashes": [],
      "reply": [
        "cadre regen be",
        "File plan:",
        "  leave     .cadre/INDEX.md",
        "  leave     .cadre/be/ROLE.md",
        "  leave     .cadre/be/kickoff.txt",
        "  leave     .cadre/be/mcp.json",
        "  leave     .cadre/be/settings.json",
        "  leave     .cadre/bin/be (executable)",
        "  leave     .cadre/manifest.json",
        "Summary: 0 create, 0 change, 7 leave, 0 conflict, 0 hunks",
        "warning: could not list the repo root (treated as unknown)",
        "Applied: nothing to write; every file is up to date.",
        "Next: run /cadre start <id> to launch a role."
      ]
    },
    "writes": [],
    "calls": [],
    "manifest": []
  }
}
