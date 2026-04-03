---
name: opengram
description: Use OpenGram features — structured requests, chat management, media, and search.
---

# OpenGram Skill

OpenGram is a chat interface and REST API for AI agents. When your messages are
delivered via OpenGram (channel = "opengram"), you have access to features that
standard chat platforms don't offer.

## Chat ID

All OpenGram tools require a `chatId` parameter. Extract it from the `From`
field in your conversation context:

- Format: `From: opengram:<chatId>`
- Example: if `From: opengram:abc123xyz`, use `chatId: "abc123xyz"`

<!-- ## Structured Requests

Instead of asking questions in plain text, use the `opengram_request` tool to
create structured UI widgets. These appear prominently in the chat and give
users a clear, tappable interface for responding.

### When to Use Requests

- **Approvals/choices** → `choice` request (buttons the user taps)
- **Need text input** → `text_input` request (input field with validation)
- **Multiple fields** → `form` request (structured form with various field types)

### When NOT to Use Requests

- Open-ended questions — just ask in regular chat text
- Simple yes/no that's part of a flowing conversation — plain text is fine
- When you need to ask a follow-up immediately — requests are for standalone prompts

### Choice Request Example

```json
{
  "type": "choice",
  "title": "Deploy to production?",
  "body": "All tests pass. Ready to deploy v2.1.0.",
  "config": {
    "options": [
      { "id": "approve", "label": "Approve", "variant": "primary" },
      { "id": "reject", "label": "Reject", "variant": "danger" },
      { "id": "defer", "label": "Defer to tomorrow" }
    ],
    "maxSelections": 1
  }
}
```

### Text Input Request Example

```json
{
  "type": "text_input",
  "title": "PR Description",
  "body": "Enter a description for the pull request.",
  "config": {
    "placeholder": "Describe the changes...",
    "validation": { "minLength": 10, "maxLength": 500 }
  }
}
```

### Form Request Example

```json
{
  "type": "form",
  "title": "New Feature Proposal",
  "config": {
    "fields": [
      { "name": "title", "type": "text", "label": "Feature Title", "required": true },
      { "name": "description", "type": "textarea", "label": "Description" },
      { "name": "priority", "type": "select", "label": "Priority", "options": ["low", "medium", "high"] },
      { "name": "tags", "type": "multiselect", "label": "Tags", "options": ["frontend", "backend", "api", "ux"] }
    ],
    "submitLabel": "Submit Proposal"
  }
}
```

### When the User Responds

When a user resolves a request, you receive a message like:
- Choice: `[Request resolved: "Deploy to production?"] Selected: approve`
- Text: `[Request resolved: "PR Description"] Response: Fixed the auth bug...`
- Form: `[Request resolved: "New Feature Proposal"] Form values: {"title": "...", ...}` -->

## Search

Use `opengram_search` to search past conversations by title or message content.

**Parameters:**
- `query` (required) — the search text
- `scope` (optional) — `"all"` (default), `"titles"`, or `"messages"`

**Results** include matching chats (with IDs and titles) and matching messages
(with chat IDs and content snippets). Use the returned chat IDs to reference
or link to past conversations.

## Media

### Inbound (user sends files to you)

When a user sends files in a message, you receive them as temporary local file
paths in your context:

- Single file: `MediaPath` contains the temp file path, `MediaType` has the MIME type
- Multiple files: `MediaPaths` (array of paths), `MediaTypes` (array of MIME types)

You can read these files directly from the provided paths.

### Outbound (you send files to the user)

Use `opengram_media` to upload files to a chat. The `filePath` parameter accepts:

- A `MediaPath` you received from the user's inbound message
- Any local file path (e.g., a file you generated or downloaded)

The file appears as an attachment in the chat with proper previews for images,
PDFs, and audio.

## Chat Management

Use `opengram_chat` to create, update, or list chats.

**Create** — starts a new chat. `modelId` is optional; if omitted, OpenGram
uses the agent or instance default model. Optionally set `title`, `tags`, and
`agentId`.

**Update** — modify an existing chat. Requires `chatId`. You can change
`title`, `tags`, or `pinned` status.

**List** — returns up to 20 recent chats with their IDs and titles.

<!-- ## Best Practices

1. Prefer requests over plain text for any question with discrete options
2. Use choice requests for approvals, yes/no, multi-option decisions
3. Use form requests when you need multiple pieces of information at once
4. Keep request titles short — they should be scannable on mobile
5. Set variants on choice options: `"primary"` = suggested, `"danger"` = destructive
6. Always extract your chatId from the `From` field before calling any tool -->
