import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { AsyncResult } from "effect/reactivity";
import { randomUUID } from "expo-crypto";
import { useGT } from "gt-react-native";

import * as Dialog from "../../components/ui/Dialog";
import type { ThreadGroup } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { moveThreadToGroup } from "./threadGroups";

const EMPTY_GROUPS: ReadonlyArray<ThreadGroup> = [];

export function useThreadGroups() {
  const gt = useGT();
  const result = useAtomValue(mobilePreferencesAtom);
  const save = useAtomCommand(saveMobilePreferences);
  const loaded = AsyncResult.isSuccess(result);
  const groups = loaded ? (result.value.threadGroups ?? EMPTY_GROUPS) : EMPTY_GROUPS;

  const update = (change: (previous: ReadonlyArray<ThreadGroup>) => ReadonlyArray<ThreadGroup>) => {
    if (!loaded) return;
    void save({
      transform: (current) => ({ threadGroups: change(current.threadGroups ?? EMPTY_GROUPS) }),
    });
  };
  const editName = (title: string, initialValue: string, onSave: (value: string) => void) =>
    Dialog.prompt({
      title,
      initialValue,
      confirmText: gt("Save"),
      onConfirm: (value) => {
        const name = value.trim().slice(0, 80);
        if (name) onSave(name);
      },
    });

  const onRowAction = (thread: EnvironmentThreadShell, action: string) => {
    const key = `${thread.environmentId}:${thread.id}`;
    if (action === "thread-group:new") {
      editName(gt("New group"), thread.title.slice(0, 80), (title) =>
        update((previous) => [
          { id: randomUUID(), title, members: [key], collapsed: false },
          ...moveThreadToGroup(previous, key, null),
        ]),
      );
    } else if (action === "thread-group:remove") {
      update((previous) => moveThreadToGroup(previous, key, null));
    } else if (action.startsWith("thread-group:move:")) {
      update((previous) =>
        moveThreadToGroup(previous, key, action.slice("thread-group:move:".length)),
      );
    }
  };

  return {
    groups,
    loaded,
    onRowAction,
    toggle: (id: string) =>
      update((previous) =>
        previous.map((group) =>
          group.id === id ? { ...group, collapsed: !group.collapsed } : group,
        ),
      ),
    rename: (group: ThreadGroup) =>
      editName(gt("Rename group"), group.title, (title) =>
        update((previous) =>
          previous.map((entry) => (entry.id === group.id ? { ...entry, title } : entry)),
        ),
      ),
    ungroup: (id: string) => update((previous) => previous.filter((group) => group.id !== id)),
  };
}
