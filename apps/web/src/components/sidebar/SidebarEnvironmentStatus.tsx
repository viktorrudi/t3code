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
import { useContext, useId, useState, useSyncExternalStore } from "react";

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
import { SidebarEnvironmentHistory } from "./SidebarEnvironmentHistory";
import {
  EMPTY_RESOURCE_HISTORY,
  appendResourceHistory,
  type ResourceHistoryState,
} from "./SidebarEnvironmentHistory.logic";

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
    // One expiry for the group keeps retained values honest when live refresh pauses.
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
  history,
  now,
  current,
  collapsed,
  expanded,
  onActivate,
  onDeactivate,
  onClose,
  onToggle,
}: {
  readonly environment: EnvironmentPresentation;
  readonly result: AsyncResult.AsyncResult<HostResourcesSnapshot, unknown> | undefined;
  readonly history: ResourceHistoryState;
  readonly now: number;
  readonly current: boolean;
  readonly collapsed: boolean;
  readonly expanded: boolean;
  readonly onActivate: () => void;
  readonly onDeactivate: () => void;
  readonly onClose: () => void;
  readonly onToggle: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const detailsId = useId();
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
  const loading = result === undefined || result._tag === "Initial";
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
  const emptyChartLabel = (value: number | null) =>
    metrics.stale
      ? gt("No recent samples")
      : snapshot !== null && value === null
        ? unavailable
        : gt("Collecting samples");
  const open = expanded && !collapsed;
  return (
    <div
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") onActivate();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "touch") return;
        if (!event.currentTarget.querySelector(":focus-visible")) onDeactivate();
      }}
      onFocus={(event) => {
        if (event.target.matches(":focus-visible")) onActivate();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onDeactivate();
      }}
      className={cn("min-w-0 rounded-sm", open && "bg-sidebar-row-hover")}
    >
      <Tooltip disabled={!collapsed}>
        <TooltipTrigger
          render={
            <span
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-expanded={collapsed ? undefined : open}
              aria-controls={open ? detailsId : undefined}
              onClick={onToggle}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggle();
                } else if (event.key === "Escape" && open) {
                  event.stopPropagation();
                  onClose();
                }
              }}
              className={cn(
                "flex min-h-7 min-w-0 cursor-pointer items-center gap-x-1.5 gap-y-0.5 rounded-sm px-1 py-1 text-xs tabular-nums outline-hidden hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset group-data-[collapsible=icon]:flex-nowrap group-data-[collapsible=icon]:justify-center",
                connected && "flex-wrap",
                connected && !metrics.stale
                  ? "text-sidebar-foreground"
                  : "text-sidebar-muted-foreground",
              )}
            />
          }
        >
          <span className="flex min-w-0 max-w-full grow basis-auto items-center gap-1.5 group-data-[collapsible=icon]:grow-0">
            <SidebarMachineIcon
              kind={resolveEnvironmentMachineKind(environment.serverConfig)}
              current={current}
            />
            <span
              aria-hidden="true"
              className={cn(
                "min-w-0 truncate group-data-[collapsible=icon]:hidden",
                current && "font-medium",
              )}
            >
              {currentLabel ?? environment.label}
            </span>
            {connected && battery !== null ? (
              <span
                aria-hidden="true"
                className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sidebar-muted-foreground group-data-[collapsible=icon]:hidden"
              >
                <Battery className="size-3" />
                {battery.percent}%
              </span>
            ) : null}
            {connected && metrics.stale ? (
              <span
                aria-hidden="true"
                className="text-warning group-data-[collapsible=icon]:hidden"
              >
                *
              </span>
            ) : null}
          </span>
          {connected ? (
            <span
              aria-hidden="true"
              className="ml-auto flex min-w-0 max-w-full shrink-0 basis-full items-center justify-end gap-1.5 @min-[14rem]/sidebar-machines:basis-auto group-data-[collapsible=icon]:hidden"
            >
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <MemoryStickIcon className="size-2.5 text-sidebar-muted-foreground" />
                {metrics.memoryPercent === null ? "–" : memory}
              </span>
              {metrics.detailsAvailability !== null && !loading ? (
                <span className="min-w-0 truncate text-sidebar-muted-foreground">
                  {metrics.detailsAvailability === "legacy" ? gt("older T3") : unavailable}
                </span>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <BotIcon className="size-2.5 text-sidebar-muted-foreground" />
                    {metrics.workingAgentCount === null ? "–" : agents}
                  </span>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <HardDriveIcon className="size-2.5 text-sidebar-muted-foreground" />
                    {metrics.diskAvailableBytes === null ? "–" : disk}
                  </span>
                </>
              )}
            </span>
          ) : (
            <span aria-hidden="true" className="shrink-0 group-data-[collapsible=icon]:hidden">
              {disconnectedStatus}
            </span>
          )}
        </TooltipTrigger>
        <TooltipPopup side="right" align="start">
          <div className="grid gap-1 py-1">
            <span className="font-medium">{name}</span>
            <span className="text-muted-foreground">{connected ? status : disconnectedStatus}</span>
          </div>
        </TooltipPopup>
      </Tooltip>
      {open ? (
        <div
          id={detailsId}
          role="group"
          aria-label={gt("{name} details", { name })}
          className="grid gap-1.5 pt-0.5 pr-1 pb-1.5 pl-6.5 text-2xs text-sidebar-muted-foreground"
        >
          {connected && (snapshot !== null || loading) ? (
            <SidebarEnvironmentHistory
              samples={history.samples}
              now={now}
              cpu={loading ? "–" : cpu}
              memory={loading ? "–" : memory}
              cpuEmptyLabel={emptyChartLabel(metrics.cpuPercent)}
              memoryEmptyLabel={emptyChartLabel(metrics.memoryPercent)}
            />
          ) : null}
          <div className="grid gap-0.5">
            {connected ? (
              <>
                <span>{status}</span>
                {metrics.detailsAvailability === null ? (
                  <>
                    <span>{gt("Working agents: {agents} (this T3 server)", { agents })}</span>
                    <span>{gt("Free disk: {disk} (server data volume)", { disk })}</span>
                  </>
                ) : snapshot !== null ? (
                  <span>{detailsNote}</span>
                ) : null}
                {battery !== null ? <span>{batteryLabel}</span> : null}
                {scope !== null && !loading ? <span>{scope}</span> : null}
                {freshness !== "" && !loading ? (
                  <span className={cn(metrics.stale && "text-warning")}>{freshness}</span>
                ) : null}
              </>
            ) : (
              <span>{gt("Not connected; power state unknown")}</span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function latestSuccess(result: AsyncResult.AsyncResult<HostResourcesSnapshot, unknown>) {
  return result._tag === "Success" ? result : null;
}

export function SidebarEnvironmentStatus() {
  const gt = useGT();
  const { environments } = useEnvironments();
  const localEnvironmentId = useAtomValue(localEnvironmentIdAtom);
  const clientHost = useAtomValue(clientHostEnvironmentAtom(localEnvironmentId));
  const currentEnvironmentId = clientHost ? localEnvironmentId : null;
  const orderedEnvironments = orderSidebarEnvironments(environments, currentEnvironmentId);
  const { isMobile, openMobile, state, setOpen } = useSidebar();
  const collapsed = !isMobile && state === "collapsed";
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
  const [histories, setHistories] = useState<ReadonlyMap<EnvironmentId, ResourceHistoryState>>(
    () => new Map(),
  );
  const [active, setActive] = useState<EnvironmentId | null>(null);
  const [pinned, setPinned] = useState<EnvironmentId | null>(null);
  // Fold each fresh read into history during render; duplicates return the same state, so this settles.
  let nextHistories = histories;
  for (const { environmentId, result } of resources) {
    const success = latestSuccess(result);
    if (success === null) continue;
    const sample = sidebarHostMetrics({
      snapshot: success.value,
      receivedAt: success.timestamp,
      now: success.timestamp,
      failed: false,
    });
    const previous = nextHistories.get(environmentId) ?? EMPTY_RESOURCE_HISTORY;
    const next = appendResourceHistory(previous, {
      sampledAt: success.value.sampledAt,
      observedAt: success.timestamp,
      cpuPercent: sample.cpuPercent,
      memoryPercent: sample.memoryPercent,
    });
    if (next === previous) continue;
    nextHistories = new Map(nextHistories).set(environmentId, next);
  }
  for (const environmentId of nextHistories.keys()) {
    if (environments.some((environment) => environment.environmentId === environmentId)) continue;
    const pruned = new Map(nextHistories);
    pruned.delete(environmentId);
    nextHistories = pruned;
  }
  if (nextHistories !== histories) setHistories(nextHistories);
  useLiveRefresh(
    () => {
      const time = Date.now();
      setNow(time);
      for (const { query } of resources) {
        const result = registry.get(query);
        if (result.waiting || result._tag === "Initial") continue;
        registry.refresh(query);
      }
    },
    {
      enabled: visible && ids !== "",
      key: "sidebar-host-resources",
      intervalMs: HOST_STATUS_REFRESH_MS,
      minimumIntervalMs: 1_500,
      refreshWhileIdle: true,
      refreshOnShow: true,
    },
  );
  if (environments.length === 0) return null;
  const expandedId = active ?? pinned;
  return (
    <SidebarMenuItem className="min-w-0 basis-full">
      <div
        role="group"
        aria-label={gt("Environment statistics")}
        className="@container/sidebar-machines grid min-w-0 grid-cols-1"
      >
        {orderedEnvironments.map((environment) => {
          const id = environment.environmentId;
          const history = nextHistories.get(id) ?? EMPTY_RESOURCE_HISTORY;
          const close = () => {
            setActive((value) => (value === id ? null : value));
            setPinned((value) => (value === id ? null : value));
          };
          return (
            <EnvironmentStatus
              key={id}
              environment={environment}
              current={id === currentEnvironmentId}
              collapsed={collapsed}
              expanded={expandedId === id}
              onActivate={() => setActive(id)}
              onDeactivate={() => setActive((value) => (value === id ? null : value))}
              onClose={close}
              onToggle={() => {
                if (collapsed) setOpen(true);
                if (pinned === id && !collapsed) close();
                else setPinned(id);
              }}
              history={history}
              result={resources.find((resource) => resource.environmentId === id)?.result}
              now={Math.max(now, evaluatedAt, history.lastObservedAt ?? 0)}
            />
          );
        })}
      </div>
    </SidebarMenuItem>
  );
}
