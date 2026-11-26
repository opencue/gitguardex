const fs = require('node:fs');
const { StringDecoder } = require('node:string_decoder');

const stdinWaitArray = new Int32Array(new SharedArrayBuffer(4));

function sleepSyncMs(milliseconds) {
  Atomics.wait(stdinWaitArray, 0, 0, milliseconds);
}

function readSingleLineFromStdin(options = {}) {
  const fsModule = options.fsModule || fs;
  const input = options.input || process.stdin;
  const sleepSync = options.sleepSync || sleepSyncMs;
  const retryDelayMs = options.retryDelayMs == null ? 15 : options.retryDelayMs;
  const buffer = Buffer.alloc(1);
  const decoder = new StringDecoder('utf8');
  let text = '';

  while (true) {
    let bytesRead = 0;
    try {
      bytesRead = fsModule.readSync(input.fd, buffer, 0, 1);
    } catch (error) {
      if (error && ['EAGAIN', 'EWOULDBLOCK', 'EINTR'].includes(error.code)) {
        sleepSync(retryDelayMs);
        continue;
      }
      return text + decoder.end();
    }

    if (bytesRead === 0) {
      if (input.isTTY) {
        sleepSync(retryDelayMs);
        continue;
      }
      return text + decoder.end();
    }

    const char = decoder.write(buffer.subarray(0, bytesRead));
    if (!char) {
      continue;
    }
    if (char === '\n' || char === '\r') {
      return text;
    }
    text += char;
  }
}

module.exports = {
  readSingleLineFromStdin,
};
