import React, { useEffect, useRef, useState } from 'react';
import { Play, Square, RefreshCw } from 'lucide-react';
import '@strudel/repl';

/**
 * SimpleStrudelRepl - Minimal REPL component that just works
 * Directly copied patterns from StrudelReplTest.jsx with minimal modifications
 */
const SimpleStrudelRepl = ({ 
  unitId,
  unitInstance,
  onCodeChange 
}) => {
  // Completely independent state and refs - exactly like StrudelReplTest
  const replRef = useRef(null);
  const containerRef = useRef(null);
  const [currentPattern, setCurrentPattern] = useState(`// Unit ${unitId}\nsound("bd hh sd oh")`);
  const [isPlaying, setIsPlaying] = useState(false);

  // Initialize REPL exactly like StrudelReplTest.jsx - once, no dependencies
  useEffect(() => {
    if (containerRef.current && !replRef.current) {
      console.log(`SimpleStrudelRepl: Creating REPL for unit ${unitId}`);
      
      const repl = document.createElement('strudel-editor');
      repl.setAttribute('code', currentPattern);
      repl.sync = true;
      repl.solo = false;
      
      containerRef.current.appendChild(repl);
      replRef.current = repl;
      
      // Notify unit instance when ready
      const checkReady = () => {
        if (repl.editor && repl.editor.repl) {
          console.log(`SimpleStrudelRepl: REPL ready for unit ${unitId}`);
          
          // Set replInstance and editorInstance on the LiveCodingUnit for proper integration
          if (unitInstance && unitInstance.setReplInstance) {
            unitInstance.setReplInstance(repl.editor);
          }
          
          // Also set the instances directly to make isReadyForSounds() return true
          if (unitInstance) {
            unitInstance.replInstance = repl.editor.repl;
            unitInstance.editorInstance = repl.editor;
            console.log(`SimpleStrudelRepl: Set instances on LiveCodingUnit ${unitId}`);
          }
          
          // Set up global method for external updates (hover interactions)
          const updateMethod = (newCode) => {
            console.log(`SimpleStrudelRepl: Global update method called for unit ${unitId}:`, newCode);
            updateFromExternal(newCode);
          };
          
          window[`updateUnit${unitId}`] = updateMethod;
          console.log(`SimpleStrudelRepl: Registered global method updateUnit${unitId}`);
          
        } else {
          setTimeout(checkReady, 100);
        }
      };
      
      setTimeout(checkReady, 100);
    }

    // Cleanup exactly like StrudelReplTest.jsx
    return () => {
      console.log(`SimpleStrudelRepl: Cleaning up unit ${unitId}`);
      
      // Clean up global method
      delete window[`updateUnit${unitId}`];
      
      // CRITICAL: Stop any playing patterns before cleanup
      if (replRef.current?.editor?.repl) {
        replRef.current.editor.repl.stop();
        console.log(`SimpleStrudelRepl: Stopped REPL during cleanup for unit ${unitId}`);
      }
      
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      replRef.current = null;
    };
  }, []); // NO DEPENDENCIES - initialize once like StrudelReplTest

  // Simple pattern update - exactly like StrudelReplTest
  const applyPattern = (pattern) => {
    if (replRef.current?.editor) {
      // CRITICAL: Stop any currently playing pattern first to avoid overlap
      if (replRef.current.editor.repl) {
        replRef.current.editor.repl.stop();
        setIsPlaying(false);
        console.log(`SimpleStrudelRepl: Stopped previous pattern for unit ${unitId}`);
      }
      
      replRef.current.editor.setCode(pattern);
      setCurrentPattern(pattern);
      
      if (onCodeChange) {
        onCodeChange(pattern);
      }
      
      console.log(`SimpleStrudelRepl: Applied new pattern for unit ${unitId}:`, pattern);
    }
  };

  // Control functions exactly like StrudelReplTest.jsx
  const handleToggle = (e) => {
    e?.stopPropagation(); // Prevent unit deselection
    if (replRef.current?.editor?.repl) {
      console.log(`SimpleStrudelRepl: Toggling playback for unit ${unitId} (currently ${isPlaying ? 'playing' : 'stopped'})`);
      replRef.current.editor.toggle();
      setIsPlaying(prev => !prev);
    }
  };

  const handleStop = (e) => {
    e?.stopPropagation(); // Prevent unit deselection
    if (replRef.current?.editor?.repl) {
      console.log(`SimpleStrudelRepl: Stopping playback for unit ${unitId}`);
      replRef.current.editor.repl.stop();
      setIsPlaying(false);
    }
  };

  const handleUpdate = (e) => {
    e?.stopPropagation(); // Prevent unit deselection
    if (replRef.current?.editor?.repl) {
      // Get code exactly like StrudelReplTest.jsx
      const currentCode = replRef.current.editor.code;
      setCurrentPattern(currentCode);
      
      if (onCodeChange) {
        onCodeChange(currentCode);
      }
      
      // CRITICAL: Stop before evaluating to prevent overlap
      console.log(`SimpleStrudelRepl: Stopping and evaluating new code for unit ${unitId}`);
      replRef.current.editor.repl.stop();
      setIsPlaying(false);
      
      // Small delay to ensure stop completes
      setTimeout(() => {
        replRef.current.editor.repl.evaluate(currentCode);
        setIsPlaying(true);
        console.log(`SimpleStrudelRepl: Started new pattern for unit ${unitId}`);
      }, 50);
    }
  };

  // Simple method to update code from external source (like hover)
  const updateFromExternal = (newCode) => {
    console.log(`SimpleStrudelRepl: External update for unit ${unitId}:`, newCode);
    
    // Stop current pattern before applying new one to prevent phantom instances
    if (replRef.current?.editor?.repl) {
      replRef.current.editor.repl.stop();
      setIsPlaying(false);
      console.log(`SimpleStrudelRepl: Stopped current pattern before external update for unit ${unitId}`);
    }
    
    applyPattern(newCode);
    
    // Auto-evaluate the new pattern from hover interactions
    setTimeout(() => {
      if (replRef.current?.editor?.repl) {
        console.log(`SimpleStrudelRepl: Auto-evaluating external pattern for unit ${unitId}`);
        replRef.current.editor.repl.evaluate(newCode);
        setIsPlaying(true);
      }
    }, 100);
  };

  // Expose update method to unit instance
  useEffect(() => {
    if (unitInstance) {
      unitInstance._replUpdateMethod = updateFromExternal;
    }
  }, [unitInstance]);

  return (
    <div className="space-y-2">
      {/* Simple controls */}
      <div className="flex items-center gap-2 p-2 bg-gray-800/50 rounded">
        <button
          onClick={handleUpdate}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-sm flex items-center gap-1 text-xs"
        >
          <RefreshCw size={12} />
          Update
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
        
        <span className="text-xs text-gray-400 ml-2">Unit {unitId}</span>
      </div>

      {/* REPL container - exactly like StrudelReplTest */}
      <div 
        ref={containerRef} 
        className="border border-gray-600 rounded bg-gray-900 min-h-[300px]"
      />
    </div>
  );
};

export default SimpleStrudelRepl;
