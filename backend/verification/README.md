# HookForge — Verification Artifact Registry

This directory is the single source of truth for all historical verification artifacts for the
HookForge `feature/backend-core` branch. Production source code, automated tests, and
configuration files remain in their original repository locations and are **not** affected by
anything in this folder.

---

## Folder Structure

```
verification/
├── README.md                               ← this file (master registry)
├── phase-1/
│   ├── README.md                           ← phase-1 artifact index
│   ├── PHASE1_SUMMARY.md                   ← Phase 1 implementation summary
│   ├── PHASE1_VERIFICATION.md              ← Phase 1 line-by-line audit
│   └── REFERENCE_AUDIT.md                 ← Java → Node.js reference mapping
└── phase-2/
    ├── README.md                           ← phase-2 artifact index
    ├── notes/
    │   └── PHASE2_PLAN.md                  ← Phase 2 planning & strategy
    ├── reports/
    │   └── PHASE2_VERIFICATION_REPORT.md   ← Formal verification report (sign-off)
    └── logs/
        ├── unit_tests.log                  ← Vitest run (131 tests, all passed)
        └── e2e_acceptance.log              ← Live E2E run (8 scenarios, all passed)
```

---

## Master Artifact Classification Table

| Original Path | Current Path | Classification | Reason | Safe to delete later? |
| :--- | :--- | :---: | :--- | :---: |
| `PHASE1_SUMMARY.md` *(root)* | `verification/phase-1/PHASE1_SUMMARY.md` | ARCHIVE | Historical summary of Phase 1 implementation — no longer referenced by any build or test script | Yes, after first release |
| `PHASE1_VERIFICATION.md` *(root)* | `verification/phase-1/PHASE1_VERIFICATION.md` | ARCHIVE | Historical Phase 1 code audit document — no production dependency | Yes, after first release |
| `REFERENCE_AUDIT.md` *(root)* | `verification/phase-1/REFERENCE_AUDIT.md` | RETAIN | Java→Node.js design mapping; useful long-term contributor reference | Optional — not urgent |
| `PHASE2_PLAN.md` *(root)* | `verification/phase-2/notes/PHASE2_PLAN.md` | REVIEW_LATER | Untracked planning doc; no build or runtime dependency | Yes, after first release |
| *(new)* | `verification/phase-2/reports/PHASE2_VERIFICATION_REPORT.md` | RETAIN | Formal sign-off record for Phase 2 — 19/19 suites, 131/131 tests, 8/8 E2E; should be kept as project evidence | Recommended to keep |
| *(new)* | `verification/phase-2/logs/unit_tests.log` | REVIEW_LATER | Raw Vitest output; can be regenerated via `npm test` at any time | Yes — regenerate as needed |
| *(new)* | `verification/phase-2/logs/e2e_acceptance.log` | REVIEW_LATER | Raw E2E acceptance output; can be regenerated via `npm run test:e2e` | Yes — regenerate as needed |

---

## Files Deliberately Kept in Place

These files were inspected but **not moved** because they are active project references:

| File | Reason to Keep |
| :--- | :--- |
| `README.md` | Primary project setup and API documentation — must stay at repository root |
| `JAVA_TO_NODE_MAPPING.md` | Active architecture module blueprint; may be referenced by contributors |
| `scripts/verify-e2e.js` | Required by `package.json` `"test:e2e"` script — cannot be relocated |
| `scripts/migrate.js` | Required by `package.json` `"db:migrate"` script |
| `src/` | All production application source code |
| `test/` | All automated test suites (Vitest) |
| `migrations/` | PostgreSQL schema migration files |
| `package.json`, `package-lock.json` | Node.js project manifests |
| `Dockerfile`, `docker-compose.yml` | Container configuration |
| `vitest.config.js` | Test runner configuration |
| `.env`, `.env.example` | Environment configuration |
| `.gitignore` | Version control exclusions |

---

## Classification Key

| Label | Meaning |
| :--- | :--- |
| **RETAIN** | Keep indefinitely; used as reference or formal record |
| **ARCHIVE** | Historically useful; safe to compress or move to cold storage after release |
| **REVIEW_LATER** | Can be regenerated; review and delete after next major release |

---

## Notes

- **No files in this directory are imported or executed by application code.**
- **No git commits were made.** All changes remain as untracked working-tree files for your review.
- Logs may be refreshed at any time: `npm test` regenerates `unit_tests.log`; `npm run test:e2e` regenerates `e2e_acceptance.log`.
