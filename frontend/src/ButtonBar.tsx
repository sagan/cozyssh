import { useState } from "react";
import { Box, TextField, Tabs, Tab, IconButton, Menu, MenuItem } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

import type { ButtonData } from "./api";
import {
  getStore,
  openAddButtonDialog,
  reorderButtons,
  setActiveGroup,
  setBtnContextMenu,
  setBtnContextMenuOpen,
  useStore,
} from "./store";
import { useShallow } from "zustand/react/shallow";
import { DEFAULT_BUTTON_GROUP } from "./constants";
import { isModifier, t } from "./common";
import ExtraMenu from "./components/ExtraMenu";
import { dialogs } from "./Dialogs";
import { buttonTypeLabel } from "./buttons";

const buttonStyleBorder: Record<ButtonData["type"], string> = {
  run_script: "2px dashed",
  send_string: "2px solid",
  open_terminal: "2px groove",
  terminal_function: "2px dotted",
  misc: "2px dotted",
};

const buttonStyleBorderColor: Record<ButtonData["type"], string> = {
  run_script: "warning.main",
  send_string: "success.main",
  open_terminal: "secondary.main",
  terminal_function: "primary.main",
  misc: "primary.main",
};

const buttonStyleBgColorHover: Record<ButtonData["type"], string> = {
  run_script: "warning.light",
  send_string: "success.light",
  open_terminal: "secondary.light",
  terminal_function: "primary.light",
  misc: "primary.light",
};

const getButtonStyle = (btn: Pick<ButtonData, "type" | "liquidjs">) => {
  let border = buttonStyleBorder[btn.type];
  let borderColor = buttonStyleBorderColor[btn.type];
  let hoverBgColor = buttonStyleBgColorHover[btn.type];

  if (btn.type === "send_string") {
    if (btn.liquidjs) {
      border = "2px inset";
      if (btn.liquidjs === 2) {
        borderColor = "secondary.main";
        hoverBgColor = "secondary.light";
      }
    }
  }

  return { border, borderColor, hoverBgColor };
};

export interface ButtonBarProps {
  groups: string[];
  isMobile: boolean;
  isTouch: boolean;
  handleButtonClick: (
    btn: Pick<ButtonData, "id" | "name" | "type" | "payload" | "liquidjs">,
    alternativeMode?: AltMode,
  ) => void;
}

export default function ButtonBar({ groups, handleButtonClick, isMobile, isTouch }: ButtonBarProps) {
  const activeGroup = useStore((state) => state.activeGroup);
  const filteredButtons = useStore(
    useShallow((state) => state.buttons.filter((b) => (b.group || DEFAULT_BUTTON_GROUP) === state.activeGroup)),
  );
  const extraButtonBarMenu = useStore((state) => state.extraButtonBarMenu);

  const [buttonBarContextMenu, setButtonBarContextMenu] = useState<{ mouseX: number; mouseY: number } | null>(null);
  const [draggedButtonId, setDraggedButtonId] = useState<string | null>(null);
  const [dragOverButton, setDragOverButton] = useState<{ id: string; position: "before" | "after" } | null>(null);

  return (
    <Box
      id="button-bar"
      sx={{
        borderTop: 1,
        borderColor: "divider",
        bgcolor: "#f8f9fa",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setButtonBarContextMenu({ mouseX: e.clientX - 2, mouseY: e.clientY - 4 });
      }}
    >
      <Box
        id="button-bar-group"
        sx={{
          px: 1,
          display: "flex",
          alignItems: "center",
          borderRight: 1,
          borderColor: "divider",
          flexShrink: 0,
          height: 28,
          // minHeight: 40,
        }}
      >
        <TextField
          select
          size="small"
          value={activeGroup}
          onChange={(e) => setActiveGroup(e.target.value)}
          slotProps={{ select: { native: true } }}
          sx={{
            minWidth: 80,
            height: "100%",
            "& .MuiInputBase-root": {
              height: "100%",
              fontSize: "typography.caption.fontSize",
              // height: 26,
            },
            "& .MuiInputBase-input": {
              height: "100% !important", // Ensures the inner textarea fills the space
            },
            "& select": { py: 0, pr: "18px !important" },
          }}
        >
          {[...new Set([...groups, activeGroup])].map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </TextField>
      </Box>
      <Tabs
        key={`tabs-${activeGroup}-${filteredButtons.length}`}
        value={false}
        id="buttons"
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          flexGrow: 1,
          minHeight: 40,
          minWidth: 0,
          "& .MuiTabs-flexContainer": { gap: 1, px: 2, alignItems: "center" },
          "& .MuiTabs-indicator": { display: "none" },
        }}
      >
        {filteredButtons.map((btn) => {
          const style = getButtonStyle(btn);
          return (
            <Tab
              id={`button-${btn.id}`}
              key={btn.id}
              label={btn.name}
              className={`button ${btn.id === draggedButtonId ? "dragging" : ""}`}
              data-name={btn.name}
              data-id={btn.id}
              title={`${btn.type}${
                btn.type === "send_string" && btn.liquidjs ? ` (liquidjs)` : ""
              } (${btn.order || 0})${btn.autorun ? " (autorun)" : ""}${
                btn.shortcut ? " (" + btn.shortcut.toUpperCase() + ")" : ""
              }${btn.type !== "run_script" ? ": " + btn.payload : ""}`}
              component="div"
              onClick={(e) =>
                handleButtonClick(btn, isModifier(e, "ctrl") ? 3 : e.shiftKey ? 2 : isModifier(e, "alt") ? 1 : 0)
              }
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setBtnContextMenu({ element: e.currentTarget, btn });
                setBtnContextMenuOpen(true);
              }}
              draggable={!isMobile && !isTouch}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", btn.id);
                setDraggedButtonId(btn.id);
              }}
              onDragEnd={() => {
                setDraggedButtonId(null);
                setDragOverButton(null);
              }}
              onDragOver={(e) => {
                if (!draggedButtonId || draggedButtonId === btn.id) {
                  return;
                }
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const rect = e.currentTarget.getBoundingClientRect();
                const position = e.clientX > rect.left + rect.width / 2 ? "after" : "before";
                if (!dragOverButton || dragOverButton.id !== btn.id || dragOverButton.position !== position) {
                  setDragOverButton({ id: btn.id, position });
                }
              }}
              onDragLeave={() => {
                if (dragOverButton?.id === btn.id) {
                  setDragOverButton(null);
                }
              }}
              onDrop={(e) => {
                if (!draggedButtonId || draggedButtonId === btn.id) {
                  return;
                }
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                const position = e.clientX > rect.left + rect.width / 2 ? "after" : "before";
                reorderButtons(draggedButtonId, btn.id, position);
                setDraggedButtonId(null);
                setDragOverButton(null);
              }}
              sx={{
                minHeight: 28,
                minWidth: "auto",
                p: "2px 12px",
                textTransform: "none",
                fontSize: "typography.caption.fontSize",
                borderRadius: 1.5,
                border: style.border,
                borderColor: style.borderColor,
                bgcolor: "background.paper",
                color: "text.primary",
                margin: "6px 4px",
                cursor: "pointer",
                opacity: draggedButtonId === btn.id ? 0.4 : 1,
                boxShadow:
                  dragOverButton?.id === btn.id
                    ? (theme) =>
                        `inset ${dragOverButton.position === "before" ? "3px" : "-3px"} 0 0 ${theme.palette.primary.main}`
                    : undefined,
                transition: "opacity 0.2s, box-shadow 0.1s",
                "&:hover": {
                  bgcolor: style.hoverBgColor,
                  color: "white",
                },
              }}
            />
          );
        })}
      </Tabs>
      <Box sx={{ flexShrink: 0, px: 1, borderLeft: 1, borderColor: "divider" }}>
        <IconButton size="small" title={t("New Button")} onClick={() => openAddButtonDialog()} sx={{ p: 0.5 }}>
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
      <Menu
        id="button-bar-menu"
        open={!!buttonBarContextMenu}
        onClose={() => setButtonBarContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={
          buttonBarContextMenu
            ? {
                top: buttonBarContextMenu.mouseY,
                left: buttonBarContextMenu.mouseX,
              }
            : undefined
        }
      >
        <MenuItem
          id="button-bar-menu-show-shortcuts"
          onClick={() => {
            setButtonBarContextMenu(null);
            const { buttons, activeGroup } = getStore();
            let text = t("Active Group Buttons:") + ` (${activeGroup})\n`;
            for (let i = 0; i < filteredButtons.length; i++) {
              const btn = filteredButtons[i];
              let shortcut = "";
              if (i <= 8) {
                shortcut = `alt+shift+${i + 1} `;
              } else if (i === 9) {
                shortcut = "alt+shift+0";
              }
              if (btn.shortcut) {
                if (shortcut !== "") {
                  shortcut += "  ";
                }
                shortcut += btn.shortcut + (btn.shortcut_scope === 1 ? `(${t("local shortcut")})` : "");
              }
              if (!shortcut && !btn.autorun) {
                continue;
              }
              text += `${btn.name}: ${shortcut || t("<none>")} (${t("Type:")} ${buttonTypeLabel(btn.type)})${
                btn.autorun ? `  [${t("Autorun")}]` : ""
              }\n`;
            }
            text += "\n";

            text += t("Other Group Buttons:") + "\n";
            const otherButtons = buttons.filter((b) => (b.group || DEFAULT_BUTTON_GROUP) !== activeGroup);
            for (const btn of otherButtons) {
              let shortcut = "";
              if (btn.shortcut) {
                shortcut = btn.shortcut + (btn.shortcut_scope === 1 ? `(${t("local shortcut")})` : "");
              }
              if (!shortcut && !btn.autorun) {
                continue;
              }
              text += `${btn.name}: ${shortcut || t("<none>")} (${t("Group:")} ${
                btn.group || DEFAULT_BUTTON_GROUP
              }, ${t("Type:")} ${buttonTypeLabel(btn.type)})${btn.autorun ? `  [${t("Autorun")}]` : ""}\n`;
            }
            text += "\n";

            text += t("Custom Shortcuts:") + "\n";
            for (const shortcut of Object.values(__CS_CUSTOM_SHORTCUTS__)) {
              text += `${shortcut.name}: ${shortcut.shortcut}\n`;
            }

            dialogs.alert(t("Buttons Shortcut and Autorun"), text);
          }}
        >
          {t("Show Buttons Shortcut and Autorun")}
        </MenuItem>
        <ExtraMenu
          extraMenu={extraButtonBarMenu}
          // eslint-disable-next-line @typescript-eslint/prefer-as-const
          target={"" as ""}
          before={() => {
            setButtonBarContextMenu(null);
          }}
        />
      </Menu>
    </Box>
  );
}
