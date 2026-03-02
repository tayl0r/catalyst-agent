# Per-Conversation Draft Persistence — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the text in the input box per-conversation, so switching away saves the draft and switching back restores it.

**Architecture:** A `Map<string, string>` ref in ChatPage stores `conversationId → draft text`. InputArea exposes its current text via a mutable ref prop. A `useEffect` watching conversation ID saves the outgoing draft and restores the incoming one using the existing `pendingText` mechanism.

**Tech Stack:** React 19 (useRef, useEffect, useState), TypeScript

**Note:** This project has no test infrastructure — all testing is manual. Skip TDD steps.

---

### Task 1: Add `inputTextRef` prop to InputArea

**Files:**
- Modify: `client/src/components/InputArea.tsx`

**Step 1: Add the ref prop to the interface and wire it up**

In `client/src/components/InputArea.tsx`, add `inputTextRef` to the props interface and sync it on every text change:

```tsx
// Add to InputAreaProps interface (after line 10):
inputTextRef?: React.MutableRefObject<string>;

// Add to destructured props (after onPendingTextConsumed):
inputTextRef,

// Replace the onChange handler on the textarea (line 63):
// FROM:
onChange={(e) => setText(e.target.value)}
// TO:
onChange={(e) => {
  setText(e.target.value);
  if (inputTextRef) inputTextRef.current = e.target.value;
}}
```

Also sync the ref when `pendingText` is consumed (inside the existing `useEffect` at line 28), and when `handleSubmit` clears text:

```tsx
// In the pendingText useEffect, after setText(pendingText.text):
if (inputTextRef) inputTextRef.current = pendingText.text;

// In handleSubmit, after setText(""):
if (inputTextRef) inputTextRef.current = "";
```

**Step 2: Verify manually**

Run: `cd client && npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```
feat: add inputTextRef prop to InputArea for external text access
```

---

### Task 2: Add draft save/restore to ChatPage

**Files:**
- Modify: `client/src/pages/ChatPage.tsx`

**Step 1: Add the draft map ref and input text ref**

In `client/src/pages/ChatPage.tsx`, add two refs after the existing refs (after line 50):

```tsx
const draftMapRef = useRef<Map<string, string>>(new Map());
const inputTextRef = useRef("");
```

**Step 2: Add the save/restore effect**

Add a `useEffect` that watches `currentConversation?.id`. Use a ref to track the previous conversation ID so we can save the outgoing draft:

```tsx
const prevConversationIdRef = useRef<string | null>(null);

useEffect(() => {
  const prevId = prevConversationIdRef.current;
  const newId = currentConversation?.id ?? null;

  // Save draft for outgoing conversation
  if (prevId) {
    draftMapRef.current.set(prevId, inputTextRef.current);
  }

  // Restore draft for incoming conversation
  if (newId) {
    const draft = draftMapRef.current.get(newId) ?? "";
    setPendingText({ text: draft, key: Date.now() });
    inputTextRef.current = draft;
  }

  prevConversationIdRef.current = newId;
}, [currentConversation?.id]);
```

**Step 3: Pass `inputTextRef` to InputArea**

Update the `<InputArea>` JSX (around line 293) to pass the ref:

```tsx
<InputArea
  onSend={sendPrompt}
  onStop={killProcess}
  isProcessing={isProcessing}
  disabled={
    status !== "connected" || !currentConversation || !!currentConversation.archived
  }
  syncStatus={syncStatus}
  pendingText={pendingText}
  onPendingTextConsumed={() => setPendingText(null)}
  inputTextRef={inputTextRef}
/>
```

**Step 4: Verify manually**

Run: `cd client && npm run typecheck`
Expected: No type errors

Run: `npm run dev` and test:
1. Create/select conversation A, type "hello from A"
2. Switch to conversation B, verify input is empty
3. Type "hello from B" in B
4. Switch back to A, verify "hello from A" is restored
5. Switch back to B, verify "hello from B" is restored
6. Send a message in A, switch away and back, verify input is empty

**Step 5: Commit**

```
feat: preserve input text per-conversation on switch
```

---

### Task 3: Fix outdated CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the lazy creation gotcha**

Replace the line:
```
- **Lazy conversation creation:** Conversation DB records are created on first prompt, not on WebSocket connect, to avoid orphan records
```

With:
```
- **Conversation creation:** Conversation DB records are created when the user submits the New Conversation modal (`create_conversation` message), before any prompt is sent. The record exists with a real UUID by the time the user can type.
```

Also update the Session Management section (line 50). Replace:
```
The conversation record is created lazily on the first prompt, not on WebSocket connect.
```

With:
```
The conversation record is created when the user submits the New Conversation modal, before any prompt is sent.
```

**Step 2: Commit**

```
docs: fix outdated lazy conversation creation notes in CLAUDE.md
```

---

### Task 4: Lint and final verification

**Step 1: Run lint fix**

Run: `npm run lint:fix`
Expected: No errors

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Manual smoke test**

Run: `npm run dev` and verify all the scenarios from Task 2, Step 4.
