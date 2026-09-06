import hljs from 'highlight.js';
import MarkdownIt = require('markdown-it');
import * as vscode from 'vscode';
import { ReviewModel } from './reviewModel';

export const reviewMarkdownPreviewViewType = 'heaths.azureApiReview.preview';
export const showPreviewCommentsCommand = 'heaths.azureApiReview.preview.showComments';
export const hidePreviewCommentsCommand = 'heaths.azureApiReview.preview.hideComments';
export const reopenPreviewAsTextCommand = 'heaths.azureApiReview.preview.reopenAsText';

const hasPreviewCommentsContext = 'heaths.azureApiReview.preview.hasComments';
const previewCommentsVisibleContext = 'heaths.azureApiReview.preview.commentsVisible';

interface PreviewPanel {
  readonly document: vscode.TextDocument;
  readonly panel: vscode.WebviewPanel;
  readonly contributedStyles: MarkdownPreviewStyles;
  commentsVisible: boolean;
  hasCommentsPatch: boolean;
  generation: number;
}

interface MarkdownPreviewStyleExtension {
  readonly extensionUri: vscode.Uri;
  readonly packageJSON: unknown;
}

export interface MarkdownPreviewStyles {
  readonly stylesheets: readonly vscode.Uri[];
  readonly roots: readonly vscode.Uri[];
}

const markdownRenderer = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code, language) {
    const normalized = normalizeLanguage(language);
    if (normalized && hljs.getLanguage(normalized)) {
      const highlighted = hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value;
      return wrapHighlightedLines(highlighted);
    }
    return wrapHighlightedLines(escapeHtml(code));
  },
});

export class ReviewMarkdownPreview implements vscode.CustomTextEditorProvider {
  private readonly previews = new Set<PreviewPanel>();
  private activePreview: PreviewPanel | undefined;

  public constructor(
    private readonly model: ReviewModel,
    private readonly extensionUri: vscode.Uri,
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
  }

  public refresh(uri?: vscode.Uri): void {
    for (const preview of this.previews) {
      if (!uri || preview.document.uri.toString() === uri.toString()) {
        void this.render(preview);
      }
    }
  }

  public showComments(): void {
    this.setCommentsVisible(true);
  }

  public hideComments(): void {
    this.setCommentsVisible(false);
  }

  private setCommentsVisible(visible: boolean): void {
    const preview = this.activePreview;
    if (!preview?.hasCommentsPatch) {
      return;
    }
    preview.commentsVisible = visible;
    void preview.panel.webview.postMessage({ type: 'setCommentsVisible', visible });
    this.updateContexts(preview);
  }

  private setActivePreview(preview: PreviewPanel | undefined): void {
    this.activePreview = preview;
    this.updateContexts(preview);
  }

  private updateContexts(preview: PreviewPanel | undefined): void {
    void vscode.commands.executeCommand('setContext', hasPreviewCommentsContext, preview?.hasCommentsPatch === true);
    void vscode.commands.executeCommand('setContext', previewCommentsVisibleContext, preview?.commentsVisible === true);
  }

  private async render(preview: PreviewPanel): Promise<void> {
    const generation = ++preview.generation;
    const content = await this.model.getPreviewContent(preview.document);
    if (generation !== preview.generation || !this.previews.has(preview)) {
      return;
    }

    preview.hasCommentsPatch = content.hasCommentsPatch;
    if (!content.hasCommentsPatch) {
      preview.commentsVisible = false;
    }
    preview.panel.webview.html = getPreviewHtml(
      preview.panel.webview,
      this.extensionUri,
      preview.document.uri,
      content.markdown,
      preview.hasCommentsPatch,
      preview.commentsVisible,
      preview.contributedStyles.stylesheets,
    );
    if (this.activePreview === preview) {
      this.updateContexts(preview);
    }
  }
}

export function renderMarkdown(markdown: string): string {
  return markdownRenderer.render(markdown);
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

function wrapHighlightedLines(highlighted: string): string {
  const parts = highlighted.split(/(<span\b[^>]*>|<\/span>)/);
  const openTags: { tag: string; comment: boolean }[] = [];
  const lines: string[] = [];
  let line = '';
  let hasContent = false;
  let hasNonCommentContent = false;

  const finishLine = (): void => {
    const closingTags = openTags.map(() => '</span>').reverse().join('');
    const classes = hasContent && !hasNonCommentContent ? 'code-line comment-line' : 'code-line';
    lines.push(`<span class="${classes}">${line}${closingTags}</span>`);
    line = openTags.map(value => value.tag).join('');
    hasContent = false;
    hasNonCommentContent = false;
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

function getPreviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  documentUri: vscode.Uri,
  markdown: string,
  hasCommentsPatch: boolean,
  commentsVisible: boolean,
  contributedStylesheets: readonly vscode.Uri[],
): string {
  const stylesheet = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'markdownPreview.css'));
  const contributedStyles = contributedStylesheets
    .map(uri => `  <link rel="stylesheet" href="${escapeAttribute(webview.asWebviewUri(uri).toString())}">`)
    .join('\n');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'assets', 'markdownPreview.js'));
  const documentDirectory = documentUri.with({ path: documentUri.path.slice(0, documentUri.path.lastIndexOf('/') + 1) });
  const base = webview.asWebviewUri(documentDirectory);
  const nonce = createNonce();
  const classes = [
    hasCommentsPatch ? 'has-comments-patch' : '',
    commentsVisible ? 'comments-visible' : '',
  ].filter(Boolean).join(' ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; media-src ${webview.cspSource} https: data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <base href="${escapeAttribute(base.toString())}">
  <link rel="stylesheet" href="${escapeAttribute(stylesheet.toString())}">
${contributedStyles}
  <title>Azure API Review</title>
</head>
<body class="${classes}">
  <main class="markdown-body" dir="auto">${renderMarkdown(markdown)}</main>
  <script nonce="${nonce}" src="${escapeAttribute(script.toString())}"></script>
</body>
</html>`;
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
