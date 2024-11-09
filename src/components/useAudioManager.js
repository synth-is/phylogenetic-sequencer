import { useState, useEffect, useRef } from 'react';
import AudioManager from './AudioManager';

export function useAudioManager() {
  const [hasInteracted, setHasInteracted] = useState(false);
  const audioManagerRef = useRef(null);
  const currentSoundUrlRef = useRef(null);

  useEffect(() => {
    audioManagerRef.current = new AudioManager();
    return () => {
      if (audioManagerRef.current) {
        audioManagerRef.current.cleanup();
      }
    };
  }, []);

  const playSound = async (url, cellIndices) => {
    if (!hasInteracted || !audioManagerRef.current) return null;
    
    // Skip if trying to play the same sound URL
    if (url === currentSoundUrlRef.current) return null;
    
    try {
      currentSoundUrlRef.current = url;
      const result = await audioManagerRef.current.playSound(url, cellIndices);
      return result;
    } catch (error) {
      console.error('Error playing sound:', error);
      currentSoundUrlRef.current = null;
      return null;
    }
  };

  const setReverbMix = (amount) => {
    if (!audioManagerRef.current) return;
    audioManagerRef.current.setReverbMix(amount);
  };

  const initialize = async () => {
    if (!audioManagerRef.current) return;
    
    try {
      await audioManagerRef.current.initialize();
      await audioManagerRef.current.resume();
      setHasInteracted(true);
    } catch (error) {
      console.error('Error initializing audio:', error);
    }
  };

  return {
    hasInteracted,
    initialize,
    playSound,
    setReverbMix,
    cleanup: () => audioManagerRef.current?.cleanup()
  };
}