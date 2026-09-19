import { config } from './config.js';
import { getDb } from './db/connection.js';
import { buildApp } from './app.js';
import { startScheduler } from './jobs/scheduler.js';

// Opens the DB (and runs migrations) at startup rather than lazily on first
// query, so a broken schema fails loudly before the server starts accepting requests.
getDb();

const app = await buildApp();

startScheduler();

app.listen({ port: config.port, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
