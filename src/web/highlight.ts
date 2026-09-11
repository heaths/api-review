import type { HLJSApi, LanguageFn } from 'highlight.js';
import hljsModule = require('highlight.js/lib/core');
import bash = require('highlight.js/lib/languages/bash');
import csharp = require('highlight.js/lib/languages/csharp');
import cpp = require('highlight.js/lib/languages/cpp');
import go = require('highlight.js/lib/languages/go');
import java = require('highlight.js/lib/languages/java');
import javascript = require('highlight.js/lib/languages/javascript');
import json = require('highlight.js/lib/languages/json');
import python = require('highlight.js/lib/languages/python');
import rust = require('highlight.js/lib/languages/rust');
import typescript = require('highlight.js/lib/languages/typescript');

const hljs = hljsModule as unknown as HLJSApi;

registerLanguage('bash', bash, ['shell', 'sh', 'zsh']);
registerLanguage('csharp', csharp, ['c#', 'cs']);
registerLanguage('cpp', cpp, ['c++', 'cc', 'cxx', 'hpp', 'h++', 'hh', 'hxx']);
registerLanguage('go', go, ['golang']);
registerLanguage('java', java);
registerLanguage('javascript', javascript, ['js', 'jsx']);
registerLanguage('json', json, ['json5', 'jsonc']);
registerLanguage('python', python, ['py', 'py3']);
registerLanguage('rust', rust, ['rs']);
registerLanguage('typescript', typescript, ['ts', 'tsx', 'typescriptreact']);

export default hljs;

export function normalizeHighlightLanguage(language: string): string {
  return language.toLowerCase();
}

function registerLanguage(name: string, languageModule: unknown, aliases: readonly string[] = []): void {
  const language = getLanguage(languageModule);
  hljs.registerLanguage(name, language);
  if (aliases.length > 0) {
    hljs.registerAliases([...aliases], { languageName: name });
  }
}

function getLanguage(languageModule: unknown): LanguageFn {
  if (typeof languageModule === 'function') {
    return languageModule as unknown as LanguageFn;
  }

  const module = languageModule as { default?: unknown };
  if (typeof module.default === 'function') {
    return module.default as LanguageFn;
  }

  throw new TypeError('Expected a highlight.js language module function');
}
