import { ParsedCiscoFields } from '@/lib/types';

const PID_LABEL = /(?:\bPID\b|\bMODEL\b|\bPRODUCT\s*ID\b)\s*[:=]?\s*([A-Z0-9][A-Z0-9-]{3,})/i;
const SN_LABEL = /(?:\bS\/?N\b|\bSERIAL(?:\s*NUMBER)?\b|\bSN\b)\s*[:=]?\s*([A-Z0-9]{8,20})/i;
const MAC_LABEL = /(?:\bMAC(?:\s*ADDRESS)?\b)\s*[:=]?\s*([0-9A-Fa-f:.\-]{12,20})/i;
const MFG_LABEL = /(?:\bMFG\b|\bDATE\b|\bDOM\b|\bMFG\s*DATE\b)\s*[:=]?\s*([0-9]{4}[-\/.][0-9]{1,2}[-\/.][0-9]{1,2}|[0-9]{1,2}[-\/.][0-9]{1,2}[-\/.][0-9]{2,4}|[A-Za-z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{4})/i;

const PID_FALLBACK = /\b(?:C\d{3,4}[A-Z0-9-]*|CW\d{4}[A-Z0-9-]*|AIR-AP[A-Z0-9-]+)\b/i;
const SN_FALLBACK = /\b[A-Z]{3}[A-Z0-9]{8,12}\b/;
const MAC_FALLBACK = /\b(?:[0-9A-Fa-f]{12}|[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}|[0-9A-Fa-f]{2}(?::|-)){5}[0-9A-Fa-f]{2}\b/;

const cleanToken = (value?: string) => value?.trim().replace(/[;,]+$/, '');

export const normalizeMac = (value: string): string | undefined => {
  const hex = value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
  if (hex.length !== 12) return undefined;
  return hex.match(/.{1,2}/g)?.join(':');
};

const normalizeDate = (value: string) => {
  const raw = value.trim().replace(/[.]/g, '/');
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return value.trim();
  return parsed.toISOString().slice(0, 10);
};

export const parseCiscoLabel = (raw: string): ParsedCiscoFields => {
  const text = raw.replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return {};

  const pid = cleanToken(text.match(PID_LABEL)?.[1] ?? text.match(PID_FALLBACK)?.[0]);
  const sn = cleanToken(text.match(SN_LABEL)?.[1] ?? text.match(SN_FALLBACK)?.[0]);
  const macRaw = cleanToken(text.match(MAC_LABEL)?.[1] ?? text.match(MAC_FALLBACK)?.[0]);
  const mfgRaw = cleanToken(text.match(MFG_LABEL)?.[1]);

  return {
    pid,
    sn,
    mac: macRaw ? normalizeMac(macRaw) : undefined,
    mfg: mfgRaw ? normalizeDate(mfgRaw) : undefined,
  };
};
