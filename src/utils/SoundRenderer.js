import { LINEAGE_SOUNDS_BUCKET_HOST } from '../constants';

class SoundRenderer {
  constructor() {
    // Cache of pending render requests
    this.pendingRenders = new Map();
    // Cache to track which render combinations have been completed
    this.completedRenders = new Set();
  }

  /**
   * Request a sound to be rendered with specific parameters
   * @param {Object} soundData - Original sound data
   * @param {Object} renderParams - Parameters for rendering
   * @param {Function} onComplete - Callback when render is complete
   * @param {Function} onProgress - Optional callback for progress updates
   * @returns {Promise} - Promise that resolves when render is complete
   */
  async renderSound(soundData, renderParams, onComplete, onProgress) {
    const { genomeId, experiment, evoRunId } = soundData;
    const { duration, pitch, velocity } = renderParams;
    
    // Generate a unique key for this render configuration
    const renderKey = this.getRenderKey(genomeId, renderParams);
    
    // Log detailed rendering request
    console.log('SoundRenderer: Render request received', {
      genomeId,
      experiment,
      evoRunId,
      renderParams,
      renderKey
    });
    
    // Check if this exact render is already in progress
    if (this.pendingRenders.has(renderKey)) {
      console.log('SoundRenderer: Render already in progress:', renderKey);
      return this.pendingRenders.get(renderKey);
    }
    
    // Check if we've already rendered this configuration
    if (this.completedRenders.has(renderKey)) {
      console.log('SoundRenderer: Render already completed:', renderKey);
      if (onComplete) {
        onComplete({
          success: true,
          renderKey,
          audioUrl: this.getRenderUrl(soundData, renderParams)
        });
      }
      return Promise.resolve(renderKey);
    }
    
    console.log('Starting render:', {
      genomeId,
      experiment,
      evoRunId,
      renderParams
    });

    // Start a new render process
    const renderPromise = new Promise((resolve, reject) => {
      // Simulate progress updates
      let progress = 0;
      const progressInterval = setInterval(() => {
        progress += 10;
        if (onProgress) {
          onProgress({ progress });
        }
        if (progress >= 100) {
          clearInterval(progressInterval);
        }
      }, 100);
      
      console.log(`SoundRenderer: Started rendering ${renderKey}`);
      
      // Simulate API call with a timeout
      setTimeout(() => {
        clearInterval(progressInterval);
        
        // In a real implementation, this would be where we'd actually
        // call the render API and handle the response
        
        // For now, we'll just simulate a successful render
        this.completedRenders.add(renderKey);
        this.pendingRenders.delete(renderKey);
        
        console.log(`SoundRenderer: Completed rendering ${renderKey}`);
        
        if (onComplete) {
          onComplete({
            success: true,
            renderKey,
            audioUrl: this.getRenderUrl(soundData, renderParams)
          });
        }
        
        resolve(renderKey);
      }, 1500); // Simulate 1.5 second render time - increase for more visible spinner
    });
    
    // Store the promise so we can check if a render is in progress
    this.pendingRenders.set(renderKey, renderPromise);
    
    return renderPromise;
  }
  
  /**
   * Generate a unique key for a render configuration
   */
  getRenderKey(genomeId, renderParams) {
    const { duration, pitch, velocity } = renderParams;
    return `${genomeId}-${duration}_${pitch}_${velocity}`;
  }
  
  /**
   * Generate the URL for a rendered sound
   * In a real implementation, this would point to where the
   * rendered sound is stored on the server
   */
  getRenderUrl(soundData, renderParams) {
    const { genomeId, experiment, evoRunId } = soundData;
    const { duration, pitch, velocity } = renderParams;
    
    // For now, we'll just modify the existing URL pattern
    return `${LINEAGE_SOUNDS_BUCKET_HOST}/${experiment}/${evoRunId}/${genomeId}-${duration}_${pitch}_${velocity}.wav`;
  }
  
  /**
   * Check if a render is currently in progress
   */
  isRendering(genomeId, renderParams) {
    const renderKey = this.getRenderKey(genomeId, renderParams);
    return this.pendingRenders.has(renderKey);
  }
  
  /**
   * Check if a render has already been completed
   */
  hasRendered(genomeId, renderParams) {
    const renderKey = this.getRenderKey(genomeId, renderParams);
    return this.completedRenders.has(renderKey);
  }
  
  /**
   * Clear the render caches
   */
  clearCache() {
    this.completedRenders.clear();
  }
}

// Export singleton instance
export default new SoundRenderer();
