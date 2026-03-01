import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface TextBlockProps {
  text: string;
}

export default function TextBlock({ text }: TextBlockProps) {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
