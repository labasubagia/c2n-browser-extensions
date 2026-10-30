# Repository Guidelines

## Project Overview

**c2n** — "ChatGPT to Notion" browser extension (Chrome/Edge, MV3). Browser port of `labasubagia/c2n` (MIT). Syncs ChatGPT image generations into a Notion database on user-triggered Sync, and cleans up ChatGPT's image library. Runs entirely in-browser; nothing is sent except to Notion via the user's own API tokens.

## Architecture (TL;DR)

- **Background** (`entrypoints/background.ts`) owns all async work and routes messages.
- **Content scripts** capture ChatGPT's auth token from the page and forward it.
- **`lib/` engines** do the work: sync pipeline, Notion/ChatGPT API adapters, IndexedDB storage, PNG prompt embedding.
- **React UIs**: popup (sync), options (settings), library (cleanup).
- For the full architecture, data flows, message contract, and editing-safety rules, see **`docs/architecture.md`**.

## Process Rules

- **Never merge a PR without explicit user permission.** Do not merge, click merge, or trigger merges autonomously; surface the review and await the user's go-ahead.
- **Check docs drift in every change.** Whenever code (interfaces, messages, types, API contracts, commands, architecture) changes, review the repo's docs and update any that are made stale by the change — including this file and `docs/architecture.md` only if they are actually affected. Treat stale docs as a defect; don't force-touch docs unrelated to the change.

## Development Rules (AI agents)

- **Verify contracts first.** Before editing, check `lib/messages.ts` (message union + `ResponseMap` + background `handleMessage` switch) and `lib/types.ts` (wire shapes). A new message touches all three.
- **Reuse before inventing.** Prefer existing patterns: `asRecord`/`asString` narrowing, `HttpError`, `ensureActive()` + `AbortError` (never swallow), module singleton + listener state.
- **Read the docs first.** Consult `AGENTS.md` + `docs/architecture.md` for intended design; if stale, fix docs in the same change.
- **Keep edits Biome-clean** (2-space, single quotes, semicolons) — pre-commit runs `biome check --write` + typecheck.
- **Preserve invariants:** Notion dedupe by filename, PNG inject idempotent, 400 = already-uploaded, never swallow abort.
- **Test only non-trivial logic** — new `test/*.test.ts`, real modules, no mocks. Don't test wiring.
- **Small diffs, one concern per PR; YAGNI** — skip unrequested abstraction.
- **Smoke-run before done:** `npm run typecheck` → `npm test` → `npm run build`, plus exercise the changed path.
- **Never merge without user permission** (per Process Rules).

## Key Directories

- `lib/` — core engines and adapters (no WXT coupling).
- `entrypoints/` — WXT entrypoints (background, content scripts, React UIs).
- `test/` — Vitest suites (one file per lib module).
- `assets/` — `app.css` shared UI style.
- `public/icon/` — extension icons.
- `docs/` — `architecture.md` (deep technical reference).
- `.github/workflows/` — CI (`ci.yml`) and PR validation (`pr-template.yml`).
- `.husky/` — active git hooks. Note: `run/_` is a **stale unused duplicate** of husky shims.

## Development Commands

```bash
npm install            # install; postinstall runs `wxt prepare`
npm run dev           # WXT dev server (HMR)
npm run build         # wxt build → .output/chrome-mv3
npm run zip           # wxt zip release artifact
npm run typecheck     # = `compile` → tsc --noEmit
npm test              # vitest run (one-shot)
npm run test:watch    # vitest watch
npm run lint          # biome lint .
npm run check         # biome check . (lint + format check)
```
Install: `npm install` → `npm run build` → load `.output/chrome-mv3` unpacked in `chrome://extensions` (Dev mode).

## Code Conventions (highlights)

- **Formatting:** Biome-controlled — 2-space indent, single quotes, semicolons always. Code must pass `biome ci .`; run `biome check --write` to autofix.
- **Async:** `async/await`; abort via `AbortError` (never swallow).
- **Error handling:** custom `HttpError`/`NotionError`; `errorMessage()` normalizes unknown errors.
- **React:** functional components + hooks only; no context/redux.
- **Types:** strict TS; `unknown` narrowing helpers across API adapters.
- **Idempotency (preserve):** Notion dedupe by filename; PNG prompt injection idempotent; 400 treated as already-uploaded.
- Full patterns (naming, state, functions) in **`docs/architecture.md`**.

## Important Files

- `lib/messages.ts` — messaging contract. **Any new message MUST be added to the `ExtensionMessage` union AND `ResponseMap`, and handled in the background `handleMessage` switch.**
- `lib/types.ts` — all shared/persisted interfaces.
- `lib/sync.ts` / `lib/library.ts` — state machines; checkpointed/resumable.
- `lib/chatgpt.ts` / `lib/notion.ts` — API adapters.
- `lib/storage.ts` — IndexedDB persistence.
- `lib/auth.ts` — session capture (token only in `browser.storage.session`).
- `wxt.config.ts` — manifest: permissions, `host_permissions`, min Chrome 116.

## Runtime/Tooling Preferences

- **Package manager:** npm (lockfile `package-lock.json`; CI uses `npm ci`).
- **Runtime:** Node ≥22 (CI pins 22); ESM (`"type": "module"`); React 19.
- **Stack:** WXT ^0.21 + `@wxt-dev/module-react`, TypeScript ^5.9, Vitest ^5, Biome ^2.6, husky 9 + lint-staged 17.
- **Husky pre-commit:** `lint-staged && npm run typecheck`. Keep edits Biome-clean to avoid churn.
- **WSL:** browser won't auto-launch; load `chrome-mv3-dev` via UNC `\\wsl.localhost\...`, or `C2N_OUT_DIR=/mnt/c/Users/<you>/c2n-dev npm run dev` for Windows-visible output.

## Testing & QA

- **Framework:** Vitest ^5, node environment, `fake-indexeddb` setup. Run with `npm test`.
- **Conventions:** `describe`/`it` per domain/behavior; **real modules, no mocks**; reset DB with `beforeEach`.
- **Coverage:** `png`, `storage`, `util`, `chatgpt`, `notion` tested. Untested: `retry`, `settings`, `sync`, `auth`, `library`, `messages`. New `test/*.test.ts` auto-discovered.
- **CI (`ci.yml`):** on push/PR — `lint` job runs `npx biome ci .`; `test` job runs `npm run typecheck` → `npm test` → `npm run build`.
- **PR hygiene:** body must follow `.github/PULL_REQUEST_TEMPLATE.md` (headers `### Summary`/`### Changes Made`/`### Testing`, ≥1 `- [x]` checked, no placeholder text) — enforced by `pr-template.yml`.
