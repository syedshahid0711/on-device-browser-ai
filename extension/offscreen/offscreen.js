import { pipeline, env } from './transformers.js';

// Prevent local model fetching to strictly use CDN for weights
env.allowLocalModels = false;

let detector = null;
let isInitializing = false;

async function initModel() {
  if (detector) return detector;
  if (isInitializing) {
    return new Promise(resolve => {
      const check = setInterval(() => {
        if (detector) {
          clearInterval(check);
          resolve(detector);
        }
      }, 100);
    });
  }

  isInitializing = true;
  console.log('Model Loading...');
  
  try {
    detector = await pipeline('object-detection', 'Xenova/yolos-tiny', {
      device: 'webgpu'
    });
    console.log('WebGPU Initialized');
  } catch (err) {
    console.warn('WebGPU failed or unavailable. Falling back to WASM.', err);
    detector = await pipeline('object-detection', 'Xenova/yolos-tiny', {
      device: 'wasm'
    });
    console.log('WASM Initialized successfully for YOLOS-tiny');
  }
  
  return detector;
}

// Pre-initialize model in background when document is created
initModel();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen' && msg.type === 'DETECT_VISUAL_PII') {
    handleVisualRedaction(msg)
      .then(result => sendResponse({ ok: true, data: result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // Indicates async response
  }
});

async function handleVisualRedaction({ imageSource, domRects }) {
  const model = await initModel();
  
  // Load image into an Image object
  const img = new Image();
  img.src = imageSource;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  const t0 = performance.now();
  
  // Run inference
  const output = await model(imageSource, { threshold: 0.8 });
  
  const latency = performance.now() - t0;
  console.log(`Inference Latency: ${Math.round(latency)} ms`);

  // We look for sensitive visual classes. 'person' identifies faces/bodies in YOLOS.
  const sensitiveClasses = ['person'];
  const sensitiveBoxes = output.filter(box => sensitiveClasses.includes(box.label));

  // Draw redactions on canvas
  const canvas = document.getElementById('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  
  // Draw original image
  ctx.drawImage(img, 0, 0);
  
  // Draw black redaction boxes over sensitive areas
  ctx.fillStyle = '#000000';
  sensitiveBoxes.forEach(box => {
    const x = box.box.xmin;
    const y = box.box.ymin;
    const width = box.box.xmax - x;
    const height = box.box.ymax - y;
    ctx.fillRect(x, y, width, height);
  });

  // Draw black redaction boxes over DOM coordinates passed from content script
  if (domRects && Array.isArray(domRects)) {
    domRects.forEach(rect => {
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    });
  }

  console.log("Redaction Complete");

  return {
    redactedImage: canvas.toDataURL('image/jpeg', 0.9),
    boundingBoxes: sensitiveBoxes
  };
}
