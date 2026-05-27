/**
 * DomainMatcher - 域名匹配工具
 *
 * 功能：
 * - 处理域名树匹配（父域名、子域名）
 * - 支持通配域名（.example.com）
 * - Cookie 域名规范化
 */

export class DomainMatcher {
  constructor() {
    // 常见的顶级域名列表（用于判断域名层级）
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

    // 多级顶级域名
    this.multiLevelTlds = new Set([
      'co.uk', 'com.au', 'gov.uk', 'edu.au', 'org.uk', 'net.nz',
      'co.jp', 'ne.jp', 'or.jp', 'ac.uk', 'gov.au'
    ]);
  }

  /**
   * 规范化域名
   * 移除前导点，转为小写
   */
  normalize(domain) {
    if (!domain) return '';
    return domain.toLowerCase().replace(/^\./, '');
  }

  /**
   * 获取根域名（顶级域名 + 二级域名）
   * 例如: www.sub.example.com -> example.com
   */
  getRootDomain(domain) {
    const normalized = this.normalize(domain);
    const parts = normalized.split('.');

    if (parts.length <= 2) {
      return normalized;
    }

    // 检查是否是多级顶级域名
    const lastTwo = parts.slice(-2).join('.');
    if (this.multiLevelTlds.has(lastTwo)) {
      return parts.slice(-3).join('.');
    }

    // 检查顶级域名
    const lastOne = parts[parts.length - 1];
    if (this.tlds.has(lastOne)) {
      return parts.slice(-2).join('.');
    }

    // 未知顶级域名，保守处理
    return parts.slice(-2).join('.');
  }

  /**
   * 获取所有相关域名（父域名 + 子域名）
   */
  getRelatedDomains(domain) {
    const normalized = this.normalize(domain);
    const domains = new Set();

    // 添加自身
    domains.add(normalized);
    domains.add('.' + normalized);

    // 添加父域名
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

  /**
   * 判断是否是通配域名（以.开头）
   */
  isWildcardDomain(domain) {
    return domain.startsWith('.');
  }

  /**
   * 匹配域名是否在域名列表中
   * 支持精确匹配和通配匹配
   */
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

  /**
   * 检查两个域名是否属于同一站点
   */
  isSameSite(domain1, domain2) {
    return this.getRootDomain(domain1) === this.getRootDomain(domain2);
  }

  /**
   * 获取 Cookie 的有效域名范围
   */
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

  /**
   * 合并域名列表（去重）
   */
  mergeDomains(domains) {
    const result = new Set();

    for (const domain of domains) {
      const normalized = this.normalize(domain);
      result.add(normalized);
    }

    return Array.from(result);
  }

  /**
   * 判断域名是否属于某个站点
   */
  belongsToSite(domain, siteDomain) {
    const domainRoot = this.getRootDomain(domain);
    const siteRoot = this.getRootDomain(siteDomain);

    return domainRoot === siteRoot;
  }
}