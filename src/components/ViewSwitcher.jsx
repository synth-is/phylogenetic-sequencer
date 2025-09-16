import React from 'react';
import { GitBranch, Flame } from 'lucide-react';

const ViewSwitcher = ({ activeView, onViewChange }) => {
  return (
    <div className="absolute bottom-4 right-4 z-50 flex flex-col gap-2 bg-gray-800/90 backdrop-blur-sm rounded-lg p-2 shadow-lg">
      <button
        onClick={() => onViewChange('tree')}
        className={`p-3 rounded-lg flex items-center justify-center transition-all duration-200 ${
          activeView === 'tree'
            ? 'bg-blue-600 text-white shadow-md'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
        }`}
        aria-label="Switch to Tree View"
        title="Tree View"
      >
        <GitBranch size={20} />
      </button>
      <button
        onClick={() => onViewChange('heatmap')}
        className={`p-3 rounded-lg flex items-center justify-center transition-all duration-200 ${
          activeView === 'heatmap'
            ? 'bg-blue-600 text-white shadow-md'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
        }`}
        aria-label="Switch to Heatmap View"
        title="Heatmap View"
      >
        <Flame size={20} />
      </button>
    </div>
  );
};

export default ViewSwitcher;