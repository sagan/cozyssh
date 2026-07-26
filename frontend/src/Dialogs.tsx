// async version of alert, confirm, prompt using MUI dialog
import { type ReactNode, useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  Button,
  FormControlLabel,
  Checkbox,
  MenuItem,
} from "@mui/material";
import { notify, setAsyncDialogOpen, triggerFocus, useStore } from "./store";
import { getKeyCombination, isMuiModalOpen, t } from "./common";
import { TOAST_KEY_COPY } from "./constants";

export interface DialogApi {
  alert: typeof csAlert;
  confirm: typeof csConfirm;
  prompt: typeof csPrompt;
  promptPassword: typeof csPromptPassword;
  choose: typeof csChoose;
}

interface DialogConfig {
  type: "alert" | "confirm" | "prompt" | "choose";
  message?: string;
  detail?: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: ((value: string) => string | undefined) | null;
  inputType?: string;
  verification?: boolean | string;
  options?: (string | CsChooseAction)[];
}
// 1. Internal registry to bridge the static export to the React provider instance
const registry = {
  current: null as DialogApi | null,
};

// 2. Exported global singleton object.
// Because it's a module-level constant, it never goes into dependency arrays.
// eslint-disable-next-line react-refresh/only-export-components
export const dialogs: DialogApi = {
  alert: (message, detail) => registry.current?.alert(message, detail) ?? Promise.resolve(),
  confirm: (message, detail, verification) =>
    registry.current?.confirm(message, detail, verification) ?? Promise.resolve(false),
  prompt: (message, defaultValue, options) =>
    registry.current?.prompt(message, defaultValue, options) ?? Promise.resolve(null),
  promptPassword: (message, defaultValue) =>
    registry.current?.promptPassword(message, defaultValue) ?? Promise.resolve(null),
  choose: (title, message, actions) => registry.current?.choose(title, message, actions) ?? Promise.resolve(null),
};

export const AsyncDialogProvider = ({ children }: { children: ReactNode }) => {
  const asyncDialogOpen = useStore((state) => state.asyncDialogOpen);

  const [inputValue, setInputValue] = useState("");
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");

  const [config, setConfig] = useState<DialogConfig>({
    type: "alert",
    message: "",
    detail: "",
    placeholder: "",
    validate: null,
    inputType: "",
    verification: undefined,
    options: [],
  });

  const resolveRef = useRef<((value: string | boolean | null) => void) | null>(null);

  const triggerDialog = (config: DialogConfig) => {
    setConfig(config);
    setInputValue(config.defaultValue || "");
    setChecked(false);
    setError("");
    setAsyncDialogOpen(true);
    return new Promise<unknown>((resolve) => {
      resolveRef.current = resolve;
    });
  };

  // 3. Bind the runtime trigger functions to the registry
  useEffect(() => {
    registry.current = {
      alert: ((message, detail) => triggerDialog({ type: "alert", message, detail })) as DialogApi["alert"],
      confirm: ((message, detail, verification) =>
        triggerDialog({ type: "confirm", message, detail, verification })) as DialogApi["confirm"],
      prompt: ((message, defaultValue, options) =>
        triggerDialog({ type: "prompt", message, defaultValue, ...options })) as DialogApi["prompt"],
      promptPassword: ((message, defaultValue) =>
        triggerDialog({ type: "prompt", inputType: "password", message, defaultValue })) as DialogApi["promptPassword"],
      choose: ((title, message, options) =>
        triggerDialog({ type: "choose", message: title, detail: message, options })) as DialogApi["choose"],
    };
  }, []);

  const handleClose = (outcome: string | boolean | null) => {
    if (!resolveRef.current) {
      return;
    }

    // Backdrop click / ESC press or explicitly passing cancel states
    if (outcome === false || outcome === null) {
      setAsyncDialogOpen(false);
      if (!isMuiModalOpen()) {
        triggerFocus();
      }
      resolveRef.current(config.type === "prompt" || config.type === "choose" ? null : false);
      return;
    }

    if (config.type === "confirm") {
      if (config.verification === true && !checked) {
        return;
      }
      if (typeof config.verification === "string" && inputValue !== config.verification) {
        return;
      }
    }

    if (config.type === "prompt" && config.validate) {
      const validationError = config.validate(inputValue);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setAsyncDialogOpen(false);
    if (!isMuiModalOpen()) {
      triggerFocus();
    }
    if (config.type === "prompt") {
      resolveRef.current(inputValue);
    } else if (config.type === "choose") {
      resolveRef.current(typeof outcome === "string" ? outcome : null);
    } else {
      resolveRef.current(true);
    }
  };

  // Determine if the confirmation criteria are unmet
  const isConfirmDisabled =
    config.type === "confirm" &&
    ((config.verification === true && !checked) ||
      (typeof config.verification === "string" && inputValue !== config.verification));

  return (
    <>
      {children}
      <Dialog
        id="async-modal-dialog"
        data-type={config.type}
        open={asyncDialogOpen}
        onClose={() => handleClose(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ pb: 1 }}>{config.message}</DialogTitle>
        <DialogContent sx={{ whiteSpace: "break-spaces" }}>
          {config.detail && (
            <DialogContentText sx={{ mb: config.type === "prompt" || config.verification ? 2 : 0 }}>
              {config.detail}
            </DialogContentText>
          )}

          {/* Checkbox Verification */}
          {config.type === "confirm" && config.verification === true && (
            <FormControlLabel
              control={
                <Checkbox
                  autoFocus
                  checked={checked}
                  onChange={(e) => setChecked(e.target.checked)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && checked) {
                      e.stopPropagation();
                      e.preventDefault();
                      handleClose(true);
                    }
                  }}
                />
              }
              label={t("I confirm and wish to proceed")}
            />
          )}

          {/* Text-matching Verification */}
          {config.type === "confirm" && typeof config.verification === "string" && (
            <TextField
              autoFocus
              margin="dense"
              fullWidth
              variant="outlined"
              placeholder={`Type "${config.verification}" to confirm`}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  e.preventDefault();
                  if (inputValue === config.verification) {
                    handleClose(true);
                  }
                }
              }}
            />
          )}

          {config.type === "prompt" && (
            <TextField
              autoFocus
              margin="dense"
              fullWidth
              select={!!config.options?.length}
              variant="outlined"
              type={config.inputType || "text"}
              placeholder={config.placeholder}
              value={inputValue}
              error={Boolean(error)}
              helperText={error}
              onChange={(e) => {
                setInputValue(e.target.value);
                if (error) {
                  setError("");
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  e.preventDefault();
                  handleClose(true);
                }
              }}
            >
              {config.options?.map((option, idx) => (
                <MenuItem key={idx} value={typeof option === "object" ? option.value : option}>
                  {typeof option === "object" ? option.label : option}
                </MenuItem>
              ))}
            </TextField>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {config.type === "choose" ? (
            (config.options || []).map((action, idx) => {
              const item =
                typeof action === "string"
                  ? ({ value: action, variant: idx === 0 ? "primary" : "secondary" } satisfies CsChooseAction)
                  : action;
              const label = item.label ?? item.value;

              // Map custom style variants cleanly to MUI Button props
              const btnVariant = item.variant === "secondary" ? "outlined" : "contained";
              const btnColor = item.variant && item.variant !== "secondary" ? item.variant : "primary";

              return (
                <Button
                  key={item.value}
                  onClick={() => handleClose(item.value)}
                  variant={btnVariant}
                  color={btnColor}
                  disableElevation
                  autoFocus={idx === 0}
                >
                  {label}
                </Button>
              );
            })
          ) : (
            <>
              {config.type !== "alert" && (
                <Button onClick={() => handleClose(false)} color="inherit">
                  {t("Cancel")}
                </Button>
              )}
              <Button
                onClick={() => handleClose(true)}
                variant={config.type === "alert" ? "text" : "contained"}
                disableElevation
                autoFocus={config.type !== "prompt" && !config.verification}
                disabled={isConfirmDisabled}
                onKeyDown={(e) => {
                  const kc = getKeyCombination(e);
                  if (kc === "alt+enter") {
                    const data = config.detail || config.message;
                    if (data) {
                      e.stopPropagation();
                      e.preventDefault();
                      navigator.clipboard.writeText(data);
                      notify(t("Copied"), "info", TOAST_KEY_COPY);
                      handleClose(true);
                    }
                  }
                }}
              >
                {t("OK")}
              </Button>
              {config.type === "alert" && !!(config.detail || config.message) && (
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText((config.detail || config.message)!);
                    handleClose(true);
                  }}
                  color="inherit"
                >
                  {t("Copy")} (alt+enter)
                </Button>
              )}
            </>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
};
