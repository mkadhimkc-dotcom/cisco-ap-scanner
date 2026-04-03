import { DeviceRecord } from '@/lib/types';

const columns = [
  'index',
  'mode',
  'batch_name',
  'pid',
  'serial_number',
  'mac_address',
  'mfg_date',
  'notes',
  'raw_scan',
  'created_at',
  'duplicate',
] as const;

export const escapeCsvValue = (value: unknown) => {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

export const sanitizeFileSegment = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

export const buildCsv = (devices: DeviceRecord[]) => {
  const rows = devices.map((d, index) => [
    index + 1,
    d.mode,
    d.batchName ?? '',
    d.pid ?? '',
    d.sn ?? '',
    d.mac ?? '',
    d.mfg ?? '',
    d.notes ?? '',
    d.raw,
    d.createdAt,
    d.isDup ? 'yes' : 'no',
  ]);

  return [columns.join(','), ...rows.map((r) => r.map(escapeCsvValue).join(','))].join('\n');
};

export const buildExportFilename = (batchName?: string) => {
  const date = new Date().toISOString().slice(0, 10);
  const batch = batchName ? sanitizeFileSegment(batchName) : '';
  return batch ? `cisco_ap_${batch}_${date}.csv` : `cisco_ap_${date}.csv`;
};

export const downloadCsv = (csv: string, filename: string) => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};
