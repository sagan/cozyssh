import { useCallback, useState } from "react";
import { Box, Button, AppBar, Toolbar, Typography, IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { yaml } from "@codemirror/lang-yaml";
import { liquid } from "@codemirror/lang-liquid";
import { php } from "@codemirror/lang-php";
import { java } from "@codemirror/lang-java";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { dialogs } from "./Dialogs";
import { t } from "./common";

const getLanguageExtension = (fileName: string) => {
  const ext = fileName.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
      return [javascript({ jsx: true, typescript: true })];
    case "py":
      return [python()];
    case "html":
      return [html()];
    case "css":
      return [css()];
    case "json":
      return [json()];
    case "md":
      return [markdown()];
    case "cpp":
    case "c":
    case "h":
    case "hpp":
      return [cpp()];
    case "go":
      return [go()];
    case "yaml":
    case "yml":
      return [yaml()];
    case "liquid":
      return [liquid()];
    case "php":
      return [php()];
    case "java":
      return [java()];
    case "rs":
      return [rust()];
    case "sql":
      return [sql()];
    case "xml":
      return [xml()];
    default:
      return [];
  }
};

interface TextEditorProps {
  fileName: string;
  initialContent: string;
  onSave: (content: string) => void;
  onClose: () => void;
  isSaving?: boolean;
}

export default function TextEditor({ fileName, initialContent, onSave, onClose, isSaving }: TextEditorProps) {
  const [content, setContent] = useState(initialContent);
  const hasChanged = content !== initialContent;

  const handleClose = useCallback(async () => {
    if (hasChanged) {
      if (!(await dialogs.confirm(t("You have unsaved changes. Discard them and close?")))) {
        return;
      }
    }
    onClose();
  }, [hasChanged, onClose]);

  return (
    <Box
      sx={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 1000,
        backgroundColor: "#ffffff",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: "#f4f6f8" }}>
        <Toolbar variant="dense">
          <Typography
            variant="h6"
            sx={{
              flexGrow: 1,
              fontFamily: "monospace",
              fontSize: "typography.body2.fontSize",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {t("Editing:")} {fileName}
          </Typography>
          <Button
            variant="contained"
            color="secondary"
            size="small"
            sx={{ mr: 1 }}
            onClick={() => navigator.clipboard.writeText(fileName)}
          >
            {t("Copy Path")}
          </Button>
          <Button
            variant="contained"
            color="secondary"
            size="small"
            sx={{ mr: 1 }}
            onClick={() => navigator.clipboard.writeText(content)}
          >
            {t("Copy")}
          </Button>
          <Button
            variant="contained"
            color="primary"
            size="small"
            sx={{ mr: 1 }}
            onClick={() => onSave(content)}
            disabled={!hasChanged || isSaving}
          >
            {isSaving ? t("Saving...") : t("Save")}
          </Button>
          <IconButton title={t("Close")} edge="end" color="inherit" onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box
        sx={{
          flexGrow: 1,
          overflow: "auto",
          "& .cm-theme-light": { height: "100%" },
          "& .cm-editor": { height: "100%" },
        }}
      >
        <CodeMirror
          value={content}
          height="100%"
          style={{ height: "100%" }}
          extensions={[...getLanguageExtension(fileName), EditorView.lineWrapping]}
          onChange={(val) => setContent(val)}
        />
      </Box>
    </Box>
  );
}
