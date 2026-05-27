# DomainMatcher - 域名匹配工具

## 模块概述

`DomainMatcher` 是一个域名处理工具类，提供域名规范化、根域名提取、域名匹配等功能。它是其他模块进行 Cookie 和存储隔离的基础工具。

**文件位置**: [multi-session-manager/background/core/DomainMatcher.js](../../../multi-session-manager/background/core/DomainMatcher.js)

## 核心功能

### 1. 域名规范化

移除域名前导点，转为小写，确保域名格式统一：

```javascript
normalize(domain) {
  if (!domain) return '';
  return domain.toLowerCase().replace(/^\./, '');
}

// 示例
'.Example.COM' → 'example.com'
'www.Example.com' → 'www.example.com'
```

### 2. 根域名提取

从完整域名中提取根域名（顶级域名 + 二级域名）：

```javascript
getRootDomain(domain) {
  const normalized = this.normalize(domain);

  // 检查是否是 IP 地址（IPv4 或 IPv6）
  if (this.isIPAddress(normalized)) {
    return normalized;  // IP 地址本身就是根域名
  }

  const parts = normalized.split('.');

  if (parts.length <= 2) {
    return normalized;
  }

  // 检查是否是多级顶级域名 (如 .co.uk)
  const lastTwo = parts.slice(-2).join('.');
  if (this.multiLevelTlds.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }

  // 标准顶级域名
  return parts.slice(-2).join('.');
}

// 示例
'www.sub.example.com' → 'example.com'
'mail.google.co.uk' → 'google.co.uk'
'shop.example.co.jp' → 'example.co.jp'
'127.0.0.1' → '127.0.0.1' (IP 地址)
'localhost' → 'localhost'
```

### 3. IP 地址检测（新增）

```javascript
isIPAddress(domain) {
  // IPv4 检查：4 个数字段，每个 0-255
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(domain)) {
    const parts = domain.split('.');
    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  // IPv6 检查：包含冒号
  if (domain.includes(':')) {
    return true;
  }

  // localhost
  if (domain === 'localhost') {
    return true;
  }

  return false;
}

// 示例
isIPAddress('127.0.0.1') → true
isIPAddress('192.168.1.1') → true
isIPAddress('::1') → true
isIPAddress('localhost') → true
isIPAddress('example.com') → false
```

### 4. 相关域名获取

获取某个域名相关的所有域名（父域名、子域名、通配域名）：

```javascript
getRelatedDomains(domain) {
  const normalized = this.normalize(domain);
  const domains = new Set();

  // 添加自身
  domains.add(normalized);
  domains.add('.' + normalized);

  // 添加父域名（到根域名为止）
  const parts = normalized.split('.');
  for (let i = 1; i < parts.length; i++) {
    const parent = parts.slice(i).join('.');
    const root = this.getRootDomain(parent);

    // 只添加到根域名为止
    if (parent === root || this.isWildcardDomain(parent)) {
      domains.add(parent);
      domains.add('.' + parent);
    }
  }

  return Array.from(domains);
}

// 示例: 'www.sub.example.com'
// 返回: [
//   'www.sub.example.com', '.www.sub.example.com',
//   'sub.example.com', '.sub.example.com',
//   'example.com', '.example.com'
// ]
```

### 5. 域名匹配

检查目标域名是否在域名列表中，支持精确匹配和通配匹配：

```javascript
matches(domainList, targetDomain) {
  if (!domainList || domainList.length === 0) return false;

  const target = this.normalize(targetDomain);
  const targetRoot = this.getRootDomain(target);

  for (const domain of domainList) {
    const normalized = this.normalize(domain);

    // 精确匹配
    if (normalized === target) return true;

    // 通配匹配 (.example.com 匹配 sub.example.com)
    if (normalized.startsWith('.')) {
      const baseDomain = normalized.slice(1);
      if (target === baseDomain || target.endsWith('.' + baseDomain)) {
        return true;
      }
    }

    // 根域名匹配
    if (this.getRootDomain(normalized) === targetRoot) return true;
  }

  return false;
}

// 示例
matches(['.example.com'], 'www.example.com') // true
matches(['example.com'], 'www.example.com')  // false (精确匹配)
matches(['sub.example.com'], 'sub.example.com') // true
```

### 6. 同站点判断

检查两个域名是否属于同一站点（根域名相同）：

```javascript
isSameSite(domain1, domain2) {
  return this.getRootDomain(domain1) === this.getRootDomain(domain2);
}

// 示例
isSameSite('www.example.com', 'mail.example.com') // true
isSameSite('example.com', 'other.com') // false
isSameSite('127.0.0.1:8080', '127.0.0.1') // true (IP 地址)
```

### 7. Cookie 域名作用域

获取 Cookie 的有效域名范围：

```javascript
getCookieDomainScope(cookieDomain) {
  const normalized = this.normalize(cookieDomain);

  if (cookieDomain.startsWith('.')) {
    // 通配域名，作用于所有子域名
    return {
      type: 'wildcard',
      base: normalized,
      matches: (testDomain) => {
        const test = this.normalize(testDomain);
        return test === normalized || test.endsWith('.' + normalized);
      }
    };
  } else {
    // 精确域名，只作用于该域名
    return {
      type: 'exact',
      base: normalized,
      matches: (testDomain) => this.normalize(testDomain) === normalized
    };
  }
}
```

### 8. 域名归属判断

判断域名是否属于某个站点：

```javascript
belongsToSite(domain, siteDomain) {
  const domainRoot = this.getRootDomain(domain);
  const siteRoot = this.getRootDomain(siteDomain);
  return domainRoot === siteRoot;
}
```

## 支持的顶级域名

### 标准顶级域名

```javascript
this.tlds = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'io', 'co', 'cn', 'jp',
  'uk', 'de', 'fr', 'ru', 'br', 'au', 'ca', 'in', 'it', 'es',
  'nl', 'se', 'no', 'dk', 'fi', 'ch', 'at', 'be', 'cz', 'pl',
  'gr', 'hu', 'ro', 'bg', 'ua', 'by', 'kz', 'kr', 'tw', 'hk',
  'sg', 'my', 'th', 'vn', 'ph', 'id', 'pk', 'bd', 'ir', 'sa',
  'ae', 'za', 'ng', 'eg', 'ke', 'tz', 'mx', 'ar', 'cl', 'pe',
  'co', 've', 'ec', 'bo', 'py', 'uy', 'nz', 'ws', 'me', 'tv',
  'info', 'biz', 'name', 'pro', 'mobi', 'asia', 'tel', 'xxx',
  'app', 'dev', 'blog', 'shop', 'store', 'online', 'site', 'xyz'
]);
```

### 多级顶级域名

```javascript
this.multiLevelTlds = new Set([
  'co.uk', 'com.au', 'gov.uk', 'edu.au', 'org.uk', 'net.nz',
  'co.jp', 'ne.jp', 'or.jp', 'ac.uk', 'gov.au'
]);
```

## 使用场景

### Cookie 隔离

```javascript
// 获取某域名相关的所有 Cookie
const domains = domainMatcher.getRelatedDomains('www.example.com');
for (const d of domains) {
  const cookies = await chrome.cookies.getAll({ domain: d });
  // ... 处理 Cookie
}
```

### 存储分组

```javascript
// 按根域名分组存储 Cookie
const rootDomain = domainMatcher.getRootDomain('www.sub.example.com');
// rootDomain = 'example.com'
session.cookies[rootDomain] = cookies;
```

### 域名匹配

```javascript
// 检查 Session 是否管理某域名
if (domainMatcher.matches(session.domains, targetDomain)) {
  await applySessionCookies(session, targetDomain);
}
```

### IP 地址处理（新增场景）

```javascript
// 正确处理本地开发环境
const rootDomain = domainMatcher.getRootDomain('127.0.0.1:8080');
// rootDomain = '127.0.0.1'（保留 IP 地址）

const rootDomain2 = domainMatcher.getRootDomain('localhost');
// rootDomain2 = 'localhost'
```

## 方法速查表

| 方法 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `normalize(domain)` | 规范化域名 | `string` | `string` |
| `getRootDomain(domain)` | 获取根域名 | `string` | `string` |
| `isIPAddress(domain)` | 检查是否是 IP 地址（新增） | `string` | `boolean` |
| `getRelatedDomains(domain)` | 获取相关域名 | `string` | `string[]` |
| `matches(domainList, target)` | 域名匹配检查 | `string[], string` | `boolean` |
| `isSameSite(d1, d2)` | 同站点判断 | `string, string` | `boolean` |
| `belongsToSite(domain, site)` | 归属判断 | `string, string` | `boolean` |
| `isWildcardDomain(domain)` | 通配域名判断 | `string` | `boolean` |
| `getCookieDomainScope(domain)` | Cookie 作用域 | `string` | `object` |
| `mergeDomains(domains)` | 合并去重 | `string[]` | `string[]` |

## 设计考量

### 为什么使用根域名分组？

1. **Cookie 共享机制**: 浏览器 Cookie 通常设置在根域名（如 `.example.com`），子域名可共享
2. **登录状态保持**: 登录 Cookie 往往覆盖整个站点，按根域名保存可确保完整性
3. **避免重复存储**: 同一站点的多个子域名 Cookie 可能重复，按根域名分组可合并

### IP 地址处理（新增）

之前的版本对 IP 地址处理不当，可能导致：
- `127.0.0.1` 被错误解析为 `0.1`
- 本地开发环境的 Cookie 无法正确保存

新版本通过 `isIPAddress()` 方法：
- 正确识别 IPv4、IPv6、localhost
- IP 地址直接作为根域名返回
- 确保本地开发环境正常工作

### 通配域名处理

Cookie 域名以 `.` 开头表示通配，作用于所有子域名：

```javascript
// .example.com 的 Cookie
// 可被 www.example.com, mail.example.com, sub.example.com 等访问
```

本模块在获取相关域名时会同时添加普通形式和通配形式，确保 Cookie 查询的完整性。

## 更新历史

| 版本 | 变更 |
|------|------|
| v1.0 | 初始版本，基础域名匹配功能 |
| v1.1 | 新增 `isIPAddress()` 方法，支持 IP 地址、IPv6、localhost |
| v1.1 | `getRootDomain()` 增加 IP 地址判断，避免错误解析 |
