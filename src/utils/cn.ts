/* Vendored from seancheung/retuned-ui (src/utils/cn.ts)
 * Source revision: 169623fdd34cea4e757532c310a53df89d046f02
 * Upstream README declares MIT. Source is maintained locally.
 */
import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-tiny", "text-tiny"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
