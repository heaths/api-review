(function () {
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
  const popup = requireElement(document.getElementById('preview-hover-actions'), HTMLDivElement, '#preview-hover-actions');
  const documentationButton = requireElement(
    popup.querySelector('[data-action="documentation"]'),
    HTMLButtonElement,
    '#preview-hover-actions [data-action="documentation"]',
  );
  const commentButton = popup.querySelector('[data-action="comment"]');
  const sourceButton = requireElement(
    popup.querySelector('[data-action="source"]'),
    HTMLButtonElement,
    '#preview-hover-actions [data-action="source"]',
  );
  const actionLines = Array.from(document.querySelectorAll('.preview-action-line'))
    .filter(line => line instanceof HTMLElement);
  const documentationGroups = collectDocumentationGroups();
  const commentWindow = createCommentWindow();
  const commentTextarea = requireElement(commentWindow.querySelector('textarea'), HTMLTextAreaElement, '#preview-comment-window textarea');
  const deleteCommentButton = requireElement(commentWindow.querySelector('[data-action="delete-comment"]'), HTMLButtonElement, '#preview-comment-window [data-action="delete-comment"]');
  const cancelCommentButton = requireElement(commentWindow.querySelector('[data-action="cancel-comment"]'), HTMLButtonElement, '#preview-comment-window [data-action="cancel-comment"]');
  const submitCommentButton = requireElement(commentWindow.querySelector('[data-action="submit-comment"]'), HTMLButtonElement, '#preview-comment-window [data-action="submit-comment"]');
  const pullRequestComments = new Map();
  const submitShortcut = getSubmitShortcutLabel();
  let diffHunks = [];
  let activeDiffHunkIndex = 0;
  let hoveredLine;
  let focusedLine;
  let activeLine;
  let anchorPointerX;
  let anchoredLeft;
  let showTimer;
  let hideTimer;
  let pointerActivatedButton;
  let navigationUpdatePending = false;
  let activeCommentLine;
  let activeCommentDialog;
  let pendingCommentOpen;

  initializeActionLines();
  refreshDiffHunks();
  scheduleNavigationStateUpdate();

  window.addEventListener('message', event => {
    switch (event.data?.type) {
      case 'setCommentsVisible': {
        const visible = event.data.visible === true;
        document.body.classList.toggle('comments-visible', visible);
        setAllDocumentationVisible(visible);
        refreshDiffHunks();
        if (activeLine && isPopupVisible()) {
          updatePopup(activeLine);
          positionPopup(activeLine, anchorPointerX, true);
        }
        scheduleNavigationStateUpdate();
        break;
      }

      case 'navigateDiffHunk':
        navigateDiffHunk(event.data.direction);
        break;

      case 'pullRequestCommentState':
        applyPullRequestCommentState(event.data.comments);
        retryPendingCommentOpen();
        break;

      case 'openPullRequestReviewDialog':
        openReviewCommentWindow(event.data.event);
        break;
    }
  });
  vscode?.postMessage({ type: 'requestPullRequestCommentState' });

  window.addEventListener('resize', () => {
    if (isPopupVisible() && activeLine) {
      positionPopup(activeLine, anchorPointerX, true);
    }
    if (isCommentWindowVisible() && activeCommentLine) {
      positionCommentWindow(activeCommentLine, activeCommentDialog?.anchorMode ?? 'inline');
    }
  });
  window.addEventListener('scroll', () => {
    if (isPopupVisible() && activeLine) {
      positionPopup(activeLine, anchorPointerX, true);
    }
    if (isCommentWindowVisible() && activeCommentLine) {
      positionCommentWindow(activeCommentLine, activeCommentDialog?.anchorMode ?? 'inline');
    }
    scheduleNavigationStateUpdate();
  }, true);
  window.addEventListener('load', scheduleNavigationStateUpdate);

  popup.addEventListener('mouseenter', () => {
    clearHideTimer();
  });
  popup.addEventListener('mouseleave', () => {
    scheduleHideIfInactive();
  });
  popup.addEventListener('focusin', () => {
    clearHideTimer();
  });
  popup.addEventListener('focusout', () => {
    window.setTimeout(scheduleHideIfInactive, 0);
  });
  popup.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePopup(true);
      closeCommentWindow();
      activeLine?.focus();
    }
  });

  commentWindow.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCommentWindow();
      activeLine?.focus();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      submitComment();
    }
  });

  if (commentButton instanceof HTMLButtonElement) {
    bindPopupButton(commentButton, () => {
      if (!(activeLine instanceof HTMLElement)) {
        return;
      }

      openCommentWindowForLine(activeLine, 'popup');
    });
  }

  bindPopupButton(documentationButton, () => {
    if (!(activeLine instanceof HTMLElement)) {
      return;
    }

    toggleDocumentation(activeLine);
    updatePopup(activeLine);
    if (isPopupVisible()) {
      positionPopup(activeLine, anchorPointerX, true);
    }
  });

  bindPopupButton(sourceButton, () => {
    if (!(activeLine instanceof HTMLElement)) {
      return;
    }

    const sourceLine = Number(activeLine.dataset.sourceLine);
    if (Number.isInteger(sourceLine)) {
      vscode?.postMessage({ type: 'goToSource', line: sourceLine });
    }
    updatePopup(activeLine);
    if (isPopupVisible()) {
      positionPopup(activeLine, anchorPointerX, true);
    }
  });

  function initializeActionLines() {
    for (const line of actionLines) {
      line.addEventListener('click', event => {
        if (!(event.target instanceof HTMLElement) || !event.target.closest('.preview-action-line')) {
          return;
        }

        if (isPointerOverCommentBadge(line, event.clientX)) {
          event.preventDefault();
          event.stopPropagation();
          activeLine = line;
          openCommentWindowForLine(line, 'inline');
        }
      });
      line.addEventListener('mouseenter', event => {
        if (isPointerOverCommentBadge(line, event.clientX)) {
          hoveredLine = undefined;
          return;
        }

        hoveredLine = line;
        anchorPointerX = event.clientX;
        scheduleOpen(line);
      });
      line.addEventListener('mousemove', event => {
        if (isPointerOverCommentBadge(line, event.clientX)) {
          if (hoveredLine === line) {
            hoveredLine = undefined;
          }
          if (activeLine === line && isPopupVisible()) {
            closePopup(false);
          }
          return;
        }

        if (hoveredLine !== line) {
          hoveredLine = line;
          scheduleOpen(line);
        }
        anchorPointerX = event.clientX;
      });
      line.addEventListener('mouseleave', () => {
        if (hoveredLine === line) {
          hoveredLine = undefined;
        }
        scheduleHideIfInactive();
      });
      line.addEventListener('focus', () => {
        focusedLine = line;
        openForLine(line);
      });
      line.addEventListener('blur', () => {
        if (focusedLine === line) {
          focusedLine = undefined;
        }
        window.setTimeout(scheduleHideIfInactive, 0);
      });
      line.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          closePopup(true);
          line.focus();
          return;
        }
        if ((event.key === 'Enter' || event.key === ' ') && isPopupVisible() && activeLine === line) {
          event.preventDefault();
          focusFirstPopupButton();
        }
      });
    }
  }

  function openForLine(line) {
    clearShowTimer();
    clearHideTimer();
    activeLine = line;
    if (anchorPointerX === undefined) {
      const bounds = line.getBoundingClientRect();
      anchorPointerX = bounds.left + (bounds.width / 2);
    }
    updatePopup(line);
    const commentDisabled = !(commentButton instanceof HTMLButtonElement) || commentButton.disabled;
    if (documentationButton.disabled && sourceButton.disabled && commentDisabled) {
      closePopup(false);
      return;
    }
    popup.classList.add('visible');
    positionPopup(line, anchorPointerX);
  }

  function scheduleOpen(line) {
    clearShowTimer();
    clearHideTimer();
    showTimer = window.setTimeout(() => {
      openForLine(line);
    }, getCssDuration('--preview-hover-delay', 200));
  }

  function scheduleHideIfInactive() {
    clearShowTimer();
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      if (!shouldKeepPopupOpen()) {
        closePopup(false);
      }
    }, getCssDuration('--preview-hover-fade-duration', 100));
  }

  function shouldKeepPopupOpen() {
    return hoveredLine === activeLine
      || focusedLine === activeLine
      || popup.matches(':hover')
      || popup.contains(document.activeElement)
      || commentWindow.contains(document.activeElement)
      || commentWindow.classList.contains('visible');
  }

  function closePopup(clearActiveLine) {
    clearShowTimer();
    clearHideTimer();
    popup.classList.remove('visible');
    anchoredLeft = undefined;
    if (clearActiveLine) {
      activeLine = undefined;
    }
  }

  function updatePopup(line) {
    const hasDocumentation = line.hasAttribute('data-has-documentation');
    const hasSource = line.hasAttribute('data-has-source');
    const hasComment = line.hasAttribute('data-has-pr-comment');
    const documentationGroup = line.dataset.documentationGroup;
    const documentationVisible = documentationGroup ? isDocumentationVisible(documentationGroup) : false;
    const documentationTooltip = documentationVisible
      ? documentationButton.dataset.hideTooltip
      : documentationButton.dataset.showTooltip;

    documentationButton.setAttribute('aria-pressed', String(documentationVisible));
    documentationButton.dataset.icon = documentationVisible ? 'collapse-docs' : 'expand-docs';
    if (documentationTooltip) {
      documentationButton.title = documentationTooltip;
      documentationButton.setAttribute('aria-label', documentationTooltip);
    }
    documentationButton.disabled = !hasDocumentation;

    if (commentButton instanceof HTMLButtonElement) {
      commentButton.disabled = !(line.hasAttribute('data-source-line') || hasComment);
    }

    sourceButton.disabled = !hasSource;
  }

  function positionPopup(line, pointerX, preserveHorizontal) {
    popup.style.left = '0px';
    popup.style.top = '0px';
    popup.hidden = false;
    const popupBounds = popup.getBoundingClientRect();
    const lineBounds = line.getBoundingClientRect();
    const margin = getCssPixels('--preview-hover-min-margin', 8);
    const gap = getCssPixels('--preview-hover-gap', 8);
    const centeredX = (pointerX ?? (lineBounds.left + (lineBounds.width / 2))) - (popupBounds.width / 2);
    const maxLeft = window.innerWidth - popupBounds.width - margin;
    const computedLeft = Math.min(Math.max(centeredX, margin), Math.max(margin, maxLeft));
    const left = preserveHorizontal && anchoredLeft !== undefined
      ? anchoredLeft
      : computedLeft;
    const preferredTop = lineBounds.top - popupBounds.height - gap;
    const top = preferredTop >= margin
      ? preferredTop
      : Math.min(lineBounds.bottom + gap, window.innerHeight - popupBounds.height - margin);

    anchoredLeft = left;
    popup.style.left = `${left}px`;
    popup.style.top = `${Math.max(margin, top)}px`;
  }

  function openCommentWindowForLine(line, anchorMode) {
    const sourceLine = Number(line.dataset.sourceLine ?? line.dataset.line);
    if (!Number.isInteger(sourceLine)) {
      return;
    }

    if (!pullRequestComments.has(sourceLine) && line.hasAttribute('data-has-pr-comment')) {
      pendingCommentOpen = { line, anchorMode, sourceLine };
      vscode?.postMessage({ type: 'requestPullRequestCommentState' });
      return;
    }

    pendingCommentOpen = undefined;
    const existingComment = pullRequestComments.get(sourceLine);
    openCommentWindow({
      kind: 'line',
      sourceLine,
      anchorLine: line,
      anchorMode,
      body: existingComment?.body ?? '',
      placeholder: `Add a pull request comment. Press ${submitShortcut} to submit.`,
      submitLabel: existingComment ? 'Update' : 'Comment',
      showDelete: existingComment !== undefined,
    });
  }

  function openReviewCommentWindow(event) {
    if (event !== 'APPROVE' && event !== 'REQUEST_CHANGES') {
      return;
    }

    openCommentWindow({
      kind: 'review',
      event,
      anchorMode: 'toolbar',
      body: '',
      placeholder: `Add an overall review comment. Press ${submitShortcut} to ${event === 'APPROVE' ? 'approve' : 'reject'}.`,
      submitLabel: event === 'APPROVE' ? 'Approve' : 'Reject',
      showDelete: false,
    });
  }

  function openCommentWindow(options) {
    activeCommentDialog = options;
    activeCommentLine = options.anchorLine;
    commentTextarea.value = options.body;
    commentTextarea.placeholder = options.placeholder;
    submitCommentButton.textContent = options.submitLabel;
    deleteCommentButton.hidden = !options.showDelete;
    commentWindow.classList.add('visible');
    positionCommentWindow(options.anchorLine, options.anchorMode);
    commentTextarea.focus();
    commentTextarea.setSelectionRange(commentTextarea.value.length, commentTextarea.value.length);
  }

  function closeCommentWindow() {
    commentWindow.classList.remove('visible');
    commentWindow.hidden = true;
    activeCommentLine = undefined;
    activeCommentDialog = undefined;
  }

  function positionCommentWindow(line, anchorMode) {
    commentWindow.hidden = false;
    commentWindow.style.left = '0px';
    commentWindow.style.top = '0px';
    commentWindow.style.width = '';
    const bounds = commentWindow.getBoundingClientRect();
    const margin = getCssPixels('--preview-hover-min-margin', 8);
    if (anchorMode === 'center') {
      const left = Math.max(margin, (window.innerWidth - bounds.width) / 2);
      const top = Math.max(margin, (window.innerHeight - bounds.height) / 2);
      commentWindow.style.left = `${left}px`;
      commentWindow.style.top = `${top}px`;
      commentWindow.style.width = `${Math.min(bounds.width, window.innerWidth - (2 * margin))}px`;
      return;
    }

    if (anchorMode === 'toolbar' || !(line instanceof HTMLElement)) {
      const left = Math.max(margin, window.innerWidth - bounds.width - margin);
      commentWindow.style.left = `${left}px`;
      commentWindow.style.top = `${margin}px`;
      commentWindow.style.width = `${Math.min(bounds.width, window.innerWidth - (2 * margin))}px`;
      return;
    }

    const lineBounds = line.getBoundingClientRect();
    const codeGap = getCssPixels('--preview-comment-window-code-gap', 8);
    const maxWidth = window.innerWidth - margin;
    const popupBounds = popup.getBoundingClientRect();
    const preferredLeft = anchorMode === 'popup'
      ? popupBounds.left
      : getInlineAnchorLeft(lineBounds);
    const maxLeft = Math.max(margin, maxWidth - bounds.width);
    const left = Math.min(Math.max(preferredLeft, margin), maxLeft);
    const top = anchorMode === 'popup'
      ? popupBounds.bottom + getCssPixels('--preview-hover-gap', 8)
      : lineBounds.bottom;
    const rightLimit = getCodeFenceRight(line) - codeGap;
    const width = Math.min(bounds.width, Math.max(200, rightLimit - left));

    commentWindow.style.left = `${left}px`;
    commentWindow.style.top = `${Math.max(margin, top)}px`;
    commentWindow.style.width = `${Math.min(width, window.innerWidth - left - margin)}px`;
  }

  function submitComment() {
    if (!activeCommentDialog) {
      return;
    }

    if (activeCommentDialog.kind === 'review') {
      vscode?.postMessage({
        type: 'submitPullRequestReview',
        event: activeCommentDialog.event,
        body: commentTextarea.value,
      });
    } else {
      vscode?.postMessage({
        type: 'upsertPullRequestComment',
        line: activeCommentDialog.sourceLine,
        body: commentTextarea.value,
      });
    }
    closeCommentWindow();
  }

  function deleteComment() {
    if (!activeCommentDialog || activeCommentDialog.kind !== 'line') {
      return;
    }

    vscode?.postMessage({ type: 'deletePullRequestComment', line: activeCommentDialog.sourceLine });
    closeCommentWindow();
  }

  function applyPullRequestCommentState(comments) {
    pullRequestComments.clear();
    for (const comment of Array.isArray(comments) ? comments : []) {
      if (!Number.isInteger(comment?.line) || typeof comment?.body !== 'string') {
        continue;
      }

      pullRequestComments.set(comment.line, comment);
    }

    for (const line of actionLines) {
      const sourceLine = Number(line.dataset.sourceLine ?? line.dataset.line);
      const hasComment = Number.isInteger(sourceLine) && pullRequestComments.has(sourceLine);
      line.toggleAttribute('data-has-pr-comment', hasComment);
    }
  }

  function retryPendingCommentOpen() {
    const pending = pendingCommentOpen;
    if (!pending) {
      return;
    }

    pendingCommentOpen = undefined;
    if (!pending.line.isConnected) {
      return;
    }
    if (!pullRequestComments.has(pending.sourceLine) && pending.line.hasAttribute('data-has-pr-comment')) {
      return;
    }

    openCommentWindowForLine(pending.line, pending.anchorMode);
  }

  function createCommentWindow() {
    const container = document.createElement('div');
    container.id = 'preview-comment-window';
    container.hidden = true;
    container.innerHTML = [
      '<textarea spellcheck="true"></textarea>',
      '<div id="preview-comment-window-footer">',
      '  <span class="preview-comment-window-spacer"></span>',
      '  <button type="button" class="preview-secondary" data-action="delete-comment" hidden>Delete</button>',
      '  <button type="button" class="preview-secondary" data-action="cancel-comment">Cancel</button>',
      '  <button type="button" data-action="submit-comment">Comment</button>',
      '</div>',
    ].join('');
    document.body.appendChild(container);
    bindPopupButton(requireElement(container.querySelector('[data-action="delete-comment"]'), HTMLButtonElement, '#preview-comment-window [data-action="delete-comment"]'), deleteComment);
    bindPopupButton(requireElement(container.querySelector('[data-action="cancel-comment"]'), HTMLButtonElement, '#preview-comment-window [data-action="cancel-comment"]'), closeCommentWindow);
    bindPopupButton(requireElement(container.querySelector('[data-action="submit-comment"]'), HTMLButtonElement, '#preview-comment-window [data-action="submit-comment"]'), submitComment);
    return container;
  }

  function getInlineAnchorLeft(lineBounds) {
    return lineBounds.left;
  }

  function getCodeFenceRight(line) {
    const code = line.closest('code');
    const bounds = code instanceof HTMLElement ? code.getBoundingClientRect() : line.getBoundingClientRect();
    return bounds.right;
  }

  function getCommentBadgeActivationWidth(line) {
    return getCssPixels('--preview-comment-badge-hit-size', 24);
  }

  function isPointerOverCommentBadge(line, clientX) {
    if (!line.hasAttribute('data-has-pr-comment')) {
      return false;
    }

    const lineBounds = line.getBoundingClientRect();
    return (clientX - lineBounds.left) <= getCommentBadgeActivationWidth(line);
  }

  function isCommentWindowVisible() {
    return commentWindow.classList.contains('visible');
  }

  function isPopupVisible() {
    return popup.classList.contains('visible');
  }

  function getSubmitShortcutLabel() {
    const platform = [
      navigator.userAgentData?.platform,
      navigator.platform,
      navigator.userAgent,
    ]
      .filter(value => typeof value === 'string' && value.length > 0)
      .join(' ');
    return /Mac|iPhone|iPad|iPod/u.test(platform) ? 'Cmd+Enter' : 'Ctrl+Enter';
  }

  function toggleDocumentation(line) {
    const groupId = line.dataset.documentationGroup;
    if (!groupId) {
      return;
    }

    const topBefore = line.getBoundingClientRect().top;
    setDocumentationGroupVisible(groupId, !isDocumentationVisible(groupId));
    const topAfter = line.getBoundingClientRect().top;
    window.scrollBy(0, topAfter - topBefore);
  }

  function setAllDocumentationVisible(visible) {
    for (const lines of documentationGroups.values()) {
      for (const line of lines) {
        line.classList.toggle('preview-documentation-visible', visible);
      }
    }
  }

  function isDocumentationVisible(groupId) {
    const lines = documentationGroups.get(groupId);
    return Array.isArray(lines) && lines.some(line => line.classList.contains('preview-documentation-visible'));
  }

  function setDocumentationGroupVisible(groupId, visible) {
    const lines = documentationGroups.get(groupId);
    if (!Array.isArray(lines)) {
      return;
    }

    for (const line of lines) {
      line.classList.toggle('preview-documentation-visible', visible);
    }
  }

  function focusFirstPopupButton() {
    const button = popup.querySelector('button:not([disabled])');
    if (button instanceof HTMLButtonElement) {
      button.focus();
    }
  }

  function bindPopupButton(button, action) {
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || button.disabled) {
        return;
      }

      pointerActivatedButton = button;
      event.preventDefault();
      clearHideTimer();
      action();
    });
    button.addEventListener('click', event => {
      event.preventDefault();
      if (pointerActivatedButton === button) {
        pointerActivatedButton = undefined;
        return;
      }
      if (!button.disabled) {
        action();
      }
    });
    button.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && !button.disabled) {
        event.preventDefault();
        action();
      }
    });
  }

  function isPopupVisible() {
    return popup.classList.contains('visible');
  }

  function clearShowTimer() {
    if (showTimer !== undefined) {
      window.clearTimeout(showTimer);
      showTimer = undefined;
    }
  }

  function clearHideTimer() {
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  }

  function collectDocumentationGroups() {
    const groups = new Map();
    for (const line of document.querySelectorAll('.preview-documentation-line[data-documentation-group]')) {
      if (!(line instanceof HTMLElement)) {
        continue;
      }

      const groupId = line.dataset.documentationGroup;
      if (!groupId) {
        continue;
      }

      const group = groups.get(groupId) ?? [];
      group.push(line);
      groups.set(groupId, group);
    }
    return groups;
  }

  function collectDiffHunks() {
    const hunks = new Map();

    for (const element of document.querySelectorAll('[data-diff-hunk]')) {
      if (!(element instanceof HTMLElement) || !isRenderedDiffHunk(element)) {
        continue;
      }

      const index = getDiffHunkIndex(element);
      if (index === undefined || hunks.has(index)) {
        continue;
      }

      hunks.set(index, element);
    }

    return Array.from(hunks.keys())
      .sort((left, right) => left - right)
      .map(index => hunks.get(index))
      .filter(element => element instanceof HTMLElement);
  }

  function refreshDiffHunks() {
    diffHunks = collectDiffHunks();
    activeDiffHunkIndex = getCurrentDiffHunkIndex();
  }

  function navigateDiffHunk(direction) {
    if (diffHunks.length === 0) {
      reportDiffNavigationState();
      return;
    }

    const referenceIndex = activeDiffHunkIndex;
    const targetIndex = direction === 'previous'
      ? Math.max(referenceIndex - 1, -1)
      : Math.min(referenceIndex + 1, diffHunks.length - 1);
    if (targetIndex < 0 || targetIndex >= diffHunks.length) {
      reportDiffNavigationState();
      return;
    }

    activeDiffHunkIndex = targetIndex;
    diffHunks[targetIndex].scrollIntoView({ block: 'start', inline: 'nearest' });
    window.requestAnimationFrame(reportDiffNavigationState);
  }

  function scheduleNavigationStateUpdate() {
    if (navigationUpdatePending) {
      return;
    }

    navigationUpdatePending = true;
    window.requestAnimationFrame(() => {
      navigationUpdatePending = false;
      activeDiffHunkIndex = getCurrentDiffHunkIndex();
      reportDiffNavigationState();
    });
  }

  function reportDiffNavigationState() {
    if (!vscode) {
      return;
    }

    const currentIndex = activeDiffHunkIndex;
    vscode.postMessage({
      type: 'diffNavigationState',
      canNavigatePrevious: currentIndex > 0,
      canNavigateNext: currentIndex < diffHunks.length - 1,
    });
  }

  function getCurrentDiffHunkIndex() {
    const topThreshold = 1;

    for (let index = diffHunks.length - 1; index >= 0; index--) {
      if (diffHunks[index].getBoundingClientRect().top <= topThreshold) {
        return index;
      }
    }

    return diffHunks.length > 0 ? -1 : 0;
  }

  function getDiffHunkIndex(element) {
    const index = Number.parseInt(element.dataset.diffHunk ?? '', 10);
    return Number.isInteger(index) ? index : undefined;
  }

  function isRenderedDiffHunk(element) {
    return element.getClientRects().length > 0;
  }

  function requireElement(element, constructor, selector) {
    if (!(element instanceof constructor)) {
      throw new Error(`Expected ${selector} to resolve to ${constructor.name}`);
    }
    return element;
  }

  function getCssDuration(name, fallback) {
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return parseCssDuration(value) ?? fallback;
  }

  function getCssPixels(name, fallback) {
    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const pixels = Number.parseFloat(value);
    return Number.isFinite(pixels) ? pixels : fallback;
  }

  function parseCssDuration(value) {
    if (!value) {
      return undefined;
    }
    if (value.endsWith('ms')) {
      const milliseconds = Number.parseFloat(value);
      return Number.isFinite(milliseconds) ? milliseconds : undefined;
    }
    if (value.endsWith('s')) {
      const seconds = Number.parseFloat(value);
      return Number.isFinite(seconds) ? seconds * 1000 : undefined;
    }
    return undefined;
  }

}());
