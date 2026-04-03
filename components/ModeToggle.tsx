'use client';

import { ScanMode } from '@/lib/types';

type Props = {
  mode: ScanMode;
  onChange: (mode: ScanMode) => void;
};

export default function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="modeToggle" role="group" aria-label="Scan mode">
      <button
        type="button"
        className={mode === 'full' ? 'active' : ''}
        onClick={() => onChange('full')}
        aria-pressed={mode === 'full'}
      >
        Full
      </button>
      <button
        type="button"
        className={mode === 'light' ? 'active' : ''}
        onClick={() => onChange('light')}
        aria-pressed={mode === 'light'}
      >
        Light
      </button>
    </div>
  );
}
