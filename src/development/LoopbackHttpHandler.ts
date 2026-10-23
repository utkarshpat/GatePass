import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpFailure } from '../transport/ApiHandler.ts';
import type { AdditionalHttpRoutes } from '../transport/ApiHandler.ts';
import { requireDummySso } from './DummyEmployeeSso.ts';

export function createLoopbackHttpHandler(origin: string, routes: AdditionalHttpRoutes) {
  requireDummySso();
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== 'http:' || url.hostname !== 'localhost' || !url.port) throw new Error('INVALID_LOOPBACK_ORIGIN');
  return async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Cache-Control','no-store');res.setHeader('Pragma','no-cache');res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");res.setHeader('Referrer-Policy','no-referrer');
    try {
      requireDummySso();
      if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') || req.headers.host !== url.host || req.headers.origin !== origin
        || ['cross-site','same-site'].includes(String(req.headers['sec-fetch-site']))) throw new HttpFailure(403);
      if(req.method!=='POST'){res.setHeader('Allow','POST');throw new HttpFailure(405);}
      if(!routes.handles(req.url??''))throw new HttpFailure(404);
      const result=await routes.handle(req,res);if(res.headersSent)return;res.statusCode=200;res.end(JSON.stringify(result));
    } catch(error) {
      if(res.headersSent){res.destroy();return;}
      req.resume();const code=(error as {code?:string})?.code;const status=error instanceof HttpFailure?error.status:code==='INVALID_INPUT'?400:code==='NOT_AUTHORIZED'?403:code==='CONFLICT'?409:503;res.statusCode=status;
      res.end(JSON.stringify({error:({400:'INVALID_INPUT',401:'NOT_AUTHENTICATED',403:'NOT_AUTHORIZED',404:'NOT_FOUND',405:'METHOD_NOT_ALLOWED',409:'CONFLICT',413:'BODY_TOO_LARGE',415:'UNSUPPORTED_MEDIA_TYPE',429:'RATE_LIMITED'} as Record<number,string>)[status]??'UNAVAILABLE'}));
    }
  };
}
