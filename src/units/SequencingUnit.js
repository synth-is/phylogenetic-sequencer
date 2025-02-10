import {el} from '@elemaudio/core';
import { UNIT_TYPES } from '../constants';
import { BaseUnit } from './BaseUnit';

export class SequencingUnit extends BaseUnit {
  constructor(id) {
    super(id, UNIT_TYPES.SEQUENCING);
    this.sequence = [];
    this.tempo = 120;
    this.isPlaying = false;
    this.currentStep = 0;
    this.audioDataCache = new Map();
    
    // Add new properties for sequencing
    this.activeSequence = [];
    this.isRecording = false;
    this.bars = 4;
    this.startOffset = 0;
    this.bpm = 120;
    this.voiceNodes = new Map();
    this.isPlaying = false;  // Add this explicitly
  }

  async initialize() {
    try {
      console.log(`Initializing SequencingUnit ${this.id}`);
      await super.initialize();
      return true;
    } catch (err) {
      console.error(`SequencingUnit ${this.id} initialization error:`, err);
      return false;
    }
  }

  setSequence(steps) {
    this.sequence = steps;
    this.updateSequencer();
  }

  updateSequencer() {
    if (!this.isPlaying || !this.sequence.length) {
      this.updateAudioNodes([]);
      return;
    }

    const ticksPerBeat = 4;
    const frequency = (this.tempo * ticksPerBeat) / 60;
    const clock = el.train(frequency);

    // Create sequencer nodes
    const sequencerNodes = this.sequence.map((step, i) => {
      if (!step.audioData) return null;
      
      const trigger = el.eq(
        el.counter(clock),
        el.const({ value: i })
      );

      return el.mul(
        el.mc.sample({
          channels: 1,
          path: `seq-${this.id}-${i}`,
          mode: 'trigger'
        }, trigger)[0],
        el.const({ value: step.velocity || 1 })
      );
    }).filter(Boolean);

    this.updateAudioNodes(sequencerNodes);
  }

  togglePlayback() {
    if (this.isPlaying) {
      this.stop();
    } else {
      this.play();
    }
  }

  play() {
    console.log('SequencingUnit play:', this.id);
    this.isPlaying = true;
    this.updateSequencer();
  }

  stop() {
    console.log('SequencingUnit stop:', this.id);
    this.isPlaying = false;
    this.updateSequencer();
  }

  setTempo(bpm) {
    this.tempo = bpm;
    this.updateSequencer();
  }

  // Add/remove sequence items
  toggleSequenceItem(cellData) {
    console.log('SequencingUnit.toggleSequenceItem called:', {
      unitId: this.id,
      cellData
    });

    const existingIndex = this.activeSequence.findIndex(item => 
      item.genomeId === cellData.genomeId
    );

    console.log('Toggle sequence state:', {
      unitId: this.id,
      cellData,
      existingIndex,
      currentSequenceLength: this.activeSequence.length
    });

    if (existingIndex >= 0) {
      // Remove item
      this.activeSequence.splice(existingIndex, 1);
    } else {
      // Add new item with default parameters
      this.activeSequence.push({
        ...cellData,
        offset: 0,           // Time offset within sequence
        durationScale: 1,    // Duration multiplier
        pitchShift: 0,      // Semitones
        stretch: 1,          // Time stretch factor
        step: this.activeSequence.length  // Position in sequence
      });
    }

    console.log('Sequence after toggle:', {
      unitId: this.id,
      sequenceLength: this.activeSequence.length,
      sequence: this.activeSequence
    });

    this.updateSequencer();
  }

  // Update sequence item parameters
  updateSequenceItem(genomeId, updates) {
    this.activeSequence = this.activeSequence.map(item => 
      item.genomeId === genomeId ? { ...item, ...updates } : item
    );
    this.updateSequencer();
  }

  // Remove sequence item
  removeSequenceItem(genomeId) {
    this.activeSequence = this.activeSequence.filter(item => 
      item.genomeId !== genomeId
    );
    this.updateSequencer();
  }

  getTimes() {
    if (this.activeSequence.length === 0) return [];

    const positions = [];
    let totalOffset = 0;
    
    // Sum all offsets (or use 1 as default offset)
    this.activeSequence.forEach(el => totalOffset += (el.offset || 1));
    
    // Calculate relative times
    let currentTime = 0;
    this.activeSequence.forEach(el => {
      const relativeTime = currentTime / totalOffset;
      positions.push(relativeTime);
      currentTime += (el.offset || 1);
    });

    return positions;
  }

  async createSequenceVoices() {
    const context = this.audioEngine.getContext();
    const renderer = this.audioEngine.getRenderer();

    if (!context || !renderer || !this.isPlaying || this.activeSequence.length === 0) {
      return [];
    }

    // Load all samples into VFS first
    for (const item of this.activeSequence) {
      const vfsKey = `seq-${this.id}-${item.genomeId}`;
      if (!this.audioDataCache.has(vfsKey)) {
        const response = await fetch(item.audioUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioData = await context.decodeAudioData(arrayBuffer);
        this.audioDataCache.set(vfsKey, audioData);
        
        const vfsUpdate = {};
        vfsUpdate[vfsKey] = audioData.getChannelData(0);
        await renderer.updateVirtualFileSystem(vfsUpdate);
      }
    }

    const sequenceDuration = (60 / this.bpm) * 4 * this.bars; // Duration in seconds
    const time = el.div(el.time(), el.sr()); // Current time in seconds
    const times = this.getTimes(); // Get evenly spaced positions

    // Create array of sample sequencers
    const voices = this.activeSequence.map((item, index) => {
      const vfsKey = `seq-${this.id}-${item.genomeId}`;
      const audioData = this.audioDataCache.get(vfsKey);
      if (!audioData) return null;

      // Calculate timing using the spacing algorithm from test-component.js
      const startTime = this.startOffset * sequenceDuration + 
                       times[index] * (1 - this.startOffset) * sequenceDuration;
      const duration = audioData.duration * item.durationScale;

      // Create trigger signal using sampleseq2
      try {
        return el.mul(
          el.sampleseq2({
            path: vfsKey,
            duration: duration,
            seq: [
              { time: startTime, value: 1 },
              { time: startTime + duration, value: 0 }
            ],
            shift: item.pitchShift,
            stretch: item.stretch
          }, 
          el.mod(time, el.const({ value: sequenceDuration }))
        ),
        el.const({ value: 1 / Math.max(1, this.activeSequence.length) })
        );
      } catch (error) {
        console.error('Failed to create sample sequencer:', error);
        return null;
      }
    }).filter(Boolean);

    console.log('Created sequence voices:', {
      unitId: this.id,
      voiceCount: voices.length,
      bpm: this.bpm,
      bars: this.bars,
      times,
      sequenceDuration
    });

    return voices;
  }

  async updateSequencer() {
    try {
      console.log('Updating sequencer:', {
        unitId: this.id,
        isPlaying: this.isPlaying,
        sequenceLength: this.activeSequence.length
      });

      const voices = await this.createSequenceVoices();
      console.log('Created voices:', {
        unitId: this.id,
        voiceCount: voices.length
      });
      
      this.updateAudioNodes(voices);
    } catch (err) {
      console.error('Error updating sequencer:', err);
      this.updateAudioNodes([]);
    }
  }

  setConfig(config) {
    Object.assign(this, config);
    this.updateSequencer();
  }

  updateConfig(config) {
    if (!config) return;
    Object.assign(this, config);
    this.updateSequencer();
  }

  cleanup() {
    this.stop();
    this.activeSequence = [];
    this.audioDataCache.clear();
    this.voiceNodes.clear();
    super.cleanup();
  }
}
