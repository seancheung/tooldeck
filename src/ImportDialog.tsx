import Dialog from './components/ui/dialog';
import { Button } from './components/controls';
import { useTranslator } from './i18n';

import type { Tool } from './types';
export interface ImportResult { id: string; name: string; version: string; previousVersion: string | null; needsConfirmation: boolean; manifest: Tool['manifest'] }
export function ImportDialog({ details, busy, close, submit }: { details: ImportResult; busy: boolean; close: () => void; submit: () => void }) {
  const tr = useTranslator();
  const m = details.manifest;
  return <Dialog closeLabel={tr("Cancel")} open onOpenChange={open => { if (!open && !busy) close(); }} closable={!busy} title={details.previousVersion ? tr("Confirm tool upgrade") : tr("Confirm tool import")} className="app-dialog" footer={<><Button variant="secondary" className="secondary" autoFocus disabled={busy} onClick={close}>{tr("Cancel")}</Button><Button variant="primary" className="primary compact" disabled={busy} onClick={submit}>{busy ? tr("Importing…") : details.previousVersion ? tr("Upgrade") : tr("Import")}</Button></>}>
    <div className="dialog-body"><h3>{m.name}</h3><p className="import-description">{m.description || tr("No description")}</p>
      <dl className="import-details"><dt>{tr("Tool ID")}</dt><dd>{m.id}</dd><dt>{tr("Version")}</dt><dd>{details.previousVersion ? 'v' + details.previousVersion + ' → ' : ''}v{m.version}</dd><dt>{tr("Runtime")}</dt><dd>{m.runtime.kind} {m.runtime.version}</dd><dt>{tr("Package manager")}</dt><dd>{m.dependencies?.manager || tr("No dependencies required")}</dd><dt>{tr("Actions")}</dt><dd>{Object.values(m.actions).map(a => a.name).join(tr(", "))}</dd>{Object.keys(m.hooks ?? {}).length > 0 && <>
        <dt>{tr("Automatic hooks")}</dt><dd>{Object.entries(m.hooks ?? {}).map(([id, hook]) => <div key={id}>{id} · {hook.event}{hook.event === 'paramsChange' && <> ({hook.paramKeys?.join(', ') ?? tr("All parameters")})</>}</div>)}</dd>
      </>}</dl>
      {details.previousVersion && <p className="hint">{tr("Upgrading replaces tool files and keeps settings. The installed environment is retained when dependencies match.")}</p>}</div>
  </Dialog>;
}
