import { zipSync, strToU8 } from 'fflate';

function getSafeName(str) {
  return (str || 'Unknown').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
}

function getShortDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function generateHtmlContent(letters, receiver) {
  const lettersHtml = letters.map(letter => {
    const prefix = `${getShortDate(letter.timestamp)}_${getSafeName(letter.receiver)}_${getSafeName(letter.sender)}`;
    
    return `
    <article class="letter">
      <header>
        <h2>${letter.sender} to ${receiver}</h2>
        <time>${letter.dateStr}</time>
        ${letter.assets.stampBytes ? `<img src="assets/${prefix}_Stamp.png" class="stamp" />` : ''}
      </header>
      <div class="content">${letter.text.replace(/\n/g, '<br>')}</div>
      
      ${letter.photos.length ? `
        <div class="photos">
          ${letter.assets.photoBytes.map((bytes, i) => bytes ? `<img src="assets/${prefix}_Photo_${i + 1}.jpg" />` : '').join('')}
        </div>
      ` : ''}
      
      ${letter.audio.url ? `
        <div class="audio-player">
          <p>🎵 Voice Note (${letter.audio.duration})</p>
          <audio controls src="assets/${prefix}_Audio.aac"></audio>
        </div>
      ` : ''}
    </article>
  `}).join('\n');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Slowly Export</title>
      <link rel="stylesheet" href="style.css">
    </head>
    <body>
      <main>${lettersHtml}</main>
    </body>
    </html>
  `;
}

export async function exportToHtmlZip(letters, receiver, baseFilename) {
  const zipData = {
    'index.html': strToU8(generateHtmlContent(letters, receiver)),
    'style.css': strToU8(`
      body { font-family: system-ui, sans-serif; background: #fafafa; color: #1a1a1a; padding: 2rem; max-width: 800px; margin: 0 auto; }
      .letter { background: #fff; border: 1px solid #ddd; border-radius: 12px; padding: 2rem; margin-bottom: 2rem; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
      .stamp { float: right; width: 80px; height: 80px; }
      .audio-player { background: #f3eddf; padding: 1rem; border-radius: 8px; border: 1px solid #c8a97e; margin-top: 1rem; }
      .photos { display: flex; gap: 10px; margin-top: 1rem; overflow-x: auto; }
      .photos img { max-height: 200px; border-radius: 8px; }
    `),
    'assets': {}
  };

  // Populate assets folder with standard nomenclature
  letters.forEach(letter => {
    const prefix = `${getShortDate(letter.timestamp)}_${getSafeName(letter.receiver)}_${getSafeName(letter.sender)}`;
    
    if (letter.assets.stampBytes) zipData['assets'][`${prefix}_Stamp.png`] = letter.assets.stampBytes;
    if (letter.assets.audioBytes) zipData['assets'][`${prefix}_Audio.aac`] = letter.assets.audioBytes;
    
    letter.assets.photoBytes.forEach((bytes, i) => {
      if (bytes) zipData['assets'][`${prefix}_Photo_${i + 1}.jpg`] = bytes;
    });
  });

  const zipped = zipSync(zipData);
  
  return {
    filename: `${baseFilename}.zip`,
    mimeType: 'application/zip',
    bytes: zipped
  };
}