import React, { useEffect, useRef, useState } from 'react';
import '@strudel/repl';

/**
 * DynamicStrudelTest - Simplified version following StrudelReplTest.jsx pattern exactly
 */
const DynamicStrudelTest = () => {
  const [replInstances, setReplInstances] = useState([]);
  const [nextId, setNextId] = useState(1);

  // Mock patterns for testing - only built-in sounds from Strudel docs
  const mockPatterns = [
    'sound("bd hh")',
    'sound("sd oh")',
    'sound("bd hh sd oh")',
    'sound("bd sd rim hh")',
    'sound("bd").every(4, x => x.speed(2))',
    'sound("hh").fast(4)',
    'sound("bd sd").slow(2)',
    'sound("casio").gain(0.8)',
    'sound("metal").delay(0.2)',
    'sound("bd hh sd hh")',
    'sound("bd hh sd oh").bank("RolandTR808")',
    'sound("bd hh sd oh").bank("RolandTR909")',
    'sound("jazz metal casio")',
    'sound("bd*4, hh*8")',
    'sound("insect wind")',
    'sound("bd rim oh")',
    'note("c e g").sound("piano")',
    'note("48 52 55 59").sound("sawtooth")',
    'sound("numbers:1 numbers:2")',
    'sound("bd sd, hh*4")'
  ];

  const logger = (haps, t) => {
    haps.forEach(hap => {
      console.log('Hap:', hap.value, "time:", t);
    });
  };

  useEffect(() => {
    if (window) {
      window.kromosynthblink = logger;
    }
  }, []);

  // Create a new REPL instance - with minimal interruption
  const createRepl = () => {
    const id = nextId;
    setNextId(prev => prev + 1);
    
    const randomPattern = mockPatterns[Math.floor(Math.random() * mockPatterns.length)];
    
    // IMPORTANT: Briefly stop all playing REPLs during creation to prevent state conflicts
    // But remember which ones were playing so we can restart them
    console.log(`DynamicStrudelTest: Temporarily stopping REPLs during creation of REPL ${id}`);
    
    // Get list of currently playing REPLs before stopping them
    const currentlyPlayingREPLs = [];
    if (window.strudelGlobalGetPlayingStates) {
      currentlyPlayingREPLs.push(...window.strudelGlobalGetPlayingStates());
    }
    
    stopAllActiveREPLs();
    
    const newInstance = {
      id,
      pattern: randomPattern,
      sync: true,
      solo: false
    };
    
    setReplInstances(prev => [...prev, newInstance]);
    console.log(`DynamicStrudelTest: Created REPL ${id} with pattern: ${randomPattern}`);
    
    // Restart the previously playing REPLs after a short delay
    setTimeout(() => {
      console.log(`DynamicStrudelTest: Restarting previously playing REPLs:`, currentlyPlayingREPLs);
      if (window.strudelGlobalRestartSpecific) {
        window.strudelGlobalRestartSpecific(currentlyPlayingREPLs);
      }
    }, 200);
  };

  // Remove a REPL instance
  const removeRepl = (id) => {
    setReplInstances(prev => prev.filter(instance => instance.id !== id));
    console.log(`DynamicStrudelTest: Removed REPL ${id}`);
  };

  // Stop all REPLs - actually stops all active instances
  const stopAll = () => {
    stopAllActiveREPLs();
  };

  // Start all REPLs - like in StrudelReplTest
  const startAll = async () => {
    console.log('Starting all REPLs...');
    // Ensure AudioContext is resumed before starting all
    await ensureGlobalAudioContextResumed();
    if (window.strudelGlobalStartAll) {
      window.strudelGlobalStartAll();
    }
  };

  // Global AudioContext resumption function
  const ensureGlobalAudioContextResumed = async () => {
    try {
      console.log('🔧 Checking global AudioContext state...');
      const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
      
      // Method 1: Try to find Strudel's AudioContext through REPL instances
      let strudelContext = null;
      
      // Check if we have any REPL instances with audio contexts
      if (window._dynamicStrudelRepls && window._dynamicStrudelRepls.size > 0) {
        for (const [id, replRef] of window._dynamicStrudelRepls) {
          const element = replRef.current;
          if (element?.editor?.repl) {
            console.log(`🔧 Found REPL instance ${id}, checking for AudioContext...`);
            const repl = element.editor.repl;
            
            // Priority 1: Check scheduler for AudioContext (most likely location)
            if (repl.scheduler) {
              console.log(`🔧 Checking scheduler in REPL ${id}...`);
              
              // Check scheduler context
              if (repl.scheduler.context) {
                const schedulerCtx = repl.scheduler.context;
                if (schedulerCtx.audioContext) {
                  strudelContext = schedulerCtx.audioContext;
                  console.log('🔧 Found audioContext in scheduler context');
                  break;
                } else if (schedulerCtx.webaudio && schedulerCtx.webaudio.context) {
                  strudelContext = schedulerCtx.webaudio.context;
                  console.log('🔧 Found webaudio context in scheduler context');
                  break;
                }
              }
              
              // Check scheduler properties directly
              Object.getOwnPropertyNames(repl.scheduler).forEach(prop => {
                const value = repl.scheduler[prop];
                if (!strudelContext && value && typeof value === 'object' && 
                    (prop.toLowerCase().includes('audio') || prop.toLowerCase().includes('context')) &&
                    typeof value.resume === 'function' && value.state !== undefined) {
                  strudelContext = value;
                  console.log(`🔧 Found AudioContext in scheduler.${prop}`);
                }
                
                // Special check for worker and channel objects
                if (!strudelContext && prop === 'worker' && value && typeof value === 'object') {
                  Object.getOwnPropertyNames(value).forEach(workerProp => {
                    const workerValue = value[workerProp];
                    if (!strudelContext && workerValue && typeof workerValue === 'object' &&
                        typeof workerValue.resume === 'function' && workerValue.state !== undefined) {
                      strudelContext = workerValue;
                      console.log(`🔧 Found AudioContext in scheduler.worker.${workerProp}`);
                    }
                  });
                }
                
                if (!strudelContext && prop === 'channel' && value && typeof value === 'object') {
                  Object.getOwnPropertyNames(value).forEach(channelProp => {
                    const channelValue = value[channelProp];
                    if (!strudelContext && channelValue && typeof channelValue === 'object' &&
                        typeof channelValue.resume === 'function' && channelValue.state !== undefined) {
                      strudelContext = channelValue;
                      console.log(`🔧 Found AudioContext in scheduler.channel.${channelProp}`);
                    }
                  });
                }
              });
              
              if (strudelContext) break;
            }
            
            // Priority 2: Check REPL context (fallback)
            if (repl.context) {
              const replContext = repl.context;
              
              // Look for AudioContext in the REPL context
              if (replContext.audioContext) {
                strudelContext = replContext.audioContext;
                console.log('🔧 Found audioContext in REPL context');
                break;
              }
              
              // Alternative: Look for webaudio context
              if (replContext.webaudio && replContext.webaudio.context) {
                strudelContext = replContext.webaudio.context;
                console.log('🔧 Found webaudio context in REPL context');
                break;
              }
              
              // Try to access through cyclist or other Strudel internals
              if (replContext.cyclist && replContext.cyclist.context) {
                strudelContext = replContext.cyclist.context;
                console.log('🔧 Found cyclist context in REPL context');
                break;
              }
            }
          }
        }
      }
      
      // Method 2: Try global Strudel/AudioContext references
      if (!strudelContext) {
        const possibleContexts = [
          window.audioContext,
          window._strudelAudioContext,
          window.webAudioContext,
          // Check for any AudioContext instances globally
          ...(window.AudioContext ? [new AudioContext()] : [])
        ];
        
        for (const context of possibleContexts) {
          if (context && typeof context.resume === 'function') {
            strudelContext = context;
            console.log('🔧 Found global AudioContext');
            break;
          }
        }
      }
      
      // Method 3: Try Tone.js if available (fallback)
      if (!strudelContext && window.Tone && window.Tone.context) {
        strudelContext = window.Tone.context;
        console.log('🔧 Found Tone.js context');
      }
      
      // Resume the found context
      if (strudelContext) {
        console.log('🔧 AudioContext state:', strudelContext.state);
        
        if (strudelContext.state === 'suspended') {
          console.log('🔧 Resuming AudioContext...');
          
          if (isFirefox) {
            // Firefox-specific: Add timeout to prevent hanging
            const resumeWithTimeout = () => {
              return new Promise(async (resolve, reject) => {
                const timeout = setTimeout(() => {
                  console.warn('🚨 Firefox: AudioContext resume timeout after 5 seconds');
                  resolve(); // Continue anyway
                }, 5000);
                
                try {
                  await strudelContext.resume();
                  clearTimeout(timeout);
                  console.log('✅ AudioContext resumed successfully');
                  resolve();
                } catch (err) {
                  clearTimeout(timeout);
                  console.warn('🚨 AudioContext resume failed:', err);
                  resolve(); // Continue anyway
                }
              });
            };
            await resumeWithTimeout();
          } else {
            // Standard resume for non-Firefox browsers
            await strudelContext.resume();
            console.log('✅ AudioContext resumed successfully');
          }
        } else {
          console.log('✅ AudioContext already running:', strudelContext.state);
        }
      } else {
        console.warn('⚠️ No AudioContext found for resumption');
      }
      
    } catch (err) {
      console.warn('🚨 Error in ensureGlobalAudioContextResumed:', err);
    }
  };

  // Test AudioContext function for debugging
  const testAudioContext = async () => {
    console.log('🧪 Testing AudioContext...');
    await ensureGlobalAudioContextResumed();
    
    // Additional diagnostics - check what's available in Strudel REPLs
    if (window._dynamicStrudelRepls && window._dynamicStrudelRepls.size > 0) {
      for (const [id, replRef] of window._dynamicStrudelRepls) {
        const element = replRef.current;
        if (element?.editor?.repl?.context) {
          const ctx = element.editor.repl.context;
          console.log(`🧪 REPL ${id} context keys:`, Object.keys(ctx));
          console.log(`🧪 REPL ${id} has audioContext:`, !!ctx.audioContext);
          console.log(`🧪 REPL ${id} has webaudio:`, !!ctx.webaudio);
          console.log(`🧪 REPL ${id} has cyclist:`, !!ctx.cyclist);
          
          // Try to play a test pattern to verify audio
          try {
            if (element.editor.repl.evaluate) {
              console.log(`🧪 Testing sound with REPL ${id}...`);
              await element.editor.repl.evaluate('sound("bd").gain(0.3)');
              setTimeout(() => {
                if (element.editor.repl.start) {
                  element.editor.repl.start();
                  console.log(`✅ Test pattern started on REPL ${id}`);
                  setTimeout(() => {
                    if (element.editor.repl.stop) {
                      element.editor.repl.stop();
                      console.log(`🔇 Test pattern stopped on REPL ${id}`);
                    }
                  }, 1000);
                }
              }, 100);
            }
          } catch (err) {
            console.error(`❌ Test pattern failed on REPL ${id}:`, err);
          }
          break; // Only test the first available REPL
        }
      }
    } else {
      console.warn('⚠️ No REPL instances available for testing');
    }
  };

  // Debug Strudel internals to understand the audio architecture
  const debugStrudelInternals = () => {
    console.log('🔍 === STRUDEL INTERNALS DEBUG ===');
    
    // Check global window objects related to audio/strudel
    const globalKeys = Object.keys(window).filter(key => 
      key.toLowerCase().includes('audio') || 
      key.toLowerCase().includes('strudel') || 
      key.toLowerCase().includes('tone') ||
      key.toLowerCase().includes('context') ||
      key.toLowerCase().includes('cyclist')
    );
    console.log('🔍 Global keys with audio/strudel:', globalKeys);
    
    // Check for common audio libraries
    console.log('🔍 Audio libraries available:');
    console.log('  - Tone.js:', !!window.Tone);
    console.log('  - Web Audio API:', !!window.AudioContext);
    console.log('  - Strudel (global):', !!window.strudel);
    
    // Check REPL instances in detail
    if (window._dynamicStrudelRepls && window._dynamicStrudelRepls.size > 0) {
      for (const [id, replRef] of window._dynamicStrudelRepls) {
        const element = replRef.current;
        console.log(`🔍 === REPL ${id} INTERNALS ===`);
        
        if (element) {
          console.log(`🔍 Element properties:`, Object.getOwnPropertyNames(element));
          
          if (element.editor) {
            console.log(`🔍 Editor properties:`, Object.getOwnPropertyNames(element.editor));
            
            if (element.editor.repl) {
              const repl = element.editor.repl;
              console.log(`🔍 REPL properties:`, Object.getOwnPropertyNames(repl));
              
              // Dig deeper into scheduler - this likely contains cyclist
              if (repl.scheduler) {
                console.log(`🔍 REPL scheduler properties:`, Object.getOwnPropertyNames(repl.scheduler));
                
                // Show all scheduler properties and their types to find AudioContext
                Object.getOwnPropertyNames(repl.scheduler).forEach(prop => {
                  const value = repl.scheduler[prop];
                  const type = typeof value;
                  const constructor = value && typeof value === 'object' ? value.constructor.name : 'N/A';
                  console.log(`🔍   scheduler.${prop}: ${type} (${constructor})`);
                  
                  // Special detailed inspection for worker and channel
                  if (prop === 'worker' && value && typeof value === 'object') {
                    console.log(`🔍     🔧 WORKER DEEP INSPECTION:`);
                    console.log(`🔍     worker properties:`, Object.getOwnPropertyNames(value));
                    Object.getOwnPropertyNames(value).forEach(workerProp => {
                      const workerValue = value[workerProp];
                      const workerType = typeof workerValue;
                      const workerConstructor = workerValue && typeof workerValue === 'object' ? workerValue.constructor.name : 'N/A';
                      console.log(`🔍       worker.${workerProp}: ${workerType} (${workerConstructor})`);
                      
                      // Look for AudioContext in worker
                      if (workerValue && typeof workerValue === 'object' && 
                          (workerProp.toLowerCase().includes('audio') || 
                           workerProp.toLowerCase().includes('context') ||
                           workerConstructor.includes('Audio') ||
                           workerConstructor.includes('Context'))) {
                        console.log(`🔍         ✨ worker.${workerProp} might be AudioContext!`, workerValue);
                        if (workerValue.state !== undefined) {
                          console.log(`🔍         ✨ worker.${workerProp} state:`, workerValue.state);
                        }
                      }
                    });
                  }
                  
                  if (prop === 'channel' && value && typeof value === 'object') {
                    console.log(`🔍     📡 CHANNEL DEEP INSPECTION:`);
                    console.log(`🔍     channel properties:`, Object.getOwnPropertyNames(value));
                    Object.getOwnPropertyNames(value).forEach(channelProp => {
                      const channelValue = value[channelProp];
                      const channelType = typeof channelValue;
                      const channelConstructor = channelValue && typeof channelValue === 'object' ? channelValue.constructor.name : 'N/A';
                      console.log(`🔍       channel.${channelProp}: ${channelType} (${channelConstructor})`);
                      
                      // Look for AudioContext in channel
                      if (channelValue && typeof channelValue === 'object' && 
                          (channelProp.toLowerCase().includes('audio') || 
                           channelProp.toLowerCase().includes('context') ||
                           channelConstructor.includes('Audio') ||
                           channelConstructor.includes('Context'))) {
                        console.log(`🔍         ✨ channel.${channelProp} might be AudioContext!`, channelValue);
                        if (channelValue.state !== undefined) {
                          console.log(`🔍         ✨ channel.${channelProp} state:`, channelValue.state);
                        }
                      }
                    });
                  }
                  
                  // If it looks like it might contain an AudioContext, inspect further
                  if (value && typeof value === 'object' && 
                      (prop.toLowerCase().includes('audio') || 
                       prop.toLowerCase().includes('context') ||
                       prop.toLowerCase().includes('output') ||
                       constructor.includes('Audio') ||
                       constructor.includes('Context'))) {
                    console.log(`🔍     ${prop} properties:`, Object.getOwnPropertyNames(value));
                    
                    // Check if this object has AudioContext-like properties
                    if (value.state !== undefined && typeof value.resume === 'function') {
                      console.log(`🔍     ✨ ${prop} looks like an AudioContext! State: ${value.state}`);
                    }
                  }
                });
                
                // Look for cyclist in scheduler
                if (repl.scheduler.context) {
                  console.log(`🔍 Scheduler context properties:`, Object.getOwnPropertyNames(repl.scheduler.context));
                  
                  // Check for AudioContext in scheduler context
                  const ctx = repl.scheduler.context;
                  Object.getOwnPropertyNames(ctx).forEach(prop => {
                    const value = ctx[prop];
                    if (prop.toLowerCase().includes('audio') || 
                        prop.toLowerCase().includes('context') ||
                        prop.toLowerCase().includes('cyclist') ||
                        (value && typeof value === 'object' && value.constructor && 
                         (value.constructor.name.includes('Audio') || 
                          value.constructor.name.includes('Context')))) {
                      console.log(`🔍 Scheduler context audio property '${prop}':`, value);
                      
                      if (value && typeof value === 'object') {
                        console.log(`🔍   ${prop} properties:`, Object.getOwnPropertyNames(value));
                        
                        // If it looks like an AudioContext, log its state
                        if (value.state !== undefined) {
                          console.log(`🔍   ${prop} state:`, value.state);
                        }
                      }
                    }
                  });
                }
                
                // Also check if scheduler itself has AudioContext properties
                Object.getOwnPropertyNames(repl.scheduler).forEach(prop => {
                  const value = repl.scheduler[prop];
                  if (prop.toLowerCase().includes('audio') || 
                      prop.toLowerCase().includes('context') ||
                      (value && typeof value === 'object' && value.constructor && 
                       (value.constructor.name.includes('Audio') || 
                        value.constructor.name.includes('Context')))) {
                    console.log(`🔍 Scheduler audio property '${prop}':`, value);
                    
                    if (value && typeof value === 'object' && value.state !== undefined) {
                      console.log(`🔍   ${prop} state:`, value.state);
                    }
                  }
                });
              }
              
              if (repl.context) {
                const ctx = repl.context;
                console.log(`🔍 REPL context properties:`, Object.getOwnPropertyNames(ctx));
                
                // Look for audio-related properties
                Object.getOwnPropertyNames(ctx).forEach(prop => {
                  const value = ctx[prop];
                  if (prop.toLowerCase().includes('audio') || 
                      prop.toLowerCase().includes('context') ||
                      prop.toLowerCase().includes('cyclist') ||
                      (value && typeof value === 'object' && value.constructor && 
                       (value.constructor.name.includes('Audio') || 
                        value.constructor.name.includes('Context')))) {
                    console.log(`🔍 Audio-related property '${prop}':`, value);
                    
                    if (value && typeof value === 'object') {
                      console.log(`🔍   ${prop} properties:`, Object.getOwnPropertyNames(value));
                      
                      // If it looks like an AudioContext, log its state
                      if (value.state !== undefined) {
                        console.log(`🔍   ${prop} state:`, value.state);
                      }
                    }
                  }
                });
                
                // Special check for cyclist (seems to be Strudel's audio engine)
                if (ctx.cyclist) {
                  console.log('🔍 Cyclist (audio engine) details:');
                  console.log('🔍   cyclist properties:', Object.getOwnPropertyNames(ctx.cyclist));
                  
                  // Try to find the AudioContext in cyclist
                  if (ctx.cyclist.ac || ctx.cyclist.audioContext || ctx.cyclist.context) {
                    const audioCtx = ctx.cyclist.ac || ctx.cyclist.audioContext || ctx.cyclist.context;
                    console.log('🔍   cyclist AudioContext found:', audioCtx);
                    console.log('🔍   cyclist AudioContext state:', audioCtx.state);
                  }
                }
              }
            }
          }
        }
        break; // Only debug the first REPL in detail
      }
    } else {
      console.log('🔍 No REPL instances available for debugging');
    }
    
    console.log('🔍 === END STRUDEL INTERNALS DEBUG ===');
  };

  // Function to actually stop all playing REPLs across all instances
  const stopAllActiveREPLs = () => {
    console.log('Stopping all active REPLs to prevent state conflicts...');
    // We'll need to access the refs from the instances
    // This will be implemented by triggering a global stop event
    if (window.strudelGlobalStop) {
      window.strudelGlobalStop();
    }
  };

  // Individual REPL component - with global stop coordination
  const ReplInstance = ({ instance, onRemove }) => {
    const replRef = useRef(null);
    const containerRef = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentPattern, setCurrentPattern] = useState(instance.pattern);
  const [isSolo, setIsSolo] = useState(false);

    // Initialize REPL - exactly like StrudelReplTest
  useEffect(() => {
      if (containerRef.current && !replRef.current) {
        console.log(`ReplInstance: Initializing REPL ${instance.id}`);
        
        const repl = document.createElement('strudel-editor');
        repl.setAttribute('code', currentPattern);
        repl.sync = instance.sync;
        repl.solo = instance.solo;
        containerRef.current.appendChild(repl);
        replRef.current = repl;

    // Register globally for solo coordination
    if (!window._dynamicStrudelRepls) window._dynamicStrudelRepls = new Map();
    window._dynamicStrudelRepls.set(instance.id, replRef);
        
        console.log(`ReplInstance: REPL ${instance.id} initialized`);
      }

      // Cleanup - exactly like StrudelReplTest
      return () => {
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
        }
    if (window._dynamicStrudelRepls) window._dynamicStrudelRepls.delete(instance.id);
        replRef.current = null;
      };
    }, []); // Empty dependency array like StrudelReplTest

    // Register this instance for global coordination
    useEffect(() => {
      const stopThisREPL = () => {
        if (replRef.current?.editor?.repl) {
          console.log(`ReplInstance: Global stop triggered for REPL ${instance.id}`);
          replRef.current.editor.repl.stop();
          setIsPlaying(false);
        }
      };

      const startThisREPL = async () => {
        if (replRef.current?.editor?.repl && !isPlaying) {
          console.log(`ReplInstance: Global start triggered for REPL ${instance.id}`);
          // Ensure AudioContext is resumed before starting
          await ensureAudioContextResumed();
          // Prefer explicit start() if available to avoid unintended stop
          if (replRef.current.editor.repl.start) {
            try { replRef.current.editor.repl.start(); } catch {}
          } else if (replRef.current.editor.toggle) {
            replRef.current.editor.toggle();
          }
          setIsPlaying(true);
        } else if (isPlaying) {
          // Already playing; ensure internal flag reflects it
          setIsPlaying(true);
        }
      };

      const getPlayingState = () => {
        return { id: instance.id, isPlaying };
      };

      const restartIfWasPlaying = (playingStates) => {
        const wasPlaying = playingStates.find(state => state.id === instance.id && state.isPlaying);
        if (wasPlaying && replRef.current?.editor?.repl && !isPlaying) {
          console.log(`ReplInstance: Restarting REPL ${instance.id} as it was playing before`);
          replRef.current.editor.toggle();
          setIsPlaying(true);
        }
      };

      // Register global stop function
      if (!window.strudelGlobalStopFunctions) {
        window.strudelGlobalStopFunctions = new Set();
      }
      window.strudelGlobalStopFunctions.add(stopThisREPL);

  // Map id -> stop/start for targeted external control (solo logic)
  if (!window._dynamicReplStopFns) window._dynamicReplStopFns = {};
  if (!window._dynamicReplStartFns) window._dynamicReplStartFns = {};
  if (!window._dynamicReplMarkPlayingFns) window._dynamicReplMarkPlayingFns = {};
  window._dynamicReplStopFns[instance.id] = stopThisREPL;
  window._dynamicReplStartFns[instance.id] = startThisREPL;
  window._dynamicReplMarkPlayingFns[instance.id] = () => setIsPlaying(true);

      // Register global start function
      if (!window.strudelGlobalStartFunctions) {
        window.strudelGlobalStartFunctions = new Set();
      }
      window.strudelGlobalStartFunctions.add(startThisREPL);

      // Register playing state getter
      if (!window.strudelGlobalPlayingStateGetters) {
        window.strudelGlobalPlayingStateGetters = new Set();
      }
      window.strudelGlobalPlayingStateGetters.add(getPlayingState);

      // Register restart function
      if (!window.strudelGlobalRestartFunctions) {
        window.strudelGlobalRestartFunctions = new Set();
      }
      window.strudelGlobalRestartFunctions.add(restartIfWasPlaying);

      // Create global stop coordinator if it doesn't exist
      if (!window.strudelGlobalStop) {
        window.strudelGlobalStop = () => {
          console.log('Executing global stop for all REPL instances');
          if (window.strudelGlobalStopFunctions) {
            window.strudelGlobalStopFunctions.forEach(stopFn => {
              try {
                stopFn();
              } catch (error) {
                console.log('Error in global stop function:', error);
              }
            });
          }
        };
      }

      // Create global start coordinator if it doesn't exist
      if (!window.strudelGlobalStartAll) {
        window.strudelGlobalStartAll = () => {
          console.log('Executing global start for all REPL instances');
          if (window.strudelGlobalStartFunctions) {
            window.strudelGlobalStartFunctions.forEach(startFn => {
              try {
                startFn();
              } catch (error) {
                console.log('Error in global start function:', error);
              }
            });
          }
        };
      }

      // Create global playing state getter if it doesn't exist
      if (!window.strudelGlobalGetPlayingStates) {
        window.strudelGlobalGetPlayingStates = () => {
          const states = [];
          if (window.strudelGlobalPlayingStateGetters) {
            window.strudelGlobalPlayingStateGetters.forEach(getter => {
              try {
                states.push(getter());
              } catch (error) {
                console.log('Error getting playing state:', error);
              }
            });
          }
          return states;
        };
      }

      // Create global restart specific function if it doesn't exist
      if (!window.strudelGlobalRestartSpecific) {
        window.strudelGlobalRestartSpecific = (playingStates) => {
          console.log('Executing global restart for specific REPL instances');
          if (window.strudelGlobalRestartFunctions) {
            window.strudelGlobalRestartFunctions.forEach(restartFn => {
              try {
                restartFn(playingStates);
              } catch (error) {
                console.log('Error in global restart function:', error);
              }
            });
          }
        };
      }

      // Cleanup: remove this function from global registry
      return () => {
        if (window.strudelGlobalStopFunctions) {
          window.strudelGlobalStopFunctions.delete(stopThisREPL);
        }
        if (window.strudelGlobalStartFunctions) {
          window.strudelGlobalStartFunctions.delete(startThisREPL);
        }
        if (window.strudelGlobalPlayingStateGetters) {
          window.strudelGlobalPlayingStateGetters.delete(getPlayingState);
        }
        if (window.strudelGlobalRestartFunctions) {
          window.strudelGlobalRestartFunctions.delete(restartIfWasPlaying);
        }
  if (window._dynamicReplStopFns) delete window._dynamicReplStopFns[instance.id];
  if (window._dynamicReplStartFns) delete window._dynamicReplStartFns[instance.id];
  if (window._dynamicReplMarkPlayingFns) delete window._dynamicReplMarkPlayingFns[instance.id];
      };
    }, [instance.id, isPlaying]);

  // Handle functions - exactly like StrudelReplTest (no exclusive playback)
  const handleToggle = async () => {
    if (replRef.current?.editor?.repl) {
      // Before toggling, ensure AudioContext is resumed (especially for Firefox)
      await ensureAudioContextResumed();
      replRef.current.editor.toggle();
      setIsPlaying(prev => !prev);
      console.log(`DynamicStrudelTest: Toggled REPL ${instance.id}`);
    }
  };

  // Ensure AudioContext is resumed for Strudel/Tone.js - crucial for Firefox
  const ensureAudioContextResumed = async () => {
    try {
      // Check if we're in Firefox (where AudioContext.resume() can hang)
      const isFirefox = navigator.userAgent.toLowerCase().includes('firefox');
      
      // Method 1: Try to find AudioContext through this REPL instance
      let strudelContext = null;
      
      if (replRef.current?.editor?.repl) {
        const repl = replRef.current.editor.repl;
        
        // First, try to find AudioContext in scheduler (where cyclist likely lives)
        if (repl.scheduler) {
          console.log('🔧 Checking scheduler for AudioContext...');
          
          // Check scheduler context
          if (repl.scheduler.context) {
            const schedulerCtx = repl.scheduler.context;
            if (schedulerCtx.audioContext) {
              strudelContext = schedulerCtx.audioContext;
              console.log('🔧 Found audioContext in scheduler context');
            } else if (schedulerCtx.webaudio && schedulerCtx.webaudio.context) {
              strudelContext = schedulerCtx.webaudio.context;
              console.log('🔧 Found webaudio context in scheduler context');
            }
          }
          
          // Check scheduler itself for audio properties
          if (!strudelContext) {
            Object.getOwnPropertyNames(repl.scheduler).forEach(prop => {
              const value = repl.scheduler[prop];
              if (!strudelContext && value && typeof value === 'object' && 
                  (prop.toLowerCase().includes('audio') || prop.toLowerCase().includes('context')) &&
                  typeof value.resume === 'function' && value.state !== undefined) {
                strudelContext = value;
                console.log(`🔧 Found AudioContext in scheduler.${prop}`);
              }
            });
          }
        }
        
        // Fallback: try REPL context
        if (!strudelContext && repl.context) {
          const replContext = repl.context;
          
          // Look for AudioContext in various possible locations
          if (replContext.audioContext) {
            strudelContext = replContext.audioContext;
            console.log('🔧 Found audioContext in REPL context');
          } else if (replContext.webaudio && replContext.webaudio.context) {
            strudelContext = replContext.webaudio.context;
            console.log('🔧 Found webaudio context in REPL context');
          } else if (replContext.cyclist && replContext.cyclist.context) {
            strudelContext = replContext.cyclist.context;
            console.log('🔧 Found cyclist context in REPL context');
          }
        }
      }
      
      // Method 2: Try Tone.js context if available
      if (!strudelContext && window.Tone && window.Tone.context) {
        strudelContext = window.Tone.context;
        console.log('🔧 Using Tone.js context');
      }
      
      // Method 3: Try global AudioContext
      if (!strudelContext && window.audioContext) {
        strudelContext = window.audioContext;
        console.log('🔧 Using global audioContext');
      }
      
      // Resume the context if found and suspended
      if (strudelContext) {
        console.log('🔧 AudioContext state:', strudelContext.state);
        
        if (strudelContext.state === 'suspended') {
          console.log('🔧 Resuming AudioContext...');
          
          if (isFirefox) {
            // Firefox-specific: Add timeout to prevent hanging
            const resumeWithTimeout = () => {
              return new Promise(async (resolve, reject) => {
                const timeout = setTimeout(() => {
                  console.warn('🚨 Firefox: AudioContext resume timeout after 3 seconds');
                  resolve(); // Continue anyway
                }, 3000);
                
                try {
                  await strudelContext.resume();
                  clearTimeout(timeout);
                  console.log('✅ AudioContext resumed successfully');
                  resolve();
                } catch (err) {
                  clearTimeout(timeout);
                  console.warn('🚨 AudioContext resume failed:', err);
                  resolve(); // Continue anyway
                }
              });
            };
            await resumeWithTimeout();
          } else {
            // Standard resume for non-Firefox browsers
            await strudelContext.resume();
            console.log('✅ AudioContext resumed successfully');
          }
        } else {
          console.log('✅ AudioContext already running:', strudelContext.state);
        }
      } else {
        console.warn('⚠️ No AudioContext found for this REPL instance');
      }
      
    } catch (err) {
      console.warn('🚨 Error in ensureAudioContextResumed:', err);
    }
  };    const handleStop = () => {
      if (replRef.current?.editor?.repl) {
        replRef.current.editor.repl.stop();
        setIsPlaying(false);
        console.log(`DynamicStrudelTest: Stopped REPL ${instance.id}`);
      }
    };

    const handleSolo = () => {
      const newSolo = !isSolo;
      if (newSolo) {
        // Record and stop others
        // Prefer authoritative global playing states if available
        let prevStates = [];
        if (window.strudelGlobalGetPlayingStates) {
          try { prevStates = window.strudelGlobalGetPlayingStates(); } catch {}
        }
        const recorded = [];
        if (window._dynamicStrudelRepls) {
          window._dynamicStrudelRepls.forEach((otherRef, otherId) => {
            if (otherId === instance.id) return;
            const el = otherRef.current;
            if (!el) return;
            const state = prevStates.find(s => s.id === otherId);
            const wasPlaying = state ? !!state.isPlaying : !!el.editor?.repl?.isPlaying;
            recorded.push({ id: otherId, wasPlaying });
            if (wasPlaying) {
              // Prefer mapped stop fn to also update React state
              try {
                if (window._dynamicReplStopFns && window._dynamicReplStopFns[otherId]) {
                  window._dynamicReplStopFns[otherId]();
                } else {
                  el.editor?.repl?.stop?.();
                }
              } catch {}
            }
            el.solo = false;
            if (el.editor?.repl) {
              try { el.editor.repl.solo = false; } catch {}
            }
          });
        }
        // Store the correctly shaped recorded states (with wasPlaying) for restoration
        replRef.current._prevStates = recorded;
        console.log('[Solo] Stored previous states for restore:', recorded);
        window._dynamicSoloReplId = instance.id;
      } else {
        // Restore others if we have previous states
        if (replRef.current?._prevStates && window._dynamicStrudelRepls) {
          // Build current playing map to avoid double toggles
            let currentStates = [];
            if (window.strudelGlobalGetPlayingStates) {
              try { currentStates = window.strudelGlobalGetPlayingStates(); } catch {}
            }
            console.log('[SoloRestore] Stored prevStates to process:', replRef.current._prevStates);
            replRef.current._prevStates.forEach((entry) => {
              const id = entry.id;
              const wasPlaying = entry.wasPlaying !== undefined ? entry.wasPlaying : entry.isPlaying;
              const otherRef = window._dynamicStrudelRepls.get(id);
              const el = otherRef?.current;
              if (!el) return;
              el.solo = false;
              // Determine current playing via live repl object, not cached state list that may be stale
              const isCurrentlyPlaying = !!el.editor?.repl?.isPlaying;
              console.log(`[SoloRestore] REPL ${id} wasPlaying=${wasPlaying} isCurrentlyPlaying=${isCurrentlyPlaying}`);
              if (wasPlaying && !isCurrentlyPlaying) {
                console.log(`[SoloRestore] Attempting restart for REPL ${id}`);
                let started = false;
                try {
                  if (el.editor?.repl?.start) {
                    el.editor.repl.start();
                    started = true;
                    console.log(`[SoloRestore] start() used for REPL ${id}`);
                    try { window._dynamicReplMarkPlayingFns && window._dynamicReplMarkPlayingFns[id] && window._dynamicReplMarkPlayingFns[id](); } catch {}
                  }
                } catch (e) {
                  console.warn(`[SoloRestore] start() failed for REPL ${id}:`, e.message);
                }
                if (!started) {
                  try {
                    if (el.editor?.toggle) {
                      el.editor.toggle();
                      started = true;
                      console.log(`[SoloRestore] toggle() fallback used for REPL ${id}`);
                      try { window._dynamicReplMarkPlayingFns && window._dynamicReplMarkPlayingFns[id] && window._dynamicReplMarkPlayingFns[id](); } catch {}
                    }
                  } catch (e) {
                    console.warn(`[SoloRestore] toggle() failed for REPL ${id}:`, e.message);
                  }
                }
                if (!started) {
                  // Last resort: re-evaluate code then try start again after a tick
                  try {
                    const code = el.editor?.code || el.getAttribute('code');
                    if (code && el.editor?.repl?.evaluate) {
                      el.editor.repl.evaluate(code);
                      console.log(`[SoloRestore] evaluate() fallback for REPL ${id}`);
                    }
                    setTimeout(() => {
                      try {
                        if (el.editor?.repl?.start) {
                          el.editor.repl.start();
                          console.log(`[SoloRestore] delayed start() succeeded for REPL ${id}`);
                          try { window._dynamicReplMarkPlayingFns && window._dynamicReplMarkPlayingFns[id] && window._dynamicReplMarkPlayingFns[id](); } catch {}
                        } else if (el.editor?.toggle) {
                          el.editor.toggle();
                          console.log(`[SoloRestore] delayed toggle() succeeded for REPL ${id}`);
                          try { window._dynamicReplMarkPlayingFns && window._dynamicReplMarkPlayingFns[id] && window._dynamicReplMarkPlayingFns[id](); } catch {}
                        }
                      } catch (e2) {
                        console.warn(`[SoloRestore] delayed restart failed for REPL ${id}:`, e2.message);
                      }
                    }, 120);
                  } catch (e) {
                    console.warn(`[SoloRestore] evaluate+delayed start fallback failed for REPL ${id}:`, e.message);
                  }
                }
              }
              if (el.editor?.repl) {
                try { el.editor.repl.solo = false; } catch {}
              }
            });
          }
        replRef.current._prevStates = null;
        window._dynamicSoloReplId = null;
      }
      setIsSolo(newSolo);
      if (replRef.current) {
        replRef.current.solo = newSolo;
        try { replRef.current.editor?.repl && (replRef.current.editor.repl.solo = newSolo); } catch {}
      }
      console.log(`DynamicStrudelTest: REPL ${instance.id} solo =>`, newSolo);
    };

    const applyRandomPattern = () => {
      const randomPattern = mockPatterns[Math.floor(Math.random() * mockPatterns.length)];
      if (replRef.current?.editor) {
        replRef.current.editor.setCode(randomPattern);
        setCurrentPattern(randomPattern);
        console.log(`DynamicStrudelTest: Applied random pattern to REPL ${instance.id}: ${randomPattern}`);
      }
    };

    return (
      <div className="bg-white p-4 rounded-lg shadow space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">REPL {instance.id}</h3>
          <button
            onClick={() => onRemove(instance.id)}
            className="px-2 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
          >
            Remove
          </button>
        </div>
        
        <div className="text-sm text-gray-600 font-mono bg-gray-100 p-2 rounded">
          {currentPattern}
        </div>
        
        <div 
          ref={containerRef}
          className="border border-gray-300 rounded p-2 min-h-[150px] bg-gray-50"
        />
        
        <div className="flex gap-2">
          <button
            onClick={handleSolo}
            className={`px-3 py-1 rounded text-sm font-semibold ${
              isSolo ? 'bg-yellow-400 text-gray-900 hover:bg-yellow-300' : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
            }`}
            title="Solo"
          >
            S
          </button>
          <button
            onClick={handleToggle}
            className={`px-3 py-1 rounded text-sm ${
              isPlaying
                ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          
          <button
            onClick={handleStop}
            className="px-3 py-1 bg-red-500 text-white rounded text-sm hover:bg-red-600"
          >
            Stop
          </button>
          
          <button
            onClick={applyRandomPattern}
            className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
          >
            Random Pattern
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">Dynamic Strudel REPL Test (Simplified)</h1>
        <p className="text-gray-600 mb-6">
          Following StrudelReplTest.jsx pattern exactly - no complex state management
        </p>
      </div>
      
      {/* Global Controls */}
      <div className="bg-gray-100 p-4 rounded-lg">
        <h2 className="text-lg font-semibold mb-3">Global Controls</h2>
        <div className="flex gap-3">
          <button
            onClick={createRepl}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Add New REPL
          </button>
          
          <button
            onClick={startAll}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Start All
          </button>
          
          <button
            onClick={stopAll}
            className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
          >
            Stop All
          </button>
          
          <button
            onClick={testAudioContext}
            className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
            title="Test AudioContext and play a beep"
          >
            Test Audio
          </button>
          
          <button
            onClick={debugStrudelInternals}
            className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
            title="Debug Strudel internals to find audio system"
          >
            Debug Strudel
          </button>
          
          <div className="ml-auto text-sm text-gray-600 flex items-center">
            Active REPLs: {replInstances.length}
          </div>
        </div>
      </div>

      {/* REPL Instances */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {replInstances.map(instance => (
          <ReplInstance 
            key={instance.id} 
            instance={instance} 
            onRemove={removeRepl}
          />
        ))}
      </div>
      
      {replInstances.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg mb-4">No REPLs created yet</p>
          <button
            onClick={createRepl}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            Create Your First REPL
          </button>
        </div>
      )}
      
      {/* Instructions */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <h3 className="font-semibold text-blue-900 mb-2">Testing Instructions:</h3>
        <ul className="text-blue-800 text-sm space-y-1">
          <li>• <strong>UNINTERRUPTED PLAYBACK:</strong> Creating new REPLs will briefly pause others but automatically restart them</li>
          <li>• Create multiple REPLs and start them playing</li>
          <li>• Add a new REPL while others are playing - they should resume automatically</li>
          <li>• <strong>Check Visual Feedback:</strong> Each REPL should maintain its own highlighting when playing</li>
          <li>• Test individual start/stop controls for each REPL</li>
          <li>• Use "Start All" and "Stop All" for global control</li>
          <li>• <strong>Sync/Solo:</strong> sync=true means REPLs play in time together, solo=false means all are audible</li>
          <li>• <strong>Smart Creation:</strong> REPLs remember their playing state and resume after creation conflicts</li>
        </ul>
      </div>
    </div>
  );
};

export default DynamicStrudelTest;
