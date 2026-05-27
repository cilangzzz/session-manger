/**
 * CookieMonitor - Cookie 自动监控模块
 *
 * 功能：
 * - 监听 Cookie 变化自动同步到 Session
 * - 按域名分组管理
 * - 支持域名树匹配（子域名/父域名）
 */

import { DomainMatcher } from './DomainMatcher.js';

export class CookieMonitor {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.domainMatcher = new DomainMatcher();
    this.enabled = true;
    this.initialized = false;

    // 当前激活的 Session（按 Tab 记录）
    this.activeSessionByTab = new Map();

    // 监听器引用
    this.cookieListener = null;
    this.tabListener = null;
    this.navigationListener = null;
  }

  /**
   * 初始化监控
   */
  initialize() {
    if (this.initialized) return;

    this.setupCookieListener();
    this.setupTabListeners();
    this.setupNavigationListener();

    this.initialized = true;
    console.log('[CookieMonitor] Initialized');
  }

  /**
   * 设置 Cookie 变化监听
   */
  setupCookieListener() {
    this.cookieListener = async (changeInfo) => {
      if (!this.enabled) return;

      const { cookie, removed, cause } = changeInfo;

      // 获取关联的 Session
      const session = this.getActiveSessionForDomain(cookie.domain);
      if (!session) return;

      console.log(`[CookieMonitor] Cookie ${removed ? 'removed' : 'changed'}: ${cookie.name} @ ${cookie.domain}`);

      // 自动同步到 Session
      if (removed) {
        this.removeCookieFromSession(session, cookie);
      } else {
        this.addCookieToSession(session, cookie);
      }
    };

    chrome.cookies.onChanged.addListener(this.cookieListener);
  }

  /**
   * 设置 Tab 相关监听
   */
  setupTabListeners() {
    // Tab 关闭时清理绑定
    this.tabListener = (tabId, removeInfo) => {
      this.activeSessionByTab.delete(tabId);
    };

    chrome.tabs.onRemoved.addListener(this.tabListener);
  }

  /**
   * 设置导航监听 - 核心切换逻辑
   */
  setupNavigationListener() {
    // 使用 webNavigation 监听页面导航
    this.navigationListener = async (details) => {
      if (!this.enabled) return;
      if (details.frameId !== 0) return; // 只处理主 frame

      const { tabId, url, transitionType } = details;

      try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname;

        // 获取该 Tab 绑定的 Session
        const sessionId = this.activeSessionByTab.get(tabId);
        if (!sessionId) return;

        const session = this.sessionManager.getSession(sessionId);
        if (!session) return;

        // 检查是否需要切换 Cookie
        const needsSwitch = this.needsCookieSwitch(session, domain);

        if (needsSwitch) {
          console.log(`[CookieMonitor] Auto-switching cookies for tab ${tabId} -> ${domain}`);
          await this.autoSwitchCookies(sessionId, domain);
        }
      } catch (e) {
        // 忽略无效 URL（chrome://, about: 等）
      }
    };

    // 监听导航开始（在请求发出前）
    if (chrome.webNavigation?.onBeforeNavigate) {
      chrome.webNavigation.onBeforeNavigate.addListener(this.navigationListener);
    }
  }

  /**
   * 绑定 Tab 到 Session
   */
  bindTabToSession(tabId, sessionId) {
    this.activeSessionByTab.set(tabId, sessionId);
    console.log(`[CookieMonitor] Tab ${tabId} bound to session ${sessionId}`);
  }

  /**
   * 解绑 Tab
   */
  unbindTab(tabId) {
    this.activeSessionByTab.delete(tabId);
  }

  /**
   * 获取 Tab 绑定的 Session
   */
  getTabSession(tabId) {
    return this.activeSessionByTab.get(tabId);
  }

  /**
   * 获取当前激活的 Session（通过 Tab）
   */
  getActiveSessionForDomain(domain) {
    // 找到最近使用的处理该域名的 Session
    // 先检查当前激活 Tab
    try {
      chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
        if (tabs.length > 0) {
          const tabId = tabs[0].id;
          const sessionId = this.activeSessionByTab.get(tabId);
          if (sessionId) {
            const session = this.sessionManager.getSession(sessionId);
            if (session && this.domainMatcher.matches(session.domains, domain)) {
              return session;
            }
          }
        }
      });
    } catch (e) {
      // 异步获取失败，降级处理
    }

    // 降级：找到管理该域名的最近使用的 Session
    let recentSession = null;
    let recentTime = 0;

    for (const session of this.sessionManager.getAllSessions()) {
      if (session.id === 'default') continue;

      if (this.domainMatcher.matches(session.domains, domain)) {
        if (session.lastUsedAt > recentTime) {
          recentTime = session.lastUsedAt;
          recentSession = session;
        }
      }
    }

    return recentSession;
  }

  /**
   * 检查是否需要切换 Cookie
   */
  needsCookieSwitch(session, targetDomain) {
    // 检查 Session 是否管理该域名
    if (!this.domainMatcher.matches(session.domains, targetDomain)) {
      return false;
    }

    // 检查当前浏览器 Cookie 是否与 Session 一致
    const currentCookies = this.getCurrentBrowserCookies(targetDomain);
    const sessionCookies = session.cookies[targetDomain] || [];

    // 快速比较（数量和关键 Cookie）
    if (currentCookies.length !== sessionCookies.length) {
      return true;
    }

    // 检查关键认证 Cookie
    const authCookieNames = ['session', 'token', 'auth', 'jwt', 'sid', 'login', 'user'];
    for (const name of authCookieNames) {
      const current = currentCookies.find(c => c.name.toLowerCase().includes(name));
      const stored = sessionCookies.find(c => c.name.toLowerCase().includes(name));

      if (current && stored && current.value !== stored.value) {
        return true;
      }
      if ((current && !stored) || (!current && stored)) {
        return true;
      }
    }

    return false;
  }

  /**
   * 获取当前浏览器的 Cookies
   */
  async getCurrentBrowserCookies(domain) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      const wildcardCookies = await chrome.cookies.getAll({ domain: `.${domain}` });

      return [...cookies, ...wildcardCookies];
    } catch (e) {
      return [];
    }
  }

  /**
   * 自动切换 Cookies
   */
  async autoSwitchCookies(sessionId, domain) {
    // 保存当前浏览器状态到其他 Session（如果需要）
    await this.preserveCurrentState(domain, sessionId);

    // 应用目标 Session 的 Cookies
    await this.sessionManager.applySessionCookies(sessionId, domain);
  }

  /**
   * 保存当前浏览器状态（防止丢失其他账号登录）
   */
  async preserveCurrentState(domain, excludeSessionId) {
    const currentCookies = await this.getCurrentBrowserCookies(domain);

    if (currentCookies.length === 0) return;

    // 找到管理该域名的其他 Session
    for (const session of this.sessionManager.getAllSessions()) {
      if (session.id === excludeSessionId) continue;
      if (session.id === 'default') continue;

      if (this.domainMatcher.matches(session.domains, domain)) {
        // 保存当前 Cookies 到该 Session（覆盖）
        session.cookies[domain] = currentCookies;
        if (!session.domains.includes(domain)) {
          session.domains.push(domain);
        }
        console.log(`[CookieMonitor] Preserved cookies to session ${session.id} for domain ${domain}`);
      }
    }

    await this.sessionManager.saveToStorage();
  }

  /**
   * 添加 Cookie 到 Session
   */
  addCookieToSession(session, cookie) {
    const domain = cookie.domain;

    // 初始化域名存储
    if (!session.cookies[domain]) {
      session.cookies[domain] = [];
    }

    // 查找并更新或添加
    const existingIndex = session.cookies[domain].findIndex(
      c => c.name === cookie.name && c.domain === cookie.domain
    );

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

    if (existingIndex >= 0) {
      session.cookies[domain][existingIndex] = cookieData;
    } else {
      session.cookies[domain].push(cookieData);
    }

    // 添加域名关联
    if (!session.domains.includes(domain)) {
      session.domains.push(domain);
    }

    // 保存到存储
    this.sessionManager.saveToStorage().catch(console.error);
  }

  /**
   * 从 Session 移除 Cookie
   */
  removeCookieFromSession(session, cookie) {
    const domain = cookie.domain;

    if (!session.cookies[domain]) return;

    const index = session.cookies[domain].findIndex(
      c => c.name === cookie.name && c.domain === cookie.domain
    );

    if (index >= 0) {
      session.cookies[domain].splice(index, 1);
      this.sessionManager.saveToStorage().catch(console.error);
    }
  }

  /**
   * 启用/禁用自动监控
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(`[CookieMonitor] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * 销毁
   */
  destroy() {
    if (this.cookieListener) {
      chrome.cookies.onChanged.removeListener(this.cookieListener);
    }
    if (this.tabListener) {
      chrome.tabs.onRemoved.removeListener(this.tabListener);
    }
    if (this.navigationListener && chrome.webNavigation?.onBeforeNavigate) {
      chrome.webNavigation.onBeforeNavigate.removeListener(this.navigationListener);
    }

    this.initialized = false;
  }
}