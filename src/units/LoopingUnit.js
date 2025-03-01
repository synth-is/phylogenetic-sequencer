import {el} from '@elemaudio/core';
import { UNIT_TYPES } from '../constants';
import { BaseUnit } from './BaseUnit';
import SoundRenderer from '../utils/SoundRenderer';

export class LoopingUnit extends BaseUnit {
  constructor(id) {
    super(id, UNIT_TYPES.LOOPING);
    this.active = true;
    this.muted = false;
    this.soloed = false;
    this.volume = -12;
    this.audioDataCache = new Map(); // Will store metadata instead of full buffers
    this.audioBufferSources = new Map(); // To track sources by ID
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

    // Add rendering state
    this.renderingVoices = new Map();
    this.renderCallbacks = new Set();
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
    console.log('LoopingUnit handleCellHover:', cellData);
    if (!this.initialized || !this.active || this.muted || !cellData) return;

    const { audioUrl, genomeId } = cellData;
    if (!genomeId) return;

    try {
      // Load audio data if needed
      const vfsKey = `sound-${genomeId}`;
      let audioMetadata = this.audioDataCache.get(vfsKey);
      
      if (!audioMetadata) {
        try {
          const renderParams = {
            duration: cellData.duration || 4,
            pitch: cellData.noteDelta || 0,
            velocity: cellData.velocity || 1
          };
          
          // Use the unified BaseUnit renderSound method
          const result = await this.renderSound(
            {
              genomeId,
              experiment: cellData.experiment || 'unknown',
              evoRunId: cellData.evoRunId || 'unknown'
            },
            renderParams
          );
          
          if (result) {
            audioMetadata = result.metadata;
          } else {
            throw new Error('Failed to obtain audio data');
          }
        } catch (error) {
          console.error('Failed to obtain audio data:', error);
          cellData.config?.onLoopStateChanged?.(false);
          return;
        }
      }

      // Store cell data experiment and evoRunId with the looping voice
      // This ensures we have this information for updates later
      if (this.loopingVoices.has(genomeId)) {
        this.stopLoopingVoice(genomeId);
        cellData.config?.onLoopStateChanged?.(false);
      } else {
        if (this.loopingVoices.size >= this.maxVoices) {
          const [oldestId] = this.loopingVoices.keys();
          this.stopLoopingVoice(oldestId);
        }

        const voice = this.createLoopingVoice(genomeId, audioMetadata);
        this.loopingVoices.set(genomeId, {
          voice,
          audioUrl: cellData.audioUrl,
          experiment: cellData.experiment,  // Make sure to store these
          evoRunId: cellData.evoRunId,     // values from cellData
          duration: audioMetadata.duration,
          timestamp: Date.now(),
          // Add render parameters
          duration: cellData.duration || 4,
          pitch: cellData.noteDelta || 0,
          velocity: cellData.velocity || 1
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

  createLoopingVoice(genomeId, audioMetadata, params = {}) {
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
      const audioMetadata = this.audioDataCache.get(`sound-${genomeId}`);
      if (!audioMetadata) return;
      
      // Use the voice's stored pitch/playbackRate instead of the master rate
      voiceData.voice = this.createLoopingVoice(genomeId, audioMetadata, {
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
    this.audioBufferSources.clear();
    this.loopingVoices.clear();
    this.stateChangeCallbacks.clear();
    this.masterLoopId = null;
    this.masterLoopDuration = null;
    this.renderingVoices.clear();
    this.renderCallbacks.clear();
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

  // Completely rewritten updateLoopingVoice method with proper error handling and logging
  updateLoopingVoice(genomeId, updates) {
    console.log('Updating looping voice:', { genomeId, updates });
    
    if (!this.loopingVoices.has(genomeId)) {
      console.error('No looping voice found with ID:', genomeId);
      return;
    }

    const voiceData = this.loopingVoices.get(genomeId);
    
    // Check if this is a render parameter update - needs new audio data
    const isRenderUpdate = updates.duration !== undefined || 
                          updates.pitch !== undefined ||
                          updates.velocity !== undefined;
    
    // For render parameter updates, use the renderSound method
    if (isRenderUpdate && !updates.vfsKey) {
      console.log('LoopingUnit: Render update detected');
      
      // Prepare render parameters
      const renderParams = {
        duration: updates.duration ?? voiceData.duration ?? 4,
        pitch: updates.pitch ?? voiceData.pitch ?? 0,
        velocity: updates.velocity ?? voiceData.velocity ?? 1
      };
      
      console.log('Rendering with params:', renderParams);
      
      // Use the shared implementation with a success callback
      this.renderSound(
        { 
          genomeId, 
          experiment: voiceData.experiment || 'unknown',
          evoRunId: voiceData.evoRunId || 'unknown'
        }, 
        renderParams,
        {
          onSuccess: (renderKey, audioBuffer) => {
            // Update the looping voice with the new render key
            const metadata = {
              duration: audioBuffer.duration,
              length: audioBuffer.length,
              sampleRate: audioBuffer.sampleRate,
              numberOfChannels: audioBuffer.numberOfChannels
            };
            this.audioDataCache.set(renderKey, metadata);
            
            // Update with the new render key
            this.updateLoopingVoice(genomeId, {
              ...updates,
              vfsKey: renderKey
            });
          }
        }
      );
      return; // Exit early, we'll continue after render is complete
    }

    // For non-render updates like playbackRate, startOffset, etc.
    // Get the metadata from the original key
    const originalVfsKey = `sound-${genomeId}`;
    const customVfsKey = voiceData.vfsKey || originalVfsKey;
    
    // First check if we have metadata directly for the key we're using
    let audioMetadata = this.audioDataCache.get(customVfsKey);
    
    // If not found, try the original key as a fallback
    if (!audioMetadata && customVfsKey !== originalVfsKey) {
      audioMetadata = this.audioDataCache.get(originalVfsKey);
    }
    
    // If still not found, look for any metadata for this genome
    if (!audioMetadata) {
      // Get all cache keys
      const allKeys = Array.from(this.audioDataCache.keys());
      console.log('Looking for metadata in all keys:', { 
        genomeId, 
        allKeys,
        searchingFor: `sound-${genomeId}`
      });
      
      // Find any key that starts with sound-{genomeId}
      for (const key of allKeys) {
        if (key.startsWith(`sound-${genomeId}`)) {
          audioMetadata = this.audioDataCache.get(key);
          console.log(`Found metadata using key: ${key}`);
          break;
        }
      }
    }
    
    // If we still don't have metadata, check if the Audio Engine has this voice loaded
    if (!audioMetadata && this.audioEngine) {
      // Try to get it from the Audio Engine's VFS if available
      const audioData = this.audioEngine.getAudioData?.(originalVfsKey);
      if (audioData) {
        // Create metadata from the audio data
        audioMetadata = {
          duration: audioData.duration || voiceData.duration || 4,
          length: audioData.length || (48000 * 4), // Default to 4 seconds if unknown
          sampleRate: audioData.sampleRate || 48000,
          numberOfChannels: audioData.numberOfChannels || 1
        };
        
        // Cache it for future use
        this.audioDataCache.set(originalVfsKey, audioMetadata);
        console.log('Created metadata from AudioEngine data:', audioMetadata);
      }
    }
    
    // Last resort - if we still don't have metadata, create a placeholder based on voiceData
    if (!audioMetadata && voiceData) {
      console.warn('Creating dummy metadata as last resort for:', genomeId);
      audioMetadata = {
        duration: voiceData.duration || 4,
        length: (voiceData.duration || 4) * 48000,
        sampleRate: 48000,
        numberOfChannels: 1
      };
      
      // Cache this placeholder
      this.audioDataCache.set(originalVfsKey, audioMetadata);
    }
    
    if (!audioMetadata) {
      console.error('No audio metadata found for voice:', genomeId, {
        availableKeys: Array.from(this.audioDataCache.keys()),
        voiceData: voiceData
      });
      return;
    }

    // For VFS path, use either the provided key or the original
    const vfsKey = updates.vfsKey || voiceData.vfsKey || originalVfsKey;
    console.log('Using VFS key for playback:', vfsKey);

    // Calculate playback rate based on updates
    const newPlaybackRate = updates.playbackRate ?? voiceData.playbackRate ?? this.playbackRate;
    console.log('Setting playback rate:', newPlaybackRate);

    // Create voice with current parameters
    const voice = el.mul(
      el.mc.sample(
        {
          channels: 1,
          path: vfsKey,
          mode: 'loop',
          playbackRate: newPlaybackRate,
          startOffset: Math.floor((updates.startOffset ?? voiceData.startOffset ?? 0) * audioMetadata.length),
          endOffset: Math.floor((updates.stopOffset ?? voiceData.stopOffset ?? 0) * audioMetadata.length),
          key: `looping-${genomeId}-${this.id}`
        },
        this.getTriggerSignal()
      )[0],
      el.const({ 
        key: `gain-${genomeId}-${this.id}`,
        value: 1 / this.maxVoices 
      })
    );

    // Update voice data, merging only the updates provided
    this.loopingVoices.set(genomeId, {
      ...voiceData,
      ...updates,
      voice,
      playbackRate: newPlaybackRate,
      timestamp: Date.now()
    });

    console.log('Voice updated successfully');
    this.updateVoiceMix();
    this.notifyStateChange();
  }
  
  // Compatibility method for state change notification
  notifyRenderStateChange() {
    super.notifyRenderStateChange();
  }

  // Replace SoundRenderer direct calls with our base method
  async renderSound(soundData, renderParams, options = {}) {
    console.log('LoopingUnit - Rendering sound:', { soundData, renderParams, options });
    return super.renderSound(soundData, renderParams, options);
  }
}