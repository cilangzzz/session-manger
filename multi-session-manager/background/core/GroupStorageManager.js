/**
 * GroupStorageManager - Tab Group 级别的全存储隔离
 *
 * 存储标识：使用用户自定义名称
 * Group 管理：由扩展控制创建和管理
 *
 * 存储内容：
 * - Cookies
 * - localStorage
 * - sessionStorage
 */

import { DomainMatcher } from './DomainMatcher.js';

export class GroupStorageManager {
  constructor() {
    this.STORAGE_KEY = 'group_storage_manager';
    this.SETTINGS_KEY = 'group_storage_settings';
    this.domainMatcher = new DomainMatcher();

    // 存储名称 -> 存储数据（永久保存）
    this.storageByName = new Map();

    // 扩展管理的 Group: 名称 -> Group ID
    this.managedGroups = new Map();

    // 当前激活的
    this.activeGroupName = null;
    this.activeTabId = null;

    // 设置
    this.settings = {
      autoSwitchEnabled: true,
      autoSaveEnabled: true
    };

    this.ignoreCookieChange = false;
    this.isCreatingGroup = false;  // 防止创建时重复触发切换
    this.isApplyingStorage = false;  // 防止应用存储时触发自动保存
    this.saveDebounceTimer = null;
    this.initialized = false;
  }

  /**
   * 初始化
   */
  async initialize() {
    if (this.initialized) return;

    await this.loadFromStorage();
    await this.loadSettings();
    this.setupListeners();

    // 恢复已管理的 Group
    await this.restoreManagedGroups();

    // 获取当前激活的 Tab
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      this.activeTabId = activeTab.id;
      // 检查是否在管理的 Group 中
      for (const [name, groupId] of this.managedGroups) {
        const tabs = await chrome.tabs.query({ groupId });
        if (tabs.some(t => t.id === activeTab.id)) {
          this.activeGroupName = name;
          break;
        }
      }
    }

    this.initialized = true;
    console.log('[GroupStorageManager] Initialized');
    console.log('[GroupStorageManager] Managed groups:', Array.from(this.managedGroups.keys()));
    console.log('[GroupStorageManager] Stored sessions:', Array.from(this.storageByName.keys()));
  }

  /**
   * 从存储加载数据
   */
  async loadFromStorage() {
    const data = await chrome.storage.local.get(this.STORAGE_KEY);
    if (data[this.STORAGE_KEY]) {
      const { storageByName, managedGroups } = data[this.STORAGE_KEY];

      if (storageByName) {
        for (const [name, store] of Object.entries(storageByName)) {
          this.storageByName.set(name, store);
        }
      }

      if (managedGroups) {
        for (const [name, groupId] of Object.entries(managedGroups)) {
          this.managedGroups.set(name, groupId);
        }
      }
    }
  }

  /**
   * 保存到存储
   */
  saveToStorage() {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    this.saveDebounceTimer = setTimeout(async () => {
      await this.saveToStorageImmediate();
      this.saveDebounceTimer = null;
    }, 500);
  }

  async saveToStorageImmediate() {
    const data = {
      storageByName: Object.fromEntries(this.storageByName),
      managedGroups: Object.fromEntries(this.managedGroups)
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
    return this.settings;
  }

  /**
   * 恢复已管理的 Group
   */
  async restoreManagedGroups() {
    const validGroups = new Map();

    for (const [name, groupId] of this.managedGroups) {
      try {
        const group = await chrome.tabGroups.get(groupId);
        // 验证 Group 名称是否匹配
        if (group.title === name) {
          validGroups.set(name, groupId);
        }
      } catch (e) {
        // Group 不存在，忽略
      }
    }

    this.managedGroups = validGroups;
    await this.saveToStorageImmediate();
  }

  /**
   * 设置监听器
   */
  setupListeners() {
    // Tab 激活
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      await this.handleTabActivated(activeInfo.tabId);
    });

    // Tab 更新
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && this.settings.autoSaveEnabled) {
        await this.autoSaveTabStorage(tabId, tab);
      }
    });

    // Tab Group 更新
    chrome.tabGroups.onUpdated.addListener(async (group) => {
      await this.handleGroupUpdated(group);
    });

    // Tab Group 删除
    chrome.tabGroups.onRemoved.addListener(async (group) => {
      await this.handleGroupRemoved(group);
    });

    // Cookie 变化
    chrome.cookies.onChanged.addListener(async (changeInfo) => {
      if (this.settings.autoSaveEnabled) {
        await this.handleCookieChanged(changeInfo);
      }
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
   * Tab 激活处理
   */
  async handleTabActivated(tabId) {
    console.log(`[GroupStorageManager] handleTabActivated triggered for tabId=${tabId}, isCreatingGroup=${this.isCreatingGroup}, activeGroupName="${this.activeGroupName}"`);

    // 正在创建 Group 时跳过
    if (this.isCreatingGroup) {
      console.log(`[GroupStorageManager] Ignoring tab activation during group creation (tabId: ${tabId})`);
      return;
    }
    if (!this.settings.autoSwitchEnabled) return;

    let tab = null;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      return;
    }

    const previousGroupName = this.activeGroupName;

    // 检查 Tab 是否在管理的 Group 中
    let newGroupName = null;
    for (const [name, groupId] of this.managedGroups) {
      try {
        const tabs = await chrome.tabs.query({ groupId });
        if (tabs.some(t => t.id === tabId)) {
          newGroupName = name;
          console.log(`[GroupStorageManager] Tab ${tabId} found in group "${name}"`);
          break;
        }
      } catch (e) {
        // 忽略
      }
    }

    // 如果没有找到对应的 Group，检查 tab 是否有 groupId
    if (!newGroupName && tab.groupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      console.log(`[GroupStorageManager] Tab ${tabId} has groupId ${tab.groupId} but not in managed groups`);
    }

    // 名称没变，不切换
    if (previousGroupName === newGroupName) {
      this.activeTabId = tabId;
      return;
    }

    // 1. 先保存上一个 Group 的存储
    if (previousGroupName && this.activeTabId) {
      try {
        const prevTab = await chrome.tabs.get(this.activeTabId);
        if (prevTab && prevTab.url && !prevTab.url.startsWith('chrome://')) {
          await this.autoSaveTabStorage(this.activeTabId, prevTab);
        }
      } catch (e) {}
    }

    // 2. 更新激活状态
    this.activeTabId = tabId;
    this.activeGroupName = newGroupName;

    // 3. 切换存储（应用新 Group 的存储）
    if (newGroupName && tab.url && !tab.url.startsWith('chrome://')) {
      await this.applyNamedStorage(newGroupName, tab);
    }

    console.log(`[GroupStorageManager] Switched from "${previousGroupName}" to "${newGroupName}"`);
  }

  /**
   * Group 更新处理
   */
  async handleGroupUpdated(group) {
    // 检查是否是管理的 Group
    for (const [name, groupId] of this.managedGroups) {
      if (groupId === group.id) {
        // 检查名称是否变化
        if (group.title && group.title !== name) {
          // 名称变化，迁移存储
          const store = this.storageByName.get(name);
          if (store) {
            store.name = group.title;
            this.storageByName.delete(name);
            this.storageByName.set(group.title, store);
          }

          // 更新管理映射
          this.managedGroups.delete(name);
          this.managedGroups.set(group.title, group.id);

          if (this.activeGroupName === name) {
            this.activeGroupName = group.title;
          }

          await this.saveToStorageImmediate();
          console.log(`[GroupStorageManager] Group renamed: "${name}" -> "${group.title}"`);
        }
        break;
      }
    }
  }

  /**
   * Group 删除处理 - 关闭前先保存存储
   */
  async handleGroupRemoved(group) {
    // 找到对应的名称
    let closedName = null;
    for (const [name, groupId] of this.managedGroups) {
      if (groupId === group.id) {
        closedName = name;
        break;
      }
    }

    if (closedName) {
      // 关闭前，保存当前 Group 的所有 Tab 存储
      let lastValidUrl = null;

      try {
        const groupId = this.managedGroups.get(closedName);
        const tabs = await chrome.tabs.query({ groupId });

        for (const tab of tabs) {
          if (tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
            try {
              const url = new URL(tab.url);
              const domain = url.hostname;

              // 记录最后一个有效的 URL 作为 startUrl
              lastValidUrl = tab.url;

              const cookies = await this.getAllCookiesForDomain(domain);

              let webStorage = { localStorage: {}, sessionStorage: {} };
              try {
                const response = await chrome.scripting.executeScript({
                  target: { tabId: tab.id },
                  func: () => ({
                    localStorage: { ...localStorage },
                    sessionStorage: { ...sessionStorage }
                  })
                });
                if (response?.[0]?.result) {
                  webStorage = response[0].result;
                }
              } catch (e) {}

              // 立即保存，传入 tab.url 作为 startUrl
              await this.saveToNamedStore(closedName, domain, cookies, webStorage, tab.url, true);
              console.log(`[GroupStorageManager] Saved storage for "${closedName}" - cookies: ${cookies.length}, ls: ${Object.keys(webStorage.localStorage || {}).length}, ss: ${Object.keys(webStorage.sessionStorage || {}).length}`);
            } catch (e) {}
          }
        }

        // 更新 startUrl 到存储
        if (lastValidUrl && this.storageByName.has(closedName)) {
          const store = this.storageByName.get(closedName);
          store.startUrl = lastValidUrl;
        }

        console.log(`[GroupStorageManager] Saved storage before closing "${closedName}"`);
      } catch (e) {
        // Group 可能已不存在
      }

      // 从管理中移除
      this.managedGroups.delete(closedName);
      if (this.activeGroupName === closedName) {
        this.activeGroupName = null;
        this.activeTabId = null;
      }

      await this.saveToStorageImmediate();
      console.log(`[GroupStorageManager] Group "${closedName}" closed (storage preserved)`);
    }
  }

  /**
   * 创建新 Group（由扩展管理）
   */
  async createGroup(options = {}) {
    const name = options.name || `Session ${this.managedGroups.size + 1}`;
    const color = options.color || 'blue';

    console.log(`[GroupStorageManager] createGroup START for "${name}"`);

    // 设置创建标志，防止 handleTabActivated 干扰
    this.isCreatingGroup = true;
    console.log(`[GroupStorageManager] Set isCreatingGroup=true for "${name}"`);

    try {
      // 检查名称是否已存在（已打开的 Group）
      if (this.managedGroups.has(name)) {
        const groupId = this.managedGroups.get(name);
        try {
          const tabs = await chrome.tabs.query({ groupId });
          if (tabs.length > 0) {
            // 已打开，直接激活
            const tab = tabs[0];
            await chrome.tabs.update(tab.id, { active: true });
            await chrome.windows.update(tab.windowId, { focused: true });

            // 应用存储
            if (this.storageByName.has(name) && tab.url && !tab.url.startsWith('chrome://')) {
              await this.applyNamedStorage(name, tab);
            }

            this.activeGroupName = name;
            this.activeTabId = tab.id;
            return { groupId, name, tabId: tab.id, isNew: false };
          }
        } catch (e) {
          this.managedGroups.delete(name);
        }
      }

      // 获取 URL：优先使用传入的 URL，否则使用历史存储的 startUrl
      let url = options.url;
      if (!url && this.storageByName.has(name)) {
        const store = this.storageByName.get(name);
        url = store.startUrl || 'https://www.google.com';
      }
      if (!url) {
        url = 'https://www.google.com';
      }

      // 保存当前 Group 的存储（如果有的话）
      if (this.activeGroupName && this.activeTabId) {
        try {
          const currentTab = await chrome.tabs.get(this.activeTabId);
          if (currentTab && currentTab.url && !currentTab.url.startsWith('chrome://')) {
            await this.autoSaveTabStorage(this.activeTabId, currentTab);
          }
        } catch (e) {}
      }

      // 创建新 Tab 和 Group
      const tab = await chrome.tabs.create({ url, active: true });
      console.log(`[GroupStorageManager] Created tab ${tab.id} for "${name}"`);
      const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
      console.log(`[GroupStorageManager] Added tab ${tab.id} to group ${groupId}`);
      await chrome.tabGroups.update(groupId, { title: name, color });

      // 添加到管理（但先不更新 activeGroupName，防止自动保存时保存错误）
      this.managedGroups.set(name, groupId);
      this.activeTabId = tab.id;

      await this.saveToStorageImmediate();

      // 处理存储
      console.log(`[GroupStorageManager] Checking storage for "${name}": has=${this.storageByName.has(name)}`);
      if (this.storageByName.has(name)) {
        const existingStore = this.storageByName.get(name);
        console.log(`[GroupStorageManager] Found existing store for "${name}":`, JSON.stringify({
          startUrl: existingStore.startUrl,
          domains: existingStore.domains,
          cookieDomains: Object.keys(existingStore.cookies || {}),
          cookieCount: Object.values(existingStore.cookies || {}).reduce((sum, arr) => sum + arr.length, 0),
          lsDomains: Object.keys(existingStore.localStorage || {}),
          ssDomains: Object.keys(existingStore.sessionStorage || {})
        }));
        // 有历史存储，等待页面加载后应用
        await this.waitForTabLoad(tab.id, 8000);
        // 重新获取 tab，因为页面可能已经导航
        const currentTab = await chrome.tabs.get(tab.id);
        console.log(`[GroupStorageManager] Applying stored data for "${name}" to tab ${tab.id}, url: ${currentTab?.url}`);
        await this.applyNamedStorage(name, currentTab);
        // 应用存储后才更新 activeGroupName
        this.activeGroupName = name;
      } else {
        // 新 Session，初始化存储并保存 startUrl
        await this.waitForTabLoad(tab.id, 5000);

        // 初始化存储记录
        this.storageByName.set(name, {
          name: name,
          startUrl: url,
          cookies: {},
          localStorage: {},
          sessionStorage: {},
          domains: [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        await this.saveToStorageImmediate();

        // 清空当前存储
        await this.clearAllStorage(tab.id, url);
        // 更新 activeGroupName
        this.activeGroupName = name;
      }

      console.log(`[GroupStorageManager] Created group "${name}" (ID: ${groupId})`);

      // 重置创建标志 - 在所有操作完成后
      this.isCreatingGroup = false;

      return { groupId, name, tabId: tab.id, isNew: true };
    } catch (error) {
      // 发生错误时也要重置标志
      this.isCreatingGroup = false;
      throw error;
    }
  }

  /**
   * 等待 Tab 加载完成
   */
  async waitForTabLoad(tabId, timeout = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          return true;
        }
      } catch (e) {
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return false;
  }

  /**
   * 清空指定 URL 的所有存储（Cookie + localStorage + sessionStorage）
   */
  async clearCurrentCookies(url) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      // 1. 清空 Cookies
      const cookies = await this.getAllCookiesForDomain(domain);
      for (const cookie of cookies) {
        try {
          const cookieUrl = this.buildCookieUrl(cookie);
          await chrome.cookies.remove({ url: cookieUrl, name: cookie.name });
        } catch (e) {}
      }

      console.log(`[GroupStorageManager] Cleared ${cookies.length} cookies for ${domain}`);
    } catch (e) {
      // 忽略无效 URL
    }
  }

  /**
   * 清空 Tab 的所有存储（Cookie + localStorage + sessionStorage）
   */
  async clearAllStorage(tabId, url) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      // 1. 清空 Cookies
      const cookies = await this.getAllCookiesForDomain(domain);
      for (const cookie of cookies) {
        try {
          const cookieUrl = this.buildCookieUrl(cookie);
          await chrome.cookies.remove({ url: cookieUrl, name: cookie.name });
        } catch (e) {}
      }

      // 2. 清空 localStorage 和 sessionStorage
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            localStorage.clear();
            sessionStorage.clear();
            console.log('Cleared localStorage and sessionStorage');
          }
        });
      } catch (e) {
        // 可能是 chrome:// 页面
      }

      console.log(`[GroupStorageManager] Cleared all storage for ${domain}`);
    } catch (e) {
      // 忽略无效 URL
    }
  }

  /**
   * 打开 Group（恢复或激活）
   */
  async openGroup(name) {
    console.log(`[GroupStorageManager] openGroup called with name="${name}"`);
    console.log(`[GroupStorageManager] Current managedGroups: ${Array.from(this.managedGroups.keys()).join(', ')}`);
    console.log(`[GroupStorageManager] Current storageByName: ${Array.from(this.storageByName.keys()).join(', ')}`);

    // 检查是否已打开
    if (this.managedGroups.has(name)) {
      const groupId = this.managedGroups.get(name);
      try {
        const tabs = await chrome.tabs.query({ groupId });
        if (tabs.length > 0) {
          const tab = tabs[0];
          // 如果有历史存储，先应用
          if (this.storageByName.has(name) && tab.url && !tab.url.startsWith('chrome://')) {
            await this.applyNamedStorage(name, tab);
          }
          await chrome.tabs.update(tab.id, { active: true });
          await chrome.windows.update(tab.windowId, { focused: true });
          this.activeGroupName = name;
          this.activeTabId = tab.id;
          return { opened: false, tabId: tab.id };
        }
      } catch (e) {
        // Group 不存在，需要重新创建
        this.managedGroups.delete(name);
      }
    }

    // 创建新 Group
    return await this.createGroup({ name });
  }

  /**
   * 删除 Group（关闭所有 Tab）
   */
  async closeGroup(name) {
    if (!this.managedGroups.has(name)) return false;

    const groupId = this.managedGroups.get(name);
    try {
      const tabs = await chrome.tabs.query({ groupId });
      for (const tab of tabs) {
        await chrome.tabs.remove(tab.id);
      }
    } catch (e) {
      // 忽略
    }

    this.managedGroups.delete(name);
    if (this.activeGroupName === name) {
      this.activeGroupName = null;
    }

    await this.saveToStorageImmediate();
    return true;
  }

  /**
   * 删除 Group 及其存储
   */
  async deleteGroupAndStorage(name) {
    await this.closeGroup(name);
    this.storageByName.delete(name);
    await this.saveToStorageImmediate();
    return true;
  }

  /**
   * 获取 Tab 所属的 Group 名称
   * @returns {string|null} Group 名称，如果不在任何管理的 Group 中则返回 null
   */
  async getTabGroupName(tabId) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab) return null;

      // 遍历管理的 Group，找到 Tab 属于哪个
      for (const [name, groupId] of this.managedGroups) {
        try {
          const tabs = await chrome.tabs.query({ groupId });
          if (tabs.some(t => t.id === tabId)) {
            return name;
          }
        } catch (e) {
          // Group 可能不存在
        }
      }
    } catch (e) {
      // Tab 可能不存在
    }
    return null;
  }

  /**
   * 自动保存 Tab 存储
   */
  async autoSaveTabStorage(tabId, tab) {
    // 正在创建 Group 时跳过自动保存
    if (this.isCreatingGroup) {
      console.log(`[GroupStorageManager] Skipping auto-save during group creation`);
      return;
    }

    // 正在应用存储时跳过（刷新后可能会触发）
    if (this.isApplyingStorage) {
      console.log(`[GroupStorageManager] Skipping auto-save during storage application`);
      return;
    }

    if (!this.activeGroupName) return;

    // 容错检查：验证 Tab 是否真的属于当前 activeGroupName
    const actualGroupName = await this.getTabGroupName(tabId);
    if (actualGroupName && actualGroupName !== this.activeGroupName) {
      console.log(`[GroupStorageManager] Tab ${tabId} is in group "${actualGroupName}", not "${this.activeGroupName}". Updating activeGroupName.`);
      // 更新 activeGroupName 为实际的 Group 名
      this.activeGroupName = actualGroupName;
    }

    // 如果 Tab 不在任何管理的 Group 中，跳过保存
    if (!actualGroupName) {
      console.log(`[GroupStorageManager] Tab ${tabId} is not in any managed group, skipping save`);
      return;
    }

    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      return;
    }

    try {
      const url = new URL(tab.url);
      const domain = url.hostname;

      const cookies = await this.getAllCookiesForDomain(domain);

      let webStorage = { localStorage: {}, sessionStorage: {} };
      try {
        const response = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({
            localStorage: { ...localStorage },
            sessionStorage: { ...sessionStorage }
          })
        });
        if (response?.[0]?.result) {
          webStorage = response[0].result;
        }
      } catch (e) {}

      // 只要有数据就保存，传入 tab.url 作为 startUrl
      const lsKeys = Object.keys(webStorage.localStorage || {}).length;
      const ssKeys = Object.keys(webStorage.sessionStorage || {}).length;
      await this.saveToNamedStore(this.activeGroupName, domain, cookies, webStorage, tab.url, false);
      console.log(`[GroupStorageManager] Auto-saved "${this.activeGroupName}" - domain: ${domain}, cookies: ${cookies.length}, ls: ${lsKeys}, ss: ${ssKeys}`);
    } catch (e) {}
  }

  /**
   * Cookie 变化处理
   */
  async handleCookieChanged(changeInfo) {
    // 正在创建 Group 时跳过
    if (this.isCreatingGroup) return;
    if (this.ignoreCookieChange || !this.activeGroupName) return;

    // 容错检查：验证当前 Tab 是否属于 activeGroupName
    if (this.activeTabId) {
      const actualGroupName = await this.getTabGroupName(this.activeTabId);
      if (actualGroupName && actualGroupName !== this.activeGroupName) {
        console.log(`[GroupStorageManager] Cookie change: Tab is in "${actualGroupName}", not "${this.activeGroupName}"`);
        this.activeGroupName = actualGroupName;
      }
      if (!actualGroupName) {
        return; // Tab 不在任何管理的 Group 中
      }
    }

    const { cookie, removed } = changeInfo;

    try {
      const tab = await chrome.tabs.get(this.activeTabId);
      if (!tab || !tab.url) return;

      const url = new URL(tab.url);
      if (!this.domainMatcher.isSameSite(cookie.domain, url.hostname)) return;

      await this.saveCookieToNamedStore(this.activeGroupName, cookie, removed);
    } catch (e) {}
  }

  /**
   * 保存到指定名称存储
   * @param {string} groupName - 存储名称
   * @param {string} domain - 域名
   * @param {array} cookies - Cookie 数组
   * @param {object} webStorage - localStorage 和 sessionStorage
   * @param {string} startUrl - 起始 URL（可选）
   * @param {boolean} immediate - 是否立即保存
   */
  async saveToNamedStore(groupName, domain, cookies, webStorage, startUrl = null, immediate = false) {
    if (!this.storageByName.has(groupName)) {
      this.storageByName.set(groupName, {
        name: groupName,
        startUrl: startUrl || `https://${domain}`,
        cookies: {},
        localStorage: {},
        sessionStorage: {},
        domains: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    const store = this.storageByName.get(groupName);
    const rootDomain = this.domainMatcher.getRootDomain(domain);

    // 更新 startUrl（如果提供了）
    if (startUrl) {
      store.startUrl = startUrl;
    }

    if (cookies?.length > 0) {
      store.cookies[rootDomain] = cookies;
      if (!store.domains.includes(rootDomain)) {
        store.domains.push(rootDomain);
      }
    }

    if (webStorage?.localStorage && Object.keys(webStorage.localStorage).length > 0) {
      store.localStorage[rootDomain] = webStorage.localStorage;
    }
    if (webStorage?.sessionStorage && Object.keys(webStorage.sessionStorage).length > 0) {
      store.sessionStorage[rootDomain] = webStorage.sessionStorage;
    }

    store.updatedAt = Date.now();

    if (immediate) {
      await this.saveToStorageImmediate();
    } else {
      this.saveToStorage();
    }
  }

  /**
   * 保存单个 Cookie
   */
  async saveCookieToNamedStore(groupName, cookie, removed) {
    let store = this.storageByName.get(groupName);

    if (!store && !removed) {
      // 初始化存储，但不设置 startUrl（startUrl 由其他方法设置）
      store = {
        name: groupName,
        startUrl: null,
        cookies: {},
        localStorage: {},
        sessionStorage: {},
        domains: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.storageByName.set(groupName, store);
    }

    if (!store) return;

    const domain = this.domainMatcher.normalize(cookie.domain);
    const rootDomain = this.domainMatcher.getRootDomain(domain);

    if (!store.cookies[rootDomain]) {
      store.cookies[rootDomain] = [];
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
      store.cookies[rootDomain] = store.cookies[rootDomain].filter(
        c => !(c.name === cookie.name && c.domain === cookie.domain)
      );
    } else {
      const index = store.cookies[rootDomain].findIndex(
        c => c.name === cookie.name && c.domain === cookie.domain
      );

      if (index >= 0) {
        store.cookies[rootDomain][index] = cookieData;
      } else {
        store.cookies[rootDomain].push(cookieData);
      }

      if (!store.domains.includes(rootDomain)) {
        store.domains.push(rootDomain);
      }
    }

    store.updatedAt = Date.now();
    this.saveToStorage();
  }

  /**
   * 应用指定名称存储 - 先清空当前所有存储，再应用新存储
   */
  async applyNamedStorage(groupName, tab) {
    console.log(`[GroupStorageManager] applyNamedStorage called with groupName="${groupName}", tab.url="${tab?.url}"`);
    console.log(`[GroupStorageManager] Available stores: ${Array.from(this.storageByName.keys()).join(', ')}`);

    const store = this.storageByName.get(groupName);

    if (!store) {
      console.log(`[GroupStorageManager] No stored data for "${groupName}"`);
      return { success: true, applied: false };
    }

    if (!tab || !tab.url) return { success: false };

    let targetDomain = null;
    try {
      const url = new URL(tab.url);
      targetDomain = url.hostname;
    } catch (e) {
      return { success: false };
    }

    this.ignoreCookieChange = true;
    this.isApplyingStorage = true;  // 防止刷新后自动保存

    try {
      // 1. 先清空当前所有存储
      await this.clearAllStorage(tab.id, tab.url);

      // 2. 应用存储的 Cookie
      await this.applyCookies(store, targetDomain);

      // 3. 应用存储的 WebStorage
      await this.applyWebStorage(store, tab.id, targetDomain);

      // 4. 刷新页面
      await chrome.tabs.reload(tab.id);

      console.log(`[GroupStorageManager] Applied storage for "${groupName}"`);
      return { success: true, applied: true };
    } catch (e) {
      console.error('[GroupStorageManager] Apply error:', e);
      return { success: false, error: e.message };
    } finally {
      this.ignoreCookieChange = false;
      this.isApplyingStorage = false;
    }
  }

  /**
   * 应用 Cookies - 只应用存储的 Cookie（清空已在 applyNamedStorage 中完成）
   */
  async applyCookies(store, targetDomain) {
    console.log(`[GroupStorageManager] applyCookies - store.cookies:`, JSON.stringify(store.cookies));
    console.log(`[GroupStorageManager] applyCookies - targetDomain: ${targetDomain}`);

    let appliedCount = 0;

    for (const [domain, cookies] of Object.entries(store.cookies)) {
      console.log(`[GroupStorageManager] Processing domain "${domain}" with ${cookies?.length || 0} cookies`);
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
          appliedCount++;
        } catch (e) {
          console.log(`[GroupStorageManager] Failed to set cookie ${cookie.name}: ${e.message}`);
        }
      }
    }

    console.log(`[GroupStorageManager] Applied ${appliedCount} cookies for ${Object.keys(store.cookies).length} domains`);
  }

  /**
   * 应用 WebStorage
   */
  async applyWebStorage(store, tabId, targetDomain) {
    const rootDomain = this.domainMatcher.getRootDomain(targetDomain);
    console.log(`[GroupStorageManager] applyWebStorage - targetDomain: ${targetDomain}, rootDomain: ${rootDomain}`);

    // 尝试获取存储数据，支持多种 key 格式
    let ls = store.localStorage[rootDomain] || {};
    let ss = store.sessionStorage[rootDomain] || {};

    // 如果找不到，尝试用旧格式的 key（兼容之前保存的数据）
    // 之前 IP 地址可能被错误地转换为段，如 127.0.0.1 -> 0.1
    if (Object.keys(ls).length === 0 && Object.keys(ss).length === 0) {
      // 尝试查找可能的旧 key
      for (const [key, value] of Object.entries(store.localStorage)) {
        if (this.isMatchingDomainKey(key, targetDomain)) {
          ls = value;
          console.log(`[GroupStorageManager] Found localStorage with legacy key "${key}"`);
          break;
        }
      }
      for (const [key, value] of Object.entries(store.sessionStorage)) {
        if (this.isMatchingDomainKey(key, targetDomain)) {
          ss = value;
          console.log(`[GroupStorageManager] Found sessionStorage with legacy key "${key}"`);
          break;
        }
      }
    }

    console.log(`[GroupStorageManager] applyWebStorage - ls keys: ${Object.keys(ls).length}, ss keys: ${Object.keys(ss).length}`);

    if (Object.keys(ls).length === 0 && Object.keys(ss).length === 0) {
      console.log(`[GroupStorageManager] No web storage data to apply for ${rootDomain}`);
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (localStorageData, sessionStorageData) => {
          localStorage.clear();
          for (const [key, value] of Object.entries(localStorageData)) {
            localStorage.setItem(key, value);
          }
          sessionStorage.clear();
          for (const [key, value] of Object.entries(sessionStorageData)) {
            sessionStorage.setItem(key, value);
          }
          console.log(`Applied ${Object.keys(localStorageData).length} localStorage items and ${Object.keys(sessionStorageData).length} sessionStorage items`);
        },
        args: [ls, ss]
      });
      console.log(`[GroupStorageManager] Successfully applied web storage`);
    } catch (e) {
      console.error(`[GroupStorageManager] Failed to apply web storage:`, e);
    }
  }

  /**
   * 检查存储的 key 是否匹配目标域名（兼容旧数据）
   */
  isMatchingDomainKey(key, targetDomain) {
    // 直接匹配
    if (key === targetDomain) return true;

    // 检查是否是 IP 地址的段匹配（旧 bug 的兼容）
    const parts = targetDomain.split('.');
    if (parts.length >= 2) {
      // 尝试最后两段匹配（如 127.0.0.1 -> 0.1）
      const lastTwo = parts.slice(-2).join('.');
      if (key === lastTwo) return true;

      // 尝试最后一段匹配
      const lastOne = parts[parts.length - 1];
      if (key === lastOne) return true;
    }

    return false;
  }

  /**
   * 获取域名相关 Cookies
   */
  async getAllCookiesForDomain(domain) {
    const cookies = [];
    const seen = new Set();

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
      } catch (e) {}
    }

    return cookies;
  }

  buildCookieUrl(cookie) {
    const protocol = cookie.secure ? 'https' : 'http';
    const domain = cookie.domain?.startsWith('.')
      ? cookie.domain.slice(1)
      : cookie.domain || 'example.com';
    return `${protocol}://${domain}${cookie.path || '/'}`;
  }

  /**
   * 获取所有存储
   */
  getAllStores() {
    return Array.from(this.storageByName.values());
  }

  /**
   * 获取管理的 Group 列表
   */
  async getManagedGroupsList() {
    const result = [];

    for (const [name, groupId] of this.managedGroups) {
      let isOpen = false;
      let tabCount = 0;

      try {
        const tabs = await chrome.tabs.query({ groupId });
        tabCount = tabs.length;
        isOpen = true;
      } catch (e) {
        // Group 已关闭
      }

      const store = this.storageByName.get(name);
      let cookieCount = 0;
      if (store) {
        for (const cookies of Object.values(store.cookies)) {
          cookieCount += cookies.length;
        }
      }

      result.push({
        name,
        groupId,
        isOpen,
        tabCount,
        cookieCount,
        hasStore: !!store,
        startUrl: store?.startUrl,
        updatedAt: store?.updatedAt
      });
    }

    // 添加只有存储、没有打开的 Group
    for (const [name, store] of this.storageByName) {
      if (!this.managedGroups.has(name)) {
        let cookieCount = 0;
        for (const cookies of Object.values(store.cookies)) {
          cookieCount += cookies.length;
        }
        result.push({
          name,
          groupId: null,
          isOpen: false,
          tabCount: 0,
          cookieCount,
          hasStore: true,
          startUrl: store.startUrl,
          updatedAt: store.updatedAt
        });
      }
    }

    return result;
  }

  /**
   * 重命名 Group
   */
  async renameGroup(oldName, newName) {
    if (oldName === newName) return true;

    // 更新 Group 标题
    if (this.managedGroups.has(oldName)) {
      const groupId = this.managedGroups.get(oldName);
      try {
        await chrome.tabGroups.update(groupId, { title: newName });
      } catch (e) {}
    }

    // 迁移存储
    const store = this.storageByName.get(oldName);
    if (store) {
      store.name = newName;
      this.storageByName.delete(oldName);
      this.storageByName.set(newName, store);
    }

    // 更新管理映射
    const groupId = this.managedGroups.get(oldName);
    if (groupId) {
      this.managedGroups.delete(oldName);
      this.managedGroups.set(newName, groupId);
    }

    if (this.activeGroupName === oldName) {
      this.activeGroupName = newName;
    }

    await this.saveToStorageImmediate();
    return true;
  }

  /**
   * 手动保存
   */
  async manualSave() {
    if (!this.activeGroupName) {
      return { success: false, error: 'No active group' };
    }

    const tab = await chrome.tabs.get(this.activeTabId);
    if (!tab?.url) {
      return { success: false, error: 'No active tab' };
    }

    try {
      const url = new URL(tab.url);
      const domain = url.hostname;

      const cookies = await this.getAllCookiesForDomain(domain);
      let webStorage = { localStorage: {}, sessionStorage: {} };

      try {
        const response = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            localStorage: { ...localStorage },
            sessionStorage: { ...sessionStorage }
          })
        });
        if (response?.[0]?.result) {
          webStorage = response[0].result;
        }
      } catch (e) {}

      await this.saveToNamedStore(this.activeGroupName, domain, cookies, webStorage);

      const store = this.storageByName.get(this.activeGroupName);
      let cookieCount = 0, lsCount = 0, ssCount = 0;
      if (store) {
        for (const cookies of Object.values(store.cookies)) {
          cookieCount += cookies.length;
        }
        for (const ls of Object.values(store.localStorage)) {
          lsCount += Object.keys(ls).length;
        }
        for (const ss of Object.values(store.sessionStorage)) {
          ssCount += Object.keys(ss).length;
        }
      }

      return { success: true, cookieCount, lsCount, ssCount };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * 获取当前状态
   */
  getCurrentState() {
    return {
      activeGroupName: this.activeGroupName,
      activeTabId: this.activeTabId,
      settings: this.settings,
      managedGroupsCount: this.managedGroups.size
    };
  }

  /**
   * 导入 Session
   */
  async importSession(sessionData) {
    if (!sessionData || !sessionData.name) {
      throw new Error('Invalid session data: missing name');
    }

    const name = sessionData.name;

    // 检查是否已存在
    if (this.storageByName.has(name)) {
      // 已存在，合并数据
      const existingStore = this.storageByName.get(name);

      // 合并 cookies
      if (sessionData.cookies) {
        for (const [domain, cookies] of Object.entries(sessionData.cookies)) {
          existingStore.cookies[domain] = cookies;
        }
      }

      // 合并 localStorage
      if (sessionData.localStorage) {
        for (const [domain, ls] of Object.entries(sessionData.localStorage)) {
          existingStore.localStorage[domain] = ls;
        }
      }

      // 合并 sessionStorage
      if (sessionData.sessionStorage) {
        for (const [domain, ss] of Object.entries(sessionData.sessionStorage)) {
          existingStore.sessionStorage[domain] = ss;
        }
      }

      // 合并 domains
      if (sessionData.domains) {
        for (const domain of sessionData.domains) {
          if (!existingStore.domains.includes(domain)) {
            existingStore.domains.push(domain);
          }
        }
      }

      // 更新 startUrl（如果没有的话）
      if (!existingStore.startUrl && sessionData.startUrl) {
        existingStore.startUrl = sessionData.startUrl;
      }

      existingStore.updatedAt = Date.now();
    } else {
      // 不存在，创建新存储
      this.storageByName.set(name, {
        name: name,
        startUrl: sessionData.startUrl || null,
        cookies: sessionData.cookies || {},
        localStorage: sessionData.localStorage || {},
        sessionStorage: sessionData.sessionStorage || {},
        domains: sessionData.domains || [],
        createdAt: sessionData.createdAt || Date.now(),
        updatedAt: Date.now()
      });
    }

    await this.saveToStorageImmediate();
    console.log(`[GroupStorageManager] Imported session "${name}"`);
    return { success: true, name };
  }

  /**
   * 获取统计
   */
  getStats() {
    let totalCookies = 0;
    for (const store of this.storageByName.values()) {
      for (const cookies of Object.values(store.cookies)) {
        totalCookies += cookies.length;
      }
    }

    return {
      storeCount: this.storageByName.size,
      openGroupCount: this.managedGroups.size,
      totalCookies,
      activeGroupName: this.activeGroupName,
      settings: this.settings
    };
  }
}