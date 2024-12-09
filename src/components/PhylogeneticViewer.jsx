import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Settings, Download } from 'lucide-react';
import * as d3 from 'd3';
import { pruneTreeForContextSwitches } from './phylogenetic-tree-common';
import { LINEAGE_SOUNDS_BUCKET_HOST } from '../constants';
import AudioManager from './AudioManager';

const PhylogeneticViewer = ({ 
  treeData, 
  experiment, 
  evoRunId, 
  showSettings, 
  setShowSettings,
  hasAudioInteraction,
  onAudioInteraction 
}) => {
  // State declarations
  const [theme, setTheme] = useState('dark');
  const [measureContextSwitches, setMeasureContextSwitches] = useState(false);
  const [reverbAmount, setReverbAmount] = useState(5);
  const [tooltip, setTooltip] = useState({ show: false, content: '', x: 0, y: 0 });
  const [maxVoices, setMaxVoices] = useState(4);
  const [silentMode, setSilentMode] = useState(false);

  // Refs
  const searchTermRef = useRef('');  // Search ref instead of state
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const nodesRef = useRef(null);
  const linksRef = useRef(null);
  const currentZoomTransformRef = useRef(null);

  // Replace audio refs with AudioManager
  const audioManagerRef = useRef(null);
  const currentlyPlayingNodeRef = useRef(null);
  const treeInitializedRef = useRef(false);  // Add this line

  // Add active nodes tracking
  const activeNodesRef = useRef(new Set());

  // Constants
  const FADE_TIME = 0.1;
  const BASE_VOLUME = 1;

  // Remove old audio setup code and replace with AudioManager initialization
  useEffect(() => {
    if (!audioManagerRef.current) {
      audioManagerRef.current = new AudioManager();
      audioManagerRef.current.initialize();
    }
    if (audioManagerRef.current) {
      audioManagerRef.current.maxVoices = maxVoices;
    }
  }, [maxVoices]);

  // Update redrawNodes to be more defensive
  const redrawNodes = useCallback(() => {
    if (!gRef.current || !audioManagerRef.current) return;
    
    const nodes = gRef.current.querySelectorAll('.node-circle');
    const playingSounds = new Set([...audioManagerRef.current.playingCells.keys()]);
    
    nodes.forEach(node => {
      const d = d3.select(node).datum();
      const cellKey = `${d.data.id}-${d.data.id}`;
      const isPlaying = playingSounds.has(cellKey);
      const color = isPlaying ? '#ff0000' : 
        (d.data.s ? d3.interpolateViridis(d.data.s) : "#999");
      node.setAttribute('fill', color);
    });
  }, []);

  // Memoize playAudioWithFade
  const playAudioWithFade = useCallback(async (d) => {
    if (!hasAudioInteraction || !audioManagerRef.current) return;

    try {
      const fileName = `${d.data.id}-${d.data.duration}_${d.data.noteDelta}_${d.data.velocity}.wav`;
      const audioUrl = `${LINEAGE_SOUNDS_BUCKET_HOST}/${experiment}/${evoRunId}/${fileName}`;
      
      const result = await audioManagerRef.current.playSound(audioUrl, { 
        i: d.data.id, 
        j: d.data.id
      });
      
      if (result) {
        requestAnimationFrame(redrawNodes);
        const voice = audioManagerRef.current.voices.get(result.voiceId);
        if (voice?.source) {
          voice.source.onended = () => requestAnimationFrame(redrawNodes);
        }
      }
    } catch (error) {
      console.error('Error playing audio:', error);
      requestAnimationFrame(redrawNodes);
    }
  }, [experiment, evoRunId, hasAudioInteraction, redrawNodes]);

  // Remove stopAudioWithFade with cleanup using AudioManager
  const stopAudioWithFade = async () => {
    if (audioManagerRef.current) {
      audioManagerRef.current.cleanup();
      currentlyPlayingNodeRef.current = null;
      requestAnimationFrame(redrawNodes); // Update to use redrawNodes
    }
  };

  // Add cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
      activeNodesRef.current.clear();
    };
  }, []);

  // Update reverb mix when reverbAmount changes
  useEffect(() => {
    if (audioManagerRef.current) {
      audioManagerRef.current.setReverbMix(reverbAmount);
    }
  }, [reverbAmount]);

  // Slider handler
  const handleReverbChange = useCallback((e) => {
    setReverbAmount(Number(e.target.value));
  }, []);

  // Memoize heavy functions
  const updateSearch = useCallback((term) => {
    if (!gRef.current) return;
    
    const searchTerm = term.toLowerCase();
    requestAnimationFrame(() => {
      // Direct DOM manipulation instead of going through D3 selection
      const nodes = gRef.current.querySelectorAll('.node');
      const links = gRef.current.querySelectorAll('.link');

      nodes.forEach(node => {
        const d = d3.select(node).datum();
        const opacity = d.data.name.toLowerCase().includes(searchTerm) ? 1 : 0.1;
        node.style.opacity = opacity;
      });

      links.forEach(link => {
        const d = d3.select(link).datum();
        const opacity = d.target.data.name.toLowerCase().includes(searchTerm) ? 0.4 : 0.1;
        link.style.opacity = opacity;
      });
    });
  }, []);

  // Handle search input without state updates
  const handleSearchInput = useCallback((e) => {
    searchTermRef.current = e.target.value;
    updateSearch(e.target.value);
  }, [updateSearch]);

  // Simplify handleNodeMouseOver
  const handleNodeMouseOver = useCallback((event, d) => {
    setTooltip({
      show: true,
      content: `ID: ${d.data.name || d.data.id}<br/>Score: ${d.data.s ? d.data.s.toFixed(3) : 'N/A'}<br/>Generation: ${d.data.gN || 'N/A'}`,
      x: event.pageX,
      y: event.pageY
    });

    if (hasAudioInteraction && !silentMode) {
      playAudioWithFade(d);
    }
  }, [hasAudioInteraction, silentMode, playAudioWithFade]);

  // Initialize D3 visualization
  useEffect(() => {
    if (!containerRef.current || !treeData) return;
    
    // Clear existing content and reset initialization flag
    d3.select(containerRef.current).selectAll("*").remove();
    treeInitializedRef.current = false;

    // Process the tree based on context switches setting
    const simplifiedRoot = measureContextSwitches ? 
      pruneTreeForContextSwitches(treeData) : 
      treeData;

    const margin = { top: 80, right: 20, bottom: 80, left: 20 };
    const width = containerRef.current.clientWidth - margin.left - margin.right;
    const height = containerRef.current.clientHeight - margin.top - margin.bottom;
    const nodeRadius = 6;
    const separationFactor = 3;

    // Create hierarchy and calculate margins
    const root = d3.hierarchy(simplifiedRoot);
    const maxMeasuredDepth = d3.max(root.descendants(), d => d.depth);
    const marginRadius = Math.max(100, maxMeasuredDepth * 50);
    const radius = Math.min(width, height) / 2 - marginRadius;

    // Create SVG
    const svg = d3.select(containerRef.current)
      .append("svg")
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
      .style("font", "10px sans-serif");

    const g = svg.append("g")
      .attr("transform", `translate(${width/2 + margin.left},${height/2 + margin.top})`);

    // Create tree layout
    const tree = d3.tree()
      .size([2 * Math.PI, radius])
      .separation((a, b) => (a.parent == b.parent ? 1 : 2) / a.depth * separationFactor);

    // Process the hierarchy
    tree(root);

    // Adjust nodes function
    function adjustNodes(node, depth = 0) {
      if (node.children) {
        const siblings = node.children;
        const spacing = 2 * Math.PI / Math.pow(siblings.length, 1.1);
        siblings.forEach((child, i) => {
          child.x = node.x + (i - (siblings.length - 1) / 2) * spacing / (depth + 1);
          adjustNodes(child, depth + 1);
        });
      }
    }

    adjustNodes(root);

    // Create links
    const links = g.selectAll(".link")
      .data(root.links())
      .join("path")
      .attr("class", "link")
      .attr("fill", "none")
      .attr("stroke", "#555")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", 3)
      .attr("d", d3.linkRadial()
        .angle(d => d.x)
        .radius(d => d.y));

    // Create nodes
    const node = g.selectAll(".node")
      .data(root.descendants())
      .join("g")
      .attr("class", "node")
      .attr("transform", d => `rotate(${d.x * 180 / Math.PI - 90}) translate(${d.y},0)`);

    const circles = node.append("circle")
      .attr("fill", d => d.data.s ? d3.interpolateViridis(d.data.s) : "#999")
      .attr("r", nodeRadius)
      .attr("class", "node-circle")
      .on("mouseover", handleNodeMouseOver)  // Use the memoized callback
      .on("mouseout", function(event, d) {
        setTooltip({ show: false, content: '', x: 0, y: 0 });
        // Remove color update on mouseout since it's handled by redrawNodes
      })
      .on("dblclick", (event, d) => {
        event.preventDefault();
        event.stopPropagation();
        if (hasAudioInteraction) {  // Change this line
          downloadNodeSound(d);
        }
      });

    treeInitializedRef.current = true;

    // Add zoom behavior that maintains mouse position as zoom center
    // Optimize zoom handling
    const zoom = d3.zoom()
      .scaleExtent([0.1, 10])
      .on("zoom", (event) => {
        requestAnimationFrame(() => {
          const transform = event.transform;
          currentZoomTransformRef.current = transform;
          
          if (gRef.current) {
            gRef.current.style.transform = 
              `translate(${transform.x}px,${transform.y}px) scale(${transform.k})`;
            
            // Batch DOM updates
            const nodes = gRef.current.querySelectorAll('.node-circle');
            const links = gRef.current.querySelectorAll('.link');
            
            nodes.forEach(node => {
              node.setAttribute('r', nodeRadius / transform.k);
            });
            
            links.forEach(link => {
              link.style.strokeWidth = `${3 / transform.k}px`;
            });
          }

          // // Update audio volume
          // if (zoomGainNodeRef.current) {
          //   const newVolume = Math.min(1, transform.k);
          //   zoomGainNodeRef.current.gain.setValueAtTime(
          //     newVolume, 
          //     audioContextRef.current.currentTime
          //   );
          // }
        });
      });

    // Store refs for direct access
    svgRef.current = svg.node();
    gRef.current = g.node();
    nodesRef.current = node.node();
    linksRef.current = links.node();

    // Apply zoom behavior
    svg.call(zoom);

    // Apply stored zoom transform or initial zoom
    if (currentZoomTransformRef.current) {
      svg.call(zoom.transform, currentZoomTransformRef.current);
    } else {
      const dx = width / 2;
      const dy = height / 2;
      svg.call(
        zoom.transform,
        d3.zoomIdentity
          .translate(dx, dy)
          .scale(0.8)
      );
    }

    // Add window resize handler
    const handleResize = () => {
      const newWidth = containerRef.current.clientWidth - margin.left - margin.right;
      const newHeight = containerRef.current.clientHeight - margin.top - margin.bottom;
      
      svg
        .attr("width", newWidth + margin.left + margin.right)
        .attr("height", newHeight + margin.top + margin.bottom);
      
      if (currentZoomTransformRef.current) {
        g.attr("transform", currentZoomTransformRef.current);
      } else {
        g.attr("transform", `translate(${newWidth/2 + margin.left},${newHeight/2 + margin.top})`);
      }
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      // Remove the old audio cleanup since we're using AudioManager now
      audioManagerRef.current?.cleanup();
    };
  }, [treeData, experiment, evoRunId, measureContextSwitches, hasAudioInteraction, handleNodeMouseOver]); // Remove silentMode

  // Add periodic redraw to catch any missed state changes
  useEffect(() => {
    const interval = setInterval(() => {
      if (audioManagerRef.current) {
        redrawNodes();
      }
    }, 100); // Check every 100ms

    return () => clearInterval(interval);
  }, [redrawNodes]);

  // Update click handler
  const handleClick = async (e) => {
    e.stopPropagation();
    console.log('PhylogeneticViewer click, before:', hasAudioInteraction);
    if (!hasAudioInteraction) {
      try {
        await audioManagerRef.current?.resume();
        onAudioInteraction();  // Just call the prop function
        console.log('PhylogeneticViewer click, after audio init');
      } catch (error) {
        console.error('Error initializing audio:', error);
      }
    }
  };

  // Update the theme handling
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light-theme');
      document.documentElement.classList.remove('dark-theme');
    } else {
      document.documentElement.classList.add('dark-theme');
      document.documentElement.classList.remove('light-theme');
    }
  }, [theme]);

  const handleExportSVG = useCallback(() => {
    if (!svgRef.current) return;
    
    // Clone the SVG to avoid modifying the displayed one
    const clonedSvg = svgRef.current.cloneNode(true);
    
    // Apply current transform to the main group
    if (currentZoomTransformRef.current) {
      const g = clonedSvg.querySelector('g');
      const transform = currentZoomTransformRef.current;
      g.setAttribute('transform', `translate(${transform.x},${transform.y}) scale(${transform.k})`);
    }

    // Convert to string
    const svgString = new XMLSerializer().serializeToString(clonedSvg);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    
    // Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `phylogenetic-tree-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  // Add key handler for Alt key
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

  return (
    <div 
      className={`flex flex-col h-screen ${theme === 'light' ? 'bg-gray-100' : 'bg-gray-950'}`}
      onClick={handleClick}
    >
      {/* Add download button next to settings */}
      <div className="absolute bottom-2 right-2 z-50 flex gap-2">
        <button
          onClick={handleExportSVG}
          className="p-2 rounded-full bg-gray-800/80 hover:bg-gray-700/80 text-white"
          title="Export as SVG"
        >
          <Download size={20} />
        </button>
        {/* ...existing settings button... */}
      </div>

      {/* Enhanced Settings Panel */}
      {showSettings && (
        <div 
          className={`absolute right-0 top-12 p-6 rounded-l shadow-lg z-50
            ${theme === 'light' 
              ? 'bg-white/95 text-gray-900' 
              : 'bg-gray-900/95 text-white'} 
            backdrop-blur w-80`}
        >
          <div className="space-y-6">
            {/* Search Filter - Now using ref */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Search Filter</label>
              <input
                type="text"
                defaultValue={searchTermRef.current}  // Using defaultValue with ref
                onChange={handleSearchInput}
                placeholder="Search by ID..."
                className="w-full px-3 py-1.5 text-sm bg-gray-800 text-white rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
              />
            </div>

            {/* Reverb Control */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Reverb Amount</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  className="flex-1 h-2"
                  min="0"
                  max="100"
                  value={reverbAmount}
                  onChange={(e) => setReverbAmount(Number(e.target.value))}
                />
                <span className="text-sm w-8">{reverbAmount}%</span>
              </div>
            </div>

            {/* Theme Toggle */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Appearance</label>
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={theme === 'light'}
                  onChange={(e) => setTheme(e.target.checked ? 'light' : 'dark')}
                  className={`rounded ${theme === 'light' 
                    ? 'bg-white border-gray-300' 
                    : 'bg-gray-800 border-gray-700'}`}
                />
                Light theme
              </label>
            </div>

            {/* Add Polyphony Control */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Polyphony (Max Voices)</label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  className="flex-1 h-2"
                  min="1"
                  max="8"
                  step="1"
                  value={maxVoices}
                  onChange={(e) => setMaxVoices(Number(e.target.value))}
                />
                <span className="text-sm w-8">{maxVoices}</span>
              </div>
            </div>

            {/* Add Silent Mode Control */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Navigation Mode</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={silentMode}
                  onChange={(e) => setSilentMode(e.target.checked)}
                  className={`rounded ${theme === 'light' 
                    ? 'bg-white border-gray-300' 
                    : 'bg-gray-800 border-gray-700'}`}
                />
                Silent mode (or hold Alt key)
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Rest of the component remains the same */}
      <div className="flex-1 relative">
        <div 
          ref={containerRef} 
          className="absolute inset-0"
          onClick={handleClick}
        />

        {/* Add tooltip div */}
        {tooltip.show && (
          <div
            className="fixed z-50 px-2 py-1 bg-gray-900 text-white text-sm rounded pointer-events-none"
            style={{
              left: tooltip.x + 10,
              top: tooltip.y - 10
            }}
            dangerouslySetInnerHTML={{ __html: tooltip.content }}
          />
        )}

        <div className="absolute bottom-2 left-2 text-white/70 text-xs flex items-center gap-2">
          <span>Hover: {silentMode ? 'navigation only' : 'play sound'} • Double-click: download</span>
          {silentMode && (
            <span className="px-1.5 py-0.5 bg-gray-800/80 rounded text-xs">
              Silent Mode
            </span>
          )}
        </div>

        {!hasAudioInteraction && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-20">
          <div className="bg-gray-800/90 px-4 py-3 rounded text-white text-sm">
            Click anywhere to enable audio playback
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default PhylogeneticViewer;