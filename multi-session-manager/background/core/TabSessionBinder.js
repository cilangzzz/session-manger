/**
 * TabSessionBinder - Tab 与 Session 绑定管理
 *
 * 功能：
 * - 管理 Tab 到 Session 的绑定关系
 * - 支持批量绑定（Tab Group）
 * - 自动处理 Tab 创建/关闭/移动
 */

export class TabSessionBinder {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;

    // Tab ID -> Session ID 映射
    this.bindings = new Map();

    // Session ID -> Set<Tab ID> 映射
    this.sessionTabs = new Map();

    this.initialized = false;
  }

  /**
   * 初始化
   */
  async initialize() {
    if (this.initialized) return;

    await this.syncExistingBindings();
    this.setupListeners();

    this.initialized = true;
    console.log('[TabSessionBinder] Initialized with', this.bindings.size, 'bindings');
  }

  /**
   * 同步现有绑定（从 Tab Groups 恢复）
   */
  async syncExistingBindings() {
    const sessions = this.sessionManager.getAllSessions();

    for (const session of sessions) {
      if (session.id === 'default') continue;

      const groupId = this.sessionManager.tabGroups.get(session.id);
      if (groupId) {
        try {
          const tabs = await chrome.tabs.query({ groupId });
          for (const tab of tabs) {
            this.bindings.set(tab.id, session.id);
          }

          this.sessionTabs.set(session.id, new Set(tabs.map(t => t.id)));
          console.log(`[TabSessionBinder] Restored ${tabs.length} tabs for session ${session.id}`);
        } catch (e) {
          // Group 可能已删除
        }
      }
    }
  }

  /**
   * 设置监听器
   */
  setupListeners() {
    // Tab 创建 - 自动绑定到 Group 对应的 Session
    chrome.tabs.onCreated.addListener(async (tab) => {
      if (tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const sessionId = this.findSessionByGroupId(tab.groupId);
        if (sessionId) {
          this.bind(tab.id, sessionId);
        }
      }
    });

    // Tab 更新 - 检查 Group 变化
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.groupId !== undefined) {
        this.handleGroupChange(tabId, changeInfo.groupId);
      }
    });

    // Tab 关闭 - 清理绑定
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.unbind(tabId);
    });

    // Tab Group 移除 - 批量解绑
    chrome.tabGroups.onRemoved.addListener(async (group) => {
      const sessionId = this.findSessionByGroupId(group.id);
      if (sessionId) {
        // 清理该 Session 的所有 Tab 绑定
        const tabIds = this.sessionTabs.get(sessionId);
        if (tabIds) {
          for (const tabId of tabIds) {
            this.bindings.delete(tabId);
          }
          this.sessionTabs.delete(sessionId);
        }
      }
    });
  }

  /**
   * 绑定 Tab 到 Session
   */
  bind(tabId, sessionId) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) {
      console.warn(`[TabSessionBinder] Session ${sessionId} not found`);
      return false;
    }

    // 如果已绑定其他 Session，先解绑
    const currentSessionId = this.bindings.get(tabId);
    if (currentSessionId && currentSessionId !== sessionId) {
      this.unbind(tabId);
    }

    this.bindings.set(tabId, sessionId);

    if (!this.sessionTabs.has(sessionId)) {
      this.sessionTabs.set(sessionId, new Set());
    }
    this.sessionTabs.get(sessionId).add(tabId);

    console.log(`[TabSessionBinder] Bound tab ${tabId} to session ${sessionId}`);
    return true;
  }

  /**
   * 解绑 Tab
   */
  unbind(tabId) {
    const sessionId = this.bindings.get(tabId);
    if (!sessionId) return;

    this.bindings.delete(tabId);

    const tabs = this.sessionTabs.get(sessionId);
    if (tabs) {
      tabs.delete(tabId);
    }

    console.log(`[TabSessionBinder] Unbound tab ${tabId} from session ${sessionId}`);
  }

  /**
   * 获取 Tab 绑定的 Session
   */
  getSessionId(tabId) {
    return this.bindings.get(tabId);
  }

  /**
   * 获取 Session 的所有 Tab
   */
  getSessionTabIds(sessionId) {
    const tabs = this.sessionTabs.get(sessionId);
    return tabs ? Array.from(tabs) : [];
  }

  /**
   * 批量绑定 Tabs 到 Session
   */
  bindTabs(tabIds, sessionId) {
    for (const tabId of tabIds) {
      this.bind(tabId, sessionId);
    }
  }

  /**
   * 处理 Tab Group 变化
   */
  handleGroupChange(tabId, newGroupId) {
    if (newGroupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      // Tab 离开了 Group
      this.unbind(tabId);
      return;
    }

    const sessionId = this.findSessionByGroupId(newGroupId);
    if (sessionId) {
      this.bind(tabId, sessionId);
    }
  }

  /**
   * 通过 Group ID 找到 Session
   */
  findSessionByGroupId(groupId) {
    for (const [sessionId, gid] of this.sessionManager.tabGroups) {
      if (gid === groupId) {
        return sessionId;
      }
    }
    return null;
  }

  /**
   * 获取所有绑定信息
   */
  getAllBindings() {
    return {
      byTab: Object.fromEntries(this.bindings),
      bySession: Object.fromEntries(
        Array.from(this.sessionTabs.entries()).map(([k, v]) => [k, Array.from(v)])
      )
    };
  }

  /**
   * 获取绑定统计
   */
  getStats() {
    return {
      totalBindings: this.bindings.size,
      sessions: this.sessionTabs.size
    };
  }
}