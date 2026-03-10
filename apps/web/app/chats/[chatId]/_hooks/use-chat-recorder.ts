'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { isMicPermissionDenied } from '@/app/chats/[chatId]/_lib/chat-utils';
import { apiFetch } from '@/src/lib/api-fetch';
import type { MediaItem, Message } from '@/app/chats/[chatId]/_lib/types';
import { upsertFeedMessage } from '@/src/lib/chat';

type UseChatRecorderArgs = {
  getChatId: () => Promise<string | null>;
  setError: (message: string | null) => void;
  setMessages?: Dispatch<SetStateAction<Message[]>>;
  setMedia?: Dispatch<SetStateAction<MediaItem[]>>;
  onVoiceNoteUploaded?: (chatId: string) => void;
};

function extensionFromMime(mime: string): string {
  if (mime.includes('audio/webm')) return '.webm';
  if (mime.includes('audio/ogg')) return '.ogg';
  if (mime.includes('audio/mp4') || mime.includes('audio/x-m4a')) return '.m4a';
  if (mime.includes('audio/mpeg')) return '.mp3';
  if (mime.includes('audio/wav')) return '.wav';
  return '.webm';
}

const AUDIO_LEVEL_BARS = 24;

export function useChatRecorder({ getChatId, setError, setMessages, setMedia, onVoiceNoteUploaded }: UseChatRecorderArgs) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isUploadingVoiceNote, setIsUploadingVoiceNote] = useState(false);
  const [showMicSettingsPrompt, setShowMicSettingsPrompt] = useState(false);
  const [audioLevels, setAudioLevels] = useState<number[]>(() => new Array(AUDIO_LEVEL_BARS).fill(0));

  const recordingTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingSecondsRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const uploadVoiceNote = useCallback(async (blob: Blob) => {
    if (blob.size === 0) {
      setError('Recording was too short. Try again.');
      return;
    }

    const chatId = await getChatId();
    if (!chatId) {
      throw new Error('Chat not available');
    }

    setIsUploadingVoiceNote(true);
    try {
      const ext = extensionFromMime(blob.type);
      const formData = new FormData();
      formData.append('file', blob, `voice-${Date.now()}${ext}`);
      formData.append('kind', 'audio');

      const uploadResponse = await apiFetch(`/api/v1/chats/${chatId}/media`, {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        const errorBody = await uploadResponse.text().catch(() => '');
        throw new Error(`Upload failed (${uploadResponse.status}): ${errorBody || 'Unknown error'}`);
      }

      const uploadedMedia = (await uploadResponse.json()) as MediaItem;

      let messageResponse: Response;
      try {
        messageResponse = await apiFetch(`/api/v1/chats/${chatId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            senderId: 'user:primary',
            trace: { mediaId: uploadedMedia.id, kind: 'audio' },
          }),
        });
      } catch (error) {
        await apiFetch(`/api/v1/media/${uploadedMedia.id}`, { method: 'DELETE' }).catch(() => undefined);
        throw error;
      }

      if (!messageResponse.ok) {
        await apiFetch(`/api/v1/media/${uploadedMedia.id}`, { method: 'DELETE' }).catch(() => undefined);
        const errorBody = await messageResponse.text().catch(() => '');
        throw new Error(`Failed to create voice message (${messageResponse.status}): ${errorBody || 'Unknown error'}`);
      }

      const createdMessage = (await messageResponse.json()) as Message;
      setMessages?.((current) => upsertFeedMessage(current, createdMessage));
      setMedia?.((current) => (current.some((item) => item.id === uploadedMedia.id) ? current : [...current, uploadedMedia]));
      onVoiceNoteUploaded?.(chatId);
    } finally {
      setIsUploadingVoiceNote(false);
    }
  }, [getChatId, setError, setMedia, setMessages, onVoiceNoteUploaded]);

  const stopAudioAnalysis = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevels(new Array(AUDIO_LEVEL_BARS).fill(0));
  }, []);

  const resetRecordingState = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    stopAudioAnalysis();
    recordingChunksRef.current = [];
    mediaRecorderRef.current = null;
    recordingSecondsRef.current = 0;
    cancelledRef.current = false;
    setIsRecording(false);
    setRecordingSeconds(0);

    for (const track of recordingStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    recordingStreamRef.current = null;
  }, [stopAudioAnalysis]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      resetRecordingState();
    }
  }, [resetRecordingState]);

  const startAudioAnalysis = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const update = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        const binCount = dataArray.length;
        const barsPerBin = Math.max(1, Math.floor(binCount / AUDIO_LEVEL_BARS));
        const levels: number[] = [];

        for (let i = 0; i < AUDIO_LEVEL_BARS; i++) {
          const start = Math.min(i * barsPerBin, binCount - 1);
          const end = Math.min(start + barsPerBin, binCount);
          let sum = 0;
          for (let j = start; j < end; j++) {
            sum += dataArray[j];
          }
          levels.push(sum / (end - start) / 255);
        }

        setAudioLevels(levels);
        animFrameRef.current = requestAnimationFrame(update);
      };

      animFrameRef.current = requestAnimationFrame(update);
    } catch {
      // Audio analysis is non-critical, continue recording without it
    }
  }, []);

  const handleMicAction = useCallback(async () => {
    if (isRecording) {
      stopRecording();
      return;
    }

    if (!('mediaDevices' in navigator) || !navigator.mediaDevices.getUserMedia || !('MediaRecorder' in window)) {
      setError('Voice recording is not supported in this browser.');
      return;
    }

    try {
      setError(null);
      setShowMicSettingsPrompt(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordingChunksRef.current = [];
      recordingSecondsRef.current = 0;
      cancelledRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const wasCancelled = cancelledRef.current;
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        resetRecordingState();

        if (wasCancelled) {
          return;
        }

        if (blob.size === 0) {
          setError('Recording was too short. Try again.');
          return;
        }

        void uploadVoiceNote(blob).catch((err) => {
          console.error('Voice note upload failed:', err);
          setError(err instanceof Error ? err.message : 'Failed to upload voice note.');
        });
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      startAudioAnalysis(stream);
      recordingTimerRef.current = window.setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingSeconds(recordingSecondsRef.current);
      }, 1000);
    } catch (micError) {
      resetRecordingState();

      if (!window.isSecureContext) {
        setError('Microphone access requires a secure (HTTPS) connection.');
        return;
      }

      if (isMicPermissionDenied(micError)) {
        setShowMicSettingsPrompt(true);
        return;
      }

      setError('Microphone is unavailable. Check browser permissions and try again.');
    }
  }, [isRecording, resetRecordingState, setError, startAudioAnalysis, stopRecording, uploadVoiceNote]);

  useEffect(() => () => {
    resetRecordingState();
  }, [resetRecordingState]);

  return {
    isRecording,
    recordingSeconds,
    isUploadingVoiceNote,
    showMicSettingsPrompt,
    audioLevels,
    handleMicAction,
    stopRecording,
    cancelRecording,
    resetRecordingState,
  };
}
