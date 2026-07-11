import { PowerReading } from "../types";

// Helper to safely parse any Firestore / JS Date / ISO timestamp
export const getReadingDate = (timestamp: any): Date => {
  if (!timestamp) return new Date();
  if (typeof timestamp.toDate === "function") {
    return timestamp.toDate();
  } else if (timestamp instanceof Date) {
    return timestamp;
  } else if (timestamp.seconds) {
    return new Date(timestamp.seconds * 1000);
  } else {
    return new Date(timestamp);
  }
};

// Calculate start and end date for current billing period (cutoff on 25th)
export function getCurrentBillingPeriod(customDate?: Date): { start: Date; end: Date } {
  const now = customDate || new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed (0 = Jan)
  const day = now.getDate();

  let start: Date;
  let end: Date;

  if (day >= 26) {
    // Current cycle starts on 26th of this month and ends on 25th of next month
    start = new Date(year, month, 26, 0, 0, 0, 0);
    if (month === 11) {
      end = new Date(year + 1, 0, 25, 23, 59, 59, 999);
    } else {
      end = new Date(year, month + 1, 25, 23, 59, 59, 999);
    }
  } else {
    // Current cycle started on 26th of previous month and ends on 25th of this month
    if (month === 0) {
      start = new Date(year - 1, 11, 26, 0, 0, 0, 0);
    } else {
      start = new Date(year, month - 1, 26, 0, 0, 0, 0);
    }
    end = new Date(year, month, 25, 23, 59, 59, 999);
  }

  return { start, end };
}

// Calculate actual energy consumed in a period taking resets into account
export function getKWhConsumedInPeriod(readings: PowerReading[]): number {
  if (readings.length < 2) return 0;

  // Sort oldest first
  const sorted = [...readings].sort((a, b) => {
    const tA = getReadingDate(a.timestamp).getTime();
    const tB = getReadingDate(b.timestamp).getTime();
    return tA - tB;
  });

  let totalDelta = 0;
  let lastEnergy = sorted[0].energy;

  for (let i = 1; i < sorted.length; i++) {
    const currentEnergy = sorted[i].energy;
    if (currentEnergy >= lastEnergy) {
      totalDelta += (currentEnergy - lastEnergy);
    } else {
      // Reset occurred! Assume it reset to 0 and added currentEnergy
      totalDelta += currentEnergy;
    }
    lastEnergy = currentEnergy;
  }

  return totalDelta;
}

// Thailand Progressive Residential Tariff (ประเภท 1.1)
export interface CostStep {
  name: string;
  rate: number;
  units: number;
  cost: number;
}

export interface ProgressiveCostResult {
  baseCost: number;
  serviceFee: number;
  ftCost: number;
  ftRate: number;
  vat: number;
  totalCost: number;
  breakdown: CostStep[];
}

export function calculateProgressiveCost(
  kwh: number,
  customFtRate?: number,
  customServiceFee?: number,
  customVatRate?: number
): ProgressiveCostResult {
  const steps = [
    { limit: 15, rate: 2.3488, label: "15 หน่วยแรก (0 - 15)" },
    { limit: 10, rate: 2.9882, label: "10 หน่วยถัดไป (16 - 25)" },
    { limit: 10, rate: 3.2405, label: "10 หน่วยถัดไป (26 - 35)" },
    { limit: 65, rate: 3.6237, label: "65 หน่วยถัดไป (36 - 100)" },
    { limit: 50, rate: 3.7171, label: "50 หน่วยถัดไป (101 - 150)" },
    { limit: 250, rate: 4.2218, label: "250 หน่วยถัดไป (151 - 400)" },
    { limit: Infinity, rate: 4.4217, label: "ส่วนที่เกิน 400 หน่วย (> 400)" },
  ];

  let remaining = Math.max(0, kwh);
  let baseCost = 0;
  const breakdown: CostStep[] = [];

  for (const step of steps) {
    if (remaining <= 0) break;
    const units = Math.min(remaining, step.limit);
    const cost = units * step.rate;
    baseCost += cost;
    breakdown.push({
      name: step.label,
      rate: step.rate,
      units: parseFloat(units.toFixed(2)),
      cost: parseFloat(cost.toFixed(2)),
    });
    remaining -= units;
  }

  // Monthly service fee: 8.19 THB (if <= 150 units), 38.22 THB (if > 150 units) unless custom specified
  const serviceFee = customServiceFee !== undefined ? customServiceFee : (kwh > 150 ? 38.22 : 8.19);
  const ftRate = customFtRate !== undefined ? customFtRate : 0.3972; // Average Ft rate (THB / unit)
  const ftCost = kwh * ftRate;

  const subTotal = baseCost + serviceFee + ftCost;
  const vatPercent = customVatRate !== undefined ? customVatRate : 7;
  const vat = subTotal * (vatPercent / 100);
  const totalCost = subTotal + vat;

  return {
    baseCost: parseFloat(baseCost.toFixed(2)),
    serviceFee,
    ftCost: parseFloat(ftCost.toFixed(2)),
    ftRate,
    vat: parseFloat(vat.toFixed(2)),
    totalCost: parseFloat(totalCost.toFixed(2)),
    breakdown,
  };
}
