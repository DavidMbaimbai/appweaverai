import { readFile } from 'node:fs/promises';
import type esbuild from 'esbuild';

/** Inlines CSS imports as runtime style injection (works with write: false). */
export function cssInjectPlugin(): esbuild.Plugin {
  return {
    name: 'preview-css-inject',
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const css = await readFile(args.path, 'utf8');
        return {
          contents: `
const css = ${JSON.stringify(css)};
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.setAttribute("data-preview-bundle", "true");
  style.textContent = css;
  document.head.appendChild(style);
}
export default css;
`,
          loader: 'js',
        };
      });
    },
  };
}
