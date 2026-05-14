declare module "../lib/teknikSinyalEngine.js" {
  const finansTeknikSinyalEngine: {
    analyze: (
      candles: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>,
      opts?: { symbol?: string; interval?: string },
    ) => {
      signals: Array<{ time: number; side: string; label?: string }>;
      lastSignal: { time: number; side: string; label?: string; score?: number } | null;
      summary?: string;
    };
  };
  export = finansTeknikSinyalEngine;
}
