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

  /**
   * Update parameters for a specific voice in real time
   * @param {string} voiceId - The voice identifier 
   * @param {Object} params - The parameters to update (pitch, playbackRate, etc.)
   * @returns {boolean} - Whether the update was successful
   */
  updateVoiceParams(voiceId, params) {
    if (!this.initialized || !this.renderer) {
      return false;
    }
    
    try {
      // Update parameters by sending named constants to the audio core
      Object.entries(params).forEach(([param, value]) => {
        // For each parameter, create the appropriate parameter key
        const paramKey = `${param}-${voiceId}`;
        
        console.log(`AudioEngine: Updating parameter ${paramKey} to ${value}`);
        
        // Update the constant in the renderer
        this.renderer.updateConstant(paramKey, value);
      });
      
      return true;
    } catch (error) {
      console.error('Error updating voice parameters:', error);
      return false;
    }
  }

  /**
   * Update a specific sample in the VirtualFileSystem
   * @param {string} key - The VFS key to update
   * @param {Float32Array} audioData - The audio sample data
   * @returns {Promise<boolean>} - Whether the update was successful
   */
  async updateVfsSample(key, audioData) {
    if (!this.initialized || !this.renderer) {
      return false;
    }

    try {
      console.log(`AudioEngine: Updating VFS sample: ${key}`);
      
      // Create a VFS update
      const vfsUpdate = {};
      vfsUpdate[key] = audioData;
      
      // Apply the update
      await this.renderer.updateVirtualFileSystem(vfsUpdate);
      
      return true;
    } catch (error) {
      console.error(`AudioEngine: Failed to update VFS sample ${key}:`, error);
      return false;
    }
  }
  
  /**
   * Replace audio sample for a playing voice
   * @param {string} voiceId - ID of the voice
   * @param {string} vfsKey - New VFS key to use
   * @returns {boolean} - Whether the update was successful
   */
  updateVoiceSample(voiceId, vfsKey) {
    if (!this.initialized || !this.renderer) {
      return false;
    }
    
    try {
      console.log(`AudioEngine: Updating voice ${voiceId} to use sample ${vfsKey}`);
      
      // Elementary Audio doesn't directly support changing the sample of a playing voice
      // We'll need to update the voice's path parameter, which can be done by sending 
      // a specific message to the core
      const pathKey = `path-${voiceId}`;
      this.renderer.updateConstant(pathKey, vfsKey);
      
      return true;
    } catch (error) {
      console.error(`AudioEngine: Failed to update voice sample:`, error);
      return false;
    }
  }

  /**
   * Get audio data from the VFS by key
   * @param {string} vfsKey - Key in the virtual file system
   * @returns {Float32Array|null} - Audio data or null if not found
   */
  getAudioData(vfsKey) {
    if (!this.initialized || !this.renderer) {
      return null;
    }
    
    try {
      // This is a placeholder - WebRenderer doesn't currently expose VFS directly
      // In the future, this would retrieve data from the VFS
      return null;
    } catch (error) {
      console.error('Error accessing audio data:', error);
      return null;
    }
  }

  /**
   * Check if audio data exists in the VFS
   * @param {string} vfsKey - Key to check
   * @returns {boolean} - Whether the key exists
   */
  hasAudioData(vfsKey) {
    if (!this.initialized || !this.renderer) {
      return false;
    }
    
    // This is also a placeholder for future functionality
    return false;
  }
}

// Export singleton instance
export default new AudioEngine();
