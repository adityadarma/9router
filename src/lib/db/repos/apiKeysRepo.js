import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    // Limit-token fields. tokenLimit/expiresAt null = unlimited/never.
    tokenLimit: row.tokenLimit != null ? Number(row.tokenLimit) : null,
    expiresAt: row.expiresAt || null,
    tokensUsed: row.tokensUsed != null ? Number(row.tokensUsed) : 0,
  };
}

// Normalize a raw token-limit input into a positive integer or null (unlimited).
function normalizeTokenLimit(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

// Normalize an expiry input into an ISO string or null (never).
function normalizeExpiresAt(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Limit-token check ONLY (ignores isActive / key existence).
// Returns "expired" | "limit" when a *configured* constraint is exceeded,
// otherwise null. If neither tokenLimit nor expiresAt is set, always null
// → key behaves exactly as before (free pass).
export function keyLimitReason(key) {
  if (!key) return null;
  if (key.expiresAt && Date.now() >= new Date(key.expiresAt).getTime()) return "expired";
  if (key.tokenLimit && key.tokenLimit > 0 && (key.tokensUsed || 0) >= key.tokenLimit) return "limit";
  return null;
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function getApiKeyByKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    tokenLimit: normalizeTokenLimit(options.tokenLimit),
    expiresAt: normalizeExpiresAt(options.expiresAt),
    tokensUsed: 0,
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, tokenLimit, expiresAt, tokensUsed) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, apiKey.tokenLimit, apiKey.expiresAt, 0]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToKey(row);
    const merged = { ...current, ...data };
    // Re-normalize limit/expiry only if caller supplied them.
    if ("tokenLimit" in data) merged.tokenLimit = normalizeTokenLimit(data.tokenLimit);
    if ("expiresAt" in data) merged.expiresAt = normalizeExpiresAt(data.expiresAt);
    if ("tokensUsed" in data) merged.tokensUsed = Math.max(0, Math.floor(Number(data.tokensUsed) || 0));
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, tokenLimit = ?, expiresAt = ?, tokensUsed = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, merged.tokenLimit, merged.expiresAt, merged.tokensUsed || 0, id]
    );
    result = merged;
  });
  return result;
}

// Atomically add consumed tokens to a key's running total (matched by key string).
// Used by usage tracking after each request completes.
export async function addTokensUsedByKey(key, tokens) {
  if (!key || !tokens || tokens <= 0) return;
  const db = await getAdapter();
  db.run(
    `UPDATE apiKeys SET tokensUsed = COALESCE(tokensUsed, 0) + ? WHERE key = ?`,
    [Math.floor(tokens), key]
  );
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

// Full validation result with reason. Used by request handlers that want to
// surface why a key was rejected.
// reason: "invalid" (unknown key) | "inactive" (paused) | "expired" | "limit" | null
export async function validateApiKeyDetailed(key) {
  const row = await getApiKeyByKey(key);
  if (!row) return { valid: false, reason: "invalid", key: null };
  if (!row.isActive) return { valid: false, reason: "inactive", key: row };
  const limitReason = keyLimitReason(row);
  return { valid: !limitReason, reason: limitReason, key: row };
}

export async function validateApiKey(key) {
  const { valid } = await validateApiKeyDetailed(key);
  return valid;
}
