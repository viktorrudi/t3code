import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { connectionStatusText, connectionStatusTitle } from "@t3tools/client-runtime/connection";
import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type EnvironmentMachineKind,
  type HostResourcesSnapshot,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useGT, useMessages } from "gt-react";
import {
  BatteryChargingIcon,
  BatteryIcon,
  BotIcon,
  HardDriveIcon,
  MemoryStickIcon,
} from "lucide-react";
import { useContext, useState, useSyncExternalStore } from "react";

import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { getDocumentActivity, subscribeDocumentActivity } from "../../lib/documentActivity";
import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/utils";
import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";
import { clientHostEnvironmentAtom } from "../../state/clientHostEnvironment";
import { localEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { serverEnvironment } from "../../state/server";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  HOST_STATUS_REFRESH_MS,
  HOST_STATUS_STALE_MS,
  sidebarHostMetrics,
  sidebarBattery,
  orderSidebarEnvironments,
} from "./SidebarEnvironmentStatus.logic";

const resourcesAtom = Atom.family((ids: string) =>
  Atom.make((get) => {
    const evaluatedAt = Date.now();
    const resources = (ids === "" ? [] : ids.split("\n")).map((id) => {
      const environmentId = id as EnvironmentId;
      const query = serverEnvironment.hostResources({ environmentId, input: {} });
      return { environmentId, query, result: get(query) };
    });
    const nextExpiry = Math.min(
      ...resources
        .map(({ result }) =>
          result._tag === "Success" ? result.timestamp + HOST_STATUS_STALE_MS : 0,
        )
        .filter((expiry) => expiry > evaluatedAt),
    );
    // One expiry for the group keeps retained values honest when live refresh pauses for idle.
    if (Number.isFinite(nextExpiry)) {
      const timer = setTimeout(() => get.refreshSelf(), nextExpiry - evaluatedAt);
      get.addFinalizer(() => clearTimeout(timer));
    }
    return { resources, evaluatedAt };
  }),
);

function SidebarMachineIcon({
  kind,
  current,
}: {
  readonly kind: EnvironmentMachineKind;
  readonly current: boolean;
}) {
  return (
    <span aria-hidden="true" className="relative grid size-4 shrink-0 place-items-center">
      <EnvironmentMachineIcon
        kind={kind}
        className={kind === "server" || kind === "desktop" ? "size-3" : "size-3.5"}
      />
      {current ? (
        <span className="absolute -right-0.5 -bottom-0.5 size-1.25 rounded-full bg-primary ring-1 ring-sidebar" />
      ) : null}
    </span>
  );
}

function EnvironmentStatus({
  environment,
  result,
  now,
  current,
  collapsed,
}: {
  readonly environment: EnvironmentPresentation;
  readonly result: AsyncResult.AsyncResult<HostResourcesSnapshot, unknown> | undefined;
  readonly now: number;
  readonly current: boolean;
  readonly collapsed: boolean;
}) {
  const gt = useGT();
  const messages = useMessages();
  const connected = environment.connection.phase === "connected";
  const success =
    result?._tag === "Failure" ? Option.getOrUndefined(result.previousSuccess) : result;
  const snapshot = success?._tag === "Success" ? success.value : null;
  const metrics = sidebarHostMetrics({
    snapshot,
    receivedAt: success?._tag === "Success" ? success.timestamp : now,
    now,
    failed: result?._tag === "Failure",
  });
  const unavailable = gt("Unavailable");
  const cpu = metrics.cpuPercent === null ? unavailable : `${metrics.cpuPercent}%`;
  const memory = metrics.memoryPercent === null ? unavailable : `${metrics.memoryPercent}%`;
  const status = connectionStatusText(environment.connection, messages);
  const disconnectedStatus =
    environment.connection.phase === "connecting" ||
    environment.connection.phase === "available" ||
    environment.connection.awaitingApproval
      ? connectionStatusTitle(environment.connection, messages)
      : gt("Offline");
  const freshness =
    snapshot === null ? gt("Statistics unavailable") : metrics.stale ? gt("Stale") : "";
  const scope =
    snapshot?.scope === "constrained"
      ? gt("RAM/CPU include environment limits")
      : snapshot?.scope === undefined
        ? gt("Resource scope unavailable")
        : null;
  const agents =
    metrics.workingAgentCount === null ? unavailable : String(metrics.workingAgentCount);
  const disk =
    metrics.diskAvailableBytes === null ? unavailable : formatBytes(metrics.diskAvailableBytes);
  const battery = sidebarBattery(snapshot, environment.serverConfig?.environment.platform.machine);
  const Battery = battery?.charging === true ? BatteryChargingIcon : BatteryIcon;
  const batteryLabel =
    battery === null
      ? ""
      : battery.charging === true
        ? gt("Battery: {percent}%, charging", { percent: battery.percent })
        : gt("Battery: {percent}%", { percent: battery.percent });
  const currentLabel = current
    ? environment.serverConfig?.environment.platform.os === "darwin"
      ? gt("This Mac")
      : gt("This computer")
    : null;
  const name = currentLabel === null ? environment.label : `${environment.label} · ${currentLabel}`;
  const detailsNote =
    metrics.detailsAvailability === "legacy"
      ? gt("Working agents and free disk need a newer T3 server.")
      : gt("Working agents and free disk are unavailable.");
  const label = connected
    ? [
        gt(
          "{name}: {status}. RAM {memory}, working agents {agents}, free disk {disk}. CPU: {cpu}",
          {
            name,
            status,
            memory,
            agents,
            disk,
            cpu,
          },
        ),
        freshness,
        batteryLabel,
      ]
        .filter(Boolean)
        .join(". ")
    : `${name}: ${disconnectedStatus}`;
  return (
    <Tooltip>
      <TooltipTrigger
        payload={label}
        render={
          <span
            tabIndex={0}
            aria-label={label}
            className={cn(
              "col-span-full min-h-7 min-w-0 items-center gap-x-1.5 gap-y-0.5 rounded-sm px-1 py-1 text-xs tabular-nums outline-hidden hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center",
              connected ? "grid grid-cols-subgrid" : "flex",
              connected && !metrics.stale
                ? "text-sidebar-foreground"
                : "text-sidebar-muted-foreground",
            )}
          />
        }
      >
        <SidebarMachineIcon
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          current={current}
        />
        <span
          aria-hidden="true"
          className={cn(
            "flex min-w-0 items-center gap-1.5 group-data-[collapsible=icon]:hidden",
            connected ? "col-start-2 col-end-5 row-start-1" : "flex-1",
          )}
        >
          <span className={cn("truncate", current && "font-medium")}>
            {currentLabel ?? environment.label}
          </span>
          {connected && battery !== null ? (
            <span className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sidebar-muted-foreground">
              <Battery className="size-3" />
              {battery.percent}%
            </span>
          ) : null}
          {connected && metrics.stale ? <span className="text-warning">*</span> : null}
        </span>
        {connected ? (
          <>
            <span
              aria-hidden="true"
              className="col-start-2 row-start-2 inline-flex items-center gap-1 whitespace-nowrap group-data-[collapsible=icon]:hidden"
            >
              <MemoryStickIcon className="size-2.5 text-sidebar-muted-foreground" />
              {metrics.memoryPercent === null ? "–" : memory}
            </span>
            {metrics.detailsAvailability !== null ? (
              <span
                aria-hidden="true"
                className="col-start-3 col-end-5 row-start-2 min-w-0 truncate text-sidebar-muted-foreground group-data-[collapsible=icon]:hidden"
              >
                {metrics.detailsAvailability === "legacy" ? gt("older T3") : unavailable}
              </span>
            ) : (
              <>
                <span
                  aria-hidden="true"
                  className="col-start-3 row-start-2 inline-flex items-center gap-1 whitespace-nowrap group-data-[collapsible=icon]:hidden"
                >
                  <BotIcon className="size-2.5 text-sidebar-muted-foreground" />
                  {metrics.workingAgentCount === null ? "–" : agents}
                </span>
                <span
                  aria-hidden="true"
                  className="col-start-4 row-start-2 inline-flex items-center gap-1 whitespace-nowrap group-data-[collapsible=icon]:hidden"
                >
                  <HardDriveIcon className="size-2.5 text-sidebar-muted-foreground" />
                  {metrics.diskAvailableBytes === null ? "–" : disk}
                </span>
              </>
            )}
          </>
        ) : (
          <span aria-hidden="true" className="shrink-0 group-data-[collapsible=icon]:hidden">
            {disconnectedStatus}
          </span>
        )}
      </TooltipTrigger>
      <TooltipPopup side={collapsed ? "right" : "top"} align="start">
        <div className="grid gap-1 py-1">
          <span className="font-medium">{name}</span>
          <span className="text-muted-foreground">{status}</span>
          {connected ? (
            <>
              <span>{gt("CPU: {cpu}", { cpu })}</span>
              {collapsed ? <span>{gt("RAM: {memory}", { memory })}</span> : null}
              {metrics.detailsAvailability === null ? (
                <>
                  <span>{gt("Working agents: {agents} (this T3 server)", { agents })}</span>
                  <span>{gt("Free disk: {disk} (server data volume)", { disk })}</span>
                </>
              ) : snapshot !== null ? (
                <span className="text-muted-foreground">{detailsNote}</span>
              ) : null}
              {battery !== null ? <span>{batteryLabel}</span> : null}
              {scope !== null ? <span className="text-muted-foreground">{scope}</span> : null}
              {freshness !== "" ? (
                <span className={metrics.stale ? "text-warning" : "text-muted-foreground"}>
                  {freshness}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">
              {gt("Not connected; power state unknown")}
            </span>
          )}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

export function SidebarEnvironmentStatus() {
  const gt = useGT();
  const { environments } = useEnvironments();
  const localEnvironmentId = useAtomValue(localEnvironmentIdAtom);
  const clientHost = useAtomValue(clientHostEnvironmentAtom(localEnvironmentId));
  const currentEnvironmentId = clientHost ? localEnvironmentId : null;
  const orderedEnvironments = orderSidebarEnvironments(environments, currentEnvironmentId);
  const { isMobile, openMobile, state } = useSidebar();
  const activity = useSyncExternalStore(
    subscribeDocumentActivity,
    getDocumentActivity,
    getDocumentActivity,
  );
  const visible = activity.visible && (isMobile ? openMobile : state !== "collapsed");
  const ids = environments
    .filter((environment) => visible && environment.connection.phase === "connected")
    .map((environment) => environment.environmentId)
    .sort()
    .join("\n");
  const { resources, evaluatedAt } = useAtomValue(resourcesAtom(ids));
  const registry = useContext(RegistryContext);
  const [now, setNow] = useState(Date.now);
  useLiveRefresh(
    () => {
      const time = Date.now();
      setNow(time);
      for (const { query } of resources) {
        const result = registry.get(query);
        if (result.waiting || result._tag === "Initial") continue;
        if (result._tag !== "Success" || time - result.timestamp >= HOST_STATUS_REFRESH_MS) {
          registry.refresh(query);
        }
      }
    },
    {
      enabled: visible && ids !== "",
      key: "sidebar-host-resources",
      intervalMs: HOST_STATUS_REFRESH_MS,
    },
  );
  if (environments.length === 0) return null;
  return (
    <SidebarMenuItem className="min-w-0 basis-full">
      <div
        role="group"
        aria-label={gt("Environment statistics")}
        className="grid min-w-0 grid-cols-[1rem_auto_auto_minmax(0,1fr)] gap-x-1.5 group-data-[collapsible=icon]:grid-cols-1"
      >
        {orderedEnvironments.map((environment) => (
          <EnvironmentStatus
            key={environment.environmentId}
            environment={environment}
            current={environment.environmentId === currentEnvironmentId}
            collapsed={!isMobile && state === "collapsed"}
            result={
              resources.find((resource) => resource.environmentId === environment.environmentId)
                ?.result
            }
            now={Math.max(now, evaluatedAt)}
          />
        ))}
      </div>
    </SidebarMenuItem>
  );
}
