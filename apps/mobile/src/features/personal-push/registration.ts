import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as Schema from "effect/Schema";
import { AppState, Platform } from "react-native";
import { HubCredential, HubStatus, hubOrigin } from "./protocol";

export const personalPushAvailable =
  Platform.OS === "ios" && Constants.expoConfig?.extra?.iosForkProductionPush === true;
const storageKey = "personal-notification-hub";
type State = {
  readonly configured: boolean;
  readonly busy: boolean;
  readonly preview: boolean;
  readonly error: "permission" | "registration" | "connection" | null;
  readonly status: HubStatus | null;
};
let state: State = { configured: false, busy: false, preview: true, error: null, status: null };
const listeners = new Set<() => void>();
let serial = Promise.resolve();
export const getPersonalPushState = () => state;
export function subscribePersonalPush(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function update(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
const decodeHubCredential = Schema.decodeUnknownSync(HubCredential);
const decodeHubStatus = Schema.decodeUnknownSync(HubStatus);
async function readCredential(): Promise<HubCredential | null> {
  const value = await SecureStore.getItemAsync(storageKey);
  if (!value) return null;
  try {
    return decodeHubCredential(JSON.parse(value));
  } catch {
    await SecureStore.deleteItemAsync(storageKey);
    update({ configured: false, status: null, error: "registration" });
    return null;
  }
}
async function request(credential: HubCredential, method: "POST" | "DELETE", body?: unknown) {
  const response = await fetch(`${hubOrigin(credential.origin)}/register`, {
    method,
    headers: {
      Authorization: `Bearer ${credential.credential}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(
      response.status === 401 || response.status === 400 ? "registration" : "connection",
    );
  return method === "POST" ? decodeHubStatus(await response.json()) : null;
}
function enqueue(operation: () => Promise<void>) {
  const next = serial.then(async () => {
    update({ busy: true });
    try {
      await operation();
    } catch (error) {
      update({
        error:
          error instanceof Error && error.message === "permission"
            ? "permission"
            : error instanceof Error && error.message === "registration"
              ? "registration"
              : "connection",
      });
    } finally {
      update({ busy: false });
    }
  });
  serial = next;
  return next;
}
async function register(credential: HubCredential) {
  update({ configured: true, preview: credential.preview });
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) throw new Error("permission");
  const token = await Notifications.getDevicePushTokenAsync();
  if (token.type !== "ios" || typeof token.data !== "string") throw new Error("registration");
  const status = await request(credential, "POST", {
    deviceId: credential.deviceId,
    token: token.data,
    preview: credential.preview,
  });
  update({ error: null, status });
}
export function refreshPersonalPush() {
  return enqueue(async () => {
    const credential = await readCredential();
    if (credential) await register(credential);
  });
}
export function connectPersonalPush(invitation: string) {
  return enqueue(async () => {
    const link = new URL(invitation.trim());
    const origin = hubOrigin(link.origin);
    const code = new URLSearchParams(link.hash.slice(1)).get("t3-notifications");
    if (!code || !/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error("registration");
    const previous = await readCredential();
    if (previous) throw new Error("registration");
    const permission = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: true },
    });
    if (!permission.granted) throw new Error("permission");
    const credential = { origin, credential: code, deviceId: Crypto.randomUUID(), preview: true };
    // Persist before the one-use invitation is consumed; retries must retain the same device identity.
    await SecureStore.setItemAsync(storageKey, JSON.stringify(credential), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    await register(credential);
  });
}
export function setPersonalPushPreview(preview: boolean) {
  return enqueue(async () => {
    const credential = await readCredential();
    if (!credential) return;
    const next = { ...credential, preview };
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) throw new Error("permission");
    await SecureStore.setItemAsync(storageKey, JSON.stringify(next), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    await register(next);
  });
}
export function disconnectPersonalPush() {
  return enqueue(async () => {
    const credential = await readCredential();
    if (credential) {
      try {
        await request(credential, "DELETE");
      } catch (error) {
        if (!(error instanceof Error && error.message === "registration")) throw error;
      }
    }
    await SecureStore.deleteItemAsync(storageKey);
    update({ configured: false, error: null, status: null });
  });
}
export function forgetPersonalPush() {
  return enqueue(async () => {
    await SecureStore.deleteItemAsync(storageKey);
    update({ configured: false, error: null, status: null });
  });
}
export function installPersonalPushRegistration() {
  if (!personalPushAvailable) return () => {};
  void refreshPersonalPush();
  const active = AppState.addEventListener("change", (value) => {
    if (value === "active") void refreshPersonalPush();
  });
  const token = Notifications.addPushTokenListener(() => {
    void refreshPersonalPush();
  });
  return () => {
    active.remove();
    token.remove();
  };
}
