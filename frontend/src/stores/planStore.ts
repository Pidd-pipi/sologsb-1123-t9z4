import { create } from 'zustand';
import { db } from '../utils/db';
import { emitPlanChanged } from '../utils/planEvents';
import {
  PlanConflictError,
  PlanValidationError,
  bindAssetToSortie,
  markSortieReconciled,
  transitionMissionStatus,
} from '../utils/planService';
import type { Mission, MissionStatus } from '../types/mission';
import type { PlanVersion, SortieRecord } from '../types/planVersion';

interface PlanState {
  versions: PlanVersion[];
  sorties: SortieRecord[];
  loaded: boolean;
  load: () => Promise<void>;
  versionsForMission: (missionId: string) => PlanVersion[];
  currentVersion: (missionId: string, mission?: Mission) => PlanVersion | undefined;
  sortiesForVersion: (versionId: string) => SortieRecord[];
  setStatus: (missionId: string, status: MissionStatus, expectedRevision?: number) => Promise<void>;
  reconcile: (sortieId: string) => Promise<void>;
  bindAsset: (assetId: string, sortieId: string) => Promise<void>;
  markArchiveConflict: (missionId: string) => Promise<void>;
  clearConflict: (missionId: string) => Promise<void>;
}

export { PlanConflictError, PlanValidationError };

export const usePlanStore = create<PlanState>((set, get) => ({
  versions: [],
  sorties: [],
  loaded: false,
  async load() {
    const [versions, sorties] = await Promise.all([
      db.planVersions.orderBy('createdAt').toArray(),
      db.sorties.orderBy('sortieNo').toArray(),
    ]);
    set({ versions, sorties, loaded: true });
  },
  versionsForMission(missionId) {
    return get()
      .versions.filter((v) => v.missionId === missionId)
      .sort((a, b) => b.versionNo - a.versionNo);
  },
  currentVersion(missionId, mission) {
    const list = get().versionsForMission(missionId);
    return list.find((v) => v.id === mission?.currentVersionId) ?? list.find((v) => v.status !== '草稿') ?? list[0];
  },
  sortiesForVersion(versionId) {
    return get()
      .sorties.filter((s) => s.planVersionId === versionId)
      .sort((a, b) => a.sortieNo - b.sortieNo);
  },
  async setStatus(missionId, status, expectedRevision) {
    await transitionMissionStatus(missionId, status, expectedRevision);
    await get().load();
    emitPlanChanged();
  },
  async reconcile(sortieId) {
    await markSortieReconciled(sortieId);
    await get().load();
    emitPlanChanged();
  },
  async bindAsset(assetId, sortieId) {
    await bindAssetToSortie(assetId, sortieId);
    emitPlanChanged();
  },
  async markArchiveConflict(missionId) {
    await db.missions.update(missionId, { archiveConflict: true });
    await get().load();
    emitPlanChanged();
  },
  async clearConflict(missionId) {
    await db.missions.update(missionId, { archiveConflict: undefined });
    emitPlanChanged();
  },
}));
