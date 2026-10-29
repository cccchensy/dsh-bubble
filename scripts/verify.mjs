/**
 * Structural + behavioural verification for `dsh-bubble`.
 *
 * Not shipped. It checks the manifest, patch, locales, icon and WAV facts, then
 * loads the built browser bundle against stubbed page contracts and exercises
 * the completion detector: a root Session going running -> idle rings exactly
 * once, a subagent-origin Session never rings, mute silences it, and the dedupe
 * window collapses two simultaneous completions into one chime.
 *
 * Run: node scripts/verify.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const failures = [];

/**
 * Record one assertion.
 * @param name - what is being asserted.
 * @param passed - the outcome.
 * @param detail - optional evidence on failure.
 */
function check(name, passed, detail) {
  if (passed) {
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  }
}

const read = (relative) => readFileSync(join(root, relative), 'utf8');

// ── manifest ────────────────────────────────────────────────────────────────
console.log('manifest and bundle files');
const pkg = JSON.parse(read('package.json'));
check('package name', pkg.name === 'dsh-bubble', pkg.name);
check('ES module package', pkg.type === 'module');
check('host entry exported', pkg.exports['.'] === './index.js');
check('client entry exported', pkg.exports['./client'] === './lib/client.js');
check('locale files exported', pkg.exports['./locale/*.json'] === './locale/*.json');
check('icon exported', pkg.exports['./icon'] === './icon.svg');
check('bundle patch declared', pkg.dsh?.bundle?.patch === './cordis.patch.yml');
check('client platform is web', pkg.dsh?.client?.platform === 'web');
check('client activates immediately', pkg.dsh?.client?.immediately === true);
check(
  'client orders after the conversation shell',
  Array.isArray(pkg.dsh?.client?.inject) && pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'),
);
check('built client exists', existsSync(join(root, 'lib/client.js')));
check('host entry exists', existsSync(join(root, 'index.js')));
check('sound asset exists', existsSync(join(root, 'assets/bubble-chime.wav')));

// ── locales ─────────────────────────────────────────────────────────────────
console.log('display metadata');
for (const locale of ['en', 'zh']) {
  const dict = JSON.parse(read(`locale/${locale}.json`));
  check(`${locale} title`, typeof dict.meta?.title === 'string' && dict.meta.title.length > 0);
  check(`${locale} description`, typeof dict.meta?.description === 'string' && dict.meta.description.length > 0);
  check(`${locale} toggle strings`, typeof dict.bubbleChime?.mute === 'string' && typeof dict.bubbleChime?.unmute === 'string');
}

// ── icon ────────────────────────────────────────────────────────────────────
console.log('icon');
const icon = read('icon.svg');
check('icon is SVG', icon.trimStart().startsWith('<svg'));
check('icon has a viewBox', /viewBox="[\d.\s]+"/.test(icon));
check(
  'icon loads no external resource',
  !/<image\b/i.test(icon)
  && !/(?:xlink:)?href\s*=\s*["']\s*(?:https?:)?\/\//i.test(icon)
  && !/url\(\s*["']?https?:/i.test(icon),
);
check('icon is under the 256 KiB cap', Buffer.byteLength(icon, 'utf8') < 256 * 1024);

// ── patch ───────────────────────────────────────────────────────────────────
console.log('bundle patch');
const patch = read('cordis.patch.yml');
check('patch inserts the row id', /id:\s*bubble\b/.test(patch));
check('patch mounts this package', /name:\s*'dsh-bubble'/.test(patch));
check('patch inserts exactly one row', (patch.match(/^\s*-\s+id:/gm) ?? []).length === 1);

// ── WAV ─────────────────────────────────────────────────────────────────────
console.log('sound asset');
const wav = readFileSync(join(root, 'assets/bubble-chime.wav'));
const wavHash = createHash('sha256').update(wav).digest('hex');

/**
 * Parse the PCM facts of a RIFF/WAVE file.
 * @param buffer - WAV bytes.
 * @returns the format and duration.
 */
function inspectWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not RIFF/WAVE');
  let offset = 12;
  let fmt;
  let dataSize;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      dataSize = size;
    }
    offset = body + size + (size % 2);
  }
  return { ...fmt, dataSize, duration: dataSize / (fmt.channels * (fmt.bitsPerSample / 8)) / fmt.sampleRate };
}
const facts = inspectWav(wav);
check('PCM mono 44.1 kHz 16-bit', facts.format === 1 && facts.channels === 1 && facts.sampleRate === 44100 && facts.bitsPerSample === 16);
check('duration 0.9-1.2 s', facts.duration >= 0.9 && facts.duration <= 1.2, `${facts.duration.toFixed(3)} s`);
check('asset under 200 KiB', wav.length < 200 * 1024, `${wav.length} bytes`);

// ── built bundle ────────────────────────────────────────────────────────────
console.log('built browser bundle');
const source = read('lib/client.js');
check('generated banner present', source.includes('Generated by scripts/build.mjs'));
check('placeholder fully replaced', !source.includes('__BUBBLE_CHIME_DATA_URI__'));
check('module id matches the package', source.includes("id: 'dsh-bubble'"));
check('banner carries the WAV hash', source.includes(`sha256:${wavHash}`));
const embedded = /data:audio\/wav;base64,([A-Za-z0-9+/=]+)/.exec(source);
check('embedded WAV data URI found', embedded !== null);
if (embedded !== null) {
  const embeddedBytes = Buffer.from(embedded[1], 'base64');
  check('embedded audio is the exact asset', createHash('sha256').update(embeddedBytes).digest('hex') === wavHash);
}

// ── load the bundle against stubbed page contracts ──────────────────────────
/**
 * Load the built bundle in a fresh stub page and return its pieces.
 * @param options - `muted` seeds localStorage; `audio` selects the Web Audio stub.
 * @returns the module, ctx, and captured state.
 */
function loadBundle(options = {}) {
  const reactEffects = [];
  const audio = {
    started: 0,
    decoded: 0,
    created: 0,
    state: 'running',
    elementPlays: 0,
  };
  const react = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity) };
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, function () {}];
    },
    useEffect(effect) {
      reactEffects.push(effect);
    },
    useRef(initial) {
      return { current: initial };
    },
  };

  const storage = new Map();
  if (options.muted === true) storage.set('dsh-bubble.muted', '1');

  const styleTags = [];
  const doc = {
    head: {
      appendChild(node) {
        styleTags.push(node);
        node.parentNode = doc.head;
      },
      removeChild(node) {
        const index = styleTags.indexOf(node);
        if (index >= 0) styleTags.splice(index, 1);
        node.parentNode = null;
      },
    },
    createElement(tag) {
      return {
        tag,
        textContent: '',
        dataset: {},
        parentNode: null,
        setAttribute(name, value) {
          this.dataset[name] = value;
        },
      };
    },
  };

  const listeners = new Map();
  const win = {
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    },
    atob: (payload) => Buffer.from(payload, 'base64').toString('binary'),
    __ModuleLoader__: {
      load(entry) {
        win.loaded = entry;
      },
    },
  };
  if (options.audio !== false) {
    win.AudioContext = function FakeAudioContext() {
      audio.created += 1;
      return {
        state: audio.state,
        destination: {},
        decodeAudioData() {
          audio.decoded += 1;
          return Promise.resolve({ duration: 1 });
        },
        resume() {
          audio.state = 'running';
          return Promise.resolve();
        },
        createBufferSource() {
          return {
            buffer: null,
            connect() {},
            start() {
              audio.started += 1;
            },
          };
        },
        createGain() {
          return { gain: { value: 0 }, connect() {} };
        },
      };
    };
  }
  win.Audio = function FakeAudio() {
    return { preload: '', currentTime: 0, play: () => Promise.resolve((audio.elementPlays += 1)) };
  };

  const requireStub = (name) => {
    if (name === 'react') return react;
    throw new Error(`unexpected require('${name}')`);
  };
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'require', source)(win, doc, requireStub);
  const entry = win.loaded;
  if (entry === undefined) throw new Error('bundle did not call the module loader');

  const registrations = [];
  const injections = [];
  const localeRegistrations = [];
  const disposers = [];
  const ctx = {
    effect(effect) {
      disposers.push(effect());
      return () => {};
    },
    slots: {
      inject(key, callback) {
        injections.push(key);
        callback();
        return () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
    locale: {
      register(ns, dicts) {
        localeRegistrations.push({ ns, dicts });
        return () => {};
      },
      bind() {
        return (key) => key;
      },
    },
    remote: { $on: () => () => {} },
    sessions: {
      list: {
        getSnapshot: () => ({ byId: {} }),
        subscribe: () => () => {},
      },
    },
  };

  return { win, doc, react, reactEffects, audio, entry, ctx, registrations, injections, localeRegistrations, disposers, styleTags };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log('browser bundle wiring');
const loaded = loadBundle();
const module = loaded.entry.factory((name) => {
  if (name === 'react') return loaded.react;
  throw new Error(`unexpected require('${name}')`);
});
check('loader id matches package', loaded.entry.id === 'dsh-bubble');
check('exports a plugin apply', typeof module.apply === 'function');
check(
  'declares its client services',
  JSON.stringify(module.inject) === JSON.stringify(['slots', 'locale', 'sessions', 'remote']),
  JSON.stringify(module.inject),
);
module.apply(loaded.ctx);
check('stylesheet inserted', loaded.styleTags.length === 1);
check(
  'injects both owning slots',
  loaded.injections.includes('shell.overlay') && loaded.injections.includes('conversation.composer.dock'),
  loaded.injections.join(', '),
);
check('registers exactly two entries', loaded.registrations.length === 2, String(loaded.registrations.length));
const watcherReg = loaded.registrations.find((item) => item.options.id === 'bubble-watcher');
const toggleReg = loaded.registrations.find((item) => item.options.id === 'bubble-toggle');
check('watcher entry in the frame overlay', watcherReg?.options.name === 'shell.overlay');
check('toggle entry in the composer dock', toggleReg?.options.name === 'conversation.composer.dock');
check('toggle registration carries a locale seat', typeof toggleReg?.options.locale === 'string');
check(
  'dictionaries registered for zh + en',
  loaded.localeRegistrations.length === 1
    && loaded.localeRegistrations[0].ns === 'bubbleChime'
    && typeof loaded.localeRegistrations[0].dicts.zh?.mute === 'string'
    && typeof loaded.localeRegistrations[0].dicts.en?.mute === 'string',
);

/**
 * Mount the watcher with a roster and a captured status handler.
 * @param harness - result of loadBundle().
 * @param rows - roster rows to seed.
 * @returns the captured status handler.
 */
function mountWatcher(harness, rows) {
  let statusHandler = null;
  const props = {
    remote: {
      $on(name, handler) {
        if (name === 'api-session/status') statusHandler = handler;
        return () => {};
      },
    },
    readRoster: () => rows,
    subscribeRoster: () => () => {},
  };
  harness.reactEffects.length = 0;
  const rendered = harness.registrations.find((item) => item.options.id === 'bubble-watcher').component(props);
  check('watcher draws nothing', rendered === null);
  for (const effect of harness.reactEffects) effect();
  return () => statusHandler;
}

// ── behaviour: a root completion rings once ─────────────────────────────────
console.log('behaviour');
{
  const harness = loadBundle();
  const module2 = harness.entry.factory((name) => {
    if (name === 'react') return harness.react;
    throw new Error(`unexpected require('${name}')`);
  });
  module2.apply(harness.ctx);
  const status = mountWatcher(harness, [{ id: 'root-1', origin: 'main', running: true }]);
  await settle();
  check('audio decoded once up front', harness.audio.decoded === 1);
  status()('root-1', false);
  check('root completion rings the chime', harness.audio.started === 1, String(harness.audio.started));
  status()('root-1', false);
  check('a repeated idle status is silent', harness.audio.started === 1, String(harness.audio.started));
  status()('root-1', true);
  await sleep(760);
  status()('root-1', false);
  check('a second completed task rings again', harness.audio.started === 2, String(harness.audio.started));
}

// ── behaviour: subagent completions never ring ──────────────────────────────
{
  const harness = loadBundle();
  const module2 = harness.entry.factory((name) => {
    if (name === 'react') return harness.react;
    throw new Error(`unexpected require('${name}')`);
  });
  module2.apply(harness.ctx);
  const status = mountWatcher(harness, [
    { id: 'root-2', origin: 'main', running: true },
    { id: 'child-2', origin: 'subagent', running: true },
  ]);
  await settle();
  status()('child-2', false);
  check('a subagent completion is silent', harness.audio.started === 0, String(harness.audio.started));
  status()('root-2', false);
  check('the parent completion still rings', harness.audio.started === 1, String(harness.audio.started));
}

// ── behaviour: mute ─────────────────────────────────────────────────────────
{
  const harness = loadBundle({ muted: true });
  const module2 = harness.entry.factory((name) => {
    if (name === 'react') return harness.react;
    throw new Error(`unexpected require('${name}')`);
  });
  module2.apply(harness.ctx);
  const status = mountWatcher(harness, [{ id: 'root-3', running: true }]);
  await settle();
  status()('root-3', false);
  check('muted completion is silent', harness.audio.started === 0, String(harness.audio.started));
}

// ── behaviour: dedupe two simultaneous completions ──────────────────────────
{
  const harness = loadBundle();
  const module2 = harness.entry.factory((name) => {
    if (name === 'react') return harness.react;
    throw new Error(`unexpected require('${name}')`);
  });
  module2.apply(harness.ctx);
  const status = mountWatcher(harness, [
    { id: 'root-4', running: true },
    { id: 'root-5', running: true },
  ]);
  await settle();
  status()('root-4', false);
  status()('root-5', false);
  check('two completions in one window ring once', harness.audio.started === 1, String(harness.audio.started));
}

// ── behaviour: no Web Audio falls back without throwing ─────────────────────
{
  const harness = loadBundle({ audio: false });
  const module2 = harness.entry.factory((name) => {
    if (name === 'react') return harness.react;
    throw new Error(`unexpected require('${name}')`);
  });
  module2.apply(harness.ctx);
  const status = mountWatcher(harness, [{ id: 'root-6', running: true }]);
  await settle();
  status()('root-6', false);
  check('falls back to the audio element', harness.audio.elementPlays === 1, String(harness.audio.elementPlays));
}

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}`);
process.exit(failures.length === 0 ? 0 : 1);
