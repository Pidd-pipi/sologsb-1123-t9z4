import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { emitPlanChanged } from '../utils/planEvents';
import { makeThumbDataUrl, type AssetThumb, type ImageAsset, type ImageAssetDraft, type ImageQuality } from '../types/imageasset';
import type { PlanVersion, SortieRecord } from '../types/planVersion';

export interface AssetReceiveResult {
  inserted: number;
  filled: number;
  skipped: number;
}

interface AssetState {
  items: ImageAsset[];
  thumbs: Record<string, string>;
  loaded: boolean;
  load: () => Promise<void>;
  addMany: (drafts: ImageAssetDraft[]) => Promise<ImageAsset[]>;
  receiveMany: (
    drafts: ImageAssetDraft[],
    context: { version: PlanVersion; sortie: SortieRecord },
  ) => Promise<AssetReceiveResult>;
  update: (id: string, patch: Partial<ImageAsset>) => Promise<void>;
  bindAsset: (id: string, sortie: SortieRecord, version: PlanVersion) => Promise<void>;
  markMany: (ids: string[], quality: ImageQuality) => Promise<void>;
  removeMany: (ids: string[]) => Promise<void>;
  byMission: (missionId: string) => ImageAsset[];
  qualityStats: (missionId: string) => { quality: ImageQuality; count: number }[];
}

function blankFallback(asset: ImageAssetDraft): Partial<ImageAsset> {
  return {
    receivedAt: asset.receivedAt ?? Date.now(),
    altitude: asset.altitude,
    gsd: asset.gsd,
    overlap: asset.overlap,
    tiltAngle: asset.tiltAngle ?? 0,
    shotAt: asset.shotAt,
  };
}

export const useAssetStore = create<AssetState>((set, get) => ({
  items: [],
  thumbs: {},
  loaded: false,
  async load() {
    const rows = await db.assets.toArray();
    rows.sort((a, b) => a.imageNo.localeCompare(b.imageNo, 'zh-Hans-CN', { numeric: true }));
    const thumbRows = await db.thumbs.toArray();
    const thumbs: Record<string, string> = {};
    thumbRows.forEach((t) => {
      thumbs[t.id] = t.dataUrl;
    });
    set({ items: rows, thumbs, loaded: true });
  },
  async addMany(drafts) {
    const now = Date.now();
    const records: ImageAsset[] = drafts.map((d) => ({ ...d, receivedAt: d.receivedAt ?? now, id: newId('asset') }));
    const thumbRecords: AssetThumb[] = records.map((r) => ({
      id: r.id,
      missionId: r.missionId,
      dataUrl: makeThumbDataUrl(r.imageNo, r.quality, r.lng, r.lat),
    }));
    // 缩略图单独建表存放；重复片号接收时不替换缩略图
    await db.assets.bulkPut(records);
    await db.thumbs.bulkPut(thumbRecords);
    const nextThumbs = { ...get().thumbs };
    thumbRecords.forEach((t) => {
      nextThumbs[t.id] = t.dataUrl;
    });
    set({ items: [...get().items, ...records], thumbs: nextThumbs });
    emitPlanChanged();
    return records;
  },
  async receiveMany(drafts, { version, sortie }) {
    const result: AssetReceiveResult = { inserted: 0, filled: 0, skipped: 0 };
    const existing = await db.assets.where('missionId').equals(version.missionId).toArray();

    await db.transaction('rw', [db.assets, db.thumbs], async () => {
      for (const draft of drafts) {
        const matched = existing.find((item) => item.imageNo.trim().toLowerCase() === draft.imageNo.trim().toLowerCase());
        if (matched) {
          if (matched.sortieId === sortie.id) {
            result.skipped += 1;
            continue;
          }
          if (matched.sortieId && matched.planVersionId) {
            // 同片号已绑定到其他架次：保留原绑定、质量和缩略图
            result.skipped += 1;
            continue;
          }
          const fillPatch: Partial<ImageAsset> = {};
          const candidates: Partial<ImageAsset> = {
            ...blankFallback(draft),
            planVersionId: version.id,
            sortieId: sortie.id,
            lng: draft.lng,
            lat: draft.lat,
            folder: draft.folder,
          };
          Object.entries(candidates).forEach(([key, value]) => {
            const current = matched[key as keyof ImageAsset];
            if ((current === undefined || current === null || current === '') && value !== undefined) {
              (fillPatch as Record<string, unknown>)[key] = value;
            }
          });
          if (Object.keys(fillPatch).length > 0) {
            await db.assets.update(matched.id, fillPatch);
            result.filled += 1;
          } else {
            result.skipped += 1;
          }
          continue;
        }

        const id = newId('asset');
        const record: ImageAsset = {
          id,
          missionId: version.missionId,
          imageNo: draft.imageNo.trim(),
          lng: draft.lng,
          lat: draft.lat,
          altitude: draft.altitude ?? version.route.altitude,
          gsd: draft.gsd ?? version.route.gsd,
          overlap: draft.overlap ?? Math.round((version.route.overlapForward + version.route.overlapSide) / 2),
          tiltAngle: draft.tiltAngle ?? 0,
          shotAt: draft.shotAt,
          quality: draft.quality,
          folder: draft.folder ?? `/${version.missionId}/${String(sortie.sortieNo).padStart(3, '0')}MEDIA`,
          planVersionId: version.id,
          sortieId: sortie.id,
          receivedAt: Date.now(),
        };
        await db.assets.put(record);
        await db.thumbs.put({
          id,
          missionId: version.missionId,
          dataUrl: makeThumbDataUrl(record.imageNo, record.quality, record.lng, record.lat),
        });
        existing.push(record);
        result.inserted += 1;
      }
    });

    await get().load();
    emitPlanChanged();
    return result;
  },
  async update(id, patch) {
    await db.assets.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
  },
  async bindAsset(id, sortie, version) {
    const asset = get().items.find((it) => it.id === id);
    const patch: Partial<ImageAsset> = {
      planVersionId: version.id,
      sortieId: sortie.id,
      receivedAt: asset?.receivedAt ?? Date.now(),
      altitude: asset?.altitude ?? version.route.altitude,
      gsd: asset?.gsd ?? version.route.gsd,
      overlap:
        asset?.overlap ?? Math.round((version.route.overlapForward + version.route.overlapSide) / 2),
    };
    await db.assets.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
    emitPlanChanged();
  },
  async markMany(ids, quality) {
    for (const id of ids) {
      await db.assets.update(id, { quality });
    }
    set({ items: get().items.map((it) => (ids.includes(it.id) ? { ...it, quality } : it)) });
  },
  async removeMany(ids) {
    await db.assets.bulkDelete(ids);
    await db.thumbs.bulkDelete(ids);
    const nextThumbs = { ...get().thumbs };
    ids.forEach((id) => {
      delete nextThumbs[id];
    });
    set({ items: get().items.filter((it) => !ids.includes(it.id)), thumbs: nextThumbs });
    emitPlanChanged();
  },
  byMission(missionId) {
    return get().items.filter((it) => it.missionId === missionId);
  },
  qualityStats(missionId) {
    const list = get().items.filter((it) => it.missionId === missionId);
    return (['合格', '模糊', '过曝'] as ImageQuality[]).map((quality) => ({
      quality,
      count: list.filter((it) => it.quality === quality).length,
    }));
  },
}));
