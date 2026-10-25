export interface Env {
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
  CLASSIFICATION_ENABLED: string;
  INSTALL_DAILY_LIMIT: string;
  GLOBAL_DAILY_LIMIT: string;
  INSTALL_MINUTE_LIMIT: string;
  GLOBAL_MINUTE_LIMIT: string;
  QUOTA_LIMITER: DurableObjectNamespace;
}

export function limitsFrom(env: Env) {
  const positive = (value: string) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 1 || n > 100_000) throw new Error('invalid_limit');
    return n;
  };
  return {
    installDay: positive(env.INSTALL_DAILY_LIMIT), globalDay: positive(env.GLOBAL_DAILY_LIMIT),
    installMinute: positive(env.INSTALL_MINUTE_LIMIT), globalMinute: positive(env.GLOBAL_MINUTE_LIMIT),
  };
}
