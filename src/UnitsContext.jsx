import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { TrajectoryUnit } from './units/TrajectoryUnit';
import { LoopingUnit } from './units/LoopingUnit';
import { SequencingUnit } from './units/SequencingUnit';
import { UNIT_TYPES } from './constants';

const UnitsContext = createContext();

export function UnitsProvider({ children }) {
  const [units, setUnits] = useState([]);
  const unitsRef = useRef(new Map());

  // Add lastModifiedCellData to track modifications from units
  const [lastModifiedCellData, setLastModifiedCellData] = useState(null);
  
  // Add global modified parameters state to persist across hover events
  const [modifiedParameters, setModifiedParameters] = useState({});

  const handleCellHover = useCallback((cellData) => {
    // Apply any stored modified parameters to the cellData before passing it on
    if (cellData && cellData.config && modifiedParameters) {
      // Deep clone the cellData to avoid mutation issues
      const modifiedCellData = JSON.parse(JSON.stringify(cellData));
      
      // Apply modifications to the config directly
      if (modifiedParameters.duration !== undefined) {
        modifiedCellData.config.duration = modifiedParameters.duration;
        // Also add to the top level for convenience
        modifiedCellData.duration = modifiedParameters.duration;
      }
      
      if (modifiedParameters.noteDelta !== undefined) {
        modifiedCellData.config.noteDelta = modifiedParameters.noteDelta;
        // Also add to the top level for convenience
        modifiedCellData.noteDelta = modifiedParameters.noteDelta;
      }
      
      if (modifiedParameters.velocity !== undefined) {
        modifiedCellData.config.velocity = modifiedParameters.velocity;
        // Also add to the top level for convenience
        modifiedCellData.velocity = modifiedParameters.velocity;
      }
      
      console.log('UnitsContext: Modified cellData before passing to unit', {
        originalConfig: cellData.config,
        modifiedConfig: modifiedCellData.config,
        storedParams: modifiedParameters
      });
      
      return modifiedCellData;
    }
    
    // If no modifications, pass through unchanged
    return cellData;
  }, [modifiedParameters]);
  
  const updateUnitConfig = useCallback((unitId, config) => {
    const unitInstance = unitsRef.current.get(unitId);
    if (unitInstance) {
      unitInstance.updateConfig?.(config);
    }
  }, []);

  // Add a callback for units to report modified cell data
  const handleCellDataModified = useCallback((unitId, originalData, modifiedData) => {
    console.log('UnitsContext: Cell data modified by unit:', {
      unitId,
      original: {
        duration: originalData?.duration,
        noteDelta: originalData?.noteDelta,
        velocity: originalData?.velocity
      },
      modified: {
        duration: modifiedData?.duration,
        noteDelta: modifiedData?.noteDelta || modifiedData?.pitch,
        velocity: modifiedData?.velocity
      }
    });
    
    // Store both original and modified data for components to use
    setLastModifiedCellData({
      unitId,
      originalData,
      modifiedData
    });
    
    // Update the global modified parameters state
    setModifiedParameters(prev => ({
      ...prev,
      duration: modifiedData.duration,
      noteDelta: modifiedData.noteDelta || modifiedData.pitch,
      velocity: modifiedData.velocity
    }));
  }, []);

  // Add a function to update global modified parameters
  const updateModifiedParameters = useCallback((params) => {
    console.log('UnitsContext: Updating global modified parameters:', params);
    setModifiedParameters(prev => ({
      ...prev,
      ...params
    }));
  }, []);

  // Add a function to reset modified parameters
  const resetModifiedParameters = useCallback(() => {
    console.log('UnitsContext: Resetting modified parameters');
    setModifiedParameters({});
  }, []);

  return (
    <UnitsContext.Provider value={{ 
      units, 
      setUnits, 
      unitsRef,
      handleCellHover,
      updateUnitConfig,
      lastModifiedCellData,
      handleCellDataModified,
      modifiedParameters,
      updateModifiedParameters,
      resetModifiedParameters
    }}>
      {children}
    </UnitsContext.Provider>
  );
}

export function useUnits() {
  return useContext(UnitsContext);
}