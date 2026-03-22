import { access } from "fs/promises";
import { join, resolve } from "path";

export async function resolveProjectDir(dir: string): Promise<string | null> {
  const projectDir = resolve(dir);

  try {
    await access(join(projectDir, "shipkey.json"));
    return projectDir;
  } catch {
    return null;
  }
}
