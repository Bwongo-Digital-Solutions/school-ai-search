import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Keyboard, Loader2, ScanLine, X } from 'lucide-react';

/**
 * Reads a student ID card three ways:
 *  - a USB/Bluetooth barcode scanner acting as a keyboard (types the payload, then Enter)
 *  - the device camera, where the browser supports the Barcode Detection API
 *  - typing the student number by hand
 *
 * The raw payload is passed through untouched; the backend normalises URLs, JSON, and bare numbers.
 */

type DetectedBarcode = { rawValue: string };

type BarcodeDetectorInstance = {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
};

type BarcodeDetectorConstructor = {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?: () => Promise<string[]>;
};

const getBarcodeDetector = (): BarcodeDetectorConstructor | null => {
  const detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  return typeof detector === 'function' ? detector : null;
};

const cameraSupported = () =>
  Boolean(getBarcodeDetector()) && Boolean(navigator.mediaDevices?.getUserMedia);

interface StudentIdScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  title?: string;
  hint?: string;
}

const StudentIdScanner: React.FC<StudentIdScannerProps> = ({
  isOpen,
  onClose,
  onScan,
  title = 'Scan Student ID',
  hint = 'Scan the QR code on the card, or type the student number.',
}) => {
  const [manualCode, setManualCode] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);

  const stopCamera = useCallback(() => {
    if (scanTimerRef.current !== null) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const submit = useCallback(
    (code: string) => {
      const value = code.trim();
      if (!value) return;
      stopCamera();
      setManualCode('');
      onScan(value);
    },
    [onScan, stopCamera],
  );

  const startCamera = useCallback(async () => {
    const Detector = getBarcodeDetector();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser cannot scan with the camera. Use a handheld scanner or type the number.');
      return;
    }

    setStarting(true);
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);

      const detector = new Detector({ formats: ['qr_code', 'code_128', 'code_39'] });
      scanTimerRef.current = window.setInterval(async () => {
        const video = videoRef.current;
        if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) return;
        try {
          const results = await detector.detect(video);
          const value = results[0]?.rawValue;
          if (value) submit(value);
        } catch (err) {
          console.error('Barcode detection failed:', err);
        }
      }, 350);
    } catch (err) {
      console.error('Camera start failed:', err);
      setCameraError('Could not open the camera. Check permissions, or type the student number instead.');
      stopCamera();
    }
    setStarting(false);
  }, [stopCamera, submit]);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setManualCode('');
      setCameraError(null);
      return;
    }
    // Keep focus on the input so a keyboard-wedge scanner lands here without a click.
    inputRef.current?.focus();
  }, [isOpen, stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-white flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-indigo-500" />
            {title}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">{hint}</p>

          <form
            onSubmit={event => {
              event.preventDefault();
              submit(manualCode);
            }}
          >
            <label className="text-xs font-medium text-gray-700 dark:text-gray-200 flex items-center gap-1.5 mb-1.5">
              <Keyboard className="w-3.5 h-3.5 text-indigo-500" />
              Student number
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={manualCode}
                onChange={event => setManualCode(event.target.value)}
                placeholder="STU-2026-001"
                autoComplete="off"
                className="flex-1 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
              />
              <button
                type="submit"
                disabled={!manualCode.trim()}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
              >
                Look Up
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5">
              A handheld barcode or QR scanner types into this box and submits automatically.
            </p>
          </form>

          <div className="border-t border-gray-100 dark:border-gray-700 pt-4">
            {cameraOn ? (
              <div className="space-y-2">
                <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
                  <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                  <div className="absolute inset-6 border-2 border-white/70 rounded-lg pointer-events-none" />
                </div>
                <button
                  onClick={stopCamera}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <CameraOff className="w-4 h-4" /> Stop Camera
                </button>
              </div>
            ) : (
              <button
                onClick={startCamera}
                disabled={starting || !cameraSupported()}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                Scan QR with Camera
              </button>
            )}

            {!cameraSupported() && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-2">
                Camera scanning needs a browser with the Barcode Detection API (Chrome or Edge). A handheld
                scanner and manual entry work everywhere.
              </p>
            )}
            {cameraError && <p className="text-[10px] text-red-500 mt-2">{cameraError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentIdScanner;
