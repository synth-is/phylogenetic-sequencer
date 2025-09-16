import React, { useEffect, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import '@strudel/repl';

/**
 * UnitStrudelRepl (Version 4 - In-Place Local Editor with Persistence)
 * Improved: Maintains REPL instance even when component unmounts to prevent context loss
 * Rationale: Sample registration fails when REPL contexts are destroyed during unit switching.
 */
const UnitStrudelRepl = ({ unitId }) => {
  const containerRef = useRef(null);
  const editorElementRef = useRef(null); // The local in-place strudel-editor element
  const cleanupRef = useRef([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentCode, setCurrentCode] = useState('');
  const [version] = useState('v4-inplace-persistent');
  const persistentInstanceRef = useRef(null); // Store instance across unmounts

  useEffect(() => {
    console.log(`[UnitStrudelRepl ${unitId}] Mount (${version}) creating local editor in-place`);
    if (!containerRef.current) return;

    // Check if we have a persistent instance for this unit
    const globalInstanceKey = `strudelInstance_${unitId}`;
    if (window[globalInstanceKey] && persistentInstanceRef.current !== window[globalInstanceKey]) {
      console.log(`[UnitStrudelRepl ${unitId}] Reusing persistent REPL instance`);
      
      // Reuse existing instance
      const existingElement = window[globalInstanceKey];
      if (existingElement && existingElement.parentNode) {
        existingElement.parentNode.removeChild(existingElement);
      }
      
      containerRef.current.appendChild(existingElement);
      editorElementRef.current = existingElement;
      persistentInstanceRef.current = existingElement;
      
      // Reconnect to unit
      const unit = window.getUnitInstance?.(unitId);
      if (unit && unit.type === 'LIVE_CODING' && existingElement.editor?.repl) {
        console.log(`[UnitStrudelRepl ${unitId}] Reconnecting persistent instance to unit`);
        unit.setReplInstance(existingElement.editor, existingElement);
        setIsPlaying(!!unit.isPlaying);
        setCurrentCode(unit.currentCode || existingElement.editor.code || '');
      }
      
      return; // Don't create new instance
    }

    // Ensure highlighting preference ON before creation
    try {
      const key = 'codemirror-settings';
      const existing = localStorage.getItem(key);
      const next = existing ? { ...JSON.parse(existing), isPatternHighlightingEnabled: true } : { isPatternHighlightingEnabled: true };
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}

    // Clear container (safety) and create element
    containerRef.current.innerHTML = '';
    const el = document.createElement('strudel-editor');
    el.setAttribute('data-unit-id', unitId);
    el.setAttribute('id', `strudel-editor-local-${unitId}`);
    // Initial code from unit (if available)
    const unit = window.getUnitInstance?.(unitId);
    const initialCode = unit?.currentCode || `// Live coding unit ${unitId}\n`;
    el.setAttribute('code', initialCode);
    Object.assign(el.style, {
      position: 'relative',
      width: '100%',
      height: '100%',
      display: 'block'
    });
    containerRef.current.appendChild(el);
    editorElementRef.current = el;
    persistentInstanceRef.current = el;
    
    // Store globally for persistence
    window[globalInstanceKey] = el;
    console.log(`[UnitStrudelRepl ${unitId}] Created and stored persistent REPL instance`);

    let cancelled = false;
    const readyStart = performance.now();
    const readyCheck = () => {
      if (cancelled) return;
      if (el.editor && el.editor.repl) {
        console.log(`[UnitStrudelRepl ${unitId}] Local editor ready in ${(performance.now()-readyStart).toFixed(1)}ms`);
        // Enable highlighting and refresh
        try { el.editor.cm?.refresh(); } catch {}
        try {
          if (typeof el.editor.enableHighlighting === 'function') el.editor.enableHighlighting(true);
          if (typeof el.editor.repl.enableHighlighting === 'function') el.editor.repl.enableHighlighting(true);
          el.editor.repl.evaluate(el.editor.code || 'silence');
        } catch {}
        // Wire into unit
        if (unit && unit.type === 'LIVE_CODING') {
          try { unit.setReplInstance(el.editor, el); } catch (e) { console.warn('setReplInstance failed', e); }
          setIsPlaying(!!unit.isPlaying);
          setCurrentCode(unit.currentCode || el.editor.code || '');
        } else {
          setCurrentCode(el.editor.code || '');
        }
        // Remove any duplicate editors that might have been created earlier
        try {
          const all = Array.from(document.querySelectorAll(`strudel-editor[data-unit-id='${unitId}']`));
          all.forEach(other => {
            if (other !== el) {
              console.log(`[UnitStrudelRepl ${unitId}] Removing duplicate stray editor`, other.id || '(no id)');
              try { other.parentNode?.removeChild(other); } catch {}
            }
          });
        } catch {}
        return;
      }
      setTimeout(readyCheck, 60);
    };
    readyCheck();

    // Poll unit playback state into component (UI sync)
    const syncInterval = setInterval(() => {
      const u = window.getUnitInstance?.(unitId);
      if (!u) return;
      setIsPlaying(!!u.isPlaying);
    }, 400);
    cleanupRef.current.push(() => clearInterval(syncInterval));

    return () => {
      cancelled = true;
      cleanupRef.current.forEach(fn => { try { fn(); } catch {} });
      cleanupRef.current = [];
      // Do NOT remove persistent element - keep it in global store
      console.log(`[UnitStrudelRepl ${unitId}] Component unmounting, but preserving REPL instance`);
    };
  }, [unitId, version]);

  // Playback controls
  const handlePlay = () => {
    console.log(`[UnitStrudelRepl ${unitId}] handlePlay clicked`);
    const unit = window.getUnitInstance?.(unitId);
    if (unit && unit.type === 'LIVE_CODING') {
      if (!unit.replInstance) {
        console.warn(`[UnitStrudelRepl ${unitId}] Unit has no replInstance yet; will retry shortly`);
        setTimeout(() => handlePlay(), 120);
        return;
      }
      try {
        unit.play();
        setIsPlaying(true);
        setCurrentCode(unit.currentCode);
        console.log(`[UnitStrudelRepl ${unitId}] Unit play invoked (isPlaying=${unit.isPlaying})`);
      } catch (e) { console.warn(e); }
      return;
    }
    // Fallback direct editor usage
    const editor = editorElementRef.current?.editor;
    if (editor?.repl) {
      try { editor.repl.stop(); editor.repl.evaluate(editor.code); editor.repl.start?.(); setIsPlaying(true); setCurrentCode(editor.code); } catch (e) { console.warn('Direct play failed', e); }
    } else {
      console.warn(`[UnitStrudelRepl ${unitId}] No editor.repl available for play`);
    }
  };
  const handleStop = () => {
    console.log(`[UnitStrudelRepl ${unitId}] handleStop clicked`);
    const unit = window.getUnitInstance?.(unitId);
    if (unit && unit.type === 'LIVE_CODING') {
      try { unit.stop(); setIsPlaying(false); console.log(`[UnitStrudelRepl ${unitId}] Unit stop invoked`); } catch (e) { console.warn(e); }
      return;
    }
    const editor = editorElementRef.current?.editor;
    if (editor?.repl) { try { editor.repl.stop(); editor.repl.hush?.(); setIsPlaying(false); } catch (e) { console.warn('Direct stop failed', e); } }
  };

  // External code update hook for genome hover, etc.
  const updateCode = (newCode) => {
    console.log(`[UnitStrudelRepl ${unitId}] updateCode invoked`);
    const unit = window.getUnitInstance?.(unitId);
    if (unit && unit.type === 'LIVE_CODING') {
      try { unit.setCode(newCode); unit.play(); setIsPlaying(true); setCurrentCode(newCode); } catch (e) { console.warn(e); }
      return;
    }
    const editor = editorElementRef.current?.editor;
    if (editor?.repl) {
      try { editor.repl.stop(); editor.setCode(newCode); editor.repl.evaluate(newCode); editor.repl.start?.(); setCurrentCode(newCode); setIsPlaying(true); } catch (e) { console.warn('Direct updateCode failed', e); }
    }
  };

  useEffect(() => {
  window[`updateUnit${unitId}`] = updateCode;
  console.log(`[UnitStrudelRepl ${unitId}] Registered global update method: updateUnit${unitId}`);
    return () => { 
      delete window[`updateUnit${unitId}`];
      console.log(`[UnitStrudelRepl ${unitId}] Unregistered global update method: updateUnit${unitId}`);
    };
  }, [unitId]);

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden" data-role="unit-repl-container" data-unit-id={unitId}>
      <div className="flex items-center gap-2 p-2 bg-gray-800 border-b border-gray-700">
        <button onClick={handlePlay} disabled={isPlaying} className={`p-2 rounded ${isPlaying ? 'bg-gray-700 text-gray-500' : 'bg-green-600 hover:bg-green-700 text-white'}`} title="Play"><Play size={16} /></button>
        <button onClick={handleStop} disabled={!isPlaying} className={`p-2 rounded ${!isPlaying ? 'bg-gray-700 text-gray-500' : 'bg-red-600 hover:bg-red-700 text-white'}`} title="Stop"><Square size={16} /></button>
        <div className="flex-1 text-xs text-gray-400 px-2 truncate">{isPlaying ? 'Playing' : 'Stopped'} • Unit {unitId}</div>
      </div>
  <div ref={containerRef} className="flex-1 min-h-[240px]" data-unit-id={unitId} />
    </div>
  );
};

export default UnitStrudelRepl;
