import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button, InlineLoading } from '@carbon/react';
import { Microphone, StopFilled } from '@carbon/react/icons';
import { supabase } from '@/lib/supabase';
import styles from './composer-widgets.module.scss';
import { useNotifications } from '@/contexts/NotificationContext';

interface VoiceRecorderProps {
  onTranscription: (text: string) => void;
  onRecordingStateChange?: (isRecording: boolean) => void;
}

type VoiceToTextResponse = {
  text?: string;
  warning?: string;
};

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onTranscription, onRecordingStateChange }) => {
  const { notify } = useNotifications();
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(20).fill(0));
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const transcribeAudio = useCallback(async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      // Convert blob to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      const base64Data = await base64Promise;

      const { data, error } = await supabase.functions.invoke<VoiceToTextResponse>('voice-to-text', {
        body: { audioData: base64Data },
      });

      if (error) throw error;

      if (data?.text) {
        onTranscription(data.text);
      } else if (data?.warning) {
        notify.warning('Transcription', data.warning);
      } else {
        notify.error('Could not transcribe that', 'Try again, or type your question instead.');
      }
    } catch (err) {
      console.error('Transcription failed:', err);
      notify.error('Voice transcription failed', 'Try again, or type your question instead.');
    } finally {
      setIsTranscribing(false);
    }
  }, [onTranscription]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Set up audio analysis for visualization
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        audioContext.close();
        
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        await transcribeAudio(blob);
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setDuration(0);
      onRecordingStateChange?.(true);

      // Start timer
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

      // Start visualization
      const updateLevels = () => {
        if (analyserRef.current) {
          const data = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(data);
          const levels = Array.from(data).slice(0, 20).map(v => v / 255);
          setAudioLevels(levels);
        }
        animFrameRef.current = requestAnimationFrame(updateLevels);
      };
      updateLevels();

    } catch (err) {
      console.error('Failed to start recording:', err);
      notify.error('No access to the microphone', 'Check the browser permissions for this site.');
    }
  }, [onRecordingStateChange, transcribeAudio]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      onRecordingStateChange?.(false);
      
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setAudioLevels(new Array(20).fill(0));
    }
  }, [isRecording, onRecordingStateChange]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (isTranscribing) {
    return (
      <div className={styles.transcribing}>
        <InlineLoading description="Transcribing…" />
      </div>
    );
  }

  if (isRecording) {
    return (
      <div className={styles.recording}>
        <span className={styles.recordingDot} />

        {/* A live level meter rather than a number: the question while recording is "is it hearing
            me", and a moving bar answers that without being read. */}
        <span className={styles.levels} aria-hidden="true">
          {audioLevels.map((level, i) => (
            <span
              key={i}
              className={styles.level}
              style={{ height: `${Math.max(4, level * 24)}px` }}
            />
          ))}
        </span>

        <span className={styles.duration}>{formatDuration(duration)}</span>

        <Button
          hasIconOnly
          kind="danger"
          size="sm"
          renderIcon={StopFilled}
          iconDescription="Stop recording"
          tooltipPosition="top"
          onClick={stopRecording}
        />
      </div>
    );
  }

  return (
    <Button
      hasIconOnly
      kind="ghost"
      size="md"
      renderIcon={Microphone}
      iconDescription="Record a spoken question"
      tooltipPosition="top"
      onClick={startRecording}
    />
  );
};

export default VoiceRecorder;
