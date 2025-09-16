import React, { useEffect, useRef, useState } from 'react';
import { Play, Square, RefreshCw } from 'lucide-react';
import '@strudel/repl';

/**
 * UnitStrudelRepl - Dead simple REPL for each unit
 * No complex state management, no bridging - just works like StrudelReplTest.jsx
 */
const UnitStrudelRepl = ({ unitId }) => {
  // Completely independent state - no sharing, no complex sync
  const replRef = useRef(null);
  const containerRef = useRef(null);
  const attachTokenRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentCode, setCurrentCode] = useState(`// Unit ${unitId}\nsound("bd hh sd oh")`);
  const initializedRef = useRef(false);

  console.log(`UnitStrudelRepl: Component rendered for unit ${unitId}`);

  // Initialize and mount the existing hidden REPL directly into our container
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;
    const localAttachToken = ++attachTokenRef.current;


  const ensureEditorReady = (editorEl) => {
      // Wait until the custom element exposes .editor before syncing
      const maxWait = Date.now() + 5000;
      const waitReady = () => {
        if (attachTokenRef.current !== localAttachToken) return;
    if (editorEl.editor && editorEl.editor.repl && editorEl.editor.repl.context) {
          try {
            const unit = window.getUnitInstance?.(unitId);
            const unitCode = unit?.currentCode;
            const liveCode = unitCode || editorEl.editor?.code || editorEl.getAttribute('code') || currentCode;
            if (unitCode && editorEl.editor) {
              editorEl.editor.setCode(unitCode);
              try { editorEl.setAttribute('code', unitCode); } catch {}
            }
            setCurrentCode(liveCode);
            if (unit && unit.type === 'LIVE_CODING') {
              unit.setReplInstance(editorEl.editor, editorEl);
        // Reflect current playing state
        setIsPlaying(!!unit.isPlaying);
            }
          } catch {}
          return; // ready
        }
        if (Date.now() < maxWait) {
          setTimeout(waitReady, 100);
        }
      };
      waitReady();
    };

    const finalizeAttach = (editorEl) => {
      if (!editorEl || attachTokenRef.current !== localAttachToken) return;
      replRef.current = editorEl;
  // Mount the editor directly into the container (no overlay)
      const container = containerRef.current;
      if (container) {
        // Remove any previous children; we only want our editor
        while (container.firstChild) {
          if (container.firstChild === editorEl) break;
          container.removeChild(container.firstChild);
        }
        if (editorEl.parentNode !== container) {
          container.appendChild(editorEl);
        }
      }

  // Ensure it’s visible
  // Control visibility via overlay; make sure editor can measure
  editorEl.style.position = '';
  editorEl.style.left = '';
  editorEl.style.top = '';
  editorEl.style.width = '100%';
  editorEl.style.height = '100%';
  editorEl.style.visibility = 'visible';
  editorEl.style.minWidth = '0'; // Prevent editor from forcing container expansion
  editorEl.style.maxWidth = '100%'; // Constrain editor to container width

  // Ensure editor element is visible (avoid display:none while visible)
  editorEl.style.display = 'block';
  // Force refresh for CodeMirror-like editors when transitioning from hidden/offscreen
  try {
    if (editorEl.editor && typeof editorEl.editor.refresh === 'function') {
      editorEl.editor.refresh();
    }
  } catch {}
  // Prevent clicks inside editor from deselecting the unit
  try {
    const stopBubble = (e) => { try { e.stopPropagation(); } catch {} };
    // Only pointer/mouse events; let keyboard/focus flow to the editor
    ['mousedown','mouseup','click','dblclick','pointerdown','pointerup'].forEach(evt => {
      editorEl.addEventListener(evt, stopBubble, { capture: false });
    });
  } catch {}

  // Ensure editor is ready and synced
      ensureEditorReady(editorEl);
  // Nudge layout for editors that size on resize events
  try { setTimeout(() => window.dispatchEvent(new Event('resize')), 0); } catch {}

  // Sync will be handled in ensureEditorReady when REPL context is available

  // No observers required
    };

    // Poll for the editor created by the initializer, then attach via overlay
    const waitUntil = Date.now() + 8000; // up to 8s
    const poll = setInterval(() => {
      const found = document.querySelector(`strudel-editor[data-unit-id="${unitId}"]`);
      if (found || Date.now() > waitUntil) {
        clearInterval(poll);
        finalizeAttach(found || null);
      }
    }, 100);

      // Overlay is inside the container, CSS keeps it aligned; no rAF or resize needed

  return () => {
      delete window[`updateUnit${unitId}`];
      clearInterval(poll);
      // Clean any leftover nodes in this container for a fresh start next mount
      try {
        const container = containerRef.current;
        if (container) {
          while (container.firstChild) {
            try { container.removeChild(container.firstChild); } catch {}
          }
        }
      } catch {}
      // Park editor element back to the initializer (hidden but measurable)
      const initializerContainer = document.querySelector('[data-testid="live-coding-initializer"]');
      if (replRef.current && initializerContainer) {
        const el = replRef.current;
        Object.assign(el.style, {
          position: 'absolute',
          left: '-20000px',
          top: '0px',
          width: '800px',
          height: '600px',
          visibility: 'hidden',
          display: ''
        });
        try { initializerContainer.appendChild(el); } catch {}
      }
  replRef.current = null;
      initializedRef.current = false;
    };
  }, [unitId]);

  // Simple controls
  const handlePlay = (e) => {
    e?.stopPropagation(); // Prevent unit deselection
    const unit = window.getUnitInstance?.(unitId);
    if (unit && unit.type === 'LIVE_CODING') {
  console.log(`UnitStrudelRepl: Play via LiveCodingUnit ${unitId}`);
  try { unit.play(); } catch {}
  setIsPlaying(true);
  setCurrentCode(unit.currentCode);
  return;
    }
    if (replRef.current?.editor?.repl) {
      console.log(`UnitStrudelRepl: Playing unit ${unitId} (fallback)`);
      try { replRef.current.editor.repl.stop(); } catch {}
      const code = replRef.current.editor.code;
      replRef.current.editor.repl.evaluate(code);
      setIsPlaying(true);
      setCurrentCode(code);
    }
  };

  const handleStop = (e) => {
    e?.stopPropagation(); // Prevent unit deselection
    const unit = window.getUnitInstance?.(unitId);
    if (unit && unit.type === 'LIVE_CODING') {
      console.log(`UnitStrudelRepl: Stopping via LiveCodingUnit ${unitId}`);
  try { unit.stop(); } catch {}
      setIsPlaying(false);
      return;
    }
    if (replRef.current?.editor?.repl) {
      console.log(`UnitStrudelRepl: Stopping unit ${unitId} (fallback)`);
      try { replRef.current.editor.repl.stop(); } catch {}
      setIsPlaying(false);
    }
  };

  const handleToggle = (e) => {
    e?.stopPropagation(); // Prevent unit deselection
    const unit = window.getUnitInstance?.(unitId);
    if (unit && unit.type === 'LIVE_CODING') {
      unit.toggle();
      setIsPlaying(unit.isPlaying);
      return;
    }
    if (isPlaying) handleStop(e); else handlePlay(e);
  };

  // Simple method to update code from hover (called directly, no complex bridging)
  const updateCode = (newCode) => {
    console.log(`UnitStrudelRepl: Updating code for unit ${unitId}:`, newCode);
    const unit = window.getUnitInstance?.(unitId);
    if (unit && unit.type === 'LIVE_CODING') {
      try { unit.stop(); } catch {}
      try { unit.setCode(newCode); } catch {}
      setCurrentCode(newCode);
      // Auto-play via unit logic (which evaluates-before-start)
      setTimeout(() => { try { unit.play(); setIsPlaying(true); } catch {} }, 50);
      return;
    }
    if (replRef.current?.editor) {
      try { replRef.current.editor.repl?.stop(); } catch {}
      replRef.current.editor.setCode(newCode);
      setCurrentCode(newCode);
      setTimeout(() => { try { replRef.current?.editor?.repl?.evaluate(newCode); setIsPlaying(true); } catch {} }, 100);
    }
  };

  // ALWAYS ensure global method is available (robust registration)
  useEffect(() => {
    // Register unit-specific updater once per mount
    window[`updateUnit${unitId}`] = updateCode;
    return () => {
      delete window[`updateUnit${unitId}`];
    };
  }, [unitId, updateCode]);

  return (
    <div
      className="space-y-2 w-full max-w-2xl"
      // Stop bubbling to parent selectors, but allow events to reach the editor/buttons
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      data-role="unit-repl-container"
    >
      <div className="flex items-center gap-2 p-2 bg-gray-800/50 rounded">
        <button
          onClick={handlePlay}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-sm flex items-center gap-1 text-xs"
        >
          <RefreshCw size={12} />
          Play
        </button>
        
        <button
          onClick={handleToggle}
          className={`px-3 py-1.5 rounded-sm flex items-center gap-1 text-xs ${
            isPlaying ? 'bg-yellow-600' : 'bg-green-600'
          } text-white`}
        >
          {isPlaying ? <Square size={12} /> : <Play size={12} />}
          {isPlaying ? 'Pause' : 'Start'}
        </button>
        
        <button
          onClick={handleStop}
          className="px-3 py-1.5 bg-red-600 text-white rounded-sm flex items-center gap-1 text-xs"
        >
          <Square size={12} />
          Stop
        </button>
        
        <span className="text-xs text-gray-400 ml-2">Unit {unitId}</span>
        <span className="text-xs text-gray-500 ml-2">{isPlaying ? '🔊' : '🔇'}</span>
      </div>

      <div
        ref={containerRef}
        className="border border-gray-600 rounded bg-gray-900 min-h-[300px] relative overflow-auto"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        data-role="unit-repl-host"
      />
    </div>
  );
};

export default UnitStrudelRepl;
