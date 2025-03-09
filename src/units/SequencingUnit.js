import {el} from '@elemaudio/core';
import { UNIT_TYPES } from '../constants';
import { BaseUnit } from './BaseUnit';
import SoundRenderer from '../utils/SoundRenderer';
import VoiceParameterRegistry from '../utils/VoiceParameterRegistry';
import { findTreeForGenome, getSequenceTreeStatistics } from '../utils/TreeUtils';

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

    // Evolution parameters
    this.grow = 0;
    this.shrink = 0;
    this.mutate = 0;
    this.probNewTree = 0;
    this.mutatePosition = 0; // Add new parameter for position offset mutation
    this.metaMutate = 0; // Add new parameter for meta-mutation probability
    this.groupProb = 0; // Add new parameter for grouping probability
    // Evolution state tracking new parameter for meta-mutation
    this.evolutionActive = false;
    this.lastEvolutionTime = 0;
    this.evolutionInterval = 1000; // Time in ms between evolution steps
    this.treeStatistics = null;
    this.evolutionInterval = 1000; // Time in ms between evolution steps
    this.treeStatistics = null;
    this.treeData = null; // Will store the most recent tree data
    this.evolutionHistory = []; // Keep track of evolution steps for debugging

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
        originalVelocity: cellData.originalVelocity || cellData.velocity || 1,
        // Flag to identify manually added items (for debugging)
        manuallyAdded: true
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
      
      // Check if we need to restart evolution after manually adding a voice
      if (this.activeSequence.length === 1 && (this.grow > 0 || this.shrink > 0 || this.mutate > 0)) {
        console.log('First item added to sequence, restarting evolution process');
        this.checkAndStartEvolution();
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
      
      // Start the evolution process if any evolution parameters are set
      this.checkAndStartEvolution();
      
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

  /**
   * Update config options for the unit
   */
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

    // Handle evolution parameter changes
    const evolutionParamsChanged = 
      (config.grow !== undefined && config.grow !== this.grow) ||
      (config.shrink !== undefined && config.shrink !== this.shrink) ||
      (config.mutate !== undefined && config.mutate !== this.mutate) ||
      (config.mutatePosition !== undefined && config.mutatePosition !== this.mutatePosition) ||
      (config.groupProb !== undefined && config.groupProb !== this.groupProb) ||
      (config.metaMutate !== undefined && config.metaMutate !== this.metaMutate) ||
      (config.probNewTree !== undefined && config.probNewTree !== this.probNewTree);
    
    // Apply all config changes first
    Object.assign(this, config);
    
    // Check and start evolution if needed - AFTER applying all changes
    if (evolutionParamsChanged) {
      this.checkAndStartEvolution();
    } else {
      // Only update sequencer if evolution params didn't change
      // (to avoid double updates since checkAndStartEvolution will call updateSequencer)
      this.updateSequencer();
    }
  }

  /**
   * Check and start the evolution process if any parameters are set
   */
  checkAndStartEvolution() {
    const shouldEvolve = this.grow > 0 || this.shrink > 0 || this.mutate > 0 || this.mutatePosition > 0 || this.metaMutate > 0;
    
    // Start evolution if it's not already running and parameters are set
    if (shouldEvolve && !this.evolutionActive) {
      // Remove the check for activeSequence.length > 0
      // The evolution should run regardless of sequence length
      console.log('Starting evolution process', {
        grow: this.grow,
        shrink: this.shrink,
        mutate: this.mutate,
        mutatePosition: this.mutatePosition,
        groupProb: this.groupProb,
        probNewTree: this.probNewTree,
        metaMutate: this.metaMutate,
        sequenceLength: this.activeSequence.length
      });
      
      // IMPORTANT: Make sure we have fresh tree info before starting evolution
      // This performs the same action as clicking "Update Tree Info" button
      if (window.phyloTreeData) {
        console.log('Automatically updating tree information before starting evolution');
        this.updateTreeInformation(window.phyloTreeData);
      } else {
        console.warn('No tree data available in window.phyloTreeData');
      }
      
      this.evolutionActive = true;
      this.startEvolution();
    } 
    // Stop evolution if it's running but parameters are all zero
    else if (!shouldEvolve && this.evolutionActive) {
      console.log('Stopping evolution process');
      this.evolutionActive = false;
    }
  }

  /**
   * Start the evolution process
   */
  startEvolution() {
    // Don't start if not active or already running
    if (!this.evolutionActive) return;
    
    // Calculate time to wait before next evolution based on sequence length and bars
    const sequenceDuration = (60 / this.bpm) * 4 * this.bars;
    this.evolutionInterval = sequenceDuration * 1000; // Convert to milliseconds
    
    console.log('Evolution interval set:', {
      bpm: this.bpm,
      bars: this.bars,
      sequenceDuration,
      evolutionInterval: this.evolutionInterval
    });
    
    // Set timeout for next evolution
    setTimeout(() => this.evolveSequence(), this.evolutionInterval);
  }

  /**
   * Evolve the sequence based on the set probabilities
   */
  evolveSequence() {
    // Don't evolve if not active
    if (!this.evolutionActive) return;
    
    // Record the current state before any changes
    const beforeState = {
      time: Date.now(),
      sequenceLength: this.activeSequence.length,
      parameters: {
        grow: this.grow,
        shrink: this.shrink,
        mutate: this.mutate, 
        mutatePosition: this.mutatePosition,
        probNewTree: this.probNewTree
      },
      itemsById: this.activeSequence.map(item => ({
        genomeId: item.genomeId,
        treeIndex: item.treeInfo?.treeIndex,
        step: item.step || 0,
        offset: item.offset || 0.5
      }))
    };
    
    // First, potentially mutate the probability parameters themselves
    // This happens on each evolution step, so parameters can change gradually over time
    // These updated parameters will be used immediately in the current evolution step
    if (this.metaMutate > 0) {
      console.log('Checking for meta-mutations with probability:', this.metaMutate);
      this.performMetaMutation();
    }
    
    console.log('Evolving sequence', {
      currentLength: this.activeSequence.length,
      grow: this.grow,
      shrink: this.shrink,
      mutate: this.mutate,
      mutatePosition: this.mutatePosition,
      probNewTree: this.probNewTree,
      metaMutate: this.metaMutate
    });
    
    // Only check for tree statistics if we're trying to grow
    // Skip this check for shrink-only operations on empty sequences
    if (!this.treeStatistics && !this.treeData && this.grow > 0) {
      console.warn('No tree data available for evolution');
      this.startEvolution(); // Schedule next evolution
      return;
    }

    // Special case: If sequence is empty but grow parameter is set, 
    // attempt to add a new node regardless of normal probability
    if (this.activeSequence.length === 0 && this.grow > 0) {
      console.log('Sequence is empty, forcing grow operation');
      this.performGrow(true); // Pass true to force growth regardless of probability
    } else {
      // Normal case: Apply operations in a more natural order
      
      // First perform position mutations - this only affects existing voices
      if (this.mutatePosition > 0 && this.activeSequence.length > 0) {
        this.performPositionMutation();
      }
      
      // Then shrink - this can potentially empty the sequence
      if (this.shrink > 0) {
        this.performShrink(); 
      }
      
      // Then mutate existing items
      if (this.mutate > 0 && this.activeSequence.length > 0) {
        this.performMutate();
      }
      
      // Finally grow
      if (this.grow > 0) {
        this.performGrow();
      }
    }
    
    // Record the result
    const afterState = {
      time: Date.now(),
      sequenceLength: this.activeSequence.length,
      parameters: {
        grow: this.grow,
        shrink: this.shrink,
        mutate: this.mutate,
        mutatePosition: this.mutatePosition,
        probNewTree: this.probNewTree
      },
      itemsById: this.activeSequence.map(item => ({
        genomeId: item.genomeId,
        treeIndex: item.treeInfo?.treeIndex,
        step: item.step || 0,
        offset: item.offset || 0.5
      }))
    };
    
    // Analyze position changes
    const positionChanges = [];
    if (beforeState.itemsById.length > 0 && afterState.itemsById.length > 0) {
      beforeState.itemsById.forEach((beforeItem) => {
        const afterItem = afterState.itemsById.find(i => i.genomeId === beforeItem.genomeId);
        if (afterItem && 
            (beforeItem.step !== afterItem.step || 
             Math.abs(beforeItem.offset - afterItem.offset) > 0.001)) {
          positionChanges.push({
            genomeId: beforeItem.genomeId,
            fromStep: beforeItem.step,
            toStep: afterItem.step,
            fromOffset: beforeItem.offset,
            toOffset: afterItem.offset
          });
        }
      });
    }
    
    // Track parameter changes for logging and debugging
    const parameterChanges = {};
    Object.keys(beforeState.parameters).forEach(param => {
      if (beforeState.parameters[param] !== afterState.parameters[param]) {
        parameterChanges[param] = {
          from: beforeState.parameters[param],
          to: afterState.parameters[param]
        };
      }
    });
    
    this.evolutionHistory.push({
      before: beforeState,
      after: afterState,
      changes: {
        added: afterState.sequenceLength - beforeState.sequenceLength,
        removed: Math.max(0, beforeState.sequenceLength - afterState.sequenceLength),
        unchanged: Math.min(beforeState.sequenceLength, afterState.sequenceLength),
        positionChanges, // Track position changes
        parameterChanges  // Track parameter changes from meta-mutation
      }
    });
    
    // Log significant changes
    if (Object.keys(parameterChanges).length > 0) {
      console.log('Parameter mutations occurred:', parameterChanges);
    }
    
    if (positionChanges.length > 0) {
      console.log('Position mutations occurred:', positionChanges);
    }
    
    // Update the UI and audio
    this.updateSequencer();
    
    // Schedule next evolution
    this.startEvolution();
  }

  /**
   * Perform position mutation for sequence items
   */
  performPositionMutation() {
    if (this.mutatePosition <= 0 || this.activeSequence.length <= 1) return;
    
    console.log('Performing position mutation with probability:', this.mutatePosition);
    
    // Track if any mutations occurred
    let mutationOccurred = false;
    
    // For each item, consider mutating its position
    this.activeSequence.forEach(item => {
      // Apply probability check for each item
      if (Math.random() > this.mutatePosition) return;
      
      // Mutate the offset (the position within the step)
      // We'll make small adjustments around the current position
      const currentOffset = item.offset || 0.5;
      
      // Generate a random adjustment between -0.15 and 0.15
      const offsetAdjustment = (Math.random() * 0.3) - 0.15;
      
      // Calculate new offset and clamp between 0 and 1
      const newOffset = Math.max(0, Math.min(1, currentOffset + offsetAdjustment));
      
      // Only apply if there's an actual change
      if (Math.abs(newOffset - currentOffset) > 0.01) {
        console.log(`Mutating position offset for ${item.genomeId}: ${currentOffset.toFixed(2)} -> ${newOffset.toFixed(2)}`);
        
        // Update the item's offset
        item.offset = newOffset;
        mutationOccurred = true;
      }
    });
    
    // After position mutations, update the UI if any changes were made
    if (mutationOccurred) {
      this.updateSequencer();
    }
  }

  /**
   * Perform grow operation - add new items to the sequence
   * @param {boolean} force - If true, bypass probability check
   */
  performGrow(force = false) {
    if (this.grow <= 0 || !this.treeData) return;
    
    // Determine if we should add a new item based on grow probability
    if (!force && Math.random() > this.grow) return;
    
    console.log('Performing grow operation', { force });
    
    // Get trees represented in the current sequence
    const currentTreeIndices = new Set();
    this.activeSequence.forEach(item => {
      if (item.treeInfo && item.treeInfo.treeIndex !== undefined) {
        currentTreeIndices.add(item.treeInfo.treeIndex);
      }
    });
    
    // Determine if we should select from a new tree
    const useNewTree = Math.random() < this.probNewTree;
    let targetTreeIndex;
    
    if (useNewTree && this.treeStatistics && this.treeStatistics.treeCount > currentTreeIndices.size) {
      // Select a tree that's not already represented
      const allTreeIndices = Array.from({ length: this.treeStatistics.treeCount }, (_, i) => i);
      const availableNewTrees = allTreeIndices.filter(idx => !currentTreeIndices.has(idx));
      
      if (availableNewTrees.length > 0) {
        targetTreeIndex = availableNewTrees[Math.floor(Math.random() * availableNewTrees.length)];
        console.log('Growing from new tree:', targetTreeIndex);
      } else {
        // Fall back to random existing tree if no new trees available
        targetTreeIndex = Array.from(currentTreeIndices)[Math.floor(Math.random() * currentTreeIndices.size)];
      }
    } else {
      // Handle empty sequence case
      if (currentTreeIndices.size === 0) {
        // Pick any random tree index
        const randomTreeIndex = Math.floor(Math.random() * (this.treeStatistics?.treeCount || 1));
        targetTreeIndex = randomTreeIndex;
        console.log('No existing trees, selecting random tree:', targetTreeIndex);
      } else {
        // Use an existing tree
        const treeIndicesArray = Array.from(currentTreeIndices);
        targetTreeIndex = treeIndicesArray[Math.floor(Math.random() * treeIndicesArray.length)];
      }
    }
    
    // Find a nearby node in the tree to add
    this.addNodeFromTree(targetTreeIndex);
  }

  /**
   * Perform shrink operation - remove items from the sequence
   */
  performShrink() {
    if (this.shrink <= 0 || this.activeSequence.length === 0) return;
    
    // Determine if we should remove an item based on shrink probability
    if (Math.random() > this.shrink) return;
    
    console.log('Performing shrink operation');
    
    // Randomly select an item to remove
    const indexToRemove = Math.floor(Math.random() * this.activeSequence.length);
    const itemToRemove = this.activeSequence[indexToRemove];
    
    // Remove the item
    if (itemToRemove && itemToRemove.genomeId) {
      this.removeSequenceItem(itemToRemove.genomeId);
      console.log(`Removed item ${itemToRemove.genomeId} from sequence`);
    }

    // If this was the last item and we still have grow > 0, force a grow operation
    if (this.activeSequence.length === 0 && this.grow > 0) {
      console.log('Sequence is empty after shrink, forcing grow operation');
      setTimeout(() => this.performGrow(true), 1000); // Add delay before growing to avoid flicker
    }
  }

  /**
   * Perform mutate operation - change an existing item in the sequence
   */
  performMutate() {
    if (this.mutate <= 0 || this.activeSequence.length === 0) return;
    
    // Determine if we should mutate based on probability
    if (Math.random() > this.mutate) return;
    
    console.log('Performing mutate operation');
    
    // Randomly select an item to mutate
    const indexToMutate = Math.floor(Math.random() * this.activeSequence.length);
    const itemToMutate = this.activeSequence[indexToMutate];
    
    if (!itemToMutate || !itemToMutate.treeInfo || itemToMutate.treeInfo.treeIndex === undefined) {
      console.warn('Cannot mutate item without tree info');
      return;
    }
    
    // Remove the item
    if (itemToMutate && itemToMutate.genomeId) {
      this.removeSequenceItem(itemToMutate.genomeId);
      
      // Add a new one from the same tree (or possibly a new tree)
      const useNewTree = Math.random() < this.probNewTree;
      let targetTreeIndex = itemToMutate.treeInfo.treeIndex;
      
      if (useNewTree && this.treeStatistics && this.treeStatistics.treeCount > 1) {
        // Pick a different tree
        const otherTreeIndices = Array.from(
          { length: this.treeStatistics.treeCount }, 
          (_, i) => i
        ).filter(idx => idx !== targetTreeIndex);
        
        if (otherTreeIndices.length > 0) {
          targetTreeIndex = otherTreeIndices[Math.floor(Math.random() * otherTreeIndices.length)];
          console.log(`Mutating from tree ${itemToMutate.treeInfo.treeIndex} to ${targetTreeIndex}`);
        }
      }
      
      // Add a new node from the selected tree
      this.addNodeFromTree(targetTreeIndex);
    }
  }

  /**
   * Add a node from a specified tree
   */
  addNodeFromTree(treeIndex) {
    if (!this.treeData) {
      console.warn('No tree data available for adding nodes');
      return;
    }
    
    // This approach works for D3 hierarchy structure common in PhylogeneticViewer
    try {
      if (this.treeData.name === 'root' && Array.isArray(this.treeData.children)) {
        // Find the tree at the specified index
        const targetTree = this.treeData.children[treeIndex];
        if (!targetTree) {
          console.warn(`No tree found at index ${treeIndex}`);
          return;
        }
        
        // Find all leaf nodes in this tree
        const leafNodes = this.findLeafNodes(targetTree);
        if (leafNodes.length === 0) {
          console.warn(`No leaf nodes found in tree ${treeIndex}`);
          return;
        }
        
        // Select a random leaf node
        const randomNode = leafNodes[Math.floor(Math.random() * leafNodes.length)];
        console.log('------------ Selected random node from tree:', randomNode);
        
        // Determine the appropriate experiment and evoRunId to use
        // First, check if we have existing items in the sequence with this information
        let experimentToUse = null;
        let evoRunIdToUse = null;
        
        // Look for an existing sequence item with valid experiment data
        const itemWithValidData = this.activeSequence.find(item => 
          item.experiment && item.experiment !== 'evolution' && 
          item.evoRunId && !item.evoRunId.startsWith('evolution-')
        );
        
        if (itemWithValidData) {
          // Use existing item's data as template
          experimentToUse = itemWithValidData.experiment;
          evoRunIdToUse = itemWithValidData.evoRunId;
          console.log('Using experiment data from existing sequence item:', {
            experiment: experimentToUse,
            evoRunId: evoRunIdToUse
          });
        } else {
          // Try to extract from window context or global variables
          if (window.phyloExperiment && window.phyloEvoRunId) {
            experimentToUse = window.phyloExperiment;
            evoRunIdToUse = window.phyloEvoRunId;
            console.log('Using experiment data from window globals:', {
              experiment: experimentToUse,
              evoRunId: evoRunIdToUse
            });
          } else if (window.phyloTreeData) {
            // Some implementations store this in the tree data
            if (window.phyloTreeData.experiment) {
              experimentToUse = window.phyloTreeData.experiment;
            }
            if (window.phyloTreeData.evoRunId) {
              evoRunIdToUse = window.phyloTreeData.evoRunId;
            }
            
            // If we found data, log it
            if (experimentToUse || evoRunIdToUse) {
              console.log('Using experiment data from tree data:', {
                experiment: experimentToUse,
                evoRunId: evoRunIdToUse
              });
            }
          }
          
          // Check if treeData itself has experiment info
          if (!experimentToUse && this.treeData.experiment) {
            experimentToUse = this.treeData.experiment;
          }
          if (!evoRunIdToUse && this.treeData.evoRunId) {
            evoRunIdToUse = this.treeData.evoRunId;
          }
        }
        
        // FINAL FALLBACKS - Only use these if absolutely necessary
        if (!experimentToUse) {
          experimentToUse = 'unknown';
          console.warn('No experiment ID found, using "unknown"');
        }
        
        if (!evoRunIdToUse) {
          // Rather than using the current date, use a consistent identifier related to the tree
          evoRunIdToUse = `unknown_${this.treeData.id || 'tree'}`;
          console.warn(`No evolution run ID found, using "${evoRunIdToUse}"`);
        }
        
        // Create a cell data object for this node
        const cellData = {
          genomeId: randomNode.id || randomNode.name,
          name: randomNode.name,
          duration: 4, // Default values
          noteDelta: 0,
          velocity: 1,
          experiment: experimentToUse,
          evoRunId: evoRunIdToUse
        };
        
        console.log(`Adding node to sequence from tree ${treeIndex}:`, cellData);
        
        // Add to sequence
        this.toggleSequenceItem(cellData);
        
        // After adding, immediately update its tree info
        const addedItemIndex = this.activeSequence.findIndex(item => item.genomeId === cellData.genomeId);
        if (addedItemIndex >= 0) {
          this.activeSequence[addedItemIndex].treeInfo = {
            treeIndex: treeIndex,
            treeId: targetTree.name || `tree_${treeIndex}`,
            path: randomNode.path || ''
          };
        }
      } else {
        console.warn('Tree data structure not supported for evolution');
      }
    } catch (error) {
      console.error('Error adding node from tree:', error);
    }
  }

  /**
   * Find all leaf nodes in a tree
   */
  findLeafNodes(node, path = '', result = []) {
    if (!node) return result;
    
    // If node has no children, it's a leaf
    if (!node.children || node.children.length === 0) {
      // Only add if it has an ID or name
      if (node.id || node.name) {
        result.push({
          ...node,
          path
        });
      }
      return result;
    }
    
    // Otherwise, recursively check all children
    if (Array.isArray(node.children)) {
      node.children.forEach((child, index) => {
        const childPath = path ? `${path}/${index}` : `/${index}`;
        this.findLeafNodes(child, childPath, result);
      });
    }
    
    return result;
  }

  /**
   * Update tree information for all sequence items
   * @param {Object} treeData - The phylogenetic tree data
   * @returns {Object} - Statistics about the trees represented in the sequence
   */
  updateTreeInformation(treeData) {
    // Store the tree data for evolution
    this.treeData = treeData;
    
    // Also store experiment data if available
    if (treeData && treeData.experiment) {
      window.phyloExperiment = treeData.experiment;
      window.phyloEvoRunId = treeData.evoRunId;
    }
    
    // Store a reference to the tree data in the window scope
    // This will help with automatic recovery if needed
    if (!window.phyloTreeData && treeData) {
      window.phyloTreeData = treeData;
      console.log('Stored tree data in window.phyloTreeData for future reference');
    }
    
    if (!treeData) {
      return {
        treeCount: 0,
        itemsByTree: {},
        treesRepresented: 0
      };
    }
    
    console.log('Updating tree information with tree data:', { 
      hasTreesArray: Array.isArray(treeData.trees),
      hasNodes: Array.isArray(treeData.nodes),
      nodeCount: treeData.nodes?.length, 
      edgeCount: treeData.edges?.length,
      rootNodesCount: treeData.rootNodes?.length,
      sequenceLength: this.activeSequence.length,
      firstGenomeId: this.activeSequence[0]?.genomeId
    });
    
    // Use TreeUtils to analyze tree structure - make sure to import it dynamically
    import('../utils/TreeUtils').then(module => {
      if (module.logTreeStructure) {
        module.logTreeStructure(treeData);
      }
    });
    
    // Use the full getSequenceTreeStatistics function from TreeUtils
    import('../utils/TreeUtils').then(module => {
      if (module.getSequenceTreeStatistics) {
        const stats = module.getSequenceTreeStatistics(this.activeSequence, treeData);
        this.treeStatistics = stats;
        
        // Update treeInfo for each sequence item based on the found trees
        Object.entries(stats.itemsByTree).forEach(([treeKey, items]) => {
          if (treeKey === 'unknown') return;
          
          const treeIndex = parseInt(treeKey.replace('tree_', ''));
          
          items.forEach(treeItem => {
            const sequenceItem = this.activeSequence.find(item => 
              item.genomeId === treeItem.genomeId
            );
            
            if (sequenceItem) {
              sequenceItem.treeInfo = {
                treeIndex,
                treeId: treeItem.treeId,
                path: treeItem.path
              };
            }
          });
        });
        
        console.log('Sequence tree statistics updated:', stats);
        
        // Check if we should start evolution now that we have tree data
        this.checkAndStartEvolution();
      }
    }).catch(err => {
      console.error('Error importing TreeUtils:', err);
      this.processTreeInfoManually(treeData);
    });
    
    // Process directly as a fallback
    this.processTreeInfoManually(treeData);
    
    return this.treeStatistics;
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

  /**
   * Process tree information manually as a fallback
   * @param {Object} treeData - The phylogenetic tree data
   */
  processTreeInfoManually(treeData) {
    const itemsByTree = {};
    const treeIndices = new Set();
    
    // Use cached tree count from findTreeForGenome if available
    let treeCount = window._treeUtilsCache?.identifiedTreesCount || 0;
    
    if (treeCount === 0) {
      // Count trees based on structure
      if (treeData.name === 'root' && Array.isArray(treeData.children)) {
        treeCount = treeData.children.length;
      } else if (Array.isArray(treeData.trees)) {
        treeCount = treeData.trees.length;
      } else if (Array.isArray(treeData.rootNodes)) {
        treeCount = treeData.rootNodes.length;
      } else {
        treeCount = 1;
      }
    }
    
    // Process each sequence item
    this.activeSequence.forEach((item, index) => {
      if (!item.genomeId) return;
      
      // If we already have treeInfo for this item, use it
      if (item.treeInfo) {
        const treeKey = `tree_${item.treeInfo.treeIndex}`;
        if (!itemsByTree[treeKey]) {
          itemsByTree[treeKey] = [];
          treeIndices.add(item.treeInfo.treeIndex);
        }
        
        itemsByTree[treeKey].push({
          index,
          genomeId: item.genomeId,
          treeIndex: item.treeInfo.treeIndex,
          treeId: item.treeInfo.treeId
        });
      } else {
        // For items without tree info
        if (!itemsByTree['unknown']) {
          itemsByTree['unknown'] = [];
        }
        itemsByTree['unknown'].push({ index, genomeId: item.genomeId });
      }
    });
    
    // Store the statistics in the unit
    this.treeStatistics = {
      treeCount,
      itemsByTree,
      treesRepresented: treeIndices.size,
      treeIndices: Array.from(treeIndices)
    };
    
    console.log('Sequence tree statistics (manual):', this.treeStatistics);
  }

  /**
   * Get current tree statistics for the sequence
   * @returns {Object} - The tree statistics object
   */
  getTreeStatistics() {
    return this.treeStatistics || {
      treeCount: 0,
      itemsByTree: {},
      treesRepresented: 0,
      treeIndices: []
    };
  }

  /**
   * Print tree information for debugging
   */
  debugPrintTreeInfo() {
    if (!this.activeSequence.length) {
      console.log('SequencingUnit: No voices in sequence');
      return;
    }
    
    console.log(`SequencingUnit ${this.id}: Tree information for ${this.activeSequence.length} voices`);
    
    this.activeSequence.forEach((item, index) => {
      if (item.treeInfo) {
        console.log(`Voice ${index + 1}: Genome ${item.genomeId.slice(-8)}, Tree ${item.treeInfo.treeIndex + 1} (ID: ${item.treeInfo.treeId})`);
      } else {
        console.log(`Voice ${index + 1}: Genome ${item.genomeId.slice(-8)}, Tree: Unknown`);
      }
    });
    
    // Print summary statistics
    if (this.treeStatistics) {
      console.log(`Tree Statistics: ${this.treeStatistics.treesRepresented} trees represented out of ${this.treeStatistics.treeCount} total trees`);
      
      Object.entries(this.treeStatistics.itemsByTree).forEach(([treeKey, items]) => {
        console.log(`${treeKey}: ${items.length} voices`);
      });
    }
  }

  /**
   * Register a config change callback to notify when parameter values change
   * through meta-mutation
   * @param {Function} callback - The function to call when config changes
   */
  onConfigChange(callback) {
    this.configChangeCallback = callback;
  }

  /**
   * Perform meta-mutation on probability parameters
   */
  performMetaMutation() {
    if (this.metaMutate <= 0) return;
    
    // Define the parameters that can be mutated
    const mutableParams = ['grow', 'shrink', 'mutate', 'mutatePosition', 'probNewTree'];
    
    // Flag to track if any mutations occurred
    let mutationOccurred = false;
    const updatedConfig = {};
    
    // Consider each parameter with equal probability
    mutableParams.forEach(param => {
      // Each parameter has a chance to mutate based on metaMutate value
      if (Math.random() < this.metaMutate) {
        const currentValue = this[param];
        
        // Different mutation strategies based on current value to prevent getting stuck
        let newValue;
        
        // For very small values (close to 0), occasionally make larger jumps 
        // to prevent getting stuck at 0
        if (currentValue < 0.05) {
          // Higher chance (40%) of making a significant positive jump when value is near zero
          if (Math.random() < 0.4) {
            // Jump to a random value between 0.05 and 0.2
            newValue = 0.05 + Math.random() * 0.15;
            console.log(`Meta-mutation ${param}: boosting from near-zero ${currentValue.toFixed(2)} to ${newValue.toFixed(2)}`);
          } else {
            // Small random adjustment with a bias towards increase
            const adjustment = (Math.random() * 0.08) - 0.02; // -0.02 to +0.08
            newValue = Math.max(0, Math.min(1, currentValue + adjustment));
          }
        } 
        // For values near 1, occasionally make larger negative jumps
        else if (currentValue > 0.95) {
          // Higher chance (40%) of making a significant negative jump when value is near one
          if (Math.random() < 0.4) {
            // Jump to a random value between 0.8 and 0.95
            newValue = 0.8 + Math.random() * 0.15;
            console.log(`Meta-mutation ${param}: reducing from near-one ${currentValue.toFixed(2)} to ${newValue.toFixed(2)}`);
          } else {
            // Small random adjustment with a bias towards decrease
            const adjustment = (Math.random() * 0.08) - 0.06; // -0.06 to +0.02
            newValue = Math.max(0, Math.min(1, currentValue + adjustment));
          }
        }
        // For mid-range values, use more balanced mutations
        else {
          // Calculate adjustment scale - larger for mid-range values for more movement
          const adjustmentScale = Math.max(0.05, currentValue * 0.3);
          
          // Random adjustment between -adjustmentScale and +adjustmentScale
          const adjustment = (Math.random() * 2 - 1) * adjustmentScale;
          newValue = Math.max(0, Math.min(1, currentValue + adjustment));
          
          // 10% chance of making larger jumps to prevent getting stuck in local patterns
          if (Math.random() < 0.1) {
            // Equal chance of jumping higher or lower
            if (Math.random() < 0.5) {
              newValue = Math.min(1, currentValue + Math.random() * 0.3);
            } else {
              newValue = Math.max(0, currentValue - Math.random() * 0.3);
            }
          }
        }
        
        // Only apply if there's an actual change beyond a minimum threshold
        if (Math.abs(newValue - currentValue) > 0.01) {
          console.log(`Meta-mutation: ${param} changed from ${currentValue.toFixed(2)} to ${newValue.toFixed(2)}`);
          
          // Update the parameter immediately for use in this evolution step
          this[param] = newValue;
          updatedConfig[param] = newValue;
          mutationOccurred = true;
        }
      }
    });
    
    // If mutations occurred, notify UI of the changes
    if (mutationOccurred && this.configChangeCallback) {
      try {
        // This callback should update the UI sliders
        this.configChangeCallback(updatedConfig);
        console.log('Meta-mutation changes sent to UI:', updatedConfig);
      } catch (e) {
        console.error('Error in config change callback:', e);
      }
    }
    
    return mutationOccurred;
  }
}
