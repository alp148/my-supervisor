'use strict';

const { Router } = require('express');
const path = require('path');
const fs = require('fs');

/**
 * All routes are keyed by process uid.
 * @param {import('../../ProcessManager')} pm
 */
function processRoutes(pm) {
  const router = Router();

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Resolve process by uid or send 404 */
  function resolve(req, res) {
    const proc = pm.getByUid(req.params.uid);
    if (!proc) {
      res.status(404).json({ error: `No process with uid "${req.params.uid}"` });
      return null;
    }
    return proc;
  }

  /**
   * @swagger
   * /api/processes:
   *   get:
   *     summary: List all processes
   *     tags: [Processes]
   *     responses:
   *       200:
   *         description: A list of processes
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 processes:
   *                   type: array
   *                   items:
   *                     type: object
   */
  // ─── GET /api/processes ──────────────────────────────────────────────────
  router.get('/', (_req, res) => {
    res.json({ processes: pm.getAll() });
  });

  // ─── Bulk Actions ────────────────────────────────────────────────────────

  /**
   * @swagger
   * /api/processes/all/start:
   *   post:
   *     summary: Start all processes
   *     tags: [Bulk Actions]
   *     responses:
   *       200:
   *         description: Bulk start signal sent
   *       500:
   *         description: Internal server error
   */
  router.post('/all/start', async (_req, res) => {
    try {
      await pm.startAll();
      res.json({ action: 'start-all', status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/processes/all/stop:
   *   post:
   *     summary: Stop all processes
   *     tags: [Bulk Actions]
   *     responses:
   *       200:
   *         description: Bulk stop signal sent
   *       500:
   *         description: Internal server error
   */
  router.post('/all/stop', async (_req, res) => {
    try {
      await pm.stopAll();
      res.json({ action: 'stop-all', status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/processes/all/restart:
   *   post:
   *     summary: Restart all processes
   *     tags: [Bulk Actions]
   *     responses:
   *       200:
   *         description: Bulk restart signal sent
   *       500:
   *         description: Internal server error
   */
  router.post('/all/restart', async (_req, res) => {
    try {
      await pm.restartAll();
      res.json({ action: 'restart-all', status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/processes/all/reload:
   *   post:
   *     summary: Reload all process configurations from disk
   *     tags: [Bulk Actions]
   *     responses:
   *       200:
   *         description: Reload summary
   *       500:
   *         description: Internal server error
   */
  router.post('/all/reload', async (_req, res) => {
    try {
      const summary = await pm.reloadConfigs();
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/processes/events:
   *   get:
   *     summary: Stream process status updates via SSE
   *     tags: [Processes]
   *     responses:
   *       200:
   *         description: SSE stream opened
   *         content:
   *           text/event-stream:
   *             schema:
   *               type: string
   */
  // ─── GET /api/processes/events ───────────────────────────────────────────
  router.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendData = () => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify({ processes: pm.getAll() })}\n\n`);
    };

    sendData();
    const intervalId = setInterval(sendData, 1000);

    req.on('close', () => {
      clearInterval(intervalId);
      res.end();
    });
  });

  /**
   * @swagger
   * /api/processes/{uid}:
   *   get:
   *     summary: Get process details
   *     tags: [Processes]
   *     parameters:
   *       - in: path
   *         name: uid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Process details
   *       404:
   *         description: Process not found
   */
  // ─── GET /api/processes/:uid ─────────────────────────────────────────────
  router.get('/:uid', (req, res) => {
    const proc = resolve(req, res);
    if (!proc) return;
    res.json(proc.toJSON());
  });

  /**
   * @swagger
   * /api/processes/{uid}/start:
   *   post:
   *     summary: Start a process
   *     tags: [Commands]
   *     parameters:
   *       - in: path
   *         name: uid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Start signal sent
   *       404:
   *         description: Process not found
   *       409:
   *         description: Conflict (already running or disabled)
   */
  // ─── POST /api/processes/:uid/start ──────────────────────────────────────
  router.post('/:uid/start', (req, res) => {
    const proc = resolve(req, res);
    if (!proc) return;
    try {
      proc.start();
      res.json({ uid: proc.uid, action: 'start', state: proc.toJSON().state });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/processes/{uid}/stop:
   *   post:
   *     summary: Stop a process
   *     tags: [Commands]
   *     parameters:
   *       - in: path
   *         name: uid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Stop signal sent
   *       404:
   *         description: Process not found
   *       500:
   *         description: Internal server error
   */
  // ─── POST /api/processes/:uid/stop ───────────────────────────────────────
  router.post('/:uid/stop', async (req, res) => {
    const proc = resolve(req, res);
    if (!proc) return;
    try {
      await proc.stop();
      res.json({ uid: proc.uid, action: 'stop', state: proc.toJSON().state });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/processes/{uid}/restart:
   *   post:
   *     summary: Restart a process
   *     tags: [Commands]
   *     parameters:
   *       - in: path
   *         name: uid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Restart signal sent
   *       404:
   *         description: Process not found
   *       409:
   *         description: Conflict
   */
  // ─── POST /api/processes/:uid/restart ────────────────────────────────────
  router.post('/:uid/restart', async (req, res) => {
    const proc = resolve(req, res);
    if (!proc) return;
    try {
      await proc.restart();
      res.json({ uid: proc.uid, action: 'restart', state: proc.toJSON().state });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/processes/{uid}/disable:
   *   post:
   *     summary: Disable a process (prevents autostart)
   *     tags: [Commands]
   *     parameters:
   *       - in: path
   *         name: uid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Process disabled
   *       404:
   *         description: Process not found
   */
  // ─── POST /api/processes/:uid/disable ────────────────────────────────────
  router.post('/:uid/disable', async (req, res) => {
    const proc = resolve(req, res);
    if (!proc) return;
    try {
      await proc.disable();
      res.json({ uid: proc.uid, action: 'disable', state: proc.toJSON().state });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/processes/{uid}/enable:
   *   post:
   *     summary: Enable a process
   *     tags: [Commands]
   *     parameters:
   *       - in: path
   *         name: uid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Process enabled
   *       404:
   *         description: Process not found
   *       409:
   *         description: Conflict
   */
  // ─── POST /api/processes/enable/:uid ─────────────────────────────────────
  router.post('/:uid/enable', (req, res) => {
    const proc = resolve(req, res);
    if (!proc) return;
    try {
      proc.enable();
      res.json({ uid: proc.uid, action: 'enable', state: proc.toJSON().state });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/processes/{uid}/logs:
   *   get:
   *     summary: Get process logs
   *     tags: [Logs]
   *     parameters:
   *       - in: path
   *         name: uid
   *         required: true
   *         schema:
   *           type: string
   *       - in: query
   *         name: lines
   *         description: Number of lines to retrieve
   *         schema:
   *           type: integer
   *           default: 100
   *     responses:
   *       200:
   *         description: Log lines
   *       404:
   *         description: Process not found
   */
  // ─── GET /api/processes/:uid/logs ────────────────────────────────────────
  router.get('/:uid/logs', (req, res) => {
    const proc = resolve(req, res);
    if (!proc) return;
    const lines = Math.min(parseInt(req.query.lines, 10) || 100, 1000);
    res.json({
      uid: proc.uid,
      lines: proc.logManager.getLines(lines),
    });
  });

  /**
   * @swagger
   * /api/processes/{uid}/logs/events:
   *   get:
   *     summary: Stream process logs via SSE
   *     tags: [Logs]
   *     parameters:
   *       - in: path
   *         name: uid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Log event stream opened
   *         content:
   *           text/event-stream:
   *             schema:
   *               type: string
   */
  // ─── GET /api/processes/:uid/logs/events ──────────────────────────────────
  router.get('/:uid/logs/events', (req, res) => {
    const proc = resolve(req, res);
    if (!proc) return;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send the last few lines as a buffer
    const recentLines = proc.logManager.getLines(50);
    recentLines.forEach(l => {
      res.write(`data: ${JSON.stringify(l)}\n\n`);
    });

    const onLog = (logEntry) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(logEntry)}\n\n`);
    };

    proc.on('log', onLog);

    req.on('close', () => {
      proc.off('log', onLog);
      res.end();
    });
  });

  /**
   * @swagger
   * /api/processes/{uid}/logs/download:
   *   get:
   *     summary: Download the full process log file
   *     tags: [Logs]
   *     parameters:
   *       - in: path
   *         name: uid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Log file download
   *       404:
   *         description: Process not found
   */
  // ─── GET /api/processes/:uid/logs/download ────────────────────────────────
  router.get('/:uid/logs/download', (req, res) => {
    const proc = resolve(req, res);
    if (!proc) return;

    const logPath = path.join(proc.logManager.logsDir, `${proc.uid}.log`);
    if (fs.existsSync(logPath)) {
      res.download(logPath, `${proc.uid}.log`);
    } else {
      res.status(404).json({ error: 'Log file not found' });
    }
  });

  /**
   * @swagger
   * /api/processes:
   *   post:
   *     summary: Create a new process
   *     tags: [Processes]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [uid, command]
   *             properties:
   *               uid: { type: string }
   *               title: { type: string }
   *               description: { type: string }
   *               command: { type: string }
   *               args: { type: string, description: "Comma separated arguments" }
   *               cwd: { type: string }
   *               autostart: { type: boolean }
   *               autorestart: { type: boolean }
   *     responses:
   *       201:
   *         description: Process created
   *       400:
   *         description: Invalid input
   *       409:
   *         description: Conflict (uid already exists)
   */
  router.post('/', (req, res) => {
    try {
      const procSnapshot = pm.createProcess(req.body);
      res.status(201).json(procSnapshot);
    } catch (err) {
      const status = err.message.includes('already exists') ? 409 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/processes/{uid}:
   *   delete:
   *     summary: Permanently remove a process
   *     tags: [Processes]
   *     parameters:
   *       - in: path
   *         name: uid
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Process removed
   *       404:
   *         description: Process not found
   *       500:
   *         description: Internal server error
   */
  router.delete('/:uid', async (req, res) => {
    try {
      await pm.removeProcess(req.params.uid);
      res.json({ uid: req.params.uid, action: 'remove', status: 'ok' });
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  /**
   * @swagger
   * /api/processes/all/export:
   *   get:
   *     summary: Export all process configurations
   *     tags: [Backup]
   *     responses:
   *       200:
   *         description: JSON array of configurations
   */
  router.get('/all/export', (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="supervisor-export.json"');
    res.json(pm.getAllConfigs());
  });

  /**
   * @swagger
   * /api/processes/{uid}/export:
   *   get:
   *     summary: Export a single process configuration
   *     tags: [Backup]
   *     parameters:
   *       - in: path
   *         name: uid
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: JSON configuration file
   */
  router.get('/:uid/export', (req, res) => {
    const proc = resolve(req, res);
    if (!proc) return;
    res.setHeader('Content-Disposition', `attachment; filename="${proc.uid}.json"`);
    res.json(proc.config);
  });

  /**
   * @swagger
   * /api/processes/import:
   *   post:
   *     summary: Import process configurations
   *     tags: [Backup]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             oneOf:
   *               - type: object
   *               - type: array
   *                 items: { type: object }
   *     responses:
   *       200:
   *         description: Import summary
   */
  router.post('/import', (req, res) => {
    const configs = Array.isArray(req.body) ? req.body : [req.body];
    const results = { succeded: [], failed: [] };

    for (const config of configs) {
      try {
        const snapshot = pm.createProcess(config);
        results.succeded.push({ uid: config.uid, status: 'imported' });
      } catch (err) {
        results.failed.push({ uid: config.uid || 'unknown', error: err.message });
      }
    }

    res.json(results);
  });

  return router;
}

module.exports = processRoutes;
