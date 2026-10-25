// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { Options } from '../../entrypoints/options/Options';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../shared/settings';

vi.mock('../shared/settings', async (original) => ({ ...await original<typeof import('../shared/settings')>(), loadSettings: vi.fn(), saveSettings: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it('初回同意、接続確認、取消、自分のキーへの切替でも同意し直す操作ができる', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let settings = { ...DEFAULT_SETTINGS };
  vi.mocked(loadSettings).mockResolvedValue(settings);
  vi.mocked(saveSettings).mockImplementation(async (patch) => (settings = { ...settings, ...patch }));
  const sendMessage = vi.fn().mockResolvedValue({ ok: true, model: 'test' });
  vi.stubGlobal('browser', { runtime: { sendMessage } });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const button = (text: string) => [...container.querySelectorAll('button')].find((e) => e.textContent === text)!;
  const click = async (text: string) => { await act(async () => button(text).click()); };
  try {
    await act(async () => root.render(<Options />));
    expect(button('接続を確認する').disabled).toBe(true);
    await click('接続を確認する'); expect(sendMessage).not.toHaveBeenCalled();
    await click('同意して分類を使う'); expect(button('接続を確認する').disabled).toBe(false);
    await click('接続を確認する'); expect(sendMessage).toHaveBeenCalledOnce();
    await click('同意を取り消す'); expect(button('接続を確認する').disabled).toBe(true);
    const direct = container.querySelectorAll<HTMLInputElement>('[name="classifierMode"]')[1]!;
    await act(async () => direct.click());
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(settings.classificationConsent).toBe('pending');
    expect(button('接続を確認する').disabled).toBe(true);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
