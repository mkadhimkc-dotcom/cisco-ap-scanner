'use client';

import { useEffect, useMemo, useState } from 'react';
import DeviceList from '@/components/DeviceList';
import ManualEntryModal from '@/components/ManualEntryModal';
import ModeToggle from '@/components/ModeToggle';
import Scanner from '@/components/Scanner';
import Toasts from '@/components/Toasts';
import { buildCsv, buildExportFilename, downloadCsv } from '@/lib/csv';
import { normalizeMac, parseCiscoLabel } from '@/lib/parseCisco';
import { loadBatchName, loadDevices, loadMode, saveBatchName, saveDevices, saveMode } from '@/lib/storage';
import { DeviceRecord, ScanMode, ScannerStatus, ToastMessage } from '@/lib/types';
import { isValidEmail, nowIso, uid } from '@/lib/utils';

export default function HomePage() {
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [mode, setMode] = useState<ScanMode>('full');
  const [batchName, setBatchName] = useState('');
  const [status, setStatus] = useState<ScannerStatus>('paused');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isManualOpen, setManualOpen] = useState(false);

  const pushToast = (type: ToastMessage['type'], text: string) => {
    const id = uid();
    setToasts((curr) => [...curr, { id, type, text }]);
    window.setTimeout(() => {
      setToasts((curr) => curr.filter((t) => t.id !== id));
    }, 2600);
  };

  useEffect(() => {
    setDevices(loadDevices());
    setMode(loadMode());
    setBatchName(loadBatchName());
  }, []);

  useEffect(() => saveDevices(devices), [devices]);
  useEffect(() => saveMode(mode), [mode]);
  useEffect(() => saveBatchName(batchName), [batchName]);

  const checkDuplicate = (record: DeviceRecord, existing: DeviceRecord[]) => {
    if (record.mode !== 'full') return false;
    const currentSn = record.sn?.toUpperCase();
    const currentMac = normalizeMac(record.mac ?? '');
    return existing.some(
      (d) =>
        d.mode === 'full' &&
        ((currentSn && d.sn?.toUpperCase() === currentSn) ||
          (currentMac && normalizeMac(d.mac ?? '') === currentMac)),
    );
  };

  const addRecord = (raw: string, manual?: Partial<DeviceRecord>) => {
    const base: DeviceRecord = {
      id: uid(),
      mode,
      raw,
      createdAt: nowIso(),
      batchName: batchName.trim() || undefined,
      notes: manual?.notes,
    };

    const parsed = mode === 'full' ? parseCiscoLabel(raw) : {};
    const merged: DeviceRecord = {
      ...base,
      pid: manual?.pid ?? parsed.pid,
      sn: manual?.sn ?? parsed.sn,
      mac: manual?.mac ? normalizeMac(manual.mac) ?? manual.mac : parsed.mac,
      mfg: manual?.mfg ?? parsed.mfg,
    };

    setDevices((current) => {
      const final = { ...merged, isDup: checkDuplicate(merged, current) };
      return [final, ...current];
    });

    pushToast('success', `Scan saved (${mode.toUpperCase()})`);
  };

  const exportCsv = () => {
    if (!devices.length) {
      pushToast('info', 'No scans to export');
      return;
    }
    const csv = buildCsv(devices);
    const filename = buildExportFilename(batchName);
    downloadCsv(csv, filename);
    pushToast('success', `CSV exported: ${filename}`);
  };

  const emailCsv = async () => {
    if (!devices.length) {
      pushToast('info', 'No scans to export');
      return;
    }

    const to = window.prompt('Destination email address');
    if (!to || !isValidEmail(to)) {
      pushToast('error', 'Please provide a valid email address');
      return;
    }

    const csv = buildCsv(devices);
    const filename = buildExportFilename(batchName);

    try {
      const response = await fetch('/api/export-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, filename, csv }),
      });

      if (!response.ok) {
        throw new Error('Email export failed');
      }

      pushToast('success', `CSV emailed to ${to}`);
    } catch {
      pushToast('error', 'Failed to send email export');
    }
  };

  const statusLabel = useMemo(() => {
    if (status === 'live') return 'camera live';
    if (status === 'error') return 'error';
    return 'paused';
  }, [status]);

  return (
    <main className="appShell">
      <header className="appHeader panel">
        <h1>Cisco AP Scanner</h1>
        <p>{devices.length} total scans</p>
      </header>

      <div className="statusRow panel">
        <span className={`statusDot status-${status}`} />
        <span>Status: {statusLabel}</span>
      </div>

      <Scanner onDetected={(raw) => addRecord(raw)} onStatusChange={setStatus} onError={(m) => pushToast('error', m)} />

      <section className="panel controlsPanel">
        <ModeToggle mode={mode} onChange={setMode} />
        <label>
          Batch Name
          <input
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
            placeholder="Optional batch label"
            className="textInput"
          />
        </label>
      </section>

      <section className="stickyActions panel">
        <button className="btn btn-primary" onClick={() => setManualOpen(true)}>Manual Entry</button>
        <button className="btn btn-secondary" onClick={exportCsv}>Export CSV</button>
        <button className="btn btn-secondary" onClick={emailCsv}>Email CSV</button>
        <button
          className="btn btn-danger"
          onClick={() => {
            setDevices([]);
            pushToast('info', 'All scans cleared');
          }}
        >
          Clear All
        </button>
      </section>

      <DeviceList
        devices={devices}
        onDelete={(id) => setDevices((curr) => curr.filter((d) => d.id !== id))}
        onUpdateNotes={(id, notes) =>
          setDevices((curr) => curr.map((d) => (d.id === id ? { ...d, notes } : d)))
        }
      />

      <ManualEntryModal
        open={isManualOpen}
        mode={mode}
        onClose={() => setManualOpen(false)}
        onSave={(data) => addRecord(data.raw, data)}
      />

      <Toasts toasts={toasts} />
    </main>
  );
}
