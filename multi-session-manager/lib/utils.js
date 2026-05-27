/**
 * 工具函数库
 */

/**
 * 生成唯一 ID
 */
export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 延迟执行
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 防抖函数
 */
export function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * 节流函数
 */
export function throttle(fn, limit) {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * 深拷贝
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 格式化日期
 */
export function formatDate(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

/**
 * 相对时间
 */
export function relativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} minutes ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;

  return formatDate(timestamp);
}

/**
 * 截断字符串
 */
export function truncate(str, length = 50) {
  if (!str) return '';
  if (str.length <= length) return str;
  return str.substring(0, length - 3) + '...';
}

/**
 * 解析 URL 域名
 */
export function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

/**
 * Cookie 对象转字符串
 */
export function cookieToString(cookie) {
  return `${cookie.name}=${cookie.value}`;
}

/**
 * Cookie 数组转 Cookie 头字符串
 */
export function cookiesToHeader(cookies) {
  return cookies.map(cookieToString).join('; ');
}

/**
 * 检查 Cookie 是否过期
 */
export function isCookieExpired(cookie) {
  if (!cookie.expirationDate) return false;
  return cookie.expirationDate * 1000 < Date.now();
}

/**
 * 过滤有效 Cookie
 */
export function filterValidCookies(cookies) {
  return cookies.filter(c => !isCookieExpired(c));
}

/**
 * 颜色验证
 */
export function isValidColor(color) {
  if (!color) return false;
  return /^#([0-9A-Fa-f]{3}){1,2}$/.test(color) ||
    /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/.test(color) ||
    /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*\)$/.test(color);
}

/**
 * 获取随机颜色
 */
export function getRandomColor() {
  const colors = [
    '#FF5722', '#2196F3', '#4CAF50', '#9C27B0',
    '#FF9800', '#00BCD4', '#E91E63', '#673AB7'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * 存储容量检查
 */
export async function getStorageUsage() {
  return new Promise((resolve) => {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
      resolve({
        used: bytes,
        total: chrome.storage.local.QUOTA_BYTES || 5242880,
        percentage: (bytes / (chrome.storage.local.QUOTA_BYTES || 5242880) * 100).toFixed(2)
      });
    });
  });
}