/**
 * @module dsh-call-session/workspace
 * 工作区领域基语与路径规约契约
 */

export declare function normalizeWorkspace(rawPath: string | null | undefined): string;

export declare function isSameWorkspace(wsA: string | null | undefined, wsB: string | null | undefined): boolean;
