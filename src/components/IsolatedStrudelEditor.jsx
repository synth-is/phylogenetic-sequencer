import React, { useEffect, useRef, useState } from 'react';
import { Play, Square, RefreshCw } from 'lucide-react';
import '@strudel/repl';

/**
 * IsolatedStrudelEditor - A truly isolated Strudel REPL editor
 * Based on the exact patterns from StrudelReplTest.jsx that we know work
 */
const IsolatedStrudelEditor = ({ 
  unitId, 
  initialCode, 
  onCodeChange, 
  onEditorReady,
  unitInstance = null,
  sync = true,
  solo = false
}) => {
  // Each editor gets its own unique refs and state - NO SHARING
  const replRef = useRef(null);
  const containerRef = useRef(null);
  const [currentPattern, setCurrentPattern] = useState(initialCode || 'sound("bd hh sd oh")');
  const [isPlaying, setIsPlaying] = useState(false);

  console.log(`IsolatedStrudelEditor: Creating for unit ${unitId}`);

  // Initialize REPL exactly like StrudelReplTest.jsx - once, no dependencies
  useEffect(() => {
    console.log(`IsolatedStrudelEditor: Initializing REPL for unit ${unitId}`);
    
    if (containerRef.current && !replRef.current) {
      console.log(`IsolatedStrudelEditor: Creating strudel-editor element for unit ${unitId}`);
      
      // Create exactly like StrudelReplTest
      const repl = document.createElement('strudel-editor');
      repl.setAttribute('code', currentPattern);
      repl.sync = sync;
      repl.solo = solo;
      
      // Add unique identifiers for debugging
      repl.id = `isolated-strudel-${unitId}`;
      repl.setAttribute('data-unit-id', unitId);
      
      containerRef.current.appendChild(repl);
      replRef.current = repl;
      
      console.log(`IsolatedStrudelEditor: REPL element created for unit ${unitId}`, {
        replId: repl.id,
        hasContainer: !!containerRef.current,
        hasRepl: !!replRef.current
      });

      // Wait for editor to be ready - like StrudelReplTest
      const checkReady = () => {
        if (repl.editor && repl.editor.repl) {
          console.log(`IsolatedStrudelEditor: REPL ready for unit ${unitId}`, {
            hasEditor: !!repl.editor,
            hasRepl: !!repl.editor.repl,
            hasContext: !!repl.editor.repl.context
          });
          
          if (onEditorReady) {
            onEditorReady(repl.editor);
          }
        } else {
          setTimeout(checkReady, 100);
        }
      };
      
      setTimeout(checkReady, 100);
    }

    // Cleanup exactly like StrudelReplTest.jsx
    return () => {
      console.log(`IsolatedStrudelEditor: Cleaning up unit ${unitId}`);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      replRef.current = null;
    };
  }, []); // NO DEPENDENCIES - initialize once like StrudelReplTest

  // Poll for unit code changes (since external changes might not trigger re-renders)
  useEffect(() => {
    if (!unitInstance) return;
    
    const pollInterval = setInterval(() => {
      const latestCode = unitInstance.currentCode;
      if (latestCode && latestCode !== currentPattern) {
        console.log(`IsolatedStrudelEditor: Detected code change via polling for unit ${unitId}`);
        setCurrentPattern(latestCode);
        
        if (replRef.current?.editor) {
          replRef.current.editor.setCode(latestCode);
        }
      }
    }, 500); // Poll every 500ms
    
    return () => clearInterval(pollInterval);
  }, [unitInstance, currentPattern, unitId]);

  // Update pattern when initialCode changes OR when unit instance code changes
  useEffect(() => {
    // Get the current code from the unit instance if available
    const currentUnitCode = unitInstance?.currentCode || initialCode;
    
    if (currentUnitCode && currentUnitCode !== currentPattern) {
      console.log(`IsolatedStrudelEditor: Updating pattern for unit ${unitId}:`, currentUnitCode);
      setCurrentPattern(currentUnitCode);
      
      if (replRef.current?.editor) {
        replRef.current.editor.setCode(currentUnitCode);
        
        // Auto-evaluate only for real patterns (not placeholders)
        const isRealPattern = currentUnitCode && 
          !currentUnitCode.includes('Waiting for evolutionary sounds') &&
          !currentUnitCode.includes('Double-click sounds in the tree') &&
          currentUnitCode.trim().length > 0 &&
          currentUnitCode.includes('s('); // Contains sample pattern
        
        if (isRealPattern) {
          console.log(`IsolatedStrudelEditor: Auto-evaluating pattern for unit ${unitId}`);
          handleUpdate();
        }
      }
    }
  }, [initialCode, unitId, unitInstance?.currentCode]); // Listen to unit instance code changes

  // Control functions exactly like StrudelReplTest.jsx
  const handleToggle = () => {
    if (replRef.current?.editor?.repl) {
      console.log(`IsolatedStrudelEditor: Toggling playback for unit ${unitId}`);
      replRef.current.editor.toggle();
      setIsPlaying(prev => !prev);
    }
  };

  const handleStop = () => {
    if (replRef.current?.editor?.repl) {
      console.log(`IsolatedStrudelEditor: Stopping playback for unit ${unitId}`);
      replRef.current.editor.repl.stop();
      setIsPlaying(false);
    }
  };

  const handleUpdate = async () => {
    if (replRef.current?.editor?.repl) {
      // Get code exactly like StrudelReplTest.jsx
      const currentCode = replRef.current.editor.code;
      console.log(`IsolatedStrudelEditor: Updating code for unit ${unitId}:`, currentCode);
      
      setCurrentPattern(currentCode);
      
      if (onCodeChange) {
        onCodeChange(currentCode);
      }
      
      // Use unit instance's evaluate method if available for proper sample registration
      if (unitInstance && typeof unitInstance.evaluate === 'function') {
        console.log(`IsolatedStrudelEditor: Using LiveCodingUnit.evaluate() for unit ${unitId}`);
        await unitInstance.evaluate();
      } else {
        // Fallback to direct evaluation like StrudelReplTest
        console.log(`IsolatedStrudelEditor: Using direct REPL evaluation for unit ${unitId}`);
        replRef.current.editor.repl.evaluate(currentCode);
      }
    }
  };

  return (
    <div className="space-y-2">
      {/* Control buttons */}
      <div className="flex items-center gap-2 p-2 bg-gray-800/50 rounded">
        <button
          onClick={handleUpdate}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-sm flex items-center gap-1 text-xs"
        >
          <RefreshCw size={12} />
          Update & Run
        </button>
        
        <button
          onClick={handleToggle}
          className={`px-3 py-1.5 rounded-sm flex items-center gap-1 text-xs ${
            isPlaying
              ? 'bg-yellow-600 text-white'
              : 'bg-green-600 text-white'
          }`}
        >
          {isPlaying ? <Square size={12} /> : <Play size={12} />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        
        <button
          onClick={handleStop}
          className="px-3 py-1.5 bg-red-600 text-white rounded-sm flex items-center gap-1 text-xs"
        >
          <Square size={12} />
          Stop
        </button>
        
        <span className="text-xs text-gray-400 ml-2">
          Unit: {unitId}
        </span>
      </div>

      {/* Strudel editor container */}
      <div 
        ref={containerRef} 
        className="border border-gray-600 rounded bg-gray-900 min-h-[300px]"
        style={{ minHeight: '300px' }}
      />
    </div>
  );
};

export default IsolatedStrudelEditor;
