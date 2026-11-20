import {
  WS_METHODS,
  type EnvironmentId,
  type ThreadId,
  type ThreadTicket,
} from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";

const threadTicketsAtom = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "environment-data:thread-tickets",
  tag: WS_METHODS.threadTicketsSubscribe,
});

export const jiraIssueAtom = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:jira-issue",
  tag: WS_METHODS.jiraGetIssue,
  staleTimeMs: 30_000,
  refreshIntervalMs: 120_000,
});

export const transitionJiraIssue = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:jira-issue:transition",
  tag: WS_METHODS.jiraTransitionIssue,
});

const NO_TICKETS: ReadonlyArray<ThreadTicket> = [];

/** The Jira tickets linked to a thread, with their deploy state when one is known. */
export function useThreadTickets(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): ReadonlyArray<ThreadTicket> {
  const query = useEnvironmentQuery(
    environmentId === null ? null : threadTicketsAtom({ environmentId, input: {} }),
  );
  if (threadId === null) return NO_TICKETS;
  return query.data?.threads[threadId] ?? NO_TICKETS;
}
