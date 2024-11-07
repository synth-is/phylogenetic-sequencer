class AudioManager {
  constructor() {
    this.context = null;
    this.maxVoices = 4; // Number of simultaneous sounds
    this.voices = new Map(); // Map voice ID to voice data
    this.convolverNode = null;
    this.dryGainNode = null;
    this.wetGainNode = null;
    this.masterGainNode = null;
  }

  async initialize() {
    if (this.context) return;

    this.context = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGainNode = this.context.createGain();
    this.masterGainNode.connect(this.context.destination);

    // Setup reverb chain
    this.convolverNode = this.context.createConvolver();
    this.dryGainNode = this.context.createGain();
    this.wetGainNode = this.context.createGain();

    this.dryGainNode.connect(this.masterGainNode);
    this.convolverNode.connect(this.wetGainNode);
    this.wetGainNode.connect(this.masterGainNode);

    // Load reverb impulse response
    try {
      const response = await fetch('/WIDEHALL-1.wav');
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
      this.convolverNode.buffer = audioBuffer;
    } catch (error) {
      console.error('Error loading reverb:', error);
    }
  }

  setReverbMix(wetAmount) {
    if (!this.context) return;
    
    const wet = wetAmount / 100;
    const dry = 1 - wet;
    
    this.wetGainNode.gain.setTargetAtTime(wet, this.context.currentTime, 0.1);
    this.dryGainNode.gain.setTargetAtTime(dry, this.context.currentTime, 0.1);
  }

  async playSound(url, cellIndices) {
    if (!this.context) await this.initialize();

    // Check if this sound is already playing
    const existingVoice = Array.from(this.voices.values())
      .find(voice => voice.url === url && !voice.isReleasing);
    
    if (existingVoice) return { voiceId: existingVoice.id, cellIndices };

    // Find a free voice or the oldest one
    let voiceId = this.findFreeVoice();
    
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.context.decodeAudioData(arrayBuffer);

      // Setup new voice
      const source = this.context.createBufferSource();
      source.buffer = audioBuffer;

      const gainNode = this.context.createGain();
      gainNode.gain.setValueAtTime(0, this.context.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.5, this.context.currentTime + 0.1);

      source.connect(gainNode);
      gainNode.connect(this.dryGainNode);
      gainNode.connect(this.convolverNode);

      source.start();

      // Store voice data
      this.voices.set(voiceId, {
        id: voiceId,
        url,
        source,
        gainNode,
        startTime: this.context.currentTime,
        isReleasing: false,
        cellIndices
      });

      source.onended = () => {
        this.releaseVoice(voiceId);
      };

      return { voiceId, cellIndices };
    } catch (error) {
      console.error('Error playing sound:', error);
      return null;
    }
  }

  releaseVoice(voiceId, immediate = false) {
    const voice = this.voices.get(voiceId);
    if (!voice || voice.isReleasing) return;

    voice.isReleasing = true;

    if (immediate) {
      try {
        voice.source.stop();
        voice.source.disconnect();
        voice.gainNode.disconnect();
        this.voices.delete(voiceId);
      } catch (e) {
        console.error('Error stopping voice:', e);
      }
    } else {
      voice.gainNode.gain.linearRampToValueAtTime(0, this.context.currentTime + 0.1);
      setTimeout(() => {
        try {
          if (voice.source) {
            voice.source.stop();
            voice.source.disconnect();
          }
          voice.gainNode.disconnect();
          this.voices.delete(voiceId);
        } catch (e) {
          console.error('Error cleaning up voice:', e);
        }
      }, 100);
    }
  }

  findFreeVoice() {
    // If we have room for a new voice, create one
    if (this.voices.size < this.maxVoices) {
      return this.voices.size;
    }

    // Find the oldest voice
    let oldestTime = Infinity;
    let oldestId = null;

    this.voices.forEach((voice, id) => {
      if (voice.startTime < oldestTime) {
        oldestTime = voice.startTime;
        oldestId = id;
      }
    });

    if (oldestId !== null) {
      this.releaseVoice(oldestId, true);
    }

    return oldestId;
  }

  resume() {
    return this.context?.resume();
  }

  cleanup() {
    Array.from(this.voices.keys()).forEach(id => this.releaseVoice(id, true));
    this.voices.clear();
  }
}

export default AudioManager;