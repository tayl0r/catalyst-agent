interface ToolUseBlockProps {
  name: string;
  input: Record<string, unknown>;
}

function renderInput(name: string, input: Record<string, unknown>) {
  const n = name.toLowerCase();

  if (n === "bash") {
    return (
      <div>
        {typeof input.description === "string" && (
          <p className="text-xs text-gray-400 mb-1">{input.description}</p>
        )}
        <pre className="text-xs bg-black/40 rounded px-3 py-2 overflow-x-auto text-gray-200 font-mono">
          {String(input.command ?? "")}
        </pre>
      </div>
    );
  }

  if (n === "read" || n === "write" || n === "edit") {
    return <p className="text-xs text-gray-300 font-mono">{String(input.file_path ?? "")}</p>;
  }

  if (n === "glob" || n === "grep") {
    return <p className="text-xs text-gray-300 font-mono">{String(input.pattern ?? "")}</p>;
  }

  // Fallback: show key-value pairs, with special rendering for todo arrays
  const entries = Object.entries(input).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return null;

  return (
    <div className="text-xs text-gray-300 space-y-0.5">
      {entries.map(([key, value]) => {
        // Render todo arrays as a nice list
        if (key === "todos" && Array.isArray(value)) {
          return (
            <div key={key}>
              <span className="text-gray-500">{key}:</span>
              <div className="ml-3 mt-0.5 space-y-0.5">
                {(value as Record<string, unknown>[]).map((todo) => {
                  const content = typeof todo.content === "string" ? todo.content : "";
                  const activeForm = typeof todo.activeForm === "string" ? todo.activeForm : "";
                  const label = activeForm
                    ? `${content.toLowerCase()} → ${activeForm.toLowerCase()}...`
                    : `${content.toLowerCase()}...`;
                  return (
                    <div key={content || activeForm} className="text-gray-300">
                      <span className="text-gray-500">- </span>
                      {label}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        }

        return (
          <div key={key}>
            <span className="text-gray-500">{key}: </span>
            <span className="font-mono">
              {typeof value === "string" ? value : JSON.stringify(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function ToolUseBlock({ name, input }: ToolUseBlockProps) {
  return (
    <div className="my-2">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium bg-gray-700 text-gray-200 px-2 py-0.5 rounded">
          {name}
        </span>
      </div>
      {renderInput(name, input)}
    </div>
  );
}
