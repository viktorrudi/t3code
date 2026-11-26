import * as Schema from "effect/Schema";

const BoundedText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
export const DeviceRegistration = Schema.Struct({
  deviceId: Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/i)),
  token: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64,200}$/i)),
  preview: Schema.Boolean,
});
export const HubCredential = Schema.Struct({
  origin: BoundedText,
  deviceId: DeviceRegistration.fields.deviceId,
  credential: BoundedText,
  preview: Schema.Boolean,
});
export type HubCredential = typeof HubCredential.Type;
export const HubStatus = Schema.Struct({
  environments: Schema.Array(
    Schema.Struct({
      environmentId: Schema.String,
      name: Schema.String,
      connected: Schema.Boolean,
    }),
  ),
  deliveryError: Schema.NullOr(Schema.String),
});
export type HubStatus = typeof HubStatus.Type;

export function hubOrigin(input: string): string {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".ts.net") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Use the notification hub's HTTPS Tailscale address.");
  }
  return url.origin;
}
