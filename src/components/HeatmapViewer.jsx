import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Settings } from 'lucide-react';
import * as d3 from 'd3';

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

const HeatmapViewer = ({ 
  showSettings, 
  setShowSettings,
  experiment,
  matrixUrl
}) => {
  // Original state
  const [matrixData, setMatrixData] = useState(null);
  const [selectedGeneration, setSelectedGeneration] = useState(2);
  const [selectedColormap, setSelectedColormap] = useState('plasma');
  const [hasInteracted, setHasInteracted] = useState(false);
  const [tooltip, setTooltip] = useState({ show: false, content: '', x: 0, y: 0 });
  
  // New state for additional features
  const [useSquareCells, setUseSquareCells] = useState(true);
  const [theme, setTheme] = useState('dark');
  const [reverbAmount, setReverbAmount] = useState(5);
  const [currentlyPlayingCell, setCurrentlyPlayingCell] = useState(null);

  // Original refs
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const transformRef = useRef(d3.zoomIdentity);
  const audioContextRef = useRef(null);
  const currentSourceRef = useRef(null);
  const currentGainNodeRef = useRef(null);
  
  // New refs for additional features
  const currentPlayingUrlRef = useRef(null);
  const convolverNodeRef = useRef(null);
  const dryGainNodeRef = useRef(null);
  const wetGainNodeRef = useRef(null);

  // Initialize audio context with reverb
  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      convolverNodeRef.current = audioContextRef.current.createConvolver();
      dryGainNodeRef.current = audioContextRef.current.createGain();
      wetGainNodeRef.current = audioContextRef.current.createGain();
  
      dryGainNodeRef.current.connect(audioContextRef.current.destination);
      convolverNodeRef.current.connect(wetGainNodeRef.current);
      wetGainNodeRef.current.connect(audioContextRef.current.destination);
  
      // Load reverb impulse response
      fetch('/WIDEHALL-1.wav')
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => audioContextRef.current.decodeAudioData(arrayBuffer))
        .then(buffer => {
          convolverNodeRef.current.buffer = buffer;
        })
        .catch(error => console.error('Error loading reverb:', error));
    }
  
    // No cleanup of audio context - just cleanup nodes
    return () => {
      if (currentSourceRef.current) {
        currentSourceRef.current.stop();
        currentSourceRef.current.disconnect();
      }
      if (currentGainNodeRef.current) {
        currentGainNodeRef.current.disconnect();
      }
    };
  }, []);

  // Update reverb mix
  useEffect(() => {
    if (!wetGainNodeRef.current || !dryGainNodeRef.current) return;
    
    const wetAmount = reverbAmount / 100;
    wetGainNodeRef.current.gain.setValueAtTime(wetAmount, audioContextRef.current.currentTime);
    dryGainNodeRef.current.gain.setValueAtTime(1 - wetAmount, audioContextRef.current.currentTime);
  }, [reverbAmount]);

  // Fetch matrix data
  useEffect(() => {
    if (!matrixUrl) return;

    fetch(matrixUrl)
      .then(response => response.json())
      .then(data => setMatrixData(data))
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

  const drawHeatmap = useCallback(() => {
    if (!matrixData || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const matrix = matrixData.scoreAndGenomeMatrices[selectedGeneration];
    
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
        
        // Handle currently playing cell
        if (currentlyPlayingCell?.i === i && currentlyPlayingCell?.j === j) {
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
  }, [matrixData, selectedGeneration, getColorForValue, theme, useSquareCells, currentlyPlayingCell]);

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
    canvas.call(zoomBehaviorRef.current);
  
    // Set initial transform
    const initialTransform = d3.zoomIdentity
      .translate(0, 0)
      .scale(1);
    canvas.call(zoomBehaviorRef.current.transform, initialTransform);
  
    return () => {
      if (zoomBehaviorRef.current) {
        canvas.on('.zoom', null);
        zoomBehaviorRef.current = null;
      }
    };
  }, [matrixData]); 

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

  const playAudio = async (genomeId, duration, noteDelta, velocity, cellIndices) => {
    if (!hasInteracted || !audioContextRef.current) return;
    
    const audioUrl = `https://ns9648k.web.sigma2.no/evoConf_singleMap_refSingleEmb_spectralSpreadAndFlux/01JA6KRDQ1JR9A8BKRXCBGBYYB_evoConf_singleMap_refSingleEmb_spectralSpreadAndFlux__2024-10/${genomeId}-${duration}_${noteDelta}_${velocity}.wav`;
    
    // Skip if same sound is already playing
    if (currentPlayingUrlRef.current === audioUrl) return;
    
    try {
      // Cancel any pending cleanup timeouts
      if (window.audioCleanupTimeout) {
        clearTimeout(window.audioCleanupTimeout);
      }
  
      // Smoothly fade out current sound if playing
      if (currentSourceRef.current && currentGainNodeRef.current) {
        const oldGain = currentGainNodeRef.current;
        const oldSource = currentSourceRef.current;
        
        oldGain.gain.cancelScheduledValues(audioContextRef.current.currentTime);
        oldGain.gain.setValueAtTime(oldGain.gain.value, audioContextRef.current.currentTime);
        oldGain.gain.linearRampToValueAtTime(0, audioContextRef.current.currentTime + 0.1);
        
        window.audioCleanupTimeout = setTimeout(() => {
          try {
            oldSource.stop();
            oldSource.disconnect();
            oldGain.disconnect();
          } catch (e) {
            console.error('Error cleaning up old audio:', e);
          }
        }, 100);
      }
      
      currentPlayingUrlRef.current = audioUrl;
      setCurrentlyPlayingCell(cellIndices);
      
      const response = await fetch(audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
      
      currentSourceRef.current = audioContextRef.current.createBufferSource();
      currentSourceRef.current.buffer = audioBuffer;
      
      currentGainNodeRef.current = audioContextRef.current.createGain();
      currentGainNodeRef.current.gain.setValueAtTime(0, audioContextRef.current.currentTime);
      currentGainNodeRef.current.gain.linearRampToValueAtTime(0.5, audioContextRef.current.currentTime + 0.1);
      
      // Connect through reverb chain
      currentSourceRef.current.connect(currentGainNodeRef.current);
      currentGainNodeRef.current.connect(dryGainNodeRef.current);
      currentGainNodeRef.current.connect(convolverNodeRef.current);
      
      currentSourceRef.current.start();
      
      currentSourceRef.current.onended = () => {
        currentPlayingUrlRef.current = null;
        setCurrentlyPlayingCell(null);
      };
    } catch (error) {
      console.error('Error playing audio:', error);
      currentPlayingUrlRef.current = null;
      setCurrentlyPlayingCell(null);
    }
  };

  // Add debounce/throttle for mouse movement
const handleMouseMove = useCallback((event) => {
  if (!matrixData) return;

  const rect = canvasRef.current.getBoundingClientRect();
  const canvasX = event.clientX - rect.left;
  const canvasY = event.clientY - rect.top;
  
  const indices = getMatrixIndices(canvasX, canvasY);
  if (indices) {
    const { i, j } = indices;
    const cell = matrixData.scoreAndGenomeMatrices[selectedGeneration][i][j];
    
    if (cell.score !== null) {
      setTooltip({
        show: true,
        content: `Score: ${cell.score.toFixed(3)}`,
        x: event.clientX,
        y: event.clientY
      });
      
      const config = matrixData.evolutionRunConfig;
      playAudio(
        cell.genomeId,
        config.classScoringDurations[0],
        config.classScoringNoteDeltas[0],
        config.classScoringVelocities[0],
        { i, j }
      );
    } else {
      setTooltip({ show: false, content: '', x: 0, y: 0 });
    }
  } else {
    setTooltip({ show: false, content: '', x: 0, y: 0 });
  }
}, [matrixData, selectedGeneration, getMatrixIndices]);

  const handleClick = async () => {
    if (!hasInteracted) {
      try {
        await audioContextRef.current?.resume();
        setHasInteracted(true);
      } catch (err) {
        console.error('Error resuming audio context:', err);
      }
    }
  };

  if (!matrixData) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400">
        Loading matrix data...
      </div>
    );
  }

  return (
    <div className={`relative flex-1 ${theme === 'light' ? 'bg-gray-100' : 'bg-gray-950'}`} 
         onClick={handleClick} 
         ref={containerRef}>
      <canvas
        ref={canvasRef}
        width={800}
        height={800}
        className="w-full h-full"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip({ show: false, content: '', x: 0, y: 0 })}
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
      {showSettings && (
        <div className={`absolute right-0 top-12 p-4 bg-gray-900/95 backdrop-blur rounded-l w-64`}>
          <div className="space-y-4">
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
          </div>
        </div>
      )}
      
      {!hasInteracted && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-gray-800/90 px-4 py-3 rounded text-white text-sm">
            Click anywhere to enable audio playback
          </div>
        </div>
      )}
    </div>
  );
};

export default HeatmapViewer;