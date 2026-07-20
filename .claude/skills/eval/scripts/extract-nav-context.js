#!/usr/bin/env node
/**
 * extract-nav-context.js — Deterministic navigation context extractor.
 * Replaces the LLM-driven eval-nav-context skill for standard project layouts.
 *
 * Usage: node extract-nav-context.js <artifacts-dir> <workspace-dir>
 *
 * Reads product-overlay.yaml for sidebar_file / routes_file paths,
 * parses route definitions and nav hierarchy from the workspace,
 * and writes navigation-hints.json to the artifacts directory.
 */

const fs = require("fs");
const path = require("path");

const OVERLAY_PATH = path.join(
  __dirname,
  "..",
  "config",
  "product-overlay.yaml",
);

const DEFAULT_ROUTES_FILE = "src/app/AppRoutes.tsx";
const DEFAULT_SIDEBAR_FILE = "src/app/AppLayout/AppLayout.tsx";

function parseOverlayNavigation() {
  if (!fs.existsSync(OVERLAY_PATH)) {
    return {
      routes_file: DEFAULT_ROUTES_FILE,
      sidebar_file: DEFAULT_SIDEBAR_FILE,
    };
  }
  const content = fs.readFileSync(OVERLAY_PATH, "utf8");

  const routesMatch = content.match(/routes_file:\s*["']?([^\s"'#]+)/);
  const sidebarMatch = content.match(/sidebar_file:\s*["']?([^\s"'#]+)/);

  return {
    routes_file: routesMatch ? routesMatch[1] : DEFAULT_ROUTES_FILE,
    sidebar_file: sidebarMatch ? sidebarMatch[1] : DEFAULT_SIDEBAR_FILE,
  };
}

function readMrDelta(artifactsDir) {
  const deltaPath = path.join(artifactsDir, "mr-delta.json");
  if (!fs.existsSync(deltaPath)) {
    console.error(`WARNING: ${deltaPath} not found — proceeding without delta`);
    return null;
  }
  return JSON.parse(fs.readFileSync(deltaPath, "utf8"));
}

function extractRoutes(workspaceDir, routesFile) {
  const fullPath = path.join(workspaceDir, routesFile);
  if (!fs.existsSync(fullPath)) {
    console.error(`WARNING: Routes file not found: ${fullPath}`);
    return [];
  }

  const content = fs.readFileSync(fullPath, "utf8");
  const lines = content.split("\n");
  const routes = [];

  // Match patterns like: path: "/some/path"  or  path="/some/path"
  const pathRegex = /path[=:]\s*["'`]([^"'`]+)["'`]/;
  // Match component references near path definitions
  const componentRegex =
    /component:\s*(\w+)|element:\s*<(\w+)|element:\s*\{.*<(\w+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pathMatch = line.match(pathRegex);
    if (!pathMatch) continue;

    const routePath = pathMatch[1];
    let component = null;

    // Look for component on this line and nearby lines (window of ±3)
    const windowStart = Math.max(0, i - 3);
    const windowEnd = Math.min(lines.length - 1, i + 3);
    for (let j = windowStart; j <= windowEnd; j++) {
      const compMatch = lines[j].match(componentRegex);
      if (compMatch) {
        component = compMatch[1] || compMatch[2] || compMatch[3];
        break;
      }
    }

    routes.push({
      path: routePath,
      file: routesFile,
      line: i + 1,
      component: component || null,
    });
  }

  return routes;
}

function extractNavSections(workspaceDir, sidebarFile) {
  const fullPath = path.join(workspaceDir, sidebarFile);
  if (!fs.existsSync(fullPath)) {
    console.error(`WARNING: Sidebar file not found: ${fullPath}`);
    return {};
  }

  const content = fs.readFileSync(fullPath, "utf8");
  const sections = {};

  // Strategy: find expandable sections and their NavItem children.
  // Pattern 1: NavExpandable with title="Section Name" containing NavItem children
  const expandableRegex =
    /NavExpandable[^>]*title=["']([^"']+)["'][^]*?<\/NavExpandable>/gs;
  let expMatch;
  while ((expMatch = expandableRegex.exec(content)) !== null) {
    const sectionName = expMatch[1];
    const sectionBlock = expMatch[0];

    const children = [];
    const navItemRegex =
      /(?:to=["'][^"']*["'][^>]*>([^<]+)|>([^<]+)<\/NavItem)/g;
    let itemMatch;
    while ((itemMatch = navItemRegex.exec(sectionBlock)) !== null) {
      const label = (itemMatch[1] || itemMatch[2] || "").trim();
      if (label && !label.includes("{") && !label.includes("<")) {
        children.push(label);
      }
    }

    if (children.length > 0) {
      sections[sectionName] = {
        children,
        selector: `button:has-text("${sectionName}")`,
      };
    }
  }

  // Pattern 2: Object-based nav config like { label: "Section", children: [...] }
  if (Object.keys(sections).length === 0) {
    const objSectionRegex =
      /(?:label|title|name):\s*["']([^"']+)["'],?\s*\n\s*(?:children|items):\s*\[([^\]]+)\]/g;
    let objMatch;
    while ((objMatch = objSectionRegex.exec(content)) !== null) {
      const sectionName = objMatch[1];
      const childrenBlock = objMatch[2];
      const children = [];

      const childLabelRegex = /["']([^"']+)["']/g;
      let childMatch;
      while ((childMatch = childLabelRegex.exec(childrenBlock)) !== null) {
        children.push(childMatch[1]);
      }

      if (children.length > 0) {
        sections[sectionName] = {
          children,
          selector: `button:has-text("${sectionName}")`,
        };
      }
    }
  }

  return sections;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: node extract-nav-context.js <artifacts-dir> <workspace-dir>",
    );
    process.exit(1);
  }

  const artifactsDir = path.resolve(args[0]);
  const workspaceDir = path.resolve(args[1]);

  if (!fs.existsSync(workspaceDir)) {
    console.error(`ERROR: Workspace directory not found: ${workspaceDir}`);
    process.exit(1);
  }

  const nav = parseOverlayNavigation();
  console.log(
    `Routes file: ${nav.routes_file}, Sidebar file: ${nav.sidebar_file}`,
  );

  const mrDelta = readMrDelta(artifactsDir);
  const routes = extractRoutes(workspaceDir, nav.routes_file);
  const navSections = extractNavSections(workspaceDir, nav.sidebar_file);

  const hints = {
    extracted_at: new Date().toISOString(),
    workspace: workspaceDir,
    routes,
    nav_sections: navSections,
  };

  const outPath = path.join(artifactsDir, "navigation-hints.json");
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(hints, null, 2));

  console.log(
    `navigation-hints.json: ${routes.length} routes, ${Object.keys(navSections).length} nav sections`,
  );
}

main();
