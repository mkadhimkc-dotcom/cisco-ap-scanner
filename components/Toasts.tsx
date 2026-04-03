'use client';

import { ToastMessage } from '@/lib/types';

type Props = {
  toasts: ToastMessage[];
};

export default function Toasts({ toasts }: Props) {
  return (
    <div className="toastStack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}
