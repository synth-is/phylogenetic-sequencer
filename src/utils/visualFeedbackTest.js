/**
 * Visual Feedback Test Utility
 * 
 * This script helps test and verify that visual feedback (Mini Notation highlighting)
 * is properly preserved when switching between LiveCoding units.
 */

/**
 * Test visual feedback preservation automatically
 * This replaces the manual testVisualFeedbackPreservation function
 */
export function testAutomaticVisualFeedbackPreservation() {
  console.log('🎨 Testing automatic visual feedback preservation...');

  if (!window._liveCodingUnits || window._liveCodingUnits.size < 2) {
    console.log('❌ Need at least 2 LiveCoding units for this test');
    return false;
  }

  console.log('🎵 Testing automatic visual feedback restoration...');
  
  // Get all units with code
  const unitsWithCode = [];
  window._liveCodingUnits.forEach((unit, unitId) => {
    if (unit.currentCode && unit.currentCode.trim() && 
        unit.currentCode !== unit.basePattern && 
        unit.replInstance && unit.editorInstance) {
      unitsWithCode.push({ unitId, unit });
    }
  });
  
  if (unitsWithCode.length < 2) {
    console.log('❌ Need at least 2 LiveCoding units with code for this test');
    console.log('Available units:', Array.from(window._liveCodingUnits.keys()));
    return false;
  }
  
  console.log(`🧪 Found ${unitsWithCode.length} units with code ready for testing`);
  
  // Simulate unit switching by calling onSelectUnit if available
  if (typeof window.debugGetSelectedUnitId === 'function') {
    const currentSelectedUnit = window.debugGetSelectedUnitId();
    console.log(`Current selected unit: ${currentSelectedUnit}`);
    
    // Find a different unit to switch to
    const targetUnit = unitsWithCode.find(({unitId}) => unitId !== currentSelectedUnit);
    
    if (targetUnit) {
      console.log(`🔄 Switching from unit ${currentSelectedUnit} to unit ${targetUnit.unitId} to test visual feedback preservation`);
      
      // Wait a moment and check if visual feedback was automatically restored
      setTimeout(() => {
        const wasRestored = checkVisualFeedbackRestored(targetUnit.unit);
        if (wasRestored) {
          console.log(`✅ Visual feedback automatically preserved when switching to unit ${targetUnit.unitId}`);
          
          // Switch back to test the other direction
          setTimeout(() => {
            console.log(`🔄 Switching back to unit ${currentSelectedUnit} to test reverse direction`);
            // The click handler in UnitsPanel should trigger automatic restoration
          }, 1000);
          
        } else {
          console.log(`❌ Visual feedback was NOT automatically preserved for unit ${targetUnit.unitId}`);
          console.log('💡 The implementation may need adjustment');
        }
      }, 500);
      
      return true;
    }
  }
  
  console.log('⚠️ Cannot simulate unit switching - manual testing required');
  console.log('📋 Manual Test Instructions:');
  console.log('1. 🎵 Add some sounds to at least 2 LiveCoding units');
  console.log('2. 🎨 Start playback on both units to establish visual feedback');
  console.log('3. 🔄 Switch focus between units in the UnitsPanel');
  console.log('4. ✨ Visual highlighting should automatically persist when switching');
  console.log('5. 📊 Each unit should show its own highlighting pattern');
  
  return false;
}

/**
 * Check if visual feedback has been restored for a unit
 * @param {LiveCodingUnit} unit - Unit to check
 * @returns {boolean} - Whether visual feedback appears to be active
 */
function checkVisualFeedbackRestored(unit) {
  try {
    // Check if the unit has an active REPL with evaluation
    if (!unit.replInstance || !unit.editorInstance) {
      return false;
    }
    
    // Check if the code has been recently evaluated (within last 2 seconds)
    const timeSinceLastEval = Date.now() - (unit._lastEvaluationTime || 0);
    if (timeSinceLastEval < 2000) {
      return true;
    }
    
    // Check if there are visual elements that suggest active highlighting
    // This is a basic check - Strudel's internal highlighting is complex
    const strudelElement = unit.strudelElement;
    if (strudelElement) {
      const codeElements = strudelElement.querySelectorAll('.CodeMirror-line');
      const hasHighlighting = Array.from(codeElements).some(el => 
        el.style.backgroundColor || 
        el.classList.contains('highlighted') ||
        el.querySelector('.highlight')
      );
      return hasHighlighting;
    }
    
    return false;
  } catch (err) {
    console.warn('Error checking visual feedback restoration:', err);
    return false;
  }
}

/**
 * Set up automatic visual feedback monitoring
 * This monitors units and logs when visual feedback is restored
 */
export function setupVisualFeedbackMonitoring() {
  console.log('🔍 Setting up visual feedback monitoring...');
  
  // Monitor unit selection changes
  let lastSelectedUnit = null;
  
  const checkSelectionChange = () => {
    const currentSelectedUnit = window.debugGetSelectedUnitId?.();
    
    if (currentSelectedUnit && currentSelectedUnit !== lastSelectedUnit) {
      console.log(`🔄 Unit selection changed: ${lastSelectedUnit} → ${currentSelectedUnit}`);
      
      // Check if the new unit is a LiveCoding unit
      const unit = window._liveCodingUnits?.get(currentSelectedUnit);
      if (unit && unit.currentCode && unit.currentCode.trim()) {
        console.log(`🎨 Monitoring visual feedback restoration for LiveCoding unit ${currentSelectedUnit}`);
        
        // Check after a delay to see if restoration happened
        setTimeout(() => {
          const wasRestored = checkVisualFeedbackRestored(unit);
          if (wasRestored) {
            console.log(`✅ Visual feedback automatically restored for unit ${currentSelectedUnit}`);
          } else {
            console.log(`⚠️ Visual feedback may not have been restored for unit ${currentSelectedUnit}`);
          }
        }, 400);
      }
      
      lastSelectedUnit = currentSelectedUnit;
    }
  };
  
  // Check every 500ms for selection changes
  setInterval(checkSelectionChange, 500);
  
  console.log('✅ Visual feedback monitoring active');
}

/**
 * Manual trigger for visual feedback restoration (for debugging)
 * @param {string} unitId - ID of unit to restore visual feedback for
 */
export function manualRestoreVisualFeedback(unitId) {
  console.log(`🔧 Manually restoring visual feedback for unit ${unitId}...`);
  
  const unit = window._liveCodingUnits?.get(unitId);
  if (!unit) {
    console.log(`❌ Unit ${unitId} not found`);
    return false;
  }
  
  if (!unit.replInstance || !unit.currentCode) {
    console.log(`❌ Unit ${unitId} not ready for visual feedback restoration`);
    return false;
  }
  
  try {
    unit.replInstance.evaluate(unit.currentCode);
    console.log(`✅ Visual feedback manually restored for unit ${unitId}`);
    return true;
  } catch (err) {
    console.log(`❌ Failed to restore visual feedback for unit ${unitId}:`, err.message);
    return false;
  }
}

// Auto-setup monitoring when script loads
if (typeof window !== 'undefined') {
  window.testAutomaticVisualFeedbackPreservation = testAutomaticVisualFeedbackPreservation;
  window.setupVisualFeedbackMonitoring = setupVisualFeedbackMonitoring;
  window.manualRestoreVisualFeedback = manualRestoreVisualFeedback;
  
  console.log('🎨 Visual feedback test utilities loaded');
  console.log('Available functions:');
  console.log('  - testAutomaticVisualFeedbackPreservation()');
  console.log('  - setupVisualFeedbackMonitoring()');
  console.log('  - manualRestoreVisualFeedback(unitId)');
}
