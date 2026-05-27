# 代理级别 Session/IP 隔离方案

本文档详细介绍基于 Chrome 扩展的代理级别 Session/IP 隔离方案，涵盖 chrome.proxy API 的完整用法、PAC 脚本编写、代理认证处理、防关联最佳实践等内容。

## 目录

1. [chrome.proxy API 概述](#1-chromeproxy-api-概述)
2. [PAC 脚本编写与动态生成](#2-pac-脚本编写与动态生成)
3. [固定代理配置方式](#3-固定代理配置方式)
4. [按域名/标签页动态切换代理](#4-按域名标签页动态切换代理)
5. [代理认证处理](#5-代理认证处理)
6. [SOCKS 与 HTTP 代理的区别](#6-socks-与-http-代理的区别)
7. [代理与账号绑定的实现](#7-代理与账号绑定的实现)
8. [代理状态的管理和持久化](#8-代理状态的管理和持久化)
9. [代理隔离的优缺点分析](#9-代理隔离的优缺点分析)
10. [防关联场景的最佳实践](#10-防关联场景的最佳实践)
11. [完整的代理管理器实现](#11-完整的代理管理器实现)

---

## 1. chrome.proxy API 概述

### 1.1 API 简介

`chrome.proxy` API 允许扩展程序管理 Chrome 的代理设置。通过此 API，可以为整个浏览器或特定请求配置代理服务器，实现网络流量的灵活路由。

### 1.2 权限配置

在 `manifest.json` 中声明权限：

```json
{
  "manifest_version": 3,
  "name": "Proxy Manager",
  "version": "1.0",
  "permissions": [
    "proxy",
    "storage",
    "tabs",
    "webRequest",
    "webRequestAuthProvider"
  ],
  "background": {
    "service_worker": "background.js"
  }
}
```

### 1.3 核心对象和方法

#### chrome.proxy.settings

代理设置的核心对象，包含以下方法：

| 方法 | 描述 |
|------|------|
| `set(details, callback)` | 设置代理配置 |
| `get(callback)` | 获取当前代理配置 |
| `clear(callback)` | 清除代理配置，恢复系统设置 |
| `onChange` | 代理设置变更事件 |

#### ProxyConfig 对象结构

```typescript
interface ProxyConfig {
  mode: 'direct' | 'auto_detect' | 'pac_script' | 'fixed_servers' | 'system';
  pacScript?: PacScript;
  rules?: ProxyRules;
}

interface PacScript {
  url?: string;           // PAC 文件的 URL
  data?: string;          // PAC 脚本的文本内容
  mandatory?: boolean;    // 是否强制使用 PAC 脚本
}

interface ProxyRules {
  singleProxy?: ProxyServer;           // 所有请求使用同一代理
  proxyForHttp?: ProxyServer;          // HTTP 请求代理
  proxyForHttps?: ProxyServer;         // HTTPS 请求代理
  proxyForFtp?: ProxyServer;           // FTP 请求代理
  fallbackProxy?: ProxyServer;         // 回退代理
  bypassList?: string[];               // 绕过代理的地址列表
}

interface ProxyServer {
  scheme?: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
}
```

### 1.4 代理模式说明

| 模式 | 描述 |
|------|------|
| `direct` | 直接连接，不使用代理 |
| `auto_detect` | 自动检测代理设置（WPAD） |
| `pac_script` | 使用 PAC 脚本配置代理 |
| `fixed_servers` | 使用固定的代理服务器 |
| `system` | 使用系统代理设置 |

---

## 2. PAC 脚本编写与动态生成

### 2.1 PAC 脚本基础

PAC（Proxy Auto-Config）文件是一个 JavaScript 文件，包含一个名为 `FindProxyForURL` 的函数，用于根据 URL 决定使用哪个代理。

### 2.2 FindProxyForURL 函数签名

```javascript
function FindProxyForURL(url, host) {
  // url: 完整的请求 URL
  // host: 从 URL 中提取的主机名
  // 返回值: 代理配置字符串
}
```

### 2.3 返回值格式

| 返回值 | 描述 |
|--------|------|
| `"DIRECT"` | 直接连接，不使用代理 |
| `"PROXY host:port"` | 使用 HTTP 代理 |
| `"HTTPS host:port"` | 使用 HTTPS 代理 |
| `"SOCKS host:port"` | 使用 SOCKS 代理（默认 SOCKS4） |
| `"SOCKS5 host:port"` | 使用 SOCKS5 代理 |

可以返回多个选项，用分号分隔，按顺序尝试：

```javascript
return "PROXY proxy1:8080; PROXY proxy2:8080; DIRECT";
```

### 2.4 内置辅助函数

PAC 脚本提供以下内置函数：

#### 字符串匹配

```javascript
// shell 通配符匹配
shExpMatch(host, "*.example.com");

// 正则表达式匹配（部分实现）
// 注意：标准 PAC 不支持完整正则，需使用 shExpMatch
```

#### DNS 相关

```javascript
// 解析主机名到 IP 地址
dnsResolve(host);

// 检查主机是否在指定 IP 范围内
isInNet(host, "192.168.0.0", "255.255.0.0");

// 检查主机名是否为本地主机
isPlainHostName(host);

// 检查主机名是否包含点
dnsDomainIs(host, ".example.com");

// 获取本地 IP 地址
myIpAddress();
```

#### 时间相关

```javascript
// 获取当前小时（0-23）
timeHour = hourRange();

// 检查当前时间是否在范围内
timeRange(9, 17);  // 9:00-17:00
weekdayRange("MON", "FRI");  // 周一到周五
```

### 2.5 PAC 脚本示例

#### 基础示例：按域名分流

```javascript
function FindProxyForURL(url, host) {
  // 本地地址直连
  if (isPlainHostName(host) ||
      dnsDomainIs(host, ".local") ||
      dnsDomainIs(host, ".localhost")) {
    return "DIRECT";
  }

  // 内网地址直连
  if (isInNet(host, "10.0.0.0", "255.0.0.0") ||
      isInNet(host, "172.16.0.0", "255.240.0.0") ||
      isInNet(host, "192.168.0.0", "255.255.0.0")) {
    return "DIRECT";
  }

  // 特定域名使用特定代理
  if (dnsDomainIs(host, ".google.com") ||
      dnsDomainIs(host, ".youtube.com")) {
    return "PROXY us-proxy:8080";
  }

  // 国内网站直连
  if (dnsDomainIs(host, ".cn") ||
      dnsDomainIs(host, ".baidu.com") ||
      dnsDomainIs(host, ".taobao.com")) {
    return "DIRECT";
  }

  // 其他请求使用默认代理
  return "PROXY default-proxy:8080; DIRECT";
}
```

#### 高级示例：负载均衡

```javascript
function FindProxyForURL(url, host) {
  // 基于主机名哈希实现简单的负载均衡
  var hash = 0;
  for (var i = 0; i < host.length; i++) {
    hash = ((hash << 5) - hash) + host.charCodeAt(i);
    hash = hash & hash;
  }

  var proxyIndex = Math.abs(hash) % 3;
  var proxies = [
    "PROXY proxy1:8080",
    "PROXY proxy2:8080",
    "PROXY proxy3:8080"
  ];

  return proxies[proxyIndex] + "; DIRECT";
}
```

### 2.6 动态生成 PAC 脚本

在扩展中动态生成 PAC 脚本：

```javascript
// background.js

class PacScriptGenerator {
  constructor() {
    this.proxyRules = new Map();
  }

  // 添加代理规则
  addRule(domain, proxyServer) {
    this.proxyRules.set(domain, proxyServer);
  }

  // 生成 PAC 脚本
  generate() {
    const rules = Array.from(this.proxyRules.entries())
      .map(([domain, proxy]) => {
        return `  if (dnsDomainIs(host, ".${domain}") || host === "${domain}") {
    return "${proxy}";
  }`;
      })
      .join('\n');

    return `
function FindProxyForURL(url, host) {
  // 本地地址直连
  if (isPlainHostName(host)) {
    return "DIRECT";
  }

${rules}

  // 默认直连
  return "DIRECT";
}
    `.trim();
  }

  // 应用 PAC 脚本
  async apply() {
    const pacScript = this.generate();

    return new Promise((resolve, reject) => {
      chrome.proxy.settings.set(
        {
          value: {
            mode: 'pac_script',
            pacScript: {
              data: pacScript,
              mandatory: false
            }
          },
          scope: 'regular'
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve();
          }
        }
      );
    });
  }
}

// 使用示例
const pacGenerator = new PacScriptGenerator();
pacGenerator.addRule('google.com', 'PROXY us-proxy:8080');
pacGenerator.addRule('facebook.com', 'PROXY us-proxy:8080');
pacGenerator.addRule('baidu.com', 'DIRECT');
await pacGenerator.apply();
```

### 2.7 使用 URL 方式加载 PAC

```javascript
// 从远程 URL 加载 PAC 脚本
chrome.proxy.settings.set({
  value: {
    mode: 'pac_script',
    pacScript: {
      url: 'https://example.com/proxy.pac',
      mandatory: false
    }
  },
  scope: 'regular'
}, () => {
  console.log('PAC script loaded from URL');
});
```

---

## 3. 固定代理配置方式

### 3.1 单一代理配置

所有请求使用同一个代理服务器：

```javascript
// 设置单一代理
chrome.proxy.settings.set({
  value: {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: 'socks5',
        host: '127.0.0.1',
        port: 1080
      },
      bypassList: [
        '<local>',           // 本地地址
        'localhost',
        '127.0.0.1',
        '::1',
        '*.local',
        '*.localhost'
      ]
    }
  },
  scope: 'regular'
}, callback);
```

### 3.2 按协议配置代理

为不同协议使用不同的代理：

```javascript
chrome.proxy.settings.set({
  value: {
    mode: 'fixed_servers',
    rules: {
      proxyForHttp: {
        scheme: 'http',
        host: 'http-proxy.example.com',
        port: 8080
      },
      proxyForHttps: {
        scheme: 'https',
        host: 'https-proxy.example.com',
        port: 8443
      },
      proxyForFtp: {
        scheme: 'socks5',
        host: 'socks-proxy.example.com',
        port: 1080
      },
      fallbackProxy: {
        scheme: 'http',
        host: 'fallback-proxy.example.com',
        port: 8080
      },
      bypassList: [
        '<local>',
        '*.internal.example.com'
      ]
    }
  },
  scope: 'regular'
}, callback);
```

### 3.3 bypassList 格式

bypassList 支持以下格式：

```javascript
bypassList: [
  // 特定主机名
  'localhost',
  'example.com',

  // 通配符匹配
  '*.example.com',
  '*.internal',

  // 正则表达式（需要前缀）
  '^https?://[^/]*\\.local($|/)',

  // 特殊值
  '<local>',  // 匹配所有本地地址

  // CIDR 格式
  '192.168.0.0/16'
]
```

### 3.4 清除代理设置

```javascript
// 清除代理设置，恢复系统默认
chrome.proxy.settings.clear({
  scope: 'regular'
}, () => {
  console.log('Proxy settings cleared');
});
```

### 3.5 获取当前代理设置

```javascript
chrome.proxy.settings.get({
  incognito: false
}, (config) => {
  console.log('Current proxy config:', config);
  // config.value 包含当前代理配置
  // config.levelOfControl 表示控制级别
});
```

---

## 4. 按域名/标签页动态切换代理

### 4.1 基于标签页的代理切换

由于 chrome.proxy API 不支持直接按标签页设置代理，需要通过 PAC 脚本结合标签页信息实现：

```javascript
// background.js

class TabProxyManager {
  constructor() {
    this.tabProxies = new Map();  // tabId -> proxy config
    this.domainProxies = new Map();  // domain -> proxy config
    this.defaultProxy = 'DIRECT';

    // 监听标签页更新
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'loading' && tab.url) {
        this.handleTabUrlChange(tabId, tab.url);
      }
    });

    // 监听标签页关闭
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.tabProxies.delete(tabId);
    });
  }

  // 为标签页设置代理
  setTabProxy(tabId, proxyConfig) {
    this.tabProxies.set(tabId, proxyConfig);
    this.updateProxySettings();
  }

  // 为域名设置代理
  setDomainProxy(domain, proxyConfig) {
    this.domainProxies.set(domain, proxyConfig);
    this.updateProxySettings();
  }

  // 处理 URL 变化
  handleTabUrlChange(tabId, url) {
    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      // 检查是否有该域名的特定代理
      if (this.domainProxies.has(domain)) {
        this.setTabProxy(tabId, this.domainProxies.get(domain));
      }
    } catch (e) {
      console.error('Invalid URL:', url);
    }
  }

  // 生成 PAC 脚本
  generatePacScript() {
    const domainRules = Array.from(this.domainProxies.entries())
      .map(([domain, proxy]) => {
        return `  if (host === "${domain}" || dnsDomainIs(host, ".${domain}")) {
    return "${proxy}";
  }`)
      .join('\n');

    return `
function FindProxyForURL(url, host) {
  // 本地地址直连
  if (isPlainHostName(host) || shExpMatch(host, "*.local")) {
    return "DIRECT";
  }

${domainRules}

  // 默认代理
  return "${this.defaultProxy}";
}
    `.trim();
  }

  // 更新代理设置
  updateProxySettings() {
    const pacScript = this.generatePacScript();

    chrome.proxy.settings.set({
      value: {
        mode: 'pac_script',
        pacScript: {
          data: pacScript,
          mandatory: false
        }
      },
      scope: 'regular'
    });
  }
}

const proxyManager = new TabProxyManager();
```

### 4.2 基于会话的代理隔离

为不同的浏览器会话（如不同窗口）配置不同的代理：

```javascript
class SessionProxyManager {
  constructor() {
    this.sessionProxies = new Map();  // sessionId -> proxy config
    this.windowSessions = new Map();  // windowId -> sessionId

    // 监听窗口创建
    chrome.windows.onCreated.addListener((window) => {
      this.assignSessionToWindow(window.id);
    });

    // 监听窗口关闭
    chrome.windows.onRemoved.addListener((windowId) => {
      this.windowSessions.delete(windowId);
    });
  }

  // 创建新会话
  createSession(proxyConfig) {
    const sessionId = this.generateSessionId();
    this.sessionProxies.set(sessionId, {
      id: sessionId,
      proxy: proxyConfig,
      createdAt: Date.now()
    });
    return sessionId;
  }

  // 将窗口分配到会话
  assignSessionToWindow(windowId, sessionId = null) {
    if (sessionId && this.sessionProxies.has(sessionId)) {
      this.windowSessions.set(windowId, sessionId);
    } else {
      // 创建新会话
      const newSessionId = this.createSession('DIRECT');
      this.windowSessions.set(windowId, newSessionId);
    }
  }

  // 获取窗口的代理配置
  getWindowProxy(windowId) {
    const sessionId = this.windowSessions.get(windowId);
    if (sessionId) {
      const session = this.sessionProxies.get(sessionId);
      return session ? session.proxy : 'DIRECT';
    }
    return 'DIRECT';
  }

  generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
}
```

### 4.3 使用 declarativeNetRequest 进行更精细的控制

对于需要更精细控制的场景，可以结合 `declarativeNetRequest` API：

```javascript
// 注意：declarativeNetRequest 不能直接设置代理
// 但可以用于修改请求头，配合代理使用

// 注册规则修改请求头
chrome.declarativeNetRequest.updateDynamicRules({
  addRules: [{
    id: 1,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{
        header: 'X-Proxy-Session',
        operation: 'set',
        value: 'session-123'
      }]
    },
    condition: {
      urlFilter: '*://example.com/*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest']
    }
  }]
});
```

---

## 5. 代理认证处理

### 5.1 代理认证概述

当代理服务器需要认证时，浏览器会弹出认证对话框。通过 `webRequestAuthProvider` API（Manifest V3）或 `webRequest.onAuthRequired`（Manifest V2），扩展可以自动提供认证凭据。

### 5.2 Manifest V3 方式（推荐）

```javascript
// manifest.json
{
  "permissions": [
    "proxy",
    "webRequestAuthProvider"
  ]
}

// background.js
class ProxyAuthManager {
  constructor() {
    this.credentials = new Map();  // proxyHost -> {username, password}

    // 监听认证请求
    chrome.webRequestAuthProvider.onAuthRequired.addListener(
      (details, callback) => {
        this.handleAuthRequired(details, callback);
      },
      { urls: ['<all_urls>'] },
      ['asyncBlocking']
    );
  }

  // 设置代理凭据
  setCredentials(proxyHost, username, password) {
    this.credentials.set(proxyHost, { username, password });
  }

  // 处理认证请求
  handleAuthRequired(details, callback) {
    const { challenger, isProxy } = details;

    // 只处理代理认证
    if (!isProxy) {
      callback({});
      return;
    }

    const proxyHost = challenger.host;
    const creds = this.credentials.get(proxyHost);

    if (creds) {
      callback({
        authCredentials: {
          username: creds.username,
          password: creds.password
        }
      });
    } else {
      // 没有存储的凭据，让用户输入
      callback({});
    }
  }
}

const authManager = new ProxyAuthManager();

// 设置代理凭据
authManager.setCredentials('proxy.example.com', 'user1', 'pass123');
```

### 5.3 Manifest V2 方式

```javascript
// manifest.json (V2)
{
  "permissions": [
    "proxy",
    "webRequest",
    "webRequestBlocking"
  ]
}

// background.js
chrome.webRequest.onAuthRequired.addListener(
  (details) => {
    if (!details.isProxy) {
      return {};
    }

    const proxyHost = details.challenger.host;
    const creds = getStoredCredentials(proxyHost);

    if (creds) {
      return {
        authCredentials: {
          username: creds.username,
          password: creds.password
        }
      };
    }

    return {};
  },
  { urls: ['<all_urls>'] },
  ['blocking']
);
```

### 5.4 完整的代理认证管理器

```javascript
class ProxyAuthHandler {
  constructor() {
    this.proxyCredentials = new Map();
    this.sessionAuthCache = new Map();

    this.setupListeners();
  }

  setupListeners() {
    // Manifest V3 方式
    if (chrome.webRequestAuthProvider) {
      chrome.webRequestAuthProvider.onAuthRequired.addListener(
        this.onAuthRequired.bind(this),
        { urls: ['<all_urls>'] },
        ['asyncBlocking']
      );
    }
    // Manifest V2 回退
    else if (chrome.webRequest) {
      chrome.webRequest.onAuthRequired.addListener(
        this.onAuthRequiredV2.bind(this),
        { urls: ['<all_urls>'] },
        ['blocking']
      );
    }
  }

  // 添加代理凭据
  addProxyCredentials(proxyConfig) {
    const key = `${proxyConfig.host}:${proxyConfig.port}`;
    this.proxyCredentials.set(key, {
      username: proxyConfig.username,
      password: proxyConfig.password,
      scheme: proxyConfig.scheme || 'http'
    });
  }

  // 移除代理凭据
  removeProxyCredentials(host, port) {
    const key = `${host}:${port}`;
    this.proxyCredentials.delete(key);
    this.sessionAuthCache.delete(key);
  }

  // Manifest V3 处理
  onAuthRequired(details, callback) {
    const result = this.processAuthRequest(details);
    callback(result);
  }

  // Manifest V2 处理
  onAuthRequiredV2(details) {
    return this.processAuthRequest(details);
  }

  // 处理认证请求
  processAuthRequest(details) {
    // 只处理代理认证
    if (!details.isProxy) {
      return {};
    }

    const challenger = details.challenger;
    const proxyKey = `${challenger.host}:${challenger.port}`;
    const requestId = details.requestId;

    // 检查是否已经为这个请求尝试过认证
    const cacheKey = `${proxyKey}:${requestId}`;
    if (this.sessionAuthCache.has(cacheKey)) {
      // 已经尝试过，避免无限循环
      return {};
    }

    const creds = this.proxyCredentials.get(proxyKey);
    if (creds) {
      // 标记已尝试
      this.sessionAuthCache.set(cacheKey, true);

      // 清理过期缓存
      setTimeout(() => {
        this.sessionAuthCache.delete(cacheKey);
      }, 60000);

      return {
        authCredentials: {
          username: creds.username,
          password: creds.password
        }
      };
    }

    return {};
  }

  // 从存储加载凭据
  async loadCredentials() {
    const stored = await chrome.storage.local.get('proxyCredentials');
    if (stored.proxyCredentials) {
      for (const [key, value] of Object.entries(stored.proxyCredentials)) {
        this.proxyCredentials.set(key, value);
      }
    }
  }

  // 保存凭据到存储
  async saveCredentials() {
    const obj = {};
    for (const [key, value] of this.proxyCredentials.entries()) {
      obj[key] = value;
    }
    await chrome.storage.local.set({ proxyCredentials: obj });
  }
}

const proxyAuthHandler = new ProxyAuthHandler();
```

### 5.5 安全存储代理密码

```javascript
// 使用加密存储敏感信息
class SecureCredentialStorage {
  constructor() {
    this.encryptionKey = null;
  }

  // 初始化加密密钥
  async init() {
    // 尝试从存储获取现有密钥
    const stored = await chrome.storage.local.get('encryptionKey');
    if (stored.encryptionKey) {
      this.encryptionKey = await crypto.subtle.importKey(
        'raw',
        new Uint8Array(stored.encryptionKey),
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
    } else {
      // 生成新密钥
      this.encryptionKey = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      // 导出并存储
      const exported = await crypto.subtle.exportKey('raw', this.encryptionKey);
      await chrome.storage.local.set({
        encryptionKey: Array.from(new Uint8Array(exported))
      });
    }
  }

  // 加密数据
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

  // 解密数据
  async decrypt(encrypted) {
    const iv = new Uint8Array(encrypted.iv);
    const data = new Uint8Array(encrypted.data);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.encryptionKey,
      data
    );

    return JSON.parse(new TextDecoder().decode(decrypted));
  }

  // 存储凭据
  async storeCredentials(proxyKey, username, password) {
    const encrypted = await this.encrypt({ username, password });
    const stored = await chrome.storage.local.get('encryptedCredentials') || {};
    stored[proxyKey] = encrypted;
    await chrome.storage.local.set({ encryptedCredentials: stored });
  }

  // 获取凭据
  async getCredentials(proxyKey) {
    const stored = await chrome.storage.local.get('encryptedCredentials');
    if (stored.encryptedCredentials && stored.encryptedCredentials[proxyKey]) {
      return await this.decrypt(stored.encryptedCredentials[proxyKey]);
    }
    return null;
  }
}
```

---

## 6. SOCKS 与 HTTP 代理的区别

### 6.1 协议层级对比

| 特性 | HTTP 代理 | SOCKS 代理 |
|------|-----------|------------|
| OSI 层级 | 应用层（Layer 7） | 会话层（Layer 5） |
| 协议理解 | 理解 HTTP 协议 | 不理解应用协议 |
| 支持协议 | HTTP/HTTPS | 任意 TCP 协议 |
| 性能 | 较低（需解析请求） | 较高（直接转发） |
| 功能 | 可缓存、过滤、修改 | 纯转发 |
| 认证方式 | Basic、Digest、NTLM | 用户名/密码 |

### 6.2 HTTP 代理工作原理

```
客户端 -> HTTP 代理 -> 目标服务器

请求流程：
1. 客户端发送: CONNECT target.com:443 HTTP/1.1
2. 代理响应: HTTP/1.1 200 Connection Established
3. 建立隧道，开始传输数据
```

HTTP 代理特点：
- 可以解析和修改 HTTP 请求/响应
- 支持缓存功能
- 可以进行内容过滤
- 对 HTTPS 需要使用 CONNECT 方法建立隧道

### 6.3 SOCKS 代理工作原理

```
客户端 -> SOCKS 代理 -> 目标服务器

SOCKS5 握手流程：
1. 客户端发送: 0x05, 认证方法列表
2. 代理响应: 0x05, 选定的认证方法
3. 认证（如果需要）
4. 客户端发送连接请求: 目标地址和端口
5. 代理响应: 连接结果
6. 开始传输数据
```

SOCKS 代理特点：
- 不解析应用层数据
- 支持任意 TCP 协议
- 支持 UDP（SOCKS5）
- 更好的性能和隐私

### 6.4 SOCKS4 vs SOCKS5

| 特性 | SOCKS4 | SOCKS5 |
|------|--------|--------|
| 认证 | 无 | 用户名/密码、GSSAPI |
| UDP | 不支持 | 支持 |
| IPv6 | 不支持 | 支持 |
| 远程 DNS | 不支持 | 支持 |
| 认证方法 | 0 | 0-255 |

### 6.5 在 Chrome 扩展中使用

```javascript
// HTTP 代理
const httpProxy = {
  scheme: 'http',
  host: 'proxy.example.com',
  port: 8080
};

// HTTPS 代理（支持 TLS）
const httpsProxy = {
  scheme: 'https',
  host: 'secure-proxy.example.com',
  port: 8443
};

// SOCKS4 代理
const socks4Proxy = {
  scheme: 'socks4',
  host: 'socks4.example.com',
  port: 1080
};

// SOCKS5 代理
const socks5Proxy = {
  scheme: 'socks5',
  host: 'socks5.example.com',
  port: 1080
};

// 设置代理
chrome.proxy.settings.set({
  value: {
    mode: 'fixed_servers',
    rules: {
      singleProxy: socks5Proxy
    }
  },
  scope: 'regular'
});
```

### 6.6 PAC 脚本中的代理类型

```javascript
function FindProxyForURL(url, host) {
  // HTTP 代理
  // return "PROXY proxy.example.com:8080";

  // HTTPS 代理
  // return "HTTPS secure-proxy.example.com:8443";

  // SOCKS4 代理
  // return "SOCKS socks4.example.com:1080";

  // SOCKS5 代理
  return "SOCKS5 socks5.example.com:1080";

  // 多个代理（故障转移）
  // return "SOCKS5 primary.example.com:1080; SOCKS5 backup.example.com:1080; DIRECT";
}
```

### 6.7 选择建议

| 场景 | 推荐类型 | 原因 |
|------|----------|------|
| 网页浏览 | HTTP/SOCKS5 | 都可以，HTTP 可缓存 |
| 需要隐私 | SOCKS5 | 不解析内容 |
| 需要认证 | SOCKS5 | 标准认证机制 |
| 需要远程 DNS | SOCKS5 | 支持 UDP 和远程解析 |
| 需要内容过滤 | HTTP | 可解析和修改内容 |
| 高性能需求 | SOCKS5 | 无协议解析开销 |

---

## 7. 代理与账号绑定的实现

### 7.1 数据模型设计

```javascript
// 账号-代理绑定模型
class AccountProxyBinding {
  constructor() {
    this.bindings = new Map();  // accountId -> binding
  }

  // 绑定结构
  /*
  {
    accountId: 'account_123',
    accountName: 'user@example.com',
    proxy: {
      scheme: 'socks5',
      host: 'proxy1.example.com',
      port: 1080,
      username: 'proxy_user',
      password: 'proxy_pass'
    },
    profile: {
      userAgent: 'Mozilla/5.0...',
      timezone: 'America/New_York',
      language: 'en-US',
      geolocation: { lat: 40.7128, lng: -74.0060 }
    },
    createdAt: 1234567890,
    lastUsed: 1234567890
  }
  */

  // 创建绑定
  createBinding(accountId, config) {
    const binding = {
      accountId,
      accountName: config.accountName,
      proxy: config.proxy,
      profile: config.profile || {},
      createdAt: Date.now(),
      lastUsed: null
    };

    this.bindings.set(accountId, binding);
    return binding;
  }

  // 获取绑定
  getBinding(accountId) {
    return this.bindings.get(accountId);
  }

  // 更新绑定
  updateBinding(accountId, updates) {
    const binding = this.bindings.get(accountId);
    if (binding) {
      Object.assign(binding, updates);
      binding.lastUsed = Date.now();
    }
    return binding;
  }

  // 删除绑定
  deleteBinding(accountId) {
    return this.bindings.delete(accountId);
  }

  // 获取所有绑定
  getAllBindings() {
    return Array.from(this.bindings.values());
  }
}
```

### 7.2 会话管理器

```javascript
class SessionManager {
  constructor() {
    this.accountProxyBinding = new AccountProxyBinding();
    this.activeSessions = new Map();  // sessionId -> session
    this.windowSessions = new Map();  // windowId -> sessionId
    this.tabSessions = new Map();     // tabId -> sessionId

    this.setupListeners();
  }

  setupListeners() {
    // 监听窗口关闭
    chrome.windows.onRemoved.addListener((windowId) => {
      this.closeSessionByWindow(windowId);
    });

    // 监听标签页关闭
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.tabSessions.delete(tabId);
    });

    // 监听标签页更新
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete') {
        this.updateTabSession(tabId, tab);
      }
    });
  }

  // 创建会话
  async createSession(accountId) {
    const binding = this.accountProxyBinding.getBinding(accountId);
    if (!binding) {
      throw new Error(`No binding found for account: ${accountId}`);
    }

    const sessionId = this.generateSessionId();
    const session = {
      id: sessionId,
      accountId,
      proxy: binding.proxy,
      profile: binding.profile,
      createdAt: Date.now(),
      windows: new Set(),
      tabs: new Set()
    };

    this.activeSessions.set(sessionId, session);

    // 更新最后使用时间
    this.accountProxyBinding.updateBinding(accountId, {
      lastUsed: Date.now()
    });

    return session;
  }

  // 创建会话窗口
  async createSessionWindow(accountId) {
    const session = await this.createSession(accountId);

    // 创建新窗口
    const window = await chrome.windows.create({
      url: 'about:blank',
      focused: true
    });

    // 关联窗口和会话
    session.windows.add(window.id);
    this.windowSessions.set(window.id, session.id);

    // 应用代理设置
    await this.applySessionProxy(session);

    // 应用配置文件设置
    await this.applySessionProfile(session, window.id);

    return { session, window };
  }

  // 应用会话代理
  async applySessionProxy(session) {
    const proxy = session.proxy;

    // 设置代理认证凭据
    if (proxy.username && proxy.password) {
      proxyAuthHandler.addProxyCredentials({
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
        scheme: proxy.scheme
      });
    }

    // 设置代理
    return new Promise((resolve, reject) => {
      chrome.proxy.settings.set({
        value: {
          mode: 'fixed_servers',
          rules: {
            singleProxy: {
              scheme: proxy.scheme,
              host: proxy.host,
              port: proxy.port
            },
            bypassList: ['<local>']
          }
        },
        scope: 'regular'
      }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  // 应用会话配置文件
  async applySessionProfile(session, windowId) {
    const profile = session.profile;

    // 注入脚本修改指纹
    if (profile.userAgent || profile.timezone || profile.language) {
      await chrome.scripting.executeScript({
        target: { windowId },
        func: (config) => {
          // 修改 navigator 属性
          if (config.userAgent) {
            Object.defineProperty(navigator, 'userAgent', {
              get: () => config.userAgent
            });
          }

          // 修改语言
          if (config.language) {
            Object.defineProperty(navigator, 'language', {
              get: () => config.language
            });
          }

          // 修改时区
          if (config.timezone) {
            const originalDateTimeFormat = Intl.DateTimeFormat;
            Intl.DateTimeFormat = function(...args) {
              if (args[1] && typeof args[1] === 'object') {
                args[1].timeZone = config.timezone;
              } else {
                args[1] = { timeZone: config.timezone };
              }
              return new originalDateTimeFormat(...args);
            };
          }
        },
        args: [profile],
        injectImmediately: true
      });
    }
  }

  // 关闭会话
  async closeSession(sessionId) {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // 关闭所有关联窗口
    for (const windowId of session.windows) {
      try {
        await chrome.windows.remove(windowId);
      } catch (e) {
        // 窗口可能已关闭
      }
      this.windowSessions.delete(windowId);
    }

    // 清理标签页关联
    for (const tabId of session.tabs) {
      this.tabSessions.delete(tabId);
    }

    // 清除代理设置
    await new Promise((resolve) => {
      chrome.proxy.settings.clear({ scope: 'regular' }, resolve);
    });

    // 移除会话
    this.activeSessions.delete(sessionId);
  }

  // 通过窗口关闭会话
  closeSessionByWindow(windowId) {
    const sessionId = this.windowSessions.get(windowId);
    if (sessionId) {
      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.windows.delete(windowId);
        // 如果没有其他窗口，关闭会话
        if (session.windows.size === 0) {
          this.closeSession(sessionId);
        }
      }
      this.windowSessions.delete(windowId);
    }
  }

  // 更新标签页会话
  updateTabSession(tabId, tab) {
    const windowId = tab.windowId;
    const sessionId = this.windowSessions.get(windowId);
    if (sessionId) {
      const session = this.activeSessions.get(sessionId);
      if (session) {
        session.tabs.add(tabId);
        this.tabSessions.set(tabId, sessionId);
      }
    }
  }

  // 获取标签页的会话
  getTabSession(tabId) {
    const sessionId = this.tabSessions.get(tabId);
    return sessionId ? this.activeSessions.get(sessionId) : null;
  }

  generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
}
```

### 7.3 多账号代理池管理

```javascript
class ProxyPoolManager {
  constructor() {
    this.proxies = new Map();  // proxyId -> proxy config
    this.accountAssignments = new Map();  // accountId -> proxyId
    this.proxyUsage = new Map();  // proxyId -> usage stats
  }

  // 添加代理到池
  addProxy(proxyId, config) {
    this.proxies.set(proxyId, {
      id: proxyId,
      ...config,
      status: 'available',
      addedAt: Date.now()
    });

    this.proxyUsage.set(proxyId, {
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      lastUsed: null,
      avgResponseTime: 0
    });
  }

  // 为账号分配代理
  assignProxyToAccount(accountId, strategy = 'dedicated') {
    let proxyId;

    switch (strategy) {
      case 'dedicated':
        // 专用代理：每个账号固定一个代理
        if (this.accountAssignments.has(accountId)) {
          proxyId = this.accountAssignments.get(accountId);
        } else {
          proxyId = this.findAvailableProxy();
          this.accountAssignments.set(accountId, proxyId);
        }
        break;

      case 'rotating':
        // 轮换代理：每次使用不同的代理
        proxyId = this.findAvailableProxy();
        break;

      case 'sticky':
        // 粘性代理：同一会话使用同一代理
        // 需要结合会话管理
        proxyId = this.findAvailableProxy();
        break;

      case 'load_balanced':
        // 负载均衡：选择使用最少的代理
        proxyId = this.findLeastUsedProxy();
        break;
    }

    return proxyId ? this.proxies.get(proxyId) : null;
  }

  // 查找可用代理
  findAvailableProxy() {
    for (const [proxyId, proxy] of this.proxies) {
      if (proxy.status === 'available') {
        return proxyId;
      }
    }
    return null;
  }

  // 查找最少使用的代理
  findLeastUsedProxy() {
    let minUsage = Infinity;
    let selectedProxyId = null;

    for (const [proxyId, usage] of this.proxyUsage) {
      const proxy = this.proxies.get(proxyId);
      if (proxy.status === 'available' && usage.totalRequests < minUsage) {
        minUsage = usage.totalRequests;
        selectedProxyId = proxyId;
      }
    }

    return selectedProxyId;
  }

  // 更新代理使用统计
  updateProxyStats(proxyId, success, responseTime) {
    const usage = this.proxyUsage.get(proxyId);
    if (usage) {
      usage.totalRequests++;
      if (success) {
        usage.successRequests++;
      } else {
        usage.failedRequests++;
      }
      usage.lastUsed = Date.now();

      // 计算平均响应时间
      usage.avgResponseTime =
        (usage.avgResponseTime * (usage.totalRequests - 1) + responseTime) /
        usage.totalRequests;
    }
  }

  // 检查代理健康状态
  async checkProxyHealth(proxyId) {
    const proxy = this.proxies.get(proxyId);
    if (!proxy) return false;

    try {
      // 发送测试请求
      const startTime = Date.now();
      const response = await fetch('https://api.ipify.org?format=json', {
        method: 'GET',
        // 注意：fetch API 本身不支持代理设置
        // 这里需要通过其他方式测试，如通过 content script
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        proxy.status = 'available';
        this.updateProxyStats(proxyId, true, responseTime);
        return true;
      } else {
        proxy.status = 'error';
        this.updateProxyStats(proxyId, false, responseTime);
        return false;
      }
    } catch (e) {
      proxy.status = 'error';
      this.updateProxyStats(proxyId, false, 0);
      return false;
    }
  }

  // 获取代理统计
  getProxyStats(proxyId) {
    return {
      proxy: this.proxies.get(proxyId),
      usage: this.proxyUsage.get(proxyId)
    };
  }
}
```

---

## 8. 代理状态的管理和持久化

### 8.1 代理状态管理器

```javascript
class ProxyStateManager {
  constructor() {
    this.state = {
      currentProxy: null,
      proxyHistory: [],
      errors: [],
      stats: {
        totalRequests: 0,
        proxiedRequests: 0,
        directRequests: 0,
        failedRequests: 0
      }
    };

    this.loadState();
    this.setupListeners();
  }

  // 加载状态
  async loadState() {
    const stored = await chrome.storage.local.get('proxyState');
    if (stored.proxyState) {
      this.state = { ...this.state, ...stored.proxyState };
    }
  }

  // 保存状态
  async saveState() {
    await chrome.storage.local.set({ proxyState: this.state });
  }

  // 设置监听器
  setupListeners() {
    // 监听代理错误
    chrome.proxy.onProxyError.addListener((details) => {
      this.handleProxyError(details);
    });

    // 监听请求完成（用于统计）
    chrome.webRequest.onCompleted.addListener(
      (details) => {
        this.updateStats(details, true);
      },
      { urls: ['<all_urls>'] }
    );

    // 监听请求错误
    chrome.webRequest.onErrorOccurred.addListener(
      (details) => {
        this.updateStats(details, false);
      },
      { urls: ['<all_urls>'] }
    );
  }

  // 设置当前代理
  async setCurrentProxy(proxyConfig) {
    this.state.currentProxy = {
      ...proxyConfig,
      setAt: Date.now()
    };

    this.state.proxyHistory.push({
      proxy: proxyConfig,
      timestamp: Date.now(),
      action: 'set'
    });

    // 限制历史记录长度
    if (this.state.proxyHistory.length > 100) {
      this.state.proxyHistory = this.state.proxyHistory.slice(-100);
    }

    await this.saveState();
  }

  // 清除当前代理
  async clearCurrentProxy() {
    if (this.state.currentProxy) {
      this.state.proxyHistory.push({
        proxy: this.state.currentProxy,
        timestamp: Date.now(),
        action: 'clear'
      });
    }

    this.state.currentProxy = null;
    await this.saveState();
  }

  // 处理代理错误
  handleProxyError(details) {
    const error = {
      message: details.error,
      proxy: this.state.currentProxy,
      url: details.url,
      timestamp: Date.now()
    };

    this.state.errors.push(error);

    // 限制错误记录长度
    if (this.state.errors.length > 50) {
      this.state.errors = this.state.errors.slice(-50);
    }

    this.saveState();

    // 通知用户
    this.notifyError(error);
  }

  // 更新统计
  updateStats(details, success) {
    this.state.stats.totalRequests++;

    if (success) {
      // 判断是否通过代理
      if (details.fromCache) {
        // 缓存请求
      } else if (this.state.currentProxy) {
        this.state.stats.proxiedRequests++;
      } else {
        this.state.stats.directRequests++;
      }
    } else {
      this.state.stats.failedRequests++;
    }

    // 定期保存（避免频繁写入）
    if (this.state.stats.totalRequests % 10 === 0) {
      this.saveState();
    }
  }

  // 通知错误
  notifyError(error) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'Proxy Error',
      message: `Proxy error: ${error.message}`
    });
  }

  // 获取状态
  getState() {
    return { ...this.state };
  }

  // 重置统计
  async resetStats() {
    this.state.stats = {
      totalRequests: 0,
      proxiedRequests: 0,
      directRequests: 0,
      failedRequests: 0
    };
    await this.saveState();
  }
}
```

### 8.2 代理配置持久化

```javascript
class ProxyConfigStorage {
  constructor() {
    this.storageKey = 'proxyConfigs';
  }

  // 保存代理配置
  async saveConfig(configId, config) {
    const configs = await this.getAllConfigs();
    configs[configId] = {
      ...config,
      id: configId,
      updatedAt: Date.now()
    };

    await chrome.storage.local.set({ [this.storageKey]: configs });
  }

  // 获取代理配置
  async getConfig(configId) {
    const configs = await this.getAllConfigs();
    return configs[configId] || null;
  }

  // 获取所有配置
  async getAllConfigs() {
    const result = await chrome.storage.local.get(this.storageKey);
    return result[this.storageKey] || {};
  }

  // 删除配置
  async deleteConfig(configId) {
    const configs = await this.getAllConfigs();
    delete configs[configId];
    await chrome.storage.local.set({ [this.storageKey]: configs });
  }

  // 导出配置
  async exportConfigs() {
    const configs = await this.getAllConfigs();
    return JSON.stringify(configs, null, 2);
  }

  // 导入配置
  async importConfigs(jsonString) {
    try {
      const configs = JSON.parse(jsonString);
      await chrome.storage.local.set({ [this.storageKey]: configs });
      return true;
    } catch (e) {
      console.error('Import failed:', e);
      return false;
    }
  }

  // 同步到云端（如果支持）
  async syncToCloud() {
    const configs = await this.getAllConfigs();
    await chrome.storage.sync.set({ [this.storageKey]: configs });
  }

  // 从云端同步
  async syncFromCloud() {
    const syncData = await chrome.storage.sync.get(this.storageKey);
    if (syncData[this.storageKey]) {
      await chrome.storage.local.set({ [this.storageKey]: syncData[this.storageKey] });
    }
  }
}
```

### 8.3 代理状态 UI 管理

```javascript
// popup.js - 代理状态显示

class ProxyStatusUI {
  constructor() {
    this.elements = {
      statusIndicator: document.getElementById('status-indicator'),
      currentProxy: document.getElementById('current-proxy'),
      stats: document.getElementById('stats'),
      history: document.getElementById('history'),
      errors: document.getElementById('errors')
    };

    this.init();
  }

  async init() {
    await this.updateUI();
    this.setupRefresh();
  }

  async updateUI() {
    const state = await this.getState();

    // 更新状态指示器
    this.updateStatusIndicator(state.currentProxy);

    // 更新当前代理信息
    this.updateCurrentProxy(state.currentProxy);

    // 更新统计
    this.updateStats(state.stats);

    // 更新历史
    this.updateHistory(state.proxyHistory);

    // 更新错误
    this.updateErrors(state.errors);
  }

  updateStatusIndicator(proxy) {
    const indicator = this.elements.statusIndicator;

    if (proxy) {
      indicator.className = 'status-active';
      indicator.textContent = 'Proxy Active';
    } else {
      indicator.className = 'status-inactive';
      indicator.textContent = 'Direct Connection';
    }
  }

  updateCurrentProxy(proxy) {
    const element = this.elements.currentProxy;

    if (proxy) {
      element.innerHTML = `
        <div class="proxy-info">
          <span class="proxy-type">${proxy.scheme.toUpperCase()}</span>
          <span class="proxy-host">${proxy.host}:${proxy.port}</span>
        </div>
        <div class="proxy-meta">
          <span>Set at: ${new Date(proxy.setAt).toLocaleString()}</span>
        </div>
      `;
    } else {
      element.innerHTML = '<div class="no-proxy">No proxy configured</div>';
    }
  }

  updateStats(stats) {
    this.elements.stats.innerHTML = `
      <div class="stat-item">
        <span class="stat-label">Total Requests:</span>
        <span class="stat-value">${stats.totalRequests}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Proxied:</span>
        <span class="stat-value">${stats.proxiedRequests}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Direct:</span>
        <span class="stat-value">${stats.directRequests}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Failed:</span>
        <span class="stat-value">${stats.failedRequests}</span>
      </div>
    `;
  }

  updateHistory(history) {
    const recentHistory = history.slice(-10).reverse();
    this.elements.history.innerHTML = recentHistory.map(item => `
      <div class="history-item">
        <span class="history-action">${item.action}</span>
        <span class="history-proxy">${item.proxy ? `${item.proxy.host}:${item.proxy.port}` : 'None'}</span>
        <span class="history-time">${new Date(item.timestamp).toLocaleString()}</span>
      </div>
    `).join('');
  }

  updateErrors(errors) {
    const recentErrors = errors.slice(-5).reverse();
    this.elements.errors.innerHTML = recentErrors.length > 0
      ? recentErrors.map(error => `
          <div class="error-item">
            <span class="error-message">${error.message}</span>
            <span class="error-time">${new Date(error.timestamp).toLocaleString()}</span>
          </div>
        `).join('')
      : '<div class="no-errors">No errors</div>';
  }

  async getState() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getState' }, resolve);
    });
  }

  setupRefresh() {
    // 定期刷新
    setInterval(() => this.updateUI(), 5000);

    // 监听状态变化
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'stateChanged') {
        this.updateUI();
      }
    });
  }
}
```

---

## 9. 代理隔离的优缺点分析

### 9.1 优点

#### 1. IP 隔离
- 每个账号/会话使用不同的出口 IP
- 防止网站通过 IP 关联多个账号
- 支持地理位置模拟

#### 2. 灵活的路由控制
- 可按域名、URL 模式、标签页等维度切换代理
- 支持故障转移和负载均衡
- 可配置绕过规则

#### 3. 易于实现
- Chrome 扩展 API 完善
- 无需修改浏览器内核
- 开发成本低

#### 4. 可扩展性
- 支持多种代理协议
- 可集成第三方代理服务
- 支持动态配置

### 9.2 缺点

#### 1. 性能影响
- 代理服务器增加延迟
- PAC 脚本解析开销
- 连接建立时间增加

#### 2. 隐私泄露风险
- DNS 泄露：DNS 查询可能绕过代理
- WebRTC 泄露：可能暴露真实 IP
- 插件泄露：某些插件可能绕过代理

#### 3. 稳定性问题
- 代理服务器故障导致连接失败
- 认证失败处理复杂
- 网络环境变化需要重新配置

#### 4. 功能限制
- 无法完全隔离浏览器指纹
- 某些 API 可能绕过代理设置
- 扩展权限限制

### 9.3 与其他隔离方案的对比

| 方案 | IP 隔离 | Cookie 隔离 | 指纹隔离 | 实现难度 | 成本 |
|------|---------|-------------|----------|----------|------|
| 代理隔离 | 是 | 否 | 部分 | 低 | 低 |
| 多配置文件 | 否 | 是 | 部分 | 低 | 低 |
| 容器标签页 | 否 | 是 | 部分 | 低 | 低 |
| 多浏览器实例 | 是 | 是 | 部分 | 中 | 中 |
| 虚拟机 | 是 | 是 | 是 | 高 | 高 |
| 反检测浏览器 | 是 | 是 | 是 | - | 中-高 |

### 9.4 适用场景

#### 适合使用代理隔离的场景
- 需要访问地理限制内容
- 需要隐藏真实 IP
- 多账号管理（配合其他隔离方式）
- 网络调试和测试

#### 不适合单独使用代理隔离的场景
- 需要完全的浏览器指纹隔离
- 高安全要求的匿名浏览
- 需要隔离本地存储（Cookie、LocalStorage）

---

## 10. 防关联场景的最佳实践

### 10.1 多维度隔离策略

代理隔离只是防关联的一部分，需要配合其他隔离措施：

```javascript
class AntiAssociationManager {
  constructor() {
    this.isolationLayers = {
      proxy: new ProxyIsolationLayer(),
      storage: new StorageIsolationLayer(),
      fingerprint: new FingerprintIsolationLayer(),
      network: new NetworkIsolationLayer()
    };
  }

  // 创建隔离环境
  async createIsolatedEnvironment(config) {
    const environment = {
      id: this.generateEnvironmentId(),
      config,
      layers: {}
    };

    // 依次初始化各隔离层
    for (const [name, layer] of Object.entries(this.isolationLayers)) {
      environment.layers[name] = await layer.initialize(config);
    }

    return environment;
  }

  generateEnvironmentId() {
    return 'env_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
}
```

### 10.2 防止 DNS 泄露

```javascript
// 配置远程 DNS 解析（SOCKS5 代理）
const proxyConfig = {
  scheme: 'socks5',
  host: 'proxy.example.com',
  port: 1080,
  // SOCKS5 代理会在代理服务器上进行 DNS 解析
  // 避免本地 DNS 查询泄露真实 IP
};

// 禁用 WebRTC（防止 IP 泄露）
// 在 content script 中注入
function disableWebRTC() {
  const script = document.createElement('script');
  script.textContent = `
    // 禁用 WebRTC
    navigator.mediaDevices.getUserMedia = undefined;
    navigator.mediaDevices.getDisplayMedia = undefined;

    // 禁用 RTCPeerConnection
    window.RTCPeerConnection = undefined;
    window.webkitRTCPeerConnection = undefined;
  `;
  document.documentElement.appendChild(script);
  script.remove();
}

// 通过 declarativeNetRequest 阻止 STUN 请求
chrome.declarativeNetRequest.updateDynamicRules({
  addRules: [{
    id: 100,
    priority: 1,
    action: { type: 'block' },
    condition: {
      urlFilter: '*://stun.*',
      resourceTypes: ['other']
    }
  }]
});
```

### 10.3 时区和地理位置一致性

```javascript
// 确保时区与代理 IP 地理位置一致
class GeoConsistencyManager {
  constructor() {
    this.geoData = new Map();  // proxyId -> geo info
  }

  // 根据代理 IP 获取地理位置
  async fetchGeoLocation(proxyConfig) {
    // 通过代理访问 IP 查询服务
    // 注意：这需要在代理环境下执行
    const response = await fetch('https://ipapi.co/json/');
    const data = await response.json();

    return {
      ip: data.ip,
      city: data.city,
      region: data.region,
      country: data.country,
      timezone: data.timezone,
      latitude: data.latitude,
      longitude: data.longitude,
      languages: data.languages
    };
  }

  // 生成一致的配置文件
  generateConsistentProfile(geoData) {
    return {
      timezone: geoData.timezone,
      language: geoData.languages.split(',')[0],
      geolocation: {
        latitude: geoData.latitude,
        longitude: geoData.longitude,
        accuracy: 100  // 模拟 GPS 精度
      },
      locale: {
        language: geoData.languages.split(',')[0].split('-')[0],
        region: geoData.country
      }
    };
  }

  // 注入配置文件到页面
  async injectProfile(tabId, profile) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (config) => {
        // 覆盖时区
        const originalDateTimeFormat = Intl.DateTimeFormat;
        window.Intl.DateTimeFormat = function(...args) {
          const instance = new originalDateTimeFormat(...args);
          const originalResolvedOptions = instance.resolvedOptions;
          instance.resolvedOptions = function() {
            const options = originalResolvedOptions.call(this);
            options.timeZone = config.timezone;
            return options;
          };
          return instance;
        };

        // 覆盖语言
        Object.defineProperty(navigator, 'language', {
          get: () => config.language,
          configurable: true
        });

        Object.defineProperty(navigator, 'languages', {
          get: () => [config.language, config.language.split('-')[0]],
          configurable: true
        });

        // 覆盖地理位置
        if (navigator.geolocation && config.geolocation) {
          const originalGetCurrentPosition = navigator.geolocation.getCurrentPosition;
          navigator.geolocation.getCurrentPosition = function(success, error, options) {
            success({
              coords: {
                latitude: config.geolocation.latitude,
                longitude: config.geolocation.longitude,
                accuracy: config.geolocation.accuracy,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null
              },
              timestamp: Date.now()
            });
          };
        }
      },
      args: [profile],
      injectImmediately: true,
      world: 'MAIN'
    });
  }
}
```

### 10.4 User-Agent 一致性

```javascript
// 确保 User-Agent 与代理 IP 地区一致
class UserAgentManager {
  constructor() {
    this.userAgents = {
      'en-US': {
        windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      'zh-CN': {
        windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
      // 更多地区...
    };
  }

  // 获取匹配的 User-Agent
  getUserAgent(locale, platform = 'windows') {
    const localeAgents = this.userAgents[locale] || this.userAgents['en-US'];
    return localeAgents[platform] || localeAgents.windows;
  }

  // 应用 User-Agent
  async applyUserAgent(tabId, userAgent) {
    // 方法1：使用 declarativeNetRequest 修改请求头
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id: 200,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{
            header: 'User-Agent',
            operation: 'set',
            value: userAgent
          }]
        },
        condition: {
          tabIds: [tabId]
        }
      }]
    });

    // 方法2：注入脚本覆盖 navigator.userAgent
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (ua) => {
        Object.defineProperty(navigator, 'userAgent', {
          get: () => ua,
          configurable: true
        });

        Object.defineProperty(navigator, 'appVersion', {
          get: () => ua.substring(8),
          configurable: true
        });

        Object.defineProperty(navigator, 'platform', {
          get: () => {
            if (ua.includes('Windows')) return 'Win32';
            if (ua.includes('Mac')) return 'MacIntel';
            if (ua.includes('Linux')) return 'Linux x86_64';
            return 'Win32';
          },
          configurable: true
        });
      },
      args: [userAgent],
      injectImmediately: true,
      world: 'MAIN'
    });
  }
}
```

### 10.5 Canvas 指纹防护

```javascript
// Canvas 指纹噪声注入
async function injectCanvasNoise(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // 保存原始方法
      const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      const originalToBlob = HTMLCanvasElement.prototype.toBlob;

      // 生成噪声
      function addNoise(data, amount = 0.0001) {
        for (let i = 0; i < data.length; i += 4) {
          // 对 RGB 通道添加微小噪声
          data[i] = Math.max(0, Math.min(255, data[i] + Math.floor((Math.random() - 0.5) * amount * 255)));
          data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + Math.floor((Math.random() - 0.5) * amount * 255)));
          data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + Math.floor((Math.random() - 0.5) * amount * 255)));
        }
        return data;
      }

      // 覆盖 toDataURL
      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          addNoise(imageData.data);
          ctx.putImageData(imageData, 0, 0);
        }
        return originalToDataURL.apply(this, args);
      };

      // 覆盖 getImageData
      CanvasRenderingContext2D.prototype.getImageData = function(...args) {
        const imageData = originalGetImageData.apply(this, args);
        addNoise(imageData.data);
        return imageData;
      };

      // 覆盖 toBlob
      HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          addNoise(imageData.data);
          ctx.putImageData(imageData, 0, 0);
        }
        return originalToBlob.call(this, callback, ...args);
      };
    },
    injectImmediately: true,
    world: 'MAIN'
  });
}
```

### 10.6 完整的防关联检查清单

```javascript
const antiAssociationChecklist = [
  {
    category: 'Network',
    items: [
      { id: 'proxy', name: 'Proxy configured', check: (env) => !!env.proxy },
      { id: 'dns', name: 'Remote DNS enabled', check: (env) => env.proxy?.scheme === 'socks5' },
      { id: 'webrtc', name: 'WebRTC disabled', check: (env) => env.webrtcDisabled },
      { id: 'stun', name: 'STUN blocked', check: (env) => env.stunBlocked }
    ]
  },
  {
    category: 'Fingerprint',
    items: [
      { id: 'canvas', name: 'Canvas noise injected', check: (env) => env.canvasNoise },
      { id: 'audio', name: 'Audio noise injected', check: (env) => env.audioNoise },
      { id: 'webgl', name: 'WebGL spoofed', check: (env) => env.webglSpoofed },
      { id: 'fonts', name: 'Fonts masked', check: (env) => env.fontsMasked }
    ]
  },
  {
    category: 'Identity',
    items: [
      { id: 'userAgent', name: 'User-Agent consistent', check: (env) => env.userAgentConsistent },
      { id: 'timezone', name: 'Timezone matches proxy', check: (env) => env.timezoneMatch },
      { id: 'language', name: 'Language matches proxy', check: (env) => env.languageMatch },
      { id: 'geolocation', name: 'Geolocation matches proxy', check: (env) => env.geoMatch }
    ]
  },
  {
    category: 'Storage',
    items: [
      { id: 'cookies', name: 'Cookies isolated', check: (env) => env.cookiesIsolated },
      { id: 'localStorage', name: 'LocalStorage isolated', check: (env) => env.localStorageIsolated },
      { id: 'indexedDB', name: 'IndexedDB isolated', check: (env) => env.indexedDBIsolated },
      { id: 'cache', name: 'Cache cleared', check: (env) => env.cacheCleared }
    ]
  }
];

// 运行检查
function runChecklist(environment) {
  const results = [];

  for (const category of antiAssociationChecklist) {
    for (const item of category.items) {
      const passed = item.check(environment);
      results.push({
        category: category.category,
        item: item.name,
        passed,
        status: passed ? 'PASS' : 'FAIL'
      });
    }
  }

  return {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results
  };
}
```

---

## 11. 完整的代理管理器实现

### 11.1 核心类设计

```javascript
// proxy-manager.js

/**
 * 完整的代理管理器
 * 整合代理配置、认证、状态管理和防关联功能
 */
class ProxyManager {
  constructor() {
    // 子系统
    this.configManager = new ProxyConfigManager();
    this.authManager = new ProxyAuthManager();
    this.stateManager = new ProxyStateManager();
    this.sessionManager = new SessionManager();
    this.geoManager = new GeoConsistencyManager();
    this.fingerprintManager = new FingerprintManager();

    // 代理池
    this.proxyPool = new ProxyPoolManager();

    // 初始化
    this.init();
  }

  async init() {
    // 加载配置
    await this.configManager.load();
    await this.stateManager.loadState();

    // 设置监听器
    this.setupListeners();

    // 恢复上次会话
    await this.restoreLastSession();
  }

  setupListeners() {
    // 监听扩展启动
    chrome.runtime.onStartup.addListener(() => {
      this.handleStartup();
    });

    // 监听安装
    chrome.runtime.onInstalled.addListener((details) => {
      this.handleInstall(details);
    });

    // 监听消息
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;  // 保持消息通道开放
    });
  }

  // 创建隔离会话
  async createIsolatedSession(accountId, options = {}) {
    // 获取账号绑定
    const binding = this.sessionManager.accountProxyBinding.getBinding(accountId);

    // 如果没有绑定，从代理池分配
    let proxyConfig = binding?.proxy;
    if (!proxyConfig) {
      const proxyId = this.proxyPool.assignProxyToAccount(accountId, options.strategy || 'dedicated');
      proxyConfig = this.proxyPool.proxies.get(proxyId);
    }

    // 获取地理位置信息
    let geoData = null;
    if (options.fetchGeo !== false) {
      try {
        geoData = await this.geoManager.fetchGeoLocation(proxyConfig);
      } catch (e) {
        console.warn('Failed to fetch geo location:', e);
      }
    }

    // 生成一致的配置文件
    const profile = geoData
      ? this.geoManager.generateConsistentProfile(geoData)
      : binding?.profile || {};

    // 创建会话窗口
    const { session, window } = await this.sessionManager.createSessionWindow(accountId);

    // 更新会话配置
    session.proxy = proxyConfig;
    session.profile = profile;
    session.geoData = geoData;

    // 应用指纹防护
    if (options.fingerprintProtection !== false) {
      await this.applyFingerprintProtection(window.id, profile);
    }

    return { session, window, profile, geoData };
  }

  // 应用指纹防护
  async applyFingerprintProtection(windowId, profile) {
    // 获取窗口中的所有标签页
    const tabs = await chrome.tabs.query({ windowId });

    for (const tab of tabs) {
      try {
        // 注入 Canvas 噪声
        await this.fingerprintManager.injectCanvasNoise(tab.id);

        // 注入 Audio 噪声
        await this.fingerprintManager.injectAudioNoise(tab.id);

        // 注入 WebGL 欺骗
        await this.fingerprintManager.spoofWebGL(tab.id);

        // 注入配置文件
        await this.geoManager.injectProfile(tab.id, profile);
      } catch (e) {
        console.warn(`Failed to apply fingerprint protection to tab ${tab.id}:`, e);
      }
    }
  }

  // 切换代理
  async switchProxy(sessionId, proxyConfig) {
    const session = this.sessionManager.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 更新代理配置
    session.proxy = proxyConfig;

    // 应用新代理
    await this.sessionManager.applySessionProxy(session);

    // 更新状态
    await this.stateManager.setCurrentProxy(proxyConfig);

    // 通知 UI
    this.notifyStateChange();
  }

  // 处理消息
  handleMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'createSession':
        this.createIsolatedSession(message.accountId, message.options)
          .then(result => sendResponse({ success: true, data: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        break;

      case 'switchProxy':
        this.switchProxy(message.sessionId, message.proxyConfig)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        break;

      case 'closeSession':
        this.sessionManager.closeSession(message.sessionId)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        break;

      case 'getState':
        sendResponse(this.stateManager.getState());
        break;

      case 'getSessions':
        sendResponse(Array.from(this.sessionManager.activeSessions.values()));
        break;

      case 'addProxy':
        this.proxyPool.addProxy(message.proxyId, message.config);
        sendResponse({ success: true });
        break;

      case 'checkProxyHealth':
        this.proxyPool.checkProxyHealth(message.proxyId)
          .then(result => sendResponse({ success: true, healthy: result }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  }

  // 通知状态变化
  notifyStateChange() {
    chrome.runtime.sendMessage({ type: 'stateChanged' }).catch(() => {
      // 忽略错误（可能没有监听者）
    });
  }

  // 处理启动
  async handleStartup() {
    console.log('Proxy Manager started');
  }

  // 处理安装
  async handleInstall(details) {
    if (details.reason === 'install') {
      // 首次安装，初始化默认配置
      await this.configManager.initDefaults();
    }
  }

  // 恢复上次会话
  async restoreLastSession() {
    const lastSession = await chrome.storage.local.get('lastSession');
    if (lastSession.lastSession) {
      // 可以选择恢复上次会话
      console.log('Last session found:', lastSession.lastSession);
    }
  }
}

// 导出单例
const proxyManager = new ProxyManager();
```

### 11.2 配置管理器

```javascript
// proxy-config-manager.js

class ProxyConfigManager {
  constructor() {
    this.configs = new Map();
    this.profiles = new Map();
    this.storageKey = 'proxyConfigs';
  }

  // 加载配置
  async load() {
    const stored = await chrome.storage.local.get(this.storageKey);
    if (stored[this.storageKey]) {
      for (const [id, config] of Object.entries(stored[this.storageKey].proxies || {})) {
        this.configs.set(id, config);
      }
      for (const [id, profile] of Object.entries(stored[this.storageKey].profiles || {})) {
        this.profiles.set(id, profile);
      }
    }
  }

  // 保存配置
  async save() {
    const data = {
      proxies: Object.fromEntries(this.configs),
      profiles: Object.fromEntries(this.profiles)
    };
    await chrome.storage.local.set({ [this.storageKey]: data });
  }

  // 初始化默认配置
  async initDefaults() {
    // 添加一些默认代理配置模板
    this.configs.set('template_socks5', {
      id: 'template_socks5',
      name: 'SOCKS5 Template',
      scheme: 'socks5',
      host: '',
      port: 1080,
      username: '',
      password: ''
    });

    this.configs.set('template_http', {
      id: 'template_http',
      name: 'HTTP Template',
      scheme: 'http',
      host: '',
      port: 8080,
      username: '',
      password: ''
    });

    await this.save();
  }

  // 添加代理配置
  async addConfig(id, config) {
    this.configs.set(id, {
      id,
      ...config,
      createdAt: Date.now()
    });
    await this.save();
  }

  // 更新代理配置
  async updateConfig(id, updates) {
    const config = this.configs.get(id);
    if (config) {
      this.configs.set(id, {
        ...config,
        ...updates,
        updatedAt: Date.now()
      });
      await this.save();
    }
  }

  // 删除代理配置
  async deleteConfig(id) {
    this.configs.delete(id);
    await this.save();
  }

  // 获取配置
  getConfig(id) {
    return this.configs.get(id);
  }

  // 获取所有配置
  getAllConfigs() {
    return Array.from(this.configs.values());
  }

  // 添加配置文件
  async addProfile(id, profile) {
    this.profiles.set(id, {
      id,
      ...profile,
      createdAt: Date.now()
    });
    await this.save();
  }

  // 获取配置文件
  getProfile(id) {
    return this.profiles.get(id);
  }
}
```

### 11.3 指纹管理器

```javascript
// fingerprint-manager.js

class FingerprintManager {
  constructor() {
    this.noiseLevel = 0.0001;
  }

  // 注入 Canvas 噪声
  async injectCanvasNoise(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (level) => {
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;

        function addNoise(data) {
          for (let i = 0; i < data.length; i += 4) {
            const noise = Math.floor((Math.random() - 0.5) * level * 255);
            data[i] = Math.max(0, Math.min(255, data[i] + noise));
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
            data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
          }
        }

        HTMLCanvasElement.prototype.toDataURL = function(...args) {
          const ctx = this.getContext('2d');
          if (ctx && this.width > 0 && this.height > 0) {
            try {
              const imageData = ctx.getImageData(0, 0, this.width, this.height);
              addNoise(imageData.data);
              ctx.putImageData(imageData, 0, 0);
            } catch (e) {}
          }
          return originalToDataURL.apply(this, args);
        };

        CanvasRenderingContext2D.prototype.getImageData = function(x, y, w, h) {
          const imageData = originalGetImageData.call(this, x, y, w, h);
          addNoise(imageData.data);
          return imageData;
        };
      },
      args: [this.noiseLevel],
      injectImmediately: true,
      world: 'MAIN'
    });
  }

  // 注入 Audio 噪声
  async injectAudioNoise(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const originalCreateAnalyser = AudioContext.prototype.createAnalyser;
        const originalGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
        const originalGetByteFrequencyData = AnalyserNode.prototype.getByteFrequencyData;

        AnalyserNode.prototype.getFloatFrequencyData = function(array) {
          originalGetFloatFrequencyData.call(this, array);
          for (let i = 0; i < array.length; i++) {
            array[i] += (Math.random() - 0.5) * 0.1;
          }
        };

        AnalyserNode.prototype.getByteFrequencyData = function(array) {
          originalGetByteFrequencyData.call(this, array);
          for (let i = 0; i < array.length; i++) {
            array[i] = Math.max(0, Math.min(255, array[i] + Math.floor((Math.random() - 0.5) * 2)));
          }
        };
      },
      injectImmediately: true,
      world: 'MAIN'
    });
  }

  // 欺骗 WebGL
  async spoofWebGL(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const getParameterProxyHandler = {
          apply: function(target, thisArg, args) {
            const param = args[0];
            const result = target.apply(thisArg, args);

            // 欺骗渲染器信息
            const UNMASKED_VENDOR_WEBGL = 0x9245;
            const UNMASKED_RENDERER_WEBGL = 0x9246;

            if (param === UNMASKED_VENDOR_WEBGL) {
              return 'Google Inc. (NVIDIA)';
            }
            if (param === UNMASKED_RENDERER_WEBGL) {
              return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080 Direct3D11 vs_5_0 ps_5_0, D3D11)';
            }

            return result;
          }
        };

        // 代理 WebGL getParameter
        const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = new Proxy(originalGetParameter, getParameterProxyHandler);

        if (typeof WebGL2RenderingContext !== 'undefined') {
          const originalGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
          WebGL2RenderingContext.prototype.getParameter = new Proxy(originalGetParameter2, getParameterProxyHandler);
        }
      },
      injectImmediately: true,
      world: 'MAIN'
    });
  }

  // 禁用 WebRTC
  async disableWebRTC(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 禁用 RTCPeerConnection
        window.RTCPeerConnection = undefined;
        window.webkitRTCPeerConnection = undefined;
        window.mozRTCPeerConnection = undefined;

        // 禁用 getUserMedia
        if (navigator.mediaDevices) {
          navigator.mediaDevices.getUserMedia = undefined;
          navigator.mediaDevices.getDisplayMedia = undefined;
        }
      },
      injectImmediately: true,
      world: 'MAIN'
    });
  }
}
```

### 11.4 使用示例

```javascript
// 示例：创建多账号隔离环境

async function setupMultiAccountEnvironment() {
  // 初始化代理管理器
  const manager = new ProxyManager();

  // 添加代理到池
  manager.proxyPool.addProxy('us_proxy_1', {
    scheme: 'socks5',
    host: 'us-proxy1.example.com',
    port: 1080,
    username: 'user1',
    password: 'pass1'
  });

  manager.proxyPool.addProxy('uk_proxy_1', {
    scheme: 'socks5',
    host: 'uk-proxy1.example.com',
    port: 1080,
    username: 'user2',
    password: 'pass2'
  });

  // 创建账号绑定
  manager.sessionManager.accountProxyBinding.createBinding('account_1', {
    accountName: 'user1@example.com',
    proxy: {
      scheme: 'socks5',
      host: 'us-proxy1.example.com',
      port: 1080,
      username: 'user1',
      password: 'pass1'
    },
    profile: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      timezone: 'America/New_York',
      language: 'en-US'
    }
  });

  manager.sessionManager.accountProxyBinding.createBinding('account_2', {
    accountName: 'user2@example.com',
    proxy: {
      scheme: 'socks5',
      host: 'uk-proxy1.example.com',
      port: 1080,
      username: 'user2',
      password: 'pass2'
    },
    profile: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      timezone: 'Europe/London',
      language: 'en-GB'
    }
  });

  // 创建隔离会话
  const session1 = await manager.createIsolatedSession('account_1');
  console.log('Session 1 created:', session1);

  const session2 = await manager.createIsolatedSession('account_2');
  console.log('Session 2 created:', session2);

  // 两个会话现在使用不同的代理和配置文件
  // 实现了 IP 隔离和指纹隔离
}

// 运行示例
setupMultiAccountEnvironment();
```

---

## 参考资料

### 官方文档
- [Chrome Proxy API](https://developer.chrome.com/docs/extensions/reference/api/proxy)
- [Chrome WebRequestAuthProvider API](https://developer.chrome.com/docs/extensions/reference/api/webRequestAuthProvider)
- [PAC File Format](https://developer.mozilla.org/en-US/docs/Web/HTTP/Proxy_servers_and_tunneling/Proxy_Auto-Configuration_PAC_file)

### 相关技术
- [WebRTC IP Leak Prevention](https://github.com/aghorler/WebRTC-IP-Leak-Preventor)
- [Canvas Fingerprinting](https://browserleaks.com/canvas)
- [Browser Fingerprinting](https://fingerprint.com/blog/)

### 代理服务
- [SOCKS5 Protocol RFC 1928](https://datatracker.ietf.org/doc/html/rfc1928)
- [HTTP Proxy RFC 7230](https://datatracker.ietf.org/doc/html/rfc7230)

---

## 总结

代理级别的 Session/IP 隔离是多账号管理和防关联场景中的重要技术手段。通过 Chrome 扩展的 `chrome.proxy` API，可以实现灵活的代理配置和动态切换。结合 PAC 脚本、代理认证、指纹防护等技术，可以构建完整的隔离方案。

然而，代理隔离只是防关联的一部分，需要配合其他隔离措施（如 Cookie 隔离、指纹防护等）才能实现更全面的保护。在实际应用中，应根据具体需求选择合适的隔离策略和技术组合。
