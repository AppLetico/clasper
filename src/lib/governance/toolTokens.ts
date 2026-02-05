import { SignJWT, jwtVerify } from 'jose';
import { v7 as uuidv7 } from 'uuid';
import { config } from '../core/config.js';
import { getDatabase } from '../core/db.js';
import { sha256Json, formatSha256 } from '../security/sha256.js';
import type { JsonValue } from '../security/stableJson.js';

export interface ToolTokenClaims {
  tenant_id: string;
  workspace_id: string;
  adapter_id: string;
  execution_id: string;
  tool: string;
  scope: JsonValue;
}

export interface IssuedToolToken {
  token: string;
  jti: string;
  expires_at: string;
  scope_hash: string;
}

export class ToolTokenError extends Error {
  code: 'config_error' | 'invalid_token' | 'expired' | 'used';

  constructor(message: string, code: ToolTokenError['code']) {
    super(message);
    this.name = 'ToolTokenError';
    this.code = code;
  }
}

export async function issueToolToken(
  claims: ToolTokenClaims,
  ttlSeconds: number = 30
): Promise<IssuedToolToken> {
  if (!config.toolTokenSecret) {
    throw new ToolTokenError('CLASPER_TOOL_TOKEN_SECRET is required', 'config_error');
  }

  const jti = uuidv7();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + ttlSeconds;
  const scopeHash = formatSha256(sha256Json(claims.scope as JsonValue));

  const encoder = new TextEncoder();
  const secret = encoder.encode(config.toolTokenSecret);

  const token = await new SignJWT({
    typ: 'tool_auth',
    tenant_id: claims.tenant_id,
    workspace_id: claims.workspace_id,
    adapter_id: claims.adapter_id,
    execution_id: claims.execution_id,
    tool: claims.tool,
    scope: claims.scope,
    scope_hash: scopeHash,
  })
    .setProtectedHeader({ alg: config.toolTokenAlgorithm })
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .setJti(jti)
    .sign(secret);

  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO tool_tokens (
      jti, tenant_id, adapter_id, execution_id, tool, scope_hash, issued_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    jti,
    claims.tenant_id,
    claims.adapter_id,
    claims.execution_id,
    claims.tool,
    scopeHash,
    new Date(issuedAt * 1000).toISOString(),
    new Date(expiresAt * 1000).toISOString()
  );

  return {
    token,
    jti,
    expires_at: new Date(expiresAt * 1000).toISOString(),
    scope_hash: scopeHash,
  };
}

export async function verifyToolToken(token: string): Promise<{ payload: Record<string, unknown> }> {
  if (!config.toolTokenSecret) {
    throw new ToolTokenError('CLASPER_TOOL_TOKEN_SECRET is required', 'config_error');
  }

  const encoder = new TextEncoder();
  const secret = encoder.encode(config.toolTokenSecret);

  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: [config.toolTokenAlgorithm],
    });
    return { payload };
  } catch {
    throw new ToolTokenError('Invalid tool token', 'invalid_token');
  }
}

export function consumeToolToken(jti: string): boolean {
  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      UPDATE tool_tokens
      SET used_at = ?
      WHERE jti = ? AND used_at IS NULL
    `
    )
    .run(now, jti);

  return result.changes > 0;
}
