import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const TEST_POLICY_DIR = join(process.cwd(), '.test-policies');
const TEST_POLICY_PATH = join(TEST_POLICY_DIR, 'policies.yaml');
process.env.CLASPER_POLICY_PATH = TEST_POLICY_PATH;

import { config } from '../core/config.js';
import { evaluatePolicy } from './policyEngine.js';

beforeEach(() => {
  if (!existsSync(TEST_POLICY_DIR)) {
    mkdirSync(TEST_POLICY_DIR, { recursive: true });
  }
  config.policyPath = TEST_POLICY_PATH;
});

afterEach(() => {
  if (existsSync(TEST_POLICY_DIR)) {
    rmSync(TEST_POLICY_DIR, { recursive: true, force: true });
  }
});

describe('Policy engine', () => {
  it('denies by default when no policy matches', () => {
    writeFileSync(TEST_POLICY_PATH, 'policies: []');
    const result = evaluatePolicy({ tool: 'filesystem.write', tenant_id: 't1' });
    expect(result.decision).toBe('deny');
  });

  it('allows when a matching rule exists', () => {
    writeFileSync(
      TEST_POLICY_PATH,
      `
policies:
  - policy_id: allow_fs_write
    if:
      tool: filesystem.write
    then:
      allow: true
`
    );
    const result = evaluatePolicy({ tool: 'filesystem.write' });
    expect(result.decision).toBe('allow');
    expect(result.policy_id).toBe('allow_fs_write');
  });

  it('requires approval when rule demands it', () => {
    writeFileSync(
      TEST_POLICY_PATH,
      `
policies:
  - policy_id: prod_fs_write
    if:
      environment: prod
      tool: filesystem.write
    then:
      require_approval: true
`
    );
    const result = evaluatePolicy({ environment: 'prod', tool: 'filesystem.write' });
    expect(result.decision).toBe('require_approval');
  });
});
