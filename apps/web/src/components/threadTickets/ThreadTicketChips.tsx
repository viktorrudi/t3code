import { useGT } from "gt-react";
import type { EnvironmentId, ThreadTicketDeploy } from "@t3tools/contracts";
import type { MouseEvent, PointerEvent } from "react";

import { IssueGlyph } from "../issue/issuePresentation";
import { Badge } from "../ui/badge";
import { InlineButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DeployTargetMenu } from "./DeployTargetMenu";
import type { ThreadJiraTicket } from "./threadJiraTickets.logic";

const DEPLOY_BADGE_VARIANT = {
  success: "success",
  info: "info",
  warning: "warning",
  muted: "secondary",
} as const satisfies Record<ThreadTicketDeploy["tone"], string>;

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

/**
 * A sidebar row's Jira tickets. A ticket the thread also links natively already shows as the
 * row's issue chip, so only its deploy badge is added; a legacy annotation-only ticket gets one
 * key chip that opens the same native issue view.
 */
export function ThreadTicketChips({
  tickets,
  environmentId,
  onOpen,
}: {
  tickets: ReadonlyArray<ThreadJiraTicket>;
  environmentId?: EnvironmentId;
  onOpen: (ticket: ThreadJiraTicket) => void;
}) {
  const gt = useGT();
  const shown = tickets.filter((ticket) => ticket.annotated);
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map((ticket) => (
        <span key={ticket.key} className="inline-flex shrink-0 items-center gap-1">
          {ticket.link === null ? (
            <InlineButton
              tone="muted"
              aria-label={gt("Open {key}", { key: ticket.key })}
              onPointerDown={keepFromRow}
              onClick={(event) => {
                event.stopPropagation();
                onOpen(ticket);
              }}
            >
              <IssueGlyph.issue aria-hidden className="size-3 shrink-0" />
              <span className="max-w-16 truncate text-xs font-normal text-secondary-label tabular-nums">
                {ticket.key}
              </span>
            </InlineButton>
          ) : null}
          {ticket.deploy ? (
            <TicketDeployBadge
              environmentId={environmentId}
              ticketKey={ticket.key}
              deploy={ticket.deploy}
            />
          ) : null}
        </span>
      ))}
    </>
  );
}
