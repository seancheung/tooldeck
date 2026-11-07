import Dialog from './components/ui/dialog';
import Checkbox from './components/ui/checkbox';
import { Button } from './components/controls';
import { useState } from 'react';
import { useTranslator } from './i18n';
import type { Tool } from './types';

export type DeleteOptions = { settings: boolean; data: boolean; logs: boolean };
export function DeleteToolDialog({tool, busy, close, submit}: {tool: Tool; busy: boolean; close: () => void; submit: (options: DeleteOptions) => void}) {
  const tr = useTranslator();
  const [options, setOptions] = useState<DeleteOptions>({settings:true, data:false, logs:false});
  return <Dialog closeLabel={tr("Cancel")} open onOpenChange={open => { if (!open && !busy) close(); }} closable={!busy} title={tr('Delete tool')} className="app-dialog" footer={<><Button variant="secondary" className="secondary" autoFocus disabled={busy} onClick={close}>{tr('Cancel')}</Button><Button variant="danger" className="secondary danger-button" disabled={busy} onClick={()=>submit(options)}>{busy?tr('Deleting…'):tr('Delete')}</Button></>}>
    <div className="dialog-body"><h3>{tool.manifest.name}</h3>
      <p>{tr('Tool files and installed dependencies will be deleted.')}</p>
      <p>{tr('Also delete the selected data. Unchecked items will be kept.')}</p>
      <Checkbox className="" value={options.settings} disabled={busy} onChange={value=>setOptions({...options,settings:value})} label={tr('Tool settings')}/>
      <p className="hint">{tr('Kept settings are restored when you import this tool again.')}</p>
      <Checkbox className="delete-log-option" value={options.data} disabled={busy} onChange={value=>setOptions({...options,data:value})} label={tr('Run data (sessions, history and caches)')}/>
      <p className="hint">{tr('Includes persistent data saved by this tool.')}</p>
      <Checkbox className="delete-log-option" value={options.logs} disabled={busy} onChange={value=>setOptions({...options,logs:value})} label={tr('Run logs for this tool')}/>
      <p className="hint">{tr('Files saved to locations you selected are not deleted.')}</p>
    </div>
  </Dialog>;
}
