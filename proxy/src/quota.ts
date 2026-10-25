export interface Sql {
  exec(query: string, ...bindings: (string | number)[]): Iterable<Record<string, unknown>>;
}
export interface Limits { installDay: number; globalDay: number; installMinute: number; globalMinute: number }

export function initializeQuota(sql: Sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS counters_expiry ON counters (expires)');
}

/** 呼び出し側がtransactionSyncで囲み、全体と端末の枠を同時に予約する。失敗したAPI呼び出しも消費する。 */
export function reserveQuota(sql: Sql, id: string, now: number, limits: Limits) {
  sql.exec('DELETE FROM counters WHERE expires <= ?', now);
  const dayEnd = (Math.floor(now / 86_400_000) + 1) * 86_400_000;
  const minuteEnd = (Math.floor(now / 60_000) + 1) * 60_000;
  const buckets = [
    { key: 'global:day', limit: limits.globalDay, end: dayEnd },
    { key: 'global:minute', limit: limits.globalMinute, end: minuteEnd },
    { key: `install:${id}:day`, limit: limits.installDay, end: dayEnd },
    { key: `install:${id}:minute`, limit: limits.installMinute, end: minuteEnd },
  ];
  let retryAfter = 0;
  for (const bucket of buckets) {
    const row = [...sql.exec('SELECT count FROM counters WHERE key = ?', bucket.key)][0];
    if (Number(row?.count ?? 0) >= bucket.limit) retryAfter = Math.max(retryAfter, Math.ceil((bucket.end - now) / 1000));
  }
  if (retryAfter) return { allowed: false, retryAfter };
  for (const bucket of buckets) {
    sql.exec('INSERT INTO counters (key, count, expires) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1', bucket.key, bucket.end);
  }
  return { allowed: true, retryAfter: 0 };
}
