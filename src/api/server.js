'use strict';

const express = require('express');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const processRoutes = require('./routes/processes');

/**
 * Build and return the Express app.
 * @param {import('../../ProcessManager')} processManager
 * @returns {express.Application}
 */
function createServer(processManager) {
  const app = express();

  // ── Middleware ────────────────────────────────────────────────────────────
  app.use(require('cors')());
  app.use(express.json());
  app.use(morgan('[:date[iso]] :method :url :status :response-time ms'));

  // ── Routes ────────────────────────────────────────────────────────────────
  app.use(express.static(require('path').join(__dirname, '../../public')));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.use('/api/processes', processRoutes(processManager));

  /**
   * @swagger
   * /health:
   *   get:
   *     summary: Health check
   *     responses:
   *       200:
   *         description: API is healthy
   */
  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // ── 404 ───────────────────────────────────────────────────────────────────
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // ── Global error handler ──────────────────────────────────────────────────
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[API Error]', err.message);
    res.status(err.status || 500).json({ error: err.message });
  });

  return app;
}

module.exports = { createServer };
