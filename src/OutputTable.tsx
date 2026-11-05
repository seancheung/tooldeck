import type { Json } from './types';
import { FileIcon, FolderIcon } from '@phosphor-icons/react';

export function OutputTable({ value, onOpen }: { value: { columns: { key: string; label?: string }[]; rows: Record<string, Json>[] }; onOpen: (target: string) => void }) {
  const cell = (value: Json | undefined) => {
    if (value == null) return '';
    if (typeof value === 'object' && !Array.isArray(value) && (value.kind === 'file' || value.kind === 'directory') && typeof value.target === 'string' && (value.label === undefined || typeof value.label === 'string')) {
      const target = value.target;
      return <button type="button" className="table-link" title={target} onClick={() => onOpen(target)}>{value.kind === 'directory' ? <FolderIcon size={14}/> : <FileIcon size={14}/>}<span>{value.label || target}</span></button>;
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  };
  return <div className="output-table"><table><thead><tr>{value.columns.map(column => <th key={column.key}>{column.label ?? column.key}</th>)}</tr></thead><tbody>{value.rows.map((row, index) => <tr key={index}>{value.columns.map(column => <td key={column.key}>{cell(row[column.key])}</td>)}</tr>)}</tbody></table></div>;
}
