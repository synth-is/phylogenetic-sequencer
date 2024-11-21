import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Settings, Download } from 'lucide-react';
import * as d3 from 'd3';
import { LINEAGE_SOUNDS_BUCKET_HOST } from '../constants';
import AudioManager from './AudioManager';

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

const EXPORT_WITH_GRID = true;  // Set to true to include grid lines in SVG export
const GRID_CANVAS_EXTENSION = 200;  // Number of cells to extend the grid beyond the heatmap
const GRID_OPACITY = 0.83;  // Opacity of the extended grid

const HeatmapViewer = ({
  showSettings,
  setShowSettings,
  experiment,
  evoRunId,
  matrixUrl,
  hasAudioInteraction,
  onAudioInteraction
}) => {
  // Original state
  const [matrixData, setMatrixData] = useState(null);
  const [selectedGeneration, setSelectedGeneration] = useState(2);
  const [selectedColormap, setSelectedColormap] = useState('plasma');
  const [tooltip, setTooltip] = useState({ show: false, content: '', x: 0, y: 0 });
  const [maxVoices, setMaxVoices] = useState(4);
  const [silentMode, setSilentMode] = useState(false);
  
  // UI state
  const [useSquareCells, setUseSquareCells] = useState(true);
  const [theme, setTheme] = useState('dark');
  const [reverbAmount, setReverbAmount] = useState(5);
  const [activeCells, setActiveCells] = useState(new Map());
  
  // Refs
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const transformRef = useRef(d3.zoomIdentity);
  const audioManagerRef = useRef(null);
  const audioContextRef = useRef(null);
  const mouseMoveThrottleRef = useRef(null);
  const currentCellRef = useRef(null);
  const currentlyPlayingCellRef = useRef(null);
  const hasInteractedRef = useRef(false);
  const currentMatrixRef = useRef(null);
  const lastMatrixUrlRef = useRef(null);
  const mountedRef = useRef(false);


  // Initialize Audio Context
  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Set hasInteracted when audio interaction is enabled
    if (hasAudioInteraction) {
      hasInteractedRef.current = true;
    }
  }, [hasAudioInteraction]);

  // Initialize AudioManager
  useEffect(() => {
    if (!audioManagerRef.current && audioContextRef.current) {
      audioManagerRef.current = new AudioManager(audioContextRef.current);
      audioManagerRef.current.initialize();
      audioManagerRef.current.maxVoices = maxVoices;
    }
  }, [maxVoices]);

  // Update AudioManager maxVoices when setting changes
  useEffect(() => {
    if (audioManagerRef.current) {
      audioManagerRef.current.maxVoices = maxVoices;
    }
  }, [maxVoices]);

  // Update reverb mix
  useEffect(() => {
    if (audioManagerRef.current) {
      audioManagerRef.current.setReverbMix(reverbAmount);
    }
  }, [reverbAmount]);

  // Handle cleanup
  useEffect(() => {
    return () => {
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, []);

  // Add sync effect for audio interaction state
  useEffect(() => {
    if (hasAudioInteraction && audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().catch(console.error);
    }
  }, [hasAudioInteraction]);



  // Fetch matrix data only when URL changes
  useEffect(() => {
    if (!matrixUrl || matrixUrl === lastMatrixUrlRef.current || mountedRef.current) return;
    
    console.log('Fetching matrix data for URL:', matrixUrl);
    lastMatrixUrlRef.current = matrixUrl;
    mountedRef.current = true;
    
    fetch(matrixUrl)
      .then(response => response.json())
      .then(data => {
        setMatrixData(data);
        setSelectedGeneration(data.scoreAndGenomeMatrices.length - 1);
      })
      .catch(error => console.error('Error loading matrix data:', error));
  }, [matrixUrl]);


  // Initialize to last generation
  useEffect(() => {
    if (matrixData) {
      setSelectedGeneration(matrixData.scoreAndGenomeMatrices.length - 1);
    }
  }, [matrixData]);

  const getColorForValue = useCallback((value) => {
    if (value === null) return theme === 'dark' ? '#1a1a1a' : '#e5e5e5';
    
    const colors = COLORMAP_OPTIONS[selectedColormap];
    const index = Math.floor(value * (colors.length - 1));
    return colors[index];
  }, [selectedColormap, theme]);

  // Update matrix ref when generation changes
  useEffect(() => {
    if (matrixData && selectedGeneration >= 0) {
      currentMatrixRef.current = matrixData.scoreAndGenomeMatrices[selectedGeneration];
    }
  }, [matrixData, selectedGeneration]);

  // Update drawHeatmap to use the stored matrix
  const drawHeatmap = useCallback(() => {
    if (!currentMatrixRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const matrix = currentMatrixRef.current;  // Use stored matrix instead of accessing via selectedGeneration
    
    const width = canvas.width;
    const height = canvas.height;
    const transform = transformRef.current;
    
    // Clear canvas with theme-appropriate background
    ctx.fillStyle = theme === 'dark' ? '#111827' : '#f3f4f6';
    ctx.fillRect(0, 0, width, height);
    
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);
    
    // Calculate cell dimensions
    let cellWidth, cellHeight;
    if (useSquareCells) {
      const size = Math.min(width / matrix[0].length, height / matrix.length);
      cellWidth = cellHeight = size;
    } else {
      cellWidth = width / matrix[0].length;
      cellHeight = height / matrix.length;
    }
    
    // Draw cells
    matrix.forEach((row, i) => {
      row.forEach((cell, j) => {
        const x = j * cellWidth;
        const y = i * cellHeight;
        
        const playingCell = currentlyPlayingCellRef.current;
        if (playingCell?.i === i && 
            playingCell?.j === j && 
            playingCell?.generation === selectedGeneration) {
          ctx.fillStyle = '#ff0000';
        } else {
          ctx.fillStyle = getColorForValue(cell.score);
        }
        
        ctx.fillRect(x, y, cellWidth, cellHeight);
        ctx.strokeStyle = theme === 'dark' ? '#2a2a2a' : '#d1d5db';
        ctx.strokeRect(x, y, cellWidth, cellHeight);
      });
    });
    
    ctx.restore();
  }, [getColorForValue, theme, useSquareCells, selectedGeneration]); 

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
        drawHeatmap();
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, [drawHeatmap]);

  // Initialize zoom behavior
  const zoomBehaviorRef = useRef(null);

  // Initialize zoom behavior once
  useEffect(() => {
    if (!canvasRef.current || !matrixData || zoomBehaviorRef.current) return;
  
    zoomBehaviorRef.current = d3.zoom()
      .scaleExtent([0.1, 10])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        drawHeatmap();
      });
  
    const canvas = d3.select(canvasRef.current);
    
    // Enable zoom behavior
    canvas.call(zoomBehaviorRef.current)
      .call(
        zoomBehaviorRef.current.transform,
        d3.zoomIdentity
          .translate(0, 0)
          .scale(1)
      );
  
    return () => {
      if (zoomBehaviorRef.current) {
        canvas.on('.zoom', null);
        zoomBehaviorRef.current = null;
      }
    };
  }, [matrixData]);



  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'Alt') {
        setSilentMode(e.type === 'keydown');
      }
    };
  
    window.addEventListener('keydown', handleKeyPress);
    window.addEventListener('keyup', handleKeyPress);
  
    return () => {
      window.removeEventListener('keydown', handleKeyPress);
      window.removeEventListener('keyup', handleKeyPress);
    };
  }, []);


  const getMatrixIndices = useCallback((canvasX, canvasY) => {
    if (!matrixData || !canvasRef.current) return null;
  
    const matrix = matrixData.scoreAndGenomeMatrices[selectedGeneration];
    const transform = transformRef.current;
    
    // Convert canvas coordinates to matrix space
    const x = (canvasX - transform.x) / transform.k;
    const y = (canvasY - transform.y) / transform.k;
    
    let cellWidth, cellHeight;
    if (useSquareCells) {
      const size = Math.min(canvasRef.current.width / matrix[0].length, canvasRef.current.height / matrix.length);
      cellWidth = cellHeight = size;
    } else {
      cellWidth = canvasRef.current.width / matrix[0].length;
      cellHeight = canvasRef.current.height / matrix.length;
    }
    
    const i = Math.floor(y / cellHeight);
    const j = Math.floor(x / cellWidth);
    
    if (i >= 0 && i < matrix.length && j >= 0 && j < matrix[0].length) {
      return { i, j };
    }
    return null;
  }, [matrixData, selectedGeneration, useSquareCells]);  

  const playSound = useCallback(async (cell, indices) => {
    if (!hasAudioInteraction || !audioManagerRef.current || !matrixData) return;
  
    try {
      console.log('Attempting to play sound for cell:', cell);
      const config = matrixData.evolutionRunConfig;
      const audioUrl = `${LINEAGE_SOUNDS_BUCKET_HOST}/${experiment}/${evoRunId}/${cell.genomeId}-${config.classScoringDurations[0]}_${config.classScoringNoteDeltas[0]}_${config.classScoringVelocities[0]}.wav`;
      
      console.log('Audio URL:', audioUrl);
      const result = await audioManagerRef.current.playSound(audioUrl, indices);
      
      if (result) {
        currentlyPlayingCellRef.current = {
          ...indices,
          generation: selectedGeneration
        };
        requestAnimationFrame(drawHeatmap);
        
        const voice = audioManagerRef.current.voices.get(result.voiceId);
        if (voice?.source) {
          voice.source.onended = () => {
            if (currentlyPlayingCellRef.current?.generation === selectedGeneration) {
              currentlyPlayingCellRef.current = null;
              requestAnimationFrame(drawHeatmap);
            }
          };
        }
      }
    } catch (error) {
      console.error('Error playing sound:', error);
    }
  }, [matrixData, experiment, evoRunId, selectedGeneration, hasAudioInteraction]);

  // Add debounce/throttle for mouse movement
// Only change the handleMouseMove callback to match the matrix being displayed:
  const handleMouseMove = useCallback((event) => {
    if (!matrixData || !canvasRef.current || !hasAudioInteraction) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const canvasX = event.clientX - rect.left;
    const canvasY = event.clientY - rect.top;
    
    const indices = getMatrixIndices(canvasX, canvasY);
    
    if (indices) {
      const { i, j } = indices;
      const matrix = matrixData.scoreAndGenomeMatrices[selectedGeneration];
      const cell = matrix[i][j];
      
      if (cell.score !== null) {
        setTooltip({
          show: true,
          content: `Score: ${cell.score.toFixed(3)} (Gen ${selectedGeneration * 500})`,
          x: event.clientX,
          y: event.clientY
        });
        
        const cellKey = `${i}-${j}`;
        const currentKey = currentCellRef.current ? 
          `${currentCellRef.current.i}-${currentCellRef.current.j}` : null;
        
        if (cellKey !== currentKey) {
          currentCellRef.current = { i, j };
          
          if (!silentMode && !audioManagerRef.current?.isCellPlaying(i, j)) {
            console.log('Playing sound for cell:', cell);
            playSound(cell, { i, j });
          }
        }
      } else {
        setTooltip({ show: false, content: '', x: 0, y: 0 });
        currentCellRef.current = null;
      }
    } else {
      setTooltip({ show: false, content: '', x: 0, y: 0 });
      currentCellRef.current = null;
    }
  }, [matrixData, selectedGeneration, silentMode, getMatrixIndices, playSound, hasAudioInteraction]);

  useEffect(() => {
    if (hasAudioInteraction && audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().catch(console.error);
    }
  }, [hasAudioInteraction]);
  
  // Update click handler
  const handleClick = async (e) => {
    e.stopPropagation();
    if (!hasAudioInteraction && audioContextRef.current) {
      try {
        await audioContextRef.current.resume();
        onAudioInteraction();
        hasInteractedRef.current = true;
      } catch (error) {
        console.error('Error initializing audio:', error);
      }
    }
  };

  const handleExportSVG = useCallback(() => {
    if (!canvasRef.current || !currentMatrixRef.current) return;
      
    const matrix = currentMatrixRef.current;
    
    // Calculate dimensions including extension for grid
    const contentWidth = matrix[0].length;
    const contentHeight = matrix.length;
    const totalWidth = EXPORT_WITH_GRID ? contentWidth + (GRID_CANVAS_EXTENSION * 2) : contentWidth;
    const totalHeight = EXPORT_WITH_GRID ? contentHeight + (GRID_CANVAS_EXTENSION * 2) : contentHeight;
    
    // Create SVG with extended dimensions
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', totalWidth);
    svg.setAttribute('height', totalHeight);
    svg.setAttribute('viewBox', `0 0 ${totalWidth} ${totalHeight}`);
  
    // Create a group for the content, translated to accommodate grid extension
    const contentGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    if (EXPORT_WITH_GRID) {
      contentGroup.setAttribute('transform', `translate(${GRID_CANVAS_EXTENSION},${GRID_CANVAS_EXTENSION})`);
    }
    
    // Group cells by color but maintain original resolution
    const colorGroups = new Map();
  
    for (let y = 0; y < contentHeight; y++) {
      for (let x = 0; x < contentWidth; x++) {
        const cell = matrix[y][x];
        if (cell.score !== null) {
          const color = getColorForValue(cell.score);
          if (!colorGroups.has(color)) {
            colorGroups.set(color, []);
          }
          colorGroups.get(color).push({ x, y, width: 1, height: 1 });
        }
      }
    }
  
    // Create elements grouped by color
    for (const [color, rects] of colorGroups) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('fill', color);
      
      const pathData = rects.map(rect => 
        `M${rect.x},${rect.y}h1v1h-1z`
      ).join(' ');
      
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', pathData);
      g.appendChild(path);
      
      contentGroup.appendChild(g);
    }
  
    svg.appendChild(contentGroup);
  
    // Only add grid if enabled
    if (EXPORT_WITH_GRID) {
      const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      gridGroup.setAttribute('class', 'grid');
      gridGroup.setAttribute('stroke', theme === 'dark' ? '#2a2a2a' : '#d1d5db');
      gridGroup.setAttribute('stroke-width', '0.05');
      gridGroup.setAttribute('opacity', GRID_OPACITY.toString());
  
      // Add vertical and horizontal lines for entire extended canvas
      for (let x = 0; x <= totalWidth; x++) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x);
        line.setAttribute('y1', 0);
        line.setAttribute('x2', x);
        line.setAttribute('y2', totalHeight);
        gridGroup.appendChild(line);
      }
  
      for (let y = 0; y <= totalHeight; y++) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', 0);
        line.setAttribute('y1', y);
        line.setAttribute('x2', totalWidth);
        line.setAttribute('y2', y);
        gridGroup.appendChild(line);
      }
  
      svg.appendChild(gridGroup);
    }
  
    // Add metadata with extended information
    const metadata = document.createElementNS('http://www.w3.org/2000/svg', 'metadata');
    metadata.textContent = JSON.stringify({
      type: 'heatmap',
      dimensions: {
        content: { width: contentWidth, height: contentHeight },
        total: { width: totalWidth, height: totalHeight },
        gridExtension: GRID_CANVAS_EXTENSION
      },
      generation: selectedGeneration,
      hasGrid: EXPORT_WITH_GRID,
      timestamp: Date.now()
    });
    svg.appendChild(metadata);
  
    // Convert to string (maintain precision)
    const svgString = new XMLSerializer().serializeToString(svg);
    
    // Create download link with original dimensions preserved
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `heatmap-${contentWidth}x${contentHeight}-gen${selectedGeneration}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [getColorForValue, selectedGeneration, theme]);

  if (!matrixData) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        Loading matrix data...
      </div>
    );
  }

  // Settings panel enhanced with polyphony control
  const renderSettings = () => (
    <div className="absolute right-0 top-12 p-4 bg-gray-900/95 backdrop-blur rounded-l w-64">
      <div className="space-y-4">
        {/* Existing settings... */}

        <div>
          <label className="text-sm text-white">Color Palette</label>
          <select
            value={selectedColormap}
            onChange={(e) => setSelectedColormap(e.target.value)}
            className="mt-1 w-full bg-gray-800 text-white rounded px-2 py-1 text-sm"
          >
            {Object.keys(COLORMAP_OPTIONS).map(name => (
              <option key={name} value={name}>
                {name.charAt(0).toUpperCase() + name.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-white">Cell Shape</label>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-gray-300">
            <input
              type="checkbox"
              checked={useSquareCells}
              onChange={(e) => setUseSquareCells(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            Use square cells
          </label>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-white">Reverb Amount</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              className="flex-1 h-2 bg-gray-700"
              min="0"
              max="100"
              value={reverbAmount}
              onChange={(e) => setReverbAmount(Number(e.target.value))}
            />
            <span className="text-sm text-gray-300 w-8">{reverbAmount}%</span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-white">Appearance</label>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-gray-300">
            <input
              type="checkbox"
              checked={theme === 'light'}
              onChange={(e) => setTheme(e.target.checked ? 'light' : 'dark')}
              className="rounded bg-gray-700 border-gray-600"
            />
            Light theme
          </label>
        </div>

        <div className="space-y-2">
          <label className="text-sm text-white">Coverage</label>
          <p className="text-sm text-gray-300">
            {matrixData.coveragePercentage[selectedGeneration]}%
          </p>
        </div>


        {/* New Polyphony Control */}
        <div className="space-y-2">
          <label className="text-sm text-white">Polyphony (Max Voices)</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              className="flex-1 h-2 bg-gray-700"
              min="1"
              max="8"
              step="1"
              value={maxVoices}
              onChange={(e) => setMaxVoices(Number(e.target.value))}
            />
            <span className="text-sm text-gray-300 w-8">{maxVoices}</span>
          </div>
        </div>


        <div className="space-y-2">
          <label className="text-sm text-white">Navigation Mode</label>
          <label className="flex items-center gap-2 text-sm cursor-pointer text-gray-300">
            <input
              type="checkbox"
              checked={silentMode}
              onChange={(e) => setSilentMode(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600"
            />
            Silent mode (or hold Alt key)
          </label>
        </div>

        {/* Existing settings continue... */}
      </div>
    </div>
  );


  return (
    <div 
      className={`relative flex-1 ${theme === 'light' ? 'bg-gray-100' : 'bg-gray-950'}`} 
      onClick={handleClick} 
      ref={containerRef}
    >
      <canvas
        ref={canvasRef}
        width={800}
        height={800}
        className="w-full h-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          setTooltip({ show: false, content: '', x: 0, y: 0 });
          // Optional: release all voices when mouse leaves
          if (audioManagerRef.current) {
            audioManagerRef.current.cleanup();
            setActiveCells(new Map());
            currentlyPlayingCellRef.current = null;  // Use the ref directly instead of setCurrentlyPlayingCell
            drawHeatmap();  // Redraw to clear the highlighted cell
          }
        }}
      />
      
      {tooltip.show && (
        <div
          className="fixed z-50 px-2 py-1 bg-gray-900 text-white text-sm rounded pointer-events-none"
          style={{
            left: tooltip.x + 10,
            top: tooltip.y - 10
          }}
        >
          {tooltip.content}
        </div>
      )}
      
      {/* Generation slider */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-900/80 backdrop-blur rounded z-50">
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
          <span className="text-white text-sm">
            Coverage: {matrixData.coveragePercentage[selectedGeneration]}%
          </span>
        </div>
      </div>
      
      {/* Enhanced Settings panel */}
      {showSettings && renderSettings()}
      
      {!hasAudioInteraction && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-gray-800/90 px-4 py-3 rounded text-white text-sm">
            Click anywhere to enable audio playback
          </div>
        </div>
      )}

      {/* Add download button */}
      <div className="absolute bottom-2 right-2 z-50">
        <button
          onClick={handleExportSVG}
          className="p-2 rounded-full bg-gray-800/80 hover:bg-gray-700/80 text-white"
          title="Export as SVG"
        >
          <Download size={20} />
        </button>
      </div>
    </div>
  );
};

export default HeatmapViewer;