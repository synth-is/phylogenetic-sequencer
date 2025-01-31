import { useState, useEffect, useRef, useCallback } from 'react';
import { Settings, Download } from 'lucide-react';
import * as d3 from 'd3';
import {el} from '@elemaudio/core';
import WebRenderer from '@elemaudio/web-renderer';
import { LINEAGE_SOUNDS_BUCKET_HOST } from '../constants';

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
  matrixUrl,
  hasAudioInteraction,
  onAudioInteraction
}) => {
  // Add cache for audio files
  const audioBufferCacheRef = useRef(new Map());
  const MAX_CACHE_SIZE = 20; // Limit cache size
  
  // All refs
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const transformRef = useRef(d3.zoomIdentity);
  const currentMatrixRef = useRef(null);
  const rendererRef = useRef(null);
  const contextRef = useRef(null);
  const activeVoicesRef = useRef(new Map());
  const triggerSourceRef = useRef(null);
  const currentlyPlayingCellRef = useRef(null);
  const throttleTimeoutRef = useRef(null);
  const lastPlayedCellRef = useRef(null);
  const audioDataCache = useRef(new Map());

  // All state
  const [matrixData, setMatrixData] = useState(null);
  const [reverbAmount, setReverbAmount] = useState(5);
  const [maxVoices, setMaxVoices] = useState(4);
  const [selectedGeneration, setSelectedGeneration] = useState(0);
  const [selectedColormap, setSelectedColormap] = useState('plasma');
  const [theme, setTheme] = useState('dark');
  const [useSquareCells, setUseSquareCells] = useState(true);
  const [rendererReady, setRendererReady] = useState(false);

  // Add matrix data loading effect
  useEffect(() => {
    if (!matrixUrl) return;
    
    console.log('Fetching matrix data for URL:', matrixUrl);
    
    fetch(matrixUrl)
      .then(response => response.json())
      .then(data => {
        setMatrixData(data);
      })
      .catch(error => console.error('Error loading matrix data:', error));
  }, [matrixUrl]);

  // Replace AudioManager refs with Elementary refs

  // Initialize Elementary on component mount
  useEffect(() => {
    let mounted = true;
    let audioCtx = null;
    
    const setupAudio = async () => {
      try {
        audioCtx = new AudioContext();
        await audioCtx.resume();
  
        const core = new WebRenderer();
        console.log('Setting up audio, context state:', audioCtx.state);
  
        await new Promise(resolve => setTimeout(resolve, 0));
        
        const node = await core.initialize(audioCtx, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
  
        console.log('Core initialized');
        node.connect(audioCtx.destination);
        
        if (!mounted) return;
  
        console.log('Elementary Audio engine initialized');
        rendererRef.current = core;
        contextRef.current = audioCtx;
        setRendererReady(true);
  
      } catch (err) {
        console.error('Error initializing Elementary Audio:', err);
      }
    };
  
    setupAudio();
  
    return () => {
      mounted = false;
      if (audioCtx?.state !== 'closed') {
        audioCtx.close();
      }
    };
  }, []);

  // Load reverb impulse response
  useEffect(() => {
    if (!rendererReady) return;

    const loadReverb = async () => {
      try {
        const response = await fetch('/WIDEHALL-1.wav');
        const arrayBuffer = await response.arrayBuffer();
        const audioData = await rendererRef.current.context.decodeAudioData(arrayBuffer);

        await rendererRef.current.updateVirtualFileSystem({
          'reverb-ir': audioData.getChannelData(0)
        });

        console.log('Reverb IR loaded');
      } catch (err) {
        console.error('Error loading reverb:', err);
      }
    };

    loadReverb();
  }, [rendererReady]);

  // Add cache cleanup function with safe VFS update
  const cleanupOldestCache = useCallback(async () => {
    if (audioBufferCacheRef.current.size >= MAX_CACHE_SIZE) {
      const [oldestKey] = audioBufferCacheRef.current.keys();
      audioBufferCacheRef.current.delete(oldestKey);
      if (rendererRef.current) {
        try {
          const vfsUpdate = {};
          vfsUpdate[oldestKey] = new Float32Array(0); // Provide empty array instead of null
          await rendererRef.current.updateVirtualFileSystem(vfsUpdate);
        } catch (error) {
          console.error('Error cleaning up VFS:', error);
        }
      }
    }
  }, []);

  // Update playSound to handle VFS properly
  const playSound = useCallback(async (cell, indices) => {
    if (!hasAudioInteraction || !rendererReady || !rendererRef.current || !matrixData) return;
    if (!cell.genomeId) return; // Skip cells without genomeId

    // Throttle sound triggering
    if (throttleTimeoutRef.current) return;
    
    // Don't replay the same cell
    const cellKey = `${indices.i}-${indices.j}`;
    if (lastPlayedCellRef.current === cellKey) return;
    lastPlayedCellRef.current = cellKey;

    try {
      const config = matrixData.evolutionRunConfig;
      const vfsKey = `sound-${cell.genomeId}`;

      let audioData;
      // Check both caches
      if (!audioDataCache.current.has(vfsKey)) {
        await cleanupOldestCache();
        
        const fileName = `${cell.genomeId}-${config.classScoringDurations[0]}_${config.classScoringNoteDeltas[0]}_${config.classScoringVelocities[0]}.wav`;
        const audioUrl = `${LINEAGE_SOUNDS_BUCKET_HOST}/${experiment}/${evoRunId}/${fileName}`;

        const response = await fetch(audioUrl, {
          mode: 'cors',
          headers: { 'Accept': 'audio/wav, audio/*' }
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const arrayBuffer = await response.arrayBuffer();
        audioData = await rendererRef.current.context.decodeAudioData(arrayBuffer);
        
        // Cache the audio data
        audioDataCache.current.set(vfsKey, audioData);
      } else {
        audioData = audioDataCache.current.get(vfsKey);
      }

      // Update or create VFS entry
      const vfsUpdate = {};
      vfsUpdate[vfsKey] = audioData.getChannelData(0);
      await rendererRef.current.updateVirtualFileSystem(vfsUpdate);

      // Create or update trigger with correct duration
      const triggerRate = 1 / audioData.duration;
      const trigger = el.train(
        el.const({ key: `rate-${cell.genomeId}`, value: triggerRate })
      );

      // Create new voice
      const newVoice = el.mul(
        el.mul(
          el.sample(
            { path: vfsKey, mode: 'trigger', key: `sample-${cell.genomeId}` },
            trigger,
            el.const({ key: `playback-rate-${cell.genomeId}`, value: 1 })
          ),
          el.adsr(0.01, 0.1, 0.7, 0.3, trigger)
        ),
        el.const({ key: `voice-gain-${cell.genomeId}`, value: 1 / maxVoices })
      );

      // Manage voices
      if (activeVoicesRef.current.size >= maxVoices) {
        const [oldestKey] = activeVoicesRef.current.keys();
        activeVoicesRef.current.delete(oldestKey);
      }
      activeVoicesRef.current.set(cell.genomeId, newVoice);

      // Mix voices
      const voices = Array.from(activeVoicesRef.current.values());
      let mix = voices.length > 1 ? el.add(...voices) : voices[0];

      // Add reverb
      if (reverbAmount > 0) {
        const reverbSignal = el.mul(
          el.convolve({ path: 'reverb-ir', key: `reverb-${cell.genomeId}` }, mix),
          el.const({ key: `wet-gain-${cell.genomeId}`, value: reverbAmount / 100 * 0.3 })
        );
        const drySignal = el.mul(
          mix,
          el.const({ key: `dry-gain-${cell.genomeId}`, value: 1 - (reverbAmount / 100) })
        );
        mix = el.mul(
          el.add(drySignal, reverbSignal),
          el.const({ key: `master-gain-${cell.genomeId}`, value: 0.7 })
        );
      }

      await rendererRef.current.render(mix, mix);
      currentlyPlayingCellRef.current = indices;
      requestAnimationFrame(drawHeatmap);

      // Set throttle timeout based on audio duration
      throttleTimeoutRef.current = setTimeout(() => {
        throttleTimeoutRef.current = null;
        lastPlayedCellRef.current = null;
      }, audioData.duration * 1000); // Convert to milliseconds

    } catch (error) {
      console.error('Error playing sound:', error);
      throttleTimeoutRef.current = null;
      lastPlayedCellRef.current = null;
    }
  }, [experiment, evoRunId, hasAudioInteraction, rendererReady, maxVoices, reverbAmount, matrixData, cleanupOldestCache]);

  // Update cleanup
  useEffect(() => {
    return () => {
      // Clear audio cache with proper VFS cleanup
      if (rendererRef.current) {
        const vfsUpdate = {};
        Array.from(audioBufferCacheRef.current.keys()).forEach(key => {
          vfsUpdate[key] = new Float32Array(0);
        });
        rendererRef.current.updateVirtualFileSystem(vfsUpdate).catch(console.error);
      }
      audioBufferCacheRef.current.clear();
      activeVoicesRef.current.clear();
      
      if (contextRef.current?.state !== 'closed') {
        contextRef.current?.close();
      }
      if (throttleTimeoutRef.current) {
        clearTimeout(throttleTimeoutRef.current);
      }
      audioDataCache.current.clear();
    };
  }, []);

  // Add reverb change handler
  const handleReverbChange = useCallback((e) => {
    setReverbAmount(Number(e.target.value));
  }, []);

  // Enhance settings panel with polyphony control
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

        {/* ...existing settings... */}

        {/* Add Reverb Control */}
        <div className="space-y-2">
          <label className="text-sm text-white">Reverb Amount</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              className="flex-1 h-2 bg-gray-700"
              min="0"
              max="100"
              value={reverbAmount}
              onChange={handleReverbChange}
            />
            <span className="text-sm text-gray-300 w-8">{reverbAmount}%</span>
          </div>
        </div>

        {/* Add Polyphony Control */}
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

        {/* ...rest of existing settings... */}
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

  // Initialize to last generation when data loads - moved up
  useEffect(() => {
    if (matrixData) {
      const lastGen = matrixData.scoreAndGenomeMatrices.length - 1;
      setSelectedGeneration(lastGen);
    }
  }, [matrixData]);

  // Add mouse interaction handlers
  const handleMouseMove = useCallback((event) => {
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
      playSound(matrix[i][j], { i, j });
    }
  }, [matrixData, hasAudioInteraction, useSquareCells, playSound]);

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
        onClick={() => {
          if (!hasAudioInteraction && contextRef.current) {
            contextRef.current.resume().then(() => {
              onAudioInteraction();
            });
          }
        }}
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

      {/* ...existing settings panel and other UI elements... */}
    </div>
  );
};

export default HeatmapViewer;