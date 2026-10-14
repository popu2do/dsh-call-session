/**
 * @module dsh-call-session/tools-registry
 * 原生工具声明与注册适配器
 */

import type { BoardToolsAdapter } from './board-tools-adapter.js';

export declare function buildToolDefinitions(
  ctx: any,
  options?: { boardStore?: any; boardToolsAdapter?: BoardToolsAdapter; config?: any; logger?: any }
): any[];

export declare function registerNativeTools(
  ctx: any,
  options?: { boardStore?: any; boardToolsAdapter?: BoardToolsAdapter; config?: any; logger?: any }
): void;
