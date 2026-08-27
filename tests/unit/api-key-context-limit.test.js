import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-contextlimit-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("API key contextLimit", () => {
  it("creates key with contextLimit", async () => {
    const created = await db.createApiKey("context-limited", "m1", { contextLimit: 500 });
    expect(created.contextLimit).toBe(500);

    const fetched = await db.getApiKeyById(created.id);
    expect(fetched.contextLimit).toBe(500);
  });

  it("updateApiKey updates contextLimit", async () => {
    const created = await db.createApiKey("context-update", "m1");
    expect(created.contextLimit).toBe(null);

    const updated = await db.updateApiKey(created.id, { contextLimit: 1000 });
    expect(updated.contextLimit).toBe(1000);

    const fetched = await db.getApiKeyById(created.id);
    expect(fetched.contextLimit).toBe(1000);
    
    // update to null removes limit
    await db.updateApiKey(created.id, { contextLimit: null });
    expect((await db.getApiKeyById(created.id)).contextLimit).toBe(null);
  });

  it("checkApiKeyContextLimit returns ok:true when no limit", async () => {
    const created = await db.createApiKey("no-limit", "m1");
    const result = await (await import("@/sse/services/auth.js")).checkApiKeyContextLimit(created.key, 1000000);
    expect(result.ok).toBe(true);
    expect(result.limit).toBe(null);
  });
  
  it("checkApiKeyContextLimit returns ok:true when under limit", async () => {
    const created = await db.createApiKey("under-limit", "m1", { contextLimit: 1000 });
    const result = await (await import("@/sse/services/auth.js")).checkApiKeyContextLimit(created.key, 500);
    expect(result.ok).toBe(true);
    expect(result.limit).toBe(1000);
  });
  
  it("checkApiKeyContextLimit returns ok:true when exactly at limit", async () => {
    const created = await db.createApiKey("exact-limit", "m1", { contextLimit: 1000 });
    const result = await (await import("@/sse/services/auth.js")).checkApiKeyContextLimit(created.key, 1000);
    expect(result.ok).toBe(true);
    expect(result.limit).toBe(1000);
  });

  it("checkApiKeyContextLimit returns ok:false when over limit", async () => {
    const created = await db.createApiKey("over-limit", "m1", { contextLimit: 1000 });
    const result = await (await import("@/sse/services/auth.js")).checkApiKeyContextLimit(created.key, 1001);
    expect(result.ok).toBe(false);
    expect(result.limit).toBe(1000);
  });
});
