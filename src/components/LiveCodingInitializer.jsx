import React, { useEffect, useRef } from 'react';
import '@strudel/repl';
import { UNIT_TYPES } from '../constants';
import { useUnits } from '../UnitsContext';

/**
 * This component creates hidden REPL instances for all LiveCodingUnits
 * immediately when they're created, similar to how StrudelReplTest.jsx works.
 * This ensures proper isolation and immediate initialization.
 */
const LiveCodingInitializer = ({ units }) => {
  const containerRef = useRef(null);
  const replsRef = useRef(new Map()); // Map of unitId -> repl element
  const { unitsRef } = useUnits();

  useEffect(() => {
    if (!containerRef.current) return;

    // Ensure Strudel editor highlighting is enabled before any editors are created
    try {
      const key = 'codemirror-settings';
      const existing = localStorage.getItem(key);
      const defaults = {
        // Keep Strudel defaults, just force highlighting on
        isPatternHighlightingEnabled: true,
      };
      const next = existing ? { ...JSON.parse(existing), ...defaults } : defaults;
      // Only write if changed to avoid thrashing
      if (!existing || JSON.parse(existing).isPatternHighlightingEnabled !== true) {
        localStorage.setItem(key, JSON.stringify(next));
      }
    } catch {}

    // Find all LiveCodingUnits
    const liveCodingUnits = units.filter(unit => unit.type === UNIT_TYPES.LIVE_CODING);
    
    // Create REPL instances for new LiveCodingUnits
    liveCodingUnits.forEach(unit => {
      if (!replsRef.current.has(unit.id)) {
        // Skip if a local in-place editor already exists (version 4 strategy)
        const localEl = document.getElementById(`strudel-editor-local-${unit.id}`);
        if (localEl) {
          console.log(`LiveCodingInitializer: Skipping unit ${unit.id} (local editor present)`);
          return;
        }
        console.log(`LiveCodingInitializer: Creating REPL for unit ${unit.id}`);
        
        // Create editor exactly like StrudelReplTest.jsx
        // Guard against duplicates: reuse existing if present
        let editor = document.querySelector(`strudel-editor[data-unit-id="${unit.id}"]`);
        if (!editor) {
          editor = document.createElement('strudel-editor');
        }
        editor.setAttribute('code', unit.strudelCode || '// Waiting for evolutionary sounds...');
        editor.sync = unit.sync !== undefined ? unit.sync : true;
        editor.solo = unit.solo !== undefined ? unit.solo : false;
        
        // CRITICAL FIX: Keep editors visible but hidden with opacity/pointer-events
        // This allows CodeMirror to initialize properly with all features including highlighting
        Object.assign(editor.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          width: '800px',
          height: '600px',
          opacity: '0',
          pointerEvents: 'none',
          zIndex: '-1'
        });
        editor.setAttribute('data-unit-id', unit.id);
        editor.setAttribute('id', `strudel-editor-${unit.id}`);
        
        if (editor.parentNode !== containerRef.current) {
          containerRef.current.appendChild(editor);
        }
        replsRef.current.set(unit.id, editor);
        
        // Wait for REPL to be ready and connect to unit instance
        const checkReady = () => {
          if (editor.editor && editor.editor.repl) {
            console.log(`LiveCodingInitializer: REPL ready for unit ${unit.id}`);
            
            // CRITICAL: Force CodeMirror to refresh and enable highlighting
            // This ensures highlighting is initialized even for hidden editors
            if (editor.editor.cm) {
              try {
                // Force refresh to recalculate dimensions
                editor.editor.cm.refresh();
                
                // Ensure highlighting is enabled
                if (typeof editor.editor.enableHighlighting === 'function') {
                  editor.editor.enableHighlighting(true);
                }
                
                // Trigger a dummy evaluation to initialize highlighting state
                // Using silence pattern to avoid sound
                editor.editor.repl.evaluate('silence');
                
                console.log(`LiveCodingInitializer: Forced refresh and highlighting for unit ${unit.id}`);
              } catch (err) {
                console.warn(`Failed to force refresh CodeMirror for unit ${unit.id}:`, err);
              }
            }
            
            // Connect to unit instance
            const unitInstance = unitsRef.current?.get(unit.id);
            if (unitInstance && unitInstance.setReplInstance) {
              // Pass both the editor instance and the strudel-editor element (for sync/solo updates)
              unitInstance.setReplInstance(editor.editor, editor);
              console.log(`LiveCodingInitializer: Connected REPL to unit ${unit.id}`);

              // Nudge UI to re-render so panels reflect readiness immediately
              try {
                const updateEvent = new CustomEvent('updateUnitConfig', {
                  detail: { unitId: unit.id, config: { __replReadyPing: Date.now() }, source: 'LiveCodingInitializer' }
                });
                document.dispatchEvent(updateEvent);
              } catch {}
            }
          } else {
            setTimeout(checkReady, 100);
          }
        };
        
        setTimeout(checkReady, 100);
      }
    });

    // Clean up REPL instances for removed LiveCodingUnits
    const currentUnitIds = new Set(liveCodingUnits.map(u => u.id));
    for (const [unitId, replElement] of replsRef.current.entries()) {
      if (!currentUnitIds.has(unitId)) {
        console.log(`LiveCodingInitializer: Cleaning up REPL for removed unit ${unitId}`);
        
        // Stop the REPL
        if (replElement.editor?.repl) {
          try {
            replElement.editor.repl.stop();
          } catch (err) {
            console.warn(`Error stopping REPL for unit ${unitId}:`, err);
          }
        }
        
        // Remove from DOM
        if (replElement.parentNode) {
          replElement.parentNode.removeChild(replElement);
        }
        
        replsRef.current.delete(unitId);
      }
    }
  }, [units, unitsRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('LiveCodingInitializer: Cleaning up all hidden REPLs');
      for (const [unitId, replElement] of replsRef.current.entries()) {
        if (replElement.editor?.repl) {
          try {
            replElement.editor.repl.stop();
          } catch (err) {
            console.warn(`Error stopping REPL for unit ${unitId} during cleanup:`, err);
          }
        }
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      replsRef.current.clear();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: '800px',
        height: '600px',
        overflow: 'hidden',
        pointerEvents: 'none',
  // Raised z-index so child editors we temporarily "project" with higher z-index values
  // can appear above application panels. Individual editors keep pointerEvents managed
  // by the overlay logic in UnitStrudelRepl while the container remains non-interactive.
  zIndex: 2000
      }}
      data-testid="live-coding-initializer"
    />
  );
};

export default LiveCodingInitializer;
