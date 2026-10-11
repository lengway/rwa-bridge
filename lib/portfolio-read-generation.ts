// Single-process read snapshot generation. Only a newly chain-verified action
// advances this; browser refreshes cannot invalidate snapshots or cause bursts.
let generation = 0;
export function portfolioReadGeneration() { return generation; }
export function advancePortfolioReadGeneration() { generation++; }
