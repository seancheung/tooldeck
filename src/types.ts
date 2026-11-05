export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Condition =
  | { op: 'eq' | 'not'; key: string; value: Json }
  | { op: 'null' | 'notNull' | 'empty'; key: string }
  | { op: 'gt' | 'gte' | 'lt' | 'lte'; key: string; value: number }
  | { op: 'and' | 'or'; cond: Condition[] };
export interface Field { availableWhen?: Condition; required?: boolean; secret?: boolean; schema: Record<string, any>; ui?: { label?: string; description?: string; placeholder?: string; component?: string; mode?: string; multiple?: boolean; options?: { value: Json; label: string }[]; filters?: { name: string; extensions: string[] }[] }; path?: { kind: string; mustExist?: boolean } }
export interface Action { name: string; description?: string; entry: string; params?: Record<string, Field> }
export interface Tool { manifest: { id: string; name: string; icon?: string; description: string; version: string; hostApi: string; platforms?: { os: string; arch?: string[] | null }[] | null; runtime: { kind: string; version: string }; dependencies?: { manager: string }; actions: Record<string, Action>; settings: Record<string, Field>; docs: { locale?: string; id: string; title: string; path: string }[] }; installed: boolean; compatible: boolean; directory: string; settings: Record<string, Json>; issue?: string }
export interface Config { locale: 'en' | 'zh-CN'; dataDir: string; nodePath: string; uvPath: string }
export interface Detection { node?: string; uv?: string; powershell?: string; bash?: string }
export interface Event { runId: string; type: 'log'|'output'|'progress'|'link'|'table'; payload: any; time?: string }
export interface Run { id: string; toolId: string; operation: string; status: 'running'|'success'|'error'|'cancelled'; events: Event[]; started: number; ended?: number; message?: string }
