import { useEffect, useRef, useState } from 'react';
import { useTranslator } from './i18n';
import type { Tool } from './types';

export type DeleteOptions = { settings: boolean; data: boolean; logs: boolean };
export function DeleteToolDialog({tool, busy, close, submit}: {tool: Tool; busy: boolean; close: () => void; submit: (options: DeleteOptions) => void}) {
  const tr = useTranslator();
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<DeleteOptions>({settings:true, data:false, logs:false});
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="settings-dialog import-dialog" aria-labelledby="delete-tool-title" onCancel={e=>{e.preventDefault();if(!busy)close();}}>
    <header><h2 id="delete-tool-title">{tr('Delete tool')}</h2></header>
    <div className="dialog-body"><h3>{tool.manifest.name}</h3>
      <p>{tr('Tool files and installed dependencies will be deleted.')}</p>
      <p>{tr('Also delete the selected data. Unchecked items will be kept.')}</p>
      <label className="switch-row"><input type="checkbox" checked={options.settings} disabled={busy} onChange={e=>setOptions({...options,settings:e.target.checked})}/>{tr('Tool settings')}</label>
      <p className="hint">{tr('Kept settings are restored when you import this tool again.')}</p>
      <label className="switch-row delete-log-option"><input type="checkbox" checked={options.data} disabled={busy} onChange={e=>setOptions({...options,data:e.target.checked})}/>{tr('Run data (sessions, history and caches)')}</label>
      <p className="hint">{tr('Includes persistent data saved by this tool.')}</p>
      <label className="switch-row delete-log-option"><input type="checkbox" checked={options.logs} disabled={busy} onChange={e=>setOptions({...options,logs:e.target.checked})}/>{tr('Run logs for this tool')}</label>
      <p className="hint">{tr('Files saved to locations you selected are not deleted.')}</p>
    </div>
    <footer><button className="secondary" autoFocus disabled={busy} onClick={close}>{tr('Cancel')}</button><button className="secondary danger-button" disabled={busy} onClick={()=>submit(options)}>{busy?tr('Deleting…'):tr('Delete')}</button></footer>
  </dialog>;
}
