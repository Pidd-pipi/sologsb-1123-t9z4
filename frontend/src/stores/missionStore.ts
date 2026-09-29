import { create } from 'zustand';
import { buildSchemeSnapshot, db, loadSchemeVersions } from '../utils/db';
import { newId } from '../utils/id';
import type { CameraPreset, Mission, MissionDraft, MissionStatus } from '../types/mission';
import type { SchemeVersion } from '../types/scheme';

interface ArchiveResult {
  ok: boolean;
  /** 并发冲突：其他标签页已先归档 */
  conflict?: boolean;
  /** 未绑定架次的成果数 */
  unbound?: number;
}

interface MissionState {
  items: Mission[];
  presets: CameraPreset[];
  schemeVersions: SchemeVersion[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: MissionDraft) => Promise<Mission>;
  update: (id: string, patch: Partial<Mission>) => Promise<void>;
  setStatus: (id: string, status: MissionStatus) => Promise<void>;
  applyPreset: (missionId: string, presetId: string) => Promise<void>;
  addPreset: (draft: Omit<CameraPreset, 'id'>) => Promise<CameraPreset>;
  removePreset: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  loadSchemeVersions: (missionId: string) => Promise<SchemeVersion[]>;
  loadAllSchemeVersions: () => Promise<void>;
  /** 冻结当前方案为一个新版本（进入待飞行） */
  freezeScheme: (missionId: string) => Promise<SchemeVersion | undefined>;
  /** 归档（乐观锁：expectedArchiveVersion 与当前不符则冲突） */
  archiveMission: (missionId: string, expectedArchiveVersion: number) => Promise<ArchiveResult>;
  /** 模拟另一标签页先归档（把 archiveVersion +1） */
  simulateConcurrentArchive: (missionId: string) => Promise<void>;
}

export const useMissionStore = create<MissionState>((set, get) => ({
  items: [],
  presets: [],
  schemeVersions: [],
  loaded: false,
  async load() {
    const rows = await db.missions.orderBy('createdAt').reverse().toArray();
    const presets = await db.presets.toArray();
    set({ items: rows, presets, loaded: true });
  },
  async add(draft) {
    const record: Mission = { ...draft, id: newId('mission'), createdAt: Date.now() };
    await db.missions.put(record);
    set({ items: [record, ...get().items] });
    return record;
  },
  async update(id, patch) {
    await db.missions.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
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
    await db.missions.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
  async loadSchemeVersions(missionId) {
    const versions = await loadSchemeVersions(missionId);
    const others = get().schemeVersions.filter((v) => v.missionId !== missionId);
    set({ schemeVersions: [...others, ...versions] });
    return versions;
  },
  async loadAllSchemeVersions() {
    const rows = await db.schemes.toArray();
    set({ schemeVersions: rows });
  },
  async freezeScheme(missionId) {
    const mission = get().items.find((m) => m.id === missionId);
    if (!mission) return undefined;
    const snapshot = await buildSchemeSnapshot(mission);
    const versionNo = (mission.currentVersion ?? 0) + 1;
    const record: SchemeVersion = {
      id: newId('scheme'),
      missionId,
      versionNo,
      ...snapshot,
      createdAt: Date.now(),
      archiveVersion: 0,
    };
    await db.schemes.put(record);
    await get().update(missionId, { currentVersion: versionNo, status: '待飞行' });
    set({ schemeVersions: [...get().schemeVersions.filter((v) => v.missionId !== missionId), record] });
    return record;
  },
  async archiveMission(missionId, expectedArchiveVersion) {
    try {
      await db.transaction('rw', db.missions, db.assets, async () => {
        const mission = await db.missions.get(missionId);
        if (!mission) throw new Error('任务不存在');
        if ((mission.archiveVersion ?? 0) !== expectedArchiveVersion) {
          throw new Error('VERSION_CONFLICT');
        }
        const assets = await db.assets.where('missionId').equals(missionId).toArray();
        const unbound = assets.filter((a) => a.sortieNo === undefined || a.sortieNo === null);
        if (unbound.length > 0) {
          throw new Error(`UNBOUND:${unbound.length}`);
        }
        mission.archiveVersion = (mission.archiveVersion ?? 0) + 1;
        mission.status = '已归档';
        await db.missions.put(mission);
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'VERSION_CONFLICT') return { ok: false, conflict: true };
      if (msg.startsWith('UNBOUND:')) return { ok: false, unbound: Number(msg.split(':')[1]) };
      throw e;
    }
    set({
      items: get().items.map((it) =>
        it.id === missionId ? { ...it, archiveVersion: (it.archiveVersion ?? 0) + 1, status: '已归档' } : it,
      ),
    });
    return { ok: true };
  },
  async simulateConcurrentArchive(missionId) {
    // 模拟另一标签页先归档：只写库，不更新本标签页 store（本标签页仍持旧版本号）
    const mission = await db.missions.get(missionId);
    if (!mission) return;
    const next = (mission.archiveVersion ?? 0) + 1;
    await db.missions.update(missionId, { archiveVersion: next });
  },
}));
