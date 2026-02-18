export default function Home() {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <main className="w-full max-w-xl rounded-2xl border border-border bg-card p-8 shadow-2xl shadow-black/20">
        <p className="text-sm font-medium text-muted-foreground">OpenGram</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-card-foreground">
          Local Development Ready
        </h1>
        <p className="mt-4 text-base text-muted-foreground">
          App Router, Drizzle, Tailwind, and test tooling are configured for local development.
        </p>
      </main>
    </div>
  );
}
