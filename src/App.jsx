import { useState, useEffect } from 'react';
import PhylogeneticViewer from './components/PhylogeneticViewer';

function App() {
  const [treeData, setTreeData] = useState(null);
  const [lineageTreesIndex, setLineageTreesIndex] = useState(null);
  const [selectedRun, setSelectedRun] = useState('conf-classScoringVariationsAsContainerDimensions_noOsc');
  const [selectedIndex, setSelectedIndex] = useState(0);

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

  if (!lineageTreesIndex || !treeData) {
    return <div className="fixed inset-0 bg-gray-950 flex items-center justify-center text-white">
      Loading...
    </div>;
  }

  const runs = Object.keys(lineageTreesIndex);
  const steps = lineageTreesIndex[selectedRun].all.length;

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-950">
      {/* Selectors Bar */}
      <div className="p-2 bg-gray-900/80 backdrop-blur flex items-center gap-2">
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
        <div className="w-40">
          <select
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
            className="w-full bg-gray-800 text-white p-2 rounded border border-gray-700 text-sm"
          >
            {Array.from({length: steps}, (_, i) => (
              <option key={i} value={i}>
                Step {i + 1}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Visualization */}
      <div className="flex-1">
        <PhylogeneticViewer 
          treeData={treeData}
          experiment={selectedRun}
          // Extract just the evolution run ID from the path
          evoRunId={
            getEvoRunIdFromSelectedStep( lineageTreesIndex[selectedRun].all[selectedIndex].split('/')[2] )
          }
        />
      </div>
    </div>
  );
}

function getEvoRunIdFromSelectedStep( selectedStep ) {
  // set evoRunId as a substring from selectedStep, between "lineageTrees/tree_" and ("_all.json" or "_musical.json" or "_nonmusical.json")
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