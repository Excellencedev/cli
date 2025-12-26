import * as fs from "node:fs"
import * as path from "node:path"
import * as ts from "typescript"

interface ValidationError {
  file: string
  dependency: string
  message: string
}

export function validateDependencies(
  circuitFiles: string[],
  projectDir: string,
): ValidationError[] {
  const errors: ValidationError[] = []

  // Read package.json
  const packageJsonPath = path.join(projectDir, "package.json")
  if (!fs.existsSync(packageJsonPath)) {
    return errors // No package.json, skip validation
  }

  let packageJson: any
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
  } catch (error) {
    return errors // Invalid package.json, skip validation
  }

  const dependencies = packageJson.dependencies || {}
  const devDependencies = packageJson.devDependencies || {}

  for (const filePath of circuitFiles) {
    const imports = getImportsFromFile(filePath)
    for (const importPath of imports) {
      if (isNpmPackage(importPath)) {
        const packageName = getPackageName(importPath)
        if (devDependencies[packageName] && !dependencies[packageName]) {
          errors.push({
            file: path.relative(projectDir, filePath),
            dependency: packageName,
            message: `Dependency "${packageName}" is in devDependencies but is being imported in production code. Move it to dependencies.`,
          })
        }
      }
    }
  }

  return errors
}

function getImportsFromFile(filePath: string): string[] {
  const content = fs.readFileSync(filePath, "utf-8")
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  )

  const imports: string[] = []

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier
      if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
        imports.push(moduleSpecifier.text)
      }
    }

    // Check for dynamic imports
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0]
      if (argument && ts.isStringLiteral(argument)) {
        imports.push(argument.text)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return imports
}

function isNpmPackage(importPath: string): boolean {
  // Not a relative import and not an @tsci/ package
  return !importPath.startsWith(".") && !importPath.startsWith("@tsci/")
}

function getPackageName(importPath: string): string {
  // Handle scoped packages like @scope/package/path
  const match = importPath.match(/^(@[^\/]+\/[^\/]+|[^\/]+)/)
  return match ? match[0] : importPath
}
