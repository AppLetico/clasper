import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DB_DIR = join(process.cwd(), '.test-db');
const TEST_DB_PATH = join(TEST_DB_DIR, 'audit-chain.db');
process.env.CLASPER_DB_PATH = TEST_DB_PATH;

import { getDatabase, initDatabase, closeDatabase } from '../core/db.js';
import { getAuditLog } from './auditLog.js';

describe('Audit chain', () => {
  beforeEach(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    if (existsSync(TEST_DB_PATH + '-wal')) {
      unlinkSync(TEST_DB_PATH + '-wal');
    }
    if (existsSync(TEST_DB_PATH + '-shm')) {
      unlinkSync(TEST_DB_PATH + '-shm');
    }
    closeDatabase();
    initDatabase();
  });

  afterEach(() => {
    closeDatabase();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    if (existsSync(TEST_DB_PATH + '-wal')) {
      unlinkSync(TEST_DB_PATH + '-wal');
    }
    if (existsSync(TEST_DB_PATH + '-shm')) {
      unlinkSync(TEST_DB_PATH + '-shm');
    }
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
  });

  it('verifies chain hashes', () => {
    const audit = getAuditLog();
    audit.log('auth_success', { tenantId: 't1', eventData: { actor: 'a' } });
    audit.log('auth_failure', { tenantId: 't1', eventData: { actor: 'b' } });

    const verification = audit.verifyAuditChain('t1');
    expect(verification.ok).toBe(true);
  });

  it('detects tampering', () => {
    const audit = getAuditLog();
    audit.log('auth_success', { tenantId: 't1', eventData: { actor: 'a' } });
    audit.log('auth_failure', { tenantId: 't1', eventData: { actor: 'b' } });

    const db = getDatabase();
    db.prepare(`UPDATE audit_chain SET event_data = ? WHERE tenant_id = ? AND seq = 2`)
      .run(JSON.stringify({ actor: 'tampered' }), 't1');

    const verification = audit.verifyAuditChain('t1');
    expect(verification.ok).toBe(false);
    expect(verification.failures.length).toBeGreaterThan(0);
  });
});
