/* ============================================================
   孖仔帮站内搜索（4.7 v1.3，仅 /search/ 页引入）
   - 索引 fetch（data-search-index 属性取地址），失败走 error 态
   - 输入即搜：300ms 防抖；清空回初始提示态；Esc 清空
   - 匹配：title/date/excerpt 三字段子串（大小写折叠，不分词）
   - 排序：标题命中 > 摘要命中 > 仅日期命中，同档内 date 倒序（索引序）
   - ?q= 预填：加载即执行一次搜索（无防抖）
   - 高亮：textContent 切分 + createElement('mark')，零 innerHTML
   ============================================================ */
(function () {
  'use strict';

  var input = document.querySelector('[data-search-input]');
  if (!input) return;

  var countEl = document.querySelector('[data-search-count]');
  var resultsEl = document.querySelector('[data-search-results]');
  var states = {};
  ['initial', 'empty', 'error'].forEach(function (name) {
    var el = document.querySelector('[data-search-state="' + name + '"]');
    if (el) states[name] = el;
  });

  var scriptTag = document.querySelector('script[data-search-index]');
  // 索引地址优先取模板经 url_for 相对化下发的 data 属性（theme scripts/rel-url.js）；
  // 兜底按搜索页固定深度（search/index.html → '../'）相对化，不再用根绝对路径
  var INDEX_URL = scriptTag ? scriptTag.getAttribute('data-search-index') : '../search-index.json';

  /**
   * 命中链接相对前缀：直接取索引地址的目录部分（'../' 或 './'）。
   * 索引地址本身按页面深度相对化，其目录部分恰为「页面目录 → 站点根」前缀，
   * 与构建期 rel_url 同源——子路径部署（GitHub Pages 项目页）下同样成立，
   * 且不依赖 location.pathname（任意部署深度均正确）。
   */
  var REL_ROOT = (function () {
    var dir = String(INDEX_URL || '').slice(0, String(INDEX_URL || '').lastIndexOf('/') + 1);
    return dir || './';
  })();

  /** 索引条目 path 为站点根绝对形态（6.5 契约，/posts/pN/ 或 /archives/<ID>.html），渲染时转相对引用 */
  function relHitPath(rootAbsolutePath) {
    return REL_ROOT + String(rootAbsolutePath).replace(/^\//, '');
  }

  var items = null; // 索引加载后缓存
  var debounceTimer = null;
  var lastQuery = '';

  function showState(name) {
    Object.keys(states).forEach(function (key) {
      states[key].hidden = key !== name;
    });
  }

  function showCount(text) {
    if (!countEl) return;
    if (text) {
      countEl.textContent = text;
      countEl.hidden = false;
    } else {
      countEl.hidden = true;
      countEl.textContent = '';
    }
  }

  function clearResults() {
    if (resultsEl) {
      while (resultsEl.firstChild) resultsEl.removeChild(resultsEl.firstChild);
    }
  }

  /** 命中字段高亮：按命中位置切分 textContent，命中段包 <mark>；无命中返回纯文本节点 */
  function buildMarked(text, query) {
    var frag = document.createDocumentFragment();
    if (!query) {
      frag.appendChild(document.createTextNode(text));
      return frag;
    }
    var lower = text.toLowerCase();
    var q = query.toLowerCase();
    var from = 0;
    var hit;
    while ((hit = lower.indexOf(q, from)) !== -1) {
      if (hit > from) frag.appendChild(document.createTextNode(text.slice(from, hit)));
      var mark = document.createElement('mark');
      mark.textContent = text.slice(hit, hit + q.length);
      frag.appendChild(mark);
      from = hit + q.length;
    }
    if (from < text.length) frag.appendChild(document.createTextNode(text.slice(from)));
    return frag;
  }

  function hasHit(text, q) {
    return text.toLowerCase().indexOf(q) !== -1;
  }

  function renderHit(item, q) {
    var a = document.createElement('a');
    a.className = 'post-row search-hit';
    a.setAttribute('data-search-hit', '');
    a.href = relHitPath(item.path);

    var title = document.createElement('span');
    title.className = 'post-row__title';
    title.appendChild(buildMarked(item.title, hasHit(item.title, q) ? q : ''));

    var excerpt = document.createElement('span');
    excerpt.className = 'post-row__excerpt search-hit__excerpt';
    excerpt.appendChild(buildMarked(item.excerpt, hasHit(item.excerpt, q) ? q : ''));

    var date = document.createElement('span');
    date.className = 'post-row__date';
    date.textContent = item.date;

    a.appendChild(title);
    a.appendChild(excerpt);
    a.appendChild(date);
    return a;
  }

  function runSearch(rawQuery) {
    var query = String(rawQuery || '').trim();
    lastQuery = query;
    clearResults();

    if (!query) {
      showCount('');
      showState('initial');
      return;
    }
    if (!items) {
      // 索引未就绪（仍在 fetch 或失败）；失败态由 fetch catch 独立处理
      return;
    }

    var q = query.toLowerCase();
    var matches = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var titleHit = hasHit(String(it.title || ''), q);
      var excerptHit = hasHit(String(it.excerpt || ''), q);
      var dateHit = hasHit(String(it.date || ''), q);
      if (titleHit || excerptHit || dateHit) {
        // 三档排序：标题 2 > 摘要 1 > 日期 0（数组本身 date 倒序，稳定排序保持档内顺序）
        matches.push({ item: it, rank: titleHit ? 2 : excerptHit ? 1 : 0 });
      }
    }
    matches.sort(function (a, b) { return b.rank - a.rank; });

    if (!matches.length) {
      showCount('');
      showState('empty');
      return;
    }

    showCount('共找到 ' + matches.length + ' 篇「' + query + '」相关内容');
    showState('');
    var frag = document.createDocumentFragment();
    matches.forEach(function (m) {
      frag.appendChild(renderHit(m.item, query));
    });
    if (resultsEl) resultsEl.appendChild(frag);
  }

  function showFatal() {
    clearResults();
    showCount('');
    showState('error');
  }

  fetch(INDEX_URL)
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      items = Array.isArray(data && data.items) ? data.items : [];
      // ?q= 预填在索引就绪后执行一次（无防抖延迟）
      var pre = new URLSearchParams(window.location.search).get('q');
      if (pre) {
        input.value = pre;
        runSearch(pre);
      } else if (lastQuery) {
        runSearch(lastQuery);
      }
    })
    .catch(showFatal);

  input.addEventListener('input', function () {
    var value = input.value;
    if (!value.trim()) {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      runSearch('');
      return;
    }
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(function () {
      runSearch(value);
    }, 300);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      input.value = '';
      if (debounceTimer) window.clearTimeout(debounceTimer);
      runSearch('');
    }
  });

  // 桌面端任务页自动聚焦；移动端不自动聚焦（防键盘弹起遮挡）
  if (window.matchMedia('(min-width: 1024px)').matches) {
    input.focus();
  }
})();
