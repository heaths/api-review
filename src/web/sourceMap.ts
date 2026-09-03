import { RawSourceMap, SourceMapConsumer } from 'source-map-js';
import * as vscode from 'vscode';

export function resolveOriginalLocation(
  sourceMapText: string,
  sourceMapUri: vscode.Uri,
  generatedLine: number,
  generatedColumn: number,
): vscode.Location | undefined {
  const rawSourceMap = JSON.parse(sourceMapText) as RawSourceMap;
  const consumer = new SourceMapConsumer(rawSourceMap);
  let hasMappingOnLine = false;

  consumer.eachMapping(mapping => {
    if (mapping.generatedLine === generatedLine && mapping.generatedColumn <= generatedColumn) {
      hasMappingOnLine = true;
    }
  });

  if (!hasMappingOnLine) {
    return undefined;
  }

  const original = consumer.originalPositionFor({ line: generatedLine, column: generatedColumn });
  if (!original.source || original.line === null || original.column === null) {
    return undefined;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(original.source) || original.source.startsWith('/')) {
    return undefined;
  }

  const directory = sourceMapUri.with({ path: sourceMapUri.path.replace(/\/[^/]*$/, '/') });
  const sourceUri = vscode.Uri.joinPath(directory, ...original.source.split('/'));
  return new vscode.Location(sourceUri, new vscode.Position(original.line - 1, original.column));
}
