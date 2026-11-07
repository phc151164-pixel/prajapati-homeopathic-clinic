import legacy from '../handlers/consult-create-order.cjs';
import adapter from '../lib/request-adapter.cjs';

export default async (request) => adapter.invoke(legacy.handler, request, 4096);

export const config = {
  path: '/.netlify/functions/consult-create-order',
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 6 }
};
