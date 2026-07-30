import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Box,
  CssBaseline,
  createTheme,
  ThemeProvider,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
  Drawer,
  Dialog,
  DialogTitle,
  DialogContent,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ViewSidebarIcon from "@mui/icons-material/ViewSidebar";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import type { FullData } from "./api";
import {
  BROWSER_STORAGE_KEY_TOKEN,
  DEFAULT_BUTTON_GROUP,
  LOCAL_NAME,
  VAR_CS_NOAUTOLOAD,
  VAR_CS_NOAUTORUN,
  VAR_NOAUTOLOAD,
  VAR_NOAUTORUN,
  DEFAULT_VIBRATE_PATTERN,
  TAG_GROUP_PREFIX,
  TAG_FAV,
  TOAST_KEY_API_FULLDATA,
  VAR_CS_NO_SANITIZE_HASH,
  TOAST_KEY_REFRESH,
  VAR_CS_VIBRATE_PATTERN,
} from "./constants";
import {
  type ContextMenu,
  type ScratchpadSyncState,
  defaultThemeOptions,
  genTabId,
  genPaneId,
  apiReqHeaders,
  cutString,
  hostSorter,
  getCanonicalHostString,
  t,
} from "./common";
import {
  type TabData,
  useStore,
  getStore,
  setTabs,
  setActiveTabId,
  setActivePaneId,
  triggerFocus,
  notify,
  setMobileOpen,
  setMobileAppletsOpen,
  openHostsAsSplit,
  openHost,
  attachSession,
  openScratchpad,
  openHostsAsSplit2,
  getIntVar,
  refreshData,
  startupParams,
  sendParsedString,
  runScript,
} from "./store";
import "./pluginAPI";
import "./useKeyboardManager";
import Sidebar from "./Sidebar";
import type { TerminalHandle } from "./Terminal";
import type { ScratchpadHandle } from "./Scratchpad";
import TabBar from "./TabBar";
import TerminalGrid from "./TerminalGrid";
import ButtonBar from "./ButtonBar";
import DialogManager from "./DialogManager";
import AppletWrapper, { type AppletData } from "./AppletWrapper";
import SideEffect from "./SideEffect";
import { dialogs } from "./Dialogs";

interface DashboardProps {
  initialData?: FullData;
}

export default function Dashboard({ initialData }: DashboardProps) {
  const mobileAppletsOpen = useStore((state) => state.mobileAppletsOpen);
  const groups = useStore(
    useShallow((state) =>
      [
        DEFAULT_BUTTON_GROUP,
        ...Array.from(
          new Set(state.buttons.map((b) => b.group || DEFAULT_BUTTON_GROUP).filter((g) => g !== DEFAULT_BUTTON_GROUP)),
        ),
      ].sort(),
    ),
  );

  // ── UI-only state (stays in React) ────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  // terminalRefs is kept as a local ref for all Dashboard-internal usage
  const terminalRefs = useRef<Record<string, TerminalHandle | ScratchpadHandle | null>>({});
  const [viewportHeight, setViewportHeight] = useState("100dvh");
  const [scratchpadSyncState, setScratchpadSyncState] = useState<ScratchpadSyncState>("offline");
  const [memoTabId, setMemoTabId] = useState<string | null>(null);
  const [applets, setApplets] = useState<AppletData[]>([]);
  const appletRefs = useRef<AppletData[]>([]);
  const maxZIndexRef = useRef(10000);
  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // ── Mobile bar state ─────────────────────────────────────────────────────
  /** When true, swipe gestures on the terminal send arrow keys instead of switching tabs */
  const [gestureMode, setGestureMode] = useState(false);
  /** When true, the extra-keys panel is visible and the system keyboard is suppressed */
  const [extraKeysOpen, setExtraKeysOpen] = useState(false);
  /** Height of the on-screen keyboard in px (0 when hidden) */
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isTouch = useMediaQuery("(pointer: coarse)");
  const hasSidebarApplet = useMemo(() => !!applets.find((a) => a.position === "sidebar"), [applets]);
  const [muiTheme, setMuiTheme] = useState(() => createTheme(defaultThemeOptions({ fontSize: __CS_FONT_SIZE__ })));

  useEffect(() => {
    window.__CS_APPLETS__ = appletRefs;
    window.__CS_TERMINALS__ = terminalRefs;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    window.csSetTheme = (options: any, ...args: any[]) => setMuiTheme(createTheme(options, ...args));
    window.csSetApplets = setApplets;
    window.__CS_MAX_ZINDEX__ = maxZIndexRef;
  }, []);
  useEffect(() => {
    appletRefs.current = applets;
  }, [applets]);
  useEffect(() => {
    window.__CS_IS_MOBILE__ = isMobile;
    document.documentElement.dataset.csIsMobile = isMobile ? "1" : "0";
  }, [isMobile]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!isTouch || !isMobile || gestureMode) {
        return; // gesture mode uses native listeners
      }
      const touch = e.touches[0];
      swipeStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    },
    [gestureMode, isMobile, isTouch],
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!isTouch || !isMobile || gestureMode || !swipeStartRef.current) {
        return;
      }
      const touch = e.changedTouches[0];
      const diffX = touch.clientX - swipeStartRef.current.x;
      const diffY = touch.clientY - swipeStartRef.current.y;
      const diffTime = Date.now() - swipeStartRef.current.time;
      swipeStartRef.current = null;

      // Thresholds: move at least 100px, mostly horizontal, within 500ms
      if (Math.abs(diffX) > 100 && Math.abs(diffX) > Math.abs(diffY) * 2 && diffTime < 500) {
        const { activeTabId, tabs } = getStore();
        const currentIndex = tabs.findIndex((t) => t.id === activeTabId);
        if (diffX > 0 && currentIndex > 0) {
          const newTab = tabs[currentIndex - 1];
          window.navigator.vibrate?.(getIntVar(VAR_CS_VIBRATE_PATTERN, DEFAULT_VIBRATE_PATTERN));
          setActiveTabId(newTab.id);
          setActivePaneId(newTab.activePaneId);
          triggerFocus();
        } else if (diffX < 0 && currentIndex < tabs.length - 1) {
          const newTab = tabs[currentIndex + 1];
          window.navigator.vibrate?.(getIntVar(VAR_CS_VIBRATE_PATTERN, DEFAULT_VIBRATE_PATTERN));
          setActiveTabId(newTab.id);
          setActivePaneId(newTab.activePaneId);
          triggerFocus();
        }
      }
    },
    [gestureMode, isMobile, isTouch],
  );

  // 1. Add this ref right above the visualViewport useEffect
  const extraKeysOpenRef = useRef(extraKeysOpen);
  useEffect(() => {
    extraKeysOpenRef.current = extraKeysOpen;
  }, [extraKeysOpen]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) {
      return;
    }
    const handleVVResize = () => {
      // 1. Lock dimensions to perfect integers immediately
      const roundedVVHeight = Math.floor(vv.height);
      const roundedInnerHeight = Math.floor(window.innerHeight);

      setViewportHeight(`${roundedVVHeight}px`);
      // 2. Derive the keyboard height using the exact same integers
      setKeyboardHeight(Math.max(0, roundedInnerHeight - roundedVVHeight));
    };
    vv.addEventListener("resize", handleVVResize);
    handleVVResize();
    return () => vv.removeEventListener("resize", handleVVResize);
  }, []);

  // ── VirtualKeyboard API setup ───────────────────────────────────────────
  useEffect(() => {
    const vk = navigator.virtualKeyboard;
    if (!vk) {
      return;
    }
    // Opt-in: keyboard overlays content instead of resizing the viewport.
    // This lets us position our bar precisely at keyboardHeight.
    // vk.overlaysContent = true;
    const handleGeometryChange = () => {
      setKeyboardHeight(vk.boundingRect?.height ?? 0);
    };
    vk.addEventListener("geometrychange", handleGeometryChange);
    return () => {
      vk.removeEventListener("geometrychange", handleGeometryChange);
      // Restore default behaviour on unmount
      vk.overlaysContent = false;
    };
  }, []);

  // ── Keep inputmode in sync with extraKeysOpen across tab/pane changes ────
  // When the extra-keys panel is open, every terminal that becomes active must
  // have inputmode="none" so the system keyboard stays suppressed.  We also
  // call vk.hide() explicitly for the VirtualKeyboard API path.
  useEffect(() => {
    const applyMode = () => {
      if (extraKeysOpen) {
        // Only suppress the active terminal
        const term = terminalRefs.current[getStore().activePaneId];
        if (term && "getXterm" in term) {
          const textarea = term.getXterm()?.textarea as HTMLTextAreaElement | undefined;
          if (textarea) {
            textarea.inputMode = "none";
          }
        }
        // Belt-and-suspenders: force-hide via VK API
        navigator.virtualKeyboard?.hide();
      } else {
        // Restore all terminals so the keyboard can appear naturally again
        for (const term of Object.values(terminalRefs.current)) {
          if (term && "getXterm" in term) {
            const textarea = term.getXterm()?.textarea as HTMLTextAreaElement | undefined;
            if (textarea && textarea.inputMode === "none") {
              textarea.inputMode = "";
            }
          }
        }
      }
    };

    applyMode();
    // Newly-opened tabs mount their xterm asynchronously; retry after a short
    // delay to make sure the textarea exists when we try to patch it.
    const t = setTimeout(applyMode, 350);
    return () => clearTimeout(t);
  }, [extraKeysOpen]);

  useEffect(() => {
    const autorun = getIntVar(VAR_CS_NOAUTORUN) !== 1 && startupParams.get(VAR_NOAUTORUN) !== "1";
    const sanitizeHash =
      __CS_ENV__ === 0 &&
      getIntVar(VAR_CS_NO_SANITIZE_HASH) !== 1 &&
      startupParams.get(VAR_CS_NO_SANITIZE_HASH) !== "1";
    let hash = window.location.hash.substring(1);
    if (hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    try {
      hash = decodeURIComponent(hash);
    } catch {
      /* empty */
    }
    // hash comes from url and is suecptible to XSS attacks, so sanitize it by default
    if (sanitizeHash) {
      const elements = hash.split(/\s*,\s*/);
      for (let i = 0; i < elements.length; i++) {
        let element = elements[i];
        [element] = cutString(element, "?");
        element = element.replace(/[^a-z0-9._:#@-[\]]+/gi, "");
        elements[i] = element;
      }
      hash = elements.filter(Boolean).join(",");
    }

    const initAsync = async () => {
      console.log("initAsync starting, hash:", hash);
      let data = initialData;
      if (!data) {
        try {
          const res = await fetch("/api/fulldata", { headers: apiReqHeaders() });
          if (res.status === 401) {
            localStorage.removeItem(BROWSER_STORAGE_KEY_TOKEN);
            window.location.href = "/login";
            return;
          }
          if (!res.ok) {
            throw new Error(`status=${res.status}`);
          }
          data = (await res.json()) as FullData;
        } catch (err: unknown) {
          notify(t("Fail to load data:") + ` ${err}`, "error", TOAST_KEY_API_FULLDATA);
          const tabId = genTabId(LOCAL_NAME);
          const paneId = genPaneId(LOCAL_NAME);
          setTabs((tabs) => [
            ...tabs,
            {
              id: tabId,
              panes: [{ id: paneId, host: LOCAL_NAME, canonicalHostString: LOCAL_NAME, state: "" }],
              activePaneId: paneId,
              title: LOCAL_NAME,
              type: "terminal",
            },
          ]);
          setActiveTabId(tabId);
          setActivePaneId(paneId);
          return;
        }
      }

      useStore.setState(data);

      __CS_AUTORUN_DONE__ = 0;
      document.documentElement.dataset.csAutorunDone = "0";
      if (autorun) {
        const buttons = getStore().buttons;
        if (!hash) {
          for (const button of buttons) {
            if (button.type === "open_terminal" && button.autorun === 1) {
              await openHost(button.payload, { noUpdateRecent: true });
            }
          }
        }
        for (const button of buttons) {
          if (button.type === "run_script" && button.autorun === 1) {
            try {
              await runScript({ button, background: true });
            } catch (e) {
              console.error(`Autorun script ${button.name} error:`, e);
            }
          }
        }
      }
      __CS_AUTORUN_DONE__ = 1;
      document.documentElement.dataset.csAutorunDone = "1";

      const pinnedTabsData = data.pinned.filter((p) => !p.isHidden);
      const pinnedElsewhere = pinnedTabsData.some((p) => p.listenerCount > 0);

      const autoload =
        getIntVar(VAR_CS_NOAUTOLOAD) !== 1 && startupParams.get(VAR_NOAUTOLOAD) !== "1" && getStore().tabs.length === 0;

      if (hash) {
        const hostsData = data.hosts || [];
        if (hash.startsWith("#")) {
          // Tag mode /##tag
          const tag = hash.substring(1);
          const filtered = hostsData.filter((h) => h.tags && h.tags.includes(tag));

          const favs = filtered.filter((h) => h.tags?.includes(TAG_FAV)).sort(hostSorter);
          const normals = filtered.filter((h) => !h.tags?.includes(TAG_FAV) && !h.isAuto).sort(hostSorter);
          const autos = filtered.filter((h) => !h.tags?.includes(TAG_FAV) && h.isAuto).sort(hostSorter);

          const targets = [...favs, ...normals, ...autos].slice(0, 4);
          if (targets.length > 0) {
            openHostsAsSplit(
              tag.startsWith(TAG_GROUP_PREFIX) ? tag.slice(TAG_GROUP_PREFIX.length) : tag,
              targets.map((h) => h.name),
            );
          } else {
            const tabId = genTabId(LOCAL_NAME);
            const paneId = genPaneId(LOCAL_NAME);
            setTabs((tabs) => [
              ...tabs,
              {
                id: tabId,
                panes: [{ id: paneId, host: LOCAL_NAME, canonicalHostString: LOCAL_NAME, state: "" }],
                activePaneId: paneId,
                title: LOCAL_NAME,
                type: "terminal",
              },
            ]);
            setActiveTabId(tabId);
            setActivePaneId(paneId);
          }
        } else if (!hash.startsWith("$")) {
          // Directly open host(s): /#host1,host2
          const hosts: string[] = hash.split(/\s*,\s*/);
          if (hosts.length > 0) {
            openHostsAsSplit2(hosts);
          } else {
            const tabId = genTabId(LOCAL_NAME);
            const paneId = genPaneId(LOCAL_NAME);
            setTabs((tabs) => [
              ...tabs,
              {
                id: tabId,
                panes: [{ id: paneId, host: LOCAL_NAME, canonicalHostString: LOCAL_NAME, state: "" }],
                activePaneId: paneId,
                title: LOCAL_NAME,
                type: "terminal",
              },
            ]);
            setActiveTabId(tabId);
            setActivePaneId(paneId);
            dialogs.alert(t("SSH server not found"), hash);
          }
        }
      } else if (autoload) {
        if (!pinnedElsewhere) {
          // Only auto-open tabs that are not currently in use by any client
          const availablePins = pinnedTabsData.filter((p) => !p.listenerCount || p.listenerCount === 0);
          const pinnedTabs = availablePins.map((p) => {
            const paneId = p.id;
            return {
              id: p.id,
              panes: [{ id: paneId, host: p.host, canonicalHostString: getCanonicalHostString(p.host), state: "" }],
              activePaneId: paneId,
              title: p.title,
              isPinned: true,
              isLocked: p.isLocked,
              type: "terminal",
            } satisfies TabData;
          });
          if (pinnedTabs.length > 0) {
            setTabs((prev) => (prev.length > 0 ? prev : pinnedTabs));
            if (!getStore().activeTabId) {
              setActiveTabId(pinnedTabs[0].id);
            }
            if (!getStore().activePaneId) {
              setActivePaneId(pinnedTabs[0].activePaneId);
            }
          } else {
            const tabId = genTabId(LOCAL_NAME);
            const paneId = genPaneId(LOCAL_NAME);
            setTabs((prev) =>
              prev.length > 0
                ? prev
                : [
                    {
                      id: tabId,
                      panes: [{ id: paneId, host: LOCAL_NAME, canonicalHostString: LOCAL_NAME, state: "" }],
                      activePaneId: paneId,
                      title: LOCAL_NAME,
                      type: "terminal",
                    },
                  ],
            );
            if (!getStore().activeTabId) {
              setActiveTabId(tabId);
            }
            if (!getStore().activePaneId) {
              setActivePaneId(paneId);
            }
          }
        } else {
          const tabId = genTabId(LOCAL_NAME);
          const paneId = genPaneId(LOCAL_NAME);
          setTabs((prev) =>
            prev.length > 0
              ? prev
              : [
                  {
                    id: tabId,
                    panes: [{ id: paneId, host: LOCAL_NAME, canonicalHostString: LOCAL_NAME, state: "" }],
                    activePaneId: paneId,
                    title: LOCAL_NAME,
                    type: "terminal",
                  },
                ],
          );
          if (!getStore().activeTabId) {
            setActiveTabId(tabId);
          }
          if (!getStore().activePaneId) {
            setActivePaneId(paneId);
          }
        }
      }
    };

    initAsync();
    // Run ONLY once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleFiles = useCallback(() => {
    if (!contextMenu) {
      return;
    }
    const targetId = contextMenu.targetTabId;
    setContextMenu(null);
    setTabs((prev) => prev.map((t) => (t.id === targetId ? { ...t, showFiles: !t.showFiles } : t)));
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMemoTabId(id);
    setContextMenu({ mouseX: e.clientX + 2, mouseY: e.clientY - 6, targetTabId: id });
  }, []);

  const handleCloseMenu = useCallback(() => setContextMenu(null), []);

  const [lastKeyboardHeight, setLastKeyboardHeight] = useState(0);

  // 1. Bring back a safe tracking state just for the closing transition
  const [isClosingPanel, setIsClosingPanel] = useState(false);
  const prevExtraKeysOpen = useRef(extraKeysOpen);

  useEffect(() => {
    if (keyboardHeight > 60) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastKeyboardHeight(keyboardHeight);
    }
  }, [keyboardHeight]);

  // 2. Track when the panel closes to hold the spacer momentarily
  useEffect(() => {
    if (prevExtraKeysOpen.current === true && extraKeysOpen === false) {
      setIsClosingPanel(true);
      const timer = setTimeout(() => setIsClosingPanel(false), 200);
      return () => clearTimeout(timer);
    }
    prevExtraKeysOpen.current = extraKeysOpen;
  }, [extraKeysOpen]);

  const activeKbHeight = keyboardHeight > 60 ? keyboardHeight : lastKeyboardHeight;
  const panelHeight = activeKbHeight > 60 ? activeKbHeight + 40 : Math.floor(window.innerHeight * 0.38);

  const barHeight = extraKeysOpen ? 0 : 40;

  // 3. CRITICAL FIX: Only calculate the spacer if the panel is open or closing.
  // Otherwise, it must be exactly 0 (like on initial page load).
  const spacerHeight = Math.floor(
    extraKeysOpen || isClosingPanel ? Math.max(0, panelHeight - keyboardHeight - barHeight) : 0,
  );

  const onTerminalFocus = useCallback(() => {}, []);
  const onTerminalBlur = useCallback(() => {
    setExtraKeysOpen(false);
  }, []);

  useEffect(() => {
    if (applets.length === 0) {
      triggerFocus();
    }
  }, [applets.length]);

  return (
    <ThemeProvider theme={muiTheme}>
      <Box id="main-ui" sx={{ display: "flex", height: viewportHeight, overflow: "hidden" }}>
        <CssBaseline />
        <Sidebar
          isMobile={isMobile}
          isTouch={isTouch}
          onAttach={(session) => {
            setMobileOpen(false);
            attachSession(session);
          }}
          onRefresh={async () => {
            setMobileOpen(false);
            try {
              await refreshData({ sync: 2 });
              notify(t("Data refreshed"), "success", TOAST_KEY_REFRESH);
            } catch (err: unknown) {
              notify(t("Data refresh failure:") + ` ${err}`, "error", TOAST_KEY_REFRESH);
            }
          }}
          onOpenScratchpad={() => {
            setMobileOpen(false);
            openScratchpad();
          }}
        />
        <Box
          id="main-content"
          component="main"
          sx={{
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            position: "relative",
          }}
        >
          <TabBar
            isMobile={isMobile}
            isTouch={isTouch}
            hasSidebarApplet={hasSidebarApplet}
            scratchpadSyncState={scratchpadSyncState}
            handleContextMenu={handleContextMenu}
          />
          <TerminalGrid
            terminalRefs={terminalRefs}
            onTerminalBlur={onTerminalBlur}
            onTerminalFocus={onTerminalFocus}
            scratchpadSyncState={scratchpadSyncState}
            setScratchpadSyncState={setScratchpadSyncState}
            isMobile={isMobile}
            hasSidebarApplet={hasSidebarApplet}
            handleTouchStart={handleTouchStart}
            handleTouchEnd={handleTouchEnd}
            gestureMode={gestureMode}
            onGestureModeChange={setGestureMode}
            extraKeysOpen={extraKeysOpen}
            onExtraKeysOpenChange={setExtraKeysOpen}
            keyboardHeight={keyboardHeight}
          />
          <ButtonBar groups={groups} isMobile={isMobile} isTouch={isTouch} />
          <Box
            id="mobile-keyboard-spacer"
            sx={{
              flexShrink: 0,
              order: 9999,
              height: `${spacerHeight}px`, // Controlled strictly by React math
              width: "100%",
            }}
          />
        </Box>
        {applets.filter((a) => a.position === "sidebar").length > 0 &&
          (isMobile ? (
            <Drawer
              anchor="right"
              open={mobileAppletsOpen}
              onClose={() => setMobileAppletsOpen(false)}
              sx={{ "& .MuiDrawer-paper": { width: 320, boxSizing: "border-box" } }}
            >
              <Box
                sx={{
                  px: 1,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: 1,
                  borderColor: "divider",
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: "bold" }}>
                  Applets
                </Typography>
                <IconButton onClick={() => setMobileAppletsOpen(false)}>
                  <CloseIcon />
                </IconButton>
              </Box>
              <Box sx={{ flexGrow: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
                {applets
                  .filter((a) => a.position === "sidebar")
                  .map((applet, idx) => (
                    <AppletWrapper
                      key={applet.name}
                      applet={applet}
                      invisible={isMobile && !mobileAppletsOpen}
                      index={idx}
                      onClose={() => setApplets((prev) => prev.filter((a) => a.name !== applet.name))}
                      onSwitchPosition={(pos) =>
                        setApplets((prev) => prev.map((a) => (a.name === applet.name ? { ...a, position: pos } : a)))
                      }
                    />
                  ))}
              </Box>
            </Drawer>
          ) : (
            <Box
              sx={{
                width: 320,
                flexShrink: 0,
                borderLeft: 1,
                borderColor: "divider",
                display: "flex",
                flexDirection: "column",
                bgcolor: "background.paper",
                overflow: "hidden",
                height: "100%",
              }}
            >
              {applets
                .filter((a) => a.position === "sidebar")
                .map((applet, idx) => (
                  <AppletWrapper
                    key={applet.name}
                    applet={applet}
                    index={idx}
                    onClose={() => setApplets((prev) => prev.filter((a) => a.name !== applet.name))}
                    onSwitchPosition={(pos) =>
                      setApplets((prev) => prev.map((a) => (a.name === applet.name ? { ...a, position: pos } : a)))
                    }
                  />
                ))}
            </Box>
          ))}
      </Box>

      {applets
        .filter((a) => a.position === "widget")
        .map((applet, idx) => (
          <AppletWrapper
            key={applet.name}
            applet={applet}
            index={idx}
            onClose={() => setApplets((prev) => prev.filter((a) => a.name !== applet.name))}
            onSwitchPosition={(pos) =>
              setApplets((prev) => prev.map((a) => (a.name === applet.name ? { ...a, position: pos } : a)))
            }
            onFocus={() =>
              setApplets((prev) =>
                prev.map((a) => (a.name === applet.name ? { ...a, zIndex: maxZIndexRef.current++ } : a)),
              )
            }
          />
        ))}

      {applets
        .filter((a) => a.position === "dialog")
        .map((applet) => (
          <Dialog
            key={applet.name}
            open
            onClose={() => setApplets((prev) => prev.filter((a) => a.name !== applet.name))}
            fullWidth
            fullScreen={applet.fullScreen}
            maxWidth={false}
            slotProps={{
              paper: {
                sx: {
                  width: applet.width ?? 600,
                  maxWidth: "95vw",
                  height: applet.height ?? undefined,
                },
              },
            }}
          >
            <DialogTitle
              sx={{
                display: "flex",
                alignItems: "center",
                p: 1,
                pl: 2,
                borderBottom: 1,
                borderColor: "divider",
              }}
            >
              <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: "bold" }}>
                {applet.name}
              </Typography>
              <IconButton
                size="small"
                title={t("Move to sidebar")}
                onClick={() =>
                  setApplets((prev) => prev.map((a) => (a.name === applet.name ? { ...a, position: "sidebar" } : a)))
                }
                sx={{ mr: 0.5 }}
              >
                <ViewSidebarIcon fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                title={t("Move to widget")}
                onClick={() =>
                  setApplets((prev) =>
                    prev.map((a) =>
                      a.name === applet.name ? { ...a, position: "widget", zIndex: maxZIndexRef.current++ } : a,
                    ),
                  )
                }
                sx={{ mr: 0.5 }}
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => setApplets((prev) => prev.filter((a) => a.name !== applet.name))}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </DialogTitle>
            <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
              <AppletWrapper
                applet={applet}
                index={0}
                onClose={() => setApplets((prev) => prev.filter((a) => a.name !== applet.name))}
                onSwitchPosition={(pos) =>
                  setApplets((prev) => prev.map((a) => (a.name === applet.name ? { ...a, position: pos } : a)))
                }
              />
            </DialogContent>
          </Dialog>
        ))}

      <DialogManager
        isMobile={isMobile}
        isTouch={isTouch}
        contextMenu={contextMenu}
        handleCloseMenu={handleCloseMenu}
        memoTabId={memoTabId}
        handleToggleFiles={handleToggleFiles}
        groups={groups}
        sendParsedString={sendParsedString}
      />
      <SideEffect />
    </ThemeProvider>
  );
}
