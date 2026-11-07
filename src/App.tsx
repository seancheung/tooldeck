import Dropdown from './components/ui/dropdown';
import Checkbox from './components/ui/checkbox';
import Tooltip from './components/ui/tooltip';
import { useConfirmation } from './components/useConfirmation';
import Collapsible from './components/ui/collapsible';
import { ToastItem } from './components/ui/toast';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table';
import Tabs from './components/ui/tab';
import Select from './components/ui/select';
import Dialog from './components/ui/dialog';
import Progress from './components/ui/progress';
import Badge from './components/ui/badge';
import { Button, Input } from './components/controls';
import { nativeMessage } from './nativeMessages';
import { LocaleContext, translate, useTranslator } from './i18n';
import remarkExplicitLinks from './remarkExplicitLinks';
import { ImportDialog, type ImportResult } from './ImportDialog';
import { DeleteToolDialog, type DeleteOptions } from './DeleteToolDialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { SplitWorkspace } from './SplitWorkspace';
import { ToolIcon } from './ToolIcon';
import { formFields, newForm, type ParamForm, type ParamPatch } from './paramForm';
import { ParamSessions, toolScope, actionScope } from './paramSessions';
import { useParamHooks } from './useParamHooks';
import { appendOutputEvent, stampOutputEvent, chronologicalOutput } from './outputEvents';
import { latestToolRuns, clearActionRun, clearRunOutput } from './runState';
import { OutputTable } from './OutputTable';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { DotsThreeIcon, FunctionIcon, CubeIcon, DesktopIcon, PlugsIcon, MagnifyingGlassIcon, PlusIcon, GearSixIcon, StarIcon, FolderIcon, TerminalIcon, PlayIcon, StopIcon, DownloadSimpleIcon, MinusCircleIcon, TrashIcon, CaretLeftIcon, CaretRightIcon, CheckCircleIcon, WarningCircleIcon, ArrowClockwiseIcon, FileIcon, ArrowSquareOutIcon, BookOpenIcon, PackageIcon, CircleNotchIcon } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FieldForm, defaults } from './FieldForm';
import type { Config, Detection, Event, Json, Run, Tool } from './types';

const runtimeLabel: Record<string,string> = { python: 'Python', nodejs: 'Node.js', bash: 'Bash', powershell: 'PowerShell' };

function ToolStatus({tool, run}: {tool: Tool; run?: Run}) {
  const tr = useTranslator();
  const status = run?.status === 'running' ? 'running' : !tool.compatible ? 'unsupported' : !tool.installed ? 'uninstalled' : run?.status;
  if (!status) return null;
  const label = tr({running:'Running', unsupported:'Unsupported platform', uninstalled:'Not installed', success:'Completed', error:'Failed', cancelled:'Cancelled'}[status]);
  const Icon = {running:CircleNotchIcon, unsupported:WarningCircleIcon, uninstalled:DownloadSimpleIcon, success:CheckCircleIcon, error:WarningCircleIcon, cancelled:StopIcon}[status];
  return <span className={`tool-status ${status}`} title={label} role="img" aria-label={label}><Icon size={16} className={status === 'running' ? 'spin' : undefined} aria-hidden="true"/></span>;
}

export default function App() {
  const { confirm, confirmationDialog } = useConfirmation();
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
  const [formOwner, setFormOwner] = useState('');
  const [eventsReady, setEventsReady] = useState(false);
  const [form, setFormState] = useState(() => newForm());
  const [formReset, setFormReset] = useState(0);
  const currentForm = useRef(form);
  const sessions = useRef(new ParamSessions());
  const currentScope = useRef('');
  const setForm = useCallback((next: ParamForm) => {
    if (currentScope.current) sessions.current.forms.set(currentScope.current, next);
    currentForm.current = next;
    setFormState(next);
  }, []);
  const patchForm = useCallback((patch: ParamPatch, scope: string) => {
    const next = sessions.current.patch(scope, patch);
    if (next && scope === currentScope.current) setForm(next);
  }, [setForm]);
  function selectAction(t: Tool, id: string) {
    const saved = sessions.current.select(t, id, defaults(t.manifest.actions[id]?.params));
    currentScope.current = saved.scope;
    setActionId(id);
    setForm(saved.form);
  }
  const [settingsReset, setSettingsReset] = useState(0);
  const [toolSettings, setToolSettings] = useState<Record<string,Json>>({});
  const [runs, setRuns] = useState<Record<string,Run>>({});
  const clearRun = useCallback((scope: string) => setRuns(current => clearRunOutput(current, scope)), []);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ path: string; details: ImportResult }>();
  const [dragOver, setDragOver] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const importLock = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Tool>();
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
  const scope = tool ? actionScope(tool, actionId) : '';
  const toolRuns = latestToolRuns(runs);
  const run = runs[scope];
  const hooks = useParamHooks(tool, actionId, form, patchForm, eventsReady && formOwner === selected && !!tool && currentScope.current === actionScope(tool, actionId) && tab === 'actions', tools, clearRun);
  const showTimestamps = config?.showOutputTimestamps ?? true;
  const outputEvents = chronologicalOutput([...hooks.events, ...(run?.events ?? [])]);
  const activeRun = toolRuns[selected]?.status === 'running' ? toolRuns[selected] : undefined;
  const busy = Boolean(activeRun) || deleting;
  const formDisabled = busy || !tool?.installed || !tool.compatible;
  const actionDisabled = formDisabled || hooks.pendingCount > 0 || !actionId;
  const anyBusy = deleting || Object.values(runs).some(r => r.status === 'running');

  function resetAction() {
    if (!tool || actionDisabled || hooks.isPending()) return;
    hooks.reset();
    const next = newForm(defaults(action?.params));
    setForm(next);
    setFormReset(value => value + 1);
    setRuns(current => clearActionRun(current, scope));
    hooks.notifyReset(next);
  }

  async function refresh(prefer?: string) {
    const list = await invoke<Tool[]>('list_tools');
    setTools(list);
    setSelected(current => prefer || (list.some(t => t.manifest.id === current) ? current : list[0]?.manifest.id || ''));
  }
  useEffect(() => {
    let disposed = false; let unlisten: (()=>void)|undefined;
    listen<Event>('tooldeck:event', ({ payload: incoming }) => {
      const payload = stampOutputEvent(incoming);
      try { if (hooks.receive(payload)) return; }
      catch (error) { setMessage(String(error)); return; }
      setRuns(current => {
        const pair = Object.entries(current).find(([,r]) => r.id === payload.runId);
        if (!pair) return current;
        const [key, previous] = pair;
        return { ...current, [key]: { ...previous, events: appendOutputEvent(previous.events, payload) } };
      });
    }).then(fn => { if (disposed) fn(); else { unlisten = fn; setEventsReady(true); } }).catch(e=>setMessage(String(e)));
    Promise.all([refresh(), invoke<Config>('get_config').then(setConfig), invoke<Detection>('detect_runtimes').then(setDetection)]).catch(e => setMessage(String(e))).finally(()=>setLoading(false));
    return () => { disposed = true; unlisten?.(); };
  }, []);
  useEffect(() => {
    setFormOwner(selected);
    setTab('actions'); const t = tools.find(t=>t.manifest.id===selected);
    const saved = t && sessions.current.actions.get(toolScope(t));
    const id = saved && t?.manifest.actions[saved] ? saved : Object.keys(t?.manifest.actions || {})[0] || '';
    if (t) selectAction(t, id);
    else { currentScope.current = ''; setActionId(''); setForm(newForm()); }
    setToolSettings(t?.settings || {}); setDocumentId(t?.manifest.docs[0]?.id || '');
  }, [selected, tool?.directory, tool?.manifest.version]);
  useEffect(() => {
    const docs = tool?.manifest.docs ?? [];
    setDocumentId(current => docs.some(doc => doc.id === current) ? current : docs[0]?.id ?? '');
    if (!docs.length && tab === 'docs') setTab('actions');
  }, [tool?.manifest.docs, tab]);
  useEffect(() => { if (!tool || tab !== 'docs' || !documentId) return; let stale=false; setMarkdown(''); invoke<string>('read_document', { id: selected, documentId }).then(text=>{if(!stale)setMarkdown(text);}).catch(e=>{if(!stale)setMessage(String(e));}); return ()=>{stale=true;}; },[selected, documentId, tab, locale]);
  useEffect(()=>{ logEnd.current?.scrollIntoView({block:'nearest'}); },[outputEvents.length]);
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
      const imported = await invoke<Tool[]>('list_tools');
      const updated = imported.find(t => t.manifest.id === result.id);
      const previous = tools.find(t => t.manifest.id === result.id);
      if (previous) { hooks.forget(previous); sessions.current.forget(previous); }
      if (updated) { const first = Object.keys(updated.manifest.actions)[0] || ''; hooks.forget(updated); sessions.current.forget(updated); selectAction(updated, first); setToolSettings(updated.settings); setDocumentId(updated.manifest.docs[0]?.id || ''); setTab('actions'); }
      setRuns(current => Object.fromEntries(Object.entries(current).filter(([,run]) => run.toolId !== result.id)));
      setTools(imported);
      setSelected(result.id);
      setFormReset(value => value + 1);
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
    if (!tool || busy || (operation === "run" && (formDisabled || hooks.isPending()))) return;
    if (operation === 'uninstall') {
      try {
        if (!await confirm(tr("Uninstall the environment for “{name}”? Its scripts and settings will be kept.", { name: tool.manifest.name }), { title: tr("Uninstall environment"), kind: 'warning', okLabel: tr("Uninstall"), cancelLabel: tr("Cancel") })) return;
      } catch (e) { setMessage(String(e)); return; }
    }
    const id = crypto.randomUUID(); const toolId=selected;
    const runScope = actionScope(tool, actionId);
    if (operation === 'run') hooks.trackAction(id);
    const params = structuredClone(currentForm.current.values);
    setRuns(current=>({...current,[runScope]:{id,toolId,operation,actionId:operation==='run'?actionId:undefined,actionName:operation==='run'?action?.name:undefined,params,status:'running',events:[],started:Date.now()}})); setTab('actions');
    try {
      const result = await invoke<string>('execute_job', { id:toolId, runId:id, operation, actionId, params, formOverrides:currentForm.current.overrides });
      const completion = stampOutputEvent({runId:id,type:'completion',payload:{status:'success',message:result}});
      setRuns(current=>({...current,[runScope]:{...current[runScope],status:'success',ended:completion.receivedAt,message:result,events:appendOutputEvent(current[runScope].events,completion)}}));
    } catch(e) {
      const text=String(e), status=text==='Cancelled'?'cancelled':'error';
      const completion = stampOutputEvent({runId:id,type:'completion',payload:{status,message:text}});
      setRuns(current=>({...current,[runScope]:{...current[runScope],status,ended:completion.receivedAt,message:text,events:appendOutputEvent(current[runScope].events,completion)}}));
    } finally { await refresh(); }
  }
  async function deleteTool(options: DeleteOptions) {
    const tool = deleteTarget;
    if (!tool || deleting || toolRuns[tool.manifest.id]?.status === 'running') return;
    const id = tool.manifest.id;
    setDeleting(true);
    try {
      await invoke('execute_job', { id, runId: crypto.randomUUID(), operation: 'delete', actionId: null, params: options });
      hooks.forget(tool);
      sessions.current.forget(tool);
      if (currentScope.current && JSON.parse(currentScope.current)[0] === tool.directory) currentScope.current = '';
      setTools(items => items.filter(item => item.manifest.id !== id));
      setFavorites(items => items.filter(item => item !== id));
      setRuns(current => Object.fromEntries(Object.entries(current).filter(([,run]) => run.toolId !== id)));
      setDeleteTarget(undefined);
      await refresh();
    } catch (e) { setMessage(String(e)); } finally { setDeleting(false); }
  }
  async function saveSettings() { if (formDisabled) return; try { const saved=await invoke<Record<string,Json>>('save_tool_settings',{id:selected,settings:toolSettings}); setToolSettings(saved); await refresh(); setMessage(tr("Saved")); }catch(e){setMessage(String(e));} }
  async function openTarget(target: string) { try{await invoke('open_target',{target});}catch(e){setMessage(String(e));} }
  const visible = tools.filter(t => `${t.manifest.name} ${t.manifest.runtime.kind}`.toLowerCase().includes(search.toLowerCase()));
  const hookProgress = hooks.events.filter(e => e.type === 'progress').at(-1)?.payload;
  const progress = run?.status === 'running' ? [...run.events].reverse().find(e=>e.type==='progress')?.payload : hookProgress;
  const percent = progress?.total ? Math.min(100,Math.round(progress.value/progress.total*100)) : undefined;
  return <LocaleContext.Provider value={locale}><div className="app-shell">
    <aside ref={sidebar} className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''} ${dragOver ? 'drop-active' : ''}`}>
      {dragOver && <div className="sidebar-drop-hint">{tr("Drop ZIP to import")}</div>}<div className="brand"><CubeIcon size={36} weight="duotone"/><span>ToolDeck</span><Button type="button" className="sidebar-toggle" title={sidebarCollapsed ? tr("Expand sidebar") : tr("Collapse sidebar")} aria-label={sidebarCollapsed ? tr("Expand sidebar") : tr("Collapse sidebar")} aria-expanded={!sidebarCollapsed} onClick={toggleSidebar}>{sidebarCollapsed ? <CaretRightIcon size={18}/> : <CaretLeftIcon size={18}/>}</Button></div>
      <div className="search"><Input icon={<MagnifyingGlassIcon size={16}/>} aria-label={tr("Search tools")} placeholder={tr("Search tools")} value={search} onChange={e=>setSearch(e.target.value)}/></div>
      <div className="library-groups">{([['favorites',tr("Favorites")],['all',tr("All tools")]] as const).map(([group,label]) => {
        const items = visible.filter(t => group === 'all' || favorites.includes(t.manifest.id));
        const count = tools.filter(t => group === 'all' || favorites.includes(t.manifest.id)).length;
        return <Collapsible className="library-group" contentClassName="px-0" key={group} title={`${label} (${count})`} value={expanded[group]} onChange={open => setExpanded(current => ({...current,[group]:open}))}>
          <div className="tool-list">{items.map(t=><Button key={t.manifest.id} className={`tool-row ${t.compatible ? '' : 'incompatible'} ${selected===t.manifest.id?'selected':''}`} onClick={()=>setSelected(t.manifest.id)}><ToolIcon tool={t}/><span className="tool-name" title={t.manifest.name}>{t.manifest.name}</span><ToolStatus tool={t} run={toolRuns[t.manifest.id]}/><span className="runtime-icon" title={runtimeLabel[t.manifest.runtime.kind]}><img src={`/runtime-icons/${t.manifest.runtime.kind === 'nodejs' ? 'nodejs' : t.manifest.runtime.kind}.svg`} alt={runtimeLabel[t.manifest.runtime.kind]} /></span></Button>)}{!items.length&&!loading&&<p className="list-empty">{group==='favorites'?tr("No favorites"):search?tr("No matching tools"):tr("No tools")}</p>}</div>
        </Collapsible>;
      })}</div>
      <div className="sidebar-footer"><Button title={tr("Import tool")} aria-label={tr("Import tool")} onClick={importZip} disabled={importing || !!pendingImport}>{importing?<CircleNotchIcon className="spin" size={22}/>:<PlusIcon size={22}/>}<span>{tr("Import tool")}</span></Button><Button title={tr("App settings")} aria-label={tr("App settings")} onClick={()=>setSettingsOpen(true)}><GearSixIcon size={22}/><span>{tr("App settings")}</span></Button></div>
    </aside>
    {deleteTarget && <DeleteToolDialog tool={deleteTarget} busy={deleting} close={()=>setDeleteTarget(undefined)} submit={deleteTool}/>}
    {pendingImport && <ImportDialog details={pendingImport.details} busy={importing} close={cancelImport} submit={confirmImport}/>}<main className="main">
      {!tool?<div className="empty-library"><CubeIcon size={64} weight="duotone"/><h1>{loading?tr("Loading…"):tr("No tools")}</h1><Button variant="primary" className="primary" onClick={importZip}><PlusIcon size={20}/>{tr("Import tool")}</Button></div>:<>
        <header className="tool-header"><div className="tool-heading"><ToolIcon tool={tool} size={42}/><div className="tool-title-content"><h1>{tool.manifest.name}</h1>{tool.manifest.description&&<p className="tool-description">{tool.manifest.description}</p>}<div className="tool-metadata"><span className="text-xs text-content-300">v{tool.manifest.version}</span><Badge variant="secondary">{runtimeLabel[tool.manifest.runtime.kind]}</Badge>{needsInstall&&<Badge variant={tool.installed?"success":"warning"}>{tool.installed?tr("Installed"):tr("Not installed")}</Badge>}{!tool.compatible&&<Badge variant="warning">{tr("Unsupported platform")}</Badge>}</div></div></div><div className="header-actions"><Button className={`icon-button ${favorites.includes(selected)?'favorited':''}`} aria-label={favorites.includes(selected)?tr("Remove from favorites"):tr("Add to favorites")} title={tr("Add to favorites")} onClick={()=>setFavorites(f=>f.includes(selected)?f.filter(id=>id!==selected):[...f,selected])}><StarIcon weight={favorites.includes(selected)?'fill':'regular'} size={21}/></Button><Button variant="secondary" className="secondary" disabled={busy||!tool.compatible||!needsInstall||tool.installed} onClick={()=>execute('install')}><DownloadSimpleIcon size={17}/>{tr("Install")}</Button>
          <Dropdown key={selected} align="end" items={[
            { key: 'uninstall', label: tr("Uninstall"), icon: <MinusCircleIcon/>, disabled: busy || !needsInstall || !tool.installed, onSelect: () => execute('uninstall') },
            { type: 'separator' },
            { key: 'delete', label: tr("Delete"), icon: <TrashIcon/>, danger: true, disabled: busy, onSelect: () => setDeleteTarget(tool) },
          ]}>
            <Button type="button" shape="square" aria-label={tr("More options")}><DotsThreeIcon size={20} weight="bold"/></Button>
          </Dropdown></div></header>
        <Tabs className="tool-tabs" aria-label={tr("Actions")} value={tab} onChange={setTab} items={([['actions',tr("Run")],['settings',tr("Tool settings")],['dependencies',tr("Environment")],['docs',tr("Docs")]] as const).filter(([id]) => (id !== 'settings' || Object.keys(tool.manifest.settings).length > 0) && (id !== 'docs' || tool.manifest.docs.length > 0)).map(([value,label])=>({value,label}))}/>
        {tab==='actions'?<SplitWorkspace><form className="parameters" onSubmit={e=>{e.preventDefault();execute('run');}}><div className="parameter-scroll"><div className="field"><label htmlFor="action">{tr("Action")}</label><Select id="action" icon={<FunctionIcon aria-hidden="true"/>} className="w-full min-w-0" value={actionId} disabled={formDisabled} onChange={id=>selectAction(tool,id)} options={Object.entries(tool.manifest.actions).map(([value,a])=>({value,label:a.name}))}/>{action?.description&&<p className="action-description">{action.description}</p>}</div><FieldForm key={JSON.stringify([selected,actionId,tool.manifest.version,formReset])} onCommit={hooks.commit} fields={formFields(action?.params, form)} values={form.values} onChange={values => setForm({...currentForm.current, values})} disabled={formDisabled}/></div><div className="run-footer"><Tooltip content={tr("Reset form and clear output")}><Button type="button" variant="secondary" className="secondary reset-action" disabled={actionDisabled} onClick={resetAction}><ArrowClockwiseIcon size={17}/>{tr("Reset")}</Button></Tooltip>{activeRun?<Button type="button" variant="danger" className="stop" onClick={()=>invoke('cancel_job',{runId:activeRun.id}).catch(e=>setMessage(String(e)))}><StopIcon size={19} weight="fill"/>{tr(activeRun.operation==='install'?'Stop installation':'Stop run')}</Button>:<Button variant="primary" className="primary" disabled={actionDisabled}><PlayIcon size={19} weight="fill"/>{tr("Run")}</Button>}</div></form>
        <section className="output"><div className="output-header"><div><h2>{tr("Output")}</h2>{run?.actionName&&<p className="output-action">{run.actionName}</p>}</div>{run&&<span className={`status ${run.status}`}>{run.status==='running'?<CircleNotchIcon className="spin" size={15}/>:run.status==='success'?<CheckCircleIcon size={15}/>:<WarningCircleIcon size={15}/>}{{running:tr("Running"),success:tr("Completed"),error:tr("Failed"),cancelled:tr("Cancelled")}[run.status]}{run.ended&&' · '+tr("{seconds} s", {seconds:((run.ended-run.started)/1000).toFixed(1)})}</span>}</div>{!run && !hooks.events.length?<div className="output-empty"><TerminalIcon size={38}/><p>{tr("No output")}</p></div>:<div className="output-content">{progress&&<div className="progress"><div><span>{progress.message||tr("Processing")}</span><span>{percent!==undefined?`${percent}%`:''}</span></div>{percent!==undefined && <Progress value={percent} aria-label={progress.message||tr("Processing")}/>}</div>}<div className="links">{outputEvents.filter(e=>e.type==='link').map((e,i)=><Button key={i} onClick={()=>openTarget(e.payload.target)}>{e.payload.kind==='directory'?<FolderIcon size={23}/>:e.payload.kind==='url'?<ArrowSquareOutIcon size={23}/>:<FileIcon size={23}/>}<span>{e.payload.label||e.payload.target}</span><CaretRightIcon size={17}/></Button>)}</div><div className="log-stream" aria-live="polite">{outputEvents.filter(e=>e.type==='log'||e.type==='output'||e.type==='table'||e.type==='details'||e.type==='completion').map((e,i)=>e.type==='details'?<Collapsible className="output-details" key={JSON.stringify([e.runId,e.payload.id])} title={`${showTimestamps && e.time ? `[${e.time}] ` : ""}${e.payload.title}`}><pre>{e.payload.text}</pre></Collapsible>:<div className={`log-line ${e.payload?.level||''}`} key={e.sequence ?? i}>{showTimestamps && e.time && <time>[${e.time}]</time>}{e.type==='completion'?<span className={`completion ${e.payload.status}`}>{nativeMessage(locale,e.payload.message)}</span>:e.type==='table'?<OutputTable value={e.payload} onOpen={openTarget}/>:e.type==='output'?<pre>{JSON.stringify(e.payload,null,2)}</pre>:<span>{e.payload.message}</span>}</div>)}<div ref={logEnd}/></div></div>}</section></SplitWorkspace>
        :tab==='settings'?<form className="settings-content" onSubmit={e=>{e.preventDefault();saveSettings();}}><FieldForm key={JSON.stringify([selected,tool.manifest.version,settingsReset])} fields={tool.manifest.settings} values={toolSettings} onChange={setToolSettings} disabled={formDisabled}/>{Object.keys(tool.manifest.settings).length?<div className="settings-actions"><Button type="button" variant="secondary" className="secondary" disabled={formDisabled} title={tr("Restore defaults; save to apply")} onClick={()=>{setToolSettings(defaults(tool.manifest.settings));setSettingsReset(value=>value+1);}}><ArrowClockwiseIcon size={16}/>{tr("Reset")}</Button><Button variant="primary" className="primary compact" disabled={formDisabled}>{tr("Save")}</Button></div>:<div className="quiet-empty">{tr("No settings")}</div>}</form>
        :tab==='dependencies'?<EnvironmentPanel key={selected} tool={tool}/>:<section className="documents">{tool.manifest.docs.length?<><div className="document-picker"><Select icon={<BookOpenIcon aria-hidden="true"/>} aria-label={tr("Select document")} value={documentId} onChange={setDocumentId} options={tool.manifest.docs.map(d=>({value:d.id,label:d.title}))}/></div><article className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkExplicitLinks]} components={{a:({href,children})=><a href={href} onClick={e=>{e.preventDefault();if(href)openTarget(href.startsWith('http')?href:`${tool.directory}/${href}`);}}>{children}</a>}}>{markdown}</ReactMarkdown></article></>:<div className="quiet-empty">{tr("No documentation")}</div>}</section>}
      </>}
    </main>
    {message&&<div className="app-notification"><ToastItem key={message} toast={{id:'app-message',description:nativeMessage(locale,message),variant:'default',duration:4000}} fromTop={false} closeLabel={tr("Dismiss")} onDismiss={()=>setMessage('')}/></div>}
    {settingsOpen&&<SettingsDialog config={config} detection={detection} busy={anyBusy} close={()=>setSettingsOpen(false)} error={setMessage} saved={async value=>{if (config?.dataDir !== value.dataDir) setSelected(''); setConfig(value);await refresh();}}/>}
    {confirmationDialog}
  </div></LocaleContext.Provider>;
}

function SettingsDialog({config,detection,busy,close,error,saved}:{config?:Config;detection:Detection;busy:boolean;close:()=>void;error:(s:string)=>void;saved:(c:Config)=>Promise<void>}){
  const { confirm, confirmationDialog } = useConfirmation();
  const tr = useTranslator();
  const [draft,setDraft]=useState<Config>(config||{dataDir:'',nodePath:'',uvPath:'',locale:'en',showOutputTimestamps:true}); const [found,setFound]=useState(detection); const [saving,setSaving]=useState(false);
  const [clearing,setClearing]=useState(false);
  const [logMessage,setLogMessage]=useState('');
  async function clearLogs(){
    if(!await confirm(tr("Clear all run logs in the current data directory?"), {title:tr("Clear run logs"),kind:'warning',okLabel:tr("Clear"),cancelLabel:tr("Cancel")}))return;
    setClearing(true);setLogMessage('');
    try{const count=await invoke<number>('clear_run_logs');setLogMessage(tr("Cleared {count} run logs", { count }));}catch(e){error(String(e));}finally{setClearing(false);}
  }
  async function choose(field:keyof Config){try{const value=await open({directory:field==='dataDir',multiple:false,title:field==='dataDir'?tr("Choose application data directory"):tr("Choose executable")});if(typeof value==='string')setDraft(d=>({...d,[field]:value}));}catch(e){error(String(e));}}
  async function submit(){setSaving(true);try{const value=await invoke<Config>('save_config',{config:draft});await saved(value);close();}catch(e){error(String(e));}finally{setSaving(false);}}
  return <><Dialog closeLabel={tr("Cancel")} open title={tr("App settings")} className="app-dialog" closable={!saving && !clearing} onOpenChange={open=>{if(!open&&!saving&&!clearing)close();}} footer={<><Button variant="secondary" className="secondary" disabled={saving||clearing} onClick={close}>{tr("Cancel")}</Button><Button variant="primary" className="primary compact" onClick={submit} disabled={busy||saving||clearing}>{saving?tr("Saving…"):tr("Save")}</Button></>}><div className="dialog-body"><div className="field"><label htmlFor="display-language">{tr("Display language")}</label><Select<Config['locale']> id="display-language" className="w-full min-w-0" value={draft.locale} onChange={locale=>setDraft({...draft,locale})} options={[{value:"en",label:"English"},{value:"zh-CN",label:translate("zh-CN", "Simplified Chinese")}]}/></div><h3>{tr("System runtimes")}</h3>{([['nodePath','Node.js',found.node],['uvPath','uv',found.uv]] as const).map(([key,label,detected])=><div className="field" key={key}><label htmlFor={key}>{label}</label><div className="input-group"><Input id={key} placeholder={detected || tr("Not detected")} value={draft[key]} readOnly/>{draft[key]&&<Button variant="secondary" shape="square" aria-label={tr("Auto-detect")} onClick={()=>setDraft({...draft,[key]:''})}><ArrowClockwiseIcon size={16}/></Button>}<Button variant="secondary" shape="square" title={tr("Choose {name}", { name: label })} onClick={()=>choose(key)}><FolderIcon size={20}/></Button></div></div>)}<Button type="button" variant="secondary" onClick={()=>invoke<Detection>('detect_runtimes').then(setFound).catch(e=>error(String(e)))}><ArrowClockwiseIcon size={17}/>{tr("Detect again")}</Button><div className="section-divider"/><h3>{tr("Application data directory")}</h3><div className="input-group"><Input aria-label={tr("Application data directory")} value={draft.dataDir} readOnly/><Button variant="secondary" shape="square" title={tr("Choose data directory")} onClick={()=>choose('dataDir')}><FolderIcon size={20}/></Button></div><div className="section-divider"/><h3>{tr("Run logs")}</h3>
      <div className="mb-3"><Checkbox label={tr("Show output timestamps")} value={draft.showOutputTimestamps ?? true}
        onChange={showOutputTimestamps => setDraft(current => ({...current, showOutputTimestamps}))}/></div>
      <Button type="button" variant="secondary" className="secondary" disabled={busy||clearing} onClick={clearLogs}>{clearing?tr("Clearing…"):tr("Clear run logs")}</Button>{logMessage&&<p className="hint">{logMessage}</p>}</div></Dialog>{confirmationDialog}</>;
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
          <Table><TableHeader><TableRow><TableHead scope="col">{tr("Name / declaration")}</TableHead><TableHead scope="col">{tr("Version requirement")}</TableHead></TableRow></TableHeader>
            <TableBody>{group.rows.map((row, index) => <TableRow key={index}><TableCell>{row.name}</TableCell><TableCell>{row.spec || '—'}</TableCell></TableRow>)}</TableBody>
          </Table>
        </section>) : null}
      {data && <Collapsible bordered className="dep-original" title={<><FileIcon size={15}/><span>{tr("View source file")}</span><code>{data.file}</code></>}>
        <pre>{data.content}</pre></Collapsible>}
    </>}
  </section>;
}
