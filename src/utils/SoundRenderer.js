import { LINEAGE_SOUNDS_BUCKET_HOST } from '../constants';

// WebSocket server URL - this should be moved to environment config 
const RENDERING_SOCKET_SERVER = 'wss://rendering.synth.is';

class SoundRenderer {
  constructor() {
    // Cache of pending render requests
    this.pendingRenders = new Map();
    // Cache to track which render combinations have been completed
    this.completedRenders = new Set();
    // WebSocket instance
    this.socket = null;
    // Queue for messages waiting for socket connection
    this.messageQueue = [];
    // Map of callbacks waiting for responses
    this.responseCallbacks = new Map();
    // Flag to track connection state
    this.isConnecting = false;
  }

  /**
   * Get or initialize WebSocket connection
   * @returns {WebSocket} - WebSocket connection
   */
  getSocket() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return this.socket;
    }
    
    if (!this.isConnecting) {
      this.isConnecting = true;
      console.log('SoundRenderer: Initializing WebSocket connection to:', RENDERING_SOCKET_SERVER);
      
      this.socket = new WebSocket(RENDERING_SOCKET_SERVER);
      this.socket.binaryType = 'arraybuffer';
      
      this.socket.onopen = () => {
        console.log('SoundRenderer: WebSocket connection established');
        this.isConnecting = false;
        
        // Send any queued messages
        while (this.messageQueue.length > 0) {
          const message = this.messageQueue.shift();
          this.socket.send(message);
        }
      };
      
      this.socket.onmessage = (event) => this.handleSocketMessage(event);
      
      this.socket.onclose = () => {
        console.log('SoundRenderer: WebSocket connection closed');
        this.socket = null;
        this.isConnecting = false;
        
        // Attempt to reconnect after a delay
        setTimeout(() => {
          this.getSocket();
        }, 5000);
      };
      
      this.socket.onerror = (error) => {
        console.error('SoundRenderer: WebSocket error:', error);
        // Socket will automatically close with onclose handler
      };
    }
    
    return this.socket;
  }

  /**
   * Handle incoming WebSocket messages
   * @param {MessageEvent} event - WebSocket message event
   */
  handleSocketMessage(event) {
    // Check if the response is binary
    if (event.data instanceof ArrayBuffer) {
      // Handle binary audio data response
      if (event.data.byteLength > 0) {
        console.log(`SoundRenderer: Received binary data of size ${event.data.byteLength}`);
        
        // Convert PCM data to AudioBuffer
        const pcmData = new Int16Array(event.data, 0, event.data.byteLength / 2);
        const audioContext = new AudioContext();
        const audioBuffer = this.convertToAudioBuffer(pcmData, audioContext);
        
        // Find the callback for this buffer
        const renderKey = this.findCallbackForBuffer();
        if (renderKey && this.responseCallbacks.has(renderKey)) {
          const callback = this.responseCallbacks.get(renderKey);
          this.responseCallbacks.delete(renderKey);
          
          this.completedRenders.add(renderKey);
          this.pendingRenders.delete(renderKey);
          
          callback({
            success: true,
            renderKey,
            audioBuffer,
          });
        }
      }
    } else {
      // Handle JSON message
      try {
        const data = JSON.parse(event.data);
        console.log('SoundRenderer: Received JSON message:', data);
      } catch (error) {
        console.error('SoundRenderer: Error parsing JSON message:', error);
      }
    }
  }

  /**
   * Find the render key associated with a received buffer
   */
  findCallbackForBuffer() {
    // For now, just return the first pending render key
    const firstKey = this.responseCallbacks.keys().next().value;
    return firstKey;
  }

  /**
   * Convert Int16 PCM data to AudioBuffer
   */
  convertToAudioBuffer(pcmData, audioContext) {
    const numChannels = 1; // Mono audio
    const sampleRate = 48000; // Standard sample rate for our renders
    const numSamples = pcmData.length / numChannels;
    
    const audioBuffer = audioContext.createBuffer(numChannels, numSamples, sampleRate);
    
    for (let channel = 0; channel < numChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      
      for (let sample = 0; sample < numSamples; sample++) {
        const index = (sample * numChannels + channel);
        // Convert 16-bit PCM to float32 and scale to range [-1, 1]
        const pcmSample = pcmData[index] / 32767;
        channelData[sample] = pcmSample;
      }
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
    
    // Log detailed rendering request
    console.log('SoundRenderer: Render request received', {
      genomeDataUrl,
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
          cached: true
        });
      }
      return Promise.resolve(renderKey);
    }
    
    console.log('Starting WebSocket render:', {
      genomeDataUrl,
      renderParams
    });
    
    // Start a new render process
    const renderPromise = new Promise((resolve, reject) => {
      // Prepare the request
      const audioRenderRequest = JSON.stringify({
        type: 'get_audio_data',
        genomeStringUrl: genomeDataUrl,
        duration,
        noteDelta: pitch,
        velocity,
        reverse: false,
        useOvertoneInharmonicityFactors: true,
        antiAliasing: true,
      });
      
      // Store the callback so we can call it when we get the response
      this.responseCallbacks.set(renderKey, (result) => {
        if (result.success) {
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
      
      // Send the request to the WebSocket
      try {
        const socket = this.getSocket();
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(audioRenderRequest);
        } else {
          // Queue the message to be sent when the socket opens
          this.messageQueue.push(audioRenderRequest);
        }
      } catch (error) {
        console.error('SoundRenderer: Error sending WebSocket request:', error);
        clearInterval(progressInterval);
        this.responseCallbacks.delete(renderKey);
        
        if (onComplete) {
          onComplete({
            success: false,
            renderKey,
            error: 'Error sending WebSocket request'
          });
        }
        reject('Error sending WebSocket request');
      }
      
      // Set timeout for the render to complete
      setTimeout(() => {
        if (this.responseCallbacks.has(renderKey)) {
          clearInterval(progressInterval);
          this.responseCallbacks.delete(renderKey);
          
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
    });
    
    // Store the promise so we can check if a render is in progress
    this.pendingRenders.set(renderKey, renderPromise);
    
    return renderPromise;
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
    const genomeUrl = `${LINEAGE_SOUNDS_BUCKET_HOST}/evorenders/${evoRunId}/genome_${evoRunId}_${genomeId}.json.gz`;
    
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
}

// Export singleton instance
export default new SoundRenderer();
