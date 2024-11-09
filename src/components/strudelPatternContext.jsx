import { createContext, useContext, useRef, useState } from 'react';

export const StrudelPatternContext = createContext(null);

export const StrudelPatternProvider = ({ children }) => {
  const [patterns, setPatterns] = useState(new Map());
  const [debugLog, setDebugLog] = useState([]);  // Add debug logging
  const replInstances = useRef(new Map());

  const logDebug = (message, unitId) => {
    const timestamp = new Date().toISOString();
    setDebugLog(prev => [...prev, { timestamp, message, unitId }]);
  };

  const registerPattern = (unitId, initialPattern) => {
    setPatterns(prev => new Map(prev).set(unitId, initialPattern));
    logDebug(`Pattern registered for unit ${unitId}`, unitId);
  };

  const updatePattern = (unitId, newPattern, source = 'editor') => {
    setPatterns(prev => new Map(prev).set(unitId, newPattern));
    logDebug(`Pattern updated for unit ${unitId} from ${source}`, unitId);
    
    // Update the specific instance with the new pattern
    const instance = replInstances.current.get(unitId);
    if (instance?.editor?.repl) {
      instance.editor.repl.setCode(newPattern);
      instance.editor.repl.evaluate(newPattern);
    }
  };

  const applyPatternFromEditor = (unitId) => {
    const instance = replInstances.current.get(unitId);
    if (instance?.editor?.repl) {
      const currentCode = instance.editor.code;
      setPatterns(prev => new Map(prev).set(unitId, currentCode));
      logDebug(`Pattern applied from editor for unit ${unitId}`, unitId);
      return currentCode;
    }
    return null;
  };

  // Test function to verify pattern application
  const testPatternUpdate = (unitId) => {
    const testPattern = `note("c3 eb3 g3").sound("sawtooth").slow(${Math.random() * 2 + 0.5})`;
    updatePattern(unitId, testPattern, 'test');
    logDebug(`Test pattern applied to unit ${unitId}: ${testPattern}`, unitId);
  };

  const clearDebugLog = () => {
    setDebugLog([]);
  };

  const registerReplInstance = (unitId, instance) => {
    replInstances.current.set(unitId, instance);
  };

  const unregisterReplInstance = (unitId) => {
    replInstances.current.delete(unitId);
  };

  const getPattern = (unitId) => {
    return patterns.get(unitId);
  };

  const getReplInstance = (unitId) => {
    return replInstances.current.get(unitId);
  };

  const startAll = () => {
    replInstances.current.forEach(instance => {
      if (instance?.editor?.repl && !instance.editor.repl.isPlaying) {
        instance.editor.repl.start();
      }
    });
  };

  const stopAll = () => {
    replInstances.current.forEach(instance => {
      if (instance?.editor?.repl) {
        instance.editor.repl.stop();
      }
    });
  };

  return (
    <StrudelPatternContext.Provider value={{
      patterns,
      debugLog,
      registerPattern,
      updatePattern,
      registerReplInstance,
      unregisterReplInstance,
      getPattern,
      getReplInstance,
      startAll,
      stopAll,
      applyPatternFromEditor,
      testPatternUpdate,
      clearDebugLog
    }}>
      {children}
    </StrudelPatternContext.Provider>
  );
};