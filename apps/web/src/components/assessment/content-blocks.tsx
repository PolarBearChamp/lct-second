import type { ContentBlock } from '@fsp/contracts';

/** Отображение условий задания: текст, код, таблицы, списки. Код — только материал для анализа, он не исполняется. */
export function ContentBlocks({ blocks }: { blocks: ContentBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'text':
            return (
              <p key={index} className="whitespace-pre-line text-[15px] leading-relaxed">
                {block.text}
              </p>
            );
          case 'list':
            return (
              <ul key={index} className="list-disc space-y-1 pl-5 text-[15px]">
                {block.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            );
          case 'code':
            return (
              <pre
                key={index}
                className="overflow-x-auto rounded-xl bg-ink p-4 text-[13px] leading-relaxed text-[#ededed]"
                tabIndex={0}
                aria-label={`Фрагмент кода (${block.language})`}
              >
                <code>{block.code}</code>
              </pre>
            );
          case 'table':
            return (
              <div key={index} className="overflow-x-auto rounded-xl border border-line" tabIndex={0}>
                <table className="w-full text-left text-sm">
                  {block.caption ? (
                    <caption className="border-b border-line bg-canvas px-3 py-2 text-left font-brand text-[13px] font-bold">
                      {block.caption}
                    </caption>
                  ) : null}
                  <thead className="bg-canvas">
                    <tr>
                      {block.columns.map((column) => (
                        <th key={column} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-t border-line">
                        {row.map((cell, c) => (
                          <td key={c} className="px-3 py-2 align-top font-mono text-[13px]">
                            {cell === null ? 'NULL' : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
