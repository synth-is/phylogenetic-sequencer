import React, { useContext } from 'react';
import { StrudelPatternContext } from './strudelPatternContext';

export const useStrudelPattern = (unitId) => {
  const context = useContext(StrudelPatternContext);
  if (!context) {
    throw new Error('useStrudelPattern must be used within a StrudelPatternProvider');
  }

  return {
    pattern: context.getPattern(unitId),
    updatePattern: (newPattern) => context.updatePattern(unitId, newPattern),
    registerPattern: (pattern) => context.registerPattern(unitId, pattern),
    registerReplInstance: (instance) => context.registerReplInstance(unitId, instance),
    unregisterReplInstance: () => context.unregisterReplInstance(unitId),
    startAll: context.startAll,
    stopAll: context.stopAll
  };
};