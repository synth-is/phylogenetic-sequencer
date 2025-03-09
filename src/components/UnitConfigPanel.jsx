import React, { useState, useRef, useEffect } from 'react';
import { X, Code, Play, Square, RefreshCw, Bug, ChevronUp, ChevronDown } from 'lucide-react';
import StrudelEditor from './StrudelEditor';
import ChuckEditor from './ChuckEditor';
import { DEFAULT_STRUDEL_CODE, UNIT_TYPES } from '../constants';
import '@strudel/repl';
import { useStrudelPattern } from './useStrudelPattern';
import { useUnits } from '../UnitsContext'; // Add this import for useUnits

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

const TreeInfoSection = ({ unit, treeData, unitInstance }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { unitsRef } = useUnits(); // Now this will work because of the import
  
  // Add debug logging to check unitInstance
  console.log('TreeInfoSection props:', { 
    unit, 
    unitType: unit.type,
    unitId: unit.id,
    hasTreeData: !!treeData,
    hasUnitInstance: !!unitInstance,
    unitInstanceType: unitInstance?.type
  });
  
  // Try to get instance from context if not provided directly
  const actualInstance = unitInstance || (unitsRef?.current?.get(unit.id));
  
  // Now use the instance (either passed in or from context)
  const isSequencingUnit = unit.type === UNIT_TYPES.SEQUENCING && actualInstance;
  
  // Add function to manually analyze tree data and sequence
  const analyzeTreeData = () => {
    if (!treeData || !actualInstance?.activeSequence?.length) return;
    
    console.log('Analyzing Tree Data Structure:', {
      hasTreesArray: Array.isArray(treeData.trees),
      treesLength: treeData.trees?.length,
      hasNodesArray: Array.isArray(treeData.nodes),
      nodesLength: treeData.nodes?.length,
      hasEdgesArray: Array.isArray(treeData.edges),
      edgesLength: treeData.edges?.length,
      hasRootNodes: Boolean(treeData.rootNodes),
      rootNodesCount: Array.isArray(treeData.rootNodes) ? treeData.rootNodes.length : (treeData.rootNodes ? 1 : 0),
      sampleNodeIds: treeData.nodes?.slice(0, 3).map(n => n.id),
      childCount: treeData.children?.length,
      cachedTreeCount: window._treeUtilsCache?.identifiedTreesCount
    });
    
    console.log('Sample sequence items:', actualInstance.activeSequence.slice(0, 3));
    
    // Try to find genome in different ways
    const firstGenomeId = actualInstance.activeSequence[0]?.genomeId;
    if (firstGenomeId && treeData.nodes) {
      // Look for matching node
      const matchingNode = treeData.nodes.find(n => 
        n.id === firstGenomeId || n.id.includes(firstGenomeId)
      );
      console.log('Direct node match search result:', {
        genomeId: firstGenomeId,
        matchFound: !!matchingNode,
        matchingNode
      });
      
      // Check edges
      if (treeData.edges) {
        const edgesWithGenome = treeData.edges.filter(edge => 
          edge.source === firstGenomeId || 
          edge.target === firstGenomeId ||
          edge.source.includes(firstGenomeId) ||
          edge.target.includes(firstGenomeId)
        );
        
        console.log('Direct edge match search result:', {
          genomeId: firstGenomeId,
          edgesFound: edgesWithGenome.length,
          sampleEdges: edgesWithGenome.slice(0, 2)
        });
      }
    }
  };
  
  // Early return with helpful debug info if no unitInstance
  if (!actualInstance) {
    console.warn(`TreeInfoSection: No unitInstance provided for unit ${unit.id} (type: ${unit.type})`);
    
    // For debugging, log what instances are available in the context
    if (unitsRef && unitsRef.current) {
      const availableIds = Array.from(unitsRef.current.keys());
      console.log('Available unit instances:', availableIds);
    }
    
    if (unit.type === UNIT_TYPES.SEQUENCING) {
      return (
        <CollapsibleSection title="Tree Information">
          <div className="text-sm text-yellow-500 p-2 bg-yellow-900/20 rounded">
            Tree information unavailable. Missing unit instance reference.
          </div>
        </CollapsibleSection>
      );
    }
    return null;
  }
  
  // Get tree statistics - with additional null checks
  const treeStats = isSequencingUnit && typeof actualInstance.getTreeStatistics === 'function' 
    ? actualInstance.getTreeStatistics() 
    : { treesRepresented: 0, treeCount: 0 };
  
  // Check for actual sequence data
  if (!isSequencingUnit || !actualInstance.activeSequence?.length) {
    return unit.type === UNIT_TYPES.SEQUENCING ? (
      <CollapsibleSection title="Tree Information">
        <div className="space-y-2 text-sm text-gray-400">
          <p>No sequence items added yet.</p>
          <p>Click on nodes in the tree to add them to the sequence.</p>
        </div>
      </CollapsibleSection>
    ) : null;
  }

  // Group items by tree for better display
  const treeGroups = {};
  const voices = actualInstance.activeSequence || [];
  
  voices.forEach((item, index) => {
    const treeIndex = item.treeInfo?.treeIndex !== undefined ? item.treeInfo.treeIndex : 'unknown';
    const treeId = item.treeInfo?.treeId || 'Unknown';
    const groupKey = `${treeIndex}`;
    
    if (!treeGroups[groupKey]) {
      treeGroups[groupKey] = {
        treeIndex,
        treeId,
        items: []
      };
    }
    
    treeGroups[groupKey].items.push({
      index,
      genomeId: item.genomeId,
      shortId: item.genomeId?.slice(-6) || 'unknown',
      treeInfo: item.treeInfo
    });
  });
  
  const sortedTreeGroups = Object.values(treeGroups).sort((a, b) => {
    if (a.treeIndex === 'unknown') return 1;
    if (b.treeIndex === 'unknown') return -1;
    return a.treeIndex - b.treeIndex;
  });

  return (
    <CollapsibleSection title="Tree Information">
      <div className="space-y-2 text-sm text-gray-300">
        <div className="flex justify-between items-center">
          <div>
            <span className="text-blue-400 font-medium">
              {treeStats.treesRepresented}/{treeStats.treeCount}
            </span> trees represented
            {window._treeUtilsCache?.identifiedTreesCount && treeStats.treeCount !== window._treeUtilsCache.identifiedTreesCount && (
              <span className="ml-1 text-yellow-500">
                (detected: {window._treeUtilsCache.identifiedTreesCount})
              </span>
            )}
          </div>
          <div className="flex gap-1">
            <button 
              onClick={() => {
                analyzeTreeData();
              }}
              className="px-2 py-1 bg-purple-600/30 hover:bg-purple-600/50 text-xs text-white rounded"
            >
              Debug
            </button>
            <button 
              onClick={() => {
                actualInstance.debugPrintTreeInfo();
                // Update tree information if we have tree data
                if (treeData) {
                  actualInstance.updateTreeInformation(treeData);
                }
              }}
              className="px-2 py-1 bg-blue-600/30 hover:bg-blue-600/50 text-xs text-white rounded"
            >
              Update Tree Info
            </button>
          </div>
        </div>
        
        {/* Tree distribution overview */}
        <div className="bg-gray-800/50 p-2 rounded space-y-2">
          <h4 className="text-xs font-medium text-gray-300">Tree Distribution</h4>
          <div className="space-y-1">
            {sortedTreeGroups.map(group => (
              <details key={group.treeIndex} className="text-xs">
                <summary className="cursor-pointer flex justify-between items-center p-1 hover:bg-gray-700/30">
                  <span className={group.treeIndex === 'unknown' ? 'text-red-400' : 'text-blue-400'}>
                    {group.treeIndex === 'unknown' ? 'Unknown Tree' : `Tree ${parseInt(group.treeIndex) + 1}`}
                    {group.treeId && group.treeIndex !== 'unknown' && ` (${group.treeId})`}
                  </span>
                  <span className="text-gray-400">{group.items.length} voices</span>
                </summary>
                <div className="ml-4 mt-1 space-y-0.5">
                  {group.items.map(item => (
                    <div key={item.index} className="text-gray-400">
                      Voice {item.index + 1}: {item.shortId}
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>
      </div>
    </CollapsibleSection>
  );
};

export default function UnitConfigPanel({ unit, units, onClose, onUpdateUnit, treeData, unitInstance }) {
  // Add debug logging to check unitInstance in the parent component
  console.log('UnitConfigPanel props:', { 
    unit, 
    unitType: unit.type,
    unitId: unit.id,
    hasTreeData: !!treeData,
    hasUnitInstance: !!unitInstance,
    unitInstanceType: unitInstance?.type
  });
  
  // Try to get instance from window.getUnitInstance if needed
  const actualInstance = unitInstance || (window.getUnitInstance ? window.getUnitInstance(unit.id) : null);
  
  // Add logging to check if we found an instance
  console.log('UnitConfigPanel actual instance:', { 
    unitId: unit.id,
    hasDirectInstance: !!unitInstance,
    hasWindowInstance: !!(window.getUnitInstance && window.getUnitInstance(unit.id)),
    resolvedInstance: !!actualInstance
  });

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
    // For evolution parameters, ensure they're between 0 and 1
    if (['grow', 'shrink', 'mutate', 'probNewTree'].includes(key)) {
      value = Math.max(0, Math.min(1, value));
    }
    
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

  // Add useEffect to automatically update tree information when panel opens
  useEffect(() => {
    // When a sequencing unit is selected and tree data is available
    if (unit.type === UNIT_TYPES.SEQUENCING && treeData && actualInstance) {
      console.log('UnitConfigPanel: Automatically updating tree information on panel open');
      actualInstance.updateTreeInformation(treeData);
      
      // Set up a callback for meta-mutations to update UI values
      // This ensures UI sliders update when parameters evolve autonomously
      actualInstance.onConfigChange(updatedConfig => {
        console.log('Meta-mutation occurred, updating UI:', updatedConfig);
        
        // For each changed parameter, update the unit config
        const newConfig = { ...unit }; // Create a new copy to avoid mutation issues
        
        Object.entries(updatedConfig).forEach(([param, value]) => {
          newConfig[param] = value;
        });
        
        // Update the unit with all changed parameters at once
        onUpdateUnit(unit.id, newConfig);
      });
    }
    
    // Cleanup function to remove callback when component unmounts
    return () => {
      if (actualInstance && actualInstance.onConfigChange) {
        // Remove callback by setting it to null
        actualInstance.onConfigChange(null);
      }
    };
  }, [unit.id, unit.type, treeData, actualInstance, onUpdateUnit]);

  return (
    <div className="fixed right-4 top-16 z-50 bg-gray-900/95 backdrop-blur border border-gray-800 rounded-lg shadow-xl w-80 flex flex-col max-h-[calc(100vh-5rem)]">
      {/* Header - Always visible */}
      <div className="flex items-center border-b border-gray-800 p-2 shrink-0">
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

      {/* Main content area - Scrollable */}
      <div 
        className={`transition-all duration-200 overflow-hidden ${
          isCollapsed ? 'max-h-0' : 'flex-1 overflow-y-auto'
        }`}
      >
        <div className="p-4">
          {activeTab === 'Unit' && (
            <>
              {/* Show Playback section for both TrajectoryUnit and LoopingUnit */}
              {(unit.type === UNIT_TYPES.TRAJECTORY || unit.type === UNIT_TYPES.LOOPING) && (
                <CollapsibleSection title="Playback">
                  <div className="space-y-2">
                    <Slider 
                      label="Pitch" 
                      value={unit.pitch || 0} 
                      onChange={val => handleValueChange('pitch', val)} 
                      min={-12} 
                      max={12} 
                      centered={true}
                    />
                    <Slider 
                      label="Max Voices" 
                      value={unit.maxVoices || 4} 
                      onChange={val => handleValueChange('maxVoices', val)} 
                      min={1} 
                      max={8} 
                      step={1}
                    />
                  </div>
                </CollapsibleSection>
              )}

              {unit.type === UNIT_TYPES.SEQUENCING && (
                <CollapsibleSection title="Playback">
                  <div className="space-y-2">
                    <Slider 
                      label="Pitch" 
                      value={unit.pitch || 0} 
                      onChange={val => handleValueChange('pitch', val)} 
                      min={-12} 
                      max={12} 
                      centered={true}
                    />
                  </div>
                </CollapsibleSection>
              )}

              {/* Only show Evolution section when a SequencingUnit is selected */}
              {unit.type === UNIT_TYPES.SEQUENCING && (
                <CollapsibleSection title="Evolution">
                  <Slider 
                    label="Grow" 
                    value={unit.grow || 0} 
                    onChange={val => handleValueChange('grow', val)} 
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <Slider 
                    label="Shrink" 
                    value={unit.shrink || 0} 
                    onChange={val => handleValueChange('shrink', val)} 
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <Slider 
                    label="Mutate" 
                    value={unit.mutate || 0} 
                    onChange={val => handleValueChange('mutate', val)} 
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <Slider 
                    label="Mutate Position" 
                    value={unit.mutatePosition || 0} 
                    onChange={val => handleValueChange('mutatePosition', val)} 
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <Slider 
                    label="Prob. New Tree" 
                    value={unit.probNewTree || 0} 
                    onChange={val => handleValueChange('probNewTree', val)} 
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <div className="border-t border-blue-800/30 my-2 pt-2">
                    <Slider 
                      label="Meta-Mutation" 
                      value={unit.metaMutate || 0} 
                      onChange={val => handleValueChange('metaMutate', val)} 
                      min={0}
                      max={1}
                      step={0.01}
                    />
                    <div className="mt-1 text-xs text-gray-400 italic">
                      Controls probability of evolution parameters evolving over time
                    </div>
                  </div>
                </CollapsibleSection>
              )}
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
              
              {/* Add Tree Information Section with unitInstance prop */}
              <TreeInfoSection unit={unit} treeData={treeData} unitInstance={actualInstance} />
            </>
          )}

          {activeTab === 'Sampler' && (
            <>
              {/* Remove Sample section */}

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
}