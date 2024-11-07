import React from 'react';
import { GitBranch, Flame } from 'lucide-react';

const ViewSwitcher = ({ activeView, onViewChange }) => {
  return (
    <div className="absolute top-4 right-4 z-50 flex flex-col gap-2">
      <button
        onClick={() => onViewChange('tree')}
        className={`p-2 rounded flex items-center justify-center ${
          activeView === 'tree'
            ? 'text-blue-400'
            : 'text-gray-400 hover:text-blue-400'
        }`}
      >
        <GitBranch size={16} />
      </button>
      <button
        onClick={() => onViewChange('heatmap')}
        className={`p-2 rounded flex items-center justify-center ${
          activeView === 'heatmap'
            ? 'text-blue-400'
            : 'text-gray-400 hover:text-blue-400'
        }`}
      >
        <Flame size={16} />
      </button>
    </div>
  );
};

export default ViewSwitcher;