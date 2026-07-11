export interface PowerReading {
  id?: string;
  timestamp: any; // Firestore Timestamp or ISO string
  voltage: number; // Volts (V)
  current: number; // Amperes (A)
  power: number; // Watts (W)
  energy: number; // Kilowatt-hours (kWh)
  frequency: number; // Hertz (Hz)
  pf: number; // Power Factor (0.0 to 1.0)
  deviceId: string;
}

export interface DeviceStatus {
  deviceId: string;
  lastUpdated: any; // Timestamp
  isOnline: boolean;
  deviceName?: string;
}
