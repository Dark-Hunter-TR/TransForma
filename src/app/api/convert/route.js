import sharp from "sharp";
import mammoth from "mammoth";
import ExcelJS from "exceljs";
import yaml from "js-yaml";
import { PDFDocument } from "pdf-lib";
import { NextResponse } from "next/server";
import csv from "csv-parser";
import { Readable } from "stream";

// Rate limiting and health check functions
async function checkSystemHealth() {
  try {
    const healthResponse = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/health`);
    if (healthResponse.ok) {
      const healthData = await healthResponse.json();
      
      if (healthData.status === 'critical') {
        global.systemRateLimit = {
          isActive: true,
          until: Date.now() + (60 * 60 * 1000), // 60 minutes
          reason: 'System critical'
        };
        return { rateLimited: true, timeRemaining: 60 };
      } else if (healthData.status === 'warning') {
        global.systemRateLimit = {
          isActive: true,
          until: Date.now() + (30 * 60 * 1000), // 30 minutes
          reason: 'High system load'
        };
        return { rateLimited: true, timeRemaining: 30 };
      } else if (healthData.status === 'starting') {
        global.systemRateLimit = {
          isActive: true,
          until: Date.now() + (5 * 60 * 1000), // 5 minutes
          reason: 'System starting'
        };
        return { rateLimited: true, timeRemaining: 5 };
      } else {
        global.systemRateLimit = null;
        return { rateLimited: false };
      }
    }
  } catch (error) {
    console.warn('Health check failed:', error.message);
    return { rateLimited: false, healthCheckFailed: true };
  }
  
  return { rateLimited: false };
}

// Supported format categories
const FORMAT_CATEGORIES = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg', 'ico'],
  document: ['pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'html', 'md', 'tex'],
  spreadsheet: ['xlsx', 'xls', 'csv', 'ods', 'tsv'],
  data: ['json', 'xml', 'yaml', 'yml', 'csv', 'tsv'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz'],
  code: ['js', 'ts', 'py', 'java', 'cpp', 'c', 'cs', 'php', 'rb', 'go', 'rs'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
  video: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm']
};

// Logical conversion rules
const CONVERSION_RULES = {
  // Image formats can be converted between each other
  image: {
    allowed: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'svg', 'ico', 'pdf'],
    forbidden: ['json', 'xml', 'yaml', 'csv', 'xlsx', 'txt', 'docx', 'mp3', 'mp4']
  },
  
  // Document formats
  document: {
    allowed: ['pdf', 'docx', 'txt', 'html', 'md', 'json', 'xml', 'yaml'],
    forbidden: ['jpg', 'png', 'mp3', 'mp4', 'xlsx', 'csv']
  },
  
  // Spreadsheet formats
  spreadsheet: {
    allowed: ['xlsx', 'csv', 'json', 'xml', 'yaml', 'txt', 'html', 'pdf'],
    forbidden: ['jpg', 'png', 'mp3', 'mp4', 'docx']
  },
  
  // Data formats can be converted between each other
  data: {
    allowed: ['json', 'xml', 'yaml', 'csv', 'tsv', 'txt', 'html'],
    forbidden: ['jpg', 'png', 'mp3', 'mp4', 'docx', 'pdf']
  },
  
  // Code files
  code: {
    allowed: ['txt', 'html', 'json', 'xml', 'pdf'],
    forbidden: ['jpg', 'png', 'mp3', 'mp4', 'xlsx', 'csv']
  },
  
  // Audio files (preparation for the future)
  audio: {
    allowed: ['txt', 'json', 'xml'],
    forbidden: ['jpg', 'png', 'pdf', 'docx', 'xlsx', 'csv']
  },
  
  // Video files (preparation for the future)
  video: {
    allowed: ['txt', 'json', 'xml'],
    forbidden: ['jpg', 'png', 'pdf', 'docx', 'xlsx', 'csv']
  }
};

function getFileCategory(fileName, mimeType) {
  const extension = fileName.split('.').pop()?.toLowerCase();
  
  for (const [category, extensions] of Object.entries(FORMAT_CATEGORIES)) {
    if (extensions.includes(extension)) {
      return category;
    }
  }

  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('audio/')) return 'audio';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.includes('document') || mimeType?.includes('text/')) return 'document';
  if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) return 'spreadsheet';
  
  return 'unknown';
}

function isConversionAllowed(sourceCategory, targetFormat) {
  const rules = CONVERSION_RULES[sourceCategory];
  if (!rules) return true;
  
  if (rules.forbidden && rules.forbidden.includes(targetFormat)) {
    return false;
  }
  
  if (rules.allowed && !rules.allowed.includes(targetFormat)) {
    return false;
  }
  
  return true;
}

async function extractMetadata(buffer, fileName, mimeType) {
  const metadata = {
    fileName,
    originalMimeType: mimeType,
    size: buffer.length,
    convertedAt: new Date().toISOString()
  };

  try {
    if (mimeType?.startsWith('image/')) {
      const imageInfo = await sharp(buffer).metadata();
      metadata.dimensions = {
        width: imageInfo.width,
        height: imageInfo.height,
        format: imageInfo.format,
        density: imageInfo.density,
        hasAlpha: imageInfo.hasAlpha
      };
    }
  } catch (error) {
    console.warn('Metadata extraction failed:', error.message);
  }

  return metadata;
}

function parseCSVBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = Readable.from(buffer.toString());
    
    stream
      .pipe(csv())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

export async function POST(request) {
  try {
    console.log("🚀 Enhanced Convert API called");
    
    const clientIp = request.headers.get('x-forwarded-for') || 
                    request.headers.get('x-real-ip') || 
                    'unknown';
    
    if (global.systemRateLimit && global.systemRateLimit.isActive) {
      const timeRemaining = Math.ceil((global.systemRateLimit.until - Date.now()) / 60000);
      if (Date.now() < global.systemRateLimit.until) {
        return NextResponse.json({
          error: "System temporarily unavailable",
          message: `System is under maintenance. Please try again in ${timeRemaining} minutes.`,
          rateLimited: true,
          timeRemaining: timeRemaining
        }, { status: 503 });
      } else {
        global.systemRateLimit = null;
      }
    }
    
    const formData = await request.formData();
    const file = formData.get("file");
    const outputFormat = formData.get("outputFormat")?.toLowerCase() || "png";
    const quality = parseInt(formData.get("quality")) || 90;
    const includeMetadata = formData.get("includeMetadata") === "true";

    console.log(`📁 File: ${file?.name}, Output: ${outputFormat}, Quality: ${quality}`);

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.replace(/\.[^/.]+$/, "");
    const sourceCategory = getFileCategory(file.name, file.type);
    
    console.log(`🔍 Source category: ${sourceCategory}, Target format: ${outputFormat}`);

    if (!isConversionAllowed(sourceCategory, outputFormat)) {
      return NextResponse.json({ 
        error: `Invalid conversion: ${sourceCategory} files cannot be converted to ${outputFormat}`,
        suggestion: `Try converting to one of these formats: ${CONVERSION_RULES[sourceCategory]?.allowed?.join(', ') || 'txt, json'}`
      }, { status: 400 });
    }

    let convertedBuffer;
    let contentType;
    let fileExtension;
    let metadata = includeMetadata ? await extractMetadata(buffer, fileName, file.type) : null;

    switch (outputFormat) {
      // === IMAGE FORMATS ===
      case 'png':
        console.log("🖼️ Converting to PNG...");
        convertedBuffer = await sharp(buffer)
          .png({ quality: quality, compressionLevel: 9 })
          .toBuffer();
        contentType = "image/png";
        fileExtension = "png";
        break;

      case 'jpeg':
      case 'jpg':
        console.log("🖼️ Converting to JPEG...");
        convertedBuffer = await sharp(buffer)
          .jpeg({ quality: quality, progressive: true })
          .toBuffer();
        contentType = "image/jpeg";
        fileExtension = "jpg";
        break;

      case 'webp':
        console.log("🖼️ Converting to WebP...");
        convertedBuffer = await sharp(buffer)
          .webp({ quality: quality })
          .toBuffer();
        contentType = "image/webp";
        fileExtension = "webp";
        break;

      case 'gif':
        console.log("🖼️ Converting to GIF...");
        convertedBuffer = await sharp(buffer)
          .gif()
          .toBuffer();
        contentType = "image/gif";
        fileExtension = "gif";
        break;

      case 'bmp':
        console.log("🖼️ Converting to BMP...");
        convertedBuffer = await sharp(buffer)
          .bmp()
          .toBuffer();
        contentType = "image/bmp";
        fileExtension = "bmp";
        break;

      case 'tiff':
        console.log("🖼️ Converting to TIFF...");
        convertedBuffer = await sharp(buffer)
          .tiff({ quality: quality })
          .toBuffer();
        contentType = "image/tiff";
        fileExtension = "tiff";
        break;

      case 'ico':
        console.log("🖼️ Converting to ICO...");
        convertedBuffer = await sharp(buffer)
          .resize(32, 32)
          .png()
          .toBuffer();
        contentType = "image/x-icon";
        fileExtension = "ico";
        break;

      // === DOCUMENT FORMATS ===
      case 'pdf':
        console.log("📄 Converting to PDF...");
        const pdfDoc = await PDFDocument.create();
        
        if (file.type.includes('document') || file.type.includes('text')) {
          let textContent = '';
          if (file.type.includes('document')) {
            const result = await mammoth.extractRawText({ buffer });
            textContent = result.value;
          } else {
            textContent = buffer.toString('utf-8');
          }
          
          const page = pdfDoc.addPage([595, 842]);
          const lines = textContent.split('\n');
          let yPosition = 800;
          
          for (const line of lines.slice(0, 40)) {
            if (yPosition < 50) break;
            page.drawText(line.substring(0, 80), { 
              x: 50, 
              y: yPosition, 
              size: 10 
            });
            yPosition -= 20;
          }
        } else if (file.type.startsWith('image/')) {
          const page = pdfDoc.addPage([595, 842]);
          
          if (file.type.includes('png')) {
            const pngImage = await pdfDoc.embedPng(buffer);
            const pngDims = pngImage.scale(0.5);
            page.drawImage(pngImage, { 
              x: 50, 
              y: 400, 
              width: Math.min(pngDims.width, 500), 
              height: Math.min(pngDims.height, 350) 
            });
          } else if (file.type.includes('jpeg') || file.type.includes('jpg')) {
            const jpgImage = await pdfDoc.embedJpg(buffer);
            const jpgDims = jpgImage.scale(0.5);
            page.drawImage(jpgImage, { 
              x: 50, 
              y: 400, 
              width: Math.min(jpgDims.width, 500), 
              height: Math.min(jpgDims.height, 350) 
            });
          }
        }
        
        convertedBuffer = await pdfDoc.save();
        contentType = "application/pdf";
        fileExtension = "pdf";
        break;

      case 'html':
        console.log("🌐 Converting to HTML...");
        if (file.type.includes('document')) {
          const result = await mammoth.convertToHtml({ buffer });
          convertedBuffer = Buffer.from(`
            <!DOCTYPE html>
            <html lang="tr">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>${fileName}</title>
              <style>
                body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                .metadata { background: #f5f5f5; padding: 10px; margin-bottom: 20px; border-radius: 5px; }
              </style>
            </head>
            <body>
              ${includeMetadata ? `<div class="metadata">${JSON.stringify(metadata, null, 2)}</div>` : ''}
              ${result.value}
            </body>
            </html>
          `);
        } else if (sourceCategory === 'data') {
          let data;
          try {
            data = JSON.parse(buffer.toString());
          } catch {
            data = { content: buffer.toString() };
          }
          
          convertedBuffer = Buffer.from(`
            <!DOCTYPE html>
            <html lang="tr">
            <head>
              <meta charset="UTF-8">
              <title>Data Visualization - ${fileName}</title>
              <style>
                body { font-family: Arial, sans-serif; margin: 20px; }
                pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
                .json-key { color: #0066cc; }
                .json-value { color: #009900; }
              </style>
            </head>
            <body>
              <h1>📊 Data: ${fileName}</h1>
              <pre><code>${JSON.stringify(data, null, 2)}</code></pre>
            </body>
            </html>
          `);
        } else {
          convertedBuffer = Buffer.from(`
            <!DOCTYPE html>
            <html lang="tr">
            <head>
              <meta charset="UTF-8">
              <title>${fileName}</title>
            </head>
            <body>
              <h1>📁 ${fileName}</h1>
              <p><strong>Original Type:</strong> ${file.type}</p>
              <p><strong>Size:</strong> ${(buffer.length / 1024).toFixed(2)} KB</p>
              <p><strong>Converted:</strong> ${new Date().toLocaleString('tr-TR')}</p>
              ${includeMetadata ? `<pre>${JSON.stringify(metadata, null, 2)}</pre>` : ''}
            </body>
            </html>
          `);
        }
        contentType = "text/html";
        fileExtension = "html";
        break;

      case 'txt':
        console.log("📝 Converting to TXT...");
        if (file.type.includes('document')) {
          const result = await mammoth.extractRawText({ buffer });
          convertedBuffer = Buffer.from(result.value);
        } else if (sourceCategory === 'spreadsheet') {
          if (file.name.toLowerCase().endsWith('.csv')) {
            convertedBuffer = buffer;
          } else {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);
            let text = '';
            workbook.eachSheet((worksheet) => {
              text += `=== ${worksheet.name} ===\n`;
              worksheet.eachRow((row) => {
                const values = row.values.slice(1);
                text += values.join('\t') + '\n';
              });
              text += '\n';
            });
            convertedBuffer = Buffer.from(text);
          }
        } else if (sourceCategory === 'data') {
          try {
            const data = JSON.parse(buffer.toString());
            convertedBuffer = Buffer.from(JSON.stringify(data, null, 2));
          } catch {
            convertedBuffer = buffer;
          }
        } else {
          convertedBuffer = Buffer.from(`File: ${fileName}\nType: ${file.type}\nSize: ${buffer.length} bytes\nConverted: ${new Date().toISOString()}\n\n${includeMetadata ? JSON.stringify(metadata, null, 2) : ''}`);
        }
        contentType = "text/plain";
        fileExtension = "txt";
        break;

      case 'md':
        console.log("📝 Converting to Markdown...");
        if (file.type.includes('document')) {
          const result = await mammoth.convertToHtml({ buffer });
          let markdown = result.value
            .replace(/<h1>/g, '# ')
            .replace(/<\/h1>/g, '\n\n')
            .replace(/<h2>/g, '## ')
            .replace(/<\/h2>/g, '\n\n')
            .replace(/<p>/g, '')
            .replace(/<\/p>/g, '\n\n')
            .replace(/<strong>/g, '**')
            .replace(/<\/strong>/g, '**')
            .replace(/<em>/g, '*')
            .replace(/<\/em>/g, '*');
          
          convertedBuffer = Buffer.from(markdown);
        } else {
          convertedBuffer = Buffer.from(`# ${fileName}\n\n**Original Format:** ${file.type}\n\n**Converted:** ${new Date().toISOString()}\n\n${includeMetadata ? '```json\n' + JSON.stringify(metadata, null, 2) + '\n```' : ''}`);
        }
        contentType = "text/markdown";
        fileExtension = "md";
        break;

      // === DATA FORMATS ===
      case 'json':
        console.log("📊 Converting to JSON...");
        if (sourceCategory === 'spreadsheet') {
          if (file.name.toLowerCase().endsWith('.csv')) {
            const csvData = await parseCSVBuffer(buffer);
            convertedBuffer = Buffer.from(JSON.stringify({
              metadata: metadata,
              data: csvData
            }, null, 2));
          } else {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);
            const sheets = [];
            
            workbook.eachSheet((worksheet) => {
              const sheetData = [];
              const headers = [];
              
              worksheet.eachRow((row, rowNumber) => {
                const values = row.values.slice(1);
                if (rowNumber === 1) {
                  headers.push(...values);
                } else {
                  const rowObject = {};
                  values.forEach((value, index) => {
                    rowObject[headers[index] || `column_${index}`] = value;
                  });
                  sheetData.push(rowObject);
                }
              });
              
              sheets.push({
                name: worksheet.name,
                data: sheetData
              });
            });
            
            convertedBuffer = Buffer.from(JSON.stringify({
              metadata: metadata,
              sheets: sheets
            }, null, 2));
          }
        } else if (sourceCategory === 'document' || file.type?.includes('text') || sourceCategory === 'code') {
          let textContent = '';
          
          if (file.type.includes('document')) {
            const result = await mammoth.extractRawText({ buffer });
            textContent = result.value;
          } else {
            textContent = buffer.toString('utf-8');
          }
          
          convertedBuffer = Buffer.from(JSON.stringify({
            metadata: metadata,
            fileName: fileName,
            originalFormat: file.type,
            content: textContent,
            lines: textContent.split('\n'),
            wordCount: textContent.split(/\s+/).length,
            characterCount: textContent.length,
            convertedAt: new Date().toISOString()
          }, null, 2));
        } else if (sourceCategory === 'data') {
          try {
            const data = JSON.parse(buffer.toString());
            convertedBuffer = Buffer.from(JSON.stringify({
              metadata: metadata,
              originalData: data
            }, null, 2));
          } catch {
            convertedBuffer = Buffer.from(JSON.stringify({
              metadata: metadata,
              content: buffer.toString(),
              note: "Could not parse original data as JSON"
            }, null, 2));
          }
        } else {
          convertedBuffer = Buffer.from(JSON.stringify({
            metadata: metadata,
            fileName: fileName,
            fileType: file.type,
            size: buffer.length,
            convertedAt: new Date().toISOString(),
            note: "Non-data file converted to JSON metadata"
          }, null, 2));
        }
        contentType = "application/json";
        fileExtension = "json";
        break;

      case 'xml':
        console.log("📄 Converting to XML...");
        const xmlData = {
          fileName: fileName,
          fileType: file.type,
          size: buffer.length,
          convertedAt: new Date().toISOString(),
          ...(metadata && { metadata })
        };
        
        const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<file>
  <name><![CDATA[${xmlData.fileName}]]></name>
  <type><![CDATA[${xmlData.fileType}]]></type>
  <size>${xmlData.size}</size>
  <convertedAt>${xmlData.convertedAt}</convertedAt>
  ${xmlData.metadata ? `<metadata>${JSON.stringify(xmlData.metadata)}</metadata>` : ''}
</file>`;
        
        convertedBuffer = Buffer.from(xmlContent);
        contentType = "application/xml";
        fileExtension = "xml";
        break;

      case 'yaml':
      case 'yml':
        console.log("📋 Converting to YAML...");
        if (sourceCategory === 'data') {
          try {
            const data = JSON.parse(buffer.toString());
            const yamlContent = yaml.dump({
              metadata: metadata,
              data: data
            });
            convertedBuffer = Buffer.from(yamlContent);
          } catch {
            const yamlContent = yaml.dump({
              metadata: metadata,
              fileName: fileName,
              fileType: file.type,
              content: buffer.toString(),
              note: "Could not parse as structured data"
            });
            convertedBuffer = Buffer.from(yamlContent);
          }
        } else if (sourceCategory === 'document' || file.type?.includes('text') || sourceCategory === 'code') {
          let textContent = '';
          
          if (file.type.includes('document')) {
            const result = await mammoth.extractRawText({ buffer });
            textContent = result.value;
          } else {
            textContent = buffer.toString('utf-8');
          }
          
          const yamlContent = yaml.dump({
            metadata: metadata,
            fileName: fileName,
            originalFormat: file.type,
            content: textContent,
            lines: textContent.split('\n'),
            wordCount: textContent.split(/\s+/).length,
            characterCount: textContent.length,
            convertedAt: new Date().toISOString()
          });
          convertedBuffer = Buffer.from(yamlContent);
        } else {
          const yamlContent = yaml.dump({
            metadata: metadata,
            fileName: fileName,
            fileType: file.type,
            size: buffer.length,
            convertedAt: new Date().toISOString()
          });
          convertedBuffer = Buffer.from(yamlContent);
        }
        contentType = "application/x-yaml";
        fileExtension = outputFormat;
        break;

      // === SPREADSHEET FORMATS ===
      case 'csv':
        console.log("📊 Converting to CSV...");
        if (sourceCategory === 'spreadsheet' && !file.name.toLowerCase().endsWith('.csv')) {
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(buffer);
          let csvContent = '';
          
          workbook.eachSheet((worksheet, sheetIndex) => {
            if (sheetIndex > 1) csvContent += '\n\n';
            if (workbook.worksheets.length > 1) {
              csvContent += `### ${worksheet.name} ###\n`;
            }
            
            worksheet.eachRow((row) => {
              const values = row.values.slice(1);
              csvContent += values.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',') + '\n';
            });
          });
          
          convertedBuffer = Buffer.from(csvContent);
        } else if (sourceCategory === 'data') {
          try {
            const data = JSON.parse(buffer.toString());
            if (Array.isArray(data) && data.length > 0) {
              const headers = Object.keys(data[0]);
              let csvContent = headers.join(',') + '\n';
              
              data.forEach(row => {
                const values = headers.map(header => `"${String(row[header] || '').replace(/"/g, '""')}"`);
                csvContent += values.join(',') + '\n';
              });
              
              convertedBuffer = Buffer.from(csvContent);
            } else {
              convertedBuffer = Buffer.from('data\n' + JSON.stringify(data));
            }
          } catch {
            convertedBuffer = Buffer.from('content\n' + buffer.toString());
          }
        } else {
          convertedBuffer = Buffer.from(`filename,type,size,converted\n"${fileName}","${file.type}",${buffer.length},"${new Date().toISOString()}"`);
        }
        contentType = "text/csv";
        fileExtension = "csv";
        break;

      case 'xlsx':
      case 'excel':
        console.log("📊 Converting to Excel...");
        const workbook = new ExcelJS.Workbook();
        
        if (sourceCategory === 'data') {
          try {
            const data = JSON.parse(buffer.toString());
            const worksheet = workbook.addWorksheet(fileName);
            
            if (Array.isArray(data) && data.length > 0) {
              const headers = Object.keys(data[0]);
              worksheet.addRow(headers);
              
              data.forEach(row => {
                worksheet.addRow(headers.map(header => row[header]));
              });
              worksheet.getRow(1).font = { bold: true };
              worksheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
              };
            } else {
              worksheet.addRow(['Data']);
              worksheet.addRow([JSON.stringify(data)]);
            }
          } catch {
            const worksheet = workbook.addWorksheet(fileName);
            worksheet.addRow(['Content']);
            worksheet.addRow([buffer.toString()]);
          }
        } else if (sourceCategory === 'spreadsheet' && file.name.toLowerCase().endsWith('.csv')) {
          const csvData = await parseCSVBuffer(buffer);
          const worksheet = workbook.addWorksheet(fileName);
          
          if (csvData.length > 0) {
            const headers = Object.keys(csvData[0]);
            worksheet.addRow(headers);
            
            csvData.forEach(row => {
              worksheet.addRow(headers.map(header => row[header]));
            });
            
            worksheet.getRow(1).font = { bold: true };
          }
        } else {
          const worksheet = workbook.addWorksheet(fileName);
          worksheet.addRow(['Property', 'Value']);
          worksheet.addRow(['File Name', fileName]);
          worksheet.addRow(['File Type', file.type]);
          worksheet.addRow(['File Size', buffer.length + ' bytes']);
          worksheet.addRow(['Converted At', new Date().toISOString()]);
          
          if (includeMetadata && metadata) {
            worksheet.addRow(['Metadata', JSON.stringify(metadata)]);
          }
          
          worksheet.getRow(1).font = { bold: true };
        }
        
        convertedBuffer = await workbook.xlsx.writeBuffer();
        contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        fileExtension = "xlsx";
        break;

      // === VECTOR FORMAT ===
      case 'svg':
        console.log("🖼️ Converting to SVG...");
        const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f0f9ff;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#e0f2fe;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <rect width="800" height="600" fill="url(#bg)" stroke="#0284c7" stroke-width="2"/>
  
  <text x="400" y="100" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#0c4a6e">
    📁 ${fileName}
  </text>
  
  <text x="400" y="140" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#075985">
    Original Type: ${file.type}
  </text>
  
  <text x="400" y="170" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#075985">
    Size: ${(buffer.length / 1024).toFixed(2)} KB
  </text>
  
  <text x="400" y="200" text-anchor="middle" font-family="Arial, sans-serif" font-size="16" fill="#075985">
    Converted: ${new Date().toLocaleDateString('tr-TR')}
  </text>
  
  <circle cx="400" cy="350" r="80" fill="#0ea5e9" fill-opacity="0.2" stroke="#0284c7" stroke-width="3"/>
  <text x="400" y="360" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" fill="#0284c7">
    📄
  </text>
  
  <text x="400" y="500" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#64748b">
    Generated by Enhanced Convert API
  </text>
</svg>`;
        
        convertedBuffer = Buffer.from(svgContent);
        contentType = "image/svg+xml";
        fileExtension = "svg";
        break;

      default:
        return NextResponse.json({ 
          error: `Unsupported output format: ${outputFormat}`,
          supportedFormats: {
            images: FORMAT_CATEGORIES.image,
            documents: FORMAT_CATEGORIES.document,
            spreadsheets: FORMAT_CATEGORIES.spreadsheet,
            data: FORMAT_CATEGORIES.data
          }
        }, { status: 400 });
    }

    console.log("✅ Conversion completed successfully");

    const convertedFileName = `${fileName}.${fileExtension}`;
    const response = {
      success: true,
      fileName: convertedFileName,
      contentType: contentType,
      size: convertedBuffer.length,
      originalSize: buffer.length,
      compressionRatio: ((1 - convertedBuffer.length / buffer.length) * 100).toFixed(2) + '%',
      sourceCategory: sourceCategory,
      targetFormat: outputFormat,
      downloadId: Buffer.from(convertedFileName).toString('base64'),
      ...(includeMetadata && { metadata })
    };

    global.convertedFiles = global.convertedFiles || new Map();
    global.convertedFiles.set(response.downloadId, {
      buffer: convertedBuffer,
      contentType: contentType,
      fileName: convertedFileName,
      createdAt: Date.now()
    });

    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [id, file] of global.convertedFiles.entries()) {
      if (file.createdAt < oneHourAgo) {
        global.convertedFiles.delete(id);
      }
    }

    return NextResponse.json(response);

  } catch (error) {
    console.error("❌ Conversion error:", error);

    const errorResponse = {
      error: `Conversion failed: ${error.message}`,
      details: {
        fileName: file?.name,
        fileType: file?.type,
        targetFormat: outputFormat,
        timestamp: new Date().toISOString()
      }
    };

    if (error.message.includes('Sharp')) {
      errorResponse.suggestion = "Image processing failed. Please ensure the file is a valid image format.";
    } else if (error.message.includes('mammoth')) {
      errorResponse.suggestion = "Document processing failed. Please ensure the file is a valid Word document.";
    } else if (error.message.includes('ExcelJS')) {
      errorResponse.suggestion = "Spreadsheet processing failed. Please ensure the file is a valid Excel file.";
    }

    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const downloadId = url.searchParams.get('id');

    if (!downloadId || !global.convertedFiles?.has(downloadId)) {
      return NextResponse.json({ error: "File not found or expired" }, { status: 404 });
    }

    const file = global.convertedFiles.get(downloadId);
    
    const maxFileNameLength = 100;
    let safeFileName = file.fileName
      .replace(/[^\w\s\-\.]/g, '_')
      .replace(/\s+/g, '_');
    
    if (safeFileName.length > maxFileNameLength) {
      const ext = safeFileName.includes('.') ? '.' + safeFileName.split('.').pop() : '';
      safeFileName = safeFileName.substring(0, maxFileNameLength - ext.length) + ext;
    }

    const downloadFileName = `converted_file_${Date.now()}.${file.fileName.split('.').pop() || 'bin'}`;
    const encodedFileName = encodeURIComponent(downloadFileName);

    return new NextResponse(file.buffer, {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${downloadFileName}"; filename*=UTF-8''${encodedFileName}`,
        'Content-Length': file.buffer.length.toString(),
        'Cache-Control': 'no-cache'
      }
    });

  } catch (error) {
    console.error("❌ Download error:", error);
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}