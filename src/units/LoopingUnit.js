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

    // Sync-related properties
    this.syncEnabled = false;
    this.masterLoopId = null;
    this.masterLoopDuration = null;

    this.loopingVoices = new Map();
    this.stateChangeCallbacks = new Set();
    this.initialized = false;
  }

  async initialize() {
    try {
      console.log(`Initializing LoopingUnit ${this.id}`);
      await super.initialize();
      this.initialized = true;
      
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

  getSharedClock() {
    if (this.syncEnabled && this.masterLoopDuration) {
      const rate = 1 / this.masterLoopDuration;
      return el.phasor(
        el.const({
          key: `sync-rate-${this.id}`,
          value: rate
        })
      );
    }
    return null;
  }

  getTriggerSignal() {
    const clock = this.getSharedClock();
    if (this.syncEnabled && clock) {
      // Create a gate signal that stays high for most of the cycle
      // and transitions smoothly at loop points
      return el.select(
        el.le(
          clock,
          el.const({ key: `trigger-thresh-${this.id}`, value: 0.95 })
        ),
        el.const({ value: 1 }),
        el.const({ value: 0 })
      );
    }
    return el.const({ value: 1 }); // Default: constant trigger
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

        // If this is the first loop, set it as the master
        if (this.loopingVoices.size === 0) {
          console.log('Setting master loop:', genomeId, audioData.duration);
          this.masterLoopId = genomeId;
          this.masterLoopDuration = audioData.duration;
        }
      } else {
        audioData = this.audioDataCache.get(vfsKey);
      }

      // Toggle looping state
      if (this.loopingVoices.has(genomeId)) {
        this.stopLoopingVoice(genomeId);
        cellData.config?.onLoopStateChanged?.(false);
      } else {
        if (this.loopingVoices.size >= this.maxVoices) {
          const [oldestId] = this.loopingVoices.keys();
          this.stopLoopingVoice(oldestId);
        }

        const voice = this.createLoopingVoice(genomeId, audioData);
        this.loopingVoices.set(genomeId, {
          voice,
          audioUrl: cellData.audioUrl,
          duration: audioData.duration,
          timestamp: Date.now()
        });

        this.updateVoiceMix();
        cellData.config?.onLoopStateChanged?.(true);
      }

      this.notifyStateChange();
    } catch (error) {
      console.error('LoopingUnit error:', error);
      cellData.config?.onLoopStateChanged?.(false);
    }
  }

  createLoopingVoice(genomeId, audioData, params = {}) {
    const {
      offset = 0.5,
      playbackRate = this.playbackRate
    } = params;

    const vfsKey = `sound-${genomeId}`;
    const trigger = this.getTriggerSignal();
    
    // Add an envelope to smooth transitions
    const env = el.adsr(
      0.01,    // Attack: quick fade in
      0.05,    // Decay: short
      1,       // Sustain: full volume
      0.05,    // Release: quick fade out
      trigger
    );

    // Combine sample playback with envelope
    return el.mul(
      el.mul(
        el.mc.sample({
          channels: 1,
          path: vfsKey,
          mode: 'loop',
          playbackRate,
          key: `looping-${genomeId}-${this.id}`
        },
        trigger)[0],
        env
      ),
      el.const({ 
        key: `gain-${genomeId}-${this.id}`,
        value: 1 / this.maxVoices 
      })
    );
  }

  stopLoopingVoice(genomeId) {
    if (this.loopingVoices.has(genomeId)) {
      this.loopingVoices.delete(genomeId);
      
      // If we stopped the master loop, find new master
      if (genomeId === this.masterLoopId) {
        const firstLoop = this.loopingVoices.entries().next().value;
        if (firstLoop) {
          const [newMasterId, newMasterData] = firstLoop;
          this.masterLoopId = newMasterId;
          this.masterLoopDuration = newMasterData.duration;
        } else {
          this.masterLoopId = null;
          this.masterLoopDuration = null;
        }
      }
      
      this.updateVoiceMix();
      this.notifyStateChange();
    }
  }

  updateVoiceMix() {
    if (!this.active) {
      this.updateAudioNodes([]);
      return;
    }

    console.log('LoopingUnit updateVoiceMix:', {
      unitId: this.id,
      voiceCount: this.loopingVoices.size,
      masterLoop: this.masterLoopId,
      syncEnabled: this.syncEnabled
    });

    // Recreate all voices using their individual stored pitches
    this.loopingVoices.forEach((voiceData, genomeId) => {
      const audioData = this.audioDataCache.get(`sound-${genomeId}`);
      // Use the voice's stored pitch/playbackRate instead of the master rate
      voiceData.voice = this.createLoopingVoice(genomeId, audioData, {
        playbackRate: voiceData.playbackRate || this.playbackRate,
        pitch: voiceData.pitch || this.pitch
      });
    });

    const voices = Array.from(this.loopingVoices.values()).map(v => v.voice);
    const mix = voices.length === 0 ? el.const({value: 0}) :
               voices.length === 1 ? voices[0] :
               el.add(...voices);

    this.updateAudioNodes(mix ? [mix] : []);
  }

  getMasterLoopInfo() {
    if (!this.masterLoopId) return null;
    
    return {
      id: this.masterLoopId,
      duration: this.masterLoopDuration
    };
  }

  toggleSync(enabled) {
    this.syncEnabled = enabled;
    this.updateVoiceMix();
    this.notifyStateChange();
  }

  cleanup() {
    this.audioDataCache.clear();
    this.loopingVoices.clear();
    this.stateChangeCallbacks.clear();
    this.masterLoopId = null;
    this.masterLoopDuration = null;
    super.cleanup();
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

  updateConfig(config) {
    // Handle pitch changes for looping voices
    if (config.pitch !== undefined && config.pitch !== this.pitch) {
      this.pitch = config.pitch;
      this.playbackRate = Math.pow(2, config.pitch / 12);
      
      // Update all looping voices with new playback rate only
      const playingGenomes = Array.from(this.loopingVoices.keys());
      playingGenomes.forEach(genomeId => {
        const voiceData = this.loopingVoices.get(genomeId);
        this.updateLoopingVoice(genomeId, {
          ...voiceData,
          playbackRate: this.playbackRate // Only update playbackRate, not pitch
        });
      });
    }

    // Handle other config changes
    Object.assign(this, config);
    this.updateVoiceMix();
    this.notifyStateChange();
  }

  updateLoopingVoice(genomeId, updates) {
    if (!this.loopingVoices.has(genomeId)) return;

    const voiceData = this.loopingVoices.get(genomeId);
    const vfsKey = `sound-${genomeId}`;
    const audioData = this.audioDataCache.get(vfsKey);

    if (!audioData) {
      console.error('No audio data found for voice:', genomeId);
      return;
    }

    // Calculate playback rate based on updates
    let newPlaybackRate;
    if (updates.playbackRate !== undefined) {
      // Use provided playbackRate directly
      newPlaybackRate = updates.playbackRate;
    } else {
      // Keep existing playbackRate or use unit's default
      newPlaybackRate = voiceData.playbackRate || this.playbackRate;
    }

    // Create voice with current parameters
    const voice = el.mul(
      el.mc.sample(
        {
          channels: 1,
          path: vfsKey,
          mode: 'loop',
          playbackRate: newPlaybackRate,
          startOffset: Math.floor((updates.startOffset ?? 0) * audioData.length),
          endOffset: Math.floor((updates.stopOffset ?? 0) * audioData.length),
          key: `looping-${genomeId}-${this.id}`
        },
        this.getTriggerSignal()
      )[0],
      el.const({ 
        key: `gain-${genomeId}-${this.id}`,
        value: 1 / this.maxVoices 
      })
    );

    // Update voice data, only updating the provided parameters
    this.loopingVoices.set(genomeId, {
      ...voiceData,
      ...updates,
      voice,
      playbackRate: newPlaybackRate,
      timestamp: Date.now()
    });

    this.updateAudioNodes([...Array.from(this.loopingVoices.values()).map(v => v.voice)]);
    this.notifyStateChange();
  }
}