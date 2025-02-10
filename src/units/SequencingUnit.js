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

  play() {
    this.isPlaying = true;
    this.updateSequencer();
  }

  stop() {
    this.isPlaying = false;
    this.updateSequencer();
  }

  setTempo(bpm) {
    this.tempo = bpm;
    this.updateSequencer();
  }
}
