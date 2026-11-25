/** Triggers a browser download for a text file. */
export function downloadText(filename, text, type = 'application/xml') {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copies text to the clipboard, falling back to execCommand for older browsers. */
export async function copyText(text, fallbackTextarea) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    if (!fallbackTextarea) return false;
    fallbackTextarea.focus();
    fallbackTextarea.select();
    try { return document.execCommand('copy'); } catch (_) { return false; }
  }
}
