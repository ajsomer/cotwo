'use client';

import { useState, useEffect, useRef } from 'react';
import { PersistentHeader } from './persistent-header';
import { Check, X, AlertTriangle } from 'lucide-react';

interface DeviceTestProps {
  clinicName: string;
  logoUrl: string | null;
  roomName: string | null;
  currentStep: number;
  totalSteps: number;
  onComplete: (passed: boolean) => void;
}

type TestStatus = 'pending' | 'testing' | 'pass' | 'fail' | 'warning';

interface TestResult {
  camera: TestStatus;
  microphone: TestStatus;
  connection: TestStatus;
}

export function DeviceTest({
  clinicName,
  logoUrl,
  roomName,
  currentStep,
  totalSteps,
  onComplete,
}: DeviceTestProps) {
  const [results, setResults] = useState<TestResult>({
    camera: 'pending',
    microphone: 'pending',
    connection: 'pending',
  });
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const allDone = results.camera !== 'pending' && results.camera !== 'testing'
    && results.microphone !== 'pending' && results.microphone !== 'testing'
    && results.connection !== 'pending' && results.connection !== 'testing';

  const allPass = results.camera === 'pass' && results.microphone === 'pass' && results.connection === 'pass';
  const hasFailure = results.camera === 'fail' || results.microphone === 'fail' || results.connection === 'fail';

  useEffect(() => {
    runTests();
    return () => {
      videoStream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runTests() {
    // Camera test
    setResults((r) => ({ ...r, camera: 'testing' }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      setVideoStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setResults((r) => ({ ...r, camera: 'pass' }));
    } catch {
      setResults((r) => ({ ...r, camera: 'fail' }));
    }

    // Microphone test — listens until speech detected or 10s timeout
    setResults((r) => ({ ...r, microphone: 'testing' }));
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(audioStream);
      source.connect(analyser);
      analyser.fftSize = 256;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const detected = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          clearInterval(checkInterval);
          resolve(false);
        }, 10_000);

        const checkInterval = setInterval(() => {
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          setAudioLevel(avg / 128);
          if (avg > 5) {
            clearInterval(checkInterval);
            clearTimeout(timeout);
            resolve(true);
          }
        }, 100);
      });

      audioStream.getTracks().forEach((t) => t.stop());
      await audioContext.close();

      setResults((r) => ({
        ...r,
        microphone: detected ? 'pass' : 'warning',
      }));
    } catch {
      setResults((r) => ({ ...r, microphone: 'fail' }));
    }

    // Connection test (simple fetch)
    setResults((r) => ({ ...r, connection: 'testing' }));
    try {
      const start = Date.now();
      await fetch(window.location.href, { method: 'HEAD', cache: 'no-store' });
      const latency = Date.now() - start;

      setResults((r) => ({
        ...r,
        connection: latency < 2000 ? 'pass' : 'warning',
      }));
    } catch {
      setResults((r) => ({ ...r, connection: 'fail' }));
    }
  }

  return (
    <div className="flex flex-col items-center">
      <PersistentHeader
        clinicName={clinicName}
        logoUrl={logoUrl}
        roomName={roomName}
        currentStep={currentStep}
        totalSteps={totalSteps}
      />

      <div className="w-full space-y-4">
        <h1 className="text-xl font-semibold text-gray-800">
          Device check
        </h1>
        <p className="text-sm text-gray-500">
          Let&apos;s make sure your camera and microphone are working.
        </p>

        {/* Camera preview */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-800">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="h-48 w-full object-cover"
          />
        </div>

        {/* Test results */}
        <div className="space-y-2">
          <TestRow label="Camera" status={results.camera} />
          <TestRow label="Microphone" status={results.microphone} audioLevel={audioLevel} />
          <TestRow label="Connection" status={results.connection} />
        </div>

        {hasFailure && (
          <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
            Some checks didn&apos;t pass. You can still continue, but you may
            experience issues during your appointment.
          </div>
        )}

        {allDone && (
          <button
            onClick={() => {
              videoStream?.getTracks().forEach((t) => t.stop());
              onComplete(allPass);
            }}
            className="w-full rounded-lg bg-teal-500 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-teal-600"
          >
            {allPass ? 'Looks good' : 'Continue anyway'}
          </button>
        )}
      </div>
    </div>
  );
}

function TestRow({
  label,
  status,
  audioLevel,
}: {
  label: string;
  status: TestStatus;
  audioLevel?: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <div className="flex items-center gap-2">
        {label === 'Microphone' && status === 'testing' && audioLevel !== undefined && (
          <div className="flex h-4 items-end gap-0.5">
            {[0.2, 0.4, 0.6, 0.8, 1.0].map((threshold, i) => (
              <div
                key={i}
                className={`w-1 rounded-full transition-all ${
                  audioLevel >= threshold ? 'bg-teal-500' : 'bg-gray-200'
                }`}
                style={{ height: `${(i + 1) * 3 + 2}px` }}
              />
            ))}
          </div>
        )}
        <StatusIcon status={status} />
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: TestStatus }) {
  switch (status) {
    case 'pending':
      return <div className="h-5 w-5 rounded-full border-2 border-gray-200" />;
    case 'testing':
      return (
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
      );
    case 'pass':
      return (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500">
          <Check className="h-3 w-3 text-white" />
        </div>
      );
    case 'warning':
      return (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500">
          <AlertTriangle className="h-3 w-3 text-white" />
        </div>
      );
    case 'fail':
      return (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500">
          <X className="h-3 w-3 text-white" />
        </div>
      );
  }
}
