// AI チャット(ChatGPT・Claude・Gemini)に重ねる4状態のUI。計算・保存・休憩の操作は Runner に任せる。
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { breakMinutes, contributionShares } from '../core/model';
import { ELEMENT_KEYS, ELEMENT_LABELS } from '../core/types';
import type { Runner, UiSnapshot } from '../content/runner';
import { DEMO } from '../shared/flags';
import { endCopy, promptCopy, SNOOZE_COPY, STRETCHES } from './copy';
import { Pictogram } from './Pictogram';
import { Icon } from './Icon';
import { loadFillPercent, loadLevel, loadPercent } from './presentation';
import { useDockPosition } from './useDockPosition';
import { useTodayTimerSummary } from './useTodayTimerSummary';

const HIGH_UF = 30;

export function App({ runner }: { runner: Runner }) {
  const [snap, setSnap] = useState<UiSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [monitorCollapsed, setMonitorCollapsed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const theme = usePageTheme();
  const pill = useRef<HTMLButtonElement>(null);
  useEffect(() => runner.subscribe(setSnap), [runner]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const enabled = !!snap?.settings.enabled;
  const onBreak = !!snap?.state.breakState;
  const panelOpen = enabled && open && !onBreak;
  // 広い画面では会話の領域を確保。閉じる・無効化・アンマウント時に解除。
  useEffect(() => {
    if (!panelOpen) return;
    const style = document.createElement('style');
    style.textContent = '@media (min-width: 900px) { html body { width: calc(100% - 384px) !important; } }';
    document.head.append(style);
    return () => style.remove();
  }, [panelOpen]);

  if (!snap || !enabled) return null;
  const closePanel = () => {
    setOpen(false);
    window.requestAnimationFrame(() => pill.current?.focus());
  };
  const respond = (action: 'now' | 'next_breakpoint' | 'decline') => {
    runner.respondToPrompt(action);
    if (action !== 'now') setToast(SNOOZE_COPY[action]);
  };
  return (
    <div className="hi-root" data-theme={theme} data-load-level={loadLevel(snap.load)}>
      {snap.settings.speed > 1 && <div className="hi-demo">デモ · {snap.settings.speed}倍速</div>}
      {snap.prompt && !onBreak && !panelOpen && <PromptCard snap={snap} onAction={respond} />}
      {onBreak && <BreakOverlay snap={snap} runner={runner} />}
      {snap.finishedBreak && !onBreak && !panelOpen && <Welcome snap={snap} runner={runner} />}
      {panelOpen && <Detail snap={snap} runner={runner} onClose={closePanel} />}
      {toast && <div className="hi-toast" role="status">{toast}</div>}
      {!onBreak && !panelOpen && (
        <Dock snap={snap} runner={runner} pill={pill} onOpen={() => setOpen(true)} collapsed={monitorCollapsed}
          onToggleCollapse={() => {
            setMonitorCollapsed((value) => !value);
            window.requestAnimationFrame(() => pill.current?.focus());
          }} />
      )}
    </div>
  );
}

function Dock({ snap, runner, pill, onOpen, collapsed, onToggleCollapse }: {
  snap: UiSnapshot; runner: Runner; pill: RefObject<HTMLButtonElement | null>; onOpen: () => void;
  collapsed: boolean; onToggleCollapse: () => void;
}) {
  const { ref, bottom } = useDockPosition(() => runner.composerContainer?.() ?? null);
  const minutes = breakMinutes(snap.load, snap.settings.breakScale);
  const canCollapse = loadPercent(snap.load) < 80;
  const compact = canCollapse && collapsed;
  return <div ref={ref} className="hi-dock" style={{ bottom }}>
    {snap.state.prompt.waitingForUser && <button className="hi-ready" onClick={() => runner.startDeferredBreak()}
      title={`${minutes}分の休憩を始める`}
      aria-label={`区切りがついたら、${minutes}分休む`}>
      <Icon name="leaf" /><span className="hi-ready-copy"><small>区切りがついたら</small><strong>{minutes}分休む</strong></span>
    </button>}
    <div className={`hi-measure${compact ? ' hi-measure-collapsed' : ''}`}>
      <button ref={pill} className="hi-pill" onClick={compact ? onToggleCollapse : onOpen}
        title={compact ? `計測中 ${loadPercent(snap.load)}% · クリックで広げる` : '作業モニターを開く'}
        aria-label={compact ? '計測表示を広げる' : '作業モニターを開く'} aria-expanded={false}>
        {compact ? <Icon name="leaf" /> : <><LoadRing value={snap.load} /><span>計測中</span><strong className="hi-pill-percent">{loadPercent(snap.load)}%</strong><Icon name="chevron" /></>}
      </button>
      {canCollapse && !compact && <button className="hi-collapse-btn" onClick={onToggleCollapse}
        title="計測表示を折りたたむ" aria-label="計測表示を折りたたむ"><Icon name="minimize" /></button>}
    </div>
  </div>;
}

/** ページの明示的なテーマを優先。指定がなければOS設定に従う。
 *  ChatGPT は class/data-theme、Claude は data-mode、Gemini は dark-theme のクラスを見る(Claude・Gemini は未確認の候補) */
function usePageTheme(): 'light' | 'dark' {
  const read = () => {
    for (const element of [document.documentElement, document.body]) {
      if (element?.classList.contains('dark') || element?.classList.contains('dark-theme') || element?.getAttribute('data-theme') === 'dark' || element?.getAttribute('data-mode') === 'dark') return 'dark';
      if (element?.classList.contains('light') || element?.classList.contains('light-theme') || element?.getAttribute('data-theme') === 'light' || element?.getAttribute('data-mode') === 'light') return 'light';
      if (element?.style.colorScheme === 'dark') return 'dark';
      if (element?.style.colorScheme === 'light') return 'light';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const [theme, setTheme] = useState<'light' | 'dark'>(read);
  useEffect(() => {
    const update = () => setTheme(read());
    const observer = new MutationObserver(update);
    for (const element of [document.documentElement, document.body]) {
      if (element) observer.observe(element, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-mode', 'style'] });
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update);
    return () => { observer.disconnect(); media.removeEventListener('change', update); };
  }, []);
  return theme;
}

function LoadRing({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 8;
  return <svg className="hi-load-ring" width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
    <circle cx="11" cy="11" r="8" fill="none" stroke="var(--hi-track)" strokeWidth="3" />
    <circle cx="11" cy="11" r="8" fill="none" stroke="var(--hi-load-color)" strokeWidth="3" strokeDasharray={`${circumference * loadFillPercent(value) / 100} ${circumference}`} transform="rotate(-90 11 11)" strokeLinecap="round" />
  </svg>;
}

function PromptCard({ snap, onAction }: { snap: UiSnapshot; onAction: (action: 'now' | 'next_breakpoint') => void }) {
  const copy = promptCopy(snap.prompt!.top, snap.state.uf >= HIGH_UF);
  return (
    <section className="hi-card hi-prompt" role="status" aria-label="休憩の提案">
      <div className="hi-head">
        <div className="hi-heading"><Icon name="clock" /><h2>{copy.title}</h2></div>
        <button className="hi-icon-btn" onClick={() => onAction('next_breakpoint')} aria-label="休憩の提案を閉じて開始ボタンを残す"><Icon name="close" /></button>
      </div>
      <p className="hi-prompt-body">{copy.body}</p>
      <div className="hi-prompt-actions">
        <button className="hi-btn hi-primary" onClick={() => onAction('now')}>今{breakMinutes(snap.load, snap.settings.breakScale)}分休む</button>
        <button className="hi-btn" onClick={() => onAction('next_breakpoint')}>区切りがついたら休む</button>
      </div>
    </section>
  );
}

function Detail({ snap, runner, onClose }: { snap: UiSnapshot; runner: Runner; onClose: () => void }) {
  const timer = useTodayTimerSummary();
  const shares = contributionShares(snap.state);
  const ufFill = Math.min(100, Math.max(0, snap.state.uf));
  const rfFill = Math.min(100 - ufFill, Math.max(0, snap.state.rf));
  const percent = loadPercent(snap.load);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { close.current?.focus({ preventScroll: true }); }, []);
  return (
    <aside className="hi-detail" role="dialog" aria-label="作業モニター" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
    }}>
      <header className="hi-head">
        <div className="hi-heading"><Icon name="leaf" /><h1>作業モニター</h1></div>
        <div className="hi-head-actions">
          <button className="hi-icon-btn" onClick={() => runner.openOptions()} aria-label="設定を開く"><Icon name="settings" /></button>
          <button ref={close} className="hi-icon-btn" onClick={onClose} aria-label="作業モニターを閉じる"><Icon name="close" /></button>
        </div>
      </header>
      <div className="hi-detail-content">
        <span className="hi-status">計測中</span>
        <h2 className="hi-detail-title">作業の負担の目安</h2>
        <section className="hi-load-summary" aria-label="全体の器">
          <div className="hi-load-heading"><span>全体の器</span><strong>{loadPercent(snap.load)}<small>%</small></strong></div>
          <div className="hi-load-bar" role="meter" aria-label="全体の器" aria-valuenow={loadFillPercent(snap.load)} aria-valuetext={`${percent}%${percent > 100 ? '、100%を超えています' : ''}`} aria-valuemin={0} aria-valuemax={100}>
            <div className="hi-load-uf" style={{ width: `${ufFill}%` }} />
            <div className="hi-load-rf" style={{ width: `${rfFill}%` }} />
            <span className="hi-load-threshold" style={{ left: `${snap.settings.threshold}%` }} />
          </div>
          <div className="hi-load-caption"><span>うち今日残る分 {loadPercent(snap.state.uf)}%</span><span>休憩の目安 {snap.settings.threshold}%</span></div>
          {percent > 100 ? <p className="hi-load-message hi-load-overflow"><strong>100%を超えています！ 現在{percent}%</strong><span>区切りで休憩しましょう。</span></p>
            : percent >= 90 && <p className="hi-load-message">{percent >= 100 ? '器がいっぱいです。区切りで休憩しましょう。' : '器がたまってきました。休憩を意識しましょう。'}</p>}
        </section>
        <h3 className="hi-breakdown-title">休憩してから、何がためたか</h3>
        <p className="hi-breakdown-hint">各項目は、負担をためた要因の割合です。</p>
        <div className="hi-meters">
          {ELEMENT_KEYS.map((key) => {
            const unmeasured = key === 'decision' && !snap.state.llmAvailable;
            const percent = Math.round((shares?.[key] ?? 0) * 100);
            return <div className="hi-meter" key={key}>
              <span className="hi-meter-label">{ELEMENT_LABELS[key]}</span>
              <div className="hi-bar" role="meter" aria-label={ELEMENT_LABELS[key]} aria-valuenow={unmeasured ? undefined : percent} aria-valuetext={unmeasured ? '未計測' : `${percent}%`} aria-valuemin={0} aria-valuemax={100}>
                <div className="hi-bar-fill" style={{ width: `${unmeasured ? 0 : percent}%` }} />
              </div>
              <span className="hi-meter-percent">{unmeasured ? '未計測' : `${percent}%`}</span>
            </div>;
          })}
        </div>
        <details className="hi-history">
          <summary>推移を見る<span className="hi-muted">直近30分</span><Icon name="chevron" /></summary>
          <p className="hi-history-hint">全体の器が、時間とともにどう変わったかを表示します。</p>
          <Sparkline history={snap.state.history} minute={snap.state.minute} />
          <div className="hi-chart-labels"><span>30分前</span><span>いま</span></div>
        </details>
        {timer && <p className="hi-muted hi-timer-compare">30 分ごとのタイマーだったら、今日 {timer.ticks} 回のうち {timer.interrupted} 回は入力中か AI の生成中に鳴っていました。ひといきは {timer.prompts} 回、区切りで提案しました。</p>}
        {DEMO && <details className="hi-diagnostics">
          <summary>診断</summary>
          {!snap.state.llmAvailable && <p className="hi-muted">判断は未計測です。確認・切替は画面から取れる手がかりで計測しています。</p>}
          <Diagnostics snap={snap} />
        </details>}
      </div>
      <footer className="hi-detail-footer">
        <p className="hi-note">ログから観測した作業要求の参考表示です。</p>
        <button className="hi-btn hi-primary hi-full" onClick={() => { snap.state.prompt.waitingForUser ? runner.startDeferredBreak() : runner.startManualBreak(''); onClose(); }}>{snap.state.prompt.waitingForUser ? `${breakMinutes(snap.load, snap.settings.breakScale)}分休む` : '休憩する'}</button>
        <p className="hi-footer-hint">疲れの感じ方は、自分の感覚も大切に。</p>
      </footer>
    </aside>
  );
}

function Diagnostics({ snap }: { snap: UiSnapshot }) {
  const d = snap.diagnostics;
  return (
    <div className="hi-diag">
      <div>サイト: {d.site}</div>
      <div>回答 {d.assistantCount} / 送信 {d.userCount} / 生成中 {d.generating ? 'はい' : 'いいえ'}</div>
      <div>最後の回答: {d.lastResponseChars} 文字「{d.lastResponseHead}…」</div>
      <div>終わりの検出: {d.completionMethod ?? 'まだ'}</div>
      <div>読む残り: {snap.state.readBacklogMin.toFixed(1)} 分 / 計算上の時刻: {snap.state.minute} 分</div>
      {Object.entries(d.matched).map(([group, selector]) => <div key={group}>{group}: <code>{selector ?? '見つからない'}</code></div>)}
      <div>分類: {snap.lastClassify ? snap.lastClassify.ok ? `OK（${snap.lastClassify.model}、${snap.lastClassify.ms}ms）` : `失敗（${snap.lastClassify.error}）` : snap.settings.hasApiKey ? 'まだ' : 'API キー未設定'}</div>
    </div>
  );
}

function Sparkline({ history, minute }: { history: { t: number; load: number }[]; minute: number }) {
  const max = Math.max(100, Math.ceil(Math.max(0, ...history.map((point) => point.load)) / 50) * 50);
  const x = (t: number) => 44 + ((t - (minute - 30)) / 30) * 276;
  const y = (value: number) => 120 - (value / max) * 104;
  const points = history.map((point) => `${x(point.t)},${y(point.load)}`).join(' ');
  return (
    <div className="hi-chart">
      <svg viewBox="0 0 336 136" width="336" height="136" className="hi-spark" role="img" aria-label={`直近30分の負担の推移（0から${max}%）`}>
        {[0, max / 2, max].map((value) => <g key={value}><line x1="42" x2="324" y1={y(value)} y2={y(value)} className="hi-spark-grid" /><text x="36" y={y(value) + 3} textAnchor="end" className="hi-spark-label">{value}%</text></g>)}
        {history.length > 1 && <polyline points={points} className="hi-spark-line" />}
        {history.length === 1 && <circle cx={x(history[0]!.t)} cy={y(history[0]!.load)} r="3" className="hi-spark-dot" />}
      </svg>
      {!history.length && <span className="hi-chart-empty">作業の記録がここに表示されます</span>}
    </div>
  );
}

function trapFocus(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, summary, [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && (event.target === first || event.target === event.currentTarget)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
}

function useModalFocus(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = ref.current?.getRootNode() as Document | ShadowRoot;
    const previous = root?.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [ref]);
}

function BreakOverlay({ snap, runner }: { snap: UiSnapshot; runner: Runner }) {
  const b = snap.state.breakState!;
  const stretch = b.stretch ?? 'reach';
  const [now, setNow] = useState(Date.now());
  const modal = useRef<HTMLDivElement>(null);
  useModalFocus(modal);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const elapsedSeconds = (snap.clock.minute - b.startedAt) * 60 + (Math.max(0, now - snap.clock.sampledAt) / 1000) * snap.settings.speed;
  const remaining = Math.max(0, Math.ceil(b.plannedMin * 60 - elapsedSeconds));
  const progress = Math.min(1, Math.max(0, elapsedSeconds / (b.plannedMin * 60)));
  const time = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  const line = STRETCHES.find((item) => item.id === stretch)?.line ?? '';
  const circumference = 2 * Math.PI * 106;
  return (
    <div className="hi-overlay">
      <div ref={modal} className="hi-card hi-break" role="dialog" aria-modal="true" aria-label="休憩中" tabIndex={-1}
        onKeyDown={(event) => {
          trapFocus(event);
          if (event.key === 'Escape') { event.stopPropagation(); snap.confirmEndBreak ? runner.cancelEndBreak() : runner.askEndBreak(); }
        }}>
        <header className="hi-head hi-break-head">
          <div className="hi-heading"><Icon name="leaf" /><h2>休憩中</h2></div>
          <button className="hi-icon-btn" onClick={() => runner.askEndBreak()} aria-label="休憩を終える"><Icon name="close" /></button>
        </header>
        <div className="hi-timer">
          <svg className="hi-timer-ring" width="232" height="232" viewBox="0 0 232 232" aria-hidden="true">
            <circle cx="116" cy="116" r="106" fill="none" stroke="var(--hi-ring-track)" strokeWidth="10" />
            <circle cx="116" cy="116" r="106" fill="none" stroke="var(--hi-ring)" strokeWidth="10" strokeDasharray={`${circumference * (1 - progress)} ${circumference}`} transform="rotate(-90 116 116)" strokeLinecap="round" />
          </svg>
          <div className="hi-timer-inner"><Pictogram kind={stretch} /><span className="hi-timer-text" role="timer" aria-label={`休憩の残り時間 ${time}`}>{time}</span></div>
        </div>
        <div className="hi-stretch-name">{STRETCHES.find((item) => item.id === stretch)?.name}</div>
        <p className="hi-stretch-line">{line}</p>
        <p className="hi-muted hi-stretch-hint">そのまま休んでもOK。無理のない範囲で。</p>
        <details className="hi-memo-disclosure">
          <summary>復帰メモ<Icon name="chevron" /></summary>
          <label className="hi-memo-field">戻ったらやること<input className="hi-input" placeholder="例：テスト結果を確認する" value={b.memo} maxLength={80} onChange={(event) => runner.setMemo(event.target.value)} /></label>
        </details>
        <button className="hi-btn hi-full hi-end-break" onClick={() => runner.askEndBreak()}>休憩を終える</button>
        {snap.confirmEndBreak && <div className="hi-confirm" role="group" aria-label="休憩終了の確認"><p>休憩を終えますか？</p><div className="hi-actions"><button className="hi-btn hi-primary" onClick={() => runner.endBreakEarly()}>終える</button><button className="hi-btn" onClick={() => runner.cancelEndBreak()}>続ける</button></div></div>}
      </div>
    </div>
  );
}

function Welcome({ snap, runner }: { snap: UiSnapshot; runner: Runner }) {
  const finished = snap.finishedBreak!;
  const line = endCopy({ top: finished.top, plannedMin: finished.plannedMin, highUf: snap.state.uf >= HIGH_UF });
  return (
    <section className="hi-card hi-welcome" aria-label="おかえり">
      <div className="hi-head"><div className="hi-heading"><Icon name="leaf" /><h2>おかえりなさい</h2></div><button className="hi-icon-btn" onClick={() => runner.dismissFinished()} aria-label="復帰メッセージを閉じる"><Icon name="close" /></button></div>
      {finished.memo && <div className="hi-memo"><span className="hi-muted">戻ったらやること</span><p>{finished.memo}</p></div>}
      <p className="hi-welcome-line">{line}</p><p className="hi-muted">この休憩はどうでしたか？</p>
      <div className="hi-actions"><button className="hi-btn" onClick={() => runner.sendFeedback('good')}>よかった</button><button className="hi-btn" onClick={() => runner.sendFeedback('ok')}>ふつう</button><button className="hi-btn" onClick={() => runner.sendFeedback('unneeded')}>不要だった</button></div>
    </section>
  );
}
