/**
 * Canonical Mock Host and Context Test Fixtures
 * 
 * Provides unified, decoupled test doubles for Cordis Context
 * and AgentsService.
 */

import { createMockAgent } from './mock-agent.mjs';

/**
 * Creates a mock AgentsService double.
 */
function createMockAgentsService(agentList = []) {
  const list = [...agentList];
  return {
    list: () => list,
    create: async (payload) => {
      const target = createMockAgent(payload.sessionId, {
        title: payload.title,
        cwd: payload.cwd,
        generation: payload.meta?.generation ?? 1,
        options: payload.agentOptions
      });
      list.push(target);
      return target;
    }
  };
}

/**
 * Creates a mock Cordis environment with AgentsService and Root Context.
 */
export function createMockEnvironment(agentList = []) {
  const agentsService = createMockAgentsService(agentList);
  const mockCtx = {
    root: {
      agents: agentsService
    },
    agents: agentsService,
    get: (key) => (key === 'agents' ? agentsService : undefined)
  };

  return { ctx: mockCtx, agentsService, list: agentsService.list() };
}
