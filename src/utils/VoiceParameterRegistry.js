/**
 * VoiceParameterRegistry - A unified registry for tracking and updating voice parameters
 * 
 * This registry provides a centralized way to manage voice parameter updates across different units
 * as well as global parameter overrides used by CellDataFormatter.
 */
class VoiceParameterRegistry {
  constructor() {
    if (VoiceParameterRegistry.instance) {
      return VoiceParameterRegistry.instance;
    }

    VoiceParameterRegistry.instance = this;
    
    // Map of registered voices: { voiceId: { genomeId, params, contextId } }
    this.voices = new Map();
    
    // Map of genomes to voice IDs: { genomeId: Set(voiceIds) }
    this.genomeToVoices = new Map();
    
    // Map of contexts to voice IDs: { contextId: Set(voiceIds) }
    this.contextToVoices = new Map();
    
    // Map of parameter change listeners: { listenerId: callback }
    this.renderParamListeners = new Map();
    
    // Global parameter overrides that apply across the application
    this.globalParameters = {
      duration: undefined,
      pitch: undefined,
      velocity: undefined
    };
    
    // Global parameter change callbacks
    this.globalParameterCallbacks = new Set();
    
    console.log('VoiceParameterRegistry initialized');
  }

  /**
   * Register a voice with the registry
   * @param {string} voiceId - Unique ID for the voice
   * @param {string} genomeId - Associated genome ID
   * @param {Object} params - Initial parameters (duration, pitch, velocity, etc.)
   * @param {string} contextId - Optional context ID (e.g. "trajectory-1", "looping-2")
   * @returns {boolean} - True if registration was successful
   */
  registerVoice(voiceId, genomeId, params = {}, contextId = null) {
    if (!voiceId || !genomeId) return false;

    console.log('Registering voice:', { voiceId, genomeId, params, contextId });
    
    // Register the voice
    this.voices.set(voiceId, { genomeId, params, contextId });
    
    // Add to genome mapping for quick lookups
    if (!this.genomeToVoices.has(genomeId)) {
      this.genomeToVoices.set(genomeId, new Set());
    }
    this.genomeToVoices.get(genomeId).add(voiceId);
    
    // Add to context mapping if provided
    if (contextId) {
      if (!this.contextToVoices.has(contextId)) {
        this.contextToVoices.set(contextId, new Set());
      }
      this.contextToVoices.get(contextId).add(voiceId);
    }
    
    return true;
  }
  
  /**
   * Remove a voice from the registry
   * @param {string} voiceId - ID of the voice to remove
   * @returns {boolean} - True if removal was successful
   */
  removeVoice(voiceId) {
    const voiceInfo = this.voices.get(voiceId);
    if (!voiceInfo) return false;
    
    console.log('Removing voice:', voiceId);
    
    // Remove from genome mapping
    const genomeId = voiceInfo.genomeId;
    if (this.genomeToVoices.has(genomeId)) {
      this.genomeToVoices.get(genomeId).delete(voiceId);
      if (this.genomeToVoices.get(genomeId).size === 0) {
        this.genomeToVoices.delete(genomeId);
      }
    }
    
    // Remove from context mapping
    const contextId = voiceInfo.contextId;
    if (contextId && this.contextToVoices.has(contextId)) {
      this.contextToVoices.get(contextId).delete(voiceId);
      if (this.contextToVoices.get(contextId).size === 0) {
        this.contextToVoices.delete(contextId);
      }
    }
    
    // Remove the voice entry
    this.voices.delete(voiceId);
    
    return true;
  }
  
  /**
   * Update parameters for a specific voice
   * @param {string} voiceId - ID of the voice to update
   * @param {Object} params - New parameters to apply
   * @returns {boolean} - True if update was successful
   */
  updateVoiceParameters(voiceId, params) {
    const voiceInfo = this.voices.get(voiceId);
    if (!voiceInfo) return false;
    
    // Update the stored parameters
    this.voices.set(voiceId, {
      ...voiceInfo,
      params: { ...voiceInfo.params, ...params }
    });
    
    return true;
  }
  
  /**
   * Update parameters for all voices associated with a genome
   * @param {string} genomeId - Genome ID
   * @param {Object} params - New parameters to apply
   * @param {string} contextId - Optional context ID to limit updates to a specific context
   * @returns {boolean} - True if update was successful for at least one voice
   */
  updateParameters(genomeId, params, contextId = null) {
    if (!genomeId) return false;
    if (!this.genomeToVoices.has(genomeId)) return false;
    
    console.log('Updating parameters for genome:', {
      genomeId, params, contextId,
      voiceCount: this.genomeToVoices.get(genomeId).size
    });
    
    let updatedAny = false;
    
    // Get all voices for this genome
    const voiceIds = Array.from(this.genomeToVoices.get(genomeId));
    
    // Update each voice if it matches the context filter (if provided)
    for (const voiceId of voiceIds) {
      const voiceInfo = this.voices.get(voiceId);
      
      // Skip if context doesn't match (when contextId is provided)
      if (contextId && voiceInfo.contextId !== contextId) continue;
      
      // Update parameters for this voice
      this.updateVoiceParameters(voiceId, params);
      updatedAny = true;
    }
    
    // Only notify listeners if we actually updated any voices
    if (updatedAny) {
      // Notify listeners of the parameter change
      // Only dispatch render parameter changes - these are exclusively handled on slider release
      const renderParams = {};
      if (params.renderNow && params.duration !== undefined) renderParams.duration = params.duration;
      if (params.renderNow && params.pitch !== undefined) renderParams.pitch = params.pitch;
      if (params.renderNow && params.velocity !== undefined) renderParams.velocity = params.velocity;
      
      if (Object.keys(renderParams).length > 0) {
        voiceIds.forEach(voiceId => {
          this.notifyParamChange(voiceId, genomeId, renderParams);
        });
      }
    }

    // Update global parameters if this is an "explore" update with renderNow flag
    // This ensures we only update global parameters when sliders are released, not during dragging
    if (params.renderNow === true && 
       (params.duration !== undefined || params.pitch !== undefined || params.velocity !== undefined)) {
      // Update global parameters for use by CellDataFormatter
      this.updateGlobalParameters({
        duration: params.duration,
        pitch: params.pitch,
        velocity: params.velocity
      });
    }
    
    return updatedAny;
  }
  
  /**
   * Register a listener for render parameter changes
   * @param {string} listenerId - Unique ID for the listener (typically unit ID)
   * @param {Function} callback - Callback function(voiceId, genomeId, params)
   * @returns {boolean} - True if registration was successful
   */
  registerRenderParamListener(listenerId, callback) {
    if (!listenerId || typeof callback !== 'function') return false;
    
    console.log('Registering render param listener:', listenerId);
    this.renderParamListeners.set(listenerId, callback);
    return true;
  }
  
  /**
   * Remove a render parameter change listener
   * @param {string} listenerId - ID of the listener to remove
   * @returns {boolean} - True if removal was successful
   */
  removeRenderParamListener(listenerId) {
    if (!listenerId) return false;
    
    console.log('Removing render param listener:', listenerId);
    return this.renderParamListeners.delete(listenerId);
  }
  
  /**
   * Notify all listeners of a parameter change
   * @param {string} voiceId - ID of the voice that changed
   * @param {string} genomeId - Genome ID associated with the voice
   * @param {Object} params - Updated parameters
   * @private
   */
  notifyParamChange(voiceId, genomeId, params) {
    if (this.renderParamListeners.size === 0) return;
    
    // Filter parameters to only include render-relevant ones
    const renderParams = {};
    if (params.duration !== undefined) renderParams.duration = params.duration;
    if (params.pitch !== undefined) renderParams.pitch = params.pitch;
    if (params.velocity !== undefined) renderParams.velocity = params.velocity;
    
    // Don't notify if no render parameters were changed
    if (Object.keys(renderParams).length === 0) return;
    
    console.log('Notifying parameter change:', {
      voiceId, genomeId, renderParams,
      listenerCount: this.renderParamListeners.size
    });
    
    // Notify all registered listeners
    this.renderParamListeners.forEach((callback, listenerId) => {
      try {
        callback(voiceId, genomeId, renderParams);
      } catch (error) {
        console.error(`Error in param change listener ${listenerId}:`, error);
      }
    });
  }
  
  /**
   * Get all voices for a specific genome
   * @param {string} genomeId - Genome ID to look up
   * @returns {Array} - Array of voice IDs
   */
  getVoicesForGenome(genomeId) {
    if (!genomeId || !this.genomeToVoices.has(genomeId)) return [];
    return Array.from(this.genomeToVoices.get(genomeId));
  }
  
  /**
   * Get all voices for a specific context
   * @param {string} contextId - Context ID to look up
   * @returns {Array} - Array of voice IDs
   */
  getVoicesForContext(contextId) {
    if (!contextId || !this.contextToVoices.has(contextId)) return [];
    return Array.from(this.contextToVoices.get(contextId));
  }
  
  /**
   * Get current parameters for a voice
   * @param {string} voiceId - Voice ID to look up
   * @returns {Object|null} - Current parameters or null if voice not found
   */
  getVoiceParameters(voiceId) {
    const voiceInfo = this.voices.get(voiceId);
    return voiceInfo ? { ...voiceInfo.params } : null;
  }
  
  /**
   * Clear all registry data
   * @returns {void}
   */
  clear() {
    this.voices.clear();
    this.genomeToVoices.clear();
    this.contextToVoices.clear();
    // Don't clear listeners as they should persist
  }
  
  /**
   * Get debug information about registry state
   * @returns {Object} - Debug information
   */
  getDebugInfo() {
    return {
      voiceCount: this.voices.size,
      genomeCount: this.genomeToVoices.size,
      contextCount: this.contextToVoices.size,
      listenerCount: this.renderParamListeners.size,
      voices: Array.from(this.voices.entries()).map(([id, info]) => ({
        id,
        genomeId: info.genomeId,
        contextId: info.contextId,
        params: { ...info.params }
      }))
    };
  }

  /**
   * Update global parameters used by CellDataFormatter and other components
   * @param {Object} params - New global parameters
   * @returns {boolean} - True if update was successful
   */
  updateGlobalParameters(params) {
    if (!params || typeof params !== 'object') return false;
    
    console.log('VoiceParameterRegistry: Updating global parameters:', params);
    
    // Update the global parameters immediately for reads
    this.globalParameters = {
      ...this.globalParameters,
      ...params
    };
    
    // Notify callbacks immediately - we know this is a final value since it's coming
    // from a slider release or direct parameter update
    this.notifyGlobalParameterChange();
    
    return true;
  }
  
  /**
   * Get current global parameter overrides
   * @returns {Object} - Current global parameters
   */
  getGlobalParameters() {
    return { ...this.globalParameters };
  }
  
  /**
   * Reset global parameters to default values (undefined)
   * @returns {boolean} - True if reset was successful
   */
  resetGlobalParameters() {
    this.globalParameters = {
      duration: undefined,
      pitch: undefined,
      velocity: undefined
    };
    
    // Notify any registered global parameter callbacks
    this.notifyGlobalParameterChange();
    
    return true;
  }
  
  /**
   * Register a callback for global parameter changes
   * @param {Function} callback - Callback function(params)
   * @returns {Function} - Function to unregister callback
   */
  registerGlobalParameterCallback(callback) {
    if (typeof callback !== 'function') {
      console.error('Invalid callback provided to registerGlobalParameterCallback');
      return () => {};
    }
    
    this.globalParameterCallbacks.add(callback);
    
    return () => {
      this.globalParameterCallbacks.delete(callback);
    };
  }
  
  /**
   * Notify all registered callbacks about global parameter changes
   * @private
   */
  notifyGlobalParameterChange() {
    if (this.globalParameterCallbacks.size === 0) return;
    
    console.log('VoiceParameterRegistry: Notifying global parameter change:', {
      parameters: this.globalParameters,
      callbackCount: this.globalParameterCallbacks.size
    });
    
    // Notify all callbacks
    this.globalParameterCallbacks.forEach(callback => {
      try {
        callback(this.globalParameters);
      } catch (error) {
        console.error('Error in global parameter callback:', error);
      }
    });
  }
}

// Export singleton instance
export default new VoiceParameterRegistry();
