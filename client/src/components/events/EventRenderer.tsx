import AskUserQuestionBlock from "./AskUserQuestionBlock";
import ResultSummary from "./ResultSummary";
import TextBlock from "./TextBlock";
import ThinkingBlock from "./ThinkingBlock";
import ToolResultBlock from "./ToolResultBlock";
import ToolUseBlock from "./ToolUseBlock";

interface EventRendererProps {
  events: Record<string, unknown>[];
  onSend?: (text: string) => void;
}

interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

export default function EventRenderer({ events, onSend }: EventRendererProps) {
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // Assistant event — extract content blocks from message.content[]
    if (event.message && typeof event.message === "object") {
      const msg = event.message as Record<string, unknown>;
      const content = msg.content;
      if (Array.isArray(content)) {
        for (let j = 0; j < content.length; j++) {
          const block = content[j] as ContentBlock;
          const key = `${i}-${j}`;

          if (block.type === "thinking" && typeof block.thinking === "string") {
            elements.push(<ThinkingBlock key={key} thinking={block.thinking} />);
          } else if (block.type === "text" && typeof block.text === "string") {
            elements.push(<TextBlock key={key} text={block.text} />);
          } else if (block.type === "tool_use" && block.name === "AskUserQuestion") {
            const input = (block.input as Record<string, unknown>) ?? {};
            const questions = Array.isArray(input.questions) ? input.questions : [];
            elements.push(
              <AskUserQuestionBlock
                key={key}
                questions={
                  questions as {
                    question: string;
                    header: string;
                    options: { label: string; description: string }[];
                    multiSelect: boolean;
                  }[]
                }
                onSend={onSend}
              />,
            );
          } else if (block.type === "tool_use" && typeof block.name === "string") {
            elements.push(
              <ToolUseBlock
                key={key}
                name={block.name}
                input={(block.input as Record<string, unknown>) ?? {}}
              />,
            );
          }
        }
      }
      continue;
    }

    // User event with tool result
    if (event.type === "user") {
      const msg = event.message as Record<string, unknown> | undefined;
      const content = msg?.content;
      if (Array.isArray(content)) {
        for (let j = 0; j < content.length; j++) {
          const block = content[j] as ContentBlock;
          if (block.type === "tool_result" || block.tool_use_result) {
            const result = (block.tool_use_result ?? block) as Record<string, unknown>;
            const contentArr = result.content;
            let stdout = "";
            let stderr = "";
            if (typeof contentArr === "string") {
              stdout = contentArr;
            } else if (Array.isArray(contentArr)) {
              for (const part of contentArr) {
                if (typeof part === "object" && part !== null) {
                  const p = part as Record<string, unknown>;
                  if (typeof p.text === "string") {
                    stdout += p.text;
                  }
                }
              }
            }
            // Check for stderr in the tool result
            if (typeof result.stderr === "string") {
              stderr = result.stderr;
            }
            if (stdout || stderr) {
              elements.push(<ToolResultBlock key={`${i}-${j}`} result={{ stdout, stderr }} />);
            }
          }
        }
      }
      continue;
    }

    // Result event
    if (event.type === "result") {
      elements.push(
        <ResultSummary
          key={`${i}-result`}
          durationMs={typeof event.duration_ms === "number" ? event.duration_ms : undefined}
          isError={event.is_error === true}
        />,
      );
    }

    // Unknown event types are silently skipped
  }

  return <>{elements}</>;
}
