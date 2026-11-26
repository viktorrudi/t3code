import {
  SENSONEO_JIRA_HOST,
  type ThreadIssueLink,
  type ThreadTicket,
  type ThreadTicketDeploy,
} from "@t3tools/contracts";

const JIRA_TRACKER_KIND = "jira";

/**
 * One Jira ticket on a thread, however it was linked: the skill's annotation, a native thread
 * issue link, or both. Both name the same ticket, so it is shown once.
 */
export interface ThreadJiraTicket {
  key: string;
  host: string;
  url: string;
  /** The native link, which opens the issue under its own project. */
  link: ThreadIssueLink | null;
  /** The skill's annotation names it; a sidebar row shows such a ticket beside its issue chip. */
  annotated: boolean;
  deploy: ThreadTicketDeploy | undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return SENSONEO_JIRA_HOST;
  }
}

const identity = (host: string, key: string) => `${host.trim().toLowerCase()} ${key.trim()}`;

/** Annotation tickets first, in their order, then native Jira links the annotations lack. */
export function mergeThreadJiraTickets(
  tickets: ReadonlyArray<ThreadTicket>,
  issues: ReadonlyArray<ThreadIssueLink> | undefined,
): ThreadJiraTicket[] {
  const native = new Map<string, ThreadIssueLink>();
  for (const link of issues ?? []) {
    if (link.tracker !== JIRA_TRACKER_KIND) continue;
    const id = identity(link.host, link.key);
    if (!native.has(id)) native.set(id, link);
  }
  const merged: ThreadJiraTicket[] = [];
  const seen = new Set<string>();
  for (const ticket of tickets) {
    const host = hostOf(ticket.url);
    const id = identity(host, ticket.key);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push({
      key: ticket.key,
      host,
      url: ticket.url,
      link: native.get(id) ?? null,
      annotated: true,
      deploy: ticket.deploy,
    });
  }
  for (const [id, link] of native) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push({
      key: link.key,
      host: link.host.toLowerCase(),
      url: link.url,
      link,
      annotated: false,
      deploy: undefined,
    });
  }
  return merged;
}

/** Where the native Issues view finds this ticket; a legacy annotation reads through the thread's project. */
export function jiraTicketIssueTarget(ticket: ThreadJiraTicket, threadProjectId: string) {
  return {
    projectId: ticket.link?.projectId ?? threadProjectId,
    tracker: JIRA_TRACKER_KIND,
    host: ticket.host,
    scope: ticket.link?.scope ?? ticket.key.split("-")[0] ?? ticket.key,
    key: ticket.key,
    url: ticket.url,
  };
}
