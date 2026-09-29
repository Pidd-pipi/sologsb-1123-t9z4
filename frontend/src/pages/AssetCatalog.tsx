import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { DownloadOutlined, PlusOutlined } from '@ant-design/icons';
import { useMissionStore } from '../stores/missionStore';
import { useAssetStore } from '../stores/assetStore';
import { usePlanStore, PlanValidationError } from '../stores/planStore';
import AssetGrid from '../components/common/AssetGrid';
import AmapRouteView from '../components/common/AmapRouteView';
import { IMAGE_QUALITIES, type ImageAsset, type ImageAssetDraft, type ImageQuality } from '../types/imageasset';
import type { Waypoint } from '../types/waypoint';
import { distanceMeters } from '../utils/geoCalc';

/** /missions/:id/assets 成果影像编目：按片号接收、绑定架次并核销 */
export default function AssetCatalog() {
  const { id = '' } = useParams();
  const missions = useMissionStore((s) => s.items);
  const assets = useAssetStore((s) => s.items);
  const thumbs = useAssetStore((s) => s.thumbs);
  const receiveMany = useAssetStore((s) => s.receiveMany);
  const bindAssetStore = useAssetStore((s) => s.bindAsset);
  const markMany = useAssetStore((s) => s.markMany);
  const removeMany = useAssetStore((s) => s.removeMany);
  const currentVersionSelector = usePlanStore((s) => s.currentVersion);
  const sortiesForVersion = usePlanStore((s) => s.sortiesForVersion);
  const reconcile = usePlanStore((s) => s.reconcile);
  const setStatus = usePlanStore((s) => s.setStatus);

  const mission = missions.find((m) => m.id === id);
  const activeVersion = mission ? currentVersionSelector(id, mission) : undefined;
  const sorties = activeVersion ? sortiesForVersion(activeVersion.id) : [];
  const missionAssets = useMemo(
    () => assets.filter((a) => a.missionId === id).sort((a, b) => a.imageNo.localeCompare(b.imageNo, 'zh-Hans-CN', { numeric: true })),
    [assets, id],
  );
  const frozenWaypoints = useMemo<Waypoint[]>(
    () =>
      activeVersion
        ? activeVersion.waypoints.map((w) => ({
            id: `snapshot_${w.seq}`,
            missionId: id,
            ...w,
          }))
        : [],
    [activeVersion, id],
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [qualityFilter, setQualityFilter] = useState<ImageQuality | 'all'>('all');
  const [locateSeq, setLocateSeq] = useState<number | undefined>(undefined);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [sortieId, setSortieId] = useState('');
  const [receiveText, setReceiveText] = useState('');
  const [bindAssetId, setBindAssetId] = useState('');

  useEffect(() => {
    if (!sortieId && sorties.length > 0) setSortieId(sorties.find((s) => s.status === '待飞')?.id ?? sorties[0].id);
  }, [sorties, sortieId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedSortie = sorties.find((s) => s.id === sortieId);
  const unboundAssets = missionAssets.filter((a) => !a.planVersionId || !a.sortieId);
  const filtered = missionAssets.filter((a) => {
    if (qualityFilter !== 'all' && a.quality !== qualityFilter) return false;
    if (keyword && !a.imageNo.toLowerCase().includes(keyword.trim().toLowerCase())) return false;
    return true;
  });

  const stats = IMAGE_QUALITIES.map((quality) => ({
    quality,
    count: missionAssets.filter((a) => a.quality === quality).length,
  }));

  const receiveDrafts = async (drafts: ImageAssetDraft[]) => {
    if (!activeVersion || !selectedSortie) {
      setError('请先让任务进入待飞行，生成冻结方案与架次');
      return;
    }
    const result = await receiveMany(drafts, { version: activeVersion, sortie: selectedSortie });
    setError('');
    setToast(`第 ${selectedSortie.sortieNo} 架次接收：新增 ${result.inserted} 张，重复片号补空值 ${result.filled} 张，跳过 ${result.skipped} 张`);
  };

  /** 按冻结航点生成片号；重复片号不会覆盖已判质量或缩略图 */
  const catalogFromWaypoints = async () => {
    if (!mission || !activeVersion) {
      setError('任务尚未冻结方案');
      return;
    }
    if (frozenWaypoints.length === 0) {
      setError('冻结方案中暂无航点，不能生成片号');
      return;
    }
    const usedNos = new Set(missionAssets.map((a) => a.imageNo.trim().toLowerCase()));
    const drafts: ImageAssetDraft[] = frozenWaypoints
      .map((w, index) => ({
        missionId: mission.id,
        imageNo: `IMG_${String(2000 + index + 1)}`,
        lng: w.lng,
        lat: w.lat,
        altitude: w.altitude,
        gsd: activeVersion.route.gsd,
        overlap: Math.round((activeVersion.route.overlapForward + activeVersion.route.overlapSide) / 2),
        tiltAngle: Math.abs(w.gimbalPitch + 90),
        shotAt: undefined,
        quality: undefined,
        folder: `/${mission.missionNo}/${String(selectedSortie?.sortieNo ?? 1).padStart(3, '0')}MEDIA`,
      }))
      .filter((d) => !usedNos.has(d.imageNo.toLowerCase()));
    if (drafts.length === 0) {
      setToast('冻结航点对应的片号均已接收，重复片号未重复创建');
      return;
    }
    await receiveDrafts(drafts);
  };

  const receiveByImageNo = async () => {
    const numbers = receiveText
      .split(/[\s,;，；]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    if (numbers.length === 0) {
      setError('请输入至少一个片号，支持换行、空格或逗号分隔');
      return;
    }
    if (!mission) return;
    const unique = Array.from(new Set(numbers));
    await receiveDrafts(
      unique.map((imageNo) => ({
        missionId: mission.id,
        imageNo,
        folder: `/${mission.missionNo}/${String(selectedSortie?.sortieNo ?? 1).padStart(3, '0')}MEDIA`,
      })),
    );
    setReceiveText('');
  };

  const locate = (asset: ImageAsset) => {
    if (frozenWaypoints.length === 0 || asset.lng === undefined || asset.lat === undefined) return;
    let best = frozenWaypoints[0];
    let bestDist = Number.POSITIVE_INFINITY;
    frozenWaypoints.forEach((w) => {
      const d = distanceMeters([asset.lng!, asset.lat!], [w.lng, w.lat]);
      if (d < bestDist) {
        bestDist = d;
        best = w;
      }
    });
    setLocateSeq(best.seq);
    setToast(`已定位到已飞方案航点 #${best.seq}（距离 ${bestDist.toFixed(1)} m）`);
  };

  const exportList = () => {
    const header = '片号,版本,架次,经度,纬度,航高m,GSDcm/px,重叠%,倾角°,质量,归档目录';
    const sortieNoById = new Map(sorties.map((s) => [s.id, s.sortieNo]));
    const lines = missionAssets.map((a) =>
      [
        a.imageNo,
        activeVersion?.versionNo ?? '',
        a.sortieId ? sortieNoById.get(a.sortieId) ?? '' : '',
        a.lng ?? '',
        a.lat ?? '',
        a.altitude ?? '',
        a.gsd ?? '',
        a.overlap ?? '',
        a.tiltAngle ?? '',
        a.quality ?? '',
        a.folder ?? '',
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `成果影像清单_${mission?.missionNo ?? 'mission'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    setToast(`已导出 ${lines.length} 条影像清单`);
  };

  if (!mission) {
    return (
      <Space direction="vertical">
        <Alert type="warning" showIcon message="未找到该任务" />
        <Link to="/missions">返回任务台账</Link>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Space wrap align="center">
        <Typography.Title level={4} style={{ margin: 0 }}>
          成果影像编目 · {mission.missionNo}
        </Typography.Title>
        <Tag color="cyan">{mission.purpose}</Tag>
        <Tag color="purple">{activeVersion ? `冻结版本 v${activeVersion.versionNo} · ${activeVersion.status}` : '方案未冻结'}</Tag>
        <Tag>条目 {missionAssets.length} 张</Tag>
        <Tag color={unboundAssets.length > 0 ? 'red' : 'green'}>未绑定 {unboundAssets.length} 张</Tag>
        <div style={{ flex: 1 }} />
        <Button type="link"><Link to={`/missions/${mission.id}/route`}>航线规划</Link></Button>
        <Button type="link"><Link to={`/missions/${mission.id}/waypoints`}>航点明细</Link></Button>
        <Button type="link"><Link to="/missions">返回台账</Link></Button>
      </Space>

      {toast ? <Alert type="success" showIcon message={toast} closable onClose={() => setToast('')} /> : null}
      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError('')} /> : null}
      {mission.status === '规划中' ? (
        <Alert
          type="warning"
          showIcon
          message="任务仍在规划中，成果接收前需要按当前航点、航线和相机参数冻结方案。"
          action={<Button size="small" type="primary" onClick={() => setStatus(mission.id, '待飞行')}>进入待飞行并冻结 v1</Button>}
        />
      ) : null}

      <Row gutter={12}>
        {stats.map((s) => (
          <Col span={4} key={s.quality}>
            <Card size="small"><Statistic title={`${s.quality}影像`} value={s.count} suffix="张" /></Card>
          </Col>
        ))}
        <Col span={4}>
          <Card size="small"><Statistic title="未绑定影像" value={unboundAssets.length} suffix="张" /></Card>
        </Col>
        <Col span={4}>
          <Card size="small"><Statistic title="未核销架次" value={sorties.filter((s) => s.status !== '已核销').length} suffix="个" /></Card>
        </Col>
        <Col span={4}>
          <Card size="small"><Statistic title="冻结航点" value={frozenWaypoints.length} suffix="个" /></Card>
        </Col>
      </Row>

      <Card size="small" title="按片号接收并绑定架次">
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          <Space wrap>
            <Select
              style={{ width: 240 }}
              placeholder="选择接收架次"
              value={sortieId || undefined}
              onChange={setSortieId}
              options={sorties.map((s) => ({
                value: s.id,
                label: `第 ${s.sortieNo} 架次 · 计划 ${s.plannedPhotos} 张 · ${s.status}`,
              }))}
            />
            <Tag color="blue">航高 {activeVersion?.route.altitude ?? '—'} m</Tag>
            <Tag color="blue">重叠 {activeVersion?.route.overlapForward ?? '—'}/{activeVersion?.route.overlapSide ?? '—'}%</Tag>
            <Tag color="blue">GSD {activeVersion?.route.gsd ?? '—'} cm/px</Tag>
          </Space>
          <Input.TextArea
            rows={3}
            placeholder="粘贴片号，例如：IMG_2001&#10;IMG_2002&#10;IMG_2003"
            value={receiveText}
            onChange={(e) => setReceiveText(e.target.value)}
          />
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={receiveByImageNo} disabled={!selectedSortie}>
              接收片号到选定架次
            </Button>
            <Button onClick={catalogFromWaypoints} disabled={!selectedSortie}>
              按已飞航点补片号
            </Button>
            {unboundAssets.length > 0 ? (
              <>
                <Select
                  style={{ width: 220 }}
                  placeholder="选择未绑定影像"
                  value={bindAssetId || undefined}
                  onChange={setBindAssetId}
                  options={unboundAssets.map((a) => ({ value: a.id, label: a.imageNo }))}
                />
                <Button
                  disabled={!bindAssetId || !selectedSortie}
                  onClick={async () => {
                    if (!activeVersion || !selectedSortie) return;
                    await bindAssetStore(bindAssetId, selectedSortie, activeVersion);
                    setBindAssetId('');
                    setToast('影像已绑定架次；已判质量和缩略图保持不变');
                  }}
                >
                  绑定到选定架次
                </Button>
              </>
            ) : null}
          </Space>
        </Space>
      </Card>

      <Card size="small" title="架次核销">
        <Space wrap>
          {sorties.length === 0 ? <Typography.Text type="secondary">暂无冻结架次</Typography.Text> : null}
          {sorties.map((s) => {
            const count = missionAssets.filter((a) => a.sortieId === s.id).length;
            return (
              <Card key={s.id} size="small" style={{ minWidth: 220 }}>
                <Space direction="vertical" size={4}>
                  <Space>
                    <Typography.Text strong>第 {s.sortieNo} 架次</Typography.Text>
                    <Tag color={s.status === '已核销' ? 'green' : 'orange'}>{s.status}</Tag>
                  </Space>
                  <Typography.Text type="secondary">计划 {s.plannedPhotos} 张 / {s.plannedDurationMin} min · 已绑定 {count} 张</Typography.Text>
                  <Button
                    size="small"
                    disabled={s.status === '已核销' || count === 0}
                    onClick={async () => {
                      try {
                        await reconcile(s.id);
                        setToast(`第 ${s.sortieNo} 架次已核销`);
                      } catch (err) {
                        setError(err instanceof PlanValidationError ? err.message : '架次核销失败');
                      }
                    }}
                  >
                    核销架次
                  </Button>
                </Space>
              </Card>
            );
          })}
        </Space>
      </Card>

      <Card size="small">
        <Space wrap size={10}>
          <Input allowClear style={{ width: 200 }} placeholder="按片号筛选" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          <Select
            style={{ width: 140 }}
            value={qualityFilter}
            onChange={(v) => setQualityFilter(v as ImageQuality | 'all')}
            options={[{ value: 'all', label: '全部质量' }, ...IMAGE_QUALITIES.map((q) => ({ value: q, label: q }))]}
          />
          <Button
            disabled={selected.length === 0}
            onClick={async () => { await markMany(selected, '合格'); setToast(`已把 ${selected.length} 张标记为「合格」`); }}
          >标记合格</Button>
          <Button
            disabled={selected.length === 0}
            onClick={async () => { await markMany(selected, '模糊'); setToast(`已把 ${selected.length} 张标记为「模糊」`); }}
          >标记模糊</Button>
          <Button
            disabled={selected.length === 0}
            onClick={async () => { await markMany(selected, '过曝'); setToast(`已把 ${selected.length} 张标记为「过曝」`); }}
          >标记过曝</Button>
          <Button
            danger
            disabled={selected.length === 0}
            onClick={async () => { await removeMany(selected); setToast(`已删除 ${selected.length} 条影像条目`); setSelected([]); }}
          >删除选中</Button>
          <Button icon={<DownloadOutlined />} onClick={exportList} disabled={missionAssets.length === 0}>导出成果清单</Button>
        </Space>
      </Card>

      <Row gutter={14}>
        <Col span={16}>
          <Card size="small" title={`影像格子（筛选后 ${filtered.length} 张）`}>
            <AssetGrid
              assets={filtered}
              thumbs={thumbs}
              selectedIds={selected}
              onToggle={(assetId) => setSelected((prev) => (prev.includes(assetId) ? prev.filter((x) => x !== assetId) : [...prev, assetId]))}
              onToggleAll={(ids) => setSelected(ids)}
              onLocate={locate}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title="已飞方案定位">
            <AmapRouteView mission={mission} waypoints={frozenWaypoints} altitude={activeVersion?.route.altitude ?? 120} height={340} highlightSeq={locateSeq} />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
