// AI チャットの画面から手がかりを取る。本文は保存しない(分類のために LLM へ送るときだけ使う)。
// サイトごとの違い(セレクタ・会話 ID)は sites.ts の定義に任せ、ここはどのサイトでも同じ動きにする。
import { lineCount, looksLikeError } from '../core/detect';
import type { SelectorSet, SiteDef, SiteId } from './sites';

type SelectorGroup = keyof SelectorSet;

export interface Diagnostics {
  site: SiteId;
  matched: Partial<Record<SelectorGroup, string | null>>;
  assistantCount: number;
  userCount: number;
  generating: boolean;
  lastResponseChars: number;
  /** 最後の回答の先頭(実機の確認用。保存しない) */
  lastResponseHead: string;
  completionMethod: CompletionMethod | null;
}

/** 回答の終わりをどちらで決めたか: 停止ボタンが消えた / 最後の回答の字数が止まった */
export type CompletionMethod = 'stop_button' | 'quiet';

export interface ObserverCallbacks {
  onPromptSent(text: string): void;
  /** continuation: 終わったと思った回答が、その後も伸びた分 */
  onResponseDone(text: string, userText: string, continuation: boolean, method: CompletionMethod): void;
  onErrorPaste(lines: number): void;
  onConversationSwitch(): void;
  onActivity(): void;
  /** 記録用(本文は渡さない) */
  onGenerationStart?(): void;
  onTypingStart?(): void;
  onTypingEnd?(): void;
}

function textOf(el: Element | null | undefined): string {
  return (el as HTMLElement | null)?.innerText ?? el?.textContent ?? '';
}

/** 最後の回答の字数がこの秒数変わらなければ、生成が終わったとみなす(停止ボタンが見つからない時の代わり) */
const QUIET_MS = 2500;
/** この秒数入力が無ければ「入力中」ではない */
const TYPING_IDLE_MS = 3000;
/** 吹き出しが増えてから、この間に Enter・クリックの送信が記録されなければ、吹き出しから送信を補う */
const BACKFILL_WAIT_MS = 600;
/** 読み込み・会話の切替の直後は、吹き出しが描かれていくだけなので補わない */
const BACKFILL_SETTLE_MS = 5000;

export class ChatObserver {
  diagnostics: Diagnostics;
  lastTypingAt = 0;
  lastResponseDoneAt: number | null = null;

  private lastPath = location.pathname;
  private lastUserText = '';
  private pendingUserText = '';
  private wasGenerating = false;
  /** 最後の回答の字数が最後に変わった時刻と、その時の要素・字数(ページのほかの所の変化は見ない) */
  private textChangedAt = 0;
  private seenEl: Element | null = null;
  private seenLen = 0;
  private lastAssistantLen = 0;
  private lastAssistantEl: Element | null = null;
  private lastUserCount = -1;
  private lastUserEl: Element | null = null;
  private lastSentAt = 0;
  /** 送信した時の最後の回答(前の回答)。字数の静けさで終わりにするのは、これと別の回答の時だけ */
  private sentAssistantEl: Element | null = null;
  private backfillFrom = 0;
  private awaitingResponse = false;
  private typingActive = false;
  private timers: number[] = [];

  constructor(
    readonly site: SiteDef,
    private cb: ObserverCallbacks,
  ) {
    this.diagnostics = {
      site: site.id,
      matched: {},
      assistantCount: 0,
      userCount: 0,
      generating: false,
      lastResponseChars: 0,
      lastResponseHead: '',
      completionMethod: null,
    };
  }

  start(): void {
    this.backfillFrom = Date.now() + BACKFILL_SETTLE_MS;
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('input', this.onInput, true);
    document.addEventListener('paste', this.onPaste, true);
    document.addEventListener('click', this.onClick, true);
    window.addEventListener('scroll', this.onScroll, true);
    this.timers.push(window.setInterval(this.poll, 500));
  }

  stop(): void {
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('input', this.onInput, true);
    document.removeEventListener('paste', this.onPaste, true);
    document.removeEventListener('click', this.onClick, true);
    window.removeEventListener('scroll', this.onScroll, true);
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private firstMatch(group: SelectorGroup): { el: Element | null; sel: string | null } {
    for (const sel of this.site.selectors[group]) {
      const el = document.querySelector(sel);
      if (el) return { el, sel };
    }
    return { el: null, sel: null };
  }

  private allMatch(group: SelectorGroup): Element[] {
    for (const sel of this.site.selectors[group]) {
      const els = Array.from(document.querySelectorAll(sel));
      if (els.length) return els;
    }
    return [];
  }

  composer(): HTMLElement | null {
    return this.firstMatch('composer').el as HTMLElement | null;
  }

  /** 入力欄全体の外枠を、常駐ボタンの配置に使う。本文には触れない。 */
  composerContainer(): HTMLElement | null {
    const outer = this.firstMatch('composerContainer').el as HTMLElement | null;
    if (outer) return outer;
    const composer = this.composer();
    return (composer?.closest('form') as HTMLElement | null) ?? composer;
  }

  composerText(): string {
    const c = this.composer();
    if (!c) return '';
    return c instanceof HTMLTextAreaElement ? c.value : c.innerText.trim();
  }

  isGenerating(): boolean {
    return this.firstMatch('stop').el !== null;
  }

  /** 入力中: 直近 3 秒に入力があった */
  isTyping(): boolean {
    return Date.now() - this.lastTypingAt < TYPING_IDLE_MS;
  }

  private inComposer(target: EventTarget | null): boolean {
    const c = this.composer();
    return !!c && target instanceof Node && (c === target || c.contains(target));
  }

  private assistantText(el: Element | undefined): string {
    const t = textOf(el);
    return this.site.cleanAssistantText ? this.site.cleanAssistantText(t) : t;
  }

  private markSent(): void {
    const text = this.pendingUserText || this.composerText();
    if (!text) return;
    this.lastUserText = text;
    this.pendingUserText = '';
    this.noteSent();
    this.cb.onPromptSent(text);
  }

  private noteSent(): void {
    this.awaitingResponse = true;
    this.lastSentAt = Date.now();
    const assistants = this.allMatch('assistant');
    this.sentAssistantEl = assistants[assistants.length - 1] ?? null;
  }

  /** Enter・クリックで送信が取れなかった時に、増えた吹き出しから送信を補う(文の比較はしない。整形で一致しないため) */
  private backfillSent(bubble: Element): void {
    if (this.awaitingResponse || Date.now() - this.lastSentAt < BACKFILL_WAIT_MS * 2) return;
    this.lastUserText = textOf(bubble);
    this.noteSent();
    this.cb.onPromptSent(this.lastUserText);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.inComposer(e.target)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      this.pendingUserText = this.composerText();
      // 送信はサイト側の処理の後に入力欄が空になる。少し待って確かめる
      window.setTimeout(() => {
        if (this.composerText() === '' && this.pendingUserText) this.markSent();
      }, 300);
    }
  };

  private onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    if (!target) return;
    // 送信と停止が同じボタンのことがある。生成中に押したのは停止
    if (this.isGenerating()) return;
    if (this.site.selectors.send.some((sel) => target.closest(sel))) {
      this.pendingUserText = this.composerText();
      window.setTimeout(() => this.markSent(), 300);
    }
  };

  private onInput = (e: Event) => {
    if (this.inComposer(e.target)) {
      if (!this.typingActive) {
        this.typingActive = true;
        this.cb.onTypingStart?.();
      }
      this.lastTypingAt = Date.now();
      this.cb.onActivity();
    }
  };

  private lastScrollReport = 0;
  private onScroll = () => {
    if (Date.now() - this.lastScrollReport > 10_000) {
      this.lastScrollReport = Date.now();
      this.cb.onActivity();
    }
  };

  private onPaste = (e: ClipboardEvent) => {
    if (!this.inComposer(e.target)) return;
    const text = e.clipboardData?.getData('text/plain') ?? '';
    // 本文は残さず、エラーらしいかと行数だけを見る
    if (looksLikeError(text)) this.cb.onErrorPaste(lineCount(text));
    this.cb.onActivity();
  };

  private poll = () => {
    // 入力の終わり(3 秒入力が無い)
    if (this.typingActive && !this.isTyping()) {
      this.typingActive = false;
      this.cb.onTypingEnd?.();
    }

    // 会話の切替: 会話 ID が別の ID に変わった。新しい会話に ID が付いた時(null → ID)は切替ではなく、
    // 1 通目の回答を待っているので取り逃さないよう状態を残す
    if (location.pathname !== this.lastPath) {
      const prevId = this.site.conversationId(this.lastPath);
      const nextId = this.site.conversationId(location.pathname);
      this.lastPath = location.pathname;
      if (prevId !== null && prevId !== nextId) {
        this.lastAssistantLen = 0;
        this.lastAssistantEl = null;
        this.lastUserCount = -1;
        this.awaitingResponse = false;
        this.backfillFrom = Date.now() + BACKFILL_SETTLE_MS;
        this.cb.onConversationSwitch();
      } else if (prevId === null) {
        this.lastUserCount = -1;
      }
    }

    const assistants = this.allMatch('assistant');
    const users = this.allMatch('user');
    const generating = this.isGenerating();
    this.diagnostics.assistantCount = assistants.length;
    this.diagnostics.userCount = users.length;
    this.diagnostics.generating = generating;
    for (const g of Object.keys(this.site.selectors) as SelectorGroup[]) {
      this.diagnostics.matched[g] = this.firstMatch(g).sel;
    }

    const last = assistants[assistants.length - 1];
    const lastText = this.assistantText(last);
    if (last !== this.seenEl || lastText.length !== this.seenLen) {
      this.seenEl = last ?? null;
      this.seenLen = lastText.length;
      this.textChangedAt = Date.now();
    }
    const textQuiet = Date.now() - this.textChangedAt > QUIET_MS;

    // 送信を取り逃しても、ユーザーの吹き出しが最後に 1 つ増えたら、少し待って送信とみなす(生成中が取れない画面でも)。
    // 上へのスクロールで古い会話が読み込まれた時は最後の吹き出しが変わらず、会話を開いた時はまとめて増えるので数えない
    const newestUser = users[users.length - 1] ?? null;
    if (this.lastUserCount < 0) {
      this.lastUserCount = users.length;
      this.lastUserEl = newestUser;
    }
    if (users.length !== this.lastUserCount) {
      if (users.length === this.lastUserCount + 1 && newestUser !== this.lastUserEl && Date.now() >= this.backfillFrom) {
        const bubble = newestUser!;
        window.setTimeout(() => this.backfillSent(bubble), BACKFILL_WAIT_MS);
      }
      this.lastUserCount = users.length;
      this.lastUserEl = newestUser;
    }

    if (!this.wasGenerating && generating) this.cb.onGenerationStart?.();

    // 生成の終わり: 停止ボタンが消えた、または停止ボタンが無い画面で最後の回答の字数が止まった
    let done = false;
    if (this.wasGenerating && !generating) {
      done = true;
      this.diagnostics.completionMethod = 'stop_button';
    } else if (
      this.awaitingResponse &&
      !generating &&
      // 送信した直後の最後の回答は前の回答で、字数がずっと変わっていないので数えない
      last !== this.sentAssistantEl &&
      lastText.length > 0 &&
      lastText.length !== this.lastAssistantLen &&
      textQuiet
    ) {
      done = true;
      this.diagnostics.completionMethod = 'quiet';
    }
    this.wasGenerating = generating;

    if (done && lastText.length > 0) {
      const continuation = last === this.lastAssistantEl && lastText.length > this.lastAssistantLen && this.lastAssistantLen > 0;
      const text = continuation ? lastText.slice(this.lastAssistantLen) : lastText;
      this.awaitingResponse = false;
      this.lastAssistantEl = last ?? null;
      this.lastAssistantLen = lastText.length;
      this.lastResponseDoneAt = Date.now();
      this.diagnostics.lastResponseChars = lastText.length;
      this.diagnostics.lastResponseHead = lastText.slice(0, 24);
      this.cb.onResponseDone(text, this.lastUserText, continuation, this.diagnostics.completionMethod!);
    } else if (
      // 静かになって終わりとみなした後も、同じ回答が伸びたら差分を足す(考える系のモデルは途中で長く止まる)
      !generating &&
      last === this.lastAssistantEl &&
      lastText.length > this.lastAssistantLen &&
      textQuiet
    ) {
      const delta = lastText.slice(this.lastAssistantLen);
      this.lastAssistantLen = lastText.length;
      this.lastResponseDoneAt = Date.now();
      this.diagnostics.lastResponseChars = lastText.length;
      this.cb.onResponseDone(delta, this.lastUserText, true, 'quiet');
    }
  };
}
