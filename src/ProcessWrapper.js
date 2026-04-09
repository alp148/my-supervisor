'use strict';

const { spawn } = require('child_process');
const EventEmitter = require('events');
const LogManager = require('./LogManager');

const STATES = {
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  STOPPING: 'stopping',
  CRASHED: 'crashed',
  FINISHED: 'finished',
  DISABLED: 'disabled',
};

/**
 * Wraps the lifecycle of a single child process.
 * Emits: 'stateChange', 'exit'
 */
class ProcessWrapper extends EventEmitter {
  /**
   * @param {object} config       - Process config loaded from its JSON file
   * @param {string} logsDir      - Directory where log files live
   * @param {number} logMaxLines  - Max in-memory log lines to keep
   */
  constructor(config, logsDir, logMaxLines) {
    super();

    this.uid = config.uid;
    this.title = config.title || config.uid;
    this.description = config.description || '';
    this.config = config;

    this._state = config.enabled === false ? STATES.DISABLED : STATES.STOPPED;
    this._child = null;
    this._restartCount = 0;
    this._restartTimer = null;
    this._startedAt = null;
    this._stoppedAt = null;
    this._pid = null;
    this._intentionalStop = false; // true when we called stop() ourselves

    this.logManager = new LogManager(config.uid, logsDir, logMaxLines);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Start the process. */
  start() {
    if (this._state === STATES.DISABLED) {
      throw new Error(`Process "${this.uid}" is disabled.`);
    }
    if (this._state === STATES.RUNNING || this._state === STATES.STARTING) {
      throw new Error(`Process "${this.uid}" is already ${this._state}.`);
    }
    this._restartCount = 0;
    this._spawn();
  }

  /** Stop the process (will NOT auto-restart). */
  stop() {
    return new Promise((resolve) => {
      if (this._state === STATES.STOPPED || this._state === STATES.STOPPING) {
        return resolve();
      }
      if (this._restartTimer) {
        clearTimeout(this._restartTimer);
        this._restartTimer = null;
      }

      this._intentionalStop = true;
      this._setState(STATES.STOPPING);

      const onExit = () => resolve();
      this.once('exit', onExit);

      if (this._child) {
        this._child.kill('SIGTERM');
        // Force kill after 5 s if process doesn't exit
        setTimeout(() => {
          if (this._child) this._child.kill('SIGKILL');
        }, 5000);
      } else {
        resolve();
      }
    });
  }

  /** Restart the process. */
  async restart() {
    await this.stop();
    this._intentionalStop = false;
    this._setState(STATES.STOPPED);
    this._restartCount = 0;
    this._spawn();
  }

  /** Disable: stop and prevent any future starts until re-enabled. */
  async disable() {
    await this.stop();
    this._setState(STATES.DISABLED);
    this.config.enabled = false;
  }

  /** Enable: allow starts again (does NOT auto-start). */
  enable() {
    if (this._state === STATES.DISABLED) {
      this.config.enabled = true;
      this._setState(STATES.STOPPED);
    }
  }

  /**
   * Update the internal configuration.
   * If sensitive fields (command, args, env, cwd) change, restart the process if it's running.
   */
  async updateConfig(newConfig) {
    const sensitiveFields = ['command', 'args', 'env', 'cwd'];
    let needsRestart = false;

    for (const field of sensitiveFields) {
      if (JSON.stringify(this.config[field]) !== JSON.stringify(newConfig[field])) {
        needsRestart = true;
        break;
      }
    }

    const wasRunning = this._state === STATES.RUNNING || this._state === STATES.STARTING;

    // Update the config object (merging to keep any non-JSON fields if they exist, though currently they don't)
    this.config = { ...this.config, ...newConfig };
    this.title = this.config.title || this.config.uid;
    this.description = this.config.description || '';

    if (needsRestart && wasRunning) {
      this._log(`[supervisor] Config change detected on sensitive fields. Restarting...`, 'stdout');
      await this.restart();
    } else {
      this._log(`[supervisor] Config updated.`, 'stdout');
    }
  }

  /** Return a plain-object snapshot of current state. */
  toJSON() {
    return {
      uid: this.uid,
      title: this.title,
      description: this.description,
      state: this._state,
      pid: this._pid,
      startedAt: this._startedAt,
      stoppedAt: this._stoppedAt,
      restartCount: this._restartCount,
      autostart: !!this.config.autostart,
      autorestart: !!this.config.autorestart,
      maxRestarts: this.config.maxRestarts ?? 5,
      enabled: this.config.enabled !== false,
    };
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  _setState(newState) {
    if (this._state === newState) return;
    this._state = newState;
    this.emit('stateChange', { uid: this.uid, state: newState });
  }

  _log(line, stream = 'stdout') {
    this.logManager.write(line, stream);
    this.emit('log', {
      timestamp: new Date().toISOString(),
      stream,
      line: line.trimEnd()
    });
  }

  _spawn() {
    const { command, args = [], cwd, env } = this.config;

    this._intentionalStop = false;
    this._setState(STATES.STARTING);
    this._log(`[supervisor] Starting: ${command} ${args.join(' ')}`, 'stdout');

    const child = spawn(command, args, {
      cwd: cwd || process.cwd(),
      env: { ...process.env, ...(env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this._child = child;
    this._pid = child.pid;
    this._startedAt = new Date().toISOString();
    this._stoppedAt = null;
    this._setState(STATES.RUNNING);

    child.stdout.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line) => {
        this._log(line, 'stdout');
      });
    });

    child.stderr.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach((line) => {
        this._log(line, 'stderr');
      });
    });

    child.on('error', (err) => {
      this._log(`[supervisor] spawn error: ${err.message}`, 'stderr');
      this._onExit(1);
    });

    child.on('close', (code) => {
      this._log(`[supervisor] Process exited with code ${code}`, 'stdout');
      this._onExit(code);
    });
  }

  _onExit(code) {
    this._child = null;
    this._pid = null;
    this._stoppedAt = new Date().toISOString();
    this.emit('exit', { uid: this.uid, code });

    if (this._intentionalStop || this._state === STATES.DISABLED) {
      this._setState(STATES.STOPPED);
      return;
    }

    // Unexpected exit — try auto-restart
    const { autorestart = false, maxRestarts = 5, restartDelay = 2000 } = this.config;

    if (autorestart && this._restartCount < maxRestarts) {
      this._restartCount++;
      this._setState(code === 0 ? STATES.FINISHED : STATES.CRASHED);
      this._log(
        `[supervisor] Auto-restarting in ${restartDelay}ms (attempt ${this._restartCount}/${maxRestarts})`,
        'stdout',
      );
      this._restartTimer = setTimeout(() => {
        this._restartTimer = null;
        if (this._state !== STATES.DISABLED) this._spawn();
      }, restartDelay);
    } else {
      this._setState(code === 0 ? STATES.FINISHED : STATES.CRASHED);
      if (autorestart) {
        this._log(
          `[supervisor] Max restarts (${maxRestarts}) reached. Giving up.`,
          'stderr',
        );
      }
    }
  }
}

module.exports = { ProcessWrapper, STATES };
