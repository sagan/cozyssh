import * as React from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";

// Define the shape of our menu configuration state
interface MenuConfig {
  anchorEl: HTMLElement | null;
  options: string[];
  resolve: (value: string | null) => void;
}

// Global mutable placeholder to allow standard functional calls outside React contexts
let globalOpenMenuHandler: ((anchorId: string | HTMLElement, options: string[]) => Promise<string | null>) | null =
  null;

/**
 * Universal imperative wrapper function.
 * Must be executed while under a nested <DynamicMenuProvider>.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function openMenu(anchorId: string | HTMLElement, options: string[]): Promise<string | null> {
  if (__CS_AUTORUN_DONE__ !== 1) {
    // don't open menu in autorun stage.
    return Promise.resolve(null);
  }
  if (!globalOpenMenuHandler) {
    console.error("DynamicMenuProvider is missing from the parent component tree.");
    return Promise.resolve(null);
  }
  return globalOpenMenuHandler(anchorId, options);
}

interface ProviderProps {
  children: React.ReactNode;
}

export function DynamicMenuProvider({ children }: ProviderProps) {
  const [config, setConfig] = React.useState<MenuConfig | null>(null);

  const triggerOpenMenu = (anchorId: string | HTMLElement, options: string[]): Promise<string | null> => {
    return new Promise((resolve) => {
      const targetElement = typeof anchorId === "string" ? document.getElementById(anchorId) : anchorId;

      if (!targetElement) {
        console.warn(`Element with id "${anchorId}" was not found in the DOM.`);
        resolve(null);
        return;
      }

      setConfig({
        anchorEl: targetElement,
        options,
        resolve,
      });
    });
  };

  // Bind the runtime logic to the globally accessible export
  React.useEffect(() => {
    globalOpenMenuHandler = triggerOpenMenu;
    return () => {
      globalOpenMenuHandler = null;
    };
  }, []);

  const handleClose = (selectedValue: string | null) => {
    if (config) {
      config.resolve(selectedValue); // Resolve the promise right away
      setConfig(null); // Instantly tear down state to hide menu
    }
  };

  return (
    <>
      {children}
      <Menu
        id="dynamic-imperative-menu"
        anchorEl={config?.anchorEl}
        open={Boolean(config?.anchorEl)}
        onClose={() => handleClose(null)} // Clicked outside or pressed Escape
        sx={{ zIndex: 10000 }}
      >
        {config?.options.map((option, index) => (
          <MenuItem key={`${option}-${index}`} onClick={() => handleClose(option)}>
            {option}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
