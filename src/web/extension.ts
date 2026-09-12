import * as vscode from 'vscode';
import {
  goToSource,
  goToSourceCommand,
  ReviewCodeLensProvider,
  showDocumentationCommand,
} from './codeLensProvider';
import { DocumentationProvider, documentationScheme } from './documentation';
import {
  approvePreviewPullRequestCommand,
  closePreviewDiffCommand,
  hidePreviewCommentsCommand,
  nextPreviewDiffHunkCommand,
  previousPreviewDiffHunkCommand,
  rejectPreviewPullRequestCommand,
  reopenPreviewAsTextCommand,
  ReviewMarkdownPreview,
  reviewMarkdownPreviewViewType,
  showPreviewDiffCommand,
  showPreviewCommentsCommand,
} from './markdownPreview';
import { PullRequestReviewController } from './pullRequestReview';
import { ReviewModel } from './reviewModel';
import { DiffBaselineSelection, DisplayDiffService } from './displayDiff';
import { MemoryCache } from './cache';
import { createGitHubClient } from './githubClientFactory';
import { createGitClient } from './gitClientFactory';

const defaultChannelName = 'Azure API Review';

export interface AzureApiReviewExtensionApi {
  readonly version: 1;
  showDiff(documentUri: string, baseline: DiffBaselineSelection): Promise<void>;
  hideDiff(documentUri: string): Promise<void>;
}

export async function activate(context: vscode.ExtensionContext): Promise<AzureApiReviewExtensionApi> {
  const displayName = context.extension.packageJSON?.displayName;
  const logger = vscode.window.createOutputChannel(
    typeof displayName === 'string' && displayName.trim().length > 0 ? displayName : defaultChannelName,
    { log: true },
  );
  const model = new ReviewModel(logger);
  const githubCache = new MemoryCache();
  const githubClient = createGitHubClient({ cache: githubCache, logger });
  const gitClient = createGitClient();
  const diffService = new DisplayDiffService(logger, githubClient, gitClient);
  const pullRequestReview = new PullRequestReviewController(githubClient);
  const provider = new ReviewCodeLensProvider(model);
  const documentation = new DocumentationProvider(model, logger);
  const preview = new ReviewMarkdownPreview(model, context.extensionUri, diffService, pullRequestReview, logger);
  const selector: vscode.DocumentSelector = { language: 'markdown' };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');

  const refreshDiscovery = async (): Promise<void> => {
    try {
      await model.refresh();
      diffService.invalidate();
      provider.refresh();
      documentation.refresh();
      preview.refresh();
    } catch (error) {
      logger.error(`Unable to discover API review files: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  logger.debug('Activated extension', { logLevel: logger.logLevel, channel: displayName });

  context.subscriptions.push(
    logger,
    watcher,
    vscode.window.registerCustomEditorProvider(
      reviewMarkdownPreviewViewType,
      preview,
      { webviewOptions: { enableFindWidget: true } },
    ),
    vscode.languages.registerCodeLensProvider(selector, provider),
    vscode.workspace.registerTextDocumentContentProvider(documentationScheme, documentation),
    vscode.commands.registerCommand(showDocumentationCommand, argument => provider.showDocumentation(argument)),
    vscode.commands.registerCommand(goToSourceCommand, argument => goToSource(model, argument)),
    vscode.commands.registerCommand(showPreviewCommentsCommand, () => preview.showComments()),
    vscode.commands.registerCommand(hidePreviewCommentsCommand, () => preview.hideComments()),
    vscode.commands.registerCommand(showPreviewDiffCommand, () => preview.showDiffPicker()),
    vscode.commands.registerCommand(nextPreviewDiffHunkCommand, () => preview.showNextDiffHunk()),
    vscode.commands.registerCommand(previousPreviewDiffHunkCommand, () => preview.showPreviousDiffHunk()),
    vscode.commands.registerCommand(closePreviewDiffCommand, () => preview.hideActiveDiff()),
    vscode.commands.registerCommand(approvePreviewPullRequestCommand, () => preview.approvePullRequest()),
    vscode.commands.registerCommand(rejectPreviewPullRequestCommand, () => preview.rejectPullRequest()),
    vscode.commands.registerCommand(reopenPreviewAsTextCommand, () =>
      vscode.commands.executeCommand('reopenActiveEditorWith', 'default')),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('heaths.azureApiReview.files')) {
        void refreshDiscovery();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshDiscovery()),
    vscode.workspace.onDidChangeTextDocument(event => {
      model.invalidate(event.document.uri);
      diffService.invalidate(event.document.uri);
      provider.refresh();
      documentation.refresh(event.document.uri);
      preview.refresh(event.document.uri);
    }),
    watcher.onDidCreate(() => void refreshDiscovery()),
    watcher.onDidChange(() => void refreshDiscovery()),
    watcher.onDidDelete(() => void refreshDiscovery()),
  );

  await refreshDiscovery();

  return {
    version: 1,
    showDiff(documentUri: string, baseline: DiffBaselineSelection) {
      return preview.showDiff(documentUri, baseline);
    },
    hideDiff(documentUri: string) {
      return preview.hideDiff(documentUri);
    },
  };
}

export function deactivate() { }
