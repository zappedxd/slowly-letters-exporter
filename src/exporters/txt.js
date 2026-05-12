export async function exportToTxt(letters) {
    let content = '';
  
    for (const l of letters) {
      content += `${l.sender} · ${l.dateStr}\n`;
      content += `----------------------------------------------------\n\n`;
      content += `${l.text}\n\n`;
      if (l.audio.duration) {
        content += `[ Voice Note Attached: ${l.audio.duration} ]\n\n`;
      }
      content += `\n\n`;
    }
  
    const bytes = new TextEncoder().encode(content);
    return { filename: `Slowly_TXT_${Date.now()}.txt`, mimeType: 'text/plain', bytes };
  }