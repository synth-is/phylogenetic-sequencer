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
    this.attackTime = 0.01;
    this.decayTime = 0.1;
    this.sustainLevel = 0.7;
    this.releaseTime = 0.3;
    this.reverbMix = 0.3;
    this.trajectoryMode = 'continuous'; // 'continuous' or 'discrete'
    this.voiceOverlap = 'polyphonic'; // 'polyphonic' or 'monophonic'
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
      cellData
    });
  
    if (!this.active || this.muted || !this.renderer || !cellData) {
      console.log('TrajectoryUnit bail conditions:', {
        notActive: !this.active,
        isMuted: this.muted,
        noRenderer: !this.renderer,
        noData: !cellData
      });
      return;
    }
  
    const { audioUrl, genomeId } = cellData;
    if (!audioUrl || !genomeId) {
      console.log('TrajectoryUnit missing audio data:', { audioUrl, genomeId });
      return;
    }
  
    try {
      const vfsKey = `sound-${genomeId}`;
      let audioData;
  
      if (!this.audioDataCache.has(vfsKey)) {
        console.log('TrajectoryUnit fetching audio:', audioUrl);
        const response = await fetch(audioUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        audioData = await this.renderer.context.decodeAudioData(arrayBuffer);
        this.audioDataCache.set(vfsKey, audioData);
      } else {
        audioData = this.audioDataCache.get(vfsKey);
      }
  
      // Update VFS
      const vfsUpdate = {};
      vfsUpdate[vfsKey] = audioData.getChannelData(0);
      await this.renderer.updateVirtualFileSystem(vfsUpdate);

      // Create trigger
      const triggerRate = 1 / audioData.duration;
      const trigger = el.train(
        el.const({ key: `rate-${genomeId}`, value: triggerRate })
      );

      // Create voice with updated parameters
      const voice = el.mul(
        el.mul(
          el.sample(
            { path: vfsKey, mode: 'trigger', key: `sample-${genomeId}` },
            trigger,
            el.const({ key: `playback-rate-${genomeId}`, value: this.playbackRate })
          ),
          el.adsr(
            this.attackTime,
            this.decayTime,
            this.sustainLevel,
            this.releaseTime,
            trigger
          )
        ),
        el.const({ key: `voice-gain-${genomeId}`, value: 1 / this.maxVoices })
      );

      // Handle voice management based on mode
      if (this.voiceOverlap === 'monophonic') {
        this.activeVoices.clear();
      } else if (this.activeVoices.size >= this.maxVoices) {
        const [oldestKey] = this.activeVoices.keys();
        this.activeVoices.delete(oldestKey);
      }
      this.activeVoices.set(genomeId, voice);

      // Mix voices
      const voices = Array.from(this.activeVoices.values());
      let mix = voices.length > 1 ? el.add(...voices) : voices[0];

      // Add reverb
      if (this.reverbAmount > 0) {
        const reverbSignal = el.mul(
          el.convolve({ path: 'reverb-ir', key: `reverb-${genomeId}` }, mix),
          el.const({ key: `wet-gain-${genomeId}`, value: this.reverbAmount / 100 * this.reverbMix })
        );
        const drySignal = el.mul(
          mix,
          el.const({ key: `dry-gain-${genomeId}`, value: 1 - (this.reverbAmount / 100) })
        );
        mix = el.mul(
          el.add(drySignal, reverbSignal),
          el.const({ key: `master-gain-${genomeId}`, value: Math.pow(10, this.volume / 20) })
        );
      }

      await this.renderer.render(mix, mix);

      // Set throttle timeout
      this.throttleTimeout = setTimeout(() => {
        this.throttleTimeout = null;
        this.lastPlayedCell = null;
      }, audioData.duration * 1000);

      console.log('TrajectoryUnit successfully processed audio');

    } catch (error) {
      console.error(`TrajectoryUnit ${this.id} playback error:`, error);
      this.throttleTimeout = null;
      this.lastPlayedCell = null;
    }
  }

  updateConfig(config) {
    Object.assign(this, config);
  }

  // Add method to update playback parameters
  updatePlaybackParams(params) {
    Object.assign(this, params);
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
  }
}
