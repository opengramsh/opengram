import { useCallback, useEffect, useRef, useState } from 'react';

interface UseFileDropOptions {
  onDrop: (files: FileList) => void;
  disabled?: boolean;
}

export function useFileDrop({ onDrop, disabled }: UseFileDropOptions) {
  const dropRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (disabled) return;
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragCounter.current++;
      if (dragCounter.current === 1) setIsDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      if (disabled) return;
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    },
    [disabled],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDragging(false);
      if (disabled) return;
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        onDrop(e.dataTransfer.files);
      }
    },
    [disabled, onDrop],
  );

  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;

    el.addEventListener('dragenter', handleDragEnter);
    el.addEventListener('dragleave', handleDragLeave);
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('drop', handleDrop);

    return () => {
      el.removeEventListener('dragenter', handleDragEnter);
      el.removeEventListener('dragleave', handleDragLeave);
      el.removeEventListener('dragover', handleDragOver);
      el.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  return { dropRef, isDragging };
}
