/* eslint-disable @typescript-eslint/no-require-imports -- Node tests intentionally use CommonJS. */
// Run transport/adapter regression tests using the existing TypeScript dependency.
// No additional test framework, server, or Agent runtime is required.
const fs = require("node:fs");
const ts = require("typescript");

function loadTypeScript(module, filename) {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(outputText, filename);
}
require.extensions[".ts"] = loadTypeScript;
require.extensions[".tsx"] = loadTypeScript;
