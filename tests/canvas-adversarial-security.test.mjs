import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testFileDir, '..');
const clientSourcePath = path.join(rootDir, 'lib', 'client.js');

function loadClientBundle(sandboxExtensions = {}) {
  const code = fs.readFileSync(clientSourcePath, 'utf8');

  let registration = null;
  const mockWindow = {
    __ModuleLoader__: {
      load: (payload) => {
        registration = payload;
      }
    },
    requestAnimationFrame: (cb) => cb(),
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  const sandbox = {
    window: mockWindow,
    document: {
      head: { appendChild: () => {} },
      body: { appendChild: () => {} },
      getElementById: () => null,
      createElement: () => ({ setAttribute: () => {}, appendChild: () => {} })
    },
    navigator: {
      clipboard: {
        writeText: async () => {}
      }
    },
    console,
    Date,
    Set,
    Map,
    Array,
    Object,
    String,
    Math,
    JSON,
    URLSearchParams,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    ...sandboxExtensions
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  assert.ok(registration, 'lib/client.js must register with window.__ModuleLoader__');
  return registration.factory(() => null);
}

test('插槽注册唯一性、作用域隔离与无全局路由/DOM悬浮', () => {
  const clientSource = fs.readFileSync(clientSourcePath, 'utf8');

  // 1. 审查插槽注册目标：仅注入 conversation.view
  const injectRegex = /ctx\.slots\.inject\(\s*['"]([^'"]+)['"]/g;
  const injectedSlots = [...clientSource.matchAll(injectRegex)].map(m => m[1]);
  assert.equal(injectedSlots.length, 1, 'ctx.slots.inject 应调用 1 次');
  assert.equal(injectedSlots[0], 'conversation.view', '插槽目标应为 conversation.view');

  // 2. 检查注册元数据：id 为 canvas，order 为 15
  assert.ok(clientSource.includes("name: 'conversation.view'"));
  assert.ok(clientSource.includes("id: 'canvas'"));
  assert.ok(clientSource.includes('order: 15'));

  // 3. 排查二级路由与路由劫持
  const forbiddenRoutingPatterns = [
    /createRouter/i,
    /useRouter/i,
    /pushState/i,
    /replaceState/i,
    /hashchange/i,
    /popstate/i,
    /location\.href\s*=/i,
    /location\.hash\s*=/i,
    /react-router/i,
    /vue-router/i
  ];
  for (const pattern of forbiddenRoutingPatterns) {
    assert.equal(
      pattern.test(clientSource),
      false,
      `client.js 不包含二级路由或路由劫持逻辑: ${pattern}`
    );
  }

  // 4. 排查全局 DOM 悬浮与全局 Portal
  // 除了向 document.head 挂载样式表外，不向 document.body 挂载全局悬浮节点
  assert.equal(/document\.body\.appendChild/i.test(clientSource), false, '不向 document.body 挂载全局 DOM 悬浮节点');
  assert.equal(/createPortal/i.test(clientSource), false, '不使用 createPortal 创建全局悬浮层');

  // 5. 排查向智能体注册模型工具
  assert.equal(/ctx\.(?:tools|tool)\.register/i.test(clientSource), false, '前端代码不包含 ctx.tools.register');

  // 6. 运行期模拟审查：apply 仅注册单个插槽并注入预期上下文
  const plugin = loadClientBundle();
  let slotInjectCount = 0;
  let registeredSlotDef = null;

  const mockCtx = {
    effect: (fn) => fn(),
    locale: {
      register: () => {},
      bind: () => (k) => k
    },
    slots: {
      inject: (slotName, factory) => {
        slotInjectCount++;
        assert.equal(slotName, 'conversation.view');
        factory();
      },
      register: (def) => {
        registeredSlotDef = def;
      }
    }
  };

  plugin.apply(mockCtx);
  assert.equal(slotInjectCount, 1);
  assert.ok(registeredSlotDef);
  assert.equal(registeredSlotDef.id, 'canvas');
  assert.equal(registeredSlotDef.order, 15);
});

test('详情抽屉（CanvasDrawer）只读性与无写入 API', () => {
  const plugin = loadClientBundle();
  const t = (k) => plugin.zh[k] || k;

  function traverseVirtualDom(node, visitor) {
    if (!node || typeof node !== 'object') return;
    visitor(node);
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        traverseVirtualDom(child, visitor);
      }
    }
  }

  // 构建各类待审实体（涵盖正常实体与潜在恶意/脏数据实体）
  const testEntities = [
    {
      kind: 'session',
      id: 'session-adv-01',
      title: 'Audited Session Node',
      workspace: 'd:/workspace/core',
      status: 'running',
      agentType: 'specialist',
      stats: { inboundCalls: 12, outboundCalls: 4, postsCount: 3 }
    },
    {
      kind: 'call',
      id: 'call-adv-02',
      callType: 'task_dispatch',
      deliveryMode: 'steer',
      durationMs: 25,
      timestamp: Date.now(),
      callerSessionId: 'session-a',
      callerTitle: 'Caller A',
      targetSessionId: 'session-b',
      targetTitle: 'Target B',
      contextPostIds: ['post-1', 'post-2'],
      messageSnippet: 'Dispatch instruction snippet',
      messagePayload: '```json\n{"action": "execute", "protected": true}\n```',
      status: 'active'
    },
    {
      kind: 'post',
      id: 'post-adv-03',
      topic: 'task:compliance',
      tags: ['audit', 'immutable'],
      ttlRemainingMs: 3500000,
      authorSessionId: 'session-a',
      workspace: 'd:/workspace/core',
      content: '# Immutable Compliance Report\nAll checks must be strictly read-only.'
    },
    {
      kind: 'hub',
      id: 'hub',
      topic: 'blackboard:hub',
      tags: ['hub'],
      ttlRemainingMs: 3600000,
      content: '{"activeCount": 5}'
    }
  ];

  for (const entity of testEntities) {
    const drawer = plugin.CanvasDrawer({
      entity,
      onClose: () => {},
      t,
      copiedKey: null,
      setCopiedKey: () => {}
    });
    assert.ok(drawer, `实体 ${entity.kind} 的 Drawer 正常渲染`);

    let buttonCount = 0;
    let copyButtonCount = 0;
    let closeButtonCount = 0;
    let hasReadOnlyBadge = false;

    traverseVirtualDom(drawer, (el) => {
      const tag = String(el.type || '').toLowerCase();

      // 1. 表单输入类可修改标签检查
      assert.notEqual(tag, 'input', `Drawer 内不包含 input 元素 (${entity.kind})`);
      assert.notEqual(tag, 'textarea', `Drawer 内不包含 textarea 元素 (${entity.kind})`);
      assert.notEqual(tag, 'select', `Drawer 内不包含 select 元素 (${entity.kind})`);
      assert.notEqual(tag, 'form', `Drawer 内不包含 form 元素 (${entity.kind})`);

      // 2. 可编辑属性检查
      if (el.props) {
        assert.equal(el.props.contentEditable, undefined, `元素不包含 contentEditable`);
        if (el.props.className && el.props.className.includes('dsh-canvas-drawer-readonly')) {
          hasReadOnlyBadge = true;
        }
      }

      // 3. 统计并审查按钮：只能有关闭和复制按钮
      if (tag === 'button') {
        buttonCount++;
        const cls = String(el.props?.className || '');
        const btnText = (el.children || []).map(c => typeof c === 'string' ? c : '').join(' ');

        // 状态修改变异词汇检查
        const forbiddenMutationWords = ['删除', '修改', '归档', '执行', '重置', '提交', 'delete', 'edit', 'mutate', 'archive', 'submit'];
        for (const word of forbiddenMutationWords) {
          assert.equal(
            btnText.toLowerCase().includes(word),
            false,
            `Drawer 按钮文本不包含变异动作词汇: "${word}"`
          );
        }

        if (cls.includes('dsh-canvas-copy-btn')) {
          copyButtonCount++;
        } else if (cls.includes('dsh-canvas-btn')) {
          closeButtonCount++;
        } else {
          assert.fail(`发现未知用途交互按钮: class="${cls}", text="${btnText}"`);
        }
      }
    });

    // 4. 安全断言：显式包含只读徽章，且交互按钮收敛
    assert.ok(hasReadOnlyBadge, `Drawer 顶部呈现只读徽章`);
    assert.equal(closeButtonCount, 1, `Drawer 有 1 个关闭按钮`);
    assert.ok(copyButtonCount >= 0, `复制按钮数量正常`);
    assert.equal(buttonCount, closeButtonCount + copyButtonCount, `按钮总数等于关闭按钮加复制按钮之和`);
  }

  // 5. 源码网络请求排查：无 POST/PUT/DELETE/PATCH 变异请求
  const clientSource = fs.readFileSync(clientSourcePath, 'utf8');
  assert.equal(
    /method\s*:\s*['"](?:POST|PUT|DELETE|PATCH)['"]/i.test(clientSource),
    false,
    'client.js 源码中不包含变异 HTTP 方法'
  );
});

test('CSS 样式声明检查：包含 translate3d、will-change 与 contain', () => {
  const clientSource = fs.readFileSync(clientSourcePath, 'utf8');

  // 1. 视口层 CSS 隔离与硬件加速声明
  assert.ok(
    clientSource.includes('contain: layout style;'),
    '.dsh-canvas-viewport 声明 contain: layout style'
  );
  assert.ok(
    clientSource.includes('will-change: transform;'),
    '.dsh-canvas-surface 声明 will-change: transform'
  );

  // 2. 抽屉层动画 GPU 加速声明
  assert.ok(
    clientSource.includes('@keyframes dshCanvasDrawerIn'),
    '抽屉进场采用 CSS keyframes 动画'
  );
  assert.ok(
    clientSource.includes('from { transform: translate3d(100%, 0, 0); }'),
    '抽屉动画起始帧采用 3D 变换 translate3d(100%, 0, 0)'
  );
  assert.ok(
    clientSource.includes('to { transform: translate3d(0, 0, 0); }'),
    '抽屉动画结束帧采用 3D 变换 translate3d(0, 0, 0)'
  );

  // 3. 视口画布表面平移缩放采用 translate3d 配合 scale
  assert.ok(
    clientSource.includes("transform: 'translate3d(' + pan.x + 'px, ' + pan.y + 'px, 0px) scale(' + zoom + ')'"),
    '画布表面平移缩放采用 translate3d'
  );

  // 4. 鼠标拖拽平移事件调度：采用 requestAnimationFrame 防抖节流
  assert.ok(
    clientSource.includes('window.requestAnimationFrame'),
    '画布平移事件经过 window.requestAnimationFrame 调度'
  );

  // 5. 关联高亮与渐隐过渡：采用 opacity 与 cubic-bezier
  assert.ok(
    clientSource.includes('opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1)'),
    '关联高亮渐变采用 opacity 和标准三阶贝塞尔缓动'
  );
});

test('Zero-Emoji 与国际化字典内容检查 (ADR-0009)', () => {
  const clientSource = fs.readFileSync(clientSourcePath, 'utf8');
  const plugin = loadClientBundle();

  // 1. 源码全文零 Emoji 断言
  const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
  assert.equal(
    emojiRegex.test(clientSource),
    false,
    'lib/client.js 全文不包含 Emoji 图标'
  );

  // 2. 国际化字典全量条目核查
  assert.ok(plugin.zh && Object.keys(plugin.zh).length > 20);
  assert.ok(plugin.en && Object.keys(plugin.en).length > 20);

  for (const [k, v] of Object.entries(plugin.zh)) {
    assert.equal(emojiRegex.test(v), false, `zh 字典 "${k}" 不包含 Emoji`);
  }
  for (const [k, v] of Object.entries(plugin.en)) {
    assert.equal(emojiRegex.test(v), false, `en 字典 "${k}" 不包含 Emoji`);
  }
});
