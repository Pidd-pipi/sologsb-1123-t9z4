import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import { makeThumbDataUrl, type AssetThumb, type ImageAsset, type ImageAssetDraft, type ImageQuality } from '../types/imageasset';

interface ReceiveResult {
  /** 新建的片号 */
  created: string[];
  /** 已存在且补了空值的片号 */
  filled: string[];
  /** 已存在但无需补值的片号 */
  skipped: string[];
}

interface AssetState {
  items: ImageAsset[];
  thumbs: Record<string, string>;
  loaded: boolean;
  load: () => Promise<void>;
  addMany: (drafts: ImageAssetDraft[]) => Promise<ImageAsset[]>;
  update: (id: string, patch: Partial<ImageAsset>) => Promise<void>;
  markMany: (ids: string[], quality: ImageQuality) => Promise<void>;
  removeMany: (ids: string[]) => Promise<void>;
  byMission: (missionId: string) => ImageAsset[];
  qualityStats: (missionId: string) => { quality: ImageQuality; count: number }[];
  /** 按片号接收成果：重复片号只补空值，保留已判质量与缩略图 */
  receiveByPhotoNo: (missionId: string, imageNos: string[], sortieNo?: number, schemeVersionId?: string) => Promise<ReceiveResult>;
  /** 绑定到架次 */
  bindToSortie: (assetIds: string[], sortieNo: number) => Promise<void>;
  /** 未绑定架次的成果 */
  unboundAssets: (missionId: string) => ImageAsset[];
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
    const records: ImageAsset[] = drafts.map((d) => ({ ...d, id: newId('asset') }));
    const thumbRecords: AssetThumb[] = records.map((r) => ({
      id: r.id,
      missionId: r.missionId,
      dataUrl: makeThumbDataUrl(r.imageNo, r.quality, r.lng, r.lat),
    }));
    // 缩略图单独建表存放
    await db.assets.bulkPut(records);
    await db.thumbs.bulkPut(thumbRecords);
    const nextThumbs = { ...get().thumbs };
    thumbRecords.forEach((t) => {
      nextThumbs[t.id] = t.dataUrl;
    });
    set({ items: [...get().items, ...records], thumbs: nextThumbs });
    return records;
  },
  async update(id, patch) {
    await db.assets.update(id, patch);
    set({ items: get().items.map((it) => (it.id === id ? { ...it, ...patch } : it)) });
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
  },
  byMission(missionId) {
    return get().items.filter((it) => it.missionId === missionId);
  },
  qualityStats(missionId) {
    const list = get().items.filter((it) => it.missionId === missionId);
    return (['合格', '模糊', '过曝', '未判'] as ImageQuality[]).map((quality) => ({
      quality,
      count: list.filter((it) => it.quality === quality).length,
    }));
  },
  async receiveByPhotoNo(missionId, imageNos, sortieNo, schemeVersionId) {
    const created: string[] = [];
    const filled: string[] = [];
    const skipped: string[] = [];
    const newRecords: ImageAsset[] = [];
    const newThumbs: AssetThumb[] = [];
    const patches: Record<string, Partial<ImageAsset>> = {};

    for (const rawNo of imageNos) {
      const imageNo = rawNo.trim();
      if (!imageNo) continue;
      const existing = get().items.find((a) => a.missionId === missionId && a.imageNo === imageNo);
      if (existing) {
        // 重复片号：只补空值，不覆盖已判质量、缩略图等
        const patch: Partial<ImageAsset> = {};
        if (existing.sortieNo === undefined && sortieNo !== undefined) patch.sortieNo = sortieNo;
        if (existing.schemeVersionId === undefined && schemeVersionId !== undefined) patch.schemeVersionId = schemeVersionId;
        if (existing.folder === undefined || existing.folder === '') patch.folder = `/${missionId}/100MEDIA`;
        if (Object.keys(patch).length > 0) {
          patches[existing.id] = patch;
          filled.push(imageNo);
        } else {
          skipped.push(imageNo);
        }
      } else {
        const id = newId('asset');
        const record: ImageAsset = {
          id,
          missionId,
          imageNo,
          lng: 0,
          lat: 0,
          altitude: 0,
          gsd: 0,
          overlap: 0,
          tiltAngle: 0,
          shotAt: Date.now(),
          quality: '未判',
          folder: `/${missionId}/100MEDIA`,
          sortieNo,
          schemeVersionId,
        };
        newRecords.push(record);
        newThumbs.push({
          id,
          missionId,
          dataUrl: makeThumbDataUrl(imageNo, '未判', 0, 0),
        });
        created.push(imageNo);
      }
    }

    // 写库
    for (const [id, patch] of Object.entries(patches)) {
      await db.assets.update(id, patch);
    }
    if (newRecords.length > 0) {
      await db.assets.bulkPut(newRecords);
      await db.thumbs.bulkPut(newThumbs);
    }

    // 更新 store
    const nextThumbs = { ...get().thumbs };
    newThumbs.forEach((t) => {
      nextThumbs[t.id] = t.dataUrl;
    });
    set({
      items: [
        ...get().items.map((it) => (patches[it.id] ? { ...it, ...patches[it.id] } : it)),
        ...newRecords,
      ],
      thumbs: nextThumbs,
    });

    return { created, filled, skipped };
  },
  async bindToSortie(assetIds, sortieNo) {
    for (const id of assetIds) {
      await db.assets.update(id, { sortieNo });
    }
    set({
      items: get().items.map((it) => (assetIds.includes(it.id) ? { ...it, sortieNo } : it)),
    });
  },
  unboundAssets(missionId) {
    return get().items.filter((it) => it.missionId === missionId && (it.sortieNo === undefined || it.sortieNo === null));
  },
}));
