import { nativeMessage } from './nativeMessages';
import { LocaleContext, translate, useTranslator } from './i18n';
import remarkExplicitLinks from './remarkExplicitLinks';
import { ImportDialog, type ImportResult } from './ImportDialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { SplitWorkspace } from './SplitWorkspace';
import { ToolIcon } from './ToolIcon';
import { OutputTable } from './OutputTable';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, confirm } from '@tauri-apps/plugin-dialog';
import { CubeIcon, DesktopIcon, PlugsIcon, MagnifyingGlassIcon, PlusIcon, GearSixIcon, StarIcon, FolderIcon, TerminalIcon, PlayIcon, StopIcon, DownloadSimpleIcon, MinusCircleIcon, TrashIcon, CaretLeftIcon, CaretRightIcon, CaretDownIcon, CaretUpIcon, XIcon, CheckCircleIcon, WarningCircleIcon, ArrowClockwiseIcon, FileIcon, ArrowSquareOutIcon, BookOpenIcon, PackageIcon, CircleNotchIcon } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FieldForm, defaults } from './FieldForm';
import type { Config, Detection, Event, Json, Run, Tool } from './types';

const runtimeLabel: Record<string,string> = { python: 'Python', nodejs: 'Node.js', bash: 'Bash', powershell: 'PowerShell' };

export default function App() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState<'actions'|'settings'|'dependencies'|'docs'>('actions');
  const [expanded, setExpanded] = useState({ all: true, favorites: true });
  const [favorites, setFavorites] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('tooldeck:favorites') || '[]'); } catch { return []; } });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => { try { return localStorage.getItem('tooldeck:sidebarCollapsed') === 'true'; } catch { return false; } });
  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try { localStorage.setItem('tooldeck:sidebarCollapsed', String(next)); } catch {}
  }
  const [search, setSearch] = useState('');
  const [actionId, setActionId] = useState('');
  const [params, setParams] = useState<Record<string,Json>>({});
  const [toolSettings, setToolSettings] = useState<Record<string,Json>>({});
  const [runs, setRuns] = useState<Record<string,Run>>({});
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ path: string; details: ImportResult }>();
  const [dragOver, setDragOver] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const importLock = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<Config>();
  const locale = config?.locale ?? (/^zh(?:-|$)/i.test(navigator.language) ? 'zh-CN' : 'en');
  const tr = (key: string, values?: Record<string, string | number>) => translate(locale, key, values);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const [detection, setDetection] = useState<Detection>({});
  const [documentId, setDocumentId] = useState('');
  const [markdown, setMarkdown] = useState('');
  const logEnd = useRef<HTMLDivElement>(null);
  const tool = tools.find(t => t.manifest.id === selected);
  const needsInstall = tool?.manifest.runtime.kind === 'python' || !!tool?.manifest.dependencies;
  const action = tool?.manifest.actions[actionId];
  const run = runs[selected];
  const activeRun = run?.status === 'running' ? run : undefined;
  const busy = Boolean(activeRun) || deleting;
  const anyBusy = deleting || Object.values(runs).some(r => r.status === 'running');

  async function refresh(prefer?: string) {
    const list = await invoke<Tool[]>('list_tools');
    setTools(list);
    setSelected(current => prefer || (list.some(t => t.manifest.id === current) ? current : list[0]?.manifest.id || ''));
  }
  useEffect(() => {
    let disposed = false; let unlisten: (()=>void)|undefined;
    listen<Event>('tooldeck:event', ({ payload }) => {
      setRuns(current => {
        const pair = Object.entries(current).find(([,r]) => r.id === payload.runId);
        if (!pair) return current;
        const [key, previous] = pair;
        return { ...current, [key]: { ...previous, events: [...previous.events, { ...payload, time: new Date().toLocaleTimeString(document.documentElement.lang || 'en',{hour12:false}) }].slice(-5000) } };
      });
    }).then(fn => { if (disposed) fn(); else unlisten = fn; }).catch(e=>setMessage(String(e)));
    Promise.all([refresh(), invoke<Config>('get_config').then(setConfig), invoke<Detection>('detect_runtimes').then(setDetection)]).catch(e => setMessage(String(e))).finally(()=>setLoading(false));
    return () => { disposed = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    setTab('actions'); const t = tools.find(t=>t.manifest.id===selected); const id = Object.keys(t?.manifest.actions || {})[0] || '';
    setActionId(id); setParams(defaults(t?.manifest.actions[id]?.params)); setToolSettings(t?.settings || {}); setDocumentId(t?.manifest.docs[0]?.id || '');
  }, [selected]);
  useEffect(() => {
    const docs = tool?.manifest.docs ?? [];
    setDocumentId(current => docs.some(doc => doc.id === current) ? current : docs[0]?.id ?? '');
    if (!docs.length && tab === 'docs') setTab('actions');
  }, [tool?.manifest.docs, tab]);
  useEffect(() => { if (!tool || tab !== 'docs' || !documentId) return; let stale=false; setMarkdown(''); invoke<string>('read_document', { id: selected, documentId }).then(text=>{if(!stale)setMarkdown(text);}).catch(e=>{if(!stale)setMessage(String(e));}); return ()=>{stale=true;}; },[selected, documentId, tab, locale]);
  useEffect(()=>{ logEnd.current?.scrollIntoView({block:'nearest'}); },[run?.events.length]);
  useEffect(()=>{ localStorage.setItem('tooldeck:favorites', JSON.stringify(favorites)); },[favorites]);

  function cancelImport() { setPendingImport(undefined); importLock.current = false; }
  async function prepareImport(path: string) {
    if (importLock.current) return;
    if (!path.toLowerCase().endsWith('.zip')) { setMessage(tr("Choose a ZIP tool package.")); return; }
    importLock.current = true; setImporting(true);
    try { const details = await invoke<ImportResult>('import_tool', { path }); setPendingImport({ path, details }); }
    catch (e) { importLock.current = false; setMessage(String(e)); }
    finally { setImporting(false); }
  }
  async function importZip() {

    if (importLock.current) return;
    try { const file = await open({ title: tr("Import tool ZIP"), filters: [{ name: tr("Tool packages"), extensions: ['zip'] }], multiple: false }); if (typeof file === 'string') await prepareImport(file); }
    catch (e) { setMessage(String(e)); }
  }
  async function confirmImport() {
    if (!pendingImport || importing) return;
    setImporting(true);
    try {
      const result = await invoke<ImportResult>('import_tool', { path: pendingImport.path, confirmation: pendingImport.details });
      await refresh(result.id);
      const imported = await invoke<Tool[]>('list_tools');
      const updated = imported.find(t => t.manifest.id === result.id);
      if (updated) { const first = Object.keys(updated.manifest.actions)[0] || ''; setActionId(first); setParams(defaults(updated.manifest.actions[first]?.params)); setToolSettings(updated.settings); setDocumentId(updated.manifest.docs[0]?.id || ''); setTab('actions'); }
      setRuns(current => { const next = { ...current }; delete next[result.id]; return next; });
    } catch (e) { setMessage(String(e)); }
    finally { setImporting(false); cancelImport(); }
  }
  useEffect(() => {

    let disposed = false; let unlisten: (() => void) | undefined;
    getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === 'leave') { setDragOver(false); return; }
      const rect = sidebar.current?.getBoundingClientRect();
      const x = payload.position.x / window.devicePixelRatio, y = payload.position.y / window.devicePixelRatio;
      const inside = !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      setDragOver(inside && !importLock.current && payload.type !== 'drop');
      if (payload.type === 'drop' && inside && !importLock.current) {
        if (payload.paths.length !== 1 || !payload.paths[0].toLowerCase().endsWith('.zip')) { setMessage(tr("Drop one ZIP tool package at a time.")); return; }
        void prepareImport(payload.paths[0]);
      }
    }).then(fn => { if (disposed) fn(); else unlisten = fn; }).catch(e => setMessage(String(e)));
    return () => { disposed = true; unlisten?.(); };
  }, []);  async function execute(operation: string) {
    if (!tool || busy) return;
    if (operation === 'uninstall') {
      try {
        if (!await confirm(tr("Uninstall the environment for “{name}”? Its scripts and settings will be kept.", { name: tool.manifest.name }), { title: tr("Uninstall environment"), kind: 'warning', okLabel: tr("Uninstall"), cancelLabel: tr("Cancel") })) return;
      } catch (e) { setMessage(String(e)); return; }
    }
    const id = crypto.randomUUID(); const toolId=selected;
    setRuns(current=>({...current,[toolId]:{id,toolId,operation,status:'running',events:[],started:Date.now()}})); setTab('actions');
    try {
      const result = await invoke<string>('execute_job', { id:toolId, runId:id, operation, actionId, params });
      setRuns(current=>({...current,[toolId]:{...current[toolId],status:'success',ended:Date.now(),message:result}}));
    } catch(e) {
      const text=String(e); setRuns(current=>({...current,[toolId]:{...current[toolId],status:text==='Cancelled'?'cancelled':'error',ended:Date.now(),message:text}}));
    } finally { await refresh(); }
  }
  async function deleteTool() {
    if (!tool || busy) return;
    const id = tool.manifest.id;
    if (!await confirm(tr("Delete “{name}”, including its scripts, dependencies and settings?", { name: tool.manifest.name }), { title: tr("Delete tool"), kind: 'warning', okLabel: tr("Delete"), cancelLabel: tr("Cancel") })) return;
    setDeleting(true);
    try {
      await invoke('execute_job', { id, runId: crypto.randomUUID(), operation: 'delete', actionId: null, params: null });
      setTools(items => items.filter(item => item.manifest.id !== id));
      setFavorites(items => items.filter(item => item !== id));
      setRuns(current => { const next = {...current}; delete next[id]; return next; });
      await refresh();
    } catch (e) { setMessage(String(e)); } finally { setDeleting(false); }
  }
  async function saveSettings() { try { const saved=await invoke<Record<string,Json>>('save_tool_settings',{id:selected,settings:toolSettings}); setToolSettings(saved); await refresh(); setMessage(tr("Saved")); }catch(e){setMessage(String(e));} }
  async function openTarget(target: string) { try{await invoke('open_target',{target});}catch(e){setMessage(String(e));} }
  const visible = tools.filter(t => `${t.manifest.name} ${t.manifest.runtime.kind}`.toLowerCase().includes(search.toLowerCase()));
  const progress = run?.status === 'running' ? [...run.events].reverse().find(e=>e.type==='progress')?.payload : undefined;
  const percent = progress?.total ? Math.min(100,Math.round(progress.value/progress.total*100)) : undefined;
  return <LocaleContext.Provider value={locale}><div className="app-shell">
    <aside ref={sidebar} className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${dragOver ? 'drop-active' : ''}`}>
      {dragOver && <div className="sidebar-drop-hint">{tr("Drop ZIP to import")}</div>}<div className="brand"><CubeIcon size={36} weight="duotone"/><span>ToolDeck</span><button type="button" className="sidebar-toggle" title={sidebarCollapsed ? tr("Expand sidebar") : tr("Collapse sidebar")} aria-label={sidebarCollapsed ? tr("Expand sidebar") : tr("Collapse sidebar")} aria-expanded={!sidebarCollapsed} onClick={toggleSidebar}>{sidebarCollapsed ? <CaretRightIcon size={18}/> : <CaretLeftIcon size={18}/>}</button></div>
      <div className="search"><MagnifyingGlassIcon size={20}/><input aria-label={tr("Search tools")} placeholder={tr("Search tools")} value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <div className="library-groups">{([['favorites',tr("Favorites")],['all',tr("All tools")]] as const).map(([group,label]) => {
        const items = visible.filter(t => group === 'all' || favorites.includes(t.manifest.id));
        const count = tools.filter(t => group === 'all' || favorites.includes(t.manifest.id)).length;
        return <section className="library-group" key={group}>
          <button className="group-heading" aria-expanded={expanded[group]} onClick={() => setExpanded(current => ({...current,[group]:!current[group]}))}>
            <span>{label} <span className="group-count">({count})</span></span>{expanded[group]?<CaretUpIcon size={17}/>:<CaretDownIcon size={17}/>}
          </button>
          {expanded[group]&&<div className="tool-list">{items.map(t=><button key={t.manifest.id} className={`tool-row ${t.compatible ? '' : 'incompatible'} ${selected===t.manifest.id?'selected':''}`} onClick={()=>setSelected(t.manifest.id)}><ToolIcon tool={t}/><span className="tool-name">{t.manifest.name}<small>{!t.compatible ? tr("Unsupported platform") : t.installed ? '' : tr("Not installed")}</small></span><span className="runtime-icon" title={runtimeLabel[t.manifest.runtime.kind]}><img src={`/runtime-icons/${t.manifest.runtime.kind === 'nodejs' ? 'nodejs' : t.manifest.runtime.kind}.svg`} alt={runtimeLabel[t.manifest.runtime.kind]} /></span></button>)}{!items.length&&!loading&&<p className="list-empty">{group==='favorites'?tr("No favorites"):search?tr("No matching tools"):tr("No tools")}</p>}</div>}
        </section>;
      })}</div>
      <div className="sidebar-footer"><button title={tr("Import tool")} aria-label={tr("Import tool")} onClick={importZip} disabled={importing || !!pendingImport}>{importing?<CircleNotchIcon className="spin" size={22}/>:<PlusIcon size={22}/>}<span>{tr("Import tool")}</span></button><button title={tr("App settings")} aria-label={tr("App settings")} onClick={()=>setSettingsOpen(true)}><GearSixIcon size={22}/><span>{tr("App settings")}</span></button></div>
    </aside>
    {pendingImport && <ImportDialog details={pendingImport.details} busy={importing} close={cancelImport} submit={confirmImport}/>}<main className="main">
      {!tool?<div className="empty-library"><CubeIcon size={64} weight="duotone"/><h1>{loading?tr("Loading…"):tr("No tools")}</h1><button className="primary" onClick={importZip}><PlusIcon size={20}/>{tr("Import tool")}</button></div>:<>
        <header className="tool-header"><div className="tool-heading"><ToolIcon tool={tool} size={42}/><div className="tool-title-content"><h1>{tool.manifest.name}</h1>{tool.manifest.description&&<p className="tool-description">{tool.manifest.description}</p>}<div className="tool-metadata"><span className="tool-version">v{tool.manifest.version}</span><span>{runtimeLabel[tool.manifest.runtime.kind]}</span><span>{needsInstall?(tool.installed?tr("Installed"):tr("Not installed")):tr("No dependencies required")}</span>{!tool.compatible&&<span className="warning-text">{tr("Unsupported platform")}</span>}</div></div></div><div className="header-actions"><button className={`icon-button ${favorites.includes(selected)?'favorited':''}`} aria-label={favorites.includes(selected)?tr("Remove from favorites"):tr("Add to favorites")} title={tr("Add to favorites")} onClick={()=>setFavorites(f=>f.includes(selected)?f.filter(id=>id!==selected):[...f,selected])}><StarIcon weight={favorites.includes(selected)?'fill':'regular'} size={21}/></button><button className="secondary" disabled={busy||!tool.compatible||!needsInstall||tool.installed} onClick={()=>execute('install')}><DownloadSimpleIcon size={17}/>{tr("Install")}</button><button className="secondary" disabled={busy||!needsInstall||!tool.installed} onClick={()=>execute('uninstall')}><MinusCircleIcon size={17}/>{tr("Uninstall")}</button><button className="secondary danger-button" disabled={busy} onClick={deleteTool}><TrashIcon size={17}/>{tr("Delete")}</button></div></header>
        <nav className="tabs">{([['actions',tr("Actions")],['settings',tr("Tool settings")],['dependencies',tr("Environment")],['docs',tr("Docs")]] as const).filter(([id]) => (id !== 'settings' || Object.keys(tool.manifest.settings).length > 0) && (id !== 'docs' || tool.manifest.docs.length > 0)).map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</nav>
        {tab==='actions'?<SplitWorkspace><form className="parameters" onSubmit={e=>{e.preventDefault();execute('run');}}><div className="parameter-scroll"><div className="field"><label htmlFor="action">{tr("Actions")}</label><select id="action" value={actionId} disabled={busy} onChange={e=>{setActionId(e.target.value);setParams(defaults(tool.manifest.actions[e.target.value].params));}}>{Object.entries(tool.manifest.actions).map(([id,a])=><option key={id} value={id}>{a.name}</option>)}</select>{action?.description&&<p className="action-description">{action.description}</p>}</div><FieldForm fields={action?.params} values={params} onChange={setParams} disabled={busy}/></div><div className="run-footer">{activeRun?<button type="button" className="stop" onClick={()=>invoke('cancel_job',{runId:activeRun.id}).catch(e=>setMessage(String(e)))}><StopIcon size={19} weight="fill"/>{tr(activeRun.operation==='install'?'Stop installation':'Stop run')}</button>:<button className="primary" disabled={busy||!tool.installed||!tool.compatible||!actionId}><PlayIcon size={19} weight="fill"/>{tr("Run")}</button>}</div></form>
        <section className="output"><div className="output-header"><h2>{tr("Output")}</h2>{run&&<span className={`status ${run.status}`}>{run.status==='running'?<CircleNotchIcon className="spin" size={15}/>:run.status==='success'?<CheckCircleIcon size={15}/>:<WarningCircleIcon size={15}/>}{{running:tr("Running"),success:tr("Completed"),error:tr("Failed"),cancelled:tr("Cancelled")}[run.status]}{run.ended&&' · '+tr("{seconds} s", {seconds:((run.ended-run.started)/1000).toFixed(1)})}</span>}</div>{!run?<div className="output-empty"><TerminalIcon size={38}/><p>{tr("No output")}</p></div>:<div className="output-content">{progress&&<div className="progress"><div><span>{progress.message||tr("Processing")}</span><span>{percent!==undefined?`${percent}%`:''}</span></div><div className={`progress-track ${percent===undefined?'indeterminate':''}`}><i style={{width:percent===undefined?'35%':`${percent}%`}}/></div></div>}<div className="links">{run.events.filter(e=>e.type==='link').map((e,i)=><button key={i} onClick={()=>openTarget(e.payload.target)}>{e.payload.kind==='directory'?<FolderIcon size={23}/>:e.payload.kind==='url'?<ArrowSquareOutIcon size={23}/>:<FileIcon size={23}/>}<span>{e.payload.label||e.payload.target}</span><CaretRightIcon size={17}/></button>)}</div><div className="log-stream" aria-live="polite">{run.events.filter(e=>e.type==='log'||e.type==='output'||e.type==='table').map((e,i)=><div className={`log-line ${e.payload?.level||''}`} key={i}><time>{e.time?`[${e.time}]`:''}</time>{e.type==='table'?<OutputTable value={e.payload} onOpen={openTarget}/>:e.type==='output'?<pre>{JSON.stringify(e.payload,null,2)}</pre>:<span>{e.payload.message}</span>}</div>)}{run.message&&<div className={`completion ${run.status}`}>{nativeMessage(locale, run.message)}</div>}<div ref={logEnd}/></div></div>}</section></SplitWorkspace>
        :tab==='settings'?<form className="settings-content" onSubmit={e=>{e.preventDefault();saveSettings();}}><FieldForm fields={tool.manifest.settings} values={toolSettings} onChange={setToolSettings}/>{Object.keys(tool.manifest.settings).length?<button className="primary compact" disabled={busy}>{tr("Save settings")}</button>:<div className="quiet-empty">{tr("No settings")}</div>}</form>
        :tab==='dependencies'?<EnvironmentPanel key={selected} tool={tool}/>:<section className="documents">{tool.manifest.docs.length?<><div className="document-picker"><BookOpenIcon size={19}/><select aria-label={tr("Select document")} value={documentId} onChange={e=>setDocumentId(e.target.value)}>{tool.manifest.docs.map(d=><option key={d.id} value={d.id}>{d.title}</option>)}</select></div><article className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkExplicitLinks]} components={{a:({href,children})=><a href={href} onClick={e=>{e.preventDefault();if(href)openTarget(href.startsWith('http')?href:`${tool.directory}/${href}`);}}>{children}</a>}}>{markdown}</ReactMarkdown></article></>:<div className="quiet-empty">{tr("No documentation")}</div>}</section>}
      </>}
    </main>
    {message&&<div className="toast" role="status"><span>{nativeMessage(locale, message)}</span><button title={tr("Dismiss")} onClick={()=>setMessage('')}><XIcon size={17}/></button></div>}
    {settingsOpen&&<SettingsDialog config={config} detection={detection} busy={anyBusy} close={()=>setSettingsOpen(false)} error={setMessage} saved={async value=>{if (config?.dataDir !== value.dataDir) setSelected(''); setConfig(value);await refresh();}}/>}
  </div></LocaleContext.Provider>;
}

function SettingsDialog({config,detection,busy,close,error,saved}:{config?:Config;detection:Detection;busy:boolean;close:()=>void;error:(s:string)=>void;saved:(c:Config)=>Promise<void>}){
  const tr = useTranslator();
  const [draft,setDraft]=useState<Config>(config||{dataDir:'',nodePath:'',uvPath:'',locale:'en'}); const [found,setFound]=useState(detection); const [saving,setSaving]=useState(false);
  const [clearing,setClearing]=useState(false);
  const [logMessage,setLogMessage]=useState('');
  async function clearLogs(){
    if(!await confirm(tr("Clear all run logs in the current data directory?"), {title:tr("Clear run logs"),kind:'warning',okLabel:tr("Clear"),cancelLabel:tr("Cancel")}))return;
    setClearing(true);setLogMessage('');
    try{const count=await invoke<number>('clear_run_logs');setLogMessage(tr("Cleared {count} run logs", { count }));}catch(e){error(String(e));}finally{setClearing(false);}
  }
  async function choose(field:keyof Config){try{const value=await open({directory:field==='dataDir',multiple:false,title:field==='dataDir'?tr("Choose application data directory"):tr("Choose executable")});if(typeof value==='string')setDraft(d=>({...d,[field]:value}));}catch(e){error(String(e));}}
  async function submit(){setSaving(true);try{const value=await invoke<Config>('save_config',{config:draft});await saved(value);close();}catch(e){error(String(e));}finally{setSaving(false);}}
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section className="settings-dialog" role="dialog" aria-modal="true" aria-label={tr("App settings")}><header><div><h2>{tr("App settings")}</h2></div><button className="icon-button" onClick={close} title={tr("Close settings")}><XIcon size={23}/></button></header><div className="dialog-body"><div className="field"><label htmlFor="display-language">{tr("Display language")}</label><select id="display-language" value={draft.locale} onChange={e=>setDraft({...draft,locale:e.target.value as Config['locale']})}><option value="en">English</option><option value="zh-CN">{translate('zh-CN', 'Simplified Chinese')}</option></select></div><h3>{tr("System runtimes")}</h3>{([['nodePath','Node.js',found.node],['uvPath','uv',found.uv]] as const).map(([key,label,detected])=><div className="field" key={key}><label htmlFor={key}>{label}</label><div className="input-group"><input id={key} placeholder={tr("Auto-detect")} value={draft[key]} onChange={e=>setDraft({...draft,[key]:e.target.value})}/><button title={tr("Choose {name}", { name: label })} onClick={()=>choose(key)}><FolderIcon size={20}/></button></div><p className={`hint ${!detected&&!draft[key]?'warning-text':''}`}>{draft[key]?'':detected?detected:tr("Not detected")}</p></div>)}<button className="text-button" onClick={()=>invoke<Detection>('detect_runtimes').then(setFound).catch(e=>error(String(e)))}><ArrowClockwiseIcon size={17}/>{tr("Detect again")}</button><div className="section-divider"/><h3>{tr("Application data directory")}</h3><div className="input-group"><input aria-label={tr("Application data directory")} value={draft.dataDir} onChange={e=>setDraft({...draft,dataDir:e.target.value})}/><button title={tr("Choose data directory")} onClick={()=>choose('dataDir')}><FolderIcon size={20}/></button></div><p className="hint">{tr("Existing files stay in their original directory.")}</p><div className="section-divider"/><h3>{tr("Run logs")}</h3><p className="hint">{tr("Logs are stored in the logs folder of the configured data directory. Clearing logs keeps tool outputs.")}</p><button type="button" className="secondary" disabled={busy||clearing} onClick={clearLogs}>{clearing?tr("Clearing…"):tr("Clear run logs")}</button>{logMessage&&<p className="hint">{logMessage}</p>}</div><footer><button className="secondary" onClick={close}>{tr("Cancel")}</button><button className="primary compact" onClick={submit} disabled={busy||saving}>{saving?tr("Saving…"):tr("Save settings")}</button></footer></section></div>;
}

interface DependencyFile { manager: string; file: string; lockfile?: string; content: string }
function EnvironmentPanel({tool}: {tool:Tool}) {
  const tr = useTranslator();
  const [data,setData]=useState<DependencyFile|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    let stale=false;
    invoke<DependencyFile|null>('read_dependencies',{id:tool.manifest.id})
      .then(value=>{if(!stale)setData(value);})
      .catch(e=>{if(!stale)setError(String(e));})
      .finally(()=>{if(!stale)setLoading(false);});
    return ()=>{stale=true;};
  },[tool.manifest.id]);
  const groups: { title: string; rows: { name: string; spec: string }[] }[] = [];
  let parseError = '';
  if (data?.manager === 'npm') {
    try {
      const pkg = JSON.parse(data.content);
      for (const [key, title] of Object.entries({
        dependencies: tr("Dependencies"), devDependencies: tr("Development dependencies"),
        optionalDependencies: tr("Optional dependencies"), peerDependencies: tr("Peer dependencies")
      })) {
        const rows = Object.entries(pkg[key] ?? {}).map(([name, spec]) => ({ name, spec: String(spec) }));
        if (rows.length) groups.push({ title, rows });
      }
    } catch { parseError = tr("Invalid package.json"); }
  } else if (data?.manager === 'pip') {
    const rows = data.content.split(/\r?\n/).map(line => line.trim())
      .filter(line => line && !line.startsWith('#')).map(line => {
        // Keep paths, URLs and pip directives verbatim.
        const match = /^([\w.-]+(?:\[[\w.,-]+\])?)\s*((?:[<>=!~;@].*)?)$/.exec(line);
        return match ? { name: match[1], spec: match[2] } : { name: line, spec: '' };
      });
    if (rows.length) groups.push({ title: tr("Required packages"), rows });
  }
  const platformNames: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
  return <section className="dependencies-content dep-view">
    <dl className="dep-environment">
      <div><dt><TerminalIcon size={16}/>{tr("Runtime")}</dt><dd><strong>{runtimeLabel[tool.manifest.runtime.kind]}</strong><code>{tool.manifest.runtime.version}</code></dd></div>
      <div><dt><DesktopIcon size={16}/>{tr("Platforms")}</dt><dd>
        {tool.manifest.platforms?.length ? tool.manifest.platforms.map(platform =>
          <span key={[platform.os, ...(platform.arch ?? [])].join('-')}>
            {tr("{platform} ({arch})", { platform: platformNames[platform.os] ?? platform.os, arch: platform.arch?.join(tr(", ")) || tr("all architectures") })}
          </span>) : <span>{tr("All platforms and architectures")}</span>}
      </dd></div>
      <div><dt><PlugsIcon size={16}/>Host API</dt><dd><code>{tool.manifest.hostApi}</code></dd></div>
      <div><dt><PackageIcon size={16}/>{tr("Package manager")}</dt><dd>
        <strong>{tool.manifest.dependencies?.manager ?? tr("None required")}</strong>
        {data && <span className="dep-filenames">{[data.file, data.lockfile].filter(Boolean).join(' · ')}</span>}
      </dd></div>
    </dl>
    {loading ? <p className="quiet-empty">{tr("Loading…")}</p> : error ? <p className="error-text">{error}</p> : <>
      {parseError ? <p className="error-text">{parseError}</p> : groups.length ? groups.map(group =>
        <section className="dep-list" key={group.title}>
          <h3>{group.title}<span>{group.rows.length} {tr("items")}</span></h3>
          <table><thead><tr><th scope="col">{tr("Name / declaration")}</th><th scope="col">{tr("Version requirement")}</th></tr></thead>
            <tbody>{group.rows.map((row, index) => <tr key={index}><td>{row.name}</td><td>{row.spec || '—'}</td></tr>)}</tbody>
          </table>
        </section>) : <p className="quiet-empty">{tr("No dependencies")}</p>}
      {data && <details className="dep-original"><summary><CaretRightIcon size={14}/><FileIcon size={15}/><span>{tr("View source file")}</span><code>{data.file}</code></summary>
        <pre>{data.content}</pre></details>}
    </>}
  </section>;
}