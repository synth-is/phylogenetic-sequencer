import {el} from '@elemaudio/core';
import { UNIT_TYPES } from '../constants';
import { BaseUnit } from './BaseUnit';

export class SequencingUnit extends BaseUnit {
  constructor(id) {
    super(id, UNIT_TYPES.SEQUENCING);
    this.sequence = [];
    this.tempo = 120;
    this.isPlaying = true;  // Change default to true
    this.currentStep = 0;
    this.audioDataCache = new Map();
    
    // Add new properties for sequencing
    this.activeSequence = [];
    this.isRecording = false;
    this.bars = 4;
    this.startOffset = 0;
    this.bpm = 120;
    this.voiceNodes = new Map();
    this.isPlaying = true;  // Change default to true
    this.selectedTimestep = null; // Add this line
    this.pitch = 0;
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
      cellData,
      selectedTimestep: this.selectedTimestep
    });

    const existingIndex = this.activeSequence.findIndex(item => 
      item.genomeId === cellData.genomeId
    );

    if (existingIndex >= 0) {
      // Remove item
      this.activeSequence.splice(existingIndex, 1);
    } else {
      // Add new item
      const existingOffset = this.selectedTimestep !== null ? 
        this.selectedTimestep : 
        this.activeSequence.length > 0 ? 
          Math.max(...this.activeSequence.map(item => item.step || 0)) + 1 : 
          0;

      // For first item, ensure no timestep is selected
      if (this.activeSequence.length === 0) {
        this.selectedTimestep = null;
      }

      this.activeSequence.push({
        ...cellData,
        step: existingOffset,     // Use step for group position
        offset: 0.5,              // Set default offset to 0.5 (neutral position)
        durationScale: 1,
        pitchShift: 0,
        stretch: 1
      });

      // Start playing if this is the first item added
      if (!this.isPlaying && this.activeSequence.length === 1) {
        this.play();
      }

      console.log('Added new item to sequence:', {
        genomeId: cellData.genomeId,
        offset: existingOffset,
        selectedTimestep: this.selectedTimestep,
        groupSize: this.activeSequence.filter(item => item.offset === existingOffset).length
      });
    }

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

    const sequenceDuration = (60 / this.bpm) * 4 * this.bars;
    const time = el.div(el.time(), el.sr());
    
    // Group items by step position
    const groupedItems = new Map();
    this.activeSequence.forEach(item => {
      const step = item.step || 0;
      if (!groupedItems.has(step)) {
        groupedItems.set(step, []);
      }
      groupedItems.get(step).push(item);
    });

    const steps = Array.from(groupedItems.keys()).sort((a, b) => a - b);
    const stepSpacing = 1 / Math.max(1, steps.length);
    
    // Calculate total number of voices for global gain normalization
    const totalVoices = Array.from(groupedItems.values())
      .reduce((sum, items) => sum + items.length, 0);
    
    // Create voices for each group
    const voices = [];
    steps.forEach((step, stepIndex) => {
      const items = groupedItems.get(step);
      const baseTime = this.startOffset * sequenceDuration + 
                      (stepIndex * stepSpacing) * (1 - this.startOffset) * sequenceDuration;

      items.forEach((item, itemIndex) => {
        const vfsKey = `seq-${this.id}-${item.genomeId}`;
        const audioData = this.audioDataCache.get(vfsKey);
        if (!audioData) return;

        const relativeOffset = (item.offset - 0.5) * stepSpacing * sequenceDuration;
        const startTime = baseTime + relativeOffset;
        const duration = audioData.duration * item.durationScale;

        try {
          // Create voice with proper gain normalization and unique keys
          const voice = el.mul(
            el.sampleseq2({
              key: `player-${this.id}-${step}-${itemIndex}`, // Add unique key for player
              path: vfsKey,
              duration: duration,
              seq: [
                { time: startTime, value: 1 },
                { time: startTime + duration, value: 0 }
              ],
              shift: item.pitchShift,
              stretch: item.stretch
            }, 
            el.mod(
              time, 
              el.const({ 
                key: `duration-${this.id}-${step}-${itemIndex}`, // Add unique key for duration
                value: sequenceDuration 
              })
            )
          ),
          el.const({ 
            key: `gain-${this.id}-${step}-${itemIndex}`, // Add unique key for gain
            value: 1 / Math.max(1, totalVoices) 
          })
          );
          voices.push(voice);
        } catch (error) {
          console.error('Failed to create sample sequencer:', error);
        }
      });
    });

    console.log('Created sequence voices:', {
      unitId: this.id,
      voiceCount: voices.length,
      groupCount: groupedItems.size,
      groups: Array.from(groupedItems.entries()).map(([offset, items]) => ({
        offset,
        itemCount: items.length
      }))
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
    // Handle state changes that need immediate audio update
    if (config.active !== undefined && config.active !== this.active) {
      this.active = config.active;
      this.updateSequencer();
    }
    if (config.soloed !== undefined && config.soloed !== this.soloed) {
      this.soloed = config.soloed;
      // Just update mixing without affecting element settings
      this.updateSequencer();
      return; // Exit early to prevent pitch/other updates
    }

    // Only update sequence item pitches when explicitly changing unit pitch
    if (config.pitch !== undefined && config.pitch !== this.pitch) {
      this.pitch = config.pitch;
      this.activeSequence.forEach(item => {
        item.pitchShift = config.pitch;
      });
    }

    // Handle other config changes
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

  // Add method to get groups with step-based offsets
  getGroupedSequence() {
    const groups = new Map();
    this.activeSequence.forEach(item => {
      const step = item.step || 0;
      if (!groups.has(step)) {
        groups.set(step, []);
      }
      groups.get(step).push(item);
    });

    return Array.from(groups.entries()).map(([step, items]) => ({
      offset: step,
      items,
      isSelected: step === this.selectedTimestep
    })).sort((a, b) => a.offset - b.offset);
  }

  // Add method to select a timestep
  selectTimestep(offset) {
    this.selectedTimestep = this.selectedTimestep === offset ? null : offset;
    return this.selectedTimestep;
  }
}
