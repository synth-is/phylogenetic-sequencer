import {el} from '@elemaudio/core';
import { UNIT_TYPES } from '../constants';
import { BaseUnit } from './BaseUnit';

export class LoopingUnit extends BaseUnit {
  constructor(id) {
    super(id, UNIT_TYPES.LOOPING);
    this.active = true;
    this.muted = false;
    this.soloed = false;
    this.volume = -12;
    this.audioDataCache = new Map();
    this.maxVoices = 4;
    this.pitch = 0;
    this.playbackRate = 1.0;

    this.loopingVoices = new Map();
    this.stateChangeCallbacks = new Set();
    this.lastHoverTimes = new Map();
    this.initialized = false; // Add this line
  }

  async initialize() {
    try {
      console.log(`Initializing LoopingUnit ${this.id}`);
      await super.initialize();
      this.initialized = true; // Add this line
      
      // Get references from AudioEngine
      const context = this.audioEngine.getContext();
      const renderer = this.audioEngine.getRenderer();

      if (!context || !renderer) {
        throw new Error('AudioEngine not properly initialized');
      }

      console.log(`LoopingUnit ${this.id} initialized successfully`);
      return true;
    } catch (err) {
      console.error(`LoopingUnit ${this.id} initialization error:`, err);
      return false;
    }
  }

  async handleCellHover(cellData) {
    if (!this.initialized || !this.active || this.muted || !cellData) return;

    const { audioUrl, genomeId } = cellData;
    if (!audioUrl || !genomeId) return;

    try {
      // Load audio data if needed
      const vfsKey = `sound-${genomeId}`;
      let audioData;
      
      if (!this.audioDataCache.has(vfsKey)) {
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        audioData = await this.audioEngine.getContext().decodeAudioData(arrayBuffer);
        this.audioDataCache.set(vfsKey, audioData);
        
        // Update VFS
        await this.audioEngine.getRenderer().updateVirtualFileSystem({
          [vfsKey]: audioData.getChannelData(0)
        });
      } else {
        audioData = this.audioDataCache.get(vfsKey);
      }

      // Toggle looping state
      if (this.loopingVoices.has(genomeId)) {
        // Stop if already playing
        this.stopLoopingVoice(genomeId);
        cellData.config?.onLoopStateChanged?.(false);
      } else {
        // Create and start new looping voice
        const voice = el.mul(
          el.mc.sample({
            channels: 1,
            path: vfsKey,
            mode: 'loop',
            playbackRate: this.playbackRate,
            key: `looping-${genomeId}-${this.id}`
          },
          el.const({ 
            key: `trigger-${genomeId}-${this.id}`,
            value: 1 
          }))[0],
          el.const({ 
            key: `gain-${genomeId}-${this.id}`,
            value: 1 / this.maxVoices 
          })
        );

        this.loopingVoices.set(genomeId, {
          voice,
          audioUrl: cellData.audioUrl,
          duration: audioData.duration,
          timestamp: Date.now()
        });

        this.updateVoiceMix();
        cellData.config?.onLoopStateChanged?.(true);
        this.notifyStateChange(); // Add this line to trigger UI update
      }

    } catch (error) {
      console.error('LoopingUnit error:', error);
      cellData.config?.onLoopStateChanged?.(false);
    }
  }

  async startLoopingVoice(genomeId, cellData, audioData) {
    while (this.loopingVoices.size >= this.maxVoices) {
      const [oldestId] = this.loopingVoices.keys();
      this.stopLoopingVoice(oldestId);
    }

    this.loopingVoices.set(genomeId, {
      voice: this.createLoopingVoice(genomeId, audioData),
      audioUrl: cellData.audioUrl,
      duration: audioData.duration,
      timestamp: Date.now(),
      offset: 0.5,
      playbackRate: this.playbackRate,
      startOffset: 0,
      stopOffset: 0
    });

    this.updateVoiceMix();
  }

  stopLoopingVoice(genomeId) {
    if (this.loopingVoices.has(genomeId)) {
      this.loopingVoices.delete(genomeId);
      this.updateVoiceMix();
      this.notifyStateChange(); // Add this line
    }
  }

  updateLoopingVoice(genomeId, updates) {
    if (!this.loopingVoices.has(genomeId)) return;

    const voiceData = this.loopingVoices.get(genomeId);
    const vfsKey = `sound-${genomeId}`;
    const audioData = this.audioDataCache.get(vfsKey);
    
    this.loopingVoices.set(genomeId, {
      ...voiceData,
      ...updates,
      voice: this.createLoopingVoice(genomeId, audioData, updates)
    });

    this.updateVoiceMix();
    this.notifyStateChange();
  }

  createLoopingVoice(genomeId, audioData, params = {}) {
    const {
      offset = 0.5,
      playbackRate = this.playbackRate,
      startOffset = 0,
      stopOffset = 0
    } = params;

    const vfsKey = `sound-${genomeId}`;
    const phaseOffset = Math.floor(offset * audioData.duration * this.audioEngine.getContext().sampleRate);

    // Remove timestamps from keys to maintain voice continuity
    return el.mul(
      el.mc.sample({
        channels: 1,
        path: vfsKey,
        mode: 'loop',
        playbackRate,
        startOffset: Math.floor(startOffset * audioData.duration * this.audioEngine.getContext().sampleRate),
        endOffset: Math.floor(stopOffset * audioData.duration * this.audioEngine.getContext().sampleRate),
        phaseOffset,
        key: `looping-${genomeId}-${this.id}` // Remove timestamp to maintain voice
      },
      el.const({ 
        key: `trigger-${genomeId}-${this.id}`, // Remove timestamp
        value: 1 
      }))[0],
      el.const({ 
        key: `gain-${genomeId}-${this.id}`, // Remove timestamp
        value: 1 / this.maxVoices 
      })
    );
  }

  updateVoiceMix() {
    if (!this.active) {
      this.updateAudioNodes([]);
      return;
    }

    console.log('LoopingUnit updateVoiceMix:', {
      unitId: this.id,
      voiceCount: this.loopingVoices.size,
      voices: Array.from(this.loopingVoices.entries()).map(([id, data]) => ({
        id,
        hasVoice: !!data.voice
      }))
    });

    const voices = Array.from(this.loopingVoices.values()).map(v => v.voice);
    const mix = voices.length === 0 ? el.const({value: 0}) :
               voices.length === 1 ? voices[0] :
               el.add(...voices);

    this.updateAudioNodes(mix ? [mix] : []);
  }

  cleanup() {
    this.audioDataCache.clear();
    this.loopingVoices.clear();
    this.stateChangeCallbacks.clear();
    this.lastHoverTimes.clear();
    super.cleanup();
  }

  // Add state change notification system
  addStateChangeCallback(callback) {
    this.stateChangeCallbacks.add(callback);
  }

  removeStateChangeCallback(callback) {
    this.stateChangeCallbacks.delete(callback);
  }

  notifyStateChange() {
    this.stateChangeCallbacks.forEach(callback => callback());
  }

  updateConfig(config) {
    // Handle state changes that need immediate audio update
    if (config.soloed !== undefined && config.soloed !== this.soloed) {
      this.soloed = config.soloed;
      this.updateVoiceMix();
      return;
    }

    // Handle pitch changes
    if (config.pitch !== undefined && config.pitch !== this.pitch) {
      this.pitch = config.pitch;
      this.playbackRate = Math.pow(2, config.pitch / 12);
      
      // Update all active voices with new playback rate, maintaining existing voice states
      this.loopingVoices.forEach((voiceData, genomeId) => {
        voiceData.playbackRate = this.playbackRate; // Update stored playbackRate
        const updatedVoice = this.createLoopingVoice(genomeId, 
          this.audioDataCache.get(`sound-${genomeId}`), 
          {
            ...voiceData,
            playbackRate: this.playbackRate
          }
        );
        voiceData.voice = updatedVoice; // Update voice directly instead of recreating map entry
      });
      
      this.updateVoiceMix();
    }

    // Handle max voices changes
    if (config.maxVoices !== undefined && config.maxVoices !== this.maxVoices) {
      this.maxVoices = config.maxVoices;
      
      // Remove excess voices if needed
      while (this.loopingVoices.size > this.maxVoices) {
        const [oldestId] = this.loopingVoices.keys();
        this.stopLoopingVoice(oldestId);
      }
      
      this.updateVoiceMix();
    }

    // Handle other config changes
    Object.assign(this, config);
    this.updateVoiceMix();
  }
}
