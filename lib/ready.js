const os = require('os');
const path = require('path');
const StateController = require('kite-installer').StateController;

const utils = require('./utils.js');
const metrics = require('./metrics.js');
const Login = require('./elements/login.js');

// minimum time between showing the same notification, in milliseconds
const NOTIFY_DELAY = 60 * 60 * 1000;

var Ready = {
  currentPath: function() {
    var editor = atom.workspace.getActivePaneItem();
    if (editor === undefined || editor.buffer == undefined || editor.buffer.file == undefined) {
      return null;
    }
    return editor.buffer.file.path;
  },

  // lastRejected contains the last time the user rejected a notification for
  // the given state. It is used to prevent bugging the user too frequently with
  // notifications.
  lastRejected: {},

  // shouldNotify returns true if the user should be notified about the given
  // failure detected by ensure
  shouldNotify: function(state) {
    var now = new Date();
    var prev = this.lastRejected[state];
    return prev === undefined || (now.getTime() - prev.getTime()) >= NOTIFY_DELAY;
  },

  // ensure checks that Kite is installed, running, reachable, authenticated,
  // and enabled in the current directory. If any of these checks fail then an
  // appropriate noficiation is displayed with a button that lets the user fix
  // the problem.
  ensure: function(forceNotify=false) {
    var curpath = this.currentPath();
    StateController.handleState(curpath).then((state) => {
      switch (state) {
        case StateController.STATES.UNSUPPORTED:
          if (this.shouldNotify(state) || forceNotify) {
            this.warnNotSupported();
          }
          break;
        case StateController.STATES.UNINSTALLED:
          if (this.shouldNotify(state) || forceNotify) {
            this.warnNotInstalled();
          }
          break;
        case StateController.STATES.INSTALLED:
          if (this.shouldNotify(state) || forceNotify) {
            this.warnNotRunning();
          }
          break;
        case StateController.STATES.RUNNING:
          // for now, ignore this
          break;
        case StateController.STATES.REACHABLE:
          if (this.shouldNotify(state) || forceNotify) {
            this.warnNotAuthenticated();
          }
          break;
        case StateController.STATES.AUTHENTICATED:
          if (curpath !== null) {
            if (this.shouldNotify(state) || forceNotify) {
              this.warnNotWhitelisted(curpath);
            }
          } else if (forceNotify) {
            this.notifyReady();
          }
          break;
        case StateController.STATES.WHITELISTED:
          metrics.track("kite is ready");
          if (forceNotify) {
            this.notifyReady();
          }
          break;
      }
    }, (err) => {
      metrics.track("handleState failed", err);
    });
  },

  // ensureAndNotify is like ensure but also shows a success notification if Kite is already running.
  ensureAndNotify: function() {
    this.ensure(true);
  },

  warnNotSupported: function() {
    metrics.track("not-supported warning shown");
    atom.notifications.addError(
      "The Kite autocomplete daemon is not supported on this platform", {
      description: "Kite is currently only supported on macOS.",
      icon: "circle-slash",
      dismissable: true,
    }).onDidDismiss(() => {
      metrics.track("not-supported warning dismissed");
    });
  },

  warnNotInstalled: function() {
    var rejected = true;
    metrics.track("not-installed warning shown");
    var notification = atom.notifications.addWarning(
      "The Kite autocomplete daemon is not installed", {
      description: "In order to provide completions the Kite daemon needs to be installed.",
      icon: "circle-slash",
      dismissable: true,
      buttons: [{
        text: "Install Kite",
        onDidClick: () => {
          rejected = false;  // so that onDidDismiss knows that this was not a reject
          metrics.track("install button clicked (via not-installed warning)");
          notification.dismiss();
          this.install();
        }
      }]
    });
    notification.onDidDismiss(() => {
      if (rejected) {
        this.lastRejected[StateController.STATES.UNINSTALLED] = new Date();
        metrics.track("not-installed warning dismissed");
      }
    });
  },

  install: function() {
    metrics.track("download-and-install started");
    StateController.installKiteRelease().then(() => {
      metrics.track("download-and-install succeeded");
      this.launch();
    }, (err) => {
      metrics.track("download-and-install failed", err);

      // if install failed because kite is already installed then ignore
      var curState = err.data || 0;
      if (curState >= StateController.STATES.INSTALLED) {
        console.log("download-and-install failed because kite is already installed (state { curState })");
        return;
      }

      // show an error notification with an option to retry
      var notification = atom.notifications.addError("Unable to install Kite", {
        description: JSON.stringify(err),
        dismissable: true,
        buttons: [{
          text: "Retry",
          onDidClick: () => {
            metrics.track("retry button clicked (via download-and-install error)");
            notification.dismiss();
            this.install();
          }
        }]
      });
      notification.onDidDismiss(() => {
        metrics.track("download-and-install error dismissed");
      });
    });
  },

  warnNotRunning: function() {
    var rejected = true;
    metrics.track("not-running warning shown");
    var notification = atom.notifications.addWarning(
      "The Kite autocomplete daemon is not running", {
      description: "In order to provide completions the Kite daemon needs to be started.",
      icon: "circle-slash",
      dismissable: true,
      buttons: [{
        text: "Start Kite",
        onDidClick: () => {
          rejected = false;  // so that onDidDismiss knows that this was not a reject
          metrics.track("start button clicked (via not-running warning)");
          notification.dismiss();
          this.launch();
        }
      }]
    });
    notification.onDidDismiss(() => {
      if (rejected) {
        this.lastRejected[StateController.STATES.INSTALLED] = new Date();
        metrics.track("not-running warning dismissed");
      }
    });
  },

  launch: function() {
    metrics.track("launch started");
    StateController.runKiteAndWait().then(() => {
      metrics.track("launch succeeded");
      this.ensure();
    }, (err) => {
      metrics.track("launch failed", err);

      // if launch failed because kite is already running then ignore
      var curState = err.data || 0;
      if (curState >= StateController.STATES.RUNNING) {
        console.log("launch failed because kite is already installed (state { curState })");
        return;
      }

      // show an error notification with an option to retry
      var notification = atom.notifications.addError("Unable to start Kite autocomplete daemon", {
        description: JSON.stringify(err),
        dismissable: true,
        buttons: [{
          text: "Retry",
          onDidClick: () => {
            metrics.track("retry button clicked (via launch error)");
            notification.dismiss();
            this.launch();
          }
        }]
      });
      notification.onDidDismiss(() => {
        metrics.track("launch error dismissed");
      });
    });
  },

  // this situation is currently ignored, so this function is never called
  warnNotReachable: function() {
    metrics.track("not-reachable warning shown");
    atom.notifications.addError(
      "The Kite autocomplete daemon is running but not reachable", {
      description: "Try killing Kite from Activity Monitor.",
      dismissable: true,
    }).onDidDismiss(() => {
      metrics.track("not-reachable warning dismissed");
      this.lastRejected[StateController.STATES.RUNNING] = new Date();
    });
  },

  warnNotAuthenticated: function() {
    var rejected = true;
    metrics.track("not-authenticated warning shown");
    var notification = atom.notifications.addWarning(
      "You need to log in to the Kite autocomplete daemon", {
      description: "In order to provide completions the Kite daemon needs to be authenticated (so that it can access the index of your code stored on the cloud).",
      icon: "circle-slash",
      dismissable: true,
      buttons: [{
        text: "Login",
        onDidClick: () => {
          rejected = false;  // so that onDidDismiss knows that this was not a reject
          metrics.track("login button clicked (via not-authenticated warning)");
          notification.dismiss();
          this.authenticate();
        }
      }]
    });
    notification.onDidDismiss(() => {
      if (rejected) {
        this.lastRejected[StateController.STATES.REACHABLE] = new Date();
        metrics.track("not-authenticated warning dismissed");
      }
    });
  },

  authenticate: function() {
    var login = new Login();
    var panel = atom.workspace.addTopPanel({item: login.element});

    login.onCancel(() => {
      panel.destroy();
      login.destroy();
      metrics.track("cancel clicked in login panel");
    });

    login.onResetPassword(() => {
      metrics.track("reset password clicked in login panel");
      var url = `https://alpha.kite.com/account/resetPassword/request?email={ login.email }`;
      child_process.spawnSync('open', url);
      panel.destroy();
      login.destroy();
    });

    login.onSubmit(() => {
      var email = login.email;
      var password = login.password;
      panel.destroy();
      login.destroy();
      metrics.track("submit clicked in login panel", {email: email});

      metrics.track("authentication started", {email: email});
      StateController.authenticateUser(email, password).then(() => {
        metrics.track("authentication succeeded", {email: email});
        this.ensure();
      }, (err) => {
        metrics.track("authentication failed", err);

        // if authentication failed because kite is already authenticated then ignore
        var curState = err.data || 0;
        if (curState >= StateController.STATES.AUTHENTICATED) {
          console.log("launch failed because kite is already installed (state { curState })");
          return;
        }

        // show an error notification with an option to retry
        var notification = atom.notifications.addError("Unable to login", {
          description: JSON.stringify(err),
          dismissable: true,
          buttons: [{
            text: "Retry",
            onDidClick: () => {
              metrics.track("retry button clicked (via authentication error)");
              notification.dismiss();
              this.authenticate();
            }
          }]
        });
        notification.onDidDismiss(() => {
          metrics.track("authentication error dismissed");
        });
      });
    });
  },

  warnNotWhitelisted: function(filepath) {
    var dir = path.dirname(filepath);
    metrics.track("not-whitelisted warning shown", {dir: dir});

    var rejected = true;
    var notification = atom.notifications.addWarning(
      "Kite completions are not enabled for "+filepath, {
      description: "Kite only processes files in enabled directories. If you enable Kite then files in this directory will be synced to the Kite backend, where they will be analyzed and indexed.",
      icon: "circle-slash",
      dismissable: true,
      buttons: [{
        text: "Enable Kite for "+dir,
        onDidClick: () => {
          rejected = false;  // so that onDidDismiss knows that this was not a reject
          metrics.track("enable button clicked (via not-whitelisted warning)", {dir: dir});
          notification.dismiss();
          this.whitelist(dir);
        }
      }]
    });
    notification.onDidDismiss(() => {
      if (rejected) {
        metrics.track("not-whitelisted warning dismissed", {dir: dir});
        this.lastRejected[StateController.STATES.AUTHENTICATED] = new Date();
      }
    });
  },

  whitelist: function(dirpath) {
    metrics.track("whitelisting started", {dir: dirpath});
    StateController.whitelistPath(dirpath).then(() => {
      metrics.track("whitelisting succeeded", {dir: dirpath});
      this.ensure();
    }, (err) => {
      metrics.track("whitelisting failed", {dir: dirpath});

      // if whitelist failed because dir is already whitelisted then ignore
      var curState = err.data || 0;
      if (curState >= StateController.STATES.WHITELISTED) {
        console.log("whitelist failed because dir is already whitelisted (state { curState })");
        return;
      }

      // show an error notification with an option to retry
      var notification = atom.notifications.addError("Unable to enable Kite for "+dirpath, {
        description: JSON.stringify(err),
        dismissable: true,
        buttons: [{
          text: "Retry",
          onDidClick: () => {
            metrics.track("retry clicked (via whitelisting-failed error)", {dir: dirpath});
            notification.dismiss();
            this.whitelist(dirpath);
          }
        }]
      });
      notification.onDidDismiss(() => {
        metrics.track("whitelisting error dismissed");
      });
    });
  },

  notifyReady: function() {
    metrics.track("ready notification shown");
    atom.notifications.addSuccess(
      "The Kite autocomplete daemon is ready", {
      description: "We checked that the daemon is installed, running, responsive, and authenticated.",
      dismissable: true,
    }).onDidDismiss(() => {
      metrics.track("ready notification dismissed");
    });
  }
};

module.exports = Ready;