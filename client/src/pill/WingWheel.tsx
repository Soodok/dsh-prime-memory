/**
 * 八边形域轮（wing 主题轴门面，v6 换挡版）。
 *
 * 几何：八边形为**固定规则正八边形**（顶点半径恒定，无鼓起/无连续半径形变）。
 * 交互：拖动 = 在 8 个顶点间**离散换挡**（档位只能是整数 0-7，绝不停在边中），
 *       并可沿辐条**径向滑回中心**（智能档）——顶点 ↔ 中心互切。
 *   - 边中点仅留 3° 迟滞带（防边界抖动）；**过中点即换挡**（段落感）；
 *   - 拖进中心圈（半径 INNER）则切到中心(智能)；
 *   - 蓝色激活块以纯阻尼缓动在「顶点 ↔ 中心」间滑动（无弹动/无过冲）。
 * 语义：点角 / 拖动松手 = 以该角为主题（会话级域锁定），其余角由服务端硬过滤抑制；
 *       点中心 / 向中心拖 = 回全域（智能档）。权重只与"停在哪个档位"有关。
 *
 * 数据：角计数来自 dsh-memory/wing-overview（打开时拉取一次）。
 * 层级：设置页全局闸 ⊃ 会话闸（图形外）⊃ 域范围（图形内）。
 */
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { ActionButton, Segmented } from '../ui/controls.js';
import type { RpcFn } from '../rpc.js';
import type { WingOverviewResponse } from '../../../src/contract.js';
import { ensureThemeStyle } from '../theme.js';
import { SessionInfoArea } from './SessionInfoArea.js';
// SessionRecalledArea 已从输入区弹窗移除（召回展示由 brief-sidebar 接管）；组件文件保留以备回滚。

/** 轮盘几何（px）：容器边长 / 中心 / 固定半径。 */
const SIZE = 196;
const CENTER = SIZE / 2;
const R = 64; // 八边形顶点到中心（无鼓起、连续形变）
const DRAG_SLOP = 4; // 位移小于它算点击（切换锁定），否则算拖动（换挡）
const DEAD = 3 * (Math.PI / 180); // 边中点迟滞带（只防边界抖动，须小——过大换挡会迟钝）
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** 第 i 角的角度（i=0 从正上开始，顺时针与 WING_CATALOG 词表序一致）。 */
function cornerAngle(i: number): number {
  return (-90 + i * 45) * DEG;
}

/** 第 i 角的坐标。 */
function cornerPos(i: number): { left: number; top: number } {
  const a = cornerAngle(i);
  return { left: CENTER + R * Math.cos(a), top: CENTER + R * Math.sin(a) };
}

/** 第 i 角坐标（x/y 形态，供激活块弹簧使用）。 */
function cornerXY(i: number): { x: number; y: number } {
  const p = cornerPos(i);
  return { x: p.left, y: p.top };
}

/** 把任意角归一化到 [-π, π)。 */
function normAngle(a: number): number {
  while (a < -Math.PI) a += TAU;
  while (a >= Math.PI) a -= TAU;
  return a;
}

/** 指针角度 → 最近角索引（结果永远是整数 0-7）。 */
function angleIndex(a: number): number {
  let t = a + 90 * DEG;
  while (t < 0) t += TAU;
  while (t >= TAU) t -= TAU;
  return Math.round(t / (45 * DEG)) % 8;
}

/** 带边中点阻尼的换挡 snap。当前停在 cur，指针角度 p；
 *  越过中点但未出死区时保持 cur（阻尼），过死区后 snap 到邻角。 */
function snapIndex(p: number, cur: number): number {
  const cand = angleIndex(p);
  if (cand === cur) return cur;
  const curA = cornerAngle(cur);
  const candA = cornerAngle(cand);
  const dir = Math.sign(normAngle(candA - curA)) || 1;
  const edge = curA + dir * (22.5 * DEG);
  // 死区覆盖边中点：指针在边中点 ±DEAD 内时保持原角（阻尼大）
  if (Math.abs(normAngle(p - edge)) < DEAD) return cur;
  return cand;
}

export function WingWheel(props: {
  mode: string;
  /** 会话级域锁定（单选语义）：空数组 = 中心（智能档）；[id] = 以该角为主题。 */
  halls: string[];
  hallIncludeUnlabeled: boolean;
  hallIncludeGeneral: boolean;
  onCommit(key: string): void;
  /** 锁定提交：[id] = 以该角为主题；null = 回中心（清除锁定）。 */
  onCommitWing(halls: string[] | null): void;
  onCommitWingBoundaries(patch: { includeUnlabeled?: boolean; includeGeneral?: boolean }): void;
  /** 会话级注入覆盖（复用既有控件）：缺省 = 浮层不渲染注入行。 */
  recall?: boolean | null;
  onCommitRecall?(next: boolean | null): void;
  rpc: RpcFn;
  sessionId: string;
  error?: string | null;
}) {
  ensureThemeStyle();
  const isOff = props.mode === 'off';
  const [overview, setOverview] = useState<WingOverviewResponse | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  // 关键词回填：忙碌态 + 完成后的结果行（本区串按文件惯例硬编码中文，同 wing 回填）。
  const [kwBusy, setKwBusy] = useState(false);
  const [kwSummary, setKwSummary] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  // 回填后的轮询计时器（卸载时统一清除）
  const timersRef = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const t of timersRef.current) window.clearTimeout(t);
    },
    [],
  );

  // 角计数与词表随打开拉取一次
  useEffect(() => {
    let alive = true;
    props
      .rpc('dsh-memory/wing-overview', {})
      .then((r) => {
        if (!alive) return;
        if (r && r.ok) setOverview(r.value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [props.rpc]);

  const cornerCount = (id: string): number | null => {
    if (!overview) return null;
    if (id === 'general') return overview.general;
    return overview.corners.find((c) => c.id === id)?.count ?? 0;
  };

  /** 一键回填：对存量未打标记忆批量补打 wing 标签。 */
  const backfill = () => {
    if (backfillBusy || !overview || overview.unlabeled === 0) return;
    setBackfillBusy(true);
    setLocalError(null);
    let polls = 0;
    const finish = () => setBackfillBusy(false);
    const tick = () => {
      polls++;
      props
        .rpc('dsh-memory/wing-overview', {})
        .then((r) => {
          const v = r && r.ok ? r.value : null;
          if (v) setOverview(v);
          if ((v && v.unlabeled === 0) || polls >= 20) finish();
          else {
            const t = window.setTimeout(tick, 3000);
            timersRef.current.push(t);
          }
        })
        .catch(() => finish());
    };
    props
      .rpc('dsh-memory/wing-backfill', {})
      .then((r) => {
        if (!r || !r.ok) {
          setLocalError(r && r.error ? '回填失败：' + r.error.message : '回填失败');
          finish();
          return;
        }
        timersRef.current.push(window.setTimeout(tick, 3000));
      })
      .catch((e: unknown) => {
        setLocalError('回填失败：' + String((e && (e as Error).message) || e));
        finish();
      });
  };

  /**
   * 关键词蒸馏回填：对缺 `dsh_keywords` 的存量记忆批量补关键词，喂 FTS 关键词轴。
   * 进口同一端点带单飞守卫：运行中重复调只读状态不重启，首次 running=false 即停——不会误触发二次扫描。
   */
  const keywordBackfill = () => {
    if (kwBusy) return;
    setKwBusy(true);
    setKwSummary(null);
    setLocalError(null);
    let polls = 0;
    const finish = () => setKwBusy(false);
    const showResult = (v: { updated?: number; failed?: number }) => {
      const fail = v.failed ?? 0;
      setKwSummary(`关键词回填完成：成功 ${v.updated ?? 0} 条${fail > 0 ? `，失败 ${fail} 条` : ''}`);
    };
    const failMsg = (m: string) => { setLocalError(m); finish(); };
    const tick = () => {
      polls++;
      props
        .rpc('dsh-memory/keyword-backfill', {})
        .then((r: { ok?: boolean; value?: { enabled?: boolean; running?: boolean; updated?: number; failed?: number }; error?: { message?: string } }) => {
          const v = r && r.ok ? r.value : null;
          if (!v) { failMsg('关键词回填失败'); return; }
          if (!v.enabled) { failMsg('关键词回填未开启：请先在设置里打开 keyword.enabled'); return; }
          if (!v.running) { showResult(v); finish(); return; }
          if (polls >= 20) { showResult(v); finish(); return; }
          timersRef.current.push(window.setTimeout(tick, 3000));
        })
        .catch(() => failMsg('关键词回填失败'));
    };
    props
      .rpc('dsh-memory/keyword-backfill', {})
      .then((r: { ok?: boolean; value?: { enabled?: boolean; running?: boolean }; error?: { message?: string } }) => {
        if (!r || !r.ok) { failMsg(r && r.error ? '关键词回填失败：' + r.error.message : '关键词回填失败'); return; }
        if (!r.value || !r.value.enabled) { failMsg('关键词回填未开启：请先在设置里打开 keyword.enabled'); return; }
        timersRef.current.push(window.setTimeout(tick, 3000));
      })
      .catch((e: unknown) => failMsg('关键词回填失败：' + String((e && (e as Error).message) || e)));
  };

  // ── 离散换挡：档位永远是整数角；中心(智能)同样是可停档位，沿辐条径向滑入 ──
  const boxRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const downIndexRef = useRef<number | null>(null); // 按下时的角（点击切换用）
  const dragTargetRef = useRef<number | null>(null); // 拖动当前目标（null = 智能/中心）
  // drag: null = 未拖动；{ index } = 拖动中（index=null 表示已滑到中心 = 智能）
  const [drag, setDrag] = useState<{ index: number | null } | null>(null);

  const lockedIndex = (() => {
    if (props.halls.length !== 1 || !overview) return null;
    const i = overview.corners.findIndex((c) => c.id === props.halls[0]);
    return i >= 0 ? i : null;
  })();
  /** 当前指示的角；null = 智能/中心（蓝块停在中心）。 */
  const activeCorner = drag ? drag.index : lockedIndex;

  // ── 阻尼滑块：蓝色激活块沿辐条在「顶点 ↔ 中心(智能)」间缓动滑动
  //    （纯阻尼指数逼近，无弹动/无过冲） ──
  const blockPosRef = useRef<{ x: number; y: number }>(
    activeCorner != null ? cornerXY(activeCorner) : { x: CENTER, y: CENTER },
  );
  const blockTargetRef = useRef<{ x: number; y: number }>(blockPosRef.current);
  const [blockPos, setBlockPos] = useState(blockPosRef.current);
  useEffect(() => {
    blockTargetRef.current =
      activeCorner != null ? cornerXY(activeCorner) : { x: CENTER, y: CENTER };
  }, [activeCorner]);
  // reduced-motion：用户要求减少动态效果 → 蓝块不做缓动，直接吸附终点（静帧）
  const reducedMotionRef = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      reducedMotionRef.current = mq.matches;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const cur = blockPosRef.current;
      const tgt = blockTargetRef.current;
      if (reducedMotionRef.current) {
        // 静帧：直接落位，不插值
        if (cur.x !== tgt.x || cur.y !== tgt.y) {
          blockPosRef.current = tgt;
          setBlockPos(tgt);
        }
      } else {
        const dx = tgt.x - cur.x;
        const dy = tgt.y - cur.y;
        if (Math.hypot(dx, dy) > 0.05) {
          // 指数逼近：位置按比例一次性靠近目标，无速度累积 → 不会过冲/回弹
          const next = { x: cur.x + dx * 0.2, y: cur.y + dy * 0.2 };
          blockPosRef.current = next;
          setBlockPos(next);
        } else if (cur.x !== tgt.x || cur.y !== tgt.y) {
          blockPosRef.current = tgt;
          setBlockPos(tgt);
        }
      }
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const pointAngle = (clientX: number, clientY: number) => {
    const box = boxRef.current;
    if (!box) return { angle: 0, dist: 0 };
    const r = box.getBoundingClientRect();
    const scale = r.width / SIZE || 1;
    const dx = (clientX - (r.left + CENTER * scale)) / scale;
    const dy = (clientY - (r.top + CENTER * scale)) / scale;
    return { angle: Math.atan2(dy, dx), dist: Math.hypot(dx, dy) };
  };

  const INNER = 34; // 中心区半径：拖进此圈 = 智能档（沿辐条向内滑）

  const onBoxDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isOff) return;
    const { angle, dist } = pointAngle(e.clientX, e.clientY);
    if (dist < 24) return; // 中心按钮自管点击
    e.currentTarget.setPointerCapture?.(e.pointerId);
    movedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    const idx = angleIndex(angle);
    downIndexRef.current = idx;
    dragTargetRef.current = idx;
    setDrag({ index: idx });
  };
  const onBoxMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    const s = startRef.current;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > DRAG_SLOP) movedRef.current = true;
    if (!movedRef.current) return;
    const { angle, dist } = pointAngle(e.clientX, e.clientY);
    const cur = dragTargetRef.current;
    // 径向二分：进中心圈 = 智能（沿辐条向内）；出圈 = 落到最近角
    //（从中心出来时没有"原角"，直接取最近角，不走死区）
    const cand: number | null =
      dist < INNER ? null : cur == null ? angleIndex(angle) : snapIndex(angle, cur);
    if (cand !== cur) {
      dragTargetRef.current = cand;
      setDrag({ index: cand });
    }
  };
  const onBoxUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const moved = movedRef.current;
    const di = downIndexRef.current;
    const dt = dragTargetRef.current;
    startRef.current = null;
    downIndexRef.current = null;
    dragTargetRef.current = null;
    setDrag(null);
    if (!moved) {
      // 点击某角：锁定该角。**不做反向取消**——点已选中的角原地保留，
      // 回全域只走中心（避免"点一下松开又弹回去"的误触）。
      const id = di != null ? overview?.corners[di]?.id : undefined;
      if (!id) return;
      if (!props.halls.includes(id)) props.onCommitWing([id]);
    } else if (dt == null) {
      // 拖到中心：回智能档（全域）
      if (props.halls.length !== 0) props.onCommitWing(null);
    } else {
      // 拖到某角：以该角为主题
      const id = overview?.corners[dt]?.id;
      if (id && !props.halls.includes(id)) props.onCommitWing([id]);
    }
  };

  // 固定正八边形顶点
  const polyPoints = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const p = cornerPos(i);
    return `${p.left},${p.top}`;
  }).join(' ');

  const grayStyle: CSSProperties = isOff
    ? { opacity: 0.45, pointerEvents: 'none' as const }
    : {};

  // 边界开关（未打标 / 跨域）在"智能档"下无意义（没有锁定的域）——**置灰而非卸载**：
  // 卸载会改变浮层高度 → 切档时下方内容跳变（实测观感差）。置灰保留占位与高度。
  const boundariesDisabled = props.halls.length === 0 || isOff;

  return (
    <div style={{ width: SIZE }}>
      {/* ── 图形内：固定正八边形 + 阻尼滑块（蓝色激活块） ── */}
      <div
        ref={boxRef}
        style={{ position: 'relative', width: SIZE, height: SIZE, ...grayStyle }}
        onPointerDown={onBoxDown}
        onPointerMove={onBoxMove}
        onPointerUp={onBoxUp}
        onPointerCancel={onBoxUp}
      >
        <svg
          width={SIZE}
          height={SIZE}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          aria-hidden="true"
        >
          {/* 中性基线参考八边形（虚线） */}
          <polygon
            points={polyPoints}
            fill="none"
            stroke="var(--dsh-mem-wing-line)"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity={0.45}
          />
          {/* 实线八边形 */}
          <polygon
            points={polyPoints}
            fill="none"
            stroke="var(--dsh-mem-wing-line)"
            strokeWidth="1"
          />
          {/* 8 条固定辐条：中性参考线，不强调颜色、不参与动画 */}
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
            const p = cornerPos(i);
            return (
              <line
                key={'spoke' + i}
                x1={CENTER}
                y1={CENTER}
                x2={p.left}
                y2={p.top}
                stroke="var(--dsh-mem-wing-line)"
                strokeWidth="1"
              />
            );
          })}
        </svg>
        {/* 蓝色激活块：阻尼滑块（无弹动），沿辐条在「顶点 ↔ 中心(智能)」间滑动
            （非辐条）。位于八边形之上、角标/中心钮之下；切档时以纯阻尼缓动滑入。 */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: blockPos.x,
            top: blockPos.y,
            transform: 'translate(-50%, -50%)',
            width: 52,
            height: 30,
            borderRadius: 10,
            border: '1.5px solid var(--dsh-mem-accent)',
            background: 'var(--dsh-mem-accent-weak)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
        {/* 中心 = 智能档：点击回中心 = 全域。视觉与角标同尺寸，蓝块滑到此处即智能 */}
        <button
          type="button"
          title="智能档：自动判断召回各域（点中心 / 从角向内拖 = 全域）"
          onClick={() => props.onCommitWing(null)}
          style={{
            position: 'absolute',
            left: CENTER,
            top: CENTER,
            transform: 'translate(-50%, -50%)',
            width: 52,
            height: 30,
            borderRadius: 10,
            border: 'none',
            background: 'transparent',
            color:
              activeCorner == null
                ? 'var(--dsh-mem-wing-corner-on)'
                : 'var(--dsh-mem-wing-corner)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            zIndex: 2,
          }}
        >
          智能
        </button>
        {/* 8 角 = 域：视觉层，pointerEvents none（命中统一由 box 处理） */}
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const corner = overview?.corners[i];
          const id = corner?.id;
          const label = corner?.label ?? LABEL_FALLBACK[i] ?? `域${i + 1}`;
          const count = id ? cornerCount(id) : null;
          const active = activeCorner === i;
          const dim = activeCorner != null && !active;
          const empty = count === 0;
          const p = cornerPos(i);
          return (
            <div
              key={id ?? i}
              title={
                id
                  ? `「${label}」${count ?? 0} 条\n点按/拖动 = 以该角为主题（抑制其他角）`
                  : '词表加载中'
              }
              style={{
                position: 'absolute',
                left: p.left,
                top: p.top,
                transform: 'translate(-50%, -50%)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 0,
                padding: '1px 4px',
                borderRadius: 8,
                border: '1px solid transparent',
                background: 'transparent',
                color: active
                  ? 'var(--dsh-mem-wing-corner-on)'
                  : empty
                    ? 'var(--dsh-mem-wing-empty)'
                    : 'var(--dsh-mem-wing-corner)',
                fontSize: 9.5,
                lineHeight: '12px',
                fontWeight: active ? 600 : 400,
                whiteSpace: 'nowrap',
                maxWidth: 58,
                opacity: dim ? 0.45 : 1,
                pointerEvents: 'none',
                zIndex: 2,
              }}
            >
              <span>{label}</span>
              {/* 空角诚实展示：不写"0 条" */}
              <span style={{ fontSize: 8, opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>
                {count === null ? ' ' : empty ? '空角' : `${count} 条`}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── 图形外：垂直堆叠以收敛宽度 ── */}
      {/* 锁角时的边界开关（D1）：未打标默认包含 / 跨域 general 默认不含。
          智能档/off 时**置灰占位**（不卸载 → 浮层高度稳定、无跳变）。 */}
      <div
        title={
          props.halls.length === 0 ? '选定某个角（单 Wing）后，这两项才生效' : '锁定 Wing 时两类无角记忆是否参与召回'
        }
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          marginTop: 10,
          opacity: boundariesDisabled ? 0.45 : undefined,
          filter: boundariesDisabled ? 'grayscale(1)' : undefined,
          pointerEvents: boundariesDisabled ? 'none' : undefined,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--dsh-mem-text-3)' }}>
          {overview ? `另有 ${overview.unlabeled} 条未打标` : '未打标'}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Segmented
            value={props.hallIncludeUnlabeled ? 'in' : 'ex'}
            options={[
              { key: 'in', label: '含未打标', title: '未打标记忆默认包含' },
              { key: 'ex', label: '不含', title: '锁定 Wing 时排除未打标记忆' },
            ]}
            onChange={(key) => props.onCommitWingBoundaries({ includeUnlabeled: key === 'in' })}
          />
          <Segmented
            value={props.hallIncludeGeneral ? 'in' : 'ex'}
            options={[
              { key: 'in', label: '含跨域', title: '跨域（general）兜底记忆也参与召回' },
              { key: 'ex', label: '不含', title: '跨域与单主题相悖，默认不含' },
            ]}
            onChange={(key) => props.onCommitWingBoundaries({ includeGeneral: key === 'in' })}
          />
        </div>
      </div>

      {/* 会话闸：off = 本会话完全隐身 */}
      <Row label="会话">
        <Segmented
          value={isOff ? 'off' : 'on'}
          options={[
            { key: 'on', label: '启用', title: '本会话正常捕获/蒸馏/注入记忆' },
            {
              key: 'off',
              label: '关闭',
              title: '本会话对记忆系统隐身：不捕获、不蒸馏、不注入（数据保留）',
            },
          ]}
          onChange={(key) => props.onCommit(key === 'off' ? 'off' : 'auto')}
        />
      </Row>

      {/* 是否注入三态（off 档禁用） */}
      {props.recall !== undefined && props.onCommitRecall ? (
        <Row label="注入">
          <Segmented
            value={props.recall === null ? 'follow' : props.recall ? 'on' : 'off'}
            disabled={isOff}
            options={[
              { key: 'follow', label: '跟随全局', title: '清除本会话覆盖，跟随全局召回开关' },
              { key: 'on', label: '开', title: '本会话强制注入记忆' },
              { key: 'off', label: '关', title: '只写：记忆照常沉淀，但不注入本会话' },
            ]}
            onChange={(key) => props.onCommitRecall!(key === 'on' ? true : key === 'off' ? false : null)}
          />
        </Row>
      ) : null}

      {/* 未打标回填 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          marginTop: 10,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--dsh-mem-text-3)' }}>
          {overview ? `未打标 ${overview.unlabeled} 条` : '未打标计数加载中'}
        </span>
        <ActionButton
          label={backfillBusy ? '回填中…' : '回填'}
          title="对存量未打标记忆批量补打 wing 标签"
          disabled={!overview || overview.unlabeled === 0 || backfillBusy}
          onClick={() => backfill()}
        />
      </div>

      {/* 关键词回填（keyword 检索轴产出方）*/}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          marginTop: 10,
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--dsh-mem-text-3)' }}>
          {kwSummary || '为存量记忆补检索关键词'}
        </span>
        <ActionButton
          label={kwBusy ? '回填中…' : '关键词回填'}
          title="对缺 dsh_keywords 的存量记忆批量补关键词，喂 FTS 关键词检索轴（需先开 keyword.enabled）"
          disabled={kwBusy}
          onClick={() => keywordBackfill()}
        />
      </div>

      {props.error || localError ? (
        <div style={{ fontSize: 11, color: 'var(--dsh-mem-danger)', marginTop: 8 }}>
          {props.error || localError}
        </div>
      ) : null}

      {/*
        本会话召回列表已移除：召回展示已由 brief-sidebar 接管，输入区弹窗再渲染一份就是重复。
        组件文件 ./SessionRecalledArea 保留（未删），如需回滚恢复本行即可。
      */}

      {/* 会话信息区 */}
      <SessionInfoArea rpc={props.rpc} sessionId={props.sessionId} />
    </div>
  );
}

/** label 在上、控件在下的紧凑行（宽度收敛用）。 */
function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        marginTop: 10,
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--dsh-mem-text-3)' }}>{props.label}</span>
      {props.children}
    </div>
  );
}

/** 词表未送达时的兜底显示（正常路径由 wing-overview 下发的 label 取代）。 */
const LABEL_FALLBACK = ['工作', '人际', '学习', '创作娱乐', '居家', '健康', '财务', '出行'];

/** 水平视口夹持（手机端适配）：浮层以 pill 中心为轴悬浮，窄视口下贴边平移。 */
export function useViewportClamp(popRef: RefObject<HTMLDivElement | null>): number {
  const shiftRef = useRef(0);
  const [shiftX, setShiftX] = useState(0);
  useEffect(() => {
    const clamp = () => {
      const el = popRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      const left = r.left - shiftRef.current;
      const edge = 8;
      let next = 0;
      if (left < edge) next = edge - left;
      else if (left + r.width > window.innerWidth - edge) {
        next = window.innerWidth - edge - (left + r.width);
      }
      if (next !== shiftRef.current) {
        shiftRef.current = next;
        setShiftX(next);
      }
    };
    clamp();
    window.addEventListener('resize', clamp);
    const iv = window.setInterval(clamp, 100);
    return () => {
      window.removeEventListener('resize', clamp);
      window.clearInterval(iv);
    };
  }, [popRef]);
  return shiftX;
}
