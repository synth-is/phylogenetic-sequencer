import {el} from '@elemaudio/core';
import { UNIT_TYPES } from '../constants';
import { BaseUnit } from './BaseUnit';

export class TrajectoryUnit extends BaseUnit {
  constructor(id) {
    super(id, UNIT_TYPES.TRAJECTORY);
    this.active = true;
    this.muted = false;
    this.soloed = false;
    this.volume = -12;
    this.audioDataCache = new Map();
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
      
      console.log(`TrajectoryUnit ${this.id} initialized successfully`);
      return true;
    } catch (err) {
      console.error(`TrajectoryUnit ${this.id} initialization error:`, err);
      return false;
    }
  }
  

  async handleCellHover(cellData) {
    if (!this.active || this.muted || !cellData) return;

    const { audioUrl, genomeId } = cellData;
    if (!audioUrl || !genomeId) return;

    try {
      const vfsKey = `sound-${genomeId}`;
      let audioData;
  
      if (!this.audioDataCache.has(vfsKey)) {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        audioData = await this.audioEngine.getContext().decodeAudioData(arrayBuffer);
        this.audioDataCache.set(vfsKey, audioData);
        
        await this.audioEngine.getRenderer().updateVirtualFileSystem({
          [vfsKey]: audioData.getChannelData(0)
        });
      } else {
        audioData = this.audioDataCache.get(vfsKey);
      }

      // Create voice with proper trigger
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

      // Set up voice completion timeout
      const totalDuration = audioData.duration + 0.1; // Add small release time
      const timeoutId = setTimeout(() => {
        this.oneOffVoices.delete(voiceId);
        this.voiceTimeouts.delete(voiceId);
        
        const activeVoices = Array.from(this.oneOffVoices.keys())
          .filter(id => id.startsWith(genomeId));
        
        if (activeVoices.length === 0) {
          const callback = this.pendingCallbacks.get(genomeId);
          if (callback) callback();
          this.pendingCallbacks.delete(genomeId);
        }
        
        this.updateVoiceMix();
      }, totalDuration * 1000);

      this.voiceTimeouts.set(voiceId, timeoutId);

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

    const oneOffVoices = Array.from(this.oneOffVoices.values());
    const trajectorySignals = Array.from(this.activeTrajectorySignals.values());
    
    const voices = [...oneOffVoices, ...trajectorySignals];
    
    const mix = voices.length === 0 ? el.const({value: 0}) :
               voices.length === 1 ? voices[0] :
               el.add(...voices);

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
    // Remove context.close() since AudioEngine manages the context
    if (this.throttleTimeout) {
      clearTimeout(this.throttleTimeout);
    }
    this.audioDataCache.clear();
    this.activeVoices.clear();
    this.loopingVoices.clear();
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
    this.loopStateCallbacks.clear();

    this.activeTrajectorySignals.clear();
    this.trajectories.clear();
    this.isRecording = false;
    this.currentRecordingId = null;
    this.recordingStartTime = null;

    this.stateChangeCallbacks.clear();
    // Make sure to call parent cleanup to remove nodes from AudioEngine
    super.cleanup();
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

    // Get audio buffer length to store with event
    const vfsKey = `sound-${cellData.genomeId}`;
    const audioData = this.audioDataCache.get(vfsKey);
    const bufferLength = audioData ? audioData.length : 0;

    const trajectory = this.trajectories.get(this.currentRecordingId);
    trajectory.events.push({
      time: currentTime,
      cellData,
      offset: 0.5,          // Position in sequence
      playbackRate: 1,      // Speed/pitch
      startOffset: 0,       // Start offset as proportion (0-1)
      stopOffset: 0,        // Stop offset as proportion (0-1)
      bufferLength         // Store buffer length for reference
    });
  }

  // Add method to update trajectory event parameters
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
    
    if (wasPlaying) {
      console.log('Stopping playback to update parameters');
      this.stopTrajectoryPlayback(trajectoryId);
    }

    // Update the event parameters
    trajectory.events = trajectory.events.map((event, index) => {
      if (index === eventIndex) {
        const updatedEvent = { ...event, ...updates };
        console.log('Updated event:', updatedEvent);
        return updatedEvent;
      }
      return event;
    });

    // Restart playback if it was playing before
    if (wasPlaying) {
      console.log('Restarting playback with updated parameters');
      this.playTrajectory(trajectoryId);
    }
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

    trajectory.isPlaying = true;

    try {
      const context = this.audioEngine.getContext();
      const renderer = this.audioEngine.getRenderer();
      
      if (!context || !renderer) {
        throw new Error('AudioEngine not properly initialized');
      }

      // Ensure all samples are loaded in VFS first
      for (const event of trajectory.events) {
        if (event.cellData && event.cellData.audioUrl) {
          const vfsKey = `sound-${event.cellData.genomeId}`;
          
          if (!this.audioDataCache.has(vfsKey)) {
            const response = await fetch(event.cellData.audioUrl);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            const audioData = await context.decodeAudioData(arrayBuffer);
            this.audioDataCache.set(vfsKey, audioData);
            
            // Update VFS
            const vfsUpdate = {};
            vfsUpdate[vfsKey] = audioData.getChannelData(0);
            await renderer.updateVirtualFileSystem(vfsUpdate);
          }
        }
      }

      // Create timing signal - 100Hz clock
      const ticker = el.train(100);

      // Calculate timing adjustments based on offsets
      const events = trajectory.events.filter(evt => evt.cellData);
      const sequenceDuration = events[events.length - 1].time;

      // Create sequence with timing adjusted by offset parameter
      const seq = events.map((evt, i) => {
        // Calculate adjusted time using the offset parameter (0-1)
        // offset 0.5 = original time, 0 = start of sequence, 1 = end of sequence
        const baseTime = evt.time;
        const offsetAmount = (evt.offset - 0.5) * 2; // Convert 0-1 to -1 to 1
        const adjustedTime = Math.max(0, 
          baseTime + (offsetAmount * (sequenceDuration * 0.1)) // 10% max shift
        );

        console.log('Event timing:', {
          eventIndex: i,
          originalTime: baseTime,
          offset: evt.offset,
          adjustedTime,
          genomeId: evt.cellData.genomeId
        });

        return {
          tickTime: Math.round(adjustedTime * 100) + 1,
          value: i + 1,
          genomeId: evt.cellData.genomeId
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

      // Create individual triggers for EACH event
      const players = seq.map((event, index) => {
        const vfsKey = `sound-${event.genomeId}`;
        // Find the corresponding event in trajectory.events that has our parameters
        const trajectoryEvent = trajectory.events[index];
        const audioData = this.audioDataCache.get(vfsKey);
        const bufferLength = audioData ? audioData.length : 0;

        console.log('Creating player for event:', {
          genomeId: event.genomeId,
          parameters: trajectoryEvent,
          bufferLength
        });

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

        // Ensure we use the current playbackRate from the event
        return el.mc.sample({
          channels: 1,
          key: `player-${trajectoryId}-${index}-${event.genomeId}`,
          path: vfsKey,
          mode: 'trigger',
          playbackRate: trajectoryEvent?.playbackRate || 1, // Use event's playbackRate
          startOffset: startOffset,
          stopOffset: stopOffset
        }, trigger)[0];
      });

      // Apply duration scaling to the sequence timing
      if (players.length > 0) {
        const signal = players.length === 1 ?
          el.mul(players[0], el.const({ key: `gain-${trajectoryId}`, value: 1 / this.maxVoices })) :
          el.mul(el.add(...players), el.const({ key: `gain-${trajectoryId}`, value: 1 / this.maxVoices }));

        this.activeTrajectorySignals.set(trajectoryId, signal);
        this.updateVoiceMix();
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
}
