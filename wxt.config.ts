import { defineConfig } from 'wxt';
import { proxyOrigin } from './src/shared/proxy-url';

// See https://wxt.dev/api/reference/wxt/interfaces/inlineconfig.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  zip: { excludeSources: ['proxy/**', '.env*', '**/.env*', '**/.dev.vars*'] },
  manifest: () => {
    const raw = import.meta.env.WXT_PROXY_URL?.trim() ?? '';
    const origin = proxyOrigin(raw);
    if (raw && !origin) throw new Error('WXT_PROXY_URLにはHTTPSのルートURLを設定してください。');
    if (process.argv.includes('zip') && (!origin || !origin.startsWith('https://') || /YOUR-SUBDOMAIN|\.example(?::|$)/i.test(origin))) {
      throw new Error('配布ZIPには公開先URLが必要です。WXT_PROXY_URLに公開済みWorkerのHTTPS URLを設定してください。');
    }
    return {
    name: 'ひといき',
    description: 'AI チャット(ChatGPT・Claude・Gemini)での作業の中身から負担の目安を計算して、休憩のタイミングを提案します',
    permissions: ['storage'],
    host_permissions: ['https://chatgpt.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*', 'https://api.anthropic.com/*',
      ...(origin ? [`${origin}/*`] : [])],
    };
  },
});
