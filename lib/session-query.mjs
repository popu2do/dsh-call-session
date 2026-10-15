/**
 * DSH Session Query Service (Compatibility Facade)
 *
 * Forwards session queries, workspace filtering, and metadata resolution to SessionDirectory.
 */
export {
  SessionDirectory,
  getArchivedSessionIds,
  resolveSessionCwd,
  resolveSessionTitle,
  resolveAgentsService,
  executeSessionQuery,
  resolveNativeSessionStatus
} from './session-directory.mjs';