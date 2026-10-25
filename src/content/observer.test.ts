// @vitest-environment happy-dom
// ChatGPT に似た DOM を作って、送信・生成中・回答の終わり・エラーの貼り付けを取れるか確かめる。
// 本物の画面の構造とは違いうるので、当日は必ず実機の「診断」で確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatObserver } from './observer';
import { CHATGPT, CLAUDE, GEMINI } from './sites';

function setup() {
  document.body.innerHTML = `
    <main>
      <div id="thread"></div>
      <form data-chatgpt-composer>
        <div contenteditable="true" role="textbox" id="prompt-textarea"></div>
        <button data-testid="send-button">送信</button>
      </form>
    </main>`;
}

function addUser(text: string) {
  const el = document.createElement('div');
  el.setAttribute('data-message-author-role', 'user');
  el.textContent = text;
  document.getElementById('thread')!.appendChild(el);
}

function addAssistant(text: string) {
  const el = document.createElement('div');
  el.setAttribute('data-message-author-role', 'assistant');
  el.textContent = text;
  document.getElementById('thread')!.appendChild(el);
  return el;
}

function setStop(on: boolean) {
  const existing = document.querySelector('[data-testid="stop-button"]');
  if (on && !existing) {
    const b = document.createElement('button');
    b.setAttribute('data-testid', 'stop-button');
    document.querySelector('form')!.appendChild(b);
  }
  if (!on && existing) existing.remove();
}

describe('ChatObserver(ChatGPT)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setup();
  });
  afterEach(() => vi.useRealTimers());

  it('送信 → 生成中 → 停止ボタンが消えたら回答の終わり', async () => {
    const cb = {
      onPromptSent: vi.fn(),
      onResponseDone: vi.fn(),
      onErrorPaste: vi.fn(),
      onConversationSwitch: vi.fn(),
      onActivity: vi.fn(),
    };
    const obs = new ChatObserver(CHATGPT, cb);
    obs.start();
    const composer = document.getElementById('prompt-textarea')!;
    composer.textContent = 'React でフォームを作って';
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    await vi.advanceTimersByTimeAsync(400);
    expect(cb.onPromptSent).toHaveBeenCalledWith('React でフォームを作って');

    addUser('React でフォームを作って');
    setStop(true);
    const a = addAssistant('もちろんです');
    await vi.advanceTimersByTimeAsync(600);
    expect(obs.isGenerating()).toBe(true);
    expect(cb.onResponseDone).not.toHaveBeenCalled();

    a.textContent = 'もちろんです。まずは次の 4 つに分けると見通しよく作れます。';
    setStop(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(cb.onResponseDone).toHaveBeenCalledTimes(1);
    expect(cb.onResponseDone.mock.calls[0]![0]).toContain('4 つに分ける');
    expect(cb.onResponseDone.mock.calls[0]![1]).toBe('React でフォームを作って');
    expect(cb.onResponseDone.mock.calls[0]![3]).toBe('stop_button');

    // 同じ回答を 2 回数えない
    await vi.advanceTimersByTimeAsync(5000);
    expect(cb.onResponseDone).toHaveBeenCalledTimes(1);

    // 終わった後に同じ回答が伸びたら、差分だけを続きとして渡す
    a.textContent += ' 続きの説明です。';
    await vi.advanceTimersByTimeAsync(3500);
    expect(cb.onResponseDone).toHaveBeenCalledTimes(2);
    expect(cb.onResponseDone.mock.calls[1]![0]).toBe(' 続きの説明です。');
    expect(cb.onResponseDone.mock.calls[1]![2]).toBe(true);
    obs.stop();
  });

  it('停止ボタンが無い画面: ページのほかの所が 1 秒ごとに変わっても、回答の字数が 2.5 秒止まれば終わり', async () => {
    const cb = callbacks();
    const obs = new ChatObserver(CHATGPT, cb);
    obs.start();
    // 回答と関係の無い所(サイドバーなど)が 1 秒ごとに変わり続ける
    const side = document.createElement('div');
    document.body.appendChild(side);
    const ticker = window.setInterval(() => (side.textContent = String(Date.now())), 1000);
    const composer = document.getElementById('prompt-textarea')!;
    composer.textContent = '質問';
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    await vi.advanceTimersByTimeAsync(400);
    addUser('質問');
    addAssistant('回答です。最後まで書きました。');
    await vi.advanceTimersByTimeAsync(2000);
    expect(cb.onResponseDone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(cb.onResponseDone).toHaveBeenCalledTimes(1);
    expect(cb.onResponseDone.mock.calls[0]![2]).toBe(false);
    expect(cb.onResponseDone.mock.calls[0]![3]).toBe('quiet');
    expect(obs.diagnostics.completionMethod).toBe('quiet');
    clearInterval(ticker);
    obs.stop();
  });

  it('停止ボタンが無い画面: 回答の字が伸び続けている間は終わりにしない', async () => {
    const cb = callbacks();
    const obs = new ChatObserver(CHATGPT, cb);
    obs.start();
    const composer = document.getElementById('prompt-textarea')!;
    composer.textContent = '質問';
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    await vi.advanceTimersByTimeAsync(400);
    addUser('質問');
    const a = addAssistant('回答');
    for (let i = 0; i < 10; i++) {
      a.textContent += 'が続きます';
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(cb.onResponseDone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(cb.onResponseDone).toHaveBeenCalledTimes(1);
    expect(cb.onResponseDone.mock.calls[0]![0]).toBe('回答' + 'が続きます'.repeat(10));
    obs.stop();
  });

  it('送信を取り逃しても、吹き出しが最後に 1 つ増えたら(生成中が取れなくても)送信を補う。Enter で取れた時は二重にしない', async () => {
    const cb = callbacks();
    addUser('前の質問');
    const obs = new ChatObserver(CHATGPT, cb);
    obs.start();
    await vi.advanceTimersByTimeAsync(5500);
    // Enter が取れない画面: 吹き出しだけが増える。停止ボタンも出ない
    addUser('取り逃した質問');
    await vi.advanceTimersByTimeAsync(400);
    expect(cb.onPromptSent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    expect(cb.onPromptSent).toHaveBeenCalledTimes(1);
    expect(cb.onPromptSent).toHaveBeenCalledWith('取り逃した質問');

    // Enter で取れた送信は、吹き出しから二重に数えない
    await vi.advanceTimersByTimeAsync(5000);
    const composer = document.getElementById('prompt-textarea')!;
    composer.textContent = '次の質問';
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    addUser('次の質問');
    await vi.advanceTimersByTimeAsync(2000);
    expect(cb.onPromptSent).toHaveBeenCalledTimes(2);
    expect(cb.onPromptSent.mock.calls[1]![0]).toBe('次の質問');
    obs.stop();
  });

  it('開いた直後に描かれた吹き出しや、上に読み込まれた古い吹き出しは送信と数えない', async () => {
    const cb = callbacks();
    const obs = new ChatObserver(CHATGPT, cb);
    obs.start();
    await vi.advanceTimersByTimeAsync(600);
    addUser('開いた会話の 1 通目'); // 開いた直後に遅れて描かれる
    await vi.advanceTimersByTimeAsync(5500);
    // 上へのスクロールで古い吹き出しが先頭に 1 つ読み込まれる(最後の吹き出しは変わらない)
    const old = document.createElement('div');
    old.setAttribute('data-message-author-role', 'user');
    old.textContent = '古い質問';
    document.getElementById('thread')!.prepend(old);
    await vi.advanceTimersByTimeAsync(2000);
    expect(cb.onPromptSent).not.toHaveBeenCalled();
    obs.stop();
  });

  it('前の回答が残っている会話で送っても、停止ボタンが無い画面で前の回答を新しい回答と数えない', async () => {
    addUser('前の質問');
    addAssistant('前の回答です。');
    const cb = callbacks();
    const obs = new ChatObserver(CHATGPT, cb);
    obs.start();
    await vi.advanceTimersByTimeAsync(6000);
    const composer = document.getElementById('prompt-textarea')!;
    composer.textContent = '新しい質問';
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    addUser('新しい質問');
    await vi.advanceTimersByTimeAsync(4000);
    expect(cb.onResponseDone).not.toHaveBeenCalled();
    addAssistant('新しい回答です。');
    await vi.advanceTimersByTimeAsync(3500);
    expect(cb.onResponseDone).toHaveBeenCalledTimes(1);
    expect(cb.onResponseDone.mock.calls[0]!.slice(0, 4)).toEqual(['新しい回答です。', '新しい質問', false, 'quiet']);
    obs.stop();
  });

  it('前の回答が残っている会話で、停止ボタンが送信の 1 秒後に出ても、回答は停止ボタンの 1 回だけ', async () => {
    addUser('前の質問');
    addAssistant('前の回答です。');
    const cb = callbacks();
    const obs = new ChatObserver(CHATGPT, cb);
    obs.start();
    await vi.advanceTimersByTimeAsync(6000);
    const composer = document.getElementById('prompt-textarea')!;
    composer.textContent = '新しい質問';
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    addUser('新しい質問');
    await vi.advanceTimersByTimeAsync(1000);
    setStop(true);
    const a = addAssistant('新しい');
    await vi.advanceTimersByTimeAsync(3000);
    a.textContent = '新しい回答です。';
    setStop(false);
    await vi.advanceTimersByTimeAsync(600);
    expect(cb.onResponseDone.mock.calls.map((c) => [c[0], c[3]])).toEqual([['新しい回答です。', 'stop_button']]);
    obs.stop();
  });

  it('吹き出しが送信より 1 秒遅れて出ても、送信を二重に数えない', async () => {
    const cb = callbacks();
    const obs = new ChatObserver(CHATGPT, cb);
    obs.start();
    await vi.advanceTimersByTimeAsync(6000);
    const composer = document.getElementById('prompt-textarea')!;
    composer.textContent = '質問';
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    await vi.advanceTimersByTimeAsync(1000);
    addUser('質問');
    await vi.advanceTimersByTimeAsync(2000);
    expect(cb.onPromptSent).toHaveBeenCalledTimes(1);
    obs.stop();
  });

  it('生成中に送信ボタン(停止と兼用)を押しても送信とは数えない', async () => {
    const cb = {
      onPromptSent: vi.fn(),
      onResponseDone: vi.fn(),
      onErrorPaste: vi.fn(),
      onConversationSwitch: vi.fn(),
      onActivity: vi.fn(),
    };
    const obs = new ChatObserver(CHATGPT, cb);
    obs.start();
    setStop(true);
    document.getElementById('prompt-textarea')!.textContent = '書きかけ';
    (document.querySelector('[data-testid="send-button"]') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(400);
    expect(cb.onPromptSent).not.toHaveBeenCalled();
    obs.stop();
  });

  it('エラー文らしい貼り付けだけを数える(本文は渡さない)', () => {
    const cb = {
      onPromptSent: vi.fn(),
      onResponseDone: vi.fn(),
      onErrorPaste: vi.fn(),
      onConversationSwitch: vi.fn(),
      onActivity: vi.fn(),
    };
    const obs = new ChatObserver(CHATGPT, cb);
    obs.start();
    const composer = document.getElementById('prompt-textarea')!;
    const paste = (text: string) => {
      const ev = new Event('paste', { bubbles: true }) as ClipboardEvent;
      Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
      composer.dispatchEvent(ev);
    };
    paste("TypeError: Cannot read properties of undefined (reading 'map')\n    at App (App.tsx:12:5)");
    paste('普通の文章です');
    expect(cb.onErrorPaste).toHaveBeenCalledTimes(1);
    expect(cb.onErrorPaste).toHaveBeenCalledWith(2);
    obs.stop();
  });
});

function callbacks() {
  return {
    onPromptSent: vi.fn(),
    onResponseDone: vi.fn(),
    onErrorPaste: vi.fn(),
    onConversationSwitch: vi.fn(),
    onActivity: vi.fn(),
    onGenerationStart: vi.fn(),
    onTypingStart: vi.fn(),
    onTypingEnd: vi.fn(),
  };
}

describe('ChatObserver(Claude)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/new');
    document.body.innerHTML = `
      <div id="thread"></div>
      <div data-composer-card-holder><div id="card">
        <div data-testid="chat-input" contenteditable="true" class="ProseMirror"></div>
        <button data-testid="chat-input-send">送信</button>
      </div></div>`;
  });
  afterEach(() => vi.useRealTimers());

  it('新しい会話の 1 通目: URL に ID が付いても回答を取り逃さない。考えた過程のラベルは数えない', async () => {
    const cb = callbacks();
    const obs = new ChatObserver(CLAUDE, cb);
    obs.start();
    const composer = document.querySelector('[data-testid="chat-input"]')!;
    composer.textContent = 'バリデーションはどうする?';
    composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    composer.textContent = '';
    await vi.advanceTimersByTimeAsync(400);
    expect(cb.onPromptSent).toHaveBeenCalledWith('バリデーションはどうする?');

    // 送信すると /new → /chat/<id> に変わる(切替ではない)
    history.replaceState(null, '', '/chat/abc123');
    const user = document.createElement('div');
    user.setAttribute('data-testid', 'user-message');
    user.textContent = 'バリデーションはどうする?';
    document.getElementById('thread')!.appendChild(user);
    const a = document.createElement('div');
    a.setAttribute('data-testid', 'assistant-message');
    a.setAttribute('data-is-streaming', 'true');
    a.textContent = 'Thought process\n方法は';
    document.getElementById('thread')!.appendChild(a);
    await vi.advanceTimersByTimeAsync(600);
    expect(obs.isGenerating()).toBe(true);
    expect(cb.onGenerationStart).toHaveBeenCalledTimes(1);

    a.textContent = 'Thought process\n方法は 2 つあります。どちらで進めますか?';
    a.setAttribute('data-is-streaming', 'false'); // 生成後も false で残る
    await vi.advanceTimersByTimeAsync(600);
    expect(cb.onConversationSwitch).not.toHaveBeenCalled();
    expect(cb.onResponseDone).toHaveBeenCalledTimes(1);
    expect(cb.onResponseDone.mock.calls[0]![0]).not.toContain('Thought process');
    expect(cb.onResponseDone.mock.calls[0]![0]).toContain('どちらで進めますか');
    expect(obs.composerContainer()?.id).toBe('card');
    expect(obs.diagnostics.site).toBe('claude');

    // 別の会話へ移ったら切替
    history.replaceState(null, '', '/chat/zzz999');
    await vi.advanceTimersByTimeAsync(600);
    expect(cb.onConversationSwitch).toHaveBeenCalledTimes(1);
    obs.stop();
  });

  it('入力の始まりと終わり(3 秒止まったら)を 1 回ずつ知らせる', async () => {
    const cb = callbacks();
    const obs = new ChatObserver(CLAUDE, cb);
    obs.start();
    const composer = document.querySelector('[data-testid="chat-input"]')!;
    for (let i = 0; i < 5; i++) {
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(cb.onTypingStart).toHaveBeenCalledTimes(1);
    expect(cb.onTypingEnd).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3600);
    expect(cb.onTypingEnd).toHaveBeenCalledTimes(1);
    obs.stop();
  });
});

describe('ChatObserver(Gemini)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/app');
    document.body.innerHTML = `
      <div id="chat"></div>
      <div class="input-area-container" id="outer">
        <rich-textarea><div class="ql-editor" contenteditable="true" role="textbox"></div></rich-textarea>
        <div class="send-button submit"><button aria-label="Send message">送信</button></div>
      </div>`;
  });
  afterEach(() => vi.useRealTimers());

  it('停止ボタン(日本語の「停止」も)で生成中を見分け、消えたら回答の終わり', async () => {
    const cb = callbacks();
    const obs = new ChatObserver(GEMINI, cb);
    obs.start();
    const editor = document.querySelector('.ql-editor')!;
    editor.textContent = 'Docker で PostgreSQL を起動したい';
    (document.querySelector('.send-button button') as HTMLElement).click();
    editor.textContent = '';
    await vi.advanceTimersByTimeAsync(400);
    expect(cb.onPromptSent).toHaveBeenCalledTimes(1);

    history.replaceState(null, '', '/app/c_12ab');
    const q = document.createElement('user-query');
    q.textContent = 'Docker で PostgreSQL を起動したい';
    document.getElementById('chat')!.appendChild(q);
    const r = document.createElement('model-response');
    r.innerHTML = '<div class="model-response-text">docker run</div>';
    document.getElementById('chat')!.appendChild(r);
    const stop = document.createElement('button');
    stop.setAttribute('aria-label', '回答を停止');
    document.body.appendChild(stop);
    await vi.advanceTimersByTimeAsync(600);
    expect(obs.isGenerating()).toBe(true);

    r.querySelector('.model-response-text')!.textContent = 'docker run -e POSTGRES_PASSWORD=pass postgres で起動できます。';
    stop.remove();
    await vi.advanceTimersByTimeAsync(600);
    expect(cb.onResponseDone).toHaveBeenCalledTimes(1);
    expect(cb.onResponseDone.mock.calls[0]![0]).toContain('POSTGRES_PASSWORD');
    expect(cb.onConversationSwitch).not.toHaveBeenCalled();
    expect(obs.composerContainer()?.id).toBe('outer');
    obs.stop();
  });
});

describe('サイトの判定', () => {
  it('ホスト名からサイトを決め、会話 ID を取る', async () => {
    const { detectSite, SITE_MATCHES } = await import('./sites');
    expect(detectSite('chatgpt.com').id).toBe('chatgpt');
    expect(detectSite('claude.ai').id).toBe('claude');
    expect(detectSite('gemini.google.com').id).toBe('gemini');
    expect(CHATGPT.conversationId('/c/abc')).toBe('abc');
    expect(CHATGPT.conversationId('/')).toBeNull();
    expect(CLAUDE.conversationId('/chat/xyz')).toBe('xyz');
    expect(CLAUDE.conversationId('/new')).toBeNull();
    expect(GEMINI.conversationId('/app/c_1')).toBe('c_1');
    expect(GEMINI.conversationId('/app')).toBeNull();
    expect(SITE_MATCHES).toEqual(['https://chatgpt.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*']);
  });
});
