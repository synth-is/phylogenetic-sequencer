import { LINEAGE_SOUNDS_BUCKET_HOST } from '../constants';
import VoiceParameterRegistry from './VoiceParameterRegistry';

export class CellDataFormatter {
  static formatCellData(data, experiment, evoRunId, config) {
    console.log('CellDataFormatter input:', { data, experiment, evoRunId, config });
    
    if (!data || !data.id) return null;

    // Extract render parameters from config, applying any modifications
    let duration, noteDelta, velocity;

    // Get any global parameter overrides from VoiceParameterRegistry
    const globalParams = VoiceParameterRegistry.getGlobalParameters();
    
    // Log the global parameters to debug
    console.log('CellDataFormatter: Available global parameters:', globalParams);
    
    // Apply modified parameters if available, otherwise use config values
    duration = globalParams.duration !== undefined ? 
      globalParams.duration : 
      (config?.duration || "4");
    
    noteDelta = globalParams.pitch !== undefined ? 
      globalParams.pitch : 
      (config?.noteDelta || "0");
    
    velocity = globalParams.velocity !== undefined ? 
      globalParams.velocity : 
      (config?.velocity || "1");
    
    console.log('CellDataFormatter: Using parameters:', {
      fromRegistry: !!globalParams,
      duration,
      noteDelta,
      velocity,
      configValues: {
        duration: config?.duration,
        noteDelta: config?.noteDelta,
        velocity: config?.velocity
      }
    });

    // Store original values to use as defaults
    const originalDuration = parseFloat(duration);
    const originalPitch = parseFloat(noteDelta);  
    const originalVelocity = parseFloat(velocity);

    // Determine if this is a rendered version or original
    const isRendered = config?.isRendered || false;
    const renderKey = isRendered ? `${data.id}-${duration}_${noteDelta}_${velocity}` : data.id;
    
    // Build audio URL using appropriate parameters
    const audioUrl = `${LINEAGE_SOUNDS_BUCKET_HOST}/evorenders/${evoRunId}/${data.id}-${duration}_${noteDelta}_${velocity}.wav`;

    // Ensure we pass through the config callbacks, but update the values
    const updatedConfig = {
      ...config,
      onEnded: config?.onEnded,
      onLoopStateChanged: config?.onLoopStateChanged,
      duration: duration,
      noteDelta: noteDelta,
      velocity: velocity,
      isRendered
    };
    
    console.log('CellDataFormatter: Produced config:', updatedConfig);

    // Ensure we pass through the config callbacks
    return {
      audioUrl,
      genomeId: data.id,
      renderKey,
      score: data.s || 0,
      generation: data.gN || 0,
      position: { x: 0, y: 0 },
      metadata: {
        ...data,
        experiment,
        evoRunId
      },
      config: updatedConfig,
      // Add these fields directly at the top level for convenience
      experiment,
      evoRunId,
      duration: parseFloat(duration),
      noteDelta: parseFloat(noteDelta),
      velocity: parseFloat(velocity),
      // Store original values to use as defaults
      originalDuration,
      originalPitch,
      originalVelocity,
      isRendered,
      // Add render metadata for potential SoundRenderer fallback
      renderParams: {
        duration: parseFloat(duration),
        pitch: parseFloat(noteDelta),
        velocity: parseFloat(velocity)
      }
    };
  }
}