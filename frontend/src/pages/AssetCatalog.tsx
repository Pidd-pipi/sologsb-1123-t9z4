import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleOutlined,
  DownloadOutlined,
  LockOutlined,
  PlusOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useMissionStore } from '../stores/missionStore';
import { useWaypointStore } from '../stores/waypointStore';
import { useAssetStore } from '../stores/assetStore';
import AssetGrid from '../components/common/AssetGrid';
import AmapRouteView from '../components/common/AmapRouteView';
import { IMAGE_QUALITIES, type ImageAsset, type ImageAssetDraft, type ImageQuality } from '../types/imageasset';
import { calcGsd } from '../utils/geoCalc';
import { canArchive, getSchemeConflicts, getUnboundCount } from '../utils/schemeUtils';

/** /missions/:id/assets 成果影像编目：按片号接收、绑定架次、版本冲突检测后归档 */
export default function AssetCatalog() {
  const { id = '' } = useParams();
  const missions = useMissionStore((s) => s.items);
  const waypoints = useWaypointStore((s) => s.items);
  const assets = useAssetStore((s) => s.items);
  const thumbs = useAssetStore((s) => s.thumbs);
  const addMany = useAssetStore((s) => s.addMany);
  const markMany = useAssetStore((s) => s.markMany);
  const removeMany = useAssetStore((s) => s.removeMany);
  const receiveByPhotoNo = useAssetStore((s) => s.receiveByPhotoNo);
  const bindToSortie = useAssetStore((s) => s.bindToSortie);
  const schemeVersions = useMissionStore((s) => s.schemeVersions);
  const loadSchemeVersions = useMissionStore((s) => s.loadSchemeVersions);
  const archiveMission = useMissionStore((s) => s.archiveMission);
  const simulateConcurrentArchive = useMissionStore((s) => s.simulateConcurrentArchive);

  const mission = missions.find((m) => m.id === id);
  const missionAssets = useMemo(
    () => assets.filter((a) => a.missionId === id).sort((a, b) => a.imageNo.localeCompare(b.imageNo, 'zh-Hans-CN', { numeric: true })),
    [assets, id],
  );
  const missionWaypoints = useMemo(
    () => waypoints.filter((w) => w.missionId === id).sort((a, b) => a.seq - b.seq),
    [waypoints, id],
  );
  const versions = useMemo(() => schemeVersions.filter((v) => v.missionId === id).sort((a, b) => b.versionNo - a.versionNo), [schemeVersions, id]);
  const currentVersion = mission?.currentVersion ?? 0;
  const currentVersionRecord = versions.find((v) => v.versionNo === currentVersion);
  const sortieOptions = useMemo(
    () => (currentVersionRecord?.sorties ?? []).map((s) => ({ value: s.sortieNo, label: `第 ${s.sortieNo} 架次（${s.photos} 张）` })),
    [currentVersionRecord],
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [keyword, setKeyword] = useState('');
  const [qualityFilter, setQualityFilter] = useState<ImageQuality | 'all'>('all');
  const [locateSeq, setLocateSeq] = useState<number | undefined>(undefined);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [receiveText, setReceiveText] = useState('');
  const [receiveSortie, setReceiveSortie] = useState<number | undefined>(undefined);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveResult, setArchiveResult] = useState<{ ok: boolean; conflict?: boolean; unbound?: number } | null>(null);

  useEffect(() => {
    if (id) void loadSchemeVersions(id);
  }, [id, loadSchemeVersions]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filtered = missionAssets.filter((a) => {
    if (qualityFilter !== 'all' && a.quality !== qualityFilter) return false;
    if (keyword && !a.imageNo.toLowerCase().includes(keyword.trim().toLowerCase())) return false;
    return true;
  });

  const stats = IMAGE_QUALITIES.map((quality) => ({
    quality,
    count: missionAssets.filter((a) => a.quality === quality).length,
  }));

  const unboundCount = getUnboundCount(assets, id);
  const conflicts = mission ? getSchemeConflicts(mission, assets, schemeVersions) : [];
  const archiveCheck = mission ? canArchive(mission, assets, schemeVersions) : { ok: false, unbound: 0, conflicts: [] };

  /** 批量编目：按航点位置与当前航线 GSD 生成影像条目 */
  const catalogFromWaypoints = async () => {
    if (!mission) return;
    if (missionWaypoints.length === 0) {
      setError('该任务暂无航点，请先到「航点明细」录入或点击网格新增');
      return;
    }
    const gsd = calcGsd(mission.pixelSize, missionWaypoints[0].altitude, mission.focalLength);
    const startNo = missionAssets.length + 1;
    const drafts: ImageAssetDraft[] = missionWaypoints.map((w, index) => ({
      missionId: mission.id,
      imageNo: `IMG_${String(2000 + startNo + index)}`,
      lng: w.lng,
      lat: w.lat,
      altitude: w.altitude,
      gsd: calcGsd(mission.pixelSize, w.altitude, mission.focalLength) || gsd,
      overlap: 75,
      tiltAngle: Math.abs(w.gimbalPitch + 90),
      shotAt: Date.now() + index * 1000,
      quality: '合格' as ImageQuality,
      folder: `/${mission.missionNo}/100MEDIA`,
    }));
    await addMany(drafts);
    setError('');
    setToast(`已按 ${drafts.length} 个航点批量编目影像条目（GSD ${gsd} cm/px）`);
  };

  /** 按片号接收成果：重复片号只补空值，保留已判质量与缩略图 */
  const receiveByPhoto = async () => {
    if (!mission) return;
    const nos = receiveText
      .split(/[\r\n,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (nos.length === 0) {
      setError('请输入至少一个片号（每行一个，或用逗号分隔）');
      return;
    }
    const result = await receiveByPhotoNo(mission.id, nos, receiveSortie, currentVersionRecord?.id);
    setError('');
    setToast(
      `接收完成：新建 ${result.created.length} 张，补空值 ${result.filled.length} 张，跳过 ${result.skipped.length} 张（重复片号保留已判质量与缩略图）`,
    );
    setReceiveText('');
  };

  const bindSelected = async (sortieNo: number) => {
    if (selected.length === 0) return;
    await bindToSortie(selected, sortieNo);
    setToast(`已把 ${selected.length} 张成果绑定到第 ${sortieNo} 架次`);
    setSelected([]);
  };

  const locate = (asset: ImageAsset) => {
    if (missionWaypoints.length === 0) return;
    let best = missionWaypoints[0];
    let bestDist = Number.POSITIVE_INFINITY;
    missionWaypoints.forEach((w) => {
      const d = (() => {
        const R = 6371000;
        const lat1 = (asset.lat * Math.PI) / 180;
        const lat2 = (w.lat * Math.PI) / 180;
        const dLat = ((w.lat - asset.lat) * Math.PI) / 180;
        const dLng = ((w.lng - asset.lng) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(a));
      })();
      if (d < bestDist) {
        bestDist = d;
        best = w;
      }
    });
    setLocateSeq(best.seq);
    setToast(`已定位到航点 #${best.seq}（距离 ${bestDist.toFixed(1)} m）`);
  };

  const exportList = () => {
    const header = '片号,经度,纬度,航高m,GSDcm/px,重叠%,倾角°,质量,架次,归档目录';
    const lines = missionAssets.map((a) =>
      [
        a.imageNo,
        a.lng,
        a.lat,
        a.altitude,
        a.gsd,
        a.overlap,
        a.tiltAngle,
        a.quality,
        a.sortieNo ?? '',
        a.folder,
      ].join(','),
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `成果影像清单_${mission?.missionNo ?? 'mission'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(`已导出 ${lines.length} 条影像清单`);
  };

  const doArchive = async () => {
    if (!mission) return;
    const result = await archiveMission(mission.id, mission.archiveVersion ?? 0);
    setArchiveResult(result);
    if (result.ok) {
      setArchiveOpen(false);
      setToast('归档成功：方案版本已锁定，成果不可再覆盖');
    }
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
        <Tag>条目 {missionAssets.length} 张</Tag>
        {currentVersion > 0 ? <Tag color="geekblue">方案 v{currentVersion}</Tag> : null}
        {unboundCount > 0 ? (
          <Tag color="orange" icon={<WarningOutlined />}>
            {unboundCount} 张未绑定架次
          </Tag>
        ) : (
          <Tag color="green" icon={<CheckCircleOutlined />}>
            全部绑定架次
          </Tag>
        )}
        <div style={{ flex: 1 }} />
        <Button
          type="primary"
          icon={<LockOutlined />}
          onClick={() => {
            setArchiveResult(null);
            setArchiveOpen(true);
          }}
          disabled={mission.status === '已归档'}
        >
          归档
        </Button>
        <Button type="link">
          <Link to={`/missions/${mission.id}/route`}>航线规划</Link>
        </Button>
        <Button type="link">
          <Link to={`/missions/${mission.id}/waypoints`}>航点明细</Link>
        </Button>
        <Button type="link">
          <Link to="/missions">返回台账</Link>
        </Button>
      </Space>

      {toast ? <Alert type="success" showIcon message={toast} closable onClose={() => setToast('')} /> : null}
      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError('')} /> : null}
      {conflicts.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="方案冲突"
          description={
            <Space direction="vertical" size={4}>
              {conflicts.map((c, i) => (
                <div key={i}>{c.message}</div>
              ))}
            </Space>
          }
        />
      ) : null}

      <Row gutter={12}>
        {stats.map((s) => (
          <Col span={6} key={s.quality}>
            <Card size="small">
              <Statistic title={`${s.quality}影像`} value={s.count} suffix="张" />
            </Card>
          </Col>
        ))}
      </Row>

      <Card size="small" title="按片号接收成果（重复片号只补空值，保留已判质量与缩略图）">
        <Space wrap size={10} align="start">
          <Input.TextArea
            rows={3}
            style={{ width: 360 }}
            placeholder={'每行一个片号，或用逗号分隔，例如：\nIMG_1001\nIMG_1002, IMG_1003'}
            value={receiveText}
            onChange={(e) => setReceiveText(e.target.value)}
          />
          <Space direction="vertical" size={6}>
            <Select
              style={{ width: 200 }}
              placeholder="绑定到架次（可选）"
              value={receiveSortie}
              onChange={setReceiveSortie}
              allowClear
              options={sortieOptions}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={receiveByPhoto}>
              接收成果
            </Button>
          </Space>
        </Space>
      </Card>

      <Card size="small" title="批量操作与架次绑定">
        <Space wrap size={10}>
          <Input
            allowClear
            style={{ width: 200 }}
            placeholder="按片号筛选"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            style={{ width: 140 }}
            value={qualityFilter}
            onChange={(v) => setQualityFilter(v as ImageQuality | 'all')}
            options={[{ value: 'all', label: '全部质量' }, ...IMAGE_QUALITIES.map((q) => ({ value: q, label: q }))]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={catalogFromWaypoints}>
            按航点批量编目
          </Button>
          <Button disabled={selected.length === 0} onClick={() => markMany(selected, '合格')}>
            标记合格
          </Button>
          <Button disabled={selected.length === 0} onClick={() => markMany(selected, '模糊')}>
            标记模糊
          </Button>
          <Button disabled={selected.length === 0} onClick={() => markMany(selected, '过曝')}>
            标记过曝
          </Button>
          <Button disabled={selected.length === 0} onClick={() => markMany(selected, '未判')}>
            标记未判
          </Button>
          <Select
            style={{ width: 180 }}
            placeholder="绑定选中到架次"
            value={undefined}
            onChange={(v) => v !== undefined && bindSelected(v)}
            options={sortieOptions}
            disabled={selected.length === 0}
          />
          <Button
            danger
            disabled={selected.length === 0}
            onClick={async () => {
              await removeMany(selected);
              setToast(`已删除 ${selected.length} 条影像条目`);
              setSelected([]);
            }}
          >
            删除选中
          </Button>
          <Button icon={<DownloadOutlined />} onClick={exportList} disabled={missionAssets.length === 0}>
            导出成果清单
          </Button>
        </Space>
      </Card>

      <Row gutter={14}>
        <Col span={16}>
          <Card size="small" title={`影像格子（筛选后 ${filtered.length} 张）`}>
            <AssetGrid
              assets={filtered}
              thumbs={thumbs}
              selectedIds={selected}
              onToggle={(assetId) =>
                setSelected((prev) => (prev.includes(assetId) ? prev.filter((x) => x !== assetId) : [...prev, assetId]))
              }
              onToggleAll={(ids) => setSelected(ids)}
              onLocate={locate}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title="定位到图">
            <AmapRouteView
              mission={mission}
              waypoints={missionWaypoints}
              altitude={missionWaypoints[0]?.altitude ?? 120}
              height={340}
              highlightSeq={locateSeq}
            />
          </Card>
        </Col>
      </Row>

      <Modal
        open={archiveOpen}
        title="归档任务"
        onCancel={() => setArchiveOpen(false)}
        onOk={doArchive}
        okText="确认归档"
        okButtonProps={{ disabled: !archiveCheck.ok }}
      >
        {archiveResult?.conflict ? (
          <Alert
            type="error"
            showIcon
            message="版本冲突"
            description="另一标签页已先完成归档，当前方案版本已过期。先提交结果不能被覆盖，请刷新后重新核对成果。"
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {archiveResult && !archiveResult.ok && !archiveResult.conflict ? (
          <Alert
            type="warning"
            showIcon
            message={`还有 ${archiveResult.unbound ?? unboundCount} 张成果未绑定架次，不能归档`}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          <Typography.Text>
            任务：{mission.missionNo} · 方案版本 v{currentVersion}
          </Typography.Text>
          <Typography.Text>
            成果条目：{missionAssets.length} 张 · 未绑定架次：{unboundCount} 张
          </Typography.Text>
          {conflicts.length > 0 ? (
            <Alert type="warning" showIcon message="存在方案冲突，归档后旧版本成果将无法更新" />
          ) : null}
          {mission.status !== '已归档' ? (
            <Button
              size="small"
              onClick={async () => {
                await simulateConcurrentArchive(mission.id);
                setToast('已模拟另一标签页先归档（archiveVersion +1），此时再点归档将看到冲突');
              }}
            >
              模拟另一标签页先归档
            </Button>
          ) : null}
        </Space>
      </Modal>
    </Space>
  );
}
