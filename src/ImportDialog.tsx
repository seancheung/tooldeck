import { useTranslator } from './i18n';
import { useEffect, useRef } from 'react';
import type { Tool } from './types';
export interface ImportResult { id: string; name: string; version: string; previousVersion: string | null; needsConfirmation: boolean; manifest: Tool['manifest'] }
export function ImportDialog({ details, busy, close, submit }: { details: ImportResult; busy: boolean; close: () => void; submit: () => void }) {
  const tr = useTranslator();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const m = details.manifest;
  return <dialog ref={dialog} className="settings-dialog import-dialog" aria-labelledby="import-title" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <header><h2 id="import-title">{details.previousVersion ? tr("Confirm tool upgrade") : tr("Confirm tool import")}</h2></header>
    <div className="dialog-body"><h3>{m.name}</h3><p className="import-description">{m.description || tr("No description")}</p>
      <dl className="import-details"><dt>{tr("Tool ID")}</dt><dd>{m.id}</dd><dt>{tr("Version")}</dt><dd>{details.previousVersion ? 'v' + details.previousVersion + ' → ' : ''}v{m.version}</dd><dt>{tr("Runtime")}</dt><dd>{m.runtime.kind} {m.runtime.version}</dd><dt>{tr("Package manager")}</dt><dd>{m.dependencies?.manager || tr("No dependencies required")}</dd><dt>{tr("Actions")}</dt><dd>{Object.values(m.actions).map(a => a.name).join(tr(", "))}</dd>{Object.keys(m.hooks ?? {}).length > 0 && <>
        <dt>{tr("Automatic hooks")}</dt><dd>{Object.entries(m.hooks ?? {}).map(([id, hook]) => <div key={id}>{id} · {hook.event}{hook.event === 'paramsChange' && <> ({hook.paramKeys?.join(', ') ?? tr("All parameters")})</>}</div>)}</dd>
      </>}</dl>
      {details.previousVersion && <p className="hint">{tr("Upgrading replaces tool files and keeps settings. The installed environment is retained when dependencies match.")}</p>}</div>
    <footer><button className="secondary" autoFocus disabled={busy} onClick={close}>{tr("Cancel")}</button><button className="primary compact" disabled={busy} onClick={submit}>{busy ? tr("Importing…") : details.previousVersion ? tr("Upgrade") : tr("Import")}</button></footer>
  </dialog>;
}
