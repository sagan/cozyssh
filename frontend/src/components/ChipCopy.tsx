import Chip, { type ChipProps } from "@mui/material/Chip";

import { TOAST_KEY_COPY } from "../constants";
import { notify } from "../store";

interface ChipCopyProps extends Omit<ChipProps, "onClick"> {
  label: string | undefined | null;
}

export default function ChipCopy(props: ChipCopyProps) {
  return (
    <Chip
      {...props}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!props.label) {
          return;
        }
        navigator.clipboard
          .writeText(props.label)
          .then(() => {
            notify("Copied to clipboard", "info", TOAST_KEY_COPY);
          })
          .catch(() => {
            notify("Failed to copy to clipboard", "error", TOAST_KEY_COPY);
          });
      }}
    />
  );
}
