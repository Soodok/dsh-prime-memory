import { callLLM, parseJsonLogged, resolveLayerTokens } from '../llm.js';
import { buildScenePrompt, formatSceneSummaries } from '../prompts/scene.js';
import { Bm25Index } from '../store/bm25.js';
import { chunkByCharBudget, MAX_SCENE_CHUNK_CHARS } from './l1.js';
const REQUEST_RE = /\[PERSONA_UPDATE_REQUEST\]\s*reason:\s*([\s\S]*?)\[\/PERSONA_UPDATE_REQUEST\]/;
export async function runSceneConsolidation(ctx, cfg, scenes, newMemories, logger, family) {
    if (!cfg.l2.enabled || newMemories.length === 0) {
        return { changed: 0 };
    }
    const summaries = await scenes.list();
    // 跨块共享的上下文：相关场景全文只选一次（BM25 按全量新记忆选），各块复用。
    const sceneSummaries = formatSceneSummaries(summaries);
    const sceneContents = await pickSceneContents(scenes, summaries, newMemories, cfg.l2.sceneContextLimit);
    // R1 分块分载：把 newMemories 按字符预算切块逐块整合（旧版一次塞整族 backlog → 大库必撞超时）。
    // 单块（小 backlog）时与改前逐字一致（零漂移）；多块时跨块合并判断为近似（诚实降级）。
    const perChunk = Math.min(MAX_SCENE_CHUNK_CHARS, Math.max(20_000, cfg.llm.maxInputChars - 42_000));
    const chunks = chunkByCharBudget(newMemories, perChunk);
    if (chunks.length > 1) {
        logger.info(`[memory] L2 输入超预算(${newMemories.length} 条新记忆),分 ${chunks.length} 块整合(每块 ≤${perChunk} 字符)`);
    }
    let changed = 0;
    let failedChunks = 0;
    let personaRequestedReason;
    for (const chunk of chunks) {
        const memoriesJson = JSON.stringify(chunk.map((m) => ({
            record_id: m.id,
            content: m.content,
            type: m.type,
            priority: m.priority,
            scene_name: m.scene_name,
            // repo 归属(ADR-0015 T1.9/T1.10):L2 场景归属决策可见项目边界——
            // this-repo 记录不得并入跨项目场景;'' = 未归属(不引导分组)。
            repoKeyName: m.repoKeyName ?? '',
            applicability: m.applicability ?? '',
            timestamps: m.timestamps.map((t) => new Date(t).toISOString()),
        })), null, 2);
        const { systemPrompt, userPrompt } = buildScenePrompt({
            memoriesJson,
            sceneSummaries,
            sceneContents,
            currentTimestamp: new Date().toISOString(),
            existingSceneFiles: summaries.map((s) => s.path),
            maxScenes: cfg.l2.maxScenes,
            family,
        });
        try {
            const raw = await callLLM(ctx, cfg, {
                system: systemPrompt,
                user: userPrompt,
                maxTokens: resolveLayerTokens(cfg, 'l2'),
                layer: 'l2',
                logger,
            });
            // 解析:先取 PERSONA_UPDATE_REQUEST 标记,再解析操作数组
            const reqMatch = REQUEST_RE.exec(raw);
            if (reqMatch?.[1]?.trim())
                personaRequestedReason = reqMatch[1].trim();
            const opsRaw = reqMatch ? raw.replace(REQUEST_RE, '') : raw;
            const ops = parseJsonLogged(opsRaw, 'L2 场景操作', logger);
            if (!Array.isArray(ops))
                throw new Error('L2 输出不是操作数组');
            for (const op of ops) {
                if (!op || typeof op.path !== 'string')
                    continue;
                try {
                    if (op.op === 'write' && typeof op.content === 'string') {
                        await scenes.write(op.path, op.content);
                        changed++;
                        logger.debug?.(`[memory] L2 写入场景 ${op.path} (${op.content.length} 字符)`);
                    }
                    else if (op.op === 'delete') {
                        await scenes.write(op.path, '[DELETED]');
                        changed++;
                        logger.debug?.(`[memory] L2 删除场景 ${op.path}`);
                    }
                }
                catch (err) {
                    logger.warn(`[memory] L2 操作失败 ${op.path}: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }
        catch (err) {
            // R1 块级容错：单块超时/崩只丢这块，不掀全族（旧行为是整抛）
            failedChunks++;
            logger.warn(`[memory] L2 分块整合失败(family=${family},${chunk.length} 条记忆本块丢弃): ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }
    }
    logger.info(`[memory] L2 场景整合完成(family=${family}):${newMemories.length} 条新记忆 → ${changed} 个文件操作(场景总数 ${summaries.length}` +
        (chunks.length > 1 ? `,分 ${chunks.length} 块、失败 ${failedChunks} 块` : '') + `)` +
        (personaRequestedReason ? `,请求 L3 更新:${personaRequestedReason}` : ''));
    return { changed, personaRequestedReason };
}
/** 选出与本次新记忆最相关的场景全文(供 LLM 参考,避免全量塞入)。 */
async function pickSceneContents(scenes, summaries, newMemories, limit) {
    if (summaries.length === 0 || limit <= 0)
        return '';
    const index = new Bm25Index();
    index.rebuild(summaries.map((s) => ({ id: s.path, text: `${s.summary} ${s.path}` })));
    const query = newMemories.map((m) => m.content).join(' ');
    const hits = index.search(query, limit);
    const parts = [];
    for (const h of hits) {
        const content = await scenes.read(h.id);
        if (content)
            parts.push(`### 文件: ${h.id}\n\`\`\`markdown\n${content}\n\`\`\``);
    }
    return parts.join('\n\n');
}
