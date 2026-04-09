'use strict';

const path = require('path');
const fs = require('fs');
const ProcessManager = require('./ProcessManager');
const { createServer } = require('./api/server');

// ── Load supervisor config ──────────────────────────────────────────────────
const supervisorConfigPath = path.resolve(__dirname, '../config/supervisor.json');
if (!fs.existsSync(supervisorConfigPath)) {
  console.error(`Supervisor config not found: ${supervisorConfigPath}`);
  process.exit(1);
}
const supervisorConfig = JSON.parse(fs.readFileSync(supervisorConfigPath, 'utf8'));
const PORT = supervisorConfig.port || 9000;

// ── Bootstrap ──────────────────────────────────────────────────────────────
const pm = new ProcessManager(supervisorConfig);

try {
  pm.load();
} catch (err) {
  console.error('[Supervisor] Failed to load process configs:', err.message);
  process.exit(1);
}

pm.startAutostart();

// ── Start API server ───────────────────────────────────────────────────────
const app = createServer(pm);
const server = app.listen(PORT, () => {
  console.log(`[Supervisor] API listening on http://localhost:${PORT}`);
  console.log(`[Supervisor] Managing ${pm.getAll().length} process(es).`);
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
async function shutdown(signal) {
  console.log(`\n[Supervisor] Received ${signal}. Stopping all processes...`);
  await pm.stopAll();
  server.close(() => {
    console.log('[Supervisor] HTTP server closed. Bye.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
