/**
 * Live host contract probe: the host's own judgment becomes the source of truth.
 *
 * Every other test in this repository runs against tests/helpers/mock-host.mjs, so the
 * assertions can only verify shapes we imagined. This probe reads the shipped
 * dsh-client-ui-workspace client bundle, lifts the two sidebar judgments out of it and
 * hands them back as callable functions, which lets a test compare the plugin against
 * what the host actually does.
 *
 * The bundle is a window.__ModuleLoader__.load({ id, factory }) call whose factory
 * closes over sessionVisible and groupByWorkspace, so neither reaches exports. The probe
 * therefore extracts the function declarations verbatim out of the bundle text, together
 * with the private helpers they close over, and evaluates them in one fresh scope.
 * Nothing is rewritten on the way through: the extraction is anchored on the function
 * signature and its body is taken by brace matching, so re-formatting the bundle or
 * changing a judgment inside it changes the lifted source instead of silently passing.
 *
 * Host lookup never relies on a local absolute path: an explicit DSH_HOST_ROOT is
 * authoritative, otherwise require.resolve is tried, then the npm global root, then the
 * layout next to the running node binary, then whatever `npm root -g` prints.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const WORKSPACE_CLIENT_PACKAGE = '@deepseek-ai/dsh-client-ui-workspace';
const HOST_CLIENT_ENTRY = path.join('lib', 'client.js');
const PARENT_PACKAGE = '@deepseek-ai/dsh';

/**
 * The two host judgments this probe exposes. Each entry is the declaration name in the
 * bundle followed by the private helpers it closes over, in the order the scope has to
 * declare them.
 */
export const HOST_JUDGMENTS = Object.freeze({
  sessionVisible: Object.freeze(['sessionVisible', 'assertNever$1']),
  groupByWorkspace: Object.freeze([
    'groupByWorkspace',
    'mainSessionId',
    'buildGroup',
    'orderedUngrouped',
    'orderByRecency',
    'reconcileManualOrder',
    'sessionVisible',
    'assertNever$1'
  ])
});

/** Raised when no DSH host install can be found in this environment. */
export class HostUnavailableError extends Error {
  constructor(detail) {
    super(detail ? `DSH host package not found: ${detail}` : 'DSH host package not found');
    this.name = 'HostUnavailableError';
  }
}

/** Raised when the host install exists but a judgment can no longer be lifted out of it. */
export class HostContractDriftError extends Error {
  constructor(detail) {
    super(detail);
    this.name = 'HostContractDriftError';
  }
}

const requireFn = createRequire(import.meta.url);

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function npmGlobalRoots() {
  const roots = [
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules'),
    path.join(path.dirname(process.execPath), 'node_modules')
  ];
  try {
    const printed = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (printed !== '') roots.push(printed);
  } catch {
    // No npm on PATH: the layout next to node covers the common global installs.
  }
  return roots;
}

/** Locates the dsh-client-ui-workspace package directory, or null when the host is absent. */
export function resolveHostClientPackageDir({ env = process.env, npmRoots = npmGlobalRoots } = {}) {
  const candidates = [];
  const explicitRoot = env.DSH_HOST_ROOT;
  if (typeof explicitRoot === 'string' && explicitRoot !== '') {
    // An explicit root is authoritative: it names the install under test, so a machine
    // that also has a global DSH must not answer for a tree that lost its host.
    candidates.push(
      path.join(explicitRoot, 'node_modules', PARENT_PACKAGE, 'node_modules', WORKSPACE_CLIENT_PACKAGE),
      path.join(explicitRoot, 'node_modules', WORKSPACE_CLIENT_PACKAGE),
      path.join(explicitRoot, PARENT_PACKAGE, WORKSPACE_CLIENT_PACKAGE)
    );
  } else {
    try {
      candidates.push(path.dirname(requireFn.resolve(`${PARENT_PACKAGE}/node_modules/${WORKSPACE_CLIENT_PACKAGE}/package.json`)));
    } catch {
      // The host is not a dependency of this repository; the global layouts below cover it.
    }
    for (const globalRoot of npmRoots()) {
      candidates.push(
        path.join(globalRoot, PARENT_PACKAGE, 'node_modules', WORKSPACE_CLIENT_PACKAGE),
        path.join(globalRoot, WORKSPACE_CLIENT_PACKAGE)
      );
    }
  }
  for (const candidate of candidates) {
    if (isDirectory(candidate)) return candidate;
  }
  return null;
}

/** Resolves the workspace client bundle path, or null when the host is absent. */
export function resolveHostClientPath(options) {
  const dir = resolveHostClientPackageDir(options);
  if (dir === null) return null;
  const file = path.join(dir, HOST_CLIENT_ENTRY);
  return fs.existsSync(file) ? file : null;
}

/** Builds the error a caller raises when the host is missing; it carries a fixed name. */
export function hostUnavailableError() {
  return new HostUnavailableError(`no ${PARENT_PACKAGE} install exposes ${WORKSPACE_CLIENT_PACKAGE}`);
}

function indexOfMatchingBrace(source, openIndex, label) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new HostContractDriftError(`unbalanced braces while lifting ${label}`);
}

/**
 * Lifts one function declaration out of the bundle text. The body is taken by brace
 * matching so the returned text is exactly what the host ships, however it is formatted.
 */
export function extractHostFunction(source, name) {
  if (typeof source !== 'string' || source === '') {
    throw new HostContractDriftError('host client bundle is empty');
  }
  const declaration = `function ${name}(`;
  const start = source.indexOf(declaration);
  if (start === -1) throw new HostContractDriftError(`host bundle no longer declares ${name}`);
  if (source.indexOf(declaration, start + 1) !== -1) {
    throw new HostContractDriftError(`host bundle declares ${name} more than once; the extraction is ambiguous`);
  }
  const openIndex = source.indexOf('{', start + declaration.length);
  const closeIndex = indexOfMatchingBrace(source, openIndex, name);
  return source.slice(start, closeIndex + 1);
}

function evaluateScope(declarations, exports) {
  const body = [`return (function () {`, ...declarations, `return ${exports};`, '})();'].join('\n');
  // The lifted text runs in a function scope exactly as it runs inside the bundle factory.
  return new Function(body)();
}

/**
 * Reads the host bundle and returns the two judgments as callable functions.
 * Callers decide what a missing host means: skipping, or failing when the run pins it.
 */
export function loadHostJudgments({ clientPath } = {}) {
  // An explicitly absent bundle is a missing host, not a cue to look for another one.
  const file = clientPath === undefined ? resolveHostClientPath() : clientPath;
  if (file === null || file === undefined) throw hostUnavailableError();
  const source = fs.readFileSync(file, 'utf8');

  const extraction = new Map();
  for (const names of Object.values(HOST_JUDGMENTS)) {
    for (const name of names) {
      if (!extraction.has(name)) extraction.set(name, extractHostFunction(source, name));
    }
  }
  const lifted = evaluateScope([...extraction.values()], `{ ${Object.keys(HOST_JUDGMENTS).join(', ')} }`);

  return {
    clientPath: file,
    source,
    /** Exact source text lifted for one declaration, safe to compare against the host again. */
    sourceOf: (name) => {
      if (!extraction.has(name)) throw new HostContractDriftError(`${name} was not lifted from the host bundle`);
      return extraction.get(name);
    },
    sessionVisible: lifted.sessionVisible,
    groupByWorkspace: lifted.groupByWorkspace,
    /** Evaluates one exported judgment from arbitrary lifted text, used to prove drift is caught. */
    compileJudgment: (judgment, declarations) => evaluateScope(declarations, `{ ${judgment} }`)[judgment]
  };
}

/**
 * Whitespace outside string literals is not contract: the host may be re-built with
 * different indentation or line wrapping while every judgment stays identical.
 */
export function canonicalSource(text) {
  const withoutLayout = [];
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== null) {
      withoutLayout.push(char);
      if (char === '\\') {
        withoutLayout.push(text[index + 1]);
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
      withoutLayout.push(char);
    } else if (!/\s/u.test(char)) {
      withoutLayout.push(char);
    }
  }
  return withoutLayout.join('');
}

/**
 * Compares every lifted declaration against a fresh read of the same host source.
 * Returns the first mismatch, or null when the lifted text and the host agree.
 */
export function assertionSourceMatchesHost(judgments) {
  const reread = fs.readFileSync(judgments.clientPath, 'utf8');
  for (const names of Object.values(HOST_JUDGMENTS)) {
    for (const name of names) {
      const lifted = extractHostFunction(judgments.source, name);
      const fresh = extractHostFunction(reread, name);
      if (canonicalSource(lifted) !== canonicalSource(fresh)) return { name, lifted, fresh };
    }
  }
  return null;
}
