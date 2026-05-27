# SessionManager - Session 管理器

## 模块概述

`SessionManager` 是早期版本的 Session 管理器，实现了一个 Session = 一个 Tab Group + 独立 Cookie 存储的核心机制。在新版本中，其功能已被 `GroupStorageManager` 整合和扩展。

**文件位置**: [multi-session-manager/background/core/SessionManager.js](../../../multi-session-manager/background/core/SessionManager.js)

## 核心设计

### Session 概念

```
Session = {
  id: string,           // 唯一标识
  name: string,         // 显示名称
  color: string,        // 颜色标识
  groupId: number,      // 关联的 Tab Group ID
  cookies: {},          // 按域名存储的 Cookies
  domains: [],          // 关联的域名列表
  createdAt: number,
  lastUsedAt: number
}
```

### 模块关系

```
SessionManager
  ├── DomainMatcher     // 域名匹配工具
  ├── CookieMonitor     // Cookie 自动监控
  └── TabSessionBinder  // Tab 绑定管理
```

## 核心功能实现

### 1. 初始化流程

```javascript
async initialize() {
  await this.loadFromStorage();    // 加载存储的 Session 数据
  await this.loadSettings();       // 加载用户设置
  await this.syncTabGroups();      // 同步现有 Tab Groups

  // 初始化子模块
  this.tabBinder = new TabSessionBinder(this);
  await this.tabBinder.initialize();

  this.cookieMonitor = new CookieMonitor(this);
  if (this.settings.autoCookieSync) {
    this.cookieMonitor.initialize();
  }

  this.setupListeners();
}
```

### 2. 数据持久化

```javascript
// 从存储加载
async loadFromStorage() {
  const data = await chrome.storage.local.get(this.STORAGE_KEY);
  const { sessions, tabGroups } = data[this.STORAGE_KEY];

  // 恢复到内存
  for (const [id, session] of Object.entries(sessions)) {
    this.sessions.set(id, session);
  }
  for (const [sessionId, groupId] of Object.entries(tabGroups)) {
    this.tabGroups.set(sessionId, groupId);
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

// 保存到存储
async saveToStorage() {
  const data = {
    sessions: Object.fromEntries(this.sessions),
    tabGroups: Object.fromEntries(this.tabGroups)
  };
  await chrome.storage.local.set({ [this.STORAGE_KEY]: data });
}
```

### 3. Session CRUD

#### 创建 Session

```javascript
async createSession(options = {}) {
  const sessionId = this.generateId();
  const name = options.name || `Session ${this.sessions.size}`;

  // 创建 Tab 和 Tab Group
  const tab = await chrome.tabs.create({ url: options.url, active: false });
  const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
  await chrome.tabGroups.update(groupId, {
    title: name,
    color: this.mapColorToGroupColor(color)
  });

  // 创建 Session 对象
  const session = {
    id: sessionId,
    name,
    color,
    groupId,
    cookies: {},
    domains: [],
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
  return { session, tab, groupId };
}
```

#### 获取 Session

```javascript
getAllSessions() {
  return Array.from(this.sessions.values());
}

getSession(sessionId) {
  return this.sessions.get(sessionId);
}
```

#### 更新 Session

```javascript
async updateSession(sessionId, updates) {
  const session = this.sessions.get(sessionId);
  if (!session) return null;

  if (updates.name) session.name = updates.name;
  if (updates.color) session.color = updates.color;

  // 同步更新 Tab Group
  const groupId = this.tabGroups.get(sessionId);
  if (groupId) {
    await chrome.tabGroups.update(groupId, {
      title: session.name,
      color: this.mapColorToGroupColor(session.color)
    });
  }

  await this.saveToStorage();
  return session;
}
```

#### 删除 Session

```javascript
async deleteSession(sessionId) {
  if (sessionId === 'default') return false;

  // 关闭 Group 中的所有标签页
  const groupId = this.tabGroups.get(sessionId);
  if (groupId) {
    const tabs = await chrome.tabs.query({ groupId });
    for (const tab of tabs) {
      await chrome.tabs.remove(tab.id);
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
```

### 4. Cookie 管理（核心功能）

#### 保存 Cookies

```javascript
async saveCurrentCookies(sessionId, domain = null) {
  const session = this.sessions.get(sessionId);

  // 获取当前标签页的域名
  if (!domain) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    domain = new URL(tab.url).hostname;
  }

  // 获取所有相关域名的 Cookies
  const relatedDomains = this.domainMatcher.getRelatedDomains(domain);
  const allCookies = [];

  for (const d of relatedDomains) {
    const cookies = await chrome.cookies.getAll({ domain: d });
    allCookies.push(...cookies);
  }

  // 去重并保存
  const cookieMap = new Map();
  for (const c of allCookies) {
    const key = `${c.name}@${c.domain}`;
    cookieMap.set(key, { /* cookie data */ });
  }

  const rootDomain = this.domainMatcher.getRootDomain(domain);
  session.cookies[rootDomain] = Array.from(cookieMap.values());

  // 记录关联域名
  session.domains = [...new Set([...session.domains, ...relatedDomains])];

  await this.saveToStorage();
}
```

#### 应用 Cookies

```javascript
async applySessionCookies(sessionId, domain = null) {
  const session = this.sessions.get(sessionId);

  // 先清除现有 Cookies
  for (const d of domains) {
    const existingCookies = await chrome.cookies.getAll({ domain: d });
    for (const c of existingCookies) {
      await chrome.cookies.remove({ url, name: c.name });
    }
  }

  // 应用 Session 的 Cookies
  for (const d of domains) {
    const rootDomain = this.domainMatcher.getRootDomain(d);
    const sessionCookies = session.cookies[rootDomain] || [];

    for (const cookie of sessionCookies) {
      await chrome.cookies.set({
        url: this.buildCookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        // ... 其他属性
      });
    }
  }
}
```

#### 切换 Session

```javascript
async switchSession(sessionId, domain = null) {
  // 应用 Cookies
  await this.applySessionCookies(sessionId, domain);

  // 刷新相关标签页
  const tabs = await this.getSessionTabs(sessionId);
  for (const tab of tabs) {
    if (domain && this.domainMatcher.belongsToSite(new URL(tab.url).hostname, domain)) {
      await chrome.tabs.reload(tab.id);
    }
  }

  session.lastUsedAt = Date.now();
  await this.saveToStorage();
}
```

### 5. Tab 操作

```javascript
// 在 Session 中打开新标签页
async openInSession(sessionId, url) {
  const session = this.sessions.get(sessionId);
  const groupId = this.tabGroups.get(sessionId);

  const tab = await chrome.tabs.create({ url, active: true });

  // 添加到 Group
  if (groupId) {
    await chrome.tabs.group({ tabIds: tab.id, groupId });
  }

  // 绑定 Tab
  if (this.tabBinder) {
    this.tabBinder.bind(tab.id, sessionId);
  }

  // 应用该域名的 Cookies
  if (url && this.settings.autoSwitchOnNavigate) {
    const domain = new URL(url).hostname;
    if (session.domains.includes(domain)) {
      await this.applySessionCookies(sessionId, domain);
    }
  }

  return tab;
}

// 获取 Session 的所有标签页
async getSessionTabs(sessionId) {
  const groupId = this.tabGroups.get(sessionId);
  if (!groupId) return [];
  return await chrome.tabs.query({ groupId });
}
```

### 6. 设置管理

```javascript
this.settings = {
  autoCookieSync: true,          // 自动 Cookie 同步
  autoSwitchOnNavigate: true,    // 导航时自动切换
  preserveStateOnSwitch: true    // 切换时保留状态
};

async updateSettings(newSettings) {
  this.settings = { ...this.settings, ...newSettings };
  await chrome.storage.local.set({ [this.SETTINGS_KEY]: this.settings });

  // 应用设置
  if (this.cookieMonitor) {
    this.cookieMonitor.setEnabled(this.settings.autoCookieSync);
  }
}
```

## 事件监听

```javascript
setupListeners() {
  // Tab Group 删除时清理
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
```

## 工具方法

```javascript
// 生成唯一 ID
generateId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 构建 Cookie URL
buildCookieUrl(cookie) {
  const protocol = cookie.secure ? 'https' : 'http';
  const domain = cookie.domain?.startsWith('.')
    ? cookie.domain.slice(1)
    : cookie.domain;
  return `${protocol}://${domain}${cookie.path || '/'}`;
}

// 颜色映射
mapColorToGroupColor(hexColor) {
  const colorMap = {
    '#FF5722': 'orange',
    '#2196F3': 'blue',
    '#4CAF50': 'green',
    // ...
  };
  return colorMap[hexColor] || 'blue';
}
```

## 与 GroupStorageManager 的区别

| 特性 | SessionManager | GroupStorageManager |
|------|----------------|---------------------|
| 存储标识 | 自动生成 ID | 用户自定义名称 |
| 存储内容 | Cookies | Cookies + localStorage + sessionStorage |
| Tab Group 管理 | 基础支持 | 完整生命周期管理 |
| 名称同步 | 不支持 | 支持重命名迁移 |
| 存储保留 | 删除时清除 | Group 关闭后保留 |

## 迁移建议

在新版本中，建议使用 `GroupStorageManager` 作为主要管理器，`SessionManager` 的功能已被整合：

```javascript
// 旧版本
const sessionManager = new SessionManager();
await sessionManager.initialize();

// 新版本
const manager = new GroupStorageManager();
await manager.initialize();
```

## 注意事项

1. **default Session**: 系统保留，不可删除，代表浏览器的默认状态
2. **Group 同步**: 需要定期同步 Tab Groups 状态，处理用户手动删除的情况
3. **Cookie 域名**: 保存 Cookie 时需获取相关域名，确保登录状态完整
