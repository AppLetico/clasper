import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireOpsContextFromHeaders, OpsAuthError } from "./opsAuth.js";

const ENV_KEYS = ["OPS_DEV_NO_AUTH", "OPS_OIDC_ISSUER", "NODE_ENV"] as const;
let savedEnv: Record<string, string | undefined> = {};

function saveEnv(): void {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
}

describe("requireOpsContextFromHeaders", () => {
  describe("dev no-auth bypass (OPS_DEV_NO_AUTH)", () => {
    afterEach(() => {
      restoreEnv();
    });

    it("returns synthetic admin context when bypass allowed and no Authorization header", async () => {
      saveEnv();
      process.env.OPS_DEV_NO_AUTH = "true";
      delete process.env.OPS_OIDC_ISSUER;
      process.env.NODE_ENV = "development";

      const ctx = await requireOpsContextFromHeaders({});
      expect(ctx.userId).toBe("dev-user");
      expect(ctx.tenantId).toBe("dev-tenant");
      expect(ctx.role).toBe("admin");
    });

    it("returns synthetic admin context when bypass allowed and Bearer dev", async () => {
      saveEnv();
      process.env.OPS_DEV_NO_AUTH = "true";
      delete process.env.OPS_OIDC_ISSUER;
      process.env.NODE_ENV = "development";

      const ctx = await requireOpsContextFromHeaders({
        authorization: "Bearer dev"
      });
      expect(ctx.userId).toBe("dev-user");
      expect(ctx.role).toBe("admin");
    });

    it("throws missing_token when OPS_DEV_NO_AUTH=true but NODE_ENV=production", async () => {
      saveEnv();
      process.env.OPS_DEV_NO_AUTH = "true";
      delete process.env.OPS_OIDC_ISSUER;
      process.env.NODE_ENV = "production";

      await expect(requireOpsContextFromHeaders({})).rejects.toThrow(OpsAuthError);
      await expect(requireOpsContextFromHeaders({})).rejects.toMatchObject({
        code: "missing_token"
      });
    });

    it("throws missing_token when OPS_DEV_NO_AUTH=true but OIDC is set", async () => {
      saveEnv();
      process.env.OPS_DEV_NO_AUTH = "true";
      process.env.OPS_OIDC_ISSUER = "https://idp.example.com";
      process.env.NODE_ENV = "development";

      await expect(requireOpsContextFromHeaders({})).rejects.toThrow(OpsAuthError);
      await expect(requireOpsContextFromHeaders({})).rejects.toMatchObject({
        code: "missing_token"
      });
    });

    it("throws missing_token when OPS_DEV_NO_AUTH is not set and no header", async () => {
      saveEnv();
      delete process.env.OPS_DEV_NO_AUTH;
      delete process.env.OPS_OIDC_ISSUER;
      process.env.NODE_ENV = "development";

      await expect(requireOpsContextFromHeaders({})).rejects.toThrow(OpsAuthError);
      await expect(requireOpsContextFromHeaders({})).rejects.toMatchObject({
        code: "missing_token"
      });
    });
  });
});
