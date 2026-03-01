interface Option {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: Option[];
  multiSelect: boolean;
}

interface AskUserQuestionBlockProps {
  questions: Question[];
  onSend?: (text: string) => void;
}

export default function AskUserQuestionBlock({ questions, onSend }: AskUserQuestionBlockProps) {
  return (
    <div className="my-2 space-y-3">
      {questions.map((q) => (
        <div key={q.question}>
          <p className="text-sm text-gray-200 mb-2">{q.question}</p>
          <div className="space-y-1.5">
            {q.options.map((opt) => (
              <button
                key={opt.label}
                type="button"
                onClick={() => onSend?.(`${q.question}\n${opt.label}`)}
                className="w-full text-left rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2 hover:border-blue-500 hover:bg-gray-700/50 transition-colors group"
              >
                <span className="text-sm text-gray-200 group-hover:text-white">{opt.label}</span>
                {opt.description && (
                  <span className="block text-xs text-gray-500 mt-0.5">{opt.description}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
