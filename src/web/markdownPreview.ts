import hljs from 'highlight.js';
import MarkdownIt = require('markdown-it');
import * as vscode from 'vscode';
import {
  goToSourceCommand,
  goToSourceTooltip,
  hideDocumentationTooltip,
  showDocumentationTooltip,
} from './codeLensProvider';
import { DiffAvailability, DiffBaselineSelection, DisplayDiffService, PullRequestContext, ResolvedBaseline } from './displayDiff';
import { renderDiffPreview } from './diffPreview';
import { createDiffLineMetadata, createPreviewLineMetadata, PreviewLineMetadata } from './lineMetadata';
import { PullRequestLineComment, PullRequestReviewController } from './pullRequestReview';
import { ReviewModel } from './reviewModel';

export const reviewMarkdownPreviewViewType = 'heaths.azureApiReview.preview';
export const showPreviewCommentsCommand = 'heaths.azureApiReview.preview.showComments';
export const hidePreviewCommentsCommand = 'heaths.azureApiReview.preview.hideComments';
export const reopenPreviewAsTextCommand = 'heaths.azureApiReview.preview.reopenAsText';
export const showPreviewDiffCommand = 'heaths.azureApiReview.preview.showDiff';
export const nextPreviewDiffHunkCommand = 'heaths.azureApiReview.preview.nextDiffHunk';
export const previousPreviewDiffHunkCommand = 'heaths.azureApiReview.preview.previousDiffHunk';
export const closePreviewDiffCommand = 'heaths.azureApiReview.preview.closeDiff';
export const approvePreviewPullRequestCommand = 'heaths.azureApiReview.preview.approvePullRequest';
export const rejectPreviewPullRequestCommand = 'heaths.azureApiReview.preview.rejectPullRequest';

const hasPreviewCommentsContext = 'heaths.azureApiReview.preview.hasComments';
const previewCommentsVisibleContext = 'heaths.azureApiReview.preview.commentsVisible';
const previewDiffAvailableContext = 'heaths.azureApiReview.preview.diffAvailable';
const previewDiffVisibleContext = 'heaths.azureApiReview.preview.diffVisible';
const previewCanNavigatePreviousDiffContext = 'heaths.azureApiReview.preview.canNavigatePreviousDiff';
const previewCanNavigateNextDiffContext = 'heaths.azureApiReview.preview.canNavigateNextDiff';
const previewInPullRequestContext = 'heaths.azureApiReview.preview.inPullRequest';

interface PreviewPanel {
  readonly document: vscode.TextDocument;
  readonly panel: vscode.WebviewPanel;
  readonly contributedStyles: MarkdownPreviewStyles;
  commentsVisible: boolean;
  hasCommentsPatch: boolean;
  diffAvailable: boolean;
  diffAvailability?: DiffAvailability;
  diffBaseline?: DiffBaselineSelection;
  canNavigatePreviousDiff: boolean;
  canNavigateNextDiff: boolean;
  diffRefreshGeneration: number;
  pullRequestContext?: PullRequestContext;
  pullRequestRefreshGeneration: number;
  generation: number;
}

interface MarkdownPreviewStyleExtension {
  readonly extensionUri: vscode.Uri;
  readonly packageJSON: unknown;
}

interface GoToSourcePreviewWebviewMessage {
  readonly type: 'goToSource';
  readonly line: number;
}

interface DiffNavigationStatePreviewWebviewMessage {
  readonly type: 'diffNavigationState';
  readonly canNavigatePrevious: boolean;
  readonly canNavigateNext: boolean;
}

interface UpsertPullRequestCommentPreviewWebviewMessage {
  readonly type: 'upsertPullRequestComment';
  readonly line: number;
  readonly body: string;
  readonly localId?: string;
}

interface DeletePullRequestCommentPreviewWebviewMessage {
  readonly type: 'deletePullRequestComment';
  readonly line: number;
  readonly localId?: string;
}

interface CreatePullRequestCommentReplyPreviewWebviewMessage {
  readonly type: 'createPullRequestCommentReply';
  readonly line: number;
  readonly originalPostId: number;
  readonly body: string;
}

interface RequestPullRequestCommentStatePreviewWebviewMessage {
  readonly type: 'requestPullRequestCommentState';
}

interface SubmitPullRequestReviewPreviewWebviewMessage {
  readonly type: 'submitPullRequestReview';
  readonly event: 'APPROVE' | 'REQUEST_CHANGES';
  readonly body: string;
}

type PreviewWebviewMessage =
  | GoToSourcePreviewWebviewMessage
  | DiffNavigationStatePreviewWebviewMessage
  | UpsertPullRequestCommentPreviewWebviewMessage
  | DeletePullRequestCommentPreviewWebviewMessage
  | CreatePullRequestCommentReplyPreviewWebviewMessage
  | RequestPullRequestCommentStatePreviewWebviewMessage
  | SubmitPullRequestReviewPreviewWebviewMessage;

interface SetCommentsVisiblePreviewHostMessage {
  readonly type: 'setCommentsVisible';
  readonly visible: boolean;
}

interface NavigateDiffHunkPreviewHostMessage {
  readonly type: 'navigateDiffHunk';
  readonly direction: 'previous' | 'next';
}

interface PullRequestCommentStatePreviewHostMessage {
  readonly type: 'pullRequestCommentState';
  readonly hasPendingReview: boolean;
  readonly comments: readonly PreviewPullRequestCommentState[];
}

interface OpenPullRequestReviewDialogPreviewHostMessage {
  readonly type: 'openPullRequestReviewDialog';
  readonly event: 'APPROVE' | 'REQUEST_CHANGES';
}

type PreviewHostMessage =
  | SetCommentsVisiblePreviewHostMessage
  | NavigateDiffHunkPreviewHostMessage
  | PullRequestCommentStatePreviewHostMessage
  | OpenPullRequestReviewDialogPreviewHostMessage;

export interface MarkdownPreviewStyles {
  readonly stylesheets: readonly vscode.Uri[];
  readonly roots: readonly vscode.Uri[];
}

interface PreviewLineRenderMetadata {
  readonly sourceLine?: number;
  readonly hasDocumentation?: true;
  readonly hasSource?: true;
  readonly hasPullRequestComment?: true;
  readonly hasPullRequestDiscussion?: true;
  readonly pullRequestCommentCount?: number;
  readonly documentationGroupId?: string;
  readonly documentationLine?: true;
  readonly ariaLabel?: string;
}

interface PreviewRenderEnv {
  readonly lineMetadata?: ReadonlyMap<number, PreviewLineRenderMetadata>;
}

interface PreviewPullRequestCommentState {
  readonly line: number;
  readonly comments: readonly PreviewPullRequestCommentEntryState[];
}

interface PreviewPullRequestCommentEntryState {
  readonly id?: number;
  readonly localId?: string;
  readonly body: string;
  readonly renderedBody: string;
  readonly kind: PullRequestLineComment['kind'];
  readonly isDraft: boolean;
  readonly author?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly originalPostId?: number;
}

type DiffQuickPickItem =
  | DiffBaselineQuickPickItem
  | DiffChooseFileQuickPickItem
  | DiffHideQuickPickItem;

interface DiffBaselineQuickPickItem extends vscode.QuickPickItem {
  readonly action: 'baseline';
  readonly baseline: DiffBaselineSelection;
}

interface DiffChooseFileQuickPickItem extends vscode.QuickPickItem {
  readonly action: 'chooseFile';
}

interface DiffHideQuickPickItem extends vscode.QuickPickItem {
  readonly action: 'hide';
}

const markdownRenderer = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code, language) {
    return highlightCode(code, language);
  },
});

const commentMarkdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
});

markdownRenderer.renderer.rules.fence = (tokens, index, options, env) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/u, 1)[0] ?? '';
  const normalized = normalizeLanguage(language);
  const className = normalized.length > 0 ? `${options.langPrefix}${normalized}` : '';
  const classAttribute = className.length > 0 ? ` class="${escapeAttribute(className)}"` : '';
  const startLine = token.map ? token.map[0] + 1 : undefined;
  const previewEnv = isPreviewRenderEnv(env) ? env : undefined;

  return `<pre><code${classAttribute}>${highlightCode(token.content, language, startLine, previewEnv?.lineMetadata)}</code></pre>\n`;
};

export class ReviewMarkdownPreview implements vscode.CustomTextEditorProvider {
  private readonly previews = new Set<PreviewPanel>();
  private activePreview: PreviewPanel | undefined;

  public constructor(
    private readonly model: ReviewModel,
    private readonly extensionUri: vscode.Uri,
    private readonly diffService: DisplayDiffService,
    private readonly pullRequestReview: PullRequestReviewController,
  ) { }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    const contributedStyles = getContributedMarkdownPreviewStyles(vscode.extensions.all);
    const preview: PreviewPanel = {
      document,
      panel: webviewPanel,
      contributedStyles,
      commentsVisible: false,
      hasCommentsPatch: false,
      diffAvailable: false,
      canNavigatePreviousDiff: false,
      canNavigateNextDiff: false,
      diffRefreshGeneration: 0,
      pullRequestRefreshGeneration: 0,
      generation: 0,
    };
    this.previews.add(preview);

    const assets = vscode.Uri.joinPath(this.extensionUri, 'assets');
    const documentDirectory = document.uri.with({ path: document.uri.path.slice(0, document.uri.path.lastIndexOf('/') + 1) });
    webviewPanel.webview.options = {
      enableScripts: true,
      enableForms: false,
      localResourceRoots: [assets, documentDirectory, ...contributedStyles.roots],
    };

    const disposables = [
      webviewPanel.onDidChangeViewState(event => {
        if (event.webviewPanel.active) {
          this.setActivePreview(preview);
        }
      }),
      webviewPanel.webview.onDidReceiveMessage(message => {
        void this.handleMessage(preview, message);
      }),
    ];
    webviewPanel.onDidDispose(() => {
      for (const disposable of disposables) {
        disposable.dispose();
      }
      this.previews.delete(preview);
      if (this.activePreview === preview) {
        this.setActivePreview(undefined);
      }
    });

    if (webviewPanel.active) {
      this.setActivePreview(preview);
    }
    await this.render(preview);
    void this.refreshDiffAvailability(preview);
    void this.refreshPullRequestContext(preview);
  }

  public refresh(uri?: vscode.Uri): void {
    for (const preview of this.previews) {
      if (!uri || preview.document.uri.toString() === uri.toString()) {
        void this.render(preview);
        void this.refreshDiffAvailability(preview);
        void this.refreshPullRequestContext(preview);
      }
    }
  }

  public showComments(): void {
    this.setCommentsVisible(true);
  }

  public hideComments(): void {
    this.setCommentsVisible(false);
  }

  public async showDiffPicker(): Promise<void> {
    const preview = this.activePreview;
    if (!preview) {
      return;
    }

    const availability = await this.refreshDiffAvailability(preview, true);
    if (!availability) {
      return;
    }

    if (!preview.diffBaseline && availability.defaultBaseline) {
      preview.diffBaseline = availability.defaultBaseline;
      await this.render(preview);
    }

    const item = await showDiffQuickPick(preview, availability);
    if (!item) {
      return;
    }

    switch (item.action) {
      case 'hide':
        preview.diffBaseline = undefined;
        await this.render(preview);
        return;

      case 'chooseFile': {
        const selected = await this.pickDiffFile(preview.document.uri);
        if (!selected) {
          return;
        }
        preview.diffBaseline = { kind: 'file', uri: selected.toString() };
        await this.render(preview);
        return;
      }

      case 'baseline':
        preview.diffBaseline = item.baseline;
        await this.render(preview);
        return;
    }
  }

  public async showDiff(documentUri: string, baseline: DiffBaselineSelection): Promise<void> {
    const preview = await this.ensurePreview(vscode.Uri.parse(documentUri));
    if (!preview) {
      throw new Error('Unable to open the Azure API Review preview.');
    }

    preview.diffBaseline = baseline;
    await this.render(preview);
    await this.refreshDiffAvailability(preview);
  }

  public async hideDiff(documentUri: string): Promise<void> {
    const preview = await this.ensurePreview(vscode.Uri.parse(documentUri));
    if (!preview) {
      return;
    }

    preview.diffBaseline = undefined;
    await this.render(preview);
  }

  public async hideActiveDiff(): Promise<void> {
    const preview = this.activePreview;
    if (!preview?.diffBaseline) {
      return;
    }

    preview.diffBaseline = undefined;
    await this.render(preview);
  }

  public async showNextDiffHunk(): Promise<void> {
    await this.navigateActiveDiffHunk('next');
  }

  public async showPreviousDiffHunk(): Promise<void> {
    await this.navigateActiveDiffHunk('previous');
  }

  public async approvePullRequest(): Promise<void> {
    await this.promptPullRequestReview('APPROVE');
  }

  public async rejectPullRequest(): Promise<void> {
    await this.promptPullRequestReview('REQUEST_CHANGES');
  }

  private async handleMessage(preview: PreviewPanel, message: unknown): Promise<void> {
    if (!isPreviewWebviewMessage(message)) {
      return;
    }

    try {
      switch (message.type) {
        case 'goToSource':
          await vscode.commands.executeCommand(goToSourceCommand, {
            uri: preview.document.uri.toString(),
            line: message.line,
          });
          break;

        case 'diffNavigationState':
          preview.canNavigatePreviousDiff = message.canNavigatePrevious;
          preview.canNavigateNextDiff = message.canNavigateNext;
          if (this.activePreview === preview) {
            this.updateContexts(preview);
          }
          break;

        case 'upsertPullRequestComment':
          await this.upsertPullRequestComment(preview, message.line, message.body, message.localId);
          break;

        case 'deletePullRequestComment':
          await this.deletePullRequestComment(preview, message.line, message.localId);
          break;

        case 'createPullRequestCommentReply':
          await this.createPullRequestCommentReply(preview, message.line, message.originalPostId, message.body);
          break;

        case 'requestPullRequestCommentState':
          await this.postPullRequestCommentState(preview);
          break;

        case 'submitPullRequestReview':
          await this.submitPullRequestReview(message.event, message.body);
          break;
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Unable to process preview action: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private setCommentsVisible(visible: boolean): void {
    const preview = this.activePreview;
    if (!preview?.hasCommentsPatch) {
      return;
    }
    preview.commentsVisible = visible;
    void this.postMessage(preview, { type: 'setCommentsVisible', visible });
    this.updateContexts(preview);
  }

  private setActivePreview(preview: PreviewPanel | undefined): void {
    this.activePreview = preview;
    this.updateContexts(preview);
  }

  private updateContexts(preview: PreviewPanel | undefined): void {
    void vscode.commands.executeCommand('setContext', hasPreviewCommentsContext, preview?.hasCommentsPatch === true);
    void vscode.commands.executeCommand('setContext', previewCommentsVisibleContext, preview?.commentsVisible === true);
    void vscode.commands.executeCommand('setContext', previewDiffAvailableContext, preview?.diffAvailable === true);
    void vscode.commands.executeCommand('setContext', previewDiffVisibleContext, preview?.diffBaseline !== undefined);
    void vscode.commands.executeCommand('setContext', previewInPullRequestContext, preview?.pullRequestContext !== undefined);
    void vscode.commands.executeCommand(
      'setContext',
      previewCanNavigatePreviousDiffContext,
      preview?.diffBaseline !== undefined && preview.canNavigatePreviousDiff,
    );
    void vscode.commands.executeCommand(
      'setContext',
      previewCanNavigateNextDiffContext,
      preview?.diffBaseline !== undefined && preview.canNavigateNextDiff,
    );
  }

  private async render(preview: PreviewPanel): Promise<void> {
    const generation = ++preview.generation;
    const snapshot = await this.model.getPreviewSnapshot(preview.document);
    if (generation !== preview.generation || !this.previews.has(preview)) {
      return;
    }

    const { entries, content } = snapshot;
    preview.hasCommentsPatch = content.hasCommentsPatch;
    if (!content.hasCommentsPatch) {
      preview.commentsVisible = false;
    }
    preview.canNavigatePreviousDiff = false;
    preview.canNavigateNextDiff = false;

    const sourceMarkdown = preview.document.getText();
    const lineComments = await this.getLineComments(preview);
    if (generation !== preview.generation || !this.previews.has(preview)) {
      return;
    }
    const lineMetadata = createPreviewLineMetadata(sourceMarkdown, content, entries, lineComments);
    let contentHtml = renderPreviewMarkdown(content.markdown, lineMetadata);
    let diffVisible = false;
    if (preview.diffBaseline) {
      try {
        const baseline = await this.resolveBaseline(preview);
        if (generation !== preview.generation || !this.previews.has(preview)) {
          return;
        }
        const diffLineMetadata = createDiffLineMetadata(entries, lineComments, sourceMarkdown);
        const renderedDiff = renderDiffPreview(baseline.markdown, sourceMarkdown, diffLineMetadata, baseline.label);
        contentHtml = renderedDiff.html;
        preview.canNavigateNextDiff = renderedDiff.hunkCount > 0;
        diffVisible = true;
      } catch (error) {
        preview.diffBaseline = undefined;
        void vscode.window.showErrorMessage(
          `Unable to show diff: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    preview.panel.webview.html = getPreviewHtml(
      preview.panel.webview,
      this.extensionUri,
      preview.document.uri,
      contentHtml,
      preview.hasCommentsPatch,
      preview.commentsVisible,
      diffVisible,
      preview.pullRequestContext !== undefined,
      preview.contributedStyles.stylesheets,
    );
    if (this.activePreview === preview) {
      this.updateContexts(preview);
    }
  }

  private async ensurePreview(uri: vscode.Uri): Promise<PreviewPanel | undefined> {
    let preview = this.findPreview(uri);
    if (preview) {
      return preview;
    }

    await vscode.commands.executeCommand('vscode.openWith', uri, reviewMarkdownPreviewViewType);
    preview = this.findPreview(uri);
    return preview;
  }

  private findPreview(uri: vscode.Uri): PreviewPanel | undefined {
    for (const preview of this.previews) {
      if (preview.document.uri.toString() === uri.toString()) {
        return preview;
      }
    }
    return undefined;
  }

  private async refreshDiffAvailability(
    preview: PreviewPanel,
    promptForGitHubAuth = false,
  ): Promise<DiffAvailability | undefined> {
    const generation = ++preview.diffRefreshGeneration;

    try {
      const availability = await this.diffService.getAvailability(preview.document, { promptForGitHubAuth });
      if (generation !== preview.diffRefreshGeneration || !this.previews.has(preview)) {
        return undefined;
      }

      preview.diffAvailability = availability;
      preview.diffAvailable = availability.candidates.length > 0 || availability.canPickFile;
      if (!preview.diffAvailable) {
        preview.diffBaseline = undefined;
      }
      if (this.activePreview === preview) {
        this.updateContexts(preview);
      }
      return availability;
    } catch (error) {
      preview.diffAvailability = undefined;
      preview.diffAvailable = false;
      preview.diffBaseline = undefined;
      if (this.activePreview === preview) {
        this.updateContexts(preview);
      }
      void vscode.window.showWarningMessage(
        `Unable to inspect diff history: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private async refreshPullRequestContext(
    preview: PreviewPanel,
    promptForGitHubAuth = false,
  ): Promise<PullRequestContext | undefined> {
    const generation = ++preview.pullRequestRefreshGeneration;

    try {
      const pullRequestContext = await this.diffService.getPullRequestContext(preview.document, { promptForGitHubAuth });
      if (generation !== preview.pullRequestRefreshGeneration || !this.previews.has(preview)) {
        return undefined;
      }

      const previousKey = getPullRequestContextKey(preview.pullRequestContext);
      const nextKey = getPullRequestContextKey(pullRequestContext);
      preview.pullRequestContext = pullRequestContext;
      if (this.activePreview === preview) {
        this.updateContexts(preview);
      }
      if (previousKey !== nextKey) {
        await this.render(preview);
      }
      return pullRequestContext;
    } catch (error) {
      preview.pullRequestContext = undefined;
      if (this.activePreview === preview) {
        this.updateContexts(preview);
      }
      void vscode.window.showWarningMessage(
        `Unable to inspect pull request context: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  private async navigateActiveDiffHunk(direction: 'previous' | 'next'): Promise<void> {
    const preview = this.activePreview;
    if (!preview?.diffBaseline) {
      return;
    }

    await this.postMessage(preview, { type: 'navigateDiffHunk', direction });
  }

  private async resolveBaseline(preview: PreviewPanel): Promise<ResolvedBaseline> {
    const baseline = preview.diffBaseline;
    if (!baseline) {
      throw new Error('No diff baseline is active.');
    }

    return this.diffService.resolveBaseline(preview.document, baseline);
  }

  private async postMessage(preview: PreviewPanel, message: PreviewHostMessage): Promise<void> {
    await preview.panel.webview.postMessage(message);
  }

  private async postPullRequestCommentState(preview: PreviewPanel): Promise<void> {
    const lineComments = await this.getLineComments(preview);
    if (!this.previews.has(preview)) {
      return;
    }

    await this.postMessage(preview, {
      type: 'pullRequestCommentState',
      hasPendingReview: preview.pullRequestContext !== undefined && this.pullRequestReview.hasPendingReview(
        preview.pullRequestContext.document,
        preview.pullRequestContext.pullRequest,
      ),
      comments: [...lineComments.entries()].map(([line, comments]) => ({
        line,
        comments: comments.map(comment => ({
          id: comment.id,
          localId: comment.localId,
          body: comment.body,
          renderedBody: renderCommentMarkdown(comment.body),
          kind: comment.kind,
          isDraft: comment.isDraft,
          author: comment.author,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          originalPostId: comment.originalPostId,
        })),
      })),
    });
  }

  private async promptPullRequestReview(event: 'APPROVE' | 'REQUEST_CHANGES'): Promise<void> {
    const preview = this.activePreview;
    if (!preview?.pullRequestContext) {
      return;
    }

    await this.postMessage(preview, {
      type: 'openPullRequestReviewDialog',
      event,
    });
  }

  private async submitPullRequestReview(event: 'APPROVE' | 'REQUEST_CHANGES', body?: string): Promise<void> {
    const preview = this.activePreview;
    const pullRequestContext = preview?.pullRequestContext;
    if (!preview || !pullRequestContext) {
      return;
    }

    const draftCount = await this.pullRequestReview.submitReview(
      pullRequestContext.document,
      pullRequestContext.pullRequest,
      event,
      body,
    );
    await this.refreshPullRequestContext(preview, true);
    await this.postPullRequestCommentState(preview);
    void vscode.window.showInformationMessage(
      event === 'APPROVE'
        ? `Approved pull request #${pullRequestContext.pullRequest.number}${draftCount > 0 ? ` with ${draftCount} comment${draftCount === 1 ? '' : 's'}` : ''}.`
        : `Requested changes on pull request #${pullRequestContext.pullRequest.number}${draftCount > 0 ? ` with ${draftCount} comment${draftCount === 1 ? '' : 's'}` : ''}.`,
    );
  }

  private async getLineComments(preview: PreviewPanel): Promise<ReadonlyMap<number, readonly PullRequestLineComment[]>> {
    const pullRequestContext = preview.pullRequestContext;
    if (!pullRequestContext) {
      return new Map();
    }

    return this.pullRequestReview.getLineComments(
      pullRequestContext.document,
      pullRequestContext.pullRequest,
    );
  }

  private async upsertPullRequestComment(
    preview: PreviewPanel,
    line: number,
    body: string,
    localId?: string,
  ): Promise<void> {
    const pullRequestContext = preview.pullRequestContext;
    if (!pullRequestContext) {
      return;
    }

    const existing = localId
      ? (await this.getLineComments(preview)).get(line)?.find(comment => comment.localId === localId)
      : undefined;
    await this.pullRequestReview.upsertComment(
      pullRequestContext.document,
      pullRequestContext.pullRequest,
      line,
      body,
      existing,
    );
    await this.render(preview);
  }

  private async createPullRequestCommentReply(
    preview: PreviewPanel,
    line: number,
    originalPostId: number,
    body: string,
  ): Promise<void> {
    const pullRequestContext = preview.pullRequestContext;
    if (!pullRequestContext) {
      return;
    }

    await this.pullRequestReview.replyToComment(
      pullRequestContext.document,
      pullRequestContext.pullRequest,
      line,
      originalPostId,
      body,
    );
    await this.render(preview);
  }

  private async deletePullRequestComment(preview: PreviewPanel, line: number, localId?: string): Promise<void> {
    const pullRequestContext = preview.pullRequestContext;
    if (!pullRequestContext) {
      return;
    }

    const existing = (await this.getLineComments(preview)).get(line)?.find(comment => comment.localId === localId);
    await this.pullRequestReview.deleteComment(
      pullRequestContext.document,
      pullRequestContext.pullRequest,
      line,
      existing,
    );
    await this.render(preview);
  }

  private async pickDiffFile(documentUri: vscode.Uri): Promise<vscode.Uri | undefined> {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: documentUri,
      filters: {
        Markdown: ['md'],
      },
      openLabel: 'Select baseline',
      title: 'Choose API baseline file',
    });
    return selection?.[0];
  }
}

export function renderMarkdown(markdown: string): string {
  return markdownRenderer.render(markdown);
}

export function renderCommentMarkdown(markdown: string): string {
  return commentMarkdownRenderer.render(markdown);
}

export function renderPreviewMarkdown(markdown: string, lineMetadata: readonly PreviewLineMetadata[]): string {
  return markdownRenderer.render(markdown, { lineMetadata: createPreviewLineRenderMetadata(lineMetadata) });
}

export function getContributedMarkdownPreviewStyles(
  extensions: readonly MarkdownPreviewStyleExtension[],
): MarkdownPreviewStyles {
  const stylesheets: vscode.Uri[] = [];
  const roots: vscode.Uri[] = [];
  const rootKeys = new Set<string>();

  for (const extension of extensions) {
    const paths = getMarkdownPreviewStylePaths(extension.packageJSON);
    for (const path of paths) {
      stylesheets.push(vscode.Uri.joinPath(extension.extensionUri, path));
      const rootKey = extension.extensionUri.toString();
      if (!rootKeys.has(rootKey)) {
        rootKeys.add(rootKey);
        roots.push(extension.extensionUri);
      }
    }
  }

  return { stylesheets, roots };
}

function getMarkdownPreviewStylePaths(packageJSON: unknown): readonly string[] {
  if (!isRecord(packageJSON) || !isRecord(packageJSON.contributes)) {
    return [];
  }

  const styles = packageJSON.contributes['markdown.previewStyles'];
  if (!Array.isArray(styles)) {
    return [];
  }

  return styles.filter((value): value is string => isSafeRelativeStylePath(value));
}

function isSafeRelativeStylePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('\\')) {
    return false;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    return false;
  }
  return !value.split('/').includes('..');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function highlightCode(
  code: string,
  language: string,
  startingLine?: number,
  lineMetadata?: ReadonlyMap<number, PreviewLineRenderMetadata>,
): string {
  const normalized = normalizeLanguage(language);
  if (normalized && hljs.getLanguage(normalized)) {
    const highlighted = hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value;
    return wrapHighlightedLines(highlighted, startingLine, lineMetadata);
  }
  return wrapHighlightedLines(escapeHtml(code), startingLine, lineMetadata);
}

function wrapHighlightedLines(
  highlighted: string,
  startingLine?: number,
  lineMetadata?: ReadonlyMap<number, PreviewLineRenderMetadata>,
): string {
  const parts = highlighted.split(/(<span\b[^>]*>|<\/span>)/);
  const openTags: { tag: string; comment: boolean }[] = [];
  const lines: string[] = [];
  let line = '';
  let hasContent = false;
  let hasNonCommentContent = false;
  let currentLine = startingLine;

  const finishLine = (): void => {
    const closingTags = openTags.map(() => '</span>').reverse().join('');
    const metadata = currentLine === undefined ? undefined : lineMetadata?.get(currentLine);
    const classes = ['code-line'];
    if (hasContent && !hasNonCommentContent) {
      classes.push('comment-line');
    }
    if (metadata?.documentationLine) {
      classes.push('preview-documentation-line');
    }
    if (metadata?.sourceLine !== undefined) {
      classes.push('preview-action-line');
    }
    if (metadata?.hasPullRequestComment) {
      classes.push('preview-has-pr-comment');
    }

    const attributes = currentLine === undefined ? [] : [`data-line="${currentLine}"`];
    if (metadata?.sourceLine !== undefined) {
      attributes.push(`data-source-line="${metadata.sourceLine}"`);
      attributes.push('tabindex="0"');
      attributes.push('aria-haspopup="true"');
      attributes.push('aria-controls="preview-hover-actions"');
      if (metadata.ariaLabel) {
        attributes.push(`aria-label="${escapeAttribute(metadata.ariaLabel)}"`);
      }
    }
    if (metadata?.hasDocumentation) {
      attributes.push('data-has-documentation');
    }
    if (metadata?.hasSource) {
      attributes.push('data-has-source');
    }
    if (metadata?.hasPullRequestComment) {
      attributes.push('data-has-pr-comment');
    }
    if (metadata?.hasPullRequestDiscussion) {
      attributes.push('data-has-pr-discussion');
    }
    if (metadata?.pullRequestCommentCount !== undefined) {
      attributes.push(`data-pr-comment-count="${metadata.pullRequestCommentCount}"`);
    }
    if (metadata?.documentationGroupId) {
      attributes.push(`data-documentation-group="${escapeAttribute(metadata.documentationGroupId)}"`);
    }

    const attributeText = attributes.length > 0 ? ` ${attributes.join(' ')}` : '';
    lines.push(`<span class="${classes.join(' ')}"${attributeText}>${line}${closingTags}</span>`);
    line = openTags.map(value => value.tag).join('');
    hasContent = false;
    hasNonCommentContent = false;
    if (currentLine !== undefined) {
      currentLine++;
    }
  };

  for (const part of parts) {
    if (part.startsWith('<span')) {
      openTags.push({ tag: part, comment: /\bhljs-comment\b/.test(part) });
      line += part;
      continue;
    }
    if (part === '</span>') {
      openTags.pop();
      line += part;
      continue;
    }

    const textLines = part.split('\n');
    for (let index = 0; index < textLines.length; index++) {
      const text = textLines[index];
      line += text;
      if (/\S/.test(text)) {
        hasContent = true;
        if (!openTags.some(value => value.comment)) {
          hasNonCommentContent = true;
        }
      }
      if (index < textLines.length - 1) {
        finishLine();
      }
    }
  }

  if (line.length > 0 || !highlighted.endsWith('\n')) {
    finishLine();
  }
  return lines.join('');
}

export function getPreviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  documentUri: vscode.Uri,
  contentHtml: string,
  hasCommentsPatch: boolean,
  commentsVisible: boolean,
  diffVisible: boolean,
  inPullRequest: boolean,
  contributedStylesheets: readonly vscode.Uri[],
): string {
  const stylesheet = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'markdownPreview.css'));
  const contributedStyles = contributedStylesheets
    .map(uri => `  <link rel="stylesheet" href="${escapeAttribute(webview.asWebviewUri(uri).toString())}">`)
    .join('\n');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'markdownPreview.js'));
  const icon = (name: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'codicons', `${name}.svg`)).toString();
  const documentDirectory = documentUri.with({ path: documentUri.path.slice(0, documentUri.path.lastIndexOf('/') + 1) });
  const base = webview.asWebviewUri(documentDirectory);
  const nonce = createNonce();
  const classes = [
    hasCommentsPatch ? 'has-comments-patch' : '',
    commentsVisible ? 'comments-visible' : '',
    diffVisible ? 'diff-visible' : '',
  ].filter(Boolean).join(' ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; media-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="${escapeAttribute(base.toString())}">
  <link rel="stylesheet" href="${escapeAttribute(stylesheet.toString())}">
${contributedStyles}
  <style nonce="${nonce}">
    :root {
      --preview-expand-docs-icon: url(${JSON.stringify(icon('expand-docs'))});
      --preview-collapse-docs-icon: url(${JSON.stringify(icon('collapse-docs'))});
      --preview-go-to-file-icon: url(${JSON.stringify(icon('go-to-file'))});
      --preview-comment-icon: url(${JSON.stringify(icon('comment'))});
      --preview-comment-discussion-icon: url(${JSON.stringify(icon('comment-discussion'))});
      --preview-edit-icon: url(${JSON.stringify(icon('edit'))});
    }
  </style>
  <title>Azure API Review</title>
</head>
<body class="${classes}">
  <main class="markdown-body" dir="auto">${contentHtml}</main>
  <div id="preview-hover-actions" hidden role="toolbar" aria-label="Review actions">
    ${inPullRequest ? `<button type="button" data-action="comment" data-icon="comment" title="Comment" aria-label="Comment"></button>` : ''}
    <button type="button" data-action="documentation" data-icon="expand-docs" data-show-tooltip="${escapeAttribute(showDocumentationTooltip)}" data-hide-tooltip="${escapeAttribute(hideDocumentationTooltip)}" title="${escapeAttribute(showDocumentationTooltip)}" aria-label="${escapeAttribute(showDocumentationTooltip)}"></button>
    <button type="button" data-action="source" data-icon="go-to-file" title="${escapeAttribute(goToSourceTooltip)}" aria-label="${escapeAttribute(goToSourceTooltip)}"></button>
  </div>
  <script nonce="${nonce}" src="${escapeAttribute(script.toString())}"></script>
</body>
</html>`;
}

function isPreviewWebviewMessage(message: unknown): message is PreviewWebviewMessage {
  if (!isRecord(message) || typeof message.type !== 'string') {
    return false;
  }

  switch (message.type) {
    case 'goToSource':
      return typeof message.line === 'number'
        && Number.isInteger(message.line)
        && message.line >= 0;

    case 'diffNavigationState':
      return typeof message.canNavigatePrevious === 'boolean'
        && typeof message.canNavigateNext === 'boolean';

    case 'upsertPullRequestComment':
      return typeof message.line === 'number'
        && Number.isInteger(message.line)
        && message.line >= 0
        && typeof message.body === 'string'
        && (message.localId === undefined || typeof message.localId === 'string');

    case 'deletePullRequestComment':
      return typeof message.line === 'number'
        && Number.isInteger(message.line)
        && message.line >= 0
        && (message.localId === undefined || typeof message.localId === 'string');

    case 'createPullRequestCommentReply':
      return typeof message.line === 'number'
        && Number.isInteger(message.line)
        && message.line >= 0
        && typeof message.originalPostId === 'number'
        && Number.isInteger(message.originalPostId)
        && message.originalPostId > 0
        && typeof message.body === 'string';

    case 'requestPullRequestCommentState':
      return true;

    case 'submitPullRequestReview':
      return (message.event === 'APPROVE' || message.event === 'REQUEST_CHANGES')
        && typeof message.body === 'string';

    default:
      return false;
  }
}

function createPreviewLineRenderMetadata(
  lineMetadata: readonly PreviewLineMetadata[],
): ReadonlyMap<number, PreviewLineRenderMetadata> {
  const lines = new Map<number, PreviewLineRenderMetadata>();
  for (const entry of lineMetadata) {
    lines.set(entry.previewLine, {
      sourceLine: entry.sourceLine,
      hasDocumentation: entry.hasDocumentation ? true : undefined,
      hasSource: entry.hasSource ? true : undefined,
      hasPullRequestComment: entry.pullRequestComments && entry.pullRequestComments.length > 0 ? true : undefined,
      hasPullRequestDiscussion: entry.hasPullRequestDiscussion ? true : undefined,
      pullRequestCommentCount: entry.pullRequestComments?.length,
      documentationGroupId: entry.documentationGroupId,
      ariaLabel: entry.ariaLabel,
    });

    for (const documentationPreviewLine of entry.documentationPreviewLines) {
      const current = lines.get(documentationPreviewLine) ?? {};
      lines.set(documentationPreviewLine, {
        ...current,
        documentationGroupId: entry.documentationGroupId,
        documentationLine: true,
      });
    }
  }

  return lines;
}

function normalizeLanguage(language: string): string {
  switch (language.toLowerCase()) {
    case 'c#':
    case 'csharp':
      return 'cs';
    case 'json5':
    case 'jsonc':
      return 'json';
    case 'py3':
      return 'python';
    case 'shell':
      return 'sh';
    case 'tsx':
    case 'typescriptreact':
      return 'jsx';
    default:
      return language;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

function createNonce(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => characters[Math.floor(Math.random() * characters.length)]).join('');
}

function getPullRequestContextKey(pullRequestContext: PullRequestContext | undefined): string | undefined {
  if (!pullRequestContext) {
    return undefined;
  }

  return `${pullRequestContext.pullRequest.number}:${pullRequestContext.pullRequest.headSha}`;
}

function isPreviewRenderEnv(value: unknown): value is PreviewRenderEnv {
  return isRecord(value);
}

async function showDiffQuickPick(
  preview: PreviewPanel,
  availability: DiffAvailability,
): Promise<DiffQuickPickItem | undefined> {
  const quickPick = vscode.window.createQuickPick<DiffQuickPickItem>();

  return new Promise(resolve => {
    const items = createDiffQuickPickItems(preview, availability);
    quickPick.title = 'Display diff';
    quickPick.placeholder = 'Select a baseline revision or choose a file';
    quickPick.items = items;
    quickPick.activeItems = getActiveQuickPickItems(items, preview, availability);
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    const disposables = [
      quickPick.onDidAccept(() => {
        const [item] = quickPick.selectedItems;
        resolve(item);
        dispose();
      }),
      quickPick.onDidHide(() => {
        resolve(undefined);
        dispose();
      }),
    ];

    const dispose = (): void => {
      while (disposables.length > 0) {
        disposables.pop()?.dispose();
      }
      quickPick.dispose();
    };

    quickPick.show();
  });
}

function createDiffQuickPickItems(
  preview: PreviewPanel,
  availability: DiffAvailability,
): readonly DiffQuickPickItem[] {
  const items: DiffQuickPickItem[] = [];
  const duplicateTagLabels = getDuplicateTagLabels(availability.candidates);

  if (preview.diffBaseline) {
    items.push({
      action: 'hide',
      label: '$(close) Close diff',
      description: 'Return to the normal preview',
    });
  }

  const currentFileBaseline = preview.diffBaseline?.kind === 'file'
    ? {
      action: 'baseline',
      baseline: preview.diffBaseline,
      label: `$(file) ${getPathLabel(preview.diffBaseline.uri)}`,
      description: 'Current file baseline',
      detail: preview.diffBaseline.uri,
    } satisfies DiffBaselineQuickPickItem
    : undefined;
  if (currentFileBaseline) {
    items.push(currentFileBaseline);
  }

  const currentRevisionBaseline = preview.diffBaseline && preview.diffBaseline.kind !== 'file'
    && !availability.candidates.some(candidate => isSameBaseline(candidate.baseline, preview.diffBaseline!))
    ? {
      action: 'baseline',
      baseline: preview.diffBaseline,
      ...createCurrentBaselineQuickPickCandidate(preview.diffBaseline, availability),
    } satisfies DiffBaselineQuickPickItem
    : undefined;
  if (currentRevisionBaseline) {
    items.push(currentRevisionBaseline);
  }

  items.push(...availability.candidates.map(candidate => ({
    action: 'baseline',
    baseline: candidate.baseline,
    ...createDiffQuickPickCandidate(candidate, duplicateTagLabels),
  } satisfies DiffBaselineQuickPickItem)));

  if (availability.canPickFile) {
    items.push({
      action: 'chooseFile',
      label: '$(folder-opened) Choose file...',
      description: 'Compare against another API.md file',
    });
  }

  return items;
}

export function createDiffQuickPickCandidate(
  candidate: DiffAvailability['candidates'][number],
  duplicateTagLabels: ReadonlySet<string> = new Set(),
): vscode.QuickPickItem {
  return {
    label: candidate.baseline.kind === 'tag'
      ? `$(tag) ${candidate.label}`
      : `$(git-commit) ${candidate.label}`,
    description: candidate.description,
    detail: candidate.baseline.kind === 'tag' && duplicateTagLabels.has(candidate.label)
      ? candidate.baseline.ref
      : candidate.detail,
  };
}

function createCurrentBaselineQuickPickCandidate(
  baseline: Exclude<DiffBaselineSelection, { kind: 'file' }>,
  availability: DiffAvailability,
): vscode.QuickPickItem {
  const isDefaultBaseline = availability.defaultBaseline !== undefined
    && isSameBaseline(availability.defaultBaseline, baseline);

  if (baseline.kind === 'tag') {
    return {
      label: `$(tag) ${getDisplayedTagBaselineLabel(baseline.ref)}`,
      description: isDefaultBaseline ? 'Pull request base' : 'Current baseline',
      detail: baseline.ref,
    };
  }

  return {
    label: `$(git-commit) ${baseline.ref.slice(0, 8)}`,
    description: isDefaultBaseline ? 'Pull request base' : 'Current baseline',
    detail: baseline.ref,
  };
}

function getDisplayedTagBaselineLabel(ref: string): string {
  const separator = ref.lastIndexOf('@');
  return separator >= 0 ? ref.slice(separator + 1) : ref;
}

function getDuplicateTagLabels(candidates: readonly DiffAvailability['candidates'][number][]): ReadonlySet<string> {
  const counts = new Map<string, number>();

  for (const candidate of candidates) {
    if (candidate.baseline.kind !== 'tag') {
      continue;
    }
    counts.set(candidate.label, (counts.get(candidate.label) ?? 0) + 1);
  }

  return new Set(
    Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([label]) => label),
  );
}

function getActiveQuickPickItems(
  items: readonly DiffQuickPickItem[],
  preview: PreviewPanel,
  availability: DiffAvailability,
): readonly DiffQuickPickItem[] {
  const currentBaseline = preview.diffBaseline;
  const current = currentBaseline
    ? items.find(item => item.action === 'baseline' && isSameBaseline(item.baseline, currentBaseline))
    : undefined;
  if (current) {
    return [current];
  }

  if (!availability.defaultBaseline) {
    return [];
  }

  const fallback = items.find(item =>
    item.action === 'baseline' && availability.defaultBaseline !== undefined
    && isSameBaseline(item.baseline, availability.defaultBaseline),
  );
  return fallback ? [fallback] : [];
}

function isSameBaseline(left: DiffBaselineSelection, right: DiffBaselineSelection): boolean {
  return left.kind === right.kind
    && ('uri' in left ? left.uri === ('uri' in right ? right.uri : undefined) : left.ref === ('ref' in right ? right.ref : undefined));
}

function getPathLabel(uri: string): string {
  const value = vscode.Uri.parse(uri);
  return value.path.slice(value.path.lastIndexOf('/') + 1) || value.toString();
}
