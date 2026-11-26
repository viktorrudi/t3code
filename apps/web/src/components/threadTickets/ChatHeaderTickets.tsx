import { T, useGT } from "gt-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  Link2Icon,
  Link2OffIcon,
  PanelRightIcon,
} from "lucide-react";
import { Fragment, useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useRightPanelStore } from "~/rightPanelStore";
import { useQuietThreadShell, useServerConfigs } from "~/state/entities";
import { useThreadTickets } from "../../state/threadTickets";
import { IssueGlyph } from "../issue/issuePresentation";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import {
  JiraTicketLinkDialog,
  JiraTicketPicker,
  useChangeJiraTicketLink,
  useJiraTicketLinkProject,
} from "./JiraTicketPicker";
import { TicketDeployBadge } from "./ThreadTicketChips";
import {
  jiraTicketIssueTarget,
  mergeThreadJiraTickets,
  type ThreadJiraTicket,
} from "@t3tools/client-runtime/thread-jira-tickets";

/**
 * The thread's Jira tickets as one compact entry: a menu to open each in Issues or Jira, copy its
 * /ticket command and change links, beside each ticket's deploy picker. Status, assignee and the
 * rest live in the Issues view.
 */
export function ChatHeaderTickets({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const gt = useGT();
  const threadRef = { environmentId, threadId };
  const thread = useQuietThreadShell(threadRef);
  const annotations = useThreadTickets(environmentId, threadId);
  const configs = useServerConfigs();
  const linkProjectId = useJiraTicketLinkProject(environmentId, threadId);
  const changeLink = useChangeJiraTicketLink(environmentId);
  const [linking, setLinking] = useState(false);
  const [pending, setPending] = useState(false);
  const { copyToClipboard } = useCopyToClipboard<string>({
    onCopy: (command) =>
      toastManager.add({ type: "success", title: gt("Copied {command}", { command }) }),
  });
  const tickets = mergeThreadJiraTickets(annotations, thread?.issues);

  if (tickets.length === 0) {
    return (
      <div className="flex shrink-0 items-center empty:hidden">
        <JiraTicketPicker environmentId={environmentId} threadId={threadId} tickets={annotations} />
      </div>
    );
  }

  const issuesAvailable = configs.get(environmentId)?.environment.capabilities.issues === true;
  const openInIssues = (ticket: ThreadJiraTicket) => {
    if (!issuesAvailable || thread === null) {
      window.open(ticket.url, "_blank", "noopener,noreferrer");
      return;
    }
    useRightPanelStore
      .getState()
      .openIssue(threadRef, jiraTicketIssueTarget(ticket, thread.projectId));
  };
  const unlink = async (ticket: ThreadJiraTicket) => {
    if (pending) return;
    setPending(true);
    await changeLink(threadId, ticket.key, false);
    setPending(false);
  };
  const [first] = tickets;
  const ticketItems = (ticket: ThreadJiraTicket) => (
    <>
      <MenuItem onClick={() => openInIssues(ticket)}>
        <PanelRightIcon aria-hidden />
        <T>Open in Issues</T>
      </MenuItem>
      <MenuItem render={<a href={ticket.url} target="_blank" rel="noopener noreferrer" />}>
        <ExternalLinkIcon aria-hidden />
        <T>Open in Jira</T>
      </MenuItem>
      <MenuItem onClick={() => copyToClipboard(`/ticket ${ticket.key}`, `/ticket ${ticket.key}`)}>
        <CopyIcon aria-hidden />
        <T>Copy /ticket</T>
      </MenuItem>
      {linkProjectId !== null ? (
        <MenuItem disabled={pending} onClick={() => void unlink(ticket)}>
          <Link2OffIcon aria-hidden />
          <T>Unlink from this chat</T>
        </MenuItem>
      ) : null}
    </>
  );

  return (
    <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="xs"
              variant="ghost"
              aria-label={
                tickets.length === 1
                  ? gt("Jira ticket {key}", { key: first!.key })
                  : gt("{count} Jira tickets", { count: tickets.length })
              }
            />
          }
        >
          <IssueGlyph.issue aria-hidden />
          <span className="tabular-nums">{first!.key}</span>
          {tickets.length > 1 ? (
            <span className="text-muted-foreground tabular-nums">+{tickets.length - 1}</span>
          ) : null}
          <ChevronDownIcon aria-hidden className="text-muted-foreground" />
        </MenuTrigger>
        <MenuPopup align="end" className="min-w-52">
          {tickets.length === 1
            ? ticketItems(first!)
            : tickets.map((ticket, index) => (
                <Fragment key={ticket.key}>
                  {index > 0 ? <MenuSeparator /> : null}
                  <MenuGroup>
                    <MenuGroupLabel>{ticket.key}</MenuGroupLabel>
                    {ticketItems(ticket)}
                  </MenuGroup>
                </Fragment>
              ))}
          {linkProjectId !== null ? (
            <>
              <MenuSeparator />
              <MenuItem onClick={() => setLinking(true)}>
                <Link2Icon aria-hidden />
                <T>Link another ticket…</T>
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
      {tickets.map((ticket) =>
        ticket.deploy ? (
          <TicketDeployBadge
            key={ticket.key}
            environmentId={environmentId}
            ticketKey={ticket.key}
            deploy={ticket.deploy}
          />
        ) : null,
      )}
      {linking && linkProjectId !== null ? (
        <JiraTicketLinkDialog
          environmentId={environmentId}
          projectId={linkProjectId}
          threadId={threadId}
          tickets={annotations}
          onClose={() => setLinking(false)}
        />
      ) : null}
    </div>
  );
}
