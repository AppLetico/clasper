import { z } from 'zod';
import { createPublicKey, verify as cryptoVerify } from 'crypto';
import { sha256Json, formatSha256 } from '../security/sha256.js';
import { stableStringify, type JsonValue } from '../security/stableJson.js';

export type SignedTelemetryPayloadType =
  | 'trace'
  | 'audit'
  | 'cost'
  | 'metrics'
  | 'violations';

export const SignedTelemetryEnvelopeSchema = z.object({
  envelope_version: z.literal('v1'),
  adapter_id: z.string(),
  adapter_version: z.string(),
  issued_at: z.string(),
  execution_id: z.string(),
  trace_id: z.string(),
  payload_type: z.enum(['trace', 'audit', 'cost', 'metrics', 'violations']),
  payload: z.unknown(),
  payload_hash: z.string(),
  signature: z.string(),
});

export type SignedTelemetryEnvelope = z.infer<
  typeof SignedTelemetryEnvelopeSchema
>;

export type TelemetryKeyAlgorithm = 'ed25519' | 'ES256';

export interface TelemetryKey {
  alg: TelemetryKeyAlgorithm;
  publicJwk: Record<string, unknown>;
  keyId?: string | null;
  revokedAt?: string | null;
}

export class SignedEnvelopeError extends Error {
  code:
    | 'invalid_payload'
    | 'invalid_signature'
    | 'payload_hash_mismatch'
    | 'timestamp_skew'
    | 'unsupported_algorithm'
    | 'missing_key';

  constructor(message: string, code: SignedEnvelopeError['code']) {
    super(message);
    this.name = 'SignedEnvelopeError';
    this.code = code;
  }
}

export function isSignedTelemetryEnvelope(
  payload: unknown
): payload is SignedTelemetryEnvelope {
  return SignedTelemetryEnvelopeSchema.safeParse(payload).success;
}

export function buildSigningInput(envelope: SignedTelemetryEnvelope): string {
  const input: JsonValue = {
    envelope_version: envelope.envelope_version,
    adapter_id: envelope.adapter_id,
    adapter_version: envelope.adapter_version,
    issued_at: envelope.issued_at,
    execution_id: envelope.execution_id,
    trace_id: envelope.trace_id,
    payload_type: envelope.payload_type,
    payload_hash: envelope.payload_hash,
  };
  return stableStringify(input);
}

function parseSignature(signature: string): Buffer {
  const isBase64Url = signature.includes('-') || signature.includes('_');
  const normalized = isBase64Url
    ? signature.replace(/-/g, '+').replace(/_/g, '/')
    : signature;
  const padded = normalized.padEnd(
    Math.ceil(normalized.length / 4) * 4,
    '='
  );
  return Buffer.from(padded, 'base64');
}

export function verifySignedEnvelope(params: {
  envelope: SignedTelemetryEnvelope;
  key: TelemetryKey | null;
  maxSkewSeconds: number;
}): void {
  if (!params.key) {
    throw new SignedEnvelopeError('Missing telemetry key', 'missing_key');
  }

  if (params.key.revokedAt) {
    throw new SignedEnvelopeError('Telemetry key revoked', 'missing_key');
  }

  const payloadHash = formatSha256(sha256Json(params.envelope.payload as JsonValue));
  if (payloadHash !== params.envelope.payload_hash) {
    throw new SignedEnvelopeError('Payload hash mismatch', 'payload_hash_mismatch');
  }

  const issuedAt = new Date(params.envelope.issued_at).getTime();
  if (Number.isNaN(issuedAt)) {
    throw new SignedEnvelopeError('Invalid issued_at timestamp', 'timestamp_skew');
  }

  const skewMs = Math.abs(Date.now() - issuedAt);
  if (skewMs > params.maxSkewSeconds * 1000) {
    throw new SignedEnvelopeError('Issued_at outside allowed skew', 'timestamp_skew');
  }

  const signingInput = buildSigningInput(params.envelope);
  const signature = parseSignature(params.envelope.signature);

  if (params.key.alg === 'ed25519') {
    const publicKey = createPublicKey({ key: params.key.publicJwk, format: 'jwk' });
    const ok = cryptoVerify(null, Buffer.from(signingInput), publicKey, signature);
    if (!ok) {
      throw new SignedEnvelopeError('Invalid signature', 'invalid_signature');
    }
    return;
  }

  if (params.key.alg === 'ES256') {
    const publicKey = createPublicKey({ key: params.key.publicJwk, format: 'jwk' });
    const ok = cryptoVerify('sha256', Buffer.from(signingInput), publicKey, signature);
    if (!ok) {
      throw new SignedEnvelopeError('Invalid signature', 'invalid_signature');
    }
    return;
  }

  throw new SignedEnvelopeError('Unsupported key algorithm', 'unsupported_algorithm');
}
