import { createHash } from "crypto";

export const KIRO_IDE_VERSION = "1.4.154";

const SDK_VERSION = "1.0.0";
const CLIENTS = {
  streaming: { api: "codewhispererstreaming", metrics: "E" },
  runtime: { api: "codewhispererruntime", metrics: "N,E" },
};

export function buildKiroIdentityHeaders(credentials, client = "runtime") {
  const seed =
    credentials?.providerSpecificData?.clientId
    || credentials?.refreshToken
    || credentials?.providerSpecificData?.profileArn
    || credentials?.apiKey
    || credentials?.accessToken
    || "kiro-anonymous";
  const machineId = createHash("sha256").update(String(seed)).digest("hex");
  const { api, metrics } = CLIENTS[client] || CLIENTS.runtime;
  const identity = `KiroIDE-${KIRO_IDE_VERSION}-${machineId}`;

  return {
    "User-Agent":
      `aws-sdk-js/${SDK_VERSION} ua/2.1 os/windows#10.0.26200 lang/js ` +
      `md/nodejs#22.21.1 api/${api}#${SDK_VERSION} m/${metrics} ${identity}`,
    "X-Amz-User-Agent": `aws-sdk-js/${SDK_VERSION} ${identity}`,
  };
}
