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
        audioData = await this.context.decodeAudioData(arrayBuffer);
        this.audioDataCache.set(vfsKey, audioData);
      } else {
        audioData = this.audioDataCache.get(vfsKey);
      }
  
      // Ensure both sample and reverb IR are in VFS
      const vfsUpdate = {};
      vfsUpdate[vfsKey] = audioData.getChannelData(0);
      await this.renderer.updateVirtualFileSystem(vfsUpdate);

      // Create voice elements
      const triggerRate = 1 / audioData.duration;
      const trigger = el.train(triggerRate);

      // Create voice with updated parameters
      const voice = el.mul(
        el.mul(
          el.sample(
            { path: vfsKey },
            trigger,
            el.const({ value: this.playbackRate })
          ),
          el.adsr(
            this.attackTime,
            this.decayTime,
            this.sustainLevel,
            this.releaseTime,
            trigger
          )
        ),
        el.const({ value: 1 / this.maxVoices })
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

      // Add reverb if available
      if (this.reverbAmount > 0) {
        const reverbSignal = el.mul(
          el.convolve({ path: 'reverb-ir' }, mix),
          el.const({ value: this.reverbAmount / 100 * this.reverbMix })
        );
        const drySignal = el.mul(
          mix,
          el.const({ value: 1 - (this.reverbAmount / 100) })
        );
        mix = el.mul(
          el.add(drySignal, reverbSignal),
          el.const({ value: Math.pow(10, this.volume / 20) })
        );
      }

      // Render final mix
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
