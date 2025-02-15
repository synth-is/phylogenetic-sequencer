import {el} from '@elemaudio/core';
import { UNIT_TYPES } from '../constants';
import { BaseUnit } from './BaseUnit';

export class TrajectoryUnit extends BaseUnit {
  constructor(id) {
    super(id, UNIT_TYPES.TRAJECTORY);
    // Remove renderer and context as they're now handled by AudioEngine
    this.active = true;
    this.muted = false;
    this.soloed = false;
    this.volume = -12;
    this.audioDataCache = new Map();
    this.activeVoices = new Map();
    this.maxVoices = 4;
    this.reverbAmount = 5;
    this.lastPlayedCell = null;
    this.throttleTimeout = null;

    // Add new properties
    this.playbackRate = 1.0;
    this.attackTime = 0.001;  // Almost instant attack
    this.decayTime = 0.001;   // Almost instant decay
    this.sustainLevel = 1.0;   // Full sustain level
    this.releaseTime = 0.001;  // Almost instant release
    this.reverbMix = 0.3;
    this.trajectoryMode = 'continuous'; // 'continuous' or 'discrete'
    this.voiceOverlap = 'polyphonic'; // 'polyphonic' or 'monophonic'

    // Add new properties for playback control
    this.playbackMode = 'one-off'; // 'one-off' or 'looping'
    this.loopingVoices = new Map(); // Track which sounds are currently looping
    this.oneOffVoices = new Map(); // Track active one-off voices
    this.voiceTimeouts = new Map(); // Add this line

    // Add new maps to track pending and active sounds
    this.pendingCallbacks = new Map(); // Store callbacks for each genome ID
    this.activeGenomes = new Map(); // Track which genomes are actually playing

    this.hoverDebounce = 50; // ms
    this.lastHoverTimes = new Map();
    this.highlightTimeouts = new Map(); // Add this line
    this.loopStateCallbacks = new Map(); // Add this to track callbacks per genome

    // Add trajectory recording state
    this.trajectories = new Map(); // Map of trajectory ID to trajectory data
    this.isRecording = false;
    this.recordingStartTime = null;
    this.currentRecordingId = null;
    this.activeTrajectorySignals = new Map();

    this.pitch = 0;
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
    console.log('TrajectoryUnit received hover:', {
      id: this.id,
      active: this.active,
      muted: this.muted,
      cellData,
      hasCallback: !!cellData?.config?.onEnded,
      playbackMode: this.playbackMode
    });
  
    if (!this.active || this.muted || !cellData) {
      return;
    }

    // Get AudioEngine instances
    const context = this.audioEngine.getContext();
    const renderer = this.audioEngine.getRenderer();
    
    if (!context || !renderer) {
      console.error('AudioEngine not properly initialized');
      return;
    }
  
    const { audioUrl, genomeId } = cellData;
    if (!audioUrl || !genomeId) return;

    const now = Date.now();
    const lastHover = this.lastHoverTimes.get(genomeId) || 0;
    
    // Debounce rapid hover events
    if (now - lastHover < this.hoverDebounce) {
      console.log('TrajectoryUnit debouncing rapid hover:', genomeId);
      return;
    }
    
    this.lastHoverTimes.set(genomeId, now);
  
    try {
      const context = this.audioEngine.getContext();
      const renderer = this.audioEngine.getRenderer();
      
      if (!context || !renderer) {
        throw new Error('AudioEngine not properly initialized');
      }

      const vfsKey = `sound-${genomeId}`;
      let audioData;
  
      if (!this.audioDataCache.has(vfsKey)) {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        audioData = await context.decodeAudioData(arrayBuffer);
        this.audioDataCache.set(vfsKey, audioData);
      } else {
        audioData = this.audioDataCache.get(vfsKey);
      }
  
      // Ensure sample is in VFS
      const vfsUpdate = {};
      vfsUpdate[vfsKey] = audioData.getChannelData(0);
      await renderer.updateVirtualFileSystem(vfsUpdate);

      // Clear any existing highlight timeout for this genome
      if (this.highlightTimeouts.has(genomeId)) {
        clearTimeout(this.highlightTimeouts.get(genomeId));
        this.highlightTimeouts.delete(genomeId);
      }

      // Set a fallback timeout to ensure highlight gets cleared
      const highlightTimeout = setTimeout(() => {
        console.log('Forcing highlight cleanup for:', genomeId);
        if (!this.loopingVoices.has(genomeId)) {
          cellData.config?.onEnded?.();
        }
      }, 5000); // 5 second fallback

      this.highlightTimeouts.set(genomeId, highlightTimeout);

      if (this.playbackMode === 'looping') {
        // Store callback for this genome
        this.loopStateCallbacks.set(genomeId, cellData.config?.onLoopStateChanged);

        if (this.loopingVoices.has(genomeId)) {
          console.log('Stopping looping voice:', genomeId);
          this.loopingVoices.delete(genomeId);
          this.updateVoiceMix();
          // Notify that loop has stopped
          cellData.config?.onLoopStateChanged?.(false);
          return;
        }

        if( ! this.loopingVoices.has(genomeId) ) {
            // Clean up old looping voices if at max
            if (this.loopingVoices.size >= this.maxVoices) {
                const [oldestId] = this.loopingVoices.keys();
                console.log('Cleaning up old looping voice:', oldestId);
                this.loopingVoices.delete(oldestId);
                this.updateVoiceMix();
            }

            console.log('Looping voice triggered:', genomeId);
            const voice = el.mul(
            el.mc.sample(
                {
                channels: 1,
                path: vfsKey,
                mode: 'loop',
                playbackRate: this.playbackRate,
                startOffset: 0,
                endOffset: 0
                },
                el.const({ value: 1 }) // Constant trigger
            )[0], // Take first channel from multichannel output
            el.const({ value: 1 / this.maxVoices }) // Dynamic gain scaling
            );

            // Store voice with metadata and timestamp for age tracking
            this.loopingVoices.set(genomeId, {
            voice,
            audioUrl,
            duration: audioData.duration,
            timestamp: Date.now(),
            isLooping: true  // Add this flag
            });

            cellData.config?.onLoopStateChanged?.(true);
        }
      } else { // one-off mode
        // Store callback before potentially superseding the voice
        this.pendingCallbacks.set(genomeId, cellData.config?.onEnded);

        // Clean up old voices if at max
        if (this.oneOffVoices.size >= this.maxVoices) {
          const [oldestVoiceId] = this.oneOffVoices.keys();
          const oldestGenomeId = oldestVoiceId.split('-')[0];
          
          // Call onEnded for the superseded voice
          console.log('Superseding voice:', {
            oldestVoiceId,
            oldestGenomeId,
            hasCallback: !!this.pendingCallbacks.get(oldestGenomeId)
          });

          // Only call onEnded if the genome isn't also playing in looping mode
          if (!this.loopingVoices.has(oldestGenomeId)) {
            const callback = this.pendingCallbacks.get(oldestGenomeId);
            if (callback) callback();
          }

          this.oneOffVoices.delete(oldestVoiceId);
          this.pendingCallbacks.delete(oldestGenomeId);
          this.updateVoiceMix();
        }

        // Create one-off voice - exactly matching createOneOffVoice from test-component.js
        const voiceId = `${genomeId}-${Date.now()}`;
        const voice = el.mul(
          el.mc.sample(
            {
              channels: 1,
              path: vfsKey, 
              mode: 'trigger',
              playbackRate: this.playbackRate,
              startOffset: 0,
              endOffset: 0
            },
            el.const({ key: `${voiceId}-trigger`, value: 1 }), // Single trigger with unique key
          )[0], // Take first channel from multichannel output
          el.const({ value: 1 / this.maxVoices }) // Dynamic gain scaling
        );

        // Store the voice and setup cleanup
        this.oneOffVoices.set(voiceId, voice);
        this.updateVoiceMix();

        // Track that this genome is now actually playing
        this.activeGenomes.set(genomeId, {
          mode: 'one-off',
          timestamp: Date.now()
        });

        // Calculate actual sound duration including release time
        const totalDuration = audioData.duration + this.releaseTime;
        
        console.log('Setting up voice completion timeout:', {
          voiceId,
          genomeId,
          duration: totalDuration,
          hasCallback: !!cellData?.config?.onEnded,  // Add callback check to debug log
          callbackType: typeof cellData?.config?.onEnded  // Log callback type
        });

        // Remove voice and trigger callback after sound fully completes
        const timeoutId = setTimeout(() => {
          console.log('Voice completion timeout fired:', {
            voiceId,
            genomeId,
            activeVoicesForGenome: Array.from(this.oneOffVoices.keys())
              .filter(id => id.startsWith(genomeId)),
            hasLoopingVoice: this.loopingVoices.has(genomeId),
            hasCallback: !!this.pendingCallbacks.get(genomeId)  // Add callback check here too
          });

          this.oneOffVoices.delete(voiceId);
          this.voiceTimeouts.delete(voiceId);
          this.activeGenomes.delete(genomeId);
          this.updateVoiceMix();
          
          // Only trigger onEnded if this was the last voice for this genome
          // AND there's no looping voice for this genome
          const activeVoicesForGenome = Array.from(this.oneOffVoices.keys())
            .filter(id => id.startsWith(genomeId));
          
          if (activeVoicesForGenome.length === 0 && !this.loopingVoices.has(genomeId)) {
            console.log('Calling onEnded callback for genome:', genomeId);
            const callback = this.pendingCallbacks.get(genomeId);
            if (callback) callback();
            this.pendingCallbacks.delete(genomeId);
          } else {
            console.log('Skipping onEnded - active voices remain or looping:', {
              activeOneOffs: activeVoicesForGenome,
              isLooping: this.loopingVoices.has(genomeId)
            });
          }
        }, totalDuration * 1000);

        this.voiceTimeouts.set(voiceId, timeoutId);
      }

      this.updateVoiceMix();

    } catch (error) {
      console.error(`TrajectoryUnit ${this.id} playback error:`, error);
      console.log('Calling onEnded due to error');
      cellData.config?.onEnded?.(); // Ensure callback is called even on error
    }

    // Add recording functionality
    if (this.isRecording) {
      this.recordEvent(cellData);
    }
  }

  // Add new methods for voice management
  stopLoopingVoice(genomeId) {
    if (this.loopingVoices.has(genomeId)) {
      this.loopingVoices.delete(genomeId);
      this.updateVoiceMix();
    }
  }

  updateVoiceMix() {
    // Combine all active voices
    const loopingVoices = Array.from(this.loopingVoices.values()).map(v => v.voice);
    const oneOffVoices = Array.from(this.oneOffVoices.values());
    const voices = [...loopingVoices, ...oneOffVoices];

    let mix = voices.length === 0 ? el.const({value: 0}) :
             voices.length === 1 ? voices[0] :
             el.add(...voices);

    // Apply reverb if enabled
    if (this.reverbAmount > 0) {
      // ...existing reverb code...
    }

    // Add trajectory signals to the mix
    if (this.activeTrajectorySignals.size > 0) {
      const trajectorySignals = Array.from(this.activeTrajectorySignals.values());
      const trajectoryMix = trajectorySignals.length === 1 ? 
        trajectorySignals[0] : el.add(...trajectorySignals);
      mix = mix ? el.add(mix, trajectoryMix) : trajectoryMix;
    }

    // Instead of directly rendering, update nodes in AudioEngine
    this.updateAudioNodes(mix ? [mix] : []);
  }

  // Update config method to handle playback mode
  updateConfig(config) {
    Object.assign(this, config);
    if (config.playbackMode) {
      if (config.playbackMode !== this.playbackMode) {
        // Clear all voices when switching modes
        this.loopingVoices.clear();
        this.oneOffVoices.clear();
        this.updateVoiceMix();
      }
      this.playbackMode = config.playbackMode;
    }
    if (config.pitch !== undefined) {
      this.playbackRate = Math.pow(2, config.pitch / 12);
      
      // Update all looping voices with new playback rate
      this.loopingVoices.forEach((voiceData, genomeId) => {
        const vfsKey = `sound-${genomeId}`;
        const voice = el.mul(
          el.mc.sample(
            {
              channels: 1,
              path: vfsKey,
              mode: 'loop',
              playbackRate: this.playbackRate,
              startOffset: 0,
              endOffset: 0
            },
            el.const({ value: 1 })
          )[0],
          el.const({ value: 1 / this.maxVoices })
        );
        this.loopingVoices.set(genomeId, {
          ...voiceData,
          voice
        });
      });

      // Update trajectory events
      this.updateTrajectoryPlaybackRates(config.pitch);
      
      // Update audio graph with new voices
      this.updateVoiceMix();
    }
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

  // Add method to clean up old voices if needed
  cleanupOldVoices() {
    // Keep only the most recent maxVoices looping voices
    if (this.loopingVoices.size > this.maxVoices) {
      const sortedVoices = Array.from(this.loopingVoices.entries())
        .sort((a, b) => b[1].timestamp - a[1].timestamp)
        .slice(0, this.maxVoices);
      
      this.loopingVoices = new Map(sortedVoices);
      this.updateVoiceMix();
    }
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
    const hasLoopingVoice = this.loopingVoices.has(genomeId);
    const hasOneOffVoice = Array.from(this.oneOffVoices.keys())
      .some(id => id.startsWith(genomeId));
    const isTrackedAsActive = this.activeGenomes.has(genomeId);
    
    console.log('Checking active voices:', {
      genomeId,
      hasLoopingVoice,
      hasOneOffVoice,
      isTrackedAsActive,
      activeGenomes: Array.from(this.activeGenomes.keys())
    });
    
    return hasLoopingVoice || hasOneOffVoice;
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
