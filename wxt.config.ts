import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// Dev builds pin a stable extension ID via `manifest.key`. Chrome derives an
// unpacked extension's ID from its load path, so reloading from a different
// folder (dev vs build output) changes the ID and silently resets
// `browser.storage.local` (Notion settings). The key fixes the ID regardless
// of path. It is gated to development so production/store builds ship a clean
// manifest (Chrome Web Store assigns its own key).
const DEV_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6aADDh1iY2PwrwMwGwMDE1j00EAwrIgnPLUaVoWvehtRbgUnRN6XCVwoivOJsTI5U/BlwYiEKgQHJ3BsWA8+k4/tWaWondA5nx05zZZE1u3/HWlmL/JBrM+wvHuviL5dEk9F6wfHkRxM8vF/j7OBwEbek+97mI87vx1TAhGIAovhsTfxZCTjetf8D8AgKibIweCmx5tUyZBY+FzRRx8m/Quvln8wFxApWJjmo6qVrBmroAlTHkGHuBoX5/tqCXJIVZx6DVKyrzmZA7vn1r43B//vVPL7Yt5rJ+vHJ5+XxXEVR1FDScasiMhukeE0ML5zVcox+KckuZBm3Vj3u8X75wIDAQAB';
const isDev = process.env.NODE_ENV === 'development';

// WSL users can point the build output at a Windows drive so Chrome/Edge can
// load it from a regular local path, e.g.:
//   C2N_OUT_DIR=/mnt/c/Users/<you>/c2n-dev npm run dev
const outDir = process.env.C2N_OUT_DIR?.trim();

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  ...(outDir ? { outDir } : {}),
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'c2n — ChatGPT to Notion',
    description:
      'Manually sync ChatGPT image generations to a Notion database, with optional PNG prompt metadata and ChatGPT library cleanup.',
    permissions: ['storage', 'notifications'],
    host_permissions: [
      'https://chatgpt.com/*',
      'https://*.chatgpt.com/*',
      'https://api.notion.com/*',
      'https://*.oaiusercontent.com/*',
      'https://*.openai.com/*',
    ],
    minimum_chrome_version: '116',
    ...(isDev ? { key: DEV_EXTENSION_KEY } : {}),
    action: {
      default_title: 'c2n — ChatGPT to Notion',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
  },
});
