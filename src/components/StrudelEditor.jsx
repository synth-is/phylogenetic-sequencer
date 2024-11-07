import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import '@strudel/repl';

const StrudelEditor = forwardRef(({ 
  initialCode = '', 
  onEditorReady = () => {}, 
  onPatternUpdate = (patternId) => {},
  onCodeChange = () => {},
  unitId
}, ref) => {
  const editorRef = useRef(null);
  const containerRef = useRef(null);
  const observerRef = useRef(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    let editor = null;
    let editorReadyInterval = null;
    
    if (containerRef.current && !initializedRef.current) {
      editor = document.createElement('strudel-editor');
      editor.setAttribute('code', initialCode);
      editorRef.current = editor;
      containerRef.current.appendChild(editor);
      initializedRef.current = true;

      editorReadyInterval = setInterval(() => {
        if (editor.editor) {
          clearInterval(editorReadyInterval);
          
          // Handle code changes through REPL
          const wsInstance = editor.editor;
          if (wsInstance.repl) {
            wsInstance.repl.onCodeChange = (newCode) => {
              onCodeChange(newCode);
            };
            // Set initial code
            wsInstance.repl.setCode(initialCode);
          }
          
          onEditorReady(wsInstance);
          
          // Start observing pattern changes
          const patternObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
              if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                const targetSpan = mutation.target;
                const style = targetSpan.style.cssText;
                
                if (style.startsWith('outline:')) {
                  const idElement = targetSpan.querySelector('[id]');
                  const patternId = idElement?.id;
                  if (patternId) {
                    onPatternUpdate(patternId, {
                      outline: targetSpan.style.outline,
                      timestamp: Date.now(),
                      unitId
                    });
                  }
                }
              }
            });
          });
          
          patternObserver.observe(editor, {
            attributes: true,
            attributeFilter: ['style'],
            childList: true,
            subtree: true,
          });
          
          observerRef.current = patternObserver;
        }
      }, 100);
    }

    return () => {
      if (editorReadyInterval) {
        clearInterval(editorReadyInterval);
      }
      
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }

      // Clean up when component is unmounted
      if (editor?.editor?.repl) {
        editor.editor.repl.onCodeChange = null;
      }

      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }

      editorRef.current = null;
      initializedRef.current = false;
    };
  }, []); // Empty dependency array - we'll handle updates separately

  // Update code when props change
  useEffect(() => {
    const editor = editorRef.current?.editor;
    if (editor?.repl) {
      editor.repl.setCode(initialCode);
    }
  }, [initialCode, unitId]);

  // Editor control methods
  const getEditor = () => editorRef.current?.editor;
  
  const setCode = (code) => {
    const editor = getEditor();
    if (editor?.repl) {
      console.log('Setting code:', code);
      editor.repl.setCode(code);
    }
  };

  const evaluate = () => {
    const editor = getEditor();
    if (editor?.repl) {
      editor.repl.evaluate();
    }
  };

  const start = () => {
    const editor = getEditor();
    if (editor?.repl) {
      editor.repl.start();
    }
  };

  const stop = () => {
    const editor = getEditor();
    if (editor?.repl) {
      editor.repl.stop();
    }
  };

  useImperativeHandle(ref, () => ({
    setCode,
    evaluate,
    start,
    stop,
    getEditor
  }), []);

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full bg-gray-800 rounded"
    />
  );
});

export default StrudelEditor;