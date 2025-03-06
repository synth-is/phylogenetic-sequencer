import {el} from '@elemaudio/core';
import { UNIT_TYPES } from '../constants';
import { BaseUnit } from './BaseUnit';
import VoiceParameterRegistry from '../utils/VoiceParameterRegistry';

export class TrajectoryUnit extends BaseUnit {
  constructor(id) {
    super(id, UNIT_TYPES.TRAJECTORY);
    this.active = true;
    this.muted = false;
    this.soloed = false;
    this.volume = -12;
    this.audioDataCache = new Map(); // Will store metadata instead of full buffers
    this.audioBufferSources = new Map(); // To track source audio buffers by Channel IDs
    this.oneOffVoices = new Map();
    this.maxVoices = 4;
    this.pitch = 0;
    this.playbackRate = 1.0;

    // Trajectory recording state
    this.trajectories = new Map();
    this.isRecording = false;
    this.recordingStartTime = null;
    this.currentRecordingId = null;
    this.activeTrajectorySignals = new Map();

    // Voice tracking
    this.pendingCallbacks = new Map();
    this.voiceTimeouts = new Map();
    this.lastHoverTimes = new Map();
    this.highlightTimeouts = new Map();
    this.stateChangeCallbacks = new Set();
    this.activeGenomes = new Map(); // Add this line to initialize activeGenomes
    this.lastHoveredSound = null;  // Add this to store last hovered sound data

    // Add rendering state
    this.renderingVoices = new Map();
    this.renderCallbacks = new Set();

    // Add next-buffer registry to store newly rendered sounds without disrupting playback
    this._nextBuffers = new Map(); // Maps genomeId -> { vfsKey, renderParams, timestamp }
    
    // Add smoothing parameters for audio transitions
    this.fadeInDuration = 0.02; // 20ms fade in time
    this.fadeOutDuration = 0.02; // 20ms fade out time
  }

  addStateChangeCallback(callback) {
    this.stateChangeCallbacks.add(callback);
  }

  removeStateChangeCallback(callback) {
    this.stateChangeCallbacks.delete(callback);
  }

  notifyStateChange() {
    this.stateChangeCallbacks.forEach(callback => callback());
  }

  async initialize() {
    try {
      console.log(`Initializing TrajectoryUnit ${this.id}`);
      await super.initialize(); // This initializes AudioEngine
      
      // Get references from AudioEngine
      const context = this.audioEngine.getContext();
      const renderer = this.audioEngine.getRenderer();

      if (!context || !renderer) {
        throw new Error('AudioEngine not properly initialized');
      }

      // Load impulse response for reverb
      try {
        const irResponse = await fetch('/WIDEHALL-1.wav');  // Updated path to match HeatmapViewer
        if (!irResponse.ok) throw new Error(`HTTP error! status: ${irResponse.status}`);
        const irArrayBuffer = await irResponse.arrayBuffer();
        const irAudioBuffer = await context.decodeAudioData(irArrayBuffer);
        
        // Update VFS with impulse response
        const vfsUpdate = {
          'reverb-ir': irAudioBuffer.getChannelData(0)
        };
        await renderer.updateVirtualFileSystem(vfsUpdate);
        console.log(`TrajectoryUnit ${this.id} loaded reverb IR successfully`);
      } catch (irError) {
        console.warn(`TrajectoryUnit ${this.id} failed to load reverb IR:`, irError);
        // Create a minimal IR if loading fails
        const minimalIR = new Float32Array(4096).fill(0);
        minimalIR[0] = 1;
        await renderer.updateVirtualFileSystem({
          'reverb-ir': minimalIR
        });
      }
      
      // Register for parameter updates
      VoiceParameterRegistry.registerRenderParamListener(this.id.toString(), 
        (voiceId, genomeId, params) => this.handleVoiceParamUpdate(voiceId, genomeId, params));
      
      console.log(`TrajectoryUnit ${this.id} initialized successfully`);
      return true;
    } catch (err) {
      console.error(`TrajectoryUnit ${this.id} initialization error:`, err);
      return false;
    }
  }
  
  // Handle parameter updates for voices
  handleVoiceParamUpdate(voiceId, genomeId, params) {
    console.log(`TrajectoryUnit ${this.id}: Voice param update for ${voiceId}`, params);
    
    // If this is a one-off voice that we're managing, update it
    const activeVoiceIds = Array.from(this.oneOffVoices.keys())
      .filter(id => id.startsWith(genomeId));
      
    if (activeVoiceIds.length > 0) {
      // For real-time feedback while dragging, we'll update the current playback
      // but also prepare a render for when the dragging ends
      console.log(`Updating ${activeVoiceIds.length} active voices for ${genomeId}`);
      
      // For certain parameters that can be adjusted in real-time without re-rendering:
      if (params.playbackRate !== undefined) {
        activeVoiceIds.forEach(id => {
          this.audioEngine.updateVoiceParams(id, {
            playbackRate: params.playbackRate
          });
        });
      }
      
      // For parameters that require re-rendering (duration, pitch, velocity)
      // We queue this separately to avoid constant re-renders during dragging
      if (params.duration !== undefined || params.pitch !== undefined || params.velocity !== undefined) {
        // Store the latest params for this genome to use when rendering completes
        if (!this._pendingRenderParams) this._pendingRenderParams = new Map();
        
        const currentParams = this._pendingRenderParams.get(genomeId) || {};
        this._pendingRenderParams.set(genomeId, {
          ...currentParams,
          ...params
        });
        
        // Use updatePlayingVoice which handles the complete re-render process
        // but with a short delay to avoid too many rapid renders
        clearTimeout(this._renderTimeouts?.get(genomeId));
        if (!this._renderTimeouts) this._renderTimeouts = new Map();
        
        this._renderTimeouts.set(genomeId, setTimeout(() => {
          const renderParams = this._pendingRenderParams.get(genomeId);
          if (renderParams) {
            this.updatePlayingVoice(genomeId, renderParams);
            this._pendingRenderParams.delete(genomeId);
          }
        }, 100)); // Short delay to debounce multiple rapid changes
      }
    }
    
    // Check if this is part of a trajectory
    this.trajectories.forEach((trajectory, trajectoryId) => {
      const eventIndex = trajectory.events.findIndex(evt => 
        evt.cellData && evt.cellData.genomeId === genomeId
      );
      
      if (eventIndex >= 0) {
        // For trajectory events, we need to use updateTrajectoryEvent
        // But we'll also debounce this to avoid too many updates
        clearTimeout(this._trajectoryTimeouts?.get(`${trajectoryId}-${eventIndex}`));
        if (!this._trajectoryTimeouts) this._trajectoryTimeouts = new Map();
        
        this._trajectoryTimeouts.set(`${trajectoryId}-${eventIndex}`, setTimeout(() => {
          this.updateTrajectoryEvent(trajectoryId, eventIndex, params);
        }, 100));
      }
    });
    
    // Update lastHoveredSound if it matches this genome
    if (this.lastHoveredSound && this.lastHoveredSound.genomeId === genomeId) {
      this.updateExploreParams(params);
    }
  }

  // Update handleCellHover to ensure we completely stop any previous voice
  async handleCellHover(cellData, onCellDataModified) {
    if (!this.active || this.muted || !cellData) return;

    const { audioUrl, genomeId } = cellData;
    if (!genomeId) return;

    try {
      // Store original cell data for reporting modifications
      const originalCellData = {...cellData};
      
      // IMPORTANT: Modify the incoming cellData with our stored parameters
      // This is what was missing - we need to update the cellData object itself
      // so that it has the correct parameters when passed to other components
      if (this.lastHoveredSound) {
        // Only use lastHoveredSound params if they're from a different genome
        // to avoid weird parameter inheritance between different sounds
        const modifiedCellData = {
          ...cellData,
          // Use last hovered sound parameters for rendering
          duration: this.lastHoveredSound.duration !== undefined ? 
                    this.lastHoveredSound.duration : (cellData.duration || 4),
          noteDelta: this.lastHoveredSound.pitch !== undefined ? 
                     this.lastHoveredSound.pitch : (cellData.noteDelta || 0),
          velocity: this.lastHoveredSound.velocity !== undefined ? 
                    this.lastHoveredSound.velocity : (cellData.velocity || 1)
        };
        
        console.log('TrajectoryUnit: Modified cell data for hover:', {
          originalDuration: cellData.duration,
          originalNoteDelta: cellData.noteDelta,
          originalVelocity: cellData.velocity,
          modifiedDuration: modifiedCellData.duration,
          modifiedNoteDelta: modifiedCellData.noteDelta,
          modifiedVelocity: modifiedCellData.velocity,
          hasCallback: !!onCellDataModified
        });
        
        // Update the original cellData's config with our modified parameters
        // This is essential for CellDataFormatter to see the changes
        if (cellData.config) {
          cellData.config.duration = modifiedCellData.duration;
          cellData.config.noteDelta = modifiedCellData.noteDelta;
          cellData.config.velocity = modifiedCellData.velocity;
        }
        
        // Use the modified cell data for the rest of the function
        cellData = modifiedCellData;
        
        // NEW: Report the modified data back to the parent component
        if (onCellDataModified && typeof onCellDataModified === 'function') {
          onCellDataModified(this.id, originalCellData, modifiedCellData);
        }
      }
      
      // First check if we already have a voice playing for this genomeId
      // and if so, stop it before creating a new one
      const activeVoiceIds = Array.from(this.oneOffVoices.keys())
        .filter(id => id.startsWith(genomeId));
      
      if (activeVoiceIds.length > 0) {
        console.log(`TrajectoryUnit: Stopping ${activeVoiceIds.length} active voices for ${genomeId} before new hover`);
        
        // Call the pending callback to signal that previous playback has ended
        const callback = this.pendingCallbacks.get(genomeId);
        if (callback) callback();
        
        this.pendingCallbacks.delete(genomeId); // IMPORTANT: Delete the callback reference
        
        // Clean up the active voices
        activeVoiceIds.forEach(voiceId => {
          this.oneOffVoices.delete(voiceId);
          const timeoutId = this.voiceTimeouts.get(voiceId);
          if (timeoutId) {
            clearTimeout(timeoutId);
            this.voiceTimeouts.delete(voiceId);
          }
          
          // Also remove from VoiceParameterRegistry
          VoiceParameterRegistry.removeVoice(voiceId);
        });
        
        // UPDATE: Ensure audio graph is updated immediately to stop sound
        this.updateVoiceMix();
      }
      
      // Check if we have a next buffer waiting to be used
      let vfsKey;
      if (this._nextBuffers && this._nextBuffers.has(genomeId)) {
        const nextBuffer = this._nextBuffers.get(genomeId);
        vfsKey = nextBuffer.vfsKey;
        console.log(`TrajectoryUnit: Using next buffer for ${genomeId}:`, nextBuffer);
        
        // Remove from next buffers after using it
        this._nextBuffers.delete(genomeId);
      } else {
        // IMPORTANT CHANGE: Use parameter-specific VFS key instead of just genomeId
        // This ensures we get the right sound for the right parameters
        const duration = cellData.duration || 4;
        const pitch = cellData.noteDelta || 0;
        const velocity = cellData.velocity || 1;
        
        // Create a parameter-specific VFS key
        vfsKey = `sound-${genomeId}-${duration}_${pitch}_${velocity}`;
        console.log(`TrajectoryUnit: Using parameter-specific VFS key: ${vfsKey}`);
      }
      
      let audioMetadata = this.audioDataCache.get(vfsKey);
  
      if (!audioMetadata) {
        try {
          // Use the shared implementation from BaseUnit to get audio data
          // This ensures consistent loading behavior for both custom renders and WAV files
          const result = await this.getAudioData(
            {
              genomeId,
              experiment: cellData.experiment || 'unknown',
              evoRunId: cellData.evoRunId || 'unknown'
            },
            {
              duration: cellData.duration || 4,
              pitch: cellData.noteDelta || 0,
              velocity: cellData.velocity || 1
            },
            { specificVfsKey: vfsKey }
          );
          
          if (result && result.metadata) {
            audioMetadata = result.metadata;
            // Store metadata for future use
            this.audioDataCache.set(vfsKey, audioMetadata);
          } else {
            throw new Error('Failed to load audio data');
          }
        } catch (error) {
          console.error('TrajectoryUnit playback error:', error);
          cellData.config?.onEnded?.();
          return;
        }
      }

      // Create voice with proper trigger - using standard sample playback
      const voiceId = `${genomeId}-${Date.now()}`;
      
      const voice = el.mul(
        el.mc.sample({
          channels: 1,
          path: vfsKey,
          mode: 'trigger',
          playbackRate: this.playbackRate,
          key: `voice-${voiceId}`
        },
        el.const({
          key: `trigger-${voiceId}`,
          value: 1
        }))[0],
        el.const({
          key: `gain-${voiceId}`,
          value: 1 / this.maxVoices
        })
      );

      // Store callback and voice
      this.pendingCallbacks.set(genomeId, cellData.config?.onEnded);
      this.oneOffVoices.set(voiceId, voice);
      this.updateVoiceMix();

      // Clean up old voices
      if (this.oneOffVoices.size > this.maxVoices) {
        const [oldestId] = this.oneOffVoices.keys();
        const oldestGenomeId = oldestId.split('-')[0];
        const callback = this.pendingCallbacks.get(oldestGenomeId);
        if (callback) callback();
        
        this.oneOffVoices.delete(oldestId);
        this.pendingCallbacks.delete(oldestGenomeId);
        this.updateVoiceMix();
      }

      // Register this voice with the VoiceParameterRegistry
      // Include all parameters that might be modified later
      VoiceParameterRegistry.registerVoice(voiceId, genomeId, {
        duration: (this.lastHoveredSound?.duration !== undefined) ? 
                 this.lastHoveredSound.duration : (cellData.duration || 4),
        pitch: (this.lastHoveredSound?.pitch !== undefined) ? 
              this.lastHoveredSound.pitch : (cellData.noteDelta || 0),
        velocity: (this.lastHoveredSound?.velocity !== undefined) ? 
                 this.lastHoveredSound.velocity : (cellData.velocity || 1),
        playbackRate: this.playbackRate,
        startOffset: 0,
        stopOffset: 0,
        // Important: add original values for reference
        originalDuration: cellData.originalDuration || cellData.duration || 4,
        originalPitch: cellData.originalPitch || cellData.noteDelta || 0,
        originalVelocity: cellData.originalVelocity || cellData.velocity || 1
      }, `trajectory-${this.id}`);

      // Set up voice completion timeout
      const totalDuration = audioMetadata.duration + 0.1; // Add small release time
      const timeoutId = setTimeout(() => {
        this.oneOffVoices.delete(voiceId);
        this.voiceTimeouts.delete(voiceId);
        VoiceParameterRegistry.removeVoice(voiceId);
        
        // Execute callback if provided
        const callback = this.pendingCallbacks.get(genomeId);
        if (callback && typeof callback === 'function') {
          this.pendingCallbacks.delete(genomeId);
          callback();
        }
        
        this.updateVoiceMix();
      }, totalDuration * 1000);

      this.voiceTimeouts.set(voiceId, timeoutId);

      // Store the last hovered sound data, preserving the current explore parameters
      this.lastHoveredSound = {
        ...cellData,
        playbackRate: this.playbackRate,
        startOffset: 0,
        stopOffset: 0,
        // Use parameters from the cellData (which we've already modified above)
        duration: cellData.duration || 4,
        pitch: cellData.noteDelta || 0,
        velocity: cellData.velocity || 1,
        // Make sure we store original values
        originalDuration: cellData.originalDuration || originalCellData.duration || 4,
        originalPitch: cellData.originalPitch || originalCellData.noteDelta || 0,
        originalVelocity: cellData.originalVelocity || originalCellData.velocity || 1
      };

    } catch (error) {
      console.error('TrajectoryUnit playback error:', error);
      cellData.config?.onEnded?.();
    }

    if (this.isRecording) {
      this.recordEvent(cellData);
    }
  }

  updateVoiceMix() {
    if (!this.active) {
      this.updateAudioNodes([]);
      return;
    }

    // Collect and count all active voices
    const oneOffVoices = Array.from(this.oneOffVoices.values());
    const trajectorySignals = Array.from(this.activeTrajectorySignals.values());
    const totalVoices = oneOffVoices.length + trajectorySignals.length;
    
    // Use square root scaling for smoother gain changes
    // This provides less aggressive gain reduction while still preventing distortion
    const voiceGain = 1 / Math.sqrt(Math.max(1, totalVoices));
    
    // Apply gain to each voice type
    const scaledOneOffVoices = oneOffVoices.map(voice => 
      el.mul(voice, el.const({ value: voiceGain }))
    );
    
    const scaledTrajectorySignals = trajectorySignals.map(voice => 
      el.mul(voice, el.const({ value: voiceGain }))
    );
    
    // Combine all voices efficiently
    const allVoices = [...scaledOneOffVoices, ...scaledTrajectorySignals];
    
    const mix = allVoices.length === 0 ? el.const({value: 0}) :
               allVoices.length === 1 ? allVoices[0] :
               el.add(...allVoices);

    this.updateAudioNodes(mix ? [mix] : []);
    this.notifyStateChange();
  }

  // Update config method to handle playback mode
  updateConfig(config) {
    // Handle state changes that need immediate audio update
    if (config.soloed !== undefined && config.soloed !== this.soloed) {
      this.soloed = config.soloed;
      // Just update mixing without affecting element settings
      this.updateVoiceMix();
      return; // Exit early to prevent pitch/other updates
    }

    // Handle pitch changes for trajectory events
    if (config.pitch !== undefined && config.pitch !== this.pitch) {
      this.pitch = config.pitch;
      this.playbackRate = Math.pow(2, config.pitch / 12);
      
      // Update trajectories
      this.updateTrajectoryPlaybackRates(config.pitch);
      
      // Force audio update
      this.updateVoiceMix();
    }

    // Handle other config changes
    Object.assign(this, config);
    this.updateVoiceMix();
  }

  // Add method to update playback rates for all trajectory events
  updateTrajectoryPlaybackRates(pitch) {
    const playbackRate = Math.pow(2, pitch / 12);
    const playingTrajectories = new Set();

    // Store currently playing trajectories
    this.trajectories.forEach((trajectory, id) => {
      if (trajectory.isPlaying) {
        playingTrajectories.add(id);
      }
    });

    // Stop all playing trajectories
    playingTrajectories.forEach(id => {
      this.stopTrajectoryPlayback(id);
    });

    // Update playback rates
    this.trajectories.forEach(trajectory => {
      trajectory.events.forEach(event => {
        if (event.cellData) {
          event.playbackRate = playbackRate;
        }
      });
    });

    // Restart previously playing trajectories
    playingTrajectories.forEach(id => {
      this.playTrajectory(id);
    });

    this.updateVoiceMix();
  }

  // Add method to update playback parameters
  updatePlaybackParams(params) {
    Object.assign(this, params);
  }

  cleanup() {
    // Remove parameter listener
    VoiceParameterRegistry.removeRenderParamListener(this.id.toString());
    
    // Clear any pending trajectory updates
    if (this._updatingTrajectories) {
      this._updatingTrajectories.clear();
    }
    
    // Clear debounce/rendering timeouts
    if (this._renderTimeouts) {
      for (const timeout of this._renderTimeouts.values()) {
        clearTimeout(timeout);
      }
      this._renderTimeouts.clear();
    }
    
    if (this._trajectoryTimeouts) {
      for (const timeout of this._trajectoryTimeouts.values()) {
        clearTimeout(timeout);
      }
      this._trajectoryTimeouts.clear();
    }
    
    this._pendingRenderParams?.clear();
    
    // ...rest of existing cleanup code...
    
    // Remove context.close() since AudioEngine manages the context
    if (this.throttleTimeout) {
      clearTimeout(this.throttleTimeout);
    }
    this.audioDataCache.clear();
    this.audioBufferSources.clear(); // Clear the audio buffer sources map
    this.activeVoices?.clear();
    this.loopingVoices?.clear();
    this.oneOffVoices.clear();
    
    // Clear all voice timeouts
    this.voiceTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    this.voiceTimeouts.clear();

    // Ensure all onEnded callbacks are triggered during cleanup
    const activeGenomes = new Set(
      Array.from(this.oneOffVoices.keys())
        .map(id => id.split('-')[0])
    );
    
    activeGenomes.forEach(genomeId => {
      const timeoutIds = Array.from(this.voiceTimeouts.entries())
        .filter(([id]) => id.startsWith(genomeId))
        .map(([_, timeoutId]) => timeoutId);
      
      timeoutIds.forEach(timeoutId => clearTimeout(timeoutId));
    });

    // Clean up new tracking maps
    this.pendingCallbacks.clear();
    this.activeGenomes.clear();
    this.lastHoverTimes.clear();
    
    // Clear all highlight timeouts
    this.highlightTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
    this.highlightTimeouts.clear();
    this.loopStateCallbacks?.clear();

    this.activeTrajectorySignals.clear();
    this.trajectories.clear();
    this.isRecording = false;
    this.currentRecordingId = null;
    this.recordingStartTime = null;

    this.stateChangeCallbacks.clear();
    // Make sure to call parent cleanup to remove nodes from AudioEngine
    super.cleanup();

    this.renderingVoices.clear();
    this.renderCallbacks.clear();
    
    // Clear the next buffers registry
    this._nextBuffers?.clear();
  }

  // Add method to check if a genome has active voices
  hasActiveVoices(genomeId) {
    return Array.from(this.oneOffVoices.keys())
      .some(id => id.startsWith(genomeId));
  }

  // Add a new method to check if a genome has any kind of active voices
  hasAnyActiveVoices(genomeId) {
    const hasOneOffVoice = Array.from(this.oneOffVoices.keys())
      .some(id => id.startsWith(genomeId));
    const isTrackedAsActive = this.activeGenomes.has(genomeId);
    
    console.log('Checking active voices:', {
      genomeId,
      hasOneOffVoice,
      isTrackedAsActive,
      activeGenomes: Array.from(this.activeGenomes.keys())
    });
    
    return hasOneOffVoice;
  }

  startTrajectoryRecording() {
    if (this.isRecording) return;

    this.isRecording = true;
    this.currentRecordingId = Date.now();
    this.recordingStartTime = null;

    const trajectoryData = {
      events: [],
      isPlaying: false
    };

    this.trajectories.set(this.currentRecordingId, trajectoryData);
    console.log('Started recording new trajectory:', this.currentRecordingId);
    return this.currentRecordingId;
  }

  recordEvent(cellData) {
    if (!this.isRecording || !this.currentRecordingId) return;

    const currentTime = this.recordingStartTime === null ? 
      0 : (Date.now() - this.recordingStartTime) / 1000;

    if (this.recordingStartTime === null) {
      this.recordingStartTime = Date.now();
    }

    // Get audio metadata from cache
    const vfsKey = cellData.vfsKey || `sound-${cellData.genomeId}`;
    const audioMetadata = this.audioDataCache.get(vfsKey);
    const bufferLength = audioMetadata ? audioMetadata.length : 0;
    
    console.log('TrajectoryUnit: Recording event with parameters:', {
      genomeId: cellData.genomeId,
      duration: cellData.duration,
      noteDelta: cellData.noteDelta,
      pitch: cellData.pitch,
      velocity: cellData.velocity
    });

    // Use current explore settings for new recorded events
    const trajectory = this.trajectories.get(this.currentRecordingId);
    
    // FIXED: Use correct render parameter values from cellData
    const renderParams = {
      duration: cellData.duration || 4,
      pitch: cellData.noteDelta || cellData.pitch || 0,
      velocity: cellData.velocity || 1
    };
    
    // FIXED: Always store specificVfsKey if available from cellData
    const eventVfsKey = cellData.vfsKey || vfsKey;
    
    trajectory.events.push({
      time: currentTime,
      cellData,
      offset: 0.5,
      // Use current explore settings or defaults
      playbackRate: this.lastHoveredSound?.playbackRate || 1,
      startOffset: this.lastHoveredSound?.startOffset || 0,
      stopOffset: this.lastHoveredSound?.stopOffset || 0,
      bufferLength,
      // Store correct parameter values
      duration: renderParams.duration,
      pitch: renderParams.pitch,
      velocity: renderParams.velocity,
      // Store render parameters for potential future regeneration
      renderParams,
      // FIXED: Store the correct VFS key for this sound
      vfsKey: eventVfsKey
    });
  }

  stopTrajectoryRecording() {
    if (!this.isRecording || !this.currentRecordingId) return null;

    const trajectory = this.trajectories.get(this.currentRecordingId);
    const currentTime = (Date.now() - this.recordingStartTime) / 1000;

    // Add end marker
    trajectory.events.push({
      time: currentTime,
      cellData: null
    });

    const recordingId = this.currentRecordingId;
    
    this.isRecording = false;
    this.currentRecordingId = null;
    this.recordingStartTime = null;

    this.playTrajectory(recordingId);
    return recordingId;
  }

  async playTrajectory(trajectoryId) {
    console.log('playTrajectory called with parameters:', {
      trajectoryId,
      trajectory: this.trajectories.get(trajectoryId)
    });

    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory || trajectory.events.length === 0) return;

    // IMPORTANT: First set playing status to false and remove any active signals 
    // to ensure we don't have multiple copies playing
    const wasPlaying = trajectory.isPlaying;
    trajectory.isPlaying = false;
    this.activeTrajectorySignals.delete(trajectoryId);
    
    // Update mix to apply the removal of the old signals
    if (wasPlaying) {
      this.updateVoiceMix();
    }

    // Now set playing state to true and continue with playback setup
    trajectory.isPlaying = true;

    try {
      const context = this.audioEngine.getContext();
      const renderer = this.audioEngine.getRenderer();
      
      if (!context || !renderer) {
        throw new Error('AudioEngine not properly initialized');
      }

      // Ensure all samples are loaded in VFS first
      for (const event of trajectory.events) {
        if (event.cellData && event.cellData.genomeId) {
          // Check for a parameter-specific VFS key first
          const genomeId = event.cellData.genomeId;
          
          // FIXED: Use the event's stored vfsKey if available
          let vfsKey = event.vfsKey || `sound-${genomeId}`;
          
          // Check if we have a next buffer for this genome
          if (this._nextBuffers && this._nextBuffers.has(genomeId)) {
            vfsKey = this._nextBuffers.get(genomeId).vfsKey;
            console.log(`Using next buffer for trajectory event:`, {
              genomeId,
              vfsKey,
              eventTime: event.time
            });
            
            // Store this as the event's VFS key and remove from next buffers
            event.vfsKey = vfsKey;
            this._nextBuffers.delete(genomeId);
          }
          
          // Only load if not already in cache
          if (!this.audioDataCache.has(vfsKey)) {
            try {
              // FIXED: Use the correct event parameters for rendering
              const renderParams = {
                duration: event.duration || event.renderParams?.duration || 4,
                pitch: event.pitch || event.renderParams?.pitch || 0,
                velocity: event.velocity || event.renderParams?.velocity || 1
              };
              
              // Store the render params for future reference
              if (!event.renderParams) {
                event.renderParams = renderParams;
              }
              
              // Use the shared implementation with proper parameters
              const result = await this.renderSound(
                {
                  genomeId: event.cellData.genomeId,
                  experiment: event.cellData.experiment || 'unknown',
                  evoRunId: event.cellData.evoRunId || 'unknown'
                },
                renderParams,
                { 
                  specificVfsKey: vfsKey
                }
              );
              
              if (result) {
                // Store metadata
                this.audioDataCache.set(vfsKey, result.metadata);
              }
            } catch (err) {
              console.error(`Error rendering audio for ${vfsKey}:`, err);
            }
          }
        }
      }

      // Create timing signal - 100Hz clock
      const ticker = el.train(100);

      // Calculate timing adjustments based on offsets
      const events = trajectory.events.filter(evt => evt.cellData);
      
      // Safety check for empty events
      if (events.length === 0) {
        console.warn('No events with cell data found in trajectory');
        return;
      }
      
      const sequenceDuration = events[events.length - 1].time;

      // Create sequence with timing adjusted by offset parameter
      const seq = events.map((evt, i) => {
        // Calculate adjusted time using the offset parameter (0-1)
        const baseTime = evt.time;
        const offsetAmount = ((evt.offset || 0.5) - 0.5) * 2; // Convert 0-1 to -1 to 1
        const adjustedTime = Math.max(0, 
          baseTime + (offsetAmount * (sequenceDuration * 0.1)) // 10% max shift
        );

        // Use the event's specific VFS key if available, falling back to generic key
        // Creating parameter-specific VFS key if not provided
        const genomeId = evt.cellData.genomeId;
        const renderParams = evt.renderParams || {
          duration: evt.duration || 4,
          pitch: evt.pitch || 0,
          velocity: evt.velocity || 1
        };
        
        const vfsKey = evt.vfsKey || `sound-${genomeId}-${renderParams.duration}_${renderParams.pitch}_${renderParams.velocity}`;

        console.log('Event timing:', {
          eventIndex: i,
          originalTime: baseTime,
          offset: evt.offset || 0.5,
          adjustedTime,
          genomeId: evt.cellData.genomeId,
          vfsKey
        });

        return {
          tickTime: Math.round(adjustedTime * 100) + 1,
          value: i + 1,
          genomeId: evt.cellData.genomeId,
          vfsKey
        };
      });

      const firstTick = seq[0].tickTime - 1;
      const latestEndpoint = Math.max(
        ...trajectory.events
          .filter(evt => evt.time !== undefined)
          .map(evt => Math.round(evt.time * 100))
      );

      // Create master sequence
      const masterSeq = el.sparseq({
        key: `trajectory-${trajectoryId}-master`,
        seq: seq,
        loop: [firstTick, latestEndpoint]
      }, ticker, el.const({ value: 0 }));

      // Create individual triggers for EACH event - standard sample playback
      const players = seq.map((event, index) => {
        // Get the event's VFS key
        const vfsKey = event.vfsKey || `sound-${event.genomeId}`;
        if (!vfsKey) {
          console.error(`Missing VFS key for event ${index} in trajectory ${trajectoryId}`);
          return null;
        }
        
        // Find the corresponding event in trajectory.events that has our parameters
        const trajectoryEvent = trajectory.events[index];
        
        // Get metadata from cache, falling back to a default if missing
        const audioMetadata = this.audioDataCache.get(vfsKey) || {
          length: 48000 * 4, // Default 4 seconds
          sampleRate: 48000,
          duration: 4
        };
        
        const bufferLength = audioMetadata?.length || 0;

        // Convert proportional offsets to sample positions
        const startOffset = Math.floor((trajectoryEvent?.startOffset || 0) * bufferLength);
        const stopOffset = Math.floor((trajectoryEvent?.stopOffset || 0) * bufferLength);

        const trigger = el.eq(
          masterSeq,
          el.const({ 
            key: `event-${trajectoryId}-${index}-value`,
            value: event.value 
          })
        );

        // Generate a unique playback key that includes the VFS key
        const playerKey = `player-${trajectoryId}-${index}-${Date.now()}`;

        // Ensure we use the current playbackRate from the event
        const playerPlaybackRate = trajectoryEvent?.playbackRate || 1;
        
        try {
          // Use standard sample playback with trigger
          const player = el.mul(
            el.mc.sample({
              channels: 1,
              key: playerKey,
              path: vfsKey,
              mode: 'trigger',
              playbackRate: playerPlaybackRate,
              startOffset: startOffset,
              stopOffset: stopOffset
            }, trigger)[0],
            el.const({ 
              key: `gain-${playerKey}`,
              value: 1
            })
          );
          
          return player;
        } catch (error) {
          console.error(`Error creating player for trajectory event ${index}:`, error);
          return null;
        }
      }).filter(Boolean); // Remove any null players

      // Apply gain scaling to the sequence
      if (players.length > 0) {
        const signal = players.length === 1 ?
          el.mul(players[0], el.const({ key: `gain-${trajectoryId}`, value: 1 / this.maxVoices })) :
          el.mul(el.add(...players), el.const({ key: `gain-${trajectoryId}`, value: 1 / this.maxVoices }));

        this.activeTrajectorySignals.set(trajectoryId, signal);
        this.updateVoiceMix();
        console.log(`Trajectory ${trajectoryId} playback started with ${players.length} voices`);
      } else {
        console.warn(`No players created for trajectory ${trajectoryId}`);
      }

    } catch (error) {
      console.error('Error playing trajectory:', error);
      trajectory.isPlaying = false;
    }
  }

  stopTrajectory(trajectoryId) {
    const trajectory = this.trajectories.get(trajectoryId);
    if (trajectory) {
      trajectory.isPlaying = false;
      this.activeTrajectorySignals.delete(trajectoryId);
      this.updateVoiceMix();
    }
  }

  removeTrajectory(trajectoryId) {
    this.stopTrajectory(trajectoryId);
    this.trajectories.delete(trajectoryId);
  }

  // Add this method
  stopTrajectoryPlayback(trajectoryId) {
    const trajectory = this.trajectories.get(trajectoryId);
    if (trajectory) {
      trajectory.isPlaying = false;
      this.activeTrajectorySignals.delete(trajectoryId);
      this.updateVoiceMix();
    }
  }

  // Update the updateExploreParams method to store original values
  updateExploreParams(updates) {
    if (!this.lastHoveredSound) return;
    
    // Initialize next buffers map if needed
    if (!this._nextBuffers) {
      this._nextBuffers = new Map();
    }
    
    // Check if this is a render parameter update
    const isRenderUpdate = updates.duration !== undefined || 
                          updates.pitch !== undefined ||
                          updates.velocity !== undefined;
    
    // Store the parameter changes immediately for UI feedback
    if (isRenderUpdate) {
      // Store original values if not already stored
      if (this.lastHoveredSound.originalDuration === undefined && 
          this.lastHoveredSound.duration !== undefined) {
        this.lastHoveredSound.originalDuration = this.lastHoveredSound.duration;
      }
      
      if (this.lastHoveredSound.originalPitch === undefined && 
          this.lastHoveredSound.pitch !== undefined) {
        this.lastHoveredSound.originalPitch = this.lastHoveredSound.pitch;
      }
      
      if (this.lastHoveredSound.originalVelocity === undefined && 
          this.lastHoveredSound.velocity !== undefined) {
        this.lastHoveredSound.originalVelocity = this.lastHoveredSound.velocity;
      }

      // Update the parameters in the lastHoveredSound for immediate UI feedback
      Object.assign(this.lastHoveredSound, updates);

      // Check if this is an explicit request to render (from sliderEnd)
      const shouldRenderNow = updates.renderNow === true;
      
      // Either render now or schedule a debounced render
      if (shouldRenderNow) {
        console.log('TrajectoryUnit: Rendering new sound with parameters:', updates);
        
        // Create a specific VFS key for this parameter combination
        const genomeId = this.lastHoveredSound.genomeId;
        const renderParams = {
          duration: this.lastHoveredSound.duration || 4,
          pitch: this.lastHoveredSound.pitch || 0,
          velocity: this.lastHoveredSound.velocity || 1
        };
        
        // Generate a parameter-specific VFS key
        const vfsKey = `sound-${genomeId}-${renderParams.duration}_${renderParams.pitch}_${renderParams.velocity}`;
        
        // We'll render the sound but store it for next use instead of immediately replacing
        this.renderSound(
          {
            genomeId,
            experiment: this.lastHoveredSound.experiment || 'unknown',
            evoRunId: this.lastHoveredSound.evoRunId || 'unknown'
          },
          renderParams,
          {
            specificVfsKey: vfsKey,
            onSuccess: (resultKey, audioBuffer) => {
              // Store this buffer in the next-buffer registry for this genome
              this._nextBuffers.set(genomeId, {
                vfsKey: resultKey,
                renderParams,
                timestamp: Date.now()
              });
              
              console.log(`TrajectoryUnit: Stored next buffer for ${genomeId}:`, {
                vfsKey: resultKey,
                renderParams
              });
              
              // Update global parameters for next hover
              import('../utils/VoiceParameterRegistry').then(module => {
                const VoiceParameterRegistry = module.default;
                VoiceParameterRegistry.updateGlobalParameters({
                  duration: renderParams.duration,
                  pitch: renderParams.pitch,
                  velocity: renderParams.velocity
                });
              }).catch(err => {
                console.error('Failed to update global parameters:', err);
              });
            }
          }
        );
      }
    } else {
      // For non-render parameters (like playbackRate), apply immediately
      Object.assign(this.lastHoveredSound, updates);
      
      // Update audio engine parameters for next hover playback and recording
      if (updates.playbackRate !== undefined) {
        this.playbackRate = updates.playbackRate;
      }
      if (updates.startOffset !== undefined) {
        this.startOffset = updates.startOffset;
      }
      if (updates.stopOffset !== undefined) {
        this.stopOffset = updates.stopOffset;
      }
    }
  }

  // Add a helper method to perform the actual render
  _performRender() {
    const renderParams = {
      duration: this.lastHoveredSound.duration || 4,
      pitch: this.lastHoveredSound.pitch || 0,
      velocity: this.lastHoveredSound.velocity || 1
    };
    
    // Use the shared implementation from BaseUnit
    this.renderSound(
      {
        genomeId: this.lastHoveredSound.genomeId,
        experiment: this.lastHoveredSound.experiment || 'unknown',
        evoRunId: this.lastHoveredSound.evoRunId || 'unknown'
      }, 
      renderParams
    );
    
    // Update global parameters in the VoiceParameterRegistry
    import('../utils/VoiceParameterRegistry').then(module => {
      const VoiceParameterRegistry = module.default;
      VoiceParameterRegistry.updateGlobalParameters({
        duration: renderParams.duration,
        pitch: renderParams.pitch,
        velocity: renderParams.velocity
      });
    }).catch(err => {
      console.error('Failed to update global parameters:', err);
    });
  }

  // Replace the renderSound implementation to use the BaseUnit method
  async renderSound(soundData, renderParams, options = {}) {
    return super.renderSound(soundData, renderParams, options);
  }

  // Add a method to check if a sound is being rendered
  isRendering(genomeId) {
    return this.renderingVoices.has(genomeId);
  }
  
  // Add a method to register render state callbacks
  addRenderStateCallback(callback) {
    this.renderCallbacks.add(callback);
  }
  
  // Add a method to remove render state callbacks
  removeRenderStateCallback(callback) {
    this.renderCallbacks.delete(callback);
  }
  
  // Add a method to notify render state changes
  notifyRenderStateChange() {
    // Pass the renderingVoices map to the callbacks to match expected signature
    this.renderCallbacks.forEach(callback => callback(this.renderingVoices));
  }

  // Update trajectory event params to include render params handling
  updateTrajectoryEvent(trajectoryId, eventIndex, updates) {
    console.log('updateTrajectoryEvent called:', {
      trajectoryId,
      eventIndex,
      updates,
      currentTrajectory: this.trajectories.get(trajectoryId)
    });

    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory) {
      console.error('No trajectory found with ID:', trajectoryId);
      return;
    }

    const wasPlaying = trajectory.isPlaying;
    const event = trajectory.events[eventIndex];
    const cellData = event?.cellData;
    
    if (!cellData) {
      console.error('No cell data found for event at index:', eventIndex);
      return;
    }
    
    // Instead of stopping playback immediately, mark the trajectory for update
    // This allows current audio to continue playing until new audio is ready
    const needsPlaybackUpdate = wasPlaying && (
      updates.duration !== undefined || 
      updates.pitch !== undefined || 
      updates.velocity !== undefined
    );
    
    // Only stop playback if this isn't a parameter update that will re-render
    if (wasPlaying && !needsPlaybackUpdate) {
      console.log('Stopping playback to update non-render parameters');
      this.stopTrajectoryPlayback(trajectoryId);
    } else if (needsPlaybackUpdate) {
      // For render parameters, we'll let the onSuccess callback handle restarting playback
      // We don't need to stop the playback here, but we'll mark the trajectory as not playing
      // to prevent further trajectory events from being processed while we're updating
      trajectory.isPlaying = false;
      
      // We don't remove from activeTrajectorySignals yet, so audio continues until our new render is ready
      // This prevents audio dropouts during parameter changes
    }

    // Check if this is a render parameter update
    const isRenderUpdate = updates.duration !== undefined || 
                          updates.pitch !== undefined || 
                          updates.velocity !== undefined;
    
    // Store current playback rate if not being explicitly updated
    const currentPlaybackRate = event.playbackRate || this.playbackRate;
    
    // Used to track whether we need to update the VFS key for this event
    let newVfsKey = null;
    
    // Handle render updates separately - this creates a new audio buffer
    if (isRenderUpdate) {      
      // Prepare render parameters, using existing values as defaults
      const renderParams = {
        duration: updates.duration ?? event.duration ?? event.renderParams?.duration ?? 4,
        pitch: updates.pitch ?? event.pitch ?? event.renderParams?.pitch ?? 0,
        velocity: updates.velocity ?? event.velocity ?? event.renderParams?.velocity ?? 1
      };
      
      // Create a specific parameter-based VFS key for this render
      newVfsKey = `sound-${cellData.genomeId}-${renderParams.duration}_${renderParams.pitch}_${renderParams.velocity}`;
      
      console.log(`Creating parameter-specific VFS key for trajectory event: ${newVfsKey}`, {
        renderParams,
        originalCellData: cellData,
        currentPlaybackRate
      });
      
      // Keep track of trajectory being updated for hot-swapping buffers
      if (!this._updatingTrajectories) this._updatingTrajectories = new Map();
      
      const pendingUpdate = {
        trajectoryId,
        eventIndex,
        oldKey: event.vfsKey || `sound-${cellData.genomeId}`,
        newKey: newVfsKey,
        updates,
        wasPlaying,
        playbackRate: currentPlaybackRate // Store current playback rate
      };
      
      this._updatingTrajectories.set(`${trajectoryId}-${eventIndex}`, pendingUpdate);
      
      // Use the shared implementation from BaseUnit with the specific key
      // and set an onSuccess callback to seamlessly update the playback
      this.renderSound(
        {
          genomeId: cellData.genomeId,
          experiment: cellData.experiment || 'unknown',
          evoRunId: cellData.evoRunId || 'unknown'
        }, 
        renderParams,
        {
          specificVfsKey: newVfsKey,
          onSuccess: (vfsKey, audioBuffer) => {
            console.log('Render completed for trajectory update:', {
              trajectoryId,
              eventIndex,
              vfsKey,
              audioBuffer
            });
            
            // Update event parameters in the trajectory
            const pendingUpdate = this._updatingTrajectories.get(`${trajectoryId}-${eventIndex}`);
            if (!pendingUpdate) return;
            
            // Get current trajectory state
            const currentTrajectory = this.trajectories.get(trajectoryId);
            if (!currentTrajectory) return;
            
            // Remove old key reference and update with new one
            delete currentTrajectory.events[eventIndex].vfsKey;
            
            // Update the event with all parameters
            Object.assign(currentTrajectory.events[eventIndex], {
              ...updates, 
              vfsKey,
              renderParams: { ...renderParams }
            });
            
            // Store the audio metadata
            const metadata = {
              duration: audioBuffer.duration,
              length: audioBuffer.length,
              sampleRate: audioBuffer.sampleRate,
              numberOfChannels: audioBuffer.numberOfChannels
            };
            this.audioDataCache.set(vfsKey, metadata);
            
            // Remove from updating list
            this._updatingTrajectories.delete(`${trajectoryId}-${eventIndex}`);
            
            // If was playing, restart trajectory
            if (pendingUpdate.wasPlaying) {
              // IMPORTANT: Stop any existing playback first to avoid doubled audio
              this.activeTrajectorySignals.delete(trajectoryId);
              // Then restart playback with updated parameters
              this.playTrajectory(trajectoryId);
            }
          }
        }
      );
      
      // Add the VFS key to the updates so it gets stored with the event
      updates.vfsKey = newVfsKey;
      
      // FIXED: Also store the render parameters in the updates
      updates.renderParams = renderParams;
    }

    // Update the event parameters - make sure we preserve playbackRate unless explicitly changed
    trajectory.events = trajectory.events.map((evt, index) => {
      if (index === eventIndex) {
        const updatedEvent = {
          ...evt,
          ...updates,
          playbackRate: updates.playbackRate !== undefined ? updates.playbackRate : evt.playbackRate
        };
        
        // FIXED: Make sure render-specific parameters are copied to the top level as well
        if (updates.duration !== undefined) updatedEvent.duration = updates.duration;
        if (updates.pitch !== undefined) updatedEvent.pitch = updates.pitch;
        if (updates.velocity !== undefined) updatedEvent.velocity = updates.velocity;
        
        return updatedEvent;
      }
      return evt;
    });

    // Restart playback if it was playing before but only if we're not doing a render update
    // For render updates, we'll restart in the onSuccess callback
    if (wasPlaying && !isRenderUpdate) {
      console.log('Restarting playback with updated parameters');
      this.playTrajectory(trajectoryId);
    }
  }

  /**
   * Update a currently playing voice with new parameters
   * @param {string} genomeId - The ID of the genome to update
   * @param {Object} renderParams - New render parameters (duration, pitch, velocity)
   * @returns {Promise<boolean>} - True if successful
   */
  async updatePlayingVoice(genomeId, renderParams) {
    console.log('TrajectoryUnit: Updating playing voice:', { genomeId, renderParams });
    
    if (!genomeId) return false;
    
    try {
      // First check if this genome has one-off voices playing
      const activeVoiceIds = Array.from(this.oneOffVoices.keys())
        .filter(id => id.startsWith(genomeId));
      
      if (activeVoiceIds.length > 0) {
        // IMPORTANT: Instead of trying to modify the existing voice, 
        // we'll stop it completely and create a new one with updated parameters

        // Get the current playback position (if possible)
        // This would require adding position tracking which we don't have yet
        
        // Stop all voices for this genome first
        activeVoiceIds.forEach(voiceId => {
          this.oneOffVoices.delete(voiceId);
          const timeoutId = this.voiceTimeouts.get(voiceId);
          if (timeoutId) {
            clearTimeout(timeoutId);
            this.voiceTimeouts.delete(voiceId);
          }
        });
        
        // Update voice mix to remove the stopped voices
        this.updateVoiceMix();
        
        // Clear callback but don't call it since we're replacing the voice
        this.pendingCallbacks.delete(genomeId);
        
        // Update lastHoveredSound with new parameters
        if (this.lastHoveredSound && this.lastHoveredSound.genomeId === genomeId) {
          Object.assign(this.lastHoveredSound, renderParams);
        }
        
        // Use renderSound to generate new audio data with updated parameters
        const result = await this.renderSound(
          {
            genomeId,
            experiment: this.lastHoveredSound?.experiment || 'unknown',
            evoRunId: this.lastHoveredSound?.evoRunId || 'unknown'
          },
          {
            duration: renderParams.duration !== undefined ? renderParams.duration : 
                     (this.lastHoveredSound?.duration || 4),
            pitch: renderParams.pitch !== undefined ? renderParams.pitch : 
                  (this.lastHoveredSound?.pitch || 0),
            velocity: renderParams.velocity !== undefined ? renderParams.velocity : 
                     (this.lastHoveredSound?.velocity || 1)
          },
          {
            onSuccess: async (vfsKey, audioBuffer) => {
              // With the new audio data, recreate the voice
              // Create a new unique voice ID to ensure no conflicts
              const newVoiceId = `${genomeId}-${Date.now()}`;
              
              // Create a new voice with the updated parameters
              const voice = el.mul(
                el.mc.sample({
                  channels: 1,
                  path: vfsKey,
                  mode: 'trigger',
                  playbackRate: this.playbackRate,
                  key: `voice-${newVoiceId}`
                },
                el.const({
                  key: `trigger-${newVoiceId}`,
                  value: 1
                }))[0],
                el.const({
                  key: `gain-${newVoiceId}`,
                  value: 1 / this.maxVoices
                })
              );
              
              // Store the new voice
              this.oneOffVoices.set(newVoiceId, voice);
              
              // Set up new timeout based on new duration
              const totalDuration = audioBuffer.duration + 0.1;
              const timeoutId = setTimeout(() => {
                this.oneOffVoices.delete(newVoiceId);
                this.voiceTimeouts.delete(newVoiceId);
                
                // Execute callback if provided
                const callback = this.pendingCallbacks.get(genomeId);
                if (callback && typeof callback === 'function') {
                  this.pendingCallbacks.delete(genomeId);
                  callback();
                }
                
                this.updateVoiceMix();
              }, totalDuration * 1000);
              
              this.voiceTimeouts.set(newVoiceId, timeoutId);
              
              // Register with VoiceParameterRegistry
              VoiceParameterRegistry.registerVoice(
                newVoiceId,
                genomeId,
                {
                  duration: renderParams.duration || this.lastHoveredSound?.duration || 4,
                  pitch: renderParams.pitch || this.lastHoveredSound?.pitch || 0,
                  velocity: renderParams.velocity || this.lastHoveredSound?.velocity || 1,
                  playbackRate: this.playbackRate,
                  startOffset: 0,
                  stopOffset: 0
                },
                `trajectory-${this.id}`
              );
              
              // Update the mix to include the new voice
              this.updateVoiceMix();
              
              console.log('Created new voice with updated parameters:', {
                newVoiceId,
                renderParams,
                duration: audioBuffer.duration
              });
            }
          }
        );
        
        return true;
      }
      
      // Handle trajectory events similarly
      let updatedTrajectories = false;
      
      this.trajectories.forEach((trajectory, trajectoryId) => {
        trajectory.events.forEach((event, index) => {
          if (event.cellData && event.cellData.genomeId === genomeId) {
            console.log(`Updating trajectory event ${index} in trajectory ${trajectoryId}`);
            this.updateTrajectoryEvent(trajectoryId, index, renderParams);
            updatedTrajectories = true;
          }
        });
      });
      
      return updatedTrajectories;
    } catch (error) {
      console.error('Error updating playing voice:', error);
      return false;
    }
  }

  // Update the updateExploreParams method to store original values
  updateExploreParams(updates) {
    if (!this.lastHoveredSound) return;
    
    // Check if this is a render parameter update
    const isRenderUpdate = updates.duration !== undefined || 
                          updates.pitch !== undefined ||
                          updates.velocity !== undefined;
    
    // Handle render updates separately
    if (isRenderUpdate) {
      // Store original values if not already stored
      if (this.lastHoveredSound.originalDuration === undefined && 
          this.lastHoveredSound.duration !== undefined) {
        this.lastHoveredSound.originalDuration = this.lastHoveredSound.duration;
      }
      
      if (this.lastHoveredSound.originalPitch === undefined && 
          this.lastHoveredSound.pitch !== undefined) {
        this.lastHoveredSound.originalPitch = this.lastHoveredSound.pitch;
      }
      
      if (this.lastHoveredSound.originalVelocity === undefined && 
          this.lastHoveredSound.velocity !== undefined) {
        this.lastHoveredSound.originalVelocity = this.lastHoveredSound.velocity;
      }

      // Prepare render parameters
      const renderParams = {
        duration: updates.duration !== undefined ? updates.duration : 
                 this.lastHoveredSound.duration !== undefined ? this.lastHoveredSound.duration : 4,
        pitch: updates.pitch !== undefined ? updates.pitch : 
              this.lastHoveredSound.pitch !== undefined ? this.lastHoveredSound.pitch : 0,
        velocity: updates.velocity !== undefined ? updates.velocity : 
                this.lastHoveredSound.velocity !== undefined ? this.lastHoveredSound.velocity : 1
      };
      
      // Use the shared implementation from BaseUnit
      this.renderSound(
        {
          genomeId: this.lastHoveredSound.genomeId,
          experiment: this.lastHoveredSound.experiment || 'unknown',
          evoRunId: this.lastHoveredSound.evoRunId || 'unknown'
        }, 
        renderParams
      );
      
      // IMPORTANT: Notify the UnitsContext about the parameter change
      try {
        import('../utils/ParameterUtils').then(module => {
          if (module.default && module.default.notifyParameterChange) {
            module.default.notifyParameterChange({
              duration: renderParams.duration,
              noteDelta: renderParams.pitch,
              velocity: renderParams.velocity
            });
          }
        }).catch(err => {
          console.error('Failed to import ParameterUtils:', err);
        });
      } catch (e) {
        console.warn('Failed to notify parameter change:', e);
      }
    }
    
    // Update the parameters
    Object.assign(this.lastHoveredSound, updates);
    
    // Update audio engine parameters for next hover playback and recording
    if (updates.playbackRate !== undefined) {
      this.playbackRate = updates.playbackRate;
    }
    if (updates.startOffset !== undefined) {
      this.startOffset = updates.startOffset;
    }
    if (updates.stopOffset !== undefined) {
      this.stopOffset = updates.stopOffset;
    }
  }
}
