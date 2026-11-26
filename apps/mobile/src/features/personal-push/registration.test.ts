import { expect, it, vi } from "vite-plus/test";
import * as SecureStore from "expo-secure-store";
import {
  connectPersonalPush,
  disconnectPersonalPush,
  forgetPersonalPush,
  getPersonalPushState,
} from "./registration";

vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { iosForkProductionPush: true } } },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-0000-0000-000000000001" }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "private",
}));
vi.mock("expo-notifications", () => ({
  getPermissionsAsync: async () => ({ granted: true }),
  requestPermissionsAsync: async () => ({ granted: true }),
  getDevicePushTokenAsync: async () => ({ type: "ios", data: "a".repeat(64) }),
}));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, AppState: {} }));

it("can forget an unreachable hub and pair a replacement without reinstalling", async () => {
  let saved: string | null = null;
  vi.mocked(SecureStore.getItemAsync).mockImplementation(async () => saved);
  vi.mocked(SecureStore.setItemAsync).mockImplementation(async (_key, value) => {
    saved = value;
  });
  vi.mocked(SecureStore.deleteItemAsync).mockImplementation(async () => {
    saved = null;
  });
  using request = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  const code = "a".repeat(43);
  await connectPersonalPush(`https://retired.tail123.ts.net/#t3-notifications=${code}`);
  expect(getPersonalPushState()).toMatchObject({ configured: true, error: "connection" });
  await disconnectPersonalPush();
  expect(getPersonalPushState().configured).toBe(true);
  await forgetPersonalPush();
  expect(saved).toBeNull();
  expect(getPersonalPushState()).toMatchObject({ configured: false, error: null });
  request.mockResolvedValue(
    new Response(JSON.stringify({ environments: [], deliveryError: null }), { status: 200 }),
  );
  await connectPersonalPush(`https://replacement.tail123.ts.net/#t3-notifications=${code}`);
  expect(getPersonalPushState()).toMatchObject({ configured: true, error: null });
  expect(saved).toContain("replacement.tail123.ts.net");
  await disconnectPersonalPush();
});
