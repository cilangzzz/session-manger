# Chrome Profiles API 多账号隔离方案深度解析

## 目录

1. [概述](#概述)
2. [chrome.profiles API 完整方法列表](#chromeprofiles-api-完整方法列表)
3. [Profile 的创建、切换、删除操作](#profile-的创建切换删除操作)
4. [每个 Profile 的数据存储结构](#每个-profile-的数据存储结构)
5. [Profile 切换的事件监听](#profile-切换的事件监听)
6. [通过扩展自动化管理 Profiles](#通过扩展自动化管理-profiles)
7. [Profiles 方案的限制和注意事项](#profiles-方案的限制和注意事项)
8. [实际项目中的使用案例](#实际项目中的使用案例)
9. [替代方案对比](#替代方案对比)

---

## 概述

Chrome Profiles（用户配置文件）是 Chrome 浏览器提供的多账号隔离机制，允许每个用户拥有独立的浏览数据，包括：

- Cookies 和会话数据
- 浏览历史
- 书签
- 扩展程序
- 密码和自动填充数据
- 主题和设置

Chrome Extensions 提供了 `chrome.profiles` API，允许扩展程序获取和管理用户配置文件信息。

### API 可用性

| 平台 | 支持情况 |
|------|----------|
| Chrome Browser | 支持 |
| Chrome OS | 支持 |
| Manifest V3 | 支持 |
| 最低 Chrome 版本 | Chrome 20+ |

### 权限要求

```json
// manifest.json
{
  "permissions": [
    "profiles"
  ]
}
```

---

## chrome.profiles API 完整方法列表

### 1. chrome.profiles.getProfileInfo()

获取当前活动配置文件的信息。

**语法：**

```javascript
chrome.profiles.getProfileInfo(callback)
```

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| callback | function | 回调函数，接收 ProfileInfo 对象 |

**返回值 - ProfileInfo 对象：**

```javascript
{
  id: string,           // 配置文件的唯一标识符
  name: string,         // 配置文件的显示名称
  isPrimary: boolean,   // 是否为主配置文件
  isManaged: boolean,   // 是否为企业托管配置文件
  displayEmail: string, // 显示的电子邮件地址（如果有）
  gaiaName: string      // Google 账户名称（如果有）
}
```

**代码示例：**

```javascript
// manifest.json
{
  "manifest_version": 3,
  "name": "Profile Manager",
  "version": "1.0",
  "permissions": ["profiles"],
  "background": {
    "service_worker": "background.js"
  }
}

// background.js
chrome.profiles.getProfileInfo((profileInfo) => {
  console.log('当前配置文件信息:');
  console.log(`ID: ${profileInfo.id}`);
  console.log(`名称: ${profileInfo.name}`);
  console.log(`是否为主配置文件: ${profileInfo.isPrimary}`);
  console.log(`是否为托管配置文件: ${profileInfo.isManaged}`);

  if (profileInfo.displayEmail) {
    console.log(`显示邮箱: ${profileInfo.displayEmail}`);
  }

  if (profileInfo.gaiaName) {
    console.log(`Google 账户名: ${profileInfo.gaiaName}`);
  }
});
```

### 2. chrome.profiles.onProfileChanged 事件

当用户切换配置文件时触发的事件。

**语法：**

```javascript
chrome.profiles.onProfileChanged.addListener(callback)
```

**回调参数：**

```javascript
function callback(profileInfo) {
  // profileInfo: 新的配置文件信息
}
```

**代码示例：**

```javascript
// 监听配置文件切换事件
chrome.profiles.onProfileChanged.addListener((profileInfo) => {
  console.log(`配置文件已切换到: ${profileInfo.name}`);
  console.log(`新配置文件 ID: ${profileInfo.id}`);

  // 根据不同配置文件执行不同逻辑
  if (profileInfo.isPrimary) {
    console.log('已切换到主配置文件');
    // 执行主配置文件相关操作
  } else {
    console.log('已切换到次要配置文件');
    // 执行次要配置文件相关操作
  }

  // 发送通知
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon.png',
    title: '配置文件已切换',
    message: `当前配置文件: ${profileInfo.name}`
  });
});
```

### 3. chrome.profiles.getProfileName() (已弃用)

> **注意：** 此方法已被弃用，建议使用 `getProfileInfo()` 替代。

---

## Profile 的创建、切换、删除操作

### 重要限制

**Chrome Extensions API 不支持直接创建、切换或删除 Profile！**

`chrome.profiles` API 仅提供**只读**功能，无法通过扩展程序直接操作配置文件。这是 Chrome 的安全设计决策。

### 可行的替代方案

#### 方案一：使用 chrome.windows.create 打开特定配置文件的窗口

虽然不能直接切换配置文件，但可以在特定配置文件中打开新窗口：

```javascript
// 在当前配置文件中打开新窗口
chrome.windows.create({
  url: 'https://example.com',
  type: 'normal',
  focused: true
}, (window) => {
  console.log(`新窗口已创建，窗口 ID: ${window.id}`);
});
```

#### 方案二：使用 Incognito（隐身）模式实现临时隔离

```javascript
// 在隐身模式中打开窗口
chrome.windows.create({
  url: 'https://example.com',
  incognito: true
}, (window) => {
  console.log('隐身窗口已创建');
});
```

#### 方案三：使用 Native Messaging 调用本地程序

通过 Native Messaging 与本地程序通信，实现更底层的配置文件管理：

```javascript
// manifest.json
{
  "permissions": ["nativeMessaging"],
  "background": {
    "service_worker": "background.js"
  }
}

// background.js
function createNewProfile(profileName) {
  chrome.runtime.sendNativeMessage('com.example.profile_manager', {
    action: 'createProfile',
    name: profileName
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Native messaging 错误:', chrome.runtime.lastError);
      return;
    }
    console.log('配置文件创建结果:', response);
  });
}

function launchChromeWithProfile(profilePath) {
  chrome.runtime.sendNativeMessage('com.example.profile_manager', {
    action: 'launchProfile',
    path: profilePath
  }, (response) => {
    console.log('启动结果:', response);
  });
}
```

**Native Messaging Host 示例（Python）：**

```python
#!/usr/bin/env python3
# profile_manager.py

import json
import sys
import subprocess
import os

def get_message():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        return None
    message_length = int.from_bytes(raw_length, byteorder='little')
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)

def send_message(message):
    encoded_message = json.dumps(message).encode('utf-8')
    encoded_length = len(encoded_message).to_bytes(4, byteorder='little')
    sys.stdout.buffer.write(encoded_length)
    sys.stdout.buffer.write(encoded_message)
    sys.stdout.buffer.flush()

def create_profile(name):
    # Windows 路径
    user_data = os.path.expandvars(r'%LOCALAPPDATA%\Google\Chrome\User Data')
    profile_path = os.path.join(user_data, name)

    if not os.path.exists(profile_path):
        os.makedirs(profile_path)
        return {'success': True, 'path': profile_path}
    return {'success': False, 'error': 'Profile already exists'}

def launch_profile(profile_path):
    chrome_path = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
    user_data = os.path.dirname(profile_path)
    profile_dir = os.path.basename(profile_path)

    subprocess.Popen([
        chrome_path,
        f'--user-data-dir={user_data}',
        f'--profile-directory={profile_dir}'
    ])
    return {'success': True}

def main():
    while True:
        message = get_message()
        if message is None:
            break

        action = message.get('action')

        if action == 'createProfile':
            result = create_profile(message.get('name', 'New Profile'))
        elif action == 'launchProfile':
            result = launch_profile(message.get('path'))
        else:
            result = {'error': 'Unknown action'}

        send_message(result)

if __name__ == '__main__':
    main()
```

**Native Messaging Host 配置文件（Windows）：**

```json
// com.example.profile_manager.json
// 位置: HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.example.profile_manager
// 或: %LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\

{
  "name": "com.example.profile_manager",
  "description": "Chrome Profile Manager",
  "path": "C:\\path\\to\\profile_manager.py",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}
```

#### 方案四：命令行启动 Chrome 指定配置文件

```bash
# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" \
  --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data" \
  --profile-directory="Profile 1"

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --user-data-dir="$HOME/Library/Application Support/Google/Chrome" \
  --profile-directory="Profile 1"

# Linux
google-chrome \
  --user-data-dir="$HOME/.config/google-chrome" \
  --profile-directory="Profile 1"
```

---

## 每个 Profile 的数据存储结构

### 用户数据目录位置

| 操作系统 | 默认路径 |
|----------|----------|
| Windows | `%LOCALAPPDATA%\Google\Chrome\User Data` |
| macOS | `~/Library/Application Support/Google/Chrome` |
| Linux | `~/.config/google-chrome` |

### Profile 目录结构

```
User Data/
├── Default/                    # 主配置文件
│   ├── Cookies                 # SQLite 数据库，存储 Cookies
│   ├── Cookies-journal         # Cookies 数据库日志
│   ├── History                 # SQLite 数据库，存储浏览历史
│   ├── Bookmarks               # JSON 文件，存储书签
│   ├── Preferences             # JSON 文件，存储用户设置
│   ├── Web Data                # SQLite 数据库，存储自动填充数据
│   ├── Login Data              # SQLite 数据库，存储保存的密码
│   ├── Favicons                # SQLite 数据库，存储网站图标
│   ├── Top Sites               # SQLite 数据库，存储最常访问的网站
│   ├── Visited Links           # 已访问链接数据库
│   ├── QuotaManager            # 存储配额管理信息
│   ├── Extension Rules/        # 扩展规则数据
│   ├── Extensions/             # 扩展程序文件
│   ├── Local Storage/          # localStorage 数据 (LevelDB)
│   │   └── leveldb/
│   │       ├── 000003.log
│   │       ├── CURRENT
│   │       ├── LOCK
│   │       ├── LOG
│   │       └── MANIFEST-000001
│   ├── Session Storage/        # sessionStorage 数据
│   ├── IndexedDB/              # IndexedDB 数据库
│   ├── File System/            # 文件系统 API 数据
│   ├── Cache/                  # HTTP 缓存
│   ├── Code Cache/             # 代码缓存
│   ├── GPUCache/               # GPU 缓存
│   ├── Service Worker/         # Service Worker 数据
│   ├── databases/              # WebSQL 数据库（已弃用）
│   ├── Sync Data/              # 同步数据
│   ├── Sync Extension Settings/ # 扩展同步设置
│   ├── Network Action Predictor/ # 网络预测数据
│   ├── Origin Bound Certs/     # 域名绑定证书
│   ├── Server Bound Certs/     # 服务器绑定证书
│   ├── TransportSecurity/      # HSTS 数据
│   ├── Site Characteristics Database/ # 站点特征数据
│   ├── Platform Notifications/ # 通知数据
│   ├── Hybrid/                 # 混合渲染数据
│   ├── Default/                # 下载默认路径
│   ├── Crashes/                # 崩溃报告
│   ├── Reporting and NEL/      # 报告和 NEL 数据
│   ├── optimisation_guide/     # 优化指南数据
│   ├── Privacy Sandbox/        # 隐私沙盒数据
│   ├── MEIPreload/             # 预加载数据
│   ├── First Party Sets/       # 第一方集数据
│   ├── Attestation/            # 认证数据
│   ├── aadc_download_rules/    # AADC 下载规则
│   ├── Affiliation Database/   # 关联数据库
│   ├── ads_identifier/         # 广告标识符
│   ├── component_policy_cache/ # 组件策略缓存
│   ├── crowd_strike/           # CrowdStrike 数据
│   ├── download_service/       # 下载服务数据
│   ├── jump_list_icons/        # 跳转列表图标
│   ├── jump_list_icons_new/    # 新跳转列表图标
│   ├── on_device_app_launch/   # 设备上应用启动数据
│   ├── subresource_filter/     # 子资源过滤数据
│   ├── swi_cache/              # SWI 缓存
│   ├── swi_prediction/         # SWI 预测数据
│   ├── video-tutorials/        # 视频教程数据
│   ├── zstd_dictionary/        # Zstd 字典
│   └── ...                     # 其他数据
├── Profile 1/                  # 第二个配置文件
│   └── (与 Default 相同的结构)
├── Profile 2/                  # 第三个配置文件
│   └── (与 Default 相同的结构)
├── Guest Profile/              # 访客配置文件
│   └── (临时数据，关闭后清除)
├── System Profile/             # 系统配置文件
│   └── (系统级数据)
├── Local State                 # 全局状态文件 (JSON)
├── First Run                   # 首次运行标记
├── Safe Browsing Channel Ids   # 安全浏览频道 ID
├── shader_cache/               # 着色器缓存
├── GrShaderCache/              # 图形着色器缓存
├── PnaclTranslationCache/      # PNaCl 翻译缓存
├── PepperFlash/                # Flash 插件（已弃用）
├── pnacl/                      # PNaCl 数据
├── SwiftShader/                # SwiftShader 数据
├── Driftwood/                  # Driftwood 数据
├── BrowserMetrics/             # 浏览器指标
├── crash_reports/              # 崩溃报告
├── SafeBrowsing/               # 安全浏览数据
├── SmartSelection/             # 智能选择数据
├── CertificateTransparency/    # 证书透明度数据
├── SSLErrorAssistant/          # SSL 错误助手
├── Subresource Filter/         # 子资源过滤器
├── InterventionPolicyDatabase/ # 干预策略数据库
├── OnDeviceHeadSuggestModel/   # 设备上头部建议模型
├── OptimizationGuide/          # 优化指南
├── Variations/                 # 变体数据
├── Variations2/                # 变体数据 2
├── VariationsSafeMode/         # 变体安全模式
├── variations_seed_cache/      # 变体种子缓存
├── ClientSidePhishing/         # 客户端钓鱼检测
├── OriginTrials/               # 原始试验
├── Dictionaries/               # 拼写检查字典
├── extensions-logs/            # 扩展日志
├── Extension State/            # 扩展状态
├── Extension Temp/             # 扩展临时文件
├── Extension Binding/          # 扩展绑定
├── Extension Scripts/          # 扩展脚本
├── Extension Service Worker/   # 扩展 Service Worker
├── Extension Settings/         # 扩展设置
├── Extension Rules/            # 扩展规则
├── Extension Storage/          # 扩展存储
│   └── leveldb/
├── Default Extensions/         # 默认扩展
├── External Extensions/        # 外部扩展
├── last_version                # 最后版本号
├── module_data_hash_cache.bin  # 模块数据哈希缓存
├── module_data_hash_cache.bin-1
├── module_data_hash_cache.bin-2
├── module_data_hash_cache.bin-3
└── ...
```

### 关键数据文件详解

#### 1. Cookies（SQLite 数据库）

```sql
-- Cookies 数据库结构
CREATE TABLE cookies(
  creation_utc INTEGER NOT NULL,
  host_key TEXT NOT NULL,
  top_frame_site_key TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  encrypted_value BLOB DEFAULT '',
  path TEXT NOT NULL,
  expires_utc INTEGER NOT NULL,
  is_secure INTEGER NOT NULL,
  is_httponly INTEGER NOT NULL,
  last_access_utc INTEGER NOT NULL,
  has_expires INTEGER NOT NULL DEFAULT 1,
  is_persistent INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 1,
  samesite INTEGER NOT NULL DEFAULT -1,
  source_scheme INTEGER NOT NULL DEFAULT 0,
  source_port INTEGER NOT NULL DEFAULT -1,
  is_same_party INTEGER NOT NULL DEFAULT 0,
  last_update_utc INTEGER NOT NULL DEFAULT 0,
  UNIQUE (host_key, top_frame_site_key, name, path)
);

-- 查询示例
SELECT host_key, name, value, path, expires_utc
FROM cookies
WHERE host_key LIKE '%example.com%';
```

#### 2. History（SQLite 数据库）

```sql
-- 历史记录数据库结构
CREATE TABLE urls(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url LONGVARCHAR,
  title LONGVARCHAR,
  visit_count INTEGER DEFAULT 0 NOT NULL,
  typed_count INTEGER DEFAULT 0 NOT NULL,
  last_visit_time INTEGER NOT NULL,
  hidden INTEGER DEFAULT 0 NOT NULL
);

CREATE TABLE visits(
  id INTEGER PRIMARY KEY,
  url INTEGER NOT NULL,
  visit_time INTEGER NOT NULL,
  from_visit INTEGER,
  transition INTEGER DEFAULT 0 NOT NULL,
  segment_id INTEGER,
  visit_duration INTEGER DEFAULT 0 NOT NULL
);

-- 查询示例
SELECT u.url, u.title, v.visit_time, u.visit_count
FROM urls u
JOIN visits v ON u.id = v.url
ORDER BY v.visit_time DESC
LIMIT 100;
```

#### 3. Web Data（SQLite 数据库）

```sql
-- 自动填充数据
CREATE TABLE autofill(
  name VARCHAR,
  value VARCHAR,
  value_lower VARCHAR,
  pair_id INTEGER DEFAULT 0,
  count INTEGER DEFAULT 1,
  date_created INTEGER DEFAULT 0,
  date_last_used INTEGER DEFAULT 0
);

-- 信用卡数据（加密存储）
CREATE TABLE credit_cards(
  guid VARCHAR PRIMARY KEY,
  name_on_card VARCHAR,
  expiration_month INTEGER,
  expiration_year INTEGER,
  card_number_encrypted BLOB,
  date_modified INTEGER NOT NULL DEFAULT 0,
  origin VARCHAR DEFAULT '',
  use_count INTEGER NOT NULL DEFAULT 0,
  use_date INTEGER NOT NULL DEFAULT 0,
  billing_address_id VARCHAR,
  nickname VARCHAR
);
```

#### 4. Login Data（SQLite 数据库）

```sql
-- 密码存储
CREATE TABLE logins(
  origin_url VARCHAR NOT NULL,
  action_url VARCHAR,
  username_element VARCHAR,
  username_value VARCHAR,
  password_element VARCHAR,
  password_value BLOB,  -- 加密存储
  submit_element VARCHAR,
  signon_realm VARCHAR NOT NULL,
  date_created INTEGER,
  blacklisted_by_user INTEGER NOT NULL,
  scheme INTEGER DEFAULT 0,
  password_type INTEGER,
  times_used INTEGER,
  form_data BLOB,
  display_name VARCHAR,
  avatar_url VARCHAR,
  federation_url VARCHAR,
  is_zero_click INTEGER,
  UNIQUE (origin_url, username_element, username_value, password_element, signon_realm)
);
```

#### 5. Local Storage（LevelDB）

```javascript
// Local Storage 使用 LevelDB 存储
// 数据格式: _key_prefix_<origin>_<key>

// 读取 Local Storage 数据示例（Node.js）
const level = require('level');
const path = require('path');

async function readLocalStorage(profilePath) {
  const dbPath = path.join(profilePath, 'Local Storage', 'leveldb');
  const db = level(dbPath);

  return new Promise((resolve, reject) => {
    const data = {};
    db.createReadStream()
      .on('data', (entry) => {
        // 解析键值
        if (entry.key.startsWith('_')) {
          const match = entry.key.match(/^_(\d+)_(.+)_(.+)$/);
          if (match) {
            const [, , origin, key] = match;
            if (!data[origin]) data[origin] = {};
            data[origin][key] = entry.value.toString();
          }
        }
      })
      .on('error', reject)
      .on('end', () => resolve(data));
  });
}
```

#### 6. Preferences（JSON 文件）

```json
{
  "account_info": [...],
  "autofill": {
    "enabled": true
  },
  "bookmark_bar": {
    "show_on_all_tabs": false
  },
  "browser": {
    "enabled_labs_experiments": [...],
    "window_placement": {...}
  },
  "credentials_enable_service": true,
  "default_search_provider": {...},
  "download": {
    "default_directory": "...",
    "prompt_for_download": false
  },
  "extensions": {
    "alerts": {...},
    "known_disabled": [...],
    "settings": {...}
  },
  "google_services": {
    "last_username": "user@example.com",
    "username": "user@example.com"
  },
  "homepage": "https://www.google.com",
  "homepage_is_newtabpage": false,
  "intl": {
    "accept_languages": "zh-CN,zh,en-US,en"
  },
  "profile": {
    "avatar_index": 0,
    "name": "用户1",
    "is_using_default_name": false,
    "managed_user_id": "",
    "shortcut_manager": [...]
  },
  "session": {
    "restore_on_startup": 1
  },
  "signout": {
    "allowed": true
  },
  "spellcheck": {
    "dictionary": "zh-CN"
  },
  "translate": {
    "enabled": true
  }
}
```

#### 7. Local State（全局状态文件）

```json
{
  "browser": {
    "enabled_labs_experiments": [],
    "last_known_google_url": "https://www.google.com/"
  },
  "profile": {
    "info_cache": {
      "Default": {
        "active_time": "13312345678901234",
        "avatar_icon": "chrome://theme/IDR_PROFILE_AVATAR_0",
        "background_apps": false,
        "gaia_name": "用户名",
        "is_using_default_name": false,
        "managed_user_id": "",
        "name": "用户1",
        "user_name": "user@example.com"
      },
      "Profile 1": {
        "active_time": "13312345678901234",
        "avatar_icon": "chrome://theme/IDR_PROFILE_AVATAR_1",
        "name": "用户2"
      }
    },
    "last_used": "Default",
    "last_active_profiles": ["Default", "Profile 1"],
    "profiles_created": 2
  },
  "signin": {
    "allowed": true
  },
  "user_experience_metrics": {
    "client_id": "...",
    "reporting_enabled": true
  }
}
```

---

## Profile 切换的事件监听

### 完整事件监听示例

```javascript
// manifest.json
{
  "manifest_version": 3,
  "name": "Profile Monitor",
  "version": "1.0",
  "permissions": [
    "profiles",
    "storage",
    "notifications"
  ],
  "background": {
    "service_worker": "background.js"
  }
}

// background.js

// 存储上一个配置文件信息
let previousProfile = null;

// 初始化：获取当前配置文件
chrome.profiles.getProfileInfo((profileInfo) => {
  previousProfile = profileInfo;
  console.log('初始化配置文件:', profileInfo.name);
});

// 监听配置文件切换事件
chrome.profiles.onProfileChanged.addListener((newProfile) => {
  console.log('=== 配置文件切换事件 ===');
  console.log('从:', previousProfile?.name || '未知');
  console.log('到:', newProfile.name);
  console.log('新配置文件 ID:', newProfile.id);
  console.log('是否为主配置文件:', newProfile.isPrimary);
  console.log('是否为托管配置文件:', newProfile.isManaged);

  // 记录切换历史
  recordProfileSwitch(previousProfile, newProfile);

  // 发送通知
  showProfileChangeNotification(newProfile);

  // 执行配置文件特定的操作
  handleProfileChange(newProfile);

  // 更新当前配置文件
  previousProfile = newProfile;
});

// 记录配置文件切换历史
async function recordProfileSwitch(from, to) {
  const { switchHistory = [] } = await chrome.storage.local.get('switchHistory');

  switchHistory.push({
    from: from?.name || '未知',
    to: to.name,
    timestamp: new Date().toISOString(),
    fromId: from?.id,
    toId: to.id
  });

  // 只保留最近 100 条记录
  if (switchHistory.length > 100) {
    switchHistory.shift();
  }

  await chrome.storage.local.set({ switchHistory });
  console.log('切换历史已记录');
}

// 显示通知
function showProfileChangeNotification(profile) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title: '配置文件已切换',
    message: `当前配置文件: ${profile.name}`,
    priority: 2,
    requireInteraction: false
  });
}

// 根据配置文件执行特定操作
async function handleProfileChange(profile) {
  const { profileSettings = {} } = await chrome.storage.local.get('profileSettings');
  const settings = profileSettings[profile.id] || {};

  if (settings.theme) {
    // 应用主题
    console.log('应用主题:', settings.theme);
  }

  if (settings.extensions) {
    // 管理扩展
    console.log('配置扩展:', settings.extensions);
  }

  // 可以根据配置文件执行不同的业务逻辑
  switch (profile.id) {
    case 'default-profile-id':
      console.log('执行主配置文件逻辑');
      break;
    case 'work-profile-id':
      console.log('执行工作配置文件逻辑');
      break;
    case 'personal-profile-id':
      console.log('执行个人配置文件逻辑');
      break;
    default:
      console.log('执行默认逻辑');
  }
}

// 获取切换历史
async function getSwitchHistory() {
  const { switchHistory = [] } = await chrome.storage.local.get('switchHistory');
  return switchHistory;
}

// 清除切换历史
async function clearSwitchHistory() {
  await chrome.storage.local.remove('switchHistory');
  console.log('切换历史已清除');
}
```

### 监听窗口创建事件（间接检测配置文件）

```javascript
// 监听窗口创建，可能表示新配置文件活动
chrome.windows.onCreated.addListener((window) => {
  console.log('新窗口创建:', window.id);

  // 检查是否为隐身窗口
  if (window.incognito) {
    console.log('隐身窗口创建');
    // 隐身窗口有独立的会话隔离
  }

  // 获取当前配置文件信息
  chrome.profiles.getProfileInfo((profileInfo) => {
    console.log('窗口所属配置文件:', profileInfo.name);
  });
});

// 监听标签页创建
chrome.tabs.onCreated.addListener((tab) => {
  console.log('新标签页创建:', tab.id, tab.url);

  // 获取当前配置文件
  chrome.profiles.getProfileInfo((profileInfo) => {
    console.log('标签页所属配置文件:', profileInfo.name);
  });
});
```

### 使用 chrome.runtime 监听扩展启动

```javascript
// 扩展安装或更新时
chrome.runtime.onInstalled.addListener((details) => {
  console.log('扩展事件:', details.reason);

  chrome.profiles.getProfileInfo((profileInfo) => {
    console.log('当前配置文件:', profileInfo.name);

    // 根据配置文件初始化扩展设置
    initializeForProfile(profileInfo);
  });
});

// 扩展启动时
chrome.runtime.onStartup.addListener(() => {
  console.log('浏览器启动');

  chrome.profiles.getProfileInfo((profileInfo) => {
    console.log('启动时配置文件:', profileInfo.name);
  });
});

async function initializeForProfile(profile) {
  const { profileSettings = {} } = await chrome.storage.local.get('profileSettings');

  if (!profileSettings[profile.id]) {
    // 首次在此配置文件中使用，初始化设置
    profileSettings[profile.id] = {
      name: profile.name,
      createdAt: new Date().toISOString(),
      settings: {}
    };

    await chrome.storage.local.set({ profileSettings });
    console.log('配置文件设置已初始化');
  }
}
```

---

## 通过扩展自动化管理 Profiles

### 完整的 Profile 管理扩展示例

```javascript
// manifest.json
{
  "manifest_version": 3,
  "name": "Advanced Profile Manager",
  "version": "1.0.0",
  "description": "高级配置文件管理工具",
  "permissions": [
    "profiles",
    "storage",
    "notifications",
    "tabs",
    "windows",
    "nativeMessaging"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_popup": "popup.html",
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
  }
}
```

```html
<!-- popup.html -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Profile Manager</title>
  <style>
    body {
      width: 350px;
      padding: 15px;
      font-family: 'Segoe UI', Arial, sans-serif;
    }
    h2 {
      margin: 0 0 15px 0;
      color: #333;
    }
    .current-profile {
      background: #e3f2fd;
      padding: 10px;
      border-radius: 8px;
      margin-bottom: 15px;
    }
    .profile-info {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .profile-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #1976d2;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: bold;
    }
    .profile-details h3 {
      margin: 0;
      font-size: 14px;
    }
    .profile-details p {
      margin: 2px 0 0 0;
      font-size: 12px;
      color: #666;
    }
    .section {
      margin-bottom: 15px;
    }
    .section h4 {
      margin: 0 0 10px 0;
      font-size: 13px;
      color: #666;
    }
    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .stat-item {
      background: #f5f5f5;
      padding: 8px;
      border-radius: 6px;
      text-align: center;
    }
    .stat-value {
      font-size: 20px;
      font-weight: bold;
      color: #1976d2;
    }
    .stat-label {
      font-size: 11px;
      color: #666;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    button {
      padding: 10px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      transition: background 0.2s;
    }
    .btn-primary {
      background: #1976d2;
      color: white;
    }
    .btn-primary:hover {
      background: #1565c0;
    }
    .btn-secondary {
      background: #e0e0e0;
      color: #333;
    }
    .btn-secondary:hover {
      background: #d0d0d0;
    }
    .btn-danger {
      background: #f44336;
      color: white;
    }
    .btn-danger:hover {
      background: #d32f2f;
    }
    .history-list {
      max-height: 150px;
      overflow-y: auto;
      font-size: 12px;
    }
    .history-item {
      padding: 5px;
      border-bottom: 1px solid #eee;
    }
    .history-time {
      color: #999;
      font-size: 10px;
    }
  </style>
</head>
<body>
  <h2>Profile Manager</h2>

  <div class="current-profile">
    <div class="profile-info">
      <div class="profile-avatar" id="avatar">?</div>
      <div class="profile-details">
        <h3 id="profileName">加载中...</h3>
        <p id="profileEmail">-</p>
        <p id="profileType">-</p>
      </div>
    </div>
  </div>

  <div class="section">
    <h4>统计信息</h4>
    <div class="stats">
      <div class="stat-item">
        <div class="stat-value" id="switchCount">0</div>
        <div class="stat-label">切换次数</div>
      </div>
      <div class="stat-item">
        <div class="stat-value" id="windowCount">0</div>
        <div class="stat-label">打开窗口</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h4>最近切换历史</h4>
    <div class="history-list" id="historyList">
      <div class="history-item">加载中...</div>
    </div>
  </div>

  <div class="actions">
    <button class="btn-primary" id="btnOpenIncognito">
      打开隐身窗口
    </button>
    <button class="btn-secondary" id="btnViewHistory">
      查看完整历史
    </button>
    <button class="btn-secondary" id="btnExportData">
      导出配置数据
    </button>
    <button class="btn-danger" id="btnClearHistory">
      清除历史记录
    </button>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

```javascript
// popup.js
document.addEventListener('DOMContentLoaded', async () => {
  // 获取当前配置文件信息
  const profileInfo = await getCurrentProfile();
  updateProfileDisplay(profileInfo);

  // 加载统计数据
  await loadStats();

  // 加载历史记录
  await loadHistory();

  // 绑定按钮事件
  document.getElementById('btnOpenIncognito').addEventListener('click', openIncognito);
  document.getElementById('btnViewHistory').addEventListener('click', viewFullHistory);
  document.getElementById('btnExportData').addEventListener('click', exportData);
  document.getElementById('btnClearHistory').addEventListener('click', clearHistory);
});

function getCurrentProfile() {
  return new Promise((resolve) => {
    chrome.profiles.getProfileInfo(resolve);
  });
}

function updateProfileDisplay(profile) {
  // 更新头像
  const avatar = document.getElementById('avatar');
  avatar.textContent = profile.name.charAt(0).toUpperCase();

  // 更新名称
  document.getElementById('profileName').textContent = profile.name;

  // 更新邮箱
  document.getElementById('profileEmail').textContent =
    profile.displayEmail || '未关联 Google 账户';

  // 更新类型
  const types = [];
  if (profile.isPrimary) types.push('主配置文件');
  if (profile.isManaged) types.push('企业托管');
  document.getElementById('profileType').textContent =
    types.length > 0 ? types.join(' | ') : '普通配置文件';
}

async function loadStats() {
  const { switchHistory = [], windowCount = 0 } =
    await chrome.storage.local.get(['switchHistory', 'windowCount']);

  document.getElementById('switchCount').textContent = switchHistory.length;
  document.getElementById('windowCount').textContent = windowCount;
}

async function loadHistory() {
  const { switchHistory = [] } = await chrome.storage.local.get('switchHistory');
  const historyList = document.getElementById('historyList');

  if (switchHistory.length === 0) {
    historyList.innerHTML = '<div class="history-item">暂无切换记录</div>';
    return;
  }

  // 显示最近 10 条记录
  const recentHistory = switchHistory.slice(-10).reverse();
  historyList.innerHTML = recentHistory.map(item => `
    <div class="history-item">
      <div>${item.from} → ${item.to}</div>
      <div class="history-time">${new Date(item.timestamp).toLocaleString()}</div>
    </div>
  `).join('');
}

function openIncognito() {
  chrome.windows.create({
    url: 'chrome://newtab',
    incognito: true
  });
  window.close();
}

async function viewFullHistory() {
  const { switchHistory = [] } = await chrome.storage.local.get('switchHistory');

  // 创建新标签页显示完整历史
  const historyHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>配置文件切换历史</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
        th { background: #f5f5f5; }
      </style>
    </head>
    <body>
      <h1>配置文件切换历史</h1>
      <table>
        <tr>
          <th>时间</th>
          <th>从</th>
          <th>到</th>
        </tr>
        ${switchHistory.map(item => `
          <tr>
            <td>${new Date(item.timestamp).toLocaleString()}</td>
            <td>${item.from}</td>
            <td>${item.to}</td>
          </tr>
        `).join('')}
      </table>
    </body>
    </html>
  `;

  const blob = new Blob([historyHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({ url });
}

async function exportData() {
  const data = await chrome.storage.local.get(null);

  const exportData = {
    exportTime: new Date().toISOString(),
    data: data
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json'
  });

  // 使用下载 API
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({ url }, (tab) => {
    // 延迟释放 URL
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

async function clearHistory() {
  if (confirm('确定要清除所有历史记录吗？')) {
    await chrome.storage.local.remove('switchHistory');
    await loadHistory();
    await loadStats();
  }
}
```

```javascript
// background.js

// 初始化
let currentProfile = null;
let windowCount = 0;

chrome.runtime.onInstalled.addListener(async () => {
  console.log('扩展已安装');
  await initializeExtension();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('浏览器启动');
  await initializeExtension();
});

async function initializeExtension() {
  chrome.profiles.getProfileInfo((profileInfo) => {
    currentProfile = profileInfo;
    console.log('当前配置文件:', profileInfo.name);
  });

  // 加载窗口计数
  const { windowCount: savedCount = 0 } = await chrome.storage.local.get('windowCount');
  windowCount = savedCount;
}

// 监听配置文件切换
chrome.profiles.onProfileChanged.addListener(async (newProfile) => {
  const previousProfile = currentProfile;

  console.log('配置文件切换:', previousProfile?.name, '->', newProfile.name);

  // 记录切换
  await recordSwitch(previousProfile, newProfile);

  // 发送通知
  showNotification(newProfile);

  // 更新当前配置文件
  currentProfile = newProfile;
});

async function recordSwitch(from, to) {
  const { switchHistory = [] } = await chrome.storage.local.get('switchHistory');

  switchHistory.push({
    from: from?.name || '未知',
    fromId: from?.id,
    to: to.name,
    toId: to.id,
    timestamp: new Date().toISOString()
  });

  // 保留最近 1000 条
  while (switchHistory.length > 1000) {
    switchHistory.shift();
  }

  await chrome.storage.local.set({ switchHistory });
}

function showNotification(profile) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: '配置文件已切换',
    message: `当前: ${profile.name}`,
    priority: 1
  });
}

// 监听窗口创建
chrome.windows.onCreated.addListener(async (window) => {
  windowCount++;
  await chrome.storage.local.set({ windowCount });

  if (window.incognito) {
    console.log('隐身窗口创建');
  }
});

// 监听消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'getCurrentProfile') {
    chrome.profiles.getProfileInfo(sendResponse);
    return true;
  }

  if (message.action === 'getStats') {
    chrome.storage.local.get(['switchHistory', 'windowCount'], (data) => {
      sendResponse({
        switchCount: data.switchHistory?.length || 0,
        windowCount: data.windowCount || 0
      });
    });
    return true;
  }
});
```

### 使用 Native Messaging 实现高级管理

```javascript
// native-manager.js
class NativeProfileManager {
  constructor(hostName) {
    this.hostName = hostName;
  }

  async sendNativeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendNativeMessage(this.hostName, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // 获取所有配置文件列表
  async listProfiles() {
    return this.sendNativeMessage({ action: 'listProfiles' });
  }

  // 创建新配置文件
  async createProfile(name) {
    return this.sendNativeMessage({
      action: 'createProfile',
      name: name
    });
  }

  // 启动指定配置文件
  async launchProfile(profileId) {
    return this.sendNativeMessage({
      action: 'launchProfile',
      profileId: profileId
    });
  }

  // 删除配置文件
  async deleteProfile(profileId) {
    return this.sendNativeMessage({
      action: 'deleteProfile',
      profileId: profileId
    });
  }

  // 复制配置文件数据
  async copyProfileData(sourceId, targetId) {
    return this.sendNativeMessage({
      action: 'copyProfileData',
      sourceId: sourceId,
      targetId: targetId
    });
  }
}

// 使用示例
const profileManager = new NativeProfileManager('com.example.profile_manager');

async function createWorkProfile() {
  try {
    const result = await profileManager.createProfile('Work Profile');
    console.log('配置文件创建成功:', result);
    return result;
  } catch (error) {
    console.error('创建失败:', error);
    throw error;
  }
}

async function launchWorkProfile() {
  try {
    await profileManager.launchProfile('Profile 2');
    console.log('工作配置文件已启动');
  } catch (error) {
    console.error('启动失败:', error);
  }
}
```

---

## Profiles 方案的限制和注意事项

### API 限制

| 限制项 | 说明 |
|--------|------|
| **只读访问** | `chrome.profiles` API 只能读取配置文件信息，无法创建、修改或删除 |
| **无法直接切换** | 扩展无法通过 API 直接切换用户的配置文件 |
| **无配置文件列表** | API 不提供获取所有配置文件列表的方法 |
| **权限要求** | 需要 `profiles` 权限，可能需要用户授权 |
| **事件有限** | 只有 `onProfileChanged` 一个事件 |

### 数据隔离限制

```javascript
// 扩展数据隔离说明

// 1. chrome.storage.local - 按配置文件隔离
// 每个配置文件有独立的扩展存储空间
chrome.storage.local.get('key', (data) => {
  // 此数据只在当前配置文件中可用
});

// 2. chrome.storage.sync - 同步到同一 Google 账户
// 如果用户登录了同一 Google 账户，数据会同步
chrome.storage.sync.get('key', (data) => {
  // 此数据会同步到同一账户的所有配置文件
});

// 3. 如果需要跨配置文件共享数据
// 需要使用外部服务器或 chrome.storage.sync
```

### 安全注意事项

```javascript
// 安全最佳实践

// 1. 敏感数据不要存储在扩展存储中
// 不推荐
chrome.storage.local.set({ password: 'user_password' }); // 危险！

// 推荐：使用 chrome.storage.session（内存中，关闭浏览器后清除）
chrome.storage.session.set({ tempToken: 'session_token' });

// 2. 验证配置文件信息
chrome.profiles.getProfileInfo((profileInfo) => {
  // 验证数据完整性
  if (!profileInfo || !profileInfo.id) {
    console.error('无效的配置文件信息');
    return;
  }

  // 根据配置文件类型执行不同逻辑
  if (profileInfo.isManaged) {
    // 企业托管配置文件，可能有额外限制
    applyEnterprisePolicies();
  }
});

// 3. 处理配置文件切换时的数据清理
chrome.profiles.onProfileChanged.addListener((newProfile) => {
  // 清除敏感的临时数据
  chrome.storage.session.clear();

  // 重置扩展状态
  resetExtensionState();
});
```

### 性能注意事项

```javascript
// 性能优化建议

// 1. 避免频繁调用 getProfileInfo
// 不推荐：每次操作都调用
function doSomething() {
  chrome.profiles.getProfileInfo((info) => {
    // 每次都调用 API
  });
}

// 推荐：缓存结果
let cachedProfile = null;

function getProfileInfoCached() {
  return new Promise((resolve) => {
    if (cachedProfile) {
      resolve(cachedProfile);
      return;
    }
    chrome.profiles.getProfileInfo((info) => {
      cachedProfile = info;
      resolve(info);
    });
  });
}

// 在配置文件切换时更新缓存
chrome.profiles.onProfileChanged.addListener((newProfile) => {
  cachedProfile = newProfile;
});

// 2. 批量处理历史记录
// 不推荐：每次切换都写入
chrome.profiles.onProfileChanged.addListener((profile) => {
  chrome.storage.local.set({ lastSwitch: Date.now() });
});

// 推荐：批量写入
let pendingSwitches = [];
let flushTimeout = null;

chrome.profiles.onProfileChanged.addListener((profile) => {
  pendingSwitches.push({
    profile: profile.name,
    time: Date.now()
  });

  if (!flushTimeout) {
    flushTimeout = setTimeout(flushSwitches, 5000); // 5秒后批量写入
  }
});

async function flushSwitches() {
  if (pendingSwitches.length === 0) return;

  const { switchHistory = [] } = await chrome.storage.local.get('switchHistory');
  switchHistory.push(...pendingSwitches);
  await chrome.storage.local.set({ switchHistory });

  pendingSwitches = [];
  flushTimeout = null;
}
```

### 跨平台兼容性

```javascript
// 跨平台路径处理

function getChromeUserDataPath() {
  const platform = navigator.platform.toLowerCase();

  if (platform.includes('win')) {
    // Windows
    return path.join(
      process.env.LOCALAPPDATA,
      'Google', 'Chrome', 'User Data'
    );
  } else if (platform.includes('mac')) {
    // macOS
    return path.join(
      os.homedir(),
      'Library', 'Application Support', 'Google', 'Chrome'
    );
  } else if (platform.includes('linux')) {
    // Linux
    return path.join(
      os.homedir(),
      '.config', 'google-chrome'
    );
  }

  throw new Error('不支持的操作系统');
}

// 注意：扩展 API 无法直接访问文件系统
// 需要通过 Native Messaging 或 File System Access API
```

---

## 实际项目中的使用案例

### 案例一：多账号社交媒体管理工具

```javascript
// social-media-manager.js

class SocialMediaManager {
  constructor() {
    this.accounts = new Map();
    this.currentAccount = null;
  }

  async initialize() {
    // 获取当前配置文件
    const profile = await this.getCurrentProfile();

    // 加载该配置文件的账号设置
    await this.loadAccountSettings(profile);

    // 监听配置文件切换
    chrome.profiles.onProfileChanged.addListener((newProfile) => {
      this.handleProfileChange(newProfile);
    });
  }

  getCurrentProfile() {
    return new Promise((resolve) => {
      chrome.profiles.getProfileInfo(resolve);
    });
  }

  async loadAccountSettings(profile) {
    const key = `accounts_${profile.id}`;
    const { [key]: accounts = [] } = await chrome.storage.local.get(key);

    this.accounts.clear();
    accounts.forEach(acc => {
      this.accounts.set(acc.platform, acc);
    });

    this.currentAccount = profile;
    console.log(`已加载 ${accounts.length} 个账号配置`);
  }

  async handleProfileChange(newProfile) {
    // 保存当前配置文件的设置
    await this.saveAccountSettings();

    // 加载新配置文件的设置
    await this.loadAccountSettings(newProfile);

    // 通知用户
    this.notifyAccountChange(newProfile);
  }

  async saveAccountSettings() {
    if (!this.currentAccount) return;

    const key = `accounts_${this.currentAccount.id}`;
    const accounts = Array.from(this.accounts.values());

    await chrome.storage.local.set({ [key]: accounts });
  }

  notifyAccountChange(profile) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: '账号配置已切换',
      message: `当前配置文件: ${profile.name}\n已加载 ${this.accounts.size} 个账号`
    });
  }

  // 添加账号
  async addAccount(platform, credentials) {
    const account = {
      platform,
      username: credentials.username,
      // 注意：不要存储明文密码！
      token: await this.encryptToken(credentials.token),
      addedAt: new Date().toISOString()
    };

    this.accounts.set(platform, account);
    await this.saveAccountSettings();
  }

  // 加密令牌（示例）
  async encryptToken(token) {
    // 实际应用中应使用更安全的加密方式
    // 可以使用 Web Crypto API
    const encoder = new TextEncoder();
    const data = encoder.encode(token);

    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );

    return { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
  }
}

// 使用
const manager = new SocialMediaManager();
manager.initialize();
```

### 案例二：企业多环境开发工具

```javascript
// dev-environment-manager.js

class DevEnvironmentManager {
  constructor() {
    this.environments = {
      development: {
        name: '开发环境',
        color: '#4CAF50',
        apiEndpoint: 'https://dev.api.example.com',
        features: ['debug', 'verbose-logging']
      },
      staging: {
        name: '测试环境',
        color: '#FF9800',
        apiEndpoint: 'https://staging.api.example.com',
        features: ['debug']
      },
      production: {
        name: '生产环境',
        color: '#F44336',
        apiEndpoint: 'https://api.example.com',
        features: []
      }
    };

    this.profileEnvironmentMap = new Map();
  }

  async initialize() {
    // 加载配置文件-环境映射
    await this.loadMappings();

    // 监听配置文件切换
    chrome.profiles.onProfileChanged.addListener((profile) => {
      this.applyEnvironmentForProfile(profile);
    });

    // 应用当前配置文件的环境
    const currentProfile = await this.getCurrentProfile();
    await this.applyEnvironmentForProfile(currentProfile);
  }

  async loadMappings() {
    const { envMappings = {} } = await chrome.storage.local.get('envMappings');
    Object.entries(envMappings).forEach(([profileId, env]) => {
      this.profileEnvironmentMap.set(profileId, env);
    });
  }

  getCurrentProfile() {
    return new Promise((resolve) => {
      chrome.profiles.getProfileInfo(resolve);
    });
  }

  async applyEnvironmentForProfile(profile) {
    const envName = this.profileEnvironmentMap.get(profile.id) || 'development';
    const env = this.environments[envName];

    if (!env) {
      console.error(`未知环境: ${envName}`);
      return;
    }

    console.log(`应用环境: ${env.name} (配置文件: ${profile.name})`);

    // 更新扩展图标颜色
    this.updateBadge(env);

    // 设置环境变量到存储
    await chrome.storage.local.set({
      currentEnvironment: envName,
      environmentConfig: env
    });

    // 通知所有打开的开发工具标签页
    this.notifyDevTools(env);

    // 显示通知
    this.showEnvironmentNotification(env, profile);
  }

  updateBadge(env) {
    chrome.action.setBadgeText({ text: env.name.substring(0, 2) });
    chrome.action.setBadgeBackgroundColor({ color: env.color });
  }

  notifyDevTools(env) {
    chrome.tabs.query({ url: '*://devtools/*' }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'ENVIRONMENT_CHANGE',
          environment: env
        });
      });
    });
  }

  showEnvironmentNotification(env, profile) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: `环境: ${env.name}`,
      message: `配置文件: ${profile.name}\nAPI: ${env.apiEndpoint}`,
      priority: 1
    });
  }

  // 设置配置文件的环境
  async setProfileEnvironment(profileId, envName) {
    if (!this.environments[envName]) {
      throw new Error(`未知环境: ${envName}`);
    }

    this.profileEnvironmentMap.set(profileId, envName);

    const { envMappings = {} } = await chrome.storage.local.get('envMappings');
    envMappings[profileId] = envName;
    await chrome.storage.local.set({ envMappings });

    console.log(`配置文件 ${profileId} 已设置为 ${envName} 环境`);
  }

  // 获取当前环境配置
  async getCurrentEnvironment() {
    const { currentEnvironment, environmentConfig } =
      await chrome.storage.local.get(['currentEnvironment', 'environmentConfig']);

    return {
      name: currentEnvironment,
      config: environmentConfig
    };
  }
}

// 使用
const envManager = new DevEnvironmentManager();
envManager.initialize();

// 设置特定配置文件的环境
envManager.setProfileEnvironment('profile-work-id', 'production');
envManager.setProfileEnvironment('profile-dev-id', 'development');
```

### 案例三：多账号电商价格监控

```javascript
// price-monitor.js

class MultiAccountPriceMonitor {
  constructor() {
    this.monitors = new Map(); // profileId -> monitors
    this.currentProfile = null;
  }

  async initialize() {
    // 获取当前配置文件
    this.currentProfile = await this.getCurrentProfile();

    // 加载监控配置
    await this.loadMonitors();

    // 监听配置文件切换
    chrome.profiles.onProfileChanged.addListener(async (newProfile) => {
      // 停止当前监控
      this.stopAllMonitors();

      // 切换到新配置文件
      this.currentProfile = newProfile;

      // 加载新配置文件的监控
      await this.loadMonitors();

      // 启动监控
      this.startAllMonitors();
    });

    // 启动监控
    this.startAllMonitors();
  }

  getCurrentProfile() {
    return new Promise((resolve) => {
      chrome.profiles.getProfileInfo(resolve);
    });
  }

  async loadMonitors() {
    const key = `monitors_${this.currentProfile.id}`;
    const { [key]: monitors = [] } = await chrome.storage.local.get(key);

    this.monitors.set(this.currentProfile.id, new Map());

    monitors.forEach(monitor => {
      this.monitors.get(this.currentProfile.id).set(monitor.id, monitor);
    });

    console.log(`已加载 ${monitors.length} 个价格监控`);
  }

  async saveMonitors() {
    const key = `monitors_${this.currentProfile.id}`;
    const monitors = Array.from(
      this.monitors.get(this.currentProfile.id)?.values() || []
    );

    await chrome.storage.local.set({ [key]: monitors });
  }

  // 添加价格监控
  async addMonitor(productUrl, targetPrice, accountInfo) {
    const monitor = {
      id: Date.now().toString(),
      productUrl,
      targetPrice,
      accountInfo: {
        // 存储账号信息用于自动下单
        email: accountInfo.email,
        // 不要存储密码！使用 OAuth 或其他安全方式
      },
      createdAt: new Date().toISOString(),
      lastChecked: null,
      currentPrice: null,
      status: 'active'
    };

    this.monitors.get(this.currentProfile.id).set(monitor.id, monitor);
    await this.saveMonitors();

    // 立即检查一次
    await this.checkPrice(monitor.id);

    return monitor.id;
  }

  // 检查价格
  async checkPrice(monitorId) {
    const monitor = this.monitors.get(this.currentProfile.id)?.get(monitorId);
    if (!monitor || monitor.status !== 'active') return;

    try {
      // 获取当前价格（实际应用中需要调用商品 API）
      const currentPrice = await this.fetchProductPrice(monitor.productUrl);

      monitor.currentPrice = currentPrice;
      monitor.lastChecked = new Date().toISOString();

      // 检查是否达到目标价格
      if (currentPrice <= monitor.targetPrice) {
        await this.notifyPriceDrop(monitor);
        monitor.status = 'triggered';
      }

      await this.saveMonitors();
    } catch (error) {
      console.error(`价格检查失败: ${monitorId}`, error);
    }
  }

  async fetchProductPrice(url) {
    // 实际应用中需要实现价格抓取逻辑
    // 可以使用 background fetch 或通过 content script
    return new Promise((resolve) => {
      // 模拟 API 调用
      setTimeout(() => {
        resolve(Math.random() * 1000);
      }, 500);
    });
  }

  async notifyPriceDrop(monitor) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: '价格达到目标！',
      message: `商品价格已降至 ¥${monitor.currentPrice}\n目标价格: ¥${monitor.targetPrice}`,
      priority: 2,
      buttons: [
        { title: '立即购买' },
        { title: '查看详情' }
      ]
    });

    // 打开商品页面
    chrome.tabs.create({ url: monitor.productUrl });
  }

  startAllMonitors() {
    const profileMonitors = this.monitors.get(this.currentProfile.id);
    if (!profileMonitors) return;

    profileMonitors.forEach((monitor, id) => {
      if (monitor.status === 'active') {
        // 每 5 分钟检查一次
        const intervalId = setInterval(() => {
          this.checkPrice(id);
        }, 5 * 60 * 1000);

        monitor.intervalId = intervalId;
      }
    });
  }

  stopAllMonitors() {
    const profileMonitors = this.monitors.get(this.currentProfile.id);
    if (!profileMonitors) return;

    profileMonitors.forEach((monitor) => {
      if (monitor.intervalId) {
        clearInterval(monitor.intervalId);
        monitor.intervalId = null;
      }
    });
  }

  // 删除监控
  async removeMonitor(monitorId) {
    const monitor = this.monitors.get(this.currentProfile.id)?.get(monitorId);
    if (monitor?.intervalId) {
      clearInterval(monitor.intervalId);
    }

    this.monitors.get(this.currentProfile.id)?.delete(monitorId);
    await this.saveMonitors();
  }
}

// 使用
const priceMonitor = new MultiAccountPriceMonitor();
priceMonitor.initialize();
```

### 案例四：自动化测试框架集成

```javascript
// test-automation.js

class ProfileBasedTestRunner {
  constructor() {
    this.testSuites = new Map();
    this.currentProfile = null;
    this.runningTests = false;
  }

  async initialize() {
    this.currentProfile = await this.getCurrentProfile();

    chrome.profiles.onProfileChanged.addListener((profile) => {
      if (this.runningTests) {
        console.warn('测试运行中，配置文件切换可能导致测试失败');
      }
      this.currentProfile = profile;
    });
  }

  getCurrentProfile() {
    return new Promise((resolve) => {
      chrome.profiles.getProfileInfo(resolve);
    });
  }

  // 注册测试套件
  registerTestSuite(name, config) {
    this.testSuites.set(name, {
      name,
      config,
      profiles: config.profiles || ['*'], // * 表示所有配置文件
      tests: config.tests || [],
      setup: config.setup || (() => {}),
      teardown: config.teardown || (() => {})
    });
  }

  // 检查测试是否适用于当前配置文件
  isTestApplicableForProfile(suite) {
    if (suite.profiles.includes('*')) return true;
    return suite.profiles.includes(this.currentProfile.id);
  }

  // 运行测试
  async runTests(suiteName) {
    const suite = this.testSuites.get(suiteName);
    if (!suite) {
      throw new Error(`测试套件不存在: ${suiteName}`);
    }

    if (!this.isTestApplicableForProfile(suite)) {
      console.log(`测试套件 ${suiteName} 不适用于当前配置文件`);
      return { skipped: true, reason: '不适用于当前配置文件' };
    }

    this.runningTests = true;
    const results = {
      suite: suiteName,
      profile: this.currentProfile.name,
      profileId: this.currentProfile.id,
      startTime: new Date().toISOString(),
      tests: [],
      passed: 0,
      failed: 0
    };

    try {
      // 执行 setup
      await suite.setup();

      // 运行每个测试
      for (const test of suite.tests) {
        const testResult = await this.runTest(test);
        results.tests.push(testResult);

        if (testResult.passed) {
          results.passed++;
        } else {
          results.failed++;
        }
      }

      // 执行 teardown
      await suite.teardown();

    } catch (error) {
      console.error('测试套件执行错误:', error);
      results.error = error.message;
    } finally {
      this.runningTests = false;
    }

    results.endTime = new Date().toISOString();
    return results;
  }

  async runTest(test) {
    const result = {
      name: test.name,
      passed: false,
      error: null,
      duration: 0
    };

    const startTime = Date.now();

    try {
      await test.execute();
      result.passed = true;
    } catch (error) {
      result.error = error.message;
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  // 生成测试报告
  async generateReport(results) {
    const report = {
      generatedAt: new Date().toISOString(),
      profile: {
        name: this.currentProfile.name,
        id: this.currentProfile.id,
        isPrimary: this.currentProfile.isPrimary
      },
      results: results,
      summary: {
        totalSuites: results.length,
        totalTests: results.reduce((sum, r) => sum + r.tests.length, 0),
        totalPassed: results.reduce((sum, r) => sum + r.passed, 0),
        totalFailed: results.reduce((sum, r) => sum + r.failed, 0)
      }
    };

    // 保存报告
    const key = `test_report_${Date.now()}`;
    await chrome.storage.local.set({ [key]: report });

    return report;
  }
}

// 使用示例
const testRunner = new ProfileBasedTestRunner();

// 注册测试套件
testRunner.registerTestSuite('auth-tests', {
  profiles: ['default-profile-id'], // 只在主配置文件运行
  setup: async () => {
    console.log('设置测试环境...');
  },
  teardown: async () => {
    console.log('清理测试环境...');
  },
  tests: [
    {
      name: '登录测试',
      execute: async () => {
        // 测试逻辑
        const result = await testLogin();
        if (!result.success) {
          throw new Error('登录失败');
        }
      }
    },
    {
      name: '登出测试',
      execute: async () => {
        // 测试逻辑
        const result = await testLogout();
        if (!result.success) {
          throw new Error('登出失败');
        }
      }
    }
  ]
});

testRunner.registerTestSuite('cart-tests', {
  profiles: ['*'], // 所有配置文件
  tests: [
    {
      name: '添加商品到购物车',
      execute: async () => {
        // 测试逻辑
      }
    }
  ]
});
```

---

## 替代方案对比

### 方案对比表

| 方案 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **Chrome Profiles** | 完全隔离、原生支持、数据独立 | 无法通过 API 创建/切换 | 多用户长期使用 |
| **Incognito 模式** | 临时隔离、API 支持、无需配置 | 关闭后数据丢失、功能受限 | 临时测试、隐私浏览 |
| **Browser Context (Puppeteer)** | 程序化控制、完全隔离、可创建多个 | 需要 Node.js、无 UI | 自动化测试、爬虫 |
| **chrome.storage 分区** | 简单实现、扩展内隔离 | 仅存储隔离、非浏览器级 | 简单多账号管理 |
| **Native Messaging** | 功能强大、底层控制 | 复杂、需本地程序 | 企业级管理工具 |

### Puppeteer Browser Context 示例

```javascript
// puppeteer-multi-context.js
const puppeteer = require('puppeteer');

async function multiAccountExample() {
  const browser = await puppeteer.launch({
    headless: false,
    userDataDir: './user-data' // 基础用户数据目录
  });

  // 创建独立的浏览器上下文（类似 Profile）
  const context1 = await browser.createBrowserContext();
  const context2 = await browser.createBrowserContext();

  // 每个上下文有独立的 Cookies、localStorage 等
  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  // 账号1 登录
  await page1.goto('https://example.com/login');
  await page1.type('#username', 'user1@example.com');
  await page1.type('#password', 'password1');
  await page1.click('#login');

  // 账号2 登录（完全隔离）
  await page2.goto('https://example.com/login');
  await page2.type('#username', 'user2@example.com');
  await page2.type('#password', 'password2');
  await page2.click('#login');

  // 两个账号可以同时操作，互不干扰
  await page1.goto('https://example.com/dashboard');
  await page2.goto('https://example.com/dashboard');

  // 关闭时清理
  await context1.close();
  await context2.close();
  await browser.close();
}

// 使用持久化上下文
async function persistentContextExample() {
  // 每个用户数据目录对应一个 Profile
  const user1Browser = await puppeteer.launch({
    headless: false,
    userDataDir: './profiles/user1'
  });

  const user2Browser = await puppeteer.launch({
    headless: false,
    userDataDir: './profiles/user2'
  });

  // 两个浏览器实例完全独立
  const page1 = (await user1Browser.pages())[0];
  const page2 = (await user2Browser.pages())[0];

  // ... 操作

  await user1Browser.close();
  await user2Browser.close();
}
```

### Playwright Browser Context 示例

```javascript
// playwright-multi-context.js
const { chromium } = require('playwright');

async function multiAccountExample() {
  const browser = await chromium.launch({
    headless: false
  });

  // 创建隔离的浏览器上下文
  const context1 = await browser.newContext({
    // 可以指定存储状态文件
    storageState: './auth/user1-state.json'
  });

  const context2 = await browser.newContext({
    storageState: './auth/user2-state.json'
  });

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  // 登录并保存状态
  await page1.goto('https://example.com/login');
  await page1.fill('#username', 'user1@example.com');
  await page1.fill('#password', 'password1');
  await page1.click('#login');
  await page1.waitForURL('**/dashboard');

  // 保存登录状态（Cookies、localStorage）
  await context1.storageState({ path: './auth/user1-state.json' });

  // 同样的操作用于第二个账号
  await page2.goto('https://example.com/login');
  await page2.fill('#username', 'user2@example.com');
  await page2.fill('#password', 'password2');
  await page2.click('#login');
  await context2.storageState({ path: './auth/user2-state.json' });

  // 关闭
  await context1.close();
  await context2.close();
  await browser.close();
}

// 使用持久化上下文（类似 Chrome Profile）
async function persistentContextExample() {
  const context1 = await chromium.launchPersistentContext('./profiles/user1', {
    headless: false
  });

  const context2 = await chromium.launchPersistentContext('./profiles/user2', {
    headless: false
  });

  // 数据会持久化到指定目录
  // 下次启动时恢复所有状态

  await context1.close();
  await context2.close();
}
```

---

## 总结

### chrome.profiles API 核心要点

1. **只读 API**：只能获取当前配置文件信息，无法创建、切换或删除
2. **事件监听**：通过 `onProfileChanged` 监听配置文件切换
3. **数据隔离**：每个配置文件有独立的存储空间
4. **权限要求**：需要 `profiles` 权限

### 最佳实践建议

1. **使用 Native Messaging** 实现高级配置文件管理功能
2. **结合 chrome.storage** 实现配置文件特定的设置存储
3. **监听配置文件切换事件** 及时更新扩展状态
4. **考虑跨平台兼容性** 处理不同操作系统的路径差异
5. **安全性优先** 不要在扩展存储中保存敏感信息

### Sources

- [Chrome Extensions Profiles API Documentation](https://developer.chrome.com/docs/extensions/reference/api/profiles)
- [Chromium User Data Directory Documentation](https://chromium.googlesource.com/chromium/src/+/master/docs/user_data_dir.md)
- [Chrome Extension Native Messaging](https://developer.chrome.com/docs/extensions/mv3/nativeMessaging/)
- [Puppeteer Browser Context API](https://pptr.dev/api/puppeteer.browsercontext)
- [Playwright Browser Context API](https://playwright.dev/docs/api/class-browsercontext)
