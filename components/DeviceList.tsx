'use client';

import { DeviceRecord } from '@/lib/types';
import { prettyDateTime } from '@/lib/utils';

type Props = {
  devices: DeviceRecord[];
  onDelete: (id: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
};

export default function DeviceList({ devices, onDelete, onUpdateNotes }: Props) {
  if (!devices.length) {
    return <section className="panel emptyState">No scans yet. Start camera and scan a Cisco label.</section>;
  }

  return (
    <section className="deviceList">
      {devices.map((device) => (
        <article key={device.id} className={`panel deviceCard ${device.isDup ? 'dup' : ''}`}>
          <div className="cardTop">
            <span className="modeBadge">{device.mode.toUpperCase()}</span>
            {device.isDup && <span className="dupBadge">Duplicate</span>}
            <button className="btn btn-ghost" onClick={() => onDelete(device.id)}>
              Delete
            </button>
          </div>

          {device.mode === 'full' ? (
            <div className="fieldGrid">
              <p><strong>PID:</strong> {device.pid || '—'}</p>
              <p><strong>SN:</strong> {device.sn || '—'}</p>
              <p><strong>MAC:</strong> {device.mac || '—'}</p>
              <p><strong>MFG:</strong> {device.mfg || '—'}</p>
            </div>
          ) : (
            <p className="rawProminent">{device.raw}</p>
          )}

          {device.mode === 'full' && <p className="rawLine"><strong>Raw:</strong> {device.raw}</p>}
          <p className="metaLine">{prettyDateTime(device.createdAt)}</p>
          <textarea
            className="notesInput"
            placeholder="Notes"
            value={device.notes ?? ''}
            onChange={(e) => onUpdateNotes(device.id, e.target.value)}
            rows={2}
          />
        </article>
      ))}
    </section>
  );
}
