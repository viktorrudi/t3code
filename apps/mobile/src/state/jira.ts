import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS, type EnvironmentId, type ThreadTicketAnnotations } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentServerConfigsAtom } from "./server";

export const jira = {
  threadTickets: createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
    label: "mobile:jira:thread-tickets",
    tag: WS_METHODS.threadTicketsSubscribe,
  }),
  issue: createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
    label: "mobile:jira:issue",
    tag: WS_METHODS.jiraGetIssue,
    staleTimeMs: 30_000,
  }),
  link: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:jira:link",
    tag: WS_METHODS.threadTicketsSetLink,
    concurrency: {
      mode: "singleFlight",
      key: ({ environmentId, input }) =>
        JSON.stringify([environmentId, input.threadId, input.key, input.linked]),
    },
  }),
  setDeployTarget: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:jira:set-deploy-target",
    tag: WS_METHODS.threadTicketsSetDeployTarget,
  }),
  assignRelease: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:jira:assign-release",
    tag: WS_METHODS.threadTicketsAssignRelease,
  }),
  transition: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "mobile:jira:transition",
    tag: WS_METHODS.jiraTransitionIssue,
  }),
};

export const jiraThreadAnnotationsAtom = Atom.make((get) => {
  const annotations = new Map<EnvironmentId, ThreadTicketAnnotations["threads"]>();
  for (const [environmentId, config] of get(environmentServerConfigsAtom)) {
    if (config.environment.capabilities.jiraThreadLinks !== true) continue;
    const result = get(jira.threadTickets({ environmentId, input: {} }));
    const snapshot = AsyncResult.getOrElse(result, () => null);
    if (snapshot) annotations.set(environmentId, snapshot.threads);
  }
  return annotations;
}).pipe(Atom.withLabel("mobile:jira:thread-annotations"));
