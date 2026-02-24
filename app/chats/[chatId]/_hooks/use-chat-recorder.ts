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

export function useChatRecorder({ getChatId, setError, setMessages, setMedia, onVoiceNoteUploaded }: UseChatRecorderArgs) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isUploadingVoiceNote, setIsUploadingVoiceNote] = useState(false);
  const [showMicSettingsPrompt, setShowMicSettingsPrompt] = useState(false);

  const recordingTimerRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingSecondsRef = useRef(0);

  const uploadVoiceNote = useCallback(async (blob: Blob) => {
    if (blob.size === 0) {
      setError('Recording was too short. Try again.');
      return;
    }

    const chatId = await getChatId();
    if (!chatId) {
      return;
    }

    setIsUploadingVoiceNote(true);
    try {
      const formData = new FormData();
      formData.append('file', blob, `voice-${Date.now()}.webm`);
      formData.append('kind', 'audio');

      const uploadResponse = await apiFetch(`/api/v1/chats/${chatId}/media`, {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload voice note');
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
        throw new Error('Failed to create voice message');
      }

      const createdMessage = (await messageResponse.json()) as Message;
      setMessages?.((current) => upsertFeedMessage(current, createdMessage));
      setMedia?.((current) => (current.some((item) => item.id === uploadedMedia.id) ? current : [...current, uploadedMedia]));
      onVoiceNoteUploaded?.(chatId);
    } finally {
      setIsUploadingVoiceNote(false);
    }
  }, [getChatId, setError, setMedia, setMessages, onVoiceNoteUploaded]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const resetRecordingState = useCallback(() => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    recordingChunksRef.current = [];
    mediaRecorderRef.current = null;
    recordingSecondsRef.current = 0;
    setIsRecording(false);
    setRecordingSeconds(0);

    for (const track of recordingStreamRef.current?.getTracks() ?? []) {
      track.stop();
    }
    recordingStreamRef.current = null;
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

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        resetRecordingState();

        if (blob.size === 0) {
          setError('Recording was too short. Try again.');
          return;
        }

        void uploadVoiceNote(blob).catch(() => {
          setError('Failed to upload voice note.');
        });
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = window.setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingSeconds(recordingSecondsRef.current);
      }, 1000);
    } catch (micError) {
      resetRecordingState();

      if (isMicPermissionDenied(micError)) {
        setShowMicSettingsPrompt(true);
        setError('Microphone permission was denied.');
        return;
      }

      setError('Microphone is unavailable. Check browser permissions and try again.');
    }
  }, [isRecording, resetRecordingState, setError, stopRecording, uploadVoiceNote]);

  useEffect(() => () => {
    resetRecordingState();
  }, [resetRecordingState]);

  return {
    isRecording,
    recordingSeconds,
    isUploadingVoiceNote,
    showMicSettingsPrompt,
    handleMicAction,
    resetRecordingState,
  };
}
