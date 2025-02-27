import AudioEngine from '../audio/AudioEngine';
import SoundRenderer from '../utils/SoundRenderer';

export class BaseUnit {
  constructor(id, type) {
    this.id = id;
    this.type = type;
    this.active = true;
    this.muted = false;
    this.soloed = false;
    this.volume = -12;
    this.audioEngine = AudioEngine;
    
    // Add rendering state tracking to BaseUnit
    this.renderingVoices = new Map(); // Store currently rendering voices
    this.renderCallbacks = new Set(); // Store render state change callbacks
  }

  async initialize() {
    return this.audioEngine.initialize();
  }

  cleanup() {
    // Clear rendering state as part of cleanup
    this.renderingVoices?.clear();
    this.renderCallbacks?.clear();
    this.audioEngine.removeUnitNodes(this.id);
  }

  updateAudioNodes(nodes) {
    this.audioEngine.setUnitNodes(this.id, nodes, {
      volume: this.volume,
      active: this.active,
      soloed: this.soloed
    });
  }
  
  /**
   * Shared method to handle rendering a sound with specific parameters
   * @param {Object} soundData - Data about the sound (genomeId, experiment, evoRunId)
   * @param {Object} renderParams - Render parameters (duration, pitch, velocity)
   * @param {Object} options - Additional options (vfsKey prefix, callback on success)
   * @returns {Promise} - Promise that resolves when render completes
   */
  async renderSound(soundData, renderParams, options = {}) {
    const { genomeId } = soundData;
    const vfsKeyPrefix = options.vfsKeyPrefix || `sound-`;
    const originalKey = `${vfsKeyPrefix}${genomeId}`;
    
    console.log(`${this.type}Unit - Rendering sound:`, { 
      unitId: this.id, 
      genomeId, 
      renderParams,
      currentRenderingVoices: Array.from(this.renderingVoices.keys())
    });
    
    // Check if we're already rendering this sound
    if (this.renderingVoices.has(genomeId)) {
      console.log('Already rendering this sound:', genomeId);
      return;
    }
    
    // Mark as rendering
    this.renderingVoices.set(genomeId, renderParams);
    
    // Notify render state changed
    this.notifyRenderStateChange();
    
    try {
      // Request the render
      await SoundRenderer.renderSound(
        soundData,
        renderParams,
        (result) => {
          console.log('Render complete:', result);
          this.renderingVoices.delete(genomeId);
          this.notifyRenderStateChange();
          
          if (result.success) {
            // Format the render key consistently
            const renderKey = `${vfsKeyPrefix}${genomeId}-${renderParams.duration}_${renderParams.pitch}_${renderParams.velocity}`;
            
            // Simulate loading the rendered audio into the VFS
            // by copying the existing audio buffer
            if (this.audioDataCache?.has(originalKey)) {
              const originalBuffer = this.audioDataCache.get(originalKey);
              
              // In a real implementation, this would be a new buffer
              // For now, we'll just reference the original
              this.audioDataCache.set(renderKey, originalBuffer);
              
              // Update the VFS
              this.audioEngine.getRenderer().updateVirtualFileSystem({
                [renderKey]: originalBuffer.getChannelData(0)
              });
              
              // Call the onSuccess callback if provided
              if (options.onSuccess) {
                options.onSuccess(renderKey, originalBuffer);
              }
            }
          }
        },
        (progress) => {
          // Handle progress updates if needed
          console.log('Render progress:', { genomeId, progress });
        }
      );
    } catch (error) {
      console.error(`${this.type}Unit - Render error:`, error);
      this.renderingVoices.delete(genomeId);
      this.notifyRenderStateChange();
    }
  }
  
  /**
   * Register a callback to be notified when rendering state changes
   */
  addRenderStateCallback(callback) {
    this.renderCallbacks.add(callback);
    // Immediately call with current state for UI sync
    callback(this.renderingVoices);
  }
  
  /**
   * Remove a previously registered render state callback
   */
  removeRenderStateCallback(callback) {
    this.renderCallbacks.delete(callback);
  }
  
  /**
   * Notify all registered callbacks that render state has changed
   */
  notifyRenderStateChange() {
    this.renderCallbacks.forEach(callback => callback(this.renderingVoices));
  }
  
  /**
   * Check if a specific sound is currently being rendered
   */
  isRendering(genomeId) {
    return this.renderingVoices.has(genomeId);
  }
}
