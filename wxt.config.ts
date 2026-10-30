import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

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
    action: {
      default_title: 'c2n — ChatGPT to Notion',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
  },
});
