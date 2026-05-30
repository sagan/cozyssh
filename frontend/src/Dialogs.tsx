// async version of alert, confirm, prompt using MUI dialog
import { type ReactNode, useState, useRef, useEffect } from "react";
import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, TextField, Button } from "@mui/material";

export interface DialogApi {
  alert: typeof csAlert;
  confirm: typeof csConfirm;
  prompt: typeof csPrompt;
}

interface DialogConfig {
  type: "alert" | "confirm" | "prompt";
  message?: string;
  detail?: string;
  placeholder?: string;
  defaultValue?: string;
  validate?: ((value: string) => string | undefined) | null;
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
  confirm: (message, detail) => registry.current?.confirm(message, detail) ?? Promise.resolve(false),
  prompt: (message, defaultValue, options) =>
    registry.current?.prompt(message, defaultValue, options) ?? Promise.resolve(null),
};

export const AsyncDialogProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");

  const [config, setConfig] = useState<DialogConfig>({
    type: "alert",
    message: "",
    detail: "",
    placeholder: "",
    validate: null,
  });

  const resolveRef = useRef<((value: string | boolean | null) => void) | null>(null);

  const triggerDialog = (config: DialogConfig) => {
    setConfig(config);
    setInputValue(config.defaultValue || "");
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
      confirm: ((message, detail) => triggerDialog({ type: "confirm", message, detail })) as DialogApi["confirm"],
      prompt: ((message, defaultValue) =>
        triggerDialog({ type: "prompt", message, defaultValue })) as DialogApi["prompt"],
    };
  }, []);

  const handleClose = (confirmed: boolean) => {
    if (!resolveRef.current) {
      return;
    }

    if (!confirmed) {
      setOpen(false);
      resolveRef.current(config.type === "prompt" ? null : false);
      return;
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
  };

  return (
    <>
      {children}
      <Dialog
        id="async-modal-dialog"
        data-modal-type={config.type}
        open={open}
        onClose={() => handleClose(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle sx={{ pb: 1 }}>{config.message}</DialogTitle>
        <DialogContent>
          {config.detail && (
            <DialogContentText sx={{ mb: config.type === "prompt" ? 2 : 0 }}>{config.detail}</DialogContentText>
          )}
          {config.type === "prompt" && (
            <TextField
              autoFocus
              margin="dense"
              fullWidth
              variant="outlined"
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
            autoFocus={config.type !== "prompt"}
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
