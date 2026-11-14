// Token quota and expiry enforcement shared by every /v1 handler. Model access
// is enforced exclusively by keyAccess.js.
//
// The key is read with extractClientApiKey (Bearer, x-api-key, x-goog-api-key,
// ?key=), the same places the middleware authorizes a remote call from, so a
// key cannot skip its limits just by changing how it is sent.
import { getApiKeyByKey, keyLimitReason } from "@/lib/db/repos/apiKeysRepo.js";
import { extractClientApiKey } from "./keyAccess.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";

/**
 * Error response for a denied API key.
 * @param {"expired"|"limit"|"inactive"|string} reason
 */
export function apiKeyDeniedResponse(reason) {
  switch (reason) {
    case "expired":
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "API key has expired");
    case "limit":
      return errorResponse(HTTP_STATUS.FORBIDDEN, "API key token limit reached");
    case "inactive":
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "API key is paused");
    default:
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }
}

/**
 * Enforce a known key's expiry and token limit.
 * Unknown keys and requests without a key pass (authentication itself is the
 * job of the middleware and the requireApiKey check). Paused keys are handled
 * by requireApiKey, matching chat's previous behaviour.
 *
 * @param {Request} request
 * @returns {Promise<Response|null>} a 401/403 Response, or null when allowed
 */
export async function enforceKeyLimits(request) {
  const apiKey = extractClientApiKey(request);
  if (!apiKey) return null;
  const key = await getApiKeyByKey(apiKey);
  if (!key) return null;

  const reason = keyLimitReason(key);
  if (reason) {
    log.warn("AUTH", `API key limit exceeded: ${reason}`);
    return apiKeyDeniedResponse(reason);
  }

  return null;
}
