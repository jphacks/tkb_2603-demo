/** 公開URLだけを埋め込む。秘密キーはWXT_/VITE_の環境変数に入れない。 */
export const PROXY_URL = import.meta.env?.WXT_PROXY_URL?.trim() ?? '';

export function proxyOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}
