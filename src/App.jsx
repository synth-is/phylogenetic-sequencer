import { useState, useEffect } from 'react';
import { Settings, Play } from 'lucide-react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import PhylogeneticViewer from './components/PhylogeneticViewer';
import UnitsPanel from './components/UnitsPanel';
import UnitConfigPanel from './components/UnitConfigPanel';
import ViewSwitcher from './components/ViewSwitcher';
import HeatmapViewer from './components/HeatmapViewer';
import StrudelReplTest from './components/StrudelReplTest';
import { StrudelPatternProvider } from './components/strudelPatternContext';
import { DEFAULT_STRUDEL_CODE, LINEAGE_SOUNDS_BUCKET_HOST } from './constants';

function App() {
  // Existing state
  const [treeData, setTreeData] = useState(null);
  const [lineageTreesIndex, setLineageTreesIndex] = useState(null);
  const [selectedRun, setSelectedRun] = useState('conf-classScoringVariationsAsContainerDimensions_noOsc');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showUnits, setShowUnits] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState(null);
  const [currentView, setCurrentView] = useState('tree');

  // Enhanced units state with default parameter values
  const [units, setUnits] = useState([]);

  // Load lineage trees index
  useEffect(() => {
    fetch(`${LINEAGE_SOUNDS_BUCKET_HOST}/lineage-trees-metadata/lineage-trees.json`)
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
    fetch(`${LINEAGE_SOUNDS_BUCKET_HOST}/lineage-trees/${treePath}`)
      .then(response => response.json())
      .then(treeJson => {
        setTreeData(treeJson);
      })
      .catch(error => console.error('Error loading tree:', error));
  }, [lineageTreesIndex, selectedRun, selectedIndex]);

  // Helper function to renumber units
  const renumberUnits = (unitsArray) => {
    return unitsArray.map((unit, index) => ({
      ...unit,
      id: index + 1
    }));
  };

  // Handler to add a new unit with all configurable parameters
  const handleAddUnit = () => {
    const newUnit = {
      id: units.length + 1,
      type: 'Sequence Unit',
      active: true,
      muted: false,
      soloed: false,
      volume: -10,
      // Live code parameters
      strudelCode: DEFAULT_STRUDEL_CODE,  // Add default Strudel code
      liveCodeEngine: 'Strudel',          // Default to Strudel engine
      // Sequence parameters
      speed: 0,
      // Evolution parameters
      grow: 0,
      shrink: 0,
      mutate: 0,
      probNewTree: 0,
      // Sample parameters
      pitch: 0,
      start: 0,
      // Envelope parameters
      attack: 0,
      decay: 0,
      sustain: 0.5,
      release: 0,
      // Effects parameters
      filter: 0,
      delay: 0,
      reverb: 0
    };
    setUnits([...units, newUnit]);
  };

  // Handler to remove a unit and renumber remaining units
  const handleRemoveUnit = (id) => {
    setUnits(prevUnits => {
      const remainingUnits = prevUnits.filter(unit => unit.id !== id);
      return renumberUnits(remainingUnits);
    });
    if (selectedUnitId === id) {
      setSelectedUnitId(null);
    }
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

  // Handler to update volume
  const handleUpdateVolume = (id, volume) => {
    setUnits(prevUnits => 
      prevUnits.map(unit => {
        if (unit.id === id) {
          return { ...unit, volume };
        }
        return unit;
      })
    );
  };

  // Handler to update any unit parameter
  const handleUpdateUnit = (id, updatedUnit) => {
    setUnits(prevUnits =>
      prevUnits.map(unit => unit.id === id ? updatedUnit : unit)
    );
  };

  // Handler to select a unit
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

  const TopBar = () => (
    <div className="p-2 bg-gray-900/80 backdrop-blur">
      <div className="flex items-center gap-2">
        <button 
          onClick={() => setShowUnits(!showUnits)}
          className="p-2 rounded hover:bg-gray-800 text-gray-400 transition-colors"
        >
          <Play size={16} />
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
  );

  const MainContent = () => {
    if (!lineageTreesIndex || !treeData) {
      return <div className="fixed inset-0 bg-gray-950 flex items-center justify-center text-white">
        Loading...
      </div>;
    }

    const runs = Object.keys(lineageTreesIndex);
    const steps = lineageTreesIndex[selectedRun].all.length;

    return (
      <div className="fixed inset-0 flex flex-col bg-gray-950">
        {/* Shared Top Bar - Always visible */}
        <TopBar />

        {/* Main Content Area */}
        <div className="flex-1 flex">
          {/* Units Panel - Visible based on showUnits state */}
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
                  units={units}
                  onClose={() => setSelectedUnitId(null)}
                  onUpdateUnit={handleUpdateUnit}
                />
              )}
            </>
          )}

          {/* Main Content Container */}
          <div className="flex-1 relative">
            {/* View Switcher - Always visible */}
            <ViewSwitcher 
              activeView={currentView}
              onViewChange={setCurrentView}
            />
            
            {/* Views Container - Full height and width */}
            <div className="absolute inset-0">
              {currentView === 'tree' ? (
                <PhylogeneticViewer 
                  treeData={treeData}
                  experiment={selectedRun}
                  evoRunId={getEvoRunIdFromSelectedStep(lineageTreesIndex[selectedRun].all[selectedIndex])}
                  showSettings={showSettings}
                  setShowSettings={setShowSettings}
                />
              ) : (
                <HeatmapViewer 
                  showSettings={showSettings}
                  setShowSettings={setShowSettings}
                  experiment={selectedRun}
                  evoRunId={getEvoRunIdFromSelectedStep(lineageTreesIndex[selectedRun].all[selectedIndex])}
                  matrixUrl={getMatrixUrlFromTreePath(lineageTreesIndex[selectedRun].all[selectedIndex])}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <StrudelPatternProvider>
      <Router>
        <Routes>
          <Route path="/strudel-repl-test" element={<StrudelReplTest />} />
          <Route path="/" element={<MainContent />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </StrudelPatternProvider>
  );
}

function getEvoRunIdFromSelectedStep(treeJSONfilePath) {
  const treeJSONfilePathParts = treeJSONfilePath.split('/');
  const selectedStep = treeJSONfilePathParts[treeJSONfilePathParts.length - 1];
  let suffixIndex;
  if (selectedStep.includes("_all.json")) {
    suffixIndex = selectedStep.indexOf("_all.json");
  } else if (selectedStep.includes("_musical.json")) {
    suffixIndex = selectedStep.indexOf("_musical.json");
  } else if (selectedStep.includes("_nonmusical.json")) {
    suffixIndex = selectedStep.indexOf("_nonmusical.json");
  }
  console.log("Selected step:", selectedStep);
  console.log("Suffix index:", suffixIndex);
  const evoRunId = selectedStep.substring(selectedStep.indexOf("tree_")+5, suffixIndex);
  console.log("Evo run ID:", evoRunId);
  return evoRunId;
}

function getMatrixUrlFromTreePath(treePath) {
  const treePathParts = treePath.split('/');
  const treeFileName = treePathParts[treePathParts.length - 1];
  const matrixFileName = treeFileName.replace("tree_", "matrix_").replace("_all.json", ".json");
  console.log("Matrix file name:", matrixFileName);
  return `${LINEAGE_SOUNDS_BUCKET_HOST}/lineage-matrices/${matrixFileName}`;
}

export default App;