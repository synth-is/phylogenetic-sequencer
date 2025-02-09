import { Volume2, Plus } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { UNIT_TYPES } from '../constants';
import { TrajectoryUnit } from '../units/TrajectoryUnit';
import { CellDataFormatter } from '../utils/CellDataFormatter';
import { useUnits } from '../UnitsContext';

const UnitTypeSelector = ({ onSelect, onClose }) => (
  <div className="absolute bottom-12 left-0 right-0 mx-2 bg-gray-800 rounded-sm shadow-lg overflow-hidden">
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
    units.forEach(async unit => {
      if (!unitsRef.current.has(unit.id)) {
        if (unit.type === UNIT_TYPES.TRAJECTORY) {
          console.log('Creating new TrajectoryUnit:', unit.id);
          const trajectoryUnit = new TrajectoryUnit(unit.id);
          await trajectoryUnit.initialize();
          unitsRef.current.set(unit.id, trajectoryUnit);
        }
      }
    });

    // Update existing units' configuration
    units.forEach(unit => {
      const trajectoryUnit = unitsRef.current.get(unit.id);
      if (trajectoryUnit) {
        trajectoryUnit.updateConfig(unit);
      }
    });

    // Cleanup removed units
    Array.from(unitsRef.current.keys()).forEach(id => {
      if (!units.find(u => u.id === id)) {
        console.log('Cleaning up TrajectoryUnit:', id);
        unitsRef.current.get(id).cleanup();
        unitsRef.current.delete(id);
      }
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
      const trajectoryUnit = unitsRef.current.get(selectedUnitId);
      if (trajectoryUnit && trajectoryUnit.type === UNIT_TYPES.TRAJECTORY) {
        trajectoryUnit.handleCellHover(formattedData);
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

  // Add trajectory controls renderer
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
            {isRecording ? '(S)top Recording' : '(S)tart Recording'}
          </button>
        </div>

        {/* Render trajectory list */}
        <div className="space-y-1">
          {trajectories.map(({ id: trajectoryId, isPlaying }) => (
            <div 
              key={trajectoryId}
              className="flex items-center gap-2 px-2 py-1 bg-gray-700/50 rounded-sm"
            >
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
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="h-fit bg-gray-900/95 backdrop-blur border-r border-gray-800">
      <div className="p-2 flex flex-col gap-2 min-w-[16rem]">
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
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleState(unit.id, 'active');
                  }}
                  className={`w-6 h-6 rounded-sm text-sm flex items-center justify-center ${unit.active 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-700 text-gray-400'}`}
                >
                  {unit.id}
                </button>
                
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleState(unit.id, 'muted');
                  }}
                  className={`w-6 h-6 rounded-sm text-xs font-medium flex items-center justify-center ${unit.muted 
                    ? 'bg-red-600 text-white' 
                    : 'bg-gray-700 text-gray-400'}`}
                >
                  M
                </button>
                
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleState(unit.id, 'soloed');
                  }}
                  className={`w-6 h-6 rounded-sm text-xs font-medium flex items-center justify-center ${unit.soloed 
                    ? 'bg-yellow-600 text-white' 
                    : 'bg-gray-700 text-gray-400'}`}
                >
                  S
                </button>
                
                <Volume2 size={14} className="text-gray-400" />
                
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveUnit(unit.id);
                  }}
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
                <div className="text-xs text-gray-400 text-right">
                  {unit.volume} dB
                </div>
              </div>
            </div>
            {unit.id === selectedUnitId && renderTrajectoryControls(unit)}
          </div>
        ))}
        
        <div className="relative">
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
  );
};

export default UnitsPanel;