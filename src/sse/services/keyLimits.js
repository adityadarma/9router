// Limit-token enforcement shared by every /v1 handler: expiry, token limit and
// per-key allowedModels. Runs independently of upstream's per-key access
// control (keyAccess.js); a request must pass both.
//
// The key is read with extractClientApiKey (Bearer, x-api-key, x-goog-api-key,
// ?key=), the same places the middleware authorizes a remote call from, so a
// key cannot skip its limits just by changing how it is sent.
import { getApiKeyByKey, keyLimitReason } from "@/lib/db/repos/apiKeysRepo.js";
import { extractClientApiKey } from "./keyAccess.js";
import { canonicalModelKey } from "./model.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";

/**
 * Error response for a denied API key.
 * @param {"expired"|"limit"|"inactive"|"model_not_allowed"|string} reason
 */
export function apiKeyDeniedResponse(reason) {
  switch (reason) {
    case "expired":
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "API key has expired");
    case "limit":
      return errorResponse(HTTP_STATUS.FORBIDDEN, "API key token limit reached");
    case "inactive":
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "API key is paused");
    case "model_not_allowed":
      return errorResponse(HTTP_STATUS.FORBIDDEN, "This API key is not allowed to use the requested model");
    default:
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
}

/**
 * Whether `key` may call `modelStr` under its allowedModels list.
 * Empty list = unrestricted. Equivalent spellings (provider alias vs id,
 * custom alias, combo name) match via canonicalModelKey.
 */
export async function isModelAllowedForKey(key, modelStr) {
  const allowed = Array.isArray(key?.allowedModels) ? key.allowedModels : [];
  if (allowed.length === 0) return true;
  if (!modelStr || typeof modelStr !== "string") return false;
  if (allowed.includes(modelStr)) return true;
  const requested = await canonicalModelKey(modelStr);
  if (!requested) return false;
  const allowedKeys = await Promise.all(allowed.map((m) => canonicalModelKey(m)));
  return allowedKeys.includes(requested);
}

/**
 * Enforce a known key's expiry / token limit and allowedModels.
 * Unknown keys and requests without a key pass (authentication itself is the
 * job of the middleware and the requireApiKey check). Paused keys are handled
 * by requireApiKey, matching chat's previous behaviour.
 *
 * @param {Request} request
 * @param {string|null} modelStr - requested model/combo/provider, before combo expansion
 * @returns {Promise<Response|null>} a 401/403 Response, or null when allowed
 */
export async function enforceKeyLimits(request, modelStr) {
  const apiKey = extractClientApiKey(request);
  if (!apiKey) return null;
  const key = await getApiKeyByKey(apiKey);
  if (!key) return null;

  const reason = keyLimitReason(key);
  if (reason) {
    log.warn("AUTH", `API key limit exceeded: ${reason}`);
    return apiKeyDeniedResponse(reason);
  }

  if (!(await isModelAllowedForKey(key, modelStr))) {
    log.warn("AUTH", `Model "${modelStr}" not allowed for this API key`);
    return apiKeyDeniedResponse("model_not_allowed");
  }
  return null;
}
