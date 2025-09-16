import { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, Download } from 'lucide-react';
import * as d3 from 'd3';
import { getRestServiceHost, REST_ENDPOINTS } from '../constants';

// Add COLORMAP_OPTIONS before component
const COLORMAP_OPTIONS = {
  plasma: [
    '#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', 
    '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'
  ],
  viridis: [
    '#440154', '#482777', '#3f4a8a', '#31678e', '#26838f',
    '#1f9d8a', '#6cce5a', '#b6de2b', '#fee825'
  ],
  magma: [
    '#000004', '#1b1044', '#4f127b', '#812581', '#b5367a',
    '#e55c30', '#fba40a', '#fcffa4'
  ]
};

// Add matrix utility functions
const getMatrixDimensions = (matrix) => {
  const dimensions = [];
  let current = matrix;
  while (Array.isArray(current)) {
    dimensions.push(current.length);
    current = current[0];
  }
  return dimensions;
};

const flatten2D = (matrix, dimensions) => {
  if (dimensions.length <= 2) return matrix;

  const [height, width, ...extraDims] = dimensions;
  const totalExtraDims = extraDims.reduce((a, b) => a * b, 1);
  
  // Calculate grid layout
  const gridSize = Math.ceil(Math.sqrt(totalExtraDims));
  const sectionsX = gridSize;
  const sectionsY = Math.ceil(totalExtraDims / gridSize);
  
  // Create flattened matrix
  const flattenedWidth = width * sectionsX;
  const flattenedHeight = height * sectionsY;
  const flattened = Array(flattenedHeight).fill().map(() => 
    Array(flattenedWidth).fill().map(() => ({ score: null, genomeId: null }))
  );

  // Helper to get n-dimensional coordinates from index
  const getCoords = (index, dims) => {
    const coords = [];
    let remaining = index;
    for (let i = dims.length - 1; i >= 0; i--) {
      const dim = dims[i];
      coords.unshift(remaining % dim);
      remaining = Math.floor(remaining / dim);
    }
    return coords;
  };

  // Fill the flattened matrix
  for (let sectionIndex = 0; sectionIndex < totalExtraDims; sectionIndex++) {
    const sectionY = Math.floor(sectionIndex / sectionsX);
    const sectionX = sectionIndex % sectionsX;
    
    const coords = getCoords(sectionIndex, extraDims);
    
    let current = matrix;
    for (const coord of coords) {
      if (current && current[coord]) {
        current = current[coord];
      } else {
        current = null;
        break;
      }
    }

    if (current) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const destY = sectionY * height + y;
          const destX = sectionX * width + x;
          if (destY < flattenedHeight && destX < flattenedWidth && current[y] && current[y][x]) {
            flattened[destY][destX] = current[y][x];
          }
        }
      }
    }
  }

  return flattened;
};

const HeatmapViewer = ({
  showSettings,
  setShowSettings,
  experiment,  // Add missing prop
  evoRunId,
  matrixUrls,
  hasAudioInteraction,
  onAudioInteraction,
  onCellHover
}) => {
  // All refs - remove audio-related refs since we'll use the same system as PhylogeneticViewer
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const transformRef = useRef(d3.zoomIdentity);
  const currentMatrixRef = useRef(null);
  const hoverTimestampsRef = useRef(new Map()); // Add hover debouncing like PhylogeneticViewer
  const currentHoveredCellRef = useRef(null); // Track currently hovered cell to prevent repeated triggers

  // All state - remove audio-related state
  const [matrixData, setMatrixData] = useState(null);
  const [selectedGeneration, setSelectedGeneration] = useState(0);
  const [selectedColormap, setSelectedColormap] = useState('plasma');
  const [theme, setTheme] = useState('dark');
  const [useSquareCells, setUseSquareCells] = useState(true);
  const [silentMode, setSilentMode] = useState(false);

  // Add matrix data loading effect with hybrid approach
  useEffect(() => {
    if (!matrixUrls) return;
    
    console.log('Fetching matrix data with hybrid approach:', matrixUrls);
    
    // Try REST service first
    fetch(matrixUrls.restUrl)
      .then(response => {
        if (!response.ok) {
          throw new Error(`REST service failed: ${response.status}`);
        }
        // Check if the response is gzipped
        const contentType = response.headers.get('content-type');
        const contentEncoding = response.headers.get('content-encoding');
        
        if (matrixUrls.restUrl.endsWith('.gz') || contentEncoding === 'gzip') {
          // Handle gzipped response
          return response.arrayBuffer().then(buffer => {
            const decompressed = new DecompressionStream('gzip');
            const stream = new Response(buffer).body.pipeThrough(decompressed);
            return new Response(stream).text();
          }).then(text => JSON.parse(text));
        } else {
          return response.json();
        }
      })
      .then(data => {
        console.log('Matrix data loaded from REST service');
        setMatrixData(data);
      })
      .catch(error => {
        console.warn('REST service failed, trying fallback:', error.message);
        // Try fallback URL
        fetch(matrixUrls.fallbackUrl)
          .then(response => {
            if (!response.ok) {
              throw new Error(`Fallback failed: ${response.status}`);
            }
            return response.json();
          })
          .then(data => {
            console.log('Matrix data loaded from fallback URL');
            setMatrixData(data);
          })
          .catch(fallbackError => {
            console.error('Both REST service and fallback failed:', { 
              restError: error, 
              fallbackError 
            });
          });
      });
  }, [matrixUrls]);

  // Simplified settings panel - remove audio-specific controls since they're handled by the shared audio system
  const renderSettings = () => (
    <div className="absolute right-0 top-12 p-4 bg-gray-900/95 backdrop-blur rounded-l w-64">
      <div className="space-y-4">
        {/* Add Colormap Selection */}
        <div className="space-y-2">
          <label className="text-sm text-white">Color Palette</label>
          <select
            value={selectedColormap}
            onChange={(e) => setSelectedColormap(e.target.value)}
            className="w-full px-2 py-1 bg-gray-800 text-white rounded text-sm"
          >
            {Object.keys(COLORMAP_OPTIONS).map(name => (
              <option key={name} value={name}>
                {name.charAt(0).toUpperCase() + name.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Cell Shape Toggle */}
        <div className="space-y-2">
          <label className="text-sm text-white">Cell Shape</label>
          <button
            onClick={() => setUseSquareCells(!useSquareCells)}
            className={`w-full px-2 py-1 rounded text-sm ${
              useSquareCells 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-700 text-gray-300'
            }`}
          >
            {useSquareCells ? 'Square Cells' : 'Rectangular Cells'}
          </button>
        </div>

        {/* Theme Toggle */}
        <div className="space-y-2">
          <label className="text-sm text-white">Theme</label>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={`w-full px-2 py-1 rounded text-sm ${
              theme === 'dark' 
                ? 'bg-gray-700 text-white' 
                : 'bg-gray-200 text-gray-900'
            }`}
          >
            {theme === 'dark' ? 'Dark Theme' : 'Light Theme'}
          </button>
        </div>
      </div>
    </div>
  );

  // Add drawHeatmap function
  const drawHeatmap = useCallback(() => {
    if (!currentMatrixRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const matrix = currentMatrixRef.current;
    
    // Clear canvas with theme-appropriate background
    ctx.fillStyle = theme === 'dark' ? '#111827' : '#f3f4f6';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(transformRef.current.x, transformRef.current.y);
    ctx.scale(transformRef.current.k, transformRef.current.k);
    
    // Calculate cell dimensions
    let cellWidth, cellHeight;
    if (useSquareCells) {
      const size = Math.min(canvas.width / matrix[0].length, canvas.height / matrix.length);
      cellWidth = cellHeight = size;
    } else {
      cellWidth = canvas.width / matrix[0].length;
      cellHeight = canvas.height / matrix.length;
    }
    
    // Draw cells
    matrix.forEach((row, i) => {
      row.forEach((cell, j) => {
        if (cell) {
          const x = j * cellWidth;
          const y = i * cellHeight;
          
          ctx.fillStyle = cell.score !== null ? 
            COLORMAP_OPTIONS[selectedColormap][Math.floor(cell.score * (COLORMAP_OPTIONS[selectedColormap].length - 1))] : 
            (theme === 'dark' ? '#1a1a1a' : '#e5e5e5');
          
          ctx.fillRect(x, y, cellWidth, cellHeight);
          ctx.strokeStyle = theme === 'dark' ? '#2a2a2a' : '#d1d5db';
          ctx.strokeRect(x, y, cellWidth, cellHeight);
        }
      });
    });
    
    ctx.restore();
  }, [theme, useSquareCells, selectedColormap]);

  // Update matrix when generation changes
  useEffect(() => {
    if (matrixData && selectedGeneration >= 0) {
      const rawMatrix = matrixData.scoreAndGenomeMatrices[selectedGeneration];
      const dimensions = getMatrixDimensions(rawMatrix);
      const flattened = flatten2D(rawMatrix, dimensions);
      currentMatrixRef.current = flattened;
      drawHeatmap();
    }
  }, [matrixData, selectedGeneration, drawHeatmap]);

  // Handle canvas resize
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
        drawHeatmap();
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial size

    return () => window.removeEventListener('resize', handleResize);
  }, [drawHeatmap]);

  // Initialize zoom behavior in useEffect
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const zoom = d3.zoom()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        drawHeatmap();
      });

    const canvas = d3.select(canvasRef.current);
    canvas.call(zoom);

    // Set initial zoom transform
    canvas.call(
      zoom.transform,
      d3.zoomIdentity
        .translate(0, 0)
        .scale(1)
    );
  }, [drawHeatmap]);

  // Initialize to last generation when data loads - only once
  useEffect(() => {
    if (matrixData && selectedGeneration === 0) {
      const lastGen = matrixData.scoreAndGenomeMatrices.length - 1;
      setSelectedGeneration(lastGen);
    }
  }, [matrixData, selectedGeneration]);

  // Handle keyboard events for silent mode toggle
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Alt' && e.type === 'keydown') {
        e.preventDefault();
        setSilentMode(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Add mouse interaction handlers
  const handleMouseMove = useCallback((event) => {
    if (!matrixData || !canvasRef.current || !hasAudioInteraction || silentMode) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left - transformRef.current.x) / transformRef.current.k;
    const y = (event.clientY - rect.top - transformRef.current.y) / transformRef.current.k;
    
    const matrix = currentMatrixRef.current;
    if (!matrix) return;

    // Calculate cell dimensions
    let cellWidth, cellHeight;
    if (useSquareCells) {
      const size = Math.min(canvasRef.current.width / matrix[0].length, canvasRef.current.height / matrix.length);
      cellWidth = cellHeight = size;
    } else {
      cellWidth = canvasRef.current.width / matrix[0].length;
      cellHeight = canvasRef.current.height / matrix.length;
    }

    // Get cell indices
    const i = Math.floor(y / cellHeight);
    const j = Math.floor(x / cellWidth);

    // Check if within bounds and cell exists
    if (i >= 0 && i < matrix.length && j >= 0 && j < matrix[0].length && matrix[i][j]) {
      const cell = matrix[i][j];
      
      // Create a unique cell identifier based on position and genomeId
      const cellKey = `${i}-${j}-${cell.genomeId}`;
      
      // Only trigger if this is a different cell than the currently hovered one
      if (currentHoveredCellRef.current !== cellKey) {
        currentHoveredCellRef.current = cellKey;
        
        // Use the same approach as PhylogeneticViewer - pass data to onCellHover for hover
        if (onCellHover && cell.genomeId) {
          // Add debouncing logic like PhylogeneticViewer
          const now = Date.now();
          const lastHover = hoverTimestampsRef.current.get(cell.genomeId) || 0;
          
          // Same debouncing approach as PhylogeneticViewer
          const minTimeBetweenHovers = 30; // ms, same as PhylogeneticViewer
          
          if (now - lastHover < minTimeBetweenHovers) {
            console.log('Debouncing rapid hover on cell:', cell.genomeId);
            return;
          }
          
          hoverTimestampsRef.current.set(cell.genomeId, now);
          
          const config = matrixData.evolutionRunConfig;
          onCellHover({
            data: {
              id: cell.genomeId,
              genomeId: cell.genomeId,
              score: cell.score,
              generation: selectedGeneration,
              position: { i, j }
            },
            experiment,
            evoRunId,
            config: {
              duration: config.classScoringDurations[0],
              noteDelta: config.classScoringNoteDeltas[0],
              velocity: config.classScoringVelocities[0]
            }
          });
        }
      }
    } else {
      // Clear current hovered cell when mouse is not over any valid cell
      currentHoveredCellRef.current = null;
    }
  }, [matrixData, hasAudioInteraction, useSquareCells, experiment, evoRunId, onCellHover, selectedGeneration, silentMode]);

  // Add click handler for adding sounds to sequence (similar to PhylogeneticViewer)
  const handleCanvasClick = useCallback((event) => {
    if (!matrixData || !canvasRef.current || !hasAudioInteraction) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left - transformRef.current.x) / transformRef.current.k;
    const y = (event.clientY - rect.top - transformRef.current.y) / transformRef.current.k;
    
    const matrix = currentMatrixRef.current;
    if (!matrix) return;

    // Calculate cell dimensions
    let cellWidth, cellHeight;
    if (useSquareCells) {
      const size = Math.min(canvasRef.current.width / matrix[0].length, canvasRef.current.height / matrix.length);
      cellWidth = cellHeight = size;
    } else {
      cellWidth = canvasRef.current.width / matrix[0].length;
      cellHeight = canvasRef.current.height / matrix.length;
    }

    // Get cell indices
    const i = Math.floor(y / cellHeight);
    const j = Math.floor(x / cellWidth);

    // Check if within bounds and cell exists
    if (i >= 0 && i < matrix.length && j >= 0 && j < matrix[0].length && matrix[i][j]) {
      const cell = matrix[i][j];
      
      // Use the same approach as PhylogeneticViewer - pass data to onCellHover with addToSequence flag
      if (onCellHover && cell.genomeId) {
        const config = matrixData.evolutionRunConfig;
        onCellHover({
          data: {
            id: cell.genomeId,
            genomeId: cell.genomeId,
            score: cell.score,
            generation: selectedGeneration,
            position: { i, j },
            duration: config.classScoringDurations[0],
            noteDelta: config.classScoringNoteDeltas[0],
            velocity: config.classScoringVelocities[0]
          },
          experiment,
          evoRunId,
          config: {
            addToSequence: true, // This is the key flag for SequencingUnit
            duration: config.classScoringDurations[0],
            noteDelta: config.classScoringNoteDeltas[0],
            velocity: config.classScoringVelocities[0]
          }
        });
      }
    }
  }, [matrixData, hasAudioInteraction, useSquareCells, experiment, evoRunId, onCellHover, selectedGeneration]);

  // SVG export function
  const handleExportSVG = useCallback(() => {
    if (!canvasRef.current) return;
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const width = canvasRef.current.width;
    const height = canvasRef.current.height;
    
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('x', 0);
    img.setAttribute('y', 0);
    img.setAttribute('width', width);
    img.setAttribute('height', height);
    img.setAttribute('href', canvasRef.current.toDataURL('image/png'));
    
    svg.appendChild(img);
    
    const svgString = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `heatmap-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  // Update return statement to include mouse events
  return (
    <div 
      className={`relative flex-1 ${theme === 'light' ? 'bg-gray-100' : 'bg-gray-950'}`}
      ref={containerRef}
      style={{ height: 'calc(100vh - 4rem)' }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ display: 'block' }}
        onMouseMove={handleMouseMove}
        onClick={hasAudioInteraction ? handleCanvasClick : () => onAudioInteraction()}
      />
      
      {!hasAudioInteraction && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-gray-800/90 px-4 py-3 rounded text-white text-sm">
            Click anywhere to enable audio playback
          </div>
        </div>
      )}

      {/* Add generation slider */}
      {matrixData && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-900/80 backdrop-blur rounded">
          <div className="flex items-center gap-4">
            <span className="text-white text-sm">Generation: {selectedGeneration * 500}</span>
            <input
              type="range"
              min={0}
              max={matrixData.scoreAndGenomeMatrices.length - 1}
              value={selectedGeneration}
              onChange={(e) => setSelectedGeneration(Number(e.target.value))}
              className="w-48"
            />
          </div>
        </div>
      )}

      {/* Bottom-left instructions and controls */}
      <div className="fixed bottom-2 left-2 text-white/70 text-xs flex items-center gap-2 z-50">
        <button
          onClick={handleExportSVG}
          className="p-1.5 rounded bg-gray-800/80 hover:bg-gray-700/80 text-white mr-2"
          title="Export as SVG"
        >
          <Download size={16} />
        </button>
        <span>Hover: {silentMode ? 'navigation only' : 'play sound'} • Click: add to sequence</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSilentMode(prev => !prev);
          }}
          className={`px-2 py-1 rounded text-xs transition-colors ${
            silentMode 
              ? 'bg-blue-600 text-white' 
              : 'bg-gray-800/80 text-gray-400 hover:text-white'
          }`}
        >
          {silentMode ? 'Silent Mode On' : 'Silent Mode Off'}
        </button>
        <span className="text-gray-500">(Alt to toggle)</span>
      </div>

      {/* Settings Panel */}
      {showSettings && renderSettings()}
    </div>
  );
};

export default HeatmapViewer;