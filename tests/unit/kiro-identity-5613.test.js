import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildKiroIdentityHeaders,
  KIRO_IDE_VERSION,
} from "../../open-sse/config/kiroIdentity.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { KiroService } from "../../src/lib/oauth/services/kiro.js";

describe("Kiro supported-client identity", () => {
  it("builds stable 1.4.154 headers without exposing credentials", () => {
    const credentials = {
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      providerSpecificData: { clientId: "stable-client-id" },
    };
    const machineId = createHash("sha256").update("stable-client-id").digest("hex");
    const headers = buildKiroIdentityHeaders(credentials);

    expect(KIRO_IDE_VERSION).toBe("1.4.154");
    expect(headers["User-Agent"]).toMatch(
      new RegExp(`KiroIDE-1\\.4\\.154-${machineId}$`)
    );
    expect(headers["X-Amz-User-Agent"]).toBe(
      `aws-sdk-js/1.0.0 KiroIDE-1.4.154-${machineId}`
    );
    expect(JSON.stringify(headers)).not.toContain("secret-");
  });

  it("uses the streaming identity for inference", () => {
    const headers = new KiroExecutor().buildHeaders({ accessToken: "token" });

    expect(headers["User-Agent"]).toContain("api/codewhispererstreaming#1.0.0");
    expect(headers["User-Agent"]).toMatch(/KiroIDE-1\.4\.154-[0-9a-f]{64}$/);
    expect(headers["X-Amz-User-Agent"]).toMatch(
      /^aws-sdk-js\/1\.0\.0 KiroIDE-1\.4\.154-[0-9a-f]{64}$/
    );
  });

  it("adds the identity to API-key validation and profile lookup", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, json: async () => ({ models: [{ modelId: "auto" }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ profiles: [] }) });
    const service = new KiroService();

    await service.listAvailableApiKeyModels("api-key");
    await service.listAvailableProfiles("access-token");

    for (const [, init] of fetchMock.mock.calls) {
      expect(init.headers["User-Agent"]).toMatch(/KiroIDE-1\.4\.154-[0-9a-f]{64}$/);
      expect(init.headers["X-Amz-User-Agent"]).toMatch(/KiroIDE-1\.4\.154-[0-9a-f]{64}$/);
    }
    vi.restoreAllMocks();
  });
});
