// import React from 'react';
import { Box, TextField, Tabs, Tab, IconButton } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import type { ButtonData } from './api';

const buttonStyleBorder: Record<string, string> = {
  "run_script": "1px dashed",
  "send_string": "1px solid",
  "open_terminal": "1px groove",
  "": "1px dotted", // fallback
};

const buttonStyleBorderColor: Record<string, string> = {
  "run_script": "warning.main",
  "send_string": "success.main",
  "open_terminal": "secondary.main",
  "": "primary.main",
};

const buttonStyleBgColorHover: Record<string, string> = {
  "run_script": "warning.light",
  "send_string": "success.light",
  "open_terminal": "secondary.light",
  "": "primary.light",
};

export interface ButtonBarProps {
  activeGroup: string;
  setActiveGroup: (g: string) => void;
  groups: string[];
  filteredButtons: ButtonData[];
  handleButtonClick: (btn: Pick<ButtonData, 'id' | 'name' | 'type' | 'payload'>) => void;
  setBtnMenuAnchor: (obj: { anchor: HTMLElement, btn: ButtonData } | null) => void;
  setLastMenuBtn: (btn: ButtonData) => void;
  onNewButtonClick: () => void;
}

export default function ButtonBar({
  activeGroup, setActiveGroup, groups, filteredButtons, handleButtonClick,
  setBtnMenuAnchor, setLastMenuBtn, onNewButtonClick,
}: ButtonBarProps) {
  return (
    <Box id="button-bar" sx={{
      borderTop: 1, borderColor: 'divider', bgcolor: '#f8f9fa',
      flexShrink: 0, display: 'flex', alignItems: 'center',
    }}>
      <Box sx={{
        px: 1, display: 'flex', alignItems: 'center',
        borderRight: 1, borderColor: 'divider', flexShrink: 0,
      }}>
        <TextField
          select
          size="small"
          value={activeGroup}
          onChange={(e) => setActiveGroup(e.target.value)}
          slotProps={{ select: { native: true } }}
          sx={{
            minWidth: 80,
            '& .MuiInputBase-root': { fontSize: '0.8rem', height: 26 },
            '& select': { py: 0, pr: '18px !important' },
          }}
        >
          {[...new Set([...groups, activeGroup])].map(g => (
            <option key={g} value={g}>{g}</option>
          ))}
        </TextField>
      </Box>
      <Tabs
        key={`tabs-${activeGroup}-${filteredButtons.length}`}
        value={false}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          flexGrow: 1,
          minHeight: 40,
          minWidth: 0,
          '& .MuiTabs-flexContainer': { gap: 1, px: 2, alignItems: 'center' },
          '& .MuiTabs-indicator': { display: 'none' },
        }}
      >
        {filteredButtons.map(btn => (
          <Tab
            key={btn.id}
            label={btn.name}
            data-button-name={btn.name}
            data-button-id={btn.id}
            title={`${btn.type} (${btn.order || 0})${btn.autorun ? " (autorun)" : ""}${btn.shortcut
              ? " (" + btn.shortcut.toUpperCase() + ")" : ""}${btn.type != "run_script" ? ": " + btn.payload : ""}`}
            component="div"
            onClick={() => handleButtonClick(btn)}
            onContextMenu={(e) => {
              e.preventDefault();
              setBtnMenuAnchor({ anchor: e.currentTarget, btn });
              setLastMenuBtn(btn);
            }}
            sx={{
              minHeight: 28, minWidth: 'auto', p: '2px 12px',
              textTransform: 'none', fontSize: '0.8rem', borderRadius: 1.5,
              border: buttonStyleBorder[btn.type] || buttonStyleBorder[""],
              borderColor: buttonStyleBorderColor[btn.type] || buttonStyleBorderColor[""],
              bgcolor: 'background.paper',
              color: 'text.primary', margin: '6px 4px', cursor: 'pointer',
              '&:hover': {
                bgcolor: buttonStyleBgColorHover[btn.type] || buttonStyleBgColorHover[""],
                color: 'white',
              },
            }}
          />
        ))}
      </Tabs>
      <Box sx={{ flexShrink: 0, px: 1, borderLeft: 1, borderColor: 'divider' }}>
        <IconButton
          size="small" title="New Button"
          onClick={onNewButtonClick}
          sx={{ p: 0.5 }}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}
