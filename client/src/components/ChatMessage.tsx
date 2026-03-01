import type { UIMessage } from "@shared/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import EventRenderer from "./events/EventRenderer";
import StreamingIndicator from "./StreamingIndicator";

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
          {message.rawEvents?.length ? (
            <EventRenderer events={message.rawEvents} />
          ) : message.content ? (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          ) : null}
          {message.streaming && <StreamingIndicator />}
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
    if (!cost) return null;

    return (
      <div className="flex justify-center">
        <span className="text-xs text-gray-500">{cost}</span>
      </div>
    );
  }

  return null;
}
