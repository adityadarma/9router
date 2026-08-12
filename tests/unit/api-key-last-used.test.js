// API key "last used" tracking — verifies the lastUsedAt column is created by
// schema auto-sync, defaults to null, is stamped by request usage recording,
// and survives unrelated key updates.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-lastused-"));
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

describe("API key lastUsedAt", () => {
  it("a freshly created key has never been used", async () => {
    const created = await db.createApiKey("fresh", "machine-1");
    expect(created.lastUsedAt).toBe(null);

    const fetched = await db.getApiKeyById(created.id);
    expect(fetched.lastUsedAt).toBe(null);
  });

  it("touchApiKeyUsed stamps an ISO timestamp on the matching key", async () => {
    const created = await db.createApiKey("touched", "machine-1");
    const when = "2026-08-01T10:00:00.000Z";
    await db.touchApiKeyUsed(created.key, when);

    const fetched = await db.getApiKeyById(created.id);
    expect(fetched.lastUsedAt).toBe(when);
  });

  it("recording request usage stamps lastUsedAt and accrues tokens", async () => {
    const created = await db.createApiKey("used", "machine-1");
    const ts = "2026-08-02T12:30:00.000Z";

    await db.saveRequestUsage({
      timestamp: ts,
      provider: "openai",
      model: "gpt-4",
      apiKey: created.key,
      tokens: { prompt_tokens: 30, completion_tokens: 12 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });

    const fetched = await db.getApiKeyById(created.id);
    expect(fetched.lastUsedAt).toBe(ts);
    expect(fetched.tokensUsed).toBe(42);
  });

  it("stamps lastUsedAt even when a request consumed zero tokens", async () => {
    const created = await db.createApiKey("zero-tokens", "machine-1");
    const ts = "2026-08-03T08:00:00.000Z";

    await db.saveRequestUsage({
      timestamp: ts,
      provider: "openai",
      model: "gpt-4",
      apiKey: created.key,
      tokens: {},
      endpoint: "/v1/chat/completions",
      status: "error",
    });

    const fetched = await db.getApiKeyById(created.id);
    expect(fetched.lastUsedAt).toBe(ts);
    expect(fetched.tokensUsed).toBe(0);
  });

  it("only the key that made the request is stamped", async () => {
    const a = await db.createApiKey("key-a", "machine-1");
    const b = await db.createApiKey("key-b", "machine-1");

    await db.touchApiKeyUsed(a.key, "2026-08-04T09:00:00.000Z");

    expect((await db.getApiKeyById(a.id)).lastUsedAt).toBe("2026-08-04T09:00:00.000Z");
    expect((await db.getApiKeyById(b.id)).lastUsedAt).toBe(null);
  });

  it("updateApiKey preserves lastUsedAt", async () => {
    const created = await db.createApiKey("preserve", "machine-1");
    const when = "2026-08-05T14:00:00.000Z";
    await db.touchApiKeyUsed(created.key, when);

    const updated = await db.updateApiKey(created.id, {
      allowedModels: ["gpt-4"],
      tokenLimit: 1000,
    });
    expect(updated.lastUsedAt).toBe(when);

    const fetched = await db.getApiKeyById(created.id);
    expect(fetched.lastUsedAt).toBe(when);
    expect(fetched.allowedModels).toEqual(["gpt-4"]);
  });

  it("touchApiKeyUsed is a no-op for unknown or empty keys", async () => {
    await expect(db.touchApiKeyUsed("sk-does-not-exist", new Date().toISOString())).resolves.toBeUndefined();
    await expect(db.touchApiKeyUsed("", new Date().toISOString())).resolves.toBeUndefined();
    await expect(db.touchApiKeyUsed(null)).resolves.toBeUndefined();
  });

  it("an unparseable timestamp falls back to now instead of throwing", async () => {
    const created = await db.createApiKey("bad-timestamp", "machine-1");
    await expect(db.touchApiKeyUsed(created.key, "not-a-date")).resolves.toBeUndefined();

    const fetched = await db.getApiKeyById(created.id);
    expect(fetched.lastUsedAt).toBeTruthy();
    expect(isNaN(new Date(fetched.lastUsedAt).getTime())).toBe(false);
  });

  it("an existing pre-upgrade DB gains the column with existing keys intact", async () => {
    // Simulate a user's DB created before lastUsedAt existed: apiKeys without
    // the column, stamped at the older schema version. Schema auto-sync should
    // add the column additively without touching existing rows.
    const { DatabaseSync } = await import("node:sqlite");
    const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-upgrade-"));
    fs.mkdirSync(path.join(oldDir, "db"), { recursive: true });
    const file = path.join(oldDir, "db", "data.sqlite");

    const seed = new DatabaseSync(file);
    seed.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    seed.exec(`INSERT INTO _meta(key, value) VALUES('schemaVersion', '1')`);
    seed.exec(
      `CREATE TABLE apiKeys (id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT, machineId TEXT, isActive INTEGER DEFAULT 1, createdAt TEXT NOT NULL, tokenLimit INTEGER, expiresAt TEXT, tokensUsed INTEGER DEFAULT 0, allowedModels TEXT)`
    );
    seed.exec(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, tokensUsed, allowedModels) VALUES('old-1', 'sk-legacy', 'Legacy Key', 'm1', 1, '2026-01-01T00:00:00.000Z', 12345, '[]')`
    );
    seed.close();

    const prevDir = process.env.DATA_DIR;
    const prevAdapter = global._dbAdapter;
    try {
      process.env.DATA_DIR = oldDir;
      delete global._dbAdapter;
      vi.resetModules();

      const upgraded = await import("@/lib/db/index.js");
      await upgraded.initDb();

      const key = await upgraded.getApiKeyById("old-1");
      expect(key).toBeTruthy();
      expect(key.name).toBe("Legacy Key");
      expect(key.tokensUsed).toBe(12345);
      // Column added, defaulting to "never used" rather than a bogus date.
      expect(key.lastUsedAt).toBe(null);

      // And it becomes writable right away.
      await upgraded.touchApiKeyUsed("sk-legacy", "2026-08-07T11:00:00.000Z");
      expect((await upgraded.getApiKeyById("old-1")).lastUsedAt).toBe("2026-08-07T11:00:00.000Z");
    } finally {
      try { global._dbAdapter?.instance?.close?.(); } catch {}
      global._dbAdapter = prevAdapter;
      process.env.DATA_DIR = prevDir;
      fs.rmSync(oldDir, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("lastUsedAt round-trips through export/import", async () => {
    const created = await db.createApiKey("roundtrip", "machine-1");
    const when = "2026-08-06T16:45:00.000Z";
    await db.touchApiKeyUsed(created.key, when);

    const dump = await db.exportDb();
    const exported = dump.apiKeys.find((k) => k.id === created.id);
    expect(exported.lastUsedAt).toBe(when);

    await db.importDb(dump);
    expect((await db.getApiKeyById(created.id)).lastUsedAt).toBe(when);
  });
});
