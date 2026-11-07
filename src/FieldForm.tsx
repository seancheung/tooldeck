import InputPassword from './components/ui/input-password';
import InputNumber from './components/ui/input-number';
import Tooltip from './components/ui/tooltip';
import Checkbox from './components/ui/checkbox';
import { Button, Input, Textarea, FormSelect } from './components/controls';
import { equal } from './paramForm';
import { useTranslator } from './i18n';
import { FolderOpenIcon, XIcon } from '@phosphor-icons/react';
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
  const [raw, setRaw] = useState<string>();
  const [error, setError] = useState('');
  const schema = field.schema;
  const component = field.ui?.component || (schema.enum ? 'select' : schema.type === 'boolean' ? 'checkbox' : ['number', 'integer'].includes(schema.type) ? 'number' : ['array', 'object'].includes(schema.type) ? 'json' : 'text');
  const pathPicker = component === 'file' || component === 'directory';
  const multiple = component === 'file' && field.ui?.multiple === true;
  const label = field.ui?.label || name;
  const id = `field-${name}`;
  const description = field.ui?.description?.trim();
  const descriptionId = description ? `description-${id}` : undefined;
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
  const textProps = {
    id, 'aria-describedby': descriptionId, placeholder: field.ui?.placeholder, required: field.required,
    minLength: schema.minLength, maxLength: schema.maxLength, value: value === undefined ? '' : String(value),
    disabled, readOnly: pathPicker, autoComplete: 'off', onBlur: () => commitValue(value),
  };
  const fieldLabel = <>{label}{field.required && <span className="required"> *</span>}</>;
  return <div className="field">
    {component !== 'checkbox' && <label htmlFor={id}>{fieldLabel}</label>}
    {component === 'checkbox' ? <Checkbox id={id} aria-describedby={descriptionId} value={value === true} disabled={disabled} onChange={choose} label={fieldLabel}/>
      : component === 'select' ? <FormSelect id={id} aria-describedby={descriptionId} required={field.required} disabled={disabled} value={value === undefined ? '' : String((schema.enum || []).findIndex((option: Json) => equal(option, value)))} onChange={index => choose(index === '' ? undefined : schema.enum?.[Number(index)])} placeholder={field.ui?.placeholder || tr("Select…")} options={(schema.enum || []).map((option: Json, index: number) => ({value:String(index),label:field.ui?.options?.find(item => equal(item.value, option))?.label ?? String(option)}))}/>
      : multiple ? <div className="file-selection">
          <div className="input-group w-full">
            <Input id={id} aria-describedby={descriptionId} readOnly disabled={disabled}
              placeholder={tr("No files selected")}
              value={Array.isArray(value) && value.length > 0 ? tr("{count} files selected", {count: value.length}) : ''}/>
            <Tooltip content={tr("Choose files")}>
              <Button type="button" variant="secondary" shape="square" aria-label={tr("Choose files")} disabled={disabled} onClick={browse}>
                <FolderOpenIcon size={21} aria-hidden="true"/>
              </Button>
            </Tooltip>
          </div>
        </div>
      : component === 'number' ? <InputNumber
          id={id} aria-describedby={descriptionId} className="w-full" placeholder={field.ui?.placeholder} required={field.required}
          value={typeof value === 'number' ? value : null} integer={schema.type === 'integer'}
          min={schema.minimum} max={schema.maximum} disabled={disabled}
          clearable onClear={() => choose(undefined)} onChange={choose}
        />
      : ['textarea', 'json', 'tags'].includes(component) || schema.type === 'object' || schema.type === 'array' ? <Textarea error={!!error} aria-invalid={!!error} onBlur={e => { if (e.target.validity.valid) commitValue(value); }} id={id} aria-describedby={descriptionId} placeholder={field.ui?.placeholder} disabled={disabled} rows={4} value={raw ?? (typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value, null, 2))} onChange={e => { const text = e.target.value; setRaw(text); if (schema.type === 'string') set(text); else { try { set(JSON.parse(text)); setError(''); e.target.setCustomValidity(''); } catch { setError(tr("Enter valid JSON")); e.target.setCustomValidity(tr("Enter valid JSON")); } } }} />
      : <div className="input-group">{field.secret ? <InputPassword {...textProps} visibilityLabel={tr("Show or hide")} onChange={set}/>
          : <Input {...textProps} onChange={e => set(e.target.value)}/>}{pathPicker && !field.required && !!value && <Button type="button" variant="secondary" shape="square" disabled={disabled} aria-label={tr("Clear")} onClick={()=>choose(undefined)}><XIcon size={16}/></Button>}{pathPicker && <Tooltip content={tr("Choose {name}", {name:label})}><Button variant="secondary" shape="square" aria-label={tr("Choose {name}", {name:label})} type="button" onClick={browse} disabled={disabled}><FolderOpenIcon size={21} /></Button></Tooltip>}</div>}
    {description && <p id={descriptionId} className="hint">{description}</p>}
    {multiple && Array.isArray(value) && value.length > 0 && (
      <div className="file-selection mt-2">
        {value.map((path, index) => <div className="selected-file" key={String(path)}><Tooltip content={String(path)} className="break-all"><span tabIndex={0}>{String(path)}</span></Tooltip><Tooltip content={tr("Remove file")}><Button type="button" className="file-remove" aria-label={tr("Remove {name}", {name:String(path)})} disabled={disabled} onClick={() => choose(value.filter((_, i) => i !== index))}><XIcon size={16} aria-hidden="true"/></Button></Tooltip></div>)}
      </div>
    )}
    {error && <p className="error-text">{error}</p>}
  </div>;
}
