/**
 * 文件身份名（N1）：把一条 L1 记忆的正文折成一个**人可读、可编辑、全库唯一**的短名，
 * 直接当 `<root>/<type>/<name>.memory.md` 的文件名干。
 *
 * 为什么不用现成的键：
 * - `id` 每轮新铸、从不复用（merge = 旧行软删 + 新记录追加），拿它当文件名等于每天换名；
 * - `scene_name` 实测基数大于记录数，当不了唯一名；
 * - `ext_key` 是**导入幂等键**（机器算的、只在来源内唯一），语义与"人给这条记忆起的名字"不同。
 *
 * 名字纪律**复用** `sanitizeFilename`（`store/scenes.ts`）而不是另写一套：
 * 那里已经处理过非法字符、Windows 保留设备名（`CON`/`LPT1`…）、stem 超长截断。
 * 自己拼一份正则迟早和它漂移，而漂移的后果是"库里存的名字写不出文件"。
 */
import { sanitizeFilename } from '../store/scenes.js';
/** 名字干长度上限（字符）。取正文首行的前若干字，够认、够短、能在面板里读。 */
export const NAME_MAX = 24;
/**
 * 正文 → 名字干。
 *
 * 规则：取**首个非空行**（跳过 markdown 的 `#`/`>`/`-`/`*` 前缀符号）→ 截断到
 * {@link NAME_MAX} → 过 `sanitizeFilename` 的同一套字符纪律 → 剥掉它补的 `.md`。
 * 正文为空、或整行都是标点（洗完全空）→ 返回 `''`，调用方按"没有名字"处理
 * （投射器回落到 `mem-<id8>`），**不**在这里编一个看起来像名字的东西。
 *
 * @param content - 记忆正文。
 * @returns 文件名安全的名字干；无可用文字时 `''`。
 */
export function deriveName(content) {
    const line = (content ?? '').split('\n').find((l) => l.trim().length > 0) ?? '';
    const bare = line.trim().replace(/^[#>\-*+\s]+/, '').trim();
    if (bare.length === 0)
        return '';
    const clipped = bare.length > NAME_MAX ? bare.slice(0, NAME_MAX) : bare;
    return sanitizeFilename(clipped).replace(/\.md$/i, '');
}
/**
 * 校验一个**人给的**名字是否可用（形状，不含唯一性）。
 *
 * 人从面板或 md 文件里改名字时，先过这道形状闸再谈唯一性：形状不合就拒，
 * 比"收下然后写不出文件"好。返回归一后的名字（可能与入参不同：洗掉了非法字符）。
 *
 * @param raw - 用户给的名字。
 * @returns `{ ok: true, name }` 或 `{ ok: false, reason }`。
 */
export function normalizeName(raw) {
    const trimmed = (raw ?? '').trim();
    if (trimmed.length === 0)
        return { ok: false, reason: 'empty' };
    if (trimmed.length > NAME_MAX * 2)
        return { ok: false, reason: 'too-long' };
    const safe = sanitizeFilename(trimmed).replace(/\.md$/i, '');
    if (safe.length === 0)
        return { ok: false, reason: 'no-usable-char' };
    if (safe !== trimmed)
        return { ok: false, reason: 'illegal-chars' };
    return { ok: true, name: safe };
}
