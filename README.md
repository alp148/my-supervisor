# my-supervisor

A **supervisord-like** process manager for Node.js. Manages child processes defined in individual JSON config files, auto-restarts crashed processes, and exposes a REST API to control them at runtime.

Includes a beautiful, glassmorphism-styled **Web Dashboard** for easy real-time monitoring and control, and a fully-featured **CLI tool** for remote management.

---

## Project Structure

```
my-supervisor/
├── config/
│   ├── supervisor.json         ← global settings (port, log dir, etc.)
│   └── processes/
│       ├── counter.json        ← config for the "counter" process
│       └── my-app.json         ← config for a generic app
├── src/
│   ├── index.js                ← entry point
│   ├── ProcessManager.js       ← scans config/processes/, manages all
│   ├── ProcessWrapper.js       ← wraps one child process lifecycle
│   ├── LogManager.js           ← circular log buffer + file output
│   └── api/
│       ├── server.js           ← Express app
│       └── routes/
│           └── processes.js    ← REST routes
├── examples/
│   ├── counter.js              ← demo counter process
│   └── app.js                  ← demo HTTP server process
└── logs/                       ← auto-created per-process log files
```

---

## Quick Start

```bash
npm install
npm start
```

The supervisor starts and the API listens on `http://localhost:9000`.

---

## Process Config File

Each process lives in its **own JSON file** under `config/processes/`.

```json
{
  "uid": "my-app-001",
  "title": "My Application",
  "description": "Main production Node.js service",
  "command": "node",
  "args": ["app.js"],
  "cwd": "/path/to/app",
  "env": {
    "PORT": "3001",
    "NODE_ENV": "production"
  },
  "autostart": true,
  "autorestart": true,
  "maxRestarts": 5,
  "restartDelay": 2000,
  "enabled": true
}
```

| Field | Type | Description |
|---|---|---|
| `uid` | string | **Required.** Unique identifier used by the API |
| `title` | string | Human-readable display name |
| `description` | string | Short description of the process |
| `command` | string | Executable to run |
| `args` | string[] | CLI arguments |
| `cwd` | string | Working directory (default: supervisor root) |
| `env` | object | Extra env vars (merged with `process.env`) |
| `autostart` | boolean | Start automatically on supervisor boot |
| `autorestart` | boolean | Restart on unexpected exit |
| `maxRestarts` | number | Max consecutive restart attempts |
| `restartDelay` | number | Milliseconds to wait before restart |
| `enabled` | boolean | If `false`, process is permanently disabled |

> **Adding a new process**: just drop a new `.json` file in `config/processes/` and restart the supervisor.

---

## Global Supervisor Config (`config/supervisor.json`)

```json
{
  "port": 9000,
  "processesDir": "./config/processes",
  "logsDir": "./logs",
  "logMaxLines": 500
}
```

---

## REST API

Base URL: `http://localhost:9000`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/processes` | List all processes and their status |
| `POST` | `/api/processes` | Create a new process configuration |
| `GET` | `/api/processes/:uid` | Get single process status |
| `PUT` | `/api/processes/:uid` | Update an existing process configuration |
| `DELETE` | `/api/processes/:uid` | Permanently remove a process |
| `POST` | `/api/processes/:uid/start` | Start a process |
| `POST` | `/api/processes/:uid/stop` | Stop a process |
| `POST` | `/api/processes/:uid/restart` | Restart a process |
| `POST` | `/api/processes/:uid/enable` | Enable a disabled process |
| `POST` | `/api/processes/:uid/disable` | Disable (stop and prevent restarts) |
| `GET` | `/api/processes/:uid/logs` | Get last N log lines (`?lines=100`) |
| `GET` | `/api/processes/:uid/logs/events` | Stream process logs via SSE |
| `GET` | `/api/processes/:uid/logs/download`| Download the full process log file |
| `GET` | `/api/processes/events` | Stream process status updates via SSE |
| `POST` | `/api/processes/all/start` | Bulk start all processes |
| `POST` | `/api/processes/all/stop` | Bulk stop all processes |
| `POST` | `/api/processes/all/restart` | Bulk restart all processes |
| `POST` | `/api/processes/all/reload` | Reload all process configurations from disk |
| `GET` | `/api/processes/all/export` | Export all process configurations |
| `POST` | `/api/processes/import` | Import process configurations |
| `GET` | `/health` | Health check |

### Process States

```
stopped → starting → running → stopping → stopped
                   ↘ crashed  →  (auto-restart or stays crashed)
disabled  (no transitions until enabled)
```

### Example API Calls

```bash
# List all
curl http://localhost:9000/api/processes

# Status
curl http://localhost:9000/api/processes/counter-001

# Start / stop / restart
curl -X POST http://localhost:9000/api/processes/counter-001/start
curl -X POST http://localhost:9000/api/processes/counter-001/stop
curl -X POST http://localhost:9000/api/processes/counter-001/restart

# Disable / enable
curl -X POST http://localhost:9000/api/processes/counter-001/disable
curl -X POST http://localhost:9000/api/processes/counter-001/enable

# Logs (last 50 lines)
curl "http://localhost:9000/api/processes/counter-001/logs?lines=50"
```

### Sample Response – `GET /api/processes`

```json
{
  "processes": [
    {
      "uid": "counter-001",
      "title": "Counter Demo",
      "description": "Demo process that logs an incrementing counter",
      "state": "running",
      "pid": 12345,
      "startedAt": "2026-04-09T13:00:00.000Z",
      "stoppedAt": null,
      "restartCount": 0,
      "autostart": true,
      "autorestart": true,
      "maxRestarts": 5,
      "enabled": true
    }
  ]
}
```

### Sample Response – `GET /api/processes/:uid/logs`

```json
{
  "uid": "counter-001",
  "lines": [
    { "timestamp": "2026-04-09T13:00:01.000Z", "stream": "stdout", "line": "[counter] tick #1" },
    { "timestamp": "2026-04-09T13:00:02.000Z", "stream": "stdout", "line": "[counter] tick #2" }
  ]
}
```

---

## Web Dashboard

The application includes a built-in web dashboard accessible at `http://localhost:9000/` by default.

Features include:
- **Real-time Monitoring:** View process statuses updating in real-time via Server-Sent Events (SSE).
- **Process Control:** Start, stop, restart, enable, and disable processes with a single click.
- **Live Logs:** Stream process logs directly in the browser.
- **Configuration Editing:** Edit process configurations directly from the UI without touching JSON files.
- **Modern Design:** Features a responsive, vibrant glassmorphism aesthetic.

---

## CLI Tool

Manage processes remotely from your terminal using the included CLI.

```bash
# Link the CLI globally
npm link

# Usage
my-supervisor-ctl status
my-supervisor-ctl start <uid>
my-supervisor-ctl stop <uid>
my-supervisor-ctl restart <uid>
my-supervisor-ctl logs <uid> --follow
```

---

## Debian Package

You can build a `.deb` package for production deployment.

```bash
npm run build:deb
```

This will create a Debian package that sets up `my-supervisor` as a systemd service, ensuring it starts on boot and manages your configured processes reliably.

---

## Development

```bash
# Install nodemon globally (optional)
npm install -g nodemon

# Run with auto-reload
npm run dev
```

Log files are written to `logs/<uid>.log` and also kept in a configurable in-memory ring buffer (default: last 500 lines per process, served via the `/logs` endpoint).
