// Card art auto-wires to /cards/<id>.png; fall back to <id>.svg, then hide the
// <img> so a missing file degrades gracefully instead of showing a broken-image
// icon. Lives in its own module because it is a plain function: exporting it
// beside components breaks Vite's fast refresh for that file.
export function artFallback(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  if (img.src.endsWith('.png')) img.src = img.src.replace(/\.png$/, '.svg');
  else img.style.display = 'none';
}
