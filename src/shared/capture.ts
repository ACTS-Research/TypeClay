// "Capture" (C): PNG of the stage canvas, plus SVG when the prototype can make one.
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function stamp(word: string) {
  const slug = word.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "clay";
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${slug}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function svgDocument(W: number, H: number, bg: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(W)}" height="${Math.round(H)}" viewBox="0 0 ${Math.round(W)} ${Math.round(H)}">\n` +
    `<rect width="100%" height="100%" fill="${bg}"/>\n${body}\n</svg>\n`;
}
