import { classifyInBackground } from '../src/shared/classification-service';
import type { BackgroundRequest } from '../src/shared/messages';
import { onSettingsChanged } from '../src/shared/settings';

export default defineBackground(() => {
  const pending = new Set<AbortController>();
  onSettingsChanged(() => { for (const controller of pending) controller.abort(); });
  browser.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, sendResponse) => {
    if (msg.type === 'open_options') { browser.runtime.openOptionsPage(); return false; }
    if (msg.type !== 'classify' && msg.type !== 'test_key') return false;
    const controller = new AbortController();
    pending.add(controller);
    const input = msg.type === 'classify' ? msg : {
      userText: '動かないので確認してください。TypeError: Cannot read properties of undefined',
      assistantText: 'AとBのどちらにしますか？', previousTask: '動作確認',
    };
    classifyInBackground(input, controller.signal).then(sendResponse).finally(() => pending.delete(controller));
    return true;
  });
});
