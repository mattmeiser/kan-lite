import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { config } from '../config.js';
import { closeDb, getDb } from '../db/connection.js';

/**
 * Points the shared DB singleton at a fresh temp directory for each test.
 * `config.dataDir` is a plain mutable property that getDb() only reads at
 * call time, so overwriting it in beforeEach (before any repo function
 * touches the DB) is enough to isolate every test -- no dynamic imports needed.
 */
export function useTestDb() {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kanlite-test-'));
    config.dataDir = dir;
    getDb();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}
