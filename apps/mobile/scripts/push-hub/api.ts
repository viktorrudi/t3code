import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";
import { DeviceRegistration } from "../../src/features/personal-push/protocol.ts";
import type { HubState } from "./store.ts";

const decodeDeviceRegistration = Schema.decodeUnknownSync(DeviceRegistration);
export function hashCredential(value: string): string {
  return NodeCrypto.createHash("sha256").update(value).digest("hex");
}
export function matchesCredential(value: string, hash: string): boolean {
  const expected = Buffer.from(hash, "hex");
  const actual = Buffer.from(hashCredential(value), "hex");
  return expected.length === actual.length && NodeCrypto.timingSafeEqual(actual, expected);
}
export function registerDevice(
  state: HubState,
  body: unknown,
  credential: string,
  pairing: { hash: string; expiresAt: number } | null,
  now: number,
): boolean {
  const registration = decodeDeviceRegistration(body);
  const current = state.devices.find((device) => device.id === registration.deviceId);
  const paired = current && matchesCredential(credential, current.credentialHash);
  const newPair = pairing && now < pairing.expiresAt && matchesCredential(credential, pairing.hash);
  if (!paired && !newPair) throw new Error("Unauthorized");
  // One APNs token represents one installation, even after the app restores an older backup.
  state.devices = state.devices.filter(
    (device) => device.id !== registration.deviceId && device.token !== registration.token,
  );
  state.devices.push({
    id: registration.deviceId,
    token: registration.token,
    preview: registration.preview,
    credentialHash: hashCredential(credential),
  });
  return Boolean(newPair);
}
