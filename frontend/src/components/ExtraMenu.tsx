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
  before?: (e: React.MouseEvent, item: T) => void;
  after?: (e: React.MouseEvent, item: T) => void;
}) {
  return (
    <>
      {extraMenu?.map(
        (menu, i) =>
          (!menu.hidden || !menu.hidden(target)) && (
            <MenuItem
              key={menu.key ?? i}
              disabled={menu.disabled?.(target)}
              onClick={async (e: React.MouseEvent) => {
                if (before) {
                  before(e, target);
                }
                await menu.action(e, target);
                if (after) {
                  after(e, target);
                }
              }}
            >
              {typeof menu.name === "function" ? menu.name(target) : menu.name}
            </MenuItem>
          ),
      )}
    </>
  );
}
