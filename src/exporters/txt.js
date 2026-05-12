export async function exportToTxt(letters, receiver, baseFilename) {
  let content = '';

  for (const l of letters) {
    content += `${l.sender} to ${receiver} · ${l.dateStr}\n`;
    content += `----------------------------------------------------\n\n`;
    content += `${l.text}\n\n`;
    if (l.audio.duration) {
      content += `[ Voice Note Attached: ${l.audio.duration} ]\n\n`;
    }
    content += `\n\n`;
  }

  const bytes = new TextEncoder().encode(content);
  return { filename: `${baseFilename}.txt`, mimeType: 'text/plain', bytes };
}