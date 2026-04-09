#!/usr/bin/env node
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');

// ── Load Config ──────────────────────────────────────────────────────────────
const configPath = path.resolve(__dirname, '../config/supervisor.json');
let config = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {}
}

const PORT = config.port || 9000;
const HOST = 'localhost';

// ── Helpers ──────────────────────────────────────────────────────────────────
function request(method, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: HOST,
      port: PORT,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode >= 400) {
            reject(new Error(data.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(data);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', (e) => reject(new Error(`Connection failed (Is the supervisor running?): ${e.message}`)));
    req.end();
  });
}

function formatUptime(dateString) {
  if (!dateString) return '-';
  const start = new Date(dateString);
  const now = new Date();
  const diffSecs = Math.floor((now - start) / 1000);
  
  if (diffSecs < 60) return `${diffSecs}s`;
  if (diffSecs < 3600) return `${Math.floor(diffSecs / 60)}m ${diffSecs % 60}s`;
  if (diffSecs < 86400) return `${Math.floor(diffSecs / 3600)}h ${Math.floor((diffSecs % 3600) / 60)}m`;
  return `${Math.floor(diffSecs / 86400)}d ${Math.floor((diffSecs % 86400) / 3600)}h`;
}

// ── Commands ─────────────────────────────────────────────────────────────────
const commands = {
  status: async () => {
    const { processes } = await request('GET', '/api/processes');
    if (!processes || processes.length === 0) {
      console.log('No processes managed by supervisor.');
      return;
    }

    // Header
    console.log(`${'UID'.padEnd(20)} ${'STATUS'.padEnd(10)} ${'PID'.padEnd(8)} ${'RESTARTS'.padEnd(10)} ${'UPTIME'}`);
    console.log('-'.repeat(60));

    processes.forEach(p => {
      const pid = p.pid || '-';
      const restarts = p.restartCount || 0;
      const uptime = p.state === 'running' ? formatUptime(p.startedAt) : '-';
      console.log(`${p.uid.padEnd(20)} ${p.state.padEnd(10)} ${pid.toString().padEnd(8)} ${restarts.toString().padEnd(10)} ${uptime}`);
    });
  },

  start: async (uid) => {
    if (!uid) throw new Error('UID required (usage: start <uid>)');
    await request('POST', `/api/processes/${uid}/start`);
    console.log(`Successfully sent START signal to "${uid}"`);
  },

  stop: async (uid) => {
    if (!uid) throw new Error('UID required (usage: stop <uid>)');
    await request('POST', `/api/processes/${uid}/stop`);
    console.log(`Successfully sent STOP signal to "${uid}"`);
  },

  restart: async (uid) => {
    if (!uid) throw new Error('UID required (usage: restart <uid>)');
    await request('POST', `/api/processes/${uid}/restart`);
    console.log(`Successfully sent RESTART signal to "${uid}"`);
  },

  enable: async (uid) => {
    if (!uid) throw new Error('UID required (usage: enable <uid>)');
    await request('POST', `/api/processes/${uid}/enable`);
    console.log(`Successfully ENABLED "${uid}"`);
  },

  disable: async (uid) => {
    if (!uid) throw new Error('UID required (usage: disable <uid>)');
    await request('POST', `/api/processes/${uid}/disable`);
    console.log(`Successfully DISABLED "${uid}"`);
  },

  'start-all': async () => {
    await request('POST', '/api/processes/all/start');
    console.log('Sent START ALL signal.');
  },

  'stop-all': async () => {
    await request('POST', '/api/processes/all/stop');
    console.log('Sent STOP ALL signal.');
  },

  'restart-all': async () => {
    await request('POST', '/api/processes/all/restart');
    console.log('Sent RESTART ALL signal.');
  },

  tail: async (uid) => {
    if (!uid) throw new Error('UID required (usage: tail <uid>)');
    
    console.log(`Tailing logs for "${uid}". Press Ctrl+C to stop.\n`);

    const req = http.get({
      hostname: HOST,
      port: PORT,
      path: `/api/processes/${uid}/logs/events`,
      headers: { 'Accept': 'text/event-stream' }
    }, (res) => {
      res.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        lines.forEach(line => {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              console.log(`${data.timestamp} - ${data.line}`);
            } catch (e) {
              // Ignore parse errors from partial chunks
            }
          }
        });
      });
    });

    req.on('error', (e) => {
      console.error(`Error connecting to log stream: ${e.message}`);
      process.exit(1);
    });

    // Keep process alive
    return new Promise(() => {});
  },

  logs: async (uid, ...args) => {
    if (!uid) throw new Error('UID required (usage: logs <uid> [--lines N])');
    let lines = 100;
    const linesIdx = args.indexOf('--lines');
    if (linesIdx !== -1 && args[linesIdx + 1]) {
      lines = parseInt(args[linesIdx + 1], 10);
    }
    
    const data = await request('GET', `/api/processes/${uid}/logs?lines=${lines}`);
    if (!data.lines || data.lines.length === 0) {
      console.log('No logs found for this process.');
    } else {
      data.lines.forEach(l => console.log(`${l.timestamp} - ${l.line}`));
    }
  },

  help: () => {
    console.log('My Supervisor Control (my-supervisor-ctl)');
    console.log('------------------------------------------');
    console.log('Usage:');
    console.log('  status                     List all processes and their status');
    console.log('  start <uid>                Start a process');
    console.log('  stop <uid>                 Stop a process');
    console.log('  restart <uid>              Restart a process');
    console.log('  enable <uid>               Enable a process');
    console.log('  disable <uid>              Disable a process');
    console.log('  logs <uid> [--lines N]     Show process logs');
    console.log('  tail <uid>                 Stream process logs in real-time');
    console.log('  start-all                  Start all enabled processes');
    console.log('  stop-all                   Stop all running processes');
    console.log('  restart-all                Restart all enabled processes');
    console.log('  help                       Show this help message');
  }
};

// ── Execution ────────────────────────────────────────────────────────────────
async function main() {
  const [,, cmd, ...args] = process.argv;
  
  if (!cmd || cmd === 'help' || !commands[cmd]) {
    commands.help();
    if (cmd && !commands[cmd]) {
      console.error(`\nError: Unknown command "${cmd}"`);
      process.exit(1);
    }
    process.exit(0);
  }

  try {
    await commands[cmd](...args);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
