export enum GameState {
  IDLE = 'IDLE',
  FETCHING_RNG = 'FETCHING_RNG',
  RUNNING = 'RUNNING',
  CASHED_OUT = 'CASHED_OUT',
  CRASHED = 'CRASHED'
}

export const COST_TO_PLAY = 10;
export const START_BALANCE = 100;
export const MAX_MULTIPLIER = 25;
export const HOUSE_EDGE = 0.06;
export const TARGET_MULTIPLIER = 3.4;
export const TARGET_TIME = 20;
export const GROWTH_K = Math.log(TARGET_MULTIPLIER) / TARGET_TIME;
