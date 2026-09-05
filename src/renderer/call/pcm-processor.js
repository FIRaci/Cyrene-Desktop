// AudioWorklet PCM capturer - captures microphone audio and outputs 16kHz / 16bit / mono PCM frames.
//
// Every 20ms (sampleRate=16000 → 320 samples), postMessage sends an Int16Array buffer.
// Renderer receives it, converts to ArrayBuffer, and forwards to the main process via IPC CALL_AUDIO_FRAME.

class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 16kHz, 20ms = 320 samples per frame
    this._frameSize = 320;
    this._buffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channel = input[0]; // mono
    if (!channel) return true;

    // Accumulate samples
    for (let i = 0; i < channel.length; i++) {
      // Float32 (-1.0~1.0) → Int16 (-32768~32767)
      const s = Math.max(-1, Math.min(1, channel[i]));
      this._buffer.push(s < 0 ? s * 0x8000 : s * 0x7FFF);
    }

    // Send when a full frame is available
    while (this._buffer.length >= this._frameSize) {
      const frame = this._buffer.splice(0, this._frameSize);
      const int16 = new Int16Array(frame);
      // Send ArrayBuffer to main thread
      this.port.postMessage(int16.buffer);
    }

    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
