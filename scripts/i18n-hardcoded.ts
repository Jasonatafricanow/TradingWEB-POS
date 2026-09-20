import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

export type ViolationCategory =
  | "jsx-text"
  | "jsx-expression"
  | "visible-attribute"
  | "alert"
  | "api-error";

export interface LiteralViolation {
  file: string;
  category: ViolationCategory;
  literal: string;
}

export interface NewLiteralViolation extends LiteralViolation {
  count: number;
}

interface BaselineConfig {
  version: 1;
  baselineCommit: string;
  roots: string[];
  excludes: string[];
}

const VISIBLE_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "accessibilityHint",
  "accessibilityLabel",
  "description",
  "label",
  "placeholder",
  "title",
]);
const VISIBLE_OBJECT_PROPERTIES = new Set([
  "accessibilityHint",
  "accessibilityLabel",
  "description",
  "label",
  "placeholder",
  "sub",
  "title",
]);

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizeLiteral(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isMeaningfulLiteral(value: string): boolean {
  return value.length > 1 && /[\p{L}\p{N}]/u.test(value);
}

function expressionLiteral(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return normalizeLiteral(node.text);
  }
  if (ts.isTemplateExpression(node)) {
    const value = [
      node.head.text,
      ...node.templateSpans.flatMap((span) => ["{expression}", span.literal.text]),
    ].join("");
    return normalizeLiteral(value);
  }
  if (ts.isParenthesizedExpression(node)) return expressionLiteral(node.expression);
  return null;
}

interface ConstantBinding {
  declaration: ts.VariableDeclaration;
  initializer: ts.Expression;
  scope: ts.Node;
}

function enclosingLexicalScope(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isBlock(current) ||
      ts.isSourceFile(current) ||
      ts.isModuleBlock(current)
    ) {
      return current;
    }
    current = current.parent;
  }
  return node.getSourceFile();
}

function isAncestorScope(scope: ts.Node, node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === scope) return true;
    current = current.parent;
  }
  return false;
}

function expressionLiterals(
  node: ts.Expression,
  constants: ReadonlyMap<string, readonly ConstantBinding[]>,
  seen = new Set<ts.VariableDeclaration>(),
): string[] {
  const direct = expressionLiteral(node);
  if (direct !== null) return [direct];
  if (ts.isIdentifier(node)) {
    const binding = (constants.get(node.text) ?? [])
      .filter(({ declaration, scope }) =>
        declaration.getStart() < node.getStart() && isAncestorScope(scope, node),
      )
      .sort((left, right) => right.declaration.getStart() - left.declaration.getStart())[0];
    if (!binding || seen.has(binding.declaration)) return [];
    return expressionLiterals(
      binding.initializer,
      constants,
      new Set(seen).add(binding.declaration),
    );
  }
  if (ts.isConditionalExpression(node)) {
    return [
      ...expressionLiterals(node.whenTrue, constants, seen),
      ...expressionLiterals(node.whenFalse, constants, seen),
    ];
  }
  if (
    ts.isBinaryExpression(node) &&
    [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(node.operatorToken.kind)
  ) {
    return [
      ...expressionLiterals(node.left, constants, seen),
      ...expressionLiterals(node.right, constants, seen),
    ];
  }
  return [];
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

function calledName(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    return `${expression.expression.getText()}.${expression.name.text}`;
  }
  return null;
}

export function scanSourceText(file: string, sourceText: string): LiteralViolation[] {
  const normalizedFile = normalizePath(file);
  const sourceFile = ts.createSourceFile(
    normalizedFile,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    normalizedFile.endsWith(".tsx") || normalizedFile.endsWith(".jsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );
  const violations: LiteralViolation[] = [];
  const constants = new Map<string, ConstantBinding[]>();

  const collectConstants = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      const bindings = constants.get(node.name.text) ?? [];
      bindings.push({
        declaration: node,
        initializer: node.initializer,
        scope: enclosingLexicalScope(node),
      });
      constants.set(node.name.text, bindings);
    }
    ts.forEachChild(node, collectConstants);
  };
  collectConstants(sourceFile);

  const add = (category: ViolationCategory, literal: string): void => {
    const normalized = normalizeLiteral(literal);
    if (!isMeaningfulLiteral(normalized)) return;
    violations.push({ file: normalizedFile, category, literal: normalized });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      add("jsx-text", node.text);
    } else if (
      ts.isJsxExpression(node) &&
      node.expression &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
    ) {
      for (const literal of expressionLiterals(node.expression, constants)) {
        add("jsx-expression", literal);
      }
    } else if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      VISIBLE_ATTRIBUTES.has(node.name.text)
    ) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) {
        add("visible-attribute", node.initializer.text);
      } else if (
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        for (const literal of expressionLiterals(node.initializer.expression, constants)) {
          add("visible-attribute", literal);
        }
      }
    } else if (ts.isCallExpression(node)) {
      const name = calledName(node.expression);
      if (
        name === "Alert.alert" ||
        name === "alert" ||
        name === "confirm" ||
        name?.startsWith("toast.") ||
        /^(setError|setMessage|setStatus|setWarning)$/.test(name ?? "")
      ) {
        for (const argument of node.arguments) {
          for (const literal of expressionLiterals(argument, constants)) add("alert", literal);
        }
      }
    } else if (ts.isPropertyAssignment(node)) {
      const name = propertyNameText(node.name);
      const category =
        normalizedFile.includes("/app/api/") &&
        (name === "error" || name === "message")
          ? "api-error"
          : name && VISIBLE_OBJECT_PROPERTIES.has(name)
            ? "visible-attribute"
            : null;
      if (category) {
        for (const literal of expressionLiterals(node.initializer, constants)) {
          add(category, literal);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function violationKey(violation: LiteralViolation): string {
  return JSON.stringify([violation.file, violation.category, violation.literal]);
}

function countViolations(violations: LiteralViolation[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const violation of violations) {
    const key = violationKey(violation);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function compareViolationCounts(
  current: LiteralViolation[],
  baseline: LiteralViolation[],
): NewLiteralViolation[] {
  const baselineCounts = countViolations(baseline);
  const currentCounts = countViolations(current);
  const byKey = new Map(current.map((violation) => [violationKey(violation), violation]));

  return [...currentCounts.entries()]
    .flatMap(([key, count]) => {
      const added = count - (baselineCounts.get(key) ?? 0);
      const violation = byKey.get(key);
      return added > 0 && violation ? [{ ...violation, count: added }] : [];
    })
    .sort((left, right) =>
      `${left.file}\0${left.category}\0${left.literal}`.localeCompare(
        `${right.file}\0${right.category}\0${right.literal}`,
      ),
    );
}

function shouldScan(file: string, excludes: string[]): boolean {
  const normalized = normalizePath(file);
  if (!/\.[jt]sx?$/.test(normalized) || normalized.endsWith(".d.ts")) return false;
  if (
    normalized.includes("/__tests__/") ||
    /\.(test|spec)\.[jt]sx?$/.test(normalized)
  ) {
    return false;
  }
  return !excludes.some((exclude) => {
    const normalizedExclude = normalizePath(exclude).replace(/\/+$/, "");
    return normalized === normalizedExclude || normalized.startsWith(`${normalizedExclude}/`);
  });
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(target));
    else if (entry.isFile()) result.push(target);
  }
  return result;
}

function scanWorkingTree(repoRoot: string, config: BaselineConfig): LiteralViolation[] {
  return config.roots
    .flatMap((root) => walkFiles(path.join(repoRoot, root)))
    .map((file) => normalizePath(path.relative(repoRoot, file)))
    .filter((file) => shouldScan(file, config.excludes))
    .flatMap((file) =>
      scanSourceText(file, fs.readFileSync(path.join(repoRoot, file), "utf8")),
    );
}

function scanBaselineCommit(repoRoot: string, config: BaselineConfig): LiteralViolation[] {
  const files = execFileSync(
    "git",
    ["-C", repoRoot, "ls-tree", "-r", "--name-only", config.baselineCommit, "--", ...config.roots],
    { encoding: "utf8" },
  )
    .split(/\r?\n/)
    .map(normalizePath)
    .filter(Boolean)
    .filter((file) => shouldScan(file, config.excludes));

  return files.flatMap((file) => {
    const source = execFileSync(
      "git",
      ["-C", repoRoot, "show", `${config.baselineCommit}:${file}`],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );
    return scanSourceText(file, source);
  });
}

function runCli(): void {
  const repoRoot = process.cwd();
  const configPath = path.join(repoRoot, "scripts", "i18n-baseline.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as BaselineConfig;
  if (config.version !== 1) throw new Error("Unsupported i18n baseline version");

  const baseline = scanBaselineCommit(repoRoot, config);
  const current = scanWorkingTree(repoRoot, config);
  const added = compareViolationCounts(current, baseline);

  console.log(
    `i18n literal inventory: baseline=${baseline.length} current=${current.length} new=${added.reduce((sum, item) => sum + item.count, 0)}`,
  );
  if (added.length === 0) return;

  for (const violation of added) {
    console.error(
      `${violation.file} [${violation.category}] x${violation.count}: ${violation.literal}`,
    );
  }
  process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runCli();
}
