// Limit-token enforcement shared by all /v1 handlers (src/sse/services/keyLimits.js):
// expiry, token limit and allowedModels, read from every key location the
// middleware accepts.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({ keys: {} }));

vi.mock("@/lib/db/repos/apiKeysRepo.js", async () => {
  const repo = await vi.importActual("../../src/lib/db/repos/apiKeysRepo.js");
  return {
    getApiKeyByKey: async (k) => fx.keys[k] || null,
    keyLimitReason: repo.keyLimitReason,
  };
});
// Alias-aware matching: "kr/x" and "kiro/x" are the same target.
vi.mock("../../src/sse/services/model.js", () => ({
  canonicalModelKey: async (m) => (m ? m.replace(/^kr\//, "kiro/").toLowerCase() : null),
}));
vi.mock("@/sse/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }));

const { enforceKeyLimits, isModelAllowedForKey, filterModelsListByAllowed } = await import("../../src/sse/services/keyLimits.js");

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
    "sk-free": { id: "1", isActive: true, tokensUsed: 0, allowedModels: [] },
    "sk-expired": { id: "2", isActive: true, expiresAt: PAST, tokensUsed: 0, allowedModels: [] },
    "sk-full": { id: "3", isActive: true, tokenLimit: 100, tokensUsed: 100, allowedModels: [] },
    "sk-room": { id: "4", isActive: true, tokenLimit: 100, tokensUsed: 99, expiresAt: FUTURE, allowedModels: [] },
    "sk-models": { id: "5", isActive: true, tokensUsed: 0, allowedModels: ["kiro/claude", "Main"] },
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

  it("enforces allowedModels, accepting equivalent spellings", async () => {
    expect(await enforceKeyLimits(req("sk-models"), "kiro/claude")).toBeNull();
    expect(await enforceKeyLimits(req("sk-models"), "kr/claude")).toBeNull();
    expect(await enforceKeyLimits(req("sk-models"), "Main")).toBeNull();
    const r = await errorOf(await enforceKeyLimits(req("sk-models"), "openai/gpt-5"));
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toContain("not allowed");
  });

  it("denies a restricted key when no model is given", async () => {
    expect((await enforceKeyLimits(req("sk-models"), null))?.status).toBe(403);
    expect(await enforceKeyLimits(req("sk-free"), null)).toBeNull();
  });
});

describe("isModelAllowedForKey", () => {
  it("treats an empty or missing list as unrestricted", async () => {
    expect(await isModelAllowedForKey({ allowedModels: [] }, "anything")).toBe(true);
    expect(await isModelAllowedForKey({}, "anything")).toBe(true);
  });
});

describe("filterModelsListByAllowed (/v1/models)", () => {
  const list = [
    { id: "kr/claude", owned_by: "kr" },
    { id: "openai/gpt-5", owned_by: "openai" },
    { id: "Main", owned_by: "combo" },
    { id: "other-combo", owned_by: "combo" },
  ];

  it("returns the full list without a key, for unknown keys and unrestricted keys", async () => {
    expect(await filterModelsListByAllowed(req(null), list)).toBe(list);
    expect(await filterModelsListByAllowed(req("sk-unknown"), list)).toBe(list);
    expect(await filterModelsListByAllowed(req("sk-free"), list)).toBe(list);
  });

  it("keeps only allowed models and combos, matching equivalent spellings", async () => {
    const out = await filterModelsListByAllowed(req("sk-models"), list);
    expect(out.map((m) => m.id)).toEqual(["kr/claude", "Main"]);
  });

  it("reads the key from x-goog-api-key too", async () => {
    const out = await filterModelsListByAllowed(req("sk-models", { header: "x-goog-api-key" }), list);
    expect(out.map((m) => m.id)).toEqual(["kr/claude", "Main"]);
  });
});
