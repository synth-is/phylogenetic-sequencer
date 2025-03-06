import {el} from '@elemaudio/core';
import { UNIT_TYPES } from '../constants';
import { BaseUnit } from './BaseUnit';
import SoundRenderer from '../utils/SoundRenderer';
import VoiceParameterRegistry from '../utils/VoiceParameterRegistry';

export class SequencingUnit extends BaseUnit {
  constructor(id) {
    super(id, UNIT_TYPES.SEQUENCING);
    this.sequence = [];
    this.tempo = 120;
    this.isPlaying = true;  // Change default to true
    this.currentStep = 0;
    this.audioDataCache = new Map(); // Will store metadata instead of full buffers
    this.audioBufferSources = new Map(); // To track sources by ID
    
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

    // No need to re-declare renderingItems and renderCallbacks
    // as they're now in BaseUnit as renderingVoices and renderCallbacks
  }

  async initialize() {
    try {
      console.log(`Initializing SequencingUnit ${this.id}`);
      await super.initialize();
      
      // Register for parameter updates
      VoiceParameterRegistry.registerRenderParamListener(this.id.toString(), 
        (voiceId, genomeId, params) => this.handleVoiceParamUpdate(voiceId, genomeId, params));
      
      return true;
    } catch (err) {
      console.error(`SequencingUnit ${this.id} initialization error:`, err);
      return false;
    }
  }

  // Handle parameter updates for voices
  handleVoiceParamUpdate(voiceId, genomeId, params) {
    console.log(`SequencingUnit ${this.id}: Voice param update for ${voiceId}`, params);
    
    // Find sequence items matching this genome and update them
    const itemsToUpdate = this.activeSequence.filter(item => item.genomeId === genomeId);
    
    itemsToUpdate.forEach(item => {
      this.updateSequenceItem(genomeId, {
        duration: params.duration,
        pitch: params.pitch, 
        velocity: params.velocity
      });
    });
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
      const removedItem = this.activeSequence[existingIndex];
      
      // Remove from registry when removing from sequence
      VoiceParameterRegistry.removeVoice(`seq-${this.id}-${removedItem.genomeId}`);
      
      this.activeSequence.splice(existingIndex, 1);
    } else {
      // Add new item with original values preserved
      const existingOffset = this.selectedTimestep !== null ? 
        this.selectedTimestep : 
        this.activeSequence.length > 0 ? 
          Math.max(...this.activeSequence.map(item => item.step || 0)) + 1 : 
          0;

      // For first item, ensure no timestep is selected
      if (this.activeSequence.length === 0) {
        this.selectedTimestep = null;
      }

      // Add to sequence
      this.activeSequence.push({
        ...cellData,
        step: existingOffset,     // Use step for group position
        offset: 0.5,              // Set default offset to 0.5 (neutral position)
        durationScale: 1,
        pitchShift: 0,
        stretch: 1,
        // Make sure we keep track of original values
        originalDuration: cellData.originalDuration || cellData.duration || 4,
        originalPitch: cellData.originalPitch || cellData.noteDelta || 0,
        originalVelocity: cellData.originalVelocity || cellData.velocity || 1
      });

      // Register with parameter registry
      VoiceParameterRegistry.registerVoice(
        `seq-${this.id}-${cellData.genomeId}`,
        cellData.genomeId,
        {
          duration: cellData.duration || 4,
          pitch: cellData.noteDelta || 0,
          velocity: cellData.velocity || 1
        },
        `sequence-${this.id}`
      );

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
    // Check if this is a render parameter update
    const isRenderUpdate = updates.duration !== undefined || 
                           updates.pitch !== undefined ||
                           updates.velocity !== undefined;
    
    // Find the item to update
    const item = this.activeSequence.find(item => item.genomeId === genomeId);
    
    if (item && isRenderUpdate) {
      // Prepare render parameters
      const renderParams = {
        duration: updates.duration !== undefined ? updates.duration : 
                 item.duration !== undefined ? item.duration : 4,
        pitch: updates.pitch !== undefined ? updates.pitch : 
              item.pitch !== undefined ? item.pitch : 0,
        velocity: updates.velocity !== undefined ? updates.velocity : 
                item.velocity !== undefined ? item.velocity : 1
      };
      
      // Use the shared implementation with a custom vfs key prefix for sequences
      this.renderSound(
        {
          genomeId,
          experiment: item.experiment || 'unknown',
          evoRunId: item.evoRunId || 'unknown' 
        }, 
        renderParams,
        { vfsKeyPrefix: `seq-${this.id}-` }
      );
    }
    
    // Continue with the regular update
    this.activeSequence = this.activeSequence.map(item => {
      if (item.genomeId === genomeId) {
        let newUpdates = { ...updates };

        // Handle shift parameter directly
        if (updates.shift !== undefined) {
          newUpdates.pitchShift = updates.shift;
        }

        return { ...item, ...newUpdates };
      }
      return item;
    });
    
    this.updateSequencer();
  }

  // Add renderSound method that uses the base implementation
  async renderSound(soundData, renderParams, options = {}) {
    // Add sequence-specific options here
    const sequenceOptions = {
      ...options,
      vfsKeyPrefix: options.vfsKeyPrefix || `seq-${this.id}-`
    };
    return super.renderSound(soundData, renderParams, sequenceOptions);
  }

  // Remove sequence item
  removeSequenceItem(genomeId) {
    // Remove from registry
    VoiceParameterRegistry.removeVoice(`seq-${this.id}-${genomeId}`);
    
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

    // Load all samples into VFS first using unified renderSound method
    for (const item of this.activeSequence) {
      const vfsKey = `seq-${this.id}-${item.genomeId}`;
      
      if (!this.audioDataCache.has(vfsKey)) {
        try {
          // Use the unified renderSound method
          const result = await this.renderSound(
            {
              genomeId: item.genomeId,
              experiment: item.experiment || 'unknown',
              evoRunId: item.evoRunId || 'unknown'
            },
            {
              duration: item.duration || 4,
              pitch: item.noteDelta || 0,
              velocity: item.velocity || 1
            },
            { vfsKeyPrefix: `seq-${this.id}-` }
          );
          
          if (result && result.metadata) {
            // Store just the metadata
            this.audioDataCache.set(vfsKey, result.metadata);
          }
        } catch (error) {
          console.error(`Failed to load audio for sequence item: ${error.message}`);
        }
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
    
    // Use square root scaling like other units
    const voiceGain = 1 / Math.sqrt(Math.max(1, totalVoices));

    // Create voices for each group
    const voices = [];
    steps.forEach((step, stepIndex) => {
      const items = groupedItems.get(step);
      const baseTime = this.startOffset * sequenceDuration + 
                      (stepIndex * stepSpacing) * (1 - this.startOffset) * sequenceDuration;

      items.forEach((item, itemIndex) => {
        const vfsKey = `seq-${this.id}-${item.genomeId}`;
        const audioMetadata = this.audioDataCache.get(vfsKey);
        if (!audioMetadata) return;

        const relativeOffset = (item.offset - 0.5) * stepSpacing * sequenceDuration;
        const startTime = baseTime + relativeOffset;
        const duration = audioMetadata.duration * item.durationScale;

        try {
          const voice = el.mul(
            el.sampleseq2({
              key: `player-${this.id}-${step}-${itemIndex}`,
              path: vfsKey,
              duration: duration,
              seq: [
                { time: startTime, value: 1 },
                { time: startTime + duration, value: 0 }
              ],
              shift: item.pitchShift || this.pitch, // Only use shift parameter
              stretch: item.stretch
            }, 
            el.mod(
              time, 
              el.const({ 
                key: `duration-${this.id}-${step}-${itemIndex}`,
                value: sequenceDuration 
              })
            )
          ),
          el.const({ 
            key: `gain-${this.id}-${step}-${itemIndex}`,
            value: voiceGain  // Use the square root scaled gain
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
      this.updateSequencer();
      return;
    }

    // Handle pitch changes for all sequence items
    if (config.pitch !== undefined && config.pitch !== this.pitch) {
      this.pitch = config.pitch;
      
      // Update all sequence items with new shift/pitch value
      this.activeSequence = this.activeSequence.map(item => ({
        ...item,
        shift: this.pitch,      // Add this line
        pitchShift: this.pitch  // Keep this for compatibility
      }));
    }

    // Handle other config changes
    Object.assign(this, config);
    this.updateSequencer();
  }

  cleanup() {
    // Remove parameter listener
    VoiceParameterRegistry.removeRenderParamListener(this.id.toString());
    
    this.stop();
    this.activeSequence = [];
    this.audioDataCache.clear();
    this.audioBufferSources.clear();
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

  // Update compatibility methods to align with BaseUnit methods
  notifyRenderStateChange() {
    super.notifyRenderStateChange();
  }
  
  // The renderingItems Map is now redundant, use renderingVoices from BaseUnit
  isRendering(genomeId) {
    return super.isRendering(genomeId);
  }
  
  // Remove the original renderSound method since we're using the base implementation
  // Remove duplicate addRenderStateCallback and removeRenderStateCallback methods
}
