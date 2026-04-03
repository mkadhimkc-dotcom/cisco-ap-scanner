'use client';

import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScannerStatus } from '@/lib/types';

type Props = {
  onDetected: (rawText: string) => void;
  onStatusChange: (status: ScannerStatus) => void;
  onError: (message: string) => void;
};

const SCAN_COOLDOWN_MS = 1300;

export default function Scanner({ onDetected, onStatusChange, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [running, setRunning] = useState(false);
  const [lastDetected, setLastDetected] = useState<{ value: string; at: number } | null>(null);

  const reader = useMemo(() => new BrowserMultiFormatReader(), []);

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    setRunning(false);
    onStatusChange('paused');
  }, [onStatusChange]);

  const start = useCallback(async () => {
    if (!videoRef.current) return;
    if (running) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      videoRef.current.playsInline = true;
      videoRef.current.muted = true;
      await videoRef.current.play();

      readerRef.current = reader;
      controlsRef.current = await reader.decodeFromStream(stream, videoRef.current, (result, err) => {
        if (err) return;
        if (!result) return;
        const value = result.getText().trim();
        if (!value) return;

        const now = Date.now();
        if (lastDetected && lastDetected.value === value && now - lastDetected.at < SCAN_COOLDOWN_MS) {
          return;
        }

        setLastDetected({ value, at: now });
        onDetected(value);
      });

      setRunning(true);
      onStatusChange('live');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to access camera. Ensure Safari camera permission is enabled.';
      onStatusChange('error');
      onError(
        `Camera access is blocked or unavailable. On iPhone, go to Settings → Safari → Camera → Allow. (${message})`,
      );
    }
  }, [lastDetected, onDetected, onError, onStatusChange, reader, running]);

  useEffect(() => stop, [stop]);

  return (
    <section className="panel scannerPanel">
      <div className="videoWrap">
        <video ref={videoRef} className="scannerVideo" autoPlay muted playsInline />
        <div className="scannerOverlay" aria-hidden="true" />
      </div>
      <div className="scanActions">
        <button className="btn btn-primary" onClick={start} disabled={running}>
          Start Scanning
        </button>
        <button className="btn btn-secondary" onClick={stop} disabled={!running}>
          Stop
        </button>
      </div>
    </section>
  );
}
