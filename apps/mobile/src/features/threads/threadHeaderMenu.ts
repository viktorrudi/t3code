import type { AppBarMenu, AppBarMenuItem } from "../../components/ui/AppBar.types";

function scopedMenuItems(items: ReadonlyArray<AppBarMenuItem>, prefix: string): AppBarMenuItem[] {
  return items.map((item, index) => {
    const id = `${prefix}:${index}`;
    return "items" in item
      ? { ...item, id, items: scopedMenuItems(item.items, id) }
      : { ...item, id };
  });
}

export function threadHeaderMenuItems(menus: ReadonlyArray<AppBarMenu>): AppBarMenuItem[] {
  return menus.map((menu, index) => ({
    id: `menu:${index}`,
    title: menu.status ? `${menu.title} · ${menu.status}` : menu.title,
    icon: typeof menu.icon === "string" ? menu.icon : menu.icon.ios,
    items: scopedMenuItems(menu.items, `menu:${index}`),
  }));
}
