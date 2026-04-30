import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, MicOff, Square, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface VoiceRecorderProps {
  onTranscription: (text: string) => void;
  onRecordingStateChange?: (isRecording: boolean) => void;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onTranscription, onRecordingStateChange }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(20).fill(0));
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

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
      alert('Could not access microphone. Please check permissions.');
    }
  }, [onRecordingStateChange]);

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

  const transcribeAudio = async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      // Convert blob to base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      const base64Data = await base64Promise;

      const { data, error } = await supabase.functions.invoke('voice-to-text', {
        body: { audioData: base64Data },
      });

      if (error) throw error;

      if (data?.text) {
        onTranscription(data.text);
      } else if (data?.warning) {
        alert(data.warning);
      } else {
        alert('Could not transcribe audio. Please try again or type your message.');
      }
    } catch (err) {
      console.error('Transcription failed:', err);
      alert('Voice transcription failed. Please try again.');
    } finally {
      setIsTranscribing(false);
    }
  };

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
      <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl">
        <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
        <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Transcribing...</span>
      </div>
    );
  }

  if (isRecording) {
    return (
      <div className="flex items-center gap-3 px-3 py-2 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800">
        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        
        {/* Waveform visualization */}
        <div className="flex items-center gap-[2px] h-6">
          {audioLevels.map((level, i) => (
            <div
              key={i}
              className="w-[3px] bg-red-400 rounded-full transition-all duration-75"
              style={{ height: `${Math.max(4, level * 24)}px` }}
            />
          ))}
        </div>

        <span className="text-xs text-red-600 dark:text-red-400 font-mono font-medium">
          {formatDuration(duration)}
        </span>

        <button
          onClick={stopRecording}
          className="p-1.5 bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
          title="Stop recording"
        >
          <Square className="w-3 h-3 text-white fill-white" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={startRecording}
      className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-all duration-200 hover:scale-105"
      title="Record voice message"
    >
      <Mic className="w-5 h-5" />
    </button>
  );
};

export default VoiceRecorder;
