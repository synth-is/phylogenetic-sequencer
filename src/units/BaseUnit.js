import AudioEngine from '../audio/AudioEngine';
import AudioFetcher from '../utils/AudioFetcher';

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
   * Shared method to fetch audio data with rendering fallback
   * @param {Object} soundData - Data about the sound (genomeId, experiment, evoRunId)
   * @param {Object} renderParams - Parameters for rendering (duration, pitch, velocity)
   * @param {Object} options - Additional options (vfsKey prefix, callback on success)
   * @returns {Promise<Object>} - Promise that resolves with audio data result
   */
  async getAudioData(soundData, renderParams, options = {}) {
    const { genomeId } = soundData;
    const vfsKeyPrefix = options.vfsKeyPrefix || `sound-`;
    const vfsKey = options.specificVfsKey || `${vfsKeyPrefix}${genomeId}`;
    
    // Mark as rendering
    this.renderingVoices.set(genomeId, renderParams);
    this.notifyRenderStateChange();
    
    try {
      const context = this.audioEngine.getContext();
      const renderer = this.audioEngine.getRenderer();
      
      // Get audio data using AudioFetcher (with WAV fallback to render)
      const audioBuffer = await AudioFetcher.getAudioData(
        soundData, 
        renderParams, 
        context,
        (result) => {
          if (result.success) {
            console.log(`${this.type}Unit: Audio data received from ${result.source}, duration: ${result.audioBuffer.duration}`, 
              { genomeId }
            );
          } else {
            console.error(`${this.type}Unit: Failed to get audio data`, { error: result.error });
          }
        }
      );
      
      // Update VFS with the audio data
      if (audioBuffer) {
        const vfsUpdate = {};
        vfsUpdate[vfsKey] = audioBuffer.getChannelData(0);
        await renderer.updateVirtualFileSystem(vfsUpdate);
      }
      
      return {
        vfsKey,
        audioBuffer,
        metadata: audioBuffer ? {
          duration: audioBuffer.duration,
          length: audioBuffer.length,
          sampleRate: audioBuffer.sampleRate,
          numberOfChannels: audioBuffer.numberOfChannels
        } : null
      };
    } catch (error) {
      console.error(`${this.type}Unit - Audio fetch error:`, error);
      return { vfsKey, audioBuffer: null, metadata: null, error };
    } finally {
      // Always clean up rendering state
      this.renderingVoices.delete(genomeId);
      this.notifyRenderStateChange();
    }
  }
  
  /**
   * Shared method to handle rendering a sound with specific parameters
   * This is the main public API used by unit classes for audio rendering
   * @param {Object} soundData - Data about the sound (genomeId, experiment, evoRunId)
   * @param {Object} renderParams - Parameters for rendering (duration, pitch, velocity)
   * @param {Object} options - Additional options (vfsKey prefix, callback on success)
   * @returns {Promise<Object>} - Promise that resolves when render completes
   */
  async renderSound(soundData, renderParams, options = {}) {
    const { genomeId } = soundData;
    
    console.log(`${this.type}Unit - Rendering sound:`, {
      soundData,
      renderParams,
      options
    });
    
    // Use getAudioData for consistent audio data loading flow
    const result = await this.getAudioData(soundData, renderParams, options);
    
    if (result.audioBuffer) {
      // Cache the metadata for this specific VFS key
      this.audioDataCache?.set(result.vfsKey, result.metadata);
      
      // Call the onSuccess callback if provided
      if (options.onSuccess) {
        options.onSuccess(result.vfsKey, result.audioBuffer);
      }
    }
    
    return result;
  }

  /**
   * Method to update currently playing voices with new render parameters
   * Child classes should override this method with their specific implementation
   * @param {string} genomeId - Genome ID to update
   * @param {Object} renderParams - New render parameters (duration, pitch, velocity)
   * @returns {Promise<boolean>} - True if successful
   */
  async updatePlayingVoice(genomeId, renderParams) {
    console.log(`${this.type}Unit: Base updatePlayingVoice called, but no implementation exists. Override in child class.`);
    return false;
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
    // Pass the renderingVoices map to ensure consistent callback signature
    this.renderCallbacks.forEach(callback => callback(this.renderingVoices));
  }
  
  /**
   * Check if a specific sound is currently being rendered
   */
  isRendering(genomeId) {
    return this.renderingVoices.has(genomeId);
  }
}
