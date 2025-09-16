import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'

// Add global error handlers for debugging
window.addEventListener('error', (event) => {
  console.error('Global error caught:', event.error, event.message, event.filename, event.lineno, event.colno);
  console.error('Stack trace:', event.error?.stack);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  event.preventDefault(); // Prevent the default handler
});

console.log('Starting React app...');
console.log('Window object available:', typeof window !== 'undefined');
console.log('Document ready state:', document.readyState);

// Add a small delay to ensure DOM is fully ready
const startApp = () => {
  console.log('Initializing React root...');
  try {
    const root = createRoot(document.getElementById('root'));
    console.log('React root created successfully');
    
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>
    );
    console.log('React app rendered successfully');
  } catch (error) {
    console.error('Error during React app initialization:', error);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
