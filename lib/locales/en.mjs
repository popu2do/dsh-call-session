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
      description: 'Send a 1:1 unicast call to an active session. Automatically selects steer for running sessions or followup for idle sessions. Supports call types (task_dispatch, task_report, notice) and blackboard post associations.',
      parameters: {
        target_session_id: 'Target session ID, supporting exact match or a unique prefix of at least 8 characters. Wildcards are not supported.',
        message: 'Task instructions, progress report, or notification content, max 4000 characters.',
        call_type: 'Call intent and convergence semantics: task_dispatch (task/request, respond with task_report if results needed), task_report (report/delivery, no reply needed), notice (informational, no reply needed). Defaults to task_dispatch.',
        context_post_ids: 'List of referenced public blackboard post IDs.'
      }
    },
    session_query: {
      name: 'session_query',
      description: 'Query active sessions. Returns current workspace sessions by default; set cross_workspace: true for global discovery. Status normalized to running or idle.',
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
      description: 'Create an independent peer root session in the current workspace. Use when a new session or parallel peer task is requested. Independent sessions run long-term in parallel, distinct from temporary subtasks. Inherits current session model and preset by default.',
      parameters: {
        title: 'Peer session title without privileged prefixes or newlines.',
        initial_message: 'Initial task message automatically delivered to start the first turn.',
        context_post_ids: 'Optional list of blackboard post IDs to prepend to the initial message.',
        model: 'Optional model ID override. Inherits current session model by default unless specified.',
        reasoning_effort: 'Optional reasoning effort override (e.g. low, medium, high). Inherits current session effort by default.',
        preset: 'Optional agent preset ID. Inherits current session or global default preset unless specified.'
      }
    }
  },
  prompts: {
    usageSection: () => [
      '## Cross-Session Communication & Collaboration',
      '',
      'Coordinate with other active sessions in real time:',
      '1. Discover sessions: Use `session_query` to find active sessions (scoped to current workspace by default; use `cross_workspace: true` for cross-workspace discovery).',
      '2. Unicast call: Use `session_call` to send tasks, reports, or notices to a specific session (`target_session_id`). Wildcards (*, all) are not supported.',
      '3. Create peer session: Use `session_create` to create an independent peer session in the current workspace.',
      '4. Shared blackboard: Use `board_post` to publish milestones, tasks, or shared state. Use `board_list` to query blackboard posts, and `board_clear` to dismiss or purge them.',
      '',
      'Call types and convergence rules for `session_call`:',
      '- `task_dispatch`: Dispatch a task, provide suggestions, or initiate collaboration. Receiver responds with a single `task_report` only when deliverables or conclusions are required; no response needed otherwise.',
      '- `task_report`: Report task results, deliver deliverables, or close out collaboration. Receiver archives the result without replying.',
      '- `notice`: One-way status update or informational notification. Read-only; receiver does not invoke `session_call` to reply.',
      '- Autonomous convergence rule: Both models autonomously converge communication based on intent semantics and business context. Empty pleasantries (e.g. merely replying "Received" or "Understood") are strictly forbidden.',
      '',
      'Intent routing (session_create vs subagent):',
      '- Use `session_create`: Create an independent peer root session. Use when the user requests a new session or parallel peer task. Independent sessions run long-term in parallel, distinct from temporary subtasks. Inherits current session model parameters and preset configuration by default unless overridden.',
      '- Use `subagent`: Only for internal parent-child delegation where the parent waits for or collects the child result.'
    ].join('\n'),
    authorReminder: (posts) => {
      const data = formatReminderItems(posts, 3, ', ');
      if (!data) return '';
      const countStr = data.extra > 0 ? `, and ${data.extra} more (total ${data.count})` : '';
      return `You have ${data.count} active post(s) on the public blackboard, including ${data.items}${countStr}. Please invoke board_clear to clean them up promptly once tasks are completed.`;
    }
  },
  messages: {
    boardPostSuccess: (postId) => `[Board] Published post #${postId}`,
    boardPostFailure: (error) => `[Board] Failed to publish post: ${error}`,
    boardClearSuccess: (count, action) => `Cleared ${count} blackboard post(s), ${action === 'delete' || action === 'purge' ? 'purged' : 'dismissed'}.`,
    boardClearFailure: (error) => `[Board] Failed to clear: ${error}`,
    sessionCallSuccess: (targetSessionId, deliveryMode, callType) => `Successfully called target session [${targetSessionId}] via unicast ${deliveryMode} with type ${callType}`,
    sessionCallFailure: (error) => `[Session] Call failed: ${error || 'unknown error'}`,
    sessionCreateSuccess: (sessionId, title, status, generation) => `[Session] Successfully created peer session [${sessionId}] "${title}", status: ${status}, gen: ${generation}`,
    sessionCreateFailure: (error) => `[Session] Failed to create peer session: ${error || 'unknown error'}`,
    sessionQueryEmpty: (counts) => `### Session Query Overview\n\nNo active sessions found.\n\n**Total:** ${counts.total} | **Active:** ${counts.active} | **Idle:** ${counts.idle}`,
    sessionQueryOverview: (rows, counts) => formatSessionQueryTable(
      rows,
      counts,
      { title: 'Session Query Overview', sessionId: 'Session ID', sessionTitle: 'Title', status: 'Status', workspace: 'Workspace', current: 'Current', untitled: 'Untitled', yes: 'Yes', no: 'No' },
      { total: 'Total', active: 'Active', idle: 'Idle' }
    )
  }
};
