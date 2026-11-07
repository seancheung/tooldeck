// Native event adapters for the vendored Retuned components. These keep the
// application's form validation and commit-on-blur behavior intact.
import { useRef, useState, type ComponentProps } from 'react';
import RetunedButton from './ui/button';
import RetunedInput from './ui/input';
import RetunedTextarea from './ui/textarea';
import RetunedSelect from './ui/select';

export function Button(props: ComponentProps<typeof RetunedButton>) {
  return <RetunedButton variant="ghost" {...props}/>;
}

export function Input({ onChange, ...props }: Omit<ComponentProps<typeof RetunedInput>, 'onChange'> & { onChange?: React.ChangeEventHandler<HTMLInputElement> }) {
  return <RetunedInput {...props} onNativeChange={onChange}/>;
}

export function Textarea({ onChange, ...props }: Omit<ComponentProps<typeof RetunedTextarea>, 'onChange'> & { onChange?: React.ChangeEventHandler<HTMLTextAreaElement> }) {
  return <RetunedTextarea {...props} onNativeChange={onChange}/>;
}

// The visible control is Retuned Select. A non-interactive native select only
// participates in form validation, preserving required fields and enum indices.
export function FormSelect({ id, 'aria-describedby': describedBy, value, options, placeholder, required, disabled, onChange }: {
  id: string; 'aria-describedby'?: string; value: string; options: { value: string; label: string }[];
  placeholder: string; required?: boolean; disabled?: boolean; onChange: (value: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [invalid, setInvalid] = useState(false);
  const validValue = options.some(option => option.value === value) ? value : '';
  const choices: { value: string; label: string; disabled?: boolean }[] = [{ value: '', label: placeholder, disabled: required }, ...options];
  return <div ref={root} className="relative">
    <RetunedSelect id={id} aria-describedby={describedBy} className="w-full min-w-0" value={validValue} options={choices}
      disabled={disabled} placeholder={placeholder} aria-required={required} aria-invalid={invalid && !validValue}
      error={invalid && !validValue} onChange={next => { setInvalid(false); onChange(next); }}/>
    <select aria-hidden="true" tabIndex={-1} className="sr-only" value={validValue} required={required} disabled={disabled}
      onChange={event => onChange(event.target.value)} onInvalid={event => {
        event.preventDefault(); setInvalid(true); root.current?.querySelector('button')?.focus();
      }}>
      {choices.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select>
  </div>;
}
