// Halo Recovery — browser-based recovery and diagnostics for Brilliant Labs Halo.
// Lua is sent only after an explicit user action.

// HALO BLE UUIDs
// ============================================================

const HALO_SERVICE_UUID =
  '7a230001-5475-a6a4-654c-8431f6ad49c4';

const HALO_TX_CHAR_UUID =
  '7a230002-5475-a6a4-654c-8431f6ad49c4';

const HALO_RX_CHAR_UUID =
  '7a230003-5475-a6a4-654c-8431f6ad49c4';

const HALO_AUDIO_TX_UUID =
  '7a230005-5475-a6a4-654c-8431f6ad49c4';


// ============================================================
// CONTROL SIGNALS
//
// These are bare bytes written directly to LUA TX.
// ============================================================

const SIG = {
  reboot:     0x02,
  brk:        0x03,
  reset:      0x04,
  removeMain: 0x05,
  exit:       0x06,
  wipeFiles:  0x07
};


// ============================================================
// STATE
// ============================================================

let hDev = null;
let hSrv = null;
let hTx = null;
let hRx = null;
let hConnected = false;


// ============================================================
// DOM
// ============================================================

const hStatusEl = document.getElementById('haloStatus');


// ============================================================
// BASIC HELPERS
// ============================================================

function hSetStatus(msg, type = 'info') {
  if (!hStatusEl) return;

  hStatusEl.textContent = msg;
  hStatusEl.className = 'status ' + type;
}


function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


// ============================================================
// RX DIAGNOSTICS
//
// If Halo sends anything back over LUA RX, show it in the
// browser console. This is deliberately passive.
// ============================================================

function onHaloData(event) {
  try {
    const value = event.target.value;
    const text = new TextDecoder().decode(value);

    console.log(
      'HALO RX >>>',
      JSON.stringify(text)
    );
  } catch (err) {
    console.warn('HALO RX decode error:', err);
  }
}


// ============================================================
// DISCONNECT
// ============================================================

function onHaloDisconnected() {
  hConnected = false;

  hDev = null;
  hSrv = null;
  hTx = null;
  hRx = null;

  hSetStatus('Halo disconnected', 'error');

  updateHaloButtons();
}


// ============================================================
// CONNECT
//
// Connect only.
// DO NOT send Lua here.
// DO NOT reset here.
// DO NOT reboot here.
//
// This is intentional because automatically pushing Lua on
// connection was part of the earlier looping-device problem.
// ============================================================

async function haloConnect() {

  if (!navigator.bluetooth) {
    hSetStatus(
      'WebBluetooth not supported (needs Chrome/Edge on desktop or Android)',
      'error'
    );
    return;
  }

  try {

    hSetStatus('Scanning for Halo...', 'info');

    // First try the known Halo name prefix.
    try {

      hDev = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'Halo' }
        ],
        optionalServices: [
          HALO_SERVICE_UUID
        ]
      });

    } catch (filterErr) {

      // If no Halo name is found, allow a broad device selection.
      // This is useful during diagnosis.
      if (filterErr && filterErr.name === 'NotFoundError') {

        hSetStatus(
          'No "Halo" name match - showing all devices...',
          'info'
        );

        hDev = await navigator.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: [
            HALO_SERVICE_UUID
          ]
        });

      } else {
        throw filterErr;
      }
    }


    // Avoid accumulating disconnect listeners if reconnecting.
    hDev.removeEventListener(
      'gattserverdisconnected',
      onHaloDisconnected
    );

    hDev.addEventListener(
      'gattserverdisconnected',
      onHaloDisconnected
    );


    hSetStatus('Connecting to Halo...', 'info');

    hSrv = await hDev.gatt.connect();

    await delay(500);


    // Get the Lua service.
    const svc =
      await hSrv.getPrimaryService(HALO_SERVICE_UUID);


    // Get Lua TX/RX characteristics.
    hTx =
      await svc.getCharacteristic(HALO_TX_CHAR_UUID);

    hRx =
      await svc.getCharacteristic(HALO_RX_CHAR_UUID);


    console.log(
      'HALO TX characteristic:',
      hTx.uuid
    );

    console.log(
      'HALO RX characteristic:',
      hRx.uuid
    );


    // Confirm this is actually a Halo by looking for its
    // additional audio TX characteristic.
    let isHalo = false;

    try {

      await svc.getCharacteristic(
        HALO_AUDIO_TX_UUID
      );

      isHalo = true;

    } catch {
      isHalo = false;
    }


    // Subscribe to RX exactly once.
    hRx.removeEventListener(
      'characteristicvaluechanged',
      onHaloData
    );

    hRx.addEventListener(
      'characteristicvaluechanged',
      onHaloData
    );

    await hRx.startNotifications();

    console.log(
      'HALO RX notifications started'
    );


    hConnected = true;

    hSetStatus(
      isHalo
        ? 'Halo connected - ready'
        : 'Connected, but no Halo audio characteristic found',
      isHalo ? 'success' : 'info'
    );

    updateHaloButtons();


  } catch (err) {

    console.error(
      'Halo connection failed:',
      err
    );

    hSetStatus(
      'Connection failed: ' +
      (err && err.message
        ? err.message
        : String(err)),
      'error'
    );
  }
}


// ============================================================
// SEND ONE CONTROL BYTE
//
// This is the recovery mechanism.
//
// IMPORTANT:
//   No 0x01 prefix.
//   No UTF-8 encoding.
//   Exactly one byte.
// ============================================================

async function haloSignal(byte) {

  if (!hTx) {
    hSetStatus(
      'Connect Halo first',
      'error'
    );
    return false;
  }

  try {

    console.log(
      'HALO CONTROL >>> 0x' +
      byte.toString(16).padStart(2, '0')
    );

    await hTx.writeValueWithoutResponse(
      new Uint8Array([byte])
    );

    await delay(200);

    return true;

  } catch (err) {

    console.error(
      'Halo control signal failed:',
      err
    );

    hSetStatus(
      'Signal failed: ' +
      (err && err.message
        ? err.message
        : String(err)),
      'error'
    );

    return false;
  }
}


// ============================================================
// RECOVER
//
// Break -> reset
// ============================================================

async function haloRecover() {

  if (!hTx) {
    hSetStatus(
      'Connect Halo first',
      'error'
    );
    return;
  }

  try {

    hSetStatus(
      'Recovering: break -> reset...',
      'info'
    );

    if (!await haloSignal(SIG.brk)) {
      throw new Error('Break signal failed; reset was skipped.');
    }

    await delay(300);

    if (!await haloSignal(SIG.reset)) {
      throw new Error('Reset signal failed.');
    }

    hSetStatus(
      'Recovery sent (break -> reset)',
      'success'
    );

  } catch (err) {

    console.error(err);

    hSetStatus(
      'Recovery failed: ' +
      (err.message || String(err)),
      'error'
    );
  }
}


// ============================================================
// REMOVE main.lua
//
// Break -> remove main.lua
// ============================================================

async function haloRemoveMain() {

  if (!hTx) {
    hSetStatus(
      'Connect Halo first',
      'error'
    );
    return;
  }

  const confirmed = confirm(
    'Reset Halo and remove main.lua? ' +
    '(device apps you saved will be deleted)'
  );

  if (!confirmed) return;

  try {

    hSetStatus(
      'Removing main.lua...',
      'info'
    );

    if (!await haloSignal(SIG.brk)) {
      throw new Error('Break signal failed; removal was skipped.');
    }

    await delay(300);

    if (!await haloSignal(SIG.removeMain)) {
      throw new Error('Remove main.lua signal failed.');
    }

    hSetStatus(
      'Sent break -> remove main.lua',
      'success'
    );

  } catch (err) {

    console.error(err);

    hSetStatus(
      'Remove failed: ' +
      (err.message || String(err)),
      'error'
    );
  }
}


// ============================================================
// WIPE FILES
//
// Last resort.
// Settings are preserved.
// ============================================================

async function haloWipe() {

  if (!hTx) {
    hSetStatus(
      'Connect Halo first',
      'error'
    );
    return;
  }

  const confirmed = confirm(
    'Remove ALL files/folders on Halo? ' +
    'Settings are preserved, but everything else is deleted.'
  );

  if (!confirmed) return;

  try {

    hSetStatus(
      'Wiping Halo files...',
      'info'
    );

    if (!await haloSignal(SIG.brk)) {
      throw new Error('Break signal failed; wipe was skipped.');
    }

    await delay(300);

    if (!await haloSignal(SIG.wipeFiles)) {
      throw new Error('Wipe signal failed.');
    }

    hSetStatus(
      'Wipe command sent (settings kept)',
      'success'
    );

  } catch (err) {

    console.error(err);

    hSetStatus(
      'Wipe failed: ' +
      (err.message || String(err)),
      'error'
    );
  }
}


// ============================================================
// LUA SENDER
//
// Sends raw UTF-8 Lua text followed by newline.
//
// This is ONLY called by explicit buttons.
// A true result means the browser BLE write completed; it does not confirm
// that Halo executed the command or persisted the file.
// ============================================================

async function sendLua(line) {

  if (!hTx) {
    hSetStatus(
      'Connect Halo first',
      'error'
    );
    return false;
  }

  try {

    console.log(
      'HALO LUA >>>',
      line
    );

    const bytes =
      new TextEncoder().encode(
        line + '\n'
      );

    await hTx.writeValueWithoutResponse(
      bytes
    );

    await delay(80);

    return true;

  } catch (err) {

    console.error(
      'Lua send failed:',
      err
    );

    hSetStatus(
      'Lua send failed: ' +
      (err.message || String(err)),
      'error'
    );

    return false;
  }
}


// ============================================================
// LUA STRING ESCAPE
// ============================================================

function luaEscape(s) {

  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}


// ============================================================
// RECOVERY HUD
//
// This remains the existing transient test surface.
// ============================================================

function buildRecoveryLines(name) {

  const safe =
    String(name).replace(/'/g, '');

  return [

    "frame.display.clear(0x000000)",

    "frame.display.set_font(1, 16, 1)",

    "frame.display.text('" +
      safe +
      "', 20, 40, 0xFFFFFF)",

    "frame.display.text(" +
      "'Batt '..frame.battery_level().." +
      "'%  '..frame.battery_voltage().." +
      "'mV', 20, 80, 0x00FF00)",

    "frame.display.text(" +
      "'reset OK', 20, 120, 0x00FF00)"

  ];
}


// ============================================================
// DRAW TEST
//
// Sends display commands live.
// Does NOT write main.lua.
// ============================================================

async function haloDrawTest() {

  if (!hTx) {
    hSetStatus(
      'Connect Halo first',
      'error'
    );
    return;
  }

  const name =
    (hDev && hDev.name)
      ? hDev.name
      : 'Halo';

  try {

    hSetStatus(
      'Drawing test HUD on ' +
      name +
      '...',
      'info'
    );


    for (const line of buildRecoveryLines(name)) {

      const ok =
        await sendLua(line);

      if (!ok) {
        throw new Error(
          'Lua command failed'
        );
      }
    }


    await sendLua(
      "frame.sound.play_async(" +
      "'powerup', {volume=20})"
    );


    hSetStatus(
      'Draw test sent (transient)',
      'success'
    );

  } catch (err) {

    console.error(err);

    hSetStatus(
      'Draw test failed: ' +
      (err.message || String(err)),
      'error'
    );
  }
}


// ============================================================
// WRITE RECOVERY main.lua
//
// This is the existing persistent recovery HUD.
// ============================================================

async function haloWriteRecoveryMain() {

  if (!hTx) {
    hSetStatus(
      'Connect Halo first',
      'error'
    );
    return;
  }

  const name =
    (hDev && hDev.name)
      ? hDev.name
      : 'Halo';


  const confirmed = confirm(
    'Write a recovery HUD to main.lua on ' +
    name +
    '? This overwrites any existing main.lua.'
  );

  if (!confirmed) return;


  try {

    hSetStatus(
      'Writing main.lua to ' +
      name +
      '...',
      'info'
    );


    const script =
      buildRecoveryLines(name).join('\n') +
      '\n';


    // Open file.
    const opened = await sendLua(
      "f = frame.file.open('main.lua', 'w')"
    );
    if (!opened) {
      throw new Error('Could not send file-open command; write stopped.');
    }


    // Write in manageable chunks.
    for (
      let i = 0;
      i < script.length;
      i += 180
    ) {

      const chunk =
        script.slice(i, i + 180);

      const sent = await sendLua(
        'f:write("' +
        luaEscape(chunk) +
        '")'
      );
      if (!sent) {
        throw new Error(
          'Could not send recovery HUD chunk ' +
          (Math.floor(i / 180) + 1) +
          '; the file may be incomplete and reset was skipped.'
        );
      }
    }


    // Close file.
    const closed = await sendLua(
      "f:close()"
    );
    if (!closed) {
      throw new Error('Could not send file-close command; reset was skipped.');
    }

    await delay(150);


    // Reset so main.lua runs.
    if (!await haloSignal(SIG.reset)) {
      throw new Error('Recovery HUD was sent, but reset failed; it may not be running.');
    }


    hSetStatus(
      'Recovery HUD sent; reset requested',
      'success'
    );


  } catch (err) {

    console.error(err);

    hSetStatus(
      'Write recovery HUD failed: ' +
      (err.message || String(err)),
      'error'
    );
  }
}


// ============================================================
// STATIC DASHBOARD EXAMPLE
//
// MILESTONE 1
//
// Goal:
//
//   1. Put a tiny dashboard in main.lua.
//   2. Let it execute locally.
//   3. Keep the surface deliberately tiny.
//
// No BLE state.
// No AI.
// No microphone.
// No external data.
//
// For this diagnostic version, the dashboard draws immediately
// when main.lua runs.
//
// We are deliberately NOT adding button callbacks or sleep here
// until we prove that main.lua itself is actually being written
// and executed.
// ============================================================

function buildDashboardScript() {
  return [
      "-- Static Dashboard Example",
      "",
      "local dashboard = {",
      '    "Test reminder",',
      '    "Remember Halo"',
      "}",
      "",
      "local function show_dashboard()",
      "    frame.display.power_save(false)",
      "    frame.display.clear(0x000000)",
      "    frame.display.set_font(1, 16, 1)",
      "",
      '    frame.display.text("DASHBOARD", 10, 50, 0xFFFFFF)',
      '    frame.display.text("- " .. dashboard[1], 10, 100, 0xFFFFFF)',
      '    frame.display.text("- " .. dashboard[2], 10, 140, 0xFFFFFF)',
      "end",
      "",
      "frame.button.double(function()",
      "    show_dashboard()",
      "end)",
      "",
      "frame.button.long(function()",
      "    frame.display.clear(0x000000)",
      "end)",
      "",
      "show_dashboard()"
  ].join("\n");
}


// ============================================================
// WRITE TINY DASHBOARD
//
// This version intentionally does NOT call frame.standby()
// or register a button callback.
//
// First we need to prove:
//
//     browser -> Lua TX -> file.open/write/close -> reset
//
// Once that works, we can add the local invocation behavior.
// ============================================================

async function haloWriteDashboard() {

  if (!hTx) {
    hSetStatus(
      'Connect Halo first',
      'error'
    );
    return;
  }

  const name =
    (hDev && hDev.name)
      ? hDev.name
      : 'Halo';


  const confirmed = confirm(
    'Write the tiny static dashboard to main.lua on ' +
    name +
    '? This overwrites any existing main.lua.'
  );

  if (!confirmed) return;


  try {

    hSetStatus(
      'Writing tiny dashboard to ' +
      name +
      '...',
      'info'
    );


    const script =
      buildDashboardScript();


    console.log(
      'DASHBOARD SCRIPT:',
      script
    );


    // --------------------------------------------------------
    // Open main.lua
    // --------------------------------------------------------

    const opened =
      await sendLua(
        "f = frame.file.open('main.lua', 'w')"
      );

    if (!opened) {
      throw new Error(
        'Could not send file-open command'
      );
    }


    // --------------------------------------------------------
    // Write script in chunks
    // --------------------------------------------------------

    for (
      let i = 0;
      i < script.length;
      i += 180
    ) {

      const chunk =
        script.slice(i, i + 180);

      const sent =
        await sendLua(
          'f:write("' +
          luaEscape(chunk) +
          '")'
        );

      if (!sent) {
        throw new Error(
          'Could not send dashboard chunk'
        );
      }
    }


    // --------------------------------------------------------
    // Close file
    // --------------------------------------------------------

    const closed =
      await sendLua(
        "f:close()"
      );

    if (!closed) {
      throw new Error(
        'Could not send file-close command'
      );
    }


    await delay(300);


    // --------------------------------------------------------
    // Reset
    //
    // The point of this is to cause Halo to execute main.lua.
    // --------------------------------------------------------

    hSetStatus(
      'Dashboard written - resetting Halo...',
      'info'
    );


    if (!await haloSignal(SIG.reset)) {
      throw new Error('Dashboard was sent, but reset failed; it may not be running.');
    }


    hSetStatus(
      'Dashboard sent; reset requested',
      'success'
    );


  } catch (err) {

    console.error(
      'Dashboard write failed:',
      err
    );

    hSetStatus(
      'Dashboard write failed: ' +
      (err.message || String(err)),
      'error'
    );
  }
}


// ============================================================
// DIAGNOSTIC LUA PING
//
// Not exposed as a button.
// Useful from the browser console:
//
//     haloLuaPing()
//
// This avoids depending on display APIs. If we see the Lua
// response in the Halo RX console, we know the REPL path works.
// ============================================================

async function haloLuaPing() {

  if (!hTx) {
    console.warn(
      'HALO PING: connect Halo first'
    );
    return;
  }

  hSetStatus(
    'Sending Lua ping...',
    'info'
  );

  await sendLua(
    "print('HALO LUA OK')"
  );

  hSetStatus(
    'Lua ping sent - check browser console for HALO RX',
    'success'
  );
}


// ============================================================
// BUTTON STATE
// ============================================================

function updateHaloButtons() {

  const connectBtn =
    document.getElementById(
      'haloConnect'
    );

  if (!connectBtn) return;

  connectBtn.textContent =
    hConnected
      ? 'Reconnect'
      : 'Connect Halo';
}


// ============================================================
// BUTTON WIRING
//
// These IDs intentionally match the existing halo.html.
// Missing buttons are ignored so the JS remains tolerant of
// older versions of the HTML.
// ============================================================

function on(id, fn) {

  const el =
    document.getElementById(id);

  if (!el) {
    console.warn(
      'Halo Recovery: button not found:',
      id
    );
    return;
  }

  el.addEventListener(
    'click',
    fn
  );
}


on(
  'haloConnect',
  haloConnect
);

on(
  'haloRecover',
  haloRecover
);

on(
  'haloBreak',
  () => haloSignal(SIG.brk)
);

on(
  'haloReset',
  () => haloSignal(SIG.reset)
);

on(
  'haloReboot',
  () => haloSignal(SIG.reboot)
);

on(
  'haloRemove',
  haloRemoveMain
);

on(
  'haloWipe',
  haloWipe
);

on(
  'haloDraw',
  haloDrawTest
);

on(
  'haloWriteMain',
  haloWriteRecoveryMain
);

on(
  'haloWriteDashboard',
  haloWriteDashboard
);


// ============================================================
// INIT
// ============================================================

updateHaloButtons();

hSetStatus(
  'Connect a stuck Halo, then tap Recover',
  'info'
);


// ============================================================
// CONSOLE ACCESS
//
// These are intentionally exposed so we can diagnose without
// adding another UI button.
//
// Browser console:
//
//     haloLuaPing()
//
//     buildDashboardScript()
//
// ============================================================

window.haloLuaPing =
  haloLuaPing;

window.buildDashboardScript =
  buildDashboardScript;

// ================ BUNCH OF TESTS =========================
async function haloTextPing() {
  if (!hTx) {
      console.warn('Halo not connected');
      return;
  }

  await sendLua("frame.display.power_save(false)");
  await sendLua("frame.display.clear(0x000000)");
  await sendLua("frame.display.set_font(1, 16, 1)");
  await sendLua("frame.display.text('HELLO HALO', 10, 50, 0xFFFFFF)");
}
window.haloTextPing = haloTextPing;