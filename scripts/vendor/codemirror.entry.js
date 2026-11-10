// Entry cho bundle CodeMirror 6 tự build (src/vendor/codemirror.bundle.js).
// App không có bundler lúc chạy nên CM6 phải nẵn sẵn trong src/vendor/ như các lib khác.
//
// Build:
//   npm i --no-save esbuild codemirror@6 @codemirror/lang-markdown@6 @codemirror/language@6 \
//     @codemirror/commands@6 @codemirror/state@6 @codemirror/view@6 \
//     @codemirror/autocomplete@6 @lezer/highlight@1 @lezer/markdown@1
//   npx esbuild scripts/vendor/codemirror.entry.js --bundle --minify --format=iife \
//     --global-name=CodeMirror --outfile=src/vendor/codemirror.bundle.js
//
// @codemirror/search không còn dùng: panel tìm kiếm do app tự dựng (src/js/editor/find.js).

export {
    EditorView,
    Decoration,
    keymap,
    drawSelection,
    highlightActiveLine,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
    highlightSpecialChars,
    placeholder
} from '@codemirror/view';
export { EditorState, EditorSelection, Compartment, Facet, Annotation, Prec, Text, Transaction, StateField, StateEffect } from '@codemirror/state';
export {
    history,
    historyKeymap,
    defaultKeymap,
    standardKeymap,
    undo,
    redo,
    undoDepth,
    redoDepth,
    indentWithTab,
    indentMore,
    indentLess,
    copyLineDown
} from '@codemirror/commands';
export { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
export { syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
export { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
export { tags } from '@lezer/highlight';
