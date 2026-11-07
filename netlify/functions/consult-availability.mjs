import legacy from '../handlers/consult-availability.cjs';
import adapter from '../lib/request-adapter.cjs';

export default async (request) => adapter.invoke(legacy.handler, request, 0);

export const config = {
  path: '/.netlify/functions/consult-availability',
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 90 }
};
