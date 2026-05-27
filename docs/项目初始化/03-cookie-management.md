# Cookie 管理实现多账号隔离详解

本文档详细介绍如何使用 Chrome 扩展的 `chrome.cookies` API 实现多账号隔离，包括完整的 API 方法、Cookie 属性、存储恢复流程以及生产级代码实现。

---

## 一、chrome.cookies API 完整方法详解

### 1.1 API 概述

`chrome.cookies` API 允许扩展查询和修改 Cookie，需要以下权限配置：

```json
{
  "permissions": ["cookies"],
  "host_permissions": ["<all_urls>"]
}
```

**权限说明**：
- `cookies`：允许使用 cookies API
- `host_permissions`：指定可以访问 Cookie 的域名范围，`<all_urls>` 表示所有域名

### 1.2 chrome.cookies.get()

获取单个 Cookie 的详细信息。

**语法**：
```javascript
chrome.cookies.get(details, callback)
```

**参数 details 对象**：

| 属性 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `url` | string | 是 | 与 Cookie 关联的 URL，必须包含协议（http/https） |
| `name` | string | 是 | Cookie 名称 |
| `storeId` | string | 否 | Cookie 存储区 ID，默认使用当前执行上下文的存储区 |

**返回值**：
- 成功时返回 `Cookie` 对象
- 未找到时返回 `null`

**示例代码**：
```javascript
// 获取指定 Cookie
chrome.cookies.get(
  {
    url: 'https://www.example.com',
    name: 'session_id'
  },
  (cookie) => {
    if (cookie) {
      console.log('Cookie found:', cookie);
      console.log('Value:', cookie.value);
      console.log('Domain:', cookie.domain);
      console.log('Expires:', new Date(cookie.expirationDate * 1000));
    } else {
      console.log('Cookie not found');
    }
  }
);

// Promise 版本（Chrome 116+）
async function getCookie(url, name) {
  const cookie = await chrome.cookies.get({ url, name });
  return cookie;
}
```

**注意事项**：
- `url` 参数必须与 Cookie 的 domain 和 path 匹配
- 对于 domain 以 `.` 开头的 Cookie，url 可以是该域下的任意子域名

### 1.3 chrome.cookies.getAll()

获取符合指定条件的所有 Cookie。

**语法**：
```javascript
chrome.cookies.getAll(details, callback)
```

**参数 details 对象（所有属性均为可选）**：

| 属性 | 类型 | 说明 |
|------|------|------|
| `url` | string | 筛选与该 URL 关联的 Cookie |
| `name` | string | 筛选指定名称的 Cookie |
| `domain` | string | 筛选指定域名的 Cookie，支持通配符（如 `.example.com`） |
| `path` | string | 筛选指定路径的 Cookie |
| `secure` | boolean | 筛选 Secure 属性的 Cookie |
| `session` | boolean | `true` 筛选会话 Cookie，`false` 筛选持久 Cookie |
| `storeId` | string | 指定 Cookie 存储区 |

**返回值**：
- 返回 `Cookie[]` 数组

**示例代码**：
```javascript
// 获取指定域名的所有 Cookie
chrome.cookies.getAll({ domain: '.example.com' }, (cookies) => {
  console.log(`Found ${cookies.length} cookies`);
  cookies.forEach(cookie => {
    console.log(`${cookie.name}: ${cookie.value}`);
  });
});

// 获取所有 Cookie
chrome.cookies.getAll({}, (cookies) => {
  console.log(`Total cookies: ${cookies.length}`);
});

// 获取会话 Cookie
chrome.cookies.getAll({ session: true }, (cookies) => {
  console.log(`Session cookies: ${cookies.length}`);
});

// 获取安全 Cookie
chrome.cookies.getAll({ secure: true, domain: '.google.com' }, (cookies) => {
  console.log(`Secure Google cookies: ${cookies.length}`);
});

// Promise 版本
async function getAllCookies(domain) {
  const cookies = await chrome.cookies.getAll({ domain });
  return cookies;
}

// 获取多个域名的 Cookie
async function getCookiesForDomains(domains) {
  const allCookies = [];
  for (const domain of domains) {
    const cookies = await chrome.cookies.getAll({ domain });
    allCookies.push(...cookies);
  }
  return allCookies;
}
```

### 1.4 chrome.cookies.set()

创建或更新 Cookie。

**语法**：
```javascript
chrome.cookies.set(details, callback)
```

**参数 details 对象**：

| 属性 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `url` | string | 是 | 与 Cookie 关联的 URL |
| `name` | string | 是 | Cookie 名称 |
| `value` | string | 是 | Cookie 值 |
| `domain` | string | 否 | Cookie 域名，默认为 url 的域名 |
| `path` | string | 否 | Cookie 路径，默认为 '/' |
| `secure` | boolean | 否 | 是否仅通过 HTTPS 传输，默认 false |
| `httpOnly` | boolean | 否 | 是否禁止 JavaScript 访问，默认 false |
| `expirationDate` | number | 否 | 过期时间（Unix 时间戳，秒），不设置则为会话 Cookie |
| `sameSite` | string | 否 | SameSite 属性：`unspecified`、`no_restriction`、`lax`、`strict` |
| `storeId` | string | 否 | Cookie 存储区 ID |

**返回值**：
- 成功时返回创建的 `Cookie` 对象
- 失败时返回 `null`（如参数无效或权限不足）

**示例代码**：
```javascript
// 创建会话 Cookie
chrome.cookies.set(
  {
    url: 'https://www.example.com',
    name: 'session_token',
    value: 'abc123xyz'
  },
  (cookie) => {
    if (cookie) {
      console.log('Session cookie created:', cookie);
    }
  }
);

// 创建持久 Cookie（有效期 7 天）
chrome.cookies.set(
  {
    url: 'https://www.example.com',
    name: 'remember_me',
    value: 'true',
    expirationDate: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  },
  (cookie) => {
    console.log('Persistent cookie created');
  }
);

// 创建安全 Cookie
chrome.cookies.set(
  {
    url: 'https://secure.example.com',
    name: 'auth_token',
    value: 'secret_token_value',
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
    expirationDate: Math.floor(Date.now() / 1000) + 3600
  },
  (cookie) => {
    console.log('Secure cookie created');
  }
);

// 创建跨子域名 Cookie
chrome.cookies.set(
  {
    url: 'https://www.example.com',
    name: 'user_preference',
    value: 'dark_mode',
    domain: '.example.com',  // 前导点表示所有子域名
    path: '/',
    expirationDate: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
  },
  (cookie) => {
    console.log('Cross-subdomain cookie created');
  }
);

// Promise 版本
async function setCookie(options) {
  const cookie = await chrome.cookies.set(options);
  if (!cookie) {
    throw new Error('Failed to set cookie');
  }
  return cookie;
}
```

### 1.5 chrome.cookies.remove()

删除指定的 Cookie。

**语法**：
```javascript
chrome.cookies.remove(details, callback)
```

**参数 details 对象**：

| 属性 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `url` | string | 是 | 与 Cookie 关联的 URL |
| `name` | string | 是 | Cookie 名称 |
| `storeId` | string | 否 | Cookie 存储区 ID |

**返回值**：
- 成功时返回包含 `url`、`name`、`storeId` 的对象
- 失败时返回 `null`

**示例代码**：
```javascript
// 删除单个 Cookie
chrome.cookies.remove(
  {
    url: 'https://www.example.com',
    name: 'session_id'
  },
  (result) => {
    if (result) {
      console.log('Cookie removed:', result);
    } else {
      console.log('Failed to remove cookie');
    }
  }
);

// Promise 版本
async function removeCookie(url, name) {
  const result = await chrome.cookies.remove({ url, name });
  return result !== null;
}

// 删除指定域名的所有 Cookie
async function clearDomainCookies(domain) {
  const cookies = await chrome.cookies.getAll({ domain });
  let removed = 0;
  for (const cookie of cookies) {
    const url = `https://${cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`;
    const result = await chrome.cookies.remove({ url, name: cookie.name });
    if (result) removed++;
  }
  return removed;
}

// 删除所有 Cookie
async function clearAllCookies() {
  const cookies = await chrome.cookies.getAll({});
  let removed = 0;
  for (const cookie of cookies) {
    const protocol = cookie.secure ? 'https' : 'http';
    const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
    const url = `${protocol}://${domain}${cookie.path}`;
    const result = await chrome.cookies.remove({ url, name: cookie.name });
    if (result) removed++;
  }
  return removed;
}
```

---

## 二、Cookie 属性详解

### 2.1 Cookie 对象结构

`chrome.cookies` API 返回的 Cookie 对象包含以下属性：

```javascript
{
  name: string,           // Cookie 名称
  value: string,          // Cookie 值
  domain: string,         // Cookie 域名（可能以 '.' 开头）
  path: string,           // Cookie 路径
  secure: boolean,        // 是否仅通过 HTTPS 传输
  httpOnly: boolean,      // 是否禁止 JavaScript 访问
  session: boolean,       // 是否为会话 Cookie（无过期时间）
  expirationDate: number, // 过期时间（Unix 时间戳，秒），会话 Cookie 无此属性
  sameSite: string,       // SameSite 属性
  storeId: string         // Cookie 存储区 ID
}
```

### 2.2 domain 属性

**作用**：指定 Cookie 有效的域名范围。

**规则**：
- 精确域名：`www.example.com` - 仅在该精确域名下有效
- 通配域名：`.example.com` - 在所有子域名下有效（如 `www.example.com`、`api.example.com`、`app.example.com`）

**示例**：
```javascript
// 精确域名 Cookie - 仅 www.example.com 可访问
chrome.cookies.set({
  url: 'https://www.example.com',
  name: 'www_only',
  value: 'value1',
  domain: 'www.example.com'  // 无前导点
});

// 通配域名 Cookie - 所有 example.com 子域名可访问
chrome.cookies.set({
  url: 'https://www.example.com',
  name: 'all_subdomains',
  value: 'value2',
  domain: '.example.com'  // 有前导点
});
```

**注意事项**：
- 设置 Cookie 时，domain 必须与 url 的域名匹配或为其父域名
- 不能为其他顶级域名设置 Cookie（安全限制）
- 获取 Cookie 时，domain 筛选支持通配符匹配

### 2.3 path 属性

**作用**：指定 Cookie 有效的 URL 路径范围。

**规则**：
- `/`：整个网站有效（默认值）
- `/admin`：仅在 `/admin` 路径及其子路径下有效
- `/api/v1`：仅在 `/api/v1` 路径及其子路径下有效

**示例**：
```javascript
// 全站 Cookie
chrome.cookies.set({
  url: 'https://example.com',
  name: 'global_setting',
  value: 'theme_dark',
  path: '/'
});

// 仅 API 路径 Cookie
chrome.cookies.set({
  url: 'https://example.com/api',
  name: 'api_token',
  value: 'token123',
  path: '/api'
});
```

### 2.4 secure 属性

**作用**：指定 Cookie 是否仅通过 HTTPS 连接传输。

**规则**：
- `true`：Cookie 仅通过 HTTPS 传输，HTTP 请求不会携带
- `false`：Cookie 可通过 HTTP 和 HTTPS 传输

**安全建议**：
- 对于包含敏感信息的 Cookie（如认证令牌），应设置 `secure: true`
- 现代浏览器对非安全 Cookie 有越来越多的限制

**示例**：
```javascript
// 安全 Cookie - 仅 HTTPS
chrome.cookies.set({
  url: 'https://secure.example.com',
  name: 'auth_token',
  value: 'sensitive_token',
  secure: true
});
```

### 2.5 httpOnly 属性

**作用**：防止客户端脚本访问 Cookie，防止 XSS 攻击窃取 Cookie。

**规则**：
- `true`：JavaScript 无法通过 `document.cookie` 访问该 Cookie
- `false`：JavaScript 可以访问该 Cookie（默认）

**安全建议**：
- 对于会话 Cookie 和认证令牌，应设置 `httpOnly: true`
- 注意：`chrome.cookies` API 仍可访问 httpOnly Cookie（扩展权限）

**示例**：
```javascript
// HttpOnly Cookie - 防止 XSS 攻击
chrome.cookies.set({
  url: 'https://example.com',
  name: 'session_id',
  value: 'session_value',
  httpOnly: true,
  secure: true
});
```

### 2.6 expirationDate 属性

**作用**：指定 Cookie 的过期时间。

**规则**：
- 不设置：会话 Cookie，浏览器关闭后删除
- 设置值：持久 Cookie，Unix 时间戳（秒）

**时间计算**：
```javascript
// 当前时间 + 1 小时
const oneHour = Math.floor(Date.now() / 1000) + 3600;

// 当前时间 + 1 天
const oneDay = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

// 当前时间 + 30 天
const thirtyDays = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

// 当前时间 + 1 年
const oneYear = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

// 特定日期
const specificDate = Math.floor(new Date('2025-12-31').getTime() / 1000);
```

**示例**：
```javascript
// 会话 Cookie
chrome.cookies.set({
  url: 'https://example.com',
  name: 'temp_data',
  value: 'temporary'
  // 不设置 expirationDate
});

// 持久 Cookie
chrome.cookies.set({
  url: 'https://example.com',
  name: 'remember_me',
  value: 'true',
  expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
});
```

### 2.7 sameSite 属性

**作用**：控制跨站请求时 Cookie 的发送行为，防止 CSRF 攻击。

**可选值**：

| 值 | 说明 | 跨站请求行为 |
|----|----|----|
| `strict` | 严格模式 | 完全禁止跨站请求携带 Cookie |
| `lax` | 宽松模式（默认） | 允许顶级导航的 GET 请求携带 Cookie |
| `no_restriction` | 无限制 | 允许所有跨站请求携带 Cookie |
| `unspecified` | 未指定 | 使用浏览器默认行为 |

**SameSite 行为详解**：

```
场景：用户在 site-a.com，点击链接跳转到 site-b.com

SameSite=Strict:
  - site-b.com 的 Cookie 不会发送（用户需要重新登录）

SameSite=Lax:
  - 顶级导航 GET 请求会发送 Cookie
  - 子资源请求（img、script、iframe）不发送
  - POST 表单提交不发送

SameSite=None:
  - 所有请求都发送 Cookie
  - 必须配合 Secure 属性使用
```

**示例**：
```javascript
// 严格模式 - 最安全
chrome.cookies.set({
  url: 'https://banking.example.com',
  name: 'auth_token',
  value: 'secure_token',
  sameSite: 'strict',
  secure: true
});

// 宽松模式 - 平衡安全与可用性
chrome.cookies.set({
  url: 'https://shop.example.com',
  name: 'cart_id',
  value: 'cart123',
  sameSite: 'lax'
});

// 无限制 - 允许跨站使用
chrome.cookies.set({
  url: 'https://analytics.example.com',
  name: 'tracking_id',
  value: 'track123',
  sameSite: 'no_restriction',
  secure: true  // SameSite=None 必须配合 Secure
});
```

### 2.8 storeId 属性

**作用**：标识 Cookie 所属的存储区，用于多配置文件场景。

**场景**：
- Chrome 支持多个用户配置文件（Profiles）
- 每个配置文件有独立的 Cookie 存储
- `storeId` 用于区分不同配置文件的 Cookie

**获取 storeId**：
```javascript
// 获取所有 Cookie 存储区
chrome.cookies.getAllCookieStores((stores) => {
  stores.forEach(store => {
    console.log('Store ID:', store.id);
    console.log('Tab IDs:', store.tabIds);
  });
});
```

---

## 三、Cookie 存储和恢复的完整实现流程

### 3.1 存储流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Cookie 存储流程                           │
├─────────────────────────────────────────────────────────────┤
│  1. 获取当前账号标识                                          │
│     └─> accountId: string                                   │
│                                                             │
│  2. 获取目标域名的所有 Cookie                                  │
│     └─> chrome.cookies.getAll({ domain })                   │
│                                                             │
│  3. 过滤和转换 Cookie 数据                                     │
│     ├─> 移除不需要的 Cookie（如临时 Cookie）                    │
│     ├─> 检查 Cookie 是否过期                                  │
│     └─> 序列化 Cookie 对象                                    │
│                                                             │
│  4. 存储到 chrome.storage.local                              │
│     └─> { [accountId]: { cookies, timestamp, metadata } }   │
│                                                             │
│  5. 可选：加密敏感数据                                         │
│     └─> 使用 Web Crypto API 加密                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 恢复流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Cookie 恢复流程                           │
├─────────────────────────────────────────────────────────────┤
│  1. 获取目标账号标识                                          │
│     └─> accountId: string                                   │
│                                                             │
│  2. 从 chrome.storage.local 读取存储的 Cookie                │
│     └─> chrome.storage.local.get(accountId)                 │
│                                                             │
│  3. 可选：解密敏感数据                                        │
│     └─> 使用 Web Crypto API 解密                             │
│                                                             │
│  4. 清除当前 Cookie                                          │
│     ├─> 获取当前所有 Cookie                                   │
│     └─> 逐个删除                                             │
│                                                             │
│  5. 恢复存储的 Cookie                                         │
│     ├─> 检查 Cookie 是否过期                                  │
│     ├─> 构造 Cookie 设置参数                                  │
│     └─> chrome.cookies.set() 设置每个 Cookie                 │
│                                                             │
│  6. 验证恢复结果                                              │
│     └─> 检查关键 Cookie 是否存在                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 完整实现代码

```javascript
// cookieManager.js - Cookie 管理核心类

class CookieManager {
  constructor() {
    this.STORAGE_KEY = 'multi_account_cookies';
    this.ENCRYPTION_KEY = null; // 可选：用于加密
  }

  /**
   * 获取指定域名的所有 Cookie
   * @param {string} domain - 目标域名
   * @returns {Promise<Array>} Cookie 数组
   */
  async getCookies(domain) {
    return new Promise((resolve, reject) => {
      chrome.cookies.getAll({ domain }, (cookies) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(cookies || []);
        }
      });
    });
  }

  /**
   * 获取多个域名的所有 Cookie
   * @param {Array<string>} domains - 域名数组
   * @returns {Promise<Array>} Cookie 数组
   */
  async getCookiesForDomains(domains) {
    const allCookies = [];
    for (const domain of domains) {
      const cookies = await this.getCookies(domain);
      allCookies.push(...cookies);
    }
    return allCookies;
  }

  /**
   * 序列化 Cookie 对象用于存储
   * @param {Object} cookie - Cookie 对象
   * @returns {Object} 可序列化的 Cookie 对象
   */
  serializeCookie(cookie) {
    return {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: cookie.secure || false,
      httpOnly: cookie.httpOnly || false,
      expirationDate: cookie.expirationDate,
      sameSite: cookie.sameSite || 'unspecified',
      storeId: cookie.storeId
    };
  }

  /**
   * 检查 Cookie 是否已过期
   * @param {Object} cookie - Cookie 对象
   * @returns {boolean} 是否过期
   */
  isCookieExpired(cookie) {
    if (!cookie.expirationDate) {
      return false; // 会话 Cookie 不过期
    }
    return cookie.expirationDate * 1000 < Date.now();
  }

  /**
   * 过滤有效的 Cookie
   * @param {Array} cookies - Cookie 数组
   * @returns {Array} 有效的 Cookie 数组
   */
  filterValidCookies(cookies) {
    return cookies.filter(cookie => {
      // 过滤过期 Cookie
      if (this.isCookieExpired(cookie)) {
        return false;
      }
      // 可选：过滤特定名称的 Cookie
      // if (cookie.name.startsWith('_temp_')) {
      //   return false;
      // }
      return true;
    });
  }

  /**
   * 保存账号的 Cookie
   * @param {string} accountId - 账号标识
   * @param {Array<string>} domains - 要保存的域名列表
   * @param {Object} metadata - 账号元数据
   * @returns {Promise<Object>} 保存结果
   */
  async saveAccountCookies(accountId, domains, metadata = {}) {
    try {
      // 获取所有域名的 Cookie
      const cookies = await this.getCookiesForDomains(domains);

      // 过滤有效 Cookie
      const validCookies = this.filterValidCookies(cookies);

      // 序列化 Cookie
      const serializedCookies = validCookies.map(c => this.serializeCookie(c));

      // 构建存储数据
      const accountData = {
        id: accountId,
        cookies: serializedCookies,
        domains: domains,
        savedAt: Date.now(),
        metadata: {
          name: metadata.name || accountId,
          avatar: metadata.avatar || null,
          ...metadata
        }
      };

      // 读取现有数据
      const storage = await chrome.storage.local.get(this.STORAGE_KEY);
      const accounts = storage[this.STORAGE_KEY] || {};

      // 更新账号数据
      accounts[accountId] = accountData;

      // 保存到 storage
      await chrome.storage.local.set({ [this.STORAGE_KEY]: accounts });

      return {
        success: true,
        accountId,
        cookieCount: serializedCookies.length,
        savedAt: accountData.savedAt
      };
    } catch (error) {
      console.error('Failed to save account cookies:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 清除指定域名的所有 Cookie
   * @param {string} domain - 目标域名
   * @returns {Promise<number>} 删除的 Cookie 数量
   */
  async clearDomainCookies(domain) {
    const cookies = await this.getCookies(domain);
    let removed = 0;

    for (const cookie of cookies) {
      const url = this.buildCookieUrl(cookie);
      try {
        await this.removeCookie(url, cookie.name);
        removed++;
      } catch (error) {
        console.warn(`Failed to remove cookie ${cookie.name}:`, error);
      }
    }

    return removed;
  }

  /**
   * 清除多个域名的所有 Cookie
   * @param {Array<string>} domains - 域名数组
   * @returns {Promise<number>} 删除的 Cookie 数量
   */
  async clearDomainsCookies(domains) {
    let totalRemoved = 0;
    for (const domain of domains) {
      totalRemoved += await this.clearDomainCookies(domain);
    }
    return totalRemoved;
  }

  /**
   * 构建 Cookie URL
   * @param {Object} cookie - Cookie 对象
   * @returns {string} URL 字符串
   */
  buildCookieUrl(cookie) {
    const protocol = cookie.secure ? 'https' : 'http';
    const domain = cookie.domain.startsWith('.')
      ? cookie.domain.slice(1)
      : cookie.domain;
    return `${protocol}://${domain}${cookie.path || '/'}`;
  }

  /**
   * 设置单个 Cookie
   * @param {Object} cookieData - Cookie 数据
   * @returns {Promise<Object>} 设置的 Cookie
   */
  async setCookie(cookieData) {
    return new Promise((resolve, reject) => {
      const details = {
        url: this.buildCookieUrl(cookieData),
        name: cookieData.name,
        value: cookieData.value,
        domain: cookieData.domain,
        path: cookieData.path || '/',
        secure: cookieData.secure || false,
        httpOnly: cookieData.httpOnly || false,
        sameSite: cookieData.sameSite || 'unspecified'
      };

      // 只有持久 Cookie 才设置过期时间
      if (cookieData.expirationDate && !cookieData.session) {
        details.expirationDate = cookieData.expirationDate;
      }

      chrome.cookies.set(details, (cookie) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(cookie);
        }
      });
    });
  }

  /**
   * 删除单个 Cookie
   * @param {string} url - Cookie URL
   * @param {string} name - Cookie 名称
   * @returns {Promise<boolean>} 是否成功
   */
  async removeCookie(url, name) {
    return new Promise((resolve, reject) => {
      chrome.cookies.remove({ url, name }, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result !== null);
        }
      });
    });
  }

  /**
   * 恢复账号的 Cookie
   * @param {string} accountId - 账号标识
   * @param {boolean} clearExisting - 是否清除现有 Cookie
   * @returns {Promise<Object>} 恢复结果
   */
  async restoreAccountCookies(accountId, clearExisting = true) {
    try {
      // 读取存储的账号数据
      const storage = await chrome.storage.local.get(this.STORAGE_KEY);
      const accounts = storage[this.STORAGE_KEY] || {};
      const accountData = accounts[accountId];

      if (!accountData) {
        throw new Error(`Account ${accountId} not found`);
      }

      // 清除现有 Cookie
      if (clearExisting && accountData.domains) {
        await this.clearDomainsCookies(accountData.domains);
      }

      // 恢复 Cookie
      const cookies = accountData.cookies || [];
      let restored = 0;
      let failed = 0;
      const errors = [];

      for (const cookieData of cookies) {
        // 检查是否过期
        if (cookieData.expirationDate && cookieData.expirationDate * 1000 < Date.now()) {
          console.warn(`Cookie ${cookieData.name} has expired, skipping`);
          continue;
        }

        try {
          await this.setCookie(cookieData);
          restored++;
        } catch (error) {
          failed++;
          errors.push({
            cookie: cookieData.name,
            error: error.message
          });
        }
      }

      return {
        success: true,
        accountId,
        restored,
        failed,
        errors: errors.length > 0 ? errors : undefined,
        restoredAt: Date.now()
      };
    } catch (error) {
      console.error('Failed to restore account cookies:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取所有保存的账号列表
   * @returns {Promise<Array>} 账号列表
   */
  async getAccountList() {
    const storage = await chrome.storage.local.get(this.STORAGE_KEY);
    const accounts = storage[this.STORAGE_KEY] || {};

    return Object.values(accounts).map(account => ({
      id: account.id,
      name: account.metadata?.name || account.id,
      cookieCount: account.cookies?.length || 0,
      savedAt: account.savedAt,
      domains: account.domains
    }));
  }

  /**
   * 删除账号数据
   * @param {string} accountId - 账号标识
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteAccount(accountId) {
    const storage = await chrome.storage.local.get(this.STORAGE_KEY);
    const accounts = storage[this.STORAGE_KEY] || {};

    if (accounts[accountId]) {
      delete accounts[accountId];
      await chrome.storage.local.set({ [this.STORAGE_KEY]: accounts });
      return true;
    }

    return false;
  }

  /**
   * 更新账号 Cookie（增量更新）
   * @param {string} accountId - 账号标识
   * @param {Array<string>} domains - 域名列表
   * @returns {Promise<Object>} 更新结果
   */
  async updateAccountCookies(accountId, domains) {
    const storage = await chrome.storage.local.get(this.STORAGE_KEY);
    const accounts = storage[this.STORAGE_KEY] || {};

    if (!accounts[accountId]) {
      throw new Error(`Account ${accountId} not found`);
    }

    // 获取当前 Cookie
    const currentCookies = await this.getCookiesForDomains(domains);
    const validCookies = this.filterValidCookies(currentCookies);
    const serializedCookies = validCookies.map(c => this.serializeCookie(c));

    // 更新账号数据
    accounts[accountId].cookies = serializedCookies;
    accounts[accountId].domains = domains;
    accounts[accountId].savedAt = Date.now();

    await chrome.storage.local.set({ [this.STORAGE_KEY]: accounts });

    return {
      success: true,
      accountId,
      cookieCount: serializedCookies.length
    };
  }
}

// 导出单例
const cookieManager = new CookieManager();
```

---

## 四、Cookie 过期和更新处理

### 4.1 Cookie 过期检测

```javascript
/**
 * Cookie 过期管理器
 */
class CookieExpirationManager {
  /**
   * 检查单个 Cookie 是否过期
   * @param {Object} cookie - Cookie 对象
   * @returns {Object} 检查结果
   */
  checkExpiration(cookie) {
    const now = Date.now();

    if (!cookie.expirationDate) {
      return {
        isExpired: false,
        isSession: true,
        remainingTime: null
      };
    }

    const expirationTime = cookie.expirationDate * 1000;
    const remainingTime = expirationTime - now;

    return {
      isExpired: remainingTime <= 0,
      isSession: false,
      expirationDate: new Date(expirationTime),
      remainingTime: remainingTime > 0 ? remainingTime : 0,
      remainingDays: remainingTime > 0 ? Math.floor(remainingTime / (24 * 60 * 60 * 1000)) : 0,
      remainingHours: remainingTime > 0 ? Math.floor(remainingTime / (60 * 60 * 1000)) : 0
    };
  }

  /**
   * 批量检查 Cookie 过期状态
   * @param {Array} cookies - Cookie 数组
   * @returns {Object} 检查结果统计
   */
  batchCheckExpiration(cookies) {
    const result = {
      total: cookies.length,
      valid: 0,
      expired: 0,
      session: 0,
      expiringSoon: 0, // 24小时内过期
      details: []
    };

    for (const cookie of cookies) {
      const check = this.checkExpiration(cookie);

      if (check.isSession) {
        result.session++;
        result.valid++;
      } else if (check.isExpired) {
        result.expired++;
      } else {
        result.valid++;
        if (check.remainingTime < 24 * 60 * 60 * 1000) {
          result.expiringSoon++;
        }
      }

      result.details.push({
        name: cookie.name,
        domain: cookie.domain,
        ...check
      });
    }

    return result;
  }

  /**
   * 清理过期 Cookie
   * @param {string} domain - 目标域名
   * @returns {Promise<number>} 清理数量
   */
  async cleanExpiredCookies(domain) {
    const cookies = await chrome.cookies.getAll({ domain });
    let cleaned = 0;

    for (const cookie of cookies) {
      const check = this.checkExpiration(cookie);
      if (check.isExpired) {
        const url = `https://${cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain}${cookie.path}`;
        await chrome.cookies.remove({ url, name: cookie.name });
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * 获取即将过期的 Cookie 列表
   * @param {string} domain - 目标域名
   * @param {number} hours - 小时数阈值
   * @returns {Promise<Array>} 即将过期的 Cookie 列表
   */
  async getExpiringSoonCookies(domain, hours = 24) {
    const cookies = await chrome.cookies.getAll({ domain });
    const threshold = hours * 60 * 60 * 1000;

    return cookies.filter(cookie => {
      if (!cookie.expirationDate) return false;
      const remaining = cookie.expirationDate * 1000 - Date.now();
      return remaining > 0 && remaining < threshold;
    }).map(cookie => ({
      name: cookie.name,
      domain: cookie.domain,
      expirationDate: new Date(cookie.expirationDate * 1000),
      remainingHours: Math.floor((cookie.expirationDate * 1000 - Date.now()) / (60 * 60 * 1000))
    }));
  }
}
```

### 4.2 Cookie 自动更新机制

```javascript
/**
 * Cookie 自动更新管理器
 */
class CookieAutoUpdater {
  constructor(cookieManager) {
    this.cookieManager = cookieManager;
    this.updateIntervals = new Map();
    this.listeners = new Map();
  }

  /**
   * 启动账号 Cookie 自动更新
   * @param {string} accountId - 账号标识
   * @param {Array<string>} domains - 域名列表
   * @param {number} intervalMinutes - 更新间隔（分钟）
   * @returns {void}
   */
  startAutoUpdate(accountId, domains, intervalMinutes = 30) {
    // 停止已有的更新任务
    this.stopAutoUpdate(accountId);

    // 创建新的更新任务
    const intervalId = setInterval(async () => {
      try {
        console.log(`Auto-updating cookies for account: ${accountId}`);
        await this.cookieManager.updateAccountCookies(accountId, domains);
        this.notifyListeners(accountId, 'updated');
      } catch (error) {
        console.error(`Auto-update failed for account ${accountId}:`, error);
        this.notifyListeners(accountId, 'error', error);
      }
    }, intervalMinutes * 60 * 1000);

    this.updateIntervals.set(accountId, intervalId);
  }

  /**
   * 停止账号 Cookie 自动更新
   * @param {string} accountId - 账号标识
   * @returns {void}
   */
  stopAutoUpdate(accountId) {
    const intervalId = this.updateIntervals.get(accountId);
    if (intervalId) {
      clearInterval(intervalId);
      this.updateIntervals.delete(accountId);
    }
  }

  /**
   * 停止所有自动更新
   * @returns {void}
   */
  stopAllAutoUpdates() {
    for (const [accountId, intervalId] of this.updateIntervals) {
      clearInterval(intervalId);
    }
    this.updateIntervals.clear();
  }

  /**
   * 添加更新监听器
   * @param {string} accountId - 账号标识
   * @param {Function} callback - 回调函数
   * @returns {void}
   */
  addUpdateListener(accountId, callback) {
    if (!this.listeners.has(accountId)) {
      this.listeners.set(accountId, new Set());
    }
    this.listeners.get(accountId).add(callback);
  }

  /**
   * 移除更新监听器
   * @param {string} accountId - 账号标识
   * @param {Function} callback - 回调函数
   * @returns {void}
   */
  removeUpdateListener(accountId, callback) {
    const callbacks = this.listeners.get(accountId);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  /**
   * 通知监听器
   * @param {string} accountId - 账号标识
   * @param {string} event - 事件类型
   * @param {Error} error - 错误对象
   * @returns {void}
   */
  notifyListeners(accountId, event, error = null) {
    const callbacks = this.listeners.get(accountId);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback({ accountId, event, error, timestamp: Date.now() });
        } catch (e) {
          console.error('Listener callback error:', e);
        }
      }
    }
  }
}
```

---

## 五、第三方 Cookie 和 SameSite 限制处理

### 5.1 SameSite 限制详解

Chrome 从版本 80 开始默认实施 SameSite=Lax 策略，对第三方 Cookie 有严格限制：

```
┌─────────────────────────────────────────────────────────────┐
│              SameSite 策略影响矩阵                           │
├─────────────────────────────────────────────────────────────┤
│  请求类型          │ SameSite=Strict │ SameSite=Lax │ None  │
├─────────────────────────────────────────────────────────────┤
│  同站请求          │     发送        │    发送      │ 发送  │
│  顶级导航 GET      │     不发送      │    发送      │ 发送  │
│  顶级导航 POST     │     不发送      │    不发送    │ 发送  │
│  iframe 嵌入       │     不发送      │    不发送    │ 发送  │
│  AJAX/Fetch        │     不发送      │    不发送    │ 发送  │
│  图片/脚本加载     │     不发送      │    不发送    │ 发送  │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 处理第三方 Cookie 的策略

```javascript
/**
 * 第三方 Cookie 处理器
 */
class ThirdPartyCookieHandler {
  /**
   * 检测 Cookie 是否为第三方 Cookie
   * @param {Object} cookie - Cookie 对象
   * @param {string} currentDomain - 当前页面域名
   * @returns {boolean} 是否为第三方 Cookie
   */
  isThirdPartyCookie(cookie, currentDomain) {
    const cookieDomain = cookie.domain.startsWith('.')
      ? cookie.domain.slice(1)
      : cookie.domain;

    // 检查是否为子域名关系
    return !this.isSameSite(cookieDomain, currentDomain);
  }

  /**
   * 检查两个域名是否同站
   * @param {string} domain1 - 域名1
   * @param {string} domain2 - 域名2
   * @returns {boolean} 是否同站
   */
  isSameSite(domain1, domain2) {
    // 获取 eTLD+1（有效顶级域名 + 1）
    const etld1 = this.getETLDPlusOne(domain1);
    const etld2 = this.getETLDPlusOne(domain2);

    return etld1 === etld2;
  }

  /**
   * 获取 eTLD+1
   * @param {string} domain - 域名
   * @returns {string} eTLD+1
   */
  getETLDPlusOne(domain) {
    // 简化实现，实际应使用 public suffix list
    const parts = domain.split('.');
    if (parts.length >= 2) {
      return parts.slice(-2).join('.');
    }
    return domain;
  }

  /**
   * 设置第三方 Cookie（需要特殊处理）
   * @param {Object} cookieData - Cookie 数据
   * @returns {Promise<Object>} 设置结果
   */
  async setThirdPartyCookie(cookieData) {
    // 第三方 Cookie 必须设置 SameSite=None 和 Secure
    const details = {
      ...cookieData,
      sameSite: 'no_restriction',
      secure: true  // SameSite=None 必须配合 Secure
    };

    return new Promise((resolve, reject) => {
      chrome.cookies.set(details, (cookie) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(cookie);
        }
      });
    });
  }

  /**
   * 检查浏览器是否阻止第三方 Cookie
   * @returns {Promise<boolean>} 是否阻止
   */
  async checkThirdPartyCookieBlocked() {
    // 创建测试 Cookie
    const testCookie = {
      url: 'https://example.com',
      name: '_third_party_test',
      value: 'test',
      sameSite: 'no_restriction',
      secure: true,
      expirationDate: Math.floor(Date.now() / 1000) + 60
    };

    try {
      const cookie = await new Promise((resolve, reject) => {
        chrome.cookies.set(testCookie, (c) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(c);
          }
        });
      });

      // 清理测试 Cookie
      await chrome.cookies.remove({ url: testCookie.url, name: testCookie.name });

      return cookie === null;
    } catch (error) {
      return true;
    }
  }

  /**
   * 获取 SameSite 兼容性建议
   * @param {Object} cookie - Cookie 对象
   * @param {string} usage - 使用场景
   * @returns {Object} 建议信息
   */
  getSameSiteRecommendation(cookie, usage) {
    const recommendations = {
      'authentication': {
        sameSite: 'strict',
        secure: true,
        httpOnly: true,
        reason: '认证 Cookie 应使用最严格的设置防止 CSRF'
      },
      'session': {
        sameSite: 'lax',
        secure: true,
        httpOnly: true,
        reason: '会话 Cookie 使用 Lax 平衡安全与可用性'
      },
      'analytics': {
        sameSite: 'no_restriction',
        secure: true,
        httpOnly: false,
        reason: '分析 Cookie 需要跨站追踪，使用 None'
      },
      'preference': {
        sameSite: 'lax',
        secure: false,
        httpOnly: false,
        reason: '偏好设置 Cookie 使用 Lax 即可'
      },
      'csrf-token': {
        sameSite: 'strict',
        secure: true,
        httpOnly: false,
        reason: 'CSRF Token 需要严格模式但 JavaScript 需要访问'
      }
    };

    return recommendations[usage] || {
      sameSite: 'lax',
      secure: true,
      httpOnly: false,
      reason: '默认使用 Lax 模式'
    };
  }
}
```

### 5.3 跨站请求 Cookie 处理

```javascript
/**
 * 跨站请求 Cookie 处理器
 */
class CrossSiteCookieHandler {
  /**
   * 为跨站请求准备 Cookie 头
   * @param {string} targetUrl - 目标 URL
   * @param {string} sourceUrl - 来源 URL
   * @param {Array} cookies - Cookie 数组
   * @returns {string} Cookie 头字符串
   */
  prepareCookiesForCrossSiteRequest(targetUrl, sourceUrl, cookies) {
    const targetDomain = new URL(targetUrl).hostname;
    const sourceDomain = new URL(sourceUrl).hostname;

    const validCookies = cookies.filter(cookie => {
      // 检查域名匹配
      if (!this.domainMatches(cookie.domain, targetDomain)) {
        return false;
      }

      // 检查路径匹配
      const targetPath = new URL(targetUrl).pathname;
      if (!this.pathMatches(cookie.path, targetPath)) {
        return false;
      }

      // 检查 SameSite 限制
      if (!this.isSameSite(targetDomain, sourceDomain)) {
        // 跨站请求，只有 SameSite=None 的 Cookie 可以发送
        if (cookie.sameSite !== 'no_restriction') {
          return false;
        }
      }

      // 检查 Secure 限制
      if (cookie.secure && targetUrl.startsWith('http:')) {
        return false;
      }

      return true;
    });

    return validCookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * 检查域名是否匹配
   * @param {string} cookieDomain - Cookie 域名
   * @param {string} requestDomain - 请求域名
   * @returns {boolean} 是否匹配
   */
  domainMatches(cookieDomain, requestDomain) {
    const normalizedCookieDomain = cookieDomain.startsWith('.')
      ? cookieDomain.slice(1)
      : cookieDomain;

    if (normalizedCookieDomain === requestDomain) {
      return true;
    }

    // 检查子域名匹配（Cookie 域名以 . 开头）
    if (cookieDomain.startsWith('.')) {
      return requestDomain.endsWith(normalizedCookieDomain) ||
             requestDomain === normalizedCookieDomain;
    }

    return false;
  }

  /**
   * 检查路径是否匹配
   * @param {string} cookiePath - Cookie 路径
   * @param {string} requestPath - 请求路径
   * @returns {boolean} 是否匹配
   */
  pathMatches(cookiePath, requestPath) {
    const path = cookiePath || '/';

    if (path === '/') {
      return true;
    }

    if (requestPath === path) {
      return true;
    }

    return requestPath.startsWith(path) && requestPath[path.length] === '/';
  }

  /**
   * 检查是否同站
   * @param {string} domain1 - 域名1
   * @param {string} domain2 - 域名2
   * @returns {boolean} 是否同站
   */
  isSameSite(domain1, domain2) {
    const getETLDPlusOne = (domain) => {
      const parts = domain.split('.');
      return parts.length >= 2 ? parts.slice(-2).join('.') : domain;
    };

    return getETLDPlusOne(domain1) === getETLDPlusOne(domain2);
  }
}
```

---

## 六、Cookie 变化监听（onChanged 事件）

### 6.1 onChanged 事件详解

```javascript
/**
 * Cookie 变化监听器
 */
class CookieChangeListener {
  constructor() {
    this.listeners = new Map();
    this.isListening = false;
  }

  /**
   * 启动监听
   * @returns {void}
   */
  start() {
    if (this.isListening) return;

    chrome.cookies.onChanged.addListener(this.handleChange.bind(this));
    this.isListening = true;
  }

  /**
   * 停止监听
   * @returns {void}
   */
  stop() {
    if (!this.isListening) return;

    chrome.cookies.onChanged.removeListener(this.handleChange.bind(this));
    this.isListening = false;
  }

  /**
   * 处理 Cookie 变化
   * @param {Object} changeInfo - 变化信息
   * @returns {void}
   */
  handleChange(changeInfo) {
    const { removed, cookie, cause } = changeInfo;

    // 通知所有监听器
    for (const [id, listener] of this.listeners) {
      try {
        listener({
          removed,
          cookie,
          cause,
          timestamp: Date.now()
        });
      } catch (error) {
        console.error(`Listener ${id} error:`, error);
      }
    }
  }

  /**
   * 添加监听器
   * @param {string} id - 监听器标识
   * @param {Function} callback - 回调函数
   * @returns {void}
   */
  addListener(id, callback) {
    this.listeners.set(id, callback);

    if (!this.isListening) {
      this.start();
    }
  }

  /**
   * 移除监听器
   * @param {string} id - 监听器标识
   * @returns {void}
   */
  removeListener(id) {
    this.listeners.delete(id);

    if (this.listeners.size === 0) {
      this.stop();
    }
  }
}
```

### 6.2 onChanged 事件参数详解

```javascript
/**
 * changeInfo 对象结构
 */
const changeInfoExample = {
  removed: false,  // boolean: true 表示 Cookie 被删除
  cookie: {        // Cookie 对象
    name: 'session_id',
    value: 'abc123',
    domain: '.example.com',
    path: '/',
    secure: true,
    httpOnly: true,
    session: false,
    expirationDate: 1735689600,
    sameSite: 'lax',
    storeId: '0'
  },
  cause: 'explicit'  // 变化原因
};

/**
 * cause 可能的值：
 * - 'evicted': Cookie 因过期或空间限制被自动清除
 * - 'expired': Cookie 因过期被清除
 * - 'explicit': Cookie 被显式设置或删除（用户或代码操作）
 * - 'expired_overwrite': Cookie 被设置为已过期的值
 * - 'overwrite': Cookie 被新值覆盖
 */
```

### 6.3 实用监听器示例

```javascript
/**
 * 账号 Cookie 同步监听器
 */
class AccountCookieSyncListener {
  constructor(cookieManager) {
    this.cookieManager = cookieManager;
    this.currentAccount = null;
    this.syncEnabled = false;
  }

  /**
   * 启动账号 Cookie 同步
   * @param {string} accountId - 账号标识
   * @param {Array<string>} domains - 监控的域名列表
   * @returns {void}
   */
  startSync(accountId, domains) {
    this.currentAccount = accountId;
    this.syncEnabled = true;
    this.monitoredDomains = new Set(domains.map(d => d.startsWith('.') ? d : `.${d}`));

    chrome.cookies.onChanged.addListener(this.handleCookieChange.bind(this));
  }

  /**
   * 停止同步
   * @returns {void}
   */
  stopSync() {
    this.syncEnabled = false;
    chrome.cookies.onChanged.removeListener(this.handleCookieChange.bind(this));
  }

  /**
   * 处理 Cookie 变化
   * @param {Object} changeInfo - 变化信息
   * @returns {void}
   */
  async handleCookieChange(changeInfo) {
    if (!this.syncEnabled || !this.currentAccount) return;

    const { cookie, removed, cause } = changeInfo;

    // 检查是否为监控域名
    if (!this.isMonitoredDomain(cookie.domain)) return;

    // 忽略自动清除事件
    if (cause === 'evicted' || cause === 'expired') return;

    console.log(`Cookie ${removed ? 'removed' : 'changed'}: ${cookie.name} on ${cookie.domain}`);

    // 触发同步更新
    try {
      await this.syncCookieToAccount(cookie, removed);
    } catch (error) {
      console.error('Failed to sync cookie:', error);
    }
  }

  /**
   * 检查是否为监控域名
   * @param {string} domain - Cookie 域名
   * @returns {boolean} 是否监控
   */
  isMonitoredDomain(domain) {
    const normalizedDomain = domain.startsWith('.') ? domain : `.${domain}`;
    for (const monitored of this.monitoredDomains) {
      if (normalizedDomain === monitored ||
          normalizedDomain.endsWith(monitored) ||
          monitored.endsWith(normalizedDomain)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 同步 Cookie 到账号存储
   * @param {Object} cookie - Cookie 对象
   * @param {boolean} removed - 是否被删除
   * @returns {Promise<void>}
   */
  async syncCookieToAccount(cookie, removed) {
    const storage = await chrome.storage.local.get('multi_account_cookies');
    const accounts = storage.multi_account_cookies || {};
    const account = accounts[this.currentAccount];

    if (!account) return;

    if (removed) {
      // 从存储中移除 Cookie
      account.cookies = account.cookies.filter(
        c => !(c.name === cookie.name && c.domain === cookie.domain)
      );
    } else {
      // 更新或添加 Cookie
      const index = account.cookies.findIndex(
        c => c.name === cookie.name && c.domain === cookie.domain
      );

      const serializedCookie = {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        expirationDate: cookie.expirationDate,
        sameSite: cookie.sameSite
      };

      if (index >= 0) {
        account.cookies[index] = serializedCookie;
      } else {
        account.cookies.push(serializedCookie);
      }
    }

    account.savedAt = Date.now();
    await chrome.storage.local.set({ multi_account_cookies: accounts });
  }
}
```

---

## 七、跨域 Cookie 的处理方法

### 7.1 跨子域名 Cookie 共享

```javascript
/**
 * 跨子域名 Cookie 处理器
 */
class SubdomainCookieHandler {
  /**
   * 设置跨子域名 Cookie
   * @param {string} rootDomain - 根域名（如 example.com）
   * @param {string} name - Cookie 名称
   * @param {string} value - Cookie 值
   * @param {Object} options - 其他选项
   * @returns {Promise<Object>} 设置的 Cookie
   */
  async setCrossSubdomainCookie(rootDomain, name, value, options = {}) {
    const domain = rootDomain.startsWith('.') ? rootDomain : `.${rootDomain}`;

    return new Promise((resolve, reject) => {
      chrome.cookies.set({
        url: `https://${rootDomain}`,
        name,
        value,
        domain,  // 前导点表示所有子域名
        path: options.path || '/',
        secure: options.secure !== false,
        httpOnly: options.httpOnly || false,
        sameSite: options.sameSite || 'lax',
        expirationDate: options.expirationDate
      }, (cookie) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(cookie);
        }
      });
    });
  }

  /**
   * 获取所有子域名相关的 Cookie
   * @param {string} rootDomain - 根域名
   * @returns {Promise<Array>} Cookie 数组
   */
  async getAllSubdomainCookies(rootDomain) {
    const domain = rootDomain.startsWith('.') ? rootDomain : `.${rootDomain}`;

    // 获取通配域名 Cookie
    const wildcardCookies = await new Promise((resolve) => {
      chrome.cookies.getAll({ domain }, resolve);
    });

    // 获取精确域名 Cookie
    const exactCookies = await new Promise((resolve) => {
      chrome.cookies.getAll({ domain: rootDomain.replace(/^\./, '') }, resolve);
    });

    // 合并去重
    const cookieMap = new Map();
    [...wildcardCookies, ...exactCookies].forEach(cookie => {
      const key = `${cookie.name}@${cookie.domain}`;
      cookieMap.set(key, cookie);
    });

    return Array.from(cookieMap.values());
  }

  /**
   * 清除所有子域名相关的 Cookie
   * @param {string} rootDomain - 根域名
   * @returns {Promise<number>} 清除数量
   */
  async clearAllSubdomainCookies(rootDomain) {
    const cookies = await this.getAllSubdomainCookies(rootDomain);
    let cleared = 0;

    for (const cookie of cookies) {
      const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
      const protocol = cookie.secure ? 'https' : 'http';
      const url = `${protocol}://${domain}${cookie.path}`;

      try {
        await new Promise((resolve, reject) => {
          chrome.cookies.remove({ url, name: cookie.name }, (result) => {
            if (result) {
              cleared++;
              resolve();
            } else {
              reject(new Error('Failed to remove'));
            }
          });
        });
      } catch (error) {
        console.warn(`Failed to clear cookie ${cookie.name}:`, error);
      }
    }

    return cleared;
  }
}
```

### 7.2 跨顶级域名 Cookie 处理

```javascript
/**
 * 跨顶级域名 Cookie 处理器
 * 注意：由于浏览器安全限制，无法直接设置其他域名的 Cookie
 * 需要通过其他方式实现（如 iframe + postMessage）
 */
class CrossDomainCookieHandler {
  /**
   * 通过 iframe 设置跨域 Cookie
   * 需要目标域名配合提供设置页面
   * @param {string} targetDomain - 目标域名
   * @param {Object} cookieData - Cookie 数据
   * @returns {Promise<boolean>} 是否成功
   */
  async setCrossDomainCookieViaIframe(targetDomain, cookieData) {
    return new Promise((resolve, reject) => {
      // 创建隐藏 iframe
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = `https://${targetDomain}/set-cookie`;

      // 监听消息
      const messageHandler = (event) => {
        if (event.origin !== `https://${targetDomain}`) return;

        if (event.data.type === 'cookie-set-result') {
          window.removeEventListener('message', messageHandler);
          document.body.removeChild(iframe);
          resolve(event.data.success);
        }
      };

      window.addEventListener('message', messageHandler);

      // iframe 加载完成后发送 Cookie 数据
      iframe.onload = () => {
        iframe.contentWindow.postMessage({
          type: 'set-cookie',
          cookie: cookieData
        }, `https://${targetDomain}`);
      };

      document.body.appendChild(iframe);

      // 超时处理
      setTimeout(() => {
        window.removeEventListener('message', messageHandler);
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
        reject(new Error('Timeout'));
      }, 5000);
    });
  }

  /**
   * 通过服务端代理设置跨域 Cookie
   * @param {string} proxyUrl - 代理服务端 URL
   * @param {Object} cookieData - Cookie 数据
   * @returns {Promise<boolean>} 是否成功
   */
  async setCrossDomainCookieViaProxy(proxyUrl, cookieData) {
    try {
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(cookieData),
        credentials: 'include'  // 包含 Cookie
      });

      return response.ok;
    } catch (error) {
      console.error('Failed to set cookie via proxy:', error);
      return false;
    }
  }
}
```

---

## 八、完整的多账号 Cookie 管理器代码实现

### 8.1 完整架构

```
multi-account-manager/
├── manifest.json
├── background/
│   ├── index.js              # Service Worker 入口
│   ├── accountManager.js     # 账号管理核心
│   ├── cookieManager.js      # Cookie 操作封装
│   ├── storageManager.js     # 存储管理
│   └── syncManager.js        # 同步管理
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── content/
│   └── content.js
├── options/
│   ├── options.html
│   └── options.js
└── lib/
    ├── crypto.js             # 加密工具
    ├── utils.js              # 通用工具
    └── constants.js          # 常量定义
```

### 8.2 manifest.json

```json
{
  "manifest_version": 3,
  "name": "Multi-Account Cookie Manager",
  "version": "1.0.0",
  "description": "Manage multiple accounts with cookie isolation",
  "permissions": [
    "cookies",
    "storage",
    "tabs",
    "activeTab",
    "contextMenus",
    "notifications"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background/index.js",
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
  "options_page": "options/options.html",
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 8.3 完整的 Cookie 管理器类

```javascript
// lib/constants.js
export const CONSTANTS = {
  STORAGE_KEYS: {
    ACCOUNTS: 'multi_account_cookies',
    SETTINGS: 'multi_account_settings',
    CURRENT_ACCOUNT: 'current_account_id'
  },
  DEFAULT_DOMAINS: [
    '.google.com',
    '.youtube.com',
    '.github.com',
    '.twitter.com',
    '.facebook.com'
  ],
  SYNC_INTERVAL: 30 * 60 * 1000, // 30 分钟
  MAX_ACCOUNTS: 20,
  COOKIE_ATTRIBUTES: ['name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'expirationDate', 'sameSite']
};

// background/cookieManager.js
import { CONSTANTS } from '../lib/constants.js';

/**
 * Cookie 管理器 - 完整实现
 */
export class CookieManager {
  constructor() {
    this.cache = new Map();
    this.listeners = new Set();
  }

  /**
   * 获取单个 Cookie
   */
  async get(url, name) {
    return new Promise((resolve, reject) => {
      chrome.cookies.get({ url, name }, (cookie) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(cookie);
        }
      });
    });
  }

  /**
   * 获取所有符合条件的 Cookie
   */
  async getAll(details = {}) {
    return new Promise((resolve, reject) => {
      chrome.cookies.getAll(details, (cookies) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(cookies || []);
        }
      });
    });
  }

  /**
   * 设置 Cookie
   */
  async set(details) {
    return new Promise((resolve, reject) => {
      chrome.cookies.set(details, (cookie) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!cookie) {
          reject(new Error('Failed to set cookie'));
        } else {
          resolve(cookie);
        }
      });
    });
  }

  /**
   * 删除 Cookie
   */
  async remove(url, name, storeId = null) {
    const details = { url, name };
    if (storeId) details.storeId = storeId;

    return new Promise((resolve, reject) => {
      chrome.cookies.remove(details, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result !== null);
        }
      });
    });
  }

  /**
   * 序列化 Cookie 用于存储
   */
  serializeCookie(cookie) {
    const serialized = {};
    for (const attr of CONSTANTS.COOKIE_ATTRIBUTES) {
      if (cookie[attr] !== undefined) {
        serialized[attr] = cookie[attr];
      }
    }
    return serialized;
  }

  /**
   * 反序列化 Cookie 用于设置
   */
  deserializeCookie(cookie, url) {
    return {
      url: url || this.buildUrlFromCookie(cookie),
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      secure: cookie.secure || false,
      httpOnly: cookie.httpOnly || false,
      sameSite: cookie.sameSite || 'lax',
      ...(cookie.expirationDate && { expirationDate: cookie.expirationDate })
    };
  }

  /**
   * 从 Cookie 构建 URL
   */
  buildUrlFromCookie(cookie) {
    const protocol = cookie.secure ? 'https' : 'http';
    const domain = cookie.domain.startsWith('.')
      ? cookie.domain.slice(1)
      : cookie.domain;
    return `${protocol}://${domain}${cookie.path || '/'}`;
  }

  /**
   * 检查 Cookie 是否过期
   */
  isExpired(cookie) {
    if (!cookie.expirationDate) return false;
    return cookie.expirationDate * 1000 < Date.now();
  }

  /**
   * 过滤有效 Cookie
   */
  filterValid(cookies) {
    return cookies.filter(c => !this.isExpired(c));
  }

  /**
   * 清除指定域名的所有 Cookie
   */
  async clearDomain(domain) {
    const cookies = await this.getAll({ domain });
    let cleared = 0;

    for (const cookie of cookies) {
      const url = this.buildUrlFromCookie(cookie);
      try {
        const success = await this.remove(url, cookie.name);
        if (success) cleared++;
      } catch (error) {
        console.warn(`Failed to remove ${cookie.name}:`, error);
      }
    }

    return cleared;
  }

  /**
   * 清除多个域名的 Cookie
   */
  async clearDomains(domains) {
    let total = 0;
    for (const domain of domains) {
      total += await this.clearDomain(domain);
    }
    return total;
  }

  /**
   * 批量设置 Cookie
   */
  async setBatch(cookies) {
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const cookie of cookies) {
      if (this.isExpired(cookie)) continue;

      try {
        const details = this.deserializeCookie(cookie);
        await this.set(details);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          name: cookie.name,
          domain: cookie.domain,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * 监听 Cookie 变化
   */
  addChangeListener(callback) {
    this.listeners.add(callback);

    if (this.listeners.size === 1) {
      chrome.cookies.onChanged.addListener(this.handleChange.bind(this));
    }

    return () => this.removeChangeListener(callback);
  }

  /**
   * 移除监听器
   */
  removeChangeListener(callback) {
    this.listeners.delete(callback);

    if (this.listeners.size === 0) {
      chrome.cookies.onChanged.removeListener(this.handleChange.bind(this));
    }
  }

  /**
   * 处理变化事件
   */
  handleChange(changeInfo) {
    for (const callback of this.listeners) {
      try {
        callback(changeInfo);
      } catch (error) {
        console.error('Cookie change listener error:', error);
      }
    }
  }
}

// background/accountManager.js
import { CONSTANTS } from '../lib/constants.js';
import { CookieManager } from './cookieManager.js';

/**
 * 账号管理器 - 完整实现
 */
export class AccountManager {
  constructor() {
    this.cookieManager = new CookieManager();
    this.currentAccountId = null;
    this.initialized = false;
  }

  /**
   * 初始化
   */
  async init() {
    if (this.initialized) return;

    // 加载当前账号
    const data = await chrome.storage.local.get(CONSTANTS.STORAGE_KEYS.CURRENT_ACCOUNT);
    this.currentAccountId = data[CONSTANTS.STORAGE_KEYS.CURRENT_ACCOUNT] || null;

    this.initialized = true;
  }

  /**
   * 获取所有账号
   */
  async getAccounts() {
    const data = await chrome.storage.local.get(CONSTANTS.STORAGE_KEYS.ACCOUNTS);
    return data[CONSTANTS.STORAGE_KEYS.ACCOUNTS] || {};
  }

  /**
   * 获取账号
   */
  async getAccount(accountId) {
    const accounts = await this.getAccounts();
    return accounts[accountId] || null;
  }

  /**
   * 获取当前账号
   */
  getCurrentAccount() {
    return this.currentAccountId;
  }

  /**
   * 创建账号
   */
  async createAccount(accountId, options = {}) {
    const accounts = await this.getAccounts();

    if (accounts[accountId]) {
      throw new Error(`Account ${accountId} already exists`);
    }

    if (Object.keys(accounts).length >= CONSTANTS.MAX_ACCOUNTS) {
      throw new Error('Maximum number of accounts reached');
    }

    const account = {
      id: accountId,
      name: options.name || accountId,
      avatar: options.avatar || null,
      domains: options.domains || CONSTANTS.DEFAULT_DOMAINS,
      cookies: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    accounts[accountId] = account;
    await chrome.storage.local.set({ [CONSTANTS.STORAGE_KEYS.ACCOUNTS]: accounts });

    return account;
  }

  /**
   * 保存当前 Cookie 到账号
   */
  async saveToAccount(accountId) {
    const accounts = await this.getAccounts();
    const account = accounts[accountId];

    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // 获取所有域名的 Cookie
    const allCookies = [];
    for (const domain of account.domains) {
      const cookies = await this.cookieManager.getAll({ domain });
      allCookies.push(...cookies);
    }

    // 过滤并序列化
    const validCookies = this.cookieManager.filterValid(allCookies);
    account.cookies = validCookies.map(c => this.cookieManager.serializeCookie(c));
    account.updatedAt = Date.now();

    await chrome.storage.local.set({ [CONSTANTS.STORAGE_KEYS.ACCOUNTS]: accounts });

    return {
      accountId,
      cookieCount: account.cookies.length,
      savedAt: account.updatedAt
    };
  }

  /**
   * 切换账号
   */
  async switchAccount(accountId) {
    const accounts = await this.getAccounts();
    const account = accounts[accountId];

    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // 保存当前账号状态
    if (this.currentAccountId && accounts[this.currentAccountId]) {
      await this.saveToAccount(this.currentAccountId);
    }

    // 清除当前 Cookie
    const allDomains = new Set();
    Object.values(accounts).forEach(acc => {
      acc.domains?.forEach(d => allDomains.add(d));
    });
    await this.cookieManager.clearDomains(Array.from(allDomains));

    // 恢复目标账号 Cookie
    if (account.cookies && account.cookies.length > 0) {
      const results = await this.cookieManager.setBatch(account.cookies);
      console.log(`Restored ${results.success} cookies, failed ${results.failed}`);
    }

    // 更新当前账号
    this.currentAccountId = accountId;
    await chrome.storage.local.set({ [CONSTANTS.STORAGE_KEYS.CURRENT_ACCOUNT]: accountId });

    // 通知变化
    this.notifyAccountChange(accountId);

    return {
      success: true,
      accountId,
      restoredCookies: account.cookies?.length || 0
    };
  }

  /**
   * 删除账号
   */
  async deleteAccount(accountId) {
    const accounts = await this.getAccounts();

    if (!accounts[accountId]) {
      throw new Error(`Account ${accountId} not found`);
    }

    delete accounts[accountId];
    await chrome.storage.local.set({ [CONSTANTS.STORAGE_KEYS.ACCOUNTS]: accounts });

    // 如果删除的是当前账号，清除当前账号标记
    if (this.currentAccountId === accountId) {
      this.currentAccountId = null;
      await chrome.storage.local.set({ [CONSTANTS.STORAGE_KEYS.CURRENT_ACCOUNT]: null });
    }

    return true;
  }

  /**
   * 更新账号配置
   */
  async updateAccount(accountId, updates) {
    const accounts = await this.getAccounts();
    const account = accounts[accountId];

    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // 更新允许的字段
    const allowedFields = ['name', 'avatar', 'domains'];
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        account[field] = updates[field];
      }
    }

    account.updatedAt = Date.now();
    await chrome.storage.local.set({ [CONSTANTS.STORAGE_KEYS.ACCOUNTS]: accounts });

    return account;
  }

  /**
   * 导出账号数据
   */
  async exportAccount(accountId) {
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    return JSON.stringify(account, null, 2);
  }

  /**
   * 导入账号数据
   */
  async importAccount(jsonData) {
    const account = JSON.parse(jsonData);

    if (!account.id || !account.cookies) {
      throw new Error('Invalid account data');
    }

    const accounts = await this.getAccounts();

    // 生成新 ID 如果已存在
    let newId = account.id;
    let counter = 1;
    while (accounts[newId]) {
      newId = `${account.id}_${counter}`;
      counter++;
    }

    account.id = newId;
    account.importedAt = Date.now();
    accounts[newId] = account;

    await chrome.storage.local.set({ [CONSTANTS.STORAGE_KEYS.ACCOUNTS]: accounts });

    return account;
  }

  /**
   * 通知账号变化
   */
  notifyAccountChange(accountId) {
    chrome.runtime.sendMessage({
      type: 'ACCOUNT_CHANGED',
      accountId,
      timestamp: Date.now()
    }).catch(() => {
      // 忽略没有监听器的错误
    });
  }
}

// background/index.js - Service Worker 入口
import { AccountManager } from './accountManager.js';
import { CookieManager } from './cookieManager.js';

const accountManager = new AccountManager();
const cookieManager = new CookieManager();

// 初始化
chrome.runtime.onInstalled.addListener(async () => {
  await accountManager.init();
  console.log('Multi-Account Cookie Manager initialized');
});

// 启动时初始化
chrome.runtime.onStartup.addListener(async () => {
  await accountManager.init();
});

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender, sendResponse);
  return true; // 保持消息通道开放
});

async function handleMessage(message, sender, sendResponse) {
  try {
    switch (message.type) {
      case 'GET_ACCOUNTS':
        const accounts = await accountManager.getAccounts();
        sendResponse({ success: true, accounts });
        break;

      case 'GET_CURRENT_ACCOUNT':
        const currentId = accountManager.getCurrentAccount();
        sendResponse({ success: true, currentAccountId: currentId });
        break;

      case 'CREATE_ACCOUNT':
        const newAccount = await accountManager.createAccount(
          message.accountId,
          message.options
        );
        sendResponse({ success: true, account: newAccount });
        break;

      case 'SAVE_ACCOUNT':
        const saveResult = await accountManager.saveToAccount(message.accountId);
        sendResponse({ success: true, result: saveResult });
        break;

      case 'SWITCH_ACCOUNT':
        const switchResult = await accountManager.switchAccount(message.accountId);
        sendResponse({ success: true, result: switchResult });
        break;

      case 'DELETE_ACCOUNT':
        await accountManager.deleteAccount(message.accountId);
        sendResponse({ success: true });
        break;

      case 'UPDATE_ACCOUNT':
        const updated = await accountManager.updateAccount(
          message.accountId,
          message.updates
        );
        sendResponse({ success: true, account: updated });
        break;

      case 'EXPORT_ACCOUNT':
        const exported = await accountManager.exportAccount(message.accountId);
        sendResponse({ success: true, data: exported });
        break;

      case 'IMPORT_ACCOUNT':
        const imported = await accountManager.importAccount(message.data);
        sendResponse({ success: true, account: imported });
        break;

      case 'GET_COOKIES':
        const cookies = await cookieManager.getAll(message.details || {});
        sendResponse({ success: true, cookies });
        break;

      case 'CLEAR_COOKIES':
        const cleared = await cookieManager.clearDomains(message.domains);
        sendResponse({ success: true, cleared });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

// Cookie 变化监听
cookieManager.addChangeListener((changeInfo) => {
  console.log('Cookie changed:', changeInfo.cause, changeInfo.cookie?.name);
});
```

### 8.4 Popup 界面实现

```html
<!-- popup/popup.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      width: 320px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      background: #f5f5f5;
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px;
      text-align: center;
    }

    .header h1 {
      font-size: 16px;
      font-weight: 600;
    }

    .current-account {
      background: white;
      padding: 12px 16px;
      border-bottom: 1px solid #eee;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .current-account .avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #e0e0e0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      color: #666;
    }

    .current-account .info {
      flex: 1;
    }

    .current-account .name {
      font-weight: 600;
      color: #333;
    }

    .current-account .status {
      font-size: 12px;
      color: #888;
    }

    .account-list {
      max-height: 300px;
      overflow-y: auto;
    }

    .account-item {
      background: white;
      padding: 12px 16px;
      border-bottom: 1px solid #eee;
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .account-item:hover {
      background: #f9f9f9;
    }

    .account-item.active {
      background: #e8f5e9;
    }

    .account-item .avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #e0e0e0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      color: #666;
      font-size: 14px;
    }

    .account-item .info {
      flex: 1;
    }

    .account-item .name {
      font-weight: 500;
      color: #333;
    }

    .account-item .cookies {
      font-size: 12px;
      color: #888;
    }

    .account-item .actions {
      display: flex;
      gap: 8px;
    }

    .account-item .btn {
      padding: 4px 8px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }

    .btn-switch {
      background: #667eea;
      color: white;
    }

    .btn-delete {
      background: #ff5252;
      color: white;
    }

    .footer {
      padding: 12px 16px;
      background: white;
      border-top: 1px solid #eee;
      display: flex;
      gap: 8px;
    }

    .footer input {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 14px;
    }

    .footer button {
      padding: 8px 16px;
      background: #667eea;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }

    .empty-state {
      padding: 40px 20px;
      text-align: center;
      color: #888;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Multi-Account Manager</h1>
  </div>

  <div class="current-account" id="currentAccount">
    <div class="avatar" id="currentAvatar">-</div>
    <div class="info">
      <div class="name" id="currentName">No account selected</div>
      <div class="status" id="currentStatus">Select an account to switch</div>
    </div>
  </div>

  <div class="account-list" id="accountList">
    <!-- Accounts will be rendered here -->
  </div>

  <div class="footer">
    <input type="text" id="newAccountName" placeholder="New account name">
    <button id="addAccountBtn">Add</button>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

```javascript
// popup/popup.js
class PopupManager {
  constructor() {
    this.accounts = {};
    this.currentAccountId = null;
    this.init();
  }

  async init() {
    await this.loadAccounts();
    this.render();
    this.bindEvents();
  }

  async loadAccounts() {
    const response = await chrome.runtime.sendMessage({ type: 'GET_ACCOUNTS' });
    if (response.success) {
      this.accounts = response.accounts;
    }

    const currentResponse = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_ACCOUNT' });
    if (currentResponse.success) {
      this.currentAccountId = currentResponse.currentAccountId;
    }
  }

  render() {
    this.renderCurrentAccount();
    this.renderAccountList();
  }

  renderCurrentAccount() {
    const avatarEl = document.getElementById('currentAvatar');
    const nameEl = document.getElementById('currentName');
    const statusEl = document.getElementById('currentStatus');

    if (this.currentAccountId && this.accounts[this.currentAccountId]) {
      const account = this.accounts[this.currentAccountId];
      avatarEl.textContent = account.name.charAt(0).toUpperCase();
      nameEl.textContent = account.name;
      statusEl.textContent = `${account.cookies?.length || 0} cookies saved`;
    } else {
      avatarEl.textContent = '-';
      nameEl.textContent = 'No account selected';
      statusEl.textContent = 'Select an account to switch';
    }
  }

  renderAccountList() {
    const listEl = document.getElementById('accountList');
    const accountIds = Object.keys(this.accounts);

    if (accountIds.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p>No accounts yet</p>
          <p style="font-size: 12px; margin-top: 8px;">Add an account to get started</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = accountIds.map(id => {
      const account = this.accounts[id];
      const isActive = id === this.currentAccountId;
      const initial = account.name.charAt(0).toUpperCase();

      return `
        <div class="account-item ${isActive ? 'active' : ''}" data-id="${id}">
          <div class="avatar">${initial}</div>
          <div class="info">
            <div class="name">${account.name}</div>
            <div class="cookies">${account.cookies?.length || 0} cookies</div>
          </div>
          <div class="actions">
            ${!isActive ? `<button class="btn btn-switch" data-action="switch">Switch</button>` : ''}
            <button class="btn btn-delete" data-action="delete">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  }

  bindEvents() {
    // Add account
    document.getElementById('addAccountBtn').addEventListener('click', () => {
      this.addAccount();
    });

    document.getElementById('newAccountName').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.addAccount();
      }
    });

    // Account actions
    document.getElementById('accountList').addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      const item = btn.closest('.account-item');
      const accountId = item.dataset.id;
      const action = btn.dataset.action;

      if (action === 'switch') {
        await this.switchAccount(accountId);
      } else if (action === 'delete') {
        await this.deleteAccount(accountId);
      }
    });
  }

  async addAccount() {
    const input = document.getElementById('newAccountName');
    const name = input.value.trim();

    if (!name) {
      alert('Please enter an account name');
      return;
    }

    const accountId = `account_${Date.now()}`;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CREATE_ACCOUNT',
        accountId,
        options: { name }
      });

      if (response.success) {
        input.value = '';
        await this.loadAccounts();
        this.render();
      } else {
        alert('Failed to create account: ' + response.error);
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  }

  async switchAccount(accountId) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SWITCH_ACCOUNT',
        accountId
      });

      if (response.success) {
        this.currentAccountId = accountId;
        this.render();

        // 刷新当前标签页
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          chrome.tabs.reload(tab.id);
        }
      } else {
        alert('Failed to switch account: ' + response.error);
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  }

  async deleteAccount(accountId) {
    if (!confirm('Are you sure you want to delete this account?')) {
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_ACCOUNT',
        accountId
      });

      if (response.success) {
        await this.loadAccounts();
        this.render();
      } else {
        alert('Failed to delete account: ' + response.error);
      }
    } catch (error) {
      alert('Error: ' + error.message);
    }
  }
}

// 初始化
new PopupManager();
```

---

## 九、最佳实践与注意事项

### 9.1 安全建议

1. **敏感数据加密**：Cookie 数据包含敏感信息，建议加密存储
2. **最小权限原则**：只请求必要的 `host_permissions`
3. **数据验证**：恢复 Cookie 前验证数据完整性
4. **安全传输**：导出/导入数据时使用加密

### 9.2 性能优化

1. **批量操作**：使用 `Promise.all` 并行处理 Cookie 操作
2. **缓存策略**：缓存常用数据减少 storage 读取
3. **增量更新**：只更新变化的 Cookie
4. **延迟加载**：按需加载账号数据

### 9.3 错误处理

1. **优雅降级**：Cookie 操作失败时提供备选方案
2. **重试机制**：对临时性错误实现自动重试
3. **日志记录**：记录关键操作便于问题排查
4. **用户提示**：向用户清晰展示操作结果

---

## 十、参考资料

- [Chrome Cookies API Documentation](https://developer.chrome.com/docs/extensions/reference/api/cookies)
- [MDN WebExtensions cookies API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies)
- [SameSite Cookies Explained](https://web.dev/samesite-cookies-explained/)
- [Chrome Extension Security Best Practices](https://developer.chrome.com/docs/extensions/mv3/security/)
