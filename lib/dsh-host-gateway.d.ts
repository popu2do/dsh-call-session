/**
 * @module dsh-call-session/lib/dsh-host-gateway
 * Declarations for DshHostGateway and host service adapters.
 */

export interface HostGatewayOptions {
  logger?: any;
  [key: string]: any;
}

export interface EffectiveModelParams {
  ctx?: any;
  callerAgent?: any;
  model?: string;
  reasoningEffort?: string;
}

export interface PresetSetupParams {
  ctx?: any;
  callerAgent?: any;
  args?: { preset?: string; [key: string]: any };
  options?: { preset?: string; setup?: (agentCtx: any) => Promise<void> | void; [key: string]: any };
  logger?: any;
}

export interface PresetSetupResult {
  presetId?: string;
  setup?: ((agentCtx: any) => Promise<void> | void) | null;
}

export interface CreateRootAgentParams {
  sessionId?: string;
  title?: string;
  cwd?: string;
  generation?: number;
  creatorSessionId?: string;
  agentOptions?: Record<string, any>;
  presetId?: string;
  setup?: (agentCtx: any) => Promise<void> | void;
  agentsService?: any;
  exec?: any;
}

export declare function resolveCordisService(ctx: any, name: string): any;

export declare function resolveRootAgentsService(ctx: any, exec?: any): any;

export declare function resolveDefaultModelSelection(
  ctx: any,
  logger?: any
): { provider?: string; model?: string; reasoningEffort?: string };

export declare function resolveCallerAgentOptions(callerAgent: any): Record<string, any>;

export declare function resolveEffectiveModel(params?: EffectiveModelParams): Record<string, any>;

export declare const resolvePeerAgentOptions: typeof resolveEffectiveModel;

export declare function resolvePresetSetup(params?: PresetSetupParams): Promise<PresetSetupResult>;

export declare const resolvePeerPresetAndSetup: typeof resolvePresetSetup;

export declare function createRootAgent(
  gatewayOrCtx: any,
  params?: CreateRootAgentParams
): Promise<any>;

export declare function appendTitleEvent(
  gatewayOrCtx: any,
  targetAgent: any,
  title: string
): Promise<boolean>;

export declare function attachWorkspace(
  gatewayOrCtx: any,
  sessionId: string,
  workspacePath: string
): Promise<boolean>;

export declare class DshHostGateway {
  readonly ctx: any;
  readonly options: HostGatewayOptions;
  readonly logger: any;

  constructor(ctx?: any, options?: HostGatewayOptions);

  resolveService(name: string): any;

  resolveRootAgentsService(exec?: any): any;

  resolveEffectiveModel(params?: EffectiveModelParams): Record<string, any>;

  resolvePresetSetup(params?: PresetSetupParams): Promise<PresetSetupResult>;

  createRootAgent(params?: CreateRootAgentParams): Promise<any>;

  appendTitleEvent(targetAgent: any, title: string): Promise<boolean>;

  attachWorkspace(sessionId: string, workspacePath: string): Promise<boolean>;
}
