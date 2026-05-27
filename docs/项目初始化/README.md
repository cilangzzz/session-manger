# Chrome/Edge 扩展开发与多账号隔离 - 文档总览

本文档库包含 Chrome/Edge 扩展开发及多账号信息隔离的完整技术资料。

## 文档目录

| 序号 | 文档 | 主题 | 内容概要 |
|------|------|------|----------|
| 01 | [extension-basics.md](01-extension-basics.md) | 扩展开发基础 | Manifest V3、Service Worker、Content Scripts、权限系统、消息通信、调试测试 |
| 02 | [profiles-api.md](02-profiles-api.md) | Profiles API 方案 | Chrome 配置文件 API、Native Messaging、数据存储结构、自动化管理 |
| 03 | [cookie-management.md](03-cookie-management.md) | Cookie 管理方案 | cookies API 详解、属性说明、存储恢复、多账号管理器实现 |
| 04 | [tab-session-isolation.md](04-tab-session-isolation.md) | 标签页隔离方案 | webRequest API、Tab Session 管理、SessionBox 技术原理 |
| 05 | [container-isolation.md](05-container-isolation.md) | Container 容器方案 | Firefox Containers 原理、Chrome 模拟实现、存储隔离 |
| 06 | [proxy-isolation.md](06-proxy-isolation.md) | 代理隔离方案 | proxy API、PAC 脚本、代理认证、防关联最佳实践 |

## 快速导航

### 按需求选择方案

| 需求场景 | 推荐方案 | 参考文档 |
|----------|----------|----------|
| 学习扩展开发基础 | - | [01-extension-basics.md](01-extension-basics.md) |
| 完全独立的账号环境 | Chrome Profiles | [02-profiles-api.md](02-profiles-api.md) |
| 简单的多账号切换 | Cookie 管理 | [03-cookie-management.md](03-cookie-management.md) |
| 同一窗口多账号 | 标签页隔离 | [04-tab-session-isolation.md](04-tab-session-isolation.md) |
| Firefox 风格容器 | Container 方案 | [05-container-isolation.md](05-container-isolation.md) |
| IP 级别防关联 | 代理隔离 | [06-proxy-isolation.md](06-proxy-isolation.md) |

### 按技术点查阅

| 技术点 | 相关文档 |
|--------|----------|
| Manifest V3 | [01-extension-basics.md](01-extension-basics.md) |
| Service Worker | [01-extension-basics.md](01-extension-basics.md) |
| Content Scripts | [01-extension-basics.md](01-extension-basics.md) |
| 权限系统 | [01-extension-basics.md](01-extension-basics.md) |
| chrome.cookies API | [03-cookie-management.md](03-cookie-management.md) |
| chrome.webRequest API | [04-tab-session-isolation.md](04-tab-session-isolation.md) |
| chrome.proxy API | [06-proxy-isolation.md](06-proxy-isolation.md) |
| chrome.tabs API | [04-tab-session-isolation.md](04-tab-session-isolation.md) |
| Native Messaging | [02-profiles-api.md](02-profiles-api.md) |
| 存储隔离 | [03-cookie-management.md](03-cookie-management.md)、[05-container-isolation.md](05-container-isolation.md) |

## 方案对比总览

| 方案 | 隔离级别 | 实现难度 | 同时多账号 | 防关联能力 |
|------|----------|----------|------------|------------|
| Chrome Profiles | 完全隔离 | 低 | ❌ 需切换窗口 | ⭐⭐⭐⭐⭐ |
| Cookie 管理 | Cookie 级别 | 中 | ❌ 需切换账号 | ⭐⭐ |
| 标签页隔离 | 标签页级别 | 高 | ✅ 支持 | ⭐⭐⭐ |
| Container | 容器级别 | 高 | ✅ 支持 | ⭐⭐⭐⭐ |
| 代理隔离 | IP 级别 | 中 | ✅ 支持 | ⭐⭐⭐⭐⭐ |

## 参考资源

### 官方文档
- [Chrome Extensions Documentation](https://developer.chrome.com/docs/extensions/)
- [Chrome Extensions API Reference](https://developer.chrome.com/docs/extensions/reference/)
- [Microsoft Edge Extensions](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/)
- [MDN WebExtensions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)

### 开源项目
- [Firefox Multi-Account Containers](https://github.com/mozilla/multi-account-containers)
- [Chrome Extension Samples](https://github.com/GoogleChrome/chrome-extensions-samples)
- [SessionBox](https://sessionbox.io/)
