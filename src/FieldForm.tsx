import { equal } from './paramForm';
import { useTranslator } from './i18n';
import { FolderOpenIcon, EyeIcon, EyeSlashIcon, XIcon } from '@phosphor-icons/react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useRef, useState } from 'react';
import type { Condition, Field, Json } from './types';

export function defaults(fields: Record<string, Field> = {}) {
  return Object.fromEntries(Object.entries(fields).filter(([, f]) => f.schema.default !== undefined).map(([k, f]) => [k, f.schema.default])) as Record<string, Json>;
}
function matches(condition: Condition, fields: Record<string, Field>, values: Record<string, Json>): boolean {
  if ('cond' in condition) {
    const children = condition.cond;
    return condition.op === 'and'
      ? children.every(child => matches(child, fields, values))
      : children.some(child => matches(child, fields, values));
  }
  const actual = Object.hasOwn(values, condition.key) ? values[condition.key] : fields[condition.key]?.schema.default;
  switch (condition.op) {
    case 'null': return actual == null;
    case 'notNull': return actual != null;
    case 'empty': return actual == null || actual === '';
    case 'eq': return equal(actual, condition.value);
    case 'not': return !equal(actual, condition.value);
    case 'gt': return typeof actual === 'number' && actual > condition.value;
    case 'gte': return typeof actual === 'number' && actual >= condition.value;
    case 'lt': return typeof actual === 'number' && actual < condition.value;
    case 'lte': return typeof actual === 'number' && actual <= condition.value;
  }
}

export function FieldForm({ fields = {}, values, onChange, onCommit, disabled = false }: { fields?: Record<string, Field>; values: Record<string, Json>; onChange: (v: Record<string, Json>) => void; onCommit?: (key: string, values: Record<string, Json>) => void; disabled?: boolean }) {
  const latestValues = useRef(values);
  latestValues.current = values;
  function snapshot(key: string, value: Json | undefined) {
    const next = { ...latestValues.current };
    if (value === undefined) delete next[key]; else next[key] = value;
    return next;
  }
  return <div className="fields">{Object.entries(fields).filter(([, field]) => field.visible !== false && (!field.availableWhen || matches(field.availableWhen, fields, values))).map(([key, field]) => <FieldInput key={JSON.stringify([key, field.revision])} name={key} field={field} value={values[key]} disabled={disabled} set={value => onChange(snapshot(key, value))} commit={value => onCommit?.(key, snapshot(key, value))} />)}</div>;
}
function FieldInput({ name, field, value, set, commit, disabled }: { name: string; field: Field; value: Json|undefined; set: (v: Json|undefined) => void; commit: (v: Json|undefined) => void; disabled: boolean }) {
  const tr = useTranslator();
  const [visible, setVisible] = useState(false);
  const [raw, setRaw] = useState<string>();
  const [error, setError] = useState('');
  const schema = field.schema;
  const component = field.ui?.component || (schema.enum ? 'select' : schema.type === 'boolean' ? 'checkbox' : ['number', 'integer'].includes(schema.type) ? 'number' : ['array', 'object'].includes(schema.type) ? 'json' : 'text');
  const multiple = component === 'file' && field.ui?.multiple === true;
  const label = field.ui?.label || name;
  const id = `field-${name}`;
  const committed = useRef(value);
  function commitValue(next: Json | undefined) {
    if (equal(committed.current, next)) return;
    committed.current = next;
    commit(next);
  }
  function choose(next: Json | undefined) {
    set(next);
    commitValue(next);
  }
  async function browse() {
    try {
      const filters = component === 'file' ? field.ui?.filters : undefined;
      const saving = component === 'file' && !multiple && field.ui?.mode === 'save';
      const picked = saving ? await save({ title: label, defaultPath: typeof value === 'string' ? value : undefined, filters }) : await open({ title: label, directory: component === 'directory', multiple, filters });
      if (multiple && picked) {
        choose([...new Set([...(Array.isArray(value) ? value as string[] : []), ...(Array.isArray(picked) ? picked : [picked])])]);
        setError('');
      } else if (typeof picked === 'string') {
        const extension = filters?.[0]?.extensions[0];
        const filename = picked.split(/[\\/]/).pop() || '';
        choose(saving && extension && extension !== '*' && !filename.includes('.') ? `${picked}.${extension}` : picked);
        setError('');
      }
    } catch (e) { setError(String(e)); }
  }
  return <div className="field">
    <label htmlFor={id} title={field.ui?.description}>{label}{field.required && <span className="required"> *</span>}</label>
    {component === 'checkbox' ? <label className="switch-row"><input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={e => choose(e.target.checked)} /><span>{value === true ? tr("Enabled") : tr("Disabled")}</span></label>
      : component === 'select' ? <select id={id} required={field.required} disabled={disabled} value={value === undefined ? '' : String((schema.enum || []).findIndex((option: Json) => equal(option, value)))} onChange={e => choose(e.target.value === '' ? undefined : schema.enum?.[Number(e.target.value)])}><option value="" disabled={field.required}>{field.ui?.placeholder || tr("Select…")}</option>{(schema.enum || []).map((option: Json, index: number) => <option key={index} value={index}>{field.ui?.options?.find(item => equal(item.value, option))?.label ?? String(option)}</option>)}</select>
      : multiple ? <div className="file-selection"><button id={id} type="button" className="secondary" disabled={disabled} onClick={browse}><FolderOpenIcon size={18}/>{tr("Choose files")}</button><span className="hint">{tr("{count} files selected", {count:Array.isArray(value) ? value.length : 0})}</span>{Array.isArray(value) && value.map((path, index) => <div className="selected-file" key={String(path)}><span title={String(path)}>{String(path)}</span><button type="button" className="file-remove" title={tr("Remove file")} aria-label={tr("Remove {name}", {name:String(path)})} disabled={disabled} onClick={() => choose(value.filter((_, i) => i !== index))}><XIcon size={16} aria-hidden="true"/></button></div>)}</div>
      : component === 'number' ? <input id={id} onBlur={() => commitValue(value)} placeholder={field.ui?.placeholder} type="number" required={field.required} value={value === undefined ? '' : String(value)} min={schema.minimum} max={schema.maximum} step={schema.type === 'integer' ? 1 : 'any'} disabled={disabled} onChange={e => set(e.target.value === '' ? undefined : Number(e.target.value))} />
      : ['textarea', 'json', 'tags'].includes(component) || schema.type === 'object' || schema.type === 'array' ? <textarea onBlur={e => { if (e.target.validity.valid) commitValue(value); }} id={id} placeholder={field.ui?.placeholder} disabled={disabled} rows={4} value={raw ?? (typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2))} onChange={e => { const text = e.target.value; setRaw(text); if (schema.type === 'string') set(text); else { try { set(JSON.parse(text)); setError(''); e.target.setCustomValidity(''); } catch { setError(tr("Enter valid JSON")); e.target.setCustomValidity(tr("Enter valid JSON")); } } }} />
      : <div className="input-group"><input onBlur={() => commitValue(value)} id={id} placeholder={field.ui?.placeholder} type={field.secret && !visible ? 'password' : 'text'} required={field.required} minLength={schema.minLength} maxLength={schema.maxLength} value={value === undefined ? '' : String(value)} disabled={disabled} onChange={e => set(e.target.value === '' && !field.required && ['file','directory'].includes(component) ? undefined : e.target.value)} autoComplete="off" />{['file','directory'].includes(component) && <button title={tr("Choose {name}", {name:label})} type="button" onClick={browse} disabled={disabled}><FolderOpenIcon size={21} /></button>}{field.secret && <button title={tr("Show or hide")} type="button" onClick={() => setVisible(!visible)}>{visible ? <EyeSlashIcon /> : <EyeIcon />}</button>}</div>}
    {error && <p className="error-text">{error}</p>}
  </div>;
}
