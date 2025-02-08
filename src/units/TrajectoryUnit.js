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
      playbackMode: this.playbackMode
    });
  
    if (!this.active || this.muted || !this.renderer || !cellData) {
      return;
    }
  
    const { audioUrl, genomeId } = cellData;
    if (!audioUrl || !genomeId) return;
  
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

      if (this.playbackMode === 'looping') {
        // Toggle: remove if already looping, add if not
        if (this.loopingVoices.has(genomeId)) {
            console.log('Looping voice stopped:', genomeId);
            this.loopingVoices.delete(genomeId);
            this.updateVoiceMix();
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
            timestamp: Date.now()
            });
        }
      } else { // one-off mode
        console.log('One-off voice triggered:', genomeId);
        // Clean up old voices if at max
        if (this.oneOffVoices.size >= this.maxVoices) {
          const [oldestId] = this.oneOffVoices.keys();
          this.oneOffVoices.delete(oldestId);
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

        // Remove voice after duration
        const timeoutId = setTimeout(() => {
          this.oneOffVoices.delete(voiceId);
          this.voiceTimeouts.delete(voiceId);
          this.updateVoiceMix();
        }, audioData.duration * 1000);

        this.voiceTimeouts.set(voiceId, timeoutId);
      }

      this.updateVoiceMix();

    } catch (error) {
      console.error(`TrajectoryUnit ${this.id} playback error:`, error);
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
  }
}
