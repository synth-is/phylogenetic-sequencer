export const DEFAULT_STRUDEL_CODE = `
note("c2 <eb2 <g2 g1>>".fast(2))
.sound("<sawtooth square triangle sine>").delay(1)
._scope()
`.trim();

export const LINEAGE_SOUNDS_BUCKET_HOST = "https://ns9648k.web.sigma2.no";

export const UNIT_TYPES = {
  TRAJECTORY: 'TRAJECTORY',
  SEQUENCING: 'SEQUENCING',
  LOOPING: 'LOOPING'  // Add new unit type
};

export const DEFAULT_UNIT_CONFIGS = {
  [UNIT_TYPES.TRAJECTORY]: {
    speed: 1,
    radius: 50,
    direction: 'clockwise',
    volume: -10,
    active: true,
    muted: false,
    soloed: false,
    maxVoices: 4
  },
  [UNIT_TYPES.SEQUENCING]: {
    active: true,
    muted: false,
    soloed: false,
    volume: -12,
    bars: 1,        // Set default to 1 bar
    bpm: 120,
    startOffset: 0
  },
  [UNIT_TYPES.LIVE_CODE]: {
    strudelCode: DEFAULT_STRUDEL_CODE,
    liveCodeEngine: 'Strudel',
    volume: -10,
    active: true,
    muted: false,
    soloed: false
  },
  [UNIT_TYPES.LOOPING]: {
    volume: -10,
    active: true,
    muted: false,
    soloed: false,
    maxVoices: 4,
    pitch: 0,
    syncEnabled: false  // Add this line to initialize syncEnabled
  }
};