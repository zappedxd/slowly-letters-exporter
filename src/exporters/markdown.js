export async function exportToMarkdown(letters, receiver, baseFilename) {
  let content = `# Slowly Letters Export\n\n`;

  for (const l of letters) {
    content += `## ${l.sender} to ${receiver} · ${l.dateStr}\n\n`;
    content += `${l.text}\n\n`;
    if (l.audio.duration) {
      content += `> 🎵 Voice Note Attached: ${l.audio.duration}\n\n`;
    }
    content += `---\n\n`;
  }

  const bytes = new TextEncoder().encode(content);
  return { filename: `${baseFilename}.md`, mimeType: 'text/markdown', bytes };
}