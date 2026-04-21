import type { VercelRequest, VercelResponse } from '@vercel/node';
import appPromise from '../server';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const app = await appPromise;
  return app(req, res);
}