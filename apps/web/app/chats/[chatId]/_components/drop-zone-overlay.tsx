import { Upload } from 'lucide-react';

export function DropZoneOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/50 px-12 py-10">
        <Upload className="size-10 text-primary/70" />
        <p className="text-sm font-medium text-muted-foreground">Drop files to upload</p>
      </div>
    </div>
  );
}
