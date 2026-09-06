'use client';

import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

type AgentMessageContentProps = {
  content: string;
  className?: string;
};

export function AgentMessageContent({
  content,
  className,
}: AgentMessageContentProps) {
  return (
    <div
      className={cn(
        'agent-prose text-sm leading-relaxed text-app-text-secondary',
        className,
      )}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-2 mt-1 text-base font-semibold text-app-text">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-3 text-sm font-semibold text-app-text">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-2.5 text-sm font-semibold text-app-text">
              {children}
            </h3>
          ),
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-app-text">{children}</strong>
          ),
          ul: ({ children }) => (
            <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="text-app-text-secondary">{children}</li>
          ),
          code: ({ className: codeClassName, children }) => {
            const isBlock = codeClassName?.includes('language-');
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-lg bg-[#0d0d0f] px-3 py-2 font-mono text-xs text-app-text-secondary">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-app-surface px-1 py-0.5 font-mono text-xs text-app-text">
                {children}
              </code>
            );
          },
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-replit-orange underline underline-offset-2 hover:opacity-90">
              {children}
            </a>
          ),
        }}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
