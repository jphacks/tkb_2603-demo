// デモ用(DEMO = true の時だけ出る): 器を決まった状態から始めるボタン。
// 保存した器を開いている ChatGPT などのタブが取り込む(ほかのタブの保存を取り込む仕組みをそのまま使う)
import { useState } from 'react';
import { DEMO_STATES, type DemoStateId, demoState } from '../../src/shared/demoStates';
import { loadEngine, saveEngine } from '../../src/shared/settings';

async function startFrom(id: DemoStateId): Promise<void> {
  const saved = await loadEngine();
  await saveEngine(demoState(id, saved.state), 'options-demo', saved.lastTickReal ?? Date.now());
}

/** onPrepare: 30 秒のデモ用の設定(DEMO_SETTINGS)を保存する。画面の表示も揃えるため親から受け取る */
export function DemoStateButtons({ onPrepare }: { onPrepare: () => Promise<void> }) {
  const [done, setDone] = useState('');
  return (
    <div className="field">
      30 秒のデモ
      <div className="row">
        <button
          onClick={async () => {
            await onPrepare();
            await startFrom('near');
            setDone('30 倍速・休憩短め・器 75% にしました。AI チャットのタブを再読み込みしてから始めてください。');
          }}
        >
          デモの準備
        </button>
      </div>
      状態から始める
      <div className="row">
        {DEMO_STATES.map((d) => (
          <button
            key={d.id}
            title={d.hint}
            onClick={async () => {
              await startFrom(d.id);
              setDone(`「${d.label}」にしました(${d.hint})。開いているタブに反映されます。`);
            }}
          >
            {d.label}
          </button>
        ))}
      </div>
      {done && <div className="muted">{done}</div>}
    </div>
  );
}
