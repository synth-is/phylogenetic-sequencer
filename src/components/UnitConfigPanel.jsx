import React, { useState, useRef, useEffect } from 'react';
import { X, Code, Play, Square, RefreshCw, Bug, ChevronUp, ChevronDown } from 'lucide-react';
import StrudelEditor from './StrudelEditor';
import ChuckEditor from './ChuckEditor';
import { DEFAULT_STRUDEL_CODE, UNIT_TYPES } from '../constants';
import '@strudel/repl';
import { useStrudelPattern } from './useStrudelPattern';

const Slider = ({ label, value, onChange, min = 0, max = 1, step = 0.01, centered = false }) => (
  <div className="space-y-1">
    <div className="flex justify-between text-sm">
      <span className="text-gray-300">{label}</span>
      <span className="text-gray-400">{value.toFixed(2)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className={`w-full h-1.5 rounded-sm appearance-none bg-gray-700 
        [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 
        [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:bg-blue-500 
        [&::-webkit-slider-thumb]:appearance-none`}
      style={centered ? { background: `linear-gradient(to right, #374151 50%, #374151 50%)` } : {}}
    />
  </div>
);

const CollapsibleSection = ({ title, children }) => {
  const [isOpen, setIsOpen] = useState(true);
  
  return (
    <div className="mb-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-2 py-1 bg-blue-900/30 text-white text-sm"
      >
        <span>{title}</span>
        <span>{isOpen ? '▼' : '▶'}</span>
      </button>
      {isOpen && (
        <div className="p-2 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
};

const UnitConfigPanel = ({ unit, units, onClose, onUpdateUnit }) => {
  const [showDebugger, setShowDebugger] = useState(false);
  const [activeTab, setActiveTab] = useState('Unit');
  const [liveCodeEngine, setLiveCodeEngine] = useState(unit.liveCodeEngine || 'Strudel');
  const editorRef = useRef(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  const {
    debugLog,
    applyPatternFromEditor,
    testPatternUpdate,
    clearDebugLog,
    registerReplInstance,
    unregisterReplInstance
  } = useStrudelPattern(unit.id);

  const handleEditorReady = (editor) => {
    console.log(`Strudel editor ready for unit ${unit.id}`);
    editorRef.current = editor;
    registerReplInstance(editor);

    // Initialize with a random pattern
    const randomFastValue = Math.floor(Math.random() * 10) + 1;
    const waveforms = ["sawtooth", "square", "triangle", "sine"];
    const randomWaveform = waveforms[Math.floor(Math.random() * waveforms.length)];
    const code = `note("c2 <eb2 <g2 g1>>".fast(${randomFastValue})).sound("${randomWaveform}")`;
    
    editor.repl.setCode(code);
    editor.repl.evaluate(code);
    editor.repl.stop(); // Start stopped
  };

  const handleCodeChange = (newCode) => {
    console.log(`Code change in unit ${unit.id}:`, newCode);
    onUpdateUnit(unit.id, {
      ...unit,
      strudelCode: newCode
    });
  };

  const handleEngineChange = (engine) => {
    setLiveCodeEngine(engine);
    onUpdateUnit(unit.id, { ...unit, liveCodeEngine: engine });
  };

  const handlePlay = () => {
    if (editorRef.current?.repl) {
      console.log(`Starting playback for unit ${unit.id}`);
      editorRef.current.repl.start();
    }
  };

  const handleStop = () => {
    if (editorRef.current?.repl) {
      console.log(`Stopping playback for unit ${unit.id}`);
      editorRef.current.repl.stop();
    }
  };

  const handleApplyChanges = () => {
    const editor = editorRef.current;
    if (editor?.repl) {
      console.log(`Applying changes for unit ${unit.id}`);
      const currentCode = editor.repl.getCode();
      editor.repl.evaluate(currentCode);
    }
  };

  const handleValueChange = (key, value) => {
    onUpdateUnit(unit.id, { ...unit, [key]: value });
  };

  // Cleanup when component unmounts or unit changes
  useEffect(() => {
    return () => {
      if (editorRef.current?.repl) {
        console.log(`Cleaning up editor for unit ${unit.id}`);
        unregisterReplInstance();
        editorRef.current = null;
      }
    };
  }, [unit.id]);

  // Initialize playbackMode if not set
  useEffect(() => {
    if (unit && !unit.playbackMode) {
      handleValueChange('playbackMode', 'one-off');
    }
  }, [unit]);

  return (
    <div className="fixed right-4 top-16 z-50 bg-gray-900/95 backdrop-blur border border-gray-800 rounded-lg shadow-xl w-80">
      <div className="flex items-center border-b border-gray-800 p-2">
        <div className="flex-1 flex items-center gap-2">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded-sm hover:bg-gray-800 text-gray-400 hover:text-white"
          >
            {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          {['Unit', 'Sampler', 'Live Code'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 text-sm rounded-sm ${activeTab === tab 
                ? 'bg-blue-900/30 text-white' 
                : 'text-gray-400 hover:text-white'}`}
            >
              {tab}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-sm hover:bg-gray-800 text-gray-400 hover:text-white ml-2"
        >
          <X size={16} />
        </button>
      </div>

      <div className={`overflow-hidden transition-all duration-200 ${isCollapsed ? 'max-h-0' : 'max-h-[calc(100vh-8rem)]'}`}>
        <div className="p-4 overflow-y-auto">
          {activeTab === 'Unit' && (
            <>
              {/* Only show Playback section for TrajectoryUnit */}
              {unit.type === UNIT_TYPES.TRAJECTORY && (
                <CollapsibleSection title="Playback">
                  <div className="space-y-2">
                    <label className="text-sm text-white">Mode</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleValueChange('playbackMode', 'one-off')}
                        className={`flex-1 px-2 py-1 rounded text-xs ${
                          (!unit.playbackMode || unit.playbackMode === 'one-off')
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700 text-gray-400'
                        }`}
                      >
                        One-Off
                      </button>
                      <button
                        onClick={() => handleValueChange('playbackMode', 'looping')}
                        className={`flex-1 px-2 py-1 rounded text-xs ${
                          unit.playbackMode === 'looping'
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-700 text-gray-400'
                        }`}
                      >
                        Looping
                      </button>
                    </div>
                    <p className="text-xs text-gray-400">
                      {unit.playbackMode === 'looping' 
                        ? 'Hover over nodes to loop sounds; hover again to stop the looping'
                        : 'Hover nodes to play sounds once'}
                    </p>
                  </div>
                </CollapsibleSection>
              )}

              {/* Remove Sequence section with Speed slider for both unit types */}
              
              <CollapsibleSection title="Evolution">
                <Slider 
                  label="Grow" 
                  value={unit.grow || 0} 
                  onChange={val => handleValueChange('grow', val)} 
                />
                <Slider 
                  label="Shrink" 
                  value={unit.shrink || 0} 
                  onChange={val => handleValueChange('shrink', val)} 
                />
                <Slider 
                  label="Mutate" 
                  value={unit.mutate || 0} 
                  onChange={val => handleValueChange('mutate', val)} 
                />
                <Slider 
                  label="Prob. New Tree" 
                  value={unit.probNewTree || 0} 
                  onChange={val => handleValueChange('probNewTree', val)} 
                />
              </CollapsibleSection>
            </>
          )}

          {activeTab === 'Unit' && unit.type === UNIT_TYPES.SEQUENCING && (
            <>
              <CollapsibleSection title="Sequence Settings">
                <div className="space-y-2">
                  <label className="text-sm text-white">Bars</label>
                  <select
                    value={unit.bars || 1} // Default to 1 bar
                    onChange={(e) => onUpdateUnit(unit.id, { ...unit, bars: Number(e.target.value) })}
                    className="w-full bg-gray-800 text-white p-2 rounded text-sm"
                  >
                    <option value={0.25}>1/4 bar</option>
                    <option value={0.5}>1/2 bar</option>
                    <option value={1}>1 bar</option>
                    <option value={2}>2 bars</option>
                    <option value={4}>4 bars</option>
                    <option value={8}>8 bars</option>
                  </select>
                </div>
                
                <Slider 
                  label="Start Offset" 
                  value={unit.startOffset} 
                  onChange={val => onUpdateUnit(unit.id, { ...unit, startOffset: val })} 
                  min={0}
                  max={4}
                  step={0.25}
                />
                
                <Slider 
                  label="BPM" 
                  value={unit.bpm} 
                  onChange={val => onUpdateUnit(unit.id, { ...unit, bpm: val })} 
                  min={10}
                  max={300}
                  step={1}
                />
              </CollapsibleSection>
            </>
          )}

          {activeTab === 'Sampler' && (
            <>
              <CollapsibleSection title="Sample">
                <Slider 
                  label="Pitch" 
                  value={unit.pitch || 0} 
                  onChange={val => handleValueChange('pitch', val)} 
                  min={-12} 
                  max={12} 
                  centered={true}
                />
                <Slider 
                  label="Start" 
                  value={unit.start || 0} 
                  onChange={val => handleValueChange('start', val)} 
                />
              </CollapsibleSection>

              <CollapsibleSection title="Envelope">
                <Slider 
                  label="Attack" 
                  value={unit.attack || 0} 
                  onChange={val => handleValueChange('attack', val)} 
                />
                <Slider 
                  label="Decay" 
                  value={unit.decay || 0} 
                  onChange={val => handleValueChange('decay', val)} 
                />
                <Slider 
                  label="Sustain" 
                  value={unit.sustain || 0} 
                  onChange={val => handleValueChange('sustain', val)} 
                />
                <Slider 
                  label="Release" 
                  value={unit.release || 0} 
                  onChange={val => handleValueChange('release', val)} 
                />
              </CollapsibleSection>

              <CollapsibleSection title="Effects">
                <Slider 
                  label="Filter" 
                  value={unit.filter || 0} 
                  onChange={val => handleValueChange('filter', val)} 
                />
                <Slider 
                  label="Delay" 
                  value={unit.delay || 0} 
                  onChange={val => handleValueChange('delay', val)} 
                />
                <Slider 
                  label="Reverb" 
                  value={unit.reverb || 0} 
                  onChange={val => handleValueChange('reverb', val)} 
                />
              </CollapsibleSection>
            </>
          )}

          {activeTab === 'Live Code' && (
            <div className="space-y-4">
              <div className="flex gap-1 p-1 bg-gray-800 rounded">
                <button
                  onClick={() => handleEngineChange('Strudel')}
                  className={`flex-1 px-2 py-1 rounded text-xs ${
                    liveCodeEngine === 'Strudel'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-400 hover:text-white'
                  }`}
                >
                  Strudel
                </button>
                <button
                  onClick={() => handleEngineChange('ChucK')}
                  className={`flex-1 px-2 py-1 rounded text-xs ${
                    liveCodeEngine === 'ChucK'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-400 hover:text-white'
                  }`}
                >
                  ChucK
                </button>
              </div>

              <div className="flex items-center gap-2 p-2 bg-gray-800/50 rounded">
                <button
                  onClick={handleApplyChanges}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-sm flex items-center gap-1 text-xs"
                >
                  <RefreshCw size={12} />
                  Apply Changes
                </button>
                
                <button
                  onClick={testPatternUpdate}
                  className="px-3 py-1.5 bg-purple-600 text-white rounded-sm flex items-center gap-1 text-xs"
                >
                  <Code size={12} />
                  Test Update
                </button>

                <button
                  onClick={() => setShowDebugger(!showDebugger)}
                  className="px-3 py-1.5 bg-amber-600 text-white rounded-sm flex items-center gap-1 text-xs"
                >
                  <Bug size={12} />
                  {showDebugger ? 'Hide Debug' : 'Show Debug'}
                </button>

                <div className="flex-1" />

                <button
                  onClick={handlePlay}
                  className="p-1.5 bg-green-600 text-white rounded-sm"
                >
                  <Play size={14} />
                </button>
                
                <button
                  onClick={handleStop}
                  className="p-1.5 bg-red-600 text-white rounded-sm"
                >
                  <Square size={14} />
                </button>
              </div>

              {showDebugger && (
                <div className="p-2 bg-gray-800/50 rounded space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm text-white font-medium">Pattern Debug Log</h3>
                    <button
                      onClick={clearDebugLog}
                      className="text-xs text-gray-400 hover:text-white"
                    >
                      Clear Log
                    </button>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto text-xs">
                    {debugLog.map((entry, i) => (
                      <div
                        key={i}
                        className={`p-1 rounded ${
                          entry.unitId === unit.id 
                            ? 'bg-blue-900/30 text-blue-200' 
                            : 'bg-gray-800/50 text-gray-400'
                        }`}
                      >
                        <span className="text-gray-500">{entry.timestamp.split('T')[1].split('.')[0]}</span>
                        {' - '}
                        <span className="text-gray-400">Unit {entry.unitId}:</span>
                        {' '}
                        {entry.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="relative flex-1" style={{ minHeight: '300px' }}>
                {liveCodeEngine === 'Strudel' ? (
                  <StrudelEditor
                    key={unit.id}
                    unitId={unit.id}
                    initialCode={unit.strudelCode || DEFAULT_STRUDEL_CODE}
                    onCodeChange={handleCodeChange}
                    onEditorReady={handleEditorReady}
                  />
                ) : (
                  <ChuckEditor />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default UnitConfigPanel;