import React, { useEffect, useRef, useState } from 'react';
import '@strudel/repl';

const StrudelReplTest = () => {
  const repl1Ref = useRef(null);
  const repl2Ref = useRef(null);
  const containerRef1 = useRef(null);
  const containerRef2 = useRef(null);

  // Define all available patterns
  const patterns = {
    basic1: 'sound("bd hh")',
    basic2: 'sound("sd oh")',
    tr909: 'sound("bd hh sd oh").bank("RolandTR909")',
    fourBeat: 'sound("bd hh sd hh")'
  };

  // Track current patterns
  const [currentPattern1, setCurrentPattern1] = useState(patterns.basic1);
  const [currentPattern2, setCurrentPattern2] = useState(patterns.basic2);

  useEffect(() => {
    // Initialize first REPL
    if (containerRef1.current && !repl1Ref.current) {
      const repl1 = document.createElement('strudel-editor');
      repl1.setAttribute('code', currentPattern1);
      repl1.sync = true;
      repl1.solo = false;
      containerRef1.current.appendChild(repl1);
      repl1Ref.current = repl1;
    }

    // Initialize second REPL
    if (containerRef2.current && !repl2Ref.current) {
      const repl2 = document.createElement('strudel-editor');
      repl2.setAttribute('code', currentPattern2);
      repl2.sync = true;
      repl2.solo = false;
      containerRef2.current.appendChild(repl2);
      repl2Ref.current = repl2;
    }

    // Cleanup on unmount
    return () => {
      if (containerRef1.current) {
        containerRef1.current.innerHTML = '';
      }
      if (containerRef2.current) {
        containerRef2.current.innerHTML = '';
      }
      repl1Ref.current = null;
      repl2Ref.current = null;
    };
  }, []);

  const handleStart = (repl, pattern) => {
    if (repl.current?.editor?.repl) {
      repl.current.editor.repl.evaluate(pattern);
    }
  };

  const handleStop = (repl) => {
    if (repl.current?.editor?.repl) {
      repl.current.editor.repl.stop();
    }
  };

  const handleStartAll = () => {
    handleStart(repl1Ref, currentPattern1);
    handleStart(repl2Ref, currentPattern2);
  };

  const handleStopAll = () => {
    handleStop(repl1Ref);
    handleStop(repl2Ref);
  };

  const applyPattern = (repl, pattern, setPattern) => {
    if (repl.current?.editor) {
      repl.current.editor.setCode(pattern);
      setPattern(pattern);
    }
  };

  // Pattern selection component
  const PatternSelector = ({ replRef, currentPattern, setPattern, replName }) => (
    <div className="space-y-2 mb-4">
      <h3 className="text-sm font-medium text-gray-700">Select Pattern for {replName}</h3>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => applyPattern(replRef, patterns.basic1, setPattern)}
          className={`px-3 py-1 text-sm rounded ${
            currentPattern === patterns.basic1 
              ? 'bg-blue-500 text-white' 
              : 'bg-gray-200 hover:bg-gray-300'
          }`}
        >
          Basic 1
        </button>
        <button
          onClick={() => applyPattern(replRef, patterns.basic2, setPattern)}
          className={`px-3 py-1 text-sm rounded ${
            currentPattern === patterns.basic2 
              ? 'bg-blue-500 text-white' 
              : 'bg-gray-200 hover:bg-gray-300'
          }`}
        >
          Basic 2
        </button>
        <button
          onClick={() => applyPattern(replRef, patterns.tr909, setPattern)}
          className={`px-3 py-1 text-sm rounded ${
            currentPattern === patterns.tr909 
              ? 'bg-blue-500 text-white' 
              : 'bg-gray-200 hover:bg-gray-300'
          }`}
        >
          TR-909
        </button>
        <button
          onClick={() => applyPattern(replRef, patterns.fourBeat, setPattern)}
          className={`px-3 py-1 text-sm rounded ${
            currentPattern === patterns.fourBeat 
              ? 'bg-blue-500 text-white' 
              : 'bg-gray-200 hover:bg-gray-300'
          }`}
        >
          Four Beat
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-4 space-y-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Strudel REPL Test</h1>
      
      {/* First REPL */}
      <div className="space-y-2 bg-white p-4 rounded-lg shadow">
        <h2 className="text-lg font-semibold">REPL 1</h2>
        <PatternSelector 
          replRef={repl1Ref}
          currentPattern={currentPattern1}
          setPattern={setCurrentPattern1}
          replName="REPL 1"
        />
        <div 
          ref={containerRef1} 
          className="border border-gray-300 rounded p-2 min-h-[200px]"
        />
        <div className="space-x-2">
          <button
            onClick={() => handleStart(repl1Ref, currentPattern1)}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
          >
            Start REPL 1
          </button>
          <button
            onClick={() => handleStop(repl1Ref)}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Stop REPL 1
          </button>
        </div>
      </div>

      {/* Second REPL */}
      <div className="space-y-2 bg-white p-4 rounded-lg shadow">
        <h2 className="text-lg font-semibold">REPL 2</h2>
        <PatternSelector 
          replRef={repl2Ref}
          currentPattern={currentPattern2}
          setPattern={setCurrentPattern2}
          replName="REPL 2"
        />
        <div 
          ref={containerRef2} 
          className="border border-gray-300 rounded p-2 min-h-[200px]"
        />
        <div className="space-x-2">
          <button
            onClick={() => handleStart(repl2Ref, currentPattern2)}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
          >
            Start REPL 2
          </button>
          <button
            onClick={() => handleStop(repl2Ref)}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Stop REPL 2
          </button>
        </div>
      </div>

      {/* Global Controls */}
      <div className="pt-4 border-t border-gray-300 space-x-2">
        <button
          onClick={handleStartAll}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Start All
        </button>
        <button
          onClick={handleStopAll}
          className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
        >
          Stop All
        </button>
      </div>
    </div>
  );
};

export default StrudelReplTest;