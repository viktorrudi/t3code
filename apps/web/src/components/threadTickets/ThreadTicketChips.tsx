import { useGT } from "gt-react";
import type { EnvironmentId, ThreadTicket, ThreadTicketDeploy } from "@t3tools/contracts";
import type { MouseEvent, PointerEvent } from "react";

import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DeployTargetMenu } from "./DeployTargetMenu";

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

/** Linked Jira tickets with their flag, key and deploy state. */
export function ThreadTicketChips({
  tickets,
  environmentId,
  className,
}: {
  tickets: ReadonlyArray<ThreadTicket>;
  environmentId?: EnvironmentId;
  className?: string;
}) {
  const gt = useGT();
  if (tickets.length === 0) return null;
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
