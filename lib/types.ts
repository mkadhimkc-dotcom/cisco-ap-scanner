export type ScanMode = 'full' | 'light';

export type ScannerStatus = 'live' | 'paused' | 'error';

export interface DeviceRecord {
  id: string;
  mode: ScanMode;
  raw: string;
  pid?: string;
  sn?: string;
  mac?: string;
  mfg?: string;
  notes?: string;
  isDup?: boolean;
  batchName?: string;
  createdAt: string;
}

export interface EmailExportPayload {
  to: string;
  filename: string;
  csv: string;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  text: string;
}

export interface ParsedCiscoFields {
  pid?: string;
  sn?: string;
  mac?: string;
  mfg?: string;
}
