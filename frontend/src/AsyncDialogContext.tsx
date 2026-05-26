import { type ReactNode, useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
  Button
} from '@mui/material';

interface Api {
  alert: (title: string, message?: string) => Promise<void>;
  confirm: (title: string, message?: string) => Promise<boolean>;
  prompt: (title: string, message?: string, options?: {
    placeholder?: string; validate?: (value: string) => string | undefined; defaultValue?: string
  }) => Promise<string | null>;
}

interface DialogConfig {
  type: 'alert' | 'confirm' | 'prompt';
  title: string;
  message: string;
  placeholder: string;
  validate: ((value: string) => string | undefined) | null;
}

// 1. Internal registry to bridge the static export to the React provider instance
const registry = {
  current: null as Api | null
};

// 2. Exported global singleton object. 
// Because it's a module-level constant, it never goes into dependency arrays.
// eslint-disable-next-line react-refresh/only-export-components
export const dialogs: Api = {
  alert: (title, message) => registry.current?.alert(title, message) ?? Promise.resolve(),
  confirm: (title, message) => registry.current?.confirm(title, message) ?? Promise.resolve(false),
  prompt: (title, message, options) => registry.current?.prompt(title, message, options) ?? Promise.resolve(null),
};

export const AsyncDialogProvider = ({ children }: { children: ReactNode }) => {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');

  const [config, setConfig] = useState<DialogConfig>({
    type: 'alert',
    title: '',
    message: '',
    placeholder: '',
    validate: null
  });

  const resolveRef = useRef<((value: any) => void) | null>(null);

  const triggerDialog = (
    type: 'alert' | 'confirm' | 'prompt',
    title: string,
    message: string = '',
    options: { placeholder?: string; validate?: (value: string) => string | undefined; defaultValue?: string } = {}
  ) => {
    setConfig({
      type,
      title,
      message,
      placeholder: options.placeholder || '',
      validate: options.validate || null
    });
    setInputValue(options.defaultValue || '');
    setError('');
    setOpen(true);

    return new Promise<any>((resolve) => {
      resolveRef.current = resolve;
    });
  };

  // 3. Bind the runtime trigger functions to the registry
  useEffect(() => {
    registry.current = {
      alert: (title, message) => triggerDialog('alert', title, message),
      confirm: (title, message) => triggerDialog('confirm', title, message),
      prompt: (title, message, options) => triggerDialog('prompt', title, message, options)
    };
  }, []);

  const handleClose = (confirmed: boolean) => {
    if (!resolveRef.current) return;

    if (!confirmed) {
      setOpen(false);
      resolveRef.current(config.type === 'prompt' ? null : false);
      return;
    }

    if (config.type === 'prompt' && config.validate) {
      const validationError = config.validate(inputValue);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    setOpen(false);
    resolveRef.current(config.type === 'prompt' ? inputValue : true);
  };

  return (
    <>
      {children}
      <Dialog
        open={open}
        onClose={() => handleClose(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle sx={{ pb: 1 }}>{config.title}</DialogTitle>
        <DialogContent>
          {config.message && (
            <DialogContentText sx={{ mb: config.type === 'prompt' ? 2 : 0 }}>
              {config.message}
            </DialogContentText>
          )}

          {config.type === 'prompt' && (
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
                if (error) setError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleClose(true)}
            />
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          {config.type !== 'alert' && (
            <Button onClick={() => handleClose(false)} color="inherit">
              Cancel
            </Button>
          )}
          <Button
            onClick={() => handleClose(true)}
            variant={config.type === 'alert' ? 'text' : 'contained'}
            disableElevation
            autoFocus={config.type !== 'prompt'}
          >
            OK
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};