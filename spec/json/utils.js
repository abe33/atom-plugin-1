'use strict';

const fs = require('fs');
const path = require('path');

const base = path.resolve(__dirname, '..');
const testBase = path.join(base, '..', 'node_modules', 'editors-json-tests');

function inLiveEnvironment() {
  return process.env.LIVE_ENVIRONMENT != undefined;
}

function jsonPath(...p) {
  return path.join(testBase, ...p);
}

function featureSetPath() {
  return fs.existsSync(jsonPath('tests/atom.json'))
    ? jsonPath('tests/atom.json')
    : jsonPath('tests/default.json');
}

function waitsForPromise(...args) {
  var fn, label, shouldReject, timeout;
  label = null;
  if (args.length > 1) {
    ({shouldReject, timeout, label} = args[0]);
  } else {
    shouldReject = false;
  }
  if (label == null) {
    label = 'promise to be resolved or rejected';
  }
  fn = args[args.length - 1];

  // if (typeof label == 'function')  {console.log(label());}

  return window.waitsFor('request promise resolution', (moveOn) => {
    const promise = fn();
    if (shouldReject) {
      return promise.then(() => {
        jasmine.getEnv().currentSpec.fail(typeof label == 'function' ? label() : label);
        return moveOn();
      }, moveOn);
    } else {
      return promise.then(moveOn, (error) => {
        jasmine.getEnv().currentSpec.fail(`${
          typeof label == 'function' ? label() : label
        }, but it was rejected with: ${
          (error != null ? error.message : void 0)
        } ${jasmine.pp(error)}`);
        return moveOn();
      });
    }
  }, timeout);
}

function waitsFor(m, f, t, i) {
  if (typeof m == 'function' && typeof f != 'function') {
    i = t;
    t = f;
    f = m;
    m = 'something to happen';
  }

  const intervalTime = i || 10;
  const timeoutDuration = t || 2000;

  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const res = f();
      if (res) {
        if (res.then) {
          res.then(() => {
            clearTimeout(timeout);
            clearInterval(interval);
            resolve();
          }, (err) => {});
        } else {
          clearTimeout(timeout);
          clearInterval(interval);
          resolve();
        }
      }
    }, intervalTime);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      let msg;
      if (typeof m == 'function') {
        msg = `Waited ${timeoutDuration}ms for ${m()}`;
      } else {
        msg = `Waited ${timeoutDuration}ms for ${m} but nothing happened`;
      }
      reject(new Error(msg));
    }, timeoutDuration);
  });
}

function walk(p, ext, callback) {
  if (typeof ext == 'function') {
    callback = ext;
    ext = undefined;
  }
  if (fs.existsSync(p)) {
    const stats = fs.lstatSync(p);

    if (stats.isDirectory()) {
      const content = fs.readdirSync(p);

      content.forEach(s => walk(path.join(p, s), callback));
    } else {
      if (!ext || path.extname(p) === ext) {
        callback(p);
      }
    }
  }
}

function readValueAtPath(path, object) {
  if (!path) { return object; }

  return path.split(/\./g).reduce((memo, key) => {
    if (memo == undefined) { return memo; }
    return memo[key];
  }, object);
}

function writeValueAtPath(path, value, object) {
  if (!object) { object = {}; }

  return path.split(/\./g).reduce((memo, key, i, a) => {
    if (i === a.length - 1) {
      memo[key] = value;
      return object;
    } else if (memo[key] == undefined) {
      memo[key] = {};
      return memo[key];
    }
    return memo[key];
  }, object);
}

function substituteFromContext(data, context) {
  let string = JSON.stringify(data);

  string = string.replace(/\$\{([^}]+)\}/g, (m, k) => readValueAtPath(k, context));

  return JSON.parse(string);
}

function cleanPath(p) {
  return encodeURI(normalizeDriveLetter(p))
  .replace(/^([a-zA-Z]):/, (m, d) => `/windows/${d}`)
  .replace(/\/|\\|%5C/g, ':');
}

function normalizeDriveLetter(str) {
  return str.replace(/^[a-z]:/, m => m.toUpperCase());
}

function buildContext() {
  const context = {
    plugin: 'atom',
    editors: {},
  };

  atom.workspace.getTextEditors().forEach(e => {
    const relativePath = path.relative(testBase, e.getPath());
    writeValueAtPath(relativePath, {
      filename: e.getPath(),
      filename_escaped: cleanPath(e.getPath()),
    }, context.editors);
  });

  return context;
}

function loadPayload(p) {
  let body;
  switch (typeof p) {
    case 'object':
      body = p;
      break;
    case 'string':
      body = require(jsonPath(p));
  }
  return body;
}

function itForExpectation(expectation, block = () => {}) {
  if (expectation.ignore) {
    xit(expectation.description, block);
  } else if (expectation.focus) {
    ffit(expectation.description, block);
  } else {
    it(expectation.description, block);
  }
}

function describeForTest(test, description, block) {
  if (test.ignore) {
    xdescribe(description, block);
  } else if (test.focus) {
    ffdescribe(description, block);
  } else {
    describe(description, block);
  }
}

const NotificationsMock = {
  LEVELS: {
    success: 'addSuccess',
    info: 'addInfo',
    warning: 'addWarning',
    warn: 'addWarning',
    error: 'addError',
  },

  initialize() {
    this.notifications = [];
    const safeAddSuccess = atom.notifications.addSuccess;
    const safeAddInfo = atom.notifications.addInfo;
    const safeAddWarning = atom.notifications.addWarning;
    const safeAddError = atom.notifications.addError;

    spyOn(atom.notifications, 'addSuccess').andCallFake((...args) => {
      this.registerNotification('success', ...args);
      return safeAddSuccess.apply(atom.notifications, args);
    });
    spyOn(atom.notifications, 'addInfo').andCallFake((...args) => {
      this.registerNotification('info', ...args);
      return safeAddInfo.apply(atom.notifications, args);
    });
    spyOn(atom.notifications, 'addWarning').andCallFake((...args) => {
      this.registerNotification('warning', ...args);
      return safeAddWarning.apply(atom.notifications, args);
    });
    spyOn(atom.notifications, 'addError').andCallFake((...args) => {
      this.registerNotification('error', ...args);
      return safeAddError.apply(atom.notifications, args);
    });
    this.initialized = true;
  },
  cleanup() {
    this.notifications = [];
    delete this.lastNotification;
  },
  notificationsForLevel(level) {
    return this.notifications.filter(n => n.level === level);
  },
  newNotification() {
    const lastNotification = this.notifications[this.notifications.length - 1];
    const created = lastNotification != this.lastNotification;

    if (created) {
      this.lastNotification = lastNotification;
    }
    return created;
  },
  registerNotification(level, message, options) {
    const notification = {
      level,
      message,
      options,
    };
    this.notifications.push(notification);
  },

};

if (!NotificationsMock.initialized) {
  beforeEach(() => {
    NotificationsMock.initialize();
  });

  afterEach(() => {
    NotificationsMock.cleanup();
  });
}

module.exports = {
  buildContext,
  describeForTest,
  featureSetPath,
  inLiveEnvironment,
  itForExpectation,
  jsonPath,
  loadPayload,
  NotificationsMock,
  substituteFromContext,
  waitsFor,
  waitsForPromise,
  walk,
};
