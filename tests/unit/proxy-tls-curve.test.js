import { describe, expect, it } from "vitest";
import { TLS_ECDH_CURVE } from "../../open-sse/utils/proxyFetch.js";

describe("proxy TLS curve default", () => {
  it("offers AWS OIDC-compatible curves after X25519", () => {
    expect(TLS_ECDH_CURVE).toBe(
      process.env.NINEROUTER_TLS_ECDH_CURVE || "X25519:prime256v1:secp384r1"
    );
  });
});
