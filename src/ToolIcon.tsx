import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Tool } from './types';

const colors = ['#b8dc66', '#80cba6', '#8ab5ee', '#739fe3', '#efd052', '#b493d7', '#df9b81', '#75bfc5'];

export function ToolIcon({ tool, size = 24 }: { tool: Tool; size?: number }) {
  const { id, name, icon, version } = tool.manifest;
  const [image, setImage] = useState<{ key: string; url: string }>();
  const key = JSON.stringify([id, icon, version, tool.directory]);
  useEffect(() => {
    let disposed = false;
    let url: string | undefined;
    if (icon) {
      invoke<number[]>('read_tool_icon', { id }).then(bytes => {
        if (disposed) return;
        const extension = icon.split('.').pop()?.toLowerCase();
        const mime = ({ svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', ico: 'image/x-icon' } as Record<string, string>)[extension || ''] || 'application/octet-stream';
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
        setImage({ key, url });
      }).catch(() => {});
    }
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [key, id, icon]);
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
  const initial = Array.from(name.trim())[0]?.toUpperCase() || '?';
  const source = image?.key === key ? image.url : undefined;
  return <span className="tool-avatar" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * .52), borderRadius: Math.round(size * .23), backgroundColor: source ? 'transparent' : colors[hash % colors.length] }}>{source ? <img src={source} alt="" onError={() => setImage(undefined)}/> : initial}</span>;
}
