'use strict';

const fs = require('fs');
const path = require('path');
const { ProcessWrapper } = require('./ProcessWrapper');

/**
 * Scans the configured processes directory, loads all *.json config files,
 * validates uid uniqueness, and manages all ProcessWrapper instances.
 */
class ProcessManager {
  /**
   * @param {object} supervisorConfig  - Global supervisor config (supervisor.json)
   */
  constructor(supervisorConfig) {
    this.processesDir = path.resolve(supervisorConfig.processesDir);
    this.logsDir = path.resolve(supervisorConfig.logsDir);
    this.logMaxLines = supervisorConfig.logMaxLines || 500;

    /** @type {Map<string, ProcessWrapper>} keyed by uid */
    this._processes = new Map();
  }

  /**
   * Load all process configs, validate, and create ProcessWrapper instances.
   * Throws if any uid is missing or duplicated.
   */
  load() {
    if (!fs.existsSync(this.processesDir)) {
      throw new Error(`Processes directory not found: ${this.processesDir}`);
    }

    const files = fs.readdirSync(this.processesDir).filter((f) => f.endsWith('.json'));

    if (files.length === 0) {
      console.warn(`[ProcessManager] No process config files found in ${this.processesDir}`);
    }

    for (const file of files) {
      const filePath = path.join(this.processesDir, file);
      let config;

      try {
        config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (err) {
        throw new Error(`Failed to parse config file "${file}": ${err.message}`);
      }

      if (!config.uid) {
        throw new Error(`Config file "${file}" is missing required field "uid".`);
      }

      if (this._processes.has(config.uid)) {
        throw new Error(`Duplicate uid "${config.uid}" found in "${file}".`);
      }

      const wrapper = new ProcessWrapper(config, this.logsDir, this.logMaxLines);
      this._processes.set(config.uid, wrapper);

      console.log(
        `[ProcessManager] Loaded: uid="${config.uid}" title="${config.title || ''}" from ${file}`,
      );
    }
  }

  /**
   * Auto-start all processes that have autostart: true and are enabled.
   */
  startAutostart() {
    for (const proc of this._processes.values()) {
      if (proc.config.autostart && proc.config.enabled !== false) {
        console.log(`[ProcessManager] Auto-starting: ${proc.uid}`);
        try {
          proc.start();
        } catch (err) {
          console.error(`[ProcessManager] Failed to auto-start "${proc.uid}": ${err.message}`);
        }
      }
    }
  }

  /**
   * Start all processes that are enabled and not already running.
   */
  async startAll() {
    const procs = [...this._processes.values()];
    await Promise.all(
      procs.map((p) => {
        try {
          if (p.config.enabled !== false && p.toJSON().state === 'stopped') {
            return p.start();
          }
        } catch (err) {
          console.error(`[ProcessManager] Failed to start "${p.uid}": ${err.message}`);
        }
      }),
    );
  }

  /**
   * Stop all running processes gracefully.
   */
  async stopAll() {
    const procs = [...this._processes.values()];
    await Promise.all(procs.map((p) => p.stop().catch((err) => {
      console.error(`[ProcessManager] Failed to stop "${p.uid}": ${err.message}`);
    })));
  }

  /**
   * Restart all enabled processes.
   */
  async restartAll() {
    const procs = [...this._processes.values()];
    await Promise.all(
      procs.map((p) => {
        if (p.config.enabled !== false) {
          return p.restart().catch((err) => {
            console.error(`[ProcessManager] Failed to restart "${p.uid}": ${err.message}`);
          });
        }
      }),
    );
  }

  /**
   * Get a process by uid.
   * @param {string} uid
   * @returns {ProcessWrapper|undefined}
   */
  getByUid(uid) {
    return this._processes.get(uid);
  }

  /**
   * Get all processes as a plain array of status snapshots.
   * @returns {object[]}
   */
  getAll() {
    return [...this._processes.values()].map((p) => p.toJSON());
  }
  /**
   * Create a new process, persist its config, and start management.
   * @param {object} config - The new process configuration
   * @returns {object} - Snapshot of the new process
   */
  createProcess(config) {
    if (!config.uid || !config.command) {
      throw new Error('Fields "uid" and "command" are required.');
    }

    if (this._processes.has(config.uid)) {
      throw new Error(`Process with uid "${config.uid}" already exists.`);
    }

    // Prepare config object
    const finalConfig = {
      uid: config.uid,
      title: config.title || config.uid,
      description: config.description || '',
      command: config.command,
      args: Array.isArray(config.args) ? config.args : (config.args ? config.args.split(',').map(s => s.trim()) : []),
      cwd: config.cwd || null,
      env: config.env || {},
      autostart: !!config.autostart,
      autorestart: config.autorestart !== false, // default to true
      maxRestarts: parseInt(config.maxRestarts, 10) || 5,
      enabled: config.enabled !== false,
    };

    // Save to disk
    const filePath = path.join(this.processesDir, `${finalConfig.uid}.json`);
    fs.writeFileSync(filePath, JSON.stringify(finalConfig, null, 2), 'utf8');

    // Instantiate and add to manager
    const wrapper = new ProcessWrapper(finalConfig, this.logsDir, this.logMaxLines);
    this._processes.set(finalConfig.uid, wrapper);

    console.log(`[ProcessManager] Created new process: ${finalConfig.uid}`);
    
    // Auto-start if requested
    if (finalConfig.autostart && finalConfig.enabled) {
      try {
        wrapper.start();
      } catch (err) {
        console.error(`[ProcessManager] Failed to autostart new process "${finalConfig.uid}": ${err.message}`);
      }
    }

    return wrapper.toJSON();
  }

  /**
   * Reload all configurations from disk, synchronizing the internal state.
   */
  async reloadConfigs() {
    console.log('[ProcessManager] Reloading configurations from disk...');
    const files = fs.readdirSync(this.processesDir).filter((f) => f.endsWith('.json'));
    const UIDsOnDisk = new Set();
    const results = { added: [], updated: [], removed: [], error: [] };

    for (const file of files) {
      const filePath = path.join(this.processesDir, file);
      try {
        const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!config.uid) throw new Error(`Missing "uid" in ${file}`);
        UIDsOnDisk.add(config.uid);

        if (this._processes.has(config.uid)) {
          // Update existing
          await this._processes.get(config.uid).updateConfig(config);
          results.updated.push(config.uid);
        } else {
          // Add new
          const wrapper = new ProcessWrapper(config, this.logsDir, this.logMaxLines);
          this._processes.set(config.uid, wrapper);
          results.added.push(config.uid);
          // Auto-start if configured
          if (config.autostart) {
            wrapper.start();
          }
        }
      } catch (err) {
        console.error(`[ProcessManager] Error loading ${file}: ${err.message}`);
        results.error.push({ file, error: err.message });
      }
    }

    // Remove Orphaned Processes (in memory but not on disk)
    for (const uid of this._processes.keys()) {
      if (!UIDsOnDisk.has(uid)) {
        console.log(`[ProcessManager] Orphaned process detected on disk: ${uid}. Removing...`);
        try {
          await this.removeProcess(uid); // This stops it and deletes it from memory (and disk file if it exists, but here it doesn't)
          results.removed.push(uid);
        } catch (err) {
          results.error.push({ uid, error: err.message });
        }
      }
    }

    return results;
  }

  /**
   * Get all raw process configurations.
   * @returns {object[]}
   */
  getAllConfigs() {
    return [...this._processes.values()].map((p) => p.config);
  }

  /**
   * Remove a process: stop it and delete its config file.
   * @param {string} uid
   */
  async removeProcess(uid) {
    const proc = this._processes.get(uid);
    if (!proc) {
      throw new Error(`Process with uid "${uid}" not found.`);
    }

    // 1. Stop the process first
    await proc.stop();

    // 2. Delete the config file
    const filePath = path.join(this.processesDir, `${uid}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // 3. Remove logs (optional but recommended for complete cleanup)
    // proc.logManager.clear(); 

    // 4. Remove from internal map
    this._processes.delete(uid);

    console.log(`[ProcessManager] Removed process: ${uid}`);
  }
}

module.exports = ProcessManager;
