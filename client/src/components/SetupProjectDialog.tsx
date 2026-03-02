interface SetupProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function SetupProjectDialog({
  isOpen,
  onClose,
  onConfirm,
}: SetupProjectDialogProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-project-title"
    >
      <div className="bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4 border border-gray-700">
        <h2 id="setup-project-title" className="text-lg font-semibold text-gray-100 mb-4">
          Setup Project
        </h2>
        <p className="text-sm text-gray-300 mb-6">
          This project hasn't been set up for Catalyst Agent yet. Click OK to add setup instructions
          to your prompt — Claude will create start.sh and PORTS with the right port configuration
          for this project.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 transition-colors"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
