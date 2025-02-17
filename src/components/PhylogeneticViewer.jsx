import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Settings, Download } from 'lucide-react';
import * as d3 from 'd3';
import { pruneTreeForContextSwitches } from './phylogenetic-tree-common';

const PhylogeneticViewer = ({ 
  treeData, 
  experiment, 
  evoRunId, 
  showSettings, 
  setShowSettings,
  hasAudioInteraction,
  onAudioInteraction,
  onCellHover
}) => {
  const [theme, setTheme] = useState('dark');
  const [measureContextSwitches, setMeasureContextSwitches] = useState(false);
  const [tooltip, setTooltip] = useState({ show: false, content: '', x: 0, y: 0 });
  const [silentMode, setSilentMode] = useState(false); // Add silentMode state

  // Keep only view-related refs
  const searchTermRef = useRef('');
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const gRef = useRef(null);
  const nodesRef = useRef(null);
  const linksRef = useRef(null);
  const currentZoomTransformRef = useRef(null);
  const treeInitializedRef = useRef(false);
  const playingNodesRef = useRef(new Set());
  const hoverTimestampsRef = useRef(new Map());
  const HOVER_DEBOUNCE = 50; // ms

  // Add refs for highlight tracking
  const highlightTimestampsRef = useRef(new Map());
  const cleanupIntervalRef = useRef(null);
  const HIGHLIGHT_EXPIRY = 5000; // 5 seconds max highlight lifetime

  // Add new ref to track looping state
  const loopingNodesRef = useRef(new Set());

  // 1. First define the basic color update function
  const updateNodeColors = useCallback(() => {
    if (!gRef.current) return;
    
    d3.select(gRef.current)
      .selectAll('.node-circle')
      .each(function(d) {
        const node = d3.select(this);
        const isPlaying = playingNodesRef.current.has(d.data.id);
        const isHovered = node.classed('hovered');
        const color = isPlaying || isHovered ? 'red' : 
                     (d.data.s ? d3.interpolateViridis(d.data.s) : "#999");
        node.attr('fill', color);
      });
  }, []);

  // 2. Then define setNodePlaying which uses updateNodeColors
  const setNodePlaying = useCallback((nodeId, isPlaying, isLooping = false) => {
    console.log('setNodePlaying:', { nodeId, isPlaying, isLooping });
    
    if (isPlaying) {
      playingNodesRef.current.add(nodeId);
      highlightTimestampsRef.current.set(nodeId, Date.now());
      if (isLooping) {
        loopingNodesRef.current.add(nodeId);
      }
    } else {
      playingNodesRef.current.delete(nodeId);
      highlightTimestampsRef.current.delete(nodeId);
      loopingNodesRef.current.delete(nodeId);
    }
    
    console.log('Current state:', {
      playing: Array.from(playingNodesRef.current),
      looping: Array.from(loopingNodesRef.current)
    });
    updateNodeColors();
  }, [updateNodeColors]);

  // 3. Finally define the handlers that use setNodePlaying
  const handleNodeMouseOver = useCallback((event, d) => {
    if (!hasAudioInteraction || !onCellHover || silentMode) return; // Add silentMode check here

    const now = Date.now();
    const lastHover = hoverTimestampsRef.current.get(d.data.id) || 0;
    
    // Debounce rapid hover events
    if (now - lastHover < HOVER_DEBOUNCE) {
      console.log('Debouncing rapid hover:', d.data.id);
      return;
    }
    
    hoverTimestampsRef.current.set(d.data.id, now);
    
    console.log('Node mouseOver:', { 
      nodeId: d.data.id,
      isPlaying: playingNodesRef.current.has(d.data.id)
    });

    // Refresh highlight timestamp
    highlightTimestampsRef.current.set(d.data.id, Date.now());

    setNodePlaying(d.data.id, true);
    
    onCellHover({
      data: d.data,
      experiment,
      evoRunId,
      config: {
        duration: d.data.duration,
        noteDelta: d.data.noteDelta,
        velocity: d.data.velocity,
        onLoopStateChanged: (isLooping) => {
          console.log('Loop state changed:', { nodeId: d.data.id, isLooping });
          setNodePlaying(d.data.id, isLooping, isLooping);
        },
        onEnded: () => {
          const isHovered = d3.select(event.target).classed('hovered');
          const isLooping = loopingNodesRef.current.has(d.data.id);
          
          console.log('Sound ended:', {
            nodeId: d.data.id,
            isHovered,
            isLooping
          });

          // Only remove highlight if not looping and not hovered
          if (!isLooping && !isHovered) {
            setNodePlaying(d.data.id, false);
          }
        }
      }
    });
  }, [experiment, evoRunId, hasAudioInteraction, onCellHover, setNodePlaying, silentMode]); // Add silentMode to dependencies

  const handleNodeClick = useCallback((event, d) => {
    if (!hasAudioInteraction || !onCellHover) return;
    
    event.stopPropagation();
    event.preventDefault();
    
    console.log('Node clicked:', {
      nodeId: d.data.id,
      data: d.data
    });
    
    onCellHover({
      data: d.data,
      experiment,
      evoRunId,
      config: {
        addToSequence: true,
        duration: d.data.duration,
        noteDelta: d.data.noteDelta,
        velocity: d.data.velocity
      }
    });
  }, [experiment, evoRunId, hasAudioInteraction, onCellHover]);

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
        updateNodeColors();
      })
      .on("dblclick", (event, d) => {
        event.preventDefault();
        event.stopPropagation();
        if (hasAudioInteraction) {  // Change this line
          downloadNodeSound(d);
        }
      })
      .on("click", handleNodeClick); // Use the updated click handler

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
    nodesRef.current = node; // Store D3 selection instead of DOM node
    linksRef.current = links; // Store D3 selection instead of DOM node

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
    };
  }, [treeData, experiment, evoRunId, measureContextSwitches, hasAudioInteraction, handleNodeMouseOver, updateNodeColors, handleNodeClick]);

  // Add periodic color update
  useEffect(() => {
    const interval = setInterval(updateNodeColors, 100);
    return () => clearInterval(interval);
  }, [updateNodeColors]);

  // Add cleanup interval for stale highlights
  useEffect(() => {
    return () => {
      highlightTimestampsRef.current.clear();
      playingNodesRef.current.clear();
      loopingNodesRef.current.clear();
    };
  }, [updateNodeColors]);

  // Update click handler to remove renderer references
  const handleClick = async (e) => {
    e.stopPropagation();
    if (!hasAudioInteraction) {
      console.log('Initializing audio interaction');
      onAudioInteraction();
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
  
    document.addEventListener('keydown', handleKeyPress);
    document.addEventListener('keyup', handleKeyPress);
  
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
      document.removeEventListener('keyup', handleKeyPress);
    };
  }, []);

  // Simplify hover state management
  useEffect(() => {
    if (!gRef.current) return;

    d3.select(gRef.current)
      .selectAll('.node-circle')
      .on('mouseenter', function(event, d) {
        console.log('Node mouseenter:', d.data.id);
        d3.select(this).classed('hovered', true);
      })
      .on('mouseleave', function(event, d) {
        console.log('Node mouseleave:', d.data.id);
        d3.select(this).classed('hovered', false);
      });
  }, [treeData]);

  // Add cleanup for hover timestamps on component unmount
  useEffect(() => {
    return () => {
      hoverTimestampsRef.current.clear();
      playingNodesRef.current.clear();
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

        {/* Update silent mode text */}
        <div className="absolute bottom-2 left-2 text-white/70 text-xs flex items-center gap-2">
          <span>Hover: {silentMode ? 'navigation only' : 'play sound'} • Double-click: download</span>
          {silentMode && (
            <span className="px-1.5 py-0.5 bg-gray-800/80 rounded text-xs">
              Silent Mode
            </span>
          )}
        </div>

        {!hasAudioInteraction && (
          <>
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-20" />
            <div className="absolute inset-0 flex items-center justify-center z-20">
              <div className="bg-gray-800/90 px-4 py-3 rounded text-white text-sm">
                Click anywhere to enable audio playback
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PhylogeneticViewer;