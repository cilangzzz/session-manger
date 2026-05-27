# 标签页级别 Session/Cookie 隔离方案详解

本文档深入探讨如何实现类似 SessionBox 的标签页级别会话隔离功能，包括完整的技术实现和代码架构。

---

## 目录

1. [chrome.webRequest API 详解](#1-chromewebrequest-api-详解)
2. [onBeforeSendHeaders 与 onHeadersReceived 用法](#2-onbeforesendheaders-与-onheadersreceived-用法)
3. [为每个标签页注入不同的 Cookie](#3-为每个标签页注入不同的-cookie)
4. [Tab Session 的存储和管理](#4-tab-session-的存储和管理)
5. [标签页创建时绑定 session 的实现](#5-标签页创建时绑定-session-的实现)
6. [处理 Cookie 同步、过期更新的机制](#6-处理-cookie-同步过期更新的机制)
7. [处理 HTTPS 和安全策略限制](#7-处理-https-和安全策略限制)
8. [chrome.tabs API 与 session 管理的结合](#8-chrometabs-api-与-session-管理的结合)
9. [完整的 TabSessionManager 实现](#9-完整的-tabsessionmanager-实现)
10. [SessionBox 类产品的技术原理分析](#10-sessionbox-类产品的技术原理分析)

---

## 1. chrome.webRequest API 详解

### 1.1 API 概述

`chrome.webRequest` API 允许扩展观察和分析 HTTP 请求，并在请求发送前或响应接收后进行拦截、修改或阻止。这是实现标签页级别会话隔离的核心 API。

### 1.2 权限配置

```json
// manifest.json
{
  "manifest_version": 3,
  "permissions": [
    "webRequest",
    "webRequestAuthProvider"
  ],
  "host_permissions": [
    "<all_urls>"
  ]
}
```

**注意**：在 Manifest V3 中，`webRequest` API 的阻塞模式仅对特定企业策略部署的扩展可用。对于普通扩展，建议使用 `declarativeNetRequest` API 或结合其他方案。

### 1.3 请求生命周期事件

```
请求发起 → onBeforeRequest → onBeforeSendHeaders → 发送请求
    ↓
接收响应 → onHeadersReceived → onResponseStarted → onCompleted
    ↓
(出错时) → onErrorOccurred
```

### 1.4 核心事件列表

| 事件 | 触发时机 | 可修改内容 | 用途 |
|------|----------|------------|------|
| `onBeforeRequest` | 请求即将发送 | 请求 URL、请求体、取消请求 | 重定向、阻止请求 |
| `onBeforeSendHeaders` | 发送请求头之前 | 请求头（包括 Cookie） | 注入 Cookie、修改 Headers |
| `onSendHeaders` | 请求头发送后 | 无（只读） | 日志记录 |
| `onHeadersReceived` | 接收响应头时 | 响应头、重定向 | 拦截 Set-Cookie |
| `onAuthRequired` | 需要认证时 | 认证凭据 | 自动登录 |
| `onResponseStarted` | 响应开始接收 | 无（只读） | 监控响应 |
| `onBeforeRedirect` | 重定向前 | 无（只读） | 跟踪重定向 |
| `onCompleted` | 请求完成 | 无（只读） | 清理资源 |
| `onErrorOccurred` | 请求出错 | 无（只读） | 错误处理 |

### 1.5 过滤器配置

```javascript
// 过滤特定 URL 和资源类型
const filter = {
  urls: ['https://*.example.com/*', '*://api.example.org/*'],
  types: ['main_frame', 'sub_frame', 'xmlhttprequest', 'image', 'script', 'stylesheet']
};

// 可用的资源类型
const resourceTypes = [
  'main_frame',      // 主文档
  'sub_frame',       // iframe
  'stylesheet',      // CSS
  'script',          // JavaScript
  'image',           // 图片
  'font',            // 字体
  'object',          // 插件对象
  'xmlhttprequest',  // XHR/Fetch
  'ping',            // ping 链接
  'media',           // 音视频
  'websocket',       // WebSocket
  'other'            // 其他
];
```

### 1.6 监听器注册示例

```javascript
// 基本监听器注册
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    console.log('Request to:', details.url);
    console.log('Tab ID:', details.tabId);
    console.log('Request Headers:', details.requestHeaders);
    return { requestHeaders: details.requestHeaders };
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders', 'extraHeaders']  // extraHeaders 用于获取 Cookie 等敏感头
);

// 移除监听器
chrome.webRequest.onBeforeSendHeaders.removeListener(callback);
```

### 1.7 details 对象结构

```javascript
// onBeforeSendHeaders 的 details 对象
{
  requestId: '12345',           // 请求唯一标识
  url: 'https://example.com/',  // 请求 URL
  method: 'GET',                // HTTP 方法
  tabId: 123,                   // 标签页 ID（-1 表示非标签页请求）
  type: 'main_frame',           // 资源类型
  frameId: 0,                   // 帧 ID（0 为主帧）
  parentFrameId: -1,            // 父帧 ID
  incognito: false,             // 是否隐私模式
  cookieStoreId: '0',           // Cookie 存储 ID
  originUrl: 'https://...',     // 请求来源 URL
  documentUrl: 'https://...',   // 文档 URL
  requestHeaders: [             // 请求头数组
    { name: 'User-Agent', value: '...' },
    { name: 'Cookie', value: 'session=abc123' }
  ],
  thirdParty: false,            // 是否第三方请求
  urlClassification: {},        // URL 分类信息
  timeStamp: 1234567890.123     // 时间戳
}
```

---

## 2. onBeforeSendHeaders 与 onHeadersReceived 用法

### 2.1 onBeforeSendHeaders - 修改请求头

此事件在请求头发送前触发，是注入 Cookie 的关键时机。

```javascript
// 修改请求头示例
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const headers = details.requestHeaders || [];

    // 移除原有的 Cookie 头
    const filteredHeaders = headers.filter(
      header => header.name.toLowerCase() !== 'cookie'
    );

    // 添加新的 Cookie 头
    filteredHeaders.push({
      name: 'Cookie',
      value: 'session_id=my_custom_session; user_id=user123'
    });

    // 也可以添加其他自定义头
    filteredHeaders.push({
      name: 'X-Session-Id',
      value: 'custom-session-123'
    });

    return { requestHeaders: filteredHeaders };
  },
  { urls: ['https://*.example.com/*'] },
  ['requestHeaders', 'extraHeaders', 'blocking']  // blocking 允许修改
);
```

### 2.2 onHeadersReceived - 拦截响应头

此事件在接收到响应头时触发，用于拦截服务器设置的 Cookie。

```javascript
// 拦截响应头中的 Set-Cookie
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const headers = details.responseHeaders || [];

    // 提取所有 Set-Cookie 头
    const setCookies = headers.filter(
      header => header.name.toLowerCase() === 'set-cookie'
    );

    if (setCookies.length > 0) {
      console.log('Server setting cookies:', setCookies);

      // 可以移除 Set-Cookie 头，阻止浏览器自动设置
      // const filteredHeaders = headers.filter(
      //   header => header.name.toLowerCase() !== 'set-cookie'
      // );
      // return { responseHeaders: filteredHeaders };

      // 或者修改 Set-Cookie 头
      // 例如移除 HttpOnly 标记（不推荐，仅作演示）
    }

    return { responseHeaders: headers };
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders', 'blocking']
);
```

### 2.3 处理多个 Set-Cookie 头

HTTP 规范允许多个 Set-Cookie 头，需要特殊处理：

```javascript
// 正确处理多个 Set-Cookie
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const headers = details.responseHeaders || [];
    const cookies = [];

    // 收集所有 Set-Cookie
    for (const header of headers) {
      if (header.name.toLowerCase() === 'set-cookie') {
        cookies.push(header.value);
      }
    }

    if (cookies.length > 0) {
      // 解析 Cookie
      const parsedCookies = cookies.map(cookieStr => parseSetCookie(cookieStr));

      // 存储到对应标签页的 session
      tabSessionManager.storeResponseCookies(
        details.tabId,
        details.url,
        parsedCookies
      );
    }

    return { responseHeaders: headers };
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders', 'blocking']
);

// 解析 Set-Cookie 字符串
function parseSetCookie(cookieStr) {
  const parts = cookieStr.split(';').map(p => p.trim());
  const [nameValue, ...attributes] = parts;
  const [name, value] = nameValue.split('=');

  const cookie = { name, value };

  for (const attr of attributes) {
    const [key, val] = attr.split('=');
    const keyLower = key.toLowerCase();

    switch (keyLower) {
      case 'domain':
        cookie.domain = val;
        break;
      case 'path':
        cookie.path = val;
        break;
      case 'expires':
        cookie.expirationDate = new Date(val).getTime() / 1000;
        break;
      case 'max-age':
        cookie.expirationDate = Date.now() / 1000 + parseInt(val);
        break;
      case 'secure':
        cookie.secure = true;
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'samesite':
        cookie.sameSite = val;
        break;
    }
  }

  return cookie;
}
```

### 2.4 Manifest V3 限制与解决方案

在 Manifest V3 中，`webRequest` 的阻塞模式受限：

```javascript
// Manifest V3 推荐使用 declarativeNetRequest
// 但对于动态 Cookie 注入，仍需 webRequest

// 方案一：企业策略部署
// 通过 ExtensionInstallForcelist 策略部署的扩展可使用阻塞模式

// 方案二：使用 declarativeNetRequest 的动态规则
chrome.declarativeNetRequest.updateDynamicRules({
  addRules: [{
    id: 1,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{
        header: 'Cookie',
        operation: 'set',
        value: 'session=custom_value'
      }]
    },
    condition: {
      urlFilter: '*://example.com/*',
      resourceTypes: ['main_frame', 'xmlhttprequest']
    }
  }]
});

// 方案三：结合 chrome.cookies API
// 先清除浏览器 Cookie，再通过 webRequest 注入
```

---

## 3. 为每个标签页注入不同的 Cookie

### 3.1 核心实现思路

```
┌─────────────────────────────────────────────────────────────┐
│                      请求流程                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Tab A (Session 1)    Tab B (Session 2)    Tab C (Default)  │
│       │                    │                    │           │
│       ▼                    ▼                    ▼           │
│  ┌─────────┐          ┌─────────┐          ┌─────────┐     │
│  │ Request │          │ Request │          │ Request │     │
│  └────┬────┘          └────┬────┘          └────┬────┘     │
│       │                    │                    │           │
│       ▼                    ▼                    ▼           │
│  ┌──────────────────────────────────────────────────┐      │
│  │         onBeforeSendHeaders 拦截                  │      │
│  │  根据 tabId 查找对应的 Session，注入 Cookie       │      │
│  └──────────────────────────────────────────────────┘      │
│       │                    │                    │           │
│       ▼                    ▼                    ▼           │
│  Cookie: S1           Cookie: S2           Cookie: 默认     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Tab-Session 映射管理

```javascript
// tab-session-manager.js

class TabSessionMapper {
  constructor() {
    // tabId -> sessionId 映射
    this.tabSessionMap = new Map();

    // sessionId -> cookie 数据 映射
    this.sessionCookieJar = new Map();

    // 默认 session
    this.defaultSessionId = 'default';
  }

  // 为标签页绑定 session
  bindSession(tabId, sessionId) {
    this.tabSessionMap.set(tabId, sessionId);
    console.log(`Tab ${tabId} bound to session ${sessionId}`);
  }

  // 解除绑定
  unbindSession(tabId) {
    this.tabSessionMap.delete(tabId);
  }

  // 获取标签页的 session
  getSession(tabId) {
    return this.tabSessionMap.get(tabId) || this.defaultSessionId;
  }

  // 获取 session 的 cookies
  getSessionCookies(sessionId, domain) {
    const session = this.sessionCookieJar.get(sessionId);
    if (!session) return [];

    if (domain) {
      return session.cookies.filter(c =>
        c.domain === domain || c.domain === '.' + domain
      );
    }

    return session.cookies;
  }

  // 更新 session cookies
  updateSessionCookies(sessionId, cookies) {
    const session = this.sessionCookieJar.get(sessionId) || { cookies: [] };

    for (const newCookie of cookies) {
      // 更新或添加 cookie
      const existingIndex = session.cookies.findIndex(
        c => c.name === newCookie.name && c.domain === newCookie.domain
      );

      if (existingIndex >= 0) {
        session.cookies[existingIndex] = newCookie;
      } else {
        session.cookies.push(newCookie);
      }
    }

    this.sessionCookieJar.set(sessionId, session);
  }

  // 创建新 session
  createSession(sessionId, options = {}) {
    this.sessionCookieJar.set(sessionId, {
      id: sessionId,
      cookies: [],
      createdAt: Date.now(),
      ...options
    });
  }

  // 删除 session
  deleteSession(sessionId) {
    // 移除所有使用此 session 的标签页绑定
    for (const [tabId, sid] of this.tabSessionMap) {
      if (sid === sessionId) {
        this.tabSessionMap.set(tabId, this.defaultSessionId);
      }
    }

    this.sessionCookieJar.delete(sessionId);
  }

  // 导出 session 数据（用于持久化）
  exportSession(sessionId) {
    return this.sessionCookieJar.get(sessionId);
  }

  // 导入 session 数据
  importSession(sessionId, data) {
    this.sessionCookieJar.set(sessionId, data);
  }
}
```

### 3.3 Cookie 注入实现

```javascript
// cookie-injector.js

class CookieInjector {
  constructor(tabSessionMapper) {
    this.mapper = tabSessionMapper;
    this.registeredListeners = new Set();
  }

  // 启动拦截
  start() {
    // 拦截请求头
    chrome.webRequest.onBeforeSendHeaders.addListener(
      this.onBeforeSendHeaders.bind(this),
      { urls: ['<all_urls>'] },
      ['requestHeaders', 'extraHeaders', 'blocking']
    );
    this.registeredListeners.add('onBeforeSendHeaders');

    // 拦截响应头
    chrome.webRequest.onHeadersReceived.addListener(
      this.onHeadersReceived.bind(this),
      { urls: ['<all_urls>'] },
      ['responseHeaders', 'extraHeaders', 'blocking']
    );
    this.registeredListeners.add('onHeadersReceived');
  }

  // 停止拦截
  stop() {
    if (this.registeredListeners.has('onBeforeSendHeaders')) {
      chrome.webRequest.onBeforeSendHeaders.removeListener(
        this.onBeforeSendHeaders.bind(this)
      );
    }
    if (this.registeredListeners.has('onHeadersReceived')) {
      chrome.webRequest.onHeadersReceived.removeListener(
        this.onHeadersReceived.bind(this)
      );
    }
    this.registeredListeners.clear();
  }

  // 请求头拦截 - 注入 Cookie
  onBeforeSendHeaders(details) {
    // 忽略非标签页请求（如扩展自身请求）
    if (details.tabId < 0) {
      return {};
    }

    // 获取 URL 的域名
    const url = new URL(details.url);
    const domain = url.hostname;

    // 获取此标签页的 session
    const sessionId = this.mapper.getSession(details.tabId);

    // 如果是默认 session，不干预
    if (sessionId === 'default') {
      return {};
    }

    // 获取该 session 对应此域名的 cookies
    const cookies = this.mapper.getSessionCookies(sessionId, domain);

    if (cookies.length === 0) {
      return {};
    }

    // 构建新的请求头
    const headers = details.requestHeaders || [];

    // 移除原有的 Cookie 头
    const filteredHeaders = headers.filter(
      h => h.name.toLowerCase() !== 'cookie'
    );

    // 构建新的 Cookie 字符串
    const cookieString = cookies
      .filter(c => this.isCookieValidForUrl(c, url))
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    if (cookieString) {
      filteredHeaders.push({
        name: 'Cookie',
        value: cookieString
      });
    }

    return { requestHeaders: filteredHeaders };
  }

  // 响应头拦截 - 保存 Set-Cookie
  onHeadersReceived(details) {
    if (details.tabId < 0) {
      return {};
    }

    const headers = details.responseHeaders || [];
    const setCookies = headers.filter(
      h => h.name.toLowerCase() === 'set-cookie'
    );

    if (setCookies.length === 0) {
      return {};
    }

    // 获取此标签页的 session
    const sessionId = this.mapper.getSession(details.tabId);

    if (sessionId === 'default') {
      // 默认 session，让浏览器正常处理
      return {};
    }

    // 解析并存储 cookies
    const parsedCookies = setCookies.map(c => this.parseSetCookie(c.value, details.url));

    // 更新 session 的 cookie jar
    this.mapper.updateSessionCookies(sessionId, parsedCookies);

    // 移除 Set-Cookie 头，阻止浏览器自动设置
    const filteredHeaders = headers.filter(
      h => h.name.toLowerCase() !== 'set-cookie'
    );

    return { responseHeaders: filteredHeaders };
  }

  // 检查 cookie 是否适用于 URL
  isCookieValidForUrl(cookie, url) {
    // 检查 domain
    if (cookie.domain) {
      const cookieDomain = cookie.domain.startsWith('.')
        ? cookie.domain.slice(1)
        : cookie.domain;

      if (!url.hostname.endsWith(cookieDomain) &&
          url.hostname !== cookieDomain) {
        return false;
      }
    }

    // 检查 path
    if (cookie.path && !url.pathname.startsWith(cookie.path)) {
      return false;
    }

    // 检查 secure
    if (cookie.secure && url.protocol !== 'https:') {
      return false;
    }

    // 检查过期
    if (cookie.expirationDate && cookie.expirationDate * 1000 < Date.now()) {
      return false;
    }

    return true;
  }

  // 解析 Set-Cookie 头
  parseSetCookie(cookieStr, requestUrl) {
    const url = new URL(requestUrl);
    const parts = cookieStr.split(';').map(p => p.trim());
    const [nameValue, ...attributes] = parts;
    const [name, value] = nameValue.split('=');

    const cookie = {
      name,
      value: value || '',
      domain: url.hostname,
      path: '/',
      secure: url.protocol === 'https:',
      sameSite: 'Lax'
    };

    for (const attr of attributes) {
      const eqIndex = attr.indexOf('=');
      const key = eqIndex >= 0 ? attr.substring(0, eqIndex).toLowerCase() : attr.toLowerCase();
      const val = eqIndex >= 0 ? attr.substring(eqIndex + 1) : true;

      switch (key) {
        case 'domain':
          cookie.domain = val.startsWith('.') ? val : '.' + val;
          break;
        case 'path':
          cookie.path = val;
          break;
        case 'expires':
          const expiresDate = new Date(val);
          if (!isNaN(expiresDate.getTime())) {
            cookie.expirationDate = expiresDate.getTime() / 1000;
          }
          break;
        case 'max-age':
          const maxAge = parseInt(val);
          if (!isNaN(maxAge)) {
            cookie.expirationDate = Date.now() / 1000 + maxAge;
          }
          break;
        case 'secure':
          cookie.secure = true;
          break;
        case 'httponly':
          cookie.httpOnly = true;
          break;
        case 'samesite':
          cookie.sameSite = val;
          break;
      }
    }

    return cookie;
  }
}
```

### 3.4 处理子资源请求

子资源（图片、脚本、CSS 等）的请求也需要正确处理：

```javascript
// 处理子资源请求的 Cookie 注入
class SubResourceHandler {
  constructor(tabSessionMapper) {
    this.mapper = tabSessionMapper;
    this.frameSessionMap = new Map(); // frameId -> sessionId
  }

  // 处理 iframe 的 session 继承
  handleFrameNavigation(details) {
    if (details.type === 'sub_frame') {
      // iframe 继承父页面的 session
      const parentSession = this.mapper.getSession(details.tabId);
      this.frameSessionMap.set(
        `${details.tabId}_${details.frameId}`,
        parentSession
      );
    }
  }

  // 获取请求对应的 session
  getSessionForRequest(details) {
    // 主帧请求
    if (details.type === 'main_frame') {
      return this.mapper.getSession(details.tabId);
    }

    // 子帧请求
    if (details.type === 'sub_frame') {
      return this.frameSessionMap.get(
        `${details.tabId}_${details.parentFrameId}`
      ) || this.mapper.getSession(details.tabId);
    }

    // 子资源请求
    return this.frameSessionMap.get(
      `${details.tabId}_${details.frameId}`
    ) || this.mapper.getSession(details.tabId);
  }
}
```

---

## 4. Tab Session 的存储和管理

### 4.1 存储架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                     存储架构                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  chrome.storage.local (持久化)                              │
│  ├── sessions/                                              │
│  │   ├── session_1: { cookies, localStorage, ... }         │
│  │   ├── session_2: { cookies, localStorage, ... }         │
│  │   └── ...                                                │
│  ├── tabBindings/                                           │
│  │   ├── tab_123: session_1                                │
│  │   └── tab_456: session_2                                │
│  └── config/                                                │
│      ├── defaultSession: 'default'                         │
│      └── autoCleanup: true                                  │
│                                                             │
│  内存缓存 (运行时)                                          │
│  ├── tabSessionMap: Map<tabId, sessionId>                  │
│  ├── sessionCookieJar: Map<sessionId, Cookie[]>            │
│  └── sessionMetadata: Map<sessionId, Metadata>             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Session 数据结构

```javascript
// session-data-structure.js

// Session 完整数据结构
const SessionSchema = {
  id: 'session_123',           // 唯一标识
  name: 'Work Account',        // 显示名称
  color: '#FF5722',            // 标识颜色
  icon: 'work',                // 图标标识

  // Cookie 存储
  cookies: {
    '.example.com': [
      {
        name: 'session_id',
        value: 'abc123',
        domain: '.example.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
        expirationDate: 1234567890
      }
    ]
  },

  // LocalStorage 数据（可选）
  localStorage: {
    'https://example.com': {
      'user_preferences': '{"theme":"dark"}',
      'cart_items': '[]'
    }
  },

  // SessionStorage 数据（可选）
  sessionStorage: {
    'https://example.com': {
      'temp_data': 'value'
    }
  },

  // 元数据
  metadata: {
    createdAt: 1234567890,
    updatedAt: 1234567890,
    lastUsedAt: 1234567890,
    domain: 'example.com',     // 主要关联域名
    tags: ['work', 'important']
  },

  // 代理配置（可选）
  proxy: {
    mode: 'fixed_servers',
    host: 'proxy.example.com',
    port: 8080,
    scheme: 'https'
  },

  // User-Agent 配置（可选）
  userAgent: 'Mozilla/5.0 ...'
};
```

### 4.3 存储管理器实现

```javascript
// session-storage-manager.js

class SessionStorageManager {
  constructor() {
    this.STORAGE_KEY = 'tab_session_data';
    this.memoryCache = {
      sessions: new Map(),
      tabBindings: new Map()
    };
    this.initialized = false;
  }

  // 初始化 - 从持久化存储加载数据
  async initialize() {
    if (this.initialized) return;

    try {
      const data = await chrome.storage.local.get(this.STORAGE_KEY);

      if (data[this.STORAGE_KEY]) {
        const { sessions, tabBindings } = data[this.STORAGE_KEY];

        // 加载 sessions 到内存
        if (sessions) {
          for (const [id, session] of Object.entries(sessions)) {
            this.memoryCache.sessions.set(id, session);
          }
        }

        // 加载 tab bindings
        if (tabBindings) {
          for (const [tabId, sessionId] of Object.entries(tabBindings)) {
            this.memoryCache.tabBindings.set(parseInt(tabId), sessionId);
          }
        }
      }

      this.initialized = true;
      console.log('SessionStorageManager initialized');
    } catch (error) {
      console.error('Failed to initialize SessionStorageManager:', error);
      throw error;
    }
  }

  // 持久化数据
  async persist() {
    const data = {
      sessions: Object.fromEntries(this.memoryCache.sessions),
      tabBindings: Object.fromEntries(
        Array.from(this.memoryCache.tabBindings.entries())
          .map(([k, v]) => [k.toString(), v])
      )
    };

    await chrome.storage.local.set({
      [this.STORAGE_KEY]: data
    });
  }

  // 创建新 session
  async createSession(options = {}) {
    const sessionId = options.id || this.generateSessionId();

    const session = {
      id: sessionId,
      name: options.name || `Session ${this.memoryCache.sessions.size + 1}`,
      color: options.color || this.getRandomColor(),
      icon: options.icon || 'default',
      cookies: {},
      localStorage: {},
      sessionStorage: {},
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastUsedAt: Date.now(),
        domain: options.domain || null,
        tags: options.tags || []
      },
      proxy: options.proxy || null,
      userAgent: options.userAgent || null
    };

    this.memoryCache.sessions.set(sessionId, session);
    await this.persist();

    return session;
  }

  // 获取 session
  getSession(sessionId) {
    return this.memoryCache.sessions.get(sessionId);
  }

  // 获取所有 sessions
  getAllSessions() {
    return Array.from(this.memoryCache.sessions.values());
  }

  // 更新 session
  async updateSession(sessionId, updates) {
    const session = this.memoryCache.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    Object.assign(session, updates, {
      metadata: {
        ...session.metadata,
        updatedAt: Date.now()
      }
    });

    this.memoryCache.sessions.set(sessionId, session);
    await this.persist();

    return session;
  }

  // 删除 session
  async deleteSession(sessionId) {
    // 解绑所有使用此 session 的标签页
    for (const [tabId, sid] of this.memoryCache.tabBindings) {
      if (sid === sessionId) {
        this.memoryCache.tabBindings.delete(tabId);
      }
    }

    this.memoryCache.sessions.delete(sessionId);
    await this.persist();
  }

  // 绑定标签页到 session
  async bindTabToSession(tabId, sessionId) {
    if (!this.memoryCache.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} not found`);
    }

    this.memoryCache.tabBindings.set(tabId, sessionId);

    // 更新 lastUsedAt
    const session = this.memoryCache.sessions.get(sessionId);
    session.metadata.lastUsedAt = Date.now();

    await this.persist();
  }

  // 解绑标签页
  async unbindTab(tabId) {
    this.memoryCache.tabBindings.delete(tabId);
    await this.persist();
  }

  // 获取标签页的 session
  getTabSession(tabId) {
    const sessionId = this.memoryCache.tabBindings.get(tabId);
    if (sessionId) {
      return this.memoryCache.sessions.get(sessionId);
    }
    return null;
  }

  // 获取标签页的 sessionId
  getTabSessionId(tabId) {
    return this.memoryCache.tabBindings.get(tabId) || 'default';
  }

  // 更新 session cookies
  async updateSessionCookies(sessionId, domain, cookies) {
    const session = this.memoryCache.sessions.get(sessionId);
    if (!session) return;

    if (!session.cookies[domain]) {
      session.cookies[domain] = [];
    }

    // 合并 cookies
    for (const newCookie of cookies) {
      const existingIndex = session.cookies[domain].findIndex(
        c => c.name === newCookie.name
      );

      if (existingIndex >= 0) {
        // 检查是否需要删除（过期）
        if (newCookie.expirationDate && newCookie.expirationDate * 1000 < Date.now()) {
          session.cookies[domain].splice(existingIndex, 1);
        } else {
          session.cookies[domain][existingIndex] = newCookie;
        }
      } else if (!newCookie.expirationDate || newCookie.expirationDate * 1000 >= Date.now()) {
        session.cookies[domain].push(newCookie);
      }
    }

    session.metadata.updatedAt = Date.now();
    await this.persist();
  }

  // 获取 session 的 cookies
  getSessionCookies(sessionId, domain = null) {
    const session = this.memoryCache.sessions.get(sessionId);
    if (!session) return [];

    if (domain) {
      return session.cookies[domain] || [];
    }

    // 返回所有 cookies
    return Object.values(session.cookies).flat();
  }

  // 生成 session ID
  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // 获取随机颜色
  getRandomColor() {
    const colors = [
      '#FF5722', '#E91E63', '#9C27B0', '#673AB7',
      '#3F51B5', '#2196F3', '#03A9F4', '#00BCD4',
      '#009688', '#4CAF50', '#8BC34A', '#CDDC39',
      '#FFC107', '#FF9800', '#FF5722', '#795548'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // 导出 session（用于备份）
  exportSession(sessionId) {
    const session = this.memoryCache.sessions.get(sessionId);
    if (!session) return null;

    return JSON.parse(JSON.stringify(session));
  }

  // 导入 session
  async importSession(sessionData) {
    const sessionId = sessionData.id || this.generateSessionId();
    sessionData.id = sessionId;

    this.memoryCache.sessions.set(sessionId, sessionData);
    await this.persist();

    return sessionId;
  }

  // 清理过期数据
  async cleanup() {
    const now = Date.now();
    const expiredThreshold = 30 * 24 * 60 * 60 * 1000; // 30 天未使用

    for (const [sessionId, session] of this.memoryCache.sessions) {
      // 清理过期的 cookies
      for (const domain of Object.keys(session.cookies)) {
        session.cookies[domain] = session.cookies[domain].filter(
          cookie => !cookie.expirationDate || cookie.expirationDate * 1000 >= now
        );
      }

      // 可选：删除长期未使用的 session
      // if (session.metadata.lastUsedAt < now - expiredThreshold) {
      //   await this.deleteSession(sessionId);
      // }
    }

    await this.persist();
  }
}
```

### 4.4 IndexedDB 存储方案（大数据量）

对于需要存储大量 session 数据的情况，可以使用 IndexedDB：

```javascript
// indexeddb-session-storage.js

class IndexedDBSessionStorage {
  constructor() {
    this.dbName = 'TabSessionDB';
    this.dbVersion = 1;
    this.db = null;
  }

  // 初始化数据库
  async initialize() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Sessions 存储
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('name', 'name', { unique: false });
          sessionStore.createIndex('lastUsedAt', 'metadata.lastUsedAt', { unique: false });
        }

        // Tab bindings 存储
        if (!db.objectStoreNames.contains('tabBindings')) {
          const bindingStore = db.createObjectStore('tabBindings', { keyPath: 'tabId' });
          bindingStore.createIndex('sessionId', 'sessionId', { unique: false });
        }

        // Cookies 存储（按域名索引）
        if (!db.objectStoreNames.contains('cookies')) {
          const cookieStore = db.createObjectStore('cookies', { keyPath: ['sessionId', 'domain', 'name'] });
          cookieStore.createIndex('sessionId', 'sessionId', { unique: false });
          cookieStore.createIndex('domain', 'domain', { unique: false });
        }
      };
    });
  }

  // 保存 session
  async saveSession(session) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.put(session);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // 获取 session
  async getSession(sessionId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.get(sessionId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // 获取所有 sessions
  async getAllSessions() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // 删除 session
  async deleteSession(sessionId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions', 'cookies', 'tabBindings'], 'readwrite');

      // 删除 session
      transaction.objectStore('sessions').delete(sessionId);

      // 删除相关 cookies
      const cookieStore = transaction.objectStore('cookies');
      const cookieIndex = cookieStore.index('sessionId');
      const cookieRequest = cookieIndex.openCursor(IDBKeyRange.only(sessionId));

      cookieRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      // 删除相关 tab bindings
      const bindingStore = transaction.objectStore('tabBindings');
      const bindingIndex = bindingStore.index('sessionId');
      const bindingRequest = bindingIndex.openCursor(IDBKeyRange.only(sessionId));

      bindingRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}
```

---

## 5. 标签页创建时绑定 session 的实现

### 5.1 标签页生命周期事件

```javascript
// tab-lifecycle-handler.js

class TabLifecycleHandler {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.pendingCreations = new Map(); // 待处理的标签页创建请求
  }

  // 初始化监听器
  initialize() {
    // 监听标签页创建
    chrome.tabs.onCreated.addListener(this.onTabCreated.bind(this));

    // 监听标签页更新
    chrome.tabs.onUpdated.addListener(this.onTabUpdated.bind(this));

    // 监听标签页移除
    chrome.tabs.onRemoved.addListener(this.onTabRemoved.bind(this));

    // 监听标签页替换（如预渲染）
    chrome.tabs.onReplaced.addListener(this.onTabReplaced.bind(this));

    // 监听标签页附加/分离（拖拽到其他窗口）
    chrome.tabs.onAttached.addListener(this.onTabAttached.bind(this));
    chrome.tabs.onDetached.addListener(this.onTabDetached.bind(this));
  }

  // 标签页创建
  async onTabCreated(tab) {
    console.log('Tab created:', tab.id, tab.url);

    // 检查是否有待处理的创建请求
    const pending = this.pendingCreations.get(tab.id);
    if (pending) {
      // 使用指定的 session
      await this.sessionManager.bindTabToSession(tab.id, pending.sessionId);
      this.pendingCreations.delete(tab.id);
      return;
    }

    // 检查是否从现有标签页打开（如中键点击、链接打开）
    if (tab.openerTabId) {
      // 继承 opener 的 session
      const parentSessionId = this.sessionManager.getTabSessionId(tab.openerTabId);
      if (parentSessionId && parentSessionId !== 'default') {
        await this.sessionManager.bindTabToSession(tab.id, parentSessionId);
        console.log(`Tab ${tab.id} inherited session from opener ${tab.openerTabId}`);
      }
    }
  }

  // 标签页更新
  async onTabUpdated(tabId, changeInfo, tab) {
    // 当 URL 变化时，可能需要更新 session
    if (changeInfo.url) {
      console.log(`Tab ${tabId} URL changed to:`, changeInfo.url);

      // 可以根据 URL 自动分配 session
      // const sessionId = await this.sessionManager.matchSessionForUrl(changeInfo.url);
      // if (sessionId) {
      //   await this.sessionManager.bindTabToSession(tabId, sessionId);
      // }
    }

    // 当标签页完成加载
    if (changeInfo.status === 'complete') {
      console.log(`Tab ${tabId} loading complete`);
      // 可以在这里注入 content script 或执行其他操作
    }
  }

  // 标签页移除
  async onTabRemoved(tabId, removeInfo) {
    console.log('Tab removed:', tabId);

    // 解绑 session
    await this.sessionManager.unbindTab(tabId);
  }

  // 标签页替换
  async onTabReplaced(addedTabId, removedTabId) {
    console.log(`Tab replaced: ${removedTabId} -> ${addedTabId}`);

    // 将旧标签页的 session 绑定转移到新标签页
    const sessionId = this.sessionManager.getTabSessionId(removedTabId);
    if (sessionId) {
      await this.sessionManager.unbindTab(removedTabId);
      await this.sessionManager.bindTabToSession(addedTabId, sessionId);
    }
  }

  // 标签页附加
  async onTabAttached(tabId, attachInfo) {
    console.log(`Tab ${tabId} attached to window ${attachInfo.newWindowId}`);
    // session 绑定保持不变
  }

  // 标签页分离
  async onTabDetached(tabId, detachInfo) {
    console.log(`Tab ${tabId} detached from window ${detachInfo.oldWindowId}`);
    // session 绑定保持不变
  }

  // 创建带 session 的标签页
  async createTabWithSession(options) {
    const { url, sessionId, ...tabOptions } = options;

    // 创建标签页
    const tab = await chrome.tabs.create({
      url: url || 'about:blank',
      ...tabOptions
    });

    // 绑定 session
    if (sessionId) {
      await this.sessionManager.bindTabToSession(tab.id, sessionId);
    }

    return tab;
  }

  // 预注册标签页创建（用于处理创建时 URL 已知的情况）
  preRegisterCreation(sessionId, url) {
    // 生成临时 ID 用于匹配
    const tempId = `temp_${Date.now()}_${Math.random()}`;

    // 由于无法预知 tabId，需要通过 URL 匹配
    // 这在 onCreated 中处理
    return tempId;
  }
}
```

### 5.2 用户界面集成

```javascript
// popup-session-ui.js

class SessionUI {
  constructor(sessionManager, tabLifecycle) {
    this.sessionManager = sessionManager;
    this.tabLifecycle = tabLifecycle;
  }

  // 渲染 session 列表
  async renderSessionList(container) {
    const sessions = this.sessionManager.getAllSessions();
    const currentTab = await this.getCurrentTab();
    const currentSessionId = currentTab
      ? this.sessionManager.getTabSessionId(currentTab.id)
      : 'default';

    container.innerHTML = '';

    // 默认 session 选项
    container.appendChild(this.createSessionElement({
      id: 'default',
      name: 'Default Session',
      color: '#808080',
      icon: 'public'
    }, currentSessionId === 'default'));

    // 用户创建的 sessions
    for (const session of sessions) {
      container.appendChild(this.createSessionElement(session, currentSessionId === session.id));
    }

    // 创建新 session 按钮
    const createBtn = document.createElement('button');
    createBtn.className = 'create-session-btn';
    createBtn.textContent = '+ New Session';
    createBtn.onclick = () => this.showCreateSessionDialog();
    container.appendChild(createBtn);
  }

  // 创建 session 元素
  createSessionElement(session, isActive) {
    const element = document.createElement('div');
    element.className = `session-item ${isActive ? 'active' : ''}`;
    element.style.borderLeftColor = session.color;

    element.innerHTML = `
      <div class="session-icon" style="background-color: ${session.color}">
        ${this.getSessionIcon(session.icon)}
      </div>
      <div class="session-info">
        <div class="session-name">${session.name}</div>
        <div class="session-meta">${this.getSessionMeta(session)}</div>
      </div>
      <div class="session-actions">
        <button class="action-btn open-btn" title="Open in this session">
          <svg>...</svg>
        </button>
        <button class="action-btn edit-btn" title="Edit session">
          <svg>...</svg>
        </button>
        <button class="action-btn delete-btn" title="Delete session">
          <svg>...</svg>
        </button>
      </div>
    `;

    // 点击切换当前标签页的 session
    element.querySelector('.session-info').onclick = async () => {
      await this.switchCurrentTabSession(session.id);
    };

    // 在此 session 中打开新标签页
    element.querySelector('.open-btn').onclick = async () => {
      await this.openNewTabInSession(session.id);
    };

    // 编辑 session
    element.querySelector('.edit-btn').onclick = () => {
      this.showEditSessionDialog(session);
    };

    // 删除 session
    element.querySelector('.delete-btn').onclick = async () => {
      if (confirm(`Delete session "${session.name}"?`)) {
        await this.sessionManager.deleteSession(session.id);
        this.renderSessionList(element.parentElement);
      }
    };

    return element;
  }

  // 切换当前标签页的 session
  async switchCurrentTabSession(sessionId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    if (sessionId === 'default') {
      await this.sessionManager.unbindTab(tab.id);
    } else {
      await this.sessionManager.bindTabToSession(tab.id, sessionId);
    }

    // 刷新页面以应用新 session
    await chrome.tabs.reload(tab.id);
  }

  // 在指定 session 中打开新标签页
  async openNewTabInSession(sessionId) {
    const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const newTab = await chrome.tabs.create({
      url: 'about:blank',
      index: currentTab ? currentTab.index + 1 : undefined
    });

    if (sessionId !== 'default') {
      await this.sessionManager.bindTabToSession(newTab.id, sessionId);
    }

    // 可以打开一个新标签页页面让用户输入 URL
    // 或者直接打开当前页面的 URL
    if (currentTab && currentTab.url) {
      await chrome.tabs.update(newTab.id, { url: currentTab.url });
    }
  }

  // 显示创建 session 对话框
  showCreateSessionDialog() {
    const dialog = document.createElement('dialog');
    dialog.className = 'create-session-dialog';
    dialog.innerHTML = `
      <h3>Create New Session</h3>
      <form id="create-session-form">
        <div class="form-group">
          <label for="session-name">Name</label>
          <input type="text" id="session-name" required placeholder="My Session">
        </div>
        <div class="form-group">
          <label for="session-color">Color</label>
          <input type="color" id="session-color" value="#FF5722">
        </div>
        <div class="form-group">
          <label for="session-icon">Icon</label>
          <select id="session-icon">
            <option value="default">Default</option>
            <option value="work">Work</option>
            <option value="personal">Personal</option>
            <option value="shopping">Shopping</option>
            <option value="social">Social</option>
            <option value="finance">Finance</option>
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="cancel-btn">Cancel</button>
          <button type="submit" class="create-btn">Create</button>
        </div>
      </form>
    `;

    document.body.appendChild(dialog);
    dialog.showModal();

    dialog.querySelector('.cancel-btn').onclick = () => {
      dialog.close();
      dialog.remove();
    };

    dialog.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();

      const name = dialog.querySelector('#session-name').value;
      const color = dialog.querySelector('#session-color').value;
      const icon = dialog.querySelector('#session-icon').value;

      await this.sessionManager.createSession({ name, color, icon });

      dialog.close();
      dialog.remove();

      // 刷新列表
      this.renderSessionList(document.querySelector('.session-list'));
    };
  }

  // 获取当前标签页
  async getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // 获取 session 图标 SVG
  getSessionIcon(iconName) {
    const icons = {
      default: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
      work: '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/></svg>',
      personal: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/></svg>',
      shopping: '<svg viewBox="0 0 24 24"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
      social: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      finance: '<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>'
    };
    return icons[iconName] || icons.default;
  }

  // 获取 session 元信息
  getSessionMeta(session) {
    const cookieCount = Object.values(session.cookies || {}).flat().length;
    const lastUsed = session.metadata?.lastUsedAt
      ? this.formatRelativeTime(session.metadata.lastUsedAt)
      : 'Never used';
    return `${cookieCount} cookies | ${lastUsed}`;
  }

  // 格式化相对时间
  formatRelativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }
}
```

### 5.3 右键菜单集成

```javascript
// context-menu-handler.js

class ContextMenuHandler {
  constructor(sessionManager, tabLifecycle) {
    this.sessionManager = sessionManager;
    this.tabLifecycle = tabLifecycle;
  }

  // 初始化右键菜单
  async initialize() {
    // 创建父菜单
    chrome.contextMenus.create({
      id: 'session-box',
      title: 'Session Box',
      contexts: ['page', 'link', 'tab']
    });

    // 创建子菜单项
    await this.updateSessionMenus();

    // 监听菜单点击
    chrome.contextMenus.onClicked.addListener(this.onMenuClicked.bind(this));

    // 监听 session 变化，更新菜单
    this.sessionManager.onSessionChange = () => this.updateSessionMenus();
  }

  // 更新 session 菜单项
  async updateSessionMenus() {
    // 移除旧的菜单项
    const existing = await chrome.contextMenus.getAll();
    for (const item of existing) {
      if (item.parentId === 'session-box') {
        chrome.contextMenus.remove(item.id);
      }
    }

    // 添加默认 session
    chrome.contextMenus.create({
      id: 'session_default',
      parentId: 'session-box',
      title: 'Default Session',
      contexts: ['page', 'link', 'tab']
    });

    // 添加用户 sessions
    const sessions = this.sessionManager.getAllSessions();
    for (const session of sessions) {
      chrome.contextMenus.create({
        id: `session_${session.id}`,
        parentId: 'session-box',
        title: session.name,
        contexts: ['page', 'link', 'tab']
      });
    }

    // 添加分隔线
    chrome.contextMenus.create({
      id: 'session_separator',
      parentId: 'session-box',
      type: 'separator',
      contexts: ['page', 'link', 'tab']
    });

    // 添加创建新 session 选项
    chrome.contextMenus.create({
      id: 'session_create_new',
      parentId: 'session-box',
      title: '+ Create New Session',
      contexts: ['page', 'link', 'tab']
    });
  }

  // 处理菜单点击
  async onMenuClicked(info, tab) {
    const menuItemId = info.menuItemId;

    if (menuItemId === 'session_create_new') {
      // 创建新 session
      const session = await this.sessionManager.createSession({
        name: `Session ${this.sessionManager.getAllSessions().length + 1}`
      });
      // 绑定当前标签页
      await this.sessionManager.bindTabToSession(tab.id, session.id);
      await chrome.tabs.reload(tab.id);
      return;
    }

    if (menuItemId.startsWith('session_')) {
      const sessionId = menuItemId.replace('session_', '');

      if (info.linkUrl) {
        // 在链接上点击，在新标签页中打开
        const newTab = await chrome.tabs.create({
          url: info.linkUrl,
          openerTabId: tab.id
        });

        if (sessionId !== 'default') {
          await this.sessionManager.bindTabToSession(newTab.id, sessionId);
        }
      } else {
        // 在页面上点击，切换当前标签页的 session
        if (sessionId === 'default') {
          await this.sessionManager.unbindTab(tab.id);
        } else {
          await this.sessionManager.bindTabToSession(tab.id, sessionId);
        }
        await chrome.tabs.reload(tab.id);
      }
    }
  }
}
```

---

## 6. 处理 Cookie 同步、过期更新的机制

### 6.1 Cookie 同步策略

```javascript
// cookie-sync-manager.js

class CookieSyncManager {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.syncQueue = [];
    this.isSyncing = false;
    this.syncInterval = null;
  }

  // 启动同步
  start() {
    // 监听浏览器 Cookie 变化
    chrome.cookies.onChanged.addListener(this.onCookieChanged.bind(this));

    // 定期同步（可选）
    this.syncInterval = setInterval(() => {
      this.syncAllSessions();
    }, 5 * 60 * 1000); // 每 5 分钟
  }

  // 停止同步
  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
  }

  // 处理 Cookie 变化事件
  async onCookieChanged(changeInfo) {
    const { cookie, removed, cause } = changeInfo;

    // 忽略默认 session 的变化
    // 因为我们只管理自定义 session 的 cookies

    // 如果变化是由我们的扩展引起的，忽略
    if (changeInfo.cause === 'overwrite' && this.isOurChange(cookie)) {
      return;
    }

    console.log('Cookie changed:', cookie.name, cookie.domain, removed ? 'removed' : 'set');

    // 将变化加入同步队列
    this.syncQueue.push({
      cookie,
      removed,
      cause,
      timestamp: Date.now()
    });

    // 处理队列
    this.processSyncQueue();
  }

  // 处理同步队列
  async processSyncQueue() {
    if (this.isSyncing || this.syncQueue.length === 0) {
      return;
    }

    this.isSyncing = true;

    try {
      while (this.syncQueue.length > 0) {
        const item = this.syncQueue.shift();
        await this.syncCookieChange(item);
      }
    } finally {
      this.isSyncing = false;
    }
  }

  // 同步单个 Cookie 变化
  async syncCookieChange(changeItem) {
    const { cookie, removed, cause } = changeItem;

    // 找出所有使用此域名的 sessions
    const sessions = this.sessionManager.getAllSessions();
    const domain = cookie.domain.startsWith('.')
      ? cookie.domain.slice(1)
      : cookie.domain;

    for (const session of sessions) {
      const sessionCookies = session.cookies[domain] || session.cookies[cookie.domain];

      if (sessionCookies) {
        const existingIndex = sessionCookies.findIndex(
          c => c.name === cookie.name
        );

        if (removed) {
          // 从 session 中移除
          if (existingIndex >= 0) {
            sessionCookies.splice(existingIndex, 1);
            await this.sessionManager.updateSession(session.id, session);
          }
        } else {
          // 更新或添加
          if (existingIndex >= 0) {
            sessionCookies[existingIndex] = this.cookieToSessionCookie(cookie);
          } else {
            if (!session.cookies[cookie.domain]) {
              session.cookies[cookie.domain] = [];
            }
            session.cookies[cookie.domain].push(this.cookieToSessionCookie(cookie));
          }
          await this.sessionManager.updateSession(session.id, session);
        }
      }
    }
  }

  // 同步所有 sessions
  async syncAllSessions() {
    const sessions = this.sessionManager.getAllSessions();

    for (const session of sessions) {
      await this.syncSessionWithBrowser(session.id);
    }
  }

  // 同步指定 session 与浏览器
  async syncSessionWithBrowser(sessionId) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    // 获取浏览器中所有 cookies
    const browserCookies = await chrome.cookies.getAll({});

    // 按域名分组
    const browserCookiesByDomain = {};
    for (const cookie of browserCookies) {
      const domain = cookie.domain;
      if (!browserCookiesByDomain[domain]) {
        browserCookiesByDomain[domain] = [];
      }
      browserCookiesByDomain[domain].push(cookie);
    }

    // 比较并更新 session cookies
    for (const domain of Object.keys(session.cookies)) {
      const sessionCookies = session.cookies[domain];
      const browserDomainCookies = browserCookiesByDomain[domain] || [];

      for (let i = sessionCookies.length - 1; i >= 0; i--) {
        const sessionCookie = sessionCookies[i];

        // 检查是否过期
        if (sessionCookie.expirationDate && sessionCookie.expirationDate * 1000 < Date.now()) {
          sessionCookies.splice(i, 1);
          continue;
        }

        // 检查浏览器中是否存在
        const browserCookie = browserDomainCookies.find(
          c => c.name === sessionCookie.name
        );

        if (browserCookie) {
          // 更新值
          sessionCookie.value = browserCookie.value;
          sessionCookie.expirationDate = browserCookie.expirationDate;
        }
      }
    }

    await this.sessionManager.updateSession(sessionId, session);
  }

  // 转换浏览器 Cookie 为 session Cookie 格式
  cookieToSessionCookie(cookie) {
    return {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite || 'Lax',
      expirationDate: cookie.expirationDate,
      hostOnly: cookie.hostOnly,
      sessionId: cookie.sessionId
    };
  }

  // 检查是否是我们的修改
  isOurChange(cookie) {
    // 可以通过添加特殊标记来识别
    // 例如在 cookie value 中添加前缀
    return false;
  }
}
```

### 6.2 Cookie 过期处理

```javascript
// cookie-expiration-handler.js

class CookieExpirationHandler {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.checkInterval = null;
  }

  // 启动定期检查
  start() {
    // 每分钟检查一次过期 cookies
    this.checkInterval = setInterval(() => {
      this.checkExpiredCookies();
    }, 60 * 1000);
  }

  // 停止检查
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }

  // 检查并清理过期 cookies
  async checkExpiredCookies() {
    const now = Date.now() / 1000;
    const sessions = this.sessionManager.getAllSessions();
    let hasChanges = false;

    for (const session of sessions) {
      for (const domain of Object.keys(session.cookies)) {
        const cookies = session.cookies[domain];
        const initialLength = cookies.length;

        // 过滤掉过期的 cookies
        session.cookies[domain] = cookies.filter(cookie => {
          if (cookie.expirationDate && cookie.expirationDate < now) {
            console.log(`Cookie ${cookie.name} for ${domain} expired`);
            return false;
          }
          return true;
        });

        if (session.cookies[domain].length !== initialLength) {
          hasChanges = true;
        }
      }

      if (hasChanges) {
        await this.sessionManager.updateSession(session.id, session);
      }
    }
  }

  // 获取即将过期的 cookies
  getExpiringCookies(sessionId, withinMinutes = 30) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return [];

    const threshold = Date.now() / 1000 + withinMinutes * 60;
    const expiringCookies = [];

    for (const [domain, cookies] of Object.entries(session.cookies)) {
      for (const cookie of cookies) {
        if (cookie.expirationDate && cookie.expirationDate < threshold) {
          expiringCookies.push({
            ...cookie,
            domain,
            expiresIn: Math.round((cookie.expirationDate - Date.now() / 1000) / 60)
          });
        }
      }
    }

    return expiringCookies.sort((a, b) => a.expirationDate - b.expirationDate);
  }

  // 刷新即将过期的 session
  async refreshSession(sessionId) {
    // 通知用户或尝试自动刷新
    const expiringCookies = this.getExpiringCookies(sessionId);

    if (expiringCookies.length > 0) {
      // 可以发送通知给用户
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Session Cookies Expiring',
        message: `${expiringCookies.length} cookies will expire soon. Click to refresh.`,
        buttons: [{ title: 'Refresh Now' }]
      });
    }
  }
}
```

### 6.3 Cookie 更新通知

```javascript
// cookie-notification-handler.js

class CookieNotificationHandler {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.notifiedCookies = new Set();
  }

  // 初始化
  initialize() {
    // 监听通知点击
    chrome.notifications.onClicked.addListener(this.onNotificationClicked.bind(this));
    chrome.notifications.onButtonClicked.addListener(this.onButtonClicked.bind(this));
  }

  // 发送 Cookie 更新通知
  async notifyCookieUpdate(sessionId, cookieName, domain, action) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    const notificationId = `cookie_${sessionId}_${cookieName}_${domain}`;

    // 避免重复通知
    if (this.notifiedCookies.has(notificationId)) return;
    this.notifiedCookies.add(notificationId);

    await chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `Session: ${session.name}`,
      message: `Cookie "${cookieName}" ${action} for ${domain}`,
      priority: 0,
      silent: true
    });

    // 5秒后清除通知记录
    setTimeout(() => {
      this.notifiedCookies.delete(notificationId);
    }, 5000);
  }

  // 发送登录状态变化通知
  async notifyLoginStatusChange(sessionId, isLoggedIn, siteName) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `Session: ${session.name}`,
      message: isLoggedIn
        ? `Logged in to ${siteName}`
        : `Logged out from ${siteName}`,
      priority: 1
    });
  }

  // 处理通知点击
  async onNotificationClicked(notificationId) {
    // 打开扩展 popup 或相关页面
    chrome.action.openPopup();
  }

  // 处理按钮点击
  async onButtonClicked(notificationId, buttonIndex) {
    if (notificationId.startsWith('cookie_')) {
      // 处理 cookie 相关通知的按钮点击
      if (buttonIndex === 0) {
        // "Refresh Now" 按钮
        // 执行刷新操作
      }
    }
  }
}
```

---

## 7. 处理 HTTPS 和安全策略限制

### 7.1 HTTPS Cookie 限制

```javascript
// https-cookie-handler.js

class HTTPSCookieHandler {
  constructor() {
    this.secureOrigins = new Set();
  }

  // 检查 URL 是否为安全源
  isSecureOrigin(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === 'https:' ||
             parsedUrl.hostname === 'localhost' ||
             parsedUrl.hostname === '127.0.0.1';
    } catch {
      return false;
    }
  }

  // 处理 Secure Cookie
  handleSecureCookie(cookie, requestUrl) {
    // Secure Cookie 只能通过 HTTPS 发送
    if (cookie.secure && !this.isSecureOrigin(requestUrl)) {
      console.warn(`Secure cookie ${cookie.name} cannot be sent over HTTP`);
      return false;
    }
    return true;
  }

  // 处理 SameSite 属性
  handleSameSiteCookie(cookie, requestUrl, isThirdParty) {
    const sameSite = cookie.sameSite?.toLowerCase() || 'lax';

    switch (sameSite) {
      case 'strict':
        // Strict: 完全禁止第三方请求发送
        if (isThirdParty) {
          return false;
        }
        break;

      case 'lax':
        // Lax: 允许顶级导航的 GET 请求
        if (isThirdParty && !this.isTopLevelNavigation(requestUrl)) {
          return false;
        }
        break;

      case 'none':
        // None: 允许第三方请求，但必须设置 Secure
        if (!cookie.secure) {
          console.warn(`SameSite=None cookie ${cookie.name} must have Secure attribute`);
          return false;
        }
        break;
    }

    return true;
  }

  // 检查是否为顶级导航
  isTopLevelNavigation(details) {
    return details.type === 'main_frame';
  }

  // 过滤可发送的 cookies
  filterValidCookies(cookies, requestUrl, isThirdParty) {
    return cookies.filter(cookie => {
      // 检查 Secure 属性
      if (!this.handleSecureCookie(cookie, requestUrl)) {
        return false;
      }

      // 检查 SameSite 属性
      if (!this.handleSameSiteCookie(cookie, requestUrl, isThirdParty)) {
        return false;
      }

      // 检查域名匹配
      if (!this.isCookieDomainMatch(cookie, requestUrl)) {
        return false;
      }

      // 检查路径匹配
      if (!this.isCookiePathMatch(cookie, requestUrl)) {
        return false;
      }

      // 检查是否过期
      if (cookie.expirationDate && cookie.expirationDate * 1000 < Date.now()) {
        return false;
      }

      return true;
    });
  }

  // 检查域名匹配
  isCookieDomainMatch(cookie, url) {
    try {
      const hostname = new URL(url).hostname;
      const cookieDomain = cookie.domain.startsWith('.')
        ? cookie.domain.slice(1)
        : cookie.domain;

      // 精确匹配或子域名匹配
      return hostname === cookieDomain || hostname.endsWith('.' + cookieDomain);
    } catch {
      return false;
    }
  }

  // 检查路径匹配
  isCookiePathMatch(cookie, url) {
    try {
      const pathname = new URL(url).pathname;
      const cookiePath = cookie.path || '/';

      // 路径必须以 cookie.path 开头
      return pathname === cookiePath || pathname.startsWith(cookiePath + '/');
    } catch {
      return false;
    }
  }
}
```

### 7.2 处理 CORS 和预检请求

```javascript
// cors-handler.js

class CORSHandler {
  constructor() {
    this.preflightCache = new Map();
  }

  // 处理预检请求
  handlePreflight(details) {
    if (details.method !== 'OPTIONS') {
      return {};
    }

    // 预检请求不应该携带 Cookie
    // 但需要正确处理 CORS 头

    const headers = details.requestHeaders || [];

    // 检查是否有 Access-Control-Request-Headers
    const acrh = headers.find(
      h => h.name.toLowerCase() === 'access-control-request-headers'
    );

    if (acrh && acrh.value.toLowerCase().includes('cookie')) {
      // 服务器需要允许 Cookie 头
      // 这在响应头中处理
    }

    return {};
  }

  // 处理 CORS 响应
  handleCORSResponse(details) {
    const headers = details.responseHeaders || [];

    // 检查 Access-Control-Allow-Credentials
    const allowCredentials = headers.find(
      h => h.name.toLowerCase() === 'access-control-allow-credentials'
    );

    // 如果需要携带 Cookie，必须设置 allow-credentials: true
    if (allowCredentials && allowCredentials.value === 'true') {
      // 检查 Access-Control-Allow-Origin
      const allowOrigin = headers.find(
        h => h.name.toLowerCase() === 'access-control-allow-origin'
      );

      // 当 allow-credentials 为 true 时，allow-origin 不能是 *
      if (allowOrigin && allowOrigin.value === '*') {
        console.warn('CORS: allow-credentials is true but allow-origin is *');
      }
    }

    return { responseHeaders: headers };
  }

  // 缓存预检结果
  cachePreflight(origin, url, allowed) {
    const key = `${origin}|${new URL(url).origin}`;
    this.preflightCache.set(key, {
      allowed,
      timestamp: Date.now()
    });
  }

  // 获取缓存的预检结果
  getPreflightCache(origin, url) {
    const key = `${origin}|${new URL(url).origin}`;
    const cached = this.preflightCache.get(key);

    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.allowed;
    }

    return null;
  }
}
```

### 7.3 处理 HSTS 和证书固定

```javascript
// security-handler.js

class SecurityHandler {
  constructor() {
    this.hstsCache = new Map();
  }

  // 检查 HSTS 状态
  async checkHSTS(domain) {
    // HSTS 域名只能通过 HTTPS 访问
    // Chrome 会自动处理，但我们需要知道状态

    if (this.hstsCache.has(domain)) {
      return this.hstsCache.get(domain);
    }

    // 可以通过检查 chrome://net-internals/#hsts 获取
    // 但扩展无法直接访问

    // 简单判断：如果域名在已知 HSTS 列表中
    const knownHSTSDomains = [
      'accounts.google.com',
      'www.google.com',
      'github.com',
      'facebook.com',
      'twitter.com'
    ];

    const isHSTS = knownHSTSDomains.some(d =>
      domain === d || domain.endsWith('.' + d)
    );

    this.hstsCache.set(domain, isHSTS);
    return isHSTS;
  }

  // 处理证书错误
  handleCertificateError(details) {
    // 不建议绕过证书错误
    // 但可以记录并通知用户

    if (details.error && details.error.includes('CERT')) {
      console.error('Certificate error:', details.error, details.url);

      // 通知用户
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Security Warning',
        message: `Certificate error on ${new URL(details.url).hostname}`,
        priority: 2
      });
    }
  }

  // 检查混合内容
  checkMixedContent(pageUrl, resourceUrl) {
    const pageIsHTTPS = new URL(pageUrl).protocol === 'https:';
    const resourceIsHTTPS = new URL(resourceUrl).protocol === 'https:';

    if (pageIsHTTPS && !resourceIsHTTPS) {
      console.warn('Mixed content blocked:', resourceUrl, 'on', pageUrl);
      return true; // 应该阻止
    }

    return false;
  }
}
```

### 7.4 Content Security Policy 处理

```javascript
// csp-handler.js

class CSPHandler {
  constructor() {
    this.cspCache = new Map();
  }

  // 解析 CSP 头
  parseCSP(cspString) {
    const directives = {};
    const parts = cspString.split(';').map(p => p.trim());

    for (const part of parts) {
      const [directive, ...values] = part.split(/\s+/);
      if (directive) {
        directives[directive.toLowerCase()] = values;
      }
    }

    return directives;
  }

  // 处理 CSP 响应头
  handleCSPResponse(details) {
    const headers = details.responseHeaders || [];
    const cspHeader = headers.find(
      h => h.name.toLowerCase() === 'content-security-policy'
    );

    if (cspHeader) {
      const csp = this.parseCSP(cspHeader.value);

      // 缓存 CSP 策略
      this.cspCache.set(details.url, csp);

      // 检查是否影响我们的功能
      this.checkCSPImpact(csp, details.url);
    }

    return { responseHeaders: headers };
  }

  // 检查 CSP 对扩展功能的影响
  checkCSPImpact(csp, url) {
    // 检查 script-src 是否阻止内联脚本
    const scriptSrc = csp['script-src'] || [];
    if (!scriptSrc.includes("'unsafe-inline'") && !scriptSrc.includes("'nonce-")) {
      console.log('CSP blocks inline scripts on', url);
    }

    // 检查 connect-src 是否限制 XHR 目标
    const connectSrc = csp['connect-src'] || [];
    if (connectSrc.length > 0 && !connectSrc.includes('*')) {
      console.log('CSP restricts connections on', url, 'to:', connectSrc);
    }

    // 检查 frame-ancestors 是否阻止嵌入
    const frameAncestors = csp['frame-ancestors'] || [];
    if (frameAncestors.includes("'none'")) {
      console.log('CSP blocks framing on', url);
    }
  }

  // 获取 CSP 策略
  getCSP(url) {
    return this.cspCache.get(url);
  }
}
```

---

## 8. chrome.tabs API 与 session 管理的结合

### 8.1 标签页状态管理

```javascript
// tab-state-manager.js

class TabStateManager {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.tabStates = new Map();
  }

  // 初始化
  initialize() {
    // 监听标签页事件
    chrome.tabs.onCreated.addListener(this.onTabCreated.bind(this));
    chrome.tabs.onUpdated.addListener(this.onTabUpdated.bind(this));
    chrome.tabs.onRemoved.addListener(this.onTabRemoved.bind(this));
    chrome.tabs.onReplaced.addListener(this.onTabReplaced.bind(this));

    // 监听窗口事件
    chrome.windows.onRemoved.addListener(this.onWindowRemoved.bind(this));

    // 加载现有标签页状态
    this.loadExistingTabs();
  }

  // 加载现有标签页
  async loadExistingTabs() {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      this.tabStates.set(tab.id, {
        url: tab.url,
        title: tab.title,
        favIconUrl: tab.favIconUrl,
        sessionId: this.sessionManager.getTabSessionId(tab.id)
      });
    }
  }

  // 标签页创建
  onTabCreated(tab) {
    this.tabStates.set(tab.id, {
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      sessionId: null,
      createdAt: Date.now()
    });
  }

  // 标签页更新
  async onTabUpdated(tabId, changeInfo, tab) {
    const state = this.tabStates.get(tabId) || {};

    // 更新状态
    Object.assign(state, {
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      sessionId: this.sessionManager.getTabSessionId(tabId)
    });

    this.tabStates.set(tabId, state);

    // 更新标签页视觉标识
    if (state.sessionId && state.sessionId !== 'default') {
      await this.updateTabVisual(tabId, state.sessionId);
    }
  }

  // 标签页移除
  onTabRemoved(tabId) {
    this.tabStates.delete(tabId);
  }

  // 标签页替换
  onTabReplaced(addedTabId, removedTabId) {
    const state = this.tabStates.get(removedTabId);
    if (state) {
      this.tabStates.set(addedTabId, state);
      this.tabStates.delete(removedTabId);
    }
  }

  // 窗口移除
  onWindowRemoved(windowId) {
    // 清理该窗口的所有标签页状态
    for (const [tabId, state] of this.tabStates) {
      // 需要检查标签页是否属于该窗口
      // 由于标签页已移除，这里主要是清理
    }
  }

  // 更新标签页视觉标识
  async updateTabVisual(tabId, sessionId) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    // 使用 content script 注入视觉标识
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (color, name) => {
          // 创建或更新 session 标识
          let indicator = document.getElementById('session-box-indicator');
          if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'session-box-indicator';
            indicator.style.cssText = `
              position: fixed;
              top: 0;
              left: 0;
              right: 0;
              height: 4px;
              background-color: ${color};
              z-index: 2147483647;
              pointer-events: none;
            `;
            document.body.appendChild(indicator);
          } else {
            indicator.style.backgroundColor = color;
          }

          // 更新页面标题前缀
          if (!document.title.startsWith('[')) {
            document.title = `[${name}] ${document.title}`;
          }
        },
        args: [session.color, session.name]
      });
    } catch (error) {
      // 某些页面可能无法注入脚本（如 chrome:// 页面）
      console.log('Cannot inject script into tab:', tabId, error.message);
    }
  }

  // 获取标签页状态
  getTabState(tabId) {
    return this.tabStates.get(tabId);
  }

  // 获取所有标签页状态
  getAllTabStates() {
    return Object.fromEntries(this.tabStates);
  }

  // 按窗口分组获取标签页
  async getTabsByWindow() {
    const windows = await chrome.windows.getAll({ populate: true });
    const result = {};

    for (const window of windows) {
      result[window.id] = {
        window,
        tabs: window.tabs.map(tab => ({
          ...tab,
          sessionId: this.sessionManager.getTabSessionId(tab.id)
        }))
      };
    }

    return result;
  }

  // 按分组获取标签页
  async getTabsBySession() {
    const tabs = await chrome.tabs.query({});
    const result = {};

    for (const tab of tabs) {
      const sessionId = this.sessionManager.getTabSessionId(tab.id);
      if (!result[sessionId]) {
        result[sessionId] = [];
      }
      result[sessionId].push(tab);
    }

    return result;
  }
}
```

### 8.2 标签页分组功能

```javascript
// tab-grouper.js

class TabGrouper {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.groupColors = {
      'default': 'grey',
      'work': 'blue',
      'personal': 'green',
      'shopping': 'yellow',
      'social': 'pink',
      'finance': 'red'
    };
  }

  // 创建标签页组
  async createSessionGroup(sessionId) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return null;

    // 获取使用此 session 的所有标签页
    const tabs = await chrome.tabs.query({});
    const sessionTabs = tabs.filter(
      tab => this.sessionManager.getTabSessionId(tab.id) === sessionId
    );

    if (sessionTabs.length === 0) return null;

    // 创建标签页组
    const tabIds = sessionTabs.map(t => t.id);
    const groupId = await chrome.tabs.group({ tabIds });

    // 设置组标题和颜色
    await chrome.tabGroups.update(groupId, {
      title: session.name,
      color: this.groupColors[session.icon] || 'grey'
    });

    return groupId;
  }

  // 更新标签页组
  async updateSessionGroup(sessionId) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    // 查找现有组
    const groups = await chrome.tabGroups.query({});
    const existingGroup = groups.find(g => g.title === session.name);

    if (existingGroup) {
      // 更新现有组
      const tabs = await chrome.tabs.query({ groupId: existingGroup.id });
      const sessionTabs = await this.getSessionTabs(sessionId);

      // 添加新标签页到组
      const newTabIds = sessionTabs
        .filter(t => !tabs.some(gt => gt.id === t.id))
        .map(t => t.id);

      if (newTabIds.length > 0) {
        await chrome.tabs.group({
          tabIds: newTabIds,
          groupId: existingGroup.id
        });
      }
    } else {
      // 创建新组
      await this.createSessionGroup(sessionId);
    }
  }

  // 获取 session 的所有标签页
  async getSessionTabs(sessionId) {
    const tabs = await chrome.tabs.query({});
    return tabs.filter(
      tab => this.sessionManager.getTabSessionId(tab.id) === sessionId
    );
  }

  // 移动标签页到 session 组
  async moveTabToSessionGroup(tabId, sessionId) {
    const session = this.sessionManager.getSession(sessionId);
    if (!session) return;

    // 查找或创建组
    const groups = await chrome.tabGroups.query({});
    let group = groups.find(g => g.title === session.name);

    if (!group) {
      const groupId = await this.createSessionGroup(sessionId);
      if (!groupId) return;
      group = await chrome.tabGroups.get(groupId);
    }

    // 将标签页添加到组
    await chrome.tabs.group({
      tabIds: tabId,
      groupId: group.id
    });
  }

  // 从组中移除标签页
  async removeTabFromGroup(tabId) {
    await chrome.tabs.ungroup(tabId);
  }
}
```

### 8.3 标签页恢复功能

```javascript
// tab-restore-manager.js

class TabRestoreManager {
  constructor(sessionManager) {
    this.sessionManager = sessionManager;
    this.closedTabs = [];
    this.maxClosedTabs = 100;
  }

  // 初始化
  initialize() {
    // 监听标签页移除
    chrome.tabs.onRemoved.addListener(this.onTabRemoved.bind(this));

    // 监听标签页分离（拖出窗口）
    chrome.tabs.onDetached.addListener(this.onTabDetached.bind(this));
  }

  // 标签页移除时保存状态
  async onTabRemoved(tabId, removeInfo) {
    // 忽略窗口关闭时的标签页（由窗口恢复处理）
    if (removeInfo.isWindowClosing) return;

    // 获取标签页状态
    const sessionId = this.sessionManager.getTabSessionId(tabId);

    // 获取标签页信息
    try {
      const tab = await chrome.tabs.get(tabId);
      this.saveClosedTab({
        tabId,
        url: tab.url,
        title: tab.title,
        favIconUrl: tab.favIconUrl,
        sessionId,
        closedAt: Date.now(),
        windowId: removeInfo.windowId,
        index: removeInfo.index
      });
    } catch {
      // 标签页已关闭，使用缓存的状态
    }
  }

  // 标签页分离时保存状态
  onTabDetached(tabId, detachInfo) {
    // 标签页被拖出窗口，可能需要保存状态
    // 但这不是关闭，所以通常不需要处理
  }

  // 保存关闭的标签页
  saveClosedTab(tabInfo) {
    this.closedTabs.unshift(tabInfo);

    // 限制数量
    if (this.closedTabs.length > this.maxClosedTabs) {
      this.closedTabs = this.closedTabs.slice(0, this.maxClosedTabs);
    }

    // 持久化
    this.persistClosedTabs();
  }

  // 获取最近关闭的标签页
  getRecentlyClosed(limit = 10) {
    return this.closedTabs.slice(0, limit);
  }

  // 恢复标签页
  async restoreTab(closedTabInfo) {
    // 创建新标签页
    const tab = await chrome.tabs.create({
      url: closedTabInfo.url,
      active: false
    });

    // 恢复 session 绑定
    if (closedTabInfo.sessionId && closedTabInfo.sessionId !== 'default') {
      await this.sessionManager.bindTabToSession(tab.id, closedTabInfo.sessionId);
    }

    // 从关闭列表中移除
    const index = this.closedTabs.findIndex(t =>
      t.url === closedTabInfo.url && t.closedAt === closedTabInfo.closedAt
    );
    if (index >= 0) {
      this.closedTabs.splice(index, 1);
      this.persistClosedTabs();
    }

    return tab;
  }

  // 恢复所有关闭的标签页（按 session 分组）
  async restoreAllTabs(sessionId = null) {
    const tabsToRestore = sessionId
      ? this.closedTabs.filter(t => t.sessionId === sessionId)
      : this.closedTabs;

    const restoredTabs = [];

    for (const tabInfo of tabsToRestore) {
      const tab = await this.restoreTab(tabInfo);
      restoredTabs.push(tab);
    }

    return restoredTabs;
  }

  // 持久化关闭的标签页
  async persistClosedTabs() {
    await chrome.storage.local.set({
      closedTabs: this.closedTabs
    });
  }

  // 加载关闭的标签页
  async loadClosedTabs() {
    const data = await chrome.storage.local.get('closedTabs');
    if (data.closedTabs) {
      this.closedTabs = data.closedTabs;
    }
  }

  // 清空关闭的标签页
  clearClosedTabs() {
    this.closedTabs = [];
    this.persistClosedTabs();
  }
}
```

---

## 9. 完整的 TabSessionManager 实现

### 9.1 核心类整合

```javascript
// tab-session-manager.js

class TabSessionManager {
  constructor() {
    // 子模块
    this.storageManager = new SessionStorageManager();
    this.cookieInjector = null;
    this.lifecycleHandler = null;
    this.stateManager = null;
    this.syncManager = null;
    this.expirationHandler = null;
    this.notificationHandler = null;
    this.contextMenuHandler = null;
    this.tabGrouper = null;
    this.restoreManager = null;

    // 状态
    this.initialized = false;
  }

  // 初始化
  async initialize() {
    if (this.initialized) return;

    try {
      // 初始化存储
      await this.storageManager.initialize();

      // 初始化 Cookie 注入器
      this.cookieInjector = new CookieInjector(this.storageManager);
      this.cookieInjector.start();

      // 初始化生命周期处理
      this.lifecycleHandler = new TabLifecycleHandler(this.storageManager);
      this.lifecycleHandler.initialize();

      // 初始化状态管理
      this.stateManager = new TabStateManager(this.storageManager);
      this.stateManager.initialize();

      // 初始化同步管理
      this.syncManager = new CookieSyncManager(this.storageManager);
      this.syncManager.start();

      // 初始化过期处理
      this.expirationHandler = new CookieExpirationHandler(this.storageManager);
      this.expirationHandler.start();

      // 初始化通知处理
      this.notificationHandler = new CookieNotificationHandler(this.storageManager);
      this.notificationHandler.initialize();

      // 初始化右键菜单
      this.contextMenuHandler = new ContextMenuHandler(this.storageManager, this.lifecycleHandler);
      await this.contextMenuHandler.initialize();

      // 初始化标签页分组
      this.tabGrouper = new TabGrouper(this.storageManager);

      // 初始化恢复管理
      this.restoreManager = new TabRestoreManager(this.storageManager);
      this.restoreManager.initialize();
      await this.restoreManager.loadClosedTabs();

      // 监听扩展消息
      chrome.runtime.onMessage.addListener(this.onMessage.bind(this));

      this.initialized = true;
      console.log('TabSessionManager initialized successfully');
    } catch (error) {
      console.error('Failed to initialize TabSessionManager:', error);
      throw error;
    }
  }

  // 处理扩展消息
  onMessage(request, sender, sendResponse) {
    const handlers = {
      'getSessions': () => this.getSessions(),
      'createSession': (data) => this.createSession(data),
      'deleteSession': (data) => this.deleteSession(data.sessionId),
      'updateSession': (data) => this.updateSession(data.sessionId, data.updates),
      'getTabSession': (data) => this.getTabSession(data.tabId),
      'bindTabToSession': (data) => this.bindTabToSession(data.tabId, data.sessionId),
      'unbindTab': (data) => this.unbindTab(data.tabId),
      'createTabWithSession': (data) => this.createTabWithSession(data),
      'getRecentlyClosed': (data) => this.getRecentlyClosed(data.limit),
      'restoreTab': (data) => this.restoreTab(data.tabInfo),
      'exportSession': (data) => this.exportSession(data.sessionId),
      'importSession': (data) => this.importSession(data.sessionData)
    };

    const handler = handlers[request.action];
    if (handler) {
      Promise.resolve(handler(request.data))
        .then(result => sendResponse({ success: true, data: result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // 保持消息通道开放
    }
  }

  // 公共 API 方法
  getSessions() {
    return this.storageManager.getAllSessions();
  }

  async createSession(options) {
    return await this.storageManager.createSession(options);
  }

  async deleteSession(sessionId) {
    await this.storageManager.deleteSession(sessionId);
  }

  async updateSession(sessionId, updates) {
    return await this.storageManager.updateSession(sessionId, updates);
  }

  getTabSession(tabId) {
    return this.storageManager.getTabSession(tabId);
  }

  async bindTabToSession(tabId, sessionId) {
    await this.storageManager.bindTabToSession(tabId, sessionId);
    await this.stateManager.updateTabVisual(tabId, sessionId);
  }

  async unbindTab(tabId) {
    await this.storageManager.unbindTab(tabId);
  }

  async createTabWithSession(options) {
    return await this.lifecycleHandler.createTabWithSession(options);
  }

  getRecentlyClosed(limit) {
    return this.restoreManager.getRecentlyClosed(limit);
  }

  async restoreTab(tabInfo) {
    return await this.restoreManager.restoreTab(tabInfo);
  }

  exportSession(sessionId) {
    return this.storageManager.exportSession(sessionId);
  }

  async importSession(sessionData) {
    return await this.storageManager.importSession(sessionData);
  }

  // 清理资源
  async cleanup() {
    this.cookieInjector?.stop();
    this.syncManager?.stop();
    this.expirationHandler?.stop();
    await this.storageManager.cleanup();
  }
}

// 导出单例
const tabSessionManager = new TabSessionManager();

// 在 Service Worker 中初始化
chrome.runtime.onInstalled.addListener(async () => {
  await tabSessionManager.initialize();
});

chrome.runtime.onStartup.addListener(async () => {
  await tabSessionManager.initialize();
});
```

### 9.2 Manifest 配置

```json
// manifest.json
{
  "manifest_version": 3,
  "name": "Tab Session Manager",
  "version": "1.0.0",
  "description": "Manage isolated sessions per tab, similar to SessionBox",
  "permissions": [
    "storage",
    "cookies",
    "tabs",
    "tabGroups",
    "webRequest",
    "webRequestAuthProvider",
    "contextMenus",
    "notifications",
    "scripting"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "commands": {
    "create-new-session": {
      "suggested_key": {
        "default": "Ctrl+Shift+S"
      },
      "description": "Create a new session"
    },
    "switch-session": {
      "suggested_key": {
        "default": "Ctrl+Shift+M"
      },
      "description": "Switch session for current tab"
    }
  }
}
```

### 9.3 项目文件结构

```
tab-session-manager/
├── manifest.json
├── background.js                 # Service Worker 入口
├── lib/
│   ├── tab-session-manager.js    # 核心管理器
│   ├── session-storage-manager.js
│   ├── cookie-injector.js
│   ├── tab-lifecycle-handler.js
│   ├── tab-state-manager.js
│   ├── cookie-sync-manager.js
│   ├── cookie-expiration-handler.js
│   ├── cookie-notification-handler.js
│   ├── context-menu-handler.js
│   ├── tab-grouper.js
│   ├── tab-restore-manager.js
│   ├── https-cookie-handler.js
│   ├── cors-handler.js
│   ├── csp-handler.js
│   └── security-handler.js
├── popup/
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   └── session-ui.js
├── content/
│   └── content.js
├── options/
│   ├── options.html
│   └── options.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── _locales/
    ├── en/
    │   └── messages.json
    └── zh_CN/
        └── messages.json
```

---

## 10. SessionBox 类产品的技术原理分析

### 10.1 SessionBox 概述

SessionBox 是一款流行的 Chrome 扩展，允许用户在同一浏览器中同时登录同一网站的多个账号。其核心功能包括：

- 标签页级别的会话隔离
- 多账号管理
- 会话持久化
- 代理支持
- User-Agent 切换

### 10.2 技术实现原理

#### 10.2.1 Cookie 隔离机制

SessionBox 的核心是通过拦截 HTTP 请求来实现 Cookie 隔离：

```
┌─────────────────────────────────────────────────────────────┐
│                  SessionBox 工作流程                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 用户创建 Session                                         │
│     └─> SessionBox 创建独立的 Cookie Jar                    │
│                                                             │
│  2. 用户在 Session 中打开标签页                              │
│     └─> 标签页与 Session 绑定                               │
│                                                             │
│  3. 标签页发起请求                                           │
│     └─> onBeforeSendHeaders 拦截                           │
│     └─> 从 Session Cookie Jar 注入 Cookie                   │
│     └─> 移除浏览器原生 Cookie                               │
│                                                             │
│  4. 服务器返回响应                                           │
│     └─> onHeadersReceived 拦截                             │
│     └─> 提取 Set-Cookie                                     │
│     └─> 存储到 Session Cookie Jar                          │
│     └─> 阻止浏览器自动设置 Cookie                           │
│                                                             │
│  5. 用户切换 Session                                         │
│     └─> 不同标签页使用不同 Cookie Jar                       │
│     └─> 实现多账号同时在线                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 10.2.2 存储隔离

SessionBox 不仅隔离 Cookie，还隔离其他存储：

| 存储类型 | 隔离方式 |
|----------|----------|
| Cookies | 通过 webRequest API 拦截 |
| LocalStorage | 通过 Content Script 注入覆盖 |
| SessionStorage | 通过 Content Script 注入覆盖 |
| IndexedDB | 通过 Content Script 注入覆盖 |
| Cache | 通过 Service Worker 控制 |

#### 10.2.3 LocalStorage 隔离实现

```javascript
// content-script-localstorage.js

// 注入到页面，覆盖 localStorage
function injectLocalStorage(sessionId) {
  // 创建隔离的存储对象
  const sessionKey = `sessionbox_${sessionId}`;

  // 保存原始 localStorage
  const originalLocalStorage = window.localStorage;

  // 创建代理对象
  const proxyLocalStorage = {
    getItem(key) {
      const data = JSON.parse(originalLocalStorage.getItem(sessionKey) || '{}');
      return data[key] || null;
    },

    setItem(key, value) {
      const data = JSON.parse(originalLocalStorage.getItem(sessionKey) || '{}');
      data[key] = value;
      originalLocalStorage.setItem(sessionKey, JSON.stringify(data));
    },

    removeItem(key) {
      const data = JSON.parse(originalLocalStorage.getItem(sessionKey) || '{}');
      delete data[key];
      originalLocalStorage.setItem(sessionKey, JSON.stringify(data));
    },

    clear() {
      originalLocalStorage.setItem(sessionKey, '{}');
    },

    get length() {
      const data = JSON.parse(originalLocalStorage.getItem(sessionKey) || '{}');
      return Object.keys(data).length;
    },

    key(index) {
      const data = JSON.parse(originalLocalStorage.getItem(sessionKey) || '{}');
      return Object.keys(data)[index] || null;
    }
  };

  // 替换 window.localStorage
  Object.defineProperty(window, 'localStorage', {
    value: proxyLocalStorage,
    writable: false,
    configurable: false
  });
}

// 从扩展接收 session ID
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'injectSession') {
    injectLocalStorage(message.sessionId);
    sendResponse({ success: true });
  }
});
```

### 10.3 类似产品对比

| 产品 | Cookie 隔离 | 存储隔离 | 代理支持 | UA 切换 | 开源 |
|------|-------------|----------|----------|---------|------|
| SessionBox | Yes | Yes | Yes | Yes | No |
| Multilogin | Yes | Yes | Yes | Yes | No |
| GoLogin | Yes | Yes | Yes | Yes | No |
| Firefox Containers | Yes | Yes | No | No | Yes |
| Session Buddy | No | No | No | No | No |

### 10.4 Manifest V3 适配挑战

在 Manifest V3 下，SessionBox 类产品面临以下挑战：

1. **webRequest 阻塞模式受限**
   - 解决方案：使用企业策略部署，或使用 declarativeNetRequest

2. **Service Worker 生命周期**
   - 解决方案：使用 keepalive 机制或定期唤醒

3. **远程代码执行限制**
   - 解决方案：所有逻辑必须在扩展包内

### 10.5 性能优化建议

```javascript
// 性能优化示例

// 1. 批量处理 Cookie
class BatchCookieProcessor {
  constructor() {
    this.pendingCookies = [];
    this.processTimer = null;
  }

  addCookie(cookie) {
    this.pendingCookies.push(cookie);

    // 延迟处理，批量更新
    if (!this.processTimer) {
      this.processTimer = setTimeout(() => {
        this.processBatch();
      }, 100);
    }
  }

  processBatch() {
    // 批量处理所有待处理的 cookies
    const cookies = this.pendingCookies;
    this.pendingCookies = [];
    this.processTimer = null;

    // 按域名分组
    const byDomain = {};
    for (const cookie of cookies) {
      const domain = cookie.domain;
      if (!byDomain[domain]) {
        byDomain[domain] = [];
      }
      byDomain[domain].push(cookie);
    }

    // 批量更新存储
    for (const [domain, domainCookies] of Object.entries(byDomain)) {
      this.updateDomainCookies(domain, domainCookies);
    }
  }
}

// 2. 缓存常用数据
class SessionCache {
  constructor() {
    this.cache = new Map();
    this.maxSize = 100;
  }

  get(key) {
    const item = this.cache.get(key);
    if (item && Date.now() - item.timestamp < 60000) {
      return item.value;
    }
    return null;
  }

  set(key, value) {
    // LRU 淘汰
    if (this.cache.size >= this.maxSize) {
      const oldest = [...this.cache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      this.cache.delete(oldest[0]);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }
}

// 3. 异步处理
async function processRequestAsync(details) {
  // 使用 requestIdleCallback 或 setTimeout 延迟非关键处理
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      // 非关键处理
    });
  }
}
```

### 10.6 安全考虑

```javascript
// 安全处理示例

// 1. 敏感数据加密
class SecureStorage {
  constructor() {
    this.encryptionKey = null;
  }

  async initialize() {
    // 生成或获取加密密钥
    const stored = await chrome.storage.local.get('encryptionKey');
    if (stored.encryptionKey) {
      this.encryptionKey = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(stored.encryptionKey),
        'AES-GCM',
        false,
        ['encrypt', 'decrypt']
      );
    } else {
      this.encryptionKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
      const exported = await crypto.subtle.exportKey('raw', this.encryptionKey);
      await chrome.storage.local.set({
        encryptionKey: Array.from(new Uint8Array(exported))
      });
    }
  }

  async encrypt(data) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.encryptionKey,
      encoded
    );
    return {
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encrypted))
    };
  }

  async decrypt(encrypted) {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(encrypted.iv) },
      this.encryptionKey,
      new Uint8Array(encrypted.data)
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  }
}

// 2. 防止 XSS
function sanitizeCookieValue(value) {
  // 移除潜在的恶意脚本
  return value.replace(/[<>"']/g, '');
}

// 3. 验证来源
function validateRequestSource(details) {
  // 检查请求是否来自预期的标签页
  if (details.tabId < 0) {
    return false; // 非标签页请求
  }

  // 检查 origin
  if (details.originUrl) {
    const origin = new URL(details.originUrl);
    // 验证逻辑
  }

  return true;
}
```

---

## 总结

本文档详细介绍了实现标签页级别 Session/Cookie 隔离的完整技术方案，包括：

1. **chrome.webRequest API** 的深入使用，包括请求/响应拦截和修改
2. **Cookie 注入机制**，实现每个标签页使用独立的 Cookie
3. **Session 存储管理**，包括持久化和内存缓存策略
4. **标签页生命周期管理**，处理创建、更新、关闭等事件
5. **Cookie 同步和过期处理**，确保数据一致性
6. **HTTPS 和安全策略**的处理方法
7. **完整的 TabSessionManager 实现**，整合所有功能模块
8. **SessionBox 类产品的技术原理分析**

这些技术可以用于构建类似 SessionBox、Multilogin 等多账号管理工具，实现同一浏览器中同时登录多个账号的功能。

---

## 参考资料

- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [chrome.webRequest API](https://developer.chrome.com/docs/extensions/reference/api/webRequest)
- [chrome.cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies)
- [chrome.tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/migrating/)
- [Firefox Multi-Account Containers](https://github.com/mozilla/multi-account-containers)
- [SessionBox](https://sessionbox.io/)
