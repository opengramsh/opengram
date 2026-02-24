import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownContent({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        code: ({ children, className }) =>
          className ? (
            <code className="block bg-black/20 rounded p-2 text-sm font-mono my-1 overflow-x-auto">{children}</code>
          ) : (
            <code className="bg-black/20 rounded px-1 text-sm font-mono">{children}</code>
          ),
        pre: ({ children }) => <pre className="my-1">{children}</pre>,
        ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
        li: ({ children }) => <li className="mb-0.5">{children}</li>,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer" className="underline opacity-80 hover:opacity-100">
            {children}
          </a>
        ),
        h1: ({ children }) => <h1 className="text-lg font-bold mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="font-bold mb-1">{children}</h3>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-current pl-3 opacity-70 my-1">{children}</blockquote>
        ),
        hr: () => <hr className="my-2 border-current opacity-20" />,
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="text-sm border-collapse w-full">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="opacity-70">{children}</thead>,
        th: ({ children }) => (
          <th className="border border-current/30 px-2 py-1 font-semibold text-left">{children}</th>
        ),
        td: ({ children }) => <td className="border border-current/30 px-2 py-1">{children}</td>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
