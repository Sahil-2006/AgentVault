import type { IncomingMessage, ServerResponse } from 'node:http';
import { getConfig } from '../backend/config.js';
import { openDatabase } from '../backend/db.js';
import { createApp, publicConfig } from '../backend/app.js';
const config = getConfig();
let application: ReturnType<typeof initialize> | undefined;
async function initialize() { return createApp(await openDatabase(config), config); }
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.url?.split('?')[0] === '/api/config') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(publicConfig(config))); return; }
  try { application ||= initialize(); (await application)(req, res); }
  catch { application = undefined; res.statusCode = 503; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'AgentVault is waiting for its database configuration. Add DATABASE_URL in Vercel and redeploy.' })); }
}
