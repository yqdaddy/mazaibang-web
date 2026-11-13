/**
 * 用户认证模块（T2 用户登录）
 * - 微信扫码登录（PC 展示二维码，轮询票据状态）
 * - 账号密码登录
 * - 登录态管理（JWT 存储、刷新、过期处理）
 * - API 封装
 */
(function (global) {
  'use strict';

  // ========== 配置 ==========
  var CONFIG = {
    apiBase: '', // 由 Hexo helper 注入 data-api-base
    tokenKey: 'mzb_access_token',
    refreshTokenKey: 'mzb_refresh_token',
    userKey: 'mzb_user_info',
    tokenExpiryKey: 'mzb_token_expiry',
    tokenLeeway: 60 * 1000, // 提前 60 秒判定过期
    pollInterval: 2000, // 扫码轮询间隔 2 秒
    pollMaxAttempts: 150, // 5 分钟 / 2 秒 = 150 次
    pollMaxConsecutiveErrors: 3 // 连续网络错误上限（达上限终止轮询，防 API 故障时打爆服务器）
  };

  // ========== 存储 API ==========
  var storage = {
    get: function (key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set: function (key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        // 忽略存储错误
      }
    },
    remove: function (key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        // 忽略
      }
    },
    clear: function () {
      storage.remove(CONFIG.tokenKey);
      storage.remove(CONFIG.refreshTokenKey);
      storage.remove(CONFIG.userKey);
      storage.remove(CONFIG.tokenExpiryKey);
    }
  };

  // ========== HTTP 请求封装 ==========
  // 进行中的刷新请求（并发 401 去重：共享同一次刷新，避免刷新令牌轮换互相吊销）
  var refreshInFlight = null;

  /** 刷新令牌（单飞）：并发调用共享同一次刷新请求 */
  function refreshOnce() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = auth.refreshToken().then(
      function (data) {
        refreshInFlight = null;
        return data;
      },
      function (err) {
        refreshInFlight = null;
        throw err;
      }
    );
    return refreshInFlight;
  }

  function request(method, path, data, options) {
    options = options || {};
    // _isRefreshRetry：401 刷新成功后的重试标记（只重试一次，防死循环）
    var isRefreshRetry = !!options._isRefreshRetry;
    var url = CONFIG.apiBase + path;
    var headers = {
      'Content-Type': 'application/json'
    };

    // 注入认证头
    if (options.auth) {
      var token = storage.get(CONFIG.tokenKey);
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
      }
    }

    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      Object.keys(headers).forEach(function (key) {
        xhr.setRequestHeader(key, headers[key]);
      });

      xhr.timeout = options.timeout || 15000;
      xhr.responseType = 'json';

      xhr.onload = function () {
        var status = xhr.status;
        var response = xhr.response;

        // 401：先尝试刷新令牌并重试一次（保留 refresh_token 机会），失败再清除登录态
        if (status === 401 && !isRefreshRetry) {
          refreshOnce().then(function () {
            // 刷新成功：带重试标记重发原请求
            return request(method, path, data, Object.assign({}, options, { _isRefreshRetry: true }));
          }).then(resolve, reject);
          return;
        }

        // 重试后仍 401，或刷新失败：清除登录态并通知全局
        if (status === 401) {
          storage.clear();
          global.dispatchEvent(new CustomEvent('mzb:logout'));
          reject(new Error('登录已过期，请重新登录'));
          return;
        }

        if (status >= 200 && status < 300) {
          // 拆信封
          if (response && typeof response === 'object') {
            if (response.code === 0) {
              resolve(response.data);
            } else {
              reject(new Error(response.message || '请求失败'));
            }
          } else {
            resolve(response);
          }
        } else {
          var msg = (response && response.message) || '网络错误';
          reject(new Error(msg));
        }
      };

      xhr.onerror = function () {
        reject(new Error('网络连接失败'));
      };

      xhr.ontimeout = function () {
        reject(new Error('请求超时'));
      };

      if (data) {
        xhr.send(JSON.stringify(data));
      } else {
        xhr.send();
      }
    });
  }

  // ========== 登录态管理 ==========
  var auth = {
    /** 是否已登录 */
    isLoggedIn: function () {
      var token = storage.get(CONFIG.tokenKey);
      var expiry = parseInt(storage.get(CONFIG.tokenExpiryKey), 10);
      if (!token) return false;
      // 检查是否过期（提前 leeway 判定）
      if (expiry && Date.now() > expiry - CONFIG.tokenLeeway) {
        return false;
      }
      return true;
    },

    /** 获取当前用户信息 */
    getUser: function () {
      var userStr = storage.get(CONFIG.userKey);
      if (!userStr) return null;
      try {
        return JSON.parse(userStr);
      } catch (e) {
        return null;
      }
    },

    /** 获取 Access Token */
    getToken: function () {
      return storage.get(CONFIG.tokenKey);
    },

    /** 保存登录信息 */
    saveSession: function (data) {
      storage.set(CONFIG.tokenKey, data.access_token);
      storage.set(CONFIG.refreshTokenKey, data.refresh_token);
      storage.set(CONFIG.userKey, JSON.stringify(data.user));
      // 计算过期时间
      var expiresAt = Date.now() + data.expires_in * 1000;
      storage.set(CONFIG.tokenExpiryKey, String(expiresAt));
      // 触发登录事件
      global.dispatchEvent(new CustomEvent('mzb:login', { detail: data.user }));
    },

    /** 清除登录态 */
    logout: function () {
      storage.clear();
      global.dispatchEvent(new CustomEvent('mzb:logout'));
    },

    /** 刷新 Token */
    refreshToken: function () {
      var refreshToken = storage.get(CONFIG.refreshTokenKey);
      if (!refreshToken) {
        return Promise.reject(new Error('无刷新令牌'));
      }
      // _isRefreshRetry: true 防止刷新端点 401 时再次触发刷新（死循环）
      return request('POST', '/api/v1/auth/refresh', {
        refresh_token: refreshToken
      }, { _isRefreshRetry: true }).then(function (data) {
        auth.saveSession(data);
        return data;
      }).catch(function (err) {
        auth.logout();
        throw err;
      });
    },

    /** 尝试刷新 Token（如果快过期） */
    ensureValidToken: function () {
      var expiry = parseInt(storage.get(CONFIG.tokenExpiryKey), 10);
      var token = storage.get(CONFIG.tokenKey);
      if (!token) return Promise.resolve(false);

      // 如果还有 5 分钟以上有效期，不刷新
      if (expiry && expiry - Date.now() > 5 * 60 * 1000) {
        return Promise.resolve(true);
      }

      // 尝试刷新
      return auth.refreshToken().then(function () {
        return true;
      }).catch(function () {
        return false;
      });
    }
  };

  // ========== 登录接口 ==========
  var login = {
    /** 账号密码登录 */
    password: function (phone, password, agreed) {
      return request('POST', '/api/v1/auth/login', {
        phone: phone,
        password: password,
        agreed: agreed
      }).then(function (data) {
        auth.saveSession(data);
        return data;
      });
    },

    /** 创建扫码票据 */
    createTicket: function () {
      return request('POST', '/api/v1/auth/ticket', {});
    },

    /** 查询票据状态 */
    getTicketStatus: function (ticket) {
      return request('GET', '/api/v1/auth/ticket/' + encodeURIComponent(ticket), null, { timeout: 5000 });
    },

    /** 微信扫码登录（轮询模式） */
    qrLogin: function (onQrReady, onStatusChange) {
      return login.createTicket().then(function (ticketData) {
        // 回调：二维码准备好
        if (onQrReady) {
          onQrReady(ticketData);
        }

        // 开始轮询
        var attempts = 0;  // 总轮询次数（pollMaxAttempts 封顶）
        var errors = 0;    // 连续网络错误次数（达 pollMaxConsecutiveErrors 终止）
        var pollId = null;
        var stopped = false;

        function poll() {
          if (stopped) return;
          attempts++;
          login.getTicketStatus(ticketData.ticket).then(function (statusData) {
            if (stopped) return;
            errors = 0; // 成功响应重置连续失败计数

            // 状态变化回调
            if (onStatusChange) {
              onStatusChange(statusData);
            }

            // 已确认登录
            if (statusData.status === 'confirmed' && statusData.token) {
              auth.saveSession(statusData.token);
              return;
            }

            // 过期或取消：终态，停止轮询
            if (statusData.status === 'expired' || statusData.status === 'cancelled') {
              return;
            }

            // pending：继续轮询（总次数封顶）
            if (attempts < CONFIG.pollMaxAttempts) {
              pollId = setTimeout(poll, CONFIG.pollInterval);
            } else {
              if (onStatusChange) {
                onStatusChange({ status: 'expired' });
              }
            }
          })['catch'](function () {
            // 网络错误：指数退避重试，连续失败达上限终止并通知用户
            if (stopped) return;
            errors++;
            if (errors >= CONFIG.pollMaxConsecutiveErrors) {
              stopped = true;
              if (onStatusChange) {
                onStatusChange({ status: 'error', message: '网络不稳定，请刷新重试' });
              }
              return;
            }
            // 指数退避：pollInterval * 1.5^errors（首次失败 3s，二次 4.5s，三次终止）
            var delay = Math.round(CONFIG.pollInterval * Math.pow(1.5, errors));
            if (attempts < CONFIG.pollMaxAttempts) {
              pollId = setTimeout(poll, delay);
            }
          });
        }

        poll();

        // 返回取消函数
        return function cancel() {
          stopped = true;
          if (pollId) {
            clearTimeout(pollId);
          }
        };
      });
    },

    /** 获取当前用户信息 */
    getMe: function () {
      return request('GET', '/api/v1/auth/me', null, { auth: true });
    }
  };

  // ========== 初始化配置 ==========
  function init(apiBase) {
    CONFIG.apiBase = apiBase || '';
  }

  // ========== 导出 ==========
  global.MzbAuth = {
    init: init,
    auth: auth,
    login: login,
    request: request,
    storage: storage
  };

})(typeof window !== 'undefined' ? window : this);