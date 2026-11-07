import { Button } from './components/controls';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table';
import type { Json } from './types';
import { FileIcon, FolderIcon } from '@phosphor-icons/react';

export function OutputTable({ value, onOpen }: { value: { columns: { key: string; label?: string }[]; rows: Record<string, Json>[] }; onOpen: (target: string) => void }) {
  const cell = (value: Json | undefined) => {
    if (value == null) return '';
    if (typeof value === 'object' && !Array.isArray(value) && (value.kind === 'file' || value.kind === 'directory') && typeof value.target === 'string' && (value.label === undefined || typeof value.label === 'string')) {
      const target = value.target;
      return <Button variant="ghost" type="button" className="table-link h-auto whitespace-normal justify-start text-left" title={target} onClick={() => onOpen(target)}>{value.kind === 'directory' ? <FolderIcon size={14}/> : <FileIcon size={14}/>}<span>{value.label || target}</span></Button>;
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  };
  return <div className="output-table"><Table><TableHeader><TableRow>{value.columns.map(column => <TableHead key={column.key}>{column.label ?? column.key}</TableHead>)}</TableRow></TableHeader><TableBody>{value.rows.map((row, index) => <TableRow key={index}>{value.columns.map(column => <TableCell key={column.key}>{cell(row[column.key])}</TableCell>)}</TableRow>)}</TableBody></Table></div>;
}
