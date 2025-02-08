import React, { useEffect, useState, useCallback } from 'react';
import { TrajectoryUnit } from './units/TrajectoryUnit';

// Create the context
const UnitsContext = React.createContext();

export const UnitsProvider = ({ children }) => {
  const [units, setUnits] = useState(new Map());
  
  const getOrCreateUnit = useCallback(async (unitId) => {
    if (!units.has(unitId)) {
      console.log('Creating new TrajectoryUnit instance:', unitId);
      const unit = new TrajectoryUnit(unitId);
      const initialized = await unit.initialize();
      if (initialized) {
        console.log('TrajectoryUnit initialized successfully:', unitId);
        setUnits(prev => new Map(prev).set(unitId, unit));
        return unit;
      } else {
        console.error('Failed to initialize TrajectoryUnit:', unitId);
        return null;
      }
    }
    return units.get(unitId);
  }, [units]);

  const handleCellHover = useCallback(async (unitId, cellData) => {
    console.log('UnitsContext received hover:', { unitId, cellData });
    const unit = await getOrCreateUnit(unitId);
    if (unit) {
      console.log('UnitsContext forwarding to TrajectoryUnit:', {
        unitId,
        cellData
      });
      await unit.handleCellHover(cellData);
    }
  }, [getOrCreateUnit]);

  const updateUnitConfig = useCallback((unitId, config) => {
    const unit = units.get(unitId);
    if (unit) {
      console.log('Updating unit config:', { unitId, config });
      unit.updateConfig(config);
    }
  }, [units]);

  // Cleanup effect
  useEffect(() => {
    return () => {
      units.forEach(unit => unit.cleanup());
    };
  }, [units]);

  const value = {
    units,
    handleCellHover,
    updateUnitConfig
  };

  return (
    <UnitsContext.Provider value={value}>
      {children}
    </UnitsContext.Provider>
  );
};

// Custom hook to use units context
export const useUnits = () => {
  const context = React.useContext(UnitsContext);
  if (!context) {
    throw new Error('useUnits must be used within a UnitsProvider');
  }
  return context;
};