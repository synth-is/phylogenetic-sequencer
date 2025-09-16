import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Settings, Download, RefreshCw } from 'lucide-react';
import * as d3 from 'd3';
import { pruneTreeForContextSwitches } from './phylogenetic-tree-common';
import { DEFAULT_LINEAGE_SOUNDS_BUCKET_HOST, getLineageSoundsBucketHost, getRestServiceHost, REST_ENDPOINTS } from '../constants';

// Enhance the POSITION_CONFIG to include zoom-related display settings
const POSITION_CONFIG = {
  // Initial transform constants
  INITIAL_SCALE: 1.6,        // Initial zoom level
  INITIAL_X_OFFSET_PROP: -0.8, // Proportion of container width (negative moves left)
  INITIAL_Y_OFFSET_PROP: -0.8, // Proportion of container height (negative moves up)
  
  // Tree layout constants
  CENTER_ADJUST_X: 0,        // Adjust the tree center X position
  CENTER_ADJUST_Y: 0,        // Adjust the tree center Y position
  
  // Viewport constants
  USE_FULL_CONTAINER: true,  // Use the entire container rather than a square
  MARGIN_FACTOR: 0.15,       // Margin as a percentage of the container size
  MAINTAIN_CIRCULAR: true,   // Ensure the tree maintains circular proportions
  
  // Node and line scaling behavior
  BASE_NODE_RADIUS: 6,       // Base node radius at zoom level 1
  MIN_NODE_RADIUS: 2,        // Minimum node radius at any zoom level
  MAX_NODE_RADIUS: 20,       // Maximum node radius at any zoom level
  NODE_SCALING_FACTOR: 0.8,  // Controls how quickly nodes shrink when zooming in (0.5 = square root scaling)
  
  // Simplified line settings
  LINE_WIDTH: 5,           // Base line width that will be consistently applied
  LINE_SCALING_FACTOR: 0.15,  // Controls how quickly lines scale with zoom (lower = more consistent width)
  
  // High zoom level enhancement
  HIGH_ZOOM_LEVEL: Infinity, // Threshold for "high zoom" behaviors
  NODE_BORDER_WIDTH: 0.5,    // Node border width at high zoom levels
  NODE_SEPARATION_BOOST: 0.2 // Reduce node size faster at high zoom for better separation (0-1, lower = more separation)
};

// Create a module-level variable to persist zoom state across renders
// This will maintain the state even if the component unmounts and remounts
const persistentZoomState = {
  transform: null
};

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
  const [silentMode, setSilentMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reverbAmount, setReverbAmount] = useState(20);
  const [maxVoices, setMaxVoices] = useState(4);
  const [customHostUrl, setCustomHostUrl] = useState(() => 
    localStorage.getItem('CUSTOM_LINEAGE_SOUNDS_URL') || ''
  );
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [loadingError, setLoadingError] = useState(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const retryTimeoutRef = useRef(null);

  // Audio-related refs
  const audioContextRef = useRef(null);
  const currentSourceRef = useRef(null);
  const currentGainNodeRef = useRef(null);
  const currentPlayingNodeRef = useRef(null);

  // View-related refs
  const searchTermRef = useRef('');
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const treeInitializedRef = useRef(false);
  const playingNodesRef = useRef(new Set());
  const hoverTimestampsRef = useRef(new Map());
  const HOVER_DEBOUNCE = 50; // ms

  // Refs for highlight tracking
  const highlightTimestampsRef = useRef(new Map());
  const cleanupIntervalRef = useRef(null);
  const HIGHLIGHT_EXPIRY = 5000; // 5 seconds max highlight lifetime

  // Ref to track looping state
  const loopingNodesRef = useRef(new Set());

  // D3 and rendering refs
  const scalesRef = useRef({
    x: d3.scaleLinear(),
    y: d3.scaleLinear()
  });
  const quadtreeRef = useRef(null);
  const flattenedDataRef = useRef([]);
  const rawLayoutDataRef = useRef(null);
  const currentZoomRef = useRef(null);
  const animFrameRef = useRef(null);
  const hasResetViewRef = useRef(false);
  
  // Node coloring function
  const getNodeColor = useCallback((d) => {
    if (playingNodesRef.current.has(d.id)) {
      return 'red';
    } else if (d.s !== undefined) {
      return d3.interpolateViridis(d.s);
    } else {
      return '#999';
    }
  }, []);

  // Function to download node sound - define this early
  const downloadNodeSound = useCallback((nodeData) => {
    console.log('Downloading sound for node:', nodeData.id);
  }, []);

  // Node click handler - define this early
  const handleNodeClick = useCallback((nodeData) => {
    if (!hasAudioInteraction || !onCellHover) return;
    
    onCellHover({
      eventId: Date.now(),
      data: nodeData,
      experiment,
      evoRunId,
      config: {
        addToSequence: true,
        duration: nodeData.duration,
        noteDelta: nodeData.noteDelta,
        velocity: nodeData.velocity
      }
    });
  }, [experiment, evoRunId, hasAudioInteraction, onCellHover]);

  // Node double-click handler for LiveCodingUnit
  const handleNodeDoubleClick = useCallback((nodeData) => {
    if (!hasAudioInteraction) return;
    
    console.log('Double-click on node:', nodeData.id);
    
    // Check if ANY LiveCodingUnit is selected (not just the most recent one)
    const selectedUnitElement = document.querySelector('[data-selected-unit-type="LIVE_CODING"]');
    const selectedUnitId = selectedUnitElement?.getAttribute('data-selected-unit-id');
    
  if (selectedUnitId && window.getUnitInstance) {
      const liveCodingUnit = window.getUnitInstance(selectedUnitId);
      
      if (liveCodingUnit && liveCodingUnit.type === 'LIVE_CODING') {
        console.log(`Double-click: Adding sound to SPECIFIC LiveCodingUnit: ${selectedUnitId}`);
        
        // Create cell data for the specific LiveCodingUnit
  const cellData = {
          genomeId: nodeData.id,
          experiment: experiment || 'unknown',
          evoRunId: evoRunId || 'unknown',
          duration: nodeData.duration || 2,
          noteDelta: nodeData.noteDelta || 0,
          pitch: nodeData.noteDelta || 0,
          velocity: nodeData.velocity || 0.8,
          // If we have the genome URL, include it
          genomeUrl: nodeData.genomeUrl,
          // Add unit targeting information
          targetUnitId: selectedUnitId
        };
        
        // Add sound to the specific live coding unit's sample bank
        liveCodingUnit.addSoundToBank(cellData).then(result => {
          if (result.strudelRegistered) {
            console.log(`Sound successfully added to Unit ${selectedUnitId}:`, result.sampleName);
          } else {
            console.log(`Sound added to Unit ${selectedUnitId} bank, awaiting Strudel registration:`, result.sampleName);
            // Show a unit-specific notification
            const notification = document.createElement('div');
            notification.innerHTML = `
              <div class="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-yellow-600 text-white px-4 py-2 rounded shadow-lg z-50">
                Sound added to Unit ${selectedUnitId}! Open its Live Code tab to complete setup.
              </div>
            `;
            document.body.appendChild(notification);
            setTimeout(() => notification.remove(), 3000);
          }
        }).catch(error => {
          console.error(`Failed to add sound to LiveCodingUnit ${selectedUnitId}:`, error);
        });
      }
    } else {
      // If no LiveCodingUnit is selected, show a helpful message
      const notification = document.createElement('div');
      notification.innerHTML = `
        <div class="fixed bottom-20 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded shadow-lg z-50">
          Select a LiveCoding unit first, then double-click sounds to add them.
        </div>
      `;
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 2000);
      
      // Fallback: use the download functionality
      if (onCellHover) {
        downloadNodeSound(nodeData);
      }
    }
  }, [experiment, evoRunId, hasAudioInteraction, downloadNodeSound]);

  // Replace drawCurvedPath with a straight line function
  const drawLine = useCallback((ctx, x1, y1, x2, y2) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }, []);

  // Update the renderCanvas function to implement improved scaling behavior
  const renderCanvas = useCallback(() => {
    if (!canvasRef.current || flattenedDataRef.current.length === 0) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Apply zoom transform
    const transform = currentZoomRef.current || d3.zoomIdentity;
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);
    
    // Calculate if we're in high zoom mode
    const isHighZoom = transform.k > POSITION_CONFIG.HIGH_ZOOM_LEVEL;
    
    // Simplified line width calculation - smooth scaling with zoom
    // Scale line width inversely with zoom level using scaling factor
    // This ensures lines remain visible but not too thick at any zoom level
    let lineWidth = POSITION_CONFIG.LINE_WIDTH;
    
    // Apply scaling based on zoom level - higher scaling factor = more consistent width
    if (transform.k !== 1) {
      lineWidth = lineWidth * Math.pow(transform.k, -POSITION_CONFIG.LINE_SCALING_FACTOR);
    }
    
    // Apply the calculated line width (dividing by transform.k to counteract the ctx.scale)
    ctx.lineWidth = lineWidth / transform.k;
    ctx.strokeStyle = '#555';
    ctx.globalAlpha = isHighZoom ? 0.6 : 0.4; // Make lines more visible at higher zoom
    
    flattenedDataRef.current.forEach(d => {
      if (d.parentId !== null) {
        const x1 = scalesRef.current.x(d.parentX);
        const y1 = scalesRef.current.y(d.parentY);
        const x2 = scalesRef.current.x(d.x);
        const y2 = scalesRef.current.y(d.y);
        drawLine(ctx, x1, y1, x2, y2);
      }
    });
    
    // Draw nodes with improved adaptive sizing for better separation when zoomed in
    ctx.globalAlpha = 1;
    
    // Calculate node radius with advanced scaling
    let nodeScalingPower = POSITION_CONFIG.NODE_SCALING_FACTOR;
    
    // If we're at high zoom, enhance node separation by using a stronger scaling factor
    if (isHighZoom) {
      nodeScalingPower = POSITION_CONFIG.NODE_SCALING_FACTOR * POSITION_CONFIG.NODE_SEPARATION_BOOST;
    }
    
    // Calculate adaptive node radius that gets smaller (relatively) as you zoom in
    // but at a controlled rate using the scaling power
    const zoomScale = Math.pow(transform.k, nodeScalingPower);
    const adaptiveRadius = POSITION_CONFIG.BASE_NODE_RADIUS / zoomScale;
    
    // Apply min/max constraints
    const nodeRadius = Math.max(
      POSITION_CONFIG.MIN_NODE_RADIUS / transform.k,
      Math.min(POSITION_CONFIG.MAX_NODE_RADIUS / transform.k, adaptiveRadius)
    );
    
    flattenedDataRef.current.forEach(d => {
      const x = scalesRef.current.x(d.x);
      const y = scalesRef.current.y(d.y);
      
      ctx.beginPath();
      ctx.arc(x, y, nodeRadius, 0, 2 * Math.PI);
      ctx.fillStyle = getNodeColor(d);
      ctx.fill();
      
      // Add node border with improved visibility at high zoom levels
      if (isHighZoom) {
        ctx.strokeStyle = '#111';
        ctx.lineWidth = POSITION_CONFIG.NODE_BORDER_WIDTH / transform.k;
        ctx.stroke();
      }
    });
    
    ctx.restore();
  }, [getNodeColor, drawLine]);

  // Update node playing status
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
    
    // Trigger re-render
    if (canvasRef.current) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      animFrameRef.current = requestAnimationFrame(renderCanvas);
    }
  }, [renderCanvas]);

  // Node mouse over handler
  const handleNodeMouseOver = useCallback((nodeData) => {
    if (!hasAudioInteraction || !onCellHover || silentMode) return;

    const now = Date.now();
    const lastHover = hoverTimestampsRef.current.get(nodeData.id) || 0;
    
    // We still need debouncing for rapid sequences over different nodes
    // But make it shorter to be more responsive for intentional "strumming"
    const minTimeBetweenHovers = 30; // ms, reduced from 50ms
    
    if (now - lastHover < minTimeBetweenHovers) {
      console.log('Debouncing rapid hover:', nodeData.id);
      return;
    }
    
    hoverTimestampsRef.current.set(nodeData.id, now);
    
    console.log('Node mouseOver:', { 
      nodeId: nodeData.id,
      isPlaying: playingNodesRef.current.has(nodeData.id)
    });

    // Refresh highlight timestamp
    highlightTimestampsRef.current.set(nodeData.id, Date.now());

    setNodePlaying(nodeData.id, true);
    
    onCellHover({
      eventId: Date.now(),
      data: nodeData,
      experiment,
      evoRunId,
      config: {
        duration: nodeData.duration,
        noteDelta: nodeData.noteDelta,
        velocity: nodeData.velocity,
        onLoopStateChanged: (isLooping) => {
          console.log('Loop state changed:', { nodeId: nodeData.id, isLooping });
          setNodePlaying(nodeData.id, isLooping, isLooping);
        },
        onEnded: () => {
          const isLooping = loopingNodesRef.current.has(nodeData.id);
          
          console.log('Sound ended:', {
            nodeId: nodeData.id,
            isLooping
          });

          // Only remove highlight if not looping
          if (!isLooping) {
            setNodePlaying(nodeData.id, false);
          }
        }
      }
    });
  }, [experiment, evoRunId, hasAudioInteraction, onCellHover, setNodePlaying, silentMode]);

  // Replace the flattenTreeToNodes function
  const flattenTreeToNodes = useCallback((hierarchyRoot) => {
    rawLayoutDataRef.current = hierarchyRoot;
    
    return hierarchyRoot.descendants().map(d => {
      // Fix coordinate calculation for perfect circle
      const angle = d.x;
      const radius = d.y;
      
      // Convert polar to Cartesian coordinates
      const coords = {
        x: radius * Math.cos(angle),  // Remove the angle offset
        y: radius * Math.sin(angle)
      };
      
      // Calculate parent coordinates the same way
      const parentCoords = d.parent ? {
        x: d.parent.y * Math.cos(d.parent.x),
        y: d.parent.y * Math.sin(d.parent.x)
      } : null;
      
      return {
        id: d.data.id,
        x: coords.x,
        y: coords.y,
        s: d.data.s,
        depth: d.depth,
        gN: d.data.gN,  // Extract the gN attribute for generation
        generation: d.data.generation,
        class: d.data.class,  // Extract class info
        name: d.data.name,    // Extract name as fallback
        duration: d.data.duration,
        noteDelta: d.data.noteDelta,
        velocity: d.data.velocity,
        year: d.data.year,
        parentId: d.parent ? d.parent.data.id : null,
        parentX: parentCoords?.x,
        parentY: parentCoords?.y
      };
    });
  }, []);

  // Find node under mouse position
  const findNode = useCallback((mouseX, mouseY, radius = 20) => {
    if (!quadtreeRef.current) return null;
    
    const transform = currentZoomRef.current || d3.zoomIdentity;
    const transformedX = (mouseX - transform.x) / transform.k;
    const transformedY = (mouseY - transform.y) / transform.k;
    
    let closestPoint = null;
    let closestDist = Infinity;
    
    quadtreeRef.current.visit((node, x1, y1, x2, y2) => {
      if (!node.length) {
        const d = node.data;
        const dx = scalesRef.current.x(d.x) - transformedX;
        const dy = scalesRef.current.y(d.y) - transformedY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < radius / transform.k && dist < closestDist) {
          closestDist = dist;
          closestPoint = d;
        }
      }
      
      return x1 > transformedX + radius/transform.k || 
             y1 > transformedY + radius/transform.k || 
             x2 < transformedX - radius/transform.k || 
             y2 < transformedY - radius/transform.k;
    });
    
    return closestPoint;
  }, []);

  // Enhanced debug logging function
  const debugLog = useCallback((message, data) => {
    console.log(`[PhyloViewer] ${message}:`, data);
  }, []);

  // Update setupInteractions to allow virtually unlimited zoom
  const setupInteractions = useCallback((canvasElement) => {
    // Create zoom behavior that handles both wheel zoom and drag
    // Change scaleExtent from [0.1, 10] to [0.01, 100] for much deeper zoom capability
    const zoom = d3.zoom()
      .scaleExtent([0.01, 200])  // Allow zooming from 1% to 10000% of original size
      .on("zoom", (event) => {
        // Always update both the ref and persistent state on ANY zoom event
        // This handles both wheel zooms and drags
        currentZoomRef.current = event.transform;
        persistentZoomState.transform = event.transform;
        renderCanvas();
      });

    const selection = d3.select(canvasElement)
      .call(zoom)
      .on("mousemove", event => {
        const [mouseX, mouseY] = d3.pointer(event);
        const node = findNode(mouseX, mouseY);
        
        // Handle node hover transitions to avoid jitter
        // Only trigger events when entering a new node or leaving a node completely
        if (node) {
          console.log('Hovering over node:', node);
          // Enhanced tooltip content with gN for generation and class/name information
          setTooltip({
            show: true,
            content: `
              <div class="font-medium">${node.id || 'Node'}</div>
              ${node.s !== undefined ? `<div>Score: ${(node.s * 100).toFixed(1)}%</div>` : ''}
              ${node.gN !== undefined ? 
                `<div>Generation: ${node.gN}</div>` : 
                node.generation !== undefined ? 
                  `<div>Generation: ${node.generation}</div>` : 
                  node.depth !== undefined ? `<div>Generation: ${node.depth}</div>` : ''}
              ${node.class ? 
                `<div>Class: ${node.class}</div>` : 
                node.name ? `<div>Name: ${node.name}</div>` : ''}
              ${node.duration !== undefined ? `<div>Duration: ${node.duration.toFixed(2)}</div>` : ''}
            `,
            x: mouseX,
            y: mouseY
          });
          
          // Only trigger audio/highlight if this is a different node than last time
          if (!silentMode && currentHoveredNodeRef.current !== node.id) {
            currentHoveredNodeRef.current = node.id;
            handleNodeMouseOver(node);
          }
        } else {
          setTooltip({ show: false, content: '', x: 0, y: 0 });
          
          // Clear current hovered node when not hovering any node
          // This ensures we can hover the same node again after leaving it
          currentHoveredNodeRef.current = null;
        }
      });

    // Use persistent transform if available, otherwise create initial transform
    let initialTransform;
    
    if (persistentZoomState.transform) {
      initialTransform = persistentZoomState.transform;
      debugLog("Using persistent zoom state", initialTransform);
    } else {
      // Calculate offsets based on container dimensions
      const xOffset = canvasElement.width * POSITION_CONFIG.INITIAL_X_OFFSET_PROP;
      const yOffset = canvasElement.height * POSITION_CONFIG.INITIAL_Y_OFFSET_PROP;
      
      // Position in center with configured proportional offsets and scale
      initialTransform = d3.zoomIdentity
        .translate(
          canvasElement.width / 2 + xOffset, 
          canvasElement.height / 2 + yOffset
        )
        .scale(POSITION_CONFIG.INITIAL_SCALE);
      
      debugLog("Created new initial transform", {
        transform: initialTransform,
        canvasWidth: canvasElement.width,
        canvasHeight: canvasElement.height,
        centerX: canvasElement.width / 2,
        centerY: canvasElement.height / 2,
        xOffset,
        yOffset
      });
    }

    selection.call(zoom.transform, initialTransform);
    currentZoomRef.current = initialTransform;
    persistentZoomState.transform = initialTransform;

    // Add click handler to the canvas element
    selection.on("click", event => {
      const [mouseX, mouseY] = d3.pointer(event);
      const node = findNode(mouseX, mouseY);
      
      if (node) {
        event.stopPropagation();
        event.preventDefault();
        handleNodeClick(node);
      } else if (!hasAudioInteraction) {
        onAudioInteraction();
      }
    });

    // Add double click handler
    selection.on("dblclick", event => {
      const [mouseX, mouseY] = d3.pointer(event);
      const node = findNode(mouseX, mouseY);
      
      if (node && hasAudioInteraction) {
        event.preventDefault();
        event.stopPropagation();
        handleNodeDoubleClick(node);
      }
    });

    return initialTransform;
  }, [findNode, handleNodeMouseOver, handleNodeClick, handleNodeDoubleClick, hasAudioInteraction, onAudioInteraction, renderCanvas, silentMode, debugLog]);

  // Initialize visualization
  useEffect(() => {
    if (!containerRef.current || !treeData) return;
    
    // Clear existing content
    d3.select(containerRef.current).selectAll("*").remove();
    treeInitializedRef.current = false;
    hasResetViewRef.current = false;

    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;
    
    debugLog("Container dimensions", { containerWidth, containerHeight });

    // Use either the full container or a square based on config
    let width, height;
    if (POSITION_CONFIG.USE_FULL_CONTAINER) {
      width = containerWidth;
      height = containerHeight;
    } else {
      const size = Math.min(containerWidth, containerHeight);
      width = size;
      height = size;
    }
    
    // Apply margin factor
    const margin = Math.min(width, height) * POSITION_CONFIG.MARGIN_FACTOR; 
    const radius = (Math.min(width, height) / 2) - margin;
    
    debugLog("Calculated dimensions", { 
      width, height, margin, radius,
      useFullContainer: POSITION_CONFIG.USE_FULL_CONTAINER
    });

    // Create hierarchy with adjusted center
    const root = d3.hierarchy(
      measureContextSwitches ? pruneTreeForContextSwitches(treeData) : treeData
    );

    // Configure tree layout
    const tree = d3.tree()
      .size([2 * Math.PI, radius])  // Use full circle (2π)
      .separation(() => 1);         // Constant separation for perfect circles

    // Process hierarchy
    tree(root);

    // Get flattened data with center adjustments
    const flattenedData = root.descendants().map(d => {
      const angle = d.x;
      const r = d.y;
      
      // Convert polar to Cartesian coordinates with center adjustment
      const coords = {
        x: (r * Math.cos(angle)) + POSITION_CONFIG.CENTER_ADJUST_X,
        y: (r * Math.sin(angle)) + POSITION_CONFIG.CENTER_ADJUST_Y
      };
      
      // Calculate parent coordinates with the same adjustments
      const parentCoords = d.parent ? {
        x: (d.parent.y * Math.cos(d.parent.x)) + POSITION_CONFIG.CENTER_ADJUST_X,
        y: (d.parent.y * Math.sin(d.parent.x)) + POSITION_CONFIG.CENTER_ADJUST_Y
      } : null;
      
      // Log to inspect if generation data exists in the original dataset
      if (d.depth < 2) {
        // console.log("Node data sample:", {
        //   id: d.data.id,
        //   s: d.data.s,
        //   depth: d.depth,
        //   gN: d.data.gN,
        //   generation: d.data.generation,
        //   class: d.data.class,
        //   name: d.data.name,
        //   nodeData: d.data
        // });
      }
      
      return {
        id: d.data.id,
        x: coords.x,
        y: coords.y,
        s: d.data.s,
        depth: d.depth,
        gN: d.data.gN,  // Extract the gN attribute for generation
        generation: d.data.generation,
        class: d.data.class,  // Extract class info
        name: d.data.name,    // Extract name as fallback
        duration: d.data.duration,
        noteDelta: d.data.noteDelta,
        velocity: d.data.velocity,
        year: d.data.year,
        parentId: d.parent ? d.parent.data.id : null,
        parentX: parentCoords?.x,
        parentY: parentCoords?.y
      };
    });

    flattenedDataRef.current = flattenedData;

    // Set up scales with equal ranges for x and y to maintain circularity
    const extent = radius + margin;
    const scale = d3.scaleLinear()
      .domain([-extent, extent]);
    
    // If maintaining circular proportions, use the same scale range for both axes
    let xScale, yScale;
    
    if (POSITION_CONFIG.MAINTAIN_CIRCULAR) {
      // Calculate square dimensions that fit within the container
      const squareSize = Math.min(width, height);
      const squareMargin = margin;
      
      // Create identical ranges for both axes to maintain perfect circle
      xScale = scale.copy().range([squareMargin, squareSize - squareMargin]);
      yScale = scale.copy().range([squareSize - squareMargin, squareMargin]); // Invert Y axis
      
      // Center the square within the container
      const xOffset = (width - squareSize) / 2;
      const yOffset = (height - squareSize) / 2;
      
      // Apply offsets to both scales
      xScale.range([squareMargin + xOffset, squareSize - squareMargin + xOffset]);
      yScale.range([squareSize - squareMargin + yOffset, squareMargin + yOffset]);
      
      debugLog("Using circular scale configuration", { 
        squareSize,
        xRange: xScale.range(),
        yRange: yScale.range(),
        xOffset,
        yOffset
      });
    } else {
      // Use the full container dimensions with potential distortion
      xScale = scale.copy().range([margin, width - margin]);
      yScale = scale.copy().range([height - margin, margin]); // Invert Y axis
      
      debugLog("Using container-fitted scale configuration", { 
        xRange: xScale.range(),
        yRange: yScale.range()
      });
    }

    scalesRef.current = { x: xScale, y: yScale };

    // Setup canvas with dimensions that match container
    const canvasElement = document.createElement('canvas');
    canvasElement.width = containerWidth;
    canvasElement.height = containerHeight;
    canvasElement.style.position = 'absolute';
    canvasElement.style.left = '0';
    canvasElement.style.top = '0';
    containerRef.current.appendChild(canvasElement);
    canvasRef.current = canvasElement;

    debugLog("Canvas created", { 
      width: canvasElement.width, 
      height: canvasElement.height,
      left: canvasElement.style.left,
      top: canvasElement.style.top
    });

    // Build quadtree
    quadtreeRef.current = d3.quadtree()
      .x(d => scalesRef.current.x(d.x))
      .y(d => scalesRef.current.y(d.y))
      .addAll(flattenedData);

    // Check for persistent zoom state first
    if (persistentZoomState.transform) {
      currentZoomRef.current = persistentZoomState.transform;
      debugLog("Using persistent zoom transform", currentZoomRef.current);
    } else {
      // Calculate offsets based on container dimensions
      const xOffset = containerWidth * POSITION_CONFIG.INITIAL_X_OFFSET_PROP;
      const yOffset = containerHeight * POSITION_CONFIG.INITIAL_Y_OFFSET_PROP;
      
      // Initialize with centered and scaled view
      const initialTransform = d3.zoomIdentity
        .translate(
          containerWidth / 2 + xOffset,
          containerHeight / 2 + yOffset
        )
        .scale(POSITION_CONFIG.INITIAL_SCALE);
      
      currentZoomRef.current = initialTransform;
      persistentZoomState.transform = initialTransform;
      
      debugLog("Created initial transform", { 
        translateX: initialTransform.x,
        translateY: initialTransform.y,
        scale: initialTransform.k,
        containerCenter: { 
          x: containerWidth / 2, 
          y: containerHeight / 2 
        },
        xOffset,
        yOffset
      });
    }

    setupInteractions(canvasElement);
    renderCanvas();

    // Add window resize handler that preserves relative positioning
    const handleResize = () => {
      if (!containerRef.current || !canvasRef.current) return;
      
      const oldWidth = canvasRef.current.width;
      const oldHeight = canvasRef.current.height;
      
      const newWidth = containerRef.current.clientWidth;
      const newHeight = containerRef.current.clientHeight;

      // Update canvas size
      canvasRef.current.width = newWidth;
      canvasRef.current.height = newHeight;
      
      // Update scales while maintaining circularity if configured
      if (POSITION_CONFIG.MAINTAIN_CIRCULAR) {
        const extent = scalesRef.current.x.domain()[1];
        
        // Calculate square dimensions that fit within container
        const squareSize = Math.min(newWidth, newHeight);
        const margin = squareSize * POSITION_CONFIG.MARGIN_FACTOR;
        
        // Center the square within the container
        const xOffset = (newWidth - squareSize) / 2;
        const yOffset = (newHeight - squareSize) / 2;
        
        // Update scale ranges with new dimensions while maintaining circularity
        scalesRef.current.x.range([margin + xOffset, squareSize - margin + xOffset]);
        scalesRef.current.y.range([squareSize - margin + yOffset, margin + yOffset]);
        
        debugLog("Resized with circular scale configuration", {
          newWidth, newHeight, squareSize,
          xRange: scalesRef.current.x.range(),
          yRange: scalesRef.current.y.range(),
          xOffset, yOffset
        });
      } else {
        // Update scale ranges to use full container (may distort circle)
        const margin = Math.min(newWidth, newHeight) * POSITION_CONFIG.MARGIN_FACTOR;
        scalesRef.current.x.range([margin, newWidth - margin]);
        scalesRef.current.y.range([newHeight - margin, margin]);
      }
      
      // Update quadtree with new scale
      if (flattenedDataRef.current.length > 0) {
        quadtreeRef.current = d3.quadtree()
          .x(d => scalesRef.current.x(d.x))
          .y(d => scalesRef.current.y(d.y))
          .addAll(flattenedDataRef.current);
      }

      // Update transform to maintain relative position
      if (currentZoomRef.current) {
        const oldTransform = currentZoomRef.current;
        const widthRatio = newWidth / oldWidth;
        const heightRatio = newHeight / oldHeight;
        
        // Calculate new transform that preserves relative position
        const newTransform = d3.zoomIdentity
          .translate(
            oldTransform.x * widthRatio,
            oldTransform.y * heightRatio
          )
          .scale(oldTransform.k);
        
        currentZoomRef.current = newTransform;
        persistentZoomState.transform = newTransform;
      }
      
      // Render with new dimensions
      renderCanvas();
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      // Don't clear persistentZoomState on unmount
    };
  }, [treeData, measureContextSwitches, setupInteractions, renderCanvas, debugLog]);

  // Add a cleanup function that runs only when the component is fully unmounted
  // (e.g., when navigating away, not on re-renders)
  useEffect(() => {
    return () => {
      // Only clear persistent zoom state when the experiment or evo run changes
    };
  }, [experiment, evoRunId]);

  // Handle search input change
  const handleSearchInput = (e) => {
    searchTermRef.current = e.target.value.trim().toLowerCase();
    // Could implement search highlighting here
  };

  // Add cleanup interval for stale highlights
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      
      highlightTimestampsRef.current.forEach((timestamp, nodeId) => {
        if (now - timestamp > HIGHLIGHT_EXPIRY && !loopingNodesRef.current.has(nodeId)) {
          playingNodesRef.current.delete(nodeId);
          highlightTimestampsRef.current.delete(nodeId);
          changed = true;
        }
      });
      
      if (changed && canvasRef.current) {
        renderCanvas();
      }
    }, 1000);
    
    cleanupIntervalRef.current = interval;
    
    return () => {
      clearInterval(interval);
      highlightTimestampsRef.current.clear();
      playingNodesRef.current.clear();
      loopingNodesRef.current.clear();
    };
  }, [renderCanvas]);

  // Update theme
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light-theme');
      document.documentElement.classList.remove('dark-theme');
    } else {
      document.documentElement.classList.add('dark-theme');
      document.documentElement.classList.remove('light-theme');
    }
  }, [theme]);

  // Key press handler for silent mode toggle
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'Alt' && e.type === 'keydown') {
        e.preventDefault();
        setSilentMode(prev => !prev);
      }
    };
  
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  // Export SVG function
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
    link.download = `phylogenetic-tree-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, []);

  // Main click handler
  const handleClick = async (e) => {
    e.stopPropagation();
    if (!hasAudioInteraction) {
      onAudioInteraction();
    }
    // Don't reset zoom on clicks
  };

  // Add a wheel event optimization to prevent "zoom exhaustion"
  useEffect(() => {
    if (!containerRef.current) return;
    
    // Add a custom wheel event listener to improve zoom behavior
    const handleWheel = (event) => {
      // Only modify behavior when deeply zoomed
      if (currentZoomRef.current && currentZoomRef.current.k > 20) {
        // Adjust zoom speed at extreme zoom levels
        event.preventDefault();
        
        // Get the current zoom transform
        const transform = currentZoomRef.current;
        
        // Calculate zoom factor - make it more responsive at extreme zoom levels
        const scaleFactor = 1 + Math.abs(event.deltaY) * 0.001;
        
        // Zoom in or out based on wheel direction
        const newK = event.deltaY < 0 ? 
          transform.k * scaleFactor : 
          transform.k / scaleFactor;
        
        // Apply minimum and maximum zoom constraints
        const constrainedK = Math.max(0.01, Math.min(100, newK));
        
        // Create new transform with adjusted scale
        const newTransform = d3.zoomIdentity
          .translate(transform.x, transform.y)
          .scale(constrainedK);
        
        // Update current transform
        currentZoomRef.current = newTransform;
        persistentZoomState.transform = newTransform;
        
        // Render with new transform
        renderCanvas();
      }
    };
    
    // Only add this specialized handler if needed
    if (containerRef.current) {
      // Use passive: false to enable preventDefault()
      containerRef.current.addEventListener('wheel', handleWheel, { passive: false });
    }
    
    return () => {
      if (containerRef.current) {
        containerRef.current.removeEventListener('wheel', handleWheel);
      }
    };
  }, [renderCanvas]);

  // Add state for all configurable zoom settings
  const [zoomSettings, setZoomSettings] = useState({
    // Node settings
    BASE_NODE_RADIUS: POSITION_CONFIG.BASE_NODE_RADIUS,
    MIN_NODE_RADIUS: POSITION_CONFIG.MIN_NODE_RADIUS,
    MAX_NODE_RADIUS: POSITION_CONFIG.MAX_NODE_RADIUS,
    NODE_SCALING_FACTOR: POSITION_CONFIG.NODE_SCALING_FACTOR,
    
    // Simplified line settings
    LINE_WIDTH: POSITION_CONFIG.LINE_WIDTH,
    LINE_SCALING_FACTOR: POSITION_CONFIG.LINE_SCALING_FACTOR,
    
    // High zoom settings
    HIGH_ZOOM_LEVEL: POSITION_CONFIG.HIGH_ZOOM_LEVEL,
    NODE_BORDER_WIDTH: POSITION_CONFIG.NODE_BORDER_WIDTH,
    NODE_SEPARATION_BOOST: POSITION_CONFIG.NODE_SEPARATION_BOOST
  });

  // Update the effect that applies all the zoom settings
  useEffect(() => {
    // Apply all settings to POSITION_CONFIG
    Object.keys(zoomSettings).forEach(key => {
      POSITION_CONFIG[key] = zoomSettings[key];
    });
    
    if (canvasRef.current) {
      renderCanvas();
    }
  }, [zoomSettings, renderCanvas]);

  // Add a ref to track the currently hovered node
  const currentHoveredNodeRef = useRef(null);

  // Store experiment and evoRunId in global window for access by other components
  useEffect(() => {
    if (experiment) {
      window.phyloExperiment = experiment;
    }
    
    if (evoRunId) {
      window.phyloEvoRunId = evoRunId;
    }
    
    // Store combined information in tree data itself for easier access
    if (treeData && (experiment || evoRunId)) {
      // Add annotations to the tree data to help with identification
      const annotatedTreeData = {
        ...treeData,
        experiment: experiment,
        evoRunId: evoRunId,
        __timestamp: Date.now(), // Add timestamp to detect changes
        __source: 'PhylogeneticViewer', // Indicate source of data
      };
      
      window.phyloTreeData = annotatedTreeData;
      console.log('Stored annotated tree data in window.phyloTreeData', {
        experiment,
        evoRunId,
        treeDataAvailable: !!treeData,
        timestamp: annotatedTreeData.__timestamp
      });
      
      // Automatically notify any active sequencing units about the tree data
      if (window.getUnitInstance) {
        try {
          const units = document.querySelectorAll('[data-unit-id]');
          units.forEach(unitEl => {
            const unitId = unitEl.getAttribute('data-unit-id');
            const unitInstance = window.getUnitInstance(unitId);
            
            if (unitInstance && unitInstance.type === 'SEQUENCING') {
              console.log(`Auto-updating tree information for unit ${unitId}`);
              unitInstance.updateTreeInformation(annotatedTreeData);
            }
          });
        } catch (err) {
          console.warn('Error while auto-updating sequencing units:', err);
        }
      }
    }
    
    return () => {
      // We keep the global data for cross-component access
      // But we could clean it up here if needed
    };
  }, [experiment, evoRunId, treeData]);

  // Add a cleanup effect for the retry timeout
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  const playAudioWithFade = async (d) => {
    if (!hasAudioInteraction) return;
    if (!audioContextRef.current || audioContextRef.current.state === 'suspended') {
      console.log('Audio context not ready');
      return;
    }
    if (currentPlayingNodeRef.current === d) return;

    try {
      // Use REST service instead of static file serving
      const restServiceHost = getRestServiceHost();
      // evoRunId should now contain the full folder name
      const folderName = evoRunId;
      const ulid = d.data.id;
      const duration = d.data.duration;
      const pitch = d.data.noteDelta;
      const velocity = d.data.velocity;
      
      const audioUrl = `${restServiceHost}${REST_ENDPOINTS.RENDER_AUDIO(folderName, ulid, duration, pitch, velocity)}`;
      
      console.log('Attempting to play:', audioUrl);

      // Check if URL is available before attempting to fetch
      const isAvailable = await checkUrlAvailability(audioUrl);
      
      if (!isAvailable) {
        setLoadingError('Audio server not responding. Attempting to reconnect...');
        setIsRetrying(true);
        
        const success = await retryWithBackoff(audioUrl);
        if (!success) {
          return;
        }
      }

      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);

      if (currentSourceRef.current) {
        await stopAudioWithFade();
      }

      // Create and configure audio nodes
      currentSourceRef.current = audioContextRef.current.createBufferSource();
      currentSourceRef.current.buffer = audioBuffer;
      currentSourceRef.current.loop = false;

      currentGainNodeRef.current = audioContextRef.current.createGain();
      // ... rest of the existing audio setup code ...
    } catch (error) {
      console.error('Error playing audio:', error);
      setLoadingError(error.message || 'Error playing audio file');
      if (error.message.includes('HTTP error')) {
        setLoadingError('Audio file not found or server error. Please check the audio server URL in settings.');
      }
    }
  };

  return (
    <div 
      className={`flex flex-col h-screen ${theme === 'light' ? 'bg-gray-100' : 'bg-gray-950'}`}
      onClick={handleClick}
    >
      {/* Silent Mode Indicator + Discord Button */}
      <div className="fixed bottom-2 left-2 text-white/70 text-xs flex items-center gap-2 z-50">
        {/* Discord Button */}
        <a
          href="https://discord.gg/8v6MaaAS7F"
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white flex items-center mr-2"
          title="Join us on Discord"
        >
          {/* Discord SVG icon (Heroicons/outline style, Tailwind compatible) */}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
            <path d="M20.317 4.369A19.791 19.791 0 0 0 16.885 3.3a.084.084 0 0 0-.09.042c-.388.676-.822 1.557-1.125 2.25a18.726 18.726 0 0 0-5.36 0c-.303-.693-.737-1.574-1.125-2.25a.084.084 0 0 0-.09-.042c-3.432.6-6.13 2.07-6.13 2.07a.07.07 0 0 0-.032.028C.533 9.043-.32 13.58.099 18.057a.09.09 0 0 0 .032.062c2.577 1.89 5.07 2.41 5.07 2.41a.084.084 0 0 0 .09-.03c.39-.534.74-1.1 1.02-1.7a.084.084 0 0 0-.045-.115c-.552-.21-1.08-.47-1.59-.77a.084.084 0 0 1-.008-.14c.107-.08.214-.16.317-.24a.084.084 0 0 1 .086-.01c3.3 1.51 6.86 1.51 10.14 0a.084.084 0 0 1 .087.01c.104.08.21.16.317.24a.084.084 0 0 1-.008.14c-.51.3-1.038.56-1.59.77a.084.084 0 0 0-.045.115c.28.6.63 1.166 1.02 1.7a.084.084 0 0 0 .09.03s2.493-.52 5.07-2.41a.09.09 0 0 0 .032-.062c.43-4.477-.434-9.014-2.37-13.66a.07.07 0 0 0-.032-.028ZM8.02 15.33c-.987 0-1.797-.9-1.797-2.01 0-1.11.8-2.01 1.797-2.01 1 0 1.8.9 1.8 2.01 0 1.11-.8 2.01-1.8 2.01Zm7.96 0c-.987 0-1.797-.9-1.797-2.01 0-1.11.8-2.01 1.797-2.01 1 0 1.8.9 1.8 2.01 0 1.11-.8 2.01-1.8 2.01Z" />
          </svg>
        </a>
        <button
          onClick={handleExportSVG}
          className="p-1.5 rounded bg-gray-800/80 hover:bg-gray-700/80 text-white mr-2"
          title="Export as SVG"
        >
          <Download size={16} />
        </button>
        <span>Hover: {silentMode ? 'navigation only' : 'play sound'} • Double-click: download</span>
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

      {/* Removed the original download button since it's now in the left panel */}

      {/* Settings Panel */}
      {showSettings && (
        <div 
          className={`absolute right-0 top-12 p-6 rounded-l shadow-lg z-50
            ${theme === 'light' 
              ? 'bg-white/95 text-gray-900' 
              : 'bg-gray-900/95 text-white'} 
            backdrop-blur w-80`}
        >
          <div className="space-y-6">
            {/* Search Filter */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Search Filter</label>
              <input
                type="text"
                defaultValue={searchTermRef.current}
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
              <label className="flex items-center gap-2 text-sm cursor-pointer">
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

            {/* Polyphony Control */}
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

            {/* Silent Mode Control */}
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

            {/* Context Switches Measurement */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Tree Analysis</label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={measureContextSwitches}
                  onChange={(e) => setMeasureContextSwitches(e.target.checked)}
                  className={`rounded ${theme === 'light' 
                    ? 'bg-white border-gray-300' 
                    : 'bg-gray-800 border-gray-700'}`}
                />
                Show context switches only
              </label>
            </div>

            {/* Lineage Sounds URL Configuration */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Lineage Sounds URL</label>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={customHostUrl}
                    onChange={(e) => setCustomHostUrl(e.target.value)}
                    onFocus={() => setIsEditingUrl(true)}
                    onBlur={() => {
                      if (!customHostUrl.trim()) {
                        setIsEditingUrl(false);
                      }
                    }}
                    placeholder={DEFAULT_LINEAGE_SOUNDS_BUCKET_HOST}
                    className="flex-1 px-3 py-1.5 text-sm bg-gray-800 text-white rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
                  />
                  {isEditingUrl ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (customHostUrl.trim()) {
                          localStorage.setItem('CUSTOM_LINEAGE_SOUNDS_URL', customHostUrl.trim());
                        } else {
                          localStorage.removeItem('CUSTOM_LINEAGE_SOUNDS_URL');
                        }
                        setIsEditingUrl(false);
                        // Clear any existing error
                        setLoadingError(null);
                        window.location.reload();
                      }}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      Save
                    </button>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsEditingUrl(true);
                      }}
                      className="px-3 py-1.5 text-sm bg-gray-700 text-white rounded hover:bg-gray-600"
                    >
                      Edit
                    </button>
                  )}
                </div>
                {loadingError && (
                  <div className="text-sm text-red-500 bg-red-900/20 p-2 rounded">
                    {loadingError}
                    {!isRetrying && (
                      <button
                        onClick={() => {
                          setLoadingError(null);
                          const restServiceHost = getRestServiceHost();
                          const testUrl = `${restServiceHost}/evoruns/summary`;
                          setIsRetrying(true);
                          retryWithBackoff(testUrl);
                        }}
                        className="ml-2 underline hover:no-underline"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                )}
                {isRetrying && (
                  <div className="text-sm text-yellow-500">
                    Attempting to reconnect...
                  </div>
                )}
                <p className="text-xs text-gray-400">
                  Custom URL for lineage sounds bucket. Default: {DEFAULT_LINEAGE_SOUNDS_BUCKET_HOST}
                </p>
              </div>
            </div>

            {/* Add this to the settings panel, before the last closing div */}
            <ZoomSettingsControls settings={zoomSettings} setSettings={setZoomSettings} />

          </div>
        </div>
      )}

      <div className="flex-1 relative">
        <div 
          ref={containerRef} 
          className="absolute inset-0"
          onClick={handleClick}
        />

        {/* Tooltip */}
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

        {/* Audio interaction overlay */}
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

        {/* Error message for audio loading */}
        {loadingError && (
          <div className="absolute inset-0 flex items-center justify-center z-30">
            <div className="bg-red-600/90 text-white text-sm rounded px-4 py-2 shadow-md">
              {loadingError}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Add UI controls for zoom display settings in the settings panel
// (After existing settings panel controls)
const ZoomSettingsControls = ({ settings, setSettings }) => {
  // Helper function to update a single setting
  const updateSetting = (key, value) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };
  
  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">Node Appearance</label>
        <div className="grid grid-cols-1 gap-3 mt-2">
          <div>
            <div className="flex justify-between text-xs">
              <span>Base Node Size: {settings.BASE_NODE_RADIUS.toFixed(1)}</span>
            </div>
            <input
              type="range"
              className="w-full"
              min="2"
              max="15"
              step="0.5"
              value={settings.BASE_NODE_RADIUS}
              onChange={(e) => updateSetting('BASE_NODE_RADIUS', parseFloat(e.target.value))}
            />
          </div>
          
          <div>
            <div className="flex justify-between text-xs">
              <span>Min Node Size: {settings.MIN_NODE_RADIUS.toFixed(1)}</span>
            </div>
            <input
              type="range"
              className="w-full"
              min="0.5"
              max="5"
              step="0.1"
              value={settings.MIN_NODE_RADIUS}
              onChange={(e) => updateSetting('MIN_NODE_RADIUS', parseFloat(e.target.value))}
            />
          </div>
          
          <div>
            <div className="flex justify-between text-xs">
              <span>Max Node Size: {settings.MAX_NODE_RADIUS.toFixed(1)}</span>
            </div>
            <input
              type="range"
              className="w-full"
              min="10"
              max="40"
              step="1"
              value={settings.MAX_NODE_RADIUS}
              onChange={(e) => updateSetting('MAX_NODE_RADIUS', parseFloat(e.target.value))}
            />
          </div>
          
          <div>
            <div className="flex justify-between text-xs">
              <span>Node Scaling Factor: {settings.NODE_SCALING_FACTOR.toFixed(2)}</span>
              <span className="italic text-gray-400">(Lower = More Separation)</span>
            </div>
            <input
              type="range"
              className="w-full"
              min="0.05"
              max="0.5"
              step="0.01"
              value={settings.NODE_SCALING_FACTOR}
              onChange={(e) => updateSetting('NODE_SCALING_FACTOR', parseFloat(e.target.value))}
            />
          </div>
        </div>
      </div>
      
      <div>
        <label className="text-sm font-medium">Line Appearance</label>
        <div className="grid grid-cols-1 gap-3 mt-2">
          <div>
            <div className="flex justify-between text-xs">
              <span>Line Width: {settings.LINE_WIDTH.toFixed(1)}</span>
            </div>
            <input
              type="range"
              className="w-full"
              min="0.5"
              max="5"
              step="0.1"
              value={settings.LINE_WIDTH}
              onChange={(e) => updateSetting('LINE_WIDTH', parseFloat(e.target.value))}
            />
          </div>
          
          <div>
            <div className="flex justify-between text-xs">
              <span>Line Scaling: {settings.LINE_SCALING_FACTOR.toFixed(2)}</span>
              <span className="italic text-gray-400">(Lower = More Consistent)</span>
            </div>
            <input
              type="range"
              className="w-full"
              min="0.1"
              max="1"
              step="0.05"
              value={settings.LINE_SCALING_FACTOR}
              onChange={(e) => updateSetting('LINE_SCALING_FACTOR', parseFloat(e.target.value))}
            />
          </div>
        </div>
      </div>
      
      <div>
        <label className="text-sm font-medium">High Zoom Behavior</label>
        <div className="grid grid-cols-1 gap-3 mt-2">
          <div>
            <div className="flex justify-between text-xs">
              <span>High Zoom Threshold: {settings.HIGH_ZOOM_LEVEL.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              className="w-full"
              min="5"
              max="30"
              step="1"
              value={settings.HIGH_ZOOM_LEVEL}
              onChange={(e) => updateSetting('HIGH_ZOOM_LEVEL', parseFloat(e.target.value))}
            />
          </div>
          
          <div>
            <div className="flex justify-between text-xs">
              <span>Node Border Width: {settings.NODE_BORDER_WIDTH.toFixed(2)}</span>
            </div>
            <input
              type="range"
              className="w-full"
              min="0.1"
              max="2"
              step="0.1"
              value={settings.NODE_BORDER_WIDTH}
              onChange={(e) => updateSetting('NODE_BORDER_WIDTH', parseFloat(e.target.value))}
            />
          </div>
          
          <div>
            <div className="flex justify-between text-xs">
              <span>High Zoom Separation: {settings.NODE_SEPARATION_BOOST.toFixed(2)}</span>
              <span className="italic text-gray-400">(Lower = More Separation)</span>
            </div>
            <input
              type="range"
              className="w-full"
              min="0.1"
              max="1"
              step="0.05"
              value={settings.NODE_SEPARATION_BOOST}
              onChange={(e) => updateSetting('NODE_SEPARATION_BOOST', parseFloat(e.target.value))}
            />
          </div>
        </div>
      </div>
      
      <div className="flex justify-end">
        <button
          className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
          onClick={() => {
            // Reset to default values
            setSettings({
              BASE_NODE_RADIUS: 6,
              MIN_NODE_RADIUS: 2,
              MAX_NODE_RADIUS: 20,
              NODE_SCALING_FACTOR: 0.1,
              LINE_WIDTH: 1.5,
              LINE_SCALING_FACTOR: 0.6,
              HIGH_ZOOM_LEVEL: 10,
              NODE_BORDER_WIDTH: 0.5,
              NODE_SEPARATION_BOOST: 0.2
            });
          }}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
};

export default PhylogeneticViewer;