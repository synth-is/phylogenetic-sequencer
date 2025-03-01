import { LINEAGE_SOUNDS_BUCKET_HOST } from '../constants';

export class CellDataFormatter {
  static formatCellData(data, experiment, evoRunId, config) {
    console.log('CellDataFormatter input:', { data, experiment, evoRunId, config });
    
    if (!data || !data.id) return null;

    // Extract render parameters from config
    const duration = config?.duration || "4";
    const noteDelta = config?.noteDelta || "0";
    const velocity = config?.velocity || "1";

    // Determine if this is a rendered version or original
    const isRendered = config?.isRendered || false;
    const renderKey = isRendered ? `${data.id}-${duration}_${noteDelta}_${velocity}` : data.id;
    
    // Build audio URL using appropriate parameters
    // const audioUrl = `${LINEAGE_SOUNDS_BUCKET_HOST}/${experiment}/${evoRunId}/${data.id}-${duration}_${noteDelta}_${velocity}.wav`;
    const audioUrl = `${LINEAGE_SOUNDS_BUCKET_HOST}/evorenders/${evoRunId}/${data.id}-${duration}_${noteDelta}_${velocity}.wav`;

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
      config: {  // Add this to preserve callbacks
        ...config,
        onEnded: config?.onEnded,
        duration,
        noteDelta,
        velocity,
        isRendered
      },
      // Add these fields directly at the top level for convenience
      experiment,
      evoRunId,
      duration: parseFloat(duration),
      noteDelta: parseFloat(noteDelta),
      velocity: parseFloat(velocity),
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