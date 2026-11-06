import type { Run } from './types';

export function latestToolRuns(runs: Record<string, Run>) {
  const latest: Record<string, Run> = {};
  for (const run of Object.values(runs)) {
    const previous = latest[run.toolId];
    if (!previous || (run.status === 'running' && previous.status !== 'running') ||
        (previous.status !== 'running' && run.started >= previous.started)) latest[run.toolId] = run;
  }
  return latest;
}

export function clearActionRun(runs: Record<string, Run>, scope: string) {
  if (runs[scope]?.status === 'running') return runs;
  const next = {...runs};
  delete next[scope];
  return next;
}

export function clearRunOutput(runs: Record<string, Run>, scope: string) {
  if (!runs[scope]) return runs;
  if (runs[scope].status !== 'running') return clearActionRun(runs, scope);
  return {...runs, [scope]: {...runs[scope], events: [], message: undefined}};
}
