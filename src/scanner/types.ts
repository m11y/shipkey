export type ShipkeyDirectiveValue = boolean | string;

export interface ShipkeyDirective {
  [key: string]: ShipkeyDirectiveValue;
}

export interface EnvVar {
  key: string;
  value?: string; // undefined if from template file
  source: string; // file path relative to project root
  isTemplate: boolean; // true if from .example file
  directive?: ShipkeyDirective;
}

export interface ScanResult {
  projectRoot: string;
  groups: SubProjectGroup[];
  totalVars: number;
  totalFiles: number;
}

export interface SubProjectGroup {
  path: string; // relative path from project root (e.g. "apps/api")
  files: ScannedFile[];
}

export interface ScannedFile {
  path: string; // relative file path
  isTemplate: boolean;
  vars: EnvVar[];
}
