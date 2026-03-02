# Per-Conversation Draft Persistence

## Problem

When switching between conversations, any text typed in the input box is lost. Users expect drafts to be preserved per-conversation — type something in convo A, switch to B, switch back to A, and the draft is restored.

## Constraints

- In-memory only (drafts lost on page refresh — acceptable)
- No server-side changes for draft storage

## Design

### Core mechanism

ChatPage maintains a `useRef<Map<string, string>>()` called `draftMapRef` that maps `conversationId → draft text`.

InputArea gets an `inputTextRef` prop (`React.MutableRefObject<string>`) that it writes to on every change. This avoids re-rendering ChatPage on every keystroke — ChatPage only reads the ref at save time.

### Save/restore on conversation switch

A `useEffect` in ChatPage watches `currentConversation?.id`. When it changes:

1. **Save**: Write `inputTextRef.current` to `draftMapRef` keyed by the *previous* conversation ID
2. **Restore**: Set `pendingText` to the value from `draftMapRef` for the *new* conversation ID (or `""` if none)

InputArea already handles `pendingText` — it sets its local `text` state from the prop.

### Why null IDs are not a concern

InputArea is disabled when `currentConversation` is null. Conversations get a real UUID via `create_conversation` (triggered by the NewConversationModal) before the user can type. There is no state where a user has typed text without a conversation ID.

### Data flow

```
User types in convo A → InputArea setText() + writes to inputTextRef
User clicks convo B in Sidebar → startConversation(B)
  → useEffect fires (prev conv ID = A)
  → draftMapRef.set(A, inputTextRef.current)
  → setPendingText({ text: draftMapRef.get(B) ?? "", key: Date.now() })
  → InputArea receives pendingText, sets local text state
```

### Edge cases

- **Sending a message**: InputArea clears itself with `setText("")`. The ref updates to `""`. On next switch, `""` is saved — correct behavior.
- **Conversation deleted**: Orphan entry stays in the map as harmless garbage (a string keyed by a UUID that will never be looked up again).
- **Clearing text manually**: Works naturally — empty string saved and restored like any other value.

## Files changed

| File | Change |
|------|--------|
| `client/src/pages/ChatPage.tsx` | Add `draftMapRef`, `inputTextRef`, save/restore `useEffect` |
| `client/src/components/InputArea.tsx` | Accept `inputTextRef` prop, write to it in `onChange` handler |
| `CLAUDE.md` | Fix outdated "lazy conversation creation" note |
