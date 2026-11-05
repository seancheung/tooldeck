import type { Root, RootContent } from 'mdast';
import type { VFile } from 'vfile';

// GFM adds links for plain URLs and email addresses. Keep only links whose
// source uses Markdown syntax, while retaining all other GFM features.
export default function remarkExplicitLinks() {
  return (tree: Root, file: VFile) => {
    const source = String(file);
    function walk(parent: { children: RootContent[] }) {
      parent.children = parent.children.flatMap<RootContent>(node => {
        if ('children' in node) walk(node as { children: RootContent[] });
        if (node.type !== 'link') return [node];
        const start = node.position?.start.offset;
        const first = start === undefined ? '' : source[start];
        return first === '[' || first === '<' ? [node] : node.children;
      });
    }
    walk(tree);
  };
}
