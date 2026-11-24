import { useAtomValue } from "@effect/atom-react";
import { DeployTargetEnv, type EnvironmentId, type ThreadTicketDeploy } from "@t3tools/contracts";
import { useGT } from "gt-react-native";
import { useRef, useState } from "react";
import { Linking } from "react-native";

import type { AppBarMenuItem } from "../../components/ui/AppBar.types";
import * as Dialog from "../../components/ui/Dialog";
import { jira } from "../../state/jira";
import { useAtomCommand } from "../../state/use-atom-command";
import { issueCommandError } from "./issuePresentation";

export function useJiraWorkMenu(
  environmentId: EnvironmentId,
  connected: boolean,
  refresh?: () => void,
) {
  const gt = useGT();
  const maySetTarget = useAtomValue(jira.setDeployTarget.permissionAtom(environmentId));
  const mayAssignRelease = useAtomValue(jira.assignRelease.permissionAtom(environmentId));
  const setTarget = useAtomCommand(jira.setDeployTarget, { reportFailure: false });
  const assignRelease = useAtomCommand(jira.assignRelease, { reportFailure: false });
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);

  const change = (
    message: string,
    command: () => ReturnType<typeof setTarget> | ReturnType<typeof assignRelease>,
  ) =>
    Dialog.confirm({
      title: gt("Update release"),
      message,
      confirmText: gt("Update"),
      onConfirm: async () => {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        try {
          const error = issueCommandError(await command());
          if (error) Dialog.alert(gt("Could not update release"), error);
          refresh?.();
        } finally {
          pending.current = false;
          setBusy(false);
        }
      },
    });

  return (key: string, deploy: ThreadTicketDeploy | undefined): AppBarMenuItem[] => {
    const target = deploy?.target;
    const assignment = deploy?.assign;
    const noTarget = gt("No target");
    const items: AppBarMenuItem[] = [];
    if (deploy?.url?.startsWith("https://")) {
      const url = deploy.url;
      items.push({
        id: "deploy-url",
        icon: "arrow.up.right",
        title: gt("Open deployment"),
        onPress: () =>
          void Linking.openURL(url).catch(() => Dialog.alert(gt("Could not open deployment"))),
      });
    }
    if (target && maySetTarget) {
      items.push({
        id: "deploy-target",
        title: gt("Deployment target"),
        items: DeployTargetEnv.literals.map((env) => ({
          id: `target:${env}`,
          title: env === "none" ? noTarget : env,
          selected: env === target.env,
          disabled: busy || !connected || env === target.env,
          onPress: () =>
            change(
              gt(
                "Change the target for {project} release {release} to {environment}? This affects every ticket on the release.",
                {
                  project: target.project,
                  release: target.release,
                  environment: env === "none" ? noTarget : env,
                },
              ),
              () => setTarget({ environmentId, input: { ...target, env } }),
            ),
        })),
      });
    }
    if (assignment && mayAssignRelease) {
      items.push({
        id: "assign-release",
        title: gt("Assign release"),
        items: [
          ...assignment.choices.map((choice) => ({
            id: `release:${choice.id}`,
            title: gt("Release {release}", { release: choice.id }),
            subtitle: choice.uncut
              ? gt("Branch not cut")
              : [choice.reached, choice.env === "none" ? noTarget : choice.env]
                  .filter(Boolean)
                  .join(" · "),
            selected: choice.id === assignment.current,
            disabled: busy || !connected || choice.id === assignment.current,
            onPress: () =>
              change(gt("Move {key} to release {release}?", { key, release: choice.id }), () =>
                assignRelease({ environmentId, input: { key, release: choice.id } }),
              ),
          })),
          {
            id: "release:none",
            title: gt("Remove release"),
            disabled: busy || !connected || !assignment.current,
            onPress: () =>
              change(gt("Remove the local release assignment for {key}?", { key }), () =>
                assignRelease({ environmentId, input: { key, release: "none" } }),
              ),
          },
        ],
      });
    }
    return items;
  };
}
