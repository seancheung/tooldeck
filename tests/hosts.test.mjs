import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const root = process.cwd();
const python = process.env.TOOLDECK_TEST_PYTHON || 'python';
const hasPython = !spawnSync(python, ['--version']).error;

async function runHost(runtime, action, params, directory) {
  const events = [];
  const context = { locale: 'zh-CN', apiVersion:'1.0.0', runId:'test-run', toolId:'test.tool', toolVersion:'1.0.0', actionId:action, params, settings:{prefix:'Hello',uppercase:false},paths:{tool:root,data:directory,temp:directory} };
  if (action === 'hook') context.hookEvent = {type: 'paramsChange', changedKeys: ['name']};
  let channelError;
  const server = net.createServer(socket=>{
    socket.write(JSON.stringify(context)+'\n');
    createInterface({input:socket}).on('error', error => { channelError = error; }).on('line', line=>{events.push(JSON.parse(line));socket.write('ok\n');});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const host = path.resolve(`src-tauri/hosts/${runtime === 'node' ? 'node_host.mjs':'python_host.py'}`);
  const entry = path.resolve(`examples/${runtime==='node'?'node-example':'python-example'}/${action}.${runtime==='node'?'mjs':'py'}`);
  let actionEntry = entry;
  if (action === 'clear' || action === 'invalid-clear') {
    actionEntry = path.join(directory, runtime === 'node' ? 'clear.mjs' : 'clear.py');
    const args = action === 'clear' ? '' : '"old-hook-id"';
    fs.writeFileSync(actionEntry, runtime === 'node'
      ? `export function main(ctx) { ctx.log("before"); ctx.clearOutput(${args}); ctx.log("after"); }`
      : `def main(ctx):\n    ctx.log("before")\n    ctx.clearOutput(${args})\n    ctx.log("after")\n`);
  }
  if (action === 'json-api') {
    actionEntry = path.join(directory, runtime === 'node' ? 'json-api.mjs' : 'json-api.py');
    fs.writeFileSync(actionEntry, runtime === 'node'
      ? 'export function main(ctx) { const value={count:2,enabled:true,items:[null,"text"]}; ctx.json(value); ctx.log(JSON.stringify(value)); }'
      : 'import json\ndef main(ctx):\n    value = {"count": 2, "enabled": True, "items": [None, "text"]}\n    ctx.json(value)\n    ctx.log(json.dumps(value))\n');
  }
  if (action === 'locale') {
    actionEntry = path.join(directory, runtime === 'node' ? 'locale.mjs' : 'locale.py');
    fs.writeFileSync(actionEntry, runtime === 'node'
      ? 'export function main(ctx) { ctx.json(ctx.locale); }'
      : 'def main(ctx):\n    ctx.json(ctx.locale)\n');
  }
  if (action === 'hook') {
    actionEntry = path.join(directory, runtime === 'node' ? 'observe.mjs' : 'observe.py');
    fs.writeFileSync(actionEntry, runtime === 'node'
      ? 'export function main(ctx, event) { ctx.clearOutput(); ctx.json(event); ctx.updateParams({name:{value:"Ada"}}); ctx.details({id:"info",title:"Info",text:" a "}); }'
      : 'def main(ctx, event):\n    ctx.clearOutput()\n    ctx.json(event)\n    ctx.updateParams({"name":{"value":"Ada"}})\n    ctx.details({"id":"info","title":"Info","text":" a "})\n');
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('TOOLDECK_')));
  const child=spawn(runtime==='node'?process.execPath:python,[host,actionEntry,String(server.address().port)],{env:{...env,PYTHONUTF8:'1'},stdio:['ignore','pipe','pipe']});
  let stderr=''; child.stderr.on('data',x=>stderr+=x);
  const timer=setTimeout(()=>child.kill(),10000);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  clearTimeout(timer);server.close();
  // A rejected action may close with a pending acknowledgement on Windows.
  if (channelError && (code === 0 || channelError.code !== 'ECONNRESET')) throw channelError;
  return {events,code,stderr};
}
for(const runtime of ['node','python']) {
  test(`${runtime}: independent ctx entry, structured events and overwrite failure`,{skip:runtime==='python'&&!hasPython},async()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tooldeck-host-'));
    const clear = await runHost(runtime,'clear',{},dir);
    assert.equal(clear.code,0,clear.stderr);
    assert.deepEqual(clear.events.map(e=>e.type),['log','clearOutput','log']);
    assert.equal(clear.events[1].payload,null);
    const invalidClear = await runHost(runtime,'invalid-clear',{},dir);
    assert.notEqual(invalidClear.code,0,'clearOutput must reject arguments');
    const jsonApi = await runHost(runtime,'json-api',{},dir);
    assert.equal(jsonApi.code,0,jsonApi.stderr);
    assert.deepEqual(jsonApi.events.map(e=>e.type),['output','log']);
    assert.deepEqual(jsonApi.events[0].payload,{count:2,enabled:true,items:[null,'text']});
    assert.equal(typeof jsonApi.events[1].payload.message,'string');
    assert.deepEqual(JSON.parse(jsonApi.events[1].payload.message),jsonApi.events[0].payload);
    const locale = await runHost(runtime,'locale',{},dir);
    assert.equal(locale.code,0,locale.stderr);
    assert.equal(locale.events[0].payload,'zh-CN');
    const hook = await runHost(runtime, 'hook', {}, dir);
    assert.equal(hook.code, 0, hook.stderr);
    assert.deepEqual(hook.events.map(e => e.type), ['clearOutput', 'output', 'updateParams', 'details']);
    assert.deepEqual(hook.events[3].payload, {id:"info", title:"Info", text:" a "});
    assert.deepEqual(hook.events[2].payload, {name:{value:'Ada'}});
    assert.deepEqual(hook.events[1].payload, {type: 'paramsChange', changedKeys: ['name']});
    const name='Montréal $(echo not-a-command)';
    const preview=await runHost(runtime,'preview',{name},dir);
    assert.equal(preview.code,0,preview.stderr);
    assert.equal(preview.events[0].type,'output');
    assert.equal(preview.events[0].payload.message,`Hello, ${name}!`);
    const destination=path.join(dir,'saved greeting.txt');
    const write=await runHost(runtime,'write',{name,destination},dir);
    assert.equal(write.code,0,write.stderr);
    assert.equal(fs.readFileSync(destination,'utf8'),`Hello, ${name}!\n`);
    assert.deepEqual(write.events.map(e=>e.type),['progress','output','link','link','progress']);
    assert.deepEqual(write.events.map(e=>e.seq),[1,2,3,4,5]);
    assert.equal(write.events[2].payload.target,destination);
    assert.equal(write.events.at(-1).payload.value,1);
    const duplicate=await runHost(runtime,'write',{name,destination},dir);
    assert.notEqual(duplicate.code,0);
    assert.equal(fs.readFileSync(destination,'utf8'),`Hello, ${name}!\n`);
  });
}
