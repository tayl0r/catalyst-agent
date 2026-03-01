interface ThinkingBlockProps {
  thinking: string;
}

export default function ThinkingBlock({ thinking }: ThinkingBlockProps) {
  const firstLine = thinking.split("\n")[0] ?? "";

  return (
    <details className="group border-l-2 border-gray-600 pl-3 my-2">
      <summary className="cursor-pointer text-xs text-gray-400 select-none hover:text-gray-300">
        Thinking{firstLine ? `: ${firstLine}` : "..."}
      </summary>
      <div className="mt-2 text-xs text-gray-400 whitespace-pre-wrap leading-relaxed">
        {thinking}
      </div>
    </details>
  );
}
