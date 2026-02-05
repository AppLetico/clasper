import { getDatabase } from '../core/db.js';
import type { AdapterRegistration } from './types.js';

export interface AdapterRecord extends AdapterRegistration {
  tenant_id: string;
  created_at: string;
  updated_at: string;
  telemetry_key_alg?: string | null;
  telemetry_public_jwk?: Record<string, unknown> | null;
  telemetry_key_id?: string | null;
  telemetry_key_created_at?: string | null;
  telemetry_key_revoked_at?: string | null;
}

export class AdapterRegistry {
  register(tenantId: string, registration: AdapterRegistration): AdapterRecord {
    const db = getDatabase();
    const now = new Date().toISOString();

    db.prepare(
      `
      INSERT INTO adapter_registry (
        tenant_id, adapter_id, version, display_name, risk_class, capabilities,
        enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, adapter_id, version) DO UPDATE SET
        display_name = excluded.display_name,
        risk_class = excluded.risk_class,
        capabilities = excluded.capabilities,
        enabled = excluded.enabled,
        updated_at = excluded.updated_at
      `
    ).run(
      tenantId,
      registration.adapter_id,
      registration.version,
      registration.display_name,
      registration.risk_class,
      JSON.stringify(registration.capabilities),
      registration.enabled ? 1 : 0,
      now,
      now
    );

    return this.get(tenantId, registration.adapter_id, registration.version)!;
  }

  get(tenantId: string, adapterId: string, version?: string): AdapterRecord | null {
    const db = getDatabase();
    let row: AdapterRow | undefined;

    if (version) {
      row = db
        .prepare(
          `
          SELECT * FROM adapter_registry
          WHERE tenant_id = ? AND adapter_id = ? AND version = ?
        `
        )
        .get(tenantId, adapterId, version) as AdapterRow | undefined;
    } else {
      row = db
        .prepare(
          `
          SELECT * FROM adapter_registry
          WHERE tenant_id = ? AND adapter_id = ?
          ORDER BY updated_at DESC
          LIMIT 1
        `
        )
        .get(tenantId, adapterId) as AdapterRow | undefined;
    }

    return row ? this.rowToRecord(row) : null;
  }

  list(tenantId: string, options?: { limit?: number; offset?: number }): AdapterRecord[] {
    const db = getDatabase();
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const rows = db
      .prepare(
        `
        SELECT * FROM adapter_registry
        WHERE tenant_id = ?
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(tenantId, limit, offset) as AdapterRow[];

    return rows.map((row) => this.rowToRecord(row));
  }

  setTelemetryKey(params: {
    tenantId: string;
    adapterId: string;
    version?: string;
    keyAlg: string;
    publicJwk: Record<string, unknown>;
    keyId?: string;
  }): AdapterRecord | null {
    const db = getDatabase();
    const now = new Date().toISOString();
    const keyId = params.keyId || null;

    const result = params.version
      ? db
          .prepare(
            `
            UPDATE adapter_registry
            SET telemetry_key_alg = ?, telemetry_public_jwk = ?, telemetry_key_id = ?,
                telemetry_key_created_at = ?, telemetry_key_revoked_at = NULL, updated_at = ?
            WHERE tenant_id = ? AND adapter_id = ? AND version = ?
          `
          )
          .run(
            params.keyAlg,
            JSON.stringify(params.publicJwk),
            keyId,
            now,
            now,
            params.tenantId,
            params.adapterId,
            params.version
          )
      : db
          .prepare(
            `
            UPDATE adapter_registry
            SET telemetry_key_alg = ?, telemetry_public_jwk = ?, telemetry_key_id = ?,
                telemetry_key_created_at = ?, telemetry_key_revoked_at = NULL, updated_at = ?
            WHERE tenant_id = ? AND adapter_id = ?
          `
          )
          .run(
            params.keyAlg,
            JSON.stringify(params.publicJwk),
            keyId,
            now,
            now,
            params.tenantId,
            params.adapterId
          );

    if (result.changes === 0) {
      return null;
    }

    return this.get(params.tenantId, params.adapterId, params.version || undefined);
  }

  revokeTelemetryKey(params: {
    tenantId: string;
    adapterId: string;
    version?: string;
    reason?: string;
  }): AdapterRecord | null {
    const db = getDatabase();
    const now = new Date().toISOString();

    const result = params.version
      ? db
          .prepare(
            `
            UPDATE adapter_registry
            SET telemetry_key_revoked_at = ?, updated_at = ?
            WHERE tenant_id = ? AND adapter_id = ? AND version = ?
          `
          )
          .run(now, now, params.tenantId, params.adapterId, params.version)
      : db
          .prepare(
            `
            UPDATE adapter_registry
            SET telemetry_key_revoked_at = ?, updated_at = ?
            WHERE tenant_id = ? AND adapter_id = ?
          `
          )
          .run(now, now, params.tenantId, params.adapterId);

    if (result.changes === 0) {
      return null;
    }

    return this.get(params.tenantId, params.adapterId, params.version || undefined);
  }

  getActiveTelemetryKey(params: {
    tenantId: string;
    adapterId: string;
    version?: string;
  }): {
    keyAlg: string;
    publicJwk: Record<string, unknown>;
    keyId?: string | null;
    createdAt?: string | null;
  } | null {
    const record = this.get(params.tenantId, params.adapterId, params.version);
    if (!record || !record.telemetry_public_jwk || record.telemetry_key_revoked_at) {
      return null;
    }

    if (!record.telemetry_key_alg) {
      return null;
    }

    return {
      keyAlg: record.telemetry_key_alg,
      publicJwk: record.telemetry_public_jwk,
      keyId: record.telemetry_key_id,
      createdAt: record.telemetry_key_created_at,
    };
  }

  disable(tenantId: string, adapterId: string, version?: string): boolean {
    const db = getDatabase();
    const now = new Date().toISOString();

    const result = version
      ? db
          .prepare(
            `
            UPDATE adapter_registry
            SET enabled = 0, updated_at = ?
            WHERE tenant_id = ? AND adapter_id = ? AND version = ?
          `
          )
          .run(now, tenantId, adapterId, version)
      : db
          .prepare(
            `
            UPDATE adapter_registry
            SET enabled = 0, updated_at = ?
            WHERE tenant_id = ? AND adapter_id = ?
          `
          )
          .run(now, tenantId, adapterId);

    return result.changes > 0;
  }

  private rowToRecord(row: AdapterRow): AdapterRecord {
    return {
      tenant_id: row.tenant_id,
      adapter_id: row.adapter_id,
      display_name: row.display_name,
      risk_class: row.risk_class,
      capabilities: JSON.parse(row.capabilities || '[]'),
      version: row.version,
      enabled: row.enabled === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      telemetry_key_alg: row.telemetry_key_alg,
      telemetry_public_jwk: row.telemetry_public_jwk
        ? JSON.parse(row.telemetry_public_jwk)
        : null,
      telemetry_key_id: row.telemetry_key_id,
      telemetry_key_created_at: row.telemetry_key_created_at,
      telemetry_key_revoked_at: row.telemetry_key_revoked_at,
    };
  }
}

interface AdapterRow {
  tenant_id: string;
  adapter_id: string;
  version: string;
  display_name: string;
  risk_class: AdapterRegistration['risk_class'];
  capabilities: string;
  enabled: number;
  telemetry_key_alg: string | null;
  telemetry_public_jwk: string | null;
  telemetry_key_id: string | null;
  telemetry_key_created_at: string | null;
  telemetry_key_revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

let adapterRegistryInstance: AdapterRegistry | null = null;

export function getAdapterRegistry(): AdapterRegistry {
  if (!adapterRegistryInstance) {
    adapterRegistryInstance = new AdapterRegistry();
  }
  return adapterRegistryInstance;
}

export function resetAdapterRegistry(): void {
  adapterRegistryInstance = null;
}
