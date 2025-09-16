import SoundRenderer from './SoundRenderer';
import { getRestServiceHost, REST_ENDPOINTS, getLineageSoundsBucketHost, FEATURE_FLAGS } from '../constants';

/**
 * AudioFetcher - A utility class to get audio buffers either from WAV files or from the SoundRenderer
 * 
 * Feature flag FEATURE_FLAGS.SKIP_WAV_FETCHING can be used to skip WAV file fetching and go 
 * directly to rendering from genome data. This avoids unnecessary network roundtrips when 
 * WAV files are mostly unavailable.
 */
class AudioFetcher {
  /**
   * Get genome JSON URL from sound data
   * @param {Object} soundData - Data about the sound (genomeId, experiment, evoRunId)
   * @returns {string} - URL to genome JSON data
   */
  static getGenomeUrl(soundData) {
    const { genomeId, experiment, evoRunId } = soundData;
    if (!genomeId || !evoRunId) {
      throw new Error('Missing required parameters for genome URL');
    }
    
    // Use REST service endpoint for genome data
    // evoRunId should now contain the full folder name
    const restHost = getRestServiceHost();
    return `${restHost}${REST_ENDPOINTS.GENOME(evoRunId, genomeId)}`;
  }
  
  /**
   * Get WAV URL from sound data
   * @param {Object} soundData - Data about the sound (genomeId, experiment, evoRunId)
   * @param {Object} renderParams - Parameters for rendering (duration, pitch, velocity)
   * @returns {string} - URL to the WAV file
   */
  static getWavUrl(soundData, renderParams) {
    const { genomeId, evoRunId } = soundData;
    const { duration, pitch, velocity } = renderParams;
    
    // Use REST service endpoint for rendered WAV files
    // evoRunId should now contain the full folder name
    const restHost = getRestServiceHost();
    return `${restHost}${REST_ENDPOINTS.RENDER_AUDIO(evoRunId, genomeId, duration, pitch, velocity)}`;
  }
  
  /**
   * Get fallback genome JSON URL from sound data (for backward compatibility)
   * @param {Object} soundData - Data about the sound (genomeId, experiment, evoRunId)
   * @returns {string} - URL to genome JSON data
   */
  static getFallbackGenomeUrl(soundData) {
    const { genomeId, experiment, evoRunId } = soundData;
    if (!genomeId || !evoRunId) {
      throw new Error('Missing required parameters for genome URL');
    }
    
    // Use the legacy static server format
    const staticHost = getLineageSoundsBucketHost();
    return `${staticHost}/evoruns/${evoRunId}/genome_${evoRunId}_${genomeId}.json.gz`;
  }
  
  /**
   * Get fallback WAV URL from sound data (for backward compatibility)
   * @param {Object} soundData - Data about the sound (genomeId, experiment, evoRunId)
   * @param {Object} renderParams - Parameters for rendering (duration, pitch, velocity)
   * @returns {string} - URL to the WAV file
   */
  static getFallbackWavUrl(soundData, renderParams) {
    const { genomeId, evoRunId } = soundData;
    const { duration, pitch, velocity } = renderParams;
    
    // Use the legacy static server format
    const staticHost = getLineageSoundsBucketHost();
    return `${staticHost}/evorenders/${evoRunId}/${genomeId}-${duration}_${pitch}_${velocity}.wav`;
  }
  
  /**
   * Get AudioData for the specified sound
   * When FEATURE_FLAGS.SKIP_WAV_FETCHING is enabled, goes directly to rendering from genome.
   * Otherwise, first attempts to fetch from WAV, then falls back to SoundRenderer if needed.
   * @param {Object} soundData - Data about the sound (genomeId, experiment, evoRunId)
   * @param {Object} renderParams - Parameters for rendering (duration, pitch, velocity)
   * @param {AudioContext} audioContext - AudioContext to use for decoding
   * @param {Function} onComplete - Callback when audio is available
   * @param {Function} onProgress - Optional callback for progress updates
   * @returns {Promise<AudioBuffer>} - Promise that resolves with the AudioBuffer
   */
  static async getAudioData(soundData, renderParams, audioContext, onComplete, onProgress) {
    const cacheKey = `${soundData.genomeId}-${renderParams.duration}_${renderParams.pitch}_${renderParams.velocity}`;
    
    // First check if we have this in the local cache
    if (this.audioBufferCache && this.audioBufferCache[cacheKey]) {
      console.log(`AudioFetcher: Using cached audio buffer for ${cacheKey}`);
      const cachedBuffer = this.audioBufferCache[cacheKey];
      
      // Check if the buffer is valid (not detached)
      if (cachedBuffer.length > 0) {
        // Return the audio buffer via both promise and callback
        if (onComplete) {
          onComplete({ 
            success: true, 
            audioBuffer: cachedBuffer, 
            source: 'cache',
            cacheKey
          });
        }
        return cachedBuffer;
      }
      
      // If we get here, the cached buffer was invalid
      console.log(`AudioFetcher: Cached buffer for ${cacheKey} was invalid, re-rendering`);
      delete this.audioBufferCache[cacheKey];
    }

    // Check feature flag to skip WAV fetching
    if (FEATURE_FLAGS.SKIP_WAV_FETCHING) {
      console.log('AudioFetcher: Skipping WAV fetching due to feature flag, going directly to renderer');
      
      // Go directly to renderer
      try {
        // Return a promise that resolves when the render completes
        return new Promise((resolve, reject) => {
          SoundRenderer.renderSound(
            soundData,
            renderParams,
            (result) => {
              if (result.success && result.audioBuffer) {
                // Cache the buffer for future use
                if (!this.audioBufferCache) this.audioBufferCache = {};
                this.audioBufferCache[cacheKey] = result.audioBuffer;
                
                if (onComplete) {
                  onComplete({ 
                    success: true, 
                    audioBuffer: result.audioBuffer,
                    source: 'renderer',
                    cacheKey
                  });
                }
                resolve(result.audioBuffer);
              } else {
                const error = new Error('Render failed: ' + (result.error || 'Unknown error'));
                if (onComplete) {
                  onComplete({ 
                    success: false, 
                    error: error.message,
                    source: 'renderer'
                  });
                }
                reject(error);
              }
            },
            onProgress
          );
        });
      } catch (renderError) {
        console.error('AudioFetcher: Direct render failed:', renderError);
        if (onComplete) {
          onComplete({ 
            success: false, 
            error: renderError.message,
            source: 'renderer'
          });
        }
        throw renderError;
      }
    }
    
    // Legacy path: try WAV fetching first (when feature flag is disabled)
    const wavUrl = this.getWavUrl(soundData, renderParams);
    // Legacy path: try WAV fetching first (when feature flag is disabled)
    
    // First try to fetch from WAV URL
    try {
      const wavUrl = this.getWavUrl(soundData, renderParams);
      const response = await fetch(wavUrl);
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        
        // Cache the buffer for future use
        if (!this.audioBufferCache) this.audioBufferCache = {};
        this.audioBufferCache[cacheKey] = audioBuffer;
        
        // Return the audio buffer via both promise and callback
        if (onComplete) {
          onComplete({ 
            success: true, 
            audioBuffer, 
            source: 'wav',
            cacheKey
          });
        }
        return audioBuffer;
      }
      
      // If response is not OK, throw error to trigger fallback
      throw new Error(`Failed to fetch WAV file: ${response.status}`);
    } catch (error) {
      console.log(`AudioFetcher: WAV fetch failed (${error.message}), trying fallback static server`);
      
      // Try fallback static server before going to renderer
      try {
        const fallbackWavUrl = this.getFallbackWavUrl(soundData, renderParams);
        const fallbackResponse = await fetch(fallbackWavUrl);
        if (fallbackResponse.ok) {
          const arrayBuffer = await fallbackResponse.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          
          // Cache the buffer for future use
          if (!this.audioBufferCache) this.audioBufferCache = {};
          this.audioBufferCache[cacheKey] = audioBuffer;
          
          // Return the audio buffer via both promise and callback
          if (onComplete) {
            onComplete({ 
              success: true, 
              audioBuffer, 
              source: 'wav-fallback',
              cacheKey
            });
          }
          return audioBuffer;
        }
        
        throw new Error(`Fallback WAV fetch failed: ${fallbackResponse.status}`);
      } catch (fallbackError) {
        console.log(`AudioFetcher: Fallback WAV fetch failed (${fallbackError.message}), using renderer fallback`);
      }
      
      // Fall back to renderer
      try {
        // Return a promise that resolves when the render completes
        return new Promise((resolve, reject) => {
          SoundRenderer.renderSound(
            soundData,
            renderParams,
            (result) => {
              if (result.success && result.audioBuffer) {
                // Cache the buffer for future use
                if (!this.audioBufferCache) this.audioBufferCache = {};
                this.audioBufferCache[cacheKey] = result.audioBuffer;
                
                if (onComplete) {
                  onComplete({ 
                    success: true, 
                    audioBuffer: result.audioBuffer,
                    source: 'renderer',
                    cacheKey
                  });
                }
                resolve(result.audioBuffer);
              } else {
                const error = new Error('Render failed: ' + (result.error || 'Unknown error'));
                if (onComplete) {
                  onComplete({ 
                    success: false, 
                    error: error.message,
                    source: 'renderer'
                  });
                }
                reject(error);
              }
            },
            onProgress
          );
        });
      } catch (renderError) {
        console.error('AudioFetcher: Render fallback failed:', renderError);
        if (onComplete) {
          onComplete({ 
            success: false, 
            error: renderError.message,
            source: 'unknown'
          });
        }
        throw renderError;
      }
    }
  }

  /**
   * Clear the audio buffer cache
   */
  static clearCache() {
    this.audioBufferCache = {};
  }

  /**
   * Get a specific cached audio buffer
   * @param {string} genomeId - Genome ID 
   * @param {Object} renderParams - Parameters for rendering (duration, pitch, velocity)
   * @returns {AudioBuffer|null} - The cached buffer or null if not found
   */
  static getCachedBuffer(genomeId, renderParams) {
    const cacheKey = `${genomeId}-${renderParams.duration}_${renderParams.pitch}_${renderParams.velocity}`;
    return (this.audioBufferCache && this.audioBufferCache[cacheKey]) || null;
  }
}

export default AudioFetcher;