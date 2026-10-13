/**
 * `title → name` 那一跳（Phase 3 的落库接缝）。
 *
 * 为什么单独测这里：管线其余部分都在测"抽取到的内容对不对"，而名字是**文件身份键**——
 * 模型给的名字过不了闸却仍然写进去，后果不是难看，是投射路径里出现带冒号/换行的非法
 * 文件名，或两条记录抢同一个名字把整条记忆挤出检索库。
 * 驱动整条 LLM 管线会把断言埋进两段噪声里，所以直接打导出出来的那个构造函数
 * （与 `mergeAxes` 同一先例）。
 */
import { describe, expect, it } from 'vitest';
import { toStoreRecord, type PendingMemory } from '../src/pipeline/l1.js';

function pending(title: unknown): PendingMemory {
  return {
    content: '结论：npm publish 必须显式带 registry。依据：默认指向镜像会错投。',
    type: 'work_fact',
    priority: 60,
    source_message_ids: ['m1'],
    metadata: {},
    scene_name: '发包',
    title: title as string | undefined,
    record_id: 'mem_1',
    family: 'work',
    scope: 'global',
    workspaceId: '',
    repoKeyName: '',
    repoKeyOwner: '',
    applicability: '',
  };
}

const build = (title: unknown) => toStoreRecord(pending(title), 1_700_000_000_000, 1_700_000_000_000);

describe('toStoreRecord 消费 title', () => {
  it('合格 title 落成 name（原样，含中英混排）', () => {
    const r = build('npm发布必须显式指定registry');
    expect(r.name).toBe('npm发布必须显式指定registry');
  });

  it('只有形状噪声（空格/尾点）的先整形再入库，不白丢一个合法名', () => {
    expect(build('npm 发布 必须 显式 指定 ').name).toBe('npm-发布-必须-显式-指定');
    expect(build('记忆改名后的归档流程.').name).toBe('记忆改名后的归档流程');
  });

  it('只超长时按词元边界收一刀，仍算模型给的名字', () => {
    const long = '这'.repeat(46);
    const r = build(long);
    expect(r.name).toBeDefined();
    expect(r.name!.length).toBeLessThanOrEqual(40);
  });

  it('句子/引子开头/路径/id 残片一律不写成名字，交回起名器', () => {
    for (const bad of ['用户要求以后所有发包都带参数', '保存到 docs/report.md 的结论', '会话-session-44332549-f05e', '这个说法是错的。']) {
      const r = build(bad);
      // 键**不存在**（不是空串）：空串会绕过部分唯一索引，也会让下游分不清"没名字"与"名字被洗空"。
      expect('name' in r, bad).toBe(false);
    }
  });

  it('没给 title 时记录形状与改动前逐字一致（不新增键）', () => {
    expect('name' in build(undefined)).toBe(false);
    expect('name' in build('')).toBe(false);
    // 非字符串也不接住：模型输出是不可信输入。
    expect('name' in build({})).toBe(false);
    expect('name' in build(42)).toBe(false);
  });
});
