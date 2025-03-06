import { Volume2, Plus, Loader2 } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { UNIT_TYPES } from '../constants';
import { TrajectoryUnit } from '../units/TrajectoryUnit';
import { SequencingUnit } from '../units/SequencingUnit';  // Add this import
import { LoopingUnit } from '../units/LoopingUnit';
import { CellDataFormatter } from '../utils/CellDataFormatter';
import { useUnits } from '../UnitsContext';

// Enhanced Slider component to show default value markers
const Slider = ({ 
  label, 
  value, 
  onChange,
  onMouseUp, 
  min = 0, 
  max = 1, 
  step = 0.01, 
  centered = false,
  defaultValue = null // Add defaultValue prop
}) => {
  // Keep track of dragging state
  const [isDragging, setIsDragging] = useState(false);

  // Event handlers
  const handleChange = (e) => {
    const newValue = parseFloat(e.target.value);
    onChange(newValue);
  };

  const handleMouseDown = () => {
    setIsDragging(true);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    if (onMouseUp) onMouseUp();
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-400">
          {centered ? ((value - 0.5) * 2).toFixed(2) : value.toFixed(2)}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value || 0}
          onChange={handleChange}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchEnd={handleMouseUp}
          className={`w-full h-1.5 rounded-sm appearance-none bg-gray-700 
            [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 
            [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:bg-blue-500 
            [&::-webkit-slider-thumb]:appearance-none
            ${isDragging ? 'ring-1 ring-blue-500' : ''}`}
          style={centered ? {
            background: `linear-gradient(to right, #374151 50%, #374151 50%)`
          } : {}}
        />
        {/* Default value marker */}
        {defaultValue !== null && (
          <div 
            className="absolute top-0 w-0.5 h-3 bg-yellow-400"
            style={{
              left: `${((defaultValue - min) / (max - min)) * 100}%`,
              transform: 'translateX(-50%)',
              pointerEvents: 'none'
            }}
          />
        )}
      </div>
    </div>
  );
};

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

// Add a new RenderingSpinner component for visual feedback during rendering
const RenderingSpinner = () => (
  <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 rounded z-10">
    <Loader2 size={20} className="text-blue-500 animate-spin" />
  </div>
);

export default function UnitsPanel({ 
  units, 
  onPlaybackChange,
  selectedUnitId, 
  onSelectUnit, 
  onAddUnit, 
  onRemoveUnit,
  onToggleState,
  onUpdateVolume,
  onCellHover,
  onUpdateUnit 
}) {
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
        } else if (unit.type === UNIT_TYPES.LOOPING) {
          unitInstance = new LoopingUnit(unit.id);
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
      } else if (unit.type === UNIT_TYPES.SEQUENCING) {
        // Check if this is a click (addToSequence) or just a hover
        if (onCellHover.config?.addToSequence) {
          console.log('Adding to sequence:', formattedData);
          unit.toggleSequenceItem(formattedData);
          forceSequenceUpdate(selectedUnitId);
        }
      } else if (unit.type === UNIT_TYPES.LOOPING) {
        unit.handleCellHover(formattedData);
      }
    }
  }, [selectedUnitId, onCellHover]);

  // Add new state for trajectory recording status
  const [recordingStatus, setRecordingStatus] = useState({});

  // Add state to track trajectory UIs independent of hover events
  const [trajectoryStates, setTrajectoryStates] = useState(new Map());

  // Add state to track rendering states
  const [renderingStates, setRenderingStates] = useState(new Map());

  // Force UI updates for trajectory controls
  const forceTrajectoryUpdate = (unitId) => {
    const unit = unitsRef.current.get(unitId);
    if (!unit) return;

    if (unit.type === UNIT_TYPES.TRAJECTORY) {
      const trajectories = Array.from(unit.trajectories?.entries() || []).map(
        ([id, traj]) => ({
          id,
          isPlaying: traj.isPlaying
        })
      );
      setTrajectoryStates(prev => new Map(prev).set(unitId, trajectories));
    } else if (unit.type === UNIT_TYPES.LOOPING) {
      // Force a re-render by creating a new Map
      setTrajectoryStates(prev => new Map(prev));
    }
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
      
      const trajectoryUnit = unitsRef.current.get(selectedUnitId);
      if (!trajectoryUnit || trajectoryUnit.type !== UNIT_TYPES.TRAJECTORY) return;

      // Only allow recording shortcut in one-off mode
      if (e.key.toLowerCase() === 's' && trajectoryUnit.playbackMode !== 'looping') {
        e.preventDefault();
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

const ParameterSection = ({ title, children }) => (
  <div className="mt-2">
    <h3 className="text-xs text-gray-400 mb-1">{title}</h3>
    <div className="space-y-2">
      {children}
    </div>
  </div>
);

// Update the ModifyParameters component similarly with debouncing
const ModifyParameters = ({ onChange, values, showPosition = true, unitType }) => {
  // Add state for tracking sliders being dragged
  const [isDragging, setIsDragging] = useState(false);
  // Track the current parameter values while dragging
  const [currentValues, setCurrentValues] = useState({...values});
  // Keep previous values for comparison
  const prevValuesRef = useRef({...values});

  // Update currentValues when external values change (but not during drag)
  useEffect(() => {
    if (!isDragging) {
      setCurrentValues({...values});
      prevValuesRef.current = {...values};
    }
  }, [values, isDragging]);

  // Function to handle parameter changes during dragging
  const handleParamChange = (param, value) => {
    // Update the local state immediately for UI feedback only
    setCurrentValues(prev => ({...prev, [param]: value}));
    
    // Mark as dragging
    setIsDragging(true);
  };
  
  // Function for when drag ends
  const handleDragEnd = (param) => {
    // Get the final value for this parameter
    const value = currentValues[param];
    
    // End dragging state
    setIsDragging(false);
    
    // Only apply the final value if it's different from the previous value
    if (value !== prevValuesRef.current[param]) {
      console.log(`Applying final modify parameter change (${param}): ${prevValuesRef.current[param]} -> ${value}`);
      onChange(param, value);
      prevValuesRef.current[param] = value;
    }
  };

  return (
    <ParameterSection title="Modify">
      {showPosition && (
        <Slider 
          label="Position"
          min={0}
          max={1}
          step={0.01}
          value={currentValues.offset || 0.5}
          onChange={val => handleParamChange('offset', val)}
          onMouseUp={() => handleDragEnd('offset')}
          centered={true}
        />
      )}
      
      {unitType === UNIT_TYPES.SEQUENCING ? (
        // For SequencingUnit, use shift parameter
        <Slider 
          label="Shift"
          min={-24}
          max={24}
          step={1}
          value={currentValues.shift || currentValues.pitchShift || 0}
          onChange={val => handleParamChange('shift', val)}
          onMouseUp={() => handleDragEnd('shift')}
          centered={true}
        />
      ) : (
        // For TrajectoryUnit and LoopingUnit, use playbackRate parameter
        <Slider 
          label="Playback Rate"
          min={0.25}
          max={4}
          step={0.25}
          value={currentValues.playbackRate || 1}
          onChange={val => handleParamChange('playbackRate', val)}
          onMouseUp={() => handleDragEnd('playbackRate')}
        />
      )}
      
      {showPosition && (
        <>
          <Slider 
            label="Start Offset"
            min={0}
            max={1}
            step={0.01}
            value={currentValues.startOffset || 0}
            onChange={val => handleParamChange('startOffset', val)}
            onMouseUp={() => handleDragEnd('startOffset')}
          />
          
          <Slider 
            label="Stop Offset"
            min={0}
            max={1}
            step={0.01}
            value={currentValues.stopOffset || 0}
            onChange={val => handleParamChange('stopOffset', val)}
            onMouseUp={() => handleDragEnd('stopOffset')}
          />
        </>
      )}
    </ParameterSection>
  );
};

// Update the RenderParameters component to handle real-time updates better
const RenderParameters = ({ 
  onChange, 
  values, 
  isRendering = false, 
  defaultValues = null,
  unitInstance = null,
  genomeId = null
}) => {
  // Add state for tracking sliders being dragged
  const [isDragging, setIsDragging] = useState(false);
  // Track the current parameter values while dragging
  const [currentValues, setCurrentValues] = useState({...values});
  // Use a ref to store the debounce timer
  const debounceTimerRef = useRef(null);
  // Keep previous values for comparison
  const prevValuesRef = useRef({...values});

  // Update currentValues when external values change (but not during drag)
  useEffect(() => {
    if (!isDragging) {
      setCurrentValues({...values});
      prevValuesRef.current = {...values};
    }
  }, [values, isDragging]);

  // Function to handle parameter changes during dragging
  const handleParamChange = (param, value) => {
    // Update the local state immediately for UI feedback only
    setCurrentValues(prev => ({...prev, [param]: value}));
    
    // Mark as dragging
    setIsDragging(true);
    
    // During dragging, we only update the UI, NOT the registry or trigger any renders
    // This ensures we don't fire network requests during dragging
  };
  
  // Function for when drag ends
  const handleDragEnd = (param) => {
    // Clear any existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // Get the final value for this parameter
    const value = currentValues[param];
    
    // End dragging state
    setIsDragging(false);
    
    // Only apply the final value if it's different from the previous value
    if (value !== prevValuesRef.current[param]) {
      console.log(`Applying final render parameter change (${param}): ${prevValuesRef.current[param]} -> ${value}`);
      
      // Update the registry with the final value
      if (genomeId) {
        try {
          // Import dynamically to avoid circular dependencies
          import('../utils/VoiceParameterRegistry').then(module => {
            const VoiceParameterRegistry = module.default;
            
            // Update the registry with the final parameter value
            VoiceParameterRegistry.updateParameters(
              genomeId, 
              { [param]: value }
            );
          });
        } catch (err) {
          console.error('Error updating voice parameters:', err);
        }
      }
      
      // Call onChange handler for UI updates
      onChange(param, value);
      
      // For parameters requiring render, call the unit's updatePlayingVoice method
      if (param === 'duration' || param === 'pitch' || param === 'velocity') {
        if (unitInstance && genomeId && !isRendering) {
          try {
            // Use updatePlayingVoice for single voice parameters
            // This will trigger the actual render ONLY on drag end
            unitInstance.updatePlayingVoice(genomeId, { [param]: value });
          } catch (err) {
            console.error('Error updating playing voice:', err);
          }
        }
      }
      
      // Update the previous value reference
      prevValuesRef.current[param] = value;
    } else {
      console.log(`Parameter ${param} unchanged, skipping update`);
    }
  };
  
  // Ensure we clean up timers
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <ParameterSection title="Render">
      <div className="relative">
        {isRendering && <RenderingSpinner />}
        <Slider 
          label="Duration"
          min={0.1}
          max={60}
          step={0.1}
          value={currentValues.duration || 1}
          onChange={val => handleParamChange('duration', val)} 
          onMouseUp={() => handleDragEnd('duration')}
          defaultValue={defaultValues?.duration}
        />
        
        <Slider 
          label="Pitch"
          min={-24}
          max={24}
          step={1}
          value={currentValues.pitch === undefined ? 0 : currentValues.pitch}
          onChange={val => handleParamChange('pitch', val)}
          onMouseUp={() => handleDragEnd('pitch')}
          centered={true}
          defaultValue={defaultValues?.pitch}
        />
        
        <Slider 
          label="Velocity"
          min={0}
          max={1}
          step={0.01}
          value={currentValues.velocity || 1}
          onChange={val => handleParamChange('velocity', val)}
          onMouseUp={() => handleDragEnd('velocity')}
          defaultValue={defaultValues?.velocity}
        />
      </div>
    </ParameterSection>
  );
};

// Update TrajectoryEventParams to properly reflect event values
const TrajectoryEventParams = ({ 
  event, 
  onUpdate, 
  isRendering = false, 
  trajectoryUnit = null,
  trajectoryId = null,
  eventIndex = null 
}) => {
  // FIXED: Initialize with the correct values from event
  const [dragValues, setDragValues] = useState({
    offset: event.offset || 0.5,
    playbackRate: event.playbackRate || 1,
    startOffset: event.startOffset || 0,
    stopOffset: event.stopOffset || 0,
    // IMPORTANT: Use correct render parameter values, checking multiple locations
    duration: event.duration || event.renderParams?.duration || 
              event.cellData?.duration || 4,
    pitch: event.pitch || event.renderParams?.pitch || 
           event.cellData?.noteDelta || event.cellData?.pitch || 0,
    velocity: event.velocity || event.renderParams?.velocity || 
              event.cellData?.velocity || 1
  });
  
  // Store original values from the cell data
  const originalValues = useRef({
    duration: event.cellData?.originalDuration || 
              event.cellData?.duration || 
              event.duration || 4,
    pitch: event.cellData?.originalPitch || 
           event.cellData?.noteDelta || 
           event.cellData?.pitch || 
           event.pitch || 0,
    velocity: event.cellData?.originalVelocity || 
              event.cellData?.velocity || 
              event.velocity || 1
  });
  
  // Maintain context ID for registry updates
  const contextId = `trajectory-${trajectoryId}-event-${eventIndex}`;

  // FIXED: Update dragValues when event changes with improved fallback chain
  useEffect(() => {
    console.log('TrajectoryEventParams: Event updated, refreshing values', {
      eventId: event.cellData?.genomeId,
      duration: event.duration,
      renderParamsDuration: event.renderParams?.duration,
      cellDataDuration: event.cellData?.duration,
    });
    
    setDragValues({
      offset: event.offset || 0.5,
      playbackRate: event.playbackRate || 1,
      startOffset: event.startOffset || 0,
      stopOffset: event.stopOffset || 0,
      // Use a multi-level fallback chain to get the most accurate values
      duration: event.duration || 
                event.renderParams?.duration || 
                event.cellData?.duration || 4,
      pitch: event.pitch || 
             event.renderParams?.pitch || 
             event.cellData?.noteDelta || 
             event.cellData?.pitch || 0,
      velocity: event.velocity || 
                event.renderParams?.velocity || 
                event.cellData?.velocity || 1
    });
    
    // Also update original values if needed
    originalValues.current = {
      duration: event.cellData?.originalDuration || 
                event.cellData?.duration || 
                event.duration || 4,
      pitch: event.cellData?.originalPitch || 
             event.cellData?.noteDelta || 
             event.cellData?.pitch || 
             event.pitch || 0,
      velocity: event.cellData?.originalVelocity || 
                event.cellData?.velocity || 
                event.velocity || 1
    };
  }, [
    event, 
    event.duration, 
    event.pitch, 
    event.velocity, 
    event.renderParams?.duration,
    event.renderParams?.pitch,
    event.renderParams?.velocity
  ]);

  // Function for handling render parameter changes
  const handleRenderParamChange = (param, value) => {
    // Update local state immediately for UI feedback
    setDragValues(prev => ({ ...prev, [param]: value }));
    
    // If we have VoiceParameterRegistry, update it directly for real-time changes
    if (event.cellData?.genomeId) {
      // Import dynamically to avoid circular dependencies
      import('../utils/VoiceParameterRegistry').then(module => {
        const VoiceParameterRegistry = module.default;
        
        // Update the registry with the new parameter value
        VoiceParameterRegistry.updateParameters(
          event.cellData.genomeId, 
          { [param]: value },
          contextId
        );
      });
    }
  };

  // Function for handling parameter changes with less frequent updates
  const handleModifyChange = (param, value) => {
    // Update local state immediately for UI feedback
    setDragValues(prev => ({ ...prev, [param]: value }));
    
    // Send update to trajectory
    onUpdate({ [param]: value });
  };
  
  // Function for when drag ends on a render param
  const handleRenderParamEnd = (param) => {
    // FIXED: Add renderNow flag to signal that this is a final value
    const updates = { 
      [param]: dragValues[param],
      renderNow: true
    };
    
    // Send final update
    onUpdate(updates);
  };

  return (
    <div className="pt-2 space-y-2">
      <ModifyParameters 
        values={dragValues}
        onChange={(param, value) => handleModifyChange(param, value)}
        unitType={UNIT_TYPES.TRAJECTORY}
      />
      <RenderParameters 
        values={dragValues}
        onChange={(param, value) => handleRenderParamChange(param, value)}
        onMouseUp={(param) => handleRenderParamEnd(param)}
        isRendering={isRendering}
        defaultValues={originalValues.current}
        unitInstance={trajectoryUnit}
        genomeId={event.cellData?.genomeId}
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
    const isLoopingMode = trajectoryUnit.playbackMode === 'looping';
  
    return (
      <div className="mt-2 space-y-2">
        {/* Existing recording controls */}
        {!isLoopingMode && (
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
        )}

        {/* Add Explore section */}
        {!isRecording && trajectoryUnit.lastHoveredSound && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 px-2 py-1 bg-gray-700/50 rounded-sm">
              <span className="text-xs text-gray-300">
                Explore
              </span>
              <button
                onClick={() => {
                  const element = document.querySelector(`#explore-params-${unit.id}`);
                  element.style.display = element.style.display === 'none' ? 'block' : 'none';
                }}
                className="p-1 text-xs bg-gray-600/50 hover:bg-gray-600 text-white rounded ml-auto"
              >
                ▼
              </button>
            </div>

            <div 
              id={`explore-params-${unit.id}`}
              className="ml-4 mt-1 space-y-2"
              style={{ display: 'none' }}
            >
              <div className="bg-gray-700/50 rounded-sm p-2 space-y-2 relative">
                <ModifyParameters 
                  values={trajectoryUnit.lastHoveredSound}
                  onChange={(param, value) => {
                    trajectoryUnit.updateExploreParams({ [param]: value });
                    forceTrajectoryUpdate(unit.id);
                  }}
                  showPosition={false}  // Don't show position slider for explore mode
                  unitType={UNIT_TYPES.TRAJECTORY}
                />
                <RenderParameters 
                  values={trajectoryUnit.lastHoveredSound}
                  onChange={(param, value) => {
                    trajectoryUnit.updateExploreParams({ [param]: value });
                    forceTrajectoryUpdate(unit.id);
                  }}
                  isRendering={isVoiceRendering(unit.id, trajectoryUnit.lastHoveredSound.genomeId)}
                  defaultValues={{
                    duration: trajectoryUnit.lastHoveredSound.originalDuration || trajectoryUnit.lastHoveredSound.duration,
                    pitch: trajectoryUnit.lastHoveredSound.originalPitch || trajectoryUnit.lastHoveredSound.pitch,
                    velocity: trajectoryUnit.lastHoveredSound.originalVelocity || trajectoryUnit.lastHoveredSound.velocity
                  }}
                  unitInstance={trajectoryUnit}
                  genomeId={trajectoryUnit.lastHoveredSound.genomeId}
                />
              </div>
            </div>
          </div>
        )}
  
        {/* Existing trajectories list */}
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
                      className="bg-gray-700/50 rounded-sm p-2 space-y-2 relative"
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
                          isRendering={isVoiceRendering(unit.id, event.cellData.genomeId)}
                          trajectoryUnit={trajectoryUnit}
                          trajectoryId={trajectoryId}
                          eventIndex={index}
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

const renderLoopingControls = (unit) => {
  if (unit.type !== UNIT_TYPES.LOOPING) return null;

  const loopingUnit = unitsRef.current.get(unit.id);
  if (!loopingUnit) return null;

  const masterLoopInfo = loopingUnit.getMasterLoopInfo();
  const loopingVoices = Array.from(loopingUnit.loopingVoices.entries())
    .map(([genomeId, data]) => ({
      id: genomeId,
      ...data
    }));

  return (
    <div className="space-y-2">
      {/* Header with collapse control for entire list */}
      <div className="flex items-center gap-2 px-2 py-1 bg-gray-700/50 rounded-sm">
        <span className="text-xs text-gray-300">
          Looping Voices ({loopingVoices.length})
        </span>
        <div className="flex-1" />
        {loopingVoices.length > 0 && (
          <button
            onClick={() => {
              loopingVoices.forEach(voice => {
                loopingUnit.stopLoopingVoice(voice.id);
              });
              forceTrajectoryUpdate(unit.id);
            }}
            className="px-1.5 py-0.5 text-xs rounded bg-red-600/50 text-white hover:bg-red-600"
          >
            Stop All
          </button>
        )}
        <button
          onClick={() => {
            const element = document.querySelector(`#looping-voices-${unit.id}`);
            element.style.display = element.style.display === 'none' ? 'block' : 'none';
          }}
          className="p-1 text-xs bg-gray-600/50 hover:bg-gray-600 text-white rounded"
        >
          ▼
        </button>
      </div>

      {/* Collapsible section containing everything */}
      <div 
        id={`looping-voices-${unit.id}`}
        className="space-y-2"
        style={{ display: 'none' }}
      >
        {/* Sync Controls */}
        <div className="flex items-center gap-2 py-1">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={unit.syncEnabled}
              onChange={(e) => {
                onUpdateUnit(unit.id, {
                  ...unit,
                  syncEnabled: e.target.checked
                });
              }}
              className="rounded bg-gray-800 border-gray-700"
            />
            <span className="text-gray-300">Sync to First Loop</span>
          </label>
        </div>

        {/* Master Loop Info */}
        {masterLoopInfo && (
          <div className="text-xs text-gray-500 bg-gray-800/30 px-2 py-1 rounded flex items-center justify-between">
            <span>Master: {masterLoopInfo.id.slice(-6)}</span>
            <span>{masterLoopInfo.duration.toFixed(2)}s</span>
          </div>
        )}

        {/* Individual Voices List */}
        <div className="ml-4 space-y-1">
          {loopingVoices.map(voice => (
            <div key={voice.id}>
              <div className="flex items-center gap-2 px-2 py-1 bg-gray-700/50 rounded-sm">
                <span className="text-xs text-gray-300">
                  {voice.id.slice(-6)}
                </span>
                <button
                  onClick={() => {
                    loopingUnit.stopLoopingVoice(voice.id);
                    forceTrajectoryUpdate(unit.id);
                  }}
                  className="px-1.5 py-0.5 text-xs rounded bg-red-600/50 text-white hover:bg-red-600"
                >
                  Stop
                </button>
                <button
                  onClick={() => {
                    const element = document.querySelector(`#looping-voice-${voice.id}`);
                    element.style.display = element.style.display === 'none' ? 'block' : 'none';
                  }}
                  className="p-1 text-xs bg-gray-600/50 hover:bg-gray-600 text-white rounded ml-auto"
                >
                  ▼
                </button>
              </div>

              {/* Individual Voice Parameters */}
              <div 
                id={`looping-voice-${voice.id}`}
                className="ml-4 mt-1 space-y-2"
                style={{ display: 'none' }}
              >
                <div className="bg-gray-700/50 rounded-sm p-2 space-y-2 relative">
                  <ModifyParameters 
                    values={voice}
                    onChange={(param, value) => {
                      loopingUnit.updateLoopingVoice(voice.id, { [param]: value });
                      forceTrajectoryUpdate(unit.id);
                    }}
                    showPosition={false}
                    unitType={UNIT_TYPES.LOOPING}
                  />
                  <RenderParameters 
                    values={voice}
                    onChange={(param, value) => {
                      loopingUnit.updateLoopingVoice(voice.id, { [param]: value });
                      forceTrajectoryUpdate(unit.id);
                    }}
                    isRendering={isVoiceRendering(unit.id, voice.id)}
                    defaultValues={{
                      duration: voice.originalDuration || voice.duration,
                      pitch: voice.originalPitch || voice.pitch,
                      velocity: voice.originalVelocity || voice.velocity
                    }}
                    unitInstance={loopingUnit}
                    genomeId={voice.id}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
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
                    <ModifyParameters 
                      values={item}
                      onChange={(param, value) => {
                        sequencingUnit.updateSequenceItem(item.genomeId, { [param]: value });
                        forceSequenceUpdate(unit.id);
                      }}
                      showPosition={true}  // Change this to true to show Position slider
                      unitType={UNIT_TYPES.SEQUENCING}
                    />
                    <RenderParameters 
                      values={item}
                      onChange={(param, value) => {
                        sequencingUnit.updateSequenceItem(item.genomeId, { [param]: value });
                        forceSequenceUpdate(unit.id);
                      }}
                      isRendering={isVoiceRendering(unit.id, item.genomeId)}
                      defaultValues={{
                        duration: item.originalDuration || item.duration,
                        pitch: item.originalPitch || item.pitch,
                        velocity: item.originalVelocity || item.velocity
                      }}
                      unitInstance={sequencingUnit}
                      genomeId={item.genomeId}
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

  // Add useEffect to setup state change listeners
  useEffect(() => {
    const handleStateChange = (unitId) => () => {
      forceTrajectoryUpdate(unitId);
    };

    const listeners = new Map();

    units.forEach(unit => {
      if (unit.type === UNIT_TYPES.TRAJECTORY || unit.type === UNIT_TYPES.LOOPING) {
        const unitInstance = unitsRef.current.get(unit.id);
        if (unitInstance) {
          const listener = handleStateChange(unit.id);
          unitInstance.addStateChangeCallback(listener);
          listeners.set(unit.id, listener);
        }
      }
    });

    // Cleanup listeners
    return () => {
      listeners.forEach((listener, unitId) => {
        const unitInstance = unitsRef.current.get(unitId);
        if (unitInstance) {
          unitInstance.removeStateChangeCallback(listener);
        }
      });
    };
  }, [units]);

  // Add state to track rendering status for voices
  const handleRenderStateChange = (unitId) => (renderingVoices) => {
    // Add null check to prevent errors when renderingVoices is undefined
    if (!renderingVoices) {
      console.warn(`Received undefined renderingVoices for unit ${unitId}`);
      // Clear rendering state for this unit if we got undefined
      setRenderingStates(prev => {
        const newStates = new Map(prev);
        newStates.set(unitId, new Set());
        return newStates;
      });
      return;
    }
    
    setRenderingStates(prev => {
      const newStates = new Map(prev);
      // Convert the renderingVoices Map to a Set of genomeIds for easier lookup
      const genomeIds = new Set();
      renderingVoices.forEach((_, genomeId) => {
        genomeIds.add(genomeId);
      });
      newStates.set(unitId, genomeIds);
      return newStates;
    });
    
    // Log rendering state changes
    console.log(`Render state updated for unit ${unitId}:`, {
      renderingIds: Array.from(renderingVoices.keys()),
      unitType: unitsRef.current.get(unitId)?.type
    });
  };

  // Add useEffect to setup render state listeners
  useEffect(() => {
    const renderListeners = new Map();

    // Set up render state listeners for all unit types
    units.forEach(unit => {
      const unitInstance = unitsRef.current.get(unit.id);
      if (!unitInstance) return;
      
      // Check which render callback method is available
      if (typeof unitInstance.addRenderStateCallback === 'function') {
        const listener = handleRenderStateChange(unit.id);
        unitInstance.addRenderStateCallback(listener);
        renderListeners.set(unit.id, listener);
      } 
    });

    return () => {
      // Clean up all render listeners
      renderListeners.forEach((listener, unitId) => {
        const unitInstance = unitsRef.current.get(unitId);
        if (unitInstance && typeof unitInstance.removeRenderStateCallback === 'function') {
          unitInstance.removeRenderStateCallback(listener);
        }
      });
    };
  }, [units]);

  // Updated helper function to check if a voice is being rendered
  const isVoiceRendering = (unitId, genomeId) => {
    if (!genomeId) return false;
    
    const renderingForUnit = renderingStates.get(unitId);
    const isRendering = renderingForUnit ? renderingForUnit.has(genomeId) : false;
    
    return isRendering;
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
                  {renderLoopingControls(unit)}
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