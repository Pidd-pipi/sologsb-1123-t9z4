import type { Mission } from '../types/mission';
import type { ImageAsset } from '../types/imageasset';
import type { SchemeVersion, SchemeConflict } from '../types/scheme';

/** 计算任务的方案冲突（方案修改 / 并发归档） */
export function getSchemeConflicts(
  mission: Mission,
  assets: ImageAsset[],
  versions: SchemeVersion[],
): SchemeConflict[] {
  const conflicts: SchemeConflict[] = [];
  const missionAssets = assets.filter((a) => a.missionId === mission.id);
  const currentVersion = mission.currentVersion ?? 0;

  // 方案修改冲突：有成果按旧版本接收，但方案已更新
  const staleVersionIds = new Set(versions.filter((v) => v.versionNo < currentVersion).map((v) => v.id));
  const staleAssets = missionAssets.filter((a) => a.schemeVersionId && staleVersionIds.has(a.schemeVersionId));
  if (staleAssets.length > 0) {
    conflicts.push({
      type: 'scheme_modified',
      message: `方案已更新到 v${currentVersion}，但有 ${staleAssets.length} 张成果按旧版本接收`,
    });
  }

  return conflicts;
}

/** 未绑定架次的成果数 */
export function getUnboundCount(assets: ImageAsset[], missionId: string): number {
  return assets.filter((a) => a.missionId === missionId && (a.sortieNo === undefined || a.sortieNo === null)).length;
}

/** 归档前置检查：全部绑定且无冲突才允许归档 */
export function canArchive(
  mission: Mission,
  assets: ImageAsset[],
  versions: SchemeVersion[],
): { ok: boolean; unbound: number; conflicts: SchemeConflict[] } {
  const unbound = getUnboundCount(assets, mission.id);
  const conflicts = getSchemeConflicts(mission, assets, versions);
  return { ok: unbound === 0 && conflicts.length === 0, unbound, conflicts };
}
