import { zipSync, strToU8 } from 'fflate';

function escapeXml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Helper to generate strict MS Word DrawingML for images (size in EMUs: 1 inch = 914400)
function createDrawingMl(rId, id, cx, cy) {
  return `
    <w:r>
      <w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="0">
          <wp:extent cx="${cx}" cy="${cy}"/>
          <wp:effectExtent l="0" t="0" r="0" b="0"/>
          <wp:docPr id="${id}" name="Picture ${id}"/>
          <wp:cNvGraphicFramePr/>
          <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:nvPicPr>
                  <pic:cNvPr id="${id}" name="Image ${id}"/>
                  <pic:cNvPicPr/>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip r:embed="${rId}"/>
                  <a:stretch><a:fillRect/></a:stretch>
                </pic:blipFill>
                <pic:spPr>
                  <a:xfrm>
                    <a:off x="0" y="0"/>
                    <a:ext cx="${cx}" cy="${cy}"/>
                  </a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    </w:r>`;
}

export async function exportToDocx(letters) {
  // 1. Required static MS Word files
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Default Extension="jpg" ContentType="image/jpeg"/>
      <Default Extension="png" ContentType="image/png"/>
      <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
    </Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
    </Relationships>`;

  // Base styles including the required 'Normal' style
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:docDefaults>
        <w:rPrDefault><w:rPr><w:sz w:val="22"/></w:rPr></w:rPrDefault>
        <w:pPrDefault><w:pPr><w:spacing w:after="160"/></w:pPr></w:pPrDefault>
      </w:docDefaults>
      <w:style w:type="paragraph" w:styleId="Normal" w:default="1">
        <w:name w:val="Normal"/>
        <w:pPr><w:spacing w:after="160"/></w:pPr>
      </w:style>
    </w:styles>`;

  const zipData = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'word/styles.xml': strToU8(stylesXml)
  };

  let bodyXml = '';
  
  // rId1 is strictly reserved for styles.xml, so images must start at rId2
  let relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n`;

  let imgCount = 1;
  let relCount = 2;

  for (const l of letters) {
    // Header
    bodyXml += `
      <w:p><w:r><w:t>${escapeXml(l.sender)} · ${escapeXml(l.dateStr)}</w:t></w:r></w:p>
      <w:p><w:r><w:t>---------------------------------</w:t></w:r></w:p>
    `;

    // Add Stamp and Chop
    let headerImagesXml = '';
    
    if (l.assets && l.assets.chopBytes) {
      const filename = `chop${imgCount}.png`;
      const rId = `rId${relCount}`;
      zipData[`word/media/${filename}`] = l.assets.chopBytes;
      relsXml += `  <Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/>\n`;
      headerImagesXml += createDrawingMl(rId, imgCount, 400000, 400000); // Small chop
      imgCount++; relCount++;
    }

    if (l.assets && l.assets.stampBytes) {
      const filename = `stamp${imgCount}.png`;
      const rId = `rId${relCount}`;
      zipData[`word/media/${filename}`] = l.assets.stampBytes;
      relsXml += `  <Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/>\n`;
      headerImagesXml += createDrawingMl(rId, imgCount, 800000, 800000); // Standard stamp
      imgCount++; relCount++;
    }

    if (headerImagesXml) {
      bodyXml += `<w:p>${headerImagesXml}</w:p>`;
    }

    // Text Body
    const lines = l.text.split('\n');
    for (const line of lines) {
      bodyXml += `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`;
    }

    // Audio Placeholder
    if (l.audio && l.audio.duration) {
      bodyXml += `<w:p><w:r><w:t xml:space="preserve">[ 🎵 Voice Note Attached: ${escapeXml(l.audio.duration)} ]</w:t></w:r></w:p>`;
    }

    // Embedded Photos
    if (l.assets && l.assets.photoBytes && l.assets.photoBytes.length > 0) {
      for (const bytes of l.assets.photoBytes) {
        if (!bytes) continue;
        
        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
        const ext = isPng ? 'png' : 'jpg';
        const filename = `image${imgCount}.${ext}`;
        const rId = `rId${relCount}`;

        zipData[`word/media/${filename}`] = bytes;
        relsXml += `  <Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/>\n`;
        bodyXml += `<w:p>${createDrawingMl(rId, imgCount, 3000000, 3000000)}</w:p>`; // Large photo
        
        imgCount++; relCount++;
      }
    }

    bodyXml += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
  }

  relsXml += `</Relationships>`;

  // Root XML with strictly just w, r, and wp namespaces
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
  <w:document 
    xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
    <w:body>
      ${bodyXml}
      <w:sectPr>
        <w:pgSz w:w="12240" w:h="15840"/>
        <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
      </w:sectPr>
    </w:body>
  </w:document>`;

  zipData['word/document.xml'] = strToU8(documentXml);
  zipData['word/_rels/document.xml.rels'] = strToU8(relsXml);

  return { filename: `Slowly_DOCX_${Date.now()}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: zipSync(zipData) };
}