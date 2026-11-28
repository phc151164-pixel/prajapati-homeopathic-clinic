// Model files are downloaded once and cached. Only decoded audio is sent to this local worker.
import {env, pipeline} from '@huggingface/transformers';

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = new URL('/assets/', self.location.href).href;
let transcriber;
self.onmessage = async ({data}) => {
  let stage = 'download';
  try {
    const hindi = data.language === 'hindi';
    const model = hindi ? 'MaybeSomeone19/whisper-tiny-hinglish-onnx' : 'Xenova/whisper-base';
    const revision = hindi ? '3a5b29845725c773eed1f7e04f4dcf69bddc79c4' : '64da57285918e20ea79ea5c88eed7197933abaa8';
    transcriber ??= pipeline('automatic-speech-recognition', model, {device: 'wasm', dtype: 'q8', revision});
    const transcribe = await transcriber;
    stage = 'inference';
    self.postMessage({processing: true});
    const result = await transcribe(data.samples, {
      language: data.language, task: 'transcribe', chunk_length_s: 25, stride_length_s: 4
    });
    self.postMessage({text: result.text.trim()});
  } catch {
    self.postMessage({failed: stage});
  }
};
