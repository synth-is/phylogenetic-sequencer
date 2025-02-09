import { LINEAGE_SOUNDS_BUCKET_HOST } from '../constants';

export class CellDataFormatter {
  static formatCellData(data, experiment, evoRunId, config) {
    console.log('CellDataFormatter input:', { data, experiment, evoRunId, config });
    
    if (!data || !data.id) return null;

    // Ensure we pass through the config callbacks
    return {
      audioUrl: `${LINEAGE_SOUNDS_BUCKET_HOST}/${experiment}/${evoRunId}/${data.id}-${config?.duration || "4"}_${config?.noteDelta || "0"}_${config?.velocity || "1"}.wav`,
      genomeId: data.id,
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
        onEnded: config?.onEnded
      }
    };
  }
}