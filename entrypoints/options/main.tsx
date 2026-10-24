import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import {
  CLASSIFIER_MODELS,
  clearData,
  loadLog,
  loadSettings,
  saveSettings,
  type Settings,
} from '../../src/shared/settings';
import { DEFAULT_PARAMS } from '../../src/core/types';
import { DEMO } from '../../src/shared/flags';
import { DemoStateButtons } from './DemoStates';
import type { ClassifyResponse } from '../../src/shared/messages';
import './options.css';

function Options() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [test, setTest] = useState('');
  useEffect(() => {
    void loadSettings().then((v) => {
      setS(v);
      setKeyDraft(v.apiKey);
    });
  }, []);
  if (!s) return null;

  const update = async (patch: Partial<Settings>) => {
    setS(await saveSettings(patch));
    setSaved('保存しました');
    window.setTimeout(() => setSaved(''), 1500);
  };

  const exportLog = async () => {
    const log = await loadLog();
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hitoiki-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
  };

  return (
    <main>
      <h1>ひといき — 設定</h1>
      <p className="muted">作業の中身(読む・判断・確認・切替・時間)から負担の目安を計算して、区切りで休憩を提案します。値は仮置きです。</p>
      {saved && <div className="saved">{saved}</div>}

      <section>
        <h2>計測</h2>
        <label className="row">
          <input type="checkbox" checked={s.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          計測する(止めると何も記録しません)
        </label>
        <button
          className="danger"
          onClick={async () => {
            if (confirm('器の状態と記録を消します。よろしいですか?')) {
              await clearData();
              setSaved('記録を消しました(AI チャットのタブを再読み込みしてください)');
            }
          }}
        >
          記録を消す
        </button>
        <button onClick={exportLog}>記録を書き出す(JSON)</button>
      </section>

      <section>
        <h2>休憩の出し方</h2>
        <p className="muted">器が一定量に届いたら、作業の区切りで通知します。「今休む」か「区切りがついたら休む」を選べます。休憩は開始ボタンを押すと始まります。</p>
        <label className="field">
          通知する器の量: {s.threshold}%
          <input type="range" min={50} max={95} step={5} value={s.threshold} onChange={(e) => update({ threshold: Number(e.target.value) })} />
        </label>
        <label className="field">
          休憩の長さ
          <select value={s.breakScale} onChange={(e) => update({ breakScale: Number(e.target.value) })}>
            <option value={0.5}>短め</option>
            <option value={1}>標準(10〜15 分)</option>
            <option value={1.5}>長め</option>
          </select>
        </label>
        {(DEMO || s.g !== DEFAULT_PARAMS.g) && <label className="field">
          たまる速さ: {s.g.toFixed(1)}(標準 3.2 = ふつうの作業で約 50 分)
          <input type="range" min={1.6} max={6.4} step={0.4} value={s.g} onChange={(e) => update({ g: Number(e.target.value) })} />
        </label>}
      </section>

      <section>
        <h2>会話の分類(LLM)</h2>
        <p className="muted">
          判断・確認・切替は、1 往復ごとに会話の本文を Anthropic の API に送って出来事を抜き出します。本文は拡張には保存しません。キーはこのブラウザの中に保存されます(暗号化されません。自分たちだけで使う前提です)。
        </p>
        <label className="row">
          <input type="checkbox" checked={s.llmEnabled} onChange={(e) => update({ llmEnabled: e.target.checked })} />
          LLM で分類する
        </label>
        <label className="field">
          Anthropic API キー
          <input type="password" value={keyDraft} placeholder="sk-ant-..." onChange={(e) => setKeyDraft(e.target.value)} />
        </label>
        <button onClick={() => update({ apiKey: keyDraft.trim() })}>キーを保存</button>
        <button
          onClick={async () => {
            setTest('試しています…');
            const res = (await browser.runtime.sendMessage({ type: 'test_key' })) as ClassifyResponse;
            setTest(
              res.ok
                ? `OK(${res.model}、${res.ms}ms): 判断 ${res.result.decision_requests.length} 件 / 確認 ${res.result.verification_events.length} 件`
                : `失敗: ${res.error}`,
            );
          }}
        >
          キーを試す
        </button>
        {test && <div className="muted">{test}</div>}
        <label className="field">
          モデル
          <select value={s.model} onChange={(e) => update({ model: e.target.value })}>
            {CLASSIFIER_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {(DEMO || s.speed !== 1) && <section>
        <h2>デモ</h2>
        <label className="field">
          時計の速さ
          <select value={s.speed} onChange={(e) => update({ speed: Number(e.target.value) })}>
            <option value={1}>等倍(ふだん)</option>
            <option value={10}>10 倍速</option>
            <option value={30}>30 倍速</option>
            <option value={60}>60 倍速</option>
          </select>
        </label>
        <p className="muted">本物と同じ計算を、時計だけ速めて動かします。画面に「デモ: ○倍速」と出ます。</p>
        <DemoStateButtons />
      </section>}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Options />);
