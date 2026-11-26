import * as NodePath from "node:path";
import { EnvironmentId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { makeApnsSender, type ApnsConfig } from "../push-hub/apns.ts";
import { notificationCandidates } from "../push-hub/notifications.ts";
import { observeCandidates, readHubState, writePrivateJson } from "../push-hub/store.ts";
import { prepareDelivery, finishDelivery } from "../push-hub/delivery.ts";
import { matchesCredential } from "../push-hub/api.ts";
import { credentialHash, WatchError, type WatchGrant } from "./policy.ts";

export async function watchPush(
  directory: string,
  apns: ApnsConfig | undefined,
  readGrants: () => Promise<WatchGrant[]>,
  projectOf: (environmentId: string, threadId: string) => string | undefined,
) {
  const file = NodePath.join(directory, "watch-notifications.json");
  const state = await readHubState(file);
  const send = apns && makeApnsSender(apns);
  let serial = Promise.resolve();
  const transact = <T>(operation: () => Promise<T>) => {
    const next = serial.then(operation);
    serial = next.then(
      () => {},
      () => {},
    );
    return next;
  };
  const save = () => writePrivateJson(file, state);
  const allowed = (grant: WatchGrant | undefined, environmentId: string, threadId: string) =>
    grant !== undefined &&
    grant.expiresAt > Date.now() &&
    grant.projects[environmentId]?.includes(projectOf(environmentId, threadId) ?? "");
  return {
    register: (token: string, deviceToken: string, preview: boolean) =>
      transact(async () => {
        if (!send)
          throw new WatchError(
            503,
            "Direct Watch notifications are not configured on your Mac yet.",
          );
        const grant = (await readGrants()).find(
          (g) => g.pushCredentialHash && matchesCredential(token, g.pushCredentialHash),
        );
        if (!grant || grant.expiresAt <= Date.now())
          throw new WatchError(401, "Notification registration expired. Pair this Watch again.");
        state.devices = state.devices.filter((d) => d.id !== grant.id && d.token !== deviceToken);
        state.devices.push({
          id: grant.id,
          token: deviceToken,
          preview,
          credentialHash: credentialHash(token),
        });
        await save();
        return { registered: true };
      }),
    observe: (
      environmentId: string,
      threads: Map<string, OrchestrationV2ThreadShell>,
      initial: boolean,
    ) =>
      transact(async () => {
        if (
          observeCandidates(
            state,
            environmentId,
            notificationCandidates(EnvironmentId.make(environmentId), threads, Date.now()),
            [...threads.keys()],
            Date.now(),
            initial,
          )
        )
          await save();
      }),
    deliver: () =>
      transact(async () => {
        if (!send) return;
        const grants = await readGrants();
        state.devices = state.devices.filter((d) =>
          grants.some((g) => g.id === d.id && g.expiresAt > Date.now()),
        );
        state.pending = state.pending.filter((job) =>
          allowed(
            grants.find((g) => g.id === job.deviceId),
            job.candidate.environmentId,
            job.candidate.threadId,
          ),
        );
        const delivery = prepareDelivery(state, Date.now());
        if (!delivery) return;
        const result = await send(
          delivery.device.token,
          delivery.job.candidate,
          delivery.device.preview,
        ).catch(() => ({ status: 503, reason: "TransportUnavailable" }));
        finishDelivery(state, delivery, Date.now(), result);
        await save();
      }),
    drain: () => serial,
  };
}
