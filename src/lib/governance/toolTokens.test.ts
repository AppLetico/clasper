import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DB_DIR = join(process.cwd(), '.test-db');
const TEST_DB_PATH = join(TEST_DB_DIR, 'tool-tokens.db');
process.env.CLASPER_DB_PATH = TEST_DB_PATH;
process.env.CLASPER_TOOL_TOKEN_SECRET = 'test-secret';

import { initDatabase, closeDatabase } from '../core/db.js';
import { issueToolToken, consumeToolToken, verifyToolToken } from './toolTokens.js';

describe('Tool tokens', () => {
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

  it('issues and consumes tokens', async () => {
    const issued = await issueToolToken({
      tenant_id: 't1',
      workspace_id: 'w1',
      adapter_id: 'a1',
      execution_id: 'e1',
      tool: 'filesystem.write',
      scope: { path: '/tmp/out.txt', bytes: 10 },
    });

    const verified = await verifyToolToken(issued.token);
    expect(verified.payload.tool).toBe('filesystem.write');

    const firstConsume = consumeToolToken(issued.jti);
    const secondConsume = consumeToolToken(issued.jti);

    expect(firstConsume).toBe(true);
    expect(secondConsume).toBe(false);
  });
});
