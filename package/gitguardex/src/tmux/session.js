const tmux = require('./command');

function requireName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TypeError('tmux session name must be a non-empty string');
  }
  return name;
}

function addCwd(args, cwd) {
  if (cwd !== undefined) {
    if (typeof cwd !== 'string' || cwd.trim() === '') {
      throw new TypeError('tmux cwd must be a non-empty string');
    }
    args.push('-c', cwd);
  }
}

function ensureTmuxAvailable() {
  if (tmux.isTmuxAvailable()) return;
  throw new Error('tmux is required for gx cockpit. Install tmux and retry.');
}

function sessionExists(name) {
  const result = tmux.runTmux(['has-session', '-t', requireName(name)], {
    stdio: 'pipe',
  });
  return result.status === 0;
}

function createSession(name, cwd) {
  const args = ['new-session', '-d', '-s', requireName(name)];
  addCwd(args, cwd);
  return tmux.runTmux(args);
}

function attachSession(name) {
  return tmux.runTmux(['attach-session', '-t', requireName(name)], {
    stdio: 'inherit',
  });
}

function newWindowOrPane(options = {}) {
  const {
    target,
    cwd,
    name,
    pane = false,
    split = 'vertical',
  } = options;
  const args = pane ? ['split-window'] : ['new-window'];

  if (pane) {
    if (split === 'horizontal') {
      args.push('-h');
    } else if (split === 'vertical') {
      args.push('-v');
    } else {
      throw new TypeError('tmux split must be horizontal or vertical');
    }
  }
  if (target !== undefined) {
    args.push('-t', requireName(target));
  }
  if (!pane && name !== undefined) {
    args.push('-n', requireName(name));
  }
  addCwd(args, cwd);
  return tmux.runTmux(args);
}

function sendKeys(paneId, command) {
  if (typeof paneId !== 'string' || paneId.trim() === '') {
    throw new TypeError('tmux pane id must be a non-empty string');
  }
  if (typeof command !== 'string') {
    throw new TypeError('tmux command must be a string');
  }
  return tmux.runTmux(['send-keys', '-t', paneId, command, 'C-m']);
}

module.exports = {
  ensureTmuxAvailable,
  sessionExists,
  createSession,
  attachSession,
  newWindowOrPane,
  sendKeys,
};
