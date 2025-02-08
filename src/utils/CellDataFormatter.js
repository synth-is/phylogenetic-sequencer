import { LINEAGE_SOUNDS_BUCKET_HOST } from '../constants';

export class CellDataFormatter {
  static formatCellData(data, experiment, evoRunId, config) {
    console.log('CellDataFormatter input:', { data, experiment, evoRunId, config });
    
    if (!data || !data.id) return null;

    const duration = config?.duration || "4";
    const noteDelta = config?.noteDelta || "0";
    const velocity = config?.velocity || "1";

    const fileName = `${data.id}-${duration}_${noteDelta}_${velocity}.wav`;
    const audioUrl = `${LINEAGE_SOUNDS_BUCKET_HOST}/${experiment}/${evoRunId}/${fileName}`;

    return {
      audioUrl,
      genomeId: data.id,
      score: data.s || 0,
      generation: data.gN || 0,
      position: { x: 0, y: 0 },  // Optional position data
      metadata: {
        ...data,
        experiment,
        evoRunId
      }
    };
  }
}