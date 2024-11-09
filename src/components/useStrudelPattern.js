import React, { useContext } from 'react';
import { StrudelPatternContext } from './strudelPatternContext';

export const useStrudelPattern = (unitId) => {
  const context = useContext(StrudelPatternContext);
  if (!context) {
    throw new Error('useStrudel Pattern must be used within a StrudelPatternProvider');
  }

  return {
    pattern: context.getPattern(unitId),
    debugLog: context.debugLog,
    updatePattern: (newPattern) => context.updatePattern(unitId, newPattern),
    registerPattern: (pattern) => context.registerPattern(unitId, pattern),
    registerReplInstance: (instance) => context.registerReplInstance(unitId, instance),
    unregisterReplInstance: () => context.unregisterReplInstance(unitId),
    applyPatternFromEditor: () => context.applyPatternFromEditor(unitId),
    testPatternUpdate: () => context.testPatternUpdate(unitId),
    clearDebugLog: context.clearDebugLog,
    startAll: context.startAll,
    stopAll: context.stopAll
  };
};