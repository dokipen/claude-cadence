import { Component, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

class MarkdownErrorBoundary extends Component<
  { fallback: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return <span style={{ whiteSpace: "pre-wrap" }}>{this.props.fallback}</span>;
    }
    return this.props.children;
  }
}

export function Markdown({ children }: { children: string }) {
  return (
    <MarkdownErrorBoundary fallback={children}>
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </MarkdownErrorBoundary>
  );
}
