import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ParamForm, ParamPatch } from './paramForm';
import { appendOutputEvent, stampOutputEvent } from './outputEvents';
import { actionScope } from './paramSessions';
import type { Event, Json, Tool } from './types';

export function useParamHooks(tool: Tool | undefined, actionId: string, form: ParamForm, apply: (patch: ParamPatch, scope: string) => void, visible: boolean, tools: Tool[], clearRun: (scope: string) => void) {
  const [outputs, setOutputs] = useState<Record<string, Event[]>>({});
  const pending = useRef(new Set<string>());
  const [pendingCount, setPendingCount] = useState(0);
  const calls = useRef(new Map<string, string>());
  const parameterRuns = useRef(new Set<string>());
  const closing = useRef(new Map<string, string>());
  const actionRuns = useRef(new Map<string, {runId:string; scope:string}>());
  const scope = tool ? actionScope(tool, actionId) : '';
  const activeScope = visible && tool?.installed && tool.compatible && tool.manifest.actions[actionId] ? scope : null;
  useLayoutEffect(() => {
    setPendingCount(0);
    return () => {
      pending.current.clear();
      for (const runId of parameterRuns.current) void invoke('cancel_job', {runId}).catch(() => {});
      parameterRuns.current.clear();
      calls.current.clear();
    };
  }, [activeScope]);

  const receive = useCallback((event: Event) => {
    event = stampOutputEvent(event);
    function clear(scope: string) {
      setOutputs(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => JSON.parse(key)[0] !== scope)));
      clearRun(scope);
    }
    if (event.type === 'updateParams' || event.type === 'clearOutput') {
      const run = [...actionRuns.current.values()].find(r => r.runId === event.runId);
      if (run) {
        if (event.type === 'updateParams') {
          apply(event.payload, run.scope);
        } else {
          clear(run.scope);
        }
        return true;
      }
    }
    for (const [hookId, runId] of [...calls.current, ...closing.current]) {
      if (runId !== event.runId) continue;
      if (event.type === 'clearOutput') { clear(JSON.parse(hookId)[0]); return true; }
      if (event.type === 'updateParams') {
        if (closing.current.get(hookId) === runId) return true;
        try { apply(event.payload, JSON.parse(hookId)[0]); return true; }
        catch (error) { event = {...event, type:'log', payload:{level:'error', message:String(error)}}; }
      }
      setOutputs(previous => ({
        ...previous,
        [hookId]: appendOutputEvent(previous[hookId] ?? [], event),
      }));
      return true;
    }
    return false;
  }, [apply, clearRun]);

  function dispatch(hookId: string, values: Record<string, Json>, changedKeys?: string[], overrides = form.overrides) {
    if (!tool?.installed || !tool.compatible) return;
    const event = tool.manifest.hooks![hookId].event;
    const isClose = event === 'actionClose';
    const registry = isClose ? closing.current : calls.current;
    const outputKey = JSON.stringify([scope, hookId]);
    const previous = registry.get(outputKey);
    const runId = crypto.randomUUID();
    registry.set(outputKey, runId);
    if (previous) pending.current.delete(previous);
    if (!isClose) pending.current.add(runId);
    if (event === 'paramsChange') parameterRuns.current.add(runId);
    setPendingCount(pending.current.size);
    if (previous) void invoke('cancel_job', { runId: previous }).catch(() => {});
    void invoke('execute_job', {
      id: tool.manifest.id, runId, operation: 'hook', actionId, formOverrides: overrides,
      params: { hookId, event, changedKeys, values },
    }).catch(error => receive({runId, type: 'log', payload: {level: 'error', message: String(error)}}))
      .finally(() => {
        parameterRuns.current.delete(runId);
        if (pending.current.delete(runId)) setPendingCount(pending.current.size);
      });
  }
  function commit(key: string, values: Record<string, Json>) {
    if (!activeScope || !tool) return;
    for (const [hookId, hook] of Object.entries(tool.manifest.hooks ?? {})) {
      if (hook.event !== 'paramsChange' || (hook.paramKeys && !hook.paramKeys.includes(key))) continue;
      dispatch(hookId, values, [key]);
    }
  }

  // Keep the outgoing action's last committed form, even when tool and action
  // selection change in separate renders. Ordinary edits only refresh the snapshot.
  const last = useRef<{scope: string; tool: Tool; close: () => void} | null>(null);
  useLayoutEffect(() => {
    const outgoing = last.current;
    const changed = outgoing?.scope !== activeScope;
    if (changed && outgoing && tools.some(t => t.directory === outgoing.tool.directory &&
      t.manifest.version === outgoing.tool.manifest.version && t.installed && t.compatible)) {
      outgoing.close();
    }
    if (!activeScope || !tool) { last.current = null; return; }
    function notify(type: 'actionOpen' | 'actionClose') {
      for (const [id, hook] of Object.entries(tool?.manifest.hooks ?? {})) {
        if (hook.event === type) dispatch(id, form.values);
      }
    }
    last.current = {scope: activeScope, tool, close: () => notify('actionClose')};
    if (changed) notify('actionOpen');
  });

  const events = Object.keys(tool?.manifest.hooks ?? {}).flatMap(id => outputs[JSON.stringify([scope, id])] ?? []);
  function trackAction(runId: string) {
    if (tool) actionRuns.current.set(tool.directory, {runId, scope});
  }
  function reset() {
    // Retire all writers before clearing so late hook replies cannot refill the page.
    for (const registry of [calls.current, closing.current]) {
      for (const [key, runId] of registry) {
        if (JSON.parse(key)[0] !== scope) continue;
        registry.delete(key);
        pending.current.delete(runId);
        parameterRuns.current.delete(runId);
        void invoke('cancel_job', {runId}).catch(() => {});
      }
    }
    for (const [key, run] of actionRuns.current) if (run.scope === scope) actionRuns.current.delete(key);
    setPendingCount(pending.current.size);
    setOutputs(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => JSON.parse(key)[0] !== scope)));
  }
  function forget(removed: Tool) {
    const belongs = (scope: string) => JSON.parse(scope)[0] === removed.directory;
    for (const registry of [calls.current, closing.current]) {
      for (const [key, runId] of registry) {
        if (!belongs(JSON.parse(key)[0])) continue;
        registry.delete(key);
        pending.current.delete(runId);
        parameterRuns.current.delete(runId);
        void invoke('cancel_job', {runId}).catch(() => {});
      }
    }
    for (const [key, run] of actionRuns.current) if (belongs(run.scope)) actionRuns.current.delete(key);
    if (last.current?.tool.directory === removed.directory) last.current = null;
    setPendingCount(pending.current.size);
    setOutputs(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !belongs(JSON.parse(key)[0]))));
  }
  function notifyReset(next: ParamForm) {
    if (!activeScope || !tool) return;
    for (const [id, hook] of Object.entries(tool.manifest.hooks ?? {})) {
      if (hook.event === 'actionReset') dispatch(id, next.values, undefined, next.overrides);
    }
  }
  return { events, commit, receive, trackAction, reset, notifyReset, forget, pendingCount, isPending: () => pending.current.size > 0 };
}
