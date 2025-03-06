import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useUnits } from '../UnitsContext';

/**
 * A simple indicator that shows how many sounds are currently rendering
 */
function RenderingIndicator() {
  const { renderingStates } = useUnits();
  const [renderCount, setRenderCount] = useState(0);
  
  useEffect(() => {
    if (!renderingStates) return;
    
    // Count total number of rendering sounds across all units
    let count = 0;
    renderingStates.forEach(voices => {
      if (voices) {
        count += voices.size;
      }
    });
    
    setRenderCount(count);
  }, [renderingStates]);
  
  // Don't render anything if no sounds are being rendered
  if (renderCount === 0) return null;
  
  return (
    <div className="bg-blue-600/90 text-white px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 shadow-lg">
      <Loader2 size={12} className="animate-spin" />
      {renderCount === 1 ? '1 sound rendering' : `${renderCount} sounds rendering`}
    </div>
  );
}

export default RenderingIndicator;
