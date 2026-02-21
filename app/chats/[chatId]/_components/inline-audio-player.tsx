'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

import { formatDuration } from '@/app/chats/[chatId]/_lib/chat-utils';
import type { MediaItem } from '@/app/chats/[chatId]/_lib/types';
import { Slider } from '@/src/components/ui/slider';

export function InlineAudioPlayer({ item }: { item: MediaItem }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const updateTime = () => setCurrentTime(audio.currentTime || 0);
    const updateDuration = () => setDuration(audio.duration || 0);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('durationchange', updateDuration);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    setIsPlaying(!audio.paused);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('durationchange', updateDuration);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
      return;
    }

    audio.pause();
    setIsPlaying(false);
  }, []);

  const handleSeek = useCallback((values: number[]) => {
    const audio = audioRef.current;
    const val = values[0];
    if (!audio || val === undefined) {
      return;
    }

    audio.currentTime = val;
    setCurrentTime(val);
  }, []);

  return (
    <div key={item.id} className="rounded-xl border border-border/70 bg-card/40 p-2.5">
      <audio ref={audioRef} preload="metadata" src={`/api/v1/files/${item.id}`} className="hidden" />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full border border-border bg-muted/50 text-foreground"
          aria-label={isPlaying ? `Pause ${item.filename || 'audio'}` : `Play ${item.filename || 'audio'}`}
          onClick={() => void togglePlayback()}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} className="translate-x-[1px]" />}
        </button>
        <Slider
          min={0}
          max={duration > 0 ? duration : 1}
          step={0.1}
          value={[Math.min(currentTime, duration > 0 ? duration : 1)]}
          onValueChange={handleSeek}
          aria-label={`Progress ${item.filename || item.id}`}
          className="w-full"
        />
        <p className="w-20 shrink-0 text-right text-[11px] text-muted-foreground">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </p>
      </div>
    </div>
  );
}
