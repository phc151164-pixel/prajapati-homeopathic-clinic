import handler from '../handlers/doctor-dashboard.cjs';
import {invoke} from '../lib/request-adapter.cjs';
export default async request=>invoke(handler.handler,request,40000);
export const config={path:'/.netlify/functions/doctor-dashboard',rateLimit:{windowLimit:120,windowSize:60,aggregateBy:['ip','domain']}};
