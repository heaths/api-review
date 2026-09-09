(function () {
  const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : undefined;
  const popup = requireElement(document.getElementById('preview-hover-actions'), HTMLDivElement, '#preview-hover-actions');
  const documentationButton = requireElement(
    popup.querySelector('[data-action="documentation"]'),
    HTMLButtonElement,
    '#preview-hover-actions [data-action="documentation"]',
  );
  const sourceButton = requireElement(
    popup.querySelector('[data-action="source"]'),
    HTMLButtonElement,
    '#preview-hover-actions [data-action="source"]',
  );
  const actionLines = Array.from(document.querySelectorAll('.preview-action-line'))
    .filter(line => line instanceof HTMLElement);
  const documentationGroups = collectDocumentationGroups();
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
        }
        scheduleNavigationStateUpdate();
        break;
      }

      case 'navigateDiffHunk':
        navigateDiffHunk(event.data.direction);
        break;
    }
  });

  window.addEventListener('resize', () => {
    if (isPopupVisible() && activeLine) {
      positionPopup(activeLine, anchorPointerX);
    }
  });
  window.addEventListener('scroll', () => {
    if (isPopupVisible() && activeLine) {
      positionPopup(activeLine, anchorPointerX);
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
      activeLine?.focus();
    }
  });

  bindPopupButton(documentationButton, () => {
    if (!(activeLine instanceof HTMLElement)) {
      return;
    }

    toggleDocumentation(activeLine);
    updatePopup(activeLine);
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
  });

  function initializeActionLines() {
    for (const line of actionLines) {
      line.addEventListener('mouseenter', event => {
        hoveredLine = line;
        anchorPointerX = event.clientX;
        scheduleOpen(line);
      });
      line.addEventListener('mousemove', event => {
        if (hoveredLine !== line) {
          hoveredLine = line;
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
    if (documentationButton.disabled && sourceButton.disabled) {
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
      || popup.contains(document.activeElement);
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
    const documentationGroup = line.dataset.documentationGroup;
    const documentationVisible = documentationGroup ? isDocumentationVisible(documentationGroup) : false;

    documentationButton.setAttribute('aria-pressed', String(documentationVisible));
    documentationButton.disabled = !hasDocumentation;
    documentationButton.innerHTML = documentationVisible ? chevronUpIcon() : chevronDownIcon();

    sourceButton.disabled = !hasSource;
    sourceButton.innerHTML = goToSourceIcon();
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

  function chevronDownIcon() {
    return [
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">',
      '<path d="M3.14598 5.85423L7.64598 10.3542C7.84098 10.5492 8.15798 10.5492 8.35298 10.3542L12.853 5.85423C13.048 5.65923 13.048 5.34223 12.853 5.14723C12.658 4.95223 12.341 4.95223 12.146 5.14723L7.99998 9.29323L3.85398 5.14723C3.65898 4.95223 3.34198 4.95223 3.14698 5.14723C2.95198 5.34223 2.95098 5.65923 3.14598 5.85423Z"/>',
      '</svg>',
    ].join('');
  }

  function chevronUpIcon() {
    return [
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">',
      '<path d="M3.14603 9.85423C3.34103 10.0492 3.65803 10.0492 3.85303 9.85423L7.99903 5.70823L12.145 9.85423C12.34 10.0492 12.657 10.0492 12.852 9.85423C13.047 9.65923 13.047 9.34223 12.852 9.14723L8.35203 4.64723C8.15703 4.45223 7.84003 4.45223 7.64503 4.64723L3.14503 9.14723C2.95003 9.34223 2.95103 9.65923 3.14603 9.85423Z"/>',
      '</svg>',
    ].join('');
  }

  function goToSourceIcon() {
    return [
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">',
      '<path fill-rule="evenodd" clip-rule="evenodd" d="M8.58594 1.00098C8.98394 1.00098 9.36646 1.15943 9.64746 1.44043L12.5605 4.35352C12.8415 4.63552 13.001 5.01704 13.001 5.41504V13.001C13.001 14.106 12.106 15.001 11.001 15.001H5.00098C3.89599 15.001 3.00098 14.106 3.00098 13.001V6.00098H4.00098V13.001C4.00098 13.553 4.44899 14.001 5.00098 14.001H11.001C11.553 14.001 12.001 13.553 12.001 13.001V6.00098H9.50098C8.67299 6.00096 8.00098 5.32897 8.00098 4.50098V2.00098C7.99198 1.97699 7.98265 1.9527 7.97266 1.92871C7.89674 1.74704 7.78717 1.5812 7.64746 1.44238L7.20605 1.00098H8.58594ZM9 4.5C9 4.776 9.224 5 9.5 5H11.793L9 2.20703V4.5Z"/>',
      '<path d="M4.5 0C4.63299 0 4.75952 0.0534683 4.85352 0.147461L6.85352 2.14746C6.90042 2.19336 6.93789 2.24775 6.96289 2.30859C6.98789 2.36959 7.00097 2.43498 7.00098 2.50098C7.00098 2.56698 6.98789 2.63236 6.96289 2.69336C6.93789 2.75323 6.90043 2.80956 6.85352 2.85547L4.85352 4.85547C4.75956 4.94917 4.63278 5.00195 4.5 5.00195C4.36722 5.00195 4.24044 4.94917 4.14648 4.85547C4.05248 4.76147 3.99902 4.63398 3.99902 4.50098C3.99903 4.36799 4.05249 4.24146 4.14648 4.14746L5.29297 3.00098H2.5C2.10201 3.00098 1.72045 3.15944 1.43945 3.44043C1.15846 3.72242 1.00001 4.10298 1 4.50098V5.50098C1 5.63398 0.947516 5.76147 0.853516 5.85547C0.759563 5.94817 0.632774 6.00098 0.5 6.00098C0.367225 6.00098 0.240437 5.94917 0.146484 5.85547C0.0534844 5.76147 0 5.63398 0 5.50098V4.50098C6.17892e-06 3.83799 0.263427 3.20239 0.732422 2.7334C1.20142 2.26441 1.83701 2.00098 2.5 2.00098H5.29297L4.14648 0.855469C4.05248 0.761469 3.99902 0.633977 3.99902 0.500977C3.99903 0.367985 4.05249 0.241455 4.14648 0.147461C4.24048 0.0534683 4.36701 0 4.5 0Z"/>',
      '</svg>',
    ].join('');
  }
}());
