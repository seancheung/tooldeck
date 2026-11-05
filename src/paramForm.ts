import type { Field, Json } from './types';

type Option = {value: Json; label?: string};
type Override = {options?: Option[]; visible?: boolean; unset?: true};
export type ParamPatch = Record<string, Override & {value?: Json}>;
export type ParamForm = {
  values: Record<string, Json>;
  overrides: Record<string, Override>;
  revisions: Record<string, number>;
};

export function newForm(values: Record<string, Json> = {}): ParamForm {
  return {values, overrides: {}, revisions: {}};
}

export function equal(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  }
  return Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

// Build the entire next state before publishing it. Check against the live selection,
// which may have changed since the hook received its snapshot.
export function applyPatch(form: ParamForm, patch: ParamPatch): ParamForm {
  const values = {...form.values}, overrides = {...form.overrides}, revisions = {...form.revisions};
  for (const [key, change] of Object.entries(patch)) {
    const {value, ...presentation} = change;
    const previous = Object.hasOwn(overrides, key) ? overrides[key] : {};
    if (Object.keys(presentation).length) overrides[key] = {...previous, ...presentation};
    if (Object.hasOwn(change, 'value')) values[key] = value!;
    if (change.unset) delete values[key];
    if (Object.hasOwn(change, 'value') || change.unset) revisions[key] = (Object.hasOwn(revisions, key) ? revisions[key] : 0) + 1;
    const options = (change.options ?? previous.options);
    if (options && Object.hasOwn(values, key) && !options.some(o => equal(o.value, values[key]))) {
      throw new Error(`${key}: selected value is outside the options`);
    }
  }
  return {values, overrides, revisions};
}

export function formFields(fields: Record<string, Field> = {}, form: ParamForm): Record<string, Field> {
  return Object.fromEntries(Object.entries(fields).map(([key, original]) => {
    const change = Object.hasOwn(form.overrides, key) ? form.overrides[key] : undefined;
    const revision = Object.hasOwn(form.revisions, key) ? form.revisions[key] : 0;
    if (!change && !revision) return [key, original];
    const field = {...original, schema: {...original.schema}, visible: change?.visible, revision};
    if (change?.unset) delete field.schema.default;
    if (change?.options) {
      field.schema.enum = change.options.map(o => o.value);
      field.ui = {...field.ui, options: change.options.map(o => ({value:o.value, label:o.label ?? String(o.value)}))};
    }
    return [key, field];
  }));
}
