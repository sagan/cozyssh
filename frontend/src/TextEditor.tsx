import { useCallback, useState } from 'react';
import { Box, Button, AppBar, Toolbar, Typography, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from "@codemirror/view";
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { cpp } from '@codemirror/lang-cpp';
import { yaml } from '@codemirror/lang-yaml';
import { dialogs } from './Dialogs';

const getLanguageExtension = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
      return [javascript({ jsx: true, typescript: true })];
    case 'py': return [python()];
    case 'html': return [html()];
    case 'css': return [css()];
    case 'json': return [json()];
    case 'md': return [markdown()];
    case 'cpp':
    case 'c':
    case 'h':
    case 'hpp':
    case 'go': // fallback cpp for basic C-like syntax
      return [cpp()];
    case 'yaml':
    case 'yml':
      return [yaml()];
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
      if (!await dialogs.confirm("You have unsaved changes. Discard them and close?")) {
        return;
      }
    }
    onClose();
  }, [hasChanged, onClose]);

  return (
    <Box sx={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 1000,
      backgroundColor: '#ffffff',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <AppBar position="static" color="default" elevation={1} sx={{ bgcolor: '#f4f6f8' }}>
        <Toolbar variant="dense">
          <Typography variant="h6" sx={{
            flexGrow: 1, fontFamily: 'monospace', fontSize: '0.9rem',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            Editing: {fileName}
          </Typography>
          <Button
            variant="contained"
            color="primary"
            size="small"
            sx={{ mr: 2 }}
            onClick={() => onSave(content)}
            disabled={!hasChanged || isSaving}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
          <IconButton edge="end" color="inherit" onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{
        flexGrow: 1, overflow: 'auto', '& .cm-theme-light': { height: '100%' },
        '& .cm-editor': { height: '100%' }
      }}>
        <CodeMirror
          value={content}
          height="100%"
          style={{ height: '100%' }}
          extensions={[...getLanguageExtension(fileName), EditorView.lineWrapping]}
          onChange={(val) => setContent(val)}
        />
      </Box>
    </Box>
  );
}
