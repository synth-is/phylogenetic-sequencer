import { Volume2 } from 'lucide-react';

const UnitsPanel = ({ units, onAddUnit, onRemoveUnit, onToggleState, onUpdateVolume, onSelectUnit, selectedUnitId }) => {
  return (
    <div className="w-64 bg-gray-900/95 backdrop-blur border-r border-gray-800">
      <div className="p-2 flex flex-col gap-2">
        {units.map(unit => (
          <div 
            key={unit.id}
            onClick={() => onSelectUnit(unit.id)}
            className={`bg-gray-800/50 rounded-sm p-2 cursor-pointer select-none
              ${selectedUnitId === unit.id ? 'ring-1 ring-blue-500' : ''}`}
          >
            {/* All controls in a non-interactive div by default */}
            <div className="pointer-events-none flex flex-col gap-2">
              {/* Controls row with explicit pointer-events-auto */}
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
              
              {/* Volume controls with explicit pointer-events-auto */}
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
          </div>
        ))}
        
        <button
          onClick={onAddUnit}
          className="w-full p-1.5 rounded-sm bg-gray-800/50 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors flex items-center justify-center gap-1 text-sm"
        >
          + Add Unit
        </button>
      </div>
    </div>
  );
};

export default UnitsPanel;