const {
  test,
  assert,
  fs,
  os,
  path,
  initRepo,
  seedCommit
} = require('./helpers/install-test-helpers');
const cp = require('node:child_process');
const prRespond = require('../src/pr-respond');
const { MARKER } = require('../src/pr-review');

// ---------------------------------------------------------------------------
// Body parsing helpers — no gh calls
// ---------------------------------------------------------------------------

test('severityFromBody extracts severity from a gitguardex findingBody', () => {
  assert.equal(prRespond.severityFromBody('> 🔴 **CRITICAL** · correctness'), 'critical');
  assert.equal(prRespond.severityFromBody('> 🟠 **HIGH** · security'), 'high');
  assert.equal(prRespond.severityFromBody('> 🟡 **MEDIUM**'), 'medium');
  assert.equal(prRespond.severityFromBody('> 🔵 **LOW**'), 'low');
  assert.equal(prRespond.severityFromBody('no severity here'), '');
  assert.equal(prRespond.severityFromBody(''), '');
});

test('severityFromBody is case-insensitive', () => {
  assert.equal(prRespond.severityFromBody('**critical**'), 'critical');
  assert.equal(prRespond.severityFromBody('**High**'), 'high');
});

test('messageFromBody returns the first non-blockquote paragraph', () => {
  const body = [
    '> [!WARNING]',
    '> 🟠 **HIGH** · security',
    '',
    'This is the lede sentence about the bug.',
    'Second line of lede.',
    '',
    '<details><summary>Why this matters</summary>'
  ].join('\n');
  const msg = prRespond.messageFromBody(body);
  assert.match(msg, /lede sentence/);
});

test('messageFromBody returns empty string when no non-blockquote content', () => {
  const body = '> [!WARNING]\n> 🟠 **HIGH**\n';
  assert.equal(prRespond.messageFromBody(body), '');
});

test('suggestionFromBody extracts the fenced suggestion', () => {
  const body = 'some preamble\n```suggestion\nconst x = 1;\n```\ntrailing';
  assert.equal(prRespond.suggestionFromBody(body), 'const x = 1;');
});

test('suggestionFromBody returns empty string when no suggestion block', () => {
  assert.equal(prRespond.suggestionFromBody('no suggestion here'), '');
  assert.equal(prRespond.suggestionFromBody(''), '');
});

test('suggestionFromBody handles an unclosed block without throwing', () => {
  assert.equal(prRespond.suggestionFromBody('```suggestion\nconst x = 1;'), '');
});

// ---------------------------------------------------------------------------
// threadToFinding — structure tests
// ---------------------------------------------------------------------------

function makeThread(overrides = {}) {
  return {
    id: 'thread-1',
    isResolved: false,
    isOutdated: false,
    path: 'src/a.js',
    line: 10,
    startLine: 8,
    comments: {
      nodes: [
        {
          id: 'comment-1',
          body: [
            '> [!WARNING]',
            '> 🟠 **HIGH** · correctness',
            '',
            'The function leaks a file descriptor.',
            '',
            `\`\`\`suggestion\nfd.close();\n\`\`\``,
            '',
            `<!-- gitguardex:f:abc123 -->`,
            MARKER
          ].join('\n'),
          author: { login: 'gitguardex-bot' }
        }
      ]
    },
    ...overrides
  };
}

test('threadToFinding extracts path, line, severity, message, suggestion from a gitguardex thread', () => {
  const thread = makeThread();
  const finding = prRespond.threadToFinding(thread, 'gitguardex-bot');
  assert.equal(finding.path, 'src/a.js');
  assert.equal(finding.line, 10);
  assert.equal(finding.startLine, 8);
  assert.equal(finding.severity, 'high');
  assert.match(finding.message, /file descriptor/);
  assert.equal(finding.suggestion, 'fd.close();');
});

test('threadToFinding uses severity=high and message=body for a human reviewer thread', () => {
  const thread = makeThread({
    comments: {
      nodes: [
        {
          id: 'comment-h',
          body: 'Please rename this variable for clarity.',
          author: { login: 'reviewer-alice' }
        }
      ]
    }
  });
  const finding = prRespond.threadToFinding(thread, 'gitguardex-bot');
  assert.equal(finding.severity, 'high');
  assert.match(finding.message, /rename this variable/);
  assert.equal(finding.suggestion, '');
});

test('threadToFinding caps message at 500 characters', () => {
  const longBody = 'x'.repeat(700);
  const thread = makeThread({
    comments: {
      nodes: [{ id: 'c', body: longBody, author: { login: 'reviewer' } }]
    }
  });
  const finding = prRespond.threadToFinding(thread, 'gitguardex-bot');
  assert.ok(finding.message.length <= 500);
});

// ---------------------------------------------------------------------------
// fetchBlockingThreads — runner fakes
// ---------------------------------------------------------------------------

function makeGhRunner({
  login = 'gitguardex-bot',
  isCrossRepository = false,
  threads = [],
  reviews = []
} = {}) {
  return (_cmd, args, _opts) => {
    // gh repo view (slug lookup)
    if (args[0] === 'repo' && args[1] === 'view') {
      return { status: 0, stdout: 'opencue/gitguardex\n', stderr: '' };
    }
    // gh pr view (meta)
    if (args[0] === 'pr' && args[1] === 'view') {
      return {
        status: 0,
        stdout: JSON.stringify({ headRefName: 'agent/test/fix', isCrossRepository }),
        stderr: ''
      };
    }
    // GraphQL
    const operation = args.find((a) => String(a).startsWith('query=')) || '';
    if (operation.includes('reviewThreads')) {
      return {
        status: 0,
        stdout: JSON.stringify({
          data: {
            viewer: { login },
            repository: {
              pullRequest: {
                reviews: { nodes: reviews },
                reviewThreads: {
                  nodes: threads,
                  pageInfo: { hasNextPage: false }
                }
              }
            }
          }
        }),
        stderr: ''
      };
    }
    return { status: 1, stdout: '', stderr: `unexpected gh call: ${args.join(' ')}` };
  };
}

test('fetchBlockingThreads returns empty array when no threads exist', () => {
  const runner = makeGhRunner({ threads: [] });
  const { threads } = prRespond.fetchBlockingThreads('42', '/repo', runner);
  assert.deepEqual(threads, []);
});

test('fetchBlockingThreads returns CRITICAL and HIGH gitguardex threads', () => {
  const criticalThread = {
    id: 'thread-critical',
    isResolved: false,
    isOutdated: false,
    path: 'src/a.js',
    line: 5,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c1',
          body: `> 🔴 **CRITICAL** · security\n\nSQL injection.\n\n${MARKER}`,
          author: { login: 'gitguardex-bot' }
        }
      ]
    }
  };
  const mediumThread = {
    id: 'thread-medium',
    isResolved: false,
    isOutdated: false,
    path: 'src/b.js',
    line: 10,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c2',
          body: `> 🟡 **MEDIUM** · maintainability\n\nRefactor.\n\n${MARKER}`,
          author: { login: 'gitguardex-bot' }
        }
      ]
    }
  };
  const runner = makeGhRunner({ threads: [criticalThread, mediumThread] });
  const { threads } = prRespond.fetchBlockingThreads('42', '/repo', runner);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, 'thread-critical');
});

test('fetchBlockingThreads includes HIGH threads', () => {
  const highThread = {
    id: 'thread-high',
    isResolved: false,
    isOutdated: false,
    path: 'src/c.js',
    line: 3,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c3',
          body: `> 🟠 **HIGH** · correctness\n\nNull deref.\n\n${MARKER}`,
          author: { login: 'gitguardex-bot' }
        }
      ]
    }
  };
  const runner = makeGhRunner({ threads: [highThread] });
  const { threads } = prRespond.fetchBlockingThreads('42', '/repo', runner);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, 'thread-high');
});

test('fetchBlockingThreads skips resolved and outdated threads', () => {
  const resolved = {
    id: 'thread-resolved',
    isResolved: true,
    isOutdated: false,
    path: 'src/a.js',
    line: 1,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c1',
          body: `> 🔴 **CRITICAL**\n\nBug.\n\n${MARKER}`,
          author: { login: 'gitguardex-bot' }
        }
      ]
    }
  };
  const outdated = {
    id: 'thread-outdated',
    isResolved: false,
    isOutdated: true,
    path: 'src/b.js',
    line: 2,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c2',
          body: `> 🟠 **HIGH**\n\nFix.\n\n${MARKER}`,
          author: { login: 'gitguardex-bot' }
        }
      ]
    }
  };
  const runner = makeGhRunner({ threads: [resolved, outdated] });
  const { threads } = prRespond.fetchBlockingThreads('42', '/repo', runner);
  assert.deepEqual(threads, []);
});

test('fetchBlockingThreads includes threads from human reviewers who requested changes', () => {
  const humanThread = {
    id: 'thread-human',
    isResolved: false,
    isOutdated: false,
    path: 'src/d.js',
    line: 7,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c4',
          body: 'Please rename this for clarity.',
          author: { login: 'reviewer-alice' }
        }
      ]
    }
  };
  const reviews = [{ author: { login: 'reviewer-alice' }, state: 'CHANGES_REQUESTED' }];
  const runner = makeGhRunner({ threads: [humanThread], reviews });
  const { threads } = prRespond.fetchBlockingThreads('42', '/repo', runner);
  assert.equal(threads.length, 1);
  assert.equal(threads[0].id, 'thread-human');
});

test('fetchBlockingThreads excludes human threads when reviewer later approved', () => {
  const humanThread = {
    id: 'thread-stale',
    isResolved: false,
    isOutdated: false,
    path: 'src/f.js',
    line: 3,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c-stale',
          body: 'Please rename.',
          author: { login: 'reviewer-bob' }
        }
      ]
    }
  };
  // reviewer-bob first requested changes, then approved — latest state is APPROVED.
  const reviews = [
    { author: { login: 'reviewer-bob' }, state: 'CHANGES_REQUESTED' },
    { author: { login: 'reviewer-bob' }, state: 'APPROVED' }
  ];
  const runner = makeGhRunner({ threads: [humanThread], reviews });
  const { threads } = prRespond.fetchBlockingThreads('42', '/repo', runner);
  assert.deepEqual(threads, []);
});

test('fetchBlockingThreads skips human thread when bot already replied (waiting for reviewer)', () => {
  const humanThread = {
    id: 'thread-bot-replied',
    isResolved: false,
    isOutdated: false,
    path: 'src/x.js',
    line: 12,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c-human',
          body: 'Please add error handling here.',
          author: { login: 'reviewer-dave' }
        }
      ]
    },
    // Simulate the bot having already replied — latestComment is from the bot.
    latestComment: {
      nodes: [
        {
          id: 'c-bot-reply',
          body: `${MARKER}\nApplied fix in abc12345.\nPlease review the fix and resolve this thread when satisfied.`,
          author: { login: 'gitguardex-bot' }
        }
      ]
    }
  };
  const reviews = [{ author: { login: 'reviewer-dave' }, state: 'CHANGES_REQUESTED' }];
  const runner = makeGhRunner({ threads: [humanThread], reviews });
  const { threads } = prRespond.fetchBlockingThreads('42', '/repo', runner);
  assert.deepEqual(threads, [], 'thread should be skipped because bot already replied');
});

test('fetchBlockingThreads re-queues human thread when reviewer replies after bot (human is latest)', () => {
  const humanThread = {
    id: 'thread-reviewer-replied',
    isResolved: false,
    isOutdated: false,
    path: 'src/y.js',
    line: 5,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c-human',
          body: 'Please add error handling here.',
          author: { login: 'reviewer-eve' }
        }
      ]
    },
    // Reviewer replied after the bot — latest comment is from the reviewer.
    latestComment: {
      nodes: [
        {
          id: 'c-reviewer-reply',
          body: 'Actually, also handle the timeout case.',
          author: { login: 'reviewer-eve' }
        }
      ]
    }
  };
  const reviews = [{ author: { login: 'reviewer-eve' }, state: 'CHANGES_REQUESTED' }];
  const runner = makeGhRunner({ threads: [humanThread], reviews });
  const { threads } = prRespond.fetchBlockingThreads('42', '/repo', runner);
  assert.equal(threads.length, 1, 'thread should be re-queued because reviewer replied');
  assert.equal(threads[0].id, 'thread-reviewer-replied');
});

test('fetchBlockingThreads excludes human threads when reviewer commented after CHANGES_REQUESTED (COMMENTED does not clear blocking)', () => {
  const humanThread = {
    id: 'thread-commented',
    isResolved: false,
    isOutdated: false,
    path: 'src/g.js',
    line: 5,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c-commented',
          body: 'Add a null check here.',
          author: { login: 'reviewer-carol' }
        }
      ]
    }
  };
  // reviewer-carol requested changes, then left a COMMENTED review — COMMENTED must not clear CR.
  const reviews = [
    { author: { login: 'reviewer-carol' }, state: 'CHANGES_REQUESTED' },
    { author: { login: 'reviewer-carol' }, state: 'COMMENTED' }
  ];
  const runner = makeGhRunner({ threads: [humanThread], reviews });
  const { threads } = prRespond.fetchBlockingThreads('42', '/repo', runner);
  assert.equal(threads.length, 1, 'COMMENTED should not override CHANGES_REQUESTED');
  assert.equal(threads[0].id, 'thread-commented');
});

test('fetchBlockingThreads excludes LEFT-side diff threads (deleted-line coordinates)', () => {
  const botLogin = 'gitguardex-bot'; // must match makeGhRunner default login
  const leftThread = {
    id: 'thread-left',
    isResolved: false,
    isOutdated: false,
    diffSide: 'LEFT',
    path: 'src/h.js',
    line: 10,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c-left',
          body: `> 🟠 **HIGH** · correctness\n\nDeleted line issue.\n\n${MARKER}`,
          author: { login: botLogin }
        }
      ]
    }
  };
  const rightThread = {
    id: 'thread-right',
    isResolved: false,
    isOutdated: false,
    diffSide: 'RIGHT',
    path: 'src/h.js',
    line: 12,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c-right',
          body: `> 🟠 **HIGH** · correctness\n\nRight-side issue.\n\n${MARKER}`,
          author: { login: botLogin }
        }
      ]
    }
  };
  const runner = makeGhRunner({ threads: [leftThread, rightThread], reviews: [] });
  const { threads } = prRespond.fetchBlockingThreads('42', '/repo', runner);
  assert.equal(threads.length, 1, 'only RIGHT-side thread should remain');
  assert.equal(threads[0].id, 'thread-right');
});

test('fetchBlockingThreads does not include human threads from non-CHANGES_REQUESTED reviewers', () => {
  const humanThread = {
    id: 'thread-human',
    isResolved: false,
    isOutdated: false,
    path: 'src/e.js',
    line: 4,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c5',
          body: 'LGTM but optional refactor.',
          author: { login: 'commenter-bob' }
        }
      ]
    }
  };
  const runner = makeGhRunner({ threads: [humanThread], reviews: [] });
  const { threads } = prRespond.fetchBlockingThreads('42', '/repo', runner);
  assert.deepEqual(threads, []);
});

test('fetchBlockingThreads throws when review history is truncated (hasPreviousPage=true)', () => {
  const runner = (_cmd, args, _opts) => {
    if (args[0] === 'repo') return { status: 0, stdout: 'opencue/gitguardex\n', stderr: '' };
    const operation = args.find((a) => String(a).startsWith('query=')) || '';
    if (operation.includes('reviewThreads')) {
      return {
        status: 0,
        stdout: JSON.stringify({
          data: {
            viewer: { login: 'bot' },
            repository: {
              pullRequest: {
                reviews: { nodes: [], pageInfo: { hasPreviousPage: true } },
                reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } }
              }
            }
          }
        }),
        stderr: ''
      };
    }
    return { status: 1, stdout: '', stderr: '' };
  };
  assert.throws(
    () => prRespond.fetchBlockingThreads('42', '/repo', runner),
    /more than 50 reviews/
  );
});

test('fetchBlockingThreads throws when more than 100 threads (refuses partial fix)', () => {
  const runner = (_cmd, args, _opts) => {
    if (args[0] === 'repo') return { status: 0, stdout: 'opencue/gitguardex\n', stderr: '' };
    const operation = args.find((a) => String(a).startsWith('query=')) || '';
    if (operation.includes('reviewThreads')) {
      return {
        status: 0,
        stdout: JSON.stringify({
          data: {
            viewer: { login: 'bot' },
            repository: {
              pullRequest: {
                reviews: { nodes: [] },
                reviewThreads: {
                  nodes: [],
                  pageInfo: { hasNextPage: true }
                }
              }
            }
          }
        }),
        stderr: ''
      };
    }
    return { status: 1, stdout: '', stderr: '' };
  };
  assert.throws(() => prRespond.fetchBlockingThreads('42', '/repo', runner), /more than 100/);
});

// ---------------------------------------------------------------------------
// prRespond — refusal logic
// ---------------------------------------------------------------------------

test('prRespond refuses when --pr is missing', () => {
  const result = prRespond.prRespond({ target: '/repo' });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /--pr/);
});

test('prRespond refuses fork PRs', () => {
  const runner = (cmd, args) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      return {
        status: 0,
        stdout: JSON.stringify({ headRefName: 'agent/fix', isCrossRepository: true }),
        stderr: ''
      };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  const result = prRespond.prRespond({ pr: '42', target: '/repo' }, { run: runner });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /fork/);
});

test('prRespond refuses non-agent/* branches', () => {
  const runner = (cmd, args) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      return {
        status: 0,
        stdout: JSON.stringify({ headRefName: 'feat/my-feature', isCrossRepository: false }),
        stderr: ''
      };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  const result = prRespond.prRespond({ pr: '42', target: '/repo' }, { run: runner });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /agent\//);
});

test('prRespond refuses when no local worktree is found for the branch', () => {
  // initRepo creates a real repo but no extra worktrees.
  const repoDir = initRepo();
  seedCommit(repoDir);

  const runner = (cmd, args, opts) => {
    if (cmd === 'git' && args.includes('--show-toplevel')) {
      return { status: 0, stdout: repoDir + '\n', stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      return {
        status: 0,
        stdout: JSON.stringify({ headRefName: 'agent/test/fix', isCrossRepository: false }),
        stderr: ''
      };
    }
    // Delegate real git commands through.
    const result = cp.spawnSync(cmd, args, {
      cwd: (opts && opts.cwd) || repoDir,
      encoding: 'utf8'
    });
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  };

  const result = prRespond.prRespond({ pr: '42', target: repoDir }, { run: runner });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /no local worktree/);
});

// ---------------------------------------------------------------------------
// prRespond — dry-run path
// ---------------------------------------------------------------------------

test('prRespond dry-run returns findings without touching the worktree', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  // Create an agent/* worktree for the PR branch.
  // Use 'git branch' (not 'checkout -b') so the branch is not checked out in repoDir;
  // worktree add requires the branch to be absent from the main checkout.
  const wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-wt-'));
  cp.spawnSync('git', ['-C', repoDir, 'branch', 'agent/test/dry'], { encoding: 'utf8' });
  cp.spawnSync('git', ['-C', repoDir, 'worktree', 'add', wtDir, 'agent/test/dry'], {
    encoding: 'utf8'
  });

  const highThread = {
    id: 'thread-high',
    isResolved: false,
    isOutdated: false,
    path: 'src/a.js',
    line: 5,
    startLine: null,
    comments: {
      nodes: [
        {
          id: 'c1',
          body: `> 🟠 **HIGH** · security\n\nNull deref.\n\n${MARKER}`,
          author: { login: 'gx-bot' }
        }
      ]
    }
  };

  const runner = (cmd, args, opts) => {
    if (args[0] === 'repo' && args[1] === 'view') {
      return { status: 0, stdout: 'opencue/gitguardex\n', stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      return {
        status: 0,
        stdout: JSON.stringify({ headRefName: 'agent/test/dry', isCrossRepository: false }),
        stderr: ''
      };
    }
    const operation = args.find((a) => String(a).startsWith('query=')) || '';
    if (operation.includes('reviewThreads')) {
      return {
        status: 0,
        stdout: JSON.stringify({
          data: {
            viewer: { login: 'gx-bot' },
            repository: {
              pullRequest: {
                reviews: { nodes: [] },
                reviewThreads: { nodes: [highThread], pageInfo: { hasNextPage: false } }
              }
            }
          }
        }),
        stderr: ''
      };
    }
    // Pass through real git calls.
    const result = cp.spawnSync(cmd, args, {
      cwd: opts && opts.cwd ? opts.cwd : repoDir,
      encoding: 'utf8'
    });
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  };

  const result = prRespond.prRespond({ pr: '42', target: repoDir, dryRun: true }, { run: runner });
  assert.equal(result.status, 'dry-run');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].severity, 'high');
  // Worktree must be clean — no fix was applied.
  const status = cp.spawnSync('git', ['-C', wtDir, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.equal(status.stdout.trim(), '');

  // Cleanup
  cp.spawnSync('git', ['-C', repoDir, 'worktree', 'remove', wtDir, '--force'], {
    encoding: 'utf8'
  });
});

// ---------------------------------------------------------------------------
// replyToThread / resolveThread — runner fakes
// ---------------------------------------------------------------------------

test('replyToThread calls the addPullRequestReviewThreadReply mutation', () => {
  const calls = [];
  const runner = (_cmd, args) => {
    calls.push(args);
    return {
      status: 0,
      stdout: '{"data":{"addPullRequestReviewThreadReply":{"comment":{"id":"new-comment"}}}}',
      stderr: ''
    };
  };
  const result = prRespond.replyToThread('thread-abc', 'Fixed in abc123.', '/repo', runner);
  assert.equal(result.ok, true);
  assert.ok(
    calls.some((a) => a.some((arg) => String(arg).includes('addPullRequestReviewThreadReply')))
  );
});

test('replyToThread returns ok=false on gh failure', () => {
  const runner = () => ({ status: 1, stdout: '', stderr: 'network error' });
  const result = prRespond.replyToThread('thread-x', 'body', '/repo', runner);
  assert.equal(result.ok, false);
  assert.match(result.output, /network error/);
});

test('resolveThread calls resolveReviewThread mutation and returns ok=true', () => {
  const calls = [];
  const runner = (_cmd, args) => {
    calls.push(args);
    return {
      status: 0,
      stdout: '{"data":{"resolveReviewThread":{"thread":{"isResolved":true}}}}',
      stderr: ''
    };
  };
  const result = prRespond.resolveThread('thread-abc', '/repo', runner);
  assert.equal(result.ok, true);
  assert.ok(calls.some((a) => a.some((arg) => String(arg).includes('resolveReviewThread'))));
});

test('resolveThread returns ok=false when GitHub says not resolved', () => {
  const runner = () => ({
    status: 0,
    stdout: '{"data":{"resolveReviewThread":{"thread":{"isResolved":false}}}}',
    stderr: ''
  });
  const result = prRespond.resolveThread('thread-x', '/repo', runner);
  assert.equal(result.ok, false);
});

test('resolveThread returns ok=false on GraphQL errors', () => {
  const runner = () => ({
    status: 0,
    stdout: '{"errors":[{"message":"cannot resolve"}]}',
    stderr: ''
  });
  const result = prRespond.resolveThread('thread-x', '/repo', runner);
  assert.equal(result.ok, false);
  assert.match(result.output, /cannot resolve/);
});

// ---------------------------------------------------------------------------
// fetchPrMeta
// ---------------------------------------------------------------------------

test('fetchPrMeta returns headRefName, headRefOid and isCrossRepository', () => {
  const runner = (_cmd, args) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      return {
        status: 0,
        stdout: JSON.stringify({
          headRefName: 'agent/test/my-fix',
          headRefOid: 'abc123def456abc123def456abc123def456abc1',
          isCrossRepository: false
        }),
        stderr: ''
      };
    }
    return { status: 1, stdout: '', stderr: '' };
  };
  const meta = prRespond.fetchPrMeta('7', '/repo', runner);
  assert.equal(meta.headRefName, 'agent/test/my-fix');
  assert.equal(meta.headRefOid, 'abc123def456abc123def456abc123def456abc1');
  assert.equal(meta.isCrossRepository, false);
});

test('fetchPrMeta throws when gh pr view fails', () => {
  const runner = () => ({ status: 1, stdout: '', stderr: 'not found' });
  assert.throws(() => prRespond.fetchPrMeta('7', '/repo', runner), /not found/);
});

// ---------------------------------------------------------------------------
// prRespond — no blocking threads
// ---------------------------------------------------------------------------

test('prRespond returns no-threads when the PR has no actionable threads', () => {
  const repoDir = initRepo();
  seedCommit(repoDir);
  // Use 'git branch' so the branch is not checked out in repoDir — worktree add
  // requires the branch to be absent from the main checkout.
  cp.spawnSync('git', ['-C', repoDir, 'branch', 'agent/empty-fix'], { encoding: 'utf8' });
  const wtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardex-wt-'));
  cp.spawnSync('git', ['-C', repoDir, 'worktree', 'add', wtDir, 'agent/empty-fix'], {
    encoding: 'utf8'
  });

  const runner = (cmd, args, opts) => {
    if (args[0] === 'repo' && args[1] === 'view') {
      return { status: 0, stdout: 'opencue/gitguardex\n', stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      return {
        status: 0,
        stdout: JSON.stringify({ headRefName: 'agent/empty-fix', isCrossRepository: false }),
        stderr: ''
      };
    }
    const operation = args.find((a) => String(a).startsWith('query=')) || '';
    if (operation.includes('reviewThreads')) {
      return {
        status: 0,
        stdout: JSON.stringify({
          data: {
            viewer: { login: 'gx-bot' },
            repository: {
              pullRequest: {
                reviews: { nodes: [] },
                reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } }
              }
            }
          }
        }),
        stderr: ''
      };
    }
    const result = cp.spawnSync(cmd, args, {
      cwd: opts && opts.cwd ? opts.cwd : repoDir,
      encoding: 'utf8'
    });
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  };

  const result = prRespond.prRespond({ pr: '99', target: repoDir }, { run: runner });
  assert.equal(result.status, 'no-threads');

  cp.spawnSync('git', ['-C', repoDir, 'worktree', 'remove', wtDir, '--force'], {
    encoding: 'utf8'
  });
});
