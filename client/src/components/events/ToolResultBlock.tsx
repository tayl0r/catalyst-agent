interface ToolResult {
  stdout?: string;
  stderr?: string;
}

interface ToolResultBlockProps {
  result: ToolResult;
}

export default function ToolResultBlock({ result }: ToolResultBlockProps) {
  const { stdout, stderr } = result;
  if (!stdout && !stderr) return null;

  return (
    <div className="my-1 bg-black/50 rounded px-3 py-2 max-h-64 overflow-auto font-mono text-xs">
      {stdout && <pre className="text-gray-300 whitespace-pre-wrap">{stdout}</pre>}
      {stderr && <pre className="text-red-300 whitespace-pre-wrap">{stderr}</pre>}
    </div>
  );
}
