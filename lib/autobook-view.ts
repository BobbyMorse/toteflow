export interface StratStats {
  id: string;
  name: string;
  thesis: string;
  config: { enabled: boolean; evThreshold: number; stake: number; fireAtPhase: string };
  total: number;
  open: number;
  staged: number;
  aborted: number;
  settled: number;
  won: number;
  lost: number;
  hitRate: number | null;
  realizedPL: number;
  totalStaked: number;
  roi: number | null;
  capturedEV: number;
  avgClv: number | null;
  avgClosingEV: number | null;
}

export interface AutobookState {
  globalEnabled: boolean;
  strategies: StratStats[];
  totals: {
    total: number; open: number; staged: number; aborted: number;
    settled: number; won: number; lost: number;
    hitRate: number | null;
    realizedPL: number;
    totalStaked: number;
    roi: number | null;
    predictedEdge: number;
    avgClosingEV: number | null;
  };
  today: {
    settled: number; won: number; lost: number;
    hitRate: number | null;
    realizedPL: number;
    totalStaked: number;
    roi: number | null;
  };
  bookerLog: { ts: number; msg: string }[];
  graderLog: { ts: number; msg: string }[];
}
