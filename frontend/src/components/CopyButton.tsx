import Button, { type ButtonProps } from "@mui/material/Button";

import { TOAST_KEY_COPY } from "../constants";
import { notify } from "../store";
import { t } from "../common";

interface CopyButtonProps extends Omit<ButtonProps, "onClick"> {
  data: string | (() => string);
}

export default function CopyButton({ data, children, ...props }: CopyButtonProps) {
  return (
    <Button
      {...props}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        navigator.clipboard
          .writeText(typeof data === "function" ? data() : data)
          .then(() => {
            notify(t("Copied to clipboard"), "info", TOAST_KEY_COPY);
          })
          .catch(() => {
            notify(t("Failed to copy to clipboard"), "error", TOAST_KEY_COPY);
          });
      }}
    >
      {children}
    </Button>
  );
}
