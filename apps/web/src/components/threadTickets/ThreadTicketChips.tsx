import { useGT } from "gt-react";
import type {
  EnvironmentId,
  JiraIssueDetails,
  JiraIssueStatusCategory,
  ThreadTicket,
  ThreadTicketDeploy,
} from "@t3tools/contracts";
import { useState, type MouseEvent, type PointerEvent } from "react";

import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "../../state/query";
import { jiraIssueAtom } from "../../state/threadTickets";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DeployTargetMenu } from "./DeployTargetMenu";

const DEPLOY_BADGE_VARIANT = {
  success: "success",
  info: "info",
  warning: "warning",
  muted: "secondary",
} as const satisfies Record<ThreadTicketDeploy["tone"], string>;

export const JIRA_STATUS_BADGE_VARIANT = {
  new: "secondary",
  indeterminate: "info",
  done: "success",
  unknown: "secondary",
} as const satisfies Record<JiraIssueStatusCategory, string>;

// The chips sit inside a clickable row; a click opens the link without selecting the thread.
const keepFromRow = (event: MouseEvent | PointerEvent) => event.stopPropagation();

export function TicketDeployBadge({
  environmentId,
  ticketKey,
  deploy,
}: {
  environmentId?: EnvironmentId | undefined;
  ticketKey: string;
  deploy: ThreadTicketDeploy;
}) {
  const badge = (
    <Badge
      size="sm"
      variant={DEPLOY_BADGE_VARIANT[deploy.tone]}
      render={
        deploy.url ? (
          <a
            href={deploy.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={deploy.title ?? deploy.label}
            onPointerDown={keepFromRow}
            onClick={keepFromRow}
          />
        ) : undefined
      }
    >
      {deploy.label}
    </Badge>
  );
  const plain = deploy.title ? (
    <Tooltip>
      <TooltipTrigger render={badge} />
      <TooltipPopup side="top" className="whitespace-pre-line">
        {deploy.title}
      </TooltipPopup>
    </Tooltip>
  ) : (
    badge
  );
  if (environmentId === undefined || (deploy.target ?? deploy.assign) === undefined) return plain;
  return (
    <DeployTargetMenu
      environmentId={environmentId}
      ticketKey={ticketKey}
      deploy={deploy}
      fallback={plain}
    />
  );
}

function JiraAssigneeAvatar({ assignee }: { assignee: NonNullable<JiraIssueDetails["assignee"]> }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = assignee.avatarUrl;
  const avatar =
    url === null || failedUrl === url ? (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-3xs font-medium text-muted-foreground">
        {assignee.displayName.slice(0, 1).toUpperCase()}
      </span>
    ) : (
      <img
        alt=""
        src={url}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="size-4 shrink-0 rounded-full bg-muted object-cover"
        onError={() => setFailedUrl(url)}
      />
    );
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span role="img" aria-label={assignee.displayName} className="inline-flex" />}
      >
        {avatar}
      </TooltipTrigger>
      <TooltipPopup side="top">{assignee.displayName}</TooltipPopup>
    </Tooltip>
  );
}

/** The sidebar's leading ticket segment: key, workflow status, deploy target and assignee. */
function TicketDetails({
  ticket,
  environmentId,
  lease,
}: {
  ticket: ThreadTicket;
  environmentId: EnvironmentId | undefined;
  lease: boolean;
}) {
  const gt = useGT();
  const query = useEnvironmentQuery(
    lease && environmentId !== undefined
      ? jiraIssueAtom({ environmentId, input: { key: ticket.key } })
      : null,
  );
  const issue = query.data;
  const keyLink = (
    <a
      href={ticket.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={gt("Open {key} in Jira", { key: ticket.key })}
      onPointerDown={keepFromRow}
      onClick={keepFromRow}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-sm font-medium text-foreground tabular-nums outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {ticket.flag ? <span aria-hidden>{ticket.flag}</span> : null}
      <span>{ticket.key}</span>
    </a>
  );
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Tooltip disabled={issue === null}>
        <TooltipTrigger render={keyLink} />
        {issue ? (
          <TooltipPopup side="top" className="max-w-80">
            {issue.issueType ? `${issue.issueType} · ` : ""}
            {issue.summary}
          </TooltipPopup>
        ) : null}
      </Tooltip>
      {issue ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Badge
                size="sm"
                variant={JIRA_STATUS_BADGE_VARIANT[issue.status.category]}
                className="min-w-0 max-w-24 shrink"
              />
            }
          >
            <span className="truncate">{issue.status.name}</span>
          </TooltipTrigger>
          <TooltipPopup side="top">{issue.status.name}</TooltipPopup>
        </Tooltip>
      ) : query.error !== null ? (
        <Tooltip>
          <TooltipTrigger render={<Badge size="sm" variant="warning" />}>
            {gt("Jira?")}
          </TooltipTrigger>
          <TooltipPopup side="top">{query.error}</TooltipPopup>
        </Tooltip>
      ) : null}
      {ticket.deploy ? (
        <span className="inline-flex shrink-0">
          <TicketDeployBadge
            environmentId={environmentId}
            ticketKey={ticket.key}
            deploy={ticket.deploy}
          />
        </span>
      ) : null}
      {issue?.assignee ? <JiraAssigneeAvatar assignee={issue.assignee} /> : null}
    </span>
  );
}

/** Linked Jira tickets with their flag, key and deploy state. */
export function ThreadTicketChips({
  tickets,
  environmentId,
  className,
  showJiraDetails = false,
  leaseJiraDetails = false,
}: {
  tickets: ReadonlyArray<ThreadTicket>;
  environmentId?: EnvironmentId;
  className?: string;
  /** The leading sidebar variant: adds the Jira workflow status and assignee to each ticket. */
  showJiraDetails?: boolean;
  /** Fetch those details; pass the row's viewport lease so off-screen rows stay idle. */
  leaseJiraDetails?: boolean;
}) {
  const gt = useGT();
  if (tickets.length === 0) return null;
  if (showJiraDetails) {
    return (
      <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
        {tickets.map((ticket) => (
          <TicketDetails
            key={ticket.key}
            ticket={ticket}
            environmentId={environmentId}
            lease={leaseJiraDetails}
          />
        ))}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex min-w-0 shrink-0 items-center gap-1.5", className)}>
      {tickets.map((ticket) => (
        <span key={ticket.key} className="inline-flex shrink-0 items-center gap-1">
          <a
            href={ticket.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={gt("Open {key} in Jira", { key: ticket.key })}
            onPointerDown={keepFromRow}
            onClick={keepFromRow}
            className="inline-flex items-center gap-0.5 rounded-sm tabular-nums outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {ticket.flag ? <span aria-hidden>{ticket.flag}</span> : null}
            <span>{ticket.key}</span>
          </a>
          {ticket.deploy ? (
            <TicketDeployBadge
              environmentId={environmentId}
              ticketKey={ticket.key}
              deploy={ticket.deploy}
            />
          ) : null}
        </span>
      ))}
    </span>
  );
}
