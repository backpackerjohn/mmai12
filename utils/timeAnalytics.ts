import { EnergyTag, CompletionRecord, UserDifficulty } from '../types';

const HISTORY_KEY = 'momentumMapCompletionHistory';
const MAX_RECORDS_PER_TAG = 100;

export const getCompletionHistory = (): Record<EnergyTag, CompletionRecord[]> => {
    try {
        const stored = localStorage.getItem(HISTORY_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Ensure all energy tags are present
            const fullHistory: Record<EnergyTag, CompletionRecord[]> = {} as any;
            for (const tag of Object.values(EnergyTag)) {
                fullHistory[tag] = parsed[tag] || [];
            }
            return fullHistory;
        }
    } catch (e) {
        console.error("Failed to parse completion history:", e);
    }
    // Return empty structure if not found or error
    return Object.values(EnergyTag).reduce((acc, tag) => ({ ...acc, [tag]: [] }), {} as Record<EnergyTag, CompletionRecord[]>);
};

const saveCompletionHistory = (history: Record<EnergyTag, CompletionRecord[]>) => {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        console.error("Failed to save completion history:", e);
    }
};

export const addRecordToHistory = (record: Omit<CompletionRecord, 'id'>): Record<EnergyTag, CompletionRecord[]> => {
    const history = getCompletionHistory();
    const newRecord: CompletionRecord = { ...record, id: `cr-${Date.now()}` };
    
    const recordsForTag = history[record.energyTag] || [];
    recordsForTag.push(newRecord);

    // Prune old records to prevent localStorage bloat, keeping the most recent
    if (recordsForTag.length > MAX_RECORDS_PER_TAG) {
        recordsForTag.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
        history[record.energyTag] = recordsForTag.slice(0, MAX_RECORDS_PER_TAG);
    } else {
        history[record.energyTag] = recordsForTag;
    }

    saveCompletionHistory(history);
    return history;
};

export const resetCompletionHistory = () => {
    localStorage.removeItem(HISTORY_KEY);
};

/**
 * Calculates an Exponential Moving Average.
 */
const calculateEWMA = (data: number[], alpha: number = 0.3): number => {
  if (data.length === 0) return 0;
  // The reduce method applies the EWMA formula iteratively.
  // It starts with the first value as the initial EWMA.
  return data.reduce((ewma, value) => alpha * value + (1 - alpha) * ewma, data[0]);
};


/**
 * Generates a personalized time estimate for a new chunk based on historical data.
 */
export const getPersonalizedEstimate = (
  history: Record<EnergyTag, CompletionRecord[]>,
  newChunkInfo: { energyTag: EnergyTag; subStepCount: number; },
  sensitivity: number = 0.3 // Learning sensitivity (alpha for EWMA)
): { p50: number; p90: number; confidence: 'low' | 'medium' | 'high' } | null => {
  const relevantRecords = history[newChunkInfo.energyTag] || [];

  if (relevantRecords.length < 5) {
    return null; // Not enough data for a reliable estimate
  }

  // Adjust historical durations based on user-reported difficulty
  const adjustedDurations = relevantRecords.map(r => r.actualDurationMinutes / r.difficulty);
  
  // Complexity model: duration per sub-step
  const totalAdjustedMinutes = adjustedDurations.reduce((sum, d) => sum + d, 0);
  const totalSubSteps = relevantRecords.reduce((sum, r) => sum + r.subStepCount, 0);
  if (totalSubSteps === 0) return null; // Avoid division by zero
  const avgMinutesPerSubStep = totalAdjustedMinutes / totalSubSteps;
  const complexityBasedEstimate = avgMinutesPerSubStep * newChunkInfo.subStepCount;

  // Recent performance model (EWMA)
  // Sort records chronologically for EWMA calculation
  const sortedRecords = [...relevantRecords].sort((a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime());
  const recentPerformanceEstimate = calculateEWMA(
    sortedRecords.map(r => r.actualDurationMinutes / r.difficulty),
    sensitivity
  );
  
  // Blend estimates: 50% based on complexity, 50% based on recent performance
  const blendedP50 = Math.round(complexityBasedEstimate * 0.5 + recentPerformanceEstimate * 0.5);

  // Calculate variance for P90
  const variance = adjustedDurations
    .map(d => (d - blendedP50) ** 2)
    .reduce((sum, sq) => sum + sq, 0) / adjustedDurations.length;
  const stdDev = Math.sqrt(variance);
  
  // P90 is roughly P50 + 1.3 standard deviations
  const blendedP90 = Math.round(blendedP50 + 1.3 * stdDev);

  // Determine confidence level based on number of data points
  const confidence = relevantRecords.length < 10 ? 'low' : relevantRecords.length < 25 ? 'medium' : 'high';
  
  // Final cleanup for reasonable estimates
  const finalP50 = Math.max(5, blendedP50);
  const finalP90 = Math.max(finalP50 + 5, blendedP90); // Ensure P90 is always meaningfully larger

  return { p50: finalP50, p90: finalP90, confidence };
};
