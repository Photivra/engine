// SPDX-License-Identifier: Apache-2.0

/**
 * Strips comments and indentation from the engine's WGSL shader text (#536), safely by construction.
 *
 * It rewrites only the static text of template literals tagged with a leading `/* wgsl *\/` comment, in TypeScript
 * or JavaScript source, and only in ways that cannot change the WGSL token stream:
 * - a line comment (`//` to the end of the line) is removed;
 * - a block comment (WGSL block comments nest) is replaced by one space;
 * - spaces and tabs at the start and end of each line are removed;
 * - (2.29.0, #658) inside a line, a run of spaces and tabs becomes one space, and that space is removed where it touches an
 *   identifier or number character on one side and a punctuation character on the other, or a bracket, comma or semicolon
 *   (`( ) [ ] { } , ;`) on either side. Neither can join two tokens into one: an identifier or literal cannot continue into
 *   punctuation, no multi-character token begins or ends with a bracket, comma or semicolon, and a space between two other
 *   punctuation characters (as in `a - -b`, `a / *p` or `> =`) always stays, so no operator or comment opener can form.
 *
 * Every newline is kept, so line numbers (and so source maps) of everything after a shader stay exact. (2.29.0, #658) Inside a
 * literal, a newline next to a bracket, comma or semicolon (or an empty line) is moved: the lines are joined and the newlines put
 * back as empty lines just before the next line with an interpolation and before the literal's last line (see joinLines), so the
 * literal keeps its line count and every interpolation stays on its own line. A line that contains a `${…}` interpolation and a comment
 * opener or a backslash is left untouched, so an interpolation can never end up inside or outside a comment differently
 * than written. (2.29.0, #658) Any other interpolation line is tightened by the same rules, piece by piece between its
 * interpolations, and blankspace that touches an interpolation stays as one space, since its text is not known here;
 * columns on such a line move left, so a source map points a few columns early inside its interpolations, never at
 * another line. The first line (after the opening backtick) and the last line (before the closing one) are left
 * untouched too. A backslash (a template escape) may only be removed inside a comment, where its
 * whole escape sequence goes with it; a literal with a backslash in shader code or ending a line is left whole. Expressions inside `${…}` are copied unchanged. WGSL has no string literals, so `//` and `/*`
 * always start comments in shader text.
 *
 * WGSL treats comments and whitespace only as token separators (WGSL §3 "Textual structure": "comments …
 * behave as blankspace"), and every removed run either touches a newline that stays or is replaced by a space, and
 * a newline is moved only from between a bracket, comma or semicolon (or nothing) and its neighbour, so the tokens and their
 * order are unchanged. `wgslTokens()` gives that token stream for tests.
 */

const TAG = /\/\*\s*wgsl\s*\*\/\s*`/gu;

/**
 * Finds the end of the template literal whose opening backtick is at `open`. Returns the parts: static text chunks
 * (raw source text) and expression source text between them, and the index just past the closing backtick.
 */
function readTemplate(source, open) {
  const chunks = [], expressions = [];
  let i = open + 1, chunkStart = i;
  for (;;) {
    if (i >= source.length) throw new Error("Unterminated template literal at offset " + open + ".");
    const c = source[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "`") { chunks.push(source.slice(chunkStart, i)); return { chunks, expressions, end: i + 1 }; }
    if (c === "$" && source[i + 1] === "{") {
      chunks.push(source.slice(chunkStart, i));
      const exprStart = i + 2, exprEnd = skipExpression(source, exprStart);
      expressions.push(source.slice(exprStart, exprEnd));
      i = exprEnd + 1;
      chunkStart = i;
      continue;
    }
    i++;
  }
}
/** Index of the `}` closing an interpolation that starts at `start`, skipping strings, nested templates and comments. */
function skipExpression(source, start) {
  let depth = 0, i = start;
  while (i < source.length) {
    const c = source[i];
    if (c === "'" || c === "\"") {
      i++;
      while (i < source.length && source[i] !== c) i += source[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (c === "`") { i = readTemplate(source, i).end; continue; }
    if (c === "/" && source[i + 1] === "/") { while (i < source.length && source[i] !== "\n") i++; continue; }
    if (c === "/" && source[i + 1] === "*") { i = source.indexOf("*/", i + 2) + 2; continue; }
    if (c === "{") depth++;
    else if (c === "}") { if (depth === 0) return i; depth--; }
    i++;
  }
  throw new Error("Unterminated interpolation at offset " + start + ".");
}

/** Removes comments from one line of shader text; `state.blockDepth` carries an open block comment across lines. */
function stripCommentsFromLine(line, state) {
  let out = "", i = 0;
  while (i < line.length) {
    if (state.blockDepth > 0) {
      if (line.startsWith("/*", i)) { state.blockDepth++; i += 2; continue; }
      if (line.startsWith("*/", i)) { state.blockDepth--; i += 2; if (state.blockDepth === 0) out += " "; continue; }
      i++;
      continue;
    }
    if (line.startsWith("//", i)) break;
    if (line.startsWith("/*", i)) { state.blockDepth = 1; i += 2; continue; }
    out += line[i];
    i++;
  }
  return out;
}

/**
 * Removes blankspace inside one line where it cannot separate two tokens (see the module comment): next to an identifier or number
 * character on one side and punctuation on the other, or next to a bracket, comma or semicolon.
 */
function tighten(line) {
  return line.replace(/[ \t]+/gu, " ")
    .replace(/([A-Za-z0-9_]) (?=[^A-Za-z0-9_ ])/gu, "$1").replace(/([^A-Za-z0-9_ ]) (?=[A-Za-z0-9_])/gu, "$1")
    .replace(/([()[\]{},;]) /gu, "$1").replace(/ (?=[()[\]{},;])/gu, "");
}

/**
 * A line with interpolations (sentinels) and no comment opener or backslash: each static piece tightened, the blankspace next to an
 * interpolation kept as one space.
 */
function tightenInterpolated(line) {
  return line.replace(/^[ \t]+|[ \t]+$/gu, "").split(/(\uE000\d+\uE000)/u).map((piece, k, pieces) => {
    if (k % 2 === 1) return piece;
    const lead = k > 0 && /^[ \t]/u.test(piece) ? " " : "", tail = k < pieces.length - 1 && /[ \t]$/u.test(piece) ? " " : "";
    const inner = tighten(piece.replace(/^[ \t]+|[ \t]+$/gu, ""));
    return inner === "" ? lead || tail : lead + inner + tail;
  }).join("");
}

const SENTINEL = (k) => "\uE000" + k + "\uE000";
const HAS_SENTINEL = /\uE000\d+\uE000/u;

/**
 * Minifies the static text of one template literal. `chunks` are raw static texts, `expressions` the interpolation
 * sources. Returns the new literal body (between the backticks), or null to keep it unchanged.
 */
function minifyTemplateBody(chunks, expressions) {
  if (chunks.some((chunk) => chunk.includes("\uE000"))) return null;
  let text = chunks[0];
  for (let k = 0; k < expressions.length; k++) text += SENTINEL(k) + chunks[k + 1];
  const lines = text.split("\n");
  if (lines.length < 3) return null;
  const state = { blockDepth: 0 };
  const out = lines.map((line, index) => {
    const inner = index > 0 && index < lines.length - 1;
    if (inner && state.blockDepth === 0 && HAS_SENTINEL.test(line) && !/\/\/|\/\*|\\/u.test(line)) return tightenInterpolated(line);
    if (!inner || HAS_SENTINEL.test(line)) {
      // Kept as written. A line comment on it ends at its own newline; a block comment on it, or one still open when it
      // starts, could span lines differently from the minified neighbours, so the whole literal is then left unchanged.
      if (state.blockDepth > 0 || line.includes("/*")) state.unsafe = true;
      return line;
    }
    // A backslash may only disappear inside a removed comment, and never as a line continuation (a raw "\\" before
    // the newline): then every escape sequence is either removed whole or kept whole.
    if (/\\[ \t]*$/u.test(line)) state.unsafe = true;
    const kept = tighten(stripCommentsFromLine(line, state).replace(/^[ \t]+|[ \t]+$/gu, ""));
    if (kept.includes("\\")) state.unsafe = true;
    return kept;
  });
  if (state.unsafe || state.blockDepth !== 0) return null;
  return joinLines(out).replace(/\uE000(\d+)\uE000/gu, (_, k) => "${" + expressions[Number(k)] + "}");
}

/** A bracket, comma or semicolon: no WGSL token begins or ends with one, so nothing is needed between it and its neighbour. */
const SEPARATOR = /[()[\]{},;]/u;

/**
 * (2.29.0, #658) Joins the minified lines of one literal where the newline cannot separate two tokens: a line onto the one before it
 * when that ends with a bracket, comma or semicolon, the line starts with one, or either is empty. The first line, the last line,
 * a line with an interpolation and the line after it are never joined, so text kept as written (which may end in a line comment)
 * never runs on. The newlines a run of joined lines removes are put back, as empty lines, just before the next line with an
 * interpolation and before the last line: the literal keeps its line count, and every interpolation its line.
 */
function joinLines(lines) {
  let text = lines[0], line = "", removed = 0;
  for (let i = 1; i < lines.length; i++) {
    const next = lines[i], interpolated = HAS_SENTINEL.test(next), last = i === lines.length - 1;
    const free = i > 1 && !last && !interpolated && !HAS_SENTINEL.test(lines[i - 1]) &&
      (line === "" || next === "" || SEPARATOR.test(line[line.length - 1]) || SEPARATOR.test(next[0]));
    if (free) { text += next; line += next; removed++; continue; }
    if (interpolated || last) { text += "\n".repeat(removed); removed = 0; }
    text += "\n" + next;
    line = next;
  }
  return text;
}

/**
 * Minifies every `/* wgsl *\/`-tagged template literal in `source`. Returns the new source and a report of the
 * literals found, minified and kept (with the static texts before and after, for tests).
 */
export function minifyWgslTemplates(source) {
  const literals = [];
  let out = "", last = 0;
  TAG.lastIndex = 0;
  for (let match; (match = TAG.exec(source));) {
    const open = match.index + match[0].length - 1;
    const { chunks, expressions, end } = readTemplate(source, open);
    const body = minifyTemplateBody(chunks, expressions);
    const original = source.slice(open + 1, end - 1);
    literals.push({ offset: open, original, minified: body ?? original, kept: body === null, expressions });
    out += source.slice(last, open + 1) + (body ?? original);
    last = end - 1;
    TAG.lastIndex = end;
  }
  out += source.slice(last);
  return { code: out, literals };
}

/**
 * WGSL's syntactic tokens of more than one character (WGSL §3.5 "Syntactic Tokens"), longest first: the lexer takes the longest
 * match. `>>`, `>=` and `>>=` are listed although template-list discovery (WGSL §3.9) may split them in the parser: the minifier
 * never joins or splits two punctuation characters, so a lexical stream that takes them whole compares the same either way.
 */
const MULTI_CHARACTER_TOKENS = ["<<=", ">>=", "&&", "||", "->", "<=", ">=", "==", "!=", "<<", ">>", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="];
/** Identifiers (ASCII; the engine's shaders use no other), and decimal and hexadecimal int and float literals with their suffixes (WGSL §3.6, §5.2). */
const WORD = /[A-Za-z_][A-Za-z0-9_]*|0[xX](?:[0-9a-fA-F]*\.[0-9a-fA-F]+|[0-9a-fA-F]+\.?)(?:[pP][+-]?[0-9]+)?[fhiu]?|(?:[0-9]*\.[0-9]+|[0-9]+\.?)(?:[eE][+-]?[0-9]+)?[fhiu]?/uy;

/**
 * The WGSL token stream of shader text (2.29.0, #658: a lexer, so that blankspace the minifier removes between two tokens cannot
 * hide a change): comments removed (block comments nest) and blankspace skipped (WGSL §3: both only separate tokens), then the
 * longest identifier, literal or syntactic token at each position. An interpolation (`${…}` in a literal body) is one token.
 * Used by tests and the build to show that minification changes no token.
 */
export function wgslTokens(body) {
  const tokens = [];
  const state = { blockDepth: 0 };
  let text = "";
  for (const line of body.split("\n")) text += stripCommentsFromLine(line, state) + "\n";
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
    if (c === "$" && text[i + 1] === "{") { const end = skipExpression(text, i + 2) + 1; tokens.push(text.slice(i, end)); i = end; continue; }
    WORD.lastIndex = i;
    const word = WORD.exec(text);
    if (word) { tokens.push(word[0]); i += word[0].length; continue; }
    const multi = MULTI_CHARACTER_TOKENS.find((t) => text.startsWith(t, i));
    tokens.push(multi ?? c);
    i += multi ? multi.length : 1;
  }
  return tokens;
}

/** A Vite/Vitest plugin that applies {@link minifyWgslTemplates} to `src/` TypeScript, so tests run the shipped shader text. */
export function wgslMinifyPlugin() {
  return {
    name: "photivra-wgsl-minify",
    enforce: "pre",
    transform(code, id) {
      if (!/[\\/]src[\\/].*\.ts$/u.test(id) || !code.includes("wgsl")) return null;
      const { code: next, literals } = minifyWgslTemplates(code);
      return literals.length === 0 ? null : { code: next, map: null };
    }
  };
}
