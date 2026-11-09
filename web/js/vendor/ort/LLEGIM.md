onnxruntime-web 1.29.0 (https://github.com/microsoft/onnxruntime), © Microsoft Corporation, llicència MIT.
- ort.wasm.min.mjs + ort-wasm-simd-threaded.mjs/.wasm: WASM amb fils (el que es fa servir sempre).
- ort.webgpu.min.mjs + ort-wasm-simd-threaded.asyncify.mjs/.wasm: només amb ?gpu=1 (encoder en WebGPU).
Es serveixen des del mateix origen perquè els fils (workers) no es poden crear des d'un altre domini.
