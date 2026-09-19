const fs = require('node:fs');
const path = require('node:path');
const { GH_BIN } = require('./context');
const { createRun, writeRunFile, completeRun } = require('./storage/run-artifacts');

// PR Lens 0.6.1 / graph schema 0.2.0. Keep inference in our existing tool-free
// reviewer; only validation and rendering run in the external CLI (no model API).
const GRAPH_PROMPT = [
  'Also return a "graph" object alongside "findings" for PR Lens schema 0.2.0.',
  'Graph shape: {"title":"Short change title","summary":"What changes",',
  '"lenses":["architecture"],"lanes":[{"id":"app","label":"Application"}],',
  '"nodes":[{"id":"module","label":"Module","kind":"module","delta":"modified",',
  '"lane":"app","files":[{"path":"src/module.js"}]}],"edges":[],"flows":[]}.',
  'Replace the example with entities evidenced by this diff; never invent unseen architecture.',
  'Do not emit provenance, stats, schemaVersion or kind at graph level; the runner supplies them.',
  'Use 1-16 lanes, 1-256 nodes and up to 512 edges. IDs: [A-Za-z0-9][A-Za-z0-9._:/-]*, max 128 chars.',
  'Node kind: service|app|module|function|route|job|queue|datastore|cache|external|ui|config|test|package|other.',
  'Delta on nodes, edges, flows and messages: added|modified|removed|unchanged.',
  'Edges: {id,from,to,kind,label}; kind: call|http|rpc|event|queue|data|dependency|render|other.',
  'Edges also require delta; from/to must reference declared nodes, lane must reference a declared lane.',
  'When the diff establishes an ordered sequence, add "data-flow" to lenses and a flow:',
  '{"id":"flow","title":"Sequence","delta":"modified","participants":[{"node":"a"},{"node":"b"}],',
  '"messages":[{"id":"step","from":"a","to":"b","label":"call","kind":"sync","delta":"modified"}]}.',
  'Each flow has 2-12 participants and 1-64 messages in execution order; endpoints must be participants.',
  'Message kind: sync|async|return|self (self requires identical endpoints, others require different ones).',
  'Keep labels <=120 characters and summaries <=2000; omit unsupported optional fields.'
].join('\n');

function prLensEnabled(option, env = process.env) {
  return option ?? /^(1|true|yes|on)$/i.test(String(env.GUARDEX_REVIEW_PR_LENS || '').trim());
}

function prLensCommand(repoRoot, env = process.env) {
  const bin = String(env.GUARDEX_PR_LENS_BIN || 'pr-lens').trim();
  return bin.includes('/') || bin.includes('\\') ? path.resolve(repoRoot, bin) : bin;
}

function runLens(bin, args, cwd, timeout, runner) {
  const result = runner(bin, args, { cwd, timeout });
  if (result.error || result.status !== 0) {
    throw new Error(
      `PR Lens ${args[0]} failed: ${result.error?.message || result.stderr || 'non-zero exit'}. ` +
        'Install @coldtea/pr-lens-cli@0.6.1 (Node >=20.11) or set GUARDEX_PR_LENS_BIN.'
    );
  }
}

function readPrLensMetadata(pr, repoRoot, runner) {
  const result = runner(
    GH_BIN,
    [
      'pr',
      'view',
      String(pr),
      '--json',
      'number,url,baseRefOid,headRefOid,additions,deletions,changedFiles'
    ],
    { cwd: repoRoot, timeout: 30_000 }
  );
  if (result.error || result.status !== 0) throw new Error('PR Lens could not read PR metadata');
  const data = JSON.parse(result.stdout);
  const url = new URL(data.url);
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
  if (
    url.protocol !== 'https:' ||
    !match ||
    String(data.number) !== String(pr) ||
    match[3] !== String(pr) ||
    !/^[a-f0-9]{40}$/.test(data.baseRefOid) ||
    !/^[a-f0-9]{40}$/.test(data.headRefOid) ||
    ![data.additions, data.deletions, data.changedFiles].every(
      (n) => Number.isSafeInteger(n) && n >= 0
    )
  ) {
    throw new Error('PR Lens received invalid PR metadata');
  }
  return {
    provenance: {
      repo: { owner: match[1], name: match[2], host: url.host },
      base: { sha: data.baseRefOid },
      head: { sha: data.headRefOid },
      pullRequest: { number: data.number, url: data.url }
    },
    stats: { filesChanged: data.changedFiles, additions: data.additions, deletions: data.deletions }
  };
}

function preparePrLens(pr, repoRoot, timeout, runner) {
  const bin = prLensCommand(repoRoot);
  runLens(bin, ['--help'], repoRoot, Math.min(timeout, 30_000), runner);
  return { bin, metadata: readPrLensMetadata(pr, repoRoot, runner) };
}

function renderPrLens(graph, context, pr, repoRoot, timeout, runner) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new Error('PR Lens graph missing from review response; rerun or use --no-pr-lens');
  }
  const current = readPrLensMetadata(pr, repoRoot, runner);
  if (JSON.stringify(current) !== JSON.stringify(context.metadata)) {
    throw new Error('PR changed during PR Lens review; rerun against the current diff');
  }
  const artifactRun = createRun(repoRoot);
  const graphPath = writeRunFile(
    artifactRun,
    'results',
    'graph.json',
    JSON.stringify({
      ...graph,
      schemaVersion: '0.2.0',
      kind: 'graph',
      ...context.metadata
    })
  );
  const directory = path.dirname(graphPath);
  // Explicit output and no-config avoid modifying .gitignore or loading config
  // from the reviewed checkout. Never call analyze or canvas (external uploads).
  runLens(context.bin, ['validate', graphPath], directory, timeout, runner);
  runLens(
    context.bin,
    ['render', graphPath, '--out', directory, '--no-config'],
    directory,
    timeout,
    runner
  );
  const manifestPath = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new Error('PR Lens produced no diagrams');
  }
  const diagrams = manifest.assets.map((asset) => {
    if (
      typeof asset.path !== 'string' ||
      path.basename(asset.path) !== asset.path ||
      !asset.path.endsWith('.svg') ||
      !fs.lstatSync(path.join(directory, asset.path)).isFile()
    ) {
      throw new Error('PR Lens produced an invalid diagram path');
    }
    return path.join(directory, asset.path);
  });
  completeRun(artifactRun);
  return { graphPath, manifestPath, diagrams };
}

module.exports = { GRAPH_PROMPT, prLensEnabled, preparePrLens, renderPrLens };
