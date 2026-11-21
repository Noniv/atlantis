// startup report: when the page can't start, "Save a report" downloads a text file of what the browser offers
// (its versions, every WebGPU adapter it hands out, the GPU WebGL runs on) and the errors logged so far, for whoever
// helps. It runs first, so the button works whatever fails later; nothing here runs per frame.
{
  const logged = [], note = (s) => { if (logged.length < 40) logged.push(String(s).slice(0, 1500)); };
  const ce = console.error;
  console.error = (...a) => { note(a.join(' ')); ce.apply(console, a); };
  addEventListener('error', (e) => note('uncaught: ' + e.message));
  addEventListener('unhandledrejection', (e) => note('unhandled: ' + (e.reason?.message || e.reason)));

  // one requestAdapter call, and whether that adapter gives a device
  const probe = async (name, o) => {
    try {
      const a = await navigator.gpu.requestAdapter(o);
      if (!a) return `${name}: no adapter`;
      const i = a.info || {}, l = a.limits;
      let s = `${name}: ${i.vendor} | ${i.architecture} | ${i.device} | ${i.description}${i.isFallbackAdapter ? ' | SOFTWARE FALLBACK' : ''}${a.featureLevel ? ' | ' + a.featureLevel : ''}` +
        `\n  features: ${[...a.features].sort().join(' ')}` +
        `\n  limits: maxBufferSize ${l.maxBufferSize}, maxStorageBufferBindingSize ${l.maxStorageBufferBindingSize}, maxTextureDimension2D ${l.maxTextureDimension2D}, maxStorageBuffersPerShaderStage ${l.maxStorageBuffersPerShaderStage}, maxColorAttachmentBytesPerSample ${l.maxColorAttachmentBytesPerSample}`;
      try { const d = await a.requestDevice(); s += '\n  device: ok'; d.destroy(); } catch (e) { s += '\n  device: ' + e.message; }
      return s;
    } catch (e) { return `${name}: error ${e.message}`; }
  };

  const report = async () => {
    const n = navigator, out = [`Atlantis startup report, ${new Date().toISOString()}`, '', window.__stk || 'Error: ' + (window.__err || 'none')];
    out.push('Browser: ' + n.userAgent);
    try {
      const h = await n.userAgentData?.getHighEntropyValues(['fullVersionList', 'platformVersion', 'architecture', 'bitness']);
      if (h) out.push(`  ${h.fullVersionList.map((b) => b.brand + ' ' + b.version).join(', ')} | ${h.platform} ${h.platformVersion} | ${h.architecture} ${h.bitness}-bit`);
    } catch {}
    out.push(`Page: ${location.protocol} ${location.search || '(no query)'} | secure context ${isSecureContext}`);
    out.push(`Device: ${n.hardwareConcurrency} threads, ${n.deviceMemory ?? '?'} GB, screen ${screen.width}x${screen.height} @ ${devicePixelRatio}, touch ${matchMedia('(pointer:coarse)').matches}`);
    try { out.push('Stored: ' + (Object.keys(localStorage).filter((k) => k.startsWith('atlantis')).map((k) => `${k}=${localStorage[k]}`).join(', ') || 'nothing')); } catch { out.push('Stored: storage blocked'); }

    // the GPU WebGL runs on: a software renderer here (SwiftShader, Basic Render Driver) means hardware acceleration is off
    try {
      const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) out.push('WebGL: none');
      else {
        const x = gl.getExtension('WEBGL_debug_renderer_info');
        out.push(`WebGL: ${gl.getParameter(gl.VERSION)} | ${x ? gl.getParameter(x.UNMASKED_VENDOR_WEBGL) + ' | ' + gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    } catch (e) { out.push('WebGL: error ' + e.message); }

    out.push('', 'WebGPU: ' + (n.gpu ? `present, canvas format ${n.gpu.getPreferredCanvasFormat()}, WGSL ${[...(n.gpu.wgslLanguageFeatures || [])].join(' ') || '-'}` : 'not in this browser'));
    if (n.gpu) for (const [name, o] of [['high-performance', { powerPreference: 'high-performance' }], ['default', {}], ['low-power', { powerPreference: 'low-power' }],
      ['compatibility', { featureLevel: 'compatibility' }], ['software fallback', { forceFallbackAdapter: true }]]) out.push(await probe(name, o));

    out.push('', 'Console errors:', ...(logged.length ? logged : ['none']));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out.join('\n') + '\n'], { type: 'text/plain' }));
    a.download = 'atlantis-report.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1e4);
  };
  const btn = document.getElementById('x');
  btn.onclick = async () => { btn.disabled = true; btn.textContent = 'Saving…'; try { await report(); } finally { btn.disabled = false; btn.textContent = 'Save a report'; } };
}
