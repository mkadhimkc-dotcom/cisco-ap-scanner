import { DeviceRecord, ScanMode } from '@/lib/types';

const KEYS = {
  devices: 'cisco_ap_scanner_devices_v1',
  mode: 'cisco_ap_scanner_mode_v1',
  batch: 'cisco_ap_scanner_batch_v1',
};

const canUseStorage = () => typeof window !== 'undefined' && !!window.localStorage;

const safeParse = <T>(value: string | null): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

const isDevice = (value: unknown): value is DeviceRecord => {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<DeviceRecord>;
  return (
    typeof v.id === 'string' &&
    (v.mode === 'full' || v.mode === 'light') &&
    typeof v.raw === 'string' &&
    typeof v.createdAt === 'string'
  );
};

export const loadDevices = (): DeviceRecord[] => {
  if (!canUseStorage()) return [];
  const parsed = safeParse<unknown[]>(window.localStorage.getItem(KEYS.devices));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isDevice);
};

export const saveDevices = (devices: DeviceRecord[]) => {
  if (!canUseStorage()) return;
  window.localStorage.setItem(KEYS.devices, JSON.stringify(devices));
};

export const loadMode = (): ScanMode => {
  if (!canUseStorage()) return 'full';
  const mode = window.localStorage.getItem(KEYS.mode);
  return mode === 'light' ? 'light' : 'full';
};

export const saveMode = (mode: ScanMode) => {
  if (!canUseStorage()) return;
  window.localStorage.setItem(KEYS.mode, mode);
};

export const loadBatchName = (): string => {
  if (!canUseStorage()) return '';
  return window.localStorage.getItem(KEYS.batch) ?? '';
};

export const saveBatchName = (name: string) => {
  if (!canUseStorage()) return;
  window.localStorage.setItem(KEYS.batch, name);
};
