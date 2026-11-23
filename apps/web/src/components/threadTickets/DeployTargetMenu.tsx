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

  const detail = deploy.title?.split("\n").slice(1);

  return (
    <Menu>
      <MenuTrigger
        disabled={saving}
        aria-label={gt("Change the deploy target of {release}", { release: scopeLabel })}
        onPointerDown={keepFromRow}
        onClick={keepFromRow}
        render={
          <Badge
            size="sm"
            variant={DEPLOY_BADGE_VARIANT[deploy.tone]}
            render={<button type="button" />}
          />
        }
      >
        {deploy.label}
        <ChevronDownIcon aria-hidden className="size-2.5 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="end" width="content">
        {/* The badge opens this menu, so its hover detail reads at the top of it instead. */}
        {detail && detail.length > 0 ? (
          <>
            <p className="whitespace-pre-line px-2 py-1 text-muted-foreground text-xs">
              {detail.join("\n")}
            </p>
            <MenuSeparator />
          </>
        ) : null}
        <MenuGroupLabel>
          {gt("Target for release {release}", { release: scopeLabel })}
        </MenuGroupLabel>
        <MenuRadioGroup
          value={target.env}
          onValueChange={(value) => void choose(value as DeployTargetEnv)}
        >
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
  );
}
