import handler from '../handlers/doctor-auth.cjs';
import {invoke} from '../lib/request-adapter.cjs';
export default async request => invoke(handler.handler,request,12000);
export const config={path:'/.netlify/functions/doctor-auth',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain']}};
