/**
 * SessionManager - Session 管理器（重构版）
 *
 * 核心功能：
 * - 一个 Session = 一个 Tab Group + 独立 Cookie 存储
 * - 自动 Cookie 隔离（通过 CookieMonitor）
 * - Tab 自动绑定（通过 TabSessionBinder）
 */

import { CookieMonitor } from './CookieMonitor.js';
import { TabSessionBinder } from './TabSessionBinder.js';
import { DomainMatcher } from './DomainMatcher.js';

export class SessionManager {
  constructor() {
    this.STORAGE_KEY = 'session_manager_data';
    this.SETTINGS_KEY = 'session_manager_settings';

    // 内存缓存
    this.sessions = new Map();
    this.tabGroups = new Map();

    // 子模块
    this.domainMatcher = new DomainMatcher();
    this.cookieMonitor = null;
    this.tabBinder = null;

    // 设置
    this.settings = {
      autoCookieSync: true,
      autoSwitchOnNavigate: true,
      preserveStateOnSwitch: true
    };

    this.initialized = false;
  }

  /**
   * 初始化
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await this.loadFromStorage();
      await this.loadSettings();
      await this.syncTabGroups();

      // 初始化子模块
      this.tabBinder = new TabSessionBinder(this);
      await this.tabBinder.initialize();

      this.cookieMonitor = new CookieMonitor(this);
      if (this.settings.autoCookieSync) {
        this.cookieMonitor.initialize();
      }

      this.setupListeners();

      this.initialized = true;
      console.log('[SessionManager] Initialized with', this.sessions.size, 'sessions');
      console.log('[SessionManager] Settings:', this.settings);
    } catch (error) {
      console.error('[SessionManager] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * 从存储加载数据
   */
  async loadFromStorage() {
    const data = await chrome.storage.local.get(this.STORAGE_KEY);

    if (data[this.STORAGE_KEY]) {
      const { sessions, tabGroups } = data[this.STORAGE_KEY];

      if (sessions) {
        for (const [id, session] of Object.entries(sessions)) {
          this.sessions.set(id, session);
        }
      }

      if (tabGroups) {
        for (const [sessionId, groupId] of Object.entries(tabGroups)) {
          this.tabGroups.set(sessionId, groupId);
        }
      }
    }

    // 确保有 default session
    if (!this.sessions.has('default')) {
      this.sessions.set('default', {
        id: 'default',
        name: 'Default (Browser)',
        color: '#9E9E9E',
        cookies: {},
        domains: [],
        createdAt: Date.now()
      });
    }
  }

  /**
   * 保存到存储
   */
  async saveToStorage() {
    const data = {
      sessions: Object.fromEntries(this.sessions),
      tabGroups: Object.fromEntries(this.tabGroups)
    };
    await chrome.storage.local.set({ [this.STORAGE_KEY]: data });
  }

  /**
   * 加载设置
   */
  async loadSettings() {
    const data = await chrome.storage.local.get(this.SETTINGS_KEY);
    if (data[this.SETTINGS_KEY]) {
      this.settings = { ...this.settings, ...data[this.SETTINGS_KEY] };
    }
  }

  /**
   * 更新设置
   */
  async updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    await chrome.storage.local.set({ [this.SETTINGS_KEY]: this.settings });

    // 应用设置
    if (this.cookieMonitor) {
      this.cookieMonitor.setEnabled(this.settings.autoCookieSync);
    }

    return this.settings;
  }

  /**
   * 获取设置
   */
  getSettings() {
    return this.settings;
  }

  /**
   * 同步现有 Tab Groups
   */
  async syncTabGroups() {
    try {
      const groups = await chrome.tabGroups.query({});
      for (const group of groups) {
        for (const [sessionId, gid] of this.tabGroups) {
          if (gid === group.id) {
            const session = this.sessions.get(sessionId);
            if (session) {
              session.name = group.title || session.name;
            }
          }
        }
      }
    } catch (e) {
      console.log('[SessionManager] No tab groups to sync');
    }
  }

  /**
   * 设置监听器
   */
  setupListeners() {
    chrome.tabGroups.onRemoved.addListener((group) => {
      for (const [sessionId, groupId] of this.tabGroups) {
        if (groupId === group.id) {
          this.tabGroups.delete(sessionId);
          this.saveToStorage();
          break;
        }
      }
    });
  }

  // ==================== Session CRUD ====================

  /**
   * 创建新 Session
   */
  async createSession(options = {}) {
    const sessionId = this.generateId();
    const color = options.color || this.getRandomColor();
    const name = options.name || `Session ${this.sessions.size}`;

    // 创建标签页和 Tab Group
    let groupId = null;
    let tab = null;

    if (options.url) {
      tab = await chrome.tabs.create({ url: options.url, active: false });
    } else {
      tab = await chrome.tabs.create({ url: 'chrome://newtab/', active: false });
    }

    // 创建 Tab Group
    groupId = await chrome.tabs.group({ tabIds: [tab.id] });
    await chrome.tabGroups.update(groupId, {
      title: name,
      color: this.mapColorToGroupColor(color)
    });

    const session = {
      id: sessionId,
      name: name,
      color: color,
      groupId: groupId,
      cookies: {},  // 按域名存储 cookies
      domains: [],  // 关联的域名列表
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    };

    this.sessions.set(sessionId, session);
    this.tabGroups.set(sessionId, groupId);

    // 绑定 Tab
    if (this.tabBinder) {
      this.tabBinder.bind(tab.id, sessionId);
    }

    await this.saveToStorage();

    console.log('[SessionManager] Created session:', sessionId, 'with group:', groupId);

    return { session, tab, groupId };
  }

  /**
   * 获取所有 Session
   */
  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  /**
   * 获取 Session
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * 更新 Session
   */
  async updateSession(sessionId, updates) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (updates.name) session.name = updates.name;
    if (updates.color) session.color = updates.color;

    const groupId = this.tabGroups.get(sessionId);
    if (groupId) {
      try {
        await chrome.tabGroups.update(groupId, {
          title: session.name,
          color: this.mapColorToGroupColor(session.color)
        });
      } catch (e) {
        // Group 可能已删除
      }
    }

    await this.saveToStorage();
    return session;
  }

  /**
   * 删除 Session
   */
  async deleteSession(sessionId) {
    if (sessionId === 'default') return false;

    const session = this.sessions.get(sessionId);
    if (!session) return false;

    // 关闭 Group 中的所有标签页
    const groupId = this.tabGroups.get(sessionId);
    if (groupId) {
      try {
        const tabs = await chrome.tabs.query({ groupId });
        for (const tab of tabs) {
          await chrome.tabs.remove(tab.id);
        }
      } catch (e) {
        // 忽略错误
      }
    }

    // 清理绑定
    if (this.tabBinder) {
      const tabIds = this.tabBinder.getSessionTabIds(sessionId);
      for (const tabId of tabIds) {
        this.tabBinder.unbind(tabId);
      }
    }

    this.sessions.delete(sessionId);
    this.tabGroups.delete(sessionId);
    await this.saveToStorage();

    return true;
  }

  // ==================== Tab 操作 ====================

  /**
   * 在 Session 中打开新标签页
   */
  async openInSession(sessionId, url) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const groupId = this.tabGroups.get(sessionId);

    const tab = await chrome.tabs.create({
      url: url || 'chrome://newtab/',
      active: true
    });

    if (groupId) {
      try {
        await chrome.tabs.group({ tabIds: tab.id, groupId });
      } catch (e) {
        // Group 可能已删除，重新创建
        const newGroupId = await chrome.tabs.group({ tabIds: tab.id });
        await chrome.tabGroups.update(newGroupId, {
          title: session.name,
          color: this.mapColorToGroupColor(session.color)
        });
        this.tabGroups.set(sessionId, newGroupId);
      }
    }

    // 绑定 Tab
    if (this.tabBinder) {
      this.tabBinder.bind(tab.id, sessionId);
    }

    session.lastUsedAt = Date.now();
    await this.saveToStorage();

    // 如果有 URL，自动应用该域名的 Cookies
    if (url && this.settings.autoSwitchOnNavigate) {
      try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;

        if (session.domains.includes(domain) || this.domainMatcher.matches(session.domains, domain)) {
          await this.applySessionCookies(sessionId, domain);
        }
      } catch (e) {
        // 忽略无效 URL
      }
    }

    return tab;
  }

  /**
   * 获取 Session 的所有标签页
   */
  async getSessionTabs(sessionId) {
    const groupId = this.tabGroups.get(sessionId);
    if (!groupId) return [];

    try {
      return await chrome.tabs.query({ groupId });
    } catch (e) {
      return [];
    }
  }

  /**
   * 获取 Tab 的绑定信息
   */
  getTabBinding(tabId) {
    if (!this.tabBinder) return null;
    return this.tabBinder.getSessionId(tabId);
  }

  // ==================== Cookie 管理（核心功能）====================

  /**
   * 保存当前浏览器 Cookies 到 Session
   * 用户登录后调用此方法保存登录状态
   */
  async saveCurrentCookies(sessionId, domain = null) {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    // 获取当前标签页的域名
    if (!domain) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        try {
          const url = new URL(tab.url);
          domain = url.hostname;
        } catch (e) {
          return { success: false, error: 'Cannot determine domain' };
        }
      }
    }

    if (!domain) {
      return { success: false, error: 'No domain specified' };
    }

    // 获取所有相关域名的 Cookies
    const relatedDomains = this.domainMatcher.getRelatedDomains(domain);
    const allCookies = [];

    for (const d of relatedDomains) {
      try {
        const cookies = await chrome.cookies.getAll({ domain: d });
        allCookies.push(...cookies);
      } catch (e) {
        // 忽略错误
      }
    }

    // 去重
    const cookieMap = new Map();
    for (const c of allCookies) {
      const key = `${c.name}@${c.domain}`;
      cookieMap.set(key, {
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        expirationDate: c.expirationDate,
        hostOnly: c.hostOnly,
        session: c.session
      });
    }

    const uniqueCookies = Array.from(cookieMap.values());

    // 保存到 Session（按根域名分组）
    const rootDomain = this.domainMatcher.getRootDomain(domain);
    session.cookies[rootDomain] = uniqueCookies;

    // 记录关联域名
    const existingDomains = session.domains || [];
    for (const d of relatedDomains) {
      if (!existingDomains.includes(d)) {
        existingDomains.push(d);
      }
    }
    session.domains = existingDomains;

    session.lastUsedAt = Date.now();
    await this.saveToStorage();

    console.log(`[SessionManager] Saved ${uniqueCookies.length} cookies for domain ${rootDomain} to session ${sessionId}`);

    return {
      success: true,
      domain: rootDomain,
      cookieCount: uniqueCookies.length
    };
  }

  /**
   * 应用 Session Cookies 到浏览器
   * 切换账号时调用此方法
   */
  async applySessionCookies(sessionId, domain = null) {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    const domains = domain ? [domain, ...this.domainMatcher.getRelatedDomains(domain)] : session.domains;

    let totalApplied = 0;
    let totalCleared = 0;

    // 先清除所有相关域名的现有 Cookies
    for (const d of domains) {
      try {
        const existingCookies = await chrome.cookies.getAll({ domain: d });
        for (const c of existingCookies) {
          const url = this.buildCookieUrl(c);
          try {
            await chrome.cookies.remove({ url, name: c.name });
            totalCleared++;
          } catch (e) {
            // 忽略删除失败
          }
        }
      } catch (e) {
        // 忽略错误
      }
    }

    // 应用 Session 的 Cookies
    for (const d of domains) {
      const rootDomain = this.domainMatcher.getRootDomain(d);
      const sessionCookies = session.cookies[rootDomain] || [];

      for (const cookie of sessionCookies) {
        // 检查 Cookie 是否适用于目标域名
        if (!this.cookieMatchesDomain(cookie, d)) continue;

        try {
          const url = this.buildCookieUrl(cookie);
          await chrome.cookies.set({
            url,
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
          console.warn(`[SessionManager] Failed to set cookie ${cookie.name}:`, e.message);
        }
      }
    }

    console.log(`[SessionManager] Applied ${totalApplied} cookies (cleared ${totalCleared}) for session ${sessionId}`);

    return {
      success: true,
      domains: domains,
      cleared: totalCleared,
      applied: totalApplied
    };
  }

  /**
   * 检查 Cookie 是否匹配域名
   */
  cookieMatchesDomain(cookie, domain) {
    const cookieDomain = this.domainMatcher.normalize(cookie.domain);
    const targetDomain = this.domainMatcher.normalize(domain);

    if (cookie.domain.startsWith('.')) {
      // 通配域名
      return targetDomain === cookieDomain || targetDomain.endsWith('.' + cookieDomain);
    } else {
      // 精确域名
      return targetDomain === cookieDomain;
    }
  }

  /**
   * 清除 Session 的 Cookies（从存储中删除）
   */
  async clearSessionCookies(sessionId, domain = null) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (domain) {
      const rootDomain = this.domainMatcher.getRootDomain(domain);
      delete session.cookies[rootDomain];
      session.domains = session.domains.filter(d => {
        return this.domainMatcher.getRootDomain(d) !== rootDomain;
      });
    } else {
      session.cookies = {};
      session.domains = [];
    }

    await this.saveToStorage();
    return true;
  }

  /**
   * 获取 Session 的 Cookies 信息
   */
  getSessionCookiesInfo(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const info = {
      domains: session.domains || [],
      totalCookies: 0,
      byDomain: {}
    };

    for (const [domain, cookies] of Object.entries(session.cookies)) {
      info.byDomain[domain] = cookies.length;
      info.totalCookies += cookies.length;
    }

    return info;
  }

  /**
   * 切换 Session（应用 Cookies 并刷新标签页）
   */
  async switchSession(sessionId, domain = null) {
    const session = this.sessions.get(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    // 应用 Cookies
    const result = await this.applySessionCookies(sessionId, domain);

    // 刷新 Session 相关的标签页
    const tabs = await this.getSessionTabs(sessionId);
    for (const tab of tabs) {
      // 只刷新相关域名的页面
      try {
        const url = new URL(tab.url);
        if (domain && this.domainMatcher.belongsToSite(url.hostname, domain)) {
          await chrome.tabs.reload(tab.id);
        }
      } catch (e) {
        // 无效 URL，刷新
        await chrome.tabs.reload(tab.id);
      }
    }

    session.lastUsedAt = Date.now();
    await this.saveToStorage();

    return {
      success: true,
      sessionId,
      refreshedTabs: tabs.length,
      ...result
    };
  }

  /**
   * 手动启用/禁用自动同步
   */
  setAutoSync(enabled) {
    this.settings.autoCookieSync = enabled;
    if (this.cookieMonitor) {
      this.cookieMonitor.setEnabled(enabled);
    }
    this.updateSettings({ autoCookieSync: enabled }).catch(console.error);
  }

  // ==================== 工具方法 ====================

  buildCookieUrl(cookie) {
    const protocol = cookie.secure ? 'https' : 'http';
    const domain = cookie.domain?.startsWith('.')
      ? cookie.domain.slice(1)
      : cookie.domain || 'example.com';
    return `${protocol}://${domain}${cookie.path || '/'}`;
  }

  generateId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getRandomColor() {
    const colors = ['#FF5722', '#2196F3', '#4CAF50', '#9C27B0', '#FF9800', '#00BCD4', '#E91E63', '#673AB7'];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  mapColorToGroupColor(hexColor) {
    const colorMap = {
      '#FF5722': 'orange',
      '#2196F3': 'blue',
      '#4CAF50': 'green',
      '#9C27B0': 'purple',
      '#FF9800': 'yellow',
      '#00BCD4': 'cyan',
      '#E91E63': 'pink',
      '#673AB7': 'purple',
      '#9E9E9E': 'grey'
    };
    return colorMap[hexColor] || 'blue';
  }

  /**
   * 获取统计信息
   */
  getStats() {
    let totalCookies = 0;
    for (const session of this.sessions.values()) {
      for (const cookies of Object.values(session.cookies)) {
        totalCookies += cookies.length;
      }
    }

    const bindingStats = this.tabBinder ? this.tabBinder.getStats() : { totalBindings: 0 };

    return {
      sessionCount: this.sessions.size,
      totalCookies,
      bindings: bindingStats.totalBindings,
      settings: this.settings
    };
  }
}