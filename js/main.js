/* ============================================================
   孖仔帮主题 zaibang 交互脚本（原生 JS，零依赖）
   - 返回顶部：滚动超过 600px 淡入
   - 活动页状态筛选：pill 过滤 + 空态
   - 用户登录状态：导航栏用户按钮更新
   - 评论区初始化：文章详情页挂载评论区
   （移动端导航自 v1.4 起由底部 tabBar 承载（纯静态渲染，零 JS），
    汉堡抽屉交互已随组件退役移除）
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 返回顶部 ---------- */
  var backTop = document.querySelector('[data-back-top]');
  if (backTop) {
    backTop.hidden = false;
    var onScroll = function () {
      if (window.scrollY > 600) {
        backTop.classList.add('is-visible');
      } else {
        backTop.classList.remove('is-visible');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    backTop.addEventListener('click', function () {
      var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  /* ---------- 活动页状态筛选 ---------- */
  var filterBar = document.querySelector('[role="group"][aria-label="按状态筛选活动"]');
  var filterList = document.querySelector('[data-filterable-list]');
  if (filterBar && filterList) {
    var pills = filterBar.querySelectorAll('.filter-pill');
    var emptyState = filterList.nextElementSibling;
    pills.forEach(function (pill) {
      pill.addEventListener('click', function () {
        var status = pill.getAttribute('data-filter');
        pills.forEach(function (p) {
          var active = p === pill;
          p.classList.toggle('is-active', active);
          p.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        var cards = filterList.querySelectorAll('[data-status]');
        var visible = 0;
        cards.forEach(function (card) {
          var show = status === 'all' || card.getAttribute('data-status') === status;
          card.hidden = !show;
          if (show) visible++;
        });
        if (emptyState && emptyState.classList.contains('empty-state')) {
          emptyState.classList.toggle('is-visible', visible === 0);
        }
      });
    });
  }

  /* ---------- 用户登录状态管理（T2）---------- */
  function updateUserButton() {
    var btns = document.querySelectorAll('[data-action="login"]');
    if (!window.MzbAuth) return;

    var user = window.MzbAuth.auth.getUser();
    var isLoggedIn = window.MzbAuth.auth.isLoggedIn();

    btns.forEach(function (btn) {
      if (isLoggedIn && user) {
        // 已登录：显示昵称或头像
        if (user.avatar) {
          btn.innerHTML = '<img class="nav-desktop__user-avatar" src="' + user.avatar + '" alt="">';
        } else if (user.nickname) {
          btn.innerHTML = '<span class="nav-desktop__user-nickname">' + user.nickname + '</span>';
        }
        btn.setAttribute('aria-label', user.nickname || '用户');
        btn.setAttribute('title', '点击退出登录');
      } else {
        // 未登录：显示登录图标
        var iconSvg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"></circle><path d="M6 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"></path></svg>';
        btn.innerHTML = '<span class="nav-desktop__user-icon" aria-hidden="true">' + iconSvg + '</span>';
        btn.setAttribute('aria-label', '用户登录');
        btn.removeAttribute('title');
      }
    });
  }

  // 用户按钮点击事件
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action="login"]');
    if (!btn) return;

    if (window.MzbAuth && window.MzbAuth.auth.isLoggedIn()) {
      // 已登录：点击退出
      if (confirm('确定退出登录？')) {
        window.MzbAuth.auth.logout();
      }
    } else if (window.MzbLoginModal) {
      // 未登录：打开登录模态框
      window.MzbLoginModal.open();
    }
  });

  // 监听登录/登出事件
  window.addEventListener('mzb:login', updateUserButton);
  window.addEventListener('mzb:logout', updateUserButton);
  window.addEventListener('mzb:login-success', function () {
    updateUserButton();
    // 刷新评论区
    if (window.MzbComments) {
      window.MzbComments.refresh();
    }
  });

  /* ---------- 评论区初始化（T3）---------- */
  function initComments() {
    var container = document.querySelector('[data-comments]');
    if (!container) return;
    if (!window.MzbComments) return;

    var postIndex = parseInt(container.getAttribute('data-post-index'), 10);
    if (!postIndex) return;

    window.MzbComments.init(window.MZB_API_BASE);
    window.MzbComments.mount(container, postIndex);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    // 初始化认证模块
    if (window.MzbAuth && window.MZB_API_BASE) {
      window.MzbAuth.init(window.MZB_API_BASE);
    }

    // 更新用户按钮状态
    updateUserButton();

    // 初始化评论区
    initComments();
  }

  // DOM Ready 后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
