/**
 * Simplified Chinese (zh) Localization Catalog for dsh-call-session
 */
import { formatReminderItems, formatSessionQueryTable } from './table.mjs';

export default {
  locale: 'zh',
  tools: {
    board_post: {
      name: 'board_post',
      description: '向公共黑板发布共享事实、状态或公告数据。其他会话可通过 board_list 按需读取。若需直接通知目标会话，请在发布后调用 session_call 并附带返回的 postId。',
      parameters: {
        topic: '主题或业务分类，例如 task:audit、spec:api。',
        content: '发布的主体内容，支持 Markdown、纯文本或 JSON 字符串，最大 64KB。',
        tags: "标签列表，用于分类与检索。例如 ['p0', 'blocked']。",
        ttl: '生存时间，单位为秒。默认 3600 秒即 1 小时，最大 86400 秒即 24 小时。设为 0 表示使用默认值。',
        metadata: '可选结构化元数据键值对，用于存储关联文件路径、版本号等。'
      }
    },
    board_list: {
      name: 'board_list',
      description: '查询公共黑板上的有效公告与共享状态。默认仅返回标题与元数据摘要 titles_only: true；支持通过 id 精确查阅单条详情，自动包含正文。默认仅限当前工程工作区。',
      parameters: {
        id: '按条目唯一 ID 精确检索，例如 post-1725300000000-abcd。指定 id 时 titles_only 默认自动分流为 false 以便直取正文。',
        topic: '按完整主题过滤，例如 task:audit。',
        topic_prefix: '按主题前缀过滤，例如 task:。',
        tag: '按单个标签过滤。',
        active_only: '是否仅返回未过期且未归档的活跃记录。默认为 true。',
        cross_workspace: '是否查询所有工作区的条目。默认为 false，即仅限当前工作区。',
        titles_only: '是否仅返回标题与元数据摘要，不含 content 正文。未指定 id 时默认为 true，指定 id 时默认为 false。',
        limit: '返回条数限制。默认 20，最大 100。'
      }
    },
    board_clear: {
      name: 'board_clear',
      description: '清理或归档黑板上的指定条目或主题。',
      parameters: {
        id: '目标条目 ID，例如 post-1725300000000-abcd。',
        topic: '按主题批量清理，例如 task:audit。未指定 id 时生效。',
        mode: "清理模式：'dismiss' 归档保留记录，或 'purge' 物理删除。默认 'dismiss'。"
      }
    },
    session_call: {
      name: 'session_call',
      description: '向指定活跃会话发起单播调用。根据目标状态自动选择 steer 运行中引导或 followup 空闲唤醒。支持呼叫类别 task_dispatch 派发与建议、task_report 汇报与交付、notice 单向通报，并支持关联公共黑板条目 context_post_ids。',
      parameters: {
        target_session_id: '目标会话 Session ID，支持精确匹配或大于等于 8 位的唯一前缀，不支持通配符。',
        message: '任务指令、进度汇报或通知内容，最大 4000 字符。',
        call_type: '呼叫类别与收敛语义：task_dispatch 任务派发与协作请求，需结果时单次 task_report 答复；task_report 结果汇报与收口归档，无需回复；notice 单向通报，无需回复。默认 task_dispatch。',
        context_post_ids: '引用的公共黑板条目 ID 列表。'
      }
    },
    session_query: {
      name: 'session_query',
      description: '查询当前活跃会话。默认仅返回当前工作区的会话；跨工作区查询请设置 cross_workspace: true。状态规范化为 running 或 idle。',
      parameters: {
        query: '搜索关键词，匹配 Session ID 或 Title。',
        running_only: '是否仅返回处于 running 状态的会话。默认为 false。',
        cross_workspace: '是否查询所有工作区的会话。默认为 false，即仅限当前工作区。',
        top_level_only: '是否仅列出顶层会话，排除子代理与临时会话。默认为 true。',
        limit: '返回条数限制。默认 50，最大 100。'
      }
    },
    session_create: {
      name: 'session_create',
      description: '创建同级会话。用户要求新建会话、新开 session 或平级会话时使用。独立会话可长期并行运行，不同于临时子任务 subagent。默认继承当前会话的模型参数与预设配置，除非手动指定。',
      parameters: {
        title: '同级会话标题，不包含特权前缀与换行符。',
        initial_message: '初始任务指令，会话创建后立即自动投递并启动第一轮。',
        context_post_ids: '可选关联的黑板条目 ID 列表，将自动挂载至初始任务指令首部。',
        model: '可选覆写目标会话所使用的模型 ID。默认继承当前会话模型，除非手动指定。',
        reasoning_effort: '可选覆写目标会话所使用的推理强度，例如 low、medium、high。默认继承当前会话推理强度，除非手动指定。',
        preset: '可选指定挂载的智能体预设 ID。默认继承当前会话或全局默认预设，除非手动指定。'
      }
    }
  },
  prompts: {
    usageSection: () => [
      '## 会话协作',
      '',
      '实时与其他活跃会话协同：',
      '1. 发现会话：使用 `session_query` 查询活跃会话，默认限定当前工作区，跨工作区发现请设置 `cross_workspace: true`。',
      '2. 单播调用：使用 `session_call` 向指定会话 `target_session_id` 发送任务、汇报或通知，不支持 * 或 all 等通配符。',
      '3. 创建同级会话：使用 `session_create` 在当前工作区创建独立同级会话。',
      '4. 共享黑板：使用 `board_post` 发布里程碑、任务或共享状态。使用 `board_list` 查询黑板条目，使用 `board_clear` 撤销或清理条目。',
      '',
      '`session_call` 调用意图与收敛规则：',
      '- `task_dispatch`：分派任务、提供建议或发起协作请求。接收方处理后，仅在确需回传产物或结论时通过单次 `task_report` 答复；无需返回结果则不回复。',
      '- `task_report`：任务结果汇报、交付或答复。表示当前协作单元已收口，接收方知悉归档，无需回复。',
      '- `notice`：单向状态通报或客观知悉。纯通知属性，阅后即止，接收方不调用 `session_call` 回复。',
      '- 通信自主收敛守则：由双方模型根据类别语义与业务上下文自主收敛，严禁单纯回复“收到”或“明白”等无实质内容的客套回复。',
      '',
      '意图分流规则：',
      '- 使用 `session_create`：创建同级会话。用户要求新建会话、新开 session 或平级会话时使用。独立会话可长期并行运行，不同于临时子任务 subagent。默认继承当前会话的模型参数与预设配置，除非手动指定。',
      '- 使用 `subagent`：仅用于临时父子代理任务委派，父会话需要同步等待或收集子代理结果。'
    ].join('\n'),
    authorReminder: (posts) => {
      const data = formatReminderItems(posts, 3, '、');
      if (!data) return '';
      const countStr = data.extra > 0 ? ` 等共 ${data.count} 条` : '';
      return `你在公共黑板上有 ${data.count} 条尚未清理的有效条目，包括 ${data.items}${countStr}，任务完成后请调用 board_clear 及时清理。`;
    }
  },
  messages: {
    boardPostSuccess: (postId) => `[Board] 已发布条目 #${postId}`,
    boardPostFailure: (error) => `[Board] 发布失败: ${error}`,
    boardClearSuccess: (count, action) => `已${action === 'delete' || action === 'purge' ? '删除' : '归档'} ${count} 条黑板条目。`,
    boardClearFailure: (error) => `[Board] 清理失败: ${error}`,
    sessionCallSuccess: (targetSessionId, deliveryMode, callType) => `已通过单播 ${deliveryMode} 成功呼叫目标会话 [${targetSessionId}]，类型为 ${callType}`,
    sessionCallFailure: (error) => `[Session] 呼叫失败: ${error || '未知错误'}`,
    sessionCreateSuccess: (sessionId, title, status, generation) => `[Session] 成功创建同级会话 [${sessionId}] "${title}"，状态为 ${status}，代际为 ${generation}`,
    sessionCreateFailure: (error) => `[Session] 创建同级会话失败: ${error || '未知错误'}`,
    sessionQueryEmpty: (counts) => `### 会话概览\n\n未找到匹配的会话。\n\n**总计:** ${counts.total} | **运行中:** ${counts.active} | **就绪:** ${counts.idle}`,
    sessionQueryOverview: (rows, counts) => formatSessionQueryTable(
      rows,
      counts,
      { title: '会话概览', sessionId: '会话 ID', sessionTitle: '标题', status: '状态', workspace: '工作区', current: '当前会话', untitled: '无标题', yes: '是', no: '否' },
      { total: '总计', active: '运行中', idle: '就绪' }
    )
  }
};
