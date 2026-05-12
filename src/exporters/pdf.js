import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function stripUnsupported(str) {
  if (!str) return '';
  return str.replace(/[^\x00-\xFF]/g, '');
}

function wrapParagraphs(text, maxWidth, font, fontSize) {
  const paragraphs = text.split('\n');
  const lines = [];

  for (const p of paragraphs) {
    if (p.trim() === '') {
      lines.push('');
      continue;
    }
    const words = p.split(' ');
    let currentLine = words[0] || '';
    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = font.widthOfTextAtSize(currentLine + ' ' + word, fontSize);
      if (width < maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);
  }
  return lines;
}

async function safeEmbedImage(pdfDoc, bytes) {
  try { return await pdfDoc.embedPng(bytes); } catch {
    try { return await pdfDoc.embedJpg(bytes); } catch { return null; }
  }
}

export async function exportToPdf(letters, receiver, pageBreakPerLetter = false, baseFilename) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const boldFont = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  let page = pdfDoc.addPage([612, 792]); // US Letter
  let y = 720; // Top margin

  for (let idx = 0; idx < letters.length; idx++) {
    const l = letters[idx];

    // Handle space between letters if not the first letter
    if (idx > 0) {
      if (pageBreakPerLetter) {
        page = pdfDoc.addPage([612, 792]);
        y = 720;
      } else {
        y -= 40; // Add breathing room
        if (y < 100) {
          // Force new page if we are too far down to start a new letter neatly
          page = pdfDoc.addPage([612, 792]);
          y = 720;
        } else {
          // Draw continuous flow divider
          page.drawLine({ start: { x: 250, y }, end: { x: 362, y }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
          y -= 30;
        }
      }
    }

    // Safety check just in case
    if (y < 50) { 
      page = pdfDoc.addPage([612, 792]); 
      y = 720; 
    }

    const safeSender = stripUnsupported(l.sender);
    const safeReceiver = stripUnsupported(receiver);
    const safeDate = stripUnsupported(l.dateStr);

    // Header
    page.drawText(`${safeSender} to ${safeReceiver} · ${safeDate}`, { x: 50, y, size: 16, font: boldFont, color: rgb(0.18, 0.24, 0.31) });
    
    // Draw Stamp & Chop
    if (l.assets && l.assets.stampBytes) {
      const stampImg = await safeEmbedImage(pdfDoc, l.assets.stampBytes);
      if (stampImg) {
        const dims = stampImg.scaleToFit(60, 60);
        page.drawImage(stampImg, { x: 500, y: y - 20, width: dims.width, height: dims.height });
      }
    }
    
    if (l.assets && l.assets.chopBytes) {
      const chopImg = await safeEmbedImage(pdfDoc, l.assets.chopBytes);
      if (chopImg) {
        const dims = chopImg.scaleToFit(40, 40);
        page.drawImage(chopImg, { x: 450, y: y - 10, width: dims.width, height: dims.height });
      }
    }

    y -= 30;
    
    // Separator line under header
    page.drawLine({ start: { x: 50, y }, end: { x: 562, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
    y -= 20;

    // Body Text with wrapping
    const maxWidth = 512; 
    const wrappedLines = wrapParagraphs(stripUnsupported(l.text), maxWidth, font, 11);

    for (const line of wrappedLines) {
      if (y < 50) { 
        page = pdfDoc.addPage([612, 792]);
        y = 720;
      }
      if (line.trim() !== '') {
        page.drawText(line, { x: 50, y, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
      }
      y -= 15; 
    }

    // Audio Placeholder
    if (l.audio && l.audio.duration) {
      if (y < 50) { page = pdfDoc.addPage([612, 792]); y = 720; }
      y -= 15;
      page.drawText(`[ Voice Note Attached: ${stripUnsupported(l.audio.duration)} ]`, { x: 50, y, size: 10, font: boldFont, color: rgb(0.5, 0.5, 0.5) });
      y -= 15;
    }

    // Embedded Photos
    if (l.assets && l.assets.photoBytes && l.assets.photoBytes.length > 0) {
      y -= 10;
      for (const bytes of l.assets.photoBytes) {
        if (!bytes) continue;
        const img = await safeEmbedImage(pdfDoc, bytes);
        if (!img) continue;
        
        const dims = img.scaleToFit(300, 300);
        
        if (y - dims.height < 50) {
          page = pdfDoc.addPage([612, 792]);
          y = 720;
        }
        
        y -= dims.height;
        page.drawImage(img, { x: 50, y, width: dims.width, height: dims.height });
        y -= 20; 
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  return { filename: `${baseFilename}.pdf`, mimeType: 'application/pdf', bytes: pdfBytes };
}