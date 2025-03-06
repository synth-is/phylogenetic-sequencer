import { LINEAGE_SOUNDS_BUCKET_HOST } from '../constants';

// WebSocket server URL - this should be moved to environment config 
const RENDERING_SOCKET_SERVER = 'ws://localhost:3000';

// Create a worker blob to handle WebSocket communication off the main thread
const createWebSocketWorker = () => {
  const workerCode = `
    let socket = null;
    let messageQueue = [];
    let isConnecting = false;
    const RECONNECT_DELAY = 5000;
    
    // Connect to WebSocket server
    function connectToServer(url) {
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        return;
      }
      
      isConnecting = true;
      
      try {
        socket = new WebSocket(url);
        socket.binaryType = 'arraybuffer';
        
        socket.onopen = () => {
          isConnecting = false;
          self.postMessage({ type: 'connection', status: 'open' });
          
          // Send any queued messages
          while (messageQueue.length > 0) {
            const message = messageQueue.shift();
            socket.send(message);
          }
        };
        
        socket.onmessage = (event) => {
          // Transfer the data directly to the main thread without copying
          if (event.data instanceof ArrayBuffer) {
            self.postMessage({ 
              type: 'binary', 
              data: event.data 
            }, [event.data]); // Transfer ownership to avoid copying
          } else {
            try {
              const data = JSON.parse(event.data);
              self.postMessage({ type: 'json', data });
            } catch (error) {
              self.postMessage({ 
                type: 'error', 
                error: 'Error parsing message: ' + error.message, 
                original: event.data 
              });
            }
          }
        };
        
        socket.onclose = (event) => {
          self.postMessage({ 
            type: 'connection', 
            status: 'closed', 
            code: event.code,
            reason: event.reason 
          });
          
          socket = null;
          isConnecting = false;
          
          // Attempt to reconnect after delay
          setTimeout(() => {
            connectToServer(url);
          }, RECONNECT_DELAY);
        };
        
        socket.onerror = (error) => {
          self.postMessage({ 
            type: 'error', 
            error: 'WebSocket error'
          });
        };
      } catch (error) {
        self.postMessage({ 
          type: 'error', 
          error: 'Failed to create WebSocket: ' + error.message
        });
        isConnecting = false;
        
        // Attempt to reconnect after delay
        setTimeout(() => {
          connectToServer(url);
        }, RECONNECT_DELAY);
      }
    }
    
    // Handle messages from main thread
    self.onmessage = (event) => {
      const { type, url, data } = event.data;
      
      switch (type) {
        case 'connect':
          connectToServer(url);
          break;
          
        case 'send':
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(data);
          } else {
            messageQueue.push(data);
            // Try connecting if not already connecting
            if (!isConnecting) {
              connectToServer(url);
            }
          }
          break;
          
        case 'close':
          if (socket) {
            socket.close();
            socket = null;
          }
          break;
      }
    };
  `;
  
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
};

class SoundRenderer {
  constructor() {
    // Cache of pending render requests
    this.pendingRenders = new Map();
    // Cache to track which render combinations have been completed
    this.completedRenders = new Set();
    // WebSocket Worker
    this.worker = null;
    // Queue for messages waiting for worker initialization
    this.messageQueue = [];
    // Map of callbacks waiting for responses
    this.responseCallbacks = new Map();
    // Flag to track connection state
    this.isConnecting = false;
    // Current render key for data association
    this.currentRenderKey = null;
    
    // Add debounce timers for render requests
    this.debounceTimers = new Map();
    // Track current render by genomeId to allow cancellation
    this.currentRendersByGenome = new Map();
    
    // Worker initialization state
    this.isWorkerInitialized = false;
    
    // Context for audio decoding
    this.audioContext = null;

    // Initialize the worker
    this.initializeWorker();
  }

  /**
   * Initialize WebSocket Worker
   */
  initializeWorker() {
    try {
      const workerUrl = createWebSocketWorker();
      this.worker = new Worker(workerUrl);
      
      // Handle messages from worker
      this.worker.onmessage = this.handleWorkerMessage.bind(this);
      
      // Connect to WebSocket server
      this.worker.postMessage({
        type: 'connect',
        url: RENDERING_SOCKET_SERVER
      });
      
      // Set flag for worker initialization
      this.isWorkerInitialized = true;
      
      // Process any queued messages
      while (this.messageQueue.length > 0) {
        const message = this.messageQueue.shift();
        this.sendToWorker(message);
      }
      
      console.log('WebSocket worker initialized');
    } catch (error) {
      console.error('Failed to initialize WebSocket worker:', error);
      this.isWorkerInitialized = false;
    }
  }
  
  /**
   * Handle messages from worker
   * @param {MessageEvent} event - Message from worker
   */
  handleWorkerMessage(event) {
    const { type, data, status, error } = event.data;
    
    switch (type) {
      case 'connection':
        console.log(`WebSocket connection ${status}`);
        this.isConnecting = status === 'connecting';
        break;
        
      case 'binary':
        this.handleBinaryData(data);
        break;
        
      case 'json':
        console.log('Received JSON message:', data);
        break;
        
      case 'error':
        console.error('WebSocket error:', error);
        break;
    }
  }
  
  /**
   * Handle binary data from worker
   * @param {ArrayBuffer} data - Binary data
   */
  handleBinaryData(data) {
    // Check if we have a current render key and data is valid
    if (!this.currentRenderKey || !data || data.byteLength === 0) {
      console.error('Received binary data without render key or empty data');
      return;
    }
    
    // Convert PCM data to AudioBuffer
    const pcmData = new Int16Array(data, 0, data.byteLength / 2);
    
    // Create or get an AudioContext using a factory pattern to avoid creating
    // multiple contexts unnecessarily
    if (!this.audioContext) {
      this.audioContext = new AudioContext({
        latencyHint: 'interactive',
        sampleRate: 48000 // Match expected sample rate
      });
    }
    
    const audioBuffer = this.convertToAudioBuffer(pcmData, this.audioContext);
    
    // Find the callback for this buffer
    const renderKey = this.currentRenderKey;
    if (renderKey && this.responseCallbacks.has(renderKey)) {
      const callback = this.responseCallbacks.get(renderKey);
      this.responseCallbacks.delete(renderKey);
      
      this.completedRenders.add(renderKey);
      this.pendingRenders.delete(renderKey);
      
      // Extract genomeId from renderKey
      const genomeIdMatch = renderKey.match(/(.+?)-\d+_/);
      const genomeId = genomeIdMatch ? genomeIdMatch[1] : null;
      
      // Clear from current renders if this is the active render for this genome
      if (genomeId && this.currentRendersByGenome.get(genomeId) === renderKey) {
        this.currentRendersByGenome.delete(genomeId);
      }
      
      // Reset current render key
      this.currentRenderKey = null;
      
      callback({
        success: true,
        renderKey,
        audioBuffer,
      });
    }
  }

  /**
   * Send message to worker with fallback for non-initialized worker
   * @param {Object} message - Message to send
   */
  sendToWorker(message) {
    if (!this.isWorkerInitialized) {
      this.messageQueue.push(message);
      return;
    }
    
    this.worker.postMessage(message);
  }

  /**
   * Convert Int16 PCM data to AudioBuffer
   */
  convertToAudioBuffer(pcmData, audioContext) {
    const numChannels = 1; // Mono audio
    const sampleRate = 48000; // Standard sample rate for our renders
    const numSamples = pcmData.length / numChannels;
    
    // Create AudioBuffer with specific options for better performance
    const audioBuffer = audioContext.createBuffer(numChannels, numSamples, sampleRate);
    
    // Get channel data for direct writing
    const channelData = audioBuffer.getChannelData(0);
    
    // Use a more efficient loop structure for large buffers
    for (let i = 0; i < numSamples; i++) {
      // Convert 16-bit PCM to float32 and scale to range [-1, 1]
      channelData[i] = pcmData[i] / 32767;
    }
    
    return audioBuffer;
  }

  /**
   * Request a sound to be rendered with specific parameters
   * @param {string} genomeDataUrl - URL to the genome JSON data
   * @param {Object} renderParams - Parameters for rendering
   * @param {Function} onComplete - Callback when render is complete
   * @param {Function} onProgress - Optional callback for progress updates
   * @returns {Promise} - Promise that resolves when render is complete
   */
  async renderGenome(genomeDataUrl, renderParams, onComplete, onProgress) {
    const { duration, pitch, velocity } = renderParams;
    
    // Generate a unique key for this render configuration
    const renderKey = `${genomeDataUrl}-${duration}_${pitch}_${velocity}`;
    
    // Extract genomeId from URL for tracking renders by genome
    const genomeId = this.extractGenomeId(genomeDataUrl);
    
    // Log detailed rendering request
    console.log('SoundRenderer: Render request received', {
      genomeDataUrl,
      renderParams,
      renderKey,
      genomeId
    });
    
    // Check if we've already rendered this configuration
    if (this.completedRenders.has(renderKey)) {
      console.log('SoundRenderer: Render already completed:', renderKey);
      if (onComplete) {
        onComplete({
          success: true,
          renderKey,
          cached: true
        });
      }
      return Promise.resolve(renderKey);
    }
    
    // Cancel any existing debounce timers for this genome
    if (this.debounceTimers.has(genomeId)) {
      clearTimeout(this.debounceTimers.get(genomeId));
    }
    
    // Create a new promise for this render
    return new Promise((resolve, reject) => {
      // Set debounce timer to delay actual rendering
      const debounceTimer = setTimeout(async () => {
        // Remove this timer reference
        this.debounceTimers.delete(genomeId);
        
        // Cancel any in-progress renders for the same genome
        this.cancelRenderForGenome(genomeId);
        
        // Start a new render
        console.log('Starting WebSocket render after debounce:', {
          genomeDataUrl,
          renderParams,
          genomeId
        });
        
        try {
          // Prepare the request
          const audioRenderRequest = JSON.stringify({
            type: 'get_audio_data',
            genomeStringUrl: genomeDataUrl,
            duration,
            noteDelta: pitch,
            velocity,
            reverse: false,
            useOvertoneInharmonicityFactors: true,
            antiAliasing: false,
            frequencyUpdatesApplyToAllPathcNetworkOutputs: false,
            sampleRate: 48000,
          });
          
          // Store the callback so we can call it when we get the response
          this.responseCallbacks.set(renderKey, (result) => {
            // Remove from current renders
            this.currentRendersByGenome.delete(genomeId);
            this.pendingRenders.delete(renderKey);
            
            if (result.success) {
              this.completedRenders.add(renderKey);
              if (onComplete) {
                onComplete(result);
              }
              resolve(renderKey);
            } else {
              if (onComplete) {
                onComplete(result);
              }
              reject(result.error || 'Render failed');
            }
          });
          
          // Track this as the current render for this genomeId
          this.currentRendersByGenome.set(genomeId, renderKey);
          this.pendingRenders.set(renderKey, true);
          
          // Set the current render key to associate with incoming data
          this.currentRenderKey = renderKey;
          
          // Start progress updates
          let progress = 0;
          const progressInterval = setInterval(() => {
            progress += 10;
            if (onProgress) {
              onProgress({ progress: Math.min(progress, 95) }); // Cap at 95% until complete
            }
            if (progress >= 100) {
              clearInterval(progressInterval);
            }
          }, 200);
          
          // Send the request through the worker
          this.sendToWorker({
            type: 'send',
            data: audioRenderRequest
          });
          
          // Set timeout for the render to complete
          setTimeout(() => {
            if (this.responseCallbacks.has(renderKey)) {
              clearInterval(progressInterval);
              this.responseCallbacks.delete(renderKey);
              this.currentRendersByGenome.delete(genomeId);
              this.pendingRenders.delete(renderKey);
              
              // Reset current render key if it's this one
              if (this.currentRenderKey === renderKey) {
                this.currentRenderKey = null;
              }
              
              if (onComplete) {
                onComplete({
                  success: false,
                  renderKey,
                  error: 'Render timeout'
                });
              }
              reject('Render timeout');
            }
          }, 30000); // 30 second timeout
        } catch (error) {
          console.error('SoundRenderer: Error sending WebSocket request:', error);
          this.currentRendersByGenome.delete(genomeId);
          this.pendingRenders.delete(renderKey);
          
          if (onComplete) {
            onComplete({
              success: false,
              renderKey,
              error: 'Error sending WebSocket request'
            });
          }
          reject('Error sending WebSocket request');
        }
      }, 300); // Debounce delay - wait 300ms before sending the actual render request
      
      // Store the debounce timer
      this.debounceTimers.set(genomeId, debounceTimer);
    });
  }
  
  /**
   * Extract genomeId from a genomeDataUrl for tracking purposes
   */
  extractGenomeId(genomeDataUrl) {
    // Try to parse the URL to get the genomeId
    try {
      // Format is typically .../genome_RUNID_GENOMEID.json.gz
      const urlParts = genomeDataUrl.split('/');
      const filename = urlParts[urlParts.length - 1];
      const idMatch = filename.match(/genome_.*?_([^.]+)/);
      if (idMatch && idMatch[1]) {
        return idMatch[1];
      }
    } catch (e) {
      console.warn('Could not extract genomeId from URL:', genomeDataUrl);
    }
    
    // Fall back to the full URL as the ID
    return genomeDataUrl;
  }
  
  /**
   * Cancel any in-progress renders for a specific genome
   */
  cancelRenderForGenome(genomeId) {
    if (!this.currentRendersByGenome.has(genomeId)) {
      return false;
    }
    
    // Get the render key for this genome
    const renderKey = this.currentRendersByGenome.get(genomeId);
    
    // If there's a callback waiting, call it with a cancellation
    if (this.responseCallbacks.has(renderKey)) {
      console.log(`Cancelling render for genome ${genomeId} (key: ${renderKey})`);
      
      const callback = this.responseCallbacks.get(renderKey);
      this.responseCallbacks.delete(renderKey);
      this.pendingRenders.delete(renderKey);
      
      // Reset current render key if it's this one
      if (this.currentRenderKey === renderKey) {
        this.currentRenderKey = null;
      }
      
      // Notify the callback of cancellation
      callback({
        success: false,
        renderKey,
        error: 'Cancelled by newer render request',
        cancelled: true
      });
    }
    
    // Remove from current renders
    this.currentRendersByGenome.delete(genomeId);
    return true;
  }

  /**
   * Request a sound to be rendered with specific parameters
   * This is a bridge method for compatibility with units expecting renderSound
   * @param {Object} soundData - Data about the sound (genomeId, experiment, evoRunId)
   * @param {Object} renderParams - Parameters for rendering
   * @param {Function} onComplete - Callback when render is complete
   * @param {Function} onProgress - Optional callback for progress updates
   * @returns {Promise} - Promise that resolves when render is complete
   */
  async renderSound(soundData, renderParams, onComplete, onProgress) {
    const { genomeId, experiment, evoRunId } = soundData;

    // Construct genome URL from sound data
    const genomeUrl = `${LINEAGE_SOUNDS_BUCKET_HOST}/evoruns/${evoRunId}/genome_${evoRunId}_${genomeId}.json.gz`;
    
    console.log('SoundRenderer.renderSound:', { 
      soundData, 
      renderParams, 
      genomeUrl 
    });

    // Delegate to renderGenome method
    return this.renderGenome(genomeUrl, renderParams, onComplete, onProgress);
  }

  /**
   * Check if a render is currently in progress
   */
  isRendering(genomeDataUrl, renderParams) {
    const { duration, pitch, velocity } = renderParams;
    const renderKey = `${genomeDataUrl}-${duration}_${pitch}_${velocity}`;
    return this.pendingRenders.has(renderKey);
  }
  
  /**
   * Check if a render has already been completed
   */
  hasRendered(genomeDataUrl, renderParams) {
    const { duration, pitch, velocity } = renderParams;
    const renderKey = `${genomeDataUrl}-${duration}_${pitch}_${velocity}`;
    return this.completedRenders.has(renderKey);
  }
  
  /**
   * Clear the render caches
   */
  clearCache() {
    this.completedRenders.clear();
  }
  
  /**
   * Clean up resources
   */
  cleanup() {
    // Clear any pending callbacks
    this.responseCallbacks.clear();
    this.pendingRenders.clear();
    this.currentRendersByGenome.clear();
    
    // Clear timers
    this.debounceTimers.forEach(timer => clearTimeout(timer));
    this.debounceTimers.clear();
    
    // Terminate the worker
    if (this.worker) {
      this.worker.postMessage({ type: 'close' });
      this.worker.terminate();
      this.worker = null;
    }
    
    // Close AudioContext
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(err => console.warn('Error closing AudioContext:', err));
    }
  }
}

// Export singleton instance
export default new SoundRenderer();
