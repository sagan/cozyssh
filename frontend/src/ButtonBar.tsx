// import React from 'react';
import { Box, TextField, Tabs, Tab, IconButton } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";

import type { ButtonData } from "./api";
import { setActiveGroup, setBtnMenuAnchor, setLastMenuBtn, useStore } from "./store";
import { useShallow } from "zustand/react/shallow";
import { DEFAULT_BUTTON_GROUP } from "./constants";

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
  handleButtonClick: (btn: Pick<ButtonData, "id" | "name" | "type" | "payload" | "liquidjs">) => void;
  onNewButtonClick: () => void;
}

export default function ButtonBar({ groups, handleButtonClick, onNewButtonClick }: ButtonBarProps) {
  const activeGroup = useStore((state) => state.activeGroup);
  const filteredButtons = useStore(
    useShallow((state) => state.buttons.filter((b) => (b.group || DEFAULT_BUTTON_GROUP) === state.activeGroup)),
  );

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
    >
      <Box
        sx={{
          px: 1,
          display: "flex",
          alignItems: "center",
          borderRight: 1,
          borderColor: "divider",
          flexShrink: 0,
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
            "& .MuiInputBase-root": { fontSize: "typography.caption.fontSize", height: 26 },
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
              className="button"
              data-name={btn.name}
              data-id={btn.id}
              title={`${btn.type}${
                btn.type === "send_string" && btn.liquidjs ? ` (liquidjs)` : ""
              } (${btn.order || 0})${btn.autorun ? " (autorun)" : ""}${
                btn.shortcut ? " (" + btn.shortcut.toUpperCase() + ")" : ""
              }${btn.type !== "run_script" ? ": " + btn.payload : ""}`}
              component="div"
              onClick={() => handleButtonClick(btn)}
              onContextMenu={(e) => {
                e.preventDefault();
                setBtnMenuAnchor({ anchor: e.currentTarget, btn });
                setLastMenuBtn(btn);
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
        <IconButton size="small" title="New Button" onClick={onNewButtonClick} sx={{ p: 0.5 }}>
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
