import { applyPatch, newForm, type ParamForm, type ParamPatch } from './paramForm';
import type { Json, Tool } from './types';

export const toolScope = (tool: Tool) => JSON.stringify([tool.directory, tool.manifest.version]);
export const actionScope = (tool: Tool, actionId: string) => JSON.stringify([tool.directory, tool.manifest.version, actionId]);

// Session-only state. Package versions have separate form schemas and caches.
export class ParamSessions {
  forms = new Map<string, ParamForm>();
  actions = new Map<string, string>();
  select(tool: Tool, actionId: string, defaults: Record<string, Json>) {
    const scope = actionScope(tool, actionId);
    this.actions.set(toolScope(tool), actionId);
    if (!this.forms.has(scope)) this.forms.set(scope, newForm(defaults));
    return {scope, form: this.forms.get(scope)!};
  }
  patch(scope: string, patch: ParamPatch) {
    const previous = this.forms.get(scope);
    if (!previous) return;
    const next = applyPatch(previous, patch);
    this.forms.set(scope, next);
    return next;
  }
  forget(tool: Tool) {
    for (const key of this.forms.keys()) if (JSON.parse(key)[0] === tool.directory) this.forms.delete(key);
    for (const key of this.actions.keys()) if (JSON.parse(key)[0] === tool.directory) this.actions.delete(key);
  }
}
