'use client'

import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

type ModeKey = 'execute' | 'plan' | 'merge' | 'installation'

type MessageKind =
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'hint'
  | 'tool'
  | 'conflict'
  | 'plan-list'

type ToolRowKind = 'shell' | 'read' | 'write' | 'tool'
type WorktreeKind = 'active' | 'readonly' | 'merge'
type FileStatus = 'U' | 'M' | 'D' | 'ok' | 'conflict'
type FileExt = 'rs' | 'ts' | 'tsx' | 'md' | 'yaml' | 'py' | 'sh' | 'default'

interface ToolRow {
  kind: ToolRowKind
  label: string
  value: string
}

interface ToolMessage {
  kind: 'tool'
  title: string
  sub?: string
  elapsed?: string
  rows: ToolRow[]
}

interface PlanListMessage {
  kind: 'plan-list'
  items: Array<{ title: string; meta?: string }>
}

interface TextMessage {
  kind: Exclude<MessageKind, 'tool' | 'plan-list'>
  content: ReactNode
}

type StepMessage = TextMessage | ToolMessage | PlanListMessage

interface FileEntry {
  path: string
  status: FileStatus
  ext: FileExt
}

interface WorktreeRow {
  id: string
  name: string
  branch: string
  kind: WorktreeKind
  message?: string
  tag?: string
  files?: FileEntry[]
  commitReady?: boolean
  commitState?: 'idle' | 'ready' | 'approved'
  pulling?: boolean
  showPullBar?: boolean
}

interface CodeLinePart {
  token?: 'k' | 'f' | 't' | 's' | 'c' | 'n' | 'p' | ''
  text: string
}

type LineKind = 'normal' | 'added' | 'removed'

interface CodeLine {
  kind?: LineKind
  parts: CodeLinePart[]
  typing?: boolean
}

interface EditorTab {
  path: string
  label: string
  ext: FileExt
  active?: boolean
  state?: 'normal' | 'conflict' | 'resolved'
  badge?: string
}

interface TutorialStep {
  stepLabel: string
  label: string
  description: ReactNode
  messages: StepMessage[]
  branch: string
  tabs: EditorTab[]
  worktrees: WorktreeRow[]
  codeLines: CodeLine[]
  statusBranch?: string
  statusErrors?: number
  statusSync?: string
  activityChangeCount?: number
  pulseEditor?: boolean
  showPullAnimation?: boolean
}

interface ModeConfig {
  key: ModeKey
  label: string
  dotClass: 'a' | 'p' | 'm' | 'i'
  steps: TutorialStep[]
}

interface ModeGuide {
  eyebrow: string
  title: string
  summary: string
  highlights: string[]
}

const MODE_ORDER: ModeKey[] = ['execute', 'plan', 'merge', 'installation']
const INSTALL_COMMAND = 'npm i -g @imdeadpool/guardex'
const PRODUCT_LABEL = 'Recodee'
const EDITOR_LABEL = 'recodee — VS Code'

const extFromPath = (path: string): FileExt => {
  const dot = path.lastIndexOf('.')
  if (dot === -1) return 'default'
  const ext = path.slice(dot + 1).toLowerCase()
  if (ext === 'rs' || ext === 'ts' || ext === 'tsx' || ext === 'md' || ext === 'py' || ext === 'sh') {
    return ext
  }
  if (ext === 'yml' || ext === 'yaml') return 'yaml'
  return 'default'
}

const file = (path: string, status: FileStatus): FileEntry => ({
  path,
  status,
  ext: extFromPath(path),
})

const c = (text: string, token: CodeLinePart['token'] = ''): CodeLinePart => ({ text, token })

const planListHint = (items: Array<{ title: string; meta?: string }>): PlanListMessage => ({
  kind: 'plan-list',
  items,
})

const EXECUTE_STEPS: TutorialStep[] = [
  {
    stepLabel: 'Step 01',
    label: 'Prompt the agent',
    description: (
      <>
        Every session starts with a prompt. Pick your model, reasoning level, and access mode — then
        type what you want done.
      </>
    ),
    messages: [
      {
        kind: 'user',
        content: (
          <>
            <strong>You</strong>: Port the dashboard usage slice from Python to Rust. Keep tests
            green.
            <br />
            <br />
            <span className="mono" style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
              gpt-5.4 · reasoning high · On-Request
            </span>
          </>
        ),
      },
    ],
    branch: 'dev',
    tabs: [],
    worktrees: [],
    codeLines: [
      { parts: [c('// Advance the tutorial to watch an agent spin up a sandbox', 'c')] },
      { parts: [c('// worktree and edit code.', 'c')] },
    ],
    statusBranch: 'dev',
  },
  {
    stepLabel: 'Step 02',
    label: 'Agent explores the repo',
    description: (
      <>
        Before writing anything, the agent reads skills, checks git state, and surveys the files it
        might touch — in read-only mode.
      </>
    ),
    messages: [
      {
        kind: 'assistant',
        content: (
          <>
            I&rsquo;ll load the repo skills and inspect the current Python + Rust wiring before
            making any edits.
          </>
        ),
      },
      {
        kind: 'tool',
        title: '3 tool calls',
        sub: '· context-gathering',
        elapsed: '1.2s',
        rows: [
          { kind: 'tool', label: 'tool:', value: 'state_list_active' },
          { kind: 'read', label: 'read:', value: 'recodee/CLAUDE.md' },
          { kind: 'read', label: 'read:', value: 'recodee/docs/migrations/multica-01.md' },
        ],
      },
    ],
    branch: 'dev',
    tabs: [],
    worktrees: [],
    codeLines: [
      { parts: [c('// Read-only exploration — no writes yet.', 'c')] },
      { parts: [c('// Dev branch stays untouched.', 'c')] },
    ],
    statusBranch: 'dev',
  },
  {
    stepLabel: 'Step 03',
    label: 'Worktree sandbox created',
    description: (
      <>
        Before any write, the agent creates an isolated <strong>git worktree</strong> — a sandbox
        branch off <code>dev</code>. Dev stays clean no matter what.
      </>
    ),
    messages: [
      {
        kind: 'thinking',
        content: (
          <>
            Need to isolate these edits. Creating{' '}
            <code>agent/codex/dashboard-rust-port-421</code> off dev.
          </>
        ),
      },
      {
        kind: 'tool',
        title: '1 tool call',
        sub: '· scripts/agent-branch-start.sh',
        elapsed: '0.4s',
        rows: [
          { kind: 'shell', label: 'bash:', value: 'scripts/agent-branch-start.sh "dashboard-rust-port"' },
        ],
      },
    ],
    branch: 'agent/codex/dashboard-rust-port-421',
    tabs: [],
    worktrees: [
      {
        id: 'wt-dashboard',
        name: 'agent_codex__dashboard-rust-port-421',
        branch: 'agent/codex/dashboard-rust-port-421',
        kind: 'active',
        message: 'Message (Ctrl+Enter to commit on "agent/codex/dashboard-rust-port-421")',
      },
    ],
    codeLines: [
      { parts: [c('// Sandbox worktree attached — writes land here only.', 'c')] },
    ],
    statusBranch: 'agent/codex/dashboard-rust-port-421',
  },
  {
    stepLabel: 'Step 04',
    label: 'Agent edits files in the sandbox',
    description: (
      <>
        The agent writes to files <em>only inside its worktree</em>. Watch files appear in Source
        Control and the diff stream into the editor.
      </>
    ),
    messages: [
      {
        kind: 'assistant',
        content: (
          <>
            Writing the Rust reader in <code>crates/multica-dashboard/src/reader.rs</code> and wiring
            the feature flag.
          </>
        ),
      },
      {
        kind: 'tool',
        title: '3 tool calls',
        sub: '· writing files',
        elapsed: '2.1s',
        rows: [
          { kind: 'write', label: 'write:', value: 'crates/multica-dashboard/src/reader.rs' },
          { kind: 'write', label: 'write:', value: 'crates/multica-dashboard/src/mod.rs' },
          { kind: 'write', label: 'write:', value: 'apps/dashboard/src/feature-flags.ts' },
        ],
      },
    ],
    branch: 'agent/codex/dashboard-rust-port-421',
    tabs: [
      { path: 'reader.rs', label: 'reader.rs', ext: 'rs', active: true },
    ],
    worktrees: [
      {
        id: 'wt-dashboard',
        name: 'agent_codex__dashboard-rust-port-421',
        branch: 'agent/codex/dashboard-rust-port-421',
        kind: 'active',
        files: [
          file('crates/multica-dashboard/src/reader.rs', 'U'),
          file('crates/multica-dashboard/src/mod.rs', 'M'),
          file('apps/dashboard/src/feature-flags.ts', 'M'),
        ],
        commitState: 'idle',
      },
    ],
    codeLines: [
      { parts: [c('//! Rust-owned dashboard read path.', 'c')] },
      {
        kind: 'added',
        parts: [c('use ', 'k'), c('crate', 't'), c('::{'), c('state', 'p'), c(', '), c('metrics', 'p'), c('};')],
      },
      {
        kind: 'added',
        parts: [c('use ', 'k'), c('serde', 't'), c('::{'), c('Serialize', 'p'), c('};')],
      },
      { parts: [] },
      {
        kind: 'added',
        parts: [c('#[derive(', 'k'), c('Serialize', 't'), c(')]')],
      },
      {
        kind: 'added',
        parts: [c('pub struct ', 'k'), c('UsageSummary', 't'), c(' {')],
      },
      {
        kind: 'added',
        parts: [c('    '), c('pub ', 'k'), c('account_id', 'p'), c(': '), c('Uuid', 't'), c(',')],
      },
      {
        kind: 'added',
        parts: [c('    '), c('pub ', 'k'), c('totals_5h', 'p'), c(': '), c('u64', 't'), c(',')],
      },
      {
        kind: 'added',
        parts: [c('    '), c('pub ', 'k'), c('totals_weekly', 'p'), c(': '), c('u64', 't'), c(',')],
      },
      { kind: 'added', parts: [c('}')] },
    ],
    statusBranch: 'agent/codex/dashboard-rust-port-421',
  },
  {
    stepLabel: 'Step 05',
    label: 'Live diff streams into the editor',
    description: (
      <>
        You can watch the agent type. Every write shows up as an inline diff — green adds, red
        removes — exactly like a PR review.
      </>
    ),
    messages: [
      {
        kind: 'assistant',
        content: (
          <>
            Streaming the async reader implementation now. You&rsquo;ll see the caret advance
            through each line.
          </>
        ),
      },
    ],
    branch: 'agent/codex/dashboard-rust-port-421',
    tabs: [{ path: 'reader.rs', label: 'reader.rs', ext: 'rs', active: true }],
    worktrees: [
      {
        id: 'wt-dashboard',
        name: 'agent_codex__dashboard-rust-port-421',
        branch: 'agent/codex/dashboard-rust-port-421',
        kind: 'active',
        files: [
          file('crates/multica-dashboard/src/reader.rs', 'U'),
          file('crates/multica-dashboard/src/mod.rs', 'M'),
          file('apps/dashboard/src/feature-flags.ts', 'M'),
        ],
      },
    ],
    codeLines: [
      {
        kind: 'removed',
        parts: [c('pub fn ', 'k'), c('read_usage_summary', 'f'), c('() {')],
      },
      { kind: 'removed', parts: [c('    todo!()', 'c')] },
      { kind: 'removed', parts: [c('}')] },
      {
        kind: 'added',
        parts: [c('pub async fn ', 'k'), c('read_usage_summary', 'f'), c('(')],
      },
      {
        kind: 'added',
        parts: [c('    '), c('state', 'p'), c(': '), c('&', 'k'), c('AppState', 't'), c(',')],
      },
      {
        kind: 'added',
        parts: [c('    '), c('account_id', 'p'), c(': '), c('Uuid', 't'), c(',')],
      },
      {
        kind: 'added',
        parts: [c(') -> '), c('Result', 't'), c('<'), c('UsageSummary', 't'), c('> {')],
      },
      {
        kind: 'added',
        parts: [
          c('    '),
          c('let ', 'k'),
          c('row', 'p'),
          c(' = '),
          c('sqlx::query_as!', 'f'),
          c('('),
        ],
      },
      {
        kind: 'added',
        parts: [c('        '), c('UsageSummary', 't'), c(',')],
      },
      {
        kind: 'added',
        parts: [
          c('        '),
          c('"SELECT * FROM usage_totals_fast WHERE account_id = $1"', 's'),
          c(','),
        ],
      },
      {
        kind: 'added',
        parts: [c('        '), c('account_id', 'p')],
      },
      {
        kind: 'added',
        parts: [
          c('    ).'),
          c('fetch_one', 'f'),
          c('('),
          c('&', 'k'),
          c('state', 'p'),
          c('.'),
          c('db', 'p'),
          c(').await?;'),
        ],
      },
      {
        kind: 'added',
        parts: [c('    '), c('Ok', 'f'), c('('), c('row', 'p'), c(')')],
        typing: true,
      },
      { kind: 'added', parts: [c('}')] },
    ],
    statusBranch: 'agent/codex/dashboard-rust-port-421',
  },
  {
    stepLabel: 'Step 06',
    label: 'Claude joins in parallel',
    description: (
      <>
        Need a parallel effort? Start another session with <strong>Claude</strong> while Codex keeps
        working. Each agent gets its <em>own</em> worktree — they never collide, and both show up
        side-by-side in Source Control.
      </>
    ),
    messages: [
      {
        kind: 'user',
        content: (
          <>
            <strong>You</strong> (Claude): Also fix the hydration flash on the project sidebar.
          </>
        ),
      },
      {
        kind: 'assistant',
        content: (
          <>
            Spinning up a Claude worktree alongside the Codex port — they run independently and land
            as separate PRs.
          </>
        ),
      },
      {
        kind: 'tool',
        title: '1 tool call',
        sub: '· scripts/agent-branch-start.sh (claude)',
        elapsed: '0.4s',
        rows: [
          {
            kind: 'shell',
            label: 'bash:',
            value: 'scripts/agent-branch-start.sh "projects-hydration-fix" "claude-sidebar"',
          },
        ],
      },
    ],
    branch: 'agent/claude/projects-hydration-mismatch-sidebar',
    tabs: [{ path: 'reader.rs', label: 'reader.rs', ext: 'rs', active: true }],
    worktrees: [
      {
        id: 'wt-dashboard',
        name: 'agent_codex__dashboard-rust-port-421',
        branch: 'agent/codex/dashboard-rust-port-421',
        kind: 'active',
        files: [
          file('crates/multica-dashboard/src/reader.rs', 'U'),
          file('crates/multica-dashboard/src/mod.rs', 'M'),
          file('apps/dashboard/src/feature-flags.ts', 'M'),
        ],
      },
      {
        id: 'wt-hydration',
        name: 'agent_claude__projects-hydration-mismatch-sidebar',
        branch: 'agent/claude/projects-hydration-mismatch-sidebar',
        kind: 'active',
        tag: 'claude · parallel',
        message:
          'Message (Ctrl+Enter to commit on "agent/claude/projects-hydration-mismatch-sidebar")',
      },
    ],
    codeLines: [
      { parts: [c('// Parallel lane (Claude) — Codex Rust port keeps running.', 'c')] },
      { parts: [c('// Both agents show up as separate worktrees in Source Control.', 'c')] },
    ],
    statusBranch: 'agent/claude/projects-hydration-mismatch-sidebar',
  },
  {
    stepLabel: 'Step 07',
    label: 'Files stream into the Claude sandbox',
    description: (
      <>
        Two agents, two isolated branches, simultaneous progress. <strong>Claude</strong> is writing
        TSX while <strong>Codex</strong> keeps writing Rust. Your <code>dev</code> checkout is still
        untouched.
      </>
    ),
    messages: [
      {
        kind: 'tool',
        title: '3 tool calls',
        sub: '· claude lane writes',
        elapsed: '1.4s',
        rows: [
          {
            kind: 'write',
            label: 'write:',
            value: 'apps/frontend/src/components/layout/loading-overlay.tsx',
          },
          { kind: 'write', label: 'write:', value: 'apps/frontend/src/components/ui/spinner.tsx' },
          { kind: 'write', label: 'write:', value: 'apps/frontend/src/lib/navigation-loader.ts' },
        ],
      },
    ],
    branch: 'agent/claude/projects-hydration-mismatch-sidebar',
    tabs: [
      { path: 'loading-overlay.tsx', label: 'loading-overlay.tsx', ext: 'tsx', active: true },
    ],
    worktrees: [
      {
        id: 'wt-dashboard',
        name: 'agent_codex__dashboard-rust-port-421',
        branch: 'agent/codex/dashboard-rust-port-421',
        kind: 'active',
        files: [
          file('crates/multica-dashboard/src/reader.rs', 'U'),
          file('crates/multica-dashboard/src/mod.rs', 'M'),
          file('apps/dashboard/src/feature-flags.ts', 'M'),
        ],
      },
      {
        id: 'wt-hydration',
        name: 'agent_claude__projects-hydration-mismatch-sidebar',
        branch: 'agent/claude/projects-hydration-mismatch-sidebar',
        kind: 'active',
        tag: 'claude · parallel',
        files: [
          file('apps/frontend/src/components/layout/loading-overlay.tsx', 'U'),
          file('apps/frontend/src/components/ui/spinner.tsx', 'M'),
          file('apps/frontend/src/lib/navigation-loader.ts', 'M'),
        ],
      },
    ],
    codeLines: [
      {
        kind: 'added',
        parts: [
          c('const ', 'k'),
          c('shouldRender', 'p'),
          c(' = !'),
          c('navigationSettled', 'p'),
          c(' && !'),
          c('suppressLoaderFlash', 'p'),
        ],
      },
      {
        kind: 'added',
        parts: [
          c('return '),
          c('shouldRender', 'p'),
          c(' ? <'),
          c('OverlaySpinner', 't'),
          c(' /> : '),
          c('null', 'k'),
        ],
      },
      {
        kind: 'added',
        parts: [
          c('setTimeout', 'f'),
          c('(() => '),
          c('setSuppressLoaderFlash', 'f'),
          c('('),
          c('true', 'k'),
          c('), '),
          c('140', 'n'),
          c(')'),
        ],
      },
    ],
    statusBranch: 'agent/claude/projects-hydration-mismatch-sidebar',
  },
  {
    stepLabel: 'Step 08',
    label: 'Approve the commit',
    description: (
      <>
        With access on <code>On-Request</code>, the agent pauses for your sign-off before committing.
        Click Commit to merge the sandbox to a PR.
      </>
    ),
    messages: [
      {
        kind: 'assistant',
        content: (
          <>
            All phase-1 writes done. Tests pass locally. Ready to commit{' '}
            <code>agent/codex/dashboard-rust-port-421</code>.
          </>
        ),
      },
    ],
    branch: 'agent/codex/dashboard-rust-port-421',
    tabs: [{ path: 'reader.rs', label: 'reader.rs', ext: 'rs', active: true }],
    worktrees: [
      {
        id: 'wt-dashboard',
        name: 'agent_codex__dashboard-rust-port-421',
        branch: 'agent/codex/dashboard-rust-port-421',
        kind: 'active',
        files: [
          file('crates/multica-dashboard/src/reader.rs', 'U'),
          file('crates/multica-dashboard/src/mod.rs', 'M'),
          file('apps/dashboard/src/feature-flags.ts', 'M'),
        ],
        commitReady: true,
        commitState: 'ready',
      },
    ],
    codeLines: [
      { parts: [c('cargo test -p multica-dashboard  ', 'c'), c('✓', 'f')] },
      { parts: [c('pnpm test --filter=dashboard    ', 'c'), c('✓', 'f')] },
      { parts: [c('Waiting for commit approval...', 'c')] },
    ],
    statusBranch: 'agent/codex/dashboard-rust-port-421',
  },
  {
    stepLabel: 'Step 09',
    label: 'PR opened, worktree dissolves',
    description: (
      <>
        The worktree is merged via PR on approval and automatically cleaned up. Your repo goes back
        to a single <code>dev</code> checkout. Done.
      </>
    ),
    messages: [
      {
        kind: 'tool',
        title: '2 tool calls',
        sub: '· finish',
        elapsed: '1.4s',
        rows: [
          {
            kind: 'shell',
            label: 'bash:',
            value: 'scripts/agent-branch-finish.sh --via-pr --wait-for-merge',
          },
          { kind: 'tool', label: 'tool:', value: 'pr.merged → cleanup.worktree' },
        ],
      },
      {
        kind: 'assistant',
        content: (
          <>
            PR merged, worktree removed. You&rsquo;re back on a clean <code>dev</code>. 🎉
          </>
        ),
      },
    ],
    branch: 'dev',
    tabs: [],
    worktrees: [],
    codeLines: [
      { parts: [c('git status', 'c')] },
      { parts: [c('On branch dev')] },
      { parts: [c('Your branch is up to date with origin/dev.', 'c')] },
      { parts: [c('nothing to commit, working tree clean', 'c')] },
    ],
    statusBranch: 'dev',
    statusSync: '↓ 1 ↑ 0',
    showPullAnimation: true,
  },
]

const PLAN_STEPS: TutorialStep[] = [
  {
    stepLabel: 'Step 01',
    label: 'Shift+Tab → Plan mode on',
    description: (
      <>
        Press <kbd>Shift+Tab</kbd> to cycle permission modes: Normal → Auto-Accept → Plan. Plan mode
        locks the agent into <strong>read-only</strong> — any attempt to write, edit, or run shell
        commands gets refused at the tool layer.
      </>
    ),
    messages: [
      {
        kind: 'hint',
        content: (
          <>
            <strong>⏸ plan mode on</strong>
            {'  ·  '}
            <span className="mono" style={{ fontSize: '11px' }}>
              claude --permission-mode plan
            </span>
          </>
        ),
      },
      {
        kind: 'user',
        content: (
          <>
            <strong>You</strong>: Port the dashboard usage slice from Python to Rust. Explore the
            code first, then give me a plan.
          </>
        ),
      },
    ],
    branch: 'dev',
    tabs: [],
    worktrees: [],
    codeLines: [
      { parts: [c('# Dashboard reads → Rust migration', 'c')] },
      { parts: [c('> Plan mode · read-only', 'c')] },
      { parts: [c('status: waiting for exploration', 'c')] },
    ],
    statusBranch: 'dev',
  },
  {
    stepLabel: 'Step 02',
    label: 'Explore — deep read pass',
    description: (
      <>
        The agent does an <strong>Explore phase</strong>: reads skills, searches the codebase, maps
        dependencies, and asks questions. No writes, no shell side-effects.
      </>
    ),
    messages: [
      {
        kind: 'assistant',
        content: (
          <>
            Starting Explore phase. I&rsquo;ll map the current Python reader, the Rust crate
            skeleton, and everything that depends on the output shape.
          </>
        ),
      },
      {
        kind: 'tool',
        title: '8 tool calls',
        sub: '· read-only exploration',
        elapsed: '4.7s',
        rows: [
          { kind: 'read', label: 'read:', value: 'CLAUDE.md · AGENTS.md' },
          { kind: 'read', label: 'read:', value: 'apps/backend/dashboard/reader.py' },
          { kind: 'read', label: 'read:', value: 'apps/backend/dashboard/tests/test_reader.py' },
          { kind: 'read', label: 'read:', value: 'crates/multica-dashboard/src/lib.rs' },
          { kind: 'tool', label: 'grep:', value: 'read_usage_summary → 11 callers in 4 files' },
          { kind: 'tool', label: 'grep:', value: 'usage_totals_fast → 2 call sites + 1 migration' },
          { kind: 'tool', label: 'tool:', value: 'git_log --stat apps/backend/dashboard (last 90d)' },
          { kind: 'tool', label: 'tool:', value: 'write_file → ✗ refused (read-only mode)' },
        ],
      },
    ],
    branch: 'agent/plan/dashboard-rust-port',
    tabs: [],
    worktrees: [
      {
        id: 'wt-plan',
        name: 'agent_plan__dashboard-rust-port',
        branch: 'agent/plan/dashboard-rust-port',
        kind: 'readonly',
        tag: 'read-only',
        message: 'Read-only — drafting plan, no writes yet.',
      },
    ],
    codeLines: [
      { parts: [c('# exploration summary', 'c')] },
      { parts: [c('callers: 11  ·  migrations: 1  ·  writes: blocked')] },
    ],
    statusBranch: 'agent/plan/dashboard-rust-port',
  },
  {
    stepLabel: 'Step 03',
    label: 'Plan drafted as a real markdown doc',
    description: (
      <>
        The agent writes a real plan to <code>~/.claude/plans/</code> — ordered phases, file lists,
        risks, rollback. It survives <code>/clear</code> and context compaction, and persists across
        sessions until you approve or delete it.
      </>
    ),
    messages: [
      {
        kind: 'assistant',
        content: (
          <>
            Plan written to <code>~/.claude/plans/2026-04-19-dashboard-rust-port.md</code>. 4 phases,
            ~3.5h execute time. Persists across sessions.
          </>
        ),
      },
      planListHint([
        { title: 'Phase 1 — Rust reader + types', meta: ' · 2h · 3 files' },
        { title: 'Phase 2 — Feature flag wiring', meta: ' · 30m · 2 files' },
        { title: 'Phase 3 — Shadow-read comparison', meta: ' · 24h observe · 1 file' },
        { title: 'Phase 4 — Cutover + Python deletion', meta: ' · 1h · 6 files' },
      ]),
    ],
    branch: 'agent/plan/dashboard-rust-port',
    tabs: [
      {
        path: '2026-04-19-dashboard-rust-port.md',
        label: '2026-04-19-dashboard-rust-port.md',
        ext: 'md',
        active: true,
        badge: '~/.claude/plans/',
      },
    ],
    worktrees: [
      {
        id: 'wt-plan',
        name: 'agent_plan__dashboard-rust-port',
        branch: 'agent/plan/dashboard-rust-port',
        kind: 'readonly',
        tag: 'read-only',
        message: 'Plan saved — awaiting review.',
      },
    ],
    codeLines: [
      { parts: [c('# Dashboard reads → Rust migration', 'c')] },
      { parts: [c('> Plan mode · saved · persists across /clear & compaction', 'c')] },
      { parts: [] },
      { parts: [c('## Goal', 'c')] },
      {
        parts: [
          c('Replace Python '),
          c('read_usage_summary()', 'f'),
          c(' with Rust, behind a flag, zero downtime.'),
        ],
      },
      { parts: [] },
      { parts: [c('## Phase 1 — Rust reader + types  (2h)', 'c')] },
      { parts: [c(' - Add '), c('UsageSummary', 't'), c(' struct with '), c('Serialize', 'f')] },
      {
        parts: [
          c(' - Implement '),
          c('read_usage_summary(state, account_id)', 'f'),
          c(' → '),
          c('crates/multica-dashboard/src/reader.rs', 's'),
        ],
      },
      { parts: [c(' - Export from '), c('mod.rs', 's'), c('; port 5 unit tests')] },
      { parts: [c('  accept: cargo test -p multica-dashboard passes', 'p')] },
      { parts: [] },
      { parts: [c('## Phase 2 — Feature flag wiring  (30m)', 'c')] },
      {
        parts: [
          c(' - Add '),
          c('dashboard_reads_rust', 'p'),
          c(' (default off) → '),
          c('apps/dashboard/src/feature-flags.ts', 's'),
        ],
      },
      { parts: [c(' - Router picks reader based on flag')] },
      { parts: [c('  accept: both paths green in integration tests', 'p')] },
      { parts: [] },
      { parts: [c('## Phase 3 — Shadow-read + compare  (24h observe)', 'c')] },
      {
        parts: [
          c(' - Dual-fire Python + Rust; log diffs to '),
          c('metrics.dashboard_read_parity', 's'),
        ],
      },
      { parts: [c('  accept: parity_diff_ratio < 0.001 over 24h', 'p')] },
      { parts: [] },
      { parts: [c('## Phase 4 — Cutover + delete Python  (1h)', 'c')] },
      {
        parts: [
          c(' - Flip flag to 100%; remove '),
          c('apps/backend/dashboard/reader.py', 's'),
        ],
      },
    ],
    statusBranch: 'agent/plan/dashboard-rust-port',
  },
  {
    stepLabel: 'Step 04',
    label: 'Review — read the whole plan',
    description: (
      <>
        The markdown opens in the editor. Full context: goal, approach, each phase with exact files,
        acceptance checks, risks with mitigations, rollback plan. This is the Explore → Plan →
        Review step of the loop.
      </>
    ),
    messages: [
      {
        kind: 'assistant',
        content: (
          <>
            Scroll through the plan. Everything the agent intends to do is here — no hidden context.
          </>
        ),
      },
    ],
    branch: 'agent/plan/dashboard-rust-port',
    tabs: [
      {
        path: '2026-04-19-dashboard-rust-port.md',
        label: '2026-04-19-dashboard-rust-port.md',
        ext: 'md',
        active: true,
        badge: '~/.claude/plans/',
      },
    ],
    worktrees: [
      {
        id: 'wt-plan',
        name: 'agent_plan__dashboard-rust-port',
        branch: 'agent/plan/dashboard-rust-port',
        kind: 'readonly',
        tag: 'read-only',
        message: 'Review pass · pulsing editor.',
      },
    ],
    codeLines: [
      { parts: [c('## Risks', 'c')] },
      {
        parts: [
          c(' - '),
          c('totals_weekly', 's'),
          c(' u64 vs bigint coercion → validated in phase 3'),
        ],
      },
      {
        parts: [
          c(' - '),
          c('usage_totals_fast', 's'),
          c(' view lag ~5s → acceptable per SLO'),
        ],
      },
      { parts: [] },
      { parts: [c('## Rollback', 'c')] },
      { parts: [c('Flip flag to 0%. Python reader kept until phase 4.')] },
    ],
    statusBranch: 'agent/plan/dashboard-rust-port',
    pulseEditor: true,
  },
  {
    stepLabel: 'Step 05',
    label: 'Edit the plan inline',
    description: (
      <>
        Disagree with a step? Edit the markdown. Remove a phase. Add an acceptance check. Plan mode
        keeps iterating on the doc until you approve.
      </>
    ),
    messages: [
      {
        kind: 'user',
        content: (
          <>
            <strong>You</strong>: Skip phase 4 for now — I want the Python reader kept as a fallback.
            Add a <em>load-test with 100 concurrent reads</em> to phase 3 acceptance.
          </>
        ),
      },
      {
        kind: 'assistant',
        content: (
          <>
            Updated the plan. Phase 4 marked <code>[deferred]</code>. Added load-test check to
            phase 3.
          </>
        ),
      },
    ],
    branch: 'agent/plan/dashboard-rust-port',
    tabs: [
      {
        path: 'plan-revision.diff',
        label: 'plan-revision.diff',
        ext: 'md',
        active: true,
      },
    ],
    worktrees: [
      {
        id: 'wt-plan',
        name: 'agent_plan__dashboard-rust-port',
        branch: 'agent/plan/dashboard-rust-port',
        kind: 'readonly',
        tag: 'read-only',
        message: 'Plan revision stored.',
      },
    ],
    codeLines: [
      {
        kind: 'removed',
        parts: [c('## Phase 4 — Cutover + delete Python  (1h)', 'c')],
      },
      {
        kind: 'added',
        parts: [c('## Phase 4 — Cutover + delete Python  [deferred]', 'c')],
      },
      { parts: [] },
      {
        kind: 'added',
        parts: [c('  accept: 100 concurrent reads < p99 80ms', 'p')],
      },
    ],
    statusBranch: 'agent/plan/dashboard-rust-port',
  },
  {
    stepLabel: 'Step 06',
    label: 'Approve → Execute phase',
    description: (
      <>
        When the plan reads right, approve it. The agent switches out of Plan mode, escalates access
        to <code>On-Request</code>, and starts phase 1. The saved markdown is the single source of
        truth for what gets built.
      </>
    ),
    messages: [
      {
        kind: 'user',
        content: (
          <>
            <strong>You</strong>: Looks good. Execute phases 1–3.
          </>
        ),
      },
      {
        kind: 'assistant',
        content: <>Exiting Plan mode. Access escalated to On-Request. Starting Phase 1: Rust reader + types.</>,
      },
      {
        kind: 'tool',
        title: '3 tool calls',
        sub: '· phase 1 begins',
        elapsed: '0.8s',
        rows: [
          {
            kind: 'shell',
            label: 'bash:',
            value: 'scripts/agent-branch-start.sh "dashboard-rust-port" --from-plan',
          },
          {
            kind: 'read',
            label: 'read:',
            value: '~/.claude/plans/2026-04-19-dashboard-rust-port.md',
          },
          { kind: 'write', label: 'write:', value: 'crates/multica-dashboard/src/reader.rs' },
        ],
      },
    ],
    branch: 'agent/codex/dashboard-rust-port-421',
    tabs: [{ path: 'reader.rs', label: 'reader.rs', ext: 'rs', active: true }],
    worktrees: [
      {
        id: 'wt-plan',
        name: 'agent_codex__dashboard-rust-port-421',
        branch: 'agent/codex/dashboard-rust-port-421',
        kind: 'active',
        tag: 'executing · phase 1',
        files: [file('crates/multica-dashboard/src/reader.rs', 'U')],
        message: 'Access escalated to On-Request. Writing phase 1.',
      },
    ],
    codeLines: [
      {
        kind: 'added',
        parts: [
          c('pub async fn ', 'k'),
          c('read_usage_summary', 'f'),
          c('('),
          c('state', 'p'),
          c(': '),
          c('&', 'k'),
          c('AppState', 't'),
          c(', '),
          c('account_id', 'p'),
          c(': '),
          c('Uuid', 't'),
          c(') -> '),
          c('Result', 't'),
          c('<'),
          c('UsageSummary', 't'),
          c('>'),
        ],
      },
    ],
    statusBranch: 'agent/codex/dashboard-rust-port-421',
  },
  {
    stepLabel: 'Step 07',
    label: 'Drift? Shift+Tab back into Plan',
    description: (
      <>
        If execution drifts from the plan, hit <kbd>Shift+Tab</kbd> back into Plan mode. The agent
        reads the saved plan + recent diffs and drafts a <em>revised</em> plan for the remaining
        work. Loop: Explore → Plan → Review → Execute.
      </>
    ),
    messages: [
      {
        kind: 'hint',
        content: (
          <>
            <strong>⏸ plan mode on</strong>
            {'  ·  '}re-entering to revise remaining phases
          </>
        ),
      },
      {
        kind: 'assistant',
        content: (
          <>
            Drift detected at phase 2 — flag shape changed upstream. Drafting{' '}
            <code>2026-04-19-dashboard-rust-port.v2.md</code> for phases 2–3.
          </>
        ),
      },
    ],
    branch: 'agent/plan/dashboard-rust-port-v2',
    tabs: [
      { path: 'v1.md', label: 'v1.md', ext: 'md' },
      { path: 'v2.md', label: 'v2.md (revised)', ext: 'md', active: true },
    ],
    worktrees: [
      {
        id: 'wt-plan-v2',
        name: 'agent_plan__dashboard-rust-port-v2',
        branch: 'agent/plan/dashboard-rust-port-v2',
        kind: 'readonly',
        tag: 'read-only',
        message: 'Revising plan for remaining phases.',
      },
    ],
    codeLines: [
      { parts: [c('# Dashboard reads → Rust migration (v2, revised)', 'c')] },
      { parts: [c('> Drift noted: flag shape changed upstream in main', 'c')] },
      { parts: [] },
      { kind: 'added', parts: [c("## Phase 2' — Re-wire flag to new shape  (40m)", 'c')] },
      {
        kind: 'added',
        parts: [c(' - Migrate to '), c('flag({ rollout })', 'f'), c(' constructor')],
      },
      { kind: 'added', parts: [c(' - Update 4 call sites introduced in main since v1')] },
      { parts: [] },
      { parts: [c('## Phase 3 — unchanged (see v1)', 'c')] },
    ],
    statusBranch: 'agent/plan/dashboard-rust-port-v2',
  },
]

const MERGE_STEPS: TutorialStep[] = [
  {
    stepLabel: 'Step 01',
    label: 'Two PRs are ready',
    description: (
      <>
        You have two completed worktrees from separate sessions. Both PRs passed CI. Now try to
        merge.
      </>
    ),
    messages: [
      { kind: 'assistant', content: <>Two worktrees completed and open as PRs:</> },
      {
        kind: 'tool',
        title: '2 PRs open',
        sub: '· awaiting merge',
        elapsed: '',
        rows: [
          { kind: 'tool', label: 'PR #421:', value: 'agent/codex/dashboard-rust-port' },
          { kind: 'tool', label: 'PR #438:', value: 'agent/codex/flags-cleanup-sweep' },
        ],
      },
    ],
    branch: 'dev',
    tabs: [],
    worktrees: [
      {
        id: 'wt-pr421',
        name: 'agent_codex__dashboard-rust-port-421',
        branch: 'agent/codex/dashboard-rust-port-421',
        kind: 'active',
        files: [
          file('crates/multica-dashboard/src/reader.rs', 'U'),
          file('apps/dashboard/src/feature-flags.ts', 'M'),
        ],
      },
      {
        id: 'wt-pr438',
        name: 'agent_codex__flags-cleanup-sweep-438',
        branch: 'agent/codex/flags-cleanup-sweep-438',
        kind: 'active',
        files: [
          file('apps/dashboard/src/feature-flags.ts', 'M'),
          file('apps/dashboard/src/flag-types.ts', 'U'),
        ],
      },
    ],
    codeLines: [
      { parts: [c('PR #421  status: ready  ', 'c'), c('✓', 'f')] },
      { parts: [c('PR #438  status: ready  ', 'c'), c('✓', 'f')] },
    ],
    statusBranch: 'dev',
  },
  {
    stepLabel: 'Step 02',
    label: 'Conflict detected',
    description: (
      <>
        Both PRs edited <code>apps/dashboard/src/feature-flags.ts</code>. GitHub blocks the merge.
        Normally: you stop everything and resolve by hand.
      </>
    ),
    messages: [
      {
        kind: 'conflict',
        content: (
          <>
            <strong>⚠ Merge conflict</strong>
            <br />
            Both PRs modified <code>apps/dashboard/src/feature-flags.ts</code> at overlapping lines.
          </>
        ),
      },
    ],
    branch: 'dev',
    tabs: [
      {
        path: 'feature-flags.ts',
        label: 'feature-flags.ts (conflict)',
        ext: 'ts',
        active: true,
        state: 'conflict',
      },
    ],
    worktrees: [
      {
        id: 'wt-pr421',
        name: 'agent_codex__dashboard-rust-port-421',
        branch: 'agent/codex/dashboard-rust-port-421',
        kind: 'active',
        files: [
          file('crates/multica-dashboard/src/reader.rs', 'U'),
          { ...file('apps/dashboard/src/feature-flags.ts', 'conflict'), status: 'conflict' },
        ],
      },
      {
        id: 'wt-pr438',
        name: 'agent_codex__flags-cleanup-sweep-438',
        branch: 'agent/codex/flags-cleanup-sweep-438',
        kind: 'active',
        files: [
          { ...file('apps/dashboard/src/feature-flags.ts', 'conflict'), status: 'conflict' },
          file('apps/dashboard/src/flag-types.ts', 'U'),
        ],
      },
    ],
    codeLines: [
      { parts: [c('// Conflict: two PRs touched overlapping lines.', 'c')] },
      { parts: [c('// Normally: you stop, check out both branches, resolve by hand.', 'c')] },
      { parts: [c('// With merge agent: this resolves automatically.', 'c')] },
    ],
    statusBranch: 'dev',
    statusErrors: 1,
  },
  {
    stepLabel: 'Step 03',
    label: 'Merge agent auto-spawns',
    description: (
      <>
        A <strong>merge agent</strong> worktree is created from the target branch. Its only job:
        reconcile the two PRs.
      </>
    ),
    messages: [
      {
        kind: 'thinking',
        content: (
          <>
            Spawning merge worker. Branch: <code>agent/merge/pr-421-vs-438</code>. Cherry-picking
            both heads.
          </>
        ),
      },
      {
        kind: 'tool',
        title: '2 tool calls',
        sub: '· merge setup',
        elapsed: '0.6s',
        rows: [
          {
            kind: 'shell',
            label: 'bash:',
            value: 'scripts/merge-agent-start.sh --a 421 --b 438',
          },
          {
            kind: 'shell',
            label: 'bash:',
            value: 'git cherry-pick origin/pr-421 origin/pr-438',
          },
        ],
      },
    ],
    branch: 'agent/merge/pr-421-vs-438',
    tabs: [
      {
        path: 'feature-flags.ts',
        label: 'feature-flags.ts (conflict)',
        ext: 'ts',
        active: true,
        state: 'conflict',
      },
    ],
    worktrees: [
      {
        id: 'wt-pr421',
        name: 'agent_codex__dashboard-rust-port-421',
        branch: 'agent/codex/dashboard-rust-port-421',
        kind: 'active',
        files: [
          file('crates/multica-dashboard/src/reader.rs', 'U'),
          { ...file('apps/dashboard/src/feature-flags.ts', 'conflict'), status: 'conflict' },
        ],
      },
      {
        id: 'wt-pr438',
        name: 'agent_codex__flags-cleanup-sweep-438',
        branch: 'agent/codex/flags-cleanup-sweep-438',
        kind: 'active',
        files: [
          { ...file('apps/dashboard/src/feature-flags.ts', 'conflict'), status: 'conflict' },
          file('apps/dashboard/src/flag-types.ts', 'U'),
        ],
      },
      {
        id: 'wt-merge',
        name: 'agent_merge__pr-421-vs-438',
        branch: 'agent/merge/pr-421-vs-438',
        kind: 'merge',
        tag: 'merge',
        message: 'Merge agent — reconciling PR #421 × PR #438.',
      },
    ],
    codeLines: [
      { parts: [c('bash scripts/merge-agent-start.sh --a 421 --b 438')] },
      { parts: [c('git cherry-pick origin/pr-421 origin/pr-438')] },
    ],
    statusBranch: 'agent/merge/pr-421-vs-438',
    statusErrors: 1,
  },
  {
    stepLabel: 'Step 04',
    label: 'Agent reads both sides + intent',
    description: (
      <>
        Semantic merge: the agent reads each PR description, the commit history, and the surrounding
        code to understand what each change is <em>for</em> — not just the text.
      </>
    ),
    messages: [
      {
        kind: 'assistant',
        content: (
          <>
            Loaded both PR descriptions and the conflicting hunks. PR #421 adds{' '}
            <code>dashboard_reads_rust</code>; PR #438 refactors the flag object shape. Both should
            coexist.
          </>
        ),
      },
      {
        kind: 'tool',
        title: '5 tool calls',
        sub: '· intent analysis',
        elapsed: '1.8s',
        rows: [
          { kind: 'read', label: 'read:', value: 'PR #421 description + diff' },
          { kind: 'read', label: 'read:', value: 'PR #438 description + diff' },
          { kind: 'read', label: 'read:', value: 'apps/dashboard/src/feature-flags.ts (base)' },
          { kind: 'tool', label: 'tool:', value: 'git_blame feature-flags.ts' },
          { kind: 'tool', label: 'tool:', value: 'resolve_semantic --preserve-both' },
        ],
      },
    ],
    branch: 'agent/merge/pr-421-vs-438',
    tabs: [
      {
        path: 'feature-flags.ts',
        label: 'feature-flags.ts <<< conflict',
        ext: 'ts',
        active: true,
        state: 'conflict',
      },
    ],
    worktrees: [
      {
        id: 'wt-pr421',
        name: 'agent_codex__dashboard-rust-port-421',
        branch: 'agent/codex/dashboard-rust-port-421',
        kind: 'active',
        files: [
          file('crates/multica-dashboard/src/reader.rs', 'U'),
          { ...file('apps/dashboard/src/feature-flags.ts', 'conflict'), status: 'conflict' },
        ],
      },
      {
        id: 'wt-pr438',
        name: 'agent_codex__flags-cleanup-sweep-438',
        branch: 'agent/codex/flags-cleanup-sweep-438',
        kind: 'active',
        files: [
          { ...file('apps/dashboard/src/feature-flags.ts', 'conflict'), status: 'conflict' },
          file('apps/dashboard/src/flag-types.ts', 'U'),
        ],
      },
      {
        id: 'wt-merge',
        name: 'agent_merge__pr-421-vs-438',
        branch: 'agent/merge/pr-421-vs-438',
        kind: 'merge',
        tag: 'merge',
        files: [file('apps/dashboard/src/feature-flags.ts', 'M')],
        message: 'Preparing semantic resolution.',
      },
    ],
    codeLines: [
      {
        parts: [c('export const ', 'k'), c('FLAGS', 'p'), c(' = {')],
      },
      {
        kind: 'removed',
        parts: [c('<<<<<<< HEAD (PR #421)')],
      },
      {
        kind: 'added',
        parts: [
          c('  '),
          c('dashboard_reads_rust', 'p'),
          c(': { enabled: '),
          c('false', 'k'),
          c(', rollout: '),
          c('0', 'n'),
          c(' },'),
        ],
      },
      { kind: 'removed', parts: [c('=======')] },
      {
        kind: 'added',
        parts: [
          c('  '),
          c('projects_v2_layout', 'p'),
          c(': '),
          c('flag', 'f'),
          c('({ rollout: '),
          c('25', 'n'),
          c(' }),'),
        ],
      },
      { kind: 'removed', parts: [c('>>>>>>> origin/pr-438')] },
      { parts: [c('};')] },
    ],
    statusBranch: 'agent/merge/pr-421-vs-438',
    statusErrors: 1,
  },
  {
    stepLabel: 'Step 05',
    label: 'Resolution written + tests',
    description: (
      <>
        Agent writes the merged file — no conflict markers, both features preserved — and re-runs
        the test suite.
      </>
    ),
    messages: [
      {
        kind: 'assistant',
        content: (
          <>
            Resolved. Applied PR #438&rsquo;s shape refactor on top, then added #421&rsquo;s flag
            entry in the new shape. Tests running.
          </>
        ),
      },
      {
        kind: 'tool',
        title: '2 tool calls',
        sub: '· resolve',
        elapsed: '4.1s',
        rows: [
          { kind: 'write', label: 'write:', value: 'apps/dashboard/src/feature-flags.ts' },
          { kind: 'shell', label: 'bash:', value: 'pnpm test --filter=dashboard' },
        ],
      },
      { kind: 'assistant', content: <>✓ 247 tests passed. Ready for your review.</> },
    ],
    branch: 'agent/merge/pr-421-vs-438',
    tabs: [
      {
        path: 'feature-flags.ts',
        label: 'feature-flags.ts ✓ resolved',
        ext: 'ts',
        active: true,
        state: 'resolved',
      },
    ],
    worktrees: [
      {
        id: 'wt-pr421',
        name: 'agent_codex__dashboard-rust-port-421',
        branch: 'agent/codex/dashboard-rust-port-421',
        kind: 'active',
        files: [
          file('crates/multica-dashboard/src/reader.rs', 'U'),
          file('apps/dashboard/src/feature-flags.ts', 'M'),
        ],
      },
      {
        id: 'wt-pr438',
        name: 'agent_codex__flags-cleanup-sweep-438',
        branch: 'agent/codex/flags-cleanup-sweep-438',
        kind: 'active',
        files: [
          file('apps/dashboard/src/feature-flags.ts', 'M'),
          file('apps/dashboard/src/flag-types.ts', 'U'),
        ],
      },
      {
        id: 'wt-merge',
        name: 'agent_merge__pr-421-vs-438',
        branch: 'agent/merge/pr-421-vs-438',
        kind: 'merge',
        tag: 'merge',
        files: [file('apps/dashboard/src/feature-flags.ts', 'M')],
        message: 'Resolution ready for approval.',
        commitReady: true,
        commitState: 'ready',
      },
    ],
    codeLines: [
      { parts: [c('// Merge agent resolution — both features preserved.', 'c')] },
      { parts: [c("// Applied PR #438's flag() shape, then re-added #421's entry.", 'c')] },
      { parts: [] },
      {
        kind: 'added',
        parts: [c('export const ', 'k'), c('FLAGS', 'p'), c(' = {')],
      },
      {
        kind: 'added',
        parts: [
          c('  '),
          c('dashboard_reads_rust', 'p'),
          c(': '),
          c('flag', 'f'),
          c('({ rollout: '),
          c('0', 'n'),
          c(' }),'),
        ],
      },
      {
        kind: 'added',
        parts: [
          c('  '),
          c('projects_v2_layout', 'p'),
          c(': '),
          c('flag', 'f'),
          c('({ rollout: '),
          c('25', 'n'),
          c(' }),'),
        ],
      },
      { kind: 'added', parts: [c('};')] },
    ],
    statusBranch: 'agent/merge/pr-421-vs-438',
    statusErrors: 0,
  },
  {
    stepLabel: 'Step 06',
    label: 'You review + merge',
    description: (
      <>
        Three-way side-by-side: PR A, PR B, agent&rsquo;s resolution, with a one-line rationale.
        Approve to merge both PRs; reject to retry with a nudge.
      </>
    ),
    messages: [
      {
        kind: 'user',
        content: (
          <>
            <strong>You</strong>: Looks right. Merge both.
          </>
        ),
      },
      {
        kind: 'assistant',
        content: (
          <>
            Both PRs merged via merge agent. Merge worktree dissolved. Back to clean{' '}
            <code>dev</code>.
          </>
        ),
      },
    ],
    branch: 'dev',
    tabs: [],
    worktrees: [],
    codeLines: [
      { parts: [c('PR #421 merged', 'c')] },
      { parts: [c('PR #438 merged', 'c')] },
      { parts: [c('agent/merge/pr-421-vs-438 pruned', 'c')] },
    ],
    statusBranch: 'dev',
    statusSync: '↓ 2 ↑ 0',
    showPullAnimation: true,
  },
]

const INSTALL_STEPS: TutorialStep[] = [
  {
    stepLabel: 'Step 01',
    label: 'Install the CLI globally',
    description: (
      <>
        GitGuardex ships as a single npm package. Install once and you get the <code>gx</code>,{' '}
        <code>gitguardex</code>, <code>guardex</code> (legacy), and <code>multiagent-safety</code>{' '}
        binaries on your PATH.
      </>
    ),
    messages: [
      {
        kind: 'user',
        content: (
          <>
            <strong>You</strong>: How do I start using the same agent-worktree flow in my repo?
          </>
        ),
      },
      {
        kind: 'assistant',
        content: (
          <>
            One command. Copy the install line from the top of this page and run it in a new shell.
          </>
        ),
      },
      {
        kind: 'tool',
        title: '1 shell call',
        sub: '· global install',
        elapsed: '3.8s',
        rows: [
          { kind: 'shell', label: 'bash:', value: 'npm i -g @imdeadpool/guardex' },
        ],
      },
    ],
    branch: 'dev',
    tabs: [
      {
        path: 'terminal',
        label: 'install.sh',
        ext: 'sh',
        active: true,
      },
    ],
    worktrees: [],
    codeLines: [
      { parts: [c('$ npm i -g @imdeadpool/guardex', 'c')] },
      { parts: [c('added 1 package in 3.8s')] },
      { parts: [c('')] },
      { parts: [c('$ gx --version')] },
      { parts: [c('gitguardex 7.0.16', 'f')] },
    ],
    statusBranch: 'dev',
  },
  {
    stepLabel: 'Step 02',
    label: 'Audit the repo with gx doctor',
    description: (
      <>
        <code>gx doctor</code> scans for the guardrails GitGuardex needs: git hooks, file-lock
        scripts, OpenSpec workspace, and ignore patterns. It reports what&rsquo;s missing and offers
        to repair.
      </>
    ),
    messages: [
      {
        kind: 'assistant',
        content: (
          <>
            I&rsquo;ll audit the repo to see what guardrails are already in place and what needs to
            be installed.
          </>
        ),
      },
      {
        kind: 'tool',
        title: '1 shell call',
        sub: '· gx doctor',
        elapsed: '0.6s',
        rows: [{ kind: 'shell', label: 'bash:', value: 'gx doctor' }],
      },
    ],
    branch: 'dev',
    tabs: [
      {
        path: 'terminal',
        label: 'doctor.log',
        ext: 'sh',
        active: true,
      },
    ],
    worktrees: [],
    codeLines: [
      { parts: [c('$ gx doctor', 'c')] },
      { parts: [c('[gitguardex] Doctor/fix: ', 'n'), c('/home/you/your-repo', 's')] },
      { parts: [c('  - unchanged    .omx')] },
      { parts: [c('  - unchanged    .omx/state')] },
      { parts: [c('  - unchanged    .omx/logs')] },
      { parts: [c('  - unchanged    .omx/plans')] },
      { parts: [c('  - unchanged    .omx/agent-worktrees')] },
      { parts: [c('  - unchanged    scripts/agent-branch-start.sh')] },
      { parts: [c('  - unchanged    scripts/agent-branch-finish.sh')] },
      { parts: [c('  - unchanged    scripts/codex-agent.sh')] },
      { parts: [c('  - '), c('skipped-conflict', 'n'), c(' scripts/review-bot-watch.sh')] },
      { parts: [c('  - unchanged    scripts/agent-worktree-prune.sh')] },
      { parts: [c('  - unchanged    scripts/agent-file-locks.py')] },
      { parts: [c('  - '), c('skipped-conflict', 'n'), c(' scripts/install-agent-git-hooks.sh')] },
      { parts: [c('  - unchanged    .githooks/pre-commit')] },
      { parts: [c('  - unchanged    .githooks/pre-push')] },
      { parts: [c('  - unchanged    .githooks/post-merge')] },
      { parts: [c('  - unchanged    .githooks/post-checkout')] },
      { parts: [c('  - unchanged    .gitignore')] },
      { parts: [c('  - hooksPath    set core.hooksPath=.githooks')] },
      { parts: [c('[gitguardex] Scan target: ', 'n'), c('/home/you/your-repo', 's')] },
      { parts: [c('[gitguardex] Branch: ', 'n'), c('dev', 'f')] },
      { parts: [c('[gitguardex] '), c('✅ No safety issues detected.', 'f')] },
      {
        parts: [
          c('[gitguardex] Auto-finish sweep (base=dev): ', 'n'),
          c('attempted=5', 'f'),
          c(', completed=0, skipped=15, failed=5'),
        ],
      },
      { parts: [c('  [skip] agent/claude-16-11/… already merged into dev.', 'c')] },
      { parts: [c('  [skip] agent/codex-20-20/… already merged into dev.', 'c')] },
      { parts: [c('  [fail] agent/…/rebase-in-progress → resolve conflicts.', 'c')] },
      { parts: [c('[gitguardex] '), c('✅ Repo is fully safe.', 'f')] },
    ],
    statusBranch: 'dev',
  },
  {
    stepLabel: 'Step 03',
    label: 'Wire the repo with gx setup',
    description: (
      <>
        <code>gx setup</code> installs the guardrails: git hooks that block primary-branch edits,
        the file-lock scripts, the OpenSpec scaffold, and the agent-branch helpers.
      </>
    ),
    messages: [
      {
        kind: 'assistant',
        content: <>Running setup — this wires every guardrail into your repo in one pass.</>,
      },
      {
        kind: 'tool',
        title: '1 shell call',
        sub: '· gx setup',
        elapsed: '1.9s',
        rows: [{ kind: 'shell', label: 'bash:', value: 'gx setup' }],
      },
    ],
    branch: 'dev',
    tabs: [
      {
        path: 'terminal',
        label: 'setup.log',
        ext: 'sh',
        active: true,
      },
    ],
    worktrees: [],
    codeLines: [
      { parts: [c('$ gx setup', 'c')] },
      { parts: [c('installing git hooks → .githooks/'), c(' ✓', 'f')] },
      { parts: [c('installing scripts → scripts/'), c(' ✓', 'f')] },
      { parts: [c('  scripts/agent-branch-start.sh')] },
      { parts: [c('  scripts/agent-branch-finish.sh')] },
      { parts: [c('  scripts/agent-file-locks.py')] },
      { parts: [c('  scripts/codex-agent.sh')] },
      { parts: [c('scaffolding OpenSpec → openspec/'), c(' ✓', 'f')] },
      { parts: [c('protecting main, dev branches'), c(' ✓', 'f')] },
      { parts: [c('')] },
      { parts: [c('GitGuardex ready. Start your first agent with `gx start`.', 'p')] },
    ],
    statusBranch: 'dev',
  },
  {
    stepLabel: 'Step 04',
    label: 'Start an agent worktree',
    description: (
      <>
        <code>gx start &quot;&lt;task&gt;&quot; &quot;&lt;agent-name&gt;&quot;</code> creates an isolated sandbox branch
        under <code>.omx/agent-worktrees/</code> — same flow Execute mode demos. Use{' '}
        <code>claude-*</code> or <code>codex-*</code> prefixes; the script works with both.
      </>
    ),
    messages: [
      {
        kind: 'user',
        content: (
          <>
            <strong>You</strong>: gx start &quot;refactor-payments&quot; &quot;claude-alice&quot;
          </>
        ),
      },
      {
        kind: 'assistant',
        content: (
          <>
            Sandbox created. You&rsquo;re now on an <code>agent/claude-alice/*</code> branch with a
            dedicated worktree — safe to edit.
          </>
        ),
      },
      {
        kind: 'tool',
        title: '2 shell calls',
        sub: '· spawn sandbox',
        elapsed: '0.5s',
        rows: [
          { kind: 'shell', label: 'bash:', value: 'gx start "refactor-payments" "claude-alice"' },
          { kind: 'shell', label: 'bash:', value: 'cd .omx/agent-worktrees/agent__claude-alice__refactor-payments' },
        ],
      },
    ],
    branch: 'agent/claude-alice/refactor-payments',
    tabs: [
      {
        path: 'terminal',
        label: 'start.log',
        ext: 'sh',
        active: true,
      },
    ],
    worktrees: [
      {
        id: 'wt-alice',
        name: 'agent_claude-alice__refactor-payments',
        branch: 'agent/claude-alice/refactor-payments',
        kind: 'active',
        tag: 'claude · ready',
        message: 'Sandbox ready — edit files here, dev stays clean.',
      },
    ],
    codeLines: [
      { parts: [c('$ gx start "refactor-payments" "claude-alice"', 'c')] },
      {
        parts: [
          c('[agent-branch-start] Created branch: '),
          c('agent/claude-alice/refactor-payments', 'f'),
        ],
      },
      {
        parts: [
          c('[agent-branch-start] Worktree: '),
          c('.omx/agent-worktrees/agent__claude-alice__refactor-payments', 's'),
        ],
      },
      { parts: [c('[agent-branch-start] OpenSpec change workspace ready')] },
      { parts: [c('')] },
      { parts: [c('Next: cd into the worktree and start editing.', 'c')] },
    ],
    statusBranch: 'agent/claude-alice/refactor-payments',
  },
  {
    stepLabel: 'Step 05',
    label: 'Finish with PR + auto-cleanup',
    description: (
      <>
        <code>gx finish --via-pr --wait-for-merge --cleanup</code> commits, pushes, opens a PR,
        waits for checks, merges, and prunes the worktree. One command closes the loop.
      </>
    ),
    messages: [
      {
        kind: 'assistant',
        content: (
          <>
            Work done. Firing the full finish chain — GitGuardex will commit, push, PR, wait for merge,
            and clean the sandbox.
          </>
        ),
      },
      {
        kind: 'tool',
        title: '1 shell call',
        sub: '· gx finish',
        elapsed: '42s',
        rows: [
          {
            kind: 'shell',
            label: 'bash:',
            value: 'gx finish --via-pr --wait-for-merge --cleanup',
          },
        ],
      },
      {
        kind: 'assistant',
        content: (
          <>
            PR #124 merged. Sandbox pruned. You&rsquo;re back on a clean <code>dev</code> with the
            merge commit pulled in. 🎉
          </>
        ),
      },
    ],
    branch: 'dev',
    tabs: [
      {
        path: 'terminal',
        label: 'finish.log',
        ext: 'sh',
        active: true,
      },
    ],
    worktrees: [],
    codeLines: [
      { parts: [c('$ gx finish --via-pr --wait-for-merge --cleanup', 'c')] },
      { parts: [c('[finish] commit'), c('   ✓', 'f')] },
      { parts: [c('[finish] push'), c('     ✓', 'f')] },
      { parts: [c('[finish] open PR'), c('  ✓ #124', 'f')] },
      { parts: [c('[finish] checks'), c('   ✓', 'f')] },
      { parts: [c('[finish] merge'), c('    ✓', 'f')] },
      { parts: [c('[finish] prune'), c('    ✓', 'f')] },
      { parts: [c('')] },
      { parts: [c('On branch dev  ·  working tree clean', 'c')] },
    ],
    statusBranch: 'dev',
    statusSync: '↓ 1 ↑ 0',
    showPullAnimation: true,
  },
]

const TUTORIAL: Record<ModeKey, ModeConfig> = {
  execute: { key: 'execute', label: 'Execute mode', dotClass: 'a', steps: EXECUTE_STEPS },
  plan: { key: 'plan', label: 'Plan mode', dotClass: 'p', steps: PLAN_STEPS },
  merge: { key: 'merge', label: 'Merge mode', dotClass: 'm', steps: MERGE_STEPS },
  installation: {
    key: 'installation',
    label: 'Installation',
    dotClass: 'i',
    steps: INSTALL_STEPS,
  },
}

const MODE_GUIDES: Record<ModeKey, ModeGuide> = {
  execute: {
    eyebrow: 'Live sandbox flow',
    title: 'Watch one prompt turn into an isolated PR',
    summary:
      'Execute mode is the end-to-end story: inspect first, branch into a sandbox, stream visible diffs, ask for approval, then merge and prune the worktree.',
    highlights: [
      'Prompt, inspect, sandbox, diff, PR',
      'Parallel Codex and Claude lanes stay separated',
      'Approval and cleanup stay visible end to end',
    ],
  },
  plan: {
    eyebrow: 'Read-only planning loop',
    title: 'Teach the plan before the code exists',
    summary:
      'Plan mode slows the workflow down on purpose. The agent can only read, map risks, and draft a persistent markdown plan until the human approves execution.',
    highlights: [
      'Shift+Tab locks the agent into read-only',
      'Plans persist as markdown, not hidden context',
      'Review and revise before any writes start',
    ],
  },
  merge: {
    eyebrow: 'Conflict recovery lane',
    title: 'Show how GitGuardex merges without trashing either branch',
    summary:
      'Merge mode visualizes the recovery path when two PRs collide. A dedicated merge lane appears, reads both intents, writes a semantic resolution, and proves it with tests.',
    highlights: [
      'Conflicts are isolated before main changes',
      'A merge agent owns the repair branch',
      'Tests run before the final review and merge',
    ],
  },
  installation: {
    eyebrow: 'Repo onboarding',
    title: 'Install, audit, wire, then start safely',
    summary:
      'Installation mode explains the shortest safe path into the workflow: install the CLI, audit the repo, wire the guardrails, then use the start and finish commands instead of ad hoc git moves.',
    highlights: [
      'Doctor audits drift before setup touches files',
      'Setup wires hooks, scripts, and agent defaults',
      'Start and finish keep the branch lifecycle predictable',
    ],
  },
}

const countChangedFiles = (step: TutorialStep) =>
  step.worktrees.reduce((total, worktree) => total + (worktree.files?.length ?? 0), 0)

const DEFAULT_WATCH_COPY: Record<ModeKey, string> = {
  execute: 'The walkthrough keeps every write inside a disposable agent lane.',
  plan: 'Plan mode keeps the workflow explainable before execution begins.',
  merge: 'Conflict recovery happens in a dedicated merge lane, not on the base branch.',
  installation: 'The install path teaches the command order that keeps teams out of trouble.',
}

const getStepWatchItems = (mode: ModeKey, step: TutorialStep): string[] => {
  const changedFiles = countChangedFiles(step)
  const items: string[] = []
  const hasReadonlyWorktree = step.worktrees.some((worktree) => worktree.kind === 'readonly')
  const hasParallelWorktrees = step.worktrees.length > 1
  const hasCommitGate = step.worktrees.some((worktree) => worktree.commitReady)
  const openTab = step.tabs.find((tab) => tab.active) ?? step.tabs[0]

  if (hasReadonlyWorktree) {
    items.push('This lane is read-only. Write attempts stay blocked until the plan is approved.')
  }

  if (hasParallelWorktrees) {
    items.push('Multiple sandboxes can move at once without clobbering each other.')
  } else if (step.worktrees.length === 1) {
    items.push('A single disposable sandbox owns the live change you are watching.')
  }

  if (changedFiles > 0) {
    items.push(`${changedFiles} tracked file${changedFiles === 1 ? '' : 's'} pulse in Source Control as the step advances.`)
  }

  if (openTab) {
    items.push(`The editor stays anchored on ${openTab.label} so the step remains easy to follow.`)
  }

  if (step.messages.some((message) => message.kind === 'tool')) {
    items.push('Tool blocks narrate each transition instead of hiding the mechanics.')
  }

  if (step.messages.some((message) => message.kind === 'thinking')) {
    items.push('Thinking bubbles expose intent before side effects land.')
  }

  if (hasCommitGate) {
    items.push('The commit waits at the human approval gate even though the code is ready.')
  }

  if (step.showPullAnimation) {
    items.push('The final pull-back shows the sandbox disappearing after the merge lands.')
  }

  if (items.length === 0) {
    items.push(DEFAULT_WATCH_COPY[mode])
  }

  return items.slice(0, 3)
}

const getGuardrailCopy = (mode: ModeKey, step: TutorialStep): string => {
  if (step.worktrees.some((worktree) => worktree.kind === 'readonly')) {
    return 'Read-only mode is enforced at the tool layer, so the plan stays trustworthy until a human flips the workflow back to execution.'
  }

  if (step.worktrees.some((worktree) => worktree.commitReady)) {
    return 'On-request access still pauses before commit, which keeps the operator in control of the irreversible step.'
  }

  if (step.showPullAnimation) {
    return 'Cleanup is part of the product logic. A finished lane merges, syncs back to the base branch, and prunes the sandbox instead of leaving git debt behind.'
  }

  switch (mode) {
    case 'execute':
      return 'Execute mode protects the base branch by forcing writes into disposable worktrees first, so review and rollback stay cheap.'
    case 'plan':
      return 'Plan mode converts hidden agent intent into a concrete markdown artifact before any code or shell side effects can happen.'
    case 'merge':
      return 'Merge mode resolves conflicts in isolation, preserving both PR intents before the final branch ever gets touched.'
    case 'installation':
      return 'Installation mode teaches a fixed command sequence so teams do not half-install the guardrails and drift into unsafe manual workflows.'
  }
}

const getTakeawayCopy = (mode: ModeKey, step: TutorialStep): string => {
  if (mode === 'execute') {
    if (step.showPullAnimation) {
      return 'The happy-path promise is not just “the agent can code.” It is “the repo is clean again when the change is done.”'
    }
    if (step.worktrees.length > 1) {
      return 'Parallel agents only stay safe because each lane owns a separate branch and worktree.'
    }
    if (step.worktrees.some((worktree) => worktree.commitReady)) {
      return 'The operator is still the final authority at commit time, even when the agent did the implementation.'
    }
    if (step.worktrees.length === 1) {
      return 'Once the sandbox exists, every visible file mutation becomes reviewable and reversible.'
    }
    return 'The execute demo starts by proving that GitGuardex does not skip straight to writing code.'
  }

  if (mode === 'plan') {
    if (step.worktrees.some((worktree) => worktree.kind === 'readonly')) {
      return 'A plan is more believable when the interface proves the agent physically cannot “just start coding anyway.”'
    }
    return 'The planning loop keeps the future implementation aligned with an artifact the team can review, edit, and revisit later.'
  }

  if (mode === 'merge') {
    if (step.showPullAnimation) {
      return 'Conflict resolution is only complete after the repaired branch merges cleanly and the temporary lane disappears.'
    }
    return 'Good merge UX is about preserving intent, not just deleting conflict markers until git stops complaining.'
  }

  if (step.showPullAnimation) {
    return 'The onboarding path ends where real work begins: on a clean base branch with the workflow already wired.'
  }

  return 'The install sequence matters because teams follow habits. The tutorial teaches the safe habit, not just the commands.'
}

/* ======================= ICONS ======================= */

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

type IconName =
  | 'files'
  | 'search'
  | 'git'
  | 'debug'
  | 'extensions'
  | 'account'
  | 'settings'
  | 'plus'
  | 'refresh'
  | 'more'
  | 'branch'
  | 'check'
  | 'caret-down'
  | 'reset'
  | 'caret'
  | 'x'
  | 'copy'

function Icon({ name, className, style }: { name: IconName; className?: string; style?: CSSProperties }) {
  let content: ReactNode = null
  switch (name) {
    case 'files':
      content = (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </>
      )
      break
    case 'search':
      content = (
        <>
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </>
      )
      break
    case 'git':
      content = (
        <>
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="6" r="3" />
          <circle cx="12" cy="18" r="3" />
          <path d="M6 9v6a3 3 0 0 0 3 3h6M18 9a9 9 0 0 1-3 6" />
        </>
      )
      break
    case 'debug':
      content = (
        <>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2" />
          <circle cx="12" cy="12" r="6" />
        </>
      )
      break
    case 'extensions':
      content = (
        <>
          <rect x="3" y="3" width="8" height="8" />
          <rect x="13" y="3" width="8" height="8" />
          <rect x="3" y="13" width="8" height="8" />
          <rect x="13" y="13" width="8" height="8" />
        </>
      )
      break
    case 'account':
      content = (
        <>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </>
      )
      break
    case 'settings':
      content = (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v6M12 17v6M4.2 4.2l4.2 4.2M15.6 15.6l4.2 4.2M1 12h6M17 12h6M4.2 19.8l4.2-4.2M15.6 8.4l4.2-4.2" />
        </>
      )
      break
    case 'plus':
      content = <path d="M12 5v14M5 12h14" />
      break
    case 'refresh':
      content = (
        <>
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4-4.64 4.36A9 9 0 0 1 3.51 15" />
        </>
      )
      break
    case 'more':
      content = (
        <>
          <circle cx="5" cy="12" r="1.5" fill="currentColor" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
          <circle cx="19" cy="12" r="1.5" fill="currentColor" />
        </>
      )
      break
    case 'branch':
      content = (
        <>
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </>
      )
      break
    case 'check':
      content = <path d="M20 6 9 17l-5-5" />
      break
    case 'caret-down':
      content = <path d="m6 9 6 6 6-6" />
      break
    case 'caret':
      content = <path d="m9 18 6-6-6-6" />
      break
    case 'reset':
      content = (
        <>
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          <path d="M3 21v-5h5" />
        </>
      )
      break
    case 'x':
      content = (
        <>
          <path d="M18 6 6 18" />
          <path d="M6 6l12 12" />
        </>
      )
      break
    case 'copy':
      content = (
        <>
          <rect x="9" y="9" width="12" height="12" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </>
      )
      break
    default:
      content = null
  }

  return (
    <svg
      aria-hidden="true"
      className={className}
      style={style}
      viewBox="0 0 24 24"
      {...strokeProps}
    >
      {content}
    </svg>
  )
}

/* ======================= COMPONENTS ======================= */

function ToolRowCopyBtn({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const onCopy = async (e: ReactMouseEvent) => {
    e.stopPropagation()
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(value)
      } else if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea')
        ta.value = value
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      className={`t-copy ${copied ? 'copied' : ''}`}
      onClick={onCopy}
      aria-label={copied ? 'Copied' : 'Copy command'}
      title={copied ? 'Copied' : 'Copy command'}
    >
      <Icon
        name={copied ? 'check' : 'copy'}
        style={{ width: 12, height: 12 }}
      />
    </button>
  )
}

function MessageBubble({ message, delay }: { message: StepMessage; delay: number }) {
  const style: CSSProperties = { animationDelay: `${delay}ms` }

  if (message.kind === 'tool') {
    return (
      <div className="msg" style={style}>
        <div className="tool-block">
          <div className="head">
            <span>{message.title}</span>
            {message.sub ? <span className="cnt">{message.sub}</span> : null}
            {message.elapsed ? <span className="elapsed">{message.elapsed}</span> : null}
          </div>
          <div className="tool-list">
            {message.rows.map((row, i) => (
              <div className={`t-row ${row.kind}`} key={`${row.label}-${row.value}-${i}`}>
                <div className={`t-ico ${row.kind}`}>{iconGlyph(row.kind)}</div>
                <div className="t-body">
                  <span className="lbl">{row.label}</span>
                  <span className="vl">{row.value}</span>
                </div>
                {row.kind === 'shell' ? <ToolRowCopyBtn value={row.value} /> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (message.kind === 'plan-list') {
    return (
      <div className="msg" style={style}>
        <div className="bub plan-list">
          <ol>
            {message.items.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                {item.meta ? <span className="phase-meta">{item.meta}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      </div>
    )
  }

  const alignment = message.kind === 'user' ? 'user' : ''
  return (
    <div className={`msg ${alignment}`} style={style}>
      <div className={`bub ${message.kind}`}>{message.content}</div>
    </div>
  )
}

function iconGlyph(kind: ToolRowKind) {
  switch (kind) {
    case 'shell':
      return '>_'
    case 'read':
      return '📖'
    case 'write':
      return '✎'
    case 'tool':
      return '⚙'
    default:
      return '·'
  }
}

function WorktreeCard({
  wt,
  baseline = false,
  showPull = false,
  animationIndex,
}: {
  wt: WorktreeRow
  baseline?: boolean
  showPull?: boolean
  animationIndex?: number
}) {
  const headClass = baseline ? 'base' : wt.kind
  const containerClass = [
    'wt',
    baseline ? 'active' : 'active just-added',
    wt.kind === 'readonly' ? 'readonly' : '',
    wt.kind === 'merge' ? 'merge' : '',
    showPull ? 'dev-pulling' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const tag = wt.tag ?? (baseline ? 'base · clean' : wt.branch.split('/').slice(-1)[0].slice(0, 12))
  const totalChanges = wt.files?.length ?? 0

  return (
    <div
      className={containerClass}
      style={animationIndex != null ? { animationDelay: `${animationIndex * 120}ms` } : undefined}
    >
      <div className={`wt-head ${headClass}`}>
        <Icon name="branch" className="ic" />
        <span className="name" title={wt.name}>
          {wt.name}
        </span>
        <span className="tag">{tag}</span>
        {totalChanges > 0 ? <span className="ct">{totalChanges}</span> : null}
        {showPull ? (
          <span className="commit-chip">↓ pull · +1 commit</span>
        ) : null}
      </div>

      {showPull ? <div className="pull-bar" /> : null}

      {wt.message ? (
        <div className={`wt-message ${showPull ? 'info' : ''}`}>
          {showPull ? 'Pulling merged commit from origin/dev…' : wt.message}
        </div>
      ) : null}

      {wt.commitReady ? (
        <button
          type="button"
          className={`wt-commit ${wt.commitState === 'ready' ? 'ready' : ''}`}
        >
          <Icon name="check" />
          Commit
        </button>
      ) : null}

      {totalChanges > 0 ? (
        <div className="wt-changes">
          <div className="wt-changes-head">
            <Icon name="caret-down" />
            <span>Changes</span>
            <span className="ct">{totalChanges}</span>
          </div>
          <div className="tree">
            {wt.files!.map((f, idx) => {
              const name = f.path.split('/').pop() ?? f.path
              const statusChar =
                f.status === 'conflict' ? '!' : f.status === 'ok' ? '✓' : f.status
              const nodeClass = [
                'tree-node',
                'file',
                f.status === 'conflict' ? 'conflict' : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <div
                  className={nodeClass}
                  key={`${f.path}-${idx}`}
                  style={{ animationDelay: `${idx * 120}ms` }}
                  title={f.path}
                >
                  <span className="carett" />
                  <span className={`fico ${f.ext}`}>{f.ext.toUpperCase()}</span>
                  <span className="nm">{name}</span>
                  <span className={`status ${f.status}`}>{statusChar}</span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ======================= PAGE ======================= */

export default function Home() {
  const [mode, setMode] = useState<ModeKey>('execute')
  const [stepIndex, setStepIndex] = useState(0)
  const [animationSeed, setAnimationSeed] = useState(0)
  const [copied, setCopied] = useState(false)

  const copyInstall = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(INSTALL_COMMAND)
      } else if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea')
        ta.value = INSTALL_COMMAND
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — ignore */
    }
  }, [])

  const modeData = TUTORIAL[mode]
  const modeGuide = MODE_GUIDES[mode]
  const steps = modeData.steps
  const activeStep = steps[stepIndex]

  const activityChangeCount = useMemo(() => {
    return activeStep.worktrees.reduce((total, w) => total + (w.files?.length ?? 0), 0)
  }, [activeStep])

  const switchMode = useCallback(
    (nextMode: ModeKey) => {
      if (nextMode === mode) return
      setMode(nextMode)
      setStepIndex(0)
      setAnimationSeed((s) => s + 1)
    },
    [mode],
  )

  const goToStep = useCallback(
    (idx: number) => {
      if (idx < 0 || idx > steps.length - 1) return
      setStepIndex(idx)
      setAnimationSeed((s) => s + 1)
    },
    [steps.length],
  )

  const goBack = useCallback(() => {
    if (stepIndex === 0) return
    goToStep(stepIndex - 1)
  }, [goToStep, stepIndex])

  const reset = useCallback(() => {
    setStepIndex(0)
    setAnimationSeed((s) => s + 1)
  }, [])

  const goNext = useCallback(() => {
    if (stepIndex === steps.length - 1) {
      reset()
      return
    }
    goToStep(stepIndex + 1)
  }, [goToStep, reset, stepIndex, steps.length])

  const closeWalkthrough = useCallback(() => {
    setMode('execute')
    setStepIndex(0)
    setAnimationSeed((s) => s + 1)
  }, [])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goNext()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goBack()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeWalkthrough()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [closeWalkthrough, goBack, goNext])

  const statusBranch = activeStep.statusBranch ?? activeStep.branch
  const statusSync = activeStep.statusSync ?? '↓ 0 ↑ 0'
  const statusErrors = activeStep.statusErrors ?? 0
  const showPull = !!activeStep.showPullAnimation
  const progressPercent = Math.round(((stepIndex + 1) / steps.length) * 100)
  const watchItems = getStepWatchItems(mode, activeStep)
  const guardrailCopy = getGuardrailCopy(mode, activeStep)
  const takeawayCopy = getTakeawayCopy(mode, activeStep)

  const summaryCards = [
    {
      label: 'Progress',
      value: `${stepIndex + 1}/${steps.length}`,
      meta: `${progressPercent}% through ${modeData.label.toLowerCase()}`,
    },
    {
      label: 'Lane',
      value: activeStep.worktrees.some((worktree) => worktree.kind === 'readonly')
        ? 'read-only'
        : mode === 'merge'
          ? 'merge'
          : activeStep.worktrees.length > 0
            ? 'live'
            : 'standby',
      meta:
        activeStep.worktrees.length > 0
          ? `${activeStep.worktrees.length} sandbox${activeStep.worktrees.length === 1 ? '' : 'es'} visible`
          : 'base branch only',
    },
    {
      label: 'Tracked files',
      value: `${activityChangeCount}`,
      meta: activityChangeCount > 0 ? 'surfacing in Source Control' : 'no writes yet',
    },
    {
      label: 'Branch state',
      value: statusBranch === 'dev' ? 'dev' : 'agent',
      meta: statusBranch,
    },
  ]

  return (
    <main className="how-it-works-page">
      <header className="top">
        <div className="lft">
          <div className="corner-stack">
            <div className="brand-block guardex-brand">
              <div className="mark guardex-mark" aria-hidden>
                <svg
                  viewBox="0 0 48 48"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 28c2-8 8-14 16-15 4-.5 8 0 11 2l4-3 1 6-3 2c2 3 2 7 1 11-1 4-4 7-8 9l-2 4-5-2-6 2-2-4c-4-2-6-6-7-12z" />
                  <circle cx="30" cy="22" r="1.6" fill="currentColor" />
                  <path d="M14 34l-2 6" />
                  <path d="M22 38l-1 6" />
                  <path d="M30 36l2 5" />
                </svg>
              </div>
              <div className="brand-copy">
                <div className="brand-eyebrow">guardian workflow</div>
                <div className="title">GitGuardex</div>
                <div className="sub">
                  the Guardian T-Rex for your repo ·{' '}
                  <a
                    className="guardex-link"
                    href="https://guardextutorial.com"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    guardextutorial.com
                  </a>
                </div>
              </div>
            </div>
            <div className="brand-block how-brand">
              <div className="mark how-mark" aria-hidden>
                R
              </div>
              <div className="brand-copy">
                <div className="brand-eyebrow">interactive walkthrough</div>
                <div className="title">How it works</div>
                <div className="sub">Watch an agent run — from prompt to merged PR</div>
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          className={`install-pill ${copied ? 'copied' : ''}`}
          onClick={copyInstall}
          aria-label="Copy install command"
          title="Copy install command"
        >
          <span className="dollar" aria-hidden>
            $
          </span>
          <span className="cmd">{INSTALL_COMMAND}</span>
          <span className="copy-ind" aria-hidden>
            {copied ? (
              <Icon name="check" style={{ width: 13, height: 13 }} />
            ) : (
              <Icon name="copy" style={{ width: 13, height: 13 }} />
            )}
          </span>
          <span className="copy-toast" role="status" aria-live="polite">
            {copied ? 'copied' : ''}
          </span>
        </button>

        <nav className="mode-seg" aria-label="Workflow modes">
          {MODE_ORDER.map((key) => {
            const item = TUTORIAL[key]
            const isActive = key === mode
            return (
              <button
                key={key}
                type="button"
                className={isActive ? 'active' : ''}
                onClick={() => switchMode(key)}
              >
                <span className={`dotc ${item.dotClass}`} aria-hidden />
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="rgt">
          <span className="step-count">
            <span className="step-count-label">step</span>
            <span className="mono">{stepIndex + 1}</span> / <span className="mono">{steps.length}</span>
          </span>
          <button
            aria-label="Close walkthrough"
            className="close-btn"
            onClick={closeWalkthrough}
            type="button"
          >
            ×
          </button>
        </div>
      </header>

      <div className="main">
        <section className="pane chat-pane" aria-label="Chat transcript">
          <div className="pane-label">chat · {PRODUCT_LABEL.toLowerCase()}</div>

          <section className="tutorial-brief" aria-label={`${modeData.label} overview`}>
            <div className="tutorial-brief-head">
              <div className="tutorial-copy">
                <div className="tutorial-kicker">{modeGuide.eyebrow}</div>
                <h1 className="tutorial-title">{modeGuide.title}</h1>
              </div>
              <span className={`tutorial-mode-pill ${mode}`} aria-live="polite">
                {modeData.label}
              </span>
            </div>

            <p className="tutorial-summary">{modeGuide.summary}</p>

            <div className="tutorial-progress">
              <div className="tutorial-progress-copy">
                <span>{activeStep.stepLabel}</span>
                <span>{progressPercent}% complete</span>
              </div>
              <div className="tutorial-progress-track" aria-hidden>
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            </div>

            <div className="tutorial-meta-grid">
              {summaryCards.map((card) => (
                <div className="tutorial-stat" key={card.label}>
                  <span className="tutorial-stat-label">{card.label}</span>
                  <strong className="tutorial-stat-value">{card.value}</strong>
                  <span className="tutorial-stat-meta">{card.meta}</span>
                </div>
              ))}
            </div>

            <div className="tutorial-highlights">
              {modeGuide.highlights.map((highlight) => (
                <div className="tutorial-highlight" key={highlight}>
                  {highlight}
                </div>
              ))}
            </div>
          </section>

          <div
            className="chat-scroll"
            key={`chat-${mode}-${stepIndex}-${animationSeed}`}
          >
            {activeStep.messages.map((msg, index) => (
              <MessageBubble
                key={`msg-${index}-${mode}-${stepIndex}-${animationSeed}`}
                message={msg}
                delay={index * 160}
              />
            ))}
          </div>

          <div className="controls">
            <div className="ctrl-top">
              <div className="ctrl-stage">
                <div>
                  <span className="ctrl-step-num">{activeStep.stepLabel}</span>
                  <span className="ctrl-step-label">{activeStep.label}</span>
                </div>
                <div className="ctrl-progress">
                  <span className="ctrl-progress-copy">lesson progress</span>
                  <div className="ctrl-progress-track" aria-hidden>
                    <span style={{ width: `${progressPercent}%` }} />
                  </div>
                </div>
              </div>
              <div className="dots" aria-label="Steps">
                {steps.map((step, i) => (
                  <button
                    type="button"
                    key={step.stepLabel + step.label}
                    aria-label={`Jump to ${step.stepLabel}`}
                    className={`d ${i === stepIndex ? 'active' : ''} ${
                      i < stepIndex ? 'done' : ''
                    }`}
                    onClick={() => goToStep(i)}
                  />
                ))}
              </div>
            </div>
            <div className="ctrl-desc">{activeStep.description}</div>
            <div className="ctrl-guide-grid">
              <div className="guide-card guide-card-watch">
                <span className="guide-eyebrow">Watch for</span>
                <div className="guide-token-grid">
                  {watchItems.map((item) => (
                    <span className="guide-token" key={item}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>

              <div className="guide-card">
                <span className="guide-eyebrow">Guardrail</span>
                <p>{guardrailCopy}</p>
              </div>

              <div className="guide-card">
                <span className="guide-eyebrow">Takeaway</span>
                <p>{takeawayCopy}</p>
              </div>
            </div>
            <div className="ctrl-btns">
              <button
                type="button"
                className="btn"
                onClick={goBack}
                disabled={stepIndex === 0}
              >
                ← Back
              </button>
              <button type="button" className="btn" onClick={reset}>
                <Icon name="reset" style={{ width: 13, height: 13 }} /> Reset
              </button>
              <button type="button" className="btn primary" onClick={goNext}>
                {stepIndex === steps.length - 1 ? 'Restart demo' : 'Next step →'}
              </button>
            </div>
          </div>
        </section>

        <section className="pane right vs" aria-label="VS Code live preview">
          <div className="pane-label">vs code · live</div>

          <div className="vs-titlebar">
            <span className="traffic" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <span>{EDITOR_LABEL}</span>
          </div>

          <div className="vs-body">
            <aside className="vs-activity" aria-label="Activity bar">
              <button type="button" className="ab" aria-label="Explorer">
                <Icon name="files" />
              </button>
              <button type="button" className="ab" aria-label="Search">
                <Icon name="search" />
              </button>
              <button type="button" className="ab active" aria-label="Source control">
                <Icon name="git" />
                <span className={`badge ${activityChangeCount > 0 ? 'live' : ''}`}>
                  {activityChangeCount}
                </span>
              </button>
              <button type="button" className="ab" aria-label="Run and debug">
                <Icon name="debug" />
              </button>
              <button type="button" className="ab" aria-label="Extensions">
                <Icon name="extensions" />
              </button>
              <span className="sp" />
              <button type="button" className="ab" aria-label="Account">
                <Icon name="account" />
              </button>
              <button type="button" className="ab" aria-label="Settings">
                <Icon name="settings" />
              </button>
            </aside>

            <div className="vs-sc">
              <div className="vs-sc-head">
                <span>Source Control</span>
                <span className="sc-actions">
                  <button type="button" aria-label="Create branch">
                    <Icon name="plus" />
                  </button>
                  <button type="button" aria-label="Refresh">
                    <Icon name="refresh" />
                  </button>
                  <button type="button" aria-label="More">
                    <Icon name="more" />
                  </button>
                </span>
              </div>

              <div
                className="vs-sc-scroll"
                key={`sc-${mode}-${stepIndex}-${animationSeed}`}
              >
                <WorktreeCard
                  baseline
                  showPull={showPull}
                  wt={{
                    id: 'dev',
                    name: 'dev',
                    branch: 'dev',
                    kind: 'active',
                    message: 'Baseline branch — no agent activity.',
                  }}
                />
                {activeStep.worktrees.map((w, i) => (
                  <WorktreeCard
                    key={`${w.id}-${animationSeed}`}
                    wt={w}
                    animationIndex={i}
                  />
                ))}
              </div>
            </div>

            <div className="vs-editor">
              <div className="vs-tabs">
                {activeStep.tabs.length === 0 ? (
                  <div className="vs-tab active">
                    <span className="fico default">—</span>
                    <span className="title-text">no file open</span>
                  </div>
                ) : (
                  activeStep.tabs.map((tab) => (
                    <div
                      key={tab.path + tab.label}
                      className={`vs-tab ${tab.active ? 'active' : ''} ${
                        tab.state === 'conflict' ? 'conflict' : ''
                      }`}
                    >
                      <span className={`fico ${tab.ext}`}>{tab.ext.toUpperCase()}</span>
                      <span className="title-text">{tab.label}</span>
                      {tab.badge ? (
                        <span
                          className="mono"
                          style={{
                            color: 'var(--purple)',
                            fontSize: 10,
                            marginLeft: 4,
                          }}
                        >
                          {tab.badge}
                        </span>
                      ) : null}
                      <span className="cl">
                        <Icon name="x" style={{ width: 11, height: 11 }} />
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div
                className={`vs-code ${activeStep.pulseEditor ? 'pulsed' : ''}`}
                key={`code-${mode}-${stepIndex}-${animationSeed}`}
              >
                {activeStep.codeLines.map((line, i) => (
                  <div
                    key={`line-${i}-${animationSeed}`}
                    className={`line ${line.kind ?? ''}`}
                    style={{ animationDelay: `${i * 45}ms` }}
                  >
                    <span className="ln">{i + 1}</span>
                    <span className="gutter" />
                    <span className="content">
                      {line.parts.map((part, pi) => (
                        <span key={pi} className={part.token ? `tok-${part.token}` : ''}>
                          {part.text}
                        </span>
                      ))}
                      {line.typing ? <span className="caret" /> : null}
                    </span>
                  </div>
                ))}
              </div>

              <div className="vs-status">
                <span className="item">
                  <Icon name="branch" />
                  {statusBranch}
                </span>
                <span className="item">{statusSync}</span>
                <span className="item">⊘ {statusErrors} ⚠ 0</span>
                <span className="sp" />
                <span className="item">Ln 1, Col 1</span>
                <span className="item">UTF-8</span>
                <span className="item">TypeScript React</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
