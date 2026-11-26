import * as NodeCrypto from "node:crypto";
import * as NodeHttp2 from "node:http2";
import * as NodeFSP from "node:fs/promises";

import type { PushCandidate } from "./notifications.ts";

export interface ApnsConfig {
  readonly keyPath: string;
  readonly keyId: string;
  readonly teamId: string;
  readonly bundleId: string;
}

export function apnsPayload(candidate: PushCandidate, preview: boolean) {
  return {
    aps: {
      alert: {
        title: Array.from(candidate.title).slice(0, 100).join(""),
        body: preview
          ? candidate.body
          : candidate.phase === "completed"
            ? "Done"
            : candidate.phase === "failed"
              ? "Thread failed"
              : "Needs your attention",
      },
      sound: "default",
      "thread-id": `${candidate.environmentId}:${candidate.threadId}`,
    },
    body: {
      environmentId: candidate.environmentId,
      threadId: candidate.threadId,
      titleSnapshot: candidate.title,
      kind: candidate.phase,
      deepLink: candidate.deepLink,
    },
  };
}

export function makeApnsSender(config: ApnsConfig) {
  let cached: { token: string; expiresAt: number } | undefined;
  return async (
    deviceToken: string,
    candidate: PushCandidate,
    preview: boolean,
  ): Promise<{ status: number; reason?: string }> => {
    if (!cached || cached.expiresAt <= Date.now()) {
      const key = NodeCrypto.createPrivateKey(await NodeFSP.readFile(config.keyPath));
      const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: config.keyId })).toString(
        "base64url",
      );
      const payload = Buffer.from(
        JSON.stringify({ iss: config.teamId, iat: Math.floor(Date.now() / 1000) }),
      ).toString("base64url");
      const input = `${header}.${payload}`;
      cached = {
        token: `${input}.${NodeCrypto.sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`,
        expiresAt: Date.now() + 45 * 60_000,
      };
    }
    const token = cached.token;
    return await new Promise((resolve, reject) => {
      const session = NodeHttp2.connect("https://api.push.apple.com");
      const timer = setTimeout(() => {
        session.destroy();
        reject(new Error("APNs request timed out"));
      }, 15_000);
      session.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      const request = session.request({
        ":method": "POST",
        ":path": `/3/device/${deviceToken}`,
        authorization: `bearer ${token}`,
        "apns-topic": config.bundleId,
        "apns-collapse-id": NodeCrypto.createHash("sha256").update(candidate.key).digest("hex"),
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
      });
      let status = 0;
      let body = "";
      request.on("response", (headers) => {
        status = Number(headers[":status"]);
      });
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("error", (error) => {
        clearTimeout(timer);
        session.destroy();
        reject(error);
      });
      request.on("end", () => {
        clearTimeout(timer);
        session.close();
        let reason: string | undefined;
        try {
          const parsed: unknown = JSON.parse(body);
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "reason" in parsed &&
            typeof parsed.reason === "string"
          )
            reason = parsed.reason;
        } catch {
          /* APNs succeeds with an empty body. */
        }
        if (status === 403) cached = undefined;
        resolve({ status, ...(reason ? { reason } : {}) });
      });
      request.end(JSON.stringify(apnsPayload(candidate, preview)));
    });
  };
}
