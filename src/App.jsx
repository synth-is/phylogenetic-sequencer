import { useState, useEffect } from 'react';
import { Settings, Menu } from 'lucide-react';
import PhylogeneticViewer from './components/PhylogeneticViewer';
import UnitsPanel from './components/UnitsPanel';
import UnitConfigPanel from './components/UnitConfigPanel';

function App() {
  // Existing state
  const [treeData, setTreeData] = useState(null);
  const [lineageTreesIndex, setLineageTreesIndex] = useState(null);
  const [selectedRun, setSelectedRun] = useState('conf-classScoringVariationsAsContainerDimensions_noOsc');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showUnits, setShowUnits] = useState(false);
  const [units, setUnits] = useState([]);
  const [selectedUnitId, setSelectedUnitId] = useState(null);

  // Load lineage trees index
  useEffect(() => {
    fetch('/lineage-trees.json')
      .then(response => response.json())
      .then(index => {
        setLineageTreesIndex(index);
      })
      .catch(error => console.error('Error loading index:', error));
  }, []);

  // Load selected tree data
  useEffect(() => {
    if (!lineageTreesIndex) return;

    const treePath = lineageTreesIndex[selectedRun].all[selectedIndex];
    fetch(`/${treePath}`)
      .then(response => response.json())
      .then(treeJson => {
        setTreeData(treeJson);
      })
      .catch(error => console.error('Error loading tree:', error));
  }, [lineageTreesIndex, selectedRun, selectedIndex]);

  // Units handlers
  // Helper function to renumber units
  const renumberUnits = (unitsArray) => {
    return unitsArray.map((unit, index) => ({
      ...unit,
      id: index + 1
    }));
  };

  // Handler to add a new unit
  const handleAddUnit = () => {
    const newUnit = {
      id: units.length + 1,
      type: 'Sequence Unit',
      active: true,
      muted: false,
      soloed: false,
      volume: -10
    };
    setUnits([...units, newUnit]);
  };

  // Handler to remove a unit and renumber remaining units
  const handleRemoveUnit = (id) => {
    setUnits(prevUnits => {
      const remainingUnits = prevUnits.filter(unit => unit.id !== id);
      return renumberUnits(remainingUnits);
    });
  };

  // Handler to toggle unit states
  const handleToggleState = (id, state) => {
    setUnits(prevUnits => 
      prevUnits.map(unit => {
        if (unit.id === id) {
          return { ...unit, [state]: !unit[state] };
        }
        return unit;
      })
    );
  };

  const handleUpdateVolume = (id, volume) => {
    setUnits(units.map(unit => {
      if (unit.id === id) {
        return { ...unit, volume };
      }
      return unit;
    }));
  };

  const handleSelectUnit = (id) => {
    setSelectedUnitId(id === selectedUnitId ? null : id);
  };

  if (!lineageTreesIndex || !treeData) {
    return <div className="fixed inset-0 bg-gray-950 flex items-center justify-center text-white">
      Loading...
    </div>;
  }

  const runs = Object.keys(lineageTreesIndex);
  const steps = lineageTreesIndex[selectedRun].all.length;

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-950">
      {/* Controls Bar */}
      <div className="p-2 bg-gray-900/80 backdrop-blur">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowUnits(!showUnits)}
            className="p- rounded hover:bg-gray-800 text-gray-400 transition-colors"
          >
            <Menu size={16} />
          </button>

          <div className="flex-1">
            <select 
              value={selectedRun} 
              onChange={(e) => setSelectedRun(e.target.value)}
              className="w-full bg-gray-800 text-white p-2 rounded border border-gray-700 text-sm"
            >
              {runs.map(run => (
                <option key={run} value={run}>
                  {run.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          
          <div className="flex items-center gap-2">
            <select
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
              className="w-40 bg-gray-800 text-white p-2 rounded border border-gray-700 text-sm"
            >
              {Array.from({length: steps}, (_, i) => (
                <option key={i} value={i}>
                  Step {i + 1}
                </option>
              ))}
            </select>
            
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 rounded hover:bg-gray-800 text-gray-400 transition-colors"
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex">
        {showUnits && (
          <>
            <UnitsPanel
              units={units}
              selectedUnitId={selectedUnitId}
              onSelectUnit={handleSelectUnit}
              onAddUnit={handleAddUnit}
              onRemoveUnit={handleRemoveUnit}
              onToggleState={handleToggleState}
              onUpdateVolume={handleUpdateVolume}
            />
            
            {selectedUnitId && (
              <UnitConfigPanel
                unit={units.find(u => u.id === selectedUnitId)}
                onClose={() => setSelectedUnitId(null)}
                liveCodeEngine="Strudel"
              />
            )}
          </>
        )}

        <div className="flex-1">
          <PhylogeneticViewer 
            treeData={treeData}
            experiment={selectedRun}
            evoRunId={getEvoRunIdFromSelectedStep(lineageTreesIndex[selectedRun].all[selectedIndex].split('/')[2])}
            showSettings={showSettings}
            setShowSettings={setShowSettings}
          />
        </div>
      </div>
    </div>
  );
}

function getEvoRunIdFromSelectedStep(selectedStep) {
  let suffixIndex;
  if (selectedStep.includes("_all.json")) {
    suffixIndex = selectedStep.indexOf("_all.json");
  } else if (selectedStep.includes("_musical.json")) {
    suffixIndex = selectedStep.indexOf("_musical.json");
  } else if (selectedStep.includes("_nonmusical.json")) {
    suffixIndex = selectedStep.indexOf("_nonmusical.json");
  }
  const evoRunId = selectedStep.substring(selectedStep.indexOf("tree_")+5, suffixIndex);
  return evoRunId;
}

export default App;