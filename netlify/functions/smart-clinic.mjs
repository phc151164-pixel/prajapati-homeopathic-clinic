import clinic from '../handlers/smart-clinic.cjs';
import adapter from '../lib/request-adapter.cjs';

export default request => adapter.invoke(clinic.handler, request, 38000);
export const config = {
  path: '/.netlify/functions/smart-clinic',
  rateLimit: {windowLimit: 100, windowSize: 60, aggregateBy: ['ip', 'domain']}
};
