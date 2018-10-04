'use strict';

require('./kite-logo');
const {Emitter, CompositeDisposable} = require('atom');
const {humanizeKeystroke} = require('underscore-plus');
const {STATES} = require('kite-api');
const {MAX_FILE_SIZE} = require('../constants');
const {DisposableEvent} = require('../utils');
const DataLoader = require('../data-loader');

const TOOLTIPS = {
  [STATES.UNSUPPORTED]: 'Kite only supports macOS at the moment.',
  [STATES.UNINSTALLED]: 'Kite is not installed.',
  [STATES.INSTALLED]: 'Kite is not running.',
  [STATES.RUNNING]: 'Kite is running but not reachable.',
  [STATES.REACHABLE]: 'Kite is not authenticated.',
  [STATES.AUTHENTICATED]: 'Kite is not enabled for the current directory.',
  [STATES.WHITELISTED]: 'Kite is ready.',
  ready: 'Kite is ready.',
  sizeExceedsLimit: 'The current file is too large for Kite to handle',
  indexing: 'Kite engine is indexing your code',
  syncing: 'Kite engine is syncing your code',
  none: '',
};

const STATUSES = {
  [STATES.UNSUPPORTED]: 'unsupported',
  [STATES.UNINSTALLED]: 'uninstalled',
  [STATES.INSTALLED]: 'installed',
  [STATES.RUNNING]: 'running',
  [STATES.REACHABLE]: 'reachable',
  [STATES.AUTHENTICATED]: 'authenticated',
  [STATES.WHITELISTED]: 'whitelisted',
};

class KiteStatus extends HTMLElement {
  static initClass() {
    return document.registerElement('kite-status', {
      prototype: this.prototype,
    });
  }

  onDidClick(listener) {
    return this.emitter.on('did-click', listener);
  }

  createdCallback() {
    this.emitter = new Emitter();
    this.updateOnGetState = true;
  }

  attachedCallback() {
    this.subscriptions = this.subscriptions || new CompositeDisposable();

    this.subscriptions.add(new DisposableEvent(this, 'click', () => {
      this.emitter.emit('did-click', this.getAttribute('status'));
    }));

    this.innerHTML = [
      '<kite-logo small class="badge"></kite-logo>',
      '<kite-logo sync></kite-logo>',
      '<span class="text">Kite</span>',
    ].join('');

    this.classList.add('inline-block');
    this.tooltipText = '';

    this.statusText = this.querySelector('.text');

    this.setState(-1);
    if (this.app) { this.subscribe(); }
  }

  preventUpdatesOnGetState() {
    this.updateOnGetState = false;
  }

  resumeUpdatesOnGetState() {
    this.updateOnGetState = true;
  }

  detachedCallback() {
    this.subscriptions.dispose();
    delete this.app;
  }

  subscribe() {
    this.subscriptions = this.subscriptions || new CompositeDisposable();

    this.subscriptions.add(this.app.onDidGetState(({ state }) => {
      if (this.updateOnGetState) {
        this.setState(state, this.app.hasActiveSupportedFile());
      }
    }));

    this.subscriptions.add(atom.tooltips.add(this, {
      title: () => this.tooltipText,
    }));
  }

  setApp(app) {
    this.app = app;
    this.subscribe();
  }

  setStatusLabel(kiteEditor) {
    clearTimeout(this.statusTimeout);
    this.statusTimeout = setTimeout(() => {
      let label = 'Kite';

      if (kiteEditor && kiteEditor.editor) {
        const pos = kiteEditor.editor.getCursorBufferPosition();

        // Key is composed of the filename and the cursor position so that
        // we catch both changes and invalidate the cache
        const key = `${kiteEditor.editor.getPath()}${pos}`;

        // We store the hover request promise and compare the previous
        // key with the last one to only make new requests
        const promise = this.lastDocsAtCursorPromise && key === this.lastDocsAtCursorPosition
        ? this.lastDocsAtCursorPromise
        : DataLoader.getHoverDataAtPosition(kiteEditor.editor, pos);

        this.lastDocsAtCursorPosition = key;
        this.lastDocsAtCursorPromise = promise;
        promise.then(data => {
          const editorElement = kiteEditor.editorElement;
          const binding = atom.keymaps.findKeyBindings({target: editorElement})
          .filter(k => k.command === 'kite:docs-at-cursor')[0];

          const kbd = binding
          ? ` <kbd>${humanizeKeystroke(binding.keystrokes)}</kbd>`
          : ' (Command Palette → "Kite: Docs At Cursor")';
          label += `: Docs available${kbd}`;

          this.statusText && (this.statusText.innerHTML = label);
        })
        .catch(() => {
          this.statusText && (this.statusText.innerHTML = label);
        });
      } else {
        this.statusText && (this.statusText.innerHTML = label);
      }
    }, 300);
  }

  setState(state, supported, editor) {
    const sizeExceedsLimit = editor && editor.getText().length >= MAX_FILE_SIZE;

    this.removeAttribute('is-syncing');
    this.clearStatusPolling();

    if (editor) {
      const kiteEditor = this.Kite.kiteEditorByEditorID[editor.id];
      this.setStatusLabel(kiteEditor);
    }

    if (state in STATUSES) {
      this.tooltipText = state < STATES.AUTHENTICATED
        ? TOOLTIPS[state]
        : (supported ? TOOLTIPS[state] : TOOLTIPS.none);
      this.setAttribute('status', STATUSES[state]);
      supported
        ? this.setAttribute('is-active-kite-file', '')
        : this.removeAttribute('is-active-kite-file');

      if (state >= STATES.WHITELISTED && sizeExceedsLimit) {
        this.tooltipText = TOOLTIPS.sizeExceedsLimit;
      }

      if (state >= STATES.WHITELISTED && editor) {
        this.pollStatus(editor);
      }
    } else {
      this.tooltipText = `Kite is unknown state ${state}.`;
      this.setAttribute('status', 'unknown');
    }

    sizeExceedsLimit
      ? this.setAttribute('size-exceeds-limit', '')
      : this.removeAttribute('size-exceeds-limit');

    this.lastState = state;
  }

  clearStatusPolling() {
    clearTimeout(this.pollingInterval);
  }

  pollStatus(editor) {
    DataLoader.getStatus(editor)
    .then(status => {
      if (status.status === 'ready' || status.status === '') {
        this.removeAttribute('is-syncing');
      } else {
        this.setAttribute('is-syncing', '');
        this.tooltipText = TOOLTIPS[status.status];
        this.pollingInterval = setTimeout(() => this.pollStatus(editor), 3000);
      }
    })
    .catch(() => {});
  }
}

module.exports = KiteStatus.initClass();
