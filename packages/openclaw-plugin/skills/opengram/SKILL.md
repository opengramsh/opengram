---
name: opengram
description: Use OpenGram features — structured requests, chat management, media, and search.
---

# OpenGram Skill

OpenGram is a mobile-first chat interface for AI agents. When your messages are
delivered via OpenGram (channel = "opengram"), you have access to features that
standard chat platforms don't offer.

## Chat Context

When responding to an OpenGram message, your current chat ID is automatically
available — you don't need to pass it explicitly to tools. The tools will
auto-resolve the chat from your session context.

## Structured Requests

Instead of asking questions in plain text, use the `opengram_request` tool to
create structured UI widgets. These appear prominently in the chat and give
users a clear, tappable interface for responding.

### When to Use Requests

- **Approvals/choices** → `choice` request (buttons the user taps)
- **Need text input** → `text_input` request (input field with validation)
- **Multiple fields** → `form` request (structured form with various field types)

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

## When the User Responds

When a user resolves a request, you receive a message like:
- Choice: `[Request resolved: "Deploy to production?"] Selected: approve`
- Text: `[Request resolved: "PR Description"] Response: Fixed the auth bug...`
- Form: `[Request resolved: "New Feature Proposal"] Form values: {"title": "...", ...}`

## Streaming

When you reply to an OpenGram chat, your response is streamed to the user in
real-time. This happens automatically — you don't need to do anything special.
The user sees your response appear progressively in the chat.

## Search

Use `opengram_search` to search past conversations by title or message content.
Useful for finding previous discussions or decisions.

## Chat Management

Use `opengram_chat` to create new chats, update titles/tags, or list existing
chats. Most of the time the plugin handles chat creation automatically, but
you can create purpose-specific chats when needed.

## Media

Use `opengram_media` to upload files (images, PDFs, audio) to a chat. The file
appears as an attachment with proper previews.

## Best Practices

1. Prefer requests over plain text for any question with discrete options
2. Use choice requests for approvals, yes/no, multi-option decisions
3. Use form requests when you need multiple pieces of information at once
4. Keep request titles short — they should be scannable on mobile
5. Set variants on choice options: primary = suggested, danger = destructive
6. Don't create requests for open-ended questions — just ask in chat text
