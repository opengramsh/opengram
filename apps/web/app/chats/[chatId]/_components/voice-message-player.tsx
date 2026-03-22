'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

import { buildFileUrl } from '@/src/lib/api-fetch';
import { formatDuration } from '@/app/chats/[chatId]/_lib/chat-utils';
import type { MediaItem, Message } from '@/app/chats/[chatId]/_lib/types';

const BAR_COUNT = 32;

/** Generate deterministic pseudo-random bar heights from a mediaId hash. */
function generateBarHeights(mediaId: string): number[] {
  let hash = 0;
  for (let i = 0; i < mediaId.length; i++) {
    hash = ((hash << 5) - hash + mediaId.charCodeAt(i)) | 0;
  }

  const heights: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    // Simple LCG-style PRNG seeded from hash
    hash = (hash * 1103515245 + 12345) | 0;
    const val = ((hash >>> 16) & 0x7fff) / 0x7fff;
    // Bias towards mid-range for a natural look
    heights.push(0.15 + val * 0.85);
  }
  return heights;
}

type VoiceMessagePlayerProps = {
  item: MediaItem;
  role: Message['role'];
};

export function VoiceMessagePlayer({ item, role }: VoiceMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const barHeights = useMemo(() => generateBarHeights(item.id), [item.id]);
  const isUser = role === 'user';

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime || 0);
    const updateDuration = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    // WebM/Ogg often lack duration in metadata. Force the browser to resolve
    // it by seeking to the end, then reset to the start.
    let durationProbed = false;
    const probeDuration = () => {
      if (durationProbed) return;
      if (!Number.isFinite(audio.duration) || audio.duration === 0) {
        durationProbed = true;
        audio.currentTime = 1e10; // seek to "end"
      }
    };
    const onSeeked = () => {
      if (durationProbed) {
        updateDuration();
        audio.currentTime = 0;
        durationProbed = false;
      }
    };

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('durationchange', updateDuration);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', probeDuration);
    audio.addEventListener('seeked', onSeeked);
    setIsPlaying(!audio.paused);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('durationchange', updateDuration);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', probeDuration);
      audio.removeEventListener('seeked', onSeeked);
    };
  }, []);

  const togglePlayback = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setIsPlaying(false);
      }
    } else {
      audio.pause();
    }
  }, []);

  const handleWaveformClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const container = waveformRef.current;
    if (!audio || !container || !duration) return;

    const rect = container.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  }, [duration]);

  const progress = duration > 0 ? currentTime / duration : 0;
  const displayTime = isPlaying || currentTime > 0 ? currentTime : duration;

  return (
    <div className="flex items-center gap-2.5">
      <audio ref={audioRef} preload="auto" src={buildFileUrl(item.id)} className="hidden" />

      {/* Play/Pause button */}
      <button
        type="button"
        className={`grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full ${
          isUser
            ? 'bg-white/20 text-primary-foreground'
            : 'bg-muted/80 text-foreground border border-border/70'
        }`}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        onClick={() => void togglePlayback()}
      >
        {isPlaying ? <Pause size={15} /> : <Play size={15} className="translate-x-[1px]" />}
      </button>

      {/* Waveform bars */}
      <div
        ref={waveformRef}
        className="flex cursor-pointer items-center gap-[1.5px] h-8"
        onClick={handleWaveformClick}
        role="slider"
        aria-label="Seek audio"
        aria-valuemin={0}
        aria-valuemax={duration || 0}
        aria-valuenow={currentTime}
        tabIndex={0}
      >
        {barHeights.map((height, i) => {
          const barProgress = i / BAR_COUNT;
          const isPlayed = barProgress < progress;

          return (
            <div
              key={i}
              className={`w-[2.5px] rounded-full transition-colors duration-100 ${
                isPlayed
                  ? isUser
                    ? 'bg-primary-foreground'
                    : 'bg-foreground'
                  : isUser
                    ? 'bg-primary-foreground/35'
                    : 'bg-muted-foreground/35'
              }`}
              style={{ height: `${Math.max(3, height * 28)}px` }}
            />
          );
        })}
      </div>

      {/* Duration / elapsed */}
      <span className={`shrink-0 text-[11px] tabular-nums ${isUser ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
        {formatDuration(displayTime)}
      </span>
    </div>
  );
}
