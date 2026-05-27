# CookieMonitor - Cookie 自动监控模块

## 模块概述

`CookieMonitor` 负责 Cookie 的自动监控和同步。当 Cookie 发生变化时，自动同步到对应的 Session 存储，实现 Cookie 的实时备份。

**文件位置**: [multi-session-manager/background/core/CookieMonitor.js](../../../multi-session-manager/background/core/CookieMonitor.js)

## 核心设计

### 监控机制

```
浏览器 Cookie 变化 → CookieMonitor 捕获 → 同步到 Session 存储
```

### 数据结构

```javascript
// Tab -> Session 绑定
activeSessionByTab: Map<tabId, sessionId>

// 监听器引用
cookieListener: Function      // Cookie 变化监听
tabListener: Function         // Tab 关闭监听
navigationListener: Function  // 导航监听
```

## 核心功能实现

### 1. 初始化

```javascript
initialize() {
  this.setupCookieListener();      // 监听 Cookie 变化
  this.setupTabListeners();        // 监听 Tab 关闭
  this.setupNavigationListener();  // 监听页面导航
}
```

### 2. Cookie 变化监听

```javascript
setupCookieListener() {
  this.cookieListener = async (changeInfo) => {
    if (!this.enabled) return;

    const { cookie, removed, cause } = changeInfo;

    // 获取关联的 Session
    const session = this.getActiveSessionForDomain(cookie.domain);
    if (!session) return;

    // 自动同步到 Session
    if (removed) {
      this.removeCookieFromSession(session, cookie);
    } else {
      this.addCookieToSession(session, cookie);
    }
  };

  chrome.cookies.onChanged.addListener(this.cookieListener);
}
```

**触发场景**:
- 用户登录网站，产生新 Cookie
- 用户登出网站，删除 Cookie
- Cookie 过期被浏览器清理
- 网站主动更新 Cookie

### 3. 导航监听 - 自动切换

```javascript
setupNavigationListener() {
  this.navigationListener = async (details) => {
    if (details.frameId !== 0) return; // 只处理主 frame

    const { tabId, url } = details;
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // 获取 Tab 绑定的 Session
    const sessionId = this.activeSessionByTab.get(tabId);
    if (!sessionId) return;

    const session = this.sessionManager.getSession(sessionId);

    // 检查是否需要切换 Cookie
    const needsSwitch = this.needsCookieSwitch(session, domain);
    if (needsSwitch) {
      await this.autoSwitchCookies(sessionId, domain);
    }
  };

  chrome.webNavigation.onBeforeNavigate.addListener(this.navigationListener);
}
```

### 4. Cookie 切换判断

```javascript
needsCookieSwitch(session, targetDomain) {
  // 检查 Session 是否管理该域名
  if (!this.domainMatcher.matches(session.domains, targetDomain)) {
    return false;
  }

  // 获取当前浏览器 Cookie
  const currentCookies = this.getCurrentBrowserCookies(targetDomain);
  const sessionCookies = session.cookies[targetDomain] || [];

  // 数量比较
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
```

### 5. 自动切换 Cookie

```javascript
async autoSwitchCookies(sessionId, domain) {
  // 1. 保存当前浏览器状态到其他 Session
  await this.preserveCurrentState(domain, sessionId);

  // 2. 应用目标 Session 的 Cookies
  await this.sessionManager.applySessionCookies(sessionId, domain);
}
```

### 6. 状态保护

保存当前浏览器 Cookie 到其他管理该域名的 Session：

```javascript
async preserveCurrentState(domain, excludeSessionId) {
  const currentCookies = await this.getCurrentBrowserCookies(domain);
  if (currentCookies.length === 0) return;

  // 找到管理该域名的其他 Session
  for (const session of this.sessionManager.getAllSessions()) {
    if (session.id === excludeSessionId) continue;
    if (session.id === 'default') continue;

    if (this.domainMatcher.matches(session.domains, domain)) {
      // 保存当前 Cookies 到该 Session
      session.cookies[domain] = currentCookies;
      if (!session.domains.includes(domain)) {
        session.domains.push(domain);
      }
    }
  }

  await this.sessionManager.saveToStorage();
}
```

### 7. Tab 绑定管理

```javascript
// 绑定 Tab 到 Session
bindTabToSession(tabId, sessionId) {
  this.activeSessionByTab.set(tabId, sessionId);
}

// 解绑 Tab
unbindTab(tabId) {
  this.activeSessionByTab.delete(tabId);
}

// 获取 Tab 绑定的 Session
getTabSession(tabId) {
  return this.activeSessionByTab.get(tabId);
}
```

### 8. 添加/移除 Cookie 到 Session

```javascript
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

  this.sessionManager.saveToStorage();
}
```

## 事件流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                     Cookie 变化事件流                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  用户操作 (登录/登出)                                            │
│       │                                                         │
│       ▼                                                         │
│  浏览器 Cookie 变化                                              │
│       │                                                         │
│       ▼                                                         │
│  chrome.cookies.onChanged 触发                                  │
│       │                                                         │
│       ▼                                                         │
│  CookieMonitor.cookieListener                                   │
│       │                                                         │
│       ├── enabled 检查                                          │
│       ├── 获取关联 Session                                       │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────┐                                                │
│  │  removed?   │                                                │
│  └─────────────┘                                                │
│       │                                                         │
│    是 │   否                                                    │
│       │    │                                                    │
│       ▼    ▼                                                    │
│  removeCookie  addCookie                                        │
│  FromSession   ToSession                                        │
│       │    │                                                    │
│       └────┴───► sessionManager.saveToStorage()                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 导航切换流程

```
┌─────────────────────────────────────────────────────────────────┐
│                     导航切换事件流                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  用户在 Tab 中导航到新页面                                        │
│       │                                                         │
│       ▼                                                         │
│  webNavigation.onBeforeNavigate 触发                            │
│       │                                                         │
│       ▼                                                         │
│  获取 Tab 绑定的 Session                                         │
│       │                                                         │
│       ▼                                                         │
│  needsCookieSwitch() 判断                                       │
│       │                                                         │
│    是 │   否                                                    │
│       │    │                                                    │
│       ▼    └──► 结束                                            │
│  autoSwitchCookies()                                            │
│       │                                                         │
│       ├── preserveCurrentState() 保存当前状态                    │
│       └── applySessionCookies() 应用 Session Cookie              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 配置项

```javascript
enabled: true  // 是否启用自动监控
```

可通过 `setEnabled()` 方法动态控制：

```javascript
setEnabled(enabled) {
  this.enabled = enabled;
}
```

## 销毁处理

```javascript
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
```

## 与其他模块的关系

```
CookieMonitor
  ├── 依赖 SessionManager 进行 Session 操作
  ├── 依赖 DomainMatcher 进行域名匹配
  └── 被 SessionManager 初始化和管理
```

## 注意事项

1. **性能考量**: Cookie 变化频繁时，`saveToStorage()` 可能被频繁调用，建议配合防抖机制
2. **并发问题**: 多个 Tab 同时触发 Cookie 变化时，需注意状态一致性
3. **隐私模式**: 隐私窗口的 Cookie 不受扩展管理
