import { expect, it, vi } from "vite-plus/test";

import {
  findAppBarMenuItem,
  menuActionsFromAppBarItems,
} from "../../components/ui/menuActionItems";
import { threadHeaderMenuItems } from "./threadHeaderMenu";

it("routes repeated action ids in nested ticket menus to their own ticket", () => {
  const first = vi.fn();
  const second = vi.fn();
  const items = threadHeaderMenuItems([
    {
      title: "Jira",
      icon: "tag",
      items: [
        {
          id: "RET-1",
          title: "RET-1",
          items: [{ id: "open-issue", title: "Open issue", onPress: first }],
        },
        {
          id: "RET-2",
          title: "RET-2",
          items: [{ id: "open-issue", title: "Open issue", onPress: second }],
        },
      ],
    },
  ]);
  const secondAction = menuActionsFromAppBarItems(items)[0]?.subactions?.[1]?.subactions?.[0];
  expect(secondAction).toBeDefined();
  findAppBarMenuItem(items, secondAction!.id!)?.onPress();
  expect(second).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled();
});
