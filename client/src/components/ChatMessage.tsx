import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "@shared/types";

interface ChatMessageProps {
  message: UIMessage;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  if (message.type === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2.5 text-white">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  if (message.type === "assistant") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-gray-800 px-4 py-2.5">
          <div className="prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
          {message.streaming && (
            <span className="inline-block h-4 w-1.5 animate-pulse bg-gray-400 ml-0.5" />
          )}
        </div>
      </div>
    );
  }

  if (message.type === "error") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] rounded-2xl bg-red-900/50 border border-red-700 px-4 py-2.5 text-red-200">
          <p className="text-sm">{message.content}</p>
        </div>
      </div>
    );
  }

  if (message.type === "result") {
    const { data } = message;
    const cost = data.cost_usd != null ? `$${data.cost_usd.toFixed(4)}` : null;
    const inputTokens = data.usage?.input_tokens;
    const outputTokens = data.usage?.output_tokens;

    return (
      <div className="flex justify-center">
        <div className="text-xs text-gray-500 flex gap-3">
          {cost && <span>{cost}</span>}
          {inputTokens != null && <span>{inputTokens.toLocaleString()} in</span>}
          {outputTokens != null && <span>{outputTokens.toLocaleString()} out</span>}
        </div>
      </div>
    );
  }

  return null;
}
