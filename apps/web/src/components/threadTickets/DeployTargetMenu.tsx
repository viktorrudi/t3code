import { useGT } from "gt-react";
import {
  AuthOrchestrationOperateScope,
  type DeployTargetEnv,
  type EnvironmentId,
  type ThreadTicketDeploy,
} from "@t3tools/contracts";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ChevronDownIcon } from "lucide-react";
import { useState, type MouseEvent, type PointerEvent } from "react";

import { cn } from "~/lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useEnvironmentScope } from "../../state/session";
import { setDeployTarget } from "../../state/threadTickets";
import { Badge } from "../ui/badge";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuItemLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const DEPLOY_BADGE_VARIANT = {
  success: "success",
  info: "info",
  warning: "warning",
  muted: "secondary",
} as const satisfies Record<ThreadTicketDeploy["tone"], string>;

/** The order the picker lists them in; `none` says the release is not meant to go anywhere. */
const TARGET_CHOICES: ReadonlyArray<DeployTargetEnv> = ["DEV", "QA", "UAT", "PROD", "none"];

// The badge sits inside a clickable row; a click opens the menu without selecting the thread.
const keepFromRow = (event: MouseEvent | PointerEvent) => event.stopPropagation();

/**
 * The deploy badge as a picker: the menu edits the badge's release target, the same value
 * `deploy-status.mjs target` writes, so every ticket on that release follows it.
 */
export function DeployTargetMenu({
  environmentId,
  deploy,
}: {
  environmentId: EnvironmentId;
  deploy: ThreadTicketDeploy;
}) {
  const gt = useGT();
  const target = deploy.target;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const [saving, setSaving] = useState(false);

  if (target === undefined || !canOperate) {
    return (
      <Badge size="sm" variant={DEPLOY_BADGE_VARIANT[deploy.tone]}>
        {deploy.label}
      </Badge>
    );
  }

  const scopeLabel = `${target.project} ${target.release}`;
  const choose = async (env: DeployTargetEnv) => {
    if (env === target.env || saving) return;
    setSaving(true);
    const result = await runAtomCommand(
      appAtomRegistry,
      setDeployTarget,
      { environmentId, input: { project: target.project, release: target.release, env } },
      { reportFailure: false, reportDefect: false },
    );
    setSaving(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not set the target for {release}", { release: scopeLabel }),
        description: error instanceof Error ? error.message : gt("deploy-status rejected it."),
      });
    }
  };

  const badgeClass =
    "inline-flex h-full items-center rounded-[inherit] px-1 outline-none transition-colors hover:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
  const envLabel = deploy.url ? (
    <a
      href={deploy.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={deploy.title ?? deploy.label}
      onPointerDown={keepFromRow}
      onClick={keepFromRow}
      className={badgeClass}
    >
      {deploy.label}
    </a>
  ) : (
    <span className="px-1">{deploy.label}</span>
  );

  return (
    <Badge size="split" variant={DEPLOY_BADGE_VARIANT[deploy.tone]}>
      {deploy.title ? (
        <Tooltip>
          <TooltipTrigger render={envLabel} />
          <TooltipPopup side="top" className="whitespace-pre-line">
            {deploy.title}
          </TooltipPopup>
        </Tooltip>
      ) : (
        envLabel
      )}
      <span aria-hidden className="h-2.5 w-px self-center bg-current opacity-25" />
      <Menu>
        <MenuTrigger
          disabled={saving}
          aria-label={gt("Change the deploy target of {release}", { release: scopeLabel })}
          onPointerDown={keepFromRow}
          onClick={keepFromRow}
          render={
            <button
              type="button"
              className={cn(badgeClass, "cursor-pointer px-0.5 disabled:opacity-64")}
            />
          }
        >
          <ChevronDownIcon aria-hidden className="size-2.5 opacity-60" />
        </MenuTrigger>
        <MenuPopup align="end" width="content">
          <MenuRadioGroup
            value={target.env}
            onValueChange={(value) => void choose(value as DeployTargetEnv)}
          >
            <MenuGroupLabel>
              {gt("Target for release {release}", { release: scopeLabel })}
            </MenuGroupLabel>
            {TARGET_CHOICES.map((env) => (
              <MenuRadioItem key={env} value={env} closeOnClick>
                {env === "none" ? gt("No target") : env}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          {deploy.url ? (
            <>
              <MenuSeparator />
              <MenuItem render={<a href={deploy.url} target="_blank" rel="noopener noreferrer" />}>
                <MenuItemLabel>{gt("Open the deployment")}</MenuItemLabel>
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
    </Badge>
  );
}
