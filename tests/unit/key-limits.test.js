// Token quota and expiry enforcement shared by all /v1 handlers, reading the
// key from every location the middleware accepts.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({ keys: {} }));

vi.mock("@/lib/db/repos/apiKeysRepo.js", async () => {
  const repo = await vi.importActual("../../src/lib/db/repos/apiKeysRepo.js");
  return {
    getApiKeyByKey: async (k) => fx.keys[k] || null,
    keyLimitReason: repo.keyLimitReason,
  };
});
vi.mock("@/sse/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }));

const { enforceKeyLimits } = await import("../../src/sse/services/keyLimits.js");

const FUTURE = new Date(Date.now() + 86400000).toISOString();
const PAST = new Date(Date.now() - 86400000).toISOString();

function req(k, { header = "Authorization", query = false } = {}) {
  const headers = {};
  if (k && !query) headers[header] = header === "Authorization" ? `Bearer ${k}` : k;
  const url = `http://localhost/v1/embeddings${query && k ? `?key=${k}` : ""}`;
  return new Request(url, { method: "POST", headers });
}

async function errorOf(res) {
  return res ? { status: res.status, body: await res.json() } : null;
}

beforeEach(() => {
  fx.keys = {
    "sk-free": { id: "1", isActive: true, tokensUsed: 0 },
    "sk-expired": { id: "2", isActive: true, expiresAt: PAST, tokensUsed: 0 },
    "sk-full": { id: "3", isActive: true, tokenLimit: 100, tokensUsed: 100 },
    "sk-room": { id: "4", isActive: true, tokenLimit: 100, tokensUsed: 99, expiresAt: FUTURE },
  };
});

describe("enforceKeyLimits", () => {
  it("passes requests without a key and unknown keys", async () => {
    expect(await enforceKeyLimits(req(null), "openai/x")).toBeNull();
    expect(await enforceKeyLimits(req("sk-unknown"), "openai/x")).toBeNull();
  });

  it("passes keys with no limits or with room left", async () => {
    expect(await enforceKeyLimits(req("sk-free"), "openai/x")).toBeNull();
    expect(await enforceKeyLimits(req("sk-room"), "openai/x")).toBeNull();
  });

  it("rejects an expired key with 401", async () => {
    const r = await errorOf(await enforceKeyLimits(req("sk-expired"), "openai/x"));
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.body)).toContain("expired");
  });

  it("rejects a key at its token limit with 403", async () => {
    const r = await errorOf(await enforceKeyLimits(req("sk-full"), "openai/x"));
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain("token limit");
  });

  it("reads the key from x-api-key, x-goog-api-key and ?key=", async () => {
    for (const opts of [{ header: "x-api-key" }, { header: "x-goog-api-key" }, { query: true }]) {
      const r = await enforceKeyLimits(req("sk-expired", opts), "openai/x");
      expect(r?.status).toBe(401);
    }
  });
});
