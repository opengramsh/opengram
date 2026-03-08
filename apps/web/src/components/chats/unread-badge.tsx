import { Badge } from '@/src/components/ui/badge';
import { cn } from '@/src/lib/utils';

type UnreadBadgeProps = {
  count: number;
  className?: string;
};

export function UnreadBadge({ count, className }: UnreadBadgeProps) {
  if (count > 1) {
    return <Badge className={cn('text-[10px]', className)}>{count}</Badge>;
  }

  if (count === 1) {
    return <span className={cn('h-2.5 w-2.5 rounded-full bg-primary', className)} />;
  }

  return null;
}
