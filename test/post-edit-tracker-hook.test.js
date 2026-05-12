const test = require('node:test');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

test('PostToolUse edit tracker runs on Python 3.10 compatible datetime APIs', () => {
  const payload = JSON.stringify({
    session_id: 'python-compat',
    cwd: repoRoot,
    tool_input: {
      file_path: path.join(repoRoot, 'README.md'),
    },
  });

  const result = cp.spawnSync('python3', ['.claude/hooks/post_edit_tracker.py'], {
    cwd: repoRoot,
    input: payload,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
