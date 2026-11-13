/**
 * 微信扫码登录模态框组件
 * - 显示二维码（PC 端）或引导扫码（移动端）
 * - 协议勾选（在扫码确认时完成）
 */
(function (global) {
  'use strict';

  var loginModal = null;
  var cancelPoll = null;
  var escHandler = null; // ESC 监听器引用（open 挂载 / close 移除，防泄漏）

  /** 创建模态框 DOM */
  function createModal() {
    var modal = document.createElement('div');
    modal.className = 'login-modal';
    modal.id = 'login-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'login-modal-title');
    modal.innerHTML = [
      '<div class="login-modal__backdrop" data-action="close"></div>',
      '<div class="login-modal__content">',
        '<button class="login-modal__close" data-action="close" aria-label="关闭">',
          '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">',
            '<line x1="18" y1="6" x2="6" y2="18"></line>',
            '<line x1="6" y1="6" x2="18" y2="18"></line>',
          '</svg>',
        '</button>',
        '<h2 id="login-modal-title" class="login-modal__title">微信扫码登录</h2>',
        '<div class="login-modal__body">',
          '<div class="login-modal__panel is-active" data-panel="qr">',
            '<div class="login-modal__qr-wrapper">',
              '<img class="login-modal__qr" id="login-qr-image" src="" alt="微信扫码登录">',
              '<div class="login-modal__qr-overlay" id="login-qr-overlay">',
                '<p class="login-modal__qr-status" id="login-qr-status">二维码已过期</p>',
                '<button class="login-modal__refresh-btn" id="login-qr-refresh">刷新二维码</button>',
              '</div>',
            '</div>',
            '<p class="login-modal__hint">',
              '使用微信扫描小程序码<br>在小程序中确认登录',
            '</p>',
          '</div>',
        '</div>',
      '</div>',
    ].join('');

    return modal;
  }

  /** 打开模态框 */
  function open(options) {
    options = options || {};

    if (!loginModal) {
      loginModal = createModal();
      document.body.appendChild(loginModal);
      bindEvents();
    }

    // 重置状态
    reset();

    // 显示模态框
    loginModal.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    // ESC 关闭：打开时挂载（close 时移除，防重复挂载泄漏）
    escHandler = function (e) {
      if (e.key === 'Escape' && loginModal && loginModal.classList.contains('is-open')) {
        close();
      }
    };
    document.addEventListener('keydown', escHandler);

    // 默认显示扫码登录
    switchTab('qr');
    startQrLogin();
  }

  /** 关闭模态框 */
  function close() {
    if (loginModal) {
      loginModal.classList.remove('is-open');
      document.body.style.overflow = '';
    }

    // 取消轮询
    if (cancelPoll) {
      cancelPoll();
      cancelPoll = null;
    }

    // 移除 ESC 监听（与 open 中的挂载成对，防泄漏）
    if (escHandler) {
      document.removeEventListener('keydown', escHandler);
      escHandler = null;
    }
  }

  /** 重置状态 */
  function reset() {
    var qrImage = document.getElementById('login-qr-image');
    var qrOverlay = document.getElementById('login-qr-overlay');
    var errorEl = document.getElementById('login-error');
    var form = document.getElementById('login-password-form');

    if (qrImage) qrImage.src = '';
    if (qrOverlay) qrOverlay.classList.remove('is-visible');
    if (errorEl) errorEl.textContent = '';
    if (form) form.reset();

    // 取消之前的轮询
    if (cancelPoll) {
      cancelPoll();
      cancelPoll = null;
    }
  }

  /** 切换 Tab */
  function switchTab(tab) {
    var tabs = loginModal.querySelectorAll('.login-modal__tab');
    var panels = loginModal.querySelectorAll('.login-modal__panel');

    tabs.forEach(function (t) {
      t.classList.toggle('is-active', t.dataset.tab === tab);
    });

    panels.forEach(function (p) {
      p.classList.toggle('is-active', p.dataset.panel === tab);
    });

    // 切换到扫码时启动登录
    if (tab === 'qr') {
      startQrLogin();
    } else {
      // 切换到密码登录时取消轮询
      if (cancelPoll) {
        cancelPoll();
        cancelPoll = null;
      }
    }
  }

  /** 启动扫码登录 */
  function startQrLogin() {
    if (!global.MzbAuth) {
      console.error('MzbAuth 未初始化');
      return;
    }

    var qrImage = document.getElementById('login-qr-image');
    var qrOverlay = document.getElementById('login-qr-overlay');
    var qrStatus = document.getElementById('login-qr-status');

    // 隐藏过期提示
    if (qrOverlay) qrOverlay.classList.remove('is-visible');

    // 创建票据并轮询
    global.MzbAuth.login.qrLogin(
      function onQrReady(data) {
        // 显示二维码
        if (qrImage) {
          qrImage.src = data.qrcode_url;
        }
      },
      function onStatusChange(data) {
        if (data.status === 'confirmed') {
          // 登录成功，关闭模态框
          close();
          // 刷新页面或更新 UI
          global.dispatchEvent(new CustomEvent('mzb:login-success'));
        } else if (data.status === 'expired') {
          // 二维码过期
          if (qrOverlay) qrOverlay.classList.add('is-visible');
          if (qrStatus) qrStatus.textContent = '二维码已过期';
        } else if (data.status === 'cancelled') {
          // 用户取消
          if (qrOverlay) qrOverlay.classList.add('is-visible');
          if (qrStatus) qrStatus.textContent = '已取消登录';
        } else if (data.status === 'error') {
          // 连续网络错误：提示刷新重试（轮询已终止）
          if (qrOverlay) qrOverlay.classList.add('is-visible');
          if (qrStatus) qrStatus.textContent = data.message || '网络不稳定，请刷新重试';
        }
      }
    ).then(function (cancel) {
      cancelPoll = cancel;
    }).catch(function (err) {
      console.error('扫码登录失败', err);
      if (qrOverlay) qrOverlay.classList.add('is-visible');
      if (qrStatus) qrStatus.textContent = '获取二维码失败';
    });
  }

  /** 提交密码登录 */
  function submitPasswordForm(e) {
    e.preventDefault();

    var form = e.target;
    var phone = form.phone.value.trim();
    var password = form.password.value;
    var agreed = form.agreed.checked;
    var errorEl = document.getElementById('login-error');
    var submitBtn = document.getElementById('login-submit');

    // 清空错误
    if (errorEl) errorEl.textContent = '';

    // 校验
    if (!phone) {
      if (errorEl) errorEl.textContent = '请输入手机号';
      return;
    }
    // 中国大陆手机号格式：11 位，1 开头第二位 3-9
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      if (errorEl) errorEl.textContent = '手机号格式不正确';
      return;
    }
    if (!password) {
      if (errorEl) errorEl.textContent = '请输入密码';
      return;
    }
    if (!agreed) {
      if (errorEl) errorEl.textContent = '请同意用户协议';
      return;
    }

    // 禁用按钮
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '登录中...';
    }

    global.MzbAuth.login.password(phone, password, true)
      .then(function () {
        close();
        global.dispatchEvent(new CustomEvent('mzb:login-success'));
      })
      .catch(function (err) {
        if (errorEl) errorEl.textContent = err.message || '登录失败';
      })
      .finally(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '登录';
        }
      });
  }

  /** 绑定事件 */
  function bindEvents() {
    // 关闭按钮
    loginModal.addEventListener('click', function (e) {
      var action = e.target.closest('[data-action]');
      if (action && action.dataset.action === 'close') {
        close();
      }
    });

    // Tab 切换
    loginModal.addEventListener('click', function (e) {
      var tab = e.target.closest('.login-modal__tab');
      if (tab) {
        switchTab(tab.dataset.tab);
      }
    });

    // 表单提交
    var form = document.getElementById('login-password-form');
    if (form) {
      form.addEventListener('submit', submitPasswordForm);
    }

    // 刷新二维码
    var refreshBtn = document.getElementById('login-qr-refresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        startQrLogin();
      });
    }
  }

  // ========== 导出 ==========
  global.MzbLoginModal = {
    open: open,
    close: close
  };

})(typeof window !== 'undefined' ? window : this);