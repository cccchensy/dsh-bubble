/**
 * Browser half of `dsh-bubble`.
 *
 * Watches the process-wide Session run state (the very roster the Session list
 * uses, plus the `api-session/status` Remote event) and plays the bundled
 * bubbly chime exactly once when a Session transitions from running to idle —
 * i.e. when a whole task has finished and the output has stopped.
 *
 * Subagent-origin Sessions are deliberately excluded: a team of children
 * finishing one after another must read as ONE finished task, so only a
 * user-facing root Session can ring the chime.
 *
 * The chime is a WAV embedded as a data URI; it is decoded once into an
 * AudioBuffer and played through Web Audio. The AudioContext is unlocked on the
 * first user gesture (typing or clicking) so the completion chime can sound
 * later without an autoplay violation.
 *
 * The audio placeholder below is replaced at build time by `scripts/build.mjs`
 * with the base64 data URI of `assets/bubble-chime.wav`.
 */
window.__ModuleLoader__.load({
  id: 'dsh-bubble',
  factory(require) {
    var React = require('react');
    var h = React.createElement;

    /** Locale namespace this browser half owns. */
    var NS = 'bubbleChime';

    /** localStorage key of the mute flag. */
    var MUTE_KEY = 'dsh-bubble.muted';

    /** Playback gain. The WAV is peak-normalized to -1 dBFS, so this is the perceived level. */
    var PLAY_GAIN = 0.85;

    /** At most one chime in this window: sessions finishing together read as one task. */
    var CHIME_DEDUPE_MS = 700;

    /** Dictionaries for the mute toggle; the Plugin Manager has its own copies. */
    var ZH = {
      mute: '关闭气泡提示音',
      unmute: '开启气泡提示音',
    };
    var EN = {
      mute: 'Mute the Bubble Chime',
      unmute: 'Unmute the Bubble Chime',
    };

    /** Everything this plugin paints, expressed only through theme tokens. */
    var CSS = [
      '.dsh-bb-toggle{display:inline-flex;align-items:center;justify-content:center;',
      'width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;',
      'color:var(--dsw-alias-label-secondary,currentColor);cursor:pointer;line-height:0;',
      'opacity:0.72;-webkit-appearance:none;appearance:none}',
      '.dsh-bb-toggle:hover{opacity:1;',
      'background:var(--dsw-alias-bg-layer-2,color-mix(in srgb,currentColor 10%,transparent))}',
      '.dsh-bb-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,currentColor);',
      'outline-offset:1px}',
      '.dsh-bb-toggle[data-muted="true"]{opacity:0.4}',
      '.dsh-bb-glyph{display:block;pointer-events:none}',
    ].join('');

    // ---------------------------------------------------------------- styles
    /**
     * Insert the stylesheet for the run and return its removal.
     * @returns a disposer that removes the style element.
     */
    function installStyles() {
      if (typeof document === 'undefined' || document.head === null) return function () {};
      var tag = document.createElement('style');
      tag.setAttribute('data-dsh-bubble', '');
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return function () {
        if (tag.parentNode !== null) tag.parentNode.removeChild(tag);
      };
    }

    // ------------------------------------------------------------------ mute
    /** Cached mute flag, mirrored to localStorage. */
    var muted = false;
    try {
      muted = window.localStorage.getItem(MUTE_KEY) === '1';
    } catch (error) {
      muted = false;
    }

    /** Listeners of the mute flag (the toggle button re-renders from this). */
    var muteListeners = new Set();

    /**
     * Read the current mute state.
     * @returns true while the chime is muted.
     */
    function isMuted() {
      return muted === true;
    }

    /**
     * Set the mute state and notify the toggle.
     * @param next - desired mute state.
     */
    function setMuted(next) {
      var value = next === true;
      if (value === muted) return;
      muted = value;
      try {
        window.localStorage.setItem(MUTE_KEY, value ? '1' : '0');
      } catch (error) {
        /* storage may be unavailable; the flag still lives in memory */
      }
      muteListeners.forEach(function (listener) {
        try {
          listener();
        } catch (error) {
          /* one bad listener must not break the others */
        }
      });
    }

    /**
     * Subscribe to mute changes.
     * @param listener - called after every change.
     * @returns an unsubscribe function.
     */
    function subscribeMuted(listener) {
      muteListeners.add(listener);
      return function () {
        muteListeners.delete(listener);
      };
    }

    // ----------------------------------------------------------------- audio
    /** Base64 WAV data URI injected by the build. */
    var CHIME_DATA_URI = '__BUBBLE_CHIME_DATA_URI__';

    /** Lazily created AudioContext. */
    var audioCtx = null;

    /** Decoded chime, null until decoding settles. */
    var chimeBuffer = null;

    /** True once decoding failed for good (an <audio> element is the fallback). */
    var decodeFailed = false;

    /** In-flight decode, so the WAV is never decoded twice. */
    var decodePromise = null;

    /** <audio> element fallback for a page without Web Audio. */
    var elementAudio = null;

    /** A completion arrived while the chime was still decoding. */
    var pendingPlay = false;

    /** Whether the one-time gesture unlock listeners are installed. */
    var unlockBound = false;

    /**
     * The AudioContext constructor of this page, if any.
     * @returns the constructor or null.
     */
    function AudioContextCtor() {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      return typeof Ctor === 'function' ? Ctor : null;
    }

    /**
     * Create the AudioContext on first use.
     * @returns the context or null when Web Audio is unavailable.
     */
    function ensureContext() {
      if (audioCtx !== null) return audioCtx;
      var Ctor = AudioContextCtor();
      if (Ctor === null) return null;
      try {
        audioCtx = new Ctor({ latencyHint: 'interactive' });
      } catch (error) {
        try {
          audioCtx = new Ctor();
        } catch (error2) {
          audioCtx = null;
        }
      }
      return audioCtx;
    }

    /**
     * Decode a base64 data URI into an ArrayBuffer.
     * @param uri - the data URI.
     * @returns the decoded bytes.
     */
    function base64ToArrayBuffer(uri) {
      var comma = uri.indexOf(',');
      var payload = comma >= 0 ? uri.slice(comma + 1) : uri;
      var binary = window.atob(payload);
      var bytes = new Uint8Array(binary.length);
      for (var index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes.buffer;
    }

    /** Decode the bundled WAV once, then play a queued completion if there is one. */
    function startDecode() {
      if (decodePromise !== null || decodeFailed === true) return;
      var ctx = ensureContext();
      if (ctx === null || typeof ctx.decodeAudioData !== 'function') {
        decodeFailed = true;
        return;
      }
      var data;
      try {
        data = base64ToArrayBuffer(CHIME_DATA_URI);
      } catch (error) {
        decodeFailed = true;
        return;
      }
      var result;
      try {
        result = ctx.decodeAudioData(data);
      } catch (error) {
        decodeFailed = true;
        return;
      }
      if (result === null || result === undefined || typeof result.then !== 'function') {
        decodeFailed = true;
        return;
      }
      decodePromise = result;
      result.then(
        function (buffer) {
          chimeBuffer = buffer;
          if (pendingPlay === true) {
            pendingPlay = false;
            playChime();
          }
        },
        function () {
          decodeFailed = true;
        },
      );
    }

    /** Play the chime through the <audio> element fallback. */
    function playViaElement() {
      try {
        if (elementAudio === null) {
          elementAudio = new window.Audio(CHIME_DATA_URI);
          elementAudio.preload = 'auto';
        }
        elementAudio.currentTime = 0;
        var played = elementAudio.play();
        if (played !== null && played !== undefined && typeof played.catch === 'function') played.catch(function () {});
      } catch (error) {
        /* no audio path is available; the feature is silent, never broken */
      }
    }

    /** Play the completion chime once, unlocking a suspended context if needed. */
    function playChime() {
      if (muted === true) return;
      var ctx = ensureContext();
      if (ctx === null) {
        playViaElement();
        return;
      }
      if (decodeFailed === true) {
        playViaElement();
        return;
      }
      if (chimeBuffer === null) {
        pendingPlay = true;
        startDecode();
        if (decodeFailed === true) playViaElement();
        return;
      }
      var play = function () {
        try {
          var source = ctx.createBufferSource();
          source.buffer = chimeBuffer;
          var gain = ctx.createGain();
          gain.gain.value = PLAY_GAIN;
          source.connect(gain);
          gain.connect(ctx.destination);
          source.start(0);
        } catch (error) {
          playViaElement();
        }
      };
      if (ctx.state === 'running') {
        play();
        return;
      }
      if (typeof ctx.resume === 'function') {
        try {
          // A resume forced by the autoplay policy would settle only at the next
          // user gesture, which could put the chime minutes after the task. Give
          // it a short window and drop this completion rather than ring late;
          // the next gesture unlocks the context for the following tasks.
          var cancelled = false;
          var timer = setTimeout(function () {
            cancelled = true;
          }, 400);
          var resumed = ctx.resume();
          if (resumed !== null && resumed !== undefined && typeof resumed.then === 'function') {
            resumed.then(
              function () {
                clearTimeout(timer);
                if (cancelled !== true) play();
              },
              function () {
                clearTimeout(timer);
              },
            );
          } else {
            clearTimeout(timer);
            play();
          }
        } catch (error) {
          play();
        }
        return;
      }
      play();
    }

    /**
     * Unlock and warm up audio on the first user gesture.
     *
     * The page's autoplay policy only lets a completion chime sound after the
     * user has interacted with it; typing a prompt or clicking anything is that
     * interaction, and this listener turns it into a running AudioContext.
     * @returns a disposer removing the listeners.
     */
    function bindUnlock() {
      if (unlockBound === true) return function () {};
      unlockBound = true;
      var unlock = function () {
        startDecode();
        var ctx = ensureContext();
        if (ctx === null) return;
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
          try {
            var resumed = ctx.resume();
            if (resumed !== null && resumed !== undefined && typeof resumed.catch === 'function') resumed.catch(function () {});
          } catch (error) {
            /* the play attempt retries the resume */
          }
        }
      };
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);
      return function () {
        window.removeEventListener('pointerdown', unlock, true);
        window.removeEventListener('keydown', unlock, true);
        unlockBound = false;
      };
    }

    // ------------------------------------------------------ completion watch
    /** Last observed run state per Session id. */
    var runningState = new Map();

    /** Session ids currently known to be subagent-origin Sessions. */
    var subagentIds = new Set();

    /** Timestamp of the last chime, for the dedupe window. */
    var lastChimeAt = 0;

    /**
     * Normalize a Session identity to a Map key.
     * @param id - session id or undefined.
     * @returns a string key, or an empty string when there is no identity.
     */
    function sessionKey(id) {
      return id === undefined || id === null ? '' : String(id);
    }

    /** Ring the chime, unless one just rang. */
    function fireCompletion() {
      if (muted === true) return;
      var now = Date.now();
      if (now - lastChimeAt < CHIME_DEDUPE_MS) return;
      lastChimeAt = now;
      playChime();
    }

    /**
     * Feed one run-state observation, ringing on a running -> idle edge.
     * @param id - Session id.
     * @param isRunning - whether that Session is running now.
     */
    function observeRunning(id, isRunning) {
      var key = sessionKey(id);
      if (key === '') return;
      var running = isRunning === true;
      var previous = runningState.get(key);
      runningState.set(key, running);
      if (previous === true && running === false) fireCompletion();
    }

    /**
     * Fold the Session roster into the run-state map.
     *
     * The roster is the Session list's own rows, so it covers every workspace,
     * and it also identifies subagent-origin rows, which must never ring.
     * @param rows - roster rows, or anything else when the roster is unavailable.
     */
    function syncRoster(rows) {
      if (!Array.isArray(rows)) return;
      for (var index = 0; index < rows.length; index += 1) {
        var row = rows[index];
        if (row === null || row === undefined) continue;
        var key = sessionKey(row.id !== undefined ? row.id : row.sessionId);
        if (key === '') continue;
        if (row.origin === 'subagent') {
          subagentIds.add(key);
          runningState.set(key, row.running === true);
          continue;
        }
        subagentIds.delete(key);
        observeRunning(key, row.running === true);
      }
    }

    /**
     * Feed one `api-session/status` Remote event.
     * @param sessionId - the Session that changed.
     * @param isRunning - its new run state.
     */
    function observeStatusEvent(sessionId, isRunning) {
      var key = sessionKey(sessionId);
      if (subagentIds.has(key)) {
        runningState.set(key, isRunning === true);
        return;
      }
      observeRunning(key, isRunning);
    }

    /**
     * Mounts nothing; owns the chime's completion watch for the page lifetime.
     * @param props - injected seats from `apply`.
     * @returns null, rendered into the frame-wide overlay layer.
     */
    function BubbleWatcher(props) {
      React.useEffect(function () {
        var disposers = [];
        var stopUnlock = bindUnlock();
        if (typeof stopUnlock === 'function') disposers.push(stopUnlock);

        var readRoster = props.readRoster;
        var subscribeRoster = props.subscribeRoster;
        if (typeof readRoster === 'function') {
          var sync = function () {
            var rows = null;
            try {
              rows = readRoster();
            } catch (error) {
              rows = null;
            }
            syncRoster(rows);
          };
          sync();
          if (typeof subscribeRoster === 'function') {
            try {
              var remove = subscribeRoster(sync);
              if (typeof remove === 'function') disposers.push(remove);
            } catch (error) {
              /* the status event below still carries completions */
            }
          }
        }

        var remote = props.remote;
        if (remote !== null && remote !== undefined && typeof remote.$on === 'function') {
          try {
            var off = remote.$on('api-session/status', function (sessionId, isRunning) {
              observeStatusEvent(sessionId, isRunning);
            });
            if (typeof off === 'function') disposers.push(off);
          } catch (error) {
            /* the roster subscription is the fallback */
          }
        }

        // Decode before the first completion, so the chime plays without a
        // decode stall. The context stays suspended until the first gesture.
        startDecode();

        return function () {
          for (var index = 0; index < disposers.length; index += 1) {
            try {
              disposers[index]();
            } catch (error) {
              /* teardown keeps going */
            }
          }
        };
      }, []);
      return null;
    }

    /**
     * Three rising bubbles for the mute toggle; the slash carries the muted state.
     * @param props - `muted` selects the slashed form.
     * @returns the icon element.
     */
    function BubbleGlyph(props) {
      var mutedNow = props.muted === true;
      var strokes = [
        h('circle', { key: 'big', cx: 9.2, cy: 15.1, r: 5.4 }),
        h('circle', { key: 'mid', cx: 16.9, cy: 9.1, r: 3.3 }),
        h('circle', { key: 'small', cx: 20.9, cy: 4.2, r: 1.9 }),
      ];
      if (mutedNow) {
        strokes.push(h('path', { key: 'slash', d: 'M3.2 3.2 L20.8 20.8' }));
      } else {
        strokes.push(h('circle', { key: 'glint', cx: 7.4, cy: 13.2, r: 0.95, fill: 'currentColor', stroke: 'none' }));
      }
      return h(
        'svg',
        {
          className: 'dsh-bb-glyph',
          viewBox: '0 0 24 24',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        strokes,
      );
    }

    /**
     * The mute toggle under the composer: one small bubble cluster, same weight
     * as the ambient controls around it.
     * @param props - injected `t` seat and the standard slot props.
     * @returns the toggle button.
     */
    function BubbleToggle(props) {
      var state = React.useState(isMuted());
      var mutedNow = state[0];
      var setLocalMuted = state[1];
      React.useEffect(function () {
        return subscribeMuted(function () {
          setLocalMuted(isMuted());
        });
      }, []);
      var t = typeof props.t === 'function' ? props.t : function (key) {
        return key;
      };
      var label = t(mutedNow ? 'unmute' : 'mute');
      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-bb-toggle',
          'data-muted': mutedNow ? 'true' : 'false',
          title: label,
          'aria-label': label,
          'aria-pressed': mutedNow ? 'false' : 'true',
          onClick: function () {
            setMuted(isMuted() !== true);
          },
        },
        h(BubbleGlyph, { muted: mutedNow }),
      );
    }

    // ----------------------------------------------------------------- apply
    /** Services the browser half needs before it can activate. */
    var inject = ['slots', 'locale', 'sessions', 'remote'];

    /**
     * Browser plugin body: dictionaries, chime watch, mute toggle.
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      ctx.effect(installStyles, 'dsh-bubble: styles');
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: ZH, en: EN });
      }, 'dsh-bubble: dictionaries');

      // The frame-wide overlay layer is mounted for the page's whole lifetime
      // and does not depend on the selected Session or panel, so completions in
      // any workspace are heard even while the Plugins page is open. The watcher
      // draws nothing; the entry only carries the effect.
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'bubble-watcher',
            order: 60,
            inject: function () {
              return {
                // The process-wide run status lives on the Remote event bus and
                // the Session roster; the slot inject is the only place that can
                // read `ctx`, so both are handed to the component as plain props.
                remote: ctx.remote,
                readRoster: function () {
                  try {
                    var snapshot = ctx.sessions.list.getSnapshot();
                    var byId = snapshot === null || snapshot === undefined ? undefined : snapshot.byId;
                    if (byId === undefined || byId === null) return null;
                    return Object.keys(byId).map(function (id) {
                      return byId[id];
                    });
                  } catch (error) {
                    return null;
                  }
                },
                subscribeRoster: function (listener) {
                  try {
                    return ctx.sessions.list.subscribe(listener);
                  } catch (error) {
                    return function () {};
                  }
                },
              };
            },
          },
          BubbleWatcher,
        );
      });

      // The mute toggle lives in the ambient row below the composer, beside the
      // host's own activity and usage entries.
      ctx.slots.inject('conversation.composer.dock', function () {
        return ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'bubble-toggle',
            order: 10,
            locale: NS,
            inject: function () {
              return { t: ctx.locale.bind(NS) };
            },
          },
          BubbleToggle,
        );
      });
    }

    var exports = {
      inject: inject,
      apply: apply,
    };
    return exports;
  },
});
