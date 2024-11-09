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

  // Track current patterns and playing state
  const [currentPattern1, setCurrentPattern1] = useState(patterns.basic1);
  const [currentPattern2, setCurrentPattern2] = useState(patterns.basic2);
  const [isPlaying1, setIsPlaying1] = useState(false);
  const [isPlaying2, setIsPlaying2] = useState(false);

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

  const handleToggle = (repl, setIsPlaying) => {
    if (repl.current?.editor?.repl) {
      repl.current.editor.toggle();
      setIsPlaying(prev => !prev);
    }
  };

  const handleStop = (repl, setIsPlaying) => {
    if (repl.current?.editor?.repl) {
      repl.current.editor.repl.stop();
      setIsPlaying(false);
    }
  };

  const handleStartAll = () => {
    if (!isPlaying1) handleToggle(repl1Ref, setIsPlaying1);
    if (!isPlaying2) handleToggle(repl2Ref, setIsPlaying2);
  };

  const handleStopAll = () => {
    if (isPlaying1) handleStop(repl1Ref, setIsPlaying1);
    if (isPlaying2) handleStop(repl2Ref, setIsPlaying2);
  };

  const applyPattern = (repl, pattern, setPattern) => {
    if (repl.current?.editor) {
      repl.current.editor.setCode(pattern);
      setPattern(pattern);
    }
  };

  const handleUpdate = async (repl, setPattern) => {
    if (repl.current?.editor?.repl) {
      // Get code directly from the REPL
      console.log("repl.current.editor", repl.current.editor);
      const currentCode = repl.current.editor.code;
      console.log('Current code:', currentCode);
      setPattern(currentCode);
      repl.current.editor.repl.evaluate(currentCode);
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
            onClick={() => handleToggle(repl1Ref, setIsPlaying1)}
            className={`px-4 py-2 rounded ${
              isPlaying1
                ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {isPlaying1 ? 'Pause REPL 1' : 'Play REPL 1'}
          </button>
          <button
            onClick={() => handleStop(repl1Ref, setIsPlaying1)}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Stop REPL 1
          </button>
          <button
            onClick={() => handleUpdate(repl1Ref, setCurrentPattern1)}
            className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
          >
            Update & Run REPL 1
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
            onClick={() => handleToggle(repl2Ref, setIsPlaying2)}
            className={`px-4 py-2 rounded ${
              isPlaying2
                ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {isPlaying2 ? 'Pause REPL 2' : 'Play REPL 2'}
          </button>
          <button
            onClick={() => handleStop(repl2Ref, setIsPlaying2)}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Stop REPL 2
          </button>
          <button
            onClick={() => handleUpdate(repl2Ref, setCurrentPattern2)}
            className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
          >
            Update & Run REPL 2
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