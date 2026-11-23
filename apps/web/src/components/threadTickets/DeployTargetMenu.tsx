import { useGT } from "gt-react";
import {
  AuthOrchestrationOperateScope,
  type DeployTargetEnv,
  type EnvironmentId,
  type ThreadTicketDeploy,
} from "@t3tools/contracts";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { ChevronDownIcon } from "lucide-react";
import { useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";

import { cn } from "~/lib/utils";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useEnvironmentScope } from "../../state/session";
import { assignRelease, setDeployTarget } from "../../state/threadTickets";
import { Badge } from "../ui/badge";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuItemDetail,
  MenuItemLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
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
const NO_RELEASE = "none";

// The badge sits inside a clickable row; a click opens the menu without selecting the thread.
const keepFromRow = (event: MouseEvent | PointerEvent) => event.stopPropagation();

function RadioRow({ label, detail }: { label: ReactNode; detail?: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex-1 tabular-nums">{label}</span>
      {detail ? <span className="text-muted-foreground text-xs">{detail}</span> : null}
      <span className="flex w-3.5 justify-end">
        <MenuRadioItemIndicator />
      </span>
    </span>
  );
}

/**
 * The deploy badge as a picker with the two levels the deploy state has: which release the ticket
 * ships in (`release-ledger assign`, this ticket only), and which env that release targets
 * (`deploy-status target`, every ticket on the release follows).
 */
export function DeployTargetMenu({
  environmentId,
  ticketKey,
  deploy,
  fallback,
}: {
  environmentId: EnvironmentId;
  ticketKey: string;
  deploy: ThreadTicketDeploy;
  fallback: ReactNode;
}) {
  const gt = useGT();
  const { target, assign } = deploy;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const [saving, setSaving] = useState(false);

  if (!canOperate) return fallback;

  const save = async (
    run: () => ReturnType<typeof runAtomCommand>,
    failureTitle: string,
  ): Promise<void> => {
    setSaving(true);
    const result = await run();
    setSaving(false);
    if (result._tag !== "Failure") return;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: failureTitle,
      description: error instanceof Error ? error.message : gt("deploy-status rejected it."),
    });
  };

  const chooseEnv = (env: DeployTargetEnv) => {
    if (target === undefined || env === target.env || saving) return;
    void save(
      () =>
        runAtomCommand(
          appAtomRegistry,
          setDeployTarget,
          { environmentId, input: { project: target.project, release: target.release, env } },
          { reportFailure: false, reportDefect: false },
        ),
      gt("Could not set the target for {release}", { release: target.release }),
    );
  };

  const chooseRelease = (release: string) => {
    if (release === (assign?.current ?? NO_RELEASE) || saving) return;
    void save(
      () =>
        runAtomCommand(
          appAtomRegistry,
          assignRelease,
          { environmentId, input: { key: ticketKey, release } },
          { reportFailure: false, reportDefect: false },
        ),
      gt("Could not move {key} to {release}", {
        key: ticketKey,
        release: release === NO_RELEASE ? gt("no release") : release,
      }),
    );
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
          aria-label={gt("Change the release or deploy target of {key}", { key: ticketKey })}
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
        <MenuPopup align="end" width="content" onPointerDown={keepFromRow} onClick={keepFromRow}>
          <MenuGroup>
            <MenuGroupLabel>{ticketKey}</MenuGroupLabel>
            {assign ? (
              <MenuSub>
                <MenuSubTrigger>
                  <MenuItemLabel>{gt("Release")}</MenuItemLabel>
                  <MenuItemDetail>{assign.current ?? gt("None")}</MenuItemDetail>
                </MenuSubTrigger>
                <MenuSubPopup>
                  <MenuRadioGroup
                    value={assign.current ?? NO_RELEASE}
                    onValueChange={(value) => chooseRelease(String(value))}
                  >
                    <MenuGroupLabel>{gt("Move {key} to", { key: ticketKey })}</MenuGroupLabel>
                    {assign.choices.map((choice) => (
                      <MenuRadioItem key={choice.id} value={choice.id} closeOnClick>
                        <RadioRow
                          label={`${assign.project} ${choice.id}`}
                          detail={
                            choice.uncut
                              ? gt("not cut yet")
                              : choice.env === "none"
                                ? gt("no target")
                                : choice.reached && choice.reached !== choice.env
                                  ? gt("on {reached} → {env}", {
                                      reached: choice.reached,
                                      env: choice.env,
                                    })
                                  : gt("→ {env}", { env: choice.env })
                          }
                        />
                      </MenuRadioItem>
                    ))}
                    <MenuRadioItem value={NO_RELEASE} closeOnClick>
                      <RadioRow label={gt("No release")} />
                    </MenuRadioItem>
                  </MenuRadioGroup>
                </MenuSubPopup>
              </MenuSub>
            ) : null}
            {target ? (
              <MenuSub>
                <MenuSubTrigger>
                  <MenuItemLabel>
                    {gt("{release} target", { release: target.release })}
                  </MenuItemLabel>
                  <MenuItemDetail>{target.env === "none" ? gt("None") : target.env}</MenuItemDetail>
                </MenuSubTrigger>
                <MenuSubPopup>
                  <MenuRadioGroup
                    value={target.env}
                    onValueChange={(value) => chooseEnv(value as DeployTargetEnv)}
                  >
                    <MenuGroupLabel>
                      {gt("Every ticket on {project} {release}", {
                        project: target.project,
                        release: target.release,
                      })}
                    </MenuGroupLabel>
                    {TARGET_CHOICES.map((env) => (
                      <MenuRadioItem key={env} value={env} closeOnClick>
                        <RadioRow label={env === "none" ? gt("No target") : env} />
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuSubPopup>
              </MenuSub>
            ) : null}
          </MenuGroup>
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
