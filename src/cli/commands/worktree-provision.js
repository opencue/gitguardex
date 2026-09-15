const { fs, path, TOOL_NAME } = require('../../context');
const { resolveRepoRoot, currentBranchName, readProtectedBranches } = require('../../git');
const { extractTargetedArgs } = require('../../core/runtime');
const {
  loadProvisionConfig,
  applyProvisionConfig,
  provisioningMode
} = require('../../scaffold/provision-config');
const {
  repositoryIdentity,
  requestApproval,
  revokeApproval
} = require('../../scaffold/provision-approvals');

function worktreeProvision(subcommand, args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'gx worktree approve-hooks [--target <repo>] [--revoke]\ngx worktree provision --source <repo> [--target <worktree>] [--with-defaults] [--mode minimal|docs|full]'
    );
    return;
  }
  const { target, passthrough } = extractTargetedArgs(args);
  const repoRoot = resolveRepoRoot(target);
  if (subcommand === 'approve-hooks') {
    if (passthrough.some((arg) => arg !== '--revoke'))
      throw new Error('Unexpected approval option; automatic approval is not supported');
    if (passthrough.includes('--revoke')) {
      revokeApproval(repoRoot);
      console.log(`[${TOOL_NAME}] Provision hook approval revoked.`);
      return;
    }
    const commands = loadProvisionConfig(repoRoot)?.postCreate || [];
    if (commands.length === 0) throw new Error('No postCreate commands configured');
    if (!requestApproval(repoRoot, commands))
      throw new Error('Hook approval requires explicit consent in an interactive terminal');
    console.log(
      `[${TOOL_NAME}] Approved the current postCreate command list; changes require new approval.`
    );
    return;
  }
  let source = '';
  let withDefaults = false;
  let mode;
  for (let index = 0; index < passthrough.length; index++) {
    const arg = passthrough[index];
    if (arg === '--with-defaults') withDefaults = true;
    else if (arg === '--mode' && passthrough[index + 1] && !passthrough[index + 1].startsWith('--'))
      mode = passthrough[++index];
    else if (
      arg === '--source' &&
      passthrough[index + 1] &&
      !passthrough[index + 1].startsWith('--')
    )
      source = passthrough[++index];
    else throw new Error(`Unexpected provisioning option: ${arg}`);
  }
  if (!source) throw new Error('Provisioning requires --source <repo>');
  mode = provisioningMode({ mode });
  source = resolveRepoRoot(source);
  if (
    source === repoRoot ||
    !fs.statSync(path.join(repoRoot, '.git')).isFile() ||
    repositoryIdentity(source) !== repositoryIdentity(repoRoot) ||
    readProtectedBranches(repoRoot).includes(currentBranchName(repoRoot))
  ) {
    throw new Error(
      'Provision target must be a non-protected linked worktree of the source repository'
    );
  }
  const config = loadProvisionConfig(source) || {
    files: { copy: [], symlink: [] },
    postCreate: []
  };
  if (withDefaults) {
    config.files.symlink = [
      ...new Set([
        ...config.files.symlink,
        '.venv',
        'node_modules',
        'apps/frontend/node_modules',
        'apps/backend/node_modules'
      ])
    ];
  }
  for (const operation of applyProvisionConfig(source, repoRoot, config, { mode })) {
    console.log(
      `[${TOOL_NAME}] provision ${operation.status}${operation.code ? ` ${operation.code}` : ''}: ${JSON.stringify(operation.file)} (${operation.note})`
    );
  }
}

module.exports = { worktreeProvision };
