import React, { useState, useRef, useEffect } from 'react';
import { X, Code, Play, Square, RefreshCw, Bug } from 'lucide-react';
import StrudelEditor from './StrudelEditor';
import ChuckEditor from './ChuckEditor';
import { DEFAULT_STRUDEL_CODE } from '../constants';
import '@strudel/repl';
import { useStrudelPattern } from './useStrudelPattern';

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

const Slider = ({ label, value, onChange, min = 0, max = 1, step = 0.01, centered = false }) => {
  return (
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
};

const UnitConfigPanel = ({ unit, units, onClose, onUpdateUnit }) => {
  const [showDebugger, setShowDebugger] = useState(false);
  const {
    debugLog,
    applyPatternFromEditor,
    testPatternUpdate,
    clearDebugLog,
    startAll,
    stopAll
  } = useStrudelPattern(unit.id);

  const tabs = ['Unit', 'Sampler', 'Live Code'];
  const [activeTab, setActiveTab] = useState('Unit');
  const [liveCodeEngine, setLiveCodeEngine] = useState(unit.liveCodeEngine || 'Strudel');
  const editorRefs = useRef(new Map());

  // Update liveCodeEngine when unit changes
  useEffect(() => {
    setLiveCodeEngine(unit.liveCodeEngine || 'Strudel');
  }, [unit.id]);

  const handleValueChange = (key, value) => {
    onUpdateUnit(unit.id, { ...unit, [key]: value });
  };

  const handleEditorReady = (editor) => {
    console.log('editorRefs.current.get(unit.id)', editorRefs.current.get(unit.id));

    const shouldPopulateEditor = !editorRefs.current.get(unit.id);

    console.log(`Strudel editor ready for unit ${unit.id}`);
    editorRefs.current.set(unit.id, editor);


    if (shouldPopulateEditor) {
      
      // editor.setCode(Date.now().toString());
      console.log('editor.repl', editor.repl);
      // editor.repl.setPattern( note("c3", ["eb3", "g3"]).sound("sawtooth").delay(1) );
      const randomFastValue = Math.floor(Math.random() * 10) + 1; // Random integer between 1 and 10
      const waveforms = ["sawtooth", "square", "triangle", "sine"];
      const randomWaveform = waveforms[Math.floor(Math.random() * waveforms.length)];
      const code = `note("c2 <eb2 <g2 g1>>".fast(${randomFastValue})).sound("${randomWaveform}")`;
      editorRefs.current.get(unit.id).setCode( code );
      editor.repl.evaluate( code );
      // editor.repl.setCode(`note("c2 <eb2 <g2 g1>>".fast(2)).sound("<sawtooth square triangle sine>").delay(1)`);
      
      editor.repl.stop();

    }
  };

  const handlePatternUpdate = (patternId, updateInfo) => {
    console.log(`Pattern ${patternId} updated for unit ${updateInfo.unitId}:`, updateInfo);
  };

  const handleCodeChange = (newCode) => {
    console.log(`Handling code change for unit ${unit.id}:`, newCode);
    onUpdateUnit(unit.id, {
      ...unit,
      strudelCode: newCode
    });
  };

  const handleEngineChange = (engine) => {
    setLiveCodeEngine(engine);
    onUpdateUnit(unit.id, { ...unit, liveCodeEngine: engine });
  };

  const handleApplyPattern = () => {
    const newPattern = applyPatternFromEditor();
    if (newPattern) {
      onUpdateUnit(unit.id, {
        ...unit,
        strudelCode: newPattern
      });
    }
  };

  return (
    <div className="w-1/3 bg-gray-900/95 backdrop-blur border-l border-gray-800">
      {/* Header with tabs */}
      <div className="flex items-center border-b border-gray-800">
        <div className="flex-1 flex">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm ${activeTab === tab 
                ? 'bg-blue-900/30 text-white' 
                : 'text-gray-400 hover:text-white'}`}
            >
              {tab}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="p-2 text-gray-400 hover:text-white"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content area */}
      <div className="p-4">
        {activeTab === 'Unit' && (
          <>
            <CollapsibleSection title="Sequence">
              <Slider 
                label="Speed" 
                value={unit.speed || 0} 
                onChange={val => handleValueChange('speed', val)} 
                min={-2} 
                max={2} 
                centered={true}
              />
            </CollapsibleSection>
            
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
          {/* New Control Panel */}
          <div className="flex items-center gap-2 p-2 bg-gray-800/50 rounded">
            <button
              onClick={handleApplyPattern}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-sm flex items-center gap-1 text-xs"
            >
              <RefreshCw size={12} />
              Apply Changes
            </button>
            
            <button
              onClick={() => testPatternUpdate()}
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
              onClick={startAll}
              className="p-1.5 bg-green-600 text-white rounded-sm"
            >
              <Play size={14} />
            </button>
            
            <button
              onClick={stopAll}
              className="p-1.5 bg-red-600 text-white rounded-sm"
            >
              <Square size={14} />
            </button>
          </div>

          {/* Debug Panel */}
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

          {/* Editor */}
          <div className="relative flex-1" style={{ minHeight: '300px' }}>
            {liveCodeEngine === 'Strudel' && (
              <StrudelEditor
                key={unit.id}
                unitId={unit.id}
                initialCode={unit.strudelCode}
                onCodeChange={newCode => {
                  console.log(`Code change in unit ${unit.id}:`, newCode);
                }}
                onEditorReady={handleEditorReady}
              />
            )}
            {liveCodeEngine === 'ChucK' && <ChuckEditor />}
          </div>
        </div>

        )}
      </div>
    </div>
  );
};

export default UnitConfigPanel;