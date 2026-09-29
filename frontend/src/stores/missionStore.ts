import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { emitPlanChanged } from '../utils/planEvents';
import { touchWorkingPlan } from '../utils/planService';
import type { CameraPreset, Mission, MissionDraft, MissionStatus } from '../types/mission';

interface MissionState {
  items: Mission[];
  presets: CameraPreset[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: MissionDraft) => Promise<Mission>;
  update: (id: string, patch: Partial<Mission>) => Promise<void>;
  setStatus: (id: string, status: MissionStatus) => Promise<void>;
  applyPreset: (missionId: string, presetId: string) => Promise<void>;
  addPreset: (draft: Omit<CameraPreset, 'id'>) => Promise<CameraPreset>;
  removePreset: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const CAMERA_PATCH_KEYS = ['cameraModel', 'sensorWidth', 'sensorHeight', 'focalLength', 'pixelSize'] as const;

export const useMissionStore = create<MissionState>((set, get) => ({
  items: [],
  presets: [],
  loaded: false,
  async load() {
    const rows = await db.missions.orderBy('createdAt').reverse().toArray();
    const presets = await db.presets.toArray();
    set({ items: rows, presets, loaded: true });
  },
  async add(draft) {
    const record: Mission = {
      ...draft,
      id: newId('mission'),
      archiveRevision: 0,
      archiveConflict: undefined,
      createdAt: Date.now(),
    };
    await db.missions.put(record);
    set({ items: [record, ...get().items] });
    emitPlanChanged();
    return record;
  },
  async update(id, patch) {
    const previous = get().items.find((it) => it.id === id);
    if (previous?.status === '已归档' && CAMERA_PATCH_KEYS.some((key) => patch[key] !== undefined)) {
      throw new Error('已归档任务的相机参数已随方案冻结');
    }
    await db.missions.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
    if (CAMERA_PATCH_KEYS.some((key) => patch[key] !== undefined)) {
      await touchWorkingPlan(id);
      emitPlanChanged();
    }
  },
  async setStatus(id, status) {
    await get().update(id, { status });
  },
  async applyPreset(missionId, presetId) {
    const preset = get().presets.find((p) => p.id === presetId);
    if (!preset) return;
    await get().update(missionId, {
      cameraModel: preset.cameraModel,
      sensorWidth: preset.sensorWidth,
      sensorHeight: preset.sensorHeight,
      focalLength: preset.focalLength,
      pixelSize: preset.pixelSize,
    });
  },
  async addPreset(draft) {
    const record: CameraPreset = { ...draft, id: newId('preset') };
    await db.presets.put(record);
    set({ presets: [...get().presets, record] });
    return record;
  },
  async removePreset(id) {
    await db.presets.delete(id);
    set({ presets: get().presets.filter((p) => p.id !== id) });
  },
  async remove(id) {
    await db.transaction(
      'rw',
      [db.missions, db.waypoints, db.lines, db.assets, db.thumbs, db.planVersions, db.sorties],
      async () => {
        const assetIds = await db.assets.where('missionId').equals(id).primaryKeys();
        await db.thumbs.bulkDelete(assetIds);
        await db.assets.where('missionId').equals(id).delete();
        await db.sorties.where('missionId').equals(id).delete();
        await db.planVersions.where('missionId').equals(id).delete();
        await db.lines.where('missionId').equals(id).delete();
        await db.waypoints.where('missionId').equals(id).delete();
        await db.missions.delete(id);
      },
    );
    set({ items: get().items.filter((it) => it.id !== id) });
    emitPlanChanged();
  },
}));
