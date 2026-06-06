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
} from "@mui/material";
import { triggerFocus } from "./store";

export interface DialogApi {
  alert: typeof csAlert;
  confirm: typeof csConfirm;
  prompt: typeof csPrompt;
  promptPassword: typeof csPromptPassword;
}

interface DialogConfig {
  type: "alert" | "confirm" | "prompt";
  message?: string;
  detail?: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: ((value: string) => string | undefined) | null;
  inputType?: string;
  verification?: boolean | string;
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
};

export const AsyncDialogProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
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
  });

  const resolveRef = useRef<((value: string | boolean | null) => void) | null>(null);

  const triggerDialog = (config: DialogConfig) => {
    setConfig(config);
    setInputValue(config.defaultValue || "");
    setChecked(false);
    setError("");
    setOpen(true);
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
    };
  }, []);

  const handleClose = (confirmed: boolean) => {
    if (!resolveRef.current) {
      return;
    }

    if (!confirmed) {
      setOpen(false);
      resolveRef.current(config.type === "prompt" ? null : false);
      triggerFocus();
      return;
    }

    // Safety guard for verification requirements
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

    setOpen(false);
    resolveRef.current(config.type === "prompt" ? inputValue : true);
    triggerFocus();
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
        open={open}
        onClose={() => handleClose(false)}
        fullWidth
        maxWidth="xs"
        sx={{ wordBreak: "break-all" }}
      >
        <DialogTitle sx={{ pb: 1 }}>{config.message}</DialogTitle>
        <DialogContent>
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
              label="I confirm and wish to proceed"
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
            />
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {config.type !== "alert" && (
            <Button onClick={() => handleClose(false)} color="inherit">
              Cancel
            </Button>
          )}
          <Button
            onClick={() => handleClose(true)}
            variant={config.type === "alert" ? "text" : "contained"}
            disableElevation
            autoFocus={config.type !== "prompt" && !config.verification}
            disabled={isConfirmDisabled}
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
