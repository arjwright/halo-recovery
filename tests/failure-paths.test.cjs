const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const haloSource = fs.readFileSync(path.join(root, 'halo.js'), 'utf8');
const provisionSource = fs.readFileSync(path.join(root, 'halo-provision.js'), 'utf8');

function makeHarness(shouldFail) {
  const elements = new Map();
  const calls = [];
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          id,
          textContent: '',
          className: '',
          disabled: false,
          addEventListener() {},
          remove() {},
        });
      }
      return elements.get(id);
    },
  };

  const context = {
    document,
    window: null,
    navigator: {},
    console: { log() {}, warn() {}, error() {} },
    TextEncoder,
    TextDecoder,
    Uint8Array,
    DataView,
    Blob,
    URL,
    Promise,
    Math,
    JSON,
    String,
    Number,
    Array,
    Object,
    Error,
    setTimeout() { return 1; },
    clearTimeout() {},
    confirm() { return true; },
    __elements: elements,
    __calls: calls,
  };
  context.window = context;
  context.__tx = {
    async writeValueWithoutResponse(bytes) {
      const data = Array.from(bytes);
      calls.push(data);
      if (shouldFail && shouldFail(data, calls.length)) {
        throw new Error('simulated disconnect');
      }
    },
  };

  vm.createContext(context);
  vm.runInContext(haloSource, context, { filename: 'halo.js' });
  vm.runInContext(
    'delay = async () => {}; hTx = __tx; hDev = { name: "Test Halo" };',
    context,
  );
  return context;
}

function status(context) {
  return context.__elements.get('haloStatus');
}

async function testRecoveryHudStopsOnFailedChunk() {
  const context = makeHarness((_, count) => count === 2);
  await vm.runInContext('haloWriteRecoveryMain()', context);

  assert.equal(context.__calls.length, 2, 'no writes or reset should follow the failed chunk');
  assert.match(status(context).textContent, /reset was skipped/i);
  assert.equal(status(context).className, 'status error');
}

async function testRecoveryStopsIfBreakFails() {
  const context = makeHarness(bytes => bytes.length === 1 && bytes[0] === 3);
  await vm.runInContext('haloRecover()', context);

  assert.equal(context.__calls.length, 1, 'reset must not follow a failed break');
  assert.match(status(context).textContent, /break signal failed/i);
  assert.equal(status(context).className, 'status error');
}

async function testDashboardDoesNotClaimSuccessIfResetFails() {
  const context = makeHarness(bytes => bytes.length === 1 && bytes[0] === 4);
  await vm.runInContext('haloWriteDashboard()', context);

  assert.deepEqual(context.__calls.at(-1), [4], 'reset is attempted only after file transfer');
  assert.match(status(context).textContent, /reset failed/i);
  assert.equal(status(context).className, 'status error');
}

async function testDiagnosticDoesNotRunAfterFailedFileChunk() {
  const context = makeHarness((_, count) => count === 3);
  vm.runInContext(provisionSource, context, { filename: 'halo-provision.js' });
  await vm.runInContext('haloSoundTest()', context);

  assert.equal(context.__calls.length, 3, 'the diagnostic must stop at its failed file chunk');
  const sentText = context.__calls.map(bytes => Buffer.from(bytes).toString('utf8')).join('');
  assert.doesNotMatch(sentText, /require\('soundtest'\)/);
  assert.match(status(context).textContent, /no further commands were sent/i);
  assert.equal(status(context).className, 'status error');
}

async function main() {
  await testRecoveryHudStopsOnFailedChunk();
  await testRecoveryStopsIfBreakFails();
  await testDashboardDoesNotClaimSuccessIfResetFails();
  await testDiagnosticDoesNotRunAfterFailedFileChunk();
  console.log('Halo Recovery failure-path tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
