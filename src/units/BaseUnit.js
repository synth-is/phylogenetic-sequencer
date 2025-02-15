import AudioEngine from '../audio/AudioEngine';

export class BaseUnit {
  constructor(id, type) {
    this.id = id;
    this.type = type;
    this.active = true;
    this.muted = false;
    this.soloed = false;
    this.volume = -12;
    this.audioEngine = AudioEngine;
  }

  async initialize() {
    return this.audioEngine.initialize();
  }

  cleanup() {
    this.audioEngine.removeUnitNodes(this.id);
  }

  updateAudioNodes(nodes) {
    this.audioEngine.setUnitNodes(this.id, nodes, {
      volume: this.volume,
      active: this.active,
      soloed: this.soloed
    });
  }
}
