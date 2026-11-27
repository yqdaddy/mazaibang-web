/**
 * 评论区组件（T3 评论功能）
 * - 评论列表展示（匿名可访问）
 * - 发表评论（需登录）
 * - 删除自己的评论
 * - 回复评论
 */
(function (global) {
  'use strict';

  // ========== 配置 ==========
  var CONFIG = {
    apiBase: '',
    pageSize: 20
  };

  // ========== 状态 ==========
  var state = {
    postIndex: 0,
    comments: [],
    total: 0,
    page: 1,
    hasMore: false,
    loading: false,
    degraded: false,
    replyTo: null // { id, userId, nickname }
  };

  // ========== 工具函数 ==========
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTime(createdAt) {
    var date = new Date(createdAt);
    var now = new Date();
    var diffMs = now.getTime() - date.getTime();
    var diffMins = Math.floor(diffMs / 60000);
    var diffHours = Math.floor(diffMs / 3600000);
    var diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return diffMins + ' 分钟前';
    if (diffHours < 24) return diffHours + ' 小时前';
    if (diffDays < 7) return diffDays + ' 天前';
    return createdAt.slice(0, 10);
  }

  // ========== API 封装 ==========
  function apiGet(path) {
    return new Promise(function (resolve, reject) {
      var url = CONFIG.apiBase + path;
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'json';
      xhr.timeout = 10000;

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          var resp = xhr.response;
          if (resp && resp.code === 0) {
            resolve(resp.data);
          } else {
            reject(new Error((resp && resp.message) || '请求失败'));
          }
        } else {
          reject(new Error('网络错误'));
        }
      };

      xhr.onerror = function () {
        reject(new Error('网络连接失败'));
      };

      xhr.ontimeout = function () {
        reject(new Error('请求超时'));
      };

      xhr.send();
    });
  }

  function apiAuthRequest(method, path, data) {
    return new Promise(function (resolve, reject) {
      var url = CONFIG.apiBase + path;
      var token = global.MzbAuth && global.MzbAuth.auth.getToken();

      if (!token) {
        reject(new Error('请先登录'));
        return;
      }

      var xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.responseType = 'json';
      xhr.timeout = 15000;

      xhr.onload = function () {
        if (xhr.status === 401) {
          global.MzbAuth.auth.logout();
          reject(new Error('登录已过期，请重新登录'));
          return;
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          var resp = xhr.response;
          if (resp && resp.code === 0) {
            resolve(resp.data);
          } else {
            reject(new Error((resp && resp.message) || '请求失败'));
          }
        } else if (xhr.status === 403) {
          reject(new Error('没有权限'));
        } else {
          reject(new Error('网络错误'));
        }
      };

      xhr.onerror = function () {
        reject(new Error('网络连接失败'));
      };

      xhr.ontimeout = function () {
        reject(new Error('请求超时'));
      };

      xhr.send(data ? JSON.stringify(data) : null);
    });
  }

  // ========== DOM 渲染 ==========
  function render(container) {
    var user = global.MzbAuth && global.MzbAuth.auth.getUser();
    var isLoggedIn = !!user;
    var hasComments = state.comments.length > 0;

    var html = [
      '<div class="comments">',
        '<div class="comments__header">',
          '<h3 class="comments__title">评论' + (state.total > 0 ? ' (' + state.total + ')' : '') + '</h3>',
        '</div>',

        // 降级提示
        state.degraded ? '<div class="comments__degraded"><p>评论加载失败，请稍后重试</p></div>' : '',

        // 评论列表
        hasComments ? renderCommentList() : (state.loading ? '' : '<div class="comments__empty"><p>暂无评论，快来抢沙发吧~</p></div>'),

        // 加载更多
        state.hasMore ? '<button class="comments__more" data-action="load-more">' + (state.loading ? '加载中...' : '加载更多') + '</button>' : '',

        // 评论输入
        '<div class="comments__input">',
          isLoggedIn ? renderInputForm() : '<button class="comments__login-btn" data-action="login">登录后发表评论</button>',
        '</div>',
      '</div>'
    ].join('');

    container.innerHTML = html;
    bindCommentEvents(container);
  }

  function renderCommentList() {
    var user = global.MzbAuth && global.MzbAuth.auth.getUser();
    var isLoggedIn = !!user;

    return '<div class="comments__list">' + state.comments.map(function (item) {
      var avatarHtml = item.user && item.user.avatar
        ? '<img class="comment-item__avatar" src="' + escapeHtml(item.user.avatar) + '" alt="">'
        : '<div class="comment-item__avatar comment-item__avatar--default"><span>' + escapeHtml((item.user && item.user.nickname || '?').charAt(0)) + '</span></div>';

      var isMyComment = isLoggedIn && user && item.user && user.id === item.user.id;
      var authorBadge = item.is_author_reply ? '<span class="comment-item__author-badge">作者</span>' : '';
      var replyTo = item.reply_to_user ? '<span class="comment-item__reply-to">回复 ' + escapeHtml(item.reply_to_user.nickname) + '</span>' : '';

      return [
        '<div class="comment-item" data-id="' + item.id + '">',
          avatarHtml,
          '<div class="comment-item__body">',
            '<div class="comment-item__meta">',
              '<span class="comment-item__nickname">' + escapeHtml(item.user && item.user.nickname || '匿名用户') + '</span>',
              authorBadge,
              replyTo,
              '<span class="comment-item__time">' + formatTime(item.created_at) + '</span>',
            '</div>',
            '<p class="comment-item__content">' + escapeHtml(item.content) + '</p>',
            '<div class="comment-item__actions">',
              isLoggedIn ? '<button class="comment-item__reply" data-action="reply" data-id="' + item.id + '" data-nickname="' + escapeHtml(item.user && item.user.nickname || '') + '">回复</button>' : '',
              isMyComment ? '<button class="comment-item__delete" data-action="delete" data-id="' + item.id + '">删除</button>' : '',
            '</div>',
          '</div>',
        '</div>'
      ].join('');
    }).join('') + '</div>';
  }

  function renderInputForm() {
    var replyHint = state.replyTo
      ? '<div class="comments__reply-hint">回复 ' + escapeHtml(state.replyTo.nickname) + ' <button data-action="cancel-reply" type="button">取消</button></div>'
      : '';

    return [
      replyHint,
      '<form class="comments__form" id="comment-form">',
        '<textarea class="comments__textarea" id="comment-content" placeholder="写下你的评论..." rows="3" required></textarea>',
        '<div class="comments__form-footer">',
          '<p class="comments__error" id="comment-error"></p>',
          '<button type="submit" class="comments__submit" id="comment-submit">发表评论</button>',
        '</div>',
      '</form>'
    ].join('');
  }

  // ========== 事件绑定 ==========
  function bindCommentEvents(container) {
    container.addEventListener('click', function (e) {
      var action = e.target.closest('[data-action]');
      if (!action) return;

      var actionType = action.dataset.action;

      switch (actionType) {
        case 'login':
          if (global.MzbLoginModal) {
            global.MzbLoginModal.open();
          }
          break;

        case 'load-more':
          loadMore();
          break;

        case 'reply':
          var id = parseInt(action.dataset.id, 10);
          var nickname = action.dataset.nickname || '';
          state.replyTo = { id: id, nickname: nickname };
          render(container);
          var textarea = container.querySelector('#comment-content');
          if (textarea) textarea.focus();
          break;

        case 'cancel-reply':
          state.replyTo = null;
          render(container);
          break;

        case 'delete':
          var commentId = parseInt(action.dataset.id, 10);
          deleteComment(commentId);
          break;
      }
    });

    // 表单提交
    var form = container.querySelector('#comment-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitComment();
      });
    }
  }

  // ========== 业务逻辑 ==========
  function loadComments(postIndex, page) {
    state.postIndex = postIndex;
    state.page = page || 1;
    state.loading = true;
    state.degraded = false;

    return apiGet('/api/v1/posts/' + postIndex + '/comments?page=' + state.page + '&page_size=' + CONFIG.pageSize)
      .then(function (data) {
        var items = Array.isArray(data.items) ? data.items : [];
        if (state.page === 1) {
          state.comments = items;
        } else {
          state.comments = state.comments.concat(items);
        }
        state.total = typeof data.total === 'number' ? data.total : 0;
        state.hasMore = state.page * CONFIG.pageSize < state.total;
        state.degraded = false;
      })
      .catch(function () {
        state.degraded = true;
      })
      .finally(function () {
        state.loading = false;
      });
  }

  function loadMore() {
    if (state.loading || !state.hasMore) return;
    var container = document.querySelector('[data-comments]');
    if (!container) return;

    loadComments(state.postIndex, state.page + 1).then(function () {
      render(container);
    });
  }

  function submitComment() {
    var container = document.querySelector('[data-comments]');
    var textarea = container.querySelector('#comment-content');
    var errorEl = container.querySelector('#comment-error');
    var submitBtn = container.querySelector('#comment-submit');

    if (!textarea) return;

    var content = textarea.value.trim();
    if (!content) {
      if (errorEl) errorEl.textContent = '请输入评论内容';
      return;
    }
    if (content.length > 1000) {
      if (errorEl) errorEl.textContent = '评论内容不能超过 1000 字';
      return;
    }

    // 清空错误
    if (errorEl) errorEl.textContent = '';

    // 禁用按钮
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '发表中...';
    }

    var reqData = {
      content: content
    };

    // 回复评论
    if (state.replyTo && state.replyTo.id) {
      reqData.reply_to_id = state.replyTo.id;
    }

    apiAuthRequest('POST', '/api/v1/posts/' + state.postIndex + '/comments', reqData)
      .then(function () {
        // 清空输入
        textarea.value = '';
        state.replyTo = null;
        // 重新加载评论列表
        return loadComments(state.postIndex, 1);
      })
      .then(function () {
        render(container);
        // 滚动到评论区
        container.scrollIntoView({ behavior: 'smooth' });
      })
      .catch(function (err) {
        if (errorEl) errorEl.textContent = err.message || '发表失败';
      })
      .finally(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = '发表评论';
        }
      });
  }

  function deleteComment(commentId) {
    if (!confirm('确定删除这条评论吗？')) return;

    var container = document.querySelector('[data-comments]');
    if (!container) return;

    apiAuthRequest('DELETE', '/api/v1/comments/' + commentId)
      .then(function () {
        // 从本地列表移除
        state.comments = state.comments.filter(function (c) {
          return c.id !== commentId;
        });
        state.total = Math.max(0, state.total - 1);
        render(container);
      })
      .catch(function (err) {
        alert(err.message || '删除失败');
      });
  }

  // ========== 初始化 ==========
  function init(apiBase) {
    CONFIG.apiBase = apiBase || '';
  }

  function mount(container, postIndex) {
    if (!container) return;

    init(CONFIG.apiBase);
    state.postIndex = postIndex;

    return loadComments(postIndex, 1).then(function () {
      render(container);
    });
  }

  function refresh() {
    var container = document.querySelector('[data-comments]');
    if (!container || !state.postIndex) return;

    return loadComments(state.postIndex, 1).then(function () {
      render(container);
    });
  }

  // ========== 导出 ==========
  global.MzbComments = {
    init: init,
    mount: mount,
    refresh: refresh
  };

})(typeof window !== 'undefined' ? window : this);