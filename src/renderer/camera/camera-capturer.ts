/**
 * Camera Frame Snapshot Responder
 *
 * Listens for one-shot camera capture requests from the main process (invoked by Cyrene's
 * `look_at_master` orchestrator tool).
 *
 * Privacy Guarantees:
 * - Activates camera ONLY when explicitly requested.
 * - Samples a single static JPEG frame.
 * - IMMEDIATELY stops all MediaStreamTracks to turn off the hardware camera LED.
 * - Never streams or records background video.
 */
export function registerCameraCapturer(): void {
  if (typeof window === "undefined" || !window.camera?.onCaptureRequested) return;

  window.camera.onCaptureRequested(async ({ requestId, deviceId }) => {
    let stream: MediaStream | null = null;
    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();

      // Wait a brief moment for camera auto-exposure and white balance
      await new Promise((resolve) => setTimeout(resolve, 250));

      const canvas = document.createElement("canvas");
      const videoW = video.videoWidth || 640;
      const videoH = video.videoHeight || 480;
      canvas.width = Math.min(1024, videoW);
      canvas.height = Math.round(canvas.width * (videoH / videoW));
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

      // Cleanly shutdown camera hardware tracks
      stream.getTracks().forEach((track) => track.stop());
      stream = null;

      window.camera?.sendCapturedFrame({ requestId, ok: true, dataUrl });
    } catch (err: unknown) {
      if (stream) {
        (stream as MediaStream).getTracks().forEach((track) => track.stop());
      }
      const msg = err instanceof Error ? err.message : String(err);
      window.camera?.sendCapturedFrame({ requestId, ok: false, error: msg });
    }
  });
}
