import * as NodeCrypto from "node:crypto";

// @effect-diagnostics extendsNativeError:off -- This standalone Node HTTP boundary uses status-bearing errors, not an Effect failure channel.
export class WatchError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface WatchGrant {
  id: string;
  credentialHash: string;
  expiresAt: number;
  pushCredentialHash?: string;
  operate: boolean;
  projects: Readonly<Record<string, readonly string[]>>;
}
export function credentialHash(value: string) {
  return NodeCrypto.createHash("sha256").update(value).digest("hex");
}
export function authorize(grants: WatchGrant[], token: string, now: number) {
  const actual = Buffer.from(credentialHash(token), "hex");
  const grant = grants.find((value) => {
    const expected = Buffer.from(value.credentialHash, "hex");
    return actual.length === expected.length && NodeCrypto.timingSafeEqual(actual, expected);
  });
  if (!grant || grant.expiresAt <= now) throw new WatchError(401, "Pair your Watch again.");
  return grant;
}
export function requireProject(
  grant: WatchGrant,
  environmentId: string,
  projectId: string,
  write = false,
) {
  if (!grant.projects[environmentId]?.includes(projectId))
    throw new WatchError(403, "Project is not allowed for this Watch.");
  if (write && !grant.operate) throw new WatchError(403, "This Watch has read-only access.");
}
export function page<T>(items: T[], cursor: string | null, revision: string, limit = 30) {
  let offset = 0;
  if (cursor) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(cursor, "base64url").toString());
    } catch {
      throw new WatchError(400, "Invalid page.");
    }
    if (
      !Array.isArray(decoded) ||
      decoded[0] !== revision ||
      !Number.isSafeInteger(decoded[1]) ||
      decoded[1] < 0
    )
      throw new WatchError(409, "List changed. Refresh before loading more.");
    offset = decoded[1];
  }
  return {
    items: items.slice(offset, offset + limit),
    nextCursor:
      offset + limit < items.length
        ? Buffer.from(JSON.stringify([revision, offset + limit])).toString("base64url")
        : null,
  };
}
export function commandIdentity(deviceId: string, body: unknown) {
  if (
    !body ||
    typeof body !== "object" ||
    !("commandId" in body) ||
    typeof body.commandId !== "string" ||
    !/^[\da-f-]{36}$/i.test(body.commandId)
  )
    throw new WatchError(400, "Invalid command ID.");
  return `${deviceId}:${body.commandId}`;
}
