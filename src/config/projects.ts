import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export type ProjectRecord = {
  path: string;
  name: string;
  lastOpened: string;
};

function globalWinnowDir(): string {
  return join(homedir(), ".winnow");
}

function projectsFilePath(): string {
  return join(globalWinnowDir(), "projects.json");
}

export async function listProjects(): Promise<ProjectRecord[]> {
  try {
    const content = await readFile(projectsFilePath(), "utf8");
    const projects = JSON.parse(content) as ProjectRecord[];
    return Array.isArray(projects) ? projects : [];
  } catch {
    return [];
  }
}

export async function registerProject(projectPath: string): Promise<void> {
  const projects = await listProjects();
  const name = projectPath.split("/").pop() || projectPath;
  
  const existingIndex = projects.findIndex(p => p.path === projectPath);
  const now = new Date().toISOString();

  if (existingIndex > -1) {
    projects[existingIndex].lastOpened = now;
  } else {
    projects.push({
      path: projectPath,
      name,
      lastOpened: now
    });
  }

  // Sort by last opened
  projects.sort((a, b) => b.lastOpened.localeCompare(a.lastOpened));

  await mkdir(globalWinnowDir(), { recursive: true });
  await writeFile(projectsFilePath(), JSON.stringify(projects.slice(0, 100), null, 2), "utf8");
}
