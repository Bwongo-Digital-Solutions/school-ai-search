import React from 'react';
import styles from './markdown.module.scss';

interface MarkdownRendererProps {
  content: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeContent = '';
    let inTable = false;
    let tableRows: string[][] = [];
    let tableHeader: string[] = [];

    const processInline = (line: string): React.ReactNode => {
      // Bold
      let processed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // Italic
      processed = processed.replace(/\*(.*?)\*/g, '<em>$1</em>');
      // Inline code
      processed = processed.replace(/`(.*?)`/g, '<code>$1</code>');

      return <span dangerouslySetInnerHTML={{ __html: processed }} />;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code blocks
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          elements.push(
            <pre key={i} className={styles.codeBlock}>
              <code>{codeContent}</code>
            </pre>
          );
          codeContent = '';
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeContent += (codeContent ? '\n' : '') + line;
        continue;
      }

      // Table detection
      if (line.includes('|') && line.trim().startsWith('|')) {
        const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
        
        if (cells.every(c => /^[-:]+$/.test(c))) {
          continue; // Skip separator row
        }

        if (!inTable) {
          inTable = true;
          tableHeader = cells;
        } else {
          tableRows.push(cells);
        }

        // Check if next line is not a table
        if (i + 1 >= lines.length || !lines[i + 1]?.trim().startsWith('|')) {
          elements.push(
            <div key={i} className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {tableHeader.map((h, hi) => (
                      <th key={hi}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td key={ci}>
                          {processInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          inTable = false;
          tableRows = [];
          tableHeader = [];
        }
        continue;
      }

      // Headers
      if (line.startsWith('### ')) {
        elements.push(<h3 key={i}>{processInline(line.slice(4))}</h3>);
        continue;
      }
      if (line.startsWith('## ')) {
        elements.push(<h2 key={i}>{processInline(line.slice(3))}</h2>);
        continue;
      }
      if (line.startsWith('# ')) {
        elements.push(<h1 key={i}>{processInline(line.slice(2))}</h1>);
        continue;
      }

      // Horizontal rule
      if (line.trim() === '---' || line.trim() === '***') {
        elements.push(<hr key={i} />);
        continue;
      }

      // Unordered list
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        const indent = line.search(/\S/);
        const content = line.trim().slice(2);
        elements.push(
          <div key={i} className={styles.listItem} style={{ paddingLeft: `${indent * 8}px` }}>
            <span className={styles.bullet} />
            <span>{processInline(content)}</span>
          </div>
        );
        continue;
      }

      // Ordered list
      const orderedMatch = line.trim().match(/^(\d+)\.\s(.+)/);
      if (orderedMatch) {
        elements.push(
          <div key={i} className={styles.listItem}>
            <span className={styles.ordinal}>{orderedMatch[1]}.</span>
            <span>{processInline(orderedMatch[2])}</span>
          </div>
        );
        continue;
      }

      // Empty line
      if (line.trim() === '') {
        elements.push(<div key={i} className={styles.spacer} />);
        continue;
      }

      // Regular paragraph
      elements.push(<p key={i}>{processInline(line)}</p>);
    }

    return elements;
  };

  return <div className={styles.markdown}>{renderMarkdown(content)}</div>;
};

export default MarkdownRenderer;
