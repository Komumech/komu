import appPromise from '../server.ts';

export default async function handler(req: any, res: any) {
  try {
    const app = await appPromise;
    return app(req, res);
  } catch (error: any) {
    console.error('BOOTSTRAP ERROR:', error);
    res.status(500).json({ 
      error: 'Failed to initialize server', 
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
