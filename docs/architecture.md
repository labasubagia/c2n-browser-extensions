# Architecture

Deep technical reference for the c2n extension. For a high-level orientation and commands, see `AGENTS.md`.

## Entrypoints (WXT)

- `entrypoints/background.ts` — MV3 service worker; owns all async work. Router `handleMessage` dispatches by `message.type`; restores persisted sync/library state on startup; broadcasts `STATE_UPDATE`; keep-alive while running; notifications gated by `settings.notifyOnFinish`.
- `entrypoints/chatgpt-auth.content.ts` — content script in **MAIN world**; wraps `fetch`/XHR to read ChatGPT's `Authorization` bearer (webRequest hides it from extensions); posts via `window.postMessage({source:'c2n-auth', type:'token'})`.
- `entrypoints/chatgpt-bridge.content.ts` — content script at `document_start`; listens for `c2n-auth`, forwards validated token to background (`AUTH_TOKEN_OBSERVED`).
- React UIs (each `App.tsx`/`main.tsx`/`index.html`): `popup/` (sync controls/status), `options/` (settings + Test connection), `library/` (scan/delete workflow).

## Data Flow

**Auth:**
```
chatgpt.com page
 → auth content script (MAIN world) reads Authorization
 → window.postMessage('c2n-auth', token)
 → bridge content script
 → browser.runtime.sendMessage({type:'AUTH_TOKEN_OBSERVED'})
 → background saveObservedToken() → browser.storage.session 'authSession'
```

**Sync:** UI → `START_SYNC` → background `startSync()` → `lib/sync.ts` pipeline: read generations → look up conversation prompt (optional Notion dup-check) → download image → optional `lib/png.ts` prompt embed → `lib/notion.ts` upload + create page → mark local → optional delete conversation. Progress persisted via `lib/storage.ts` + broadcast `STATE_UPDATE`.

## Messaging Contract

`lib/messages.ts` is the contract between UIs/content scripts and background. Discriminated-union `ExtensionMessage` + `ResponseMap`; typed `sendMessage<T>()`; background broadcasts `STATE_UPDATE` guarded by `isStateUpdate()`.
**Any new message MUST be added to the `ExtensionMessage` union AND `ResponseMap`, and safely handled in the background `handleMessage` switch.**

## State Management

Module-level mutable singletons (`let state`) + listener callbacks (`setSyncStateListener`/`setLibraryStateListener`), persisted to IndexedDB meta store; restored on worker startup.

## Key Modules

- `lib/notion.ts` — `NotionClient`; `validateDatabase`, `getDataSources` (cached 24h TTL), `isPageExists` (dup check), `addPageToDatabase` (createUpload → sendUpload → POST `/v1/pages`); 400 on upload = already-uploaded (idempotent).
- `lib/chatgpt.ts` — ChatGPT API client: `getRecentImageGenerations`, `getConversation`, `downloadImage`, `getMe`, `getLibraryImages`, `deleteLibraryFile`, `deleteConversation`, `getPromptFromImageNodeInConversation`, `parseSseEvents`.
- `lib/sync.ts` — `startSync`/`cancelSync`/`restoreSyncState`/`getSyncState`/`setSyncStateListener`; `run()` → `processOne()`; `fatalAuthMessage()` stops on 401/403; abort via `AbortError`/`ensureActive()`.
- `lib/library.ts` — scan (`scanLibrary`) + delete (`deleteScannedLibrary`, concurrency 4); persists `libraryState` + `libraryScan`.
- `lib/storage.ts` — IndexedDB `c2n` DB v1; stores `generations`(key id), `meta`(key key), `runs`, `libraryRuns` + indexes.
- `lib/auth.ts` — session capture/validation; `saveObservedToken`, `getUsableAuthSession`, `clearAuthSession`; JWT decode for expiry/email; stored in `browser.storage.session` (fallback local).
- `lib/settings.ts` — `Settings`, `DEFAULT_SETTINGS`, `loadSettings`/`saveSettings`, `normalizeSettings`, `validateSettings`, `isNotionConfigured`.
- `lib/retry.ts` — exponential backoff + jitter; `HttpError` (`status`,`url`,`body`,`retryAfterMs`); `isRetryable` (429/5xx/TypeError); abort-aware `sleep`; `fetchChecked`, `requestWithRetry`, `requestBlobWithRetry`.
- `lib/util.ts` — pure helpers: `fileNameForGeneration`, `parseNotionDatabaseId`, `decodeJwtPayload`, `extractEmailFromJwt`, `errorMessage`, `isAbortError`, `safeUrl`, `truncate`, `timestampToIso`, `contentTypeForFileName`.
- `lib/png.ts` — PNG chunk parse/write (crc-32); `injectPromptMetadata` writes 'Prompt' tEXt/iTXt chunk before IEND (idempotent); `getPngPrompt`.
- `lib/types.ts` — all shared interfaces (Settings, AuthSession/Status, GenerationRecord, SyncState, LibraryState, RunError).
- `lib/messages.ts` — `ExtensionMessage` union + `ResponseMap`; `openPage`/`openOptionsPage`.

## Conventions

- **Error handling:** `HttpError` (retry) & `NotionError`; `catch {}` only for best-effort; `errorMessage()` normalizes unknown errors; abort via `isAbortError()` + `signal.aborted`.
- **Async:** `async/await`; `Promise.all` for parallel init; `AbortSignal.timeout(...)` in background handlers. **Never swallow abort — rethrow.**
- **React:** functional components + hooks only (useState/useCallback/useEffect/useMemo); no context/redux; local state from polling (`setInterval` 3–5s) + `STATE_UPDATE` listener; `busy` string gates buttons.
- **Types:** strict TS; `unknown` narrowing `asRecord`/`asString`/`asNumber`/`asArray` in `chatgpt.ts`/`notion.ts`.
- **Naming:** `snake_case` API fields; `camelCase` TS; message types SCREAMING_SNAKE; phase enums lowercase.
- **Functions:** `function` declarations for main flows; exported consts for small helpers; arrow-default-export components.
- **Idempotency (preserve):** Notion dedupe by filename; PNG prompt injection idempotent; 400 = already-uploaded.
- **Re-exports:** `chatgpt.ts` re-exports `fileNameForGeneration`/`timestampToIso` from `util.ts`.

## Editing Safety

- `messages.ts` + `types.ts` are the contracts — keep wire fields in sync with raw API shape.
- Auth token lives only in `browser.storage.session`; must be re-observed from chatgpt.com. `isTokenShaped` (20–8192 chars, no whitespace) gates capture and bridge.
- Sync/library mutual exclusion: background rejects `START_SYNC` while library runs and vice-versa.
- Keep-alive runs only while sync/library running (`syncKeepAlive`).

## Tooling Constraints

- **Formatting (Biome):** 2-space indent, single quotes, semicolons always, preset `recommended`. Must pass `biome ci .`; use `biome check --write`.
- **Typecheck:** `tsc --noEmit` (pre-commit + CI). Alias `@` → repo root.
- **Manifest:** add new hosts to `host_permissions` in `wxt.config.ts`; add entrypoints/modules via wxt config.
