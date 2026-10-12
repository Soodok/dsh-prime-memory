/**
 * md 投射的**纯类型**面（无 IO、无 node 依赖）。
 *
 * 为什么要单独一个文件：`src/contract.ts` 的头部纪律是"只允许 type/interface，
 * 不 import 任何运行时值"——它一旦被拉进 client 编译程序，就会连带把
 * `node:fs`/`node:crypto` 的依赖也拖进去（实测：`tsc -p tsconfig.client.json`
 * 立刻报 `Cannot find module 'node:path'`）。所以报告形状收在这里，
 * 存储层与契约层各自 import type，**单一事实源仍然成立**。
 */
export {};
