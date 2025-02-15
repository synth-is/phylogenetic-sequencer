import { Volume2, Plus } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { UNIT_TYPES } from '../constants';
import { TrajectoryUnit } from '../units/TrajectoryUnit';
import { SequencingUnit } from '../units/SequencingUnit';  // Add this import
import { CellDataFormatter } from '../utils/CellDataFormatter';
import { useUnits } from '../UnitsContext';

// Update Slider component to support centered visualization
const Slider = ({ label, value, onChange, onMouseUp, min = 0, max = 1, step = 0.01, centered = false }) => (
  <div className="space-y-1">
    <div className="flex justify-between text-xs">
      <span className="text-gray-300">{label}</span>
      <span className="text-gray-400">
        {centered ? ((value - 0.5) * 2).toFixed(2) : value.toFixed(2)}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value || 0}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      onMouseUp={onMouseUp}
      onTouchEnd={onMouseUp}
      className={`w-full h-1.5 rounded-sm appearance-none bg-gray-700 
        [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 
        [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:bg-blue-500 
        [&::-webkit-slider-thumb]:appearance-none`}
      style={centered ? {
        background: `linear-gradient(to right, #374151 50%, #374151 50%)`
      } : {}}
    />
  </div>
);

const UnitTypeSelector = ({ onSelect, onClose }) => (
  <div className="fixed bottom-16 left-4 right-4 mx-2 bg-gray-800 rounded-sm shadow-lg overflow-hidden z-50">
    {Object.values(UNIT_TYPES).map(type => (
      <button
        key={type}
        onClick={() => {
          onSelect(type);
          onClose();
        }}
        className="w-full p-2 text-left text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
      >
        {type}
      </button>
    ))}
  </div>
);

const UnitsPanel = ({ 
  units, 
  onPlaybackChange,
  selectedUnitId, 
  onSelectUnit, 
  onAddUnit, 
  onRemoveUnit,
  onToggleState,
  onUpdateVolume,
  onCellHover 
}) => {
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const { handleCellHover, updateUnitConfig } = useUnits();
  const unitsRef = useRef(new Map());

  // Handle unit config updates
  useEffect(() => {
    units.forEach(unit => {
      updateUnitConfig(unit.id, {
        active: unit.active,
        muted: unit.muted,
        soloed: unit.soloed,
        volume: unit.volume
      });
    });
  }, [units, updateUnitConfig]);

  // Initialize new units
  useEffect(() => {
    // Create new units first
    units.forEach(async unit => {
      if (!unitsRef.current.has(unit.id)) {
        console.log('Creating new unit:', {
          id: unit.id,
          type: unit.type,
          currentUnits: units.map(u => ({ id: u.id, type: u.type })),
          existingInstances: Array.from(unitsRef.current.entries()).map(([id, instance]) => ({
            id,
            type: instance.type,
            hasTrajectories: instance.trajectories?.size > 0
          }))
        });

        let unitInstance;
        if (unit.type === UNIT_TYPES.TRAJECTORY) {
          unitInstance = new TrajectoryUnit(unit.id);
          await unitInstance.initialize();
          unitsRef.current.set(unit.id, unitInstance);
          
          // Initialize trajectory state immediately for new trajectory units
          setTrajectoryStates(prev => {
            const newState = new Map(prev);
            newState.set(unit.id, []);  // Set empty trajectories array
            return newState;
          });
          
          setRecordingStatus(prev => ({
            ...prev,
            [unit.id]: false  // Initialize recording status
          }));
        } else if (unit.type === UNIT_TYPES.SEQUENCING) {
          unitInstance = new SequencingUnit(unit.id);
          await unitInstance.initialize();
          unitsRef.current.set(unit.id, unitInstance);
        }
      }
    });

    // Update existing units' configuration
    units.forEach(unit => {
      const unitInstance = unitsRef.current.get(unit.id);
      if (unitInstance) {
        unitInstance.updateConfig?.(unit);
      }
    });

    // Find units to clean up
    const currentIds = Array.from(unitsRef.current.keys());
    const newIds = units.map(u => u.id);
    const idsToRemove = currentIds.filter(id => !newIds.includes(id));

    // Clean up removed units before reindexing
    idsToRemove.forEach(id => {
      const unitInstance = unitsRef.current.get(id);
      console.log('UnitsPanel: About to clean up unit:', {
        id,
        type: unitInstance.type,
        currentTrajectories: Array.from(unitInstance.trajectories?.entries() || []).map(([trajId, traj]) => ({
          id: trajId,
          isPlaying: traj.isPlaying,
          eventCount: traj.events?.length
        })),
        activeSignals: Array.from(unitInstance.activeTrajectorySignals?.keys() || []),
        allCurrentUnits: Array.from(unitsRef.current.keys()),
        newUnitIds: newIds
      });

      unitInstance.cleanup();
      unitsRef.current.delete(id);

      console.log('UnitsPanel: Unit cleanup complete:', {
        id,
        remainingUnits: Array.from(unitsRef.current.keys())
      });
    });
  }, [units]);

  // Keep only ONE hover handler - This is the only useEffect we need for hover events
  useEffect(() => {
    if (!selectedUnitId || !onCellHover) {
      console.log('UnitsPanel bail conditions:', {
        noSelectedUnit: !selectedUnitId,
        noHoverData: !onCellHover
      });
      return;
    }
  
    const formattedData = CellDataFormatter.formatCellData(
      onCellHover.data,
      onCellHover.experiment,
      onCellHover.evoRunId,
      onCellHover.config
    );
  
    if (formattedData) {
      const unit = unitsRef.current.get(selectedUnitId);
      if (!unit) return;
  
      console.log('Processing cell hover:', {
        unitType: unit.type,
        addToSequence: onCellHover.config?.addToSequence,
        formattedData
      });

      if (unit.type === UNIT_TYPES.TRAJECTORY) {
        unit.handleCellHover(formattedData);
      } else if (unit.type === UNIT_TYPES.SEQUENCING && onCellHover.config?.addToSequence) {
        console.log('Toggling sequence item for unit:', selectedUnitId);
        unit.toggleSequenceItem(formattedData);
        forceSequenceUpdate(selectedUnitId); // Force UI update after sequence change
      }
    }
  }, [selectedUnitId, onCellHover]);

  // Add new state for trajectory recording status
  const [recordingStatus, setRecordingStatus] = useState({});

  // Add state to track trajectory UIs independent of hover events
  const [trajectoryStates, setTrajectoryStates] = useState(new Map());

  // Force UI updates for trajectory controls
  const forceTrajectoryUpdate = (unitId) => {
    const trajectoryUnit = unitsRef.current.get(unitId);
    if (!trajectoryUnit) return;

    // Create a snapshot of current trajectory states
    const trajectories = Array.from(trajectoryUnit.trajectories.entries()).map(
      ([id, traj]) => ({
        id,
        isPlaying: traj.isPlaying
      })
    );

    setTrajectoryStates(prev => new Map(prev).set(unitId, trajectories));
  };

  // Initialize trajectory states when units are created
  useEffect(() => {
    units.forEach(unit => {
      if (unit.type === UNIT_TYPES.TRAJECTORY) {
        forceTrajectoryUpdate(unit.id);
      }
    });
  }, [units]);

  // Add keyboard shortcut handler
  useEffect(() => {
    const handleKeyPress = (e) => {
      // Only trigger if a unit is selected and key isn't pressed in an input
      if (!selectedUnitId || e.target.tagName === 'INPUT') return;
      
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        const trajectoryUnit = unitsRef.current.get(selectedUnitId);
        if (!trajectoryUnit) return;

        const isRecording = recordingStatus[selectedUnitId];
        if (!isRecording) {
          const trajectoryId = trajectoryUnit.startTrajectoryRecording();
          setRecordingStatus(prev => ({ ...prev, [selectedUnitId]: true }));
          forceTrajectoryUpdate(selectedUnitId);
        } else {
          trajectoryUnit.stopTrajectoryRecording();
          setRecordingStatus(prev => ({ ...prev, [selectedUnitId]: false }));
          forceTrajectoryUpdate(selectedUnitId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [selectedUnitId, recordingStatus]);

  const TrajectoryEventParams = ({ event, onUpdate }) => {
    // Add state to track dragging values
    const [dragValues, setDragValues] = useState({
      offset: event.offset,
      playbackRate: event.playbackRate || 1,
      startOffset: event.startOffset || 0,
      stopOffset: event.stopOffset || 0
    });

    // Handle update when dragging stops
    const handleDragEnd = (param, value) => {
      onUpdate({ [param]: value });
    };

    return (
      <div className="pt-2 space-y-2">
        <Slider 
          label="Position"
          min={0}
          max={1}
          step={0.01}
          value={dragValues.offset}
          onChange={val => {
            setDragValues(prev => ({ ...prev, offset: val }));
          }}
          onMouseUp={() => handleDragEnd('offset', dragValues.offset)}
          centered={true}
        />
        
        <Slider 
          label="Playback Rate"
          min={0.25}
          max={4}
          step={0.25}
          value={dragValues.playbackRate}
          onChange={val => {
            setDragValues(prev => ({ ...prev, playbackRate: val }));
          }}
          onMouseUp={() => handleDragEnd('playbackRate', dragValues.playbackRate)}
        />
        
        <Slider 
          label="Start Offset"
          min={0}
          max={1}
          step={0.01}
          value={dragValues.startOffset}
          onChange={val => {
            setDragValues(prev => ({ ...prev, startOffset: val }));
          }}
          onMouseUp={() => handleDragEnd('startOffset', dragValues.startOffset)}
        />
        
        <Slider 
          label="Stop Offset"
          min={0}
          max={1}
          step={0.01}
          value={dragValues.stopOffset}
          onChange={val => {
            setDragValues(prev => ({ ...prev, stopOffset: val }));
          }}
          onMouseUp={() => handleDragEnd('stopOffset', dragValues.stopOffset)}
        />
      </div>
    );
  };

  const renderTrajectoryControls = (unit) => {
    if (unit.type !== UNIT_TYPES.TRAJECTORY) return null;
  
    const trajectoryUnit = unitsRef.current.get(unit.id);
    if (!trajectoryUnit) return null;
  
    const isRecording = recordingStatus[unit.id];
    const trajectories = trajectoryStates.get(unit.id) || [];
  
    return (
      <div className="mt-2 space-y-2">
        <div className="flex gap-2">
          <button
            onClick={() => {
              if (!isRecording) {
                const trajectoryId = trajectoryUnit.startTrajectoryRecording();
                setRecordingStatus(prev => ({ ...prev, [unit.id]: true }));
                forceTrajectoryUpdate(unit.id);
              } else {
                trajectoryUnit.stopTrajectoryRecording();
                setRecordingStatus(prev => ({ ...prev, [unit.id]: false }));
                forceTrajectoryUpdate(unit.id);
              }
            }}
            className={`px-2 py-1 text-xs rounded ${
              isRecording 
                ? 'bg-red-600 text-white' 
                : 'bg-blue-600 text-white'
            }`}
          >
            {isRecording ? '(S)top Recording Trajectory' : '(S)tart Recording Trajectory'}
          </button>
        </div>
  
        {/* Render trajectory list */}
        <div className="space-y-1">
          {trajectories.map(({ id: trajectoryId, isPlaying }) => (
            <div key={trajectoryId}>
              <div className="flex items-center gap-2 px-2 py-1 bg-gray-700/50 rounded-sm">
                <span className="text-xs text-gray-300">
                  Trajectory {String(trajectoryId).slice(-4)}
                </span>
                <button
                  onClick={() => {
                    if (isPlaying) {
                      trajectoryUnit.stopTrajectory(trajectoryId);
                    } else {
                      trajectoryUnit.playTrajectory(trajectoryId);
                    }
                    forceTrajectoryUpdate(unit.id);
                  }}
                  className={`px-1.5 py-0.5 text-xs rounded ${
                    isPlaying
                      ? 'bg-yellow-600 text-white'
                      : 'bg-gray-600 text-gray-300'
                  }`}
                >
                  {isPlaying ? 'Stop' : 'Play'}
                </button>
                <button
                  onClick={() => {
                    trajectoryUnit.removeTrajectory(trajectoryId);
                    forceTrajectoryUpdate(unit.id);
                  }}
                  className="px-1.5 py-0.5 text-xs rounded bg-red-600/50 text-white hover:bg-red-600"
                >
                  Remove
                </button>
                <button
                  onClick={() => {
                    const element = document.querySelector(`#trajectory-${trajectoryId}-events`);
                    element.style.display = element.style.display === 'none' ? 'block' : 'none';
                  }}
                  className="p-1 text-xs bg-gray-600/50 hover:bg-gray-600 text-white rounded"
                >
                  {/* You can use a chevron icon here */}
                  ▼
                </button>
              </div>
  
              {/* Add collapsible events section */}
              <div 
                id={`trajectory-${trajectoryId}-events`}
                className="ml-4 mt-1 space-y-2"
                style={{ display: 'none' }}
              >
                {trajectoryUnit.trajectories.get(trajectoryId)?.events
                  ?.filter(event => event?.cellData)
                  ?.map((event, index) => (
                    <div 
                      key={index}
                      className="bg-gray-700/50 rounded-sm p-2 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-300">
                          {event.cellData.genomeId.slice(-6)} at {event.time.toFixed(2)}s
                        </span>
                      </div>
                      
                      <details className="text-xs">
                        <summary className="cursor-pointer text-gray-300">
                          Parameters
                        </summary>
                        <TrajectoryEventParams
                          event={event}
                          onUpdate={updates => {
                            trajectoryUnit.updateTrajectoryEvent(trajectoryId, index, updates);
                            forceTrajectoryUpdate(unit.id);
                          }}
                        />
                      </details>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Add state for sequence updates
  const [sequenceStates, setSequenceStates] = useState(new Map());

  // Add function to force sequence UI updates
  const forceSequenceUpdate = (unitId) => {
    const sequencingUnit = unitsRef.current.get(unitId);
    if (!sequencingUnit || sequencingUnit.type !== UNIT_TYPES.SEQUENCING) return;

    setSequenceStates(prev => new Map(prev).set(unitId, {
      isPlaying: sequencingUnit.isPlaying,
      sequence: [...sequencingUnit.activeSequence] // Create new array to force re-render
    }));
  };

  // Modify the renderSequenceControls function
  const renderSequenceControls = (unit) => {
    if (unit.type !== UNIT_TYPES.SEQUENCING) return null;
  
    const sequencingUnit = unitsRef.current.get(unit.id);
    if (!sequencingUnit) return null;

    // Get state from our sequenceStates or use unit's current state
    const currentState = sequenceStates.get(unit.id) || {
      isPlaying: sequencingUnit.isPlaying,
      sequence: sequencingUnit.activeSequence
    };

    const groupedSequence = sequencingUnit.getGroupedSequence();
  
    return (
      <div className="mt-2 space-y-2">
        {groupedSequence.map(group => (
          <div 
            key={group.offset}
            onClick={() => {
              sequencingUnit.selectTimestep(group.offset);
              forceSequenceUpdate(unit.id);
            }}
            className={`border-l-2 pl-2 space-y-2 cursor-pointer transition-colors ${
              group.isSelected 
                ? 'border-blue-500 bg-blue-500/10' 
                : 'border-gray-700 hover:border-blue-500/50 hover:bg-blue-500/5'
            }`}
          >
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <span className="text-xs text-gray-400">
                  Time: {group.offset.toFixed(2)}
                </span>
                <span className="text-xs text-gray-500 ml-2">
                  ({group.items.length} sound{group.items.length !== 1 ? 's' : ''})
                </span>
              </div>
              <span className="text-xs text-gray-500">
                {group.isSelected ? 'Click to deselect' : 'Click to select'}
              </span>
            </div>
  
            {/* Render individual items in group */}
            {group.items.map(item => (
              <div 
                key={item.genomeId}
                className="bg-gray-700/50 rounded-sm p-2 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-300">
                    {item.genomeId.slice(-6)}
                  </span>
                  <button
                    onClick={() => {
                      sequencingUnit.removeSequenceItem(item.genomeId);
                      forceSequenceUpdate(unit.id);
                    }}
                    className="p-1 text-xs bg-red-600/50 hover:bg-red-600 text-white rounded"
                  >
                    ×
                  </button>
                </div>
                
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-300">
                    Parameters
                  </summary>
                  <div className="pt-2 space-y-2">
                    <Slider 
                      label="Offset"
                      min={0}
                      max={1}
                      step={0.01}
                      value={item.offset}
                      onChange={val => {
                        sequencingUnit.updateSequenceItem(item.genomeId, { offset: val });
                        forceSequenceUpdate(unit.id); // Add this line
                      }}
                      centered={true}  // Add this prop
                    />
                    
                    <Slider 
                      label="Duration"
                      min={0.1}
                      max={4}
                      step={0.1}
                      value={item.durationScale}
                      onChange={val => {
                        sequencingUnit.updateSequenceItem(item.genomeId, { durationScale: val });
                        forceSequenceUpdate(unit.id); // Add this line
                      }}
                    />
                    
                    <Slider 
                      label="Pitch"
                      min={-12}
                      max={12}
                      step={1}
                      value={item.pitchShift}
                      onChange={val => {
                        sequencingUnit.updateSequenceItem(item.genomeId, { pitchShift: val });
                        forceSequenceUpdate(unit.id); // Add this line
                      }}
                    />
                    
                    <Slider 
                      label="Stretch"
                      min={0.25}
                      max={4}
                      step={0.25}
                      value={item.stretch}
                      onChange={val => {
                        sequencingUnit.updateSequenceItem(item.genomeId, { stretch: val });
                        forceSequenceUpdate(unit.id); // Add this line
                      }}
                    />
                  </div>
                </details>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  // Update effect to initialize sequence states
  useEffect(() => {
    units.forEach(unit => {
      if (unit.type === UNIT_TYPES.SEQUENCING) {
        forceSequenceUpdate(unit.id);
      }
    });
  }, [units]);

  const handleRemoveUnit = (e, unitId) => {
    e.stopPropagation();
    console.log('UnitsPanel: Remove unit clicked:', {
      unitId,
      currentUnits: units.map(u => ({ id: u.id, type: u.type })),
      unitToRemove: unitsRef.current.get(unitId),
      unitInstances: Array.from(unitsRef.current.entries()).map(([id, unit]) => ({
        id,
        type: unit.type,
        hasTrajectories: unit.trajectories?.size > 0,
        activeTrajectories: Array.from(unit.trajectories?.entries() || []).map(([trajId, traj]) => ({
          id: trajId,
          isPlaying: traj.isPlaying
        }))
      }))
    });
    onRemoveUnit(unitId);
  };

  // Add function to get display number for a unit
  const getDisplayNumber = (unit) => {
    // Sort units by ID (timestamp) and find index
    const sortedUnits = [...units].sort((a, b) => a.id - b.id);
    return sortedUnits.findIndex(u => u.id === unit.id) + 1;
  };

  // Add helper for exclusive soloing
  const handleSoloToggle = (e, unitId) => {
    e.stopPropagation();
    
    // First update UI state and immediately update audio engine for all units
    units.forEach(unit => {
      if (unit.id !== unitId && unit.soloed) {
        onToggleState(unit.id, 'soloed');
        updateUnitConfig(unit.id, {
          ...unit,
          soloed: false
        });
      }
    });

    // Then toggle solo for clicked unit and immediately update its audio engine state
    const unit = units.find(u => u.id === unitId);
    const newSoloState = !unit.soloed;
    onToggleState(unitId, 'soloed');
    updateUnitConfig(unitId, {
      ...unit,
      soloed: newSoloState
    });
  };

  const handleActiveToggle = (e, unit) => {
    e.stopPropagation();
    // First update the UI state
    onToggleState(unit.id, 'active');
    
    // Immediately update the audio engine
    updateUnitConfig(unit.id, {
      ...unit,
      active: !unit.active
    });

    // For SequencingUnit, also toggle playback
    const sequencingUnit = unitsRef.current.get(unit.id);
    if (sequencingUnit?.type === UNIT_TYPES.SEQUENCING) {
      sequencingUnit.togglePlayback();
    }
  };

  return (
    <div className="h-fit max-h-[calc(100vh-5rem)] bg-gray-900/95 backdrop-blur border-r border-gray-800 overflow-y-auto">
      <div className="p-2 flex flex-col gap-2 min-w-[16rem]">
        {/* Units list container with minimum height */}
        <div className="min-h-[100px] flex flex-col gap-2">
          {units.map(unit => (
            <div 
              key={unit.id}
              onClick={() => onSelectUnit(unit.id)}
              className={`bg-gray-800/50 rounded-sm p-2 cursor-pointer select-none transition-all
                ${selectedUnitId === unit.id ? 'ring-1 ring-blue-500' : ''}`}
            >
              {/* Controls */}
              <div className="pointer-events-none flex flex-col gap-2">
                <div className="flex items-center gap-1.5 pointer-events-auto">
                  <button
                    onClick={(e) => handleActiveToggle(e, unit)}
                    className={`w-6 h-6 rounded-sm text-sm flex items-center justify-center ${unit.active 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-700 text-gray-400'}`}
                  >
                    {getDisplayNumber(unit)} {/* Replace unit.id with getDisplayNumber(unit) */}
                  </button>
                  
                  <button
                    onClick={(e) => handleSoloToggle(e, unit.id)}
                    className={`w-6 h-6 rounded-sm text-xs font-medium flex items-center justify-center ${unit.soloed 
                      ? 'bg-yellow-600 text-white' 
                      : 'bg-gray-700 text-gray-400'}`}
                  >
                    S
                  </button>
                  
                  <Volume2 size={14} className="text-gray-400" />
                  
                  <button
                    onClick={(e) => handleRemoveUnit(e, unit.id)}
                    className="ml-auto w-6 h-6 rounded-sm text-xs font-medium bg-gray-700 hover:bg-red-600 text-gray-400 hover:text-white transition-colors flex items-center justify-center"
                  >
                    X
                  </button>
                </div>
                
                <div className="flex flex-col gap-0.5 pointer-events-auto">
                  <input
                    type="range"
                    min="-60"
                    max="0"
                    value={unit.volume}
                    onClick={e => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      onUpdateVolume(unit.id, Number(e.target.value));
                    }}
                    className="w-full h-1.5 rounded-sm appearance-none bg-gray-700 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:appearance-none"
                  />
                  <div className="text-xs text-gray-400 flex justify-between">
                    <span className="text-gray-500">{unit.type}</span>
                    <span>{unit.volume} dB</span>
                  </div>
                </div>
              </div>
              {unit.id === selectedUnitId && (
                <>
                  {renderTrajectoryControls(unit)}
                  {unit.type === UNIT_TYPES.SEQUENCING && renderSequenceControls(unit)}
                </>
              )}
            </div>
          ))}
        </div>
        
        {/* Move Add Unit button outside of scrollable area */}
        <div className="sticky bottom-0 bg-gray-900/95 pt-2">
          <div className="panel-footer relative">
            <button
              onClick={() => setShowTypeSelector(!showTypeSelector)}
              className="w-full p-1.5 rounded-sm bg-gray-800/50 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors flex items-center justify-center gap-1 text-sm"
            >
              <Plus size={14} />
              Add Unit
            </button>
            
            {showTypeSelector && (
              <UnitTypeSelector 
                onSelect={onAddUnit}
                onClose={() => setShowTypeSelector(false)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnitsPanel;