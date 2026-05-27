# Chrome/Edge 扩展开发与多账号隔离技术资料

> 📚 **完整文档目录**：本概览文档提供技术方案总览，详细内容请参阅 [docs/](docs/) 目录下的专题文档。

## 详细文档索引

| 文档 | 内容 | 行数 |
|------|------|------|
| [01-extension-basics.md](docs/01-extension-basics.md) | Chrome 扩展开发基础 | ~1900 行 |
| [02-profiles-api.md](docs/02-profiles-api.md) | Profiles API 多账号方案 | - |
| [03-cookie-management.md](docs/03-cookie-management.md) | Cookie 管理隔离方案 | ~3100 行 |
| [04-tab-session-isolation.md](docs/04-tab-session-isolation.md) | 标签页级别隔离方案 | ~3500 行 |
| [05-container-isolation.md](docs/05-container-isolation.md) | Container 容器隔离方案 | ~1000 行 |
| [06-proxy-isolation.md](docs/06-proxy-isolation.md) | 代理隔离方案 | ~1500 行 |

## 一、Chrome/Edge 扩展开发基础

### 1.1 扩展架构概述

Chrome 和 Edge 都基于 Chromium 内核，使用相同的扩展 API（Manifest V3）。扩展主要由以下组件构成：

#### 核心组件

| 组件 | 说明 |
|------|------|
| **manifest.json** | 扩展配置文件，定义权限、资源、入口等 |
| **Service Worker** | 后台脚本，处理事件监听和长期运行的任务 |
| **Content Scripts** | 注入网页的脚本，可访问 DOM |
| **Popup/Options Page** | 用户界面页面 |

#### Manifest V3 关键特性

```json
{
  "manifest_version": 3,
  "name": "My Extension",
  "version": "1.0",
  "permissions": ["storage", "activeTab", "cookies"],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [{
    "matches": ["https://*.example.com/*"],
    "js": ["content.js"]
  }]
}
```

### 1.2 常用 API

| API | 用途 |
|-----|------|
| `chrome.storage` | 本地数据存储 |
| `chrome.cookies` | Cookie 管理 |
| `chrome.tabs` | 标签页操作 |
| `chrome.webRequest` | 网络请求拦截 |
| `chrome.windows` | 窗口管理 |
| `chrome.runtime` | 消息通信 |
| `chrome.identity` | OAuth 认证 |

---

## 二、多账号信息隔离实现方案

### 2.1 方案一：Chrome Profiles API（推荐）

Chrome 提供原生的多配置文件支持，每个 Profile 拥有独立的：
- Cookies
- LocalStorage
- Session Storage
- 浏览历史
- 书签

#### 相关 API

```javascript
// 获取当前配置文件信息
chrome.profiles.getProfileInfo((profileInfo) => {
  console.log(profileInfo.id, profileInfo.name);
});

// 监听配置文件切换
chrome.profiles.onProfileChanged.addListener((profileId) => {
  console.log('Switched to profile:', profileId);
});
```

**优点**：
- 浏览器原生支持，隔离彻底
- 每个配置文件完全独立
- 稳定性高

**缺点**：
- 需要用户手动切换配置文件
- 不能在同一窗口中同时使用多个账号

### 2.2 方案二：Cookie 隔离管理

通过扩展手动管理 Cookie，实现同一浏览器实例的多账号隔离。

#### Cookie 操作 API

```javascript
// 获取 Cookie
chrome.cookies.get({ url: 'https://example.com', name: 'session_id' }, (cookie) => {
  console.log(cookie);
});

// 设置 Cookie
chrome.cookies.set({
  url: 'https://example.com',
  name: 'session_id',
  value: 'user1_session',
  domain: '.example.com',
  path: '/',
  secure: true,
  httpOnly: true,
  expirationDate: Date.now() / 1000 + 3600
}, (cookie) => {
  console.log('Cookie set:', cookie);
});

// 删除 Cookie
chrome.cookies.remove({ url: 'https://example.com', name: 'session_id' });

// 获取所有 Cookie
chrome.cookies.getAll({ domain: '.example.com' }, (cookies) => {
  console.log(cookies);
});
```

#### 多账号 Cookie 存储

```javascript
// 账号 Cookie 映射存储
class MultiAccountCookieManager {
  constructor() {
    this.accounts = {}; // { accountId: { cookies: [] } }
  }

  // 保存当前账号的 Cookies
  async saveAccountCookies(accountId, domain) {
    const cookies = await chrome.cookies.getAll({ domain });
    this.accounts[accountId] = { cookies };
    await chrome.storage.local.set({ accounts: this.accounts });
  }

  // 切换账号
  async switchAccount(accountId, domain) {
    // 清除当前 Cookies
    const currentCookies = await chrome.cookies.getAll({ domain });
    for (const cookie of currentCookies) {
      await chrome.cookies.remove({ url: `https://${cookie.domain}`, name: cookie.name });
    }

    // 加载目标账号 Cookies
    const account = this.accounts[accountId];
    if (account && account.cookies) {
      for (const cookie of account.cookies) {
        await chrome.cookies.set({
          url: `https://${cookie.domain}`,
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate: cookie.expirationDate
        });
      }
    }
  }
}
```

**优点**：
- 灵活性高，可自定义隔离规则
- 用户无感知切换

**缺点**：
- 实现复杂，需处理 Cookie 过期、更新等
- LocalStorage/Session Storage 需额外处理

### 2.3 方案三：标签页级别隔离（SessionBox 方式）

为每个标签页分配独立的会话上下文，通过请求拦截实现隔离。

#### 实现思路

```javascript
// background.js
class TabSessionManager {
  constructor() {
    this.tabSessions = new Map(); // tabId -> { accountId, cookies }
  }

  // 为标签页绑定账号
  bindTabToAccount(tabId, accountId) {
    this.tabSessions.set(tabId, { accountId });
  }

  // 拦截请求，注入对应账号的 Cookie
  interceptRequest(details) {
    const session = this.tabSessions.get(details.tabId);
    if (session && session.cookies) {
      const headers = details.requestHeaders || [];
      // 添加账号对应的 Cookie
      headers.push({
        name: 'Cookie',
        value: session.cookies.map(c => `${c.name}=${c.value}`).join('; ')
      });
      return { requestHeaders: headers };
    }
  }
}

// 使用 webRequest API 拦截请求
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => sessionManager.interceptRequest(details),
  { urls: ['<all_urls>'] },
  ['requestHeaders', 'extraHeaders']
);
```

**优点**：
- 同一浏览器窗口可同时登录多个账号
- 标签页级别隔离，体验流畅

**缺点**：
- 实现复杂度高
- 需要处理 Cookie 同步、过期等问题
- 对 HTTPS 网站可能受限

### 2.4 方案四：使用 Container Tabs（Firefox 风格）

Firefox 的 Multi-Account Containers 扩展提供了标签页容器隔离功能。Chrome 可通过类似方式实现：

#### 关键技术点

1. **存储隔离**：每个容器使用独立的存储命名空间
2. **Cookie 隔离**：通过请求拦截实现 Cookie 隔离
3. **视觉区分**：为不同容器的标签页添加视觉标识

```javascript
// 容器存储管理
class ContainerStorage {
  constructor() {
    this.containers = new Map();
  }

  // 获取容器专属存储
  getContainerStorage(containerId) {
    return {
      async get(key) {
        const data = await chrome.storage.local.get(`container_${containerId}_${key}`);
        return data;
      },
      async set(key, value) {
        await chrome.storage.local.set({ [`container_${containerId}_${key}`]: value });
      }
    };
  }
}
```

### 2.5 方案五：代理 + 隔离

通过为不同账号配置不同的代理，实现 IP 级别的隔离。

#### 代理配置 API

```javascript
// 使用 chrome.proxy API
chrome.proxy.settings.set({
  value: {
    mode: 'pac_script',
    pacScript: {
      data: `
        function FindProxyForURL(url, host) {
          if (shExpMatch(host, "*.example.com")) {
            return "PROXY proxy1.example.com:8080";
          }
          return "DIRECT";
        }
      `
    }
  },
  scope: 'regular'
}, () => {});
```

**优点**：
- 可实现 IP 级别隔离
- 适合需要防关联的场景

**缺点**：
- 需要代理服务器资源
- 可能影响网络速度

---

## 三、完整实现示例

### 3.1 多账号管理扩展架构

```
my-multi-account-extension/
├── manifest.json
├── background.js          # Service Worker，管理账号状态
├── popup/
│   ├── popup.html
│   └── popup.js           # 账号列表、切换界面
├── content/
│   └── content.js         # 页面注入，处理页面级操作
└── lib/
    ├── accountManager.js  # 账号管理核心逻辑
    ├── cookieManager.js   # Cookie 操作封装
    └── storageManager.js  # 存储操作封装
```

### 3.2 账号管理核心代码

```javascript
// accountManager.js
class AccountManager {
  constructor() {
    this.currentAccount = null;
    this.accounts = new Map();
  }

  // 添加账号
  async addAccount(accountId, config) {
    const account = {
      id: accountId,
      cookies: {},
      localStorage: {},
      config
    };
    this.accounts.set(accountId, account);
    await this.saveAccounts();
  }

  // 切换账号
  async switchAccount(accountId) {
    if (!this.accounts.has(accountId)) {
      throw new Error('Account not found');
    }

    // 保存当前账号状态
    if (this.currentAccount) {
      await this.saveCurrentState();
    }

    // 清除当前会话数据
    await this.clearSession();

    // 加载目标账号状态
    await this.loadAccountState(accountId);

    this.currentAccount = accountId;

    // 刷新页面
    chrome.tabs.query({ active: true }, (tabs) => {
      chrome.tabs.reload(tabs[0].id);
    });
  }

  // 保存当前状态
  async saveCurrentState() {
    const account = this.accounts.get(this.currentAccount);
    // 保存 Cookies
    account.cookies = await this.getAllCookies();
    // 保存到 storage
    await chrome.storage.local.set({ accounts: Object.fromEntries(this.accounts) });
  }

  // 加载账号状态
  async loadAccountState(accountId) {
    const account = this.accounts.get(accountId);
    // 恢复 Cookies
    for (const cookie of Object.values(account.cookies)) {
      await chrome.cookies.set(cookie);
    }
  }

  // 清除会话
  async clearSession() {
    const cookies = await chrome.cookies.getAll({});
    for (const cookie of cookies) {
      await chrome.cookies.remove({
        url: `https://${cookie.domain}${cookie.path}`,
        name: cookie.name
      });
    }
  }
}
```

---

## 四、注意事项与最佳实践

### 4.1 权限配置

```json
{
  "permissions": [
    "cookies",
    "storage",
    "tabs",
    "webRequest",
    "webRequestAuthProvider"
  ],
  "host_permissions": [
    "<all_urls>"
  ]
}
```

### 4.2 安全考虑

1. **敏感数据加密**：账号 Cookie 等敏感数据应加密存储
2. **最小权限原则**：只请求必要的权限
3. **数据隔离**：确保不同账号数据不会交叉污染

### 4.3 性能优化

1. **批量操作**：Cookie 操作尽量批量处理
2. **缓存策略**：缓存常用数据，减少 storage 读取
3. **异步处理**：使用 async/await 避免阻塞

---

## 五、参考资料

### 官方文档

- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [Chrome Extensions API Reference](https://developer.chrome.com/docs/extensions/reference/)
- [Microsoft Edge Extensions](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/)
- [MDN WebExtensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)

### 相关 API

- [chrome.cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies)
- [chrome.storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [chrome.webRequest API](https://developer.chrome.com/docs/extensions/reference/api/webRequest)
- [chrome.tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [chrome.profiles API](https://developer.chrome.com/docs/extensions/reference/api/profiles)
- [chrome.proxy API](https://developer.chrome.com/docs/extensions/reference/api/proxy)
- [chrome.identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)

### 开源项目参考

- [SessionBox](https://sessionbox.io/) - 多账号管理扩展
- [Firefox Multi-Account Containers](https://github.com/mozilla/multi-account-containers) - Mozilla 官方容器扩展
- [Chrome Extension Samples](https://github.com/GoogleChrome/chrome-extensions-samples) - Chrome 官方示例

---

## 六、总结

| 方案 | 隔离级别 | 实现难度 | 适用场景 |
|------|----------|----------|----------|
| Chrome Profiles | 完全隔离 | 低 | 需要完全独立的环境 |
| Cookie 管理 | Cookie 级别 | 中 | 简单的多账号切换 |
| 标签页隔离 | 标签页级别 | 高 | 同时操作多个账号 |
| Container 方式 | 容器级别 | 高 | 类似 Firefox 体验 |
| 代理隔离 | IP 级别 | 中 | 防关联需求 |

选择合适的方案取决于具体需求：
- **简单场景**：Cookie 管理方案
- **同时多账号**：标签页隔离或 Container 方案
- **防关联需求**：代理隔离或 Chrome Profiles
