import React, { useEffect, useRef, useState } from 'react';
import '@strudel/repl';

/**
 * DynamicStrudelTest - Test component for dynamically creating isolated Strudel REPL instances
 * Based on StrudelReplTest.jsx but with dynamic creation/destruction and proper isolation
 */
const DynamicStrudelTest = () => {
  const [repls, setRepls] = useState(new Map());
  const [nextId, setNextId] = useState(1);
  const containerRefs = useRef(new Map());
  const replRefs = useRef(new Map());

  // Mock patterns for testing - only built-in sounds from Strudel docs
  const mockPatterns = [
    'sound("bd hh")',
    'sound("sd oh")',
    'sound("bd hh sd oh")',
    'sound("bd sd rim hh")',
    'sound("bd").every(4, x => x.speed(2))',
    'sound("hh").fast(4)',
    'sound("bd sd").slow(2)',
    'sound("casio").gain(0.8)',
    'sound("metal").delay(0.2)',
    'sound("bd hh sd hh")',
    'sound("bd hh sd oh").bank("RolandTR808")',
    'sound("bd hh sd oh").bank("RolandTR909")',
    'sound("jazz metal casio")',
    'sound("bd*4, hh*8")',
    'sound("insect wind")',
    'sound("bd rim oh")',
    'note("c e g").sound("piano")',
    'note("48 52 55 59").sound("sawtooth")',
    'sound("numbers:1 numbers:2")',
    'sound("bd sd, hh*4")'
  ];

  const logger = (haps, t) => {
    haps.forEach(hap => {
      console.log('Hap:', hap.value, "time:", t);
    });
  };

  useEffect(() => {
    if (window) {
      window.kromosynthblink = logger;
    }
  }, []);

  // Create a new REPL instance
  const createRepl = () => {
    const id = nextId;
    setNextId(prev => prev + 1);
    
    const randomPattern = mockPatterns[Math.floor(Math.random() * mockPatterns.length)];
    
    setRepls(prev => new Map(prev).set(id, {
      id,
      pattern: randomPattern,
      isPlaying: false,
      sync: true,
      solo: false,
      containerRef: React.createRef(),
      replRef: React.createRef()
    }));
    
    console.log(`DynamicStrudelTest: Created REPL ${id} with pattern: ${randomPattern}`);
  };

  // Remove a REPL instance
  const removeRepl = (id) => {
    const repl = repls.get(id);
    if (repl) {
      // Stop and cleanup
      if (repl.replRef.current?.editor?.repl) {
        repl.replRef.current.editor.repl.stop();
        console.log(`DynamicStrudelTest: Stopped REPL ${id}`);
      }
      
      if (repl.containerRef.current) {
        repl.containerRef.current.innerHTML = '';
      }
      
      setRepls(prev => {
        const newMap = new Map(prev);
        newMap.delete(id);
        return newMap;
      });
      
      console.log(`DynamicStrudelTest: Removed REPL ${id}`);
    }
  };

  // Initialize a REPL after it's mounted
  const initializeRepl = (replData) => {
    if (replData.containerRef.current && !replData.replRef.current) {
      console.log(`DynamicStrudelTest: Initializing REPL ${replData.id}`);
      
      const repl = document.createElement('strudel-editor');
      repl.setAttribute('code', replData.pattern);
      repl.sync = replData.sync;
      repl.solo = replData.solo;
      
      replData.containerRef.current.appendChild(repl);
      replData.replRef.current = repl;
      
      console.log(`DynamicStrudelTest: REPL ${replData.id} initialized with pattern: ${replData.pattern}`);
    }
  };

  // Re-initialize a REPL with new sync/solo settings (preserving pattern and state)
  const reinitializeRepl = (replData, newSync = null, newSolo = null) => {
    if (!replData.containerRef.current) return;
    
    const currentSync = newSync !== null ? newSync : replData.sync;
    const currentSolo = newSolo !== null ? newSolo : replData.solo;
    const wasPlaying = replData.isPlaying;
    
    console.log(`DynamicStrudelTest: Re-initializing REPL ${replData.id} with sync=${currentSync}, solo=${currentSolo}`);
    
    // Stop and remove old instance
    if (replData.replRef.current?.editor?.repl) {
      replData.replRef.current.editor.repl.stop();
    }
    replData.containerRef.current.innerHTML = '';
    
    // Create new instance with updated properties
    const repl = document.createElement('strudel-editor');
    repl.setAttribute('code', replData.pattern);
    repl.sync = currentSync;
    repl.solo = currentSolo;
    
    replData.containerRef.current.appendChild(repl);
    replData.replRef.current = repl;
    
    // If it was playing, restart after a short delay
    if (wasPlaying) {
      setTimeout(() => {
        if (repl.editor?.repl) {
          repl.editor.repl.evaluate(replData.pattern);
          console.log(`DynamicStrudelTest: Restarted REPL ${replData.id} after re-initialization`);
        }
      }, 200);
    }
    
    console.log(`DynamicStrudelTest: REPL ${replData.id} re-initialized successfully`);
  };

  // Toggle playback for a specific REPL
  const toggleRepl = (id) => {
    const repl = repls.get(id);
    if (repl?.replRef.current?.editor?.repl) {
      repl.replRef.current.editor.toggle();
      
      setRepls(prev => {
        const newMap = new Map(prev);
        const updated = { ...newMap.get(id), isPlaying: !repl.isPlaying };
        newMap.set(id, updated);
        return newMap;
      });
      
      console.log(`DynamicStrudelTest: Toggled REPL ${id} - now ${!repl.isPlaying ? 'playing' : 'stopped'}`);
    }
  };

  // Stop a specific REPL
  const stopRepl = (id) => {
    const repl = repls.get(id);
    if (repl?.replRef.current?.editor?.repl) {
      repl.replRef.current.editor.repl.stop();
      
      setRepls(prev => {
        const newMap = new Map(prev);
        const updated = { ...newMap.get(id), isPlaying: false };
        newMap.set(id, updated);
        return newMap;
      });
      
      console.log(`DynamicStrudelTest: Stopped REPL ${id}`);
    }
  };

  // Update pattern for a specific REPL
  const updatePattern = (id, newPattern) => {
    const repl = repls.get(id);
    if (repl?.replRef.current?.editor) {
      console.log(`DynamicStrudelTest: Updating REPL ${id} pattern to: ${newPattern}`);
      
      // Stop first
      if (repl.replRef.current.editor.repl) {
        repl.replRef.current.editor.repl.stop();
      }
      
      // Update code
      repl.replRef.current.editor.setCode(newPattern);
      
      // Update state
      setRepls(prev => {
        const newMap = new Map(prev);
        const updated = { ...newMap.get(id), pattern: newPattern, isPlaying: false };
        newMap.set(id, updated);
        return newMap;
      });
      
      // Auto-evaluate after a short delay
      setTimeout(() => {
        if (repl.replRef.current?.editor?.repl) {
          repl.replRef.current.editor.repl.evaluate(newPattern);
          setRepls(prev => {
            const newMap = new Map(prev);
            const updated = { ...newMap.get(id), isPlaying: true };
            newMap.set(id, updated);
            return newMap;
          });
          console.log(`DynamicStrudelTest: Auto-evaluated new pattern for REPL ${id}`);
        }
      }, 100);
    }
  };

  // Apply a random pattern to a REPL (simulates hover behavior)
  const applyRandomPattern = (id) => {
    const randomPattern = mockPatterns[Math.floor(Math.random() * mockPatterns.length)];
    updatePattern(id, randomPattern);
  };

  // Toggle sync setting for a specific REPL
  const toggleSync = (id) => {
    const repl = repls.get(id);
    if (repl?.containerRef.current) {
      const newSync = !repl.sync;
      
      console.log(`DynamicStrudelTest: Toggling sync for REPL ${id} from ${repl.sync} to ${newSync}`);
      
      // Update state first
      setRepls(prev => {
        const newMap = new Map(prev);
        const updated = { ...newMap.get(id), sync: newSync };
        newMap.set(id, updated);
        return newMap;
      });
      
      // Re-initialize the REPL with new sync setting
      reinitializeRepl(repl, newSync, repl.solo);
    }
  };

  // Toggle solo setting for a specific REPL
  const toggleSolo = (id) => {
    const repl = repls.get(id);
    if (repl?.containerRef.current) {
      const newSolo = !repl.solo;
      
      console.log(`DynamicStrudelTest: Toggling solo for REPL ${id} from ${repl.solo} to ${newSolo}`);
      
      // Update state first
      setRepls(prev => {
        const newMap = new Map(prev);
        const updated = { ...newMap.get(id), solo: newSolo };
        newMap.set(id, updated);
        return newMap;
      });
      
      // Re-initialize the REPL with new solo setting
      reinitializeRepl(repl, repl.sync, newSolo);
    }
  };

  // Stop all REPLs
  const stopAll = () => {
    repls.forEach((repl, id) => stopRepl(id));
  };

  // Start all REPLs
  const startAll = () => {
    repls.forEach((repl, id) => {
      if (!repl.isPlaying) toggleRepl(id);
    });
  };

  // Toggle sync for all REPLs
  const toggleAllSync = () => {
    const allSynced = Array.from(repls.values()).every(repl => repl.sync);
    const newSync = !allSynced;
    
    console.log(`DynamicStrudelTest: Setting all REPLs sync to ${newSync ? 'ON' : 'OFF'}`);
    
    // Update state first
    setRepls(prev => {
      const newMap = new Map();
      prev.forEach((repl, id) => {
        newMap.set(id, { ...repl, sync: newSync });
      });
      return newMap;
    });
    
    // Re-initialize all REPLs with new sync setting
    repls.forEach((repl, id) => {
      if (repl.containerRef.current) {
        reinitializeRepl(repl, newSync, repl.solo);
      }
    });
  };

  // Clear all solo settings
  const clearAllSolo = () => {
    console.log(`DynamicStrudelTest: Clearing all solo settings`);
    
    // Update state first
    setRepls(prev => {
      const newMap = new Map();
      prev.forEach((repl, id) => {
        newMap.set(id, { ...repl, solo: false });
      });
      return newMap;
    });
    
    // Re-initialize all REPLs with solo disabled
    repls.forEach((repl, id) => {
      if (repl.containerRef.current) {
        reinitializeRepl(repl, repl.sync, false);
      }
    });
  };

  // Individual REPL component
  const ReplInstance = ({ replData }) => {
    const [hasInitialized, setHasInitialized] = useState(false);
    
    useEffect(() => {
      if (!hasInitialized) {
        initializeRepl(replData);
        setHasInitialized(true);
      }
    }, [replData, hasInitialized]);

    return (
      <div className="bg-white p-4 rounded-lg shadow space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">REPL {replData.id}</h3>
          <button
            onClick={() => removeRepl(replData.id)}
            className="px-2 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
          >
            Remove
          </button>
        </div>
        
        <div className="text-sm text-gray-600 font-mono bg-gray-100 p-2 rounded">
          {replData.pattern}
        </div>
        
        {/* Sync/Solo Controls */}
        <div className="flex gap-2 text-xs">
          <button
            onClick={() => toggleSync(replData.id)}
            className={`px-2 py-1 rounded text-xs font-medium ${
              replData.sync
                ? 'bg-blue-500 text-white'
                : 'bg-gray-300 text-gray-700'
            }`}
          >
            SYNC: {replData.sync ? 'ON' : 'OFF'}
          </button>
          
          <button
            onClick={() => toggleSolo(replData.id)}
            className={`px-2 py-1 rounded text-xs font-medium ${
              replData.solo
                ? 'bg-orange-500 text-white'
                : 'bg-gray-300 text-gray-700'
            }`}
          >
            SOLO: {replData.solo ? 'ON' : 'OFF'}
          </button>
        </div>
        
        <div 
          ref={replData.containerRef}
          className="border border-gray-300 rounded p-2 min-h-[150px] bg-gray-50"
        />
        
        <div className="flex gap-2">
          <button
            onClick={() => toggleRepl(replData.id)}
            className={`px-3 py-1 rounded text-sm ${
              replData.isPlaying
                ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {replData.isPlaying ? 'Pause' : 'Play'}
          </button>
          
          <button
            onClick={() => stopRepl(replData.id)}
            className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
          >
            Stop
          </button>
          
          <button
            onClick={() => applyRandomPattern(replData.id)}
            className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
          >
            Random Pattern
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">Dynamic Strudel REPL Test</h1>
        <p className="text-gray-600 mb-6">
          Test dynamic creation and isolation of multiple Strudel REPL instances
        </p>
      </div>
      
      {/* Global Controls */}
      <div className="bg-gray-100 p-4 rounded-lg">
        <h2 className="text-lg font-semibold mb-3">Global Controls</h2>
        <div className="flex gap-3">
          <button
            onClick={createRepl}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Add New REPL
          </button>
          
          <button
            onClick={startAll}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Start All
          </button>
          
          <button
            onClick={stopAll}
            className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
          >
            Stop All
          </button>
          
          <button
            onClick={toggleAllSync}
            className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600"
          >
            Toggle All Sync
          </button>
          
          <button
            onClick={clearAllSolo}
            className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
          >
            Clear All Solo
          </button>
          
          <div className="ml-auto text-sm text-gray-600 flex items-center">
            Active REPLs: {repls.size}
          </div>
        </div>
      </div>

      {/* REPL Instances */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from(repls.values()).map(replData => (
          <ReplInstance key={replData.id} replData={replData} />
        ))}
      </div>
      
      {repls.size === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-4">No REPLs created yet</p>
          <button
            onClick={createRepl}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            Create Your First REPL
          </button>
        </div>
      )}
      
      {/* Instructions */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <h3 className="font-semibold text-blue-900 mb-2">Testing Instructions:</h3>
        <ul className="text-blue-800 text-sm space-y-1">
          <li>• Create multiple REPLs and test if they can play simultaneously</li>
          <li>• Use "Random Pattern" to simulate hover behavior</li>
          <li>• Check if pattern updates affect only the intended REPL</li>
          <li>• Verify proper cleanup when removing REPLs</li>
          <li>• <strong>Test SYNC:</strong> Toggle sync on/off for individual REPLs - synced REPLs should play in time together</li>
          <li>• <strong>Test SOLO:</strong> Enable solo on one REPL - only that REPL should be audible</li>
          <li>• Use global controls to manage sync/solo settings across all REPLs</li>
          <li>• Try playing multiple REPLs with different sync/solo combinations</li>
        </ul>
      </div>
    </div>
  );
};

export default DynamicStrudelTest;
