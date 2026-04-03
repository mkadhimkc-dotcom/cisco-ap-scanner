'use client';

import { FormEvent, useEffect, useState } from 'react';
import { DeviceRecord, ScanMode } from '@/lib/types';

type ManualPayload = Pick<DeviceRecord, 'raw' | 'pid' | 'sn' | 'mac' | 'mfg' | 'notes'>;

type Props = {
  open: boolean;
  mode: ScanMode;
  onClose: () => void;
  onSave: (data: ManualPayload) => void;
};

export default function ManualEntryModal({ open, mode, onClose, onSave }: Props) {
  const [raw, setRaw] = useState('');
  const [pid, setPid] = useState('');
  const [sn, setSn] = useState('');
  const [mac, setMac] = useState('');
  const [mfg, setMfg] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!open) return;
    setRaw('');
    setPid('');
    setSn('');
    setMac('');
    setMfg('');
    setNotes('');
  }, [open]);

  if (!open) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!raw.trim()) return;
    onSave({
      raw: raw.trim(),
      pid: mode === 'full' ? pid.trim() || undefined : undefined,
      sn: mode === 'full' ? sn.trim() || undefined : undefined,
      mac: mode === 'full' ? mac.trim() || undefined : undefined,
      mfg: mode === 'full' ? mfg.trim() || undefined : undefined,
      notes: notes.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="modalCard" onClick={(e) => e.stopPropagation()}>
        <h2>Manual Entry ({mode.toUpperCase()})</h2>
        <form onSubmit={submit} className="manualForm">
          <label>
            Raw scan value
            <textarea value={raw} onChange={(e) => setRaw(e.target.value)} required rows={3} />
          </label>
          {mode === 'full' && (
            <>
              <label>PID<input value={pid} onChange={(e) => setPid(e.target.value)} /></label>
              <label>Serial Number<input value={sn} onChange={(e) => setSn(e.target.value)} /></label>
              <label>MAC Address<input value={mac} onChange={(e) => setMac(e.target.value)} /></label>
              <label>MFG Date<input value={mfg} onChange={(e) => setMfg(e.target.value)} /></label>
            </>
          )}
          <label>
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </label>
          <div className="modalActions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
