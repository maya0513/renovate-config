// Renovate publishes these internal JavaScript entry points without declarations.
// Keep the test boundary typed using the configuration types it does publish.
declare module 'renovate/dist/modules/platform/api.js' {
  import type { Platform } from 'renovate/dist/modules/platform/types.js';
  const api: Map<string, Platform>;
  export default api;
}

declare module 'renovate/dist/config/presets/index.js' {
  import type { RenovateConfig } from 'renovate/dist/config/types.js';

  export function resolveConfigPresets(config: RenovateConfig): Promise<{ config: RenovateConfig }>;
}

declare module 'renovate/dist/util/minimum-release-age.js' {
  import type { RenovateConfig } from 'renovate/dist/config/types.js';

  export function checkMinimumReleaseAge(config: RenovateConfig, timestamp: string | null): {
    isPending: boolean;
    minimumReleaseAgeMs: number;
    hasTimestamp: boolean;
  };
}

declare module 'renovate/dist/workers/repository/updates/flatten.js' {
  import type { RenovateConfig } from 'renovate/dist/config/types.js';
  import type { PackageFile } from 'renovate/dist/modules/manager/types.js';
  import type { BranchUpgradeConfig } from 'renovate/dist/workers/types.js';

  export function flattenUpdates(config: RenovateConfig, files: Record<string, PackageFile[]>): Promise<BranchUpgradeConfig[]>;
}

declare module 'renovate/dist/workers/repository/update/branch/schedule.js' {
  import type { DateTime } from 'luxon';
  import type { RenovateConfig } from 'renovate/dist/config/types.js';

  export function cronMatches(cron: string, now: DateTime, timezone?: string): boolean;
  export function isScheduledNow(config: RenovateConfig): boolean;
}

declare module 'renovate/dist/modules/manager/mise/extract.js' {
  import type { PackageFileContent } from 'renovate/dist/modules/manager/types.js';

  export function extractPackageFile(content: string, packageFile: string): Promise<PackageFileContent | null>;
}

declare module 'renovate/dist/modules/manager/mise/update-locked.js' {
  import type { UpdateLockedConfig, UpdateLockedResult } from 'renovate/dist/modules/manager/types.js';

  export function updateLockedDependency(config: UpdateLockedConfig): UpdateLockedResult;
}

declare module 'renovate/dist/modules/manager/npm/extract/index.js' {
  import type { ExtractConfig, PackageFileContent } from 'renovate/dist/modules/manager/types.js';

  export function extractPackageFile(content: string, packageFile: string, config: ExtractConfig): Promise<PackageFileContent | null>;
}

declare module 'renovate/dist/modules/manager/npm/extract/pnpm.js' {
  import type { PackageFileContent } from 'renovate/dist/modules/manager/types.js';
  export function extractPnpmWorkspaceFile(content: unknown, packageFile: string): Promise<PackageFileContent | null>;
}

declare module 'renovate/dist/modules/manager/github-actions/extract.js' {
  import type { ExtractConfig, PackageFileContent } from 'renovate/dist/modules/manager/types.js';

  export function extractPackageFile(content: string, packageFile: string, config?: ExtractConfig): Promise<PackageFileContent | null>;
}

declare module 'renovate/dist/modules/versioning/npm/index.js' {
  import type { VersioningApi } from 'renovate/dist/modules/versioning/types.js';

  export const api: VersioningApi;
}

declare module 'renovate/dist/modules/manager/npm/post-update/utils.js' {
  export function lazyLoadPackageJson(directory: string): { getValue(): Promise<unknown> };
  export function getPackageManagerVersion(name: string, pkg: unknown): string | null;
}

declare module 'renovate/dist/modules/manager/npm/post-update/node-version.js' {
  import type { RenovateConfig } from 'renovate/dist/config/types.js';
  import type { BranchUpgradeConfig } from 'renovate/dist/workers/types.js';
  export function getNodeToolConstraint(config: RenovateConfig, upgrades: BranchUpgradeConfig[], directory: string, pkg: { getValue(): Promise<unknown> }): Promise<{ toolName: string; constraint: string | null }>;
}

declare module 'renovate/dist/workers/repository/update/branch/artifacts.js' {
  import type { RenovateConfig } from 'renovate/dist/config/types.js';
  export function setArtifactErrorStatus(config: RenovateConfig & { branchName: string; artifactErrors?: { fileName: string; stderr: string }[] }): Promise<void>;
}
