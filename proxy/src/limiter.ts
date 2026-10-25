import { DurableObject } from 'cloudflare:workers';
import { limitsFrom, type Env } from './config';
import { initializeQuota, reserveQuota } from './quota';

export class QuotaLimiter extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    initializeQuota(ctx.storage.sql);
  }

  async fetch(request: Request): Promise<Response> {
    const { id } = await request.json() as { id: string };
    const result = this.ctx.storage.transactionSync(() => reserveQuota(this.ctx.storage.sql, id, Date.now(), limitsFrom(this.env)));
    return Response.json(result);
  }
}
