import React, { useEffect, useRef, useState } from 'react';
import { Play, Square, RefreshCw } from 'lucide-react';
import '@strudel/repl';

// GLOBAL VISUAL FEEDBACK RESTORATION
// This mimics the manual testVisualFeedbackPreservation() logic automatically.
// It batches rapid mount/reconnect events and then:
// 1. Aggregates each unit's sampleBank and registers samples in its own REPL context
// 2. Falls back to window.samples(allSamples) if available (legacy/global path)
// 3. Re-evaluates each unit's currentCode to restore Mini Notation highlighting
// Safeguards: debounced scheduling + minimum interval between full restores.
if (typeof window !== 'undefined' && !window._scheduleGlobalLiveCodingVisualRestore) {
  window._scheduleGlobalLiveCodingVisualRestore = () => {
    try {
      // Debounce
      if (window._globalVisualRestoreTimer) clearTimeout(window._globalVisualRestoreTimer);
      window._globalVisualRestoreTimer = setTimeout(() => {
        const now = Date.now();
        if (window._lastGlobalVisualRestore && (now - window._lastGlobalVisualRestore) < 400) {
          // Too soon; skip (another call already handled it)
          return;
        }
        window._lastGlobalVisualRestore = now;

        const unitsMap = window._liveCodingUnits;
        if (!unitsMap || unitsMap.size === 0) return;

        console.log('🎨 Auto visual feedback restore: scanning units...');

        // Global aggregate (optional) – some contexts may still look at window.samples
        const globalSamples = {};

        unitsMap.forEach((unit) => {
          if (unit?.sampleBank?.size > 0) {
            unit.sampleBank.forEach(sampleData => {
              if (sampleData?.name && sampleData?.blobUrl) {
                globalSamples[sampleData.name] = sampleData.blobUrl;
              }
            });
          }
        });

        // Optional global registration (non-fatal if absent)
        try {
          if (Object.keys(globalSamples).length && typeof window.samples === 'function') {
            window.samples(globalSamples);
            console.log('📦 Global samples registered for fallback path');
          }
        } catch (e) {
          console.log('⚠️ Global samples registration failed (continuing per-unit):', e.message);
        }

  let restoredCount = 0;
  const selectedUnitId = window.debugGetSelectedUnitId?.();
  unitsMap.forEach((unit) => {
          try {
            const element = unit?.strudelElement;
            const editor = element?.editor;
            const repl = editor?.repl;
            const code = unit?.currentCode;
            if (!repl || !code || !code.trim() || code.startsWith('// Live coding unit')) return;
            // NEW: Don't auto-evaluate (which starts playback) for units that are stopped and not selected
            const shouldEvaluate = (unit.isPlaying === true) || (unit.id === selectedUnitId);
            if (!shouldEvaluate) return;

            // Ensure this unit's samples are registered in its own isolated context
            if (unit.sampleBank?.size && unit.replInstance?.context?.samples) {
              const perUnitMap = {};
              unit.sampleBank.forEach(sampleData => {
                if (sampleData?.name && sampleData?.blobUrl) perUnitMap[sampleData.name] = sampleData.blobUrl;
              });
              if (Object.keys(perUnitMap).length) {
                try {
                  unit.replInstance.context.samples(perUnitMap);
                } catch (err) {
                  console.log(`⚠️ Unit ${unit.id} per-unit sample registration failed:`, err.message);
                }
              }
            }

            // Re-evaluate to restore highlighting (and audio if running)
            const attemptEval = (tag='primary') => {
              try {
                // Prefer unit.replInstance.evaluate if available (sometimes wraps extra logic)
                if (unit.replInstance && typeof unit.replInstance.evaluate === 'function') {
                  unit.replInstance.evaluate(code);
                } else if (repl && typeof repl.evaluate === 'function') {
                  repl.evaluate(code);
                } else if (editor && typeof editor.evaluate === 'function') {
                  editor.evaluate(code);
                }
                console.log(`✅ Visual feedback restore (${tag}) for unit ${unit.id}`);
                return true;
              } catch (errEval) {
                console.log(`❌ Visual restore (${tag}) failed for unit ${unit.id}:`, errEval.message);
                return false;
              }
            };

            const wasPlaying = !!unit.isPlaying;
            const successPrimary = attemptEval('primary');
            if (successPrimary) {
              restoredCount++;
              // If unit was NOT playing (selected but stopped), stop immediately after evaluation to keep highlight attempt without sound
              if (!wasPlaying && unit.replInstance) {
                try { unit.replInstance.stop?.(); unit.replInstance.hush?.(); } catch {}
              }
            }

            // Schedule a second pass to catch late sample registrations / rendering inactivity
            if (shouldEvaluate && !unit._scheduledSecondaryVisualRestore) {
              unit._scheduledSecondaryVisualRestore = true;
              setTimeout(() => {
                const secondWasPlaying = !!unit.isPlaying;
                attemptEval('second-pass');
                if (!secondWasPlaying && unit.replInstance) {
                  try { unit.replInstance.stop?.(); unit.replInstance.hush?.(); } catch {}
                }
                unit._scheduledSecondaryVisualRestore = false;
              }, 320);
            }
          } catch (inner) {
            console.log('⚠️ Visual restore inner error:', inner.message);
          }
        });

        console.log(`🎨 Auto visual restore complete (${restoredCount} unit(s) refreshed)`);
      }, 180); // debounce delay
    } catch (err) {
      console.log('❌ Scheduling global visual restore failed:', err.message);
    }
  };
}

// Immediate synchronous-style restore that mimics the original manual testVisualFeedbackPreservation()
// Use this when we need restoration BEFORE monitoring scripts time out.
if (typeof window !== 'undefined' && !window.forceImmediateVisualFeedbackRestore) {
  window.forceImmediateVisualFeedbackRestore = (options = {}) => {
    try {
      const unitsMap = window._liveCodingUnits;
      if (!unitsMap || unitsMap.size === 0) return;
      const { onlyUnitId = null, includeSamples = true } = options;

      // 1. Aggregate samples (global) like the test function
      if (includeSamples && typeof window.samples === 'function') {
        const allSamples = {};
        unitsMap.forEach(unit => {
          if (onlyUnitId && unit.id !== onlyUnitId) return; // filter if requested
            unit?.sampleBank?.forEach(sampleData => {
              if (sampleData?.name && sampleData?.blobUrl) {
                allSamples[sampleData.name] = sampleData.blobUrl;
              }
            });
        });
        if (Object.keys(allSamples).length) {
          try { window.samples(allSamples); } catch { /* ignore */ }
        }
      }

      // 2. Evaluate code for each unit (or targeted unit) respecting stopped state
      const selectedUnitId = window.debugGetSelectedUnitId?.();
      unitsMap.forEach(unit => {
        if (onlyUnitId && unit.id !== onlyUnitId) return;
        const element = unit?.strudelElement;
        const repl = element?.editor?.repl;
        const code = unit?.currentCode;
        if (!repl || !code || !code.trim() || code.startsWith('// Live coding unit')) return;
        const shouldEvaluate = (unit.isPlaying === true) || (unit.id === selectedUnitId);
        if (!shouldEvaluate) return;
        try {
          repl.evaluate(code);
          // Dispatch a custom event for monitoring tools
          window.dispatchEvent(new CustomEvent('visual-feedback-restored', { detail: { unitId: unit.id, mode: 'immediate' } }));
          if (!unit.isPlaying) { // restore highlighting but keep silent
            try { repl.stop?.(); repl.hush?.(); } catch {}
          }
        } catch (err) {
          // Second attempt after a short frame if first fails
          requestAnimationFrame(() => {
            try {
              repl.evaluate(code);
              window.dispatchEvent(new CustomEvent('visual-feedback-restored', { detail: { unitId: unit.id, mode: 'immediate-rAF' } }));
              if (!unit.isPlaying) { try { repl.stop?.(); repl.hush?.(); } catch {} }
            } catch {}
          });
        }
      });
    } catch (e) {
      console.log('forceImmediateVisualFeedbackRestore error:', e.message);
    }
  };
}

/**
 * Simple UnitStrudelRepl with stable DOM positioning for visual feedback
 * Keeps elements in fixed positions instead of moving them around
 */
const SimpleUnitStrudelRepl = ({ unitId }) => {
  const containerRef = useRef(null);
  const strudelElementRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSolo, setIsSolo] = useState(false);

  // Helper to get unit
  const getUnit = () => window.getUnitInstance?.(unitId);

  const handlePlay = () => {
    const unit = getUnit();
    if (unit && unit.type === 'LIVE_CODING') {
      if (!unit.replInstance) {
        console.warn(`SimpleUnitStrudelRepl ${unitId}: Cannot play yet, replInstance missing`);
        return;
      }
      // CRITICAL: Persist any manual edits before playing
      try { unit.persistCurrentCode(); } catch (e) { console.warn('Persist current code failed', e); }
      
      try { unit.play(); setIsPlaying(true); } catch (e) { console.warn('Play failed', e); }
      return;
    }
    // Fallback direct
    const repl = strudelElementRef.current?.editor?.repl;
    if (repl) {
      try { repl.stop?.(); repl.evaluate(strudelElementRef.current.editor.code); repl.start?.(); setIsPlaying(true); } catch (e) { console.warn('Direct play failed', e); }
    }
  };

  const handleStop = () => {
    const unit = getUnit();
    if (unit && unit.type === 'LIVE_CODING') {
      try { unit.stop(); setIsPlaying(false); } catch (e) { console.warn('Stop failed', e); }
      return;
    }
    const repl = strudelElementRef.current?.editor?.repl;
    if (repl) {
      try { repl.stop?.(); repl.hush?.(); setIsPlaying(false); } catch (e) { console.warn('Direct stop failed', e); }
    }
  };

  const handleUpdate = () => {
    const unit = getUnit();
    if (unit && unit.type === 'LIVE_CODING') {
      // CRITICAL: Persist any manual edits before evaluation
      try { unit.persistCurrentCode(); } catch (e) { console.warn('Persist current code failed', e); }
      
      const wasPlaying = !!unit.isPlaying;
      try { unit.evaluate(); } catch (e) { console.warn('Update evaluate failed', e); }
      if (!wasPlaying) {
        try { unit.stop(); unit.replInstance?.hush?.(); } catch {}
      }
      return;
    }
    const repl = strudelElementRef.current?.editor?.repl;
    if (repl) {
      const code = strudelElementRef.current.editor?.code;
      try { repl.stop?.(); repl.evaluate(code); if (!isPlaying) { repl.stop?.(); repl.hush?.(); } } catch (e) { console.warn('Direct update failed', e); }
    }
  };

  const toggleSolo = () => {
    const unit = getUnit();
    if (unit && unit.type === 'LIVE_CODING') {
      const newSolo = !unit.solo;
      // If enabling solo, hush all other live coding units but remember their previous playing state
      if (newSolo) {
        const prevStates = [];
        if (window._liveCodingUnits) {
          window._liveCodingUnits.forEach((other, otherId) => {
            if (otherId !== unit.id) {
              prevStates.push({ id: otherId, wasPlaying: !!other.isPlaying });
              // Stop others to effectively solo this unit
              if (other.isPlaying) {
                try { other.stop(); } catch {}
              }
              other.solo = false;
              if (other.strudelElement) {
                try { other.strudelElement.solo = false; } catch {}
              }
            }
          });
        }
        unit._previousPlayingStates = prevStates;
        window._currentLiveCodingSoloUnitId = unit.id;
      } else {
        // Restoring previous states when disabling solo
        if (unit._previousPlayingStates && window._liveCodingUnits) {
          unit._previousPlayingStates.forEach(({ id, wasPlaying }) => {
            const other = window._liveCodingUnits.get(id);
            if (other) {
              other.solo = false;
              if (other.strudelElement) {
                try { other.strudelElement.solo = false; } catch {}
              }
              if (wasPlaying && !other.isPlaying) {
                try { other.play(); } catch {}
              }
            }
          });
        }
        unit._previousPlayingStates = null;
        window._currentLiveCodingSoloUnitId = null;
      }
      unit.solo = newSolo;
      try { if (unit.strudelElement) unit.strudelElement.solo = newSolo; } catch {}
      setIsSolo(newSolo);
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    console.log(`SimpleUnitStrudelRepl ${unitId}: Setting up stable editor`);
    
    // Check for existing persistent element
    const persistentKey = `simple-strudel-${unitId}`;
    let strudelElement = window[persistentKey];
    
    if (strudelElement) {
      console.log(`SimpleUnitStrudelRepl ${unitId}: Using existing stable element`);
      
  // Don't move the element! Just show it and ensure it's connected
  strudelElement.style.display = 'block';
  // Constrain width so long lines cause horizontal scroll instead of panel growth
  strudelElement.style.width = 'max-content';
  strudelElement.style.maxWidth = '100%';
  strudelElement.style.boxSizing = 'border-box';
      
      // Make sure it's in our container (but only if it's not already there)
      if (strudelElement.parentNode !== containerRef.current) {
        containerRef.current.appendChild(strudelElement);
      }
      
      strudelElementRef.current = strudelElement;
      
      // CRITICAL: Reconnect to LiveCoding unit
      const unit = window.getUnitInstance?.(unitId);
      if (unit && unit.type === 'LIVE_CODING' && strudelElement.editor?.repl) {
        console.log(`SimpleUnitStrudelRepl ${unitId}: Reconnecting stable element to unit`);
        unit.setReplInstance(strudelElement.editor, strudelElement);
        
        // Restore unit's current code
        if (unit.currentCode && unit.currentCode !== strudelElement.getAttribute('code')) {
          console.log(`SimpleUnitStrudelRepl ${unitId}: Restoring unit code`);
          strudelElement.editor.setCode(unit.currentCode);
          strudelElement.setAttribute('code', unit.currentCode);
        }
        
        // AUTO-RESTORE VISUAL FEEDBACK: schedule global restoration (handles samples + evaluation)
        if (unit.currentCode && unit.currentCode.trim() && unit.currentCode !== `// Live coding unit ${unitId}`) {
          // Immediate first to satisfy fast monitors, then global batched
          window.forceImmediateVisualFeedbackRestore?.({ onlyUnitId: unitId });
          window._scheduleGlobalLiveCodingVisualRestore?.();
        }
      }
      
    } else {
      console.log(`SimpleUnitStrudelRepl ${unitId}: Creating new stable element`);
      
      // Clear container first
      containerRef.current.innerHTML = '';
      
      // Create new strudel-editor
      strudelElement = document.createElement('strudel-editor');
      strudelElement.setAttribute('code', `// Live coding unit ${unitId}`);
      strudelElement.sync = true;
      strudelElement.solo = false;
      strudelElement.setAttribute('data-unit-id', unitId);
      
  // Style for stable positioning (constrain width; allow horizontal scrolling in parent)
  strudelElement.style.width = 'max-content';
  strudelElement.style.maxWidth = '100%';
  strudelElement.style.boxSizing = 'border-box';
  strudelElement.style.height = '100%';
  strudelElement.style.display = 'block';
      
      containerRef.current.appendChild(strudelElement);
      strudelElementRef.current = strudelElement;
      
      // Store globally for persistence
      window[persistentKey] = strudelElement;

      // Wait for initialization and connect to unit
      const checkReady = () => {
        if (strudelElement.editor?.repl) {
          console.log(`SimpleUnitStrudelRepl ${unitId}: Stable editor ready, connecting to unit`);
          
          // Connect to LiveCoding unit
          const unit = window.getUnitInstance?.(unitId);
          if (unit && unit.type === 'LIVE_CODING') {
            unit.setReplInstance(strudelElement.editor, strudelElement);
            
            // Set unit's current code if it exists
            if (unit.currentCode) {
              strudelElement.editor.setCode(unit.currentCode);
              strudelElement.setAttribute('code', unit.currentCode);
              
              // AUTO-RESTORE VISUAL FEEDBACK for new elements too (global batched approach)
              if (unit.currentCode.trim() && unit.currentCode !== `// Live coding unit ${unitId}`) {
                // Immediate + scheduled
                window.forceImmediateVisualFeedbackRestore?.({ onlyUnitId: unitId });
                window._scheduleGlobalLiveCodingVisualRestore?.();
              }
            }
          }
          return;
        }
        setTimeout(checkReady, 100);
      };
      checkReady();
    }

    // Poll playback state (lightweight)
  const poll = setInterval(() => {
      const unit = getUnit();
      if (unit && unit.type === 'LIVE_CODING') {
        if (isPlaying !== !!unit.isPlaying) setIsPlaying(!!unit.isPlaying);
    if (isSolo !== !!unit.solo) setIsSolo(!!unit.solo);
      }
    }, 600);

    // Cleanup - hide instead of removing
    return () => {
      clearInterval(poll);
      if (strudelElementRef.current) {
        // Hide the element but keep it in the DOM for visual feedback continuity
        strudelElementRef.current.style.display = 'none';
        console.log(`SimpleUnitStrudelRepl ${unitId}: Hidden editor (keeping for visual feedback)`);
      }
    };
  }, [unitId]);

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden" data-role="simple-unit-repl" data-unit-id={unitId}>
      <div className="flex items-center gap-2 p-2 bg-gray-800 border-b border-gray-700">
        <button onClick={toggleSolo} title="Solo" className={`px-1.5 py-1 text-[10px] font-semibold rounded ${isSolo ? 'bg-yellow-500 text-gray-900' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'} transition-colors`}>S</button>
        <button onClick={handlePlay} disabled={isPlaying} title="Play" className={`p-1.5 rounded ${isPlaying ? 'bg-gray-700 text-gray-500' : 'bg-green-600 hover:bg-green-700 text-white'} transition-colors`}>
          <Play size={14} />
        </button>
        <button onClick={handleStop} disabled={!isPlaying} title="Stop" className={`p-1.5 rounded ${!isPlaying ? 'bg-gray-700 text-gray-500' : 'bg-red-600 hover:bg-red-700 text-white'} transition-colors`}>
          <Square size={14} />
        </button>
        <button onClick={handleUpdate} title="Update (⌘⏎)" className="p-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors">
          <RefreshCw size={14} />
        </button>
        <span className="text-xs text-gray-400 px-2 truncate">
          {isPlaying ? 'Playing' : 'Stopped'} • {unitId}
        </span>
      </div>
  <div ref={containerRef} className="flex-1 min-h-[240px] overflow-x-auto overflow-y-hidden relative" />
    </div>
  );
};

export default SimpleUnitStrudelRepl;
