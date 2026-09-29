import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Space, Table, Tag, Typography, type TableProps } from 'antd';
import { LockOutlined, HistoryOutlined } from '@ant-design/icons';
import { useMissionStore } from '../../stores/missionStore';
import type { SchemeVersion } from '../../types/scheme';
import type { Mission } from '../../types/mission';

export interface SchemeVersionPanelProps {
  mission: Mission;
}

type VersionRow = {
  key: string;
  versionNo: number;
  waypoints: number;
  altitude: string;
  overlap: string;
  gsd: string;
  sorties: number;
  createdAt: string;
  archived: boolean;
};

/**
 * 方案版本面板：冻结当前方案为新版本，查看历史版本快照（航高/重叠率/GSD 不可变）。
 * 被航线规划页（/missions/:id/route）消费。
 */
export default function SchemeVersionPanel({ mission }: SchemeVersionPanelProps) {
  const schemeVersions = useMissionStore((s) => s.schemeVersions);
  const loadSchemeVersions = useMissionStore((s) => s.loadSchemeVersions);
  const freezeScheme = useMissionStore((s) => s.freezeScheme);
  const [freezing, setFreezing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [viewing, setViewing] = useState<SchemeVersion | null>(null);

  useEffect(() => {
    if (mission.id) void loadSchemeVersions(mission.id);
  }, [mission.id, loadSchemeVersions]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const versions = schemeVersions
    .filter((v) => v.missionId === mission.id)
    .sort((a, b) => b.versionNo - a.versionNo);
  const currentVersion = mission.currentVersion ?? 0;

  const onFreeze = async () => {
    setFreezing(true);
    setError('');
    try {
      const v = await freezeScheme(mission.id);
      if (v) {
        setToast(`已冻结方案 v${v.versionNo}（${v.waypoints.length} 个航点 · ${v.sorties.length} 个架次）`);
      }
    } catch (e) {
      setError(`冻结失败：${(e as Error).message}`);
    } finally {
      setFreezing(false);
    }
  };

  const rows: VersionRow[] = versions.map((v) => ({
    key: v.id,
    versionNo: v.versionNo,
    waypoints: v.waypoints.length,
    altitude: v.waypoints.length > 0 ? `${v.waypoints[0].altitude} m` : '—',
    overlap: `${v.line.overlapForward}/${v.line.overlapSide}%`,
    gsd: `${v.line.gsd} cm/px`,
    sorties: v.sorties.length,
    createdAt: new Date(v.createdAt).toLocaleString('zh-CN'),
    archived: v.archivedAt !== undefined,
  }));

  const columns: TableProps<VersionRow>['columns'] = [
    {
      title: '版本',
      dataIndex: 'versionNo',
      width: 90,
      render: (v: number) => (
        <Space size={4}>
          <Tag color={v === currentVersion ? 'geekblue' : 'default'}>v{v}</Tag>
          {v === currentVersion ? <Tag color="green">当前</Tag> : null}
        </Space>
      ),
    },
    { title: '航点', dataIndex: 'waypoints', width: 70 },
    { title: '航高', dataIndex: 'altitude', width: 90 },
    { title: '重叠率', dataIndex: 'overlap', width: 110 },
    { title: 'GSD', dataIndex: 'gsd', width: 100 },
    { title: '架次', dataIndex: 'sorties', width: 70 },
    { title: '冻结时间', dataIndex: 'createdAt', width: 170 },
    {
      title: '操作',
      width: 100,
      render: (_: unknown, row) => (
        <Button size="small" type="link" onClick={() => setViewing(versions.find((v) => v.versionNo === row.versionNo) ?? null)}>
          查看快照
        </Button>
      ),
    },
  ];

  return (
    <Card
      size="small"
      title={
        <Space size={6}>
          <HistoryOutlined />
          <span>方案版本</span>
          {currentVersion > 0 ? <Tag color="geekblue">当前 v{currentVersion}</Tag> : <Tag>未冻结</Tag>}
        </Space>
      }
      extra={
        <Button
          type="primary"
          icon={<LockOutlined />}
          loading={freezing}
          onClick={onFreeze}
          disabled={mission.status === '已归档'}
        >
          {currentVersion > 0 ? '冻结为新版本' : '冻结方案'}
        </Button>
      }
    >
      {toast ? <Alert type="success" showIcon message={toast} closable onClose={() => setToast('')} style={{ marginBottom: 8 }} /> : null}
      {error ? <Alert type="error" showIcon message={error} closable onClose={() => setError('')} style={{ marginBottom: 8 }} /> : null}
      {versions.length === 0 ? (
        <Empty description="尚未冻结方案：点击右上角「冻结方案」生成版本快照" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Table<VersionRow>
          rowKey="key"
          size="small"
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: '暂无版本' }}
        />
      )}
      {viewing ? (
        <Card
          size="small"
          type="inner"
          title={`方案快照 v${viewing.versionNo}（${new Date(viewing.createdAt).toLocaleString('zh-CN')}）`}
          style={{ marginTop: 10 }}
          extra={<Button size="small" onClick={() => setViewing(null)}>收起</Button>}
        >
          <Descriptions size="small" column={2} colon={false}>
            <Descriptions.Item label="相机型号">{viewing.camera.cameraModel}</Descriptions.Item>
            <Descriptions.Item label="传感器">
              {viewing.camera.sensorWidth}×{viewing.camera.sensorHeight} mm
            </Descriptions.Item>
            <Descriptions.Item label="焦距">{viewing.camera.focalLength} mm</Descriptions.Item>
            <Descriptions.Item label="像元">{viewing.camera.pixelSize} μm</Descriptions.Item>
            <Descriptions.Item label="航向重叠率">{viewing.line.overlapForward}%</Descriptions.Item>
            <Descriptions.Item label="旁向重叠率">{viewing.line.overlapSide}%</Descriptions.Item>
            <Descriptions.Item label="GSD">{viewing.line.gsd} cm/px</Descriptions.Item>
            <Descriptions.Item label="航线间距">{viewing.line.spacing} m</Descriptions.Item>
            <Descriptions.Item label="拍照间隔">{viewing.line.photoInterval} m</Descriptions.Item>
            <Descriptions.Item label="预计张数">{viewing.line.estPhotos} 张</Descriptions.Item>
            <Descriptions.Item label="预计耗时">{viewing.line.estDuration} min</Descriptions.Item>
            <Descriptions.Item label="航带方向">{viewing.line.heading}°</Descriptions.Item>
          </Descriptions>
          <div style={{ marginTop: 6 }}>
            <Typography.Text type="secondary">架次拆分：</Typography.Text>
            <Space size={4} wrap>
              {viewing.sorties.map((s) => (
                <Tag key={s.sortieNo} color="blue">
                  第 {s.sortieNo} 架次 · {s.photos} 张 · {s.durationMin} min
                </Tag>
              ))}
            </Space>
          </div>
          <div style={{ marginTop: 6 }}>
            <Typography.Text type="secondary">航点（{viewing.waypoints.length} 个，已冻结不可变）：</Typography.Text>
            <Space size={4} wrap style={{ marginTop: 4 }}>
              {viewing.waypoints.map((w) => (
                <Tag key={w.seq}>
                  #{w.seq} {w.lng.toFixed(5)}, {w.lat.toFixed(5)} · {w.altitude} m
                </Tag>
              ))}
            </Space>
          </div>
        </Card>
      ) : null}
    </Card>
  );
}
