import { createContext, useContext, useRef, useState } from 'react';

export const StrudelPatternContext = createContext(null);

export const StrudelPatternProvider = ({ children }) => {
  const [patterns, setPatterns] = useState(new Map());
  const replInstances = useRef(new Map());

  const registerPattern = (unitId, initialPattern) => {
    setPatterns(prev => new Map(prev).set(unitId, initialPattern));
  };

  const updatePattern = (unitId, newPattern) => {
    setPatterns(prev => new Map(prev).set(unitId, newPattern));
    // Update all other instances with the new pattern
    const instance = replInstances.current.get(unitId);
    if (instance?.editor?.repl) {
      instance.editor.repl.evaluate(newPattern);
    }
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
      registerPattern,
      updatePattern,
      registerReplInstance,
      unregisterReplInstance,
      getPattern,
      getReplInstance,
      startAll,
      stopAll
    }}>
      {children}
    </StrudelPatternContext.Provider>
  );
};