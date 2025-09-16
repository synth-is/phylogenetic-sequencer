import { getRestServiceHost } from '../constants';

export const LoadingState = ({ message, error, showSettings }) => {
  return (
    <div className="fixed inset-0 bg-gray-950 flex items-center justify-center">
      <div className="max-w-md p-6 text-center">
        <div className="text-white mb-4">{message}</div>
        {error && (
          <div className="text-red-400 text-sm space-y-2">
            <p>Unable to reach sound source at {getRestServiceHost()}</p>
            <p>
              Please check your connection or {showSettings && 'use the settings panel to '}
              configure a different source
              {!showSettings && ' (click the gear icon to open settings)'}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
