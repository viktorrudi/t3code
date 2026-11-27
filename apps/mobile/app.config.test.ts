import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { afterEach, expect, it, vi } from "vite-plus/test";

import appleAppSiteAssociation from "../web/public/.well-known/apple-app-site-association.json";
import assetLinks from "../web/public/.well-known/assetlinks.json";

// Keep config parsing independent of local env files and build credentials.
vi.mock("../../scripts/lib/public-config.ts", () => ({
  loadRepoEnv: () =>
    Object.fromEntries(
      [
        "APP_VARIANT",
        "T3CODE_IOS_FORK",
        "T3CODE_IOS_FORK_DEVICE_BUILD",
        "T3CODE_IOS_FORK_BUNDLE_ID",
        "T3CODE_IOS_FORK_TEAM_ID",
        "T3CODE_RELAY_URL",
        "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
        "EXPO_PUBLIC_OTLP_TRACES_TOKEN",
      ].flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
    ),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig(variant: string | undefined, fork = false) {
  vi.resetModules();
  vi.stubEnv("APP_VARIANT", variant);
  vi.stubEnv("T3CODE_IOS_FORK", fork ? "1" : undefined);
  return (await import("./app.config.ts")).default;
}

it.each(["prod", ""])("rejects APP_VARIANT=%j before selecting production IDs", async (value) => {
  await expect(loadConfig(value)).rejects.toThrow(
    "APP_VARIANT must be development, preview, or production.",
  );
});

it.each([
  [undefined, "com.t3tools.t3code"],
  ["development", "com.t3tools.t3code.dev"],
  ["preview", "com.t3tools.t3code.preview"],
  ["production", "com.t3tools.t3code"],
])("keeps the iOS and Android identifiers for APP_VARIANT=%j", async (value, identifier) => {
  const config = await loadConfig(value);
  expect(config.ios?.bundleIdentifier).toBe(identifier);
  expect(config.android?.package).toBe(identifier);
  // Copied thread links open this app only while app.t3.codes lists it.
  const host = new URL(DEFAULT_HOSTED_APP_URL).host;
  expect(config.ios?.associatedDomains).toContain(`applinks:${host}`);
  expect(appleAppSiteAssociation.applinks.details[0]?.appIDs).toContain(
    `${config.ios?.appleTeamId}.${identifier}`,
  );
  expect(config.android?.intentFilters?.[0]?.data).toEqual([
    { scheme: "https", host, pathPrefix: "/threads/" },
  ]);
  expect(assetLinks.map((link) => link.target.package_name)).toContain(identifier);
});

it.each([
  ["production", "", "t3code-personal"],
  ["preview", ".preview", "t3code-personalpreview"],
  ["development", ".dev", "t3code-personaldev"],
])("isolates the %s fork's Apple identity and hosted services", async (variant, suffix, scheme) => {
  vi.stubEnv("T3CODE_IOS_FORK_BUNDLE_ID", "com.example.personal");
  vi.stubEnv("T3CODE_IOS_FORK_TEAM_ID", "ABCDEFGHIJ");
  vi.stubEnv("T3CODE_RELAY_URL", "https://upstream.example");
  vi.stubEnv("EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_example");
  vi.stubEnv("EXPO_PUBLIC_OTLP_TRACES_TOKEN", "example");
  const config = await loadConfig(variant, true);
  const id = `com.example.personal${suffix}`;
  expect(config.platforms).toEqual(["ios"]);
  expect(config.extra?.iosForkProductionPush).toBe(variant === "production");
  expect(config.scheme).toBe(scheme);
  expect(config.ios?.bundleIdentifier).toBe(id);
  expect(config.ios?.appleTeamId).toBe("ABCDEFGHIJ");
  expect(config.ios?.associatedDomains).toBeUndefined();
  expect(config.ios?.entitlements?.["keychain-access-groups"]).toEqual([
    `$(AppIdentifierPrefix)${id}`,
  ]);
  expect(config.plugins).toContainEqual([
    "expo-widgets",
    expect.objectContaining({
      bundleIdentifier: `${id}.widgets`,
      groupIdentifier: `group.${id}`,
    }),
  ]);
  expect(config.plugins).toContainEqual([
    "expo-sharing",
    expect.objectContaining({
      ios: expect.objectContaining({
        extensionBundleIdentifier: `${id}.sharing`,
        appGroupId: `group.${id}`,
      }),
    }),
  ]);
  expect(config.plugins).toContainEqual([
    "expo-notifications",
    expect.objectContaining({ mode: variant === "development" ? "development" : "production" }),
  ]);
  expect(config.plugins).toContainEqual([
    "./plugins/withoutIosPersonalTeamCapabilities.cjs",
    { keepAppGroups: true, keepPush: true },
  ]);
  expect(config.plugins).toContainEqual([
    "expo-widgets",
    expect.objectContaining({ enablePushNotifications: false }),
  ]);
  expect(config.plugins).toContain("./plugins/withPersonalWatch.cjs");
  expect(config.updates).toEqual({ enabled: false });
  expect(config.owner).toBeUndefined();
  expect(config.extra?.eas.projectId).toBeUndefined();
  expect(config.extra?.relay.url).toBeNull();
  expect(config.extra?.clerk.publishableKey).toBeNull();
  expect(config.extra?.observability.tracesToken).toBeNull();
});

it("rejects an upstream app identifier for a fork build", async () => {
  vi.stubEnv("T3CODE_IOS_FORK_BUNDLE_ID", "com.t3tools.t3code");
  await expect(loadConfig("production", true)).rejects.toThrow(
    "Use a separate reverse-DNS bundle ID",
  );
});

it("keeps direct-device builds on development APNs without enabling the production hub", async () => {
  vi.stubEnv("T3CODE_IOS_FORK_DEVICE_BUILD", "1");
  const config = await loadConfig("production", true);
  expect(config.extra?.iosForkProductionPush).toBe(false);
  expect(config.plugins).toContainEqual([
    "expo-notifications",
    expect.objectContaining({ mode: "development" }),
  ]);
});

it("keeps the personal Watch app out of upstream builds", async () => {
  expect((await loadConfig("production")).plugins).not.toContain("./plugins/withPersonalWatch.cjs");
});
