import React, { useState } from 'react';
import { X } from 'lucide-react';
import StrudelEditor from './StrudelEditor';
import ChuckEditor from './ChuckEditor';

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

const UnitConfigPanel = ({ unit, onClose, onUpdateUnit }) => {
  const [activeTab, setActiveTab] = useState('Unit');
  const [liveCodeEngine, setLiveCodeEngine] = useState('Strudel');
  const tabs = ['Unit', 'Sampler', 'Live Code'];

  const handleValueChange = (key, value) => {
    onUpdateUnit(unit.id, { ...unit, [key]: value });
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
            {/* Smaller toggle buttons */}
            <div className="flex gap-1 p-1 bg-gray-800 rounded">
              <button
                onClick={() => setLiveCodeEngine('Strudel')}
                className={`flex-1 px-2 py-1 rounded text-xs ${
                  liveCodeEngine === 'Strudel'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                Strudel
              </button>
              <button
                onClick={() => setLiveCodeEngine('ChucK')}
                className={`flex-1 px-2 py-1 rounded text-xs ${
                  liveCodeEngine === 'ChucK'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white'
                }`}
              >
                ChucK
              </button>
            </div>
            {liveCodeEngine === 'Strudel' ? <StrudelEditor /> : <ChuckEditor />}
          </div>
        )}
      </div>
    </div>
  );
};

export default UnitConfigPanel;