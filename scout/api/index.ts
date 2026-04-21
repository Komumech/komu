import type { VercelRequest, VercelResponse } from '@vercel/node';
import startServer from '../server';

let app: any;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!app) {
    app = await startServer();
  }
  return app(req, res);
}