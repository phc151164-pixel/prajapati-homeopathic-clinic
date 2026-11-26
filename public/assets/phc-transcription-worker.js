// Model files are downloaded once and cached. Only decoded audio is sent to this local worker.
import {env, pipeline} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/';
let transcriber;
self.onmessage = async ({data}) => {
  try {
    transcriber ??= pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
      device: 'wasm', dtype: 'q8', revision: '64da57285918e20ea79ea5c88eed7197933abaa8'
    });
    const transcribe = await transcriber;
    self.postMessage({processing: true});
    const result = await transcribe(data.samples, {
      language: data.language, task: 'transcribe', chunk_length_s: 25, stride_length_s: 4
    });
    self.postMessage({text: result.text.trim()});
  } catch {
    self.postMessage({failed: true});
  }
};
