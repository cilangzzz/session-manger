/**
 * TabCookieManager - Tab 级别的 Cookie 隔离管理
 *
 * 核心机制：
 * - 每个 Tab 有独立的 Cookie 存储
 * - 切换 Tab 时自动切换 Cookie
 * - Cookie 变化时自动保存到当前 Tab
 */

import { DomainMatcher } from './DomainMatcher.js';

export class TabCookieManager {
  constructor() {
    this.STORAGE_KEY = 'tab_cookie_manager';
    this.domainMatcher = new DomainMatcher();

    // Tab ID -> Cookie 存储的映射
    this.tabStores = new Map();

    // 当前激活的 Tab
    this.activeTabId = null;

    // 当前激活 Tab 的原始 Cookie（用于恢复）
    this.preservedCookies = new Map();

    // 是否启用自动切换
    this.autoSwitchEnabled = true;

    // 忽略下一次 Cookie 变化（我们自己修改 Cookie 时不触发保存）
    this.ignoreCookieChange = false;

    this.initialized = false;
  }

  /**
   * 初始化
   */
  async initialize() {
    if (this.initialized) return;

    await this.loadFromStorage();
    this.setupListeners();

    // 获取当前激活的 Tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      this.activeTabId = activeTab.id;
    }

    this.initialized = true;
    console.log('[TabCookieManager] Initialized with', this.tabStores.size, 'tab stores');
  }

  /**
   * 从存储加载数据
   */
  async loadFromStorage() {
    const data = await chrome.storage.local.get(this.STORAGE_KEY);
    if (data[this.STORAGE_KEY]) {
      const { tabStores } = data[this.STORAGE_KEY];
      if (tabStores) {
        for (const [tabId, store] of Object.entries(tabStores)) {
          this.tabStores.set(parseInt(tabId), store);
        }
      }
    }
  }

  /**
   * 保存到存储
   */
  async saveToStorage() {
    const data = {
      tabStores: Object.fromEntries(this.tabStores)
    };
    await chrome.storage.local.set({ [this.STORAGE_KEY]: data });
  }

  /**
   * 设置监听器
   */
  setupListeners() {
    // Tab 激活 - 核心：切换 Cookie
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      await this.handleTabActivated(activeInfo.tabId);
    });

    // Tab 关闭 - 清理存储
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.handleTabRemoved(tabId);
    });

    // Tab 更新 - 检测导航
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.active) {
        this.handleTabUpdated(tabId, tab);
      }
    });

    // Cookie 变化 - 自动保存
    chrome.cookies.onChanged.addListener(async (changeInfo) => {
      await this.handleCookieChanged(changeInfo);
    });

    // 窗口切换
    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        const [activeTab] = await chrome.tabs.query({ active: true, windowId });
        if (activeTab) {
          await this.handleTabActivated(activeTab.id);
        }
      }
    });
  }

  /**
   * Tab 激活处理 - 切换 Cookie
   */
  async handleTabActivated(newTabId) {
    if (!this.autoSwitchEnabled) return;

    const previousTabId = this.activeTabId;

    // 1. 保存当前 Tab 的 Cookie 状态
    if (previousTabId && previousTabId !== newTabId) {
      await this.saveCurrentTabCookies(previousTabId);
    }

    // 2. 切换到新 Tab
    this.activeTabId = newTabId;

    // 3. 应用新 Tab 的 Cookie
    await this.applyTabCookies(newTabId);

    console.log(`[TabCookieManager] Switched from tab ${previousTabId} to ${newTabId}`);
  }

  /**
   * Tab 关闭处理
   */
  handleTabRemoved(tabId) {
    if (this.tabStores.has(tabId)) {
      this.tabStores.delete(tabId);
      this.saveToStorage();
      console.log(`[TabCookieManager] Removed store for tab ${tabId}`);
    }
  }

  /**
   * Tab 更新处理
   */
  async handleTabUpdated(tabId, tab) {
    // Tab 完成加载且是激活状态，保存 Cookie
    if (tab.active) {
      await this.saveCurrentTabCookies(tabId);
    }
  }

  /**
   * Cookie 变化处理 - 自动保存到当前 Tab
   */
  async handleCookieChanged(changeInfo) {
    if (this.ignoreCookieChange) return;
    if (!this.autoSwitchEnabled) return;
    if (!this.activeTabId) return;

    const { cookie, removed } = changeInfo;

    // 获取当前 Tab 信息
    let tab = null;
    try {
      tab = await chrome.tabs.get(this.activeTabId);
    } catch (e) {
      return;
    }

    if (!tab || !tab.url) return;

    // 检查 Cookie 是否属于当前 Tab 的域名
    try {
      const url = new URL(tab.url);
      const tabDomain = url.hostname;

      if (!this.domainMatcher.isSameSite(cookie.domain, tabDomain)) {
        return; // 不是当前 Tab 的 Cookie
      }

      // 保存到当前 Tab 的存储
      await this.saveCookieToTab(this.activeTabId, cookie, removed);

      console.log(`[TabCookieManager] Cookie ${removed ? 'removed' : 'saved'}: ${cookie.name} for tab ${this.activeTabId}`);
    } catch (e) {
      // 忽略无效 URL
    }
  }

  /**
   * 保存当前 Tab 的所有 Cookie
   */
  async saveCurrentTabCookies(tabId) {
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      return;
    }

    if (!tab || !tab.url) return;

    try {
      const url = new URL(tab.url);
      const domain = url.hostname;

      // 获取该域名相关的所有 Cookie
      const cookies = await this.getAllCookiesForDomain(domain);

      // 保存到 Tab 存储
      if (!this.tabStores.has(tabId)) {
        this.tabStores.set(tabId, {
          id: tabId,
          domains: {},
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }

      const store = this.tabStores.get(tabId);
      store.domains[domain] = cookies;
      store.updatedAt = Date.now();

      await this.saveToStorage();

      console.log(`[TabCookieManager] Saved ${cookies.length} cookies for tab ${tabId} @ ${domain}`);
    } catch (e) {
      // 忽略无效 URL
    }
  }

  /**
   * 保存单个 Cookie 到 Tab
   */
  async saveCookieToTab(tabId, cookie, removed) {
    const domain = this.domainMatcher.normalize(cookie.domain);

    if (!this.tabStores.has(tabId)) {
      this.tabStores.set(tabId, {
        id: tabId,
        domains: {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    const store = this.tabStores.get(tabId);

    if (!store.domains[domain]) {
      store.domains[domain] = [];
    }

    const cookieData = {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expirationDate: cookie.expirationDate,
      hostOnly: cookie.hostOnly,
      session: cookie.session
    };

    if (removed) {
      // 移除 Cookie
      store.domains[domain] = store.domains[domain].filter(
        c => !(c.name === cookie.name && c.domain === cookie.domain)
      );
    } else {
      // 更新或添加 Cookie
      const index = store.domains[domain].findIndex(
        c => c.name === cookie.name && c.domain === cookie.domain
      );

      if (index >= 0) {
        store.domains[domain][index] = cookieData;
      } else {
        store.domains[domain].push(cookieData);
      }
    }

    store.updatedAt = Date.now();
    await this.saveToStorage();
  }

  /**
   * 应用 Tab 的 Cookie
   */
  async applyTabCookies(tabId) {
    const store = this.tabStores.get(tabId);
    if (!store) {
      console.log(`[TabCookieManager] No store for tab ${tabId}`);
      return { applied: 0, cleared: 0 };
    }

    // 获取当前 Tab 的域名
    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      return { applied: 0, cleared: 0 };
    }

    if (!tab || !tab.url) return { applied: 0, cleared: 0 };

    let targetDomain = null;
    try {
      const url = new URL(tab.url);
      targetDomain = url.hostname;
    } catch (e) {
      return { applied: 0, cleared: 0 };
    }

    // 设置忽略标志（避免触发自动保存）
    this.ignoreCookieChange = true;

    let totalApplied = 0;
    let totalCleared = 0;

    try {
      // 清除当前浏览器的相关 Cookie
      const currentCookies = await this.getAllCookiesForDomain(targetDomain);
      for (const c of currentCookies) {
        try {
          const cookieUrl = this.buildCookieUrl(c);
          await chrome.cookies.remove({ url: cookieUrl, name: c.name });
          totalCleared++;
        } catch (e) {
          // 忽略
        }
      }

      // 应用 Tab 存储的 Cookie
      const rootDomain = this.domainMatcher.getRootDomain(targetDomain);

      for (const [domain, cookies] of Object.entries(store.domains)) {
        // 只应用相关域名的 Cookie
        if (!this.domainMatcher.isSameSite(domain, targetDomain)) continue;

        for (const cookie of cookies) {
          try {
            const cookieUrl = this.buildCookieUrl(cookie);
            await chrome.cookies.set({
              url: cookieUrl,
              name: cookie.name,
              value: cookie.value,
              domain: cookie.domain,
              path: cookie.path || '/',
              secure: cookie.secure || false,
              httpOnly: cookie.httpOnly || false,
              sameSite: cookie.sameSite || 'lax',
              expirationDate: cookie.expirationDate
            });
            totalApplied++;
          } catch (e) {
            console.warn(`[TabCookieManager] Failed to set cookie ${cookie.name}:`, e.message);
          }
        }
      }

      console.log(`[TabCookieManager] Applied ${totalApplied} cookies (cleared ${totalCleared}) for tab ${tabId}`);
    } finally {
      this.ignoreCookieChange = false;
    }

    return { applied: totalApplied, cleared: totalCleared };
  }

  /**
   * 获取域名相关的所有 Cookie
   */
  async getAllCookiesForDomain(domain) {
    const cookies = [];
    const seen = new Set();

    // 获取精确域名和通配域名的 Cookie
    const domains = [
      domain,
      `.${domain}`,
      this.domainMatcher.getRootDomain(domain),
      `.${this.domainMatcher.getRootDomain(domain)}`
    ];

    for (const d of domains) {
      try {
        const domainCookies = await chrome.cookies.getAll({ domain: d });
        for (const c of domainCookies) {
          const key = `${c.name}@${c.domain}`;
          if (!seen.has(key)) {
            seen.add(key);
            cookies.push(c);
          }
        }
      } catch (e) {
        // 忽略
      }
    }

    return cookies;
  }

  /**
   * 构建 Cookie URL
   */
  buildCookieUrl(cookie) {
    const protocol = cookie.secure ? 'https' : 'http';
    const domain = cookie.domain?.startsWith('.')
      ? cookie.domain.slice(1)
      : cookie.domain || 'example.com';
    return `${protocol}://${domain}${cookie.path || '/'}`;
  }

  /**
   * 获取 Tab 的存储信息
   */
  getTabStore(tabId) {
    return this.tabStores.get(tabId);
  }

  /**
   * 获取所有 Tab 存储
   */
  getAllTabStores() {
    return Array.from(this.tabStores.entries()).map(([tabId, store]) => ({
      tabId,
      ...store
    }));
  }

  /**
   * 清除 Tab 的 Cookie 存储
   */
  async clearTabStore(tabId, domain = null) {
    const store = this.tabStores.get(tabId);
    if (!store) return false;

    if (domain) {
      delete store.domains[domain];
    } else {
      store.domains = {};
    }

    store.updatedAt = Date.now();
    await this.saveToStorage();
    return true;
  }

  /**
   * 手动保存当前 Tab Cookie
   */
  async manualSave(tabId = null) {
    const targetTabId = tabId || this.activeTabId;
    if (!targetTabId) return { success: false, error: 'No active tab' };

    await this.saveCurrentTabCookies(targetTabId);

    const store = this.tabStores.get(targetTabId);
    const cookieCount = store ? Object.values(store.domains).flat().length : 0;

    return { success: true, cookieCount };
  }

  /**
   * 启用/禁用自动切换
   */
  setAutoSwitch(enabled) {
    this.autoSwitchEnabled = enabled;
    console.log(`[TabCookieManager] Auto-switch ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * 获取统计信息
   */
  getStats() {
    let totalCookies = 0;
    for (const store of this.tabStores.values()) {
      for (const cookies of Object.values(store.domains)) {
        totalCookies += cookies.length;
      }
    }

    return {
      tabCount: this.tabStores.size,
      totalCookies,
      activeTabId: this.activeTabId,
      autoSwitchEnabled: this.autoSwitchEnabled
    };
  }

  /**
   * 为 Tab 设置标签（用于识别）
   */
  async setTabLabel(tabId, label) {
    const store = this.tabStores.get(tabId);
    if (store) {
      store.label = label;
      store.updatedAt = Date.now();
      await this.saveToStorage();
    }
  }

  /**
   * 克隆 Tab 的 Cookie 存储到另一个 Tab
   */
  async cloneTabStore(fromTabId, toTabId) {
    const sourceStore = this.tabStores.get(fromTabId);
    if (!sourceStore) return false;

    this.tabStores.set(toTabId, {
      ...sourceStore,
      id: toTabId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    await this.saveToStorage();
    return true;
  }
}