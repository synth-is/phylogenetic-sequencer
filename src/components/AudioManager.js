class AudioManager {
  constructor() {
    this.context = null;
    this.maxVoices = 4;
    this.voices = new Map();
    this.playingCells = new Set();

    // Audio processing nodes
    this.inputBus = null;      // Combines all voice inputs
    this.compressor = null;    // Dynamics control
    this.convolverNode = null; // Reverb
    this.dryGainNode = null;   // Dry signal
    this.wetGainNode = null;   // Wet (reverb) signal
    this.masterCompressor = null; // Final stage compression
    this.masterGain = null;    // Final output control
  }

  async initialize() {
    if (this.context) return;

    this.context = new (window.AudioContext || window.webkitAudioContext)();

    // Create input bus (summing node)
    this.inputBus = this.context.createGain();
    this.inputBus.gain.value = 1.0 / this.maxVoices; // Prevent clipping from summing

    // Create compressor for voice mixing
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 12;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.250;

    // Create reverb chain
    this.convolverNode = this.context.createConvolver();
    this.dryGainNode = this.context.createGain();
    this.wetGainNode = this.context.createGain();

    // Create master compressor
    this.masterCompressor = this.context.createDynamicsCompressor();
    this.masterCompressor.threshold.value = -12;
    this.masterCompressor.knee.value = 12;
    this.masterCompressor.ratio.value = 3;
    this.masterCompressor.attack.value = 0.025;
    this.masterCompressor.release.value = 0.250;

    // Create master gain
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0.8; // Leave headroom

    // Connect the processing chain
    this.inputBus.connect(this.compressor);
    this.compressor.connect(this.dryGainNode);
    this.compressor.connect(this.convolverNode);
    this.convolverNode.connect(this.wetGainNode);
    
    // Final mixing stage
    this.dryGainNode.connect(this.masterCompressor);
    this.wetGainNode.connect(this.masterCompressor);
    this.masterCompressor.connect(this.masterGain);
    this.masterGain.connect(this.context.destination);

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

  isCellPlaying(i, j) {
    return this.playingCells.has(`${i}-${j}`);
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

    const cellKey = `${cellIndices.i}-${cellIndices.j}`;
    
    if (this.playingCells.has(cellKey)) {
      return null;
    }

    let voiceId = this.findFreeVoice();
    
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.context.decodeAudioData(arrayBuffer);

      // Voice-specific processing chain
      const source = this.context.createBufferSource();
      source.buffer = audioBuffer;

      // Individual voice gain for envelope
      const voiceGain = this.context.createGain();
      voiceGain.gain.setValueAtTime(0, this.context.currentTime);
      
      // Create a gentle attack
      voiceGain.gain.setTargetAtTime(
        0.7, 
        this.context.currentTime,
        0.015
      );

      // Connect voice to processing chain
      source.connect(voiceGain);
      voiceGain.connect(this.inputBus);

      this.playingCells.add(cellKey);

      const voice = {
        id: voiceId,
        url,
        source,
        gainNode: voiceGain,
        startTime: this.context.currentTime,
        isReleasing: false,
        cellKey,
        cellIndices
      };

      this.voices.set(voiceId, voice);

      const cleanupVoice = () => {
        this.playingCells.delete(cellKey);
        this.releaseVoice(voiceId, true);
      };

      source.onended = cleanupVoice;
      source.start();

      // Safety cleanup
      setTimeout(cleanupVoice, (audioBuffer.duration * 1000) + 100);

      return { voiceId, cellIndices };
    } catch (error) {
      console.error('Error playing sound:', error);
      this.playingCells.delete(cellKey);
      return null;
    }
  }

  releaseVoice(voiceId, immediate = false) {
    const voice = this.voices.get(voiceId);
    if (!voice || voice.isReleasing) return;

    voice.isReleasing = true;

    if (immediate) {
      try {
        if (voice.cellKey) {
          this.playingCells.delete(voice.cellKey);
        }
        voice.source.stop();
        voice.source.disconnect();
        voice.gainNode.disconnect();
        this.voices.delete(voiceId);
      } catch (e) {
        console.error('Error stopping voice:', e);
      }
    } else {
      // Gentle release envelope
      voice.gainNode.gain.setTargetAtTime(
        0,
        this.context.currentTime,
        0.015
      );

      setTimeout(() => {
        try {
          if (voice.cellKey) {
            this.playingCells.delete(voice.cellKey);
          }
          voice.source.stop();
          voice.source.disconnect();
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
    this.playingCells.clear();
  }
}

export default AudioManager;