import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Modal, TextInput } from '@carbon/react';
import { Video, VideoOff } from '@carbon/react/icons';
import styles from './student-id-scanner.module.scss';

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
    <Modal
      open
      passiveModal
      modalHeading={title}
      onRequestClose={onClose}
      size="sm"
    >
      <div className={styles.body}>
        <p className={styles.hint}>{hint}</p>

        <form
          onSubmit={event => {
            event.preventDefault();
            if (manualCode.trim()) onScan(manualCode.trim());
          }}
        >
          <div className={styles.lookupRow}>
            <TextInput
              ref={inputRef}
              id="student-code"
              labelText="Student number"
              size="md"
              value={manualCode}
              onChange={event => setManualCode(event.target.value)}
              placeholder="STU-2026-001"
              autoComplete="off"
            />
            <Button kind="primary" size="md" type="submit" disabled={!manualCode.trim()}>
              Look up
            </Button>
          </div>
          <p className={styles.note}>
            A handheld barcode or QR scanner types into this box and submits automatically.
          </p>
        </form>

        <div className={styles.camera}>
          {cameraOn ? (
            <>
              <div className={styles.viewport}>
                <video ref={videoRef} className={styles.video} muted playsInline />
                <div className={styles.reticle} />
              </div>
              <Button kind="tertiary" size="md" renderIcon={VideoOff} onClick={stopCamera}>
                Stop the camera
              </Button>
            </>
          ) : (
            <Button
              kind="tertiary"
              size="md"
              renderIcon={Video}
              onClick={startCamera}
              disabled={starting || !cameraSupported()}
            >
              {starting ? 'Starting the camera…' : 'Scan the QR code with the camera'}
            </Button>
          )}

          {!cameraSupported() && (
            <p className={styles.warn}>
              Camera scanning needs a browser with the Barcode Detection API (Chrome or Edge). A
              handheld scanner and typing the number work everywhere.
            </p>
          )}
          {cameraError && <p className={styles.failure}>{cameraError}</p>}
        </div>
      </div>
    </Modal>
  );
};

export default StudentIdScanner;
