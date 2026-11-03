import { getConfig } from './config.js';
import { openDatabase } from './db.js';
import { createApp } from './app.js';
const config = getConfig();
const db = await openDatabase(config);
const app = createApp(db, config);
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`AgentVault API: http://${process.env.HOST || '127.0.0.1'}:${port} (${config.paymentMode})`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { void db.close().finally(() => process.exit(0)); }));
