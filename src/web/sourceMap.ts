import { RawSourceMap, SourceMapConsumer } from 'source-map-js';
import * as vscode from 'vscode';

export function resolveOriginalLocation(
  sourceMapText: string,
  repositoryRootUri: vscode.Uri,
  generatedLine: number,
  generatedColumn: number,
): vscode.Location | undefined {
  const rawSourceMap = JSON.parse(sourceMapText) as RawSourceMap;
  rawSourceMap.sourceRoot = repositoryRootUri.toString();
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

  const sourceUri = vscode.Uri.parse(original.source);
  if (sourceUri.scheme !== repositoryRootUri.scheme) {
    return undefined;
  }

  return new vscode.Location(sourceUri, new vscode.Position(original.line - 1, original.column));
}
