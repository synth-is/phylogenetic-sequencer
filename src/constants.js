export const DEFAULT_STRUDEL_CODE = `
note("c2 <eb2 <g2 g1>>".fast(2))
.sound("<sawtooth square triangle sine>").delay(1)
._scope()
`.trim();

export const LINEAGE_SOUNDS_BUCKET_HOST = "https://ns9648k.web.sigma2.no";

export const UNIT_TYPES = {
  TRAJECTORY: 'trajectory',
  SEQUENCING: 'sequencing',
  SEQUENCE: 'Sequence',
  LIVE_CODE: 'Live Code'
};

export const DEFAULT_UNIT_CONFIGS = {
  [UNIT_TYPES.TRAJECTORY]: {
    speed: 1,
    radius: 50,
    direction: 'clockwise',
    volume: -10,
    active: true,
    muted: false,
    soloed: false
  },
  [UNIT_TYPES.SEQUENCE]: {
    pattern: '1/4',
    steps: 8,
    volume: -10,
    active: true,
    muted: false,
    soloed: false
  },
  [UNIT_TYPES.LIVE_CODE]: {
    strudelCode: DEFAULT_STRUDEL_CODE,
    liveCodeEngine: 'Strudel',
    volume: -10,
    active: true,
    muted: false,
    soloed: false
  }
};