'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, SwitchCamera } from 'lucide-react';
import { Button } from '@/src/components/ui/button';

type CameraCaptureProps = {
  isOpen: boolean;
  onClose: () => void;
  onCapture: (file: File) => Promise<void>;
};

export function CameraCapture({ isOpen, onClose, onCapture }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const startStream = useCallback(async (facing: 'user' | 'environment') => {
    stopStream();
    setCameraError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setCameraError('Could not access camera. Check your browser permissions.');
    }
  }, [stopStream]);

  useEffect(() => {
    if (isOpen) {
      void startStream(facingMode);
    } else {
      stopStream();
    }

    return () => stopStream();
  }, [isOpen, facingMode, startStream, stopStream]);

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || isCapturing) return;

    setIsCapturing(true);
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.9);
      });

      if (!blob) return;

      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      stopStream();
      onClose();
      await onCapture(file);
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, stopStream, onClose, onCapture]);

  const handleFlip = useCallback(() => {
    setFacingMode((current) => (current === 'user' ? 'environment' : 'user'));
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close camera"
          className="text-white hover:bg-white/10"
          onClick={() => {
            stopStream();
            onClose();
          }}
        >
          <X size={22} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Switch camera"
          className="text-white hover:bg-white/10"
          onClick={handleFlip}
        >
          <SwitchCamera size={22} />
        </Button>
      </div>

      {/* Video feed */}
      <div className="flex flex-1 items-center justify-center overflow-hidden">
        {cameraError ? (
          <p className="px-6 text-center text-sm text-red-300">{cameraError}</p>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />
        )}
      </div>

      {/* Shutter button */}
      <div className="flex items-center justify-center py-8">
        <button
          type="button"
          className="flex size-18 items-center justify-center rounded-full border-4 border-white transition active:scale-90 disabled:opacity-50"
          disabled={isCapturing || Boolean(cameraError)}
          aria-label="Take photo"
          onClick={() => void handleCapture()}
        >
          <div className="size-14 rounded-full bg-white" />
        </button>
      </div>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
