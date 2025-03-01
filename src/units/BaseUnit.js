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
   * @returns {Promise<AudioBuffer>} - Promise that resolves with the AudioBuffer
   */
  async getAudioData(soundData, renderParams, options = {}) {
    const { genomeId } = soundData;
    const vfsKeyPrefix = options.vfsKeyPrefix || `sound-`;
    const vfsKey = `${vfsKeyPrefix}${genomeId}`;
    
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
            console.log(`${this.type}Unit: Audio data received from ${result.source}`, { genomeId });
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
        
        // If this is a custom render, also update a unique version
        if (renderParams.duration !== 4 || renderParams.pitch !== 0 || renderParams.velocity !== 1) {
          const customKey = `${vfsKey}-${renderParams.duration}_${renderParams.pitch}_${renderParams.velocity}`;
          vfsUpdate[customKey] = audioBuffer.getChannelData(0);
          await renderer.updateVirtualFileSystem(vfsUpdate);
        }
      }
      
      // Call the onSuccess callback if provided
      if (options.onSuccess) {
        options.onSuccess(vfsKey, audioBuffer);
      }
      
      return {
        vfsKey,
        audioBuffer,
        metadata: {
          duration: audioBuffer.duration,
          length: audioBuffer.length,
          sampleRate: audioBuffer.sampleRate,
          numberOfChannels: audioBuffer.numberOfChannels
        }
      };
    } catch (error) {
      console.error(`${this.type}Unit - Audio fetch error:`, error);
      return null;
    } finally {
      // Always clean up rendering state
      this.renderingVoices.delete(genomeId);
      this.notifyRenderStateChange();
    }
  }
  
  /**
   * Shared method to handle rendering a sound with specific parameters
   * @param {Object} soundData - Data about the sound (genomeId, experiment, evoRunId)
   * @param {Object} renderParams - Parameters for rendering (duration, pitch, velocity)
   * @param {Object} options - Additional options (vfsKey prefix, callback on success)
   * @returns {Promise} - Promise that resolves when render completes
   */
  async renderSound(soundData, renderParams, options = {}) {
    const { genomeId } = soundData;
    const vfsKeyPrefix = options.vfsKeyPrefix || `sound-`;
    const vfsKey = `${vfsKeyPrefix}${genomeId}`;
    
    console.log(`${this.type}Unit - Rendering sound:`, {
      soundData,
      renderParams,
      options
    });
    
    // Mark as rendering
    this.renderingVoices.set(genomeId, renderParams);
    this.notifyRenderStateChange();
    
    try {
      // Use AudioFetcher to get the audio data
      const result = await this.getAudioData(soundData, renderParams, {
        ...options,
        vfsKeyPrefix
      });
      
      if (options.onSuccess && result) {
        options.onSuccess(result.vfsKey, result.audioBuffer);
      }
      
      return result;
    } catch (error) {
      console.error(`${this.type}Unit - Render error:`, error);
      return null;
    } finally {
      // Always clean up rendering state
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
