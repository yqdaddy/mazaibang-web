/* ============================================================
   孖仔帮主题 zaibang 交互脚本（原生 JS，零依赖）
   - 返回顶部：滚动超过 600px 淡入
   - 活动页状态筛选：pill 过滤 + 空态
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
})();
