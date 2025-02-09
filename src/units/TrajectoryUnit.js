import WebRenderer from '@elemaudio/web-renderer';
import {el} from '@elemaudio/core';
import { UNIT_TYPES } from '../constants';

export class TrajectoryUnit {
  constructor(id) {
    this.id = id;
    this.type = UNIT_TYPES.TRAJECTORY;
    this.renderer = null;
    this.context = null;
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
  }

  async initialize() {
    try {
      console.log(`Initializing TrajectoryUnit ${this.id}`);
      const context = new AudioContext();
      await context.resume();
      
      const core = new WebRenderer();
      const node = await core.initialize(context, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      
      node.connect(context.destination);
      
      this.renderer = core;
      this.context = context;

      // Load impulse response for reverb
      try {
        const irResponse = await fetch('/WIDEHALL-1.wav');  // Updated path to match HeatmapViewer
        if (!irResponse.ok) throw new Error(`HTTP error! status: ${irResponse.status}`);
        const irArrayBuffer = await irResponse.arrayBuffer();
        const irAudioBuffer = await this.context.decodeAudioData(irArrayBuffer);
        
        // Update VFS with impulse response
        const vfsUpdate = {
          'reverb-ir': irAudioBuffer.getChannelData(0)
        };
        await this.renderer.updateVirtualFileSystem(vfsUpdate);
        console.log(`TrajectoryUnit ${this.id} loaded reverb IR successfully`);
      } catch (irError) {
        console.warn(`TrajectoryUnit ${this.id} failed to load reverb IR:`, irError);
        // Create a minimal IR if loading fails
        const minimalIR = new Float32Array(4096).fill(0);
        minimalIR[0] = 1;
        await this.renderer.updateVirtualFileSystem({
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
      hasRenderer: !!this.renderer,
      cellData,
      hasCallback: !!cellData?.config?.onEnded,  // Add this debug log
      playbackMode: this.playbackMode
    });
  
    if (!this.active || this.muted || !this.renderer || !cellData) {
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
      const vfsKey = `sound-${genomeId}`;
      let audioData;
  
      if (!this.audioDataCache.has(vfsKey)) {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        audioData = await this.context.decodeAudioData(arrayBuffer);
        this.audioDataCache.set(vfsKey, audioData);
      } else {
        audioData = this.audioDataCache.get(vfsKey);
      }
  
      // Ensure sample is in VFS
      const vfsUpdate = {};
      vfsUpdate[vfsKey] = audioData.getChannelData(0);
      await this.renderer.updateVirtualFileSystem(vfsUpdate);

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

    // Render final mix
    this.renderer.render(mix, mix);
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
    if (this.context?.state !== 'closed') {
      this.context?.close();
    }
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
}
