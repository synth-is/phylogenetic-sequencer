import React, { useEffect, useRef, useState } from 'react';
import { Play, Square, RefreshCw } from 'lucide-react';
import '@strudel/repl';

const LiveCodingStrudelEditor = ({ 
  unitId, 
  initialCode, 
  onCodeChange, 
  onEditorReady,
  unitInstance = null, // Add unit instance prop
  sync = true,
  solo = false
}) => {
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentCode, setCurrentCode] = useState(initialCode || 'sound("bd hh sd oh")');

  // Initialize Strudel editor - ensure complete isolation like StrudelReplTest.jsx
  useEffect(() => {
    if (containerRef.current && !editorRef.current) {
      console.log(`LiveCodingStrudelEditor: Initializing isolated REPL for unit ${unitId}`);
      
      // Create editor with unique attributes to ensure isolation
      const editor = document.createElement('strudel-editor');
      editor.setAttribute('code', currentCode);
      
      // CRITICAL: Add unique identifiers to prevent sharing between units
      editor.id = `strudel-editor-${unitId}-${Date.now()}`;
      editor.setAttribute('data-unit-id', unitId);
      editor.setAttribute('data-instance-id', `${unitId}-${Date.now()}`);
      
      // Set sync/solo properties
      editor.sync = sync;
      editor.solo = solo;
      
      // Add to container immediately (like StrudelReplTest)
      containerRef.current.appendChild(editor);
      editorRef.current = editor;
      
      // Wait for editor to be ready and ensure proper unit connection
      const checkReady = () => {
        if (editor.editor && editor.editor.repl) {
          console.log(`LiveCodingStrudelEditor ready for unit ${unitId}`, {
            editorId: editor.id,
            hasReplContext: !!editor.editor.repl.context,
            uniqueInstance: editor.getAttribute('data-instance-id')
          });
          
          if (onEditorReady) {
            onEditorReady(editor.editor);
          }
        } else {
          setTimeout(checkReady, 100);
        }
      };
      
      setTimeout(checkReady, 100);
    }

    // Cleanup with proper REPL stopping
    return () => {
      if (editorRef.current?.editor?.repl) {
        try {
          editorRef.current.editor.repl.stop();
          console.log(`LiveCodingStrudelEditor: Stopped REPL for unit ${unitId}`);
        } catch (err) {
          console.warn(`Error stopping REPL for unit ${unitId}:`, err);
        }
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
      editorRef.current = null;
    };
  }, [unitId]); // Include unitId to recreate when unit changes

  // Update sync/solo when props change
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.sync = sync;
      editorRef.current.solo = solo;
    }
  }, [sync, solo]);

  // Update code when initialCode changes
  useEffect(() => {
    if (editorRef.current?.editor && initialCode !== currentCode) {
      console.log(`LiveCodingStrudelEditor: Updating code for unit ${unitId}:`, initialCode);
      setCurrentCode(initialCode);
      editorRef.current.editor.setCode(initialCode);
      
      // Auto-evaluate when code changes from hover interactions (not initial placeholder)
      const isRealPattern = initialCode && 
        !initialCode.includes('Waiting for evolutionary sounds') &&
        !initialCode.includes('Double-click sounds in the tree') &&
        initialCode.trim().length > 0 &&
        initialCode.includes('s('); // Contains sample pattern
      
      if (isRealPattern) {
        console.log(`LiveCodingStrudelEditor: Auto-evaluating pattern for unit ${unitId}`);
        
        // Auto-evaluate with proper unit isolation
        const autoEvaluate = async () => {
          if (editorRef.current?.editor?.repl) {
            // Use unit instance's evaluate method to ensure proper sample registration
            if (unitInstance && typeof unitInstance.evaluate === 'function') {
              console.log(`Auto-evaluating via LiveCodingUnit.evaluate() for unit ${unitId}`);
              await unitInstance.evaluate();
            } else {
              // Fallback to direct evaluation
              console.log(`Auto-evaluating via direct REPL for unit ${unitId}`);
              editorRef.current.editor.repl.evaluate(initialCode);
            }
          }
        };
        
        // Small delay to ensure editor is ready
        setTimeout(autoEvaluate, 100);
      }
    }
  }, [initialCode, unitId, unitInstance]);

  const handleToggle = () => {
    if (editorRef.current?.editor?.repl) {
      editorRef.current.editor.toggle();
      setIsPlaying(prev => !prev);
    }
  };

  const handleStop = () => {
    if (editorRef.current?.editor?.repl) {
      editorRef.current.editor.repl.stop();
      setIsPlaying(false);
    }
  };

  const handleUpdate = async () => {
    if (editorRef.current?.editor?.repl) {
      const code = editorRef.current.editor.code;
      setCurrentCode(code);
      
      const instanceId = editorRef.current.getAttribute('data-instance-id');
      console.log(`LiveCodingStrudelEditor: Manual evaluation for unit ${unitId}, instance ${instanceId}`);
      
      if (onCodeChange) {
        onCodeChange(code);
      }
      
      // Use unit instance's evaluate method if available (includes sample re-registration)
      if (unitInstance && typeof unitInstance.evaluate === 'function') {
        console.log(`Using LiveCodingUnit.evaluate() for better sample registration for unit ${unitId}`);
        await unitInstance.evaluate();
      } else {
        // Fallback to direct evaluation with unit-specific logging
        console.log(`Using direct REPL evaluation for unit ${unitId} (no unit instance available)`);
        editorRef.current.editor.repl.evaluate(code);
      }
    }
  };

  return (
    <div className="space-y-2">
      {/* Control buttons */}
      <div className="flex items-center gap-2 p-2 bg-gray-800/50 rounded">
        <button
          onClick={handleUpdate}
          className="px-3 py-1.5 bg-blue-600 text-white rounded-sm flex items-center gap-1 text-xs"
        >
          <RefreshCw size={12} />
          Update & Run
        </button>
        
        <div className="flex-1" />

        <button
          onClick={handleToggle}
          className={`p-1.5 rounded-sm text-white ${
            isPlaying
              ? 'bg-yellow-600 hover:bg-yellow-700'
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {isPlaying ? <Square size={14} /> : <Play size={14} />}
        </button>
        
        <button
          onClick={handleStop}
          className="p-1.5 bg-red-600 text-white rounded-sm hover:bg-red-700"
        >
          <Square size={14} />
        </button>
      </div>

      {/* Strudel editor container */}
      <div 
        ref={containerRef} 
        className="border border-gray-600 rounded-sm min-h-[200px] bg-gray-900"
      />
      
      {/* Info display */}
      <div className="text-xs text-gray-400 flex justify-between">
        <span>Unit: {unitId}</span>
        <span>
          Sync: {sync ? 'On' : 'Off'} | Solo: {solo ? 'On' : 'Off'}
        </span>
      </div>
    </div>
  );
};

export default LiveCodingStrudelEditor;
