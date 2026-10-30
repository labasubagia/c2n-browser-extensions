# c2n — ChatGPT to Notion (browser extension)

A Chrome/Edge extension that mirrors image generations from **one** ChatGPT account into a Notion
database. It is a browser port of [`labasubagia/c2n`](https://github.com/labasubagia/c2n-browser-extensions) (MIT).

- Runs only on `chatgpt.com`.
- Does **not** use `/api/auth/session`; it observes the `Authorization` header ChatGPT already sends.
- **Manual sync only.** Nothing is uploaded until you press **Sync now**.
- No login screen: the ChatGPT tab supplies the session, and the Notion token + database ID are set
  in the extension's settings page.
- Includes a separate, confirmation-gated ChatGPT library cleanup page.

## Install (unpacked)

```sh
npm install
npm run build
```

Then in Chrome/Edge:

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select `.output/chrome-mv3`.
4. Pin the extension. The settings page opens on first install.

## Configure Notion

1. Create an internal integration at <https://www.notion.so/my-integrations> and copy its token.
2. Create a database with exactly these properties:
   - `Name` — type **Title**
   - `Image` — type **Files**
3. In Notion, open the database → **…** → **Connections** → add your integration.
4. Open the extension's **Settings**, paste the token and the database ID (or full database URL),
   then press **Test connection**. Both property checks must pass.

The pages c2n creates use the generated file name as the title (for example `file-abc123.png`) and
a body containing the prompt and, when available, the account email.

## Capture the ChatGPT session

1. Open <https://chatgpt.com> and sign in.
2. Reload the page after installing or reloading the extension.
3. Open the popup; the ChatGPT badge should show your email or “Session captured”.

The extension wraps `fetch`/`XMLHttpRequest` in the page's MAIN world, reads the bearer token from
requests to `chatgpt.com/backend-api/*`, and passes it to the background worker. The token is stored
in `browser.storage.session`, so it disappears when the browser session ends. If it expires, reload
chatgpt.com; there is no account UI to manage.

## Sync

1. Generate images in ChatGPT.
2. Open the popup and press **Sync now**.
3. Watch the progress counters. Cancel is safe and checkpointed.
4. If the browser suspends the worker mid-run, the popup shows **Resume interrupted run**.

For each recent generation c2n:

1. Looks up the conversation once to extract the user prompt.
2. Optionally checks Notion for an existing page with the same file name.
3. Downloads the image from ChatGPT.
4. Optionally embeds the prompt in PNG `tEXt`/`iTXt` metadata.
5. Uploads the file to Notion and creates the database page.
6. Marks the generation uploaded locally.
7. Optionally deletes the ChatGPT conversation once every image in it has synced (toggle off by default).

State lives in IndexedDB (`c2n` database) in the extension origin. No image blobs are retained.

### Settings

| Setting                         | Default | Meaning                                                            |
| ------------------------------- | ------- | ------------------------------------------------------------------ |
| Recent generations to inspect   | 100     | ChatGPT history window per run, 1–500.                             |
| Check Notion for duplicates     | on      | Query `Name` before downloading.                                   |
| Embed prompt in PNG metadata    | on      | Adds a `Prompt` chunk to PNG files.                                |
| Delete conversations after sync | off     | After all images in a conversation upload, delete it from ChatGPT. |
| Notify when a sync finishes     | on      | Browser notification on finish/failure.                            |

## Library cleanup

Open **Library cleanup** from the popup or settings page:

1. Optionally enter a search query; leave it empty for the entire image library.
2. **Scan library** lists matches without changing anything.
3. Review the preview, then type `DELETE` (filtered) or `DELETE ALL` (no query).
4. **Delete** performs ChatGPT's `soft_delete=true` library deletion with up to four concurrent
   requests; Cancel stops after in-flight requests settle.

This deletes only items in ChatGPT's image library. It does not delete conversations and does not
touch Notion pages. Deletion cannot be undone from the extension.

## Privacy and permissions

- Extension permissions: `storage`, `notifications`.
- Host permissions: `chatgpt.com`, `api.notion.com`, and ChatGPT image CDN/OpenAI hosts for downloads.
- Network traffic goes only to ChatGPT and Notion. There is no analytics or third-party service.
- The Notion token is stored in `browser.storage.local`; the ChatGPT token in `browser.storage.session`.
- Conversation data is fetched only to extract prompts; generation metadata is stored locally.

## Development

```sh
npm run dev          # WXT dev server with HMR
npm run compile      # TypeScript type check
npm test             # Vitest unit tests
npm run build        # production build
npm run zip          # distributable ZIP
```

### WSL

WXT cannot launch a Windows browser from WSL, so `npm run dev` prints:

```text
WARN Cannot open browser when using WSL. Load ".output/chrome-mv3-dev" as an unpacked extension manually
```

This is expected — the dev server is still running. Load the dev folder manually via
`chrome://extensions` → **Developer mode** → **Load unpacked**, using the Windows UNC path:

```text
\\wsl.localhost\<Distro>\home\<user>\<project>\.output\chrome-mv3-dev
```

If Chrome refuses to load from a WSL/UNC path, write the dev output to a Windows drive instead so
HMR keeps working:

```sh
C2N_OUT_DIR=/mnt/c/Users/<you>/c2n-dev npm run dev
```

Then load `C:\Users\<you>\c2n-dev\chrome-mv3-dev` as the unpacked extension. The dev server only
needs to keep running; press `o` + Enter does not help under WSL.

Key modules:

- `entrypoints/chatgpt-auth.content.ts` — MAIN-world fetch/XHR token observer.
- `entrypoints/chatgpt-bridge.content.ts` — isolated-world bridge to the background worker.
- `entrypoints/background.ts` — message router, keepalive, notifications.
- `lib/sync.ts` / `lib/library.ts` — checkpointed sync and library deletion engines.
- `lib/chatgpt.ts` / `lib/notion.ts` — API adapters.
- `lib/png.ts` — PNG prompt metadata injection.
- `lib/storage.ts` — IndexedDB state.

## Limitations

- Single ChatGPT account, Chrome/Edge (Manifest V3) first.
- Conversation deletion is optional, off by default, and only runs for conversations where every
  image synced successfully.
- Sync requires the Notion database to use the hardcoded `Name`/`Image` properties.
- ChatGPT's internal backend API can change without notice; c2n has no public API contract to rely on.
