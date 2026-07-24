import { MenuItem } from "@mui/material";
import type { CustomMenu } from "../store";

export default function ExtraMenu<T>({
  extraMenu,
  target,
  before,
  after,
}: {
  extraMenu: CustomMenu<T>[] | undefined;
  target: T;
  before?: (e: React.MouseEvent, item: T, menu: CustomMenu<T>) => void | Promise<void>;
  after?: (e: React.MouseEvent, item: T, menu: CustomMenu<T>, ret?: number) => void;
}) {
  return (
    <>
      {extraMenu?.map((menu, i) => {
        if (menu.hidden?.(target, menu)) {
          return null;
        }
        const name = typeof menu.name === "function" ? menu.name(target, menu) : menu.name;
        return (
          <MenuItem
            key={menu.key ?? i}
            data-key={menu.key ?? i}
            data-name={name}
            className="extra-menu"
            disabled={menu.disabled?.(target, menu)}
            onClick={async (e: React.MouseEvent) => {
              if (before) {
                await before(e, target, menu);
              }
              const ret = await menu.action(e, target, menu);
              if (after) {
                after(e, target, menu, ret);
              }
            }}
          >
            {name}
          </MenuItem>
        );
      })}
    </>
  );
}
