// ローカルHTTP検証専用。Anthropicへは接続しない。productionのmainからは参照しない。
import { handleRequest } from '../src/handler';
import type { Env } from '../src/config';
export { QuotaLimiter } from '../src/limiter';
export default {
  fetch(request: Request, env: Env) {
    const mock: typeof fetch = async (input, init) => {
      // Nodeのモックだけでは分からない、Workers固有のRequestオプションも検証する。
      new Request(input, init);
      return Response.json({
      stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: 'text', text: JSON.stringify({ decision_requests: [], verification_events: [], topic_shift: { shift: false, current_task: 'local test' } }) }],
      });
    };
    return handleRequest(request, env, undefined, mock);
  },
};
