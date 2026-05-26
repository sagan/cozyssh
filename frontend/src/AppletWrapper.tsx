import React, { useState, useEffect, useRef } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';

import type { AppletPosition } from './pluginAPI';

interface AppletWrapperProps {
  applet: AppletData;
  index: number;
  onClose: () => void;
  onSwitchPosition: (pos: AppletPosition) => void;
  onFocus?: () => void;
}

export interface AppletData {
  name: string;
  node: Node | React.ComponentType;
  position: AppletPosition;
  width?: number;
  height?: number;
  zIndex?: number;
}

export default function AppletWrapper({
  applet,
  onClose,
  onSwitchPosition,
  onFocus,
}: AppletWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [size, setSize] = useState(() => ({
    width: applet.width || 320,
    height: applet.height || 250,
  }));
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, window.innerWidth - (applet.width || 320) - 20),
    y: Math.max(0, window.innerHeight - (applet.height || 250) - 20),
  }));
  const dragStartRef = useRef({ x: 0, y: 0, pos: { x: 0, y: 0 } });

  useEffect(() => {
    if (applet.width !== undefined || applet.height !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSize(prev => ({
        width: applet.width ?? prev.width,
        height: applet.height ?? prev.height
      }));
    }
  }, [applet.width, applet.height]);

  useEffect(() => {
    if (applet.node instanceof Node && containerRef.current) {
      containerRef.current.innerHTML = '';
      containerRef.current.appendChild(applet.node);
    }
  }, [applet.node, expanded]);

  useEffect(() => {
    const handleWindowResize = () => {
      if (applet.position !== 'widget' || !wrapperRef.current) {
        return;
      }
      const winW = window.innerWidth;
      const winH = window.innerHeight;

      setPosition(prev => ({
        x: Math.max(0, Math.min(prev.x, winW - (wrapperRef.current?.offsetWidth || 0))),
        y: Math.max(0, Math.min(prev.y, winH - (wrapperRef.current?.offsetHeight || 0)))
      }));
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, [applet.position]);

  useEffect(() => {
    if (applet.position !== 'widget' || !wrapperRef.current) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const w = target.offsetWidth;
        const h = target.offsetHeight;
        if (w > 0 && h > 0) {
          setSize(prev => {
            if (Math.abs(prev.width - w) < 1 && Math.abs(prev.height - h) < 1) {
              return prev;
            }
            return { width: w, height: h };
          });
        }
      }
    });
    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [applet.position]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (applet.position !== 'widget') {
      return;
    }
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY, pos: position };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) {
        return;
      }
      setPosition({
        x: dragStartRef.current.pos.x + (e.clientX - dragStartRef.current.x),
        y: dragStartRef.current.pos.y + (e.clientY - dragStartRef.current.y),
      });
    };
    const handleMouseUp = () => setIsDragging(false);
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  if (applet.position === 'sidebar') {
    return (
      <Box sx={{
        borderBottom: '2px solid #5d00ff',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        flex: expanded ? 1 : '0 0 auto',
        minHeight: expanded ? 0 : 'auto',
      }}>
        <Box
          onClick={() => setExpanded(!expanded)}
          sx={{
            display: 'flex', alignItems: 'center', px: 1, py: 0,
            minHeight: 40, bgcolor: '#00000014', color: 'text.primary',
            borderBottom: 1, borderColor: 'divider',
            cursor: 'pointer', userSelect: 'none', flexShrink: 0,
            '&:hover': { bgcolor: '#00000028' },
          }}
        >
          {expanded ? <KeyboardArrowDownIcon /> : <KeyboardArrowRightIcon />}
          <Typography variant="subtitle2" sx={{ flexGrow: 1, fontWeight: 'bold' }}>{applet.name}</Typography>
          <IconButton size="small" color="inherit"
            onClick={(e) => { e.stopPropagation(); onSwitchPosition('widget'); }} sx={{ p: 0.5 }}>
            <OpenInNewIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" color="inherit"
            onClick={(e) => { e.stopPropagation(); onClose(); }} sx={{ ml: 0.5, p: 0.5 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box sx={{
          display: expanded ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
        }}>
          {!(applet.node instanceof Node) ? (
            React.isValidElement(applet.node) ? applet.node
              : React.createElement(applet.node as React.ComponentType, {})
          ) : (
            <div ref={containerRef} style={{ width: '100%', minHeight: '150px' }} />
          )}
        </Box>
      </Box>
    );
  }

  if (applet.position === 'dialog') {
    const isReactNode = !(applet.node instanceof Node);
    return (
      <Box sx={{ flexGrow: 1, overflow: 'auto', p: 1, position: 'relative', minHeight: 150 }}>
        {isReactNode
          ? (React.isValidElement(applet.node) ? applet.node
            : React.createElement(applet.node as React.ComponentType, {}))
          : <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        }
      </Box>
    );
  }

  const isReactComponent = !(applet.node instanceof Node);

  return (
    <Box
      ref={wrapperRef}
      onMouseDown={onFocus}
      sx={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: applet.zIndex || 9999,
        width: size.width,
        height: size.height,
        minWidth: 250,
        minHeight: 150,
        maxWidth: '100vw',
        maxHeight: '100vh',
        resize: isDragging ? 'none' : 'both',
        overflow: 'hidden',
        boxShadow: 3,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        userSelect: isDragging ? 'none' : 'auto',
      }}>
      <Box
        onMouseDown={handleMouseDown}
        sx={{
          display: 'flex', alignItems: 'center', px: 1, py: 0.5, bgcolor: '#f0f4f8', color: 'text.secondary',
          borderBottom: 1, borderColor: 'divider', cursor: 'move', flexShrink: 0,
        }}
      >
        <Typography variant="subtitle2" sx={{ flexGrow: 1, fontWeight: 'bold' }}>{applet.name}</Typography>
        <IconButton size="small" color="inherit" title="Move to sidebar" onClick={() => onSwitchPosition('sidebar')}>
          <ViewSidebarIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" color="inherit" title="Move to dialog" onClick={() => onSwitchPosition('dialog')}>
          <OpenInNewIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" color="inherit" onClick={onClose} sx={{ ml: 0.5 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ flexGrow: 1, overflow: 'auto', p: 1, position: 'relative' }}>
        {isReactComponent ? (React.isValidElement(applet.node) ? applet.node
          : React.createElement(applet.node as React.ComponentType, {}))
          : <div ref={containerRef} style={{ width: '100%', height: '100%' }} />}
      </Box>
    </Box>
  );
}
