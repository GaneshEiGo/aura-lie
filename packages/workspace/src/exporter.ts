import type { GeneratedDocument, Citation } from './types.js';

/**
 * PRD Section 14.3: Document mode
 * Exports without heavy libraries (client-side pure generation).
 */
export class DocumentExporter {
  
  public toMarkdown(doc: GeneratedDocument): string {
    let md = `# ${doc.title}\n\n`;
    md += `> ${doc.summary}\n\n`;
    
    const allCitations: Citation[] = [];

    for (const block of doc.blocks) {
      if (block.type === 'heading') {
        md += `${'#'.repeat(block.level || 2)} ${block.content}\n\n`;
      } else if (block.type === 'paragraph') {
        let text = block.content;
        if (block.citations && block.citations.length > 0) {
          const citeIds = block.citations.map(c => {
            allCitations.push(c);
            return `[${c.id}]`;
          }).join('');
          text += ` ${citeIds}`;
        }
        md += `${text}\n\n`;
      } else if (block.type === 'code') {
        md += `\`\`\`\n${block.content}\n\`\`\`\n\n`;
      } else if (block.type === 'table') {
        md += `${block.content}\n\n`; // Assume table content is already formatted in markdown
      }
    }

    if (allCitations.length > 0) {
      md += `## Citations\n\n`;
      // Deduplicate citations
      const uniqueCites = Array.from(new Map(allCitations.map(c => [c.id, c])).values());
      for (const cite of uniqueCites) {
        md += `[${cite.id}] [${cite.text}](${cite.sourceUrl})\n`;
      }
    }

    return md;
  }

  public toHTML(doc: GeneratedDocument): string {
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${doc.title}</title>`;
    html += `<style>body{font-family:system-ui,sans-serif;line-height:1.6;max-width:800px;margin:0 auto;padding:2rem;color:#333;} a{color:#1F4EFF;text-decoration:none;} a:hover{text-decoration:underline;} blockquote{background:#FAFAFA;border-left:4px solid #1F4EFF;margin:0;padding:1rem;}</style></head><body>`;
    html += `<h1>${doc.title}</h1>`;
    html += `<blockquote>${doc.summary}</blockquote>`;

    const allCitations: Citation[] = [];

    for (const block of doc.blocks) {
      if (block.type === 'heading') {
        const tag = `h${block.level || 2}`;
        html += `<${tag}>${block.content}</${tag}>`;
      } else if (block.type === 'paragraph') {
        let text = block.content;
        if (block.citations && block.citations.length > 0) {
          const citeIds = block.citations.map(c => {
            allCitations.push(c);
            return `<a href="#cite-${c.id}">[${c.id}]</a>`;
          }).join('');
          text += ` ${citeIds}`;
        }
        html += `<p>${text}</p>`;
      } else if (block.type === 'code') {
        html += `<pre><code>${block.content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`;
      } else if (block.type === 'table') {
        // Basic fallback, assumes pre-formatted HTML table string or simple text
        html += `<div>${block.content}</div>`; 
      }
    }

    if (allCitations.length > 0) {
      html += `<h2>Citations</h2><ul>`;
      const uniqueCites = Array.from(new Map(allCitations.map(c => [c.id, c])).values());
      for (const cite of uniqueCites) {
        html += `<li id="cite-${cite.id}"><a href="${cite.sourceUrl}" target="_blank" rel="noopener">${cite.text}</a></li>`;
      }
      html += `</ul>`;
    }

    html += `</body></html>`;
    return html;
  }
}