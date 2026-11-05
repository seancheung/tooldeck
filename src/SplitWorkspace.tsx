import { useTranslator } from './i18n';
import { useRef, useState, type ReactNode } from 'react';

export function SplitWorkspace({ children }: { children: [ReactNode, ReactNode] }) {
  const tr = useTranslator();
  const container = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [ratio, setRatio] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('tooldeck:splitRatio') || '0.39');
      return Number.isFinite(saved) && saved > 0 && saved < 1 ? saved : .39;
    } catch { return .39; }
  });
  const current = useRef(ratio);
  function update(next: number) {
    const width = (container.current?.clientWidth || 0) - 9;
    if (width < 520) return;
    current.current = Math.max(240 / width, Math.min(1 - 280 / width, next));
    setRatio(current.current);
  }
  function persist() {
    try { localStorage.setItem('tooldeck:splitRatio', String(current.current)); } catch {}
  }
  return <div ref={container} className="workspace resizable-workspace" style={{ gridTemplateColumns: `clamp(240px, calc((100% - 9px) * ${ratio}), calc(100% - 289px)) 9px minmax(280px, 1fr)` }}>
    {children[0]}
    <div className="workspace-divider" role="separator" aria-label={tr("Adjust input and output widths")} aria-orientation="vertical" aria-valuenow={Math.round(ratio * 100)} tabIndex={0}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
      }}
      onPointerMove={event => {
        if (!dragging.current || !container.current) return;
        const bounds = container.current.getBoundingClientRect();
        update((event.clientX - bounds.left - 4.5) / (bounds.width - 9));
      }}
      onPointerUp={event => {
        if (!dragging.current) return;
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
        persist();
      }}
      onLostPointerCapture={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; persist(); }}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        update(current.current + (event.key === 'ArrowLeft' ? -.02 : .02));
        persist();
      }}/>
    {children[1]}
  </div>;
}
