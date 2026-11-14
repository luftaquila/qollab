import { parse } from "yaml";
/** Pandoc's `split-level`, from the document's front matter or else _quarto.yml. */
export function splitLevel(source: string, projectConfig?: string) {
  const front = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/.exec(
    source,
  );
  for (const yaml of [front?.[1], projectConfig]) {
    if (!yaml) continue;
    let value: unknown;
    try {
      value = parse(yaml, { maxAliasCount: 0 })?.["split-level"];
    } catch {
      // The editor reports invalid YAML; the site keeps its default pages.
      continue;
    }
    if (value !== undefined)
      return Number.isInteger(value) &&
        (value as number) >= 1 &&
        (value as number) <= 6
        ? (value as number)
        : undefined;
  }
  return undefined;
}
export type SidebarItem = {
  text: string;
  link?: string;
  collapsed?: boolean;
  items?: SidebarItem[];
};
interface SidebarPage {
  id: string;
  title: string;
  groups: { id: string; title: string }[];
  group: boolean;
}
/** Groups above the split level nest their pages and stay expandable. */
export function sidebarItems<T extends SidebarPage>(
  pages: T[],
  link: (page: T) => string,
): SidebarItem[] {
  const items: SidebarItem[] = [],
    groups = new Map<string, SidebarItem>();
  const group = (id: string, text: string, parent: SidebarItem[]) => {
    if (!groups.has(id)) {
      const item: SidebarItem = { text, collapsed: false, items: [] };
      groups.set(id, item);
      parent.push(item);
    }
    return groups.get(id)!;
  };
  for (const page of pages) {
    let parent = items;
    for (const g of page.groups) parent = group(g.id, g.title, parent).items!;
    if (page.group) group(page.id, page.title, parent).link = link(page);
    else parent.push({ text: page.title, link: link(page) });
  }
  // A group page with nothing under it is a plain link, without a toggle.
  for (const item of groups.values())
    if (!item.items!.length) {
      delete item.items;
      delete item.collapsed;
    }
  return items;
}
