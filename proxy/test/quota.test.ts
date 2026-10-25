import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { initializeQuota, reserveQuota, type Limits, type Sql } from '../src/quota';

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function database() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  const sql: Sql = { exec(query, ...bindings) {
    const stmt = db.prepare(query);
    return query.startsWith('SELECT') ? stmt.all(...bindings) : (stmt.run(...bindings), []);
  } };
  initializeQuota(sql);
  const reserve = (id: string, now: number, limits: Limits) => {
    db.exec('BEGIN');
    try { const out = reserveQuota(sql, id, now, limits); db.exec('COMMIT'); return out; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  return { sql, reserve };
}
const limits = { installDay: 2, globalDay: 3, installMinute: 10, globalMinute: 20 };
it('端末ごとの枠と全体の枠を同時に予約し、拒否では枠を消費しない', () => {
  const { reserve } = database();
  expect(reserve('a', 0, limits).allowed).toBe(true);
  expect(reserve('a', 0, limits).allowed).toBe(true);
  expect(reserve('a', 0, limits)).toEqual({ allowed: false, retryAfter: 86400 });
  expect(reserve('b', 0, limits).allowed).toBe(true);
  expect(reserve('c', 0, limits).allowed).toBe(false);
});
it('分とUTC日の境界で復帰し、期限の切れた匿名IDを削除する', () => {
  const { sql, reserve } = database(); const caps = { ...limits, installMinute: 1 };
  expect(reserve('a', 1000, caps).allowed).toBe(true);
  expect(reserve('a', 1000, caps).retryAfter).toBe(59);
  expect(reserve('a', 60000, caps).allowed).toBe(true);
  expect(reserve('a', 120000, caps).allowed).toBe(false);
  expect(reserve('b', 86400000, caps).allowed).toBe(true);
  expect([...sql.exec("SELECT key FROM counters WHERE key LIKE 'install:a:%'")]).toHaveLength(0);
});
it('並行に予約しても全体枠を超えず、IDを作り直しても全体枠は共有する', async () => {
  const { reserve } = database(); const caps = { ...limits, installDay: 10, globalDay: 5 };
  const results = await Promise.all(Array.from({ length: 30 }, (_, i) => Promise.resolve().then(() => reserve(String(i), 0, caps))));
  expect(results.filter((r) => r.allowed)).toHaveLength(5);
});
