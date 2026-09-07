import hljs from 'highlight.js';
import MarkdownIt = require('markdown-it');
import * as vscode from 'vscode';
import {
  goToSourceCommand,
  goToSourceTooltip,
  showDocumentationTooltip,
} from './codeLensProvider';
import { createPreviewLineMetadata, PreviewLineMetadata } from './lineMetadata';
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

interface PreviewWebviewMessage {
  readonly type: 'goToSource';
  readonly line: number;
}

export interface MarkdownPreviewStyles {
  readonly stylesheets: readonly vscode.Uri[];
  readonly roots: readonly vscode.Uri[];
}

interface PreviewLineRenderMetadata {
  readonly sourceLine?: number;
  readonly hasDocumentation?: true;
  readonly hasSource?: true;
  readonly documentationGroupId?: string;
  readonly documentationLine?: true;
  readonly ariaLabel?: string;
}

interface PreviewRenderEnv {
  readonly lineMetadata?: ReadonlyMap<number, PreviewLineRenderMetadata>;
}

const markdownRenderer = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code, language) {
    return highlightCode(code, language);
  },
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
      }
    } catch (error) {
      void vscode.window.showErrorMessage(
        `Unable to navigate to source: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
    const snapshot = await this.model.getPreviewSnapshot(preview.document);
    if (generation !== preview.generation || !this.previews.has(preview)) {
      return;
    }

    const { entries, content } = snapshot;
    preview.hasCommentsPatch = content.hasCommentsPatch;
    if (!content.hasCommentsPatch) {
      preview.commentsVisible = false;
    }

    const lineMetadata = createPreviewLineMetadata(preview.document.getText(), content, entries);
    preview.panel.webview.html = getPreviewHtml(
      preview.panel.webview,
      this.extensionUri,
      preview.document.uri,
      content.markdown,
      preview.hasCommentsPatch,
      preview.commentsVisible,
      preview.contributedStyles.stylesheets,
      lineMetadata,
    );
    if (this.activePreview === preview) {
      this.updateContexts(preview);
    }
  }
}

export function renderMarkdown(markdown: string): string {
  return markdownRenderer.render(markdown);
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

function getPreviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  documentUri: vscode.Uri,
  markdown: string,
  hasCommentsPatch: boolean,
  commentsVisible: boolean,
  contributedStylesheets: readonly vscode.Uri[],
  lineMetadata: readonly PreviewLineMetadata[],
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
  <main class="markdown-body" dir="auto">${renderPreviewMarkdown(markdown, lineMetadata)}</main>
  <div id="preview-hover-actions" hidden role="toolbar" aria-label="Review actions">
    <button type="button" data-action="documentation" title="${escapeAttribute(showDocumentationTooltip)}" aria-label="${escapeAttribute(showDocumentationTooltip)}"></button>
    <button type="button" data-action="source" title="${escapeAttribute(goToSourceTooltip)}" aria-label="${escapeAttribute(goToSourceTooltip)}"></button>
  </div>
  <script nonce="${nonce}" src="${escapeAttribute(script.toString())}"></script>
</body>
</html>`;
}

function isPreviewWebviewMessage(message: unknown): message is PreviewWebviewMessage {
  return isRecord(message)
    && message.type === 'goToSource'
    && typeof message.line === 'number'
    && Number.isInteger(message.line)
    && message.line >= 0;
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

function createPreviewLineRenderMetadata(
  lineMetadata: readonly PreviewLineMetadata[],
): ReadonlyMap<number, PreviewLineRenderMetadata> {
  const renderedLineMetadata = new Map<number, PreviewLineRenderMetadata>();

  for (const line of lineMetadata) {
    renderedLineMetadata.set(line.previewLine, {
      sourceLine: line.sourceLine,
      hasDocumentation: line.hasDocumentation ? true : undefined,
      hasSource: line.hasSource ? true : undefined,
      documentationGroupId: line.documentationGroupId,
      ariaLabel: line.ariaLabel,
    });

    if (!line.documentationGroupId) {
      continue;
    }

    for (const documentationPreviewLine of line.documentationPreviewLines) {
      renderedLineMetadata.set(documentationPreviewLine, {
        ...renderedLineMetadata.get(documentationPreviewLine),
        documentationGroupId: line.documentationGroupId,
        documentationLine: true,
      });
    }
  }

  return renderedLineMetadata;
}

function isPreviewRenderEnv(value: unknown): value is PreviewRenderEnv {
  return isRecord(value);
}
