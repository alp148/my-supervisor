'use strict';

const fs = require('fs');
const path = require('path');
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf } = format;

const logFormat = printf(({ timestamp, message }) => `[${timestamp}] ${message}`);

/**
 * Manages a circular log buffer for one process and writes to a log file.
 */
class LogManager {
  /**
   * @param {string} uid        - Process uid (used as log filename)
   * @param {string} logsDir    - Directory to write log files
   * @param {number} maxLines   - Max lines kept in memory
   */
  constructor(uid, logsDir, maxLines = 500) {
    this.uid = uid;
    this.logsDir = logsDir;
    this.maxLines = maxLines;
    this.buffer = [];

    fs.mkdirSync(logsDir, { recursive: true });

    this.logger = createLogger({
      format: combine(timestamp(), logFormat),
      transports: [
        new transports.File({
          filename: path.join(logsDir, `${uid}.log`),
          options: { flags: 'a' },
        }),
      ],
    });
  }

  /**
   * Write a line to the buffer and log file.
   * @param {string} line
   * @param {'stdout'|'stderr'} stream
   */
  write(line, stream = 'stdout') {
    const entry = {
      timestamp: new Date().toISOString(),
      stream,
      line: line.trimEnd(),
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxLines) {
      this.buffer.shift();
    }
    this.logger.info(`[${stream}] ${entry.line}`);
  }

  /**
   * Return the last `n` log entries from the in-memory buffer.
   * @param {number} n
   * @returns {{ timestamp: string, stream: string, line: string }[]}
   */
  getLines(n = 100) {
    return this.buffer.slice(-Math.abs(n));
  }

  /**
   * Clear the in-memory buffer.
   */
  clear() {
    this.buffer = [];
  }
}

module.exports = LogManager;
