/**
 * English (en) Localization Catalog for dsh-call-session
 */
import { formatReminderItems, formatSessionQueryTable } from './table.mjs';

export default {
  locale: 'en',
  tools: {
    board_post: {
      name: 'board_post',
      description: 'Publish shared facts, status, or announcement data to the public blackboard. Other sessions can query via board_list. To directly notify a target session, invoke session_call with the returned postId.',
      parameters: {
        topic: 'Topic or category name, e.g. task:audit, spec:api.',
        content: 'Post body content supporting Markdown, plain text, or JSON string, max 64KB.',
        tags: "Tag list for categorization and filtering, e.g. ['p0', 'blocked'].",
        ttl: 'Time-to-live in seconds. Defaults to 3600 (1 hour), max 86400 (24 hours). Set to 0 to use default.',
        metadata: 'Optional structured metadata key-value pairs for associating file paths, version numbers, etc.'
      }
    },
    board_list: {
      name: 'board_list',
      description: 'Query active announcements and shared state on the public blackboard. Defaults to titles and metadata summary only (titles_only: true); specify id to retrieve full content. Scoped to current workspace by default.',
      parameters: {
        id: 'Exact post ID to retrieve, e.g. post-1725300000000-abcd. When id is specified, titles_only automatically defaults to false.',
        topic: 'Filter by exact topic, e.g. task:audit.',
        topic_prefix: 'Filter by topic prefix, e.g. task:.',
        tag: 'Filter by a single tag.',
        active_only: 'Whether to return only active, unexpired, and undismissed posts. Defaults to true.',
        cross_workspace: 'Whether to query posts across all workspaces. Defaults to false (current workspace only).',
        titles_only: 'Whether to return titles and metadata summary only without content body. Defaults to true when id is omitted.',
        limit: 'Maximum number of posts to return. Defaults to 20, max 100.'
      }
    },
    board_clear: {
      name: 'board_clear',
      description: 'Clean up or archive specified posts or topics on the blackboard.',
      parameters: {
        id: 'Target post ID, e.g. post-1725300000000-abcd.',
        topic: 'Batch clean by topic, e.g. task:audit. Effective when id is not specified.',
        mode: "Cleanup mode: 'dismiss' to archive and retain records, or 'purge' for physical deletion. Defaults to 'dismiss'."
      }
    },
    session_call: {
      name: 'session_call',
      description: 'Send a 1:1 unicast call to a live session. Automatically selects steer for running sessions or followup for idle sessions. Supports call types (notice, task_soft, task_hard, task_report) and blackboard post associations.',
      parameters: {
        target_session_id: 'Target session ID. The canonical form is session-<uuid>; a bare uuid is accepted and equivalent. Supports exact match or a unique prefix of at least 8 characters. Wildcards are not supported.',
        message: 'Task instructions, progress report, or notification content, max 4000 characters.',
        call_type: 'Call intent and convergence semantics: notice (one-way notice, no reply needed), task_soft (notify task with pre-step reminder, never blocks the end of a turn), task_hard (obliged task that requires a report and is intercepted at turn end), task_report (delivery and obligation settlement). Defaults to task_soft.',
        context_post_ids: 'List of referenced public blackboard post IDs.',
        wait_ms: 'Optional lightweight handshake timeout in milliseconds, default 300ms. Set to 0 for immediate return without wait.'
      }
    },
    session_query: {
      name: 'session_query',
      description: 'Query live sessions. Returns current workspace sessions by default; set cross_workspace: true for global discovery. Status normalized to running or idle.',
      parameters: {
        query: 'Search keyword matching Session ID or Title.',
        running_only: 'Whether to return only sessions currently in running status. Defaults to false.',
        cross_workspace: 'Whether to query sessions across all workspaces. Defaults to false (current workspace only).',
        top_level_only: 'Whether to list only top-level root sessions, excluding subagents. Defaults to true.',
        limit: 'Maximum number of sessions to return. Defaults to 50, max 100.'
      }
    },
    session_create: {
      name: 'session_create',
      description: 'Create an independent peer root session. The peer runs in the caller workspace unless workspace specifies a registered workspace; a subdirectory of a workspace is not a valid target. Use when a new session or parallel peer task is requested. Independent sessions run long-term in parallel, distinct from temporary subtasks. Inherits current session model and preset by default.',
      parameters: {
        title: 'Peer session title without privileged prefixes or newlines.',
        initial_message: 'Initial task message automatically delivered to start the first turn.',
      call_type: 'Call type of the initial message. Defaults to task_soft; use task_hard when a report is required, notice for a plain heads-up.',
        context_post_ids: 'Optional list of blackboard post IDs to prepend to the initial message.',
        model: 'Optional model ID override. Inherits current session model by default unless specified.',
        reasoning_effort: 'Optional reasoning effort override (e.g. low, medium, high). Inherits current session effort by default.',
        preset: 'Optional agent preset ID. Inherits current session or global default preset unless specified.',
        workspace: 'Optional target workspace directory. Defaults to current workspace; creates cross-workspace peer when specified (ADR-0010).',
        wait_ms: 'Optional startup handshake timeout in milliseconds, default 300ms. Set to 0 for immediate return without wait.'
      }
    }
  },
  prompts: {
    usageSection: () => [
      '## Cross-Session Communication & Collaboration',
      '',
      'Coordinate with other live sessions in real time:',
      '1. Discover sessions: Use `session_query` to find live sessions (scoped to current workspace by default; use `cross_workspace: true` for cross-workspace discovery).',
      '2. Unicast call: Use `session_call` to send tasks, reports, or notices to a specific session (`target_session_id`). Wildcards (*, all) are not supported.',
      '3. Create peer session: Use `session_create` to create an independent peer session in the current workspace.',
      '4. Shared blackboard: Use `board_post` to publish milestones, tasks, or shared state. Use `board_list` to query blackboard posts, and `board_clear` to dismiss or purge them.',
      '',
      'Call types and convergence rules for `session_call`:',
      '- `task_soft`: Notify task. Dispatches suggestions, prerequisites, or lightweight tasks. Receiver should settle via a single `task_report`; injected into pre-step system context, but the end of the turn is never blocked.',
      '- `task_hard`: Obliged task with mandatory report obligation. If the receiver attempts to stop without delivering a `task_report`, turn stopping is intercepted with a reminder.',
      '- `task_report`: Report task results, deliver deliverables, or close out collaboration. Settles open tasks (FIFO 1:1); receiver archives without replying.',
      '- `notice`: One-way status update or informational notification. Read-only without report obligation; receiver does not invoke `session_call` to reply.',
      '- Autonomous convergence rule: Both models autonomously converge communication based on intent semantics and business context. Empty pleasantries (e.g. merely replying "Received" or "Understood") are strictly forbidden.',
      '',
      'Intent routing (session_create vs subagent):',
      '- Use `session_create`: Create an independent peer root session. Use when the user requests a new session or parallel peer task. Independent sessions run long-term in parallel, distinct from temporary subtasks. Inherits current session model parameters and preset configuration by default unless overridden.',
      '- Use `subagent`: Only for temporary subtask delegation inside a session, where the calling session waits for or collects the result.'
    ].join('\n'),
    authorReminder: (posts) => {
      const data = formatReminderItems(posts, 3, ', ');
      if (!data) return '';
      const countStr = data.extra > 0 ? `, and ${data.extra} more (total ${data.count})` : '';
      return `You have ${data.count} active post(s) on the public blackboard, including ${data.items}${countStr}. Please invoke board_clear to clean them up promptly once tasks are completed.`;
    },
    taskReminder: (tasks) => {
      if (!Array.isArray(tasks) || tasks.length === 0) return '';
      const callers = Array.from(new Set(tasks.map(t => t.callerTitle || t.callerSessionId))).slice(0, 3).join(', ');
      const count = tasks.length;
      const countStr = count > 1 ? ` (${count} tasks total)` : '';
      return `[Pending Tasks] You have pending collaboration tasks from ${callers}${countStr}. Please report results back to the caller using session_call(call_type='task_report') when finished.`;
    },
    taskHardTurnReminder: (tasks) => {
      if (!Array.isArray(tasks) || tasks.length === 0) return '';
      const callers = Array.from(new Set(tasks.map(t => t.callerTitle || t.callerSessionId))).slice(0, 3).join(', ');
      const count = tasks.length;
      const countStr = count > 1 ? ` (${count} tasks total)` : '';
      return `[Task Hard Obligation] You have pending obliged tasks from ${callers}${countStr}. Please invoke session_call(call_type='task_report') to report results before ending your turn.`;
    }
  },
  messages: {
    boardPostSuccess: (postId) => `[Board] Published post #${postId}`,
    boardPostFailure: (error) => `[Board] Failed to publish post: ${error}`,
    boardClearSuccess: (count, action) => `Cleared ${count} blackboard post(s), ${action === 'delete' || action === 'purge' ? 'purged' : 'dismissed'}.`,
    boardClearFailure: (error) => `[Board] Failed to clear: ${error}`,
    sessionCallSuccess: (targetSessionId, deliveryMode, callType, executionState, deliveryState) => {
      const isRunning = executionState === 'running';
      const isPending = executionState === 'pending' || deliveryState === 'enqueued';
      const stateNote = isRunning ? 'physical execution confirmed' : (isPending ? 'enqueued, execution pending' : 'delivered');
      const convergenceNote = (callType === 'task_soft' || callType === 'task_hard')
        ? (isPending ? 'task enqueued awaiting execution, check session_query later' : 'task dispatched, await target task_report, no polling needed')
        : (callType === 'task_report' ? 'report delivered, no reply needed' : 'one-way notice, no reply needed');
      return `[Session] Dispatched via unicast ${deliveryMode} to target session [${targetSessionId}], type: ${callType} (${stateNote}; ${convergenceNote})`;
    },
    sessionCallFailure: (error) => `[Session] Call failed: ${error || 'unknown error'}`,
    sessionCreateSuccess: (sessionId, title, status, generation, executionState, deliveryState, hasInitialMessage) => {
      const isRunning = executionState === 'running' || status === 'running';
      const isError = status === 'error' || executionState === 'crashed';
      const stateNote = isError ? 'startup crashed' : (isRunning ? 'physical execution confirmed' : (status === 'idle' ? 'idle ready' : 'enqueued pending'));
      const convergenceSuffix = (!isError && hasInitialMessage) ? '; initial task dispatched, await target task_report, no polling needed' : '';
      return `[Session] Successfully created peer session [${sessionId}] "${title}", status: ${status} (${stateNote}, gen: ${generation}${convergenceSuffix})`;
    },
    sessionCreateFailure: (error) => `[Session] Failed to create peer session: ${error || 'unknown error'}`,
    sessionQueryEmpty: (counts) => `### Session Query Overview\n\nNo live sessions found.\n\n**Total:** ${counts.total} | **Active:** ${counts.active} | **Idle:** ${counts.idle}`,
    sessionQueryOverview: (rows, counts) => formatSessionQueryTable(
      rows,
      counts,
      { title: 'Session Query Overview', sessionId: 'Session ID', sessionTitle: 'Title', status: 'Status', workspace: 'Workspace', current: 'Current', untitled: 'Untitled', yes: 'Yes', no: 'No' },
      { total: 'Total', active: 'Active', idle: 'Idle' }
    )
  }
};