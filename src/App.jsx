import { useState, useEffect, useRef } from 'react';
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
import UnitsPanel from './components/UnitsPanel';
import UnitConfigPanel from './components/UnitConfigPanel';
import ViewSwitcher from './components/ViewSwitcher';
import HeatmapViewer from './components/HeatmapViewer';
import StrudelReplTest from './components/StrudelReplTest';
import { StrudelPatternProvider } from './components/strudelPatternContext';
import { DEFAULT_STRUDEL_CODE, LINEAGE_SOUNDS_BUCKET_HOST } from './constants';

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

function MainContent({ lineageTreesIndex, treeData, ...props }) {
  if (!lineageTreesIndex || !treeData) {
    return <div className="fixed inset-0 bg-gray-950 flex items-center justify-center text-white">
      Loading...
    </div>;
  }

  const runs = Object.keys(lineageTreesIndex);
  const steps = lineageTreesIndex[props.selectedRun].all.length;

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-950">
      <TopBar 
        showUnits={props.showUnits}
        setShowUnits={props.setShowUnits}
        selectedRun={props.selectedRun}
        handleRunChange={props.handleRunChange}
        selectedIndex={props.selectedIndex}
        handleIndexChange={props.handleIndexChange}
        showSettings={props.showSettings}
        setShowSettings={props.setShowSettings}
        runs={runs}
        steps={steps}
      />
      <div className="flex-1 flex">
        {props.showUnits && (
          <>
            <UnitsPanel
              units={props.units.map(unit => ({
                ...unit,
                isPlaying: props.playingUnits.has(unit.id)
              }))}
              onPlaybackChange={props.handleUnitPlaybackChange}
              selectedUnitId={props.selectedUnitId}
              onSelectUnit={props.handleSelectUnit}
              onAddUnit={props.handleAddUnit}
              onRemoveUnit={props.handleRemoveUnit}
              onToggleState={props.handleToggleState}
              onUpdateVolume={props.handleUpdateVolume}
            />
            
            {props.selectedUnitId && (
              <UnitConfigPanel
                unit={props.units.find(u => u.id === props.selectedUnitId)}
                units={props.units}
                onClose={() => props.handleSelectUnit(null)}
                onUpdateUnit={props.handleUpdateUnit}
                onPlaybackChange={props.handleUnitPlaybackChange}
              />
            )}
          </>
        )}

        <div className="flex-1 relative">
          <ViewSwitcher 
            activeView={props.currentView}
            onViewChange={props.handleViewChange}
          />
          
          <div className="absolute inset-0">
            {props.currentView === 'tree' ? (
              <PhylogeneticViewer 
                treeData={treeData}
                experiment={props.selectedRun}
                evoRunId={getEvoRunIdFromSelectedStep(lineageTreesIndex[props.selectedRun].all[props.selectedIndex])}
                showSettings={props.showSettings}
                setShowSettings={props.setShowSettings}
                hasAudioInteraction={props.hasAudioInteraction}
                onAudioInteraction={() => props.setHasAudioInteraction(true)}
              />
            ) : (
              <HeatmapViewer 
                showSettings={props.showSettings}
                setShowSettings={props.setShowSettings}
                experiment={props.selectedRun}
                evoRunId={getEvoRunIdFromSelectedStep(lineageTreesIndex[props.selectedRun].all[props.selectedIndex])}
                matrixUrl={getMatrixUrlFromTreePath(lineageTreesIndex[props.selectedRun].all[props.selectedIndex])}
                hasAudioInteraction={props.hasAudioInteraction}
                onAudioInteraction={() => props.setHasAudioInteraction(true)}
              />
            )}
          </div>
        </div>
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
  const [showUnits, setShowUnits] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState(null);
  const [units, setUnits] = useState([]);
  const [playingUnits, setPlayingUnits] = useState(new Set());

  // Group all useRef calls together
  const fetchedTreesRef = useRef(new Set());
  const fetchedIndexRef = useRef(false);

  // Group all useEffect calls together
  useEffect(() => {
    if (fetchedIndexRef.current) return;
    fetch(`${LINEAGE_SOUNDS_BUCKET_HOST}/lineage-trees-metadata/lineage-trees.json`)
      .then(response => response.json())
      .then(index => {
        setLineageTreesIndex(index);
        fetchedIndexRef.current = true;
      })
      .catch(error => console.error('Error loading index:', error));
  }, []);

  useEffect(() => {
    if (!lineageTreesIndex) return;
    const treePath = lineageTreesIndex[selectedRun].all[selectedIndex];
    if (fetchedTreesRef.current.has(treePath)) return;
    fetch(`${LINEAGE_SOUNDS_BUCKET_HOST}/lineage-trees/${treePath}`)
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
    const treePath = lineageTreesIndex[selectedRun].all[selectedIndex];
    
    setTreeData(null); // Clear current data before fetching
    fetch(`${LINEAGE_SOUNDS_BUCKET_HOST}/lineage-trees/${treePath}`)
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

  const handleAddUnit = () => {
    const newUnit = {
      id: units.length + 1,
      type: 'Sequence Unit',
      active: true,
      muted: false,
      soloed: false,
      volume: -10,
      isPlaying: false,
      strudelCode: DEFAULT_STRUDEL_CODE,
      liveCodeEngine: 'Strudel',
      speed: 0,
      grow: 0,
      shrink: 0,
      mutate: 0,
      probNewTree: 0,
      pitch: 0,
      start: 0,
      attack: 0,
      decay: 0,
      sustain: 0.5,
      release: 0,
      filter: 0,
      delay: 0,
      reverb: 0
    };
    setUnits([...units, newUnit]);
  };

  const handleRemoveUnit = (id) => {
    setUnits(prevUnits => {
      const remainingUnits = prevUnits.filter(unit => unit.id !== id);
      return remainingUnits.map((unit, index) => ({ ...unit, id: index + 1 }));
    });
    if (selectedUnitId === id) {
      setSelectedUnitId(null);
    }
  };

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
    setUnits(prevUnits =>
      prevUnits.map(unit => unit.id === id ? updatedUnit : unit)
    );
  };

  // ...existing handlers...

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
    handleSelectUnit={handleSelectUnit}
    handleAddUnit={handleAddUnit}
    handleRemoveUnit={handleRemoveUnit}
    handleToggleState={handleToggleState}
    handleUpdateVolume={handleUpdateVolume}
    handleUpdateUnit={handleUpdateUnit}
    hasAudioInteraction={hasAudioInteraction}
    setHasAudioInteraction={setHasAudioInteraction}
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
      <RouterProvider router={router} />
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