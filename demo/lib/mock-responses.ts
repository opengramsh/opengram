// Canned response library — picks a response based on keyword matching.

type ResponseEntry = {
  keywords: string[];
  response: string;
};

const RESPONSES: ResponseEntry[] = [
  {
    keywords: ['hello', 'hi', 'hey', 'greetings', 'howdy'],
    response: `Hey there! Welcome to the **OpenGram demo**.

This is a fully interactive preview of the OpenGram chat interface. Everything you see here runs entirely in your browser — no server required.

Feel free to:
- Send messages and get simulated responses
- Explore the sidebar, search, and settings
- Try pinning, tagging, or archiving chats
- Create new conversations

What would you like to try?`,
  },
  {
    keywords: ['help', 'how', 'what can', 'features', 'what do'],
    response: `Here's what you can explore in this demo:

### Chat features
- **Streaming responses** — watch messages appear word by word
- **Markdown rendering** — headings, bold, code blocks, tables, and more
- **Multiple agents** — each chat can have a different AI agent
- **Pending requests** — agents can ask for your input via buttons or forms

### Organization
- **Pin** important conversations to the top
- **Tag** chats for easy filtering
- **Archive** old conversations
- **Search** across all messages

### Try it out
Send a message like "show me some code" or "write a poem" to see the rendering in action!`,
  },
  {
    keywords: ['code', 'program', 'function', 'javascript', 'python', 'typescript', 'example'],
    response: `Here's a practical example — a TypeScript function that debounces API calls:

\`\`\`typescript
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Usage
const search = debounce((query: string) => {
  console.log("Searching for:", query);
}, 300);
\`\`\`

And here's the same concept in Python:

\`\`\`python
from functools import wraps
from threading import Timer

def debounce(delay: float):
    def decorator(fn):
        timer = [None]
        @wraps(fn)
        def wrapper(*args, **kwargs):
            if timer[0]:
                timer[0].cancel()
            timer[0] = Timer(delay, fn, args, kwargs)
            timer[0].start()
        return wrapper
    return decorator

@debounce(0.3)
def search(query: str):
    print(f"Searching for: {query}")
\`\`\`

Both implementations cancel the previous timer on each call, only executing after the specified delay of inactivity.`,
  },
  {
    keywords: ['markdown', 'format', 'render', 'rich text'],
    response: `# Markdown Showcase

OpenGram supports **full Markdown** rendering. Here's what's available:

## Text styling
- **Bold text** and *italic text*
- ~~Strikethrough~~ and \`inline code\`
- [Links](https://opengram.sh) work too

## Lists
1. First ordered item
2. Second ordered item
   - Nested unordered
   - Another nested item

## Blockquote
> "Any sufficiently advanced technology is indistinguishable from magic."
> — Arthur C. Clarke

## Table
| Syntax | Description | Example |
|--------|-------------|---------|
| \`**bold**\` | Bold text | **bold** |
| \`*italic*\` | Italic text | *italic* |
| \`\`\`code\`\`\` | Code block | \`code\` |
| \`> quote\` | Blockquote | (see above) |

## Code block
\`\`\`json
{
  "name": "opengram",
  "version": "1.0.0",
  "features": ["markdown", "streaming", "agents"]
}
\`\`\`

Pretty neat, right?`,
  },
  {
    keywords: ['poem', 'poetry', 'creative', 'write', 'story'],
    response: `Here's a short piece for you:

---

### The Async Gardener

*In a garden of promises,*
*where callbacks once grew wild,*
*an async gardener planted seeds*
*and awaited, reconciled.*

*Each function bloomed in order,*
*no tangled vines of state —*
*just clean, sequential petals*
*that never ran too late.*

*The try-catch fence stood sturdy,*
*the errors, gently caught.*
*In this well-tended codebase,*
*bugs were seldom wrought.*

---

Want me to try a different style or topic?`,
  },
  {
    keywords: ['math', 'equation', 'latex', 'formula', 'calculate'],
    response: `OpenGram supports LaTeX math rendering! Here are some examples:

**Inline math:** The quadratic formula is $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$.

**Block equation — Euler's identity:**

$$e^{i\\pi} + 1 = 0$$

**A more complex example — the Gaussian integral:**

$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$

**Matrix notation:**

$$A = \\begin{pmatrix} a_{11} & a_{12} \\\\ a_{21} & a_{22} \\end{pmatrix}$$

These are rendered using KaTeX for fast, high-quality math typesetting.`,
  },
  {
    keywords: ['deploy', 'install', 'setup', 'self-host', 'docker'],
    response: `Getting OpenGram running is simple — just one command:

\`\`\`bash
curl -fsSL https://opengram.sh/install | sh
\`\`\`

This will install OpenGram, run the interactive setup wizard, and start the server as a systemd service.

Once running, open the URL shown in your terminal to access the chat interface.

Check out [opengram.sh](https://opengram.sh) for the full documentation!`,
  },
  {
    keywords: ['thank', 'thanks', 'awesome', 'great', 'cool', 'nice', 'love'],
    response: `Glad you're enjoying the demo! Here are some more things you can try:

- **Create a new chat** using the "+" button in the sidebar
- **Search** across all conversations using the search bar
- **Pin or tag** this conversation from the chat header
- **Check out Settings** to see the configuration panel

If you like what you see, head over to [opengram.sh](https://opengram.sh) to set up your own instance. It's free and open source!`,
  },
];

const FALLBACKS = [
  `That's an interesting thought! In a full OpenGram deployment, this is where your AI agent would provide a real, contextual response.

This demo simulates the experience with pre-built replies. Try asking about **code**, **markdown**, **math**, or **deployment** to see more features in action.`,

  `Good question! While this demo uses simulated responses, a real OpenGram instance connects to actual AI models like GPT-4, Claude, or any OpenAI-compatible API.

The interface you're seeing right now is the real deal — the same UI you'd get in production. Pretty cool, right?`,

  `I hear you! Here in the demo, I'm working with a limited set of responses. But the real OpenGram supports:

- **Any AI model** via OpenAI-compatible APIs
- **Custom agents** with different personalities and capabilities
- **Streaming** for real-time response generation
- **Media attachments** — images, audio, files

Want to see something specific? Try "show me code" or "write a poem"!`,

  `That's a great point to explore! In the full version of OpenGram, you'd get a thoughtful, contextual response here.

For the demo, try some of these prompts:
- "What features does OpenGram have?"
- "Show me some markdown"
- "Write a code example"
- "How do I deploy OpenGram?"`,

  `Interesting! While I'm just a demo bot, the real OpenGram experience is much richer. Each agent can be configured with its own personality, model, and capabilities.

Want to explore more? Try creating a new chat from the sidebar or searching through the existing conversations!`,
];

let fallbackIndex = 0;

export function pickResponse(userMessage: string): string {
  const lower = userMessage.toLowerCase();

  for (const entry of RESPONSES) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.response;
    }
  }

  // Rotate through fallbacks
  const response = FALLBACKS[fallbackIndex % FALLBACKS.length];
  fallbackIndex++;
  return response;
}
