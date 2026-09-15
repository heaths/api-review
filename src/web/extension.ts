import * as vscode from 'vscode';
import {
  goToSource,
  goToSourceCommand,
  ReviewCodeLensProvider,
  showDocumentationCommand,
} from './codeLensProvider';
import { DocumentationProvider, documentationScheme } from './documentation';
import {
  approveViewPullRequestCommand,
  closeViewDiffCommand,
  hideViewCommentsCommand,
  nextViewDiffHunkCommand,
  previousViewDiffHunkCommand,
  rejectViewPullRequestCommand,
  reopenViewAsTextCommand,
  MarkdownViewProvider,
  markdownViewType,
  showViewDiffCommand,
  showViewCommentsCommand,
} from './markdownView';
import { PullRequestService } from './pullRequestService';
import { ReviewModel } from './reviewModel';
import { DiffBaselineSelection, DiffService } from './diffService';
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
  const pullRequestService = new PullRequestService(githubClient, gitClient);
  const diffService = new DiffService(logger, githubClient, gitClient, pullRequestService);
  const provider = new ReviewCodeLensProvider(model);
  const documentation = new DocumentationProvider(model, logger);
  const preview = new MarkdownViewProvider(
    model,
    context.extensionUri,
    diffService,
    pullRequestService,
    logger,
  );
  const gitStateWatcher = await gitClient.watchState(() => {
    diffService.invalidate();
    pullRequestService.invalidate();
    preview.refresh();
  });
  const selector: vscode.DocumentSelector = { language: 'markdown' };
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');

  const refreshDiscovery = async (): Promise<void> => {
    try {
      await model.refresh();
      diffService.invalidate();
      pullRequestService.invalidate();
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
    gitStateWatcher,
    watcher,
    vscode.window.registerCustomEditorProvider(
      markdownViewType,
      preview,
      { webviewOptions: { enableFindWidget: true } },
    ),
    vscode.languages.registerCodeLensProvider(selector, provider),
    vscode.workspace.registerTextDocumentContentProvider(documentationScheme, documentation),
    vscode.commands.registerCommand(showDocumentationCommand, argument => provider.showDocumentation(argument)),
    vscode.commands.registerCommand(goToSourceCommand, argument => goToSource(model, argument)),
    vscode.commands.registerCommand(showViewCommentsCommand, () => preview.showComments()),
    vscode.commands.registerCommand(hideViewCommentsCommand, () => preview.hideComments()),
    vscode.commands.registerCommand(showViewDiffCommand, () => preview.showDiffPicker()),
    vscode.commands.registerCommand(nextViewDiffHunkCommand, () => preview.showNextDiffHunk()),
    vscode.commands.registerCommand(previousViewDiffHunkCommand, () => preview.showPreviousDiffHunk()),
    vscode.commands.registerCommand(closeViewDiffCommand, () => preview.hideActiveDiff()),
    vscode.commands.registerCommand(approveViewPullRequestCommand, () => preview.approvePullRequest()),
    vscode.commands.registerCommand(rejectViewPullRequestCommand, () => preview.rejectPullRequest()),
    vscode.commands.registerCommand(reopenViewAsTextCommand, () =>
      vscode.commands.executeCommand('reopenActiveEditorWith', 'default')),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('heaths.azureApiReview.files')) {
        void refreshDiscovery();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshDiscovery()),
    vscode.authentication.onDidChangeSessions(event => {
      if (event.provider.id !== 'github') {
        return;
      }
      diffService.invalidate();
      pullRequestService.invalidate();
      preview.refresh();
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      model.invalidate(event.document.uri);
      diffService.invalidate(event.document.uri);
      pullRequestService.invalidate(event.document.uri);
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
