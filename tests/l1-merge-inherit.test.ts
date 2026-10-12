/**
 * `mergeAxes`（P0-c：合并时的检索轴并集）的纯函数回归。
 *
 * 这一段的现状是：合并产物只带新记忆的 metadata，targets 的 tags/hall/cogHall/
 * 使用场景**全丢**且全程无日志（spec F2）。一次合并就把这条记忆从它原来的
 * Room/Wing 里摘出去，而面板上看不出任何异常——所以这里钉的不是"并集算得对"，
 * 而是"合并不再吃轴"。
 *
 * 用纯函数测而不是驱动整条 LLM 管线：并集逻辑与 LLM 无关，驱动管线只会让
 * 断言被抽取/去重两段噪声盖住。
 */
import { describe, expect, it } from 'vitest';
import { mergeAxes } from '../src/pipeline/l1.js';

describe('mergeAxes：并集与单值轴', () => {
  it('tags 取并集去重，且仍过 normTags 的纪律（不因合并而放宽）', () => {
    const { metadata } = mergeAxes(
      { tags: ['release-flow', 'BAD TAG!', ''] },
      [{ tags: ['release-flow', 'npm-publish'] }, { tags: ['<script>'] }],
    );
    const tags = metadata.tags as string[];
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags).toContain('release-flow');
    expect(tags).toContain('npm-publish');
    // 非法/空标签不会因"并集"而被放行。
    expect(tags.every((t) => t.length > 0 && !t.includes(' '))).toBe(true);
  });

  it('使用场景并集后维持 ≤3 的上限（多了会灌 prompt）', () => {
    const { metadata } = mergeAxes(
      { dsh_usage_scenario: ['发版前', '改配置时'] },
      [{ dsh_usage_scenario: ['重启服务前', '跑测试时'] }],
    );
    const sc = metadata.dsh_usage_scenario as string[];
    expect(sc.length).toBeLessThanOrEqual(3);
    expect(sc).toContain('发版前');
  });

  it('hall：自己没打标且目标侧只有一个结论才继承', () => {
    const { metadata, notes } = mergeAxes({}, [{ hall: 'work', tags: ['a'] }, { hall: 'work' }]);
    expect(metadata.hall).toBe('work');
    expect(notes).toEqual([]);
  });

  it('hall：两侧互斥时保留新记忆侧并留痕，绝不拼成 "a,b"', () => {
    const kept = mergeAxes({ hall: 'work' }, [{ hall: 'home' }]);
    expect(kept.metadata.hall).toBe('work');
    expect(kept.notes.join(' ')).toContain('home');
    // 目标侧互斥也不猜：值必须仍是某个**合法单值**，不能是拼接串。
    const clash = mergeAxes({}, [{ hall: 'work' }, { hall: 'home' }]);
    expect(String(clash.metadata.hall ?? '')).not.toContain(',');
    expect(clash.notes.join(' ')).toContain('互斥');
  });

  it('cogHall：自己没打标才从目标侧继承（两侧都有则不动）', () => {
    const inherit = mergeAxes({}, [{ cogHall: 'facts' }]);
    expect(inherit.metadata.cogHall).toBe('facts');
    const own = mergeAxes({ cogHall: 'events' }, [{ cogHall: 'facts' }]);
    expect(own.metadata.cogHall).toBe('events');
  });

  it('Room 待评审状态跟着走（否则合并把"待评审"洗成"未标注"、下轮重新入队）', () => {
    const { metadata } = mergeAxes({}, [{ roomCandidates: ['npm-publish'], roomReview: 'pending' }]);
    expect(metadata.roomCandidates).toContain('npm-publish');
    expect(metadata.roomReview).toBe('pending');
    // 自己已有 review 时不被目标侧覆盖。
    const own = mergeAxes({ roomReview: 'reviewed' }, [{ roomReview: 'pending' }]);
    expect(own.metadata.roomReview).toBe('reviewed');
  });

  it('两侧都没有这些键时**不无中生有**（不写空键，记录形状与改动前一致）', () => {
    const { metadata, notes } = mergeAxes({ origin: 'x' }, [{}, undefined]);
    expect(metadata).toEqual({ origin: 'x' });
    expect(notes).toEqual([]);
  });

  it('纯函数：不改动入参（管线后面还要拿原 metadata 落锚点）', () => {
    const self = { tags: ['a'], hall: 'work' };
    const target = { tags: ['b'] };
    const out = mergeAxes(self, [target]);
    expect(self).toEqual({ tags: ['a'], hall: 'work' });
    expect(target).toEqual({ tags: ['b'] });
    expect(out.metadata).not.toBe(self);
  });
});
