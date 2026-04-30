import React from 'react';

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
      processed = processed.replace(/`(.*?)`/g, '<code class="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono text-indigo-600 dark:text-indigo-400">$1</code>');

      return <span dangerouslySetInnerHTML={{ __html: processed }} />;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code blocks
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          elements.push(
            <pre key={i} className="bg-gray-900 text-green-400 p-4 rounded-lg my-2 overflow-x-auto text-sm font-mono">
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
            <div key={i} className="overflow-x-auto my-3">
              <table className="min-w-full border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
                <thead className="bg-indigo-50 dark:bg-indigo-900/30">
                  <tr>
                    {tableHeader.map((h, hi) => (
                      <th key={hi} className="px-4 py-2 text-left text-xs font-semibold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider border-b border-gray-200 dark:border-gray-600">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-750'}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-700">
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
        elements.push(<h3 key={i} className="text-base font-bold text-gray-800 dark:text-gray-100 mt-4 mb-2">{processInline(line.slice(4))}</h3>);
        continue;
      }
      if (line.startsWith('## ')) {
        elements.push(<h2 key={i} className="text-lg font-bold text-gray-800 dark:text-gray-100 mt-4 mb-2">{processInline(line.slice(3))}</h2>);
        continue;
      }
      if (line.startsWith('# ')) {
        elements.push(<h1 key={i} className="text-xl font-bold text-gray-800 dark:text-gray-100 mt-4 mb-2">{processInline(line.slice(2))}</h1>);
        continue;
      }

      // Horizontal rule
      if (line.trim() === '---' || line.trim() === '***') {
        elements.push(<hr key={i} className="my-4 border-gray-200 dark:border-gray-600" />);
        continue;
      }

      // Unordered list
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        const indent = line.search(/\S/);
        const content = line.trim().slice(2);
        elements.push(
          <div key={i} className="flex items-start gap-2 my-0.5" style={{ paddingLeft: `${indent * 8}px` }}>
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-2 flex-shrink-0" />
            <span className="text-gray-700 dark:text-gray-300">{processInline(content)}</span>
          </div>
        );
        continue;
      }

      // Ordered list
      const orderedMatch = line.trim().match(/^(\d+)\.\s(.+)/);
      if (orderedMatch) {
        elements.push(
          <div key={i} className="flex items-start gap-2 my-0.5">
            <span className="text-indigo-500 font-semibold text-sm min-w-[20px]">{orderedMatch[1]}.</span>
            <span className="text-gray-700 dark:text-gray-300">{processInline(orderedMatch[2])}</span>
          </div>
        );
        continue;
      }

      // Empty line
      if (line.trim() === '') {
        elements.push(<div key={i} className="h-2" />);
        continue;
      }

      // Regular paragraph
      elements.push(<p key={i} className="text-gray-700 dark:text-gray-300 my-1 leading-relaxed">{processInline(line)}</p>);
    }

    return elements;
  };

  return <div className="markdown-content">{renderMarkdown(content)}</div>;
};

export default MarkdownRenderer;
