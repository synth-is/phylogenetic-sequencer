import { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, Play } from 'lucide-react';
import { 
  BrowserRouter as Router, 
  Routes, 
  Route, 
  Navigate, 
  useSearchParams,
  createBrowserRouter,
  createRoutesFromElements,
  RouterProvider
} from 'react-router-dom';
import PhylogeneticViewer from './components/PhylogeneticViewer';
import PhylogeneticViewerSVG from './components/PhylogeneticViewerSVG';
import UnitsPanel from './components/UnitsPanel';
import UnitConfigPanel from './components/UnitConfigPanel';
import ViewSwitcher from './components/ViewSwitcher';
import HeatmapViewer from './components/HeatmapViewer';
import StrudelReplTest from './components/StrudelReplTest';
import { StrudelPatternProvider } from './components/strudelPatternContext';
import { DEFAULT_STRUDEL_CODE, LINEAGE_SOUNDS_BUCKET_HOST, UNIT_TYPES, DEFAULT_UNIT_CONFIGS } from './constants';
import { UnitsProvider } from './UnitsContext';

const TopBar = ({ 
  showUnits, 
  setShowUnits, 
  selectedRun, 
  handleRunChange, 
  selectedIndex, 
  handleIndexChange,
  showSettings,
  setShowSettings,
  runs,
  steps 
}) => (
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
          onChange={(e) => handleRunChange(e.target.value)}
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
          onChange={(e) => handleIndexChange(Number(e.target.value))}
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

function MainContent({ 
  lineageTreesIndex, 
  treeData,
  selectedUnitId,
  handleCellHover,  // Changed from onCellHover
  ...props 
}) {
  if (!lineageTreesIndex || !treeData) {
    return <div className="fixed inset-0 bg-gray-950 flex items-center justify-center text-white">
      Loading...
    </div>;
  }

  const runs = Object.keys(lineageTreesIndex);
  const steps = lineageTreesIndex[props.selectedRun].length;

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-950">
      <TopBar {...props} runs={runs} steps={steps} />
      <div className="flex-1 relative">
        <div className="absolute inset-0">
          {props.currentView === 'tree' ? (
            <PhylogeneticViewer 
              treeData={treeData}
              experiment={props.selectedRun}
              evoRunId={getEvoRunIdFromSelectedStep(lineageTreesIndex[props.selectedRun][props.selectedIndex])}
              showSettings={props.showSettings}
              setShowSettings={props.setShowSettings}
              hasAudioInteraction={props.hasAudioInteraction}
              onAudioInteraction={() => props.setHasAudioInteraction(true)}
              onCellHover={handleCellHover}  // Pass the handler directly
            />
          ) : props.currentView === 'treeSVG' ? (
            <PhylogeneticViewerSVG 
              treeData={treeData}
              experiment={props.selectedRun}
              evoRunId={getEvoRunIdFromSelectedStep(lineageTreesIndex[props.selectedRun][props.selectedIndex])}
              showSettings={props.showSettings}
              setShowSettings={props.setShowSettings}
              hasAudioInteraction={props.hasAudioInteraction}
              onAudioInteraction={() => props.setHasAudioInteraction(true)}
              onCellHover={handleCellHover}  // Pass the handler directly
            />
          ) : (
            <HeatmapViewer 
              showSettings={props.showSettings}
              setShowSettings={props.setShowSettings}
              experiment={props.selectedRun}
              evoRunId={getEvoRunIdFromSelectedStep(lineageTreesIndex[props.selectedRun][props.selectedIndex])}
              matrixUrl={getMatrixUrlFromTreePath(lineageTreesIndex[props.selectedRun][props.selectedIndex])}
              hasAudioInteraction={props.hasAudioInteraction}
              onAudioInteraction={() => props.setHasAudioInteraction(true)}
              onCellHover={handleCellHover}  // Pass the handler directly
            />
          )}
        </div>

        {props.showUnits && (
          <div className="fixed left-4 top-16 z-40">
            <UnitsPanel
              units={props.units}
              onPlaybackChange={props.handleUnitPlaybackChange}
              selectedUnitId={selectedUnitId}
              onSelectUnit={props.handleSelectUnit}
              onAddUnit={props.handleAddUnit}
              onRemoveUnit={props.handleRemoveUnit}
              onToggleState={props.handleToggleState}
              onUpdateVolume={props.handleUpdateVolume}
              onUpdateUnit={props.handleUpdateUnit}  // Add this line
              onCellHover={props.lastHoverData}  // Pass the actual hover data
            />
            
            {selectedUnitId && (
              <UnitConfigPanel
                unit={props.units.find(u => u.id === selectedUnitId)}
                units={props.units}
                onClose={() => props.handleSelectUnit(null)}
                onUpdateUnit={props.handleUpdateUnit}
                onPlaybackChange={props.handleUnitPlaybackChange}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MainApp() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize hasAudioInteraction based on view type
  const initialView = searchParams.get('view') || 'tree';
  const [hasAudioInteraction, setHasAudioInteraction] = useState(() => 
    initialView === 'heatmap' // Heatmap doesn't need initial audio interaction
  );

  // Group all useState calls together
  const [selectedRun, setSelectedRun] = useState(() => 
    searchParams.get('run') || 'evoConf_singleMap_refSingleEmb_mfcc-sans0-statistics_pca_retrainIncr50_zScoreNSynthTrain'
  );
  const [selectedIndex, setSelectedIndex] = useState(() => 
    parseInt(searchParams.get('step')) || 0
  );
  const [currentView, setCurrentView] = useState(() => 
    searchParams.get('view') || 'tree'
  );
  const [treeData, setTreeData] = useState(null);
  const [lineageTreesIndex, setLineageTreesIndex] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showUnits, setShowUnits] = useState(true);
  const [selectedUnitId, setSelectedUnitId] = useState(1); // Default to first unit
  const [lastHoverData, setLastHoverData] = useState(null);  // Add this state
  const [units, setUnits] = useState(() => [{
    id: 1,
    type: UNIT_TYPES.TRAJECTORY,
    ...DEFAULT_UNIT_CONFIGS[UNIT_TYPES.TRAJECTORY]
  }]);
  const [playingUnits, setPlayingUnits] = useState(new Set());

  // Group all useRef calls together
  const fetchedTreesRef = useRef(new Set());
  const fetchedIndexRef = useRef(false);

  const handleCellHover = useCallback((cellData) => {
    if (selectedUnitId && showUnits) {
      console.log('MainApp: cell hover received:', { selectedUnitId, cellData });
      setLastHoverData(cellData);  // Store the hover data
      setUnits(prevUnits => 
        prevUnits.map(unit => 
          unit.id === selectedUnitId 
            ? { ...unit, lastHoverData: cellData }
            : unit
        )
      );
      return cellData;
    }
    return null;
  }, [selectedUnitId, showUnits]);

  // Group all useEffect calls together
  useEffect(() => {
    if (fetchedIndexRef.current) return;
    fetch(`${LINEAGE_SOUNDS_BUCKET_HOST}/lineage-trees-metadata/evolution-runs-overview.json`)
      .then(response => response.json())
      .then(index => {
        setLineageTreesIndex(index);
        fetchedIndexRef.current = true;
      })
      .catch(error => console.error('Error loading index:', error));
  }, []);

  useEffect(() => {
    if (!lineageTreesIndex) return;
    const treePath = lineageTreesIndex[selectedRun][selectedIndex];
    if (fetchedTreesRef.current.has(treePath)) return;
    fetch(`${LINEAGE_SOUNDS_BUCKET_HOST}/lineage-trees/tree_${treePath}_all.json`)
      .then(response => response.json())
      .then(treeJson => {
        setTreeData(treeJson);
        fetchedTreesRef.current.add(treePath);
      })
      .catch(error => console.error('Error loading tree:', error));
  }, [lineageTreesIndex, selectedRun, selectedIndex]);

  useEffect(() => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('run', selectedRun);
    newParams.set('step', selectedIndex.toString());
    newParams.set('view', currentView);
    setSearchParams(newParams, { replace: true });
  }, [selectedRun, selectedIndex, currentView, setSearchParams]);

  // Simplify the data fetching effect
  useEffect(() => {
    if (!lineageTreesIndex || !selectedRun || selectedIndex === undefined) return;
    const treePath = lineageTreesIndex[selectedRun][selectedIndex];
    
    setTreeData(null); // Clear current data before fetching
    fetch(`${LINEAGE_SOUNDS_BUCKET_HOST}/lineage-trees/tree_${treePath}_all.json`)
      .then(response => response.json())
      .then(treeJson => {
        setTreeData(treeJson);
      })
      .catch(error => console.error('Error loading tree:', error));
  }, [lineageTreesIndex, selectedRun, selectedIndex]);

  // Add effect to handle audio interaction state when view changes
  useEffect(() => {
    if (currentView === 'heatmap') {
      setHasAudioInteraction(true);
    }
  }, [currentView]);

  // Add handler functions
  const handleRunChange = (run) => {
    fetchedTreesRef.current.clear(); // Clear cache when manually changing run
    setTreeData(null);
    setSelectedRun(run);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('run', run);
    setSearchParams(newParams, { replace: true });
  };

  const handleIndexChange = (index) => {
    setTreeData(null);
    setSelectedIndex(index);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('step', index.toString());
    setSearchParams(newParams, { replace: true });
  };

  // Update handleViewChange to handle audio interaction
  const handleViewChange = (view) => {
    setCurrentView(view);
    if (view === 'heatmap') {
      setHasAudioInteraction(true);
    }
    const newParams = new URLSearchParams(searchParams);
    newParams.set('view', view);
    setSearchParams(newParams, { replace: true });
  };

  const handleUnitPlaybackChange = (unitId, isPlaying) => {
    setPlayingUnits(prev => {
      const next = new Set(prev);
      if (isPlaying) {
        next.add(unitId);
      } else {
        next.delete(unitId);
      }
      return next;
    });
  };

  const handleSelectUnit = (id) => {
    setSelectedUnitId(id === selectedUnitId ? null : id);
  };

  const handleAddUnit = (unitType) => {
    const newUnit = {
      id: Date.now(), // Use timestamp for unique IDs
      type: unitType,
      ...DEFAULT_UNIT_CONFIGS[unitType]
    };
    setUnits([...units, newUnit]);
    setSelectedUnitId(newUnit.id);
  };

  const handleRemoveUnit = (id) => {
    console.log('App: handleRemoveUnit called:', {
      unitToRemove: id,
      currentUnits: units.map(u => ({ id: u.id, type: u.type })),
      selectedUnitId
    });

    setUnits(prevUnits => {
      // Simply filter out the removed unit, no reindexing
      const remainingUnits = prevUnits.filter(unit => unit.id !== id);
      
      // Update selected unit ID if we removed the selected unit
      if (selectedUnitId === id) {
        setSelectedUnitId(remainingUnits.length > 0 ? remainingUnits[0].id : null);
      }
      
      return remainingUnits;
    });
  };

  const handleToggleState = (id, state) => {
    setUnits(prevUnits => {
      const newUnits = prevUnits.map(unit => {
        if (unit.id === id) {
          return { ...unit, [state]: !unit[state] };
        }
        // If toggling solo, un-solo other units
        if (state === 'soloed' && unit.id !== id) {
          return { ...unit, soloed: false };
        }
        return unit;
      });
      return newUnits;
    });
  };

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

  const handleUpdateUnit = (id, updatedUnit) => {
    console.log('handleUpdateUnit called:', { id, updatedUnit });
    setUnits(prevUnits =>
      prevUnits.map(unit => unit.id === id ? updatedUnit : unit)
    );
  };


  return <MainContent 
    lineageTreesIndex={lineageTreesIndex}
    treeData={treeData}
    showUnits={showUnits}
    setShowUnits={setShowUnits}
    selectedRun={selectedRun}
    handleRunChange={handleRunChange}
    selectedIndex={selectedIndex}
    handleIndexChange={handleIndexChange}
    showSettings={showSettings}
    setShowSettings={setShowSettings}
    currentView={currentView}
    handleViewChange={handleViewChange}
    units={units}
    playingUnits={playingUnits}
    handleUnitPlaybackChange={handleUnitPlaybackChange}
    selectedUnitId={selectedUnitId}
    handleSelectUnit={setSelectedUnitId}
    handleAddUnit={handleAddUnit}
    handleRemoveUnit={handleRemoveUnit}
    handleToggleState={handleToggleState}
    handleUpdateVolume={handleUpdateVolume}
    handleUpdateUnit={handleUpdateUnit}  // Make sure this is included
    hasAudioInteraction={hasAudioInteraction}
    setHasAudioInteraction={setHasAudioInteraction}
    handleCellHover={handleCellHover}  // Pass the handler
    lastHoverData={lastHoverData}  // Pass the stored data
  />;
}

// Create router with future flags
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route>
      <Route path="/strudel-repl-test" element={<StrudelReplTest />} />
      <Route path="/" element={<MainApp />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  ),
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true
    },
    basename: import.meta.env.BASE_URL // Add this line
  }
);

function App() {
  return (
    <StrudelPatternProvider>
      <UnitsProvider>
        <RouterProvider router={router} />
      </UnitsProvider>
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
  // const evoRunId = selectedStep.substring(selectedStep.indexOf("tree_")+5, suffixIndex);
  const evoRunId = selectedStep;
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