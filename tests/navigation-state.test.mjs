import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

function load(file, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  const module = {exports:{}};
  new Function('require','module','exports',code)(name => {
    if (!(name in imports)) throw Error('Unexpected import: '+name);
    return imports[name];
  },module,module.exports);
  return module.exports;
}
const params = load('src/paramForm.ts');
const sessionsModule = load('src/paramSessions.ts', {'./paramForm':params});
const {ParamSessions, actionScope, toolScope} = sessionsModule;
const {latestToolRuns, clearActionRun, clearRunOutput} = load('src/runState.ts');
const {stampOutputEvent, chronologicalOutput, appendOutputEvent} = load('src/outputEvents.ts');

test('manual reset hook receives defaults without old overrides and writes after output clearing',()=>{
  const host=hookHost(), calls=[], a=tool('a');
  a.manifest.hooks.reset={event:'actionReset'};
  let form=params.applyPatch(params.newForm({text:'edited'}),{text:{visible:false}});
  const {useParamHooks}=load('src/useParamHooks.ts',{
    react:host.react,
    '@tauri-apps/api/core':{invoke:(command,args)=>{calls.push({command,...args});return new Promise(()=>{});}},
    './paramSessions':sessionsModule,'./outputEvents':load('src/outputEvents.ts'),
  });
  const render=()=>host.render(()=>useParamHooks(a,'create',form,patch=>{form=params.applyPatch(form,patch);},true,[a],()=>{}));
  let hooks=render(); const open=calls.at(-1).runId;
  hooks.receive({runId:open,type:'output',payload:'old'});
  assert.equal(calls.filter(c=>c.params?.event==='actionReset').length,0);
  hooks.reset();
  form=params.newForm({text:'default'});
  hooks.notifyReset(form);
  const reset=calls.at(-1);
  assert.equal(reset.params.event,'actionReset');
  assert.deepEqual(reset.params.values,{text:'default'});
  assert.deepEqual(reset.formOverrides,{});
  assert.equal(reset.params.changedKeys,undefined);
  hooks=render(); assert.deepEqual(hooks.events,[]);
  hooks.receive({runId:reset.runId,type:'output',payload:'reset done'});
  hooks.receive({runId:reset.runId,type:'updateParams',payload:{text:{value:'initialized'}}});
  hooks=render();
  assert.equal(hooks.events[0].payload,'reset done');
  assert.equal(form.values.text,'initialized');
  assert.equal(calls.filter(c=>c.params?.event==='actionReset').length,1);
  assert.equal(calls.filter(c=>c.params?.event==='actionOpen').length,1);
});

test('deleting and reimporting the same tool drops every action cache and ignores old writers',()=>{
  const host=hookHost(), calls=[], cache=new ParamSessions(), a=tool('a'), b=tool('b');
  const {useParamHooks}=load('src/useParamHooks.ts',{
    react:host.react,
    '@tauri-apps/api/core':{invoke:(command,args)=>{calls.push({command,...args});return new Promise(()=>{});}},
    './paramSessions':sessionsModule,'./outputEvents':load('src/outputEvents.ts'),
  });
  const render=(t,id='create')=>host.render(()=>useParamHooks(t,id,cache.select(t,id,{text:'default'}).form,(patch,scope)=>cache.patch(scope,patch),true,[a,b],()=>{}));
  let hooks=render(a); const oldOpen=calls.at(-1).runId;
  hooks.trackAction('old-action');
  hooks.receive({runId:oldOpen,type:'output',payload:'old output'});
  cache.patch(actionScope(a,'create'),{text:{value:'edited',visible:false}});
  hooks=render(a,'modify');
  const oldClose=calls.find(c=>c.params?.event==='actionClose').runId;
  hooks.receive({runId:calls.at(-1).runId,type:'output',payload:'other action output'});
  hooks=render(b); const bOpen=calls.at(-1).runId;
  hooks.receive({runId:bOpen,type:'output',payload:'keep other tool'});
  hooks.forget(a); cache.forget(a);
  hooks=render(a);
  for(const runId of [oldOpen,oldClose,'old-action']) {
    assert.equal(hooks.receive({runId,type:'updateParams',payload:{text:{value:'stale'}}}),false);
    assert.equal(hooks.receive({runId,type:'output',payload:'stale'}),false);
    assert.equal(hooks.receive({runId,type:'clearOutput',payload:null}),false);
  }
  assert.deepEqual(hooks.events,[]);
  assert.deepEqual(cache.select(a,'create',{}).form,params.newForm({text:'default'}));
  hooks=render(a,'modify'); assert.deepEqual(hooks.events,[]);
  hooks=render(b); assert.equal(hooks.events[0].payload,'keep other tool');
});

for (const scenario of ['overwrite','upgrade','relocate']) {
  test(`${scenario} starts with new defaults and fresh hooks even when the action ID is unchanged`,()=>{
    const host=hookHost(), calls=[], cache=new ParamSessions(), old=tool('a');
    const updated={...old,directory:scenario==='relocate'?'new-directory':old.directory,
      manifest:{...old.manifest,version:scenario==='upgrade'?'2':old.manifest.version}};
    const {useParamHooks}=load('src/useParamHooks.ts',{
      react:host.react,
      '@tauri-apps/api/core':{invoke:(command,args)=>{calls.push({command,...args});return new Promise(()=>{});}},
      './paramSessions':sessionsModule,'./outputEvents':load('src/outputEvents.ts'),
    });
    const render=(t,value)=>host.render(()=>useParamHooks(t,'create',cache.select(t,'create',{text:value}).form,
      (patch,scope)=>cache.patch(scope,patch),true,[t],()=>{}));
    let hooks=render(old,'old default'); const oldOpen=calls.at(-1).runId;
    hooks.trackAction('old-action');
    hooks.commit('text',{text:'edited'}); const oldChange=calls.at(-1).runId;
    hooks.receive({runId:oldOpen,type:'output',payload:'old output'});
    cache.patch(actionScope(old,'create'),{text:{value:'edited',visible:false}});
    hooks.forget(old); cache.forget(old);
    hooks.forget(updated); cache.forget(updated);
    const before=calls.length;
    hooks=render(updated,'new default');
    assert.deepEqual(hooks.events,[]);
    assert.deepEqual(cache.forms.get(actionScope(updated,'create')),params.newForm({text:'new default'}));
    const newCalls=calls.slice(before).filter(c=>c.command==='execute_job');
    assert.deepEqual(newCalls.map(c=>c.params.event),['actionOpen'],'no old actionClose or duplicate actionOpen');
    assert.equal(newCalls[0].params.values.text,'new default');
    for (const runId of [oldOpen,oldChange,'old-action']) {
      assert.equal(hooks.receive({runId,type:'updateParams',payload:{text:{value:'stale'}}}),false);
      assert.equal(hooks.receive({runId,type:'output',payload:'stale'}),false);
      assert.equal(hooks.receive({runId,type:'clearOutput',payload:null}),false);
    }
    hooks.receive({runId:newCalls[0].runId,type:'output',payload:'new output'});
    hooks=render(updated,'new default');
    assert.equal(hooks.events[0].payload,'new output');
    assert.equal(calls.slice(before).filter(c=>c.params?.event==='actionOpen').length,1);
  });
}

test('mixed hook, task and completion output follows ingress order even within one millisecond',t=>{
  t.mock.method(Date,'now',()=>1000);
  const install=stampOutputEvent({runId:'install',type:'log',payload:{message:'installed packages'}});
  const completion=stampOutputEvent({runId:'install',type:'completion',payload:{status:'success',message:'Installation completed'}});
  const open=stampOutputEvent({runId:'open',type:'log',payload:{message:'actionOpen'}});
  const table=stampOutputEvent({runId:'other-hook',type:'table',payload:{rows:[]}});
  const greeting=stampOutputEvent({runId:'open',type:'output',payload:'Hello'});
  assert.deepEqual(chronologicalOutput([open,greeting,table,install,completion]),[install,completion,open,table,greeting]);
  assert.equal(stampOutputEvent(open),open,'routing an event must not stamp it again');
  for (const event of [install,completion,open,table,greeting]) assert.ok(event.time);
  Date.now.mock.mockImplementation(()=>900);
  const error=stampOutputEvent({runId:'task',type:'completion',payload:{status:'error',message:'Failed'}});
  assert.deepEqual(chronologicalOutput([error,greeting]),[greeting,error],'clock changes must not reorder received messages');
});

test('streaming details retain their first position among chronological ordinary output',()=>{
  const first=stampOutputEvent({runId:'hook',type:'details',payload:{id:'thinking',title:'Thinking',text:'one'}});
  const log=stampOutputEvent({runId:'task',type:'log',payload:{message:'middle'}});
  const chunk=stampOutputEvent({runId:'hook',type:'details',payload:{id:'thinking',title:'Thinking',text:'two'}});
  const events=chronologicalOutput([...appendOutputEvent([first],chunk),log]);
  assert.equal(events[0].payload.text,'onetwo');
  assert.equal(events[0].sequence,first.sequence);
  assert.equal(events[1],log);
});
function tool(id) {
  return {directory:id,installed:true,compatible:true,manifest:{id,version:'1',actions:{create:{},modify:{}},hooks:{
    open:{event:'actionOpen'},close:{event:'actionClose'},change:{event:'paramsChange'},
  }}};
}

test('clearOutput clears all sources in its action, preserves running jobs and accepts subsequent output',()=>{
  const host=hookHost(), calls=[], cache=new ParamSessions(), a=tool('a');
  const scope=actionScope(a,'create'), other=actionScope(a,'modify');
  let runs={
    [scope]:{id:'install',toolId:'a',status:'success',events:[{type:'completion',payload:'Installed'}]},
    [other]:{id:'other',toolId:'a',status:'success',events:[{type:'output',payload:'keep'}]},
  };
  const {useParamHooks}=load('src/useParamHooks.ts',{
    react:host.react,
    '@tauri-apps/api/core':{invoke:(command,args)=>{calls.push({command,...args});return new Promise(()=>{});}},
    './paramSessions':sessionsModule,'./outputEvents':load('src/outputEvents.ts'),
  });
  const render=()=>host.render(()=>useParamHooks(a,'create',cache.select(a,'create',{}).form,()=>{},true,[a],key=>{runs=clearRunOutput(runs,key);}));
  let hooks=render(); const open=calls.at(-1).runId;
  hooks.receive({runId:open,type:'link',payload:{kind:'url',target:'https://example.org'}});
  hooks.commit('text',{}); const change=calls.at(-1).runId;
  hooks.receive({runId:change,type:'progress',payload:{message:'loading'}});
  hooks.receive({runId:change,type:'clearOutput',payload:null});
  hooks=render();
  assert.deepEqual(hooks.events,[]);
  assert.equal(runs[scope],undefined,'system completion output is cleared');
  assert.equal(runs[other].events.length,1);
  hooks.receive({runId:open,type:'log',payload:{message:'new output'}});
  hooks=render(); assert.equal(hooks.events.length,1,'clear does not cancel writers');
  runs[scope]={id:'task',toolId:'a',status:'running',events:[{type:'output',payload:'old'}]};
  hooks.trackAction('task');
  hooks.receive({runId:'task',type:'clearOutput',payload:null});
  hooks=render(); assert.deepEqual(hooks.events,[]);
  assert.equal(runs[scope].status,'running');
  assert.deepEqual(runs[scope].events,[]);
});

test('action outputs remain separate and reset only clears the selected completed run',()=>{
  const a=tool('a'), b=tool('b');
  const first=actionScope(a,'create'), second=actionScope(a,'modify'), other=actionScope(b,'create');
  const runs={
    [first]:{id:'1',toolId:'a',status:'success',started:1,events:[{type:'output',payload:'first result'}]},
    [second]:{id:'2',toolId:'a',status:'running',started:2,events:[{type:'output',payload:'second result'}]},
    [other]:{id:'3',toolId:'b',status:'success',started:3,events:[]},
  };
  assert.equal(latestToolRuns(runs).a.id,'2');
  assert.equal(runs[first].events[0].payload,'first result');
  assert.equal(clearActionRun(runs,second),runs,'running jobs cannot be cleared');
  const cleared=clearActionRun(runs,first);
  assert.equal(cleared[first],undefined);
  assert.equal(cleared[second],runs[second]);
  assert.equal(cleared[other],runs[other]);
  assert.equal(latestToolRuns(cleared).a.status,'running');
});

test('forms restore per action and tool, including background patches and dynamic fields',()=>{
  const cache=new ParamSessions(), a=tool('a'), b=tool('b');
  const create=cache.select(a,'create',{text:'draft'});
  cache.patch(create.scope,{text:{value:'edited',visible:false}});
  const modify=cache.select(a,'modify',{text:'modify'});
  cache.select(b,'create',{text:'other tool'});
  cache.patch(modify.scope,{text:{value:'background result'}});
  assert.equal(cache.actions.get(toolScope(a)),'modify');
  assert.equal(cache.select(a,'modify',{}).form.values.text,'background result');
  assert.equal(cache.select(a,'create',{}).form.values.text,'edited');
  assert.equal(cache.select(a,'create',{}).form.overrides.text.visible,false);
  assert.equal(cache.select(b,'create',{}).form.values.text,'other tool');
  cache.forget(a);
  assert.equal(cache.patch(modify.scope,{text:{value:'stale result'}}),undefined);
  assert.equal(cache.select(a,'create',{text:'fresh'}).form.values.text,'fresh');
  assert.equal(cache.select({...a,manifest:{...a.manifest,version:'2'}},'create',{text:'v2'}).form.values.text,'v2');
});

// Small synchronous hook host: runs layout-effect cleanup/setup in React order.
function hookHost() {
  const slots=[];
  let cursor=0, effects=[];
  const react={
    useRef(value) {const i=cursor++; return slots[i]??= {current:value};},
    useState(value) {
      const i=cursor++; if (!(i in slots)) slots[i]=value;
      return [slots[i],next=>{slots[i]=typeof next==='function'?next(slots[i]):next;}];
    },
    useCallback(fn) {cursor++; return fn;},
    useLayoutEffect(fn,deps) {
      const i=cursor++, previous=slots[i];
      if (!deps || !previous || deps.some((d,j)=>!Object.is(d,previous.deps[j]))) {
        effects.push({i,fn,deps,cleanup:previous?.cleanup});
      }
    },
  };
  return {react,render(fn) {
    cursor=0; effects=[];
    const result=fn();
    for (const effect of effects) effect.cleanup?.();
    for (const effect of effects) slots[effect.i]={deps:effect.deps,cleanup:effect.fn()};
    return result;
  }};
}

test('navigation fires lifecycle hooks, cancels parameter hooks, and routes action updates to their owner',()=>{
  const host=hookHost(), calls=[], cache=new ParamSessions();
  const {useParamHooks}=load('src/useParamHooks.ts',{
    react:host.react,
    '@tauri-apps/api/core':{invoke:(command,args)=>{calls.push({command,...args});return new Promise(()=>{});}},
    './paramSessions':sessionsModule,
    './outputEvents':load('src/outputEvents.ts'),
  });
  const a=tool('a'),b=tool('b');
  const apply=(patch,scope)=>cache.patch(scope,patch);
  const render=(t,visible=true)=>host.render(()=>useParamHooks(t,'modify',cache.select(t,'modify',{text:t.directory}).form,apply,visible,[a,b],()=>{}));
  let hooks=render(a);
  hooks.trackAction('task-a');
  hooks.commit('text',{text:'a'});
  const parameter=calls.find(c=>c.params?.event==='paramsChange');
  hooks=render(b);
  assert.deepEqual(calls.filter(c=>['actionOpen','actionClose'].includes(c.params?.event)).map(c=>[c.id,c.params.event]),[
    ['a','actionOpen'],['a','actionClose'],['b','actionOpen'],
  ]);
  assert.ok(calls.some(c=>c.command==='cancel_job'&&c.runId===parameter.runId));
  assert.ok(!calls.some(c=>c.command==='cancel_job'&&c.runId==='task-a'));
  assert.equal(hooks.receive({runId:parameter.runId,type:'updateParams',payload:{text:{value:'late hook'}}}),false);
  hooks.receive({runId:'task-a',type:'updateParams',payload:{text:{value:'finished'}}});
  assert.equal(cache.forms.get(actionScope(a,'modify')).values.text,'finished');
  assert.equal(cache.forms.get(actionScope(b,'modify')).values.text,'b');
  const close=calls.find(c=>c.params?.event==='actionClose');
  hooks.receive({runId:close.runId,type:'updateParams',payload:{text:{value:'close patch'}}});
  assert.equal(cache.forms.get(actionScope(a,'modify')).values.text,'finished');
  hooks=render(a);
  hooks.receive({runId:'task-a',type:'updateParams',payload:{text:{value:'after return'}}});
  assert.equal(cache.forms.get(actionScope(a,'modify')).values.text,'after return');
  const before=calls.length;
  render(a);
  assert.equal(calls.length,before,'ordinary renders must not reopen the page');
  render(a,false);
  assert.equal(calls.at(-1).params.event,'actionClose');
  render(a,true);
  assert.equal(calls.at(-1).params.event,'actionOpen');
});

test('reset clears only current hook output and rejects late writes without reopening hooks',()=>{
  const host=hookHost(), calls=[], cache=new ParamSessions();
  const {useParamHooks}=load('src/useParamHooks.ts',{
    react:host.react,
    '@tauri-apps/api/core':{invoke:(command,args)=>{calls.push({command,...args});return new Promise(()=>{});}},
    './paramSessions':sessionsModule,
    './outputEvents':load('src/outputEvents.ts'),
  });
  const a=tool('a');
  const render=id=>host.render(()=>useParamHooks(a,id,cache.select(a,id,{}).form,(patch,scope)=>cache.patch(scope,patch),true,[a],()=>{}));
  let hooks=render('create');
  const first=calls.at(-1).runId;
  hooks.receive({runId:first,type:'output',payload:'keep me'});
  hooks=render('modify');
  const second=calls.at(-1).runId;
  hooks.trackAction('finished-action');
  hooks.receive({runId:second,type:'output',payload:'clear me'});
  hooks=render('modify');
  assert.equal(hooks.events.length,1);
  hooks.reset();
  const count=calls.length;
  hooks=render('modify');
  assert.equal(calls.length,count,'reset must not trigger actionOpen again');
  assert.equal(hooks.events.length,0);
  assert.equal(hooks.pendingCount,0);
  assert.ok(calls.some(c=>c.command==='cancel_job'&&c.runId===second));
  for (const runId of [second,'finished-action']) {
    assert.equal(hooks.receive({runId,type:'updateParams',payload:{text:{value:'late'}}}),false);
    assert.equal(hooks.receive({runId,type:'output',payload:'late'}),false);
  }
  hooks=render('create');
  assert.equal(hooks.events[0].payload,'keep me');
});
