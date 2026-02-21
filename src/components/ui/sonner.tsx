
import { Toaster as Sonner } from 'sonner';

export function Toaster() {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      toastOptions={{
        className:
          'bg-card text-foreground border-border',
        actionButtonStyle: {
          backgroundColor: 'hsl(203 90% 60%)',
          color: 'hsl(222 47% 11%)',
          fontWeight: 600,
        },
      }}
    />
  );
}
