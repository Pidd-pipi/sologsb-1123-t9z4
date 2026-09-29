import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { emitPlanChanged } from '../utils/planEvents';
import { touchWorkingPlan } from '../utils/planService';
import type { Waypoint, WaypointDraft } from '../types/waypoint';

interface WaypointState {
  items: Waypoint[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (draft: WaypointDraft) => Promise<Waypoint>;
  addMany: (drafts: WaypointDraft[]) => Promise<Waypoint[]>;
  update: (id: string, patch: Partial<Waypoint>) => Promise<void>;
  move: (id: string, direction: 'up' | 'down') => Promise<void>;
  reorder: (fromId: string, toId: string) => Promise<void>;
  removeByMission: (missionId: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  byMission: (missionId: string) => Waypoint[];
}

async function afterPlanChange(missionId: string): Promise<void> {
  await touchWorkingPlan(missionId);
  emitPlanChanged();
}

async function assertMutableMission(missionId: string): Promise<void> {
  const mission = await db.missions.get(missionId);
  if (mission?.status === '已归档') throw new Error('已归档任务的方案已冻结，不能修改航点');
}

export const useWaypointStore = create<WaypointState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const rows = await db.waypoints.toArray();
    rows.sort((a, b) => a.seq - b.seq);
    set({ items: rows, loaded: true });
  },
  async add(draft) {
    await assertMutableMission(draft.missionId);
    const record: Waypoint = { ...draft, id: newId('wp') };
    await db.waypoints.put(record);
    set({ items: [...get().items, record] });
    await afterPlanChange(record.missionId);
    return record;
  },
  async addMany(drafts) {
    const missionId = drafts[0]?.missionId;
    if (missionId) await assertMutableMission(missionId);
    const records: Waypoint[] = drafts.map((d) => ({ ...d, id: newId('wp') }));
    await db.waypoints.bulkPut(records);
    set({ items: [...get().items, ...records] });
    if (missionId) await afterPlanChange(missionId);
    return records;
  },
  async update(id, patch) {
    const previous = get().items.find((it) => it.id === id);
    if (previous) await assertMutableMission(previous.missionId);
    await db.waypoints.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
    if (previous) await afterPlanChange(previous.missionId);
  },
  /** 与相邻航点交换序号 */
  async move(id, direction) {
    const list = get().byMission(get().items.find((it) => it.id === id)?.missionId ?? '');
    const index = list.findIndex((it) => it.id === id);
    const target = direction === 'up' ? list[index - 1] : list[index + 1];
    if (!target) return;
    await get().reorder(id, target.id);
  },
  async reorder(fromId, toId) {
    const from = get().items.find((it) => it.id === fromId);
    const to = get().items.find((it) => it.id === toId);
    if (!from || !to) return;
    await assertMutableMission(from.missionId);
    const fromSeq = from.seq;
    await db.waypoints.update(from.id, { seq: to.seq });
    await db.waypoints.update(to.id, { seq: fromSeq });
    set({
      items: get().items.map((it) => {
        if (it.id === from.id) return { ...it, seq: to.seq };
        if (it.id === to.id) return { ...it, seq: fromSeq };
        return it;
      }),
    });
    await afterPlanChange(from.missionId);
  },
  async removeByMission(missionId) {
    await assertMutableMission(missionId);
    const ids = get().items.filter((it) => it.missionId === missionId).map((it) => it.id);
    await db.waypoints.bulkDelete(ids);
    set({ items: get().items.filter((it) => it.missionId !== missionId) });
    await afterPlanChange(missionId);
  },
  async remove(id) {
    const previous = get().items.find((it) => it.id === id);
    if (previous) await assertMutableMission(previous.missionId);
    await db.waypoints.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
    if (previous) await afterPlanChange(previous.missionId);
  },
  byMission(missionId) {
    return get()
      .items.filter((it) => it.missionId === missionId)
      .sort((a, b) => a.seq - b.seq);
  },
}));
