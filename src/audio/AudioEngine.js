import WebRenderer from '@elemaudio/web-renderer';
import {el} from '@elemaudio/core';

class AudioEngine {
  constructor() {
    if (AudioEngine.instance) {
      return AudioEngine.instance;
    }
    AudioEngine.instance = this;
    
    this.renderer = null;
    this.context = null;
    this.initialized = false;
    this.unitNodes = new Map(); // Track audio nodes from each unit
  }

  async initialize() {
    if (this.initialized) return true;

    try {
      const context = new AudioContext();
      await context.resume();
      
      const core = new WebRenderer();
      const node = await core.initialize(context, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      
      node.connect(context.destination);
      
      this.renderer = core;
      this.context = context;
      this.initialized = true;

      // Initialize reverb IR
      await this.initializeReverb();
      
      return true;
    } catch (err) {
      console.error('AudioEngine initialization error:', err);
      return false;
    }
  }

  async initializeReverb() {
    try {
      const irResponse = await fetch('/WIDEHALL-1.wav');
      if (!irResponse.ok) throw new Error(`HTTP error! status: ${irResponse.status}`);
      const irArrayBuffer = await irResponse.arrayBuffer();
      const irAudioBuffer = await this.context.decodeAudioData(irArrayBuffer);
      
      await this.renderer.updateVirtualFileSystem({
        'reverb-ir': irAudioBuffer.getChannelData(0)
      });
    } catch (err) {
      console.warn('Failed to load reverb IR, using minimal IR:', err);
      const minimalIR = new Float32Array(4096).fill(0);
      minimalIR[0] = 1;
      await this.renderer.updateVirtualFileSystem({
        'reverb-ir': minimalIR
      });
    }
  }

  // Register a unit's audio nodes
  setUnitNodes(unitId, nodes, config = { volume: -12, active: true, soloed: false }) {
    const { volume, active, soloed } = config;
    console.log('AudioEngine: Setting unit nodes:', {
      unitId,
      nodeCount: nodes.length,
      config: { volume, active, soloed }
    });
    
    const gain = this.dbToGain(volume);

    // Store original nodes with just volume adjustment
    const volumeAdjustedNodes = nodes.map(node => 
      el.mul(node, el.const({ key: `gain-${unitId}`, value: gain }))
    );
    
    this.unitNodes.set(unitId, {
      nodes: volumeAdjustedNodes,
      active,
      soloed
    });
    
    this.updateAudioGraph();
  }

  // Remove a unit's audio nodes
  removeUnitNodes(unitId) {
    this.unitNodes.delete(unitId);
    this.updateAudioGraph();
  }

  // Consolidate and render the full audio graph
  updateAudioGraph() {
    if (!this.initialized) return;

    console.log('AudioEngine: Updating audio graph', {
      units: Array.from(this.unitNodes.entries()).map(([id, unit]) => ({
        id,
        active: unit.active,
        soloed: unit.soloed,
        volume: unit.volume,
        nodeCount: unit.nodes.length
      }))
    });

    // Check if any units are soloed
    const hasSoloedUnits = Array.from(this.unitNodes.values())
      .some(unit => unit.soloed);

    // Get active nodes considering solo state
    const activeNodes = Array.from(this.unitNodes.entries())
      .filter(([_, unit]) => {
        if (!unit.active) return false;
        return hasSoloedUnits ? unit.soloed : true;
      })
      .map(([_, unit]) => unit.nodes)
      .flat();

    if (!activeNodes.length) {
      this.renderer.render(el.const({value: 0}), el.const({value: 0}));
      return;
    }

    // Mix down all nodes
    const mix = activeNodes.length === 1 ? 
      activeNodes[0] : 
      el.add(...activeNodes);

    // Render stereo output
    this.renderer.render(mix, mix);
  }

  // Utility methods for units to use
  getContext() {
    return this.context;
  }

  getRenderer() {
    return this.renderer;
  }

  // Add helper to convert dB to linear gain
  dbToGain(db) {
    return Math.pow(10, db / 20);
  }
}

// Export singleton instance
export default new AudioEngine();
