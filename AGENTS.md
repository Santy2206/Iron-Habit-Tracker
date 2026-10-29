<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Verification

- `npm run lint` and `npm run build` verify the SPA; build must retain static output in `out/`.
- `npm run test:notifications` requires Deno and runs synthetic parser/receiver tests without network or production writes.
- Notification SQL tests require an isolated PostgreSQL database named `iron%test` and `iron.test_database = 'synthetic-local-only'`. See SETUP.md for bootstrap commands. They roll back fixture rows.
- The original finance schema predates the migration history. `supabase/finance-current-schema.sql` is a schema-only test baseline, not a deployment migration. Never restore it onto an existing database.
- Finance ownership is not inferred: legacy rows remain unowned until an administrator explicitly assigns them. Do not run that assignment against production as part of verification.
