import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { connectionStatusText } from "@t3tools/client-runtime/connection";
import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type HostResourcesSnapshot,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";
import { useGT, useMessages } from "gt-react";
import { CpuIcon, MemoryStickIcon } from "lucide-react";
import { useContext, useState, useSyncExternalStore } from "react";

import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { getDocumentActivity, subscribeDocumentActivity } from "../../lib/documentActivity";
import { formatBytes } from "../../lib/formatBytes";
import { cn } from "../../lib/utils";
import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  HOST_STATUS_REFRESH_MS,
  HOST_STATUS_STALE_MS,
  sidebarHostMetrics,
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

function EnvironmentStatus({
  environment,
  result,
  now,
}: {
  readonly environment: EnvironmentPresentation;
  readonly result: AsyncResult.AsyncResult<HostResourcesSnapshot, unknown> | undefined;
  readonly now: number;
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
  const freshness =
    snapshot === null
      ? gt("Host statistics unavailable")
      : metrics.stale
        ? gt("Stale · received {seconds}s ago", { seconds: metrics.ageSeconds })
        : gt("Received {seconds}s ago", { seconds: metrics.ageSeconds });
  const scope =
    snapshot?.scope === "host"
      ? gt("Host resources")
      : snapshot?.scope === "constrained"
        ? gt("Effective resources: host and environment limits")
        : gt("Resource scope unavailable");
  const label = connected
    ? gt("{name}: {status}. CPU {cpu}, memory {memory}. {scope}. {freshness}", {
        name: environment.label,
        status,
        cpu,
        memory,
        freshness,
        scope,
      })
    : `${environment.label}: ${status}`;
  return (
    <Tooltip>
      <TooltipTrigger
        payload={label}
        render={
          <span
            tabIndex={0}
            aria-label={label}
            className={cn(
              "inline-flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-sm px-1 text-xs tabular-nums outline-hidden hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              connected && !metrics.stale
                ? "text-sidebar-foreground"
                : "text-sidebar-muted-foreground",
            )}
          />
        }
      >
        <EnvironmentMachineIcon
          kind={resolveEnvironmentMachineKind(environment.serverConfig)}
          className="size-3.5 shrink-0"
        />
        {connected ? (
          <span
            aria-hidden="true"
            className="inline-flex items-center gap-1 group-data-[collapsible=icon]:hidden"
          >
            <CpuIcon className="size-2.5 text-sidebar-muted-foreground" />
            <span>{metrics.cpuPercent === null ? "?" : `${metrics.cpuPercent}%`}</span>
            <MemoryStickIcon className="ml-0.5 size-2.5 text-sidebar-muted-foreground" />
            <span>{metrics.memoryPercent === null ? "?" : `${metrics.memoryPercent}%`}</span>
            {metrics.stale ? <span className="text-warning">*</span> : null}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="top" align="start">
        <div className="grid gap-1 py-1">
          <span className="font-medium">{environment.label}</span>
          <span className="text-muted-foreground">{status}</span>
          {connected ? (
            <>
              <span className="text-muted-foreground">{scope}</span>
              <span>{gt("CPU: {cpu}", { cpu })}</span>
              <span>{gt("Memory: {memory}", { memory })}</span>
              {snapshot !== null ? (
                <>
                  <span>
                    {gt("Sampled: {time}", {
                      time: new Date(snapshot.sampledAt).toLocaleTimeString(),
                    })}
                  </span>
                  <span>{gt("CPU cores: {count}", { count: snapshot.cpuCount })}</span>
                  {metrics.memoryUsedBytes !== null ? (
                    <span>
                      {gt("Memory used: {used} / {total}", {
                        used: formatBytes(metrics.memoryUsedBytes),
                        total: formatBytes(snapshot.totalMemoryBytes),
                      })}
                    </span>
                  ) : null}
                  <span>
                    {gt("Memory available: {available}", {
                      available: formatBytes(snapshot.availableMemoryBytes),
                    })}
                  </span>
                </>
              ) : null}
              <span className={metrics.stale ? "text-warning" : "text-muted-foreground"}>
                {freshness}
              </span>
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
        className="flex min-w-0 flex-wrap items-center gap-x-1"
      >
        {environments.map((environment) => (
          <EnvironmentStatus
            key={environment.environmentId}
            environment={environment}
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
