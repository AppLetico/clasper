import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'crypto';
import {
  buildSigningInput,
  verifySignedEnvelope,
  type SignedTelemetryEnvelope,
} from './signedEnvelope.js';
import { sha256Json, formatSha256 } from '../security/sha256.js';

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('SignedTelemetryEnvelope', () => {
  it('verifies a valid ed25519 signature', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const payload = { hello: 'world' };
    const envelope: SignedTelemetryEnvelope = {
      envelope_version: 'v1',
      adapter_id: 'adapter-1',
      adapter_version: '0.4.1',
      issued_at: new Date().toISOString(),
      execution_id: 'exec-1',
      trace_id: 'trace-1',
      payload_type: 'trace',
      payload,
      payload_hash: formatSha256(sha256Json(payload)),
      signature: '',
    };

    const signingInput = buildSigningInput(envelope);
    const signature = sign(null, Buffer.from(signingInput), privateKey);
    envelope.signature = toBase64Url(signature);

    expect(() =>
      verifySignedEnvelope({
        envelope,
        key: {
          alg: 'ed25519',
          publicJwk: publicKey.export({ format: 'jwk' }) as Record<string, unknown>,
        },
        maxSkewSeconds: 60,
      })
    ).not.toThrow();
  });

  it('rejects when payload hash mismatches', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const payload = { hello: 'world' };
    const envelope: SignedTelemetryEnvelope = {
      envelope_version: 'v1',
      adapter_id: 'adapter-1',
      adapter_version: '0.4.1',
      issued_at: new Date().toISOString(),
      execution_id: 'exec-1',
      trace_id: 'trace-1',
      payload_type: 'trace',
      payload,
      payload_hash: 'sha256:deadbeef',
      signature: '',
    };

    const signingInput = buildSigningInput(envelope);
    const signature = sign(null, Buffer.from(signingInput), privateKey);
    envelope.signature = toBase64Url(signature);

    expect(() =>
      verifySignedEnvelope({
        envelope,
        key: {
          alg: 'ed25519',
          publicJwk: publicKey.export({ format: 'jwk' }) as Record<string, unknown>,
        },
        maxSkewSeconds: 60,
      })
    ).toThrow(/Payload hash mismatch/);
  });

  it('rejects when issued_at is outside skew', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const payload = { hello: 'world' };
    const past = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const envelope: SignedTelemetryEnvelope = {
      envelope_version: 'v1',
      adapter_id: 'adapter-1',
      adapter_version: '0.4.1',
      issued_at: past,
      execution_id: 'exec-1',
      trace_id: 'trace-1',
      payload_type: 'trace',
      payload,
      payload_hash: formatSha256(sha256Json(payload)),
      signature: '',
    };

    const signingInput = buildSigningInput(envelope);
    const signature = sign(null, Buffer.from(signingInput), privateKey);
    envelope.signature = toBase64Url(signature);

    expect(() =>
      verifySignedEnvelope({
        envelope,
        key: {
          alg: 'ed25519',
          publicJwk: publicKey.export({ format: 'jwk' }) as Record<string, unknown>,
        },
        maxSkewSeconds: 60,
      })
    ).toThrow(/Issued_at outside allowed skew/);
  });
});
