// デモ用(DEMO = true の時だけ出る): 器を決まった状態から始めるボタン。
// 保存した器を開いている ChatGPT などのタブが取り込む(ほかのタブの保存を取り込む仕組みをそのまま使う)
import { useState } from 'react';
import { DEMO_STATES, demoState } from '../../src/shared/demoStates';
import { loadEngine, saveEngine } from '../../src/shared/settings';

export function DemoStateButtons() {
  const [done, setDone] = useState('');
  return (
    <div className="field">
      状態から始める
      <div className="row">
        {DEMO_STATES.map((d) => (
          <button
            key={d.id}
            title={d.hint}
            onClick={async () => {
              const saved = await loadEngine();
              await saveEngine(demoState(d.id, saved.state), 'options-demo', saved.lastTickReal ?? Date.now());
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
