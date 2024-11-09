import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useStrudelPattern } from './useStrudelPattern';
import '@strudel/repl';

const StrudelEditor = forwardRef(({ 
  unitId,
  initialCode = '',
  onEditorReady = () => {},
  onPatternUpdate = () => {},
  onCodeChange = () => {}
}, ref) => {
  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const observerRef = useRef(null);
  const initializedRef = useRef(false);
  
  const {
    pattern,
    updatePattern,
    registerPattern,
    registerReplInstance,
    unregisterReplInstance
  } = useStrudelPattern(unitId);

  useEffect(() => {
    let editor = null;
    let editorReadyInterval = null;
    
    if (containerRef.current && !initializedRef.current) {
      editor = document.createElement('strudel-editor');
      editor.setAttribute('code', initialCode);
      editor.sync = true;  // Enable sync mode
      editor.solo = false; // Disable solo mode to allow multiple instances
      editorRef.current = editor;
      containerRef.current.appendChild(editor);
      initializedRef.current = true;

      // Register this instance
      registerReplInstance(editor);
      registerPattern(initialCode);

      editorReadyInterval = setInterval(() => {
        if (editor.editor) {
          clearInterval(editorReadyInterval);
          
          editor.editor.repl.onCodeChange = (newCode) => {
            updatePattern(newCode);
            onCodeChange(newCode);
          };
          
          editor.editor.repl.setCode(pattern || initialCode);
          
          onEditorReady(editor.editor);
        }
      }, 100);
    }

    return () => {
      if (editorReadyInterval) {
        clearInterval(editorReadyInterval);
      }
      
      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      if (editor?.editor?.repl) {
        editor.editor.repl.onCodeChange = null;
      }

      unregisterReplInstance();

      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }

      editorRef.current = null;
      initializedRef.current = false;
    };
  }, [unitId]);

  // Update code when pattern changes
  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (editor?.repl && pattern) {
      editor.repl.setCode(pattern);
    }
  }, [pattern]);

  // Editor control methods
  useImperativeHandle(ref, () => ({
    setCode: (code) => {
      const editor = editorRef.current?.editor;
      if (editor?.repl) {
        editor.repl.setCode(code);
        updatePattern(code);
      }
    },
    evaluate: () => {
      const editor = editorRef.current?.editor;
      if (editor?.repl) {
        editor.repl.evaluate();
      }
    },
    start: () => {
      const editor = editorRef.current?.editor;
      if (editor?.repl) {
        editor.repl.start();
      }
    },
    stop: () => {
      const editor = editorRef.current?.editor;
      if (editor?.repl) {
        editor.repl.stop();
      }
    }
  }), [updatePattern]);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full bg-gray-800 rounded"
    />
  );
});

export default StrudelEditor;