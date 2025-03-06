/**
 * ParameterUtils - Utility for centralized parameter management
 * 
 * This helps components communicate parameter changes across the application
 * without direct dependencies or prop drilling.
 */
class ParameterUtils {
  constructor() {
    // Cache of current parameters
    this.currentParameters = {
      duration: 4,
      noteDelta: 0,
      velocity: 1
    };
    
    // List of callbacks that should be notified of parameter changes
    this.parameterChangeCallbacks = new Set();
  }
  
  /**
   * Register a callback to be notified when parameters change
   * @param {Function} callback - Function to call with new parameters
   * @returns {Function} - Function to unregister callback
   */
  registerParameterChangeCallback(callback) {
    if (typeof callback !== 'function') {
      console.error('Invalid callback provided to registerParameterChangeCallback');
      return () => {};
    }
    
    this.parameterChangeCallbacks.add(callback);
    
    // Return unregister function
    return () => {
      this.parameterChangeCallbacks.delete(callback);
    };
  }
  
  /**
   * Notify all registered callbacks about parameter changes
   * @param {Object} parameters - New parameters
   */
  notifyParameterChange(parameters) {
    if (!parameters || typeof parameters !== 'object') return;
    
    // Update current parameters
    this.currentParameters = {
      ...this.currentParameters,
      ...parameters
    };
    
    console.log('ParameterUtils: Notifying parameter change:', {
      parameters,
      callbackCount: this.parameterChangeCallbacks.size
    });
    
    // Notify all callbacks
    this.parameterChangeCallbacks.forEach(callback => {
      try {
        callback(this.currentParameters);
      } catch (error) {
        console.error('Error in parameter change callback:', error);
      }
    });
  }
  
  /**
   * Get current parameters
   * @returns {Object} - Current parameters
   */
  getCurrentParameters() {
    return { ...this.currentParameters };
  }
  
  /**
   * Reset parameters to defaults
   */
  resetParameters() {
    this.currentParameters = {
      duration: 4,
      noteDelta: 0,
      velocity: 1
    };
    
    // Notify all callbacks of reset
    this.notifyParameterChange(this.currentParameters);
  }
}

// Export singleton instance
export default new ParameterUtils();
