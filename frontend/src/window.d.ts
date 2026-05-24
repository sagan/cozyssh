import { type Terminal } from "@xterm/xterm";

import { type ButtonData, type HostData } from "./api";
import { type Severity } from "./common";
import { type AppletPosition, type CsExecResult } from "./pluginAPI";
import { type TerminalRefMap, type TabData } from "./dashboardStore";
import { type AppletData } from "./AppletWrapper";
import { type ShellIntegration } from "./Terminal";

interface VirtualKeyboard extends EventTarget {
  readonly boundingRect: DOMRect;
  overlaysContent: boolean;
  ongeometrychange: ((this: VirtualKeyboard, ev: Event) => unknown) | null;
  show(): void;
  hide(): void;
  addEventListener(
    type: "geometrychange",
    listener: (this: VirtualKeyboard, ev: Event) => unknown,
    options?: boolean | AddEventListenerOptions
  ): void;
}

declare global {
  interface Navigator {
    readonly virtualKeyboard?: VirtualKeyboard;
  }
  interface Window {
    __CS_AUTORUN_DONE__: undefined | number;
    __CS_MODULECACHE__: Record<string, Record<string, unknown>>;
    __CS_VERSION__: string;
    __CS_PASSTHROUGH_SHORTCUTS__: undefined | Set<string> | string[];
    csFocus: (paneId?: string) => void;
    csNotify: (msg: string, severity: Severity = "info") => void;
    csOpen: (target: HostData | string | (HostData | string)[], options?: { name?: string }) => void;
    csGetTerminal: (paneId?: string) => Terminal | undefined | null;
    csGetTerminalContents: (lineCount?: number, paneId?: string) => string;
    csGetShellIntegration: (paneId?: string) => ShellIntegration | undefined;
    csSendData: (data: string, paneId?: string) => void;
    csGetAll: () => {
      activePaneId: string;
      terminals: TerminalRefMap;
      shellIntegrations: Record<string, ShellIntegration>;
      tabs: TabData[];
      hosts: HostData[];
      buttons: ButtonData[];
      vars: Record<string, string | undefined>;
      localVars: Record<string, string | undefined>;
    };
    csFetch: (url: string, init?: RequestInit) => Promise<Response>;
    csGetVar(name: string): string | undefined;
    csGetVar(): Record<string, string>;
    csSetVar: (nameOrVars: string, value: string | undefined) => Promise<void>;
    csSetVar: (vars: Record<string, string | undefined>) => Promise<void>;
    csGetTerminal: (paneId?: string) => unknown;
    csUpdateButton: (btn: ButtonData) => Promise<string>;
    csDeleteButton: (id: string) => Promise<void>;
    csUpdateHost: (btn: HostData) => Promise<void>;
    csDeleteHost: (id: string) => Promise<void>;
    csExec: (cmdline: string) => Promise<CsExecResult>;
    csOpenApplet(
      name: string,
      node: Node | React.ComponentType,
      options?: { position?: AppletPosition; width?: number; height?: number }
    ): void;
    csCloseApplet: (name: string) => void;
    csGetApplet: (name: string) => AppletData;
    csGetApplet: () => AppletData[];
    csRefresh: () => Promise<void>;
    csSetTheme: (options: unknown, ...args: unknown[]) => void;
    csAttach: (id: string, host: string, title: string, isLocked = false) => void;
  }
}
