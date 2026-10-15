// Halo Recovery diagnostics and file-writing helpers.
// Device communication stays in the browser and is user-initiated.

// ---- guards on halo.js shared state -------------------------
function pReady() {
  if (typeof sendLua !== 'function' || typeof hTx === 'undefined' || !hTx) {
    if (typeof hSetStatus === 'function') {
      hSetStatus('Connect Halo first (halo.js must be loaded)', 'error');
    }
    return false;
  }
  return true;
}

// Escape a JS string so it is safe inside a Lua double-quoted literal.
// Our generated Lua uses single quotes and no backslashes, so only
// newlines are ever transformed - a chunk boundary can never split an
// escape sequence.
function pLuaEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

// Generic file writer: open -> chunked write -> close (<=180 to stay
// well under the 512 MTU). Reuses halo.js sendLua().
async function writeFile(name, contents) {
  if (!pReady()) return;
  const body = contents.endsWith('\n') ? contents : contents + '\n';
  await sendLua("f = frame.file.open('" + name + "', 'w')");
  for (let i = 0; i < body.length; i += 180) {
    await sendLua('f:write("' + pLuaEscape(body.slice(i, i + 180)) + '")');
  }
  await sendLua("f:close()");
  await delay(120);
}


// Interrupt any running main.lua loop so the REPL will accept our file
// writes. A running dashboard (while-true yield loop) makes Halo ignore
// incoming Lua until it receives a break - this sends that break first.
async function interruptRunningApp() {
  if (typeof haloSignal === 'function' && typeof SIG !== 'undefined') {
    await haloSignal(SIG.brk); // 0x03
    await delay(300);
  }
}


// ============================================================
// DIAGNOSTICS  (exercise one subsystem, observe on the HUD)
// Same contract as Draw Test: break the dashboard loop, push a small
// self-contained .lua, run it. The HUD is the output surface; the browser
// just reports status. These leave their result frame on the panel, so run
// Reset (0x04) or run a dashboard action afterward to bring the dashboard back.
// ============================================================

// soundtest.lua - play a built-in SFXR preset at rising volume to confirm
// the speaker works and judge loudness. sound.play() BLOCKS until each step
// finishes, so the ramp spaces itself; the same seed means the same sound
// getting louder. No audio assets, no streaming, no licensing.
function buildSoundTestLua() {
  return [
    "-- soundtest.lua (Sound Test - written by Halo Recovery)",
    "frame.display.clear(0x000000)",
    "frame.display.set_font(1, 8, 1)",
    "frame.display.text('Sound Test', 12, 30, 0xFFFFFF)",
    "frame.display.text('playing: blip (sfxr synth)', 12, 55, 0x8FB7FF)",
    "frame.display.text('volume rising 5 -> 50', 12, 75, 0xCFCFCF)",
    "frame.display.text('listen for the next ~2s', 12, 95, 0xCFCFCF)",
    "local steps = { 5, 15, 25, 35, 50 }",
    "for i = 1, #steps do",
    "  frame.sound.play('blip', { seed = 42, volume = steps[i], duration_ms = 450 })",
    "end",
    "frame.display.text('Sound Test done - hear it?', 12, 130, 0x00FF00)"
  ].join('\n');
}

// mictest.lua - capture ~4s of mic audio and draw a live level meter on the
// HUD. 8-bit signed PCM keeps the per-sample peak math cheap (one byte per
// sample; we sample every other byte). Nothing is sent to the browser - the
// meter IS the test, and the final peak stays on the panel to read.
function buildMicTestLua() {
  return [
    "-- mictest.lua (Mic Test - written by Halo Recovery)",
    "frame.microphone.start({ encoder = 'pcm', sample_rate = 8000, channels = 1, bit_depth = 8 })",
    "frame.display.set_font(1, 8, 1)",
    "local W = frame.display.width()",
    "local peak_overall = 0",
    "for n = 1, 60 do",
    "  local c = frame.microphone.read(512)",
    "  local pk = 0",
    "  if c then",
    "    for i = 1, #c, 2 do",
    "      local b = string.byte(c, i)",
    "      if b > 127 then b = b - 256 end",
    "      if b < 0 then b = -b end",
    "      if b > pk then pk = b end",
    "    end",
    "  end",
    "  if pk > peak_overall then peak_overall = pk end",
    "  local pct = math.floor(pk * 100 / 127)",
    "  local barw = math.floor(pk * (W - 24) / 127)",
    "  frame.display.clear(0x000000)",
    "  frame.display.text('Mic Test - listening', 12, 30, 0xFFFFFF)",
    "  frame.display.text('level ' .. pct .. '%', 12, 55, 0xCFCFCF)",
    "  frame.display.rect(12, 80, W - 24, 20, 0x555555, false)",
    "  if barw > 0 then frame.display.rect(12, 80, barw, 20, 0x00FF00, true) end",
    "  frame.sleep(0.06)",
    "end",
    "frame.microphone.stop()",
    "frame.display.clear(0x000000)",
    "frame.display.set_font(1, 8, 1)",
    "frame.display.text('Mic Test done', 12, 40, 0x00FF00)",
    "frame.display.text('peak ' .. math.floor(peak_overall * 100 / 127) .. '%', 12, 70, 0xFFFFFF)"
  ].join('\n');
}

// Sound Test: break the loop, write soundtest.lua, run it. play() blocks
// on-device so the ramp runs to completion; we just pace the browser status.
async function haloSoundTest() {
  if (!pReady()) return;
  hSetStatus('Sound Test: playing blip, rising 5 -> 50...', 'info');
  await interruptRunningApp();                 // free the REPL from the dashboard loop
  await writeFile('soundtest.lua', buildSoundTestLua());
  await sendLua("require('soundtest')");       // 0.8.12 re-runs require fresh each call
  await delay(2500);                           // ~ length of the 5-step ramp
  hSetStatus('Sound Test done. Hear it? Press Reset or write a dashboard again to restore the display.', 'success');
}

// Mic Test: break the loop, write mictest.lua, run it. The meter and final
// peak render on the HUD; the browser only reports timing.
async function haloMicTest() {
  if (!pReady()) return;
  hSetStatus('Mic Test: listening ~4s - watch the level meter on the HUD...', 'info');
  await interruptRunningApp();
  await writeFile('mictest.lua', buildMicTestLua());
  await sendLua("require('mictest')");
  await delay(4500);                           // ~4s meter loop + settle
  hSetStatus('Mic Test done. Peak is on the HUD. Press Reset or write a dashboard again to restore the display.', 'success');
}

// ============================================================
// CAMERA TEST  (first inbound path: pull a JPEG OFF the glasses)
// Glasses: capture a 640px JPEG, print text boundaries, stream the bytes
// via bluetooth.send (0x01-marked). Browser: an additive hRx listener
// reassembles the chunks into a Blob and pops it up with a Save button.
// The HUD shows text status only - the panel cannot decode a JPEG.
// ============================================================

// camtest.lua - capture + stream. read(max_length) + the 1-byte send marker
// fills one MTU packet per chunk; read() returns nil when the JPEG is drained.
function buildCameraTestLua() {
  return [
    "-- camtest.lua (Camera Test - written by Halo Recovery)",
    "frame.display.clear(0x000000)",
    "frame.display.set_font(1, 8, 1)",
    "frame.display.text('Camera Test', 12, 30, 0xFFFFFF)",
    "frame.display.text('waking camera...', 12, 55, 0xCFCFCF)",
    "frame.camera.power_save(false)",       // camera boots asleep; wake it first
    "frame.sleep(0.5)",                      // brief settle before capture
    "frame.camera.capture({ resolution = 640, quality = 'MEDIUM' })",
    "frame.display.text('capturing...', 12, 75, 0xCFCFCF)",
    "while not frame.camera.image_ready() do frame.sleep(0.05) end",
    "frame.display.text('sending to browser...', 12, 95, 0xCFCFCF)",
    "print('IMG_START')",                    // plain text boundary (no marker)
    "local sent = 0",
    "local mtu = frame.bluetooth.max_length()",
    "while true do",
    "  local c = frame.camera.read(mtu)",
    "  if c == nil or #c == 0 then break end",
    "  frame.bluetooth.send(c)",             // 0x01-marked data frame
    "  sent = sent + #c",
    "end",
    "print('IMG_END ' .. sent)",
    "frame.camera.power_save(true)",         // put the camera back to sleep
    "frame.display.clear(0x000000)",
    "frame.display.set_font(1, 8, 1)",
    "frame.display.text('Camera Test done', 12, 40, 0x00FF00)",
    "frame.display.text('sent ' .. sent .. ' bytes', 12, 65, 0xFFFFFF)"
  ].join('\n');
}

// ---- inbound reassembly ------------------------------------
// A running capture sets camState; the listener then routes 0x01-marked
// frames to the image buffer and watches for the text boundaries. Idle
// (camState null) it no-ops, leaving normal REPL output to halo.js.
var camState = null;
var camListenerHRx = null;   // which hRx we attached to (re-attach after reconnect)
var camCaptureId = 0;
var camUrl = null;
var camExpiryTimer = null;

function onCameraData(event) {
  if (!camState) return;                        // not capturing - ignore
  var dv = event.target.value;                  // DataView over the notification
  if (!dv || dv.byteLength === 0) return;
  var bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  if (bytes[0] === 0x01) {                       // image data: drop the send marker
    camState.chunks.push(bytes.slice(1));        // slice() copies (buffer is reused)
    camState.bytes += bytes.length - 1;
    return;
  }
  var text = '';
  try { text = new TextDecoder().decode(bytes); } catch (e) { text = ''; }
  if (text.indexOf('IMG_START') !== -1) {        // (re)start the buffer
    camState.chunks = [];
    camState.bytes = 0;
  } else if (text.indexOf('IMG_END') !== -1) {   // done - assemble + show
    camFinalize();
  }
  // any other REPL text during a capture is ignored (still visible in console)
}

function camFinalize() {
  if (!camState) return;
  var out = new Uint8Array(camState.bytes);
  var off = 0;
  for (var i = 0; i < camState.chunks.length; i++) {
    out.set(camState.chunks[i], off);
    off += camState.chunks[i].length;
  }
  camState = null;
  camShowImage(new Blob([out], { type: 'image/jpeg' }), out.length);
}

// Dynamic pop-over - needs nothing in the HTML. Overwrites each run; the
// Blob URL is revoked on close/next-run and auto-closes after 5 minutes.
function camShowImage(blob, nbytes) {
  if (camExpiryTimer) { clearTimeout(camExpiryTimer); camExpiryTimer = null; }
  if (camUrl) { URL.revokeObjectURL(camUrl); }
  camUrl = URL.createObjectURL(blob);

  var ov = document.getElementById('haloCamOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'haloCamOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:20px;';
    document.body.appendChild(ov);
  }
  ov.innerHTML = '';

  var img = document.createElement('img');
  img.src = camUrl;
  img.alt = 'Halo capture';
  img.style.cssText = 'max-width:90vw;max-height:68vh;border:1px solid #333;background:#111;';

  var cap = document.createElement('div');
  cap.textContent = Math.round(nbytes / 1024) + ' KB JPEG from Halo - overwrites next run, auto-closes in 5 min';
  cap.style.cssText = 'color:#bbb;font-size:13px;text-align:center;';

  var row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px;';
  var save = document.createElement('a');
  save.href = camUrl;
  save.download = 'halo-capture-' + Date.now() + '.jpg';
  save.textContent = 'Save image';
  save.style.cssText = 'padding:9px 18px;background:#fff;color:#111;border-radius:8px;text-decoration:none;font-weight:600;';
  var close = document.createElement('button');
  close.textContent = 'Close';
  close.style.cssText = 'padding:9px 18px;background:#222;color:#fff;border:1px solid #666;border-radius:8px;cursor:pointer;';
  close.onclick = camClose;
  row.appendChild(save);
  row.appendChild(close);

  ov.appendChild(img);
  ov.appendChild(cap);
  ov.appendChild(row);

  if (typeof hSetStatus === 'function') {
    hSetStatus('Camera Test done - ' + Math.round(nbytes / 1024) + ' KB received. Save it, then Reset or write a dashboard again to restore the display.', 'success');
  }
  camExpiryTimer = setTimeout(camClose, 5 * 60 * 1000);
}

function camClose() {
  var ov = document.getElementById('haloCamOverlay');
  if (ov) ov.remove();
  if (camUrl) { URL.revokeObjectURL(camUrl); camUrl = null; }
  if (camExpiryTimer) { clearTimeout(camExpiryTimer); camExpiryTimer = null; }
}

// Camera Test: break the loop, write camtest.lua, run it. The glasses stream
// the JPEG back; IMG_END drives completion (no fixed delay), with a 30s
// safety timeout so a stalled capture reports instead of hanging silently.
async function haloCameraTest() {
  if (!pReady()) return;
  // attach (or re-attach after a reconnect) the inbound listener to the live hRx
  if (typeof hRx !== 'undefined' && hRx && camListenerHRx !== hRx) {
    hRx.addEventListener('characteristicvaluechanged', onCameraData);
    camListenerHRx = hRx;
  }
  var myId = ++camCaptureId;
  camState = { chunks: [], bytes: 0 };          // listener is now live
  hSetStatus('Camera Test: capturing and streaming the JPEG (a few seconds)...', 'info');
  await interruptRunningApp();                   // free the REPL from the dashboard loop
  await writeFile('camtest.lua', buildCameraTestLua());
  await sendLua("require('camtest')");           // capture + stream; IMG_END finalizes
  setTimeout(function () {
    if (camState && myId === camCaptureId) {
      camState = null;
      hSetStatus('Camera Test: no complete image in 30s (timeout). Open DevTools console to see what the glasses sent.', 'error');
    }
  }, 30000);
}


(function wireDiagnostics() {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  bind('haloSoundTest', haloSoundTest);
  bind('haloMicTest', haloMicTest);
  bind('haloCameraTest', haloCameraTest);
})();
