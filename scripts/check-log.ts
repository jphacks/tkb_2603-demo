// 実機の確認(issue #16 の 3・4)を、設定画面の「記録を書き出す(JSON)」で確かめる。本文は記録に無いので、件数と時刻だけを出す。
// 使い方: node scripts/check-log.ts <file.json> [同意を取り消していた間] [計測を止めていた間] [表を数える間]
//   間は "2026-10-25 11:05:40〜11:12:10" の形(手元の時刻。秒まで書ける。終わりの日付は省ける)。
//   時刻 1 つだけなら、その時刻から記録の最後まで。使わない所は "" にする
import { readFileSync } from 'node:fs';
import type { StoredLogEntry } from '../src/shared/settings.ts';
import { parseLog } from './analyze-log.ts';

export interface SiteFlow {
  sent: number;
  /** 続き(continuation)を除いた回答の数。送信と同じになるのが正しい */
  responses: number;
  continuations: number;
  /** 停止ボタンが見えた回数。送信より少なければ、生成中のセレクタが当たっていない回がある */
  generationStarts: number;
  /** 回答の終わりをどちらで決めたか(続きも含む)。不明は end を記録する前の版 */
  endStopButton: number;
  endQuiet: number;
  endUnknown: number;
  classifyOk: number;
  classifyFailed: number;
}

export function siteFlow(log: StoredLogEntry[]): Record<string, SiteFlow> {
  const out: Record<string, SiteFlow> = {};
  for (const e of log) {
    const r = (out[e.site ?? '不明'] ??= {
      sent: 0, responses: 0, continuations: 0, generationStarts: 0, endStopButton: 0, endQuiet: 0, endUnknown: 0, classifyOk: 0, classifyFailed: 0,
    });
    if (e.type === 'classify') e.ok ? r.classifyOk++ : r.classifyFailed++;
    if (e.type !== 'observation') continue;
    if (e.kind === 'prompt_sent') r.sent++;
    else if (e.kind === 'generation_start') r.generationStarts++;
    else if (e.kind === 'response_done') {
      e.detail?.continuation ? r.continuations++ : r.responses++;
      const end = e.detail?.end;
      end === 'stop_button' ? r.endStopButton++ : end === 'quiet' ? r.endQuiet++ : r.endUnknown++;
    }
  }
  return out;
}

/** 始め〜終わり(ms)。終わりが無ければ記録の最後まで */
export interface TimeRange {
  from: number;
  to: number;
}

export function entriesIn(log: StoredLogEntry[], range: TimeRange, type?: StoredLogEntry['type']): StoredLogEntry[] {
  return log.filter((e) => e.at >= range.from && e.at <= range.to && (!type || e.type === type));
}

/** "2026-10-25 11:05:40" を手元の時刻として読む(秒は省ける。省くとその分の 0 秒)。読めなければ null */
export function parseLocalTime(s: string | undefined): number | null {
  if (!s) return null;
  const t = new Date(s.trim().replace(' ', 'T')).getTime();
  return Number.isFinite(t) ? t : null;
}

/** "2026-10-25 11:05:40〜11:12:10" を読む。〜 の後ろに日付が無ければ前の日付を使う。時刻 1 つなら記録の最後まで */
export function parseRange(s: string | undefined): TimeRange | null {
  if (!s?.trim()) return null;
  const [a, b] = s.split(/[〜~]/).map((x) => x.trim());
  const from = parseLocalTime(a);
  if (from === null) return null;
  if (!b) return { from, to: Infinity };
  const date = a!.split(' ')[0];
  const to = parseLocalTime(b.includes(' ') ? b : `${date} ${b}`);
  return to === null ? null : { from, to };
}

const fmt = (ms: number) => new Date(ms).toLocaleString('ja-JP', { hour12: false });
const fmtRange = (r: TimeRange) => (r.to === Infinity ? `${fmt(r.from)} から記録の最後まで` : `${fmt(r.from)} 〜 ${fmt(r.to)}`);

export function checkReport(log: StoredLogEntry[], revoked: TimeRange | null, stopped: TimeRange | null, table: TimeRange | null = null): string {
  const lines: string[] = [];
  const times = log.map((e) => e.at);
  lines.push(`記録 ${log.length} 件${times.length ? `: ${fmt(Math.min(...times))} 〜 ${fmt(Math.max(...times))}` : ''}`, '');
  lines.push(
    `## サイト別の取れ方(4${table ? `、${fmtRange(table)}` : ''})`,
    '',
    '| サイト | 送信 | 回答(続きを除く) | 続き | 生成の始まり | 終わりの決め方(停止ボタン / 字数 / 不明) | 分類の成功 / 失敗 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const [site, r] of Object.entries(siteFlow(table ? entriesIn(log, table) : log))) {
    lines.push(
      `| ${site} | ${r.sent} | ${r.responses} | ${r.continuations} | ${r.generationStarts} | ${r.endStopButton} / ${r.endQuiet} / ${r.endUnknown} | ${r.classifyOk} / ${r.classifyFailed} |`,
    );
  }
  lines.push(
    '',
    '送信と回答が同じなら取りこぼし無し。生成の始まりが送信より少ないサイトは、停止ボタンが取れていない回がある。',
    '終わりの決め方の「字数」は、停止ボタンが取れず、最後の回答の字数が 2.5 秒止まったことで終わりとした回。「不明」は、それを記録する前の版の記録。',
  );
  if (revoked) {
    const inRange = entriesIn(log, revoked, 'classify');
    const responses = entriesIn(log, revoked).filter((e) => e.type === 'observation' && e.kind === 'response_done').length;
    lines.push('', `## 同意を取り消していた間(${fmtRange(revoked)}、3)`, '', `classify ${inRange.length} 件(0 なら OK)、回答 ${responses} 件(器はたまり続ける)`);
    for (const e of inRange) lines.push(`- ${fmt(e.at)} ${e.site ?? '不明'}`);
  }
  if (stopped) {
    const inRange = entriesIn(log, stopped);
    lines.push('', `## 計測を止めていた間(${fmtRange(stopped)}、3)`, '', `${inRange.length} 件(0 件なら OK)`);
    for (const e of inRange) lines.push(`- ${fmt(e.at)} ${e.site ?? '不明'} ${e.type}${e.type === 'observation' ? ` ${e.kind}` : ''}`);
  }
  return lines.join('\n');
}

if (import.meta.main) {
  const [file, revoked, stopped, table] = process.argv.slice(2);
  if (!file) {
    console.error('使い方: node scripts/check-log.ts <file.json> [同意を取り消していた間] [計測を止めていた間] [表を数える間]');
    console.error('  間の例: "2026-10-25 11:05:40〜11:12:10"(時刻 1 つなら、その時刻から記録の最後まで)');
    process.exit(1);
  }
  for (const [name, s] of [['同意を取り消していた間', revoked], ['計測を止めていた間', stopped], ['表を数える間', table]] as const) {
    if (s?.trim() && !parseRange(s)) {
      console.error(`${name}が読めません: "${s}"(例: "2026-10-25 11:05:40〜11:12:10")`);
      process.exit(1);
    }
  }
  console.log(checkReport(parseLog(readFileSync(file, 'utf8')), parseRange(revoked), parseRange(stopped), parseRange(table)));
}
